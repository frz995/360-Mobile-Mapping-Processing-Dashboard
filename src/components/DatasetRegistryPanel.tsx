// =====================================================================
// DatasetRegistryPanel — the survey registry for Data Management.
// Every row is real capture data that entered the system through one of
// two ingress points: a CSV survey import staged from Data Management, or
// records promoted to the WebGIS by the release gate in the production
// hub. Rows are grouped parent subgrid → child survey records, the same
// parent→child shape the Multi PC daily processing registry shows, and
// counts are capture points rather than files.
// =====================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Loader2,
  Search,
  MapPin,
  X,
  Globe,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { ContentLoading } from './common/ContentLoading';
import {
  fetchSupabaseData,
  fetchSubgridIndexFromSupabase,
  fetchDatasetsFromSupabase,
  fetchProcessingJobsFromSupabase
} from '../services/supabase';
import type { DatasetRecord, ProcessingJobRecord } from '../types/production';
import {
  buildSurveyRegistry,
  filterRegistryNodes,
  type RegistryChildSource,
  type RegistryState,
  type SubgridIndexEntry,
  type SurveyRecordInput
} from '../utils/datasetRegistry';
import { formatDateTime } from './production/common';
import type { TranslateFn } from './production/common';
import { resolveSubgridLifecycle } from '../utils/dataLifecycle';
import { WebGISHandoffCard } from './production/WebGISHandoffCard';
import { pushWorkspace } from '../utils/urlRouter';

type SourceFilter = 'all' | RegistryChildSource;
type StateFilter = 'all' | RegistryState;

const SOURCE_FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'lineageFilterAll' },
  { id: 'import', label: 'dataRegistrySourceImport' },
  { id: 'webgis', label: 'dataRegistrySourceWebgis' }
];

const STATE_FILTERS: Array<{ id: StateFilter; label: string }> = [
  { id: 'all', label: 'lineageFilterAll' },
  { id: 'published', label: 'dataRegistryStateReleased' },
  { id: 'staging', label: 'dataRegistryStateStaging' },
  { id: 'defect', label: 'dataRegistryStateDefect' }
];

const STATE_CLASS: Record<RegistryState, string> = {
  published: 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40',
  staging: 'text-amber-300 border-amber-500/40 bg-amber-950/40',
  defect: 'text-rose-300 border-rose-500/40 bg-rose-950/40',
  mixed: 'text-text-base border-subtle bg-inner'
};

interface DatasetRegistryPanelProps {
  translate: TranslateFn;
  onOpenInMap: (subgrid: string) => void;
  isGuestUser?: boolean;
  userLabel?: string;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (
    type: any,
    title: string,
    details: string,
    status?: 'error' | 'info' | 'success' | 'warning'
  ) => void;
}

