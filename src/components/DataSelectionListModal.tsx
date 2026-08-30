import React, { useState } from 'react';
import {
  X,
  Trash2,
  CheckSquare,
  Square,
  Layers,
  FileText,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Loader2,
  RotateCcw
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
  onConfirmDelete?: () => Promise<void> | void;
  onOpenRecycleBin?: () => void;
}

export const DataSelectionListModal: React.FC<DataSelectionListModalProps> = ({
  isOpen,
  onClose,
  selectedSubgrids,
  selectedPoints,
  subgridPoints,
  dailyData = [],
  batchLogs = [],
  onTogglePoint,
  onSelectAllPointsForSubgrid,
  onClearSubgridPoints,
  onRemoveSubgrid,
  onClearAll,
  onConfirmDelete,
  onOpenRecycleBin
}) => {
  const [expandedSubgrids, setExpandedSubgrids] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    selectedSubgrids.forEach((sg) => {
      initial[sg] = true;
    });
    return initial;
  });

  const [searchFilter, setSearchFilter] = useState('');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteInputText, setDeleteInputText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Auto-initialize points for newly selected subgrids on modal open if none exist
  const initializedSubgridsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    selectedSubgrids.forEach((sg) => {
      const norm = sg.toUpperCase().trim();
      if (!initializedSubgridsRef.current.has(norm)) {
        initializedSubgridsRef.current.add(norm);
        const existing = selectedPoints.filter((p) => p.subgrid.toUpperCase().trim() === norm);
        if (existing.length === 0) {
          onSelectAllPointsForSubgrid(norm);
        }
      }
    });
  }, [selectedSubgrids, onSelectAllPointsForSubgrid]);

  if (!isOpen) return null;

  const toggleSubgridExpand = (sg: string) => {
    setExpandedSubgrids((prev) => ({ ...prev, [sg]: !prev[sg] }));
  };

  // Compute total statistics & bucket availability
  let totalSelectedPointsCount = 0;
  let totalExistingFramesCount = 0;
  let totalAvailableBucketCount = 0;
  let selectedAvailableBucketCount = 0;

  selectedSubgrids.forEach((sg) => {
    const norm = sg.toUpperCase().trim();
    const subPts = selectedPoints.filter((p) => p.subgrid.toUpperCase().trim() === norm);
    const selectedKeys = new Set(subPts.map((p) => p.filename || `${p.lat},${p.lng}`).filter(Boolean));
    const sgRow = subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === norm);
    const masterRec = (batchLogs || []).find(
      (b) => (extractSubgridName(b.subgrid || (b as any).imageFilename || '') || '').toUpperCase().trim() === norm
    );
    const dailyRecs = (dailyData || []).filter(
      (d) => (extractSubgridName(d.subgrid || (d as any).imageFilename || '') || '').toUpperCase().trim() === norm
    );
    const allPts = sgRow?.points || [];

    const availableFilenamesSet = new Set(
      [
        ...((masterRec as any)?.availableFilenames || []),
        ...dailyRecs.flatMap((d) => (d as any)?.availableFilenames || []),
        ...((masterRec as any)?.panoramas || []).filter((p: any) => p.isAvailable === true).map((p: any) => p.filename),
        ...dailyRecs.flatMap((d) => ((d as any)?.panoramas || []).filter((p: any) => p.isAvailable === true).map((p: any) => p.filename))
      ].filter((f): f is string => Boolean(f))
    );

    const targetBucketCount =
      availableFilenamesSet.size > 0
        ? availableFilenamesSet.size
        : Math.max(
            Number(masterRec?.availableImagesCount ?? (masterRec as any)?.imagesProcessed ?? (masterRec as any)?.images ?? 0),
            ...dailyRecs.map((d) => Number(d.availableImagesCount ?? (d as any).imagesProcessed ?? (d as any).images ?? 0)),
            0
          );

    const totalFrames =
      allPts.length ||
      targetBucketCount ||
      Number(masterRec?.poiCount ?? dailyRecs[0]?.poiCount ?? (masterRec as any)?.images ?? 0);

    allPts.forEach((p, idx) => {
      const pFilename = p.filename || `${norm}-${String(idx + 1).padStart(4, '0')}.jpg`;
      const pointKey = p.filename || `${p.lat},${p.lng}`;
      const isPtInBucket =
        availableFilenamesSet.size > 0
          ? availableFilenamesSet.has(pFilename)
          : typeof (p as any).isAvailable === 'boolean'
          ? (p as any).isAvailable
          : targetBucketCount > 0
          ? idx < targetBucketCount
          : true;

      if (isPtInBucket) {
        totalAvailableBucketCount += 1;
        if (selectedKeys.has(pFilename) || selectedKeys.has(pointKey)) {
          selectedAvailableBucketCount += 1;
        }
      }
    });

    totalSelectedPointsCount += subPts.length;
    totalExistingFramesCount += totalFrames;
  });

  const remainingFramesCount = Math.max(0, totalExistingFramesCount - totalSelectedPointsCount);
  const remainingBucketCount = Math.max(0, totalAvailableBucketCount - selectedAvailableBucketCount);

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[1200] animate-in fade-in">
      <div className="bg-card border border-subtle rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-subtle flex items-center justify-between bg-card shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-inner border border-subtle flex items-center justify-center text-sky-400">
              <Layers size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
                Selected Data &amp; Point Inspector
              </h3>
              <p className="text-xs text-text-muted">
                Review and refine individual subgrids or specific trajectory points selected.
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
        <div className="px-6 py-3 bg-inner/40 border-b border-subtle grid grid-cols-3 gap-3 text-xs shrink-0">
          <div className="p-3 rounded-xl bg-card border border-subtle">
            <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block mb-1">
              Subgrids Selected
            </span>
            <span className={`text-base font-bold font-sans ${selectedSubgrids.length > 0 ? 'text-sky-400' : 'text-text-muted'}`}>
              {selectedSubgrids.length}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-card border border-subtle">
            <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block mb-1">
              Points Selected
            </span>
            <span className="text-base font-bold font-sans">
              <span className={totalSelectedPointsCount > 0 ? 'text-sky-400' : 'text-text-muted'}>
                {totalSelectedPointsCount}
              </span>{' '}
              <span className="text-xs font-normal text-text-muted font-sans">
                of {totalExistingFramesCount} total
              </span>
            </span>
          </div>
          <div className="p-3 rounded-xl bg-card border border-subtle">
            <span className="text-[10px] text-text-muted uppercase font-bold tracking-wider block mb-1">
              Remaining Frames
            </span>
            <div className="text-base font-bold font-sans">
              <span className={remainingFramesCount > 0 ? 'text-sky-400' : 'text-text-muted'}>
                {remainingFramesCount}
              </span>
              <span className="text-xs font-normal text-text-muted font-sans ml-1">
                ({remainingBucketCount} in bucket)
              </span>
            </div>
          </div>
        </div>

        {/* Filter and Global Controls */}
        <div className="px-6 py-2.5 border-b border-subtle flex flex-wrap items-center justify-between gap-3 text-xs bg-inner/20 shrink-0">
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filter subgrid or point filename..."
            className="bg-card border border-subtle focus:border-sky-500/40 rounded-xl px-3.5 py-1.5 text-xs text-text-base placeholder-text-muted focus:outline-none transition-all shadow-inner w-64"
          />

          <div className="flex items-center gap-3">
            {selectedSubgrids.length > 0 && (
              <button
                onClick={onClearAll}
                className="text-[11px] text-text-muted hover:text-text-base transition-colors cursor-pointer"
              >
                Clear Selection
              </button>
            )}
          </div>
        </div>

        {/* Body: Scrollable Subgrid & Point List */}
        <div className="p-6 overflow-y-auto min-h-0 space-y-3.5 flex-1">
          {selectedSubgrids.length === 0 ? (
            <div className="text-center py-12 text-text-muted space-y-2">
              <Layers size={24} className="mx-auto text-text-muted/60" />
              <p className="text-xs font-medium">No subgrids selected.</p>
              <p className="text-[11px] text-text-muted">
                Click a station point on the map or drag a bounding box in Selection Mode to select data.
              </p>
            </div>
          ) : (
            selectedSubgrids
              .filter((sg) => !searchFilter || sg.toLowerCase().includes(searchFilter.toLowerCase()))
              .map((sg) => {
                const norm = sg.toUpperCase().trim();
                const isExpanded = expandedSubgrids[norm] ?? true;
                const sgRow = subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === norm);
                const masterRec = (batchLogs || []).find(
                  (b) => (extractSubgridName(b.subgrid || (b as any).imageFilename || '') || '').toUpperCase().trim() === norm
                );
                const dailyRecs = (dailyData || []).filter(
                  (d) => (extractSubgridName(d.subgrid || (d as any).imageFilename || '') || '').toUpperCase().trim() === norm
                );
                const allPoints = sgRow?.points || [];
                const selectedPts = selectedPoints.filter(
                  (p) => p.subgrid.toUpperCase().trim() === norm
                );
                const selectedFilenames = new Set(
                  selectedPts.map((p) => p.filename || `${p.lat},${p.lng}`).filter(Boolean)
                );
                const isAllSelected = allPoints.length > 0 && selectedPts.length === allPoints.length;
                const isPartial = selectedPts.length > 0 && selectedPts.length < allPoints.length;

                const availableFilenamesSet = new Set(
                  [
                    ...((masterRec as any)?.availableFilenames || []),
                    ...dailyRecs.flatMap((d) => (d as any)?.availableFilenames || []),
                    ...((masterRec as any)?.panoramas || []).filter((p: any) => p.isAvailable === true).map((p: any) => p.filename),
                    ...dailyRecs.flatMap((d) => ((d as any)?.panoramas || []).filter((p: any) => p.isAvailable === true).map((p: any) => p.filename))
                  ].filter((f): f is string => Boolean(f))
                );

                const targetBucketCount =
                  availableFilenamesSet.size > 0
                    ? availableFilenamesSet.size
                    : Math.max(
                        Number(masterRec?.availableImagesCount ?? (masterRec as any)?.imagesProcessed ?? (masterRec as any)?.images ?? 0),
                        ...dailyRecs.map((d) => Number(d.availableImagesCount ?? (d as any).imagesProcessed ?? (d as any).images ?? 0)),
                        0
                      );

                const bucketAvailableCount = allPoints.filter((p, i) => {
                  const pFilename = p.filename || `${norm}-${String(i + 1).padStart(4, '0')}.jpg`;
                  if (availableFilenamesSet.size > 0) return availableFilenamesSet.has(pFilename);
                  if (typeof (p as any).isAvailable === 'boolean') return (p as any).isAvailable;
                  if (targetBucketCount > 0) return i < targetBucketCount;
                  return true;
                }).length;

                return (
                  <div
                    key={norm}
                    className="border border-subtle rounded-xl bg-card overflow-hidden shadow-sm transition-all"
                  >
                    {/* Subgrid Card Header */}
                    <div
                      onClick={() => toggleSubgridExpand(norm)}
                      className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-inner/60 hover:bg-inner cursor-pointer border-b border-subtle transition-colors"
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
                        <span className="font-sans font-bold text-xs text-text-base">
                          {norm}
                        </span>
                        <span className="text-[10px] font-sans font-normal text-text-muted bg-inner border border-subtle px-2 py-0.5 rounded-md flex items-center gap-1.5">
                          <span>
                            {isAllSelected
                              ? `All ${allPoints.length} points`
                              : isPartial
                              ? `${selectedPts.length} of ${allPoints.length} points`
                              : `0 of ${allPoints.length} points (Excluded)`}
                          </span>
                          <span>&bull;</span>
                          <span>Bucket:</span>
                          <span className={bucketAvailableCount > 0 ? 'text-sky-400 font-bold' : 'text-text-muted'}>
                            {bucketAvailableCount}
                          </span>
                          <span>/</span>
                          <span>{allPoints.length} frames</span>
                        </span>
                      </div>

                      <div
                        className="flex items-center gap-2 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => onSelectAllPointsForSubgrid(norm)}
                          className="text-[11px] text-text-base hover:text-sky-400 font-medium px-2.5 py-1 rounded-lg bg-card border border-subtle hover:border-sky-500/30 transition-all cursor-pointer"
                        >
                          Select All
                        </button>
                        <button
                          onClick={() => onClearSubgridPoints(norm)}
                          className="text-[11px] text-text-muted hover:text-text-base font-medium px-2.5 py-1 rounded-lg bg-card border border-subtle hover:border-subtle transition-all cursor-pointer"
                        >
                          Unselect Points
                        </button>
                        <button
                          onClick={() => onRemoveSubgrid(norm)}
                          className="text-[11px] text-text-muted hover:text-text-base transition-colors p-1 cursor-pointer"
                          title={`Remove ${norm} from selection`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Point Detail Table (when expanded) */}
                    {isExpanded && (
                      <div className="p-3 bg-card">
                        {allPoints.length === 0 ? (
                          <p className="text-xs text-text-muted italic px-2 py-2">
                            All survey points in {norm} selected.
                          </p>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-subtle max-h-56 overflow-y-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-inner/60 text-text-muted border-b border-subtle sticky top-0 font-medium">
                                <tr>
                                  <th className="px-3 py-2 w-8">#</th>
                                  <th className="px-3 py-2">Point Filename / ID</th>
                                  <th className="px-3 py-2">GPS Latitude</th>
                                  <th className="px-3 py-2">GPS Longitude</th>
                                  <th className="px-3 py-2 text-center">Available in Bucket</th>
                                  <th className="px-3 py-2 text-right">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-subtle font-sans text-[11px]">
                                {allPoints.map((p, idx) => {
                                  const pFilename =
                                    p.filename ||
                                    `${norm}-${String(idx + 1).padStart(4, '0')}.jpg`;
                                  const pointKey = p.filename || `${p.lat},${p.lng}`;
                                  const isChecked =
                                    selectedFilenames.has(pFilename) || selectedFilenames.has(pointKey);

                                  const isAvailableInBucket = (() => {
                                    if (availableFilenamesSet.size > 0) {
                                      return availableFilenamesSet.has(pFilename);
                                    }
                                    if (typeof (p as any).isAvailable === 'boolean') {
                                      return (p as any).isAvailable;
                                    }
                                    if ((masterRec as any)?.panoramas && (masterRec as any).panoramas.length > 0) {
                                      const match = (masterRec as any).panoramas.find((pano: any) =>
                                        pano.filename === pFilename ||
                                        (Math.abs(Number(pano.latitude ?? pano.lat) - p.lat) < 0.00005 &&
                                         Math.abs(Number(pano.longitude ?? pano.lng) - p.lng) < 0.00005)
                                      );
                                      if (match && typeof (match as any).isAvailable === 'boolean') {
                                        return (match as any).isAvailable;
                                      }
                                    }
                                    for (const d of dailyRecs) {
                                      if ((d as any)?.panoramas && (d as any).panoramas.length > 0) {
                                        const match = (d as any).panoramas.find((pano: any) =>
                                          pano.filename === pFilename ||
                                          (Math.abs(Number(pano.latitude ?? pano.lat) - p.lat) < 0.00005 &&
                                           Math.abs(Number(pano.longitude ?? pano.lng) - p.lng) < 0.00005)
                                        );
                                        if (match && typeof (match as any).isAvailable === 'boolean') {
                                          return (match as any).isAvailable;
                                        }
                                      }
                                    }
                                    if (targetBucketCount > 0) {
                                      return idx < targetBucketCount;
                                    }
                                    return true;
                                  })();

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
                                      className={`hover:bg-inner/60 transition-colors cursor-pointer ${
                                        isChecked ? 'bg-sky-500/5' : ''
                                      }`}
                                    >
                                      <td className="px-3 py-1.5 text-text-muted font-sans text-[10px]">
                                        {isChecked ? (
                                          <CheckSquare size={13} className="text-sky-400" />
                                        ) : (
                                          <Square size={13} className="text-text-muted" />
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 font-sans text-text-base flex items-center gap-1.5">
                                        <FileText size={11} className="text-text-muted shrink-0" />
                                        <span>{pFilename}</span>
                                      </td>
                                      <td className="px-3 py-1.5 font-sans text-text-muted">
                                        {p.lat.toFixed(5)}
                                      </td>
                                      <td className="px-3 py-1.5 font-sans text-text-muted">
                                        {p.lng.toFixed(5)}
                                      </td>
                                      <td className="px-3 py-1.5 text-center font-sans text-[10px]">
                                        {isAvailableInBucket ? (
                                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                                            Yes
                                          </span>
                                        ) : (
                                          <span className="px-2 py-0.5 rounded-md bg-inner text-text-muted border border-subtle font-medium">
                                            No
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-sans font-medium text-[10px]">
                                        {isChecked ? (
                                          <span className="text-sky-400 font-sans font-semibold">
                                            Selected
                                          </span>
                                        ) : (
                                          <span className="text-text-muted font-sans">
                                            Excluded
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

        {/* Deletion Confirmation Modal Overlay */}
        {isConfirmingDelete && (
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-6 z-30 animate-in fade-in">
            <div className="bg-card border border-subtle rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                  <ShieldAlert size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-text-base">Confirm Permanent Deletion</h4>
                  <p className="text-xs text-text-muted">Dynamic Database &amp; Record Synchronization</p>
                </div>
              </div>

              <div className="p-3.5 bg-inner/60 border border-subtle rounded-xl text-xs space-y-1.5 font-sans">
                <div className="flex justify-between text-text-muted">
                  <span>Subgrids Targeted:</span>
                  <strong className="text-text-base font-bold">{selectedSubgrids.length}</strong>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>Points / Frames to Purge:</span>
                  <strong className="text-rose-400 font-bold">{totalSelectedPointsCount}</strong>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-text-base">
                  To confirm deletion, please type <strong className="font-sans text-rose-400 font-bold">DELETE</strong> below:
                </label>
                <input
                  type="text"
                  value={deleteInputText}
                  onChange={(e) => setDeleteInputText(e.target.value)}
                  placeholder="Type DELETE..."
                  className="w-full bg-inner border border-subtle focus:border-rose-500/70 rounded-xl px-3.5 py-2 text-xs font-sans text-text-base placeholder-text-muted focus:outline-none uppercase tracking-wider"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-subtle">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => {
                    setIsConfirmingDelete(false);
                    setDeleteInputText('');
                  }}
                  className="px-4 py-2 rounded-xl bg-inner hover:bg-inner/80 text-text-base border border-subtle text-xs font-medium cursor-pointer transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteInputText.trim().toUpperCase() !== 'DELETE' || isDeleting}
                  onClick={async () => {
                    if (!onConfirmDelete) return;
                    setIsDeleting(true);
                    try {
                      await onConfirmDelete();
                      setIsConfirmingDelete(false);
                      setDeleteInputText('');
                      onClose();
                    } finally {
                      setIsDeleting(false);
                    }
                  }}
                  className="flex items-center gap-2 px-5 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer border border-rose-500/40 active:scale-95"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={13} />
                      <span>Confirm &amp; Delete</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-subtle bg-card flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-inner hover:bg-card text-text-base border border-subtle text-xs font-medium cursor-pointer transition-all"
            >
              Close
            </button>
            {onOpenRecycleBin && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRecycleBin();
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-inner hover:bg-card text-text-muted hover:text-text-base border border-subtle text-xs font-medium cursor-pointer transition-all"
                title="Open Dataset Recovery tab to restore deleted records"
              >
                <RotateCcw size={13} className="text-sky-400" />
                <span>Dataset Recovery</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onConfirmDelete && (
              <button
                onClick={() => setIsConfirmingDelete(true)}
                disabled={selectedSubgrids.length === 0 || totalSelectedPointsCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-sm transition-all cursor-pointer border border-rose-500/40 active:scale-95"
              >
                <Trash2 size={13} />
                <span>Delete Selected Data ({totalSelectedPointsCount} pts)</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataSelectionListModal;
