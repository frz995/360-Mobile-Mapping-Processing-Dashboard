import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, Radar, Route, Table2, RefreshCw, Undo2, Network } from 'lucide-react';
import { fetchDatasetsFromSupabase, fetchProcessingJobsFromSupabase, fetchStagingPanoramasFromSupabase } from '../services/supabase';
import type { DatasetRecord, ProcessingJobRecord } from '../types/production';
import type { LineageTab } from '../types/production';
import type { LineageGraph, StagingAggregate } from '../utils/datasetLineage';
import {
  aggregateStagingBySubgrid,
  buildLineageGraph,
  lineageSummary
} from '../utils/datasetLineage';
import { LINEAGE_TAB_LABELS } from './production/lineage/lineageCommon';
import { GraphPanel } from './production/lineage/GraphPanel';
import { TracePanel } from './production/lineage/TracePanel';
import { SurveyPanel } from './production/lineage/SurveyPanel';
import { RegistryPanel } from './production/lineage/RegistryPanel';

export interface LineageWorkspaceProps {
  projectSettings: any;
  setProjectSettings: React.Dispatch<React.SetStateAction<any>>;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  onBackToDashboard?: () => void;
  translate?: (key: string) => string;
}

const TABS: Array<{ key: LineageTab; icon: React.ComponentType<{ size?: number | string; className?: string }> }> = [
  { key: 'graph', icon: Network },
  { key: 'trace', icon: Route },
  { key: 'survey', icon: Radar },
  { key: 'registry', icon: Table2 }
];

export const LineageWorkspace: React.FC<LineageWorkspaceProps> = ({
  isGuestUser,
  onBackToDashboard,
  translate = (k) => k
}) => {
  const [activeTab, setActiveTab] = useState<LineageTab>('graph');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [stagingRows, setStagingRows] = useState<Array<{ subgrid?: string; status?: string; created_at?: string }>>([]);
  const [selectedSubgrid, setSelectedSubgrid] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshAll = useCallback(() => {
    return Promise.all([
      fetchDatasetsFromSupabase().then(setDatasets),
      fetchProcessingJobsFromSupabase().then(setJobs),
      fetchStagingPanoramasFromSupabase().then(setStagingRows)
    ]);
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const aggregates: StagingAggregate[] = useMemo(
    () => aggregateStagingBySubgrid(stagingRows),
    [stagingRows]
  );

  const subgrids = useMemo(() => {
    const set = new Set<string>();
    datasets.forEach((d) => {
      if (d.subgrid) set.add((d.subgrid || '').toUpperCase());
    });
    jobs.forEach((j) => {
      if (j.subgrid) set.add((j.subgrid || '').toUpperCase());
    });
    aggregates.forEach((a) => set.add(a.subgrid));
    return Array.from(set).sort();
  }, [datasets, jobs, aggregates]);

  const graph: LineageGraph = useMemo(
    () => buildLineageGraph(datasets, jobs, aggregates, { subgrid: selectedSubgrid }),
    [datasets, jobs, aggregates, selectedSubgrid]
  );

  const summary = useMemo(() => lineageSummary(datasets, jobs, aggregates), [datasets, jobs, aggregates]);

  const handleRefresh = () => {
    setRefreshing(true);
    refreshAll().finally(() => setRefreshing(false));
  };

  const handleSelectSubgrid = (sg: string | null) => {
    setSelectedSubgrid(sg);
    setSelectedNodeId(null);
  };

  const handleTraceSubgrid = (sg: string) => {
    setSelectedSubgrid(sg);
    setSelectedNodeId(`raw::${sg}`);
    setActiveTab('graph');
  };

  const goGraph = () => setActiveTab('graph');

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="bg-card border border-subtle rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
              <GitBranch size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-text-base tracking-wide">Data Lineage</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-sky-500/40 bg-sky-950/40 text-sky-300">
                  Survey → Publish
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                Layered trace from RAW capture through processing jobs, QA/QC decisions and publication. Metadata only — image bytes never leave the NAS.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-sky-500/20 hover:border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> {translate('refresh')}
            </button>
            {onBackToDashboard && (
              <button onClick={onBackToDashboard}
                className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-amber-500/20 hover:border-amber-500/40 text-amber-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
                <Undo2 size={13} /> Dashboard
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto bg-card border border-subtle rounded-xl p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    : 'text-text-muted hover:text-text-base border border-transparent'
                }`}>
                <Icon size={14} />
                {translate(LINEAGE_TAB_LABELS[tab.key])}
              </button>
            );
          })}
        </div>

        {isGuestUser && (
          <div className="text-[11px] px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
            {translate('lineageGuestNote')}
          </div>
        )}

        {/* Summary strip */}
        {summary.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="bg-card border border-subtle rounded-xl p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{translate('lineageStatDatasets')}</div>
              <div className="text-sm font-bold text-text-base">{summary.reduce((a, r) => a + r.datasetCount, 0)}</div>
            </div>
            <div className="bg-card border border-subtle rounded-xl p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{translate('lineageStatJobs')}</div>
              <div className="text-sm font-bold text-text-base">{summary.reduce((a, r) => a + r.jobCount, 0)}</div>
            </div>
            <div className="bg-card border border-subtle rounded-xl p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{translate('lineageStatRawFrames')}</div>
              <div className="text-sm font-bold text-text-base">{summary.reduce((a, r) => a + r.rawFrames, 0)}</div>
            </div>
            <div className="bg-card border border-subtle rounded-xl p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{translate('lineageStatQaOk')}</div>
              <div className="text-sm font-bold text-emerald-300">{summary.reduce((a, r) => a + r.qaApproved, 0)}</div>
            </div>
            <div className="bg-card border border-subtle rounded-xl p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{translate('lineageStatQaRejected')}</div>
              <div className="text-sm font-bold text-rose-300">{summary.reduce((a, r) => a + r.qaRejected, 0)}</div>
            </div>
            <div className="bg-card border border-subtle rounded-xl p-3">
              <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{translate('lineageStatDeliverables')}</div>
              <div className="text-sm font-bold text-text-base">{summary.reduce((a, r) => a + r.deliverableCount, 0)}</div>
            </div>
          </div>
        )}

        {/* Active tab panel */}
        <div className="bg-card border border-subtle rounded-xl p-4 min-h-0">
          {activeTab === 'graph' && (
            <GraphPanel
              graph={graph}
              subgrids={subgrids}
              selectedSubgrid={selectedSubgrid}
              onSelectSubgrid={handleSelectSubgrid}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              translate={translate}
            />
          )}
          {activeTab === 'trace' && (
            <TracePanel
              datasets={datasets}
              jobs={jobs}
              aggregates={aggregates}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onGoGraph={goGraph}
              translate={translate}
            />
          )}
          {activeTab === 'survey' && (
            <SurveyPanel
              aggregates={aggregates}
              datasets={datasets}
              onTraceSubgrid={handleTraceSubgrid}
              translate={translate}
            />
          )}
          {activeTab === 'registry' && (
            <RegistryPanel
              graph={graph}
              subgrids={subgrids}
              selectedSubgrid={selectedSubgrid}
              onSelectSubgrid={handleSelectSubgrid}
              onSelectNode={setSelectedNodeId}
              onGoGraph={goGraph}
              translate={translate}
            />
          )}
        </div>
      </div>
    </div>
  );
};