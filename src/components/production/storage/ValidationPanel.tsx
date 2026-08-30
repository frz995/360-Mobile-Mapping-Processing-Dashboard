import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Loader2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import type { DatasetRecord, ProcessedOutputValidationResult } from '../../../types/production';
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
      if (d.subgrid) set.add(d.subgrid);
    });
    return Array.from(set).sort();
  }, [datasets]);

  const [subgrid, setSubgrid] = useState('');
  const [folder, setFolder] = useState('cleaned');
  const [expectedCount, setExpectedCount] = useState<number>(500);
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
    const expected = generateExpectedFilenames(subgrid, expectedCount > 0 ? expectedCount : found.length);
    const r = validateProcessedOutput({ expected, found });
    r.totalSizeBytes = res.sizeBytes || 0;
    setResult(r);
  };

  useEffect(() => {
    setSubgrid((s) => s || subgrids[0] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subgrids]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
          <ShieldCheck size={15} className="text-sky-400" /> Output validation spot-check
        </div>
        <div className="flex-1" />
        <button onClick={run}
          className="flex items-center gap-1.5 px-3 py-2 bg-sky-500/15 border border-sky-500/30 hover:bg-sky-500/25 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Validate folder
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">Subgrid (recorded)</span>
          <select value={subgrid} onChange={(e) => setSubgrid(e.target.value)} className={INPUT_CLASS}>
            <option value="">— select —</option>
            {subgrids.map((sg) => (
              <option key={sg} value={sg}>{sg}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">Folder stage</span>
          <select value={folder} onChange={(e) => setFolder(e.target.value)} className={INPUT_CLASS}>
            <option value="cleaned">cleaned</option>
            <option value="stitchblur">stitchblur</option>
            <option value="deliverables">deliverables</option>
            <option value="RAW">RAW</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">Expected frames</span>
          <input type="number" min={1} value={expectedCount}
            onChange={(e) => setExpectedCount(parseInt(e.target.value || '0', 10) || 0)}
            className={INPUT_CLASS} />
        </label>
      </div>

      {error && <p className="text-[11px] text-amber-300">{error}</p>}

      {result && (
        <div className="bg-inner border border-subtle rounded-xl p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`flex items-center gap-1.5 text-sm font-bold ${result.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {result.ok ? 'Folder validated — matches expected frames' : 'Validation issues found'}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            {[
              { label: 'Expected', value: result.expectedCount.toLocaleString() },
              { label: 'Found', value: result.foundCount.toLocaleString() },
              { label: 'Valid', value: result.validCount.toLocaleString() },
              { label: 'Total size', value: formatBytes(result.totalSizeBytes) }
            ].map((k) => (
              <div key={k.label} className="bg-card border border-subtle rounded-lg p-3">
                <div className="text-xs text-text-muted uppercase tracking-wide">{k.label}</div>
                <div className="text-base font-bold text-text-base mt-0.5">{k.value}</div>
              </div>
            ))}
          </div>
          {result.issues.length > 0 && (
            <ul className="mt-3 text-[11px] text-amber-300 list-disc pl-4">
              {result.issues.map((i) => <li key={i}>{i}</li>)}
            </ul>
          )}
          {(result.missing.length > 0 || result.invalid.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {result.missing.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Missing ({result.missing.length})</div>
                  <div className="max-h-32 overflow-y-auto bg-card border border-subtle rounded-lg p-2 font-sans text-[10px] text-rose-300">
                    {result.missing.map((m) => <div key={m}>{m}</div>)}
                  </div>
                </div>
              )}
              {result.invalid.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Unexpected ({result.invalid.length})</div>
                  <div className="max-h-32 overflow-y-auto bg-card border border-subtle rounded-lg p-2 font-sans text-[10px] text-amber-300">
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