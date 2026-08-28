// =====================================================================
// DatasetRegistryPanel — read-only registry of RAW / PROCESSED /
// DELIVERABLE datasets with their versioning, file stats, QA decisions,
// processing history and source↔output relationships. Reuses the
// lineage graph so parent_dataset_id chains and orphans are surfaced.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database,
  RefreshCw,
  Loader2,
  Search,
  MapPin,
  Boxes,
  ShieldCheck,
  FileArchive,
  Layers3,
  AlertTriangle
} from 'lucide-react';
import { fetchDatasetsFromSupabase, fetchProcessingJobsFromSupabase } from '../services/supabase';
import type { DatasetRecord, ProcessingJobRecord } from '../types/production';
import { buildLineageGraph, findOrphans } from '../utils/datasetLineage';
import { computeDatasetVersionState } from '../utils/datasetVersioning';
import { formatBytes, formatDateTime } from './production/common';
import type { TranslateFn } from './production/common';
import { qaBadge, statusTone } from './production/lineage/lineageCommon';

type TypeFilter = 'all' | 'RAW' | 'PROCESSED' | 'DELIVERABLE';

interface DatasetRegistryPanelProps {
  translate: TranslateFn;
  onOpenInMap: (subgrid: string) => void;
}

interface RegistryRow {
  dataset: DatasetRecord;
  sourceName?: string;
  qaDecision: string | null;
  processCount: number;
  latestVersion: boolean;
  superseded: boolean;
  versionChain: DatasetRecord[];
}

