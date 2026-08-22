import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  X,
  CheckCircle,
  Eye,
  Camera,
  Navigation,
  Sun,
  ShieldCheck,
  Filter,
  Loader2,
  MapPin,
  Clock,
  User,
  Maximize2
} from 'lucide-react';
import { QADefectRecord, ExtendedProjectSettings } from '../types/admin';
import { fetchQADefectsForSubgrid, resolveQADefectInSupabase, resolvePanoramaUrl } from '../services/supabase';

interface DefectsGalleryModalProps {
  isOpen: boolean;
  subgrid: string;
  projectSettings?: ExtendedProjectSettings;
  activeUserName?: string;
  onClose: () => void;
  onJumpTo360: (target: {
    pointId: string;
    imageUrl: string;
    lat?: number;
    lng?: number;
    bearing?: number;
  }) => void;
  onDefectResolved?: (pointId: string, remainingActiveCount: number) => void;
}

type DefectFilterCategory = 'all' | 'blur' | 'obstruction' | 'gps';

export const DefectsGalleryModal: React.FC<DefectsGalleryModalProps> = ({
  isOpen,
  subgrid,
  projectSettings,
  activeUserName = 'Operator',
  onClose,
  onJumpTo360,
  onDefectResolved
}) => {
  const [defects, setDefects] = useState<QADefectRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterCategory, setFilterCategory] = useState<DefectFilterCategory>('all');
  const [showResolved, setShowResolved] = useState<boolean>(false);
  const [resolvingPointId, setResolvingPointId] = useState<string | null>(null);
  const [lightboxDefect, setLightboxDefect] = useState<QADefectRecord | null>(null);

  const cleanSubgrid = (subgrid || '').toUpperCase().trim();

  // Load defects from Supabase on modal open or subgrid change
  useEffect(() => {
    if (!isOpen || !cleanSubgrid) return;

    let isMounted = true;
    setIsLoading(true);

    fetchQADefectsForSubgrid(cleanSubgrid).then((data) => {
      if (isMounted) {
        setDefects(data);
        setIsLoading(false);
      }
    }).catch(() => {
      if (isMounted) setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, cleanSubgrid]);

  // Filtered defects calculation
  const filteredDefects = useMemo(() => {
    return defects.filter(d => {
      if (!showResolved && d.is_resolved) return false;
      if (filterCategory === 'all') return true;
      if (filterCategory === 'blur') return Boolean(d.defect_flags?.blur || d.defect_type.toLowerCase().includes('blur'));
      if (filterCategory === 'obstruction') return Boolean(d.defect_flags?.obstruction || d.defect_type.toLowerCase().includes('obstruction') || d.defect_type.toLowerCase().includes('flare'));
      if (filterCategory === 'gps') return Boolean(d.defect_flags?.badGps || d.defect_type.toLowerCase().includes('gps'));
      return true;
    });
  }, [defects, filterCategory, showResolved]);

  // Statistics
  const activeCount = useMemo(() => defects.filter(d => !d.is_resolved).length, [defects]);
  const resolvedCount = useMemo(() => defects.filter(d => d.is_resolved).length, [defects]);
  const blurCount = useMemo(() => defects.filter(d => !d.is_resolved && (d.defect_flags?.blur || d.defect_type.toLowerCase().includes('blur'))).length, [defects]);
  const obstructionCount = useMemo(() => defects.filter(d => !d.is_resolved && (d.defect_flags?.obstruction || d.defect_type.toLowerCase().includes('obstruction') || d.defect_type.toLowerCase().includes('flare'))).length, [defects]);
  const gpsCount = useMemo(() => defects.filter(d => !d.is_resolved && (d.defect_flags?.badGps || d.defect_type.toLowerCase().includes('gps'))).length, [defects]);

  // Handle resolving/dismissing a defect
  const handleResolveDefect = async (defect: QADefectRecord) => {
    if (!defect.point_id || resolvingPointId) return;

    setResolvingPointId(defect.point_id);
    const success = await resolveQADefectInSupabase(cleanSubgrid, defect.point_id, activeUserName);

    if (success) {
      const nowStr = new Date().toISOString();
      const updated = defects.map(d => d.point_id === defect.point_id ? { ...d, is_resolved: true, resolved_at: nowStr } : d);
      setDefects(updated);

      const remainingActive = updated.filter(d => !d.is_resolved).length;
      if (onDefectResolved) {
        onDefectResolved(defect.point_id, remainingActive);
      }
    }
    setResolvingPointId(null);
  };

  // Handle Jump to 360 View
  const handleJump = (defect: QADefectRecord) => {
    const ptId = defect.point_id;
    const imgUrl = defect.image_url || resolvePanoramaUrl(ptId, projectSettings);
    onJumpTo360({
      pointId: ptId,
      imageUrl: imgUrl,
      lat: defect.lat,
      lng: defect.lng,
      bearing: defect.bearing
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl h-[88vh] bg-card border border-[rgba(255,255,255,0.12)] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-text-base">
        
        {/* HEADER BAR */}
        <div className="px-6 py-4 border-b border-[rgba(255,255,255,0.08)] bg-app flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
              <AlertTriangle size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-white">QA/QC Defect Review Gallery</h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                  {cleanSubgrid}
                </span>
                {activeCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
                    {activeCount} Active {activeCount === 1 ? 'Anomaly' : 'Anomalies'}
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted">
                Audit anomalies detected during automated blur, lens obstruction, and GPS trajectory analysis.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 hover:bg-inner rounded-xl text-text-muted hover:text-white transition-colors cursor-pointer"
            aria-label="Close Defect Gallery Modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* CONTROLS & FILTER CHIPS */}
        <div className="px-6 py-3 border-b border-[rgba(255,255,255,0.06)] bg-card/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-text-muted flex items-center gap-1.5 mr-1">
              <Filter size={13} />
              Filter:
            </span>
            <button
              onClick={() => setFilterCategory('all')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                filterCategory === 'all'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold'
                  : 'bg-inner hover:bg-slate-800 text-slate-400 border border-subtle'
              }`}
            >
              All ({defects.length})
            </button>
            <button
              onClick={() => setFilterCategory('blur')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                filterCategory === 'blur'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                  : 'bg-inner hover:bg-slate-800 text-slate-400 border border-subtle'
              }`}
            >
              <Camera size={12} />
              Blurry ({blurCount})
            </button>
            <button
              onClick={() => setFilterCategory('obstruction')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                filterCategory === 'obstruction'
                  ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40 font-semibold'
                  : 'bg-inner hover:bg-slate-800 text-slate-400 border border-subtle'
              }`}
            >
              <Sun size={12} />
              Obstruction / Glare ({obstructionCount})
            </button>
            <button
              onClick={() => setFilterCategory('gps')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                filterCategory === 'gps'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 font-semibold'
                  : 'bg-inner hover:bg-slate-800 text-slate-400 border border-subtle'
              }`}
            >
              <Navigation size={12} />
              GPS Jump ({gpsCount})
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-text-muted cursor-pointer hover:text-white transition-colors">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="rounded bg-app border-subtle text-sky-500 focus:ring-0 cursor-pointer"
            />
            <span>Show Resolved ({resolvedCount})</span>
          </label>
        </div>

        {/* DEFECT CARDS GRID BODY */}
        <div className="flex-1 p-6 overflow-y-auto min-h-0 bg-app/50">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted">
              <Loader2 size={32} className="animate-spin text-sky-400" />
              <span className="text-sm font-semibold text-text-base">Loading QA/QC defects for {cleanSubgrid}...</span>
            </div>
          ) : filteredDefects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-1">
                <ShieldCheck size={28} />
              </div>
              <h3 className="text-base font-bold text-white">No Defects Found in this View</h3>
              <p className="text-xs text-text-muted max-w-md">
                {defects.length === 0
                  ? `Subgrid ${cleanSubgrid} has 0 recorded defects or has passed automated inspection clean.`
                  : 'All recorded anomalies for this filter category have been resolved or filtered out.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDefects.map((defect) => {
                const ptId = defect.point_id;
                const imgUrl = defect.image_url || resolvePanoramaUrl(ptId, projectSettings);
                const isResolved = Boolean(defect.is_resolved);
                const flags = defect.defect_flags || {};

                return (
                  <div
                    key={defect.id || `${defect.subgrid}-${defect.point_id}`}
                    className={`bg-card border rounded-xl overflow-hidden shadow-md flex flex-col justify-between transition-all duration-200 hover:border-slate-500/60 ${
                      isResolved
                        ? 'border-emerald-500/30 opacity-75 bg-card/60'
                        : 'border-[rgba(255,255,255,0.1)] hover:shadow-lg'
                    }`}
                  >
                    {/* CARD TOP: THUMBNAIL & CROP PREVIEW */}
                    <div className="relative aspect-[16/9] w-full bg-black overflow-hidden group">
                      <img
                        src={imgUrl}
                        alt={`Defect ${ptId}`}
                        crossOrigin="anonymous"
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />

                      {/* Station Badge Overlay */}
                      <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-black/75 backdrop-blur-md text-white border border-white/10 shadow">
                          #{defect.frame_index || 1}
                        </span>
                        {isResolved ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/80 text-white backdrop-blur-md flex items-center gap-1 shadow">
                            <CheckCircle size={10} />
                            Resolved
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/85 text-black backdrop-blur-md flex items-center gap-1 shadow">
                            <AlertTriangle size={10} />
                            Flagged
                          </span>
                        )}
                      </div>

                      {/* Zoom Lightbox Trigger */}
                      <button
                        onClick={() => setLightboxDefect(defect)}
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-black/70 hover:bg-black/90 text-white backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow"
                        title="View Full Resolution Image"
                      >
                        <Maximize2 size={12} />
                      </button>

                      {/* Bottom Overlay Info */}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2.5 pt-6 flex items-center justify-between text-[11px] text-slate-300">
                        <span className="font-mono truncate font-semibold text-white">{ptId}</span>
                        {defect.bearing !== undefined && (
                          <span className="text-[10px] text-slate-300 font-mono shrink-0">
                            {Number(defect.bearing).toFixed(0)}°
                          </span>
                        )}
                      </div>
                    </div>

                    {/* CARD BODY: DEFECT REASONS & TELEMETRY */}
                    <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                      <div>
                        {/* Defect Category Pills */}
                        <div className="flex flex-wrap gap-1.5 mb-2.5">
                          {flags.blur && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                              <Camera size={10} />
                              Blurry {flags.blurVariance !== undefined ? `(Var ${Number(flags.blurVariance).toFixed(1)})` : ''}
                            </span>
                          )}
                          {flags.obstruction && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-300 border border-orange-500/30 flex items-center gap-1">
                              <Sun size={10} />
                              Obstruction {flags.avgBrightness !== undefined ? `(Luma ${Number(flags.avgBrightness).toFixed(1)})` : ''}
                            </span>
                          )}
                          {flags.badGps && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                              <Navigation size={10} />
                              GPS Drift {flags.stepDistanceMeters !== undefined ? `(${Number(flags.stepDistanceMeters).toFixed(1)}m)` : ''}
                            </span>
                          )}
                          {!flags.blur && !flags.obstruction && !flags.badGps && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              {defect.defect_type || 'QA Anomaly'}
                            </span>
                          )}
                        </div>

                        {/* Telemetry metadata */}
                        <div className="space-y-1 text-[11px] text-text-muted">
                          <div className="flex items-center gap-1.5 truncate">
                            <MapPin size={11} className="text-sky-400 shrink-0" />
                            {defect.lat && defect.lng ? (
                              <span className="font-mono">
                                {Number(defect.lat).toFixed(5)}° N, {Number(defect.lng).toFixed(5)}° E
                              </span>
                            ) : (
                              <span className="italic text-slate-500">No GPS Coordinates</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="flex items-center gap-1">
                              <User size={10} className="text-slate-500" />
                              {defect.pic || 'Inspector'}
                            </span>
                            {defect.created_at && (
                              <span className="flex items-center gap-1 text-slate-500 font-mono">
                                <Clock size={10} />
                                {new Date(defect.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* CARD ACTIONS */}
                      <div className="pt-2 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between gap-2">
                        <button
                          onClick={() => handleJump(defect)}
                          className="flex-1 py-1.5 px-2 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/30 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          title="Jump to 360 Panorama Viewer"
                        >
                          <Eye size={13} />
                          <span>Jump to 360</span>
                        </button>

                        {!isResolved ? (
                          <button
                            onClick={() => handleResolveDefect(defect)}
                            disabled={resolvingPointId === defect.point_id}
                            className="py-1.5 px-2.5 bg-inner hover:bg-emerald-500/20 hover:text-emerald-300 text-slate-400 hover:border-emerald-500/40 border border-subtle rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                            title="Mark Defect as Resolved / Dismissed"
                          >
                            {resolvingPointId === defect.point_id ? (
                              <Loader2 size={13} className="animate-spin text-emerald-400" />
                            ) : (
                              <ShieldCheck size={13} />
                            )}
                            <span>Dismiss</span>
                          </button>
                        ) : (
                          <div className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1 px-2 py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                            <CheckCircle size={12} />
                            <span>Resolved</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* FOOTER SUMMARY */}
        <div className="px-6 py-3 border-t border-[rgba(255,255,255,0.08)] bg-app flex items-center justify-between text-xs text-text-muted shrink-0">
          <div>
            Showing <span className="font-semibold text-white">{filteredDefects.length}</span> of{' '}
            <span className="font-semibold text-white">{defects.length}</span> total defect records
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-inner hover:bg-slate-700 text-white rounded-lg text-xs font-semibold border border-subtle transition-colors cursor-pointer"
          >
            Close Gallery
          </button>
        </div>

        {/* LIGHTBOX PREVIEW MODAL */}
        {lightboxDefect && (
          <div
            onClick={() => setLightboxDefect(null)}
            className="fixed inset-0 z-60 bg-black/95 flex flex-col items-center justify-center p-6 animate-in fade-in duration-150"
          >
            <div className="relative max-w-4xl max-h-[85vh] w-full flex flex-col items-center">
              <button
                onClick={() => setLightboxDefect(null)}
                className="absolute -top-10 right-0 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
              <img
                src={lightboxDefect.image_url || resolvePanoramaUrl(lightboxDefect.point_id, projectSettings)}
                alt={lightboxDefect.point_id}
                crossOrigin="anonymous"
                className="max-w-full max-h-[75vh] object-contain rounded-xl border border-white/20 shadow-2xl"
              />
              <div className="mt-3 text-center">
                <div className="text-sm font-bold text-white font-mono">{lightboxDefect.point_id}</div>
                <div className="text-xs text-slate-400 mt-0.5">{lightboxDefect.defect_type}</div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default DefectsGalleryModal;
