import { useMemo } from 'react';
import { GitBranch, ZoomIn } from 'lucide-react';
import type { LineageGraph, LineageLayer, LineageNode } from '../../../utils/datasetLineage';
import { LINEAGE_LAYERS, findOrphans } from '../../../utils/datasetLineage';
import type { TranslateFn } from '../common';

interface GraphPanelProps {
  graph: LineageGraph;
  subgrids: string[];
  selectedSubgrid: string | null;
  onSelectSubgrid: (sg: string | null) => void;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  translate: TranslateFn;
}

const NODE_W = 190;
const NODE_H = 60;
const COL_W = 210;
const COL_GAP = 60;
const PAD = 20;
const ROW_GAP = 22;
const HEADER_H = 34;

const LAYER_LABEL_KEY: Record<LineageLayer, string> = {
  RAW: 'lineageGraphLayer_RAW',
  STITCH: 'lineageGraphLayer_Stitch',
  BLUR: 'lineageGraphLayer_Blur',
  ENHANCE: 'lineageGraphLayer_Enhance',
  MASK: 'lineageGraphLayer_Mask',
  QAQC: 'lineageGraphLayer_QaQc',
  DELIVERABLE: 'lineageGraphLayer_Deliverable'
};

const NODE_TONE: Record<LineageNode['kind'], string> = {
  raw: '#f59e0b',
  dataset: '#38bdf8',
  job: '#8b5cf6'
};

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

interface LayoutItem {
  node: LineageNode;
  x: number;
  y: number;
}

