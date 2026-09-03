import React, { useEffect, useState } from 'react';
import { ClipboardList, RefreshCw, CheckCircle2 } from 'lucide-react';
import { ContentLoading } from '../../common/ContentLoading';
import { EmptyState } from '../../common/EmptyState';
import type { ProductionApiClient } from '../../../services/productionApi';
import type { DatasetRecord, NasFolderListing } from '../../../types/production';
import { extractCanonicalSubgrid } from '../../../utils/datasetLineage';
import { formatBytes } from './storageCommon';

export interface RawRegistryPanelProps {
  api: ProductionApiClient;
  datasets: DatasetRecord[];
  translate: (key: string) => string;
}

interface MaturityRow {
  subgrid: string;
  rawCount?: number;
  rawBytes?: number;
  blurredCount?: number;
  stitchedCount?: number;
  enhancedCount?: number;
  processedCount?: number;
  deliverableCount?: number;
  datasetCount: number;
  stages: string[];
}

const WORKSTATION_STAGES = [
  { key: 'RAW', label: 'RAW Frames' },
  { key: 'BLURRED', label: 'PC 1 Blur' },
  { key: 'STITCHED', label: 'PC 2 Stitch' },
  { key: 'ENHANCED', label: 'PC 3 Lightroom' },
  { key: 'PROCESSED', label: 'PC 4 Photoshop' },
  { key: 'DELIVERABLES', label: 'Deliverables' }
] as const;

export const RawRegistryPanel: React.FC<RawRegistryPanelProps> = ({ api, datasets }) => {
  const [rows, setRows] = useState<MaturityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    const results = await Promise.all(
      WORKSTATION_STAGES.map(async (stage) => {
        const listing = await api.listFolder(stage.key);
        return { top: stage.key, listing };
      })
    );

    // Union of subgrids: folder listing + dataset records.
    const folderMap: Record<string, NasFolderListing | null> = {};
    results.forEach(({ top, listing }) => {
      folderMap[top] = listing;
    });
    const subgrids = new Set<string>();
    results.forEach(({ listing }) => {
      (listing?.entries || [])
        .filter((e) => e.isDirectory)
        .forEach((e) => {
          const clean = extractCanonicalSubgrid(e.name);
          if (clean) subgrids.add(clean);
        });
    });
    datasets.forEach((d) => {
      const clean = extractCanonicalSubgrid(d.subgrid);
      if (clean) subgrids.add(clean);
    });

    const sorted = Array.from(subgrids).sort();
    const rowsOut: MaturityRow[] = sorted.map((sg) => {
      const row: MaturityRow = {
        subgrid: sg,
        datasetCount: datasets.filter(
          (d) => extractCanonicalSubgrid(d.subgrid) === sg
        ).length,
        stages: []
      };
      const getCount = (top: string) => {
        const listing = folderMap[top];
        const entry = listing?.entries.find(
          (e) => e.isDirectory && extractCanonicalSubgrid(e.name) === sg
        );
        return entry;
      };

      const raw = getCount('RAW');
      if (raw) {
        row.rawCount = raw.fileCount;
        row.rawBytes = raw.sizeBytes;
        row.stages.push('RAW');
      }
      const blurred = getCount('BLURRED');
      if (blurred) {
        row.blurredCount = blurred.fileCount;
        row.stages.push('BLURRED');
      }
      const stitched = getCount('STITCHED');
      if (stitched) {
        row.stitchedCount = stitched.fileCount;
        row.stages.push('STITCHED');
      }
      const enhanced = getCount('ENHANCED');
      if (enhanced) {
        row.enhancedCount = enhanced.fileCount;
        row.stages.push('ENHANCED');
      }
      const processed = getCount('PROCESSED');
      if (processed) {
        row.processedCount = processed.fileCount;
        row.stages.push('PROCESSED');
      }
      const deliv = getCount('DELIVERABLES');
      if (deliv) {
        row.deliverableCount = deliv.fileCount;
        row.stages.push('DELIVERABLES');
      }
      return row;
    });
    setRows(rowsOut);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const maturity = (row: MaturityRow): number => Math.min(5, row.stages.length) / 5;

  const statusFor = (row: MaturityRow): { label: string; cls: string } => {
    const m = maturity(row);
    if (m <= 0) return { label: 'Not captured', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30' };
    if (m >= 1) return { label: 'Complete', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' };
    return { label: 'In progress', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' };
  };

  const cell = (count?: number, bytes?: number) =>
    count ? (
      <div className="text-text-base font-sans">{count.toLocaleString()}
        {bytes !== undefined && <div className="text-[10px] text-text-muted font-sans">{formatBytes(bytes)}</div>}
      </div>
    ) : (
      <span className="text-text-muted/50">—</span>
    );

  return (
    <div className="space-y-4 animate-in fade-in font-sans">
      {/* Header with bottom divider line matching RBAC */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
        <div>
          <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
            <ClipboardList size={16} className="text-sky-400" />
            4-PC Workstation Maturity Matrix
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Dataset progression across RAW, PC 1 Blur, PC 2 Stitch, PC 3 Lightroom, PC 4 Photoshop, and Deliverables.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 bg-inner hover:bg-card border border-subtle rounded-lg text-xs font-semibold text-text-base flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          <span>Scan Folders</span>
        </button>
      </div>

      {error && <p className="text-xs text-amber-300">{error}</p>}

      {loading ? (
        <ContentLoading variant="table" label="Scanning workstation NAS folders…" rows={5} />
      ) : (
        <div className="border border-subtle rounded-lg overflow-x-auto">
          {rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No subgrids found"
              hint="Connect the NAS Worker (http mode) or add datasets to populate the registry, then re-scan folders."
            />
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-app text-text-muted uppercase text-[10px] tracking-wider border-b border-subtle">
                  <th className="px-3.5 py-2.5">Subgrid</th>
                  <th className="px-3.5 py-2.5 text-right">RAW Frames</th>
                  <th className="px-3.5 py-2.5 text-right">PC 1 Blur</th>
                  <th className="px-3.5 py-2.5 text-right">PC 2 Stitch</th>
                  <th className="px-3.5 py-2.5 text-right">PC 3 Lightroom</th>
                  <th className="px-3.5 py-2.5 text-right">PC 4 Photoshop</th>
                  <th className="px-3.5 py-2.5 text-right">Deliverables</th>
                  <th className="px-3.5 py-2.5 text-right">Datasets</th>
                  <th className="px-3.5 py-2.5 w-36">Maturity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle/80">
                {rows.map((row) => {
                  const st = statusFor(row);
                  return (
                    <tr key={row.subgrid} className="hover:bg-inner transition-colors">
                      <td className="px-3.5 py-2.5 font-semibold text-text-base">{row.subgrid}</td>
                      <td className="px-3.5 py-2.5 text-right">{cell(row.rawCount, row.rawBytes)}</td>
                      <td className="px-3.5 py-2.5 text-right">{cell(row.blurredCount)}</td>
                      <td className="px-3.5 py-2.5 text-right">{cell(row.stitchedCount)}</td>
                      <td className="px-3.5 py-2.5 text-right">{cell(row.enhancedCount)}</td>
                      <td className="px-3.5 py-2.5 text-right">{cell(row.processedCount)}</td>
                      <td className="px-3.5 py-2.5 text-right">{cell(row.deliverableCount)}</td>
                      <td className="px-3.5 py-2.5 text-right">
                        <span className="flex items-center justify-end gap-1 text-text-base">
                          <CheckCircle2 size={12} className="text-sky-400" /> {row.datasetCount}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 bg-black/40 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-sky-400 transition-all duration-500"
                              style={{ width: `${maturity(row) * 100}%` }} />
                          </div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${st.cls}`}>
                            {st.label}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="px-3.5 py-2 border-t border-subtle text-[10px] text-text-muted bg-inner/40">
            Matrix is queried dynamically from NAS worker directories + Supabase datasets table. {datasets.length} dataset records indexed.
          </div>
        </div>
      )}
    </div>
  );
};