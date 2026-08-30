import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Radar, Route, Table2, Network } from 'lucide-react';
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
import { UnderlineTabStrip, type ChromeTab } from './production/chrome';
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

const TABS: ChromeTab<LineageTab>[] = [
  { key: 'graph', icon: <Network size={14} /> },
  { key: 'trace', icon: <Route size={14} /> },
  { key: 'survey', icon: <Radar size={14} /> },
  { key: 'registry', icon: <Table2 size={14} /> }
];

export const LineageWorkspace: React.FC<LineageWorkspaceProps> = ({
  isGuestUser: _isGuestUser,
  onBackToDashboard: _onBackToDashboard,
  translate = (k) => k
}) => {
  const [activeTab, setActiveTab] = useState<LineageTab>('graph');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [jobs, setJobs] = useState<ProcessingJobRecord[]>([]);
  const [stagingRows, setStagingRows] = useState<Array<{ subgrid?: string; status?: string; created_at?: string }>>([]);
  const [selectedSubgrid, setSelectedSubgrid] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
        <div className="px-1">
          <h2 className="text-base font-bold text-text-base tracking-wide">
            Data Lineage
          </h2>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            Layered trace from RAW capture through processing jobs, acceptance QA decisions and publication. Metadata only — image bytes never leave the NAS.
          </p>
        </div>

        {/* Telemetry Summary strip */}
        {summary.length > 0 && (
          <div className="bg-card border border-subtle rounded-xl px-4 py-2.5 shadow-sm text-xs flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-[11px] font-bold text-text-muted shrink-0 uppercase tracking-wider">
              Pipeline Lineage:
            </span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span>
                <span className="text-text-muted">{translate('lineageStatDatasets')}: </span>
                <strong className="font-semibold text-text-base">{summary.reduce((a, r) => a + r.datasetCount, 0)}</strong>
              </span>
              <span className="text-text-muted">&bull;</span>
              <span>
                <span className="text-text-muted">{translate('lineageStatJobs')}: </span>
                <strong className="font-semibold text-text-base">{summary.reduce((a, r) => a + r.jobCount, 0)}</strong>
              </span>
              <span className="text-text-muted">&bull;</span>
              <span>
                <span className="text-text-muted">{translate('lineageStatRawFrames')}: </span>
                <strong className="font-semibold text-text-base">{summary.reduce((a, r) => a + r.rawFrames, 0)}</strong>
              </span>
              <span className="text-text-muted">&bull;</span>
              <span>
                <span className="text-text-muted">{translate('lineageStatQaOk')}: </span>
                <strong className="font-semibold text-text-base">{summary.reduce((a, r) => a + r.qaApproved, 0)}</strong>
              </span>
              <span className="text-text-muted">&bull;</span>
              <span>
                <span className="text-text-muted">{translate('lineageStatQaRejected')}: </span>
                <strong className="font-semibold text-text-base">{summary.reduce((a, r) => a + r.qaRejected, 0)}</strong>
              </span>
              <span className="text-text-muted">&bull;</span>
              <span>
                <span className="text-text-muted">{translate('lineageStatDeliverables')}: </span>
                <strong className="font-semibold text-text-base">{summary.reduce((a, r) => a + r.deliverableCount, 0)}</strong>
              </span>
            </div>
          </div>
        )}

        {/* Main Panel Canvas */}
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col min-h-0">
          <div className="px-3 pt-2 border-b border-divider bg-card">
            <UnderlineTabStrip
              tabs={TABS}
              active={activeTab}
              onChange={setActiveTab}
              tabLabel={(key) => translate(LINEAGE_TAB_LABELS[key])}
            />
          </div>

          <div className="p-4 flex-1 flex flex-col min-h-0">
            {/* Active tab panel */}
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
    </div>
  );
};