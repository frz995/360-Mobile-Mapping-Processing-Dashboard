import React, { useMemo, useState } from 'react';
import { Database, Folder } from 'lucide-react';
import type { DatasetRecord } from '../../../types/production';
import { formatBytes } from './storageCommon';

export interface IndexPanelProps {
  datasets: DatasetRecord[];
  translate: (key: string) => string;
}

const STATUS_CLS: Record<string, string> = {
  REGISTERED: 'text-sky-300 border-sky-500/40 bg-sky-950/40',
  READY: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40',
  IN_PROGRESS: 'text-amber-300 border-amber-500/40 bg-amber-950/40',
  COMPLETED: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40',
  FAILED: 'text-rose-300 border-rose-500/40 bg-rose-950/40',
  IMPORTED: 'text-sky-300 border-sky-500/40 bg-sky-950/40',
  ARCHIVED: 'text-text-muted border-subtle bg-inner'
};

export const IndexPanel: React.FC<IndexPanelProps> = ({ datasets }) => {
  const [filterType, setFilterType] = useState('ALL');

  const types = ['ALL', 'RAW', 'PROCESSED', 'DELIVERABLE'];
  const filtered = useMemo(() => {
    if (filterType === 'ALL') return datasets;
    return datasets.filter((d) => d.dataset_type === filterType);
  }, [datasets, filterType]);

  const totals = useMemo(() => {
    let files = 0;
    let bytes = 0;
    filtered.forEach((d) => {
      files += d.file_count || 0;
      bytes += d.size_bytes || 0;
    });
    return { files, bytes };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
          <Database size={15} className="text-sky-400" /> Dataset index
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 bg-inner border border-subtle rounded-lg p-0.5">
          {types.map((t) => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                filterType === t ? 'bg-sky-500/20 text-sky-300' : 'text-text-muted hover:text-text-base'
              }`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-inner border border-subtle rounded-xl overflow-x-auto">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-text-muted">
            No dataset records yet. Register datasets from the Production workspace or the Folder Browser.
          </p>
        ) : (
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-text-muted uppercase tracking-wide text-[10px] border-b border-subtle">
                <th className="py-2 px-3">Name</th>
                <th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Stage</th>
                <th className="py-2 px-3">Subgrid</th>
                <th className="py-2 px-3 text-right">Files</th>
                <th className="py-2 px-3 text-right">Size</th>
                <th className="py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id || d.name} className="border-b border-subtle/50">
                  <td className="py-2 px-3">
                    <span className="flex items-center gap-1.5 text-text-base font-semibold">
                      <Folder size={12} className="text-amber-300" /> {d.name}
                    </span>
                    {d.source_folder && (
                      <div className="text-[10px] text-text-muted font-sans">{d.source_folder}</div>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide text-sky-300 border-sky-500/40 bg-sky-950/40">
                      {d.dataset_type}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-text-muted">{d.pipeline_stage}</td>
                  <td className="py-2 px-3 font-sans text-text-muted">{d.subgrid || '—'}</td>
                  <td className="py-2 px-3 text-right text-text-muted">{d.file_count?.toLocaleString?.() || d.file_count || '—'}</td>
                  <td className="py-2 px-3 text-right text-text-muted">{formatBytes(d.size_bytes)}</td>
                  <td className="py-2 px-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${STATUS_CLS[d.status || 'REGISTERED'] || STATUS_CLS.REGISTERED}`}>
                      {d.status || 'REGISTERED'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-3 py-2 border-t border-subtle text-[10px] text-text-muted">
          {filtered.length} datasets · {totals.files.toLocaleString()} files · {formatBytes(totals.bytes)}
        </div>
      </div>
    </div>
  );
};