import React, { useState } from 'react';
import {
  Database,
  Plus,
  Trash2,
  GitBranch,
  GitCommitHorizontal,
  CheckCircle2
} from 'lucide-react';
import {
  deleteDatasetFromSupabase,
  saveDatasetToSupabase
} from '../../services/supabase';
import type { DatasetRecord, DatasetType, PipelineStage } from '../../types/production';
import { createNextVersion } from '../../utils/datasetVersioning';
import {
  DATASET_TYPE_OPTIONS,
  PIPELINE_STAGE_OPTIONS,
  formatBytes,
  formatDateTime
} from './common';

export interface DatasetsPanelProps {
  datasets: DatasetRecord[];
  translate: (key: string) => string;
  isGuestUser?: boolean;
  onRefreshDatasets: () => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
}

const INPUT_CLASS =
  'w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 placeholder:text-text-muted';

const TYPE_COLORS: Record<DatasetType, string> = {
  RAW: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  PROCESSED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  DELIVERABLE: 'bg-violet-500/15 text-violet-300 border-violet-500/40'
};

const STAGE_COLORS: Record<PipelineStage, string> = {
  STITCH: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  BLUR: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  ENHANCE: 'bg-teal-500/15 text-teal-300 border-teal-500/40',
  MASK: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  QAQC: 'bg-violet-500/15 text-violet-300 border-violet-500/40'
};

