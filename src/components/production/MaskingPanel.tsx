import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Loader2,
  ScanLine,
  Ban,
  Monitor,
  Copy,
  CheckCircle
} from 'lucide-react';
import type { ProductionApiClient } from '../../services/productionApi';
import { saveProcessingJobToSupabase } from '../../services/supabase';
import type {
  DatasetRecord,
  MaskFootprint,
  ProcessingJobRecord
} from '../../types/production';
import { loadImageWithRetry } from '../../utils/imageEnhancement';
import { detectMaskFootprint } from '../../utils/maskFootprintDetector';
import { extractCanonicalSubgrid } from '../../utils/datasetLineage';
import { productionNasUrlFor } from './common';
import { Surface } from './chrome';

export interface MaskingPanelProps {
  datasets: DatasetRecord[];
  api: ProductionApiClient;
  projectSettings: any;
  translate: (key: string) => string;
  isGuestUser?: boolean;
  onRefreshJobs: () => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
}

const confidenceColor = (c: number) =>
  c >= 0.7 ? 'text-emerald-300' : c >= 0.45 ? 'text-amber-300' : 'text-red-300';

export const MaskingPanel: React.FC<MaskingPanelProps> = ({
  datasets,
  api,
  projectSettings,
  isGuestUser,
  onRefreshJobs,
  onAddNotification,
  onAddAuditLog,
  userLabel
}) => {
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [sampleName, setSampleName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [footprint, setFootprint] = useState<MaskFootprint | null>(null);
  const [overrideBand, setOverrideBand] = useState(0.18);
  const [useOverride, setUseOverride] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [copiedAction, setCopiedAction] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const is4PcMode = (projectSettings?.processingEngineMode || 'multi_pc_workstations') === 'multi_pc_workstations';

  const selected = datasets.find((d) => d.id === selectedDatasetId);
  const canonicalSg = extractCanonicalSubgrid(selected?.subgrid);
  const sourceUrl = productionNasUrlFor(
    projectSettings,
    selected?.source_folder || '',
    sampleName || (canonicalSg ? `${canonicalSg}-00001.jpg` : '')
  );

  useEffect(() => {
    setFootprint(null);
    setAnalyzedUrl(null);
  }, [selectedDatasetId, sampleName]);

  const runDetection = async () => {
    if (!sourceUrl) return;
    setScanning(true);
    try {
      const img = await loadImageWithRetry(sourceUrl);
      const fp = detectMaskFootprint(img, {});
      setFootprint(fp);

      const c = document.createElement('canvas');
      const scale = Math.min(1, 1400 / img.naturalWidth);
      c.width = Math.max(2, Math.round(img.naturalWidth * scale));
      c.height = Math.max(2, Math.round(img.naturalHeight * scale));
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const bandH = Math.max(
          1,
          Math.round(c.height * (fp.detected ? fp.bottomBandHeight : useOverride ? overrideBand : 0.18))
        );
        const y = c.height - bandH;
        ctx.strokeStyle = 'rgba(251,146,60,0.95)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 5]);
        ctx.strokeRect(0, y, c.width, bandH);
        ctx.fillStyle = 'rgba(251,146,60,0.18)';
        ctx.fillRect(0, y, c.width, bandH);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(251,146,60,1)';
        ctx.font = 'bold 16px system-ui';
        ctx.fillText(
          `Detected mask band (${(fp.detected ? fp.bottomBandHeight * 100 : (useOverride ? overrideBand : 0.18) * 100).toFixed(1)}% of height)`,
          12,
          y - 10
        );
      }
      canvasRef.current = c;
      setAnalyzedUrl(c.toDataURL('image/jpeg', 0.9));
      if (!fp.detected) {
        onAddNotification?.({
          title: 'Mask Not Detected',
          message: 'No strong bottom mask footprint found. Manual override below may still be used.',
          category: 'PENDING',
          read: false
        });
      }
    } catch (err) {
      onAddNotification?.({
        title: 'Detection Failed',
        message: err instanceof Error ? err.message : String(err),
        category: 'ERROR',
        read: false
      });
    } finally {
      setScanning(false);
    }
  };

  const copyPhotoshopInstructions = () => {
    const effectiveBand = useOverride ? overrideBand : (footprint?.detected ? footprint.bottomBandHeight : 0.18);
    const text = `--- Adobe Photoshop Station (PC 4) Nadir Action Guide ---
Subgrid: ${selected?.subgrid || 'ALL'}
Bottom Nadir Band Height: ${Math.round(effectiveBand * 100)}% (≈ ${Math.round(effectiveBand * 5760)}px on 5.7K equirectangular)
Action Sequence:
1. Open /ENHANCED/{subgrid}/*.jpg
2. Select Bottom ${Math.round(effectiveBand * 100)}% or apply Nadir Mask Layer (.png)
3. Run Generative Fill / Nadir Circle Patch
4. Flatten image and export to /PROCESSED/{subgrid}/*.jpg (JPEG quality 92)`;

    navigator.clipboard.writeText(text);
    setCopiedAction(true);
    setTimeout(() => setCopiedAction(false), 2500);
    onAddNotification?.({
      title: 'Photoshop Guide Copied',
      message: 'Copied nadir mask dimensions & batch sequence for PC 4 (Photoshop Station).',
      category: 'INFO',
      read: false
    });
  };

  const queueMaskJob = async () => {
    if (isGuestUser || !selected) return;
    const effectiveBand = useOverride ? overrideBand : (footprint?.detected ? footprint.bottomBandHeight : 0.18);
    setQueuing(true);
    const job: ProcessingJobRecord = {
      job_type: 'MASK',
      name: `Car-Roof Removal • ${selected.subgrid || selected.name}`,
      source_dataset_id: selected.id || null,
      source_folder: selected.source_folder,
      output_folder: selected.output_folder || 'processed',
      subgrid: selected.subgrid,
      provider: is4PcMode ? 'PC 4 — Photoshop Station' : 'NAS GPU Worker',
      software_version: is4PcMode
        ? 'Adobe Photoshop Batch'
        : projectSettings?.productionApiMode === 'http'
          ? 'lama-cleaner'
          : 'mock',
      total_items: selected.file_count || 500,
      status: 'QUEUED',
      progress: 0,
      completed_items: 0,
      error_count: 0,
      operator: userLabel,
      settings: {
        apiMode: api.mode,
        mask: {
          detectAutomatically: !useOverride,
          bottomBandHeight: Number(effectiveBand.toFixed(3)),
          fillModel: 'lama',
          ...(footprint?.detected && footprint.maskB64 ? { maskB64: footprint.maskB64 } : {})
        },
        exportFormat: 'jpeg',
        jpegQuality: 92
      }
    };
    const saved = await saveProcessingJobToSupabase(job);
    if (saved?.id) {
      const res = await api.submitJob(saved);
      onAddNotification?.({
        title: 'MASK Job Queued',
        message: `${saved.name} — ${is4PcMode ? 'Registered for PC 4 handoff' : res.message}`,
        category: 'PENDING',
        read: false
      });
      onAddAuditLog?.(
        'CREATE',
        `MASK Job Queued: ${saved.name}`,
        `${userLabel} queued car-roof removal for band ${effectiveBand.toFixed(2)} via ${job.provider}.`,
        'info'
      );
      onRefreshJobs();
    }
    setQueuing(false);
  };

  return (
    <Surface className="flex flex-col min-h-0">
      {/* 4-STATION MULTI-PC WORKFLOW NOTICE STRIP */}
      {is4PcMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-divider">
          <div className="flex items-center gap-2.5 min-w-0">
            <Monitor size={15} className="text-sky-400 shrink-0" />
            <span className="text-[11px] text-text-muted leading-relaxed">
              <span className="font-bold text-text-base">4-Station Mode Active · Station 4 (Photoshop Station)</span>
              &nbsp;— nadir vehicle patching, circular hood mask &amp; generative fill inpainting executed on <strong className="text-text-base">PC 4</strong> using Photoshop Batch Actions. Use this panel to inspect the bottom footprint % and verify mask boundaries before executing actions.
            </span>
          </div>
          <span className="text-[10px] font-sans text-text-muted bg-inner border border-subtle px-2.5 py-1 rounded shrink-0">
            Input: /ENHANCED/ &rarr; Output: /PROCESSED/
          </span>
        </div>
      )}

      <div className="p-4 grid grid-cols-1 xl:grid-cols-3 gap-4 xl:gap-0 flex-1 min-h-0">
        {/* Inspector rail */}
        <div className="flex flex-col gap-4 min-h-0 xl:pr-5 overflow-y-auto max-h-[600px] xl:max-h-none">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
              Source Dataset
            </label>
            <select
              className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60"
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
            >
              <option value="">— select a dataset —</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.subgrid ? `(${d.subgrid})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
              Sample Frame
            </label>
            <input
              className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 font-sans"
              placeholder="N93E70-00001.jpg"
              value={sampleName}
              onChange={(e) => setSampleName(e.target.value)}
            />
          </div>

          <div className="bg-inner border border-subtle rounded-lg p-3 flex flex-col gap-1.5 text-[11px]">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
              Detection Result
            </span>
            {footprint ? (
              <>
                <span className={confidenceColor(footprint.confidence)}>
                  {footprint.detected ? 'Footprint detected' : 'No clear footprint'} — confidence {Math.round(footprint.confidence * 100)}%
                </span>
                {footprint.detected && (
                  <span className="text-text-muted">
                    Mask band ≈ {Math.round(footprint.bottomBandHeight * 100)}% of frame height · mask ratio {Math.round(footprint.maskRatio * 100)}%
                  </span>
                )}
              </>
            ) : scanning ? (
              <span className="text-text-muted flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin text-sky-400" /> analyzing…
              </span>
            ) : (
              <span className="text-text-muted">Run detection to locate the mask band.</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
              Manual override
            </label>
            <input
              type="checkbox"
              checked={useOverride}
              disabled={isGuestUser}
              onChange={(e) => setUseOverride(e.target.checked)}
              className="accent-slate-300 rounded cursor-pointer"
            />
          </div>
          <input
            type="range"
            min={0.02}
            max={0.5}
            step={0.01}
            value={overrideBand}
            disabled={!useOverride || isGuestUser}
            onChange={(e) => setOverrideBand(Number(e.target.value))}
            className="w-full accent-slate-300 h-1.5 bg-inner rounded-lg cursor-pointer disabled:opacity-40"
          />
          <div className="text-[10px] text-text-muted font-sans">
            band: {Math.round(overrideBand * 100)}% height
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-divider">
            <button
              onClick={runDetection}
              disabled={scanning || !sourceUrl}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-inner hover:bg-card border border-subtle text-text-base text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {scanning ? <Loader2 size={13} className="animate-spin" /> : <ScanLine size={13} />}
              Detect Footprint
            </button>

            {is4PcMode && (
              <button
                onClick={copyPhotoshopInstructions}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-inner hover:bg-card border border-subtle text-sky-400 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                title="Copy Photoshop action guide & dimensions for PC 4"
              >
                {copiedAction ? <CheckCircle size={13} className="text-emerald-400" /> : <Copy size={13} />}
                {copiedAction ? 'Copied Guide' : 'Copy PS Action Guide'}
              </button>
            )}

            {!isGuestUser && (
              <button
                onClick={queueMaskJob}
                disabled={queuing || !selected}
                className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold rounded-lg transition-all cursor-pointer disabled:opacity-50 shadow-sm"
              >
                {queuing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {is4PcMode ? 'Queue PC 4 Handoff Record' : 'Queue MASK Batch'}
              </button>
            )}
          </div>

          <p className="text-[10px] text-text-muted flex items-start gap-1.5">
            <Ban size={11} className="shrink-0 mt-0.5 text-sky-400" />
            {is4PcMode
              ? 'In 4-Station mode, the Retouch Operator runs Photoshop batch actions on PC 4. Frames requiring manual touch-up can be inspected and verified here.'
              : 'Generative-fill runs on the automated NAS GPU Worker (LaMa CUDA). Frames the model cannot clean auto-flag to REVIEW_REQUIRED for manual retouch.'}
          </p>
        </div>

        {/* Preview column */}
        <div className="xl:border-l xl:border-divider xl:pl-5 xl:col-span-2 flex flex-col gap-3 min-h-0">
          <h3 className="text-xs font-bold text-text-base">Footprint Analysis Preview</h3>
          <div className="relative rounded-lg overflow-hidden border border-subtle bg-inner min-h-[300px] flex-1">
            {analyzedUrl ? (
              <img key={analyzedUrl} src={analyzedUrl} alt="analysis" className="w-full h-full object-contain" />
            ) : scanning ? (
              <div className="w-full h-full flex items-center justify-center text-[11px] text-sky-300">
                <Loader2 size={16} className="animate-spin mr-2" /> analyzing mask region…
              </div>
            ) : sourceUrl ? (
              <div className="w-full h-full bg-inner">
                <img
                  key={sourceUrl}
                  src={sourceUrl}
                  alt="source"
                  className="w-full h-full object-contain opacity-90"
                />
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[11px] text-text-muted">
                Select a dataset to preview
              </div>
            )}
          </div>
          {analyzedUrl && footprint?.detected && (
            <div className="text-[10px] text-amber-300">
              Highlighted band = detected vehicle footprint ({Math.round(footprint.bottomBandHeight * 100)}% of frame height). {is4PcMode ? 'Set this nadir mask height in your Adobe Photoshop batch action.' : 'The worker re-derives this deterministically per frame.'}
            </div>
          )}
        </div>
      </div>
    </Surface>
  );
};