export const DatasetRegistryPanel: React.FC<DatasetRegistryPanelProps> = ({
  translate,
  onOpenInMap
}) => {
  const [records, setRecords] = useState<SurveyRecordInput[]>([]);
  const [subgridIndex, setSubgridIndex] = useState<Record<string, SubgridIndexEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Handoff assistant state — the lifecycle card is resolved on demand, so
  // the catalog and job tables are only read when an operator asks for it.
  const [handoffSubgrid, setHandoffSubgrid] = useState<string | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffDatasets, setHandoffDatasets] = useState<DatasetRecord[]>([]);
  const [handoffJobs, setHandoffJobs] = useState<ProcessingJobRecord[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [captures, index] = await Promise.all([
        fetchSupabaseData(),
        fetchSubgridIndexFromSupabase()
      ]);
      if (captures.error) {
        setError(captures.error);
        setRecords([]);
      } else {
        setRecords((captures.dailyData || []) as SurveyRecordInput[]);
      }
      setSubgridIndex(index || {});
    } catch (err: any) {
      setError(err?.message || 'Failed to load the survey registry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const registry = useMemo(
    () => buildSurveyRegistry({ records, subgridIndex }),
    [records, subgridIndex]
  );

  const nodes = useMemo(
    () => filterRegistryNodes(registry.nodes, { search, source: sourceFilter, state: stateFilter }),
    [registry.nodes, search, sourceFilter, stateFilter]
  );

  const allExpanded = nodes.length > 0 && nodes.every((n) => !collapsed.has(n.key));

  const toggleNode = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openHandoff = async (subgrid: string) => {
    setHandoffSubgrid(subgrid);
    setHandoffLoading(true);
    try {
      const [ds, js] = await Promise.all([
        fetchDatasetsFromSupabase(),
        fetchProcessingJobsFromSupabase()
      ]);
      setHandoffDatasets(ds || []);
      setHandoffJobs(js || []);
    } catch {
      setHandoffDatasets([]);
      setHandoffJobs([]);
    } finally {
      setHandoffLoading(false);
    }
  };

  const closeHandoff = () => {
    setHandoffSubgrid(null);
    setHandoffDatasets([]);
    setHandoffJobs([]);
  };

  return (
    <div className="flex flex-col gap-3 relative">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 bg-inner hover:bg-inner border border-subtle text-text-base px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-sky-400' : 'text-sky-400'} />
          <span>{translate('dataRegistryRefresh')}</span>
        </button>

        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted ml-1">
          {translate('dataRegistryColSource')}
        </span>
        {SOURCE_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setSourceFilter(f.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
              sourceFilter === f.id
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'bg-inner text-text-muted border-subtle hover:text-text-base'
            }`}
          >
            {translate(f.label)}
          </button>
        ))}

        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted ml-2">
          {translate('dataRegistryColState')}
        </span>
        {STATE_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStateFilter(f.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
              stateFilter === f.id
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'bg-inner text-text-muted border-subtle hover:text-text-base'
            }`}
          >
            {translate(f.label)}
          </button>
        ))}
      </div>

      {/* Summary Telemetry Strip */}
      <div className="bg-card border border-subtle rounded-xl px-4 py-2.5 shadow-sm text-xs flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[11px] font-bold text-text-muted shrink-0 uppercase tracking-wider">
          {translate('dataRegistryTelemetry')}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>
            <span className="text-text-muted">{translate('dataRegistrySubgrid')}: </span>
            <strong className="font-semibold text-text-base">{registry.totals.subgrids}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted">{translate('dataRegistrySurveyRecord')}: </span>
            <strong className="font-semibold text-text-base">{registry.totals.surveyRecords}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted">{translate('dataRegistryPointCapture')}: </span>
            <strong className="font-semibold text-text-base">
              {registry.totals.pointCapture.toLocaleString()}
            </strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted">{translate('dataRegistrySourceImport')}: </span>
            <strong className="font-semibold text-text-base">{registry.totals.imported}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted">{translate('dataRegistrySourceWebgis')}: </span>
            <strong className="font-semibold text-text-base">{registry.totals.released}</strong>
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={translate('dataRegistrySearch')}
            className="w-full bg-inner border border-subtle rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-text-base placeholder-text-muted focus:outline-none focus:border-sky-500/60 transition-all"
          />
        </div>
        <button
          onClick={() => setCollapsed(allExpanded ? new Set(nodes.map((n) => n.key)) : new Set())}
          className="px-2.5 py-1.5 rounded-md text-[11px] font-semibold bg-inner text-text-muted border border-subtle hover:text-text-base transition-colors cursor-pointer"
        >
          {allExpanded ? translate('dataRegistryCollapseAll') : translate('dataRegistryExpandAll')}
        </button>
        <span className="text-[11px] text-text-muted font-sans ml-auto">
          {registry.totals.surveyRecords} {translate('dataRegistrySurveyRecord').toLowerCase()}
        </span>
      </div>

      {/* Parent / child survey registry */}
      {loading ? (
        <ContentLoading variant="table" label={translate('dataRegistryLoading')} rows={6} />
      ) : error ? (
        <div className="p-4 rounded-xl border border-rose-800/60 bg-rose-950/30 text-xs text-rose-300">
          {error} —{' '}
          <button onClick={load} className="underline cursor-pointer">
            {translate('dataRegistryRefresh')}
          </button>
        </div>
      ) : (
        <div className="bg-card border border-subtle rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
            <table className="w-full text-left text-[11px] min-w-[760px]">
              <thead className="bg-inner text-text-muted border-b border-subtle sticky top-0">
                <tr>
                  <th className="px-3 py-2.5">{translate('dataRegistryColEntry')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColSource')}</th>
                  <th className="px-3 py-2.5 text-center">{translate('dataRegistryGrid')}</th>
                  <th className="px-3 py-2.5 text-right">{translate('dataRegistrySurveyRecord')}</th>
                  <th className="px-3 py-2.5 text-right">{translate('dataRegistryPointCapture')}</th>
                  <th className="px-3 py-2.5">{translate('dataRegistryColState')}</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">{translate('dataRegistryColWhen')}</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => {
                  const open = !collapsed.has(node.key);
                  const sourceLabel = node.sources.length > 1
                    ? translate('dataRegistrySourceBoth')
                    : node.sources[0] === 'webgis'
                      ? translate('dataRegistrySourceWebgis')
                      : translate('dataRegistrySourceImport');
                  return (
                    <React.Fragment key={node.key}>
                      <tr className="border-t border-subtle hover:bg-inner/50 transition-colors">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => toggleNode(node.key)}
                            className="flex items-center gap-2 text-left cursor-pointer"
                            title={`${open ? 'Hide' : 'Show'} ${node.surveyRecords} survey record(s)`}
                          >
                            {open ? (
                              <ChevronDown size={13} className="text-text-muted shrink-0" />
                            ) : (
                              <ChevronRight size={13} className="text-text-muted shrink-0" />
                            )}
                            <span
                              className={`font-mono font-bold ${node.unassigned ? 'text-text-muted' : 'text-text-base'}`}
                            >
                              {node.subgrid}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-2 text-text-muted">{sourceLabel}</td>
                        <td className="px-3 py-2 text-center font-mono text-text-base">
                          {node.grids.length > 0 ? node.grids.join(', ') : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-text-base">
                          {node.surveyRecords}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-text-base">
                          {node.pointCapture.toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border ${STATE_CLASS[node.state]}`}
                          >
                            {translate(`dataRegistryState${node.state[0].toUpperCase()}${node.state.slice(1)}`)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-text-muted whitespace-nowrap">
                          {node.recordDate || '—'}
                        </td>
                        <td className="px-3 py-2 flex items-center gap-1.5 justify-end">
                          {!node.unassigned && (
                            <>
                              <button
                                onClick={() => onOpenInMap(node.subgrid)}
                                title={translate('dataRegistryOpenInMap')}
                                className="p-1.5 rounded-md text-sky-300 border border-sky-500/30 hover:bg-sky-500/10 transition-colors cursor-pointer"
                              >
                                <MapPin size={13} />
                              </button>
                              <button
                                onClick={() => openHandoff(node.subgrid)}
                                title="Open WebGIS Handoff Guide"
                                className="px-2 py-1 rounded-md text-[10px] font-bold text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                              >
                                <Globe size={11} />
                                <span>Handoff</span>
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {open &&
                        node.children.map((child) => (
                          <tr
                            key={child.key}
                            className="border-t border-subtle bg-inner/40 hover:bg-inner transition-colors"
                          >
                            <td className="py-1.5 pl-10 pr-3 max-w-[280px]">
                              <span className="font-mono text-[11px] text-text-muted">└ </span>
                              <span className="font-mono text-[11px] text-text-base" title={child.name}>
                                {child.name}
                              </span>
                              {child.pic && (
                                <div className="text-[10px] font-sans text-text-muted truncate mt-0.5">
                                  {child.pic}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-3 text-text-muted">
                              {child.source === 'webgis'
                                ? translate('dataRegistrySourceWebgis')
                                : translate('dataRegistrySourceImport')}
                            </td>
                            <td
                              className="py-1.5 px-3 text-center font-mono text-text-base"
                              title={
                                child.gridAssigned
                                  ? translate('dataRegistryGridAssigned')
                                  : translate('dataRegistryGrid')
                              }
                            >
                              {child.grid || '—'}
                              {child.gridAssigned && (
                                <span className="ml-1 text-[8px] font-sans text-text-muted">*</span>
                              )}
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono text-text-muted">1</td>
                            <td className="py-1.5 px-3 text-right font-mono text-text-base">
                              {child.pointCapture.toLocaleString()}
                            </td>
                            <td className="py-1.5 px-3">
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border ${STATE_CLASS[child.state]}`}
                              >
                                {translate(
                                  `dataRegistryState${child.state[0].toUpperCase()}${child.state.slice(1)}`
                                )}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-text-muted whitespace-nowrap">
                              {child.recordDate || formatDateTime(child.key)}
                            </td>
                            <td className="py-1.5 px-3 flex items-center gap-1.5 justify-end">
                              {child.subgrid && (
                                <button
                                  onClick={() => onOpenInMap(child.subgrid)}
                                  title={translate('dataRegistryOpenInMap')}
                                  className="p-1.5 rounded-md text-sky-300 border border-sky-500/30 hover:bg-sky-500/10 transition-colors cursor-pointer shrink-0"
                                >
                                  <MapPin size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
                {nodes.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-text-muted">
                      {translate('dataRegistryEmpty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WebGIS Handoff Assistant Modal */}
      {handoffSubgrid && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-subtle rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden animate-panel-enter">
            <div className="p-3 bg-inner border-b border-subtle flex items-center justify-between">
              <span className="text-xs font-bold text-text-base">
                WebGIS Handoff Assistant • {handoffSubgrid}
              </span>
              <button
                onClick={closeHandoff}
                className="text-text-muted hover:text-text-base cursor-pointer p-1"
              >
                <X size={15} />
              </button>
            </div>
            <div className="p-4">
              {handoffLoading ? (
                <div className="py-10 flex items-center justify-center gap-2 text-xs text-text-muted">
                  <Loader2 size={14} className="animate-spin" />
                  <span>{translate('dataRegistryLoading')}</span>
                </div>
              ) : (
                <WebGISHandoffCard
                  lifecycle={resolveSubgridLifecycle({
                    subgrid: handoffSubgrid,
                    datasets: handoffDatasets,
                    jobs: handoffJobs
                  })}
                  onNavigateToDataManagement={(sg) => {
                    closeHandoff();
                    pushWorkspace('data', { subgrid: sg });
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
