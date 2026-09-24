import React, { useMemo, useState } from 'react';
import { Database, Folder, Loader2, Trash2 } from 'lucide-react';
import type { DatasetRecord } from '../../../types/production';
import { extractCanonicalSubgrid } from '../../../utils/datasetLineage';
import { deleteDatasetFromSupabase } from '../../../services/supabase';
import { findRunningJobsForDataset } from '../../../services/supabase';
import { formatBytes } from './storageCommon';

export interface IndexPanelProps {
  datasets: DatasetRecord[];
  translate: (key: string) => string;
  onChanged?: () => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: string, title: string, details: string, status: string) => void;
  isGuestUser?: boolean;
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

export const IndexPanel: React.FC<IndexPanelProps> = ({
  datasets,
  onChanged,
  onAddNotification,
  onAddAuditLog,
  isGuestUser
}) => {
  const [filterType, setFilterType] = useState('ALL');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (d: DatasetRecord) => {
    const id = d.id || d.name;
    if (deletingId) return;
    setDeletingId(id);
    // Safety: never remove a dataset that still has a related job running.
    const running = await findRunningJobsForDataset(d);
    if (running.length > 0) {
      setDeletingId(null);
      setConfirmId(null);
      const name = `${running[0].job_type} · ${running[0].name}`;
      onAddNotification?.({
        title: 'Delete Blocked — Processing Running',
        message: `You have a running processing (${name}) related to this data run — stop the process and proceed to delete.`,
        category: 'ERROR',
        read: false
      });
      onAddAuditLog?.(
        'BLOCKED',
        `Dataset delete blocked: ${d.name}`,
        `${running.length} running job(s) related to this data run (${name}).`,
        'WARNING'
      );
      return;
    }
    const ok = await deleteDatasetFromSupabase(d.id || d.name);
    setDeletingId(null);
    setConfirmId(null);
    if (ok) {
      onAddNotification?.({
        title: 'Dataset removed',
        message: `${d.name} removed from the dataset index.`,
        category: 'SYSTEM'
      });
      onAddAuditLog?.(
        'DELETE',
        `Dataset ${d.name}`,
        `Removed registry entry (${d.source_folder || 'no path'})`,
        'COMPLETED'
      );
      onChanged?.();
    } else {
      onAddNotification?.({
        title: 'Remove failed',
        message: `Could not remove ${d.name} — you may lack permission.`,
        category: 'ERROR'
      });
      onChanged?.();
    }
  };

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
    <div className="space-y-4 animate-in fade-in font-sans">
      {/* Header with bottom divider line matching RBAC */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
        <div>
          <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
            <Database size={16} className="text-sky-400" />
            Dataset Index Directory
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Registered datasets, pipeline stages, file counts, and storage status.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-inner border border-subtle rounded-lg p-0.5">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                filterType === t ? 'bg-card text-text-base shadow-sm' : 'text-text-muted hover:text-text-base'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-subtle rounded-lg overflow-x-auto">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-muted">
            No dataset records found. Register datasets from the Production workspace or Folder Browser.
          </p>
        ) : (
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-app text-text-muted uppercase text-[10px] tracking-wider border-b border-subtle">
                <th className="px-3.5 py-2.5">Dataset Name</th>
                <th className="px-3.5 py-2.5">Type</th>
                <th className="px-3.5 py-2.5">Stage</th>
                <th className="px-3.5 py-2.5">Subgrid</th>
                <th className="px-3.5 py-2.5 text-right">Files</th>
                <th className="px-3.5 py-2.5 text-right">Total Size</th>
                <th className="px-3.5 py-2.5 text-right">Status</th>
                {!isGuestUser && <th className="px-3.5 py-2.5 text-right w-24">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle/80">
              {filtered.map((d) => (
                <tr key={d.id || d.name} className="hover:bg-inner transition-colors">
                  <td className="px-3.5 py-2.5">
                    <div className="flex items-center gap-1.5 text-text-base font-semibold">
                      <Folder size={12} className="text-zinc-500" />
                      <span>{d.name}</span>
                    </div>
                    {d.source_folder && (
                      <div className="text-[10px] text-text-muted font-mono">{d.source_folder}</div>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <span className="text-[10px] font-mono font-semibold text-text-muted">
                      {d.dataset_type}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-text-muted">{d.pipeline_stage || '—'}</td>
                  <td className="px-3.5 py-2.5 font-mono text-zinc-300">{extractCanonicalSubgrid(d.subgrid) || '—'}</td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-text-muted">{d.file_count?.toLocaleString?.() || d.file_count || '—'}</td>
                  <td className="px-3.5 py-2.5 text-right font-mono text-text-base font-semibold">{formatBytes(d.size_bytes)}</td>
                  <td className="px-3.5 py-2.5 text-right">
                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider ${STATUS_CLS[d.status || 'REGISTERED'] || STATUS_CLS.REGISTERED}`}>
                      {d.status || 'REGISTERED'}
                    </span>
                  </td>
                  {!isGuestUser && (
                    <td className="px-3.5 py-2.5 text-right">
                      {confirmId === (d.id || d.name) ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleDelete(d)}
                            disabled={deletingId === (d.id || d.name)}
                            className="px-2 py-1 rounded bg-rose-500 hover:bg-rose-400 text-rose-950 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1"
                          >
                            {deletingId === (d.id || d.name) ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Trash2 size={11} />
                            )}
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            className="px-2 py-1 rounded bg-inner hover:bg-card border border-subtle text-text-muted text-[10px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(d.id || d.name)}
                          title={`Remove ${d.name} from registry`}
                          className="p-1.5 rounded bg-inner hover:bg-rose-500/15 border border-subtle text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-3.5 py-2 border-t border-subtle text-[10px] text-text-muted bg-inner/40 flex items-center justify-between">
          <span>{filtered.length} datasets cataloged</span>
          <span>{totals.files.toLocaleString()} files · {formatBytes(totals.bytes)} total</span>
        </div>
      </div>
    </div>
  );
};