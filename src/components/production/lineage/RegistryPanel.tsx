import { useMemo, useState } from 'react';
import { Table2, Unlink } from 'lucide-react';
import type { LineageGraph, LineageNode } from '../../../utils/datasetLineage';
import { findOrphans } from '../../../utils/datasetLineage';
import { formatDateTime } from '../common';
import type { TranslateFn } from '../common';
import { qaBadge, statusTone } from './lineageCommon';

interface RegistryPanelProps {
  graph: LineageGraph;
  subgrids: string[];
  selectedSubgrid: string | null;
  onSelectSubgrid: (sg: string | null) => void;
  onSelectNode: (id: string | null) => void;
  onGoGraph: () => void;
  translate: TranslateFn;
}

type KindFilter = 'all' | 'parent' | 'job_source' | 'job_output' | 'raw_to_dataset';

interface RegistryRow {
  id: string;
  subgrid: string;
  source: string;
  target: string;
  sourceId: string;
  targetId: string;
  kind: KindFilter;
  status?: string;
  qa?: string | null;
  date?: string;
}

export function RegistryPanel({
  graph,
  selectedSubgrid,
  onSelectSubgrid,
  onSelectNode,
  onGoGraph,
  subgrids,
  translate
}: RegistryPanelProps) {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  const orphans = useMemo(() => findOrphans(graph), [graph]);

  const rows = useMemo<RegistryRow[]>(() => {
    const byId = new Map<string, LineageNode>();
    graph.nodes.forEach((n) => byId.set(n.id, n));

    const out: RegistryRow[] = [];
    graph.edges.forEach((e) => {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      if (!s || !t) return;
      const jobNode = s.kind === 'job' ? s : t.kind === 'job' ? t : undefined;
      out.push({
        id: e.id,
        subgrid: t.subgrid || s.subgrid || '',
        source: s.label,
        target: t.label,
        sourceId: s.id,
        targetId: t.id,
        kind: e.kind,
        status:
          t.kind === 'raw'
            ? 'CAPTURED'
            : t.kind === 'job'
              ? t.job?.status
              : t.dataset?.status || s.job?.status,
        qa: jobNode?.qaDecision ?? (s.qaDecision || t.qaDecision),
        date:
          t.dataset?.created_at ||
          t.job?.created_at ||
          t.raw?.captureStart ||
          s.dataset?.created_at ||
          s.job?.created_at
      });
    });
    return out;
  }, [graph]);

  const filtered = rows.filter(
    (r) => kindFilter === 'all' || r.kind === kindFilter
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Subgrid</span>
        <button
          onClick={() => onSelectSubgrid(null)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
            selectedSubgrid === null
              ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
              : 'bg-inner text-text-muted border-subtle hover:text-text-base'
          }`}
        >
          {translate('lineageGraphAllSubgrids')}
        </button>
        {subgrids.map((sg) => (
          <button
            key={sg}
            onClick={() => onSelectSubgrid(sg)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer ${
              selectedSubgrid === sg
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                : 'bg-inner text-text-muted border-subtle hover:text-text-base'
            }`}
          >
            {sg}
          </button>
        ))}
        <div className="flex-1" />
        <select
          value={kindFilter}
          onChange={(ev) => setKindFilter(ev.target.value as KindFilter)}
          className="bg-inner border border-subtle rounded-md px-2 py-1 text-[11px] text-text-base cursor-pointer"
        >
          <option value="all">{translate('lineageFilterAll')}</option>
          <option value="raw_to_dataset">{translate('lineageKind_raw_to_dataset')}</option>
          <option value="parent">{translate('lineageKind_parent')}</option>
          <option value="job_source">{translate('lineageKind_job_source')}</option>
          <option value="job_output">{translate('lineageKind_job_output')}</option>
        </select>
      </div>

      {orphans.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
          <Unlink size={13} />
          {translate('lineageOrphansTitle')}: {orphans.length} {translate('lineageOrphanDesc')}.
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="p-3 bg-inner rounded-2xl border border-subtle text-slate-500">
            <Table2 size={26} strokeWidth={1.5} />
          </div>
          <p className="text-xs text-text-muted max-w-md leading-relaxed">
            {translate('lineageRegistryEmpty')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-subtle rounded-xl">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-subtle text-[9px] uppercase tracking-wider text-text-muted">
                <th className="px-3 py-2">{translate('lineageRegistrySubgrid')}</th>
                <th className="px-3 py-2">{translate('lineageRegistrySource')}</th>
                <th className="px-3 py-2">{translate('lineageRegistryLinkKind')}</th>
                <th className="px-3 py-2">{translate('lineageRegistryTarget')}</th>
                <th className="px-3 py-2">{translate('lineageRegistryStatus')}</th>
                <th className="px-3 py-2">{translate('lineageRegistryQa')}</th>
                <th className="px-3 py-2">{translate('lineageRegistryDates')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => {
                    onSelectNode(r.targetId);
                    onGoGraph();
                  }}
                  className="border-b border-subtle hover:bg-inner/40 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2 font-bold text-sky-300">{r.subgrid || '—'}</td>
                  <td className="px-3 py-2 text-text-muted">{r.source}</td>
                  <td className="px-3 py-2">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-violet-500/40 text-violet-300">
                      {translate(`lineageKind_${r.kind}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold">{r.target}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${statusTone(r.status)}`}>
                      {r.status || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2">{qaBadge(r.qa, translate)}</td>
                  <td className="px-3 py-2 text-text-muted">{formatDateTime(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}