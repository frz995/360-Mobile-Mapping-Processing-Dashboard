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
  AlertTriangle
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
    <div className="space-y-4">
      {/* Top Banner Message */}
      {actionMessage && (
        <div className={`p-4 rounded-xl flex items-center justify-between text-xs border font-semibold transition-all shadow-md bg-card border-subtle text-text-base`}>
          <div className="flex items-center gap-3">
            {actionMessage.type === 'success' ? (
              <CheckCircle2 size={16} className="text-sky-400 shrink-0" />
            ) : (
              <AlertTriangle size={16} className="text-rose-400 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="text-text-muted hover:text-text-base p-1 cursor-pointer">
            &times;
          </button>
        </div>
      )}

      {/* Summary KPI Cards & Toolbar Header */}
      <div className="bg-card border border-subtle rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-inner border border-subtle flex items-center justify-center text-sky-400">
              <RotateCcw size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-text-base tracking-wide">Dataset Recovery &amp; Recycle Bin</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-sans font-bold bg-inner border border-subtle text-text-base">
                  {items.length} Record{items.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Restore previously deleted survey subgrids or specific trajectory points back to active production database and map layers.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-inner hover:bg-card text-text-base border border-subtle text-xs font-medium cursor-pointer transition-all shadow-sm"
              title="Refresh from Supabase"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-sky-400' : 'text-sky-400'} />
              <span>Refresh</span>
            </button>
            {items.length > 0 && !isGuestUser && (
              <button
                onClick={handleEmptyAll}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-inner hover:bg-rose-500/10 text-text-muted hover:text-rose-400 border border-subtle hover:border-rose-500/30 text-xs font-medium cursor-pointer transition-all shadow-sm"
              >
                <Trash2 size={13} />
                <span>Empty Recycle Bin</span>
              </button>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-subtle text-xs">
          <div className="p-3 rounded-xl bg-inner/50 border border-subtle">
            <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block mb-1">
              Archived Batches / Subgrids
            </span>
            <span className={`text-base font-bold font-sans ${items.length > 0 ? 'text-sky-400' : 'text-text-muted'}`}>
              {items.length}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-inner/50 border border-subtle">
            <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block mb-1">
              Recoverable POI &amp; Frames
            </span>
            <div className="text-base font-bold font-sans flex items-center gap-1.5">
              <span className={totalRecoverablePoi > 0 ? 'text-sky-400' : 'text-text-muted'}>
                {totalRecoverablePoi} POI
              </span>
              <span className="text-text-muted text-xs font-sans font-normal">/</span>
              <span className={totalRecoverableFrames > 0 ? 'text-sky-400' : 'text-text-muted'}>
                {totalRecoverableFrames} frames
              </span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-inner/50 border border-subtle">
            <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block mb-1">
              Storage Source
            </span>
            <span className="text-xs font-sans font-medium text-text-base flex items-center gap-1.5 mt-0.5">
              <Database size={13} className="text-sky-400" />
              <span>Supabase PostgreSQL DB</span>
            </span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-card border border-subtle rounded-2xl p-4 shadow-md flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deleted subgrids, point filenames, or operators..."
            className="w-full bg-inner border border-subtle focus:border-sky-500/50 rounded-xl pl-9 pr-4 py-2 text-xs font-sans text-text-base placeholder-text-muted focus:outline-none transition-all shadow-inner"
          />
        </div>
        <div className="text-[11px] text-text-muted font-sans">
          Showing {filteredItems.length} of {items.length} items
        </div>
      </div>

      {/* Deleted Items List */}
      <div className="space-y-3">
        {loading && items.length === 0 ? (
          <ContentLoading variant="cards" label="Loading recovery records from Supabase..." rows={3} />
        ) : filteredItems.length === 0 ? (
          <div className="bg-card border border-subtle rounded-2xl p-12 text-center text-text-muted space-y-2.5">
            <div className="w-12 h-12 rounded-2xl bg-inner border border-subtle flex items-center justify-center mx-auto text-text-muted">
              <Layers size={22} />
            </div>
            <p className="text-sm font-semibold text-text-base">No items in Dataset Recovery.</p>
            <p className="text-xs text-text-muted max-w-md mx-auto">
              Whenever subgrids or trajectory points are deleted from the Selection Map or tables, their recovery snapshots will be safely archived here for restoration.
            </p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isExpanded = expandedId === item.id;
            const isRestoring = restoringId === item.id;
            const formattedDate = new Date(item.deleted_at).toLocaleString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });

            return (
              <div
                key={item.id}
                className="bg-card border border-subtle rounded-2xl overflow-hidden shadow-md transition-all hover:border-subtle/80"
              >
                {/* Item Card Header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="p-4.5 flex flex-wrap items-center justify-between gap-3 bg-card hover:bg-inner/40 cursor-pointer border-b border-subtle transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-base p-0.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedId(isExpanded ? null : item.id);
                      }}
                    >
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  <div>
                    {(() => {
                      const itemPoi = item.poi_count || item.points.length || item.original_record?.poiCount || 0;
                      const itemFrames = item.points.filter((p) => Boolean(p.filename)).length || item.original_record?.availableImagesCount || item.points.length || itemPoi;
                      return (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-sans font-bold text-sm text-text-base">
                              {item.subgrid}
                            </span>
                            <span className="text-[10px] font-sans px-2.5 py-0.5 rounded-md bg-inner border border-subtle text-text-muted font-semibold flex items-center gap-1.5">
                              <span>{item.type === 'partial_points' ? 'Partial Deletion' : 'Whole Subgrid'}</span>
                              <span>&bull;</span>
                              <span className={itemPoi > 0 ? 'text-sky-400' : 'text-text-muted'}>{itemPoi} POI</span>
                              <span>/</span>
                              <span className={itemFrames > 0 ? 'text-sky-400' : 'text-text-muted'}>{itemFrames} frames</span>
                            </span>
                          </div>
                          <p className="text-[11px] text-text-muted font-sans mt-0.5">
                            Deleted on {formattedDate} &bull; by <strong className="text-text-base">{item.deleted_by || 'Operator'}</strong> &bull; {item.km_processed || 0} km
                          </p>
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleRestore(item)}
                    disabled={isRestoring || isGuestUser}
                    className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer active:scale-95"
                  >
                    {isRestoring ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RotateCcw size={13} />
                    )}
                    <span>Restore Dataset</span>
                  </button>

                  {!isGuestUser && (
                    <button
                      onClick={() => handleDeletePermanently(item.id, item.subgrid)}
                      className="p-2 text-text-muted hover:text-rose-400 hover:bg-inner rounded-xl transition-colors cursor-pointer border border-transparent hover:border-subtle"
                      title="Delete permanently from Supabase"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded Points List Table */}
              {isExpanded && (
                <div className="p-4 bg-inner/30 space-y-2 border-t border-subtle">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-text-base text-[11px] uppercase tracking-wide">
                      Point Coordinates &amp; File Metadata ({item.points.length} points &bull; {item.points.filter((p) => Boolean(p.filename)).length} frames)
                    </span>
                  </div>
                    <div className="overflow-x-auto rounded-xl border border-subtle max-h-56 overflow-y-auto bg-card">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-inner/60 text-text-muted border-b border-subtle sticky top-0 font-medium">
                          <tr>
                            <th className="px-3 py-2 w-10">#</th>
                            <th className="px-3 py-2">Point Filename</th>
                            <th className="px-3 py-2">Latitude</th>
                            <th className="px-3 py-2">Longitude</th>
                            <th className="px-3 py-2">Heading</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle font-sans text-[11px]">
                          {item.points.map((p, idx) => (
                            <tr key={idx} className="hover:bg-inner/40">
                              <td className="px-3 py-1.5 text-text-muted">{idx + 1}</td>
                              <td className="px-3 py-1.5 text-text-base flex items-center gap-1.5">
                                <FileText size={11} className="text-text-muted shrink-0" />
                                <span>{p.filename || `${item.subgrid}-${String(idx + 1).padStart(4, '0')}.jpg`}</span>
                              </td>
                              <td className="px-3 py-1.5 text-text-muted">{p.lat?.toFixed(5)}</td>
                              <td className="px-3 py-1.5 text-text-muted">{p.lng?.toFixed(5)}</td>
                              <td className="px-3 py-1.5 text-text-muted">{p.bearing ?? '0.0'}°</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default DatasetRecoveryPanel;
