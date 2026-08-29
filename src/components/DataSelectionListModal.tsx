import React, { useState } from 'react';
import {
  X,
  Trash2,
  CheckSquare,
  Square,
  Layers,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ArrowRight
} from 'lucide-react';
import type { SelectedPointInfo, SubgridPointRow } from './DeletionSelectionMap';
import type { DailyTimeSeriesLike, BatchLogLike } from '../utils/deletionImpact';
import { extractSubgridName } from '../services/supabase';

export interface DataSelectionListModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedSubgrids: string[];
  selectedPoints: SelectedPointInfo[];
  subgridPoints: SubgridPointRow[];
  dailyData?: DailyTimeSeriesLike[];
  batchLogs?: BatchLogLike[];
  onTogglePoint: (point: SelectedPointInfo) => void;
  onSelectAllPointsForSubgrid: (subgrid: string) => void;
  onClearSubgridPoints: (subgrid: string) => void;
  onRemoveSubgrid: (subgrid: string) => void;
  onClearAll: () => void;
  onProceedToDelete: () => void;
}

export const DataSelectionListModal: React.FC<DataSelectionListModalProps> = ({
  isOpen,
  onClose,
  selectedSubgrids,
  selectedPoints,
  subgridPoints,
  dailyData = [],
  batchLogs: _batchLogs = [],
  onTogglePoint,
  onSelectAllPointsForSubgrid,
  onClearSubgridPoints,
  onRemoveSubgrid,
  onClearAll,
  onProceedToDelete
}) => {
  const [expandedSubgrids, setExpandedSubgrids] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    selectedSubgrids.forEach((sg) => {
      initial[sg] = true;
    });
    return initial;
  });

  const [searchFilter, setSearchFilter] = useState('');

  if (!isOpen) return null;

  const toggleSubgridExpand = (sg: string) => {
    setExpandedSubgrids((prev) => ({ ...prev, [sg]: !prev[sg] }));
  };

  // Compute total statistics
  let totalSelectedPointsCount = 0;
  let totalExistingFramesCount = 0;

  selectedSubgrids.forEach((sg) => {
    const norm = sg.toUpperCase().trim();
    const subPts = selectedPoints.filter((p) => p.subgrid.toUpperCase().trim() === norm);
    const sgRow = subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === norm);
    const dailyRow = dailyData.find(
      (d) => (extractSubgridName(d.subgrid || '') || '').toUpperCase().trim() === norm
    );
    const totalFrames =
      sgRow?.points?.length ||
      dailyRow?.availableImagesCount ||
      dailyRow?.poiCount ||
      (dailyRow as any)?.images ||
      0;

    totalSelectedPointsCount += subPts.length > 0 ? subPts.length : totalFrames;
    totalExistingFramesCount += totalFrames;
  });

  const remainingFramesCount = Math.max(0, totalExistingFramesCount - totalSelectedPointsCount);

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[1200] animate-in fade-in">
      <div className="bg-card border border-subtle rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-subtle flex items-center justify-between bg-inner shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <Layers size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
                Selected Data &amp; Point Inspector
              </h3>
              <p className="text-[11px] text-text-muted">
                Review and refine individual subgrids or specific trajectory points selected for deletion.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-base p-1.5 rounded-lg hover:bg-inner transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Top KPI Statistics Bar */}
        <div className="px-5 py-3 bg-inner/60 border-b border-subtle grid grid-cols-3 gap-3 text-xs shrink-0">
          <div className="p-2.5 rounded-xl bg-card border border-subtle">
            <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block">
              Subgrids Selected
            </span>
            <span className="text-base font-bold font-mono text-sky-400">
              {selectedSubgrids.length}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-card border border-rose-500/30 bg-rose-500/5">
            <span className="text-[10px] text-rose-300 uppercase font-bold tracking-wider block">
              Points / Frames To Delete
            </span>
            <span className="text-base font-bold font-mono text-rose-400">
              {totalSelectedPointsCount}{' '}
              <span className="text-[11px] font-normal text-text-muted">
                of {totalExistingFramesCount} total
              </span>
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-card border border-subtle">
            <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block">
              Remaining After Delete
            </span>
            <span className="text-base font-bold font-mono text-emerald-400">
              {remainingFramesCount} frames
            </span>
          </div>
        </div>

        {/* Filter and Global Controls */}
        <div className="px-5 py-2.5 border-b border-subtle flex flex-wrap items-center justify-between gap-3 text-xs bg-inner/40 shrink-0">
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter subgrid or point filename..."
            className="bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base placeholder-text-muted focus:outline-none focus:border-sky-500 max-w-xs flex-1 font-mono"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={onClearAll}
              className="text-[11px] text-text-muted hover:text-rose-400 transition-colors cursor-pointer px-2 py-1"
            >
              Clear All Selection
            </button>
          </div>
        </div>

        {/* Body: Scrollable Subgrid & Point List */}
        <div className="p-5 overflow-y-auto min-h-0 space-y-4 flex-1">
          {selectedSubgrids.length === 0 ? (
            <div className="text-center py-12 text-text-muted space-y-2">
              <AlertTriangle size={24} className="mx-auto text-amber-400" />
              <p className="text-xs">No subgrids or points currently selected.</p>
              <p className="text-[11px] text-text-muted">
                Click a station point on the map or drag a bounding box in Delete Mode to select data.
              </p>
            </div>
          ) : (
            selectedSubgrids
              .filter((sg) => !searchFilter || sg.toLowerCase().includes(searchFilter.toLowerCase()))
              .map((sg) => {
                const norm = sg.toUpperCase().trim();
                const isExpanded = expandedSubgrids[norm] ?? true;
                const sgRow = subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === norm);
                const allPoints = sgRow?.points || [];
                const selectedPts = selectedPoints.filter(
                  (p) => p.subgrid.toUpperCase().trim() === norm
                );
                const selectedFilenames = new Set(
                  selectedPts.map((p) => p.filename).filter(Boolean)
                );
                const isPartial = selectedPts.length > 0 && selectedPts.length < allPoints.length;
                const isAllSelected =
                  selectedPts.length === 0 || selectedPts.length >= allPoints.length;

                return (
                  <div
                    key={norm}
                    className="border border-subtle rounded-xl bg-inner overflow-hidden shadow-sm transition-all"
                  >
                    {/* Subgrid Card Header */}
                    <div
                      onClick={() => toggleSubgridExpand(norm)}
                      className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-card hover:bg-inner cursor-pointer border-b border-subtle transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          className="text-text-muted hover:text-text-base p-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSubgridExpand(norm);
                          }}
                        >
                          {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                        <span className="font-mono font-bold text-xs text-rose-300">
                          {norm}
                        </span>
                        {isPartial ? (
                          <span className="text-[10px] font-sans font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                            {selectedPts.length} of {allPoints.length} points selected
                          </span>
                        ) : (
                          <span className="text-[10px] font-sans font-semibold text-rose-300 bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 rounded-full">
                            All {allPoints.length} points targeted
                          </span>
                        )}
                      </div>

                      <div
                        className="flex items-center gap-2 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => onSelectAllPointsForSubgrid(norm)}
                          className="text-[11px] text-sky-400 hover:text-sky-300 font-medium px-2 py-1 rounded bg-inner border border-subtle hover:border-sky-500/30 cursor-pointer"
                        >
                          Select All
                        </button>
                        <button
                          onClick={() => onClearSubgridPoints(norm)}
                          className="text-[11px] text-amber-300 hover:text-amber-200 font-medium px-2 py-1 rounded bg-inner border border-subtle hover:border-amber-500/30 cursor-pointer"
                        >
                          Unselect Points
                        </button>
                        <button
                          onClick={() => onRemoveSubgrid(norm)}
                          className="text-[11px] text-text-muted hover:text-rose-400 transition-colors p-1 cursor-pointer"
                          title={`Remove ${norm} from delete list`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Point Detail Table (when expanded) */}
                    {isExpanded && (
                      <div className="p-3 bg-inner/40">
                        {allPoints.length === 0 ? (
                          <p className="text-[11px] text-text-muted italic px-2 py-2">
                            Entire subgrid record {norm} targeted for permanent removal.
                          </p>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-subtle max-h-56 overflow-y-auto">
                            <table className="w-full text-left text-[11px]">
                              <thead className="bg-card text-text-muted border-b border-subtle sticky top-0">
                                <tr>
                                  <th className="px-3 py-1.5 w-8">#</th>
                                  <th className="px-3 py-1.5">Point Filename / ID</th>
                                  <th className="px-3 py-1.5">GPS Latitude</th>
                                  <th className="px-3 py-1.5">GPS Longitude</th>
                                  <th className="px-3 py-1.5 text-right">Delete State</th>
                                </tr>
                              </thead>
                              <tbody>
                                {allPoints.map((p, idx) => {
                                  const pFilename =
                                    p.filename ||
                                    `${norm}-${String(idx + 1).padStart(4, '0')}.jpg`;
                                  const isChecked =
                                    isAllSelected || selectedFilenames.has(pFilename);

                                  return (
                                    <tr
                                      key={pFilename + idx}
                                      onClick={() =>
                                        onTogglePoint({
                                          subgrid: norm,
                                          filename: pFilename,
                                          pointId: p.pointId,
                                          lat: p.lat,
                                          lng: p.lng
                                        })
                                      }
                                      className={`hover:bg-card/80 transition-colors cursor-pointer border-t border-subtle ${
                                        isChecked ? 'bg-rose-500/5' : ''
                                      }`}
                                    >
                                      <td className="px-3 py-1.5 text-text-muted font-mono text-[10px]">
                                        {isChecked ? (
                                          <CheckSquare size={13} className="text-rose-400" />
                                        ) : (
                                          <Square size={13} className="text-text-muted" />
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono text-text-base flex items-center gap-1.5">
                                        <FileText size={11} className="text-text-muted shrink-0" />
                                        <span>{pFilename}</span>
                                      </td>
                                      <td className="px-3 py-1.5 font-mono text-text-muted">
                                        {p.lat.toFixed(5)}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono text-text-muted">
                                        {p.lng.toFixed(5)}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-semibold">
                                        {isChecked ? (
                                          <span className="text-rose-400 text-[10px]">
                                            To Delete
                                          </span>
                                        ) : (
                                          <span className="text-emerald-400 text-[10px]">
                                            Keep
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-subtle bg-inner flex items-center justify-between shrink-0 gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-card hover:bg-inner text-text-base text-xs font-medium border border-subtle transition-all cursor-pointer"
          >
            Close &amp; Continue Selection
          </button>
          <button
            onClick={() => {
              onClose();
              onProceedToDelete();
            }}
            disabled={selectedSubgrids.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-rose-500/40 active:scale-95"
          >
            <span>Proceed to Delete Impact Review</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataSelectionListModal;
