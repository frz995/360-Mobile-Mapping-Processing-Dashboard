import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Loader2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import type { DatasetRecord, ProcessedOutputValidationResult } from '../../../types/production';
import { extractCanonicalSubgrid } from '../../../utils/datasetLineage';
import { validateProcessedOutput, generateExpectedFilenames } from '../../../utils/processedOutputValidation';
import { formatBytes } from './storageCommon';

export interface ValidationPanelProps {
  api: ProductionApiClient;
  datasets: DatasetRecord[];
  translate: (key: string) => string;
}

const INPUT_CLASS =
  'w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 placeholder:text-text-muted';

export const ValidationPanel: React.FC<ValidationPanelProps> = ({ api, datasets }) => {
  const subgrids = useMemo(() => {
    const set = new Set<string>();
    datasets.forEach((d) => {
      const clean = extractCanonicalSubgrid(d.subgrid);
      if (clean) set.add(clean);
    });
    return Array.from(set).sort();
  }, [datasets]);

  const [subgrid, setSubgrid] = useState('');
  const [folder, setFolder] = useState('PROCESSED');
  const [expectedCount, setExpectedCount] = useState<number>(0);
  const [result, setResult] = useState<ProcessedOutputValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    if (!subgrid) {
      setError('Select a subgrid to validate.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    const path = `${folder}/${subgrid}`;
    const res = await api.listFolder(path);
    setLoading(false);
    if (!res) {
      setError(`Folder not found or worker unreachable: ${path}`);
      return;
    }
    const found = (res.entries || [])
      .filter((e) => !e.isDirectory)
      .map((e) => e.name);
    const count = expectedCount > 0 ? expectedCount : (found.length || 0);
    const expected = generateExpectedFilenames(subgrid, count);
    const r = validateProcessedOutput({ expected, found });
    r.totalSizeBytes = res.sizeBytes || 0;
    setResult(r);
  };

  useEffect(() => {
    setSubgrid((s) => s || subgrids[0] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subgrids]);

  return (
    <div className="space-y-4 animate-in fade-in font-sans">
      {/* Header with bottom divider line matching RBAC */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
        <div>
          <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
            <ShieldCheck size={16} className="text-sky-400" />
            Output Validation Spot-Check
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Validate subgrid directory completeness and frame sequences against storage.
          </p>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          <span>Validate Folder</span>
        </button>
      </div>

      {/* Filter and Selection Row (RBAC Search Row Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">Subgrid (Recorded)</span>
          <select value={subgrid} onChange={(e) => setSubgrid(e.target.value)} className={INPUT_CLASS}>
            <option value="">— Select Subgrid —</option>
            {subgrids.map((sg) => (
              <option key={sg} value={sg}>{sg}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">Folder Stage</span>
          <select value={folder} onChange={(e) => setFolder(e.target.value)} className={INPUT_CLASS}>
            <option value="PROCESSED">PROCESSED (PC 4 Photoshop)</option>
            <option value="ENHANCED">ENHANCED (PC 3 Lightroom)</option>
            <option value="STITCHED">STITCHED (PC 2 Stitch)</option>
            <option value="BLURRED">BLURRED (PC 1 Blur)</option>
            <option value="RAW">RAW</option>
            <option value="DELIVERABLES">DELIVERABLES</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">Expected Frames</span>
          <input
            type="number"
            min={0}
            value={expectedCount}
            onChange={(e) => setExpectedCount(parseInt(e.target.value || '0', 10) || 0)}
            className={INPUT_CLASS}
            placeholder="Auto-detect"
          />
        </label>
      </div>

      {error && <p className="text-xs text-amber-300">{error}</p>}

      {result && (
        <div className="border border-subtle rounded-lg overflow-hidden flex flex-col">
          <div className="px-3.5 py-2.5 bg-app border-b border-subtle flex items-center justify-between gap-3 flex-wrap">
            <div className={`flex items-center gap-1.5 text-xs font-bold ${result.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {result.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              <span>{result.ok ? 'Folder Validated — Matches Expected Sequence' : 'Validation Issues Found'}</span>
            </div>
            <div className="text-[11px] font-mono text-text-muted">
              Size: <span className="text-zinc-200">{formatBytes(result.totalSizeBytes)}</span>
            </div>
          </div>

          <div className="p-3.5 bg-inner/40 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-subtle">
            {[
              { label: 'Expected', value: result.expectedCount.toLocaleString() },
              { label: 'Found', value: result.foundCount.toLocaleString() },
              { label: 'Valid', value: result.validCount.toLocaleString() },
              { label: 'Total Size', value: formatBytes(result.totalSizeBytes) }
            ].map((k) => (
              <div key={k.label} className="bg-card border border-subtle rounded-lg p-2.5">
                <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">{k.label}</div>
                <div className="text-sm font-bold text-text-base mt-0.5 font-mono">{k.value}</div>
              </div>
            ))}
          </div>

          {result.issues.length > 0 && (
            <div className="p-3.5 bg-amber-500/5 border-b border-subtle">
              <ul className="text-xs text-amber-300 list-disc pl-4 space-y-1">
                {result.issues.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </div>
          )}

          {(result.missing.length > 0 || result.invalid.length > 0) && (
            <div className="p-3.5 bg-inner/30 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {result.missing.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1 font-semibold">Missing ({result.missing.length})</div>
                  <div className="max-h-32 overflow-y-auto bg-card border border-subtle rounded-lg p-2 font-mono text-[10px] text-rose-300">
                    {result.missing.map((m) => <div key={m}>{m}</div>)}
                  </div>
                </div>
              )}
              {result.invalid.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1 font-semibold">Unexpected ({result.invalid.length})</div>
                  <div className="max-h-32 overflow-y-auto bg-card border border-subtle rounded-lg p-2 font-mono text-[10px] text-amber-300">
                    {result.invalid.map((m) => <div key={m}>{m}</div>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};