export const DatasetRegistryPanel: React.FC<DatasetRegistryPanelProps> = ({
  translate,
  onOpenInMap
}) => {
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [subgridFilter, setSubgridFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ds, js] = await Promise.all([
        fetchDatasetsFromSupabase(),
        fetchProcessingJobsFromSupabase()
      ]);
      setDatasets(ds || []);
      setJobs(js || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load dataset registry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const graph = useMemo(
    () => buildLineageGraph(datasets, jobs, []),
    [datasets, jobs]
  );

  const orphans = useMemo(() => findOrphans(graph), [graph]);
  const orphanNames = useMemo(
    () => new Set(orphans.map((n) => n.id)),
    [orphans]
  );

  const subgrids = useMemo(() => {
    const set = new Set<string>();
    datasets.forEach((d) => d.subgrid && set.add(d.subgrid.trim().toUpperCase()));
    return Array.from(set).sort();
  }, [datasets]);

  const datasetById = useMemo(() => {
    const map = new Map<string, DatasetRecord>();
    datasets.forEach((d) => d.id && map.set(d.id, d));
    return map;
  }, [datasets]);

  const rows = useMemo<RegistryRow[]>(() => {
    const jobOutputQa = new Map<string, string | null>();
    jobs.forEach((j) => {
      if (j.output_dataset_id) {
        jobOutputQa.set(j.output_dataset_id, j.qa_decision ?? null);
      }
    });
    const jobTouchCount = new Map<string, number>();
    jobs.forEach((j) => {
      if (j.source_dataset_id) {
        jobTouchCount.set(j.source_dataset_id, (jobTouchCount.get(j.source_dataset_id) || 0) + 1);
      }
      if (j.output_dataset_id) {
        jobTouchCount.set(j.output_dataset_id, (jobTouchCount.get(j.output_dataset_id) || 0) + 1);
      }
    });

    const versionState = computeDatasetVersionState(datasets);

    return datasets
      .map((d) => ({
        dataset: d,
        sourceName: d.parent_dataset_id ? datasetById.get(d.parent_dataset_id)?.name : undefined,
        qaDecision: jobOutputQa.get(d.id || '') ?? null,
        processCount: jobTouchCount.get(d.id || '') || 0,
        latestVersion: versionState.latestByDataset.get(d.id || '') ?? !d.superseded_by,
        superseded: Boolean(d.superseded_by),
        versionChain: (d.id && versionState.chainByDataset.get(d.id)) || [d]
      }))
      .sort((a, b) => (b.dataset.created_at || '').localeCompare(a.dataset.created_at || ''));
  }, [datasets, jobs, datasetById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== 'all' && r.dataset.dataset_type !== typeFilter) return false;
      if (subgridFilter && (r.dataset.subgrid || '').toUpperCase() !== subgridFilter) return false;
      if (q) {
        const hay = [
          r.dataset.name,
          r.dataset.subgrid,
          r.dataset.provider,
          r.dataset.source_folder,
          r.dataset.output_folder,
          r.sourceName
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, typeFilter, subgridFilter]);

  const totals = useMemo(() => {
    let files = 0;
    let bytes = 0;
    let raw = 0;
    let processed = 0;
    let deliverable = 0;
    datasets.forEach((d) => {
      files += d.file_count || 0;
      bytes += d.size_bytes || 0;
      if (d.dataset_type === 'RAW') raw += 1;
      else if (d.dataset_type === 'PROCESSED') processed += 1;
      else if (d.dataset_type === 'DELIVERABLE') deliverable += 1;
    });
    return { files, bytes, raw, processed, deliverable };
  }, [datasets]);

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 bg-inner hover:bg-slate-700 border border-subtle text-text-base px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-sky-400' : 'text-sky-400'} />
          <span>{translate('dataRegistryRefresh')}</span>
        </button>

        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
          {translate('dataRegistrySubgrid')}
        </span>
        <button
          onClick={() => setSubgridFilter(null)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
            subgridFilter === null
              ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
              : 'bg-inner text-text-muted border-subtle hover:text-text-base'
          }`}
        >
          {translate('lineageGraphAllSubgrids')}
        </button>
        {subgrids.slice(0, 24).map((sg) => (
          <button
            key={sg}
            onClick={() => setSubgridFilter(subgridFilter === sg ? null : sg)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
              subgridFilter === sg
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'bg-inner text-text-muted border-subtle hover:text-text-base'
            }`}
          >
            {sg}
          </button>
        ))}
        {subgrids.length > 24 && (
          <span className="text-[10px] text-text-muted">+{subgrids.length - 24}…</span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {[
          { label: translate('dataRegistryTotalDatasets'), value: String(datasets.length), icon: <Database size={14} />, tone: 'text-text-base' },
          { label: translate('dataRegistryTotalFiles'), value: totals.files.toLocaleString(), icon: <FileArchive size={14} />, tone: 'text-sky-300' },
          { label: translate('dataRegistryTotalSize'), value: formatBytes(totals.bytes), icon: <Boxes size={14} />, tone: 'text-emerald-300' },
          { label: translate('dataRegistryRaw'), value: String(totals.raw), icon: <Layers3 size={14} />, tone: 'text-amber-300' },
          { label: translate('dataRegistryProcessed'), value: String(totals.processed), icon: <Layers3 size={14} />, tone: 'text-sky-300' },
          { label: translate('dataRegistryDeliverables'), value: String(totals.deliverable), icon: <ShieldCheck size={14} />, tone: 'text-emerald-300' }
        ].map((c) => (
          <div key={c.label} className="bg-inner border border-subtle rounded-xl p-3 flex items-center gap-2.5">
            <span className={`${c.tone} shrink-0`}>{c.icon}</span>
            <div className="min-w-0">
              <div className={`text-sm font-bold leading-none ${c.tone}`}>{c.value}</div>
              <div className="text-[9px] uppercase tracking-wider text-text-muted mt-1 truncate">{c.label}</div>
            </div>
          </div>
        ))}
      </div>

      {orphanNames.size > 0 && (
        <div className="p-3 bg-amber-950/30 border border-amber-700/40 rounded-xl flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
          <span>
            <strong className="font-semibold">{translate('dataRegistryOrphans')}:</strong> {orphanNames.size} —{' '}
            {Array.from(orphanNames).slice(0, 6).join(', ')}
            {orphanNames.size > 6 ? '…' : ''}
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={translate('dataRegistrySearch')}
            className="w-full bg-inner border border-subtle rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-text-base placeholder-slate-500 focus:outline-none focus:border-sky-500/60 transition-all"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="bg-inner border border-subtle rounded-md px-2 py-1.5 text-[11px] text-text-base cursor-pointer"
        >
          {(['all', 'RAW', 'PROCESSED', 'DELIVERABLE'] as const).map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? translate('lineageFilterAll') : t}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-text-muted font-mono ml-auto">{filtered.length} / {rows.length}</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-2 text-[11px] text-text-muted py-8 justify-center">
          <Loader2 size={14} className="animate-spin text-sky-400" /> {translate('dataRegistryLoading')}
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl border border-rose-800/60 bg-rose-950/30 text-xs text-rose-300">
          {error} — <button onClick={load} className="underline cursor-pointer">{translate('dataRegistryRefresh')}</button>
        </div>
      ) : (
        <div className="bg-card border border-subtle rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-inner text-text-muted border-b border-subtle sticky top-0">
                <tr>
                  <th className="px-3 py-2.5">{translate('dataRegistryColName')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColType')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColStage')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColVersion')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColSubgrid')}</th>
                  <th className="px-3 py-2.5 text-right">{translate('dataRegistryColFiles')}</th>
                  <th className="px-3 py-2.5 text-right">{translate('dataRegistryColSize')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColStatus')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColQa')}</th>
                  <th className="px-3 py-2.5 text-right">{translate('dataRegistryColJobs')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColSource')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColCreated')}</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ dataset: d, sourceName, qaDecision, processCount, latestVersion, superseded, versionChain }) => (
                  <tr
                    key={d.id || d.name}
                    className={`border-t border-subtle hover:bg-inner/50 transition-colors ${orphanNames.has(d.id || '') ? 'bg-amber-950/20' : ''}`}
                  >
                    <td className="px-3 py-2 font-mono text-sky-300 max-w-[220px] truncate" title={d.name}>
                      {d.name || '—'}
                      {orphanNames.has(d.id || '') && (
                        <span className="ml-1.5 text-[8px] font-bold uppercase text-amber-400">orphan</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border ${
                        d.dataset_type === 'RAW'
                          ? 'text-amber-300 border-amber-500/40 bg-amber-950/40'
                          : d.dataset_type === 'DELIVERABLE'
                            ? 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40'
                            : 'text-sky-300 border-sky-500/40 bg-sky-950/40'
                      }`}>
                        {d.dataset_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-muted">{d.pipeline_stage || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-mono font-bold ${latestVersion && !superseded ? 'text-emerald-300' : 'text-text-muted'}`}>
                          v{d.version ?? 1}
                        </span>
                        {latestVersion && !superseded ? (
                          <span className="text-[8px] font-bold text-emerald-400 uppercase">current</span>
                        ) : superseded ? (
                          <span className="text-[8px] font-bold text-amber-400 uppercase">superseded</span>
                        ) : null}
                      </div>
                      {versionChain.length > 1 && (
                        <div className="mt-0.5 text-[9px] text-text-muted font-mono">
                          {Array.from(new Set(versionChain.map((v) => `v${v.version ?? 1}`))).sort().join(' · ')} ({versionChain.length} versions)
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-text-base">{d.subgrid || '—'}</td>
                    <td className="px-3 py-2 text-right text-text-muted">{d.file_count?.toLocaleString() ?? '—'}</td>
                    <td className="px-3 py-2 text-right text-text-base">{formatBytes(d.size_bytes)}</td>
                    <td className="px-3 py-2">
                      {d.status ? (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border ${statusTone(d.status)}`}>
                          {d.status}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{qaBadge(qaDecision, translate)}</td>
                    <td className="px-3 py-2 text-right text-text-muted">{processCount}</td>
                    <td className="px-3 py-2 text-text-muted max-w-[160px] truncate" title={sourceName}>{sourceName || '—'}</td>
                    <td className="px-3 py-2 text-text-muted whitespace-nowrap">{formatDateTime(d.created_at)}</td>
                    <td className="px-3 py-2">
                      {d.subgrid && (
                        <button
                          onClick={() => onOpenInMap(d.subgrid!)}
                          title={translate('dataRegistryOpenInMap')}
                          className="p-1.5 rounded-md text-sky-300 border border-sky-500/30 hover:bg-sky-500/10 transition-colors cursor-pointer"
                        >
                          <MapPin size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-3 py-8 text-center text-text-muted">
                      {translate('dataRegistryEmpty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatasetRegistryPanel;