import React, { useEffect, useState } from 'react';
import { ClipboardList, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import type { DatasetRecord, NasFolderListing } from '../../../types/production';
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
  stitchedCount?: number;
  cleanedCount?: number;
  deliverableCount?: number;
  datasetCount: number;
  stages: string[];
}

const TOP_LEVELS = ['RAW', 'stitchblur', 'cleaned', 'deliverables'] as const;

export const RawRegistryPanel: React.FC<RawRegistryPanelProps> = ({ api, datasets }) => {
  const [rows, setRows] = useState<MaturityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    const results = await Promise.all(
      TOP_LEVELS.map(async (top) => {
        const listing = await api.listFolder(top);
        return { top, listing };
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
        .forEach((e) => subgrids.add(e.name.toUpperCase()));
    });
    datasets.forEach((d) => {
      if (d.subgrid) subgrids.add(d.subgrid.toUpperCase());
    });

    const sorted = Array.from(subgrids).sort();
    const rowsOut: MaturityRow[] = sorted.map((sg) => {
      const row: MaturityRow = {
        subgrid: sg,
        datasetCount: datasets.filter(
          (d) => (d.subgrid || '').toUpperCase() === sg
        ).length,
        stages: []
      };
      const getCount = (top: string) => {
        const listing = folderMap[top];
        const entry = listing?.entries.find(
          (e) => e.isDirectory && e.name.toUpperCase() === sg
        );
        return entry;
      };
      const raw = getCount('RAW');
      if (raw) {
        row.rawCount = raw.fileCount;
        row.rawBytes = raw.sizeBytes;
        row.stages.push('RAW');
      }
      const stitched = getCount('stitchblur');
      if (stitched) {
        row.stitchedCount = stitched.fileCount;
        row.stages.push('stitchblur');
      }
      const cleaned = getCount('cleaned');
      if (cleaned) {
        row.cleanedCount = cleaned.fileCount;
        row.stages.push('cleaned');
      }
      const deliv = getCount('deliverables');
      if (deliv) {
        row.deliverableCount = deliv.fileCount;
        row.stages.push('deliverables');
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

  const maturity = (row: MaturityRow): number => Math.min(4, row.stages.length) / 4;

  const statusFor = (row: MaturityRow): { label: string; cls: string } => {
    const m = maturity(row);
    if (m <= 0) return { label: 'Not captured', cls: 'text-rose-300 bg-rose-500/10 border-rose-500/30' };
    if (m >= 1) return { label: 'Complete', cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' };
    return { label: 'In progress', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' };
  };

  const cell = (count?: number, bytes?: number) =>
    count ? (
      <div className="text-text-base font-sans">{count.toLocaleString()}
        <div className="text-[10px] text-text-muted font-sans">{formatBytes(bytes)}</div>
      </div>
    ) : (
      <span className="text-text-muted/50">—</span>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-text-base text-xs font-bold uppercase tracking-wide">
          <ClipboardList size={15} className="text-sky-400" /> Per-subgrid maturity matrix
        </div>
        <div className="flex-1" />
        <button onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-sky-500/20 hover:border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Reload
        </button>
      </div>

      {error && <p className="text-[11px] text-amber-300">{error}</p>}
      {loading ? (
        <div className="flex items-center gap-2 text-[11px] text-text-muted py-6 bg-inner border border-subtle rounded-xl justify-center">
          <Loader2 size={14} className="animate-spin" /> Scanning top-level folders…
        </div>
      ) : (
        <div className="bg-inner border border-subtle rounded-xl overflow-x-auto">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-text-muted">
              No subgrids found. Connect the NAS GPU Worker (http mode) or add datasets to populate the registry.
            </p>
          ) : (
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-text-muted uppercase tracking-wide text-[10px] border-b border-subtle">
                  <th className="py-2 px-3">Subgrid</th>
                  <th className="py-2 px-3 text-right">RAW frames</th>
                  <th className="py-2 px-3 text-right">Stitch / Blur</th>
                  <th className="py-2 px-3 text-right">Cleaned</th>
                  <th className="py-2 px-3 text-right">Deliverables</th>
                  <th className="py-2 px-3 text-right">Datasets</th>
                  <th className="py-2 px-3 w-40">Maturity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const st = statusFor(row);
                  return (
                    <tr key={row.subgrid} className="border-b border-subtle/50">
                      <td className="py-2.5 px-3 font-semibold text-sky-300">{row.subgrid}</td>
                      <td className="py-2.5 px-3 text-right">{cell(row.rawCount, row.rawBytes)}</td>
                      <td className="py-2.5 px-3 text-right">{cell(row.stitchedCount)}</td>
                      <td className="py-2.5 px-3 text-right">{cell(row.cleanedCount)}</td>
                      <td className="py-2.5 px-3 text-right">{cell(row.deliverableCount)}</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className="flex items-center justify-end gap-1 text-text-base">
                          <CheckCircle2 size={12} className="text-sky-400" /> {row.datasetCount}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 bg-black/40 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 via-sky-400 to-emerald-400 transition-all duration-500"
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
          <div className="px-3 py-2 border-t border-subtle text-[10px] text-text-muted">
            Matrix is built live from {api.mode === 'mock' ? 'simulated' : 'working-dir'} top-level folders + the datasets table. {datasets.length} dataset records indexed.
          </div>
        </div>
      )}
    </div>
  );
};