export function GraphPanel({
  graph,
  subgrids,
  selectedSubgrid,
  onSelectSubgrid,
  selectedNodeId,
  onSelectNode,
  translate
}: GraphPanelProps) {
  const { itemsByLayer, svgW, svgH } = useMemo(() => {
    const colIndex = new Map<LineageLayer, number>(
      LINEAGE_LAYERS.map((l, i) => [l, i])
    );
    const items: LayoutItem[] = [];
    let lastLayerIndex = -1;
    graph.nodes.forEach((n) => {
      const lv = colIndex.get(n.layer) ?? 0;
      if (lv > lastLayerIndex) lastLayerIndex = lv;
    });

    // stable stack order within each layer
    const byLayer = new Map<number, LineageNode[]>();
    graph.nodes.forEach((n) => {
      const lv = colIndex.get(n.layer) ?? 0;
      const arr = byLayer.get(lv) || [];
      arr.push(n);
      byLayer.set(lv, arr);
    });
    byLayer.forEach((arr) => {
      arr.sort((a, b) => {
        if (a.kind === 'raw') return -1;
        if (b.kind === 'raw') return 1;
        return (a.dataset?.created_at || a.job?.created_at || '').localeCompare(
          b.dataset?.created_at || b.job?.created_at || ''
        );
      });
    });

    let maxStack = 0;
    byLayer.forEach((arr, lv) => {
      maxStack = Math.max(maxStack, arr.length);
      arr.forEach((n, i) => {
        items.push({
          node: n,
          x: PAD + lv * (COL_W + COL_GAP),
          y: HEADER_H + PAD + i * (NODE_H + ROW_GAP)
        });
      });
    });

    const w = PAD * 2 + (lastLayerIndex + 1) * (COL_W + COL_GAP) + 40;
    const h = HEADER_H + PAD * 2 + maxStack * NODE_H + Math.max(0, maxStack - 1) * ROW_GAP + 24;
    return { itemsByLayer: items, svgW: w, svgH: h };
  }, [graph]);

  const orphans = useMemo(() => findOrphans(graph), [graph]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="p-3 bg-inner rounded-2xl border border-subtle text-slate-500">
          <GitBranch size={26} strokeWidth={1.5} />
        </div>
        <p className="text-xs text-text-muted max-w-md leading-relaxed">
          {translate('lineageGraphEmpty')}
        </p>
      </div>
    );
  }

  const edgePath = (sx: number, sy: number, tx: number, ty: number) => {
    const dx = 40;
    return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
  };

  const nodeById = new Map<string, { node: LineageNode; x: number; y: number }>();
  itemsByLayer.forEach((it) => nodeById.set(it.node.id, it));

  return (
    <div className="flex flex-col gap-3 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
          {translate('lineageGraphSubgrid')}
        </span>
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
        <button
          onClick={() => {
            const el = document.getElementById('lineage-graph-scroll');
            if (el) el.scrollLeft = 0;
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border border-subtle bg-inner text-text-muted hover:text-text-base transition-colors cursor-pointer"
        >
          <ZoomIn size={13} /> {translate('lineageGraphFit')}
        </button>
      </div>

      {orphans.length > 0 && (
        <div className="text-[11px] px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
          {translate('lineageOrphansTitle')}: {orphans.length} {translate('lineageOrphanDesc')}.
        </div>
      )}

      {/* SVG DAG */}
      <div
        id="lineage-graph-scroll"
        className="overflow-auto border border-subtle rounded-xl bg-inner/50"
        style={{ maxHeight: 480 }}
      >
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="block"
        >
          {/* Column guides + headers */}
          {LINEAGE_LAYERS.map((layer, i) => {
            const count = graph.nodes.filter((n) => n.layer === layer).length;
            if (count === 0) return null;
            return (
              <g key={layer}>
                <text
                  x={PAD + i * (COL_W + COL_GAP) + NODE_W / 2}
                  y={18}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="11"
                  fontWeight={700}
                  letterSpacing="1.5"
                >
                  {translate(LAYER_LABEL_KEY[layer])}
                </text>
                <line
                  x1={PAD + i * (COL_W + COL_GAP) + NODE_W / 2}
                  y1={28}
                  x2={PAD + i * (COL_W + COL_GAP) + NODE_W / 2}
                  y2={svgH - 12}
                  stroke="#334155"
                  strokeWidth={1}
                  strokeDasharray="2 5"
                  opacity={0.5}
                />
              </g>
            );
          })}

          {/* Edges */}
          {graph.edges.map((e) => {
            const s = nodeById.get(e.source);
            const t = nodeById.get(e.target);
            if (!s || !t) return null;
            const sx = s.x + NODE_W;
            const sy = s.y + NODE_H / 2;
            const tx = t.x;
            const ty = t.y + NODE_H / 2;
            const kindDim =
              e.kind === 'raw_to_dataset'
                ? { stroke: '#f59e0b', dash: '5 4' }
                : e.kind === 'job_source' || e.kind === 'job_output'
                  ? { stroke: '#8b5cf6', dash: '1 0' }
                  : { stroke: '#38bdf8', dash: '1 0' };
            return (
              <path
                key={e.id}
                d={edgePath(sx, sy, tx, ty)}
                fill="none"
                stroke={kindDim.stroke}
                strokeWidth={1.4}
                strokeDasharray={kindDim.dash}
                opacity={0.75}
              />
            );
          })}

          {/* Nodes */}
          {itemsByLayer.map(({ node, x, y }) => {
            const tone = NODE_TONE[node.kind];
            const selected = node.id === selectedNodeId;
            const isOrphan = node.kind !== 'raw' &&
              graph.edges.every((e) => e.source !== node.id && e.target !== node.id);
            const statusText = node.status || (node.kind === 'raw' ? 'CAPTURED' : '');
            const qa = node.qaDecision;
            return (
              <g
                key={node.id}
                onClick={() => onSelectNode(selected ? null : node.id)}
                className="cursor-pointer"
              >
                <title>{`${node.label} · ${node.status}`}</title>
                <rect
                  x={x}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={10}
                  fill="#0b1020"
                  stroke={selected ? '#e2e8f0' : tone}
                  strokeWidth={selected ? 2 : 1.2}
                  opacity={isOrphan ? 0.55 : 1}
                />
                {/* QA / status dot */}
                {node.kind !== 'raw' && (
                  <circle
                    cx={x + NODE_W - 10}
                    cy={y + 12}
                    r={4}
                    fill={
                      qa === 'APPROVED'
                        ? '#10b981'
                        : qa === 'REJECTED'
                          ? '#f43f5e'
                          : statusText === 'COMPLETED' || statusText === 'IMPORTED'
                            ? '#38bdf8'
                            : '#64748b'
                    }
                  />
                )}
                <text
                  x={x + 10}
                  y={y + 20}
                  fill="#e2e8f0"
                  fontSize="11.5"
                  fontWeight={700}
                >
                  {truncate(node.label, 22)}
                </text>
                <text
                  x={x + 10}
                  y={y + 37}
                  fill={tone}
                  fontSize="9.5"
                  fontWeight={700}
                  letterSpacing="1"
                >
                  {node.kind === 'raw'
                    ? translate('lineageNodeRawAggregate').toUpperCase()
                    : node.kind === 'job'
                      ? `${translate('lineageNodeJob').toUpperCase()} · ${node.job?.job_type || ''}`
                      : translate('lineageNodeDataset').toUpperCase()}
                </text>
                <text
                  x={x + 10}
                  y={y + 51}
                  fill="#94a3b8"
                  fontSize="9.5"
                >
                  {truncate(statusText || '', 24)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap text-[11px] text-text-muted">
        <span className="font-bold uppercase tracking-wider">{translate('lineageGraphLegend')}</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/80" /> RAW
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-sky-400/80" /> {translate('lineageNodeDataset')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-violet-400/80" /> {translate('lineageNodeJob')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> {translate('lineageQaApproved')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-400" /> {translate('lineageQaRejected')}
        </span>
      </div>
    </div>
  );
}