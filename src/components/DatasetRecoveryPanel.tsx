import React, { useState, useEffect, useCallback } from 'react';
import {
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Layers,
  Database,
  CheckCircle2,
  AlertTriangle,
  X
} from 'lucide-react';
import { ContentLoading } from './common/ContentLoading';
import {
  RecycleBinItem,
  fetchRecycleBinFromSupabase,
  deleteFromRecycleBinInSupabase
} from '../services/supabase';

export interface DatasetRecoveryPanelProps {
  onRestoreItem: (item: RecycleBinItem) => Promise<void> | void;
  isGuestUser?: boolean;
  onRefreshMap?: () => void;
}

export const DatasetRecoveryPanel: React.FC<DatasetRecoveryPanelProps> = ({
  onRestoreItem,
  isGuestUser = false,
  onRefreshMap
}) => {
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRecycleBinFromSupabase();
      setItems(data);
    } catch (err) {
      console.warn('Error loading recycle bin data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredItems = items.filter(
    (i) =>
      !search ||
      i.subgrid.toLowerCase().includes(search.toLowerCase()) ||
      i.deleted_by.toLowerCase().includes(search.toLowerCase())
  );

  const totalRecoverablePoi = items.reduce(
    (acc, it) => acc + (it.poi_count || it.points?.length || it.original_record?.poiCount || 0),
    0
  );

  const totalRecoverableFrames = items.reduce(
    (acc, it) => acc + (it.points?.filter((p) => Boolean(p.filename)).length || it.original_record?.availableImagesCount || it.points?.length || it.poi_count || 0),
    0
  );

  const handleRestore = async (item: RecycleBinItem) => {
    if (isGuestUser) return;
    setRestoringId(item.id);
    try {
      await onRestoreItem(item);
      await deleteFromRecycleBinInSupabase(item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      if (onRefreshMap) onRefreshMap();
      setActionMessage({
        text: `Successfully restored ${item.subgrid} (${item.points.length} points) back into active datasets.`,
        type: 'success'
      });
      setTimeout(() => setActionMessage(null), 5000);
    } catch (err) {
      setActionMessage({
        text: `Failed to restore ${item.subgrid}: ${(err as Error).message}`,
        type: 'error'
      });
    } finally {
      setRestoringId(null);
    }
  };

  const handleDeletePermanently = async (id: string, subgrid: string) => {
    if (isGuestUser) return;
    if (!window.confirm(`Permanently purge ${subgrid} from the Recycle Bin? This cannot be undone.`)) return;

    await deleteFromRecycleBinInSupabase(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
    setActionMessage({
      text: `Permanently purged ${subgrid} from Recycle Bin.`,
      type: 'success'
    });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleEmptyAll = async () => {
    if (isGuestUser || items.length === 0) return;
    if (!window.confirm(`Empty all ${items.length} records from the Recycle Bin permanently?`)) return;

    for (const it of items) {
      await deleteFromRecycleBinInSupabase(it.id);
    }
    setItems([]);
    setActionMessage({
      text: 'Recycle Bin has been emptied completely.',
      type: 'success'
    });
    setTimeout(() => setActionMessage(null), 4000);
  };

  return (
    <div className="flex flex-col gap-3 relative">
      {/* Action Banner Message */}
      {actionMessage && (
        <div className={`p-3 rounded-xl flex items-center justify-between text-xs border font-semibold transition-all shadow-sm ${
          actionMessage.type === 'success'
            ? 'bg-emerald-950/30 border-emerald-600/40 text-emerald-200'
            : 'bg-rose-950/30 border-rose-700/40 text-rose-200'
        }`}>
          <div className="flex items-center gap-2.5">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle size={15} className="text-rose-400 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-current hover:text-text-base p-1 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 bg-inner hover:bg-white/5 border border-subtle text-text-base px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin text-sky-400' : 'text-sky-400'} />
          <span>Refresh</span>
        </button>

        {items.length > 0 && !isGuestUser && (
          <button
            onClick={handleEmptyAll}
            className="flex items-center gap-1.5 bg-rose-950/40 hover:bg-rose-950/60 text-rose-300 border border-rose-700/40 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all shadow-sm cursor-pointer"
          >
            <Trash2 size={13} />
            <span>Empty Recycle Bin</span>
          </button>
        )}

        <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted ml-1">
          Deleted Dataset Archive
        </span>
        <span className="text-[10px] font-sans px-2 py-0.5 rounded-full bg-inner border border-subtle text-text-muted">
          {items.length} record{items.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Telemetry Strip */}
      <div className="bg-card border border-subtle rounded-xl px-4 py-2.5 shadow-sm text-xs flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[11px] font-bold text-text-muted shrink-0 uppercase tracking-wider">
          Recovery Telemetry:
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>
            <span className="text-text-muted">Archived Subgrids: </span>
            <strong className="font-semibold text-text-base">{items.length}</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span>
            <span className="text-text-muted">Recoverable: </span>
            <strong className="font-semibold text-text-base">{totalRecoverablePoi} POI</strong>
            <span className="text-text-muted"> / </span>
            <strong className="font-semibold text-text-base">{totalRecoverableFrames} frames</strong>
          </span>
          <span className="text-text-muted">&bull;</span>
          <span className="flex items-center gap-1.5">
            <span className="text-text-muted">Storage Source: </span>
            <Database size={12} className="text-sky-400" />
            <strong className="font-semibold text-text-base">Supabase PostgreSQL DB</strong>
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
            placeholder="Search deleted subgrids or operators..."
            className="w-full bg-inner border border-subtle rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-text-base placeholder-text-muted focus:outline-none focus:border-sky-500/60 transition-all"
          />
        </div>
        <span className="text-[11px] text-text-muted font-sans ml-auto">
          {filteredItems.length} / {items.length} items
        </span>
      </div>

      {/* Deleted Items List */}
      {loading && items.length === 0 ? (
        <ContentLoading variant="table" label="Loading recovery records from Supabase..." rows={4} />
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-subtle bg-card px-4 py-10 text-center text-text-muted">
          <div className="w-10 h-10 rounded-xl bg-inner border border-subtle flex items-center justify-center mx-auto mb-2.5 text-text-muted">
            <Layers size={18} />
          </div>
          <p className="text-xs font-semibold text-text-base">No items in Dataset Recovery.</p>
          <p className="text-[11px] text-text-muted mt-1 max-w-md mx-auto">
            Whenever subgrids or trajectory points are deleted from the Selection Map or tables, their recovery snapshots will be safely archived here for restoration.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => {
            const isExpanded = expandedId === item.id;
            const isRestoring = restoringId === item.id;
            const formattedDate = new Date(item.deleted_at).toLocaleString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
            const itemPoi = item.poi_count || item.points.length || item.original_record?.poiCount || 0;
            const itemFrames = item.points.filter((p) => Boolean(p.filename)).length || item.original_record?.availableImagesCount || item.points.length || itemPoi;

            return (
              <div
                key={item.id}
                className="bg-card border border-subtle rounded-xl overflow-hidden shadow-sm transition-colors"
              >
                {/* Item Card Header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-3 hover:bg-inner/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-base p-0.5 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(isExpanded ? null : item.id);
                      }}
                    >
                      {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-sans font-bold text-xs text-sky-300">
                          {item.subgrid}
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border bg-inner border-subtle text-text-muted">
                          {item.type === 'partial_points' ? 'Partial Deletion' : 'Whole Subgrid'}
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border bg-sky-950/40 border-sky-500/40 text-sky-300">
                          {itemPoi} POI
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider border bg-sky-950/40 border-sky-500/40 text-sky-300">
                          {itemFrames} frames
                        </span>
                      </div>
                      <p className="text-[10px] text-text-muted font-sans mt-0.5 truncate">
                        Deleted on {formattedDate} &bull; {item.deleted_by || 'Operator'} &bull; {item.km_processed || 0} km
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleRestore(item)}
                      disabled={isRestoring || isGuestUser}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 rounded-lg text-[10px] font-bold transition-all shadow-sm cursor-pointer disabled:opacity-40 active:scale-95"
                    >
                      {isRestoring ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <RotateCcw size={12} />
                      )}
                      <span>Restore</span>
                    </button>

                    {!isGuestUser && (
                      <button
                        onClick={() => handleDeletePermanently(item.id, item.subgrid)}
                        className="p-1.5 text-text-muted hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors cursor-pointer border border-transparent hover:border-rose-500/30"
                        title="Delete permanently from Supabase"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Points List Table */}
                {isExpanded && (
                  <div className="p-3 bg-inner/40 border-t border-subtle">
                    <div className="flex items-center justify-between text-[10px] font-bold text-text-muted uppercase tracking-wide mb-2">
                      <span>
                        Point Coordinates &amp; File Metadata ({item.points.length} points &bull; {item.points.filter((p) => Boolean(p.filename)).length} frames)
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-subtle max-h-56 overflow-y-auto bg-card">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-inner/60 text-text-muted border-b border-subtle sticky top-0">
                          <tr>
                            <th className="px-2.5 py-1.5 w-8">#</th>
                            <th className="px-2.5 py-1.5">Point Filename</th>
                            <th className="px-2.5 py-1.5">Latitude</th>
                            <th className="px-2.5 py-1.5">Longitude</th>
                            <th className="px-2.5 py-1.5">Heading</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle font-sans text-[11px]">
                          {item.points.map((p, idx) => (
                            <tr key={idx} className="hover:bg-inner/40">
                              <td className="px-2.5 py-1.5 text-text-muted">{idx + 1}</td>
                              <td className="px-2.5 py-1.5 text-text-base flex items-center gap-1.5">
                                <FileText size={11} className="text-text-muted shrink-0" />
                                <span>{p.filename || `${item.subgrid}-${String(idx + 1).padStart(4, '0')}.jpg`}</span>
                              </td>
                              <td className="px-2.5 py-1.5 text-text-muted">{p.lat?.toFixed(5)}</td>
                              <td className="px-2.5 py-1.5 text-text-muted">{p.lng?.toFixed(5)}</td>
                              <td className="px-2.5 py-1.5 text-text-muted">{p.bearing ?? '0.0'}°</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DatasetRecoveryPanel;