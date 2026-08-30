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
  Maximize2,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  RotateCcw
} from 'lucide-react';
import { QADefectRecord, ExtendedProjectSettings } from '../types/admin';
import { fetchQADefectsForSubgrid, resolveQADefectInSupabase, resolvePanoramaUrl } from '../services/supabase';

interface DefectsGalleryModalProps {
  isOpen: boolean;
  subgrid: string;
  mode?: 'master' | 'daily';
  surveyDate?: string;
  batchFilenames?: string[];
  totalPoi?: number;
  projectSettings?: ExtendedProjectSettings;
  activeUserName?: string;
  fallbackDefects?: any[];
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
  mode = 'master',
  surveyDate,
  batchFilenames,
  totalPoi,
  projectSettings,
  activeUserName = 'Operator',
  fallbackDefects,
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
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);

  const cleanSubgrid = (subgrid || '').toUpperCase().trim();

  // Load defects from Supabase on modal open or subgrid change
  useEffect(() => {
    if (!isOpen || !cleanSubgrid) return;

    setFilterCategory('all');
    let isMounted = true;
    setIsLoading(true);

    fetchQADefectsForSubgrid(cleanSubgrid).then((data) => {
      if (isMounted) {
        if (data && data.length > 0) {
          setDefects(data);
        } else if (Array.isArray(fallbackDefects) && fallbackDefects.length > 0) {
          const relevant = fallbackDefects
            .filter((d: any) => (d.subgrid || '').toUpperCase().trim() === cleanSubgrid)
            .map((d: any, idx: number) => ({
              id: d.id || `fb-${idx}`,
              subgrid: d.subgrid || cleanSubgrid,
              point_id: d.point_id || d.filename || `${cleanSubgrid}-${String(idx + 1).padStart(4, '0')}.jpg`,
              frame_index: d.frame_index || (idx + 1),
              defect_flags: typeof d.defect_flags === 'object' ? d.defect_flags : { blur: true },
              defect_type: d.defect_type || 'QA Defect',
              pic: d.pic || 'Inspector',
              image_url: d.image_url,
              lat: d.lat ?? d.latitude,
              lng: d.lng ?? d.lon ?? d.longitude,
              bearing: d.bearing,
              is_resolved: Boolean(d.is_resolved),
              resolved_at: d.resolved_at,
              created_at: d.created_at || new Date().toISOString()
            }));
          setDefects(relevant);
        } else {
          setDefects([]);
        }
        setIsLoading(false);
      }
    }).catch(() => {
      if (isMounted) {
        if (Array.isArray(fallbackDefects) && fallbackDefects.length > 0) {
          const relevant = fallbackDefects
            .filter((d: any) => (d.subgrid || '').toUpperCase().trim() === cleanSubgrid)
            .map((d: any, idx: number) => ({
              id: d.id || `fb-${idx}`,
              subgrid: d.subgrid || cleanSubgrid,
              point_id: d.point_id || d.filename || `${cleanSubgrid}-${String(idx + 1).padStart(4, '0')}.jpg`,
              frame_index: d.frame_index || (idx + 1),
              defect_flags: typeof d.defect_flags === 'object' ? d.defect_flags : { blur: true },
              defect_type: d.defect_type || 'QA Defect',
              pic: d.pic || 'Inspector',
              image_url: d.image_url,
              lat: d.lat ?? d.latitude,
              lng: d.lng ?? d.lon ?? d.longitude,
              bearing: d.bearing,
              is_resolved: Boolean(d.is_resolved),
              resolved_at: d.resolved_at,
              created_at: d.created_at || new Date().toISOString()
            }));
          setDefects(relevant);
        } else {
          setDefects([]);
        }
        setIsLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen, cleanSubgrid, fallbackDefects]);

  // Contextual defect list: scoped to daily batch if in daily mode, or full subgrid if in master mode
  const displayDefects = useMemo(() => {
    if (mode === 'daily' && batchFilenames && batchFilenames.length > 0) {
      const allowedSet = new Set(batchFilenames.map(f => (f || '').split('/').pop()?.toLowerCase().trim()));
      return defects.filter(d => {
        const pid = (d.point_id || '').split('/').pop()?.toLowerCase().trim();
        return pid && allowedSet.has(pid);
      });
    }
    return defects;
  }, [defects, mode, batchFilenames]);

  // Filtered defects calculation
  const filteredDefects = useMemo(() => {
    return displayDefects.filter(d => {
      if (!showResolved && d.is_resolved) return false;
      if (filterCategory === 'all') return true;
      if (filterCategory === 'blur') return Boolean(d.defect_flags?.blur || d.defect_type?.toLowerCase().includes('blur'));
      if (filterCategory === 'obstruction') return Boolean(d.defect_flags?.obstruction || d.defect_type?.toLowerCase().includes('obstruction') || d.defect_type?.toLowerCase().includes('flare'));
      if (filterCategory === 'gps') return Boolean(d.defect_flags?.badGps || d.defect_type?.toLowerCase().includes('gps'));
      return true;
    });
  }, [displayDefects, filterCategory, showResolved]);

  // Statistics
  const activeCount = useMemo(() => displayDefects.filter(d => !d.is_resolved).length, [displayDefects]);
  const resolvedCount = useMemo(() => displayDefects.filter(d => d.is_resolved).length, [displayDefects]);
  const blurCount = useMemo(() => displayDefects.filter(d => !d.is_resolved && (d.defect_flags?.blur || d.defect_type?.toLowerCase().includes('blur'))).length, [displayDefects]);
  const obstructionCount = useMemo(() => displayDefects.filter(d => !d.is_resolved && (d.defect_flags?.obstruction || d.defect_type?.toLowerCase().includes('obstruction') || d.defect_type?.toLowerCase().includes('flare'))).length, [displayDefects]);
  const gpsCount = useMemo(() => displayDefects.filter(d => !d.is_resolved && (d.defect_flags?.badGps || d.defect_type?.toLowerCase().includes('gps'))).length, [displayDefects]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl h-[94vh] sm:h-[88vh] bg-card border border-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden text-text-base">
        
        {/* HEADER BAR */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-subtle bg-inner flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-inner/80 border border-subtle flex items-center justify-center text-text-base shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-semibold tracking-tight text-text-base truncate">
                  {mode === 'daily' ? 'Daily Batch Acquisition QC Review' : 'Masterlist Acquisition QC Review'}
                </h2>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-sans font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30 shrink-0">
                  {cleanSubgrid}
                </span>
                {mode === 'daily' ? (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0">
                    Daily {surveyDate ? `• ${surveyDate}` : ''}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-sans font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
                    Master Subgrid
                  </span>
                )}
                {totalPoi !== undefined && totalPoi > 0 && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-sans bg-inner text-text-base border border-subtle shrink-0">
                    {totalPoi} POI
                  </span>
                )}
                {activeCount > 0 ? (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 shrink-0">
                    {activeCount} Flagged
                    {totalPoi && totalPoi > 0 ? ` (${Math.round((activeCount / totalPoi) * 100)}%)` : ''}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                    0 Defects
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-muted truncate hidden xs:block mt-0.5">
                {mode === 'daily'
                  ? `Reviewing anomalies specifically for daily survey run ${surveyDate || cleanSubgrid}.`
                  : `Reviewing cumulative anomalies across all survey runs for subgrid ${cleanSubgrid}.`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-inner rounded-lg text-text-muted hover:text-text-base transition-colors cursor-pointer shrink-0"
            aria-label="Close Defect Gallery Modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* CONTROLS & FILTER CHIPS */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-subtle bg-inner flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full sm:w-auto pb-1 sm:pb-0">
            <span className="text-xs font-medium text-text-muted flex items-center gap-1 mr-1 shrink-0">
              <Filter size={12} />
              Filter:
            </span>
            <button
              onClick={() => setFilterCategory('all')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                filterCategory === 'all'
                  ? 'bg-inner text-text-base border border-subtle shadow-sm'
                  : 'bg-app/60 hover:bg-inner text-text-muted border border-subtle'
              }`}
            >
              All ({displayDefects.length})
            </button>
            <button
              onClick={() => setFilterCategory('blur')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                filterCategory === 'blur'
                  ? 'bg-inner text-text-base border border-subtle shadow-sm'
                  : 'bg-app/60 hover:bg-inner text-text-muted border border-subtle'
              }`}
            >
              <Camera size={12} />
              Blurry ({blurCount})
            </button>
            <button
              onClick={() => setFilterCategory('obstruction')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                filterCategory === 'obstruction'
                  ? 'bg-inner text-text-base border border-subtle shadow-sm'
                  : 'bg-app/60 hover:bg-inner text-text-muted border border-subtle'
              }`}
            >
              <Sun size={12} />
              Obstruction ({obstructionCount})
            </button>
            <button
              onClick={() => setFilterCategory('gps')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                filterCategory === 'gps'
                  ? 'bg-inner text-text-base border border-subtle shadow-sm'
                  : 'bg-app/60 hover:bg-inner text-text-muted border border-subtle'
              }`}
            >
              <Navigation size={12} />
              GPS ({gpsCount})
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-text-muted cursor-pointer hover:text-text-base transition-colors shrink-0">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="rounded bg-inner border-subtle text-text-muted focus:ring-0 cursor-pointer"
            />
            <span>Show Resolved ({resolvedCount})</span>
          </label>
        </div>

        {/* DEFECT CARDS GRID BODY */}
        <div className="flex-1 p-4 sm:p-6 overflow-y-auto min-h-0 bg-inner/60">
          {isLoading ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-text-muted">
              <Loader2 size={28} className="animate-spin text-text-muted" />
              <span className="text-xs font-medium text-text-base">Loading defects for {cleanSubgrid}...</span>
            </div>
          ) : filteredDefects.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8">
              <div className="w-12 h-12 rounded-xl bg-inner/80 border border-subtle flex items-center justify-center text-text-muted mb-1">
                <ShieldCheck size={24} />
              </div>
              <h3 className="text-sm font-semibold text-text-base">No Defects Found in this View</h3>
              <p className="text-xs text-text-muted max-w-md">
                {displayDefects.length === 0
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
                    className={`bg-card border rounded-xl overflow-hidden shadow-sm flex flex-col justify-between transition-all duration-200 hover:border-subtle ${
                      isResolved
                        ? 'border-subtle/60 opacity-60'
                        : 'border-subtle'
                    }`}
                  >
                    {/* CARD TOP: THUMBNAIL & CROP PREVIEW */}
                    <div 
                      onClick={() => setLightboxDefect(defect)}
                      className="relative aspect-[16/9] w-full bg-zinc-950 overflow-hidden group cursor-pointer"
                      title="Click to View Full Resolution Image"
                    >
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
                        <span className="px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-black/80 backdrop-blur-md text-slate-100 border border-white/10 shadow">
                          #{defect.frame_index || 1}
                        </span>
                        {isResolved ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/80 text-emerald-300 backdrop-blur-md flex items-center gap-1 shadow border border-emerald-800/50">
                            <CheckCircle size={10} className="text-emerald-400" />
                            Resolved
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-950/80 text-rose-300 backdrop-blur-md flex items-center gap-1 shadow border border-rose-800/50">
                            <AlertTriangle size={10} className="text-rose-400" />
                            Defect
                          </span>
                        )}
                      </div>

                      {/* Zoom Lightbox Trigger */}
                      <div
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-black/70 group-hover:bg-black/90 text-slate-300 group-hover:text-white backdrop-blur-md transition-opacity shadow border border-white/10 flex items-center gap-1 text-[11px]"
                      >
                        <Maximize2 size={12} />
                        <span className="text-[10px] hidden sm:inline font-medium">View Full</span>
                      </div>

                      {/* Bottom Overlay Info */}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2.5 pt-6 flex items-center justify-between text-[11px] text-slate-300">
                        <span className="font-sans truncate font-medium text-slate-100">{ptId}</span>
                        {defect.bearing !== undefined && (
                          <span className="text-[10px] text-slate-400 font-sans shrink-0">
                            {Number(defect.bearing).toFixed(0)}°
                          </span>
                        )}
                      </div>
                    </div>

                    {/* CARD BODY: DEFECT REASONS & TELEMETRY */}
                    <div className="p-3 flex-1 flex flex-col justify-between gap-2.5">
                      <div>
                        {/* Defect Category Pills */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {flags.blur && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-inner text-text-base border border-subtle flex items-center gap-1">
                              <Camera size={10} className="text-text-muted" />
                              Blurry {flags.blurVariance !== undefined ? `(${Number(flags.blurVariance).toFixed(1)})` : ''}
                            </span>
                          )}
                          {flags.obstruction && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-inner text-text-base border border-subtle flex items-center gap-1">
                              <Sun size={10} className="text-text-muted" />
                              Obstruction {flags.avgBrightness !== undefined ? `(${Number(flags.avgBrightness).toFixed(1)})` : ''}
                            </span>
                          )}
                          {flags.badGps && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-inner text-text-base border border-subtle flex items-center gap-1">
                              <Navigation size={10} className="text-text-muted" />
                              GPS Drift {flags.stepDistanceMeters !== undefined ? `(${Number(flags.stepDistanceMeters).toFixed(1)}m)` : ''}
                            </span>
                          )}
                          {!flags.blur && !flags.obstruction && !flags.badGps && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-inner text-text-base border border-subtle">
                              {defect.defect_type || 'QA Anomaly'}
                            </span>
                          )}
                        </div>

                        {/* Telemetry metadata */}
                        <div className="space-y-1 text-[11px] text-text-muted">
                          <div className="flex items-center gap-1.5 truncate">
                            <MapPin size={11} className="text-text-muted shrink-0" />
                            {defect.lat && defect.lng ? (
                              <span className="font-sans text-text-base">
                                {Number(defect.lat).toFixed(5)}°, {Number(defect.lng).toFixed(5)}°
                              </span>
                            ) : (
                              <span className="italic text-text-muted">No GPS Coordinates</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-text-muted">
                            <span className="flex items-center gap-1">
                              <User size={10} />
                              {defect.pic || 'Inspector'}
                            </span>
                            {defect.created_at && (
                              <span className="flex items-center gap-1 font-sans">
                                <Clock size={10} />
                                {new Date(defect.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* CARD ACTIONS */}
                      <div className="pt-2 border-t border-subtle/80 flex items-center justify-between gap-2">
                        <button
                          onClick={() => handleJump(defect)}
                          className="flex-1 py-1.5 px-2 bg-inner hover:bg-card text-text-base border border-subtle rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          title="Jump to 360 Panorama Viewer"
                        >
                          <Eye size={12} className="text-text-muted" />
                          <span>Jump to 360</span>
                        </button>

                        {!isResolved ? (
                          <button
                            onClick={() => handleResolveDefect(defect)}
                            disabled={resolvingPointId === defect.point_id}
                            className="py-1.5 px-2.5 bg-inner/60 hover:bg-inner text-text-muted hover:text-text-base border border-subtle/80 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                            title="Mark Defect as Resolved / Dismissed"
                          >
                            {resolvingPointId === defect.point_id ? (
                              <Loader2 size={12} className="animate-spin text-text-muted" />
                            ) : (
                              <ShieldCheck size={12} />
                            )}
                            <span>Dismiss</span>
                          </button>
                        ) : (
                          <div className="text-[11px] font-medium text-text-base flex items-center gap-1 px-2 py-1 bg-inner rounded-lg border border-subtle">
                            <CheckCircle size={11} className="text-text-muted" />
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
        <div className="px-6 py-3 border-t border-subtle bg-inner flex items-center justify-between text-xs text-text-muted shrink-0">
          <div>
            Showing <span className="font-semibold text-text-base">{filteredDefects.length}</span> of{' '}
            <span className="font-semibold text-text-base">{displayDefects.length}</span> total defect records
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-inner hover:bg-card text-text-base rounded-lg text-xs font-medium border border-subtle transition-colors cursor-pointer"
          >
            Close Gallery
          </button>
        </div>

      </div>

      {/* TRUE TOP-LEVEL FULLSCREEN HIGH-RES LIGHTBOX VIEWER */}
      {lightboxDefect && (() => {
        const ptId = lightboxDefect.point_id;
        const fullImgUrl = lightboxDefect.image_url || resolvePanoramaUrl(ptId, projectSettings);
        const flags = lightboxDefect.defect_flags || {};

        return (
          <div
            className="fixed inset-0 z-[100] bg-black flex flex-col justify-between p-3 sm:p-5 animate-in fade-in duration-150 select-none"
            onWheel={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const delta = e.deltaY < 0 ? 0.2 : -0.2;
              setLightboxZoom(prev => Math.min(5, Math.max(0.5, Math.round((prev + delta) * 100) / 100)));
            }}
          >
            {/* TOP LIGHTBOX BAR */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 shrink-0 bg-inner rounded-xl border border-subtle shadow-xl z-10">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="px-2 py-0.5 rounded text-xs font-sans font-bold bg-inner text-text-base border border-subtle">
                  #{lightboxDefect.frame_index || 1}
                </span>
                <span className="font-sans text-sm font-semibold text-text-base truncate">
                  {ptId}
                </span>
                <span className="px-2 py-0.5 rounded text-xs font-sans bg-inner text-text-muted border border-subtle hidden sm:inline">
                  {lightboxDefect.subgrid}
                </span>
                {lightboxDefect.is_resolved ? (
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <CheckCircle size={11} className="text-emerald-400" />
                    Resolved
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                    <AlertTriangle size={11} className="text-rose-400" />
                    {lightboxDefect.defect_type || 'Defect'}
                  </span>
                )}
              </div>

              {/* ZOOM & ACTION BUTTONS */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* Zoom Controls */}
                <div className="flex items-center bg-inner/90 rounded-lg border border-subtle p-0.5 mr-1">
                  <button
                    onClick={() => setLightboxZoom(prev => Math.max(0.5, Math.round((prev - 0.25) * 100) / 100))}
                    className="p-1 text-text-muted hover:text-white rounded hover:bg-card transition-colors cursor-pointer"
                    title="Zoom Out (or scroll down)"
                    disabled={lightboxZoom <= 0.5}
                  >
                    <ZoomOut size={13} />
                  </button>
                  <span className="px-1.5 text-[11px] font-sans text-text-base min-w-[42px] text-center">
                    {Math.round(lightboxZoom * 100)}%
                  </span>
                  <button
                    onClick={() => setLightboxZoom(prev => Math.min(5, Math.round((prev + 0.25) * 100) / 100))}
                    className="p-1 text-text-muted hover:text-white rounded hover:bg-card transition-colors cursor-pointer"
                    title="Zoom In (or scroll up)"
                    disabled={lightboxZoom >= 5}
                  >
                    <ZoomIn size={13} />
                  </button>
                  {lightboxZoom !== 1 && (
                    <button
                      onClick={() => setLightboxZoom(1)}
                      className="p-1 text-text-muted hover:text-white rounded hover:bg-card transition-colors cursor-pointer ml-0.5"
                      title="Reset Zoom (Fit)"
                    >
                      <RotateCcw size={12} />
                    </button>
                  )}
                </div>

                <a
                  href={fullImgUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-inner hover:bg-card text-text-base text-xs font-medium border border-subtle flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Open Full Image in New Tab"
                >
                  <ExternalLink size={13} />
                  <span className="hidden sm:inline">Open in Tab</span>
                </a>

                <button
                  onClick={() => {
                    handleJump(lightboxDefect);
                    setLightboxDefect(null);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-inner hover:bg-card text-text-base text-xs font-medium border border-subtle flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Jump to 360 Panorama Viewer"
                >
                  <Eye size={13} />
                  <span className="hidden sm:inline">Jump to 360</span>
                </button>

                <button
                  onClick={() => {
                    setLightboxDefect(null);
                    setLightboxZoom(1);
                  }}
                  className="p-1.5 rounded-lg bg-inner hover:bg-card text-text-base hover:text-white border border-subtle transition-colors cursor-pointer"
                  aria-label="Close Lightbox"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* IMAGE CONTAINER */}
            <div 
              onClick={() => {
                setLightboxDefect(null);
                setLightboxZoom(1);
              }}
              className="flex-1 w-full h-full flex items-center justify-center min-h-0 overflow-auto my-2 p-2 cursor-zoom-out"
            >
              <div 
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center max-w-full max-h-full transition-transform duration-150 ease-out cursor-default"
                style={{
                  transform: `scale(${lightboxZoom})`,
                  transformOrigin: 'center center'
                }}
              >
                <img
                  src={fullImgUrl}
                  alt={ptId}
                  crossOrigin="anonymous"
                  className="w-full max-w-[96vw] max-h-[75vh] object-contain rounded-xl border border-subtle/80 shadow-2xl select-none"
                  style={{
                    minWidth: lightboxZoom === 1 ? 'min(94vw, 1400px)' : 'auto'
                  }}
                />
              </div>
            </div>

            {/* BOTTOM TELEMETRY HUD */}
            <div className="px-4 py-2.5 bg-inner rounded-xl border border-subtle flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted shrink-0 shadow-xl z-10">
              <div className="flex items-center gap-4 flex-wrap">
                {flags.reasons && Array.isArray(flags.reasons) && flags.reasons.length > 0 ? (
                  <div className="flex items-center gap-1.5 text-text-base font-medium">
                    <AlertTriangle size={13} className="text-text-muted shrink-0" />
                    <span>{flags.reasons.join(' • ')}</span>
                  </div>
                ) : (
                  <span className="text-text-base">{lightboxDefect.defect_type || 'Flagged Anomaly'}</span>
                )}
                <span className="text-text-muted text-[11px] hidden md:inline">
                  (Scroll mouse wheel to zoom in/out)
                </span>
              </div>

              <div className="flex items-center gap-4 text-[11px] font-sans text-text-muted">
                {lightboxDefect.lat && lightboxDefect.lng && (
                  <span className="flex items-center gap-1 text-text-base">
                    <MapPin size={12} className="text-text-muted" />
                    {Number(lightboxDefect.lat).toFixed(6)}°, {Number(lightboxDefect.lng).toFixed(6)}°
                  </span>
                )}
                {lightboxDefect.bearing !== undefined && (
                  <span>Yaw: {Number(lightboxDefect.bearing).toFixed(0)}°</span>
                )}
                <span className="flex items-center gap-1 text-text-muted">
                  <User size={11} />
                  {lightboxDefect.pic || 'Inspector'}
                </span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default DefectsGalleryModal;
