import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Download, Play, RotateCcw, Loader2 } from 'lucide-react';
import type { ProductionApiClient } from '../../services/productionApi';
import { saveProcessingJobToSupabase } from '../../services/supabase';
import type {
  DatasetRecord,
  EnhancementParams,
  ProcessingJobRecord
} from '../../types/production';
import { DEFAULT_ENHANCEMENT_PARAMS } from '../../types/production';
import {
  canvasToJpegBlob,
  downloadBlob,
  enhancementToCssFilter,
  loadImageWithRetry,
  renderEnhancedCanvas
} from '../../utils/imageEnhancement';
import { productionNasUrlFor } from './common';

export interface EnhancementPanelProps {
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

const SLIDERS: Array<{ key: keyof EnhancementParams; label: string; min: number; max: number }> = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'denoise', label: 'Denoise', min: 0, max: 100 }
];

export const EnhancementPanel: React.FC<EnhancementPanelProps> = ({
  datasets,
  api,
  projectSettings,
  isGuestUser,
  onRefreshJobs,
  onAddNotification,
  onAddAuditLog,
  userLabel
}) => {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [sampleName, setSampleName] = useState(''); // free-text frame filename
  const [params, setParams] = useState<EnhancementParams>({ ...DEFAULT_ENHANCEMENT_PARAMS });
  const [applying, setApplying] = useState(false);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const selected = datasets.find((d) => d.id === selectedDatasetId);
  const sourceUrl = productionNasUrlFor(
    projectSettings,
    selected?.source_folder || 'stitchblur',
    sampleName || `${selected?.subgrid || 'N93E70'}-00001.jpg`
  );

  // Reset processed result when inputs change.
  useEffect(() => {
    setProcessedUrl(null);
  }, [selectedDatasetId, sampleName, sourceUrl]);

  const set = (key: keyof EnhancementParams, value: number) =>
    setParams((p) => ({ ...p, [key]: value }));

  const applyPreview = useCallback(async () => {
    if (!sourceUrl) return;
    setApplying(true);
    try {
      const img = await loadImageWithRetry(sourceUrl);
      const canvas = renderEnhancedCanvas(img, params, 0.35);
      canvasRef.current = canvas;
      setProcessedUrl(canvas.toDataURL('image/jpeg', 0.9));
    } catch (err) {
      onAddNotification?.({ title: 'Enhancement Preview Failed', message: err instanceof Error ? err.message : String(err), category: 'ERROR', read: false });
    } finally {
      setApplying(false);
    }
  }, [sourceUrl, params, onAddNotification]);

  const exportOutput = async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      await applyPreview();
    }
    setExporting(true);
    try {
      const target = canvasRef.current;
      if (!target) return;
      const blob = await canvasToJpegBlob(target, 0.92);
      const fname = sampleName || `${selected?.subgrid || 'N93E70'}-00001-enhanced.jpg`;
      downloadBlob(blob, fname);
      onAddNotification?.({ title: 'Output Exported', message: `Downloaded "${fname}". Place it in the target NAS folder, then register via Datasets.`, category: 'SYSTEM', read: false });
    } finally {
      setExporting(false);
    }
  };

  const queueEnhanceJob = async () => {
    if (isGuestUser) return;
    if (!selected) {
      onAddNotification?.({ title: 'Dataset Required', message: 'Pick a source dataset to queue an ENHANCE batch.', category: 'ERROR', read: false });
      return;
    }
    setQueuing(true);
    const job: ProcessingJobRecord = {
      job_type: 'ENHANCE',
      name: `Enhance • ${selected.subgrid || selected.name}`,
      source_dataset_id: selected.id || null,
      source_folder: selected.source_folder,
      output_folder: selected.output_folder,
      subgrid: selected.subgrid,
      provider: 'NAS GPU Worker',
      software_version: projectSettings?.productionApiMode === 'http' ? 'enhance-worker' : 'mock',
      total_items: selected.file_count || 500,
      status: 'QUEUED',
      progress: 0,
      completed_items: 0,
      error_count: 0,
      operator: userLabel,
      settings: {
        apiMode: api.mode,
        enhance: { ...params },
        exportFormat: 'jpeg',
        jpegQuality: 92
      }
    };
    const saved = await saveProcessingJobToSupabase(job);
    if (saved?.id) {
      const res = await api.submitJob(saved);
      onAddNotification?.({ title: 'ENHANCE Job Queued', message: `${saved.name} — ${res.message}`, category: 'PENDING', read: false });
      onAddAuditLog?.('CREATE', `ENHANCE Job Queued: ${saved.name}`, `${userLabel} queued batch enhancement with ${JSON.stringify(params)}.`, 'info');
      onRefreshJobs();
    }
    setQueuing(false);
  };

  const sliderValue = (key: keyof EnhancementParams) => params[key];

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
          <Sparkles size={20} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-text-base tracking-wide">Image Enhancement — Parameter Designer</h2>
          <span className="text-[11px] text-text-muted">Design adjustments live, then queue as an ENHANCE batch to the NAS GPU Worker (deterministic, applied to every frame).</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-card border border-subtle rounded-xl p-4 flex flex-col gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Source Dataset</label>
            <select className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60"
              value={selectedDatasetId} onChange={(e) => setSelectedDatasetId(e.target.value)}>
              <option value="">— register a dataset first —</option>
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
          <div className="text-[10px] text-text-muted font-mono break-all bg-inner border border-subtle rounded-lg px-3 py-2">
            {sourceUrl || '—'}
          </div>

          <div className="flex flex-col gap-3">
            {SLIDERS.map((s) => (
              <div key={s.key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{s.label}</label>
                  <span className="text-[10px] font-mono text-sky-300">{sliderValue(s.key)}</span>
                </div>
                <input type="range" min={s.min} max={s.max} value={sliderValue(s.key)}
                  onChange={(e) => set(s.key, Number(e.target.value))}
                  className="w-full accent-sky-400" />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={applyPreview} disabled={applying || !sourceUrl}
              className="flex items-center gap-1.5 px-3 py-2 bg-sky-500/15 hover:bg-sky-500/25 active:bg-sky-500/35 border border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
              {applying ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Apply Preview
            </button>
            <button onClick={() => { setParams({ ...DEFAULT_ENHANCEMENT_PARAMS }); setProcessedUrl(null); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-amber-500/15 hover:border-amber-500/40 text-amber-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
              <RotateCcw size={13} /> Reset
            </button>
            {!isGuestUser && (
              <>
                <button onClick={exportOutput} disabled={exporting}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
                  {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  Download (place on NAS)
                </button>
                <button onClick={queueEnhanceJob} disabled={queuing}
                  className="flex items-center gap-1.5 px-3 py-2 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/40 text-violet-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
                  {queuing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  Queue ENHANCE batch
                </button>
              </>
            )}
          </div>
        </div>

        <div className="bg-card border border-subtle rounded-xl p-4 flex flex-col gap-3 xl:col-span-2">
          <h3 className="text-xs font-bold text-text-base">Before / After</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
            <div className="relative rounded-lg overflow-hidden border border-subtle bg-inner min-h-[240px]">
              <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded bg-black/60 text-[10px] font-bold text-slate-200">ORIGINAL (live CSS filter)</span>
              {sourceUrl ? (
                <img key={sourceUrl} src={sourceUrl} alt="source"
                  style={{ filter: enhancementToCssFilter(params) }}
                  className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] text-text-muted">No source selected</div>
              )}
            </div>
            <div className="relative rounded-lg overflow-hidden border border-subtle bg-inner min-h-[240px]">
              <span className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded bg-black/60 text-[10px] font-bold text-emerald-300">PROCESSED (canvas pipeline)</span>
              {processedUrl ? (
                <img src={processedUrl} alt="processed" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] text-text-muted">Click “Apply Preview”</div>
              )}
            </div>
          </div>
          <p className="text-[10px] text-text-muted">
            Browser canvas = single-frame preview. Batch execution is deterministic on the worker; outputs land in the target NAS folder. RAW/stage files are never modified.
          </p>
        </div>
      </div>
    </div>
  );
};