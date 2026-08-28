import React, { useEffect, useRef, useState } from 'react';
import { Eraser, Play, Loader2, ScanLine, Ban } from 'lucide-react';
import type { ProductionApiClient } from '../../services/productionApi';
import { saveProcessingJobToSupabase } from '../../services/supabase';
import type {
  DatasetRecord,
  MaskFootprint,
  ProcessingJobRecord
} from '../../types/production';
import { loadImageWithRetry } from '../../utils/imageEnhancement';
import { detectMaskFootprint } from '../../utils/maskFootprintDetector';
import { productionNasUrlFor } from './common';

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const selected = datasets.find((d) => d.id === selectedDatasetId);
  const sourceUrl = productionNasUrlFor(
    projectSettings,
    selected?.source_folder || 'stitchblur',
    sampleName || `${selected?.subgrid || 'N93E70'}-00001.jpg`
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
        const bandH = Math.max(1, Math.round(c.height * (fp.detected ? fp.bottomBandHeight : useOverride ? overrideBand : 0.18)));
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
        ctx.fillText(`Detected mask band (${(fp.detected ? (fp.bottomBandHeight * 100).toFixed(1) : (useOverride ? overrideBand * 100 : 18.0).toFixed(1))}% of height)`, 12, y - 10);
      }
      canvasRef.current = c;
      setAnalyzedUrl(c.toDataURL('image/jpeg', 0.9));
      if (!fp.detected) {
        onAddNotification?.({ title: 'Mask Not Detected', message: 'No strong bottom mask footprint found. Manual override below may still be used.', category: 'PENDING', read: false });
      }
    } catch (err) {
      onAddNotification?.({ title: 'Detection Failed', message: err instanceof Error ? err.message : String(err), category: 'ERROR', read: false });
    } finally {
      setScanning(false);
    }
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
      output_folder: selected.output_folder,
      subgrid: selected.subgrid,
      provider: 'NAS GPU Worker',
      software_version: projectSettings?.productionApiMode === 'http' ? 'lama-cleaner' : 'mock',
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
      onAddNotification?.({ title: 'MASK Job Queued', message: `${saved.name} — ${res.message}`, category: 'PENDING', read: false });
      onAddAuditLog?.('CREATE', `MASK Job Queued: ${saved.name}`, `${userLabel} queued generative-fill car-roof removal for band ${effectiveBand.toFixed(2)}.`, 'info');
      onRefreshJobs();
    }
    setQueuing(false);
  };

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
          <Eraser size={20} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-text-base tracking-wide">Car-Roof / Black-Mask Removal</h2>
          <span className="text-[11px] text-text-muted">Detect the stitch-method mask footprint, then queue a generative-fill (LaMa) MASK batch to the NAS GPU Worker. Output lands in the target folder; source is never touched.</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-card border border-subtle rounded-xl p-4 flex flex-col gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Source Dataset</label>
            <select className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60"
              value={selectedDatasetId} onChange={(e) => setSelectedDatasetId(e.target.value)}>
              <option value="">— select a dataset —</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>{d.name} {d.subgrid ? `(${d.subgrid})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Sample Frame</label>
            <input className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 font-mono"
              placeholder="N93E70-00001.jpg" value={sampleName}
              onChange={(e) => setSampleName(e.target.value)} />
          </div>

          <div className="bg-inner border border-subtle rounded-lg p-3 flex flex-col gap-1.5 text-[11px]">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Detection Result</span>
            {footprint ? (
              <>
                <span className={confidenceColor(footprint.confidence)}>
                  {footprint.detected ? 'Footprint detected' : 'No clear footprint'} — confidence {Math.round(footprint.confidence * 100)}%
                </span>
                {footprint.detected && (
                  <span className="text-text-muted">Mask band ≈ {Math.round(footprint.bottomBandHeight * 100)}% of frame height · mask ratio {Math.round(footprint.maskRatio * 100)}%</span>
                )}
              </>
            ) : scanning ? (
              <span className="text-sky-300 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> analyzing…</span>
            ) : (
              <span className="text-text-muted">Run detection to locate the mask band.</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Manual override</label>
            <input type="checkbox" checked={useOverride} disabled={isGuestUser}
              onChange={(e) => setUseOverride(e.target.checked)} className="accent-orange-400" />
          </div>
          <input type="range" min={0.02} max={0.5} step={0.01} value={overrideBand} disabled={!useOverride || isGuestUser}
            onChange={(e) => setOverrideBand(Number(e.target.value))} className="w-full accent-orange-400" />
          <div className="text-[10px] text-text-muted font-mono">band: {Math.round(overrideBand * 100)}% height</div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={runDetection} disabled={scanning || !sourceUrl}
              className="flex items-center gap-1.5 px-3 py-2 bg-sky-500/15 hover:bg-sky-500/25 active:bg-sky-500/35 border border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
              {scanning ? <Loader2 size={13} className="animate-spin" /> : <ScanLine size={13} />}
              Detect Footprint
            </button>
            {!isGuestUser && (
              <button onClick={queueMaskJob} disabled={queuing || !selected}
                className="flex items-center gap-1.5 px-3 py-2 bg-orange-500/15 hover:bg-orange-500/25 active:bg-orange-500/35 border border-orange-500/40 text-orange-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
                {queuing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                Queue MASK (generative-fill)
              </button>
            )}
          </div>

          <p className="text-[10px] text-text-muted flex items-start gap-1.5">
            <Ban size={11} className="shrink-0 mt-0.5 text-red-400" />
            Generative-fill runs on the NAS GPU Worker (LaMa CUDA). Professional-quality clean fills per frame; frames the model can't clean auto-flag to REVIEW_REQUIRED for manual retouch.
          </p>
        </div>

        <div className="bg-card border border-subtle rounded-xl p-4 xl:col-span-2 flex flex-col gap-3">
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
                <img key={sourceUrl} src={sourceUrl} alt="source" className="w-full h-full object-contain opacity-90" />
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[11px] text-text-muted">Select a dataset to preview</div>
            )}
          </div>
          {analyzedUrl && footprint?.detected && (
            <div className="text-[10px] text-orange-300">
              Orange band = detected mask footprint ({Math.round(footprint.bottomBandHeight * 100)}% of frame height). The worker re-derives this deterministically per frame unless manual override is enabled.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};