export const DatasetsPanel: React.FC<DatasetsPanelProps> = ({
  datasets,
  isGuestUser,
  onRefreshDatasets,
  onAddNotification,
  onAddAuditLog,
  userLabel
}) => {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<DatasetRecord>({
    dataset_type: 'RAW',
    pipeline_stage: 'STITCH',
    name: '',
    subgrid: '',
    provider: 'Local PC',
    software_version: '',
    source_folder: '',
    output_folder: '',
    storage_provider: 'nas_local',
    file_count: 0,
    size_bytes: 0,
    status: 'REGISTERED',
    version: 1,
    parent_dataset_id: null,
    metadata: {},
    created_by: userLabel
  });

  const set = <K extends keyof DatasetRecord>(key: K, value: DatasetRecord[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (isGuestUser) return;
    if (!draft.name.trim()) {
      onAddNotification?.({ title: 'Dataset Name Required', message: 'Enter a dataset name before registering.', category: 'ERROR', read: false });
      return;
    }
    const saved = await saveDatasetToSupabase({
      ...draft,
      name: draft.name.trim(),
      subgrid: (draft.subgrid || '').toUpperCase().trim(),
      created_by: userLabel
    });
    if (saved) {
      onAddNotification?.({ title: 'Dataset Registered', message: `"${saved.name}" registered (metadata only, files stay on NAS).`, category: 'SYSTEM', read: false });
      onAddAuditLog?.('CREATE', `Dataset Registered: ${saved.name}`, `Type ${saved.dataset_type} / stage ${saved.pipeline_stage} for subgrid ${saved.subgrid || '-'}.`, 'success');
      setDraft({ ...draft, name: '', subgrid: '', source_folder: '', output_folder: '', file_count: 0, size_bytes: 0 });
      setShowForm(false);
      onRefreshDatasets();
    }
  };

  const remove = async (ds: DatasetRecord) => {
    if (isGuestUser || !ds.id) return;
    if (!window.confirm(`Delete dataset metadata "${ds.name}"? NAS files are untouched.`)) return;
    const ok = await deleteDatasetFromSupabase(ds.id);
    if (ok) {
      onAddAuditLog?.('DELETE', `Dataset Deleted: ${ds.name}`, `Metadata removed by ${userLabel} (NAS files untouched).`, 'warning');
      onRefreshDatasets();
    }
  };

  const createVersion = async (ds: DatasetRecord) => {
    if (isGuestUser || !ds.id) return;
    if (!window.confirm(`Create new version (v${(ds.version || 1) + 1}) of "${ds.name}"? The current version will be marked superseded.`)) return;
    const next = createNextVersion(ds);
    const superseed = await saveDatasetToSupabase({
      ...ds,
      ...next,
      name: ds.name,
      subgrid: (ds.subgrid || '').toUpperCase().trim(),
    });
    if (!superseed?.id) return;
    const prior = await saveDatasetToSupabase({ ...ds, superseded_by: superseed.id });
    if (prior) {
      onAddNotification?.({ title: 'New Dataset Version', message: `"${ds.name}" v${superseed.version} created (supersedes v${ds.version || 1}).`, category: 'SYSTEM', read: false });
      onAddAuditLog?.('CREATE', `Dataset New Version: ${ds.name} v${superseed.version}`, `Supersedes v${ds.version || 1} (${ds.id}); parent ${ds.id}.`, 'success');
      onRefreshDatasets();
    }
  };

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
            <Database size={20} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-base tracking-wide">Datasets</h2>
            <span className="text-[11px] text-text-muted">{datasets.length} registered · metadata only, NAS holds all image bytes</span>
          </div>
        </div>
        {!isGuestUser && (
          <button onClick={() => setShowForm((s) => !s)}
            className="flex items-center gap-1.5 px-3 py-2 bg-sky-500/15 hover:bg-sky-500/25 active:bg-sky-500/35 border border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
            {showForm ? <CheckCircle2 size={14} /> : <Plus size={14} />}
            {showForm ? 'Close Form' : 'Register Dataset'}
          </button>
        )}
      </div>

      {showForm && !isGuestUser && (
        <div className="bg-card border border-subtle rounded-xl p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 animate-in fade-in zoom-in-98 duration-150">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Dataset Name *</label>
            <input className={INPUT_CLASS} placeholder="Stitch+Blur N93E70" value={draft.name}
              onChange={(e) => set('name', e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Type</label>
            <select className={INPUT_CLASS} value={draft.dataset_type}
              onChange={(e) => set('dataset_type', e.target.value as DatasetType)}>
              {DATASET_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Pipeline Stage</label>
            <select className={INPUT_CLASS} value={draft.pipeline_stage}
              onChange={(e) => set('pipeline_stage', e.target.value as PipelineStage)}>
              {PIPELINE_STAGE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Subgrid</label>
            <input className={INPUT_CLASS} placeholder="N93E70" value={draft.subgrid}
              onChange={(e) => set('subgrid', e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Provider / Software</label>
            <div className="flex gap-2">
              <input className={INPUT_CLASS} placeholder="Local PC" value={draft.provider}
                onChange={(e) => set('provider', e.target.value)} />
              <input className={`${INPUT_CLASS} w-24`} placeholder="v2.3" value={draft.software_version}
                onChange={(e) => set('software_version', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Source Folder (NAS)</label>
            <input className={INPUT_CLASS} placeholder="RAW/N93E70" value={draft.source_folder}
              onChange={(e) => set('source_folder', e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Output Folder (NAS)</label>
            <input className={INPUT_CLASS} placeholder="stitchblur/N93E70 (optional)" value={draft.output_folder}
              onChange={(e) => set('output_folder', e.target.value)} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Files / Size</label>
            <div className="flex gap-2">
              <input type="number" min={0} className={INPUT_CLASS} placeholder="count" value={draft.file_count || 0}
                onChange={(e) => set('file_count', Number(e.target.value) || 0)} />
              <input type="number" min={0} step={1024} className={INPUT_CLASS} placeholder="bytes" value={draft.size_bytes || 0}
                onChange={(e) => set('size_bytes', Number(e.target.value) || 0)} />
            </div>
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <button onClick={save}
              className="px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 active:bg-emerald-500/35 border border-emerald-500/40 text-emerald-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
              Register Dataset (metadata only)
            </button>
          </div>
        </div>
      )}

      <div className="bg-card border border-subtle rounded-xl overflow-hidden min-h-0">
        <div className="max-h-[620px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-subtle">
                <th className="px-3 py-2.5 font-semibold">DATASET</th>
                <th className="px-3 py-2.5 font-semibold">TYPE / STAGE</th>
                <th className="px-3 py-2.5 font-semibold">STATUS</th>
                <th className="px-3 py-2.5 font-semibold">FOLDERS</th>
                <th className="px-3 py-2.5 font-semibold">SIZE</th>
                <th className="px-3 py-2.5 font-semibold">PROVENANCE</th>
                <th className="px-3 py-2.5 font-semibold text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {datasets.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-text-muted">No datasets registered yet.</td></tr>
              )}
              {datasets.map((ds) => (
                <tr key={ds.id} className="border-b border-subtle/60 hover:bg-inner/50 transition-colors">
                  <td className="px-3 py-2.5 align-top">
                    <div className="font-semibold text-text-base">{ds.name}</div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {ds.subgrid || '—'} · {ds.provider} {ds.software_version ? `· v${ds.software_version}` : ''} · v{ds.version || 1}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${TYPE_COLORS[ds.dataset_type] || TYPE_COLORS.PROCESSED}`}>{ds.dataset_type}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STAGE_COLORS[ds.pipeline_stage] || STAGE_COLORS.QAQC}`}>{ds.pipeline_stage}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-inner border-subtle text-text-base">{ds.status}</span>
                  </td>
                  <td className="px-3 py-2.5 align-top text-[10px] text-text-muted font-mono">
                    {ds.source_folder || '—'}
                    <div className="text-[10px]">→ {ds.output_folder || ds.source_folder || '—'}</div>
                  </td>
                  <td className="px-3 py-2.5 align-top text-[10px] font-mono text-text-muted">
                    {(ds.file_count || 0).toLocaleString()} files
                    <div className="text-[10px]">{formatBytes(ds.size_bytes || 0)}</div>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {ds.parent_dataset_id ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-sky-300"><GitBranch size={11} /> v{ds.version || 1} · parent v{ds.version ? ds.version - 1 : '?'}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-text-muted"><GitBranch size={11} /> root</span>
                    )}
                    {ds.superseded_by ? (
                      <div className="text-[10px] text-amber-300 mt-0.5 inline-flex items-center gap-1"><GitCommitHorizontal size={10} /> superseded</div>
                    ) : (
                      <div className="text-[10px] text-emerald-300 mt-0.5">current</div>
                    )}
                    <div className="text-[10px] text-text-muted mt-0.5">{formatDateTime(ds.created_at)}</div>
                  </td>
                  <td className="px-3 py-2.5 align-top text-right">
                    {isGuestUser ? (
                      <span className="text-[10px] text-text-muted italic">read-only</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        <button title="Create a new version of this dataset (marks current as superseded)" onClick={() => createVersion(ds)}
                          className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-sky-500/20 hover:border-sky-500/40 text-sky-300 transition-colors cursor-pointer">
                          <GitCommitHorizontal size={13} />
                        </button>
                        <button title="Delete metadata (NAS files untouched)" onClick={() => remove(ds)}
                          className="p-1.5 rounded-md bg-inner border border-subtle hover:bg-red-500/20 hover:border-red-500/40 text-red-400 transition-colors cursor-pointer">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};