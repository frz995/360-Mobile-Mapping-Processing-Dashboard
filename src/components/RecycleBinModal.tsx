import React, { useState, useEffect } from 'react';
import {
  X,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  Layers
} from 'lucide-react';
import {
  RecycleBinItem,
  fetchRecycleBinFromSupabase,
  deleteFromRecycleBinInSupabase
} from '../services/supabase';

export interface RecycleBinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreItem: (item: RecycleBinItem) => Promise<void> | void;
}

export const RecycleBinModal: React.FC<RecycleBinModalProps> = ({
  isOpen,
  onClose,
  onRestoreItem
}) => {
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await fetchRecycleBinFromSupabase();
      setItems(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredItems = items.filter(
    (i) =>
      !search ||
      i.subgrid.toLowerCase().includes(search.toLowerCase()) ||
      i.deleted_by.toLowerCase().includes(search.toLowerCase())
  );

  const handleRestore = async (item: RecycleBinItem) => {
    setRestoringId(item.id);
    try {
      await onRestoreItem(item);
      await deleteFromRecycleBinInSupabase(item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
    } finally {
      setRestoringId(null);
    }
  };

  const handleDeletePermanently = async (id: string) => {
    await deleteFromRecycleBinInSupabase(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[1250] animate-in fade-in">
      <div className="bg-card border border-subtle rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-subtle flex items-center justify-between bg-card shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-inner border border-subtle flex items-center justify-center text-sky-400">
              <RotateCcw size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-text-base">Recycle Bin &amp; Data Restore</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-inner border border-subtle text-text-muted">
                  {items.length} item{items.length !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Restore previously deleted subgrids and trajectory points to active survey data.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 text-text-muted hover:text-text-base rounded-lg hover:bg-inner transition-colors cursor-pointer"
              title="Refresh Recycle Bin"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-base p-1.5 rounded-lg hover:bg-inner transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-6 py-2.5 border-b border-subtle flex items-center justify-between gap-3 text-xs bg-inner/30 shrink-0">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deleted subgrid or user..."
            className="bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base placeholder-text-muted focus:outline-none focus:border-sky-500/50 max-w-xs flex-1 font-mono"
          />
          <span className="text-[11px] text-text-muted">
            Stored in Supabase Database
          </span>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto min-h-0 space-y-3 flex-1">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-12 gap-2 text-xs text-text-muted">
              <Loader2 size={16} className="animate-spin text-sky-400" />
              <span>Loading deleted records from Supabase...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12 text-text-muted space-y-2">
              <Layers size={24} className="mx-auto text-text-muted/60" />
              <p className="text-xs font-medium">Recycle Bin is empty.</p>
              <p className="text-[11px] text-text-muted">
                Deleted subgrids or trajectory points will appear here and can be restored anytime.
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
                  className="border border-subtle rounded-xl bg-card overflow-hidden transition-all shadow-sm"
                >
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-inner/40 hover:bg-inner/70 cursor-pointer border-b border-subtle transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        className="text-text-muted hover:text-text-base p-0.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId(isExpanded ? null : item.id);
                        }}
                      >
                        {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                      <span className="font-mono font-bold text-xs text-text-base">
                        {item.subgrid}
                      </span>
                      {(() => {
                        const itemPoi = item.poi_count || item.points.length || item.original_record?.poiCount || 0;
                        const itemFrames = item.points.filter((p) => Boolean(p.filename)).length || item.original_record?.availableImagesCount || item.points.length || itemPoi;
                        return (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-inner border border-subtle text-text-muted flex items-center gap-1.5 font-semibold">
                            <span>{item.type === 'partial_points' ? 'Partial Deletion' : 'Whole Subgrid'}</span>
                            <span>&bull;</span>
                            <span className={itemPoi > 0 ? 'text-sky-400' : 'text-text-muted'}>{itemPoi} POI</span>
                            <span>/</span>
                            <span className={itemFrames > 0 ? 'text-sky-400' : 'text-text-muted'}>{itemFrames} frames</span>
                          </span>
                        );
                      })()}
                    </div>

                    <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                      <span className="text-[11px] text-text-muted hidden sm:inline font-mono">
                        {formattedDate} &bull; by {item.deleted_by || 'Operator'}
                      </span>

                      <button
                        onClick={() => handleRestore(item)}
                        disabled={isRestoring}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-sm transition-all cursor-pointer"
                      >
                        {isRestoring ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        <span>Restore</span>
                      </button>

                      <button
                        onClick={() => handleDeletePermanently(item.id)}
                        className="p-1.5 text-text-muted hover:text-rose-400 transition-colors cursor-pointer rounded-lg hover:bg-inner"
                        title="Delete permanently"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Point Details */}
                  {isExpanded && (
                    <div className="p-3 bg-card">
                      <div className="overflow-x-auto rounded-lg border border-subtle max-h-48 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-inner/60 text-text-muted border-b border-subtle sticky top-0 font-medium">
                            <tr>
                              <th className="px-3 py-1.5">#</th>
                              <th className="px-3 py-1.5">Point Filename</th>
                              <th className="px-3 py-1.5">Latitude</th>
                              <th className="px-3 py-1.5">Longitude</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-subtle font-mono text-[11px]">
                            {item.points.map((p, idx) => (
                              <tr key={idx} className="hover:bg-inner/40">
                                <td className="px-3 py-1 text-text-muted">{idx + 1}</td>
                                <td className="px-3 py-1 text-text-base flex items-center gap-1.5">
                                  <FileText size={11} className="text-text-muted shrink-0" />
                                  <span>{p.filename || `${item.subgrid}-${String(idx + 1).padStart(4, '0')}.jpg`}</span>
                                </td>
                                <td className="px-3 py-1 text-text-muted">{p.lat?.toFixed(5)}</td>
                                <td className="px-3 py-1 text-text-muted">{p.lng?.toFixed(5)}</td>
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

        {/* Footer */}
        <div className="px-6 py-4 border-t border-subtle bg-card flex items-center justify-between shrink-0">
          <span className="text-[11px] text-text-muted">
            Restored records immediately sync back to Daily Data, Master List, and WebGIS Map.
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-inner hover:bg-card text-text-base border border-subtle text-xs font-semibold shadow-sm transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecycleBinModal;
