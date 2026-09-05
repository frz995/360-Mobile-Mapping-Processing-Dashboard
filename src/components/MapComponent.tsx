import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Layers } from 'lucide-react';
import { extractSubgridName } from '../utils/subgrid';
import { getItemId } from '../utils/items';
import { STORAGE_BUCKET_DEFAULT, REGION_DEFAULTS, DEFAULT_BASEMAP } from '../config/defaults';
import type { Layer, Folder } from '../types/catalog';

export const MapComponent = ({
  dataManagement = false,
  refreshKey,
  selectedSubgridFilter,
  selectedDailyRunId,
  selectedDateFilter,
  stagedItems,
  projectSettings: passedSettings,
  defectsList,
  iframeRefCb,
  selectedSubgrids,
  selectedPoints,
  isAfterDeletionPreview = false
}: {
  dataManagement?: boolean;
  layerCatalog?: (Layer | Folder)[];
  refreshKey?: number;
  onManualRefresh?: () => void;
  selectedSubgridFilter?: string | null;
  selectedDailyRunId?: string | null;
  selectedDateFilter?: string | null;
  stagedItems?: any[];
  projectSettings?: any;
  defectsList?: any[];
  iframeRefCb?: (el: HTMLIFrameElement | null) => void;
  selectedSubgrids?: string[];
  selectedPoints?: any[];
  isAfterDeletionPreview?: boolean;
}) => {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const stagedDataRafRef = useRef<number | null>(null);

  const effectiveSettings = useMemo(() => {
    return (passedSettings && typeof passedSettings === 'object') ? passedSettings : {};
  }, [passedSettings, refreshKey]);

  const formattedStagedItems = useMemo(() => {
    if (!stagedItems || stagedItems.length === 0) return [];

    const knownDefectFilenames = new Set<string>();
    const selectedSgSet = new Set((selectedSubgrids || []).map((s) => (extractSubgridName(s) || s || '').toUpperCase().trim()));
    const selectedPtKeySet = new Set((selectedPoints || []).map((p: any) => {
      const fn = (p.filename || p.image_url || p.pointId || p.point_id || '').split('/').pop()?.toUpperCase().trim();
      const ptId = (p.pointId || p.point_id || '').toUpperCase().trim();
      const rawSg = (p.subgrid || '').toUpperCase().trim();
      return fn || ptId || `${rawSg}_${p.lat},${p.lng}`;
    }));

    if (Array.isArray(defectsList)) {
      defectsList.forEach((d: any) => {
        const fn = (d.point_id || d.filename || d.pointId || d.image_url || '').split('/').pop()?.toUpperCase().trim();
        const ptId = (d.point_id || d.pointId || '').toUpperCase().trim();
        if (fn) knownDefectFilenames.add(fn);
        if (ptId) knownDefectFilenames.add(ptId);
      });
    }

    return stagedItems.map((item, itemIdx) => {
      const rawSg = item.subgrid || item.imageFilename || '';
      const normSg = (extractSubgridName(rawSg) || rawSg || '').toUpperCase().trim();
      const isSubgridSelected = selectedSgSet.has(normSg);

      const isPub = item.publishToWebGIS === 'yes' || item.publishToUSVPRO === 'yes' || Boolean(item.isSyncedWithSupabase) || item.isFromSupabase === true;
      const statusVal = isSubgridSelected ? 'selected' : (isPub ? 'yes' : (item.publishToWebGIS || item.publishToUSVPRO || 'in process'));
      const op = isSubgridSelected ? 1.0 : (isPub ? 1.0 : 0.7);

      const itemRunId = item.runId || item.id || getItemId(item) || `batch-${itemIdx}`;
      const pans = item.panoramas || item.points || [];

      const formattedPans = pans.map((p: any, pIdx: number) => {
        const fnClean = (p.filename || p.image_url || '').split('/').pop()?.toUpperCase().trim();
        const ptClean = (p.point_id || p.pointId || '').toUpperCase().trim();
        const pRawSg = p.subgrid || item.subgrid || '';
        const pNormSg = (extractSubgridName(pRawSg) || pRawSg || '').toUpperCase().trim();
        const pLatLng = (typeof p.lat === 'number' && typeof p.lng === 'number') ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : '';

        const isPointInSelectedSet = Boolean(
          (fnClean && selectedPtKeySet.has(fnClean)) ||
          (ptClean && selectedPtKeySet.has(ptClean)) ||
          (pLatLng && (selectedPtKeySet.has(pLatLng) || selectedPtKeySet.has(`${pNormSg}_${pLatLng}`)))
        );
        const isPointSelected = selectedPtKeySet.size > 0 ? isPointInSelectedSet : (isSubgridSelected || selectedSgSet.has(pNormSg));

        const isPointDefect = Boolean(
          (fnClean && knownDefectFilenames.has(fnClean)) ||
          (ptClean && knownDefectFilenames.has(ptClean)) ||
          p.isDefect ||
          p.is_defect ||
          p.defectType ||
          p.status === 'defect' ||
          p.qa_status === 'defect' ||
          (p.defect_flags && typeof p.defect_flags === 'object' && Object.values(p.defect_flags).some(Boolean))
        );
        const pointColorHex = isAfterDeletionPreview
          ? (isPointSelected ? '#64748b' : (isPointDefect ? '#ef4444' : (isPub ? '#10b981' : '#f59e0b')))
          : (isPointSelected ? '#38bdf8' : (isPointDefect ? '#ef4444' : (isPub ? '#10b981' : '#f59e0b')));
        const pointStatusVal = isAfterDeletionPreview
          ? (isPointSelected ? 'purged' : (isPointDefect ? 'defect' : statusVal))
          : (isPointSelected ? 'selected' : (isPointDefect ? 'defect' : statusVal));
        const pointOp = isAfterDeletionPreview
          ? (isPointSelected ? 0.35 : (isPointDefect ? 1.0 : op))
          : (isPointSelected ? 1.0 : (isPointDefect ? 1.0 : op));

        return {
          ...p,
          id: p.id || `pt-${itemRunId}-${pIdx}`,
          runId: itemRunId,
          filename: p.filename || p.image_url,
          image_url: p.image_url || p.filename,
          subgrid: pNormSg || normSg || item.subgrid,
          grid: p.grid || item.grid,
          latitude: p.latitude ?? p.lat ?? p.y,
          longitude: p.longitude ?? p.lon ?? p.lng ?? p.x,
          lat: p.lat ?? p.latitude ?? p.y,
          lon: p.lon ?? p.longitude ?? p.lng ?? p.x,
          lng: p.lng ?? p.longitude ?? p.lon ?? p.x,
          y: p.y ?? p.latitude ?? p.lat,
          x: p.x ?? p.longitude ?? p.lon ?? p.lng,
          date: p.date ?? p.captured_at,
          captured_at: p.captured_at ?? p.date,
          status: pointStatusVal,
          qa_status: pointStatusVal,
          publishToWebGIS: isPointSelected ? (isAfterDeletionPreview ? 'purged' : 'selected') : statusVal,
          publishToUSVPRO: isPointSelected ? (isAfterDeletionPreview ? 'purged' : 'selected') : statusVal,
          isPublished: isPointSelected ? false : isPub,
          published: isPointSelected ? false : isPub,
          isSelected: isPointSelected,
          selected: isPointSelected,
          is_selected: isPointSelected,
          is_defect: isPointDefect,
          isDefect: isPointDefect,
          opacity: pointOp,
          fillOpacity: pointOp,
          strokeOpacity: pointOp,
          color: pointColorHex,
          statusColor: pointColorHex,
          strokeColor: pointColorHex,
          fillColor: pointColorHex,
          trackColor: pointColorHex,
          lineColor: pointColorHex,
          highlightColor: pointColorHex
        };
      });

      const hasAnySelectedPoint = formattedPans.some((p: any) => p.isSelected);
      const isSubgridFullyOrPartiallySelected = isSubgridSelected || hasAnySelectedPoint;
      const colorHex = isAfterDeletionPreview
        ? (isSubgridFullyOrPartiallySelected
            ? '#64748b' // Grayed out for purged panotrack in After Deletion Preview
            : (isPub ? '#10b981' : (statusVal === 'need to recheck' || statusVal === 'no' ? '#ef4444' : '#f59e0b')))
        : (isSubgridFullyOrPartiallySelected
            ? '#38bdf8' // Light Blue for selected panotrack
            : (isPub ? '#10b981' : (statusVal === 'need to recheck' || statusVal === 'no' ? '#ef4444' : '#f59e0b')));

      const itemOp = isAfterDeletionPreview && isSubgridFullyOrPartiallySelected ? 0.35 : op;

      return {
        ...item,
        id: itemRunId,
        runId: itemRunId,
        subgrid: normSg || item.subgrid,
        grid: item.grid,
        status: isAfterDeletionPreview && isSubgridFullyOrPartiallySelected ? 'purged' : statusVal,
        qa_status: isAfterDeletionPreview && isSubgridFullyOrPartiallySelected ? 'purged' : statusVal,
        publishToWebGIS: isSubgridSelected ? (isAfterDeletionPreview ? 'purged' : 'selected') : statusVal,
        publishToUSVPRO: isSubgridSelected ? (isAfterDeletionPreview ? 'purged' : 'selected') : statusVal,
        isPublished: isSubgridSelected ? false : isPub,
        published: isSubgridSelected ? false : isPub,
        isSelected: isSubgridFullyOrPartiallySelected,
        selected: isSubgridFullyOrPartiallySelected,
        is_selected: isSubgridFullyOrPartiallySelected,
        opacity: itemOp,
        fillOpacity: itemOp,
        strokeOpacity: itemOp,
        color: colorHex,
        statusColor: colorHex,
        strokeColor: colorHex,
        fillColor: colorHex,
        trackColor: colorHex,
        lineColor: colorHex,
        highlightColor: colorHex,
        panoramas: formattedPans,
        points: formattedPans
      };
    });
  }, [stagedItems, defectsList, selectedSubgrids, selectedPoints, isAfterDeletionPreview]);

  const sendStagedDataImmediate = useCallback(() => {
    if (iframeRef.current && iframeRef.current.contentWindow && formattedStagedItems.length > 0) {
      try {
        const isSingle = Boolean(selectedDailyRunId);
        const allPoints = formattedStagedItems.flatMap(it => it.panoramas || it.points || []);
        const viewMode = selectedDailyRunId ? 'SINGLE_RUN' : (selectedSubgridFilter ? 'SUBGRID' : 'ALL');

        // 0. Send Unified SET_MAP_VIEW_STATE
        iframeRef.current.contentWindow.postMessage({
          type: 'SET_MAP_VIEW_STATE',
          viewMode,
          subgrid: selectedSubgridFilter || '',
          runId: selectedDailyRunId || null,
          date: selectedDateFilter || null,
          points: allPoints
        }, '*');

        // 1. Send SET_STAGED_DATA
        iframeRef.current.contentWindow.postMessage({
          type: 'SET_STAGED_DATA',
          isStagingPreview: Boolean(dataManagement),
          stagedItems: formattedStagedItems,
          isSingleRun: isSingle,
          runId: selectedDailyRunId || null
        }, '*');

        // 2. Send explicit selection messages for WebGIS viewer layers
        if (selectedSubgrids && selectedSubgrids.length > 0) {
          const highlightHex = isAfterDeletionPreview ? '#64748b' : '#38bdf8';
          iframeRef.current.contentWindow.postMessage({
            type: 'SET_SELECTED_SUBGRIDS',
            subgrids: selectedSubgrids,
            selectedSubgrids: selectedSubgrids,
            color: highlightHex
          }, '*');
          iframeRef.current.contentWindow.postMessage({
            type: 'HIGHLIGHT_SUBGRID',
            subgrid: selectedSubgrids[0],
            subgrids: selectedSubgrids,
            color: highlightHex
          }, '*');
        }

        // 3. Send FILTER_STATUS_TYPES to ensure stitching/in-progress trajectory filter is active
        iframeRef.current.contentWindow.postMessage({
          type: 'FILTER_STATUS_TYPES',
          statusFilters: { published: true, defect: true, stitching: true, selected: true },
          showPanotrackData: true
        }, '*');

        // 4. Send QAQC_DEFECTS_SYNC with all known defect items
        const defectsArray: any[] = [];
        if (Array.isArray(defectsList)) {
          defectsArray.push(...defectsList);
        }
        if (defectsArray.length > 0) {
          iframeRef.current.contentWindow.postMessage({
            type: 'QAQC_DEFECTS_SYNC',
            defects: defectsArray
          }, '*');
        }
      } catch (e) { }
    }
  }, [formattedStagedItems, dataManagement, defectsList, selectedDailyRunId, selectedSubgridFilter, selectedSubgrids, isAfterDeletionPreview, selectedDateFilter]);

  // Debounced wrapper using requestAnimationFrame to coalesce bursts and avoid locking the main thread
  const sendStagedData = useCallback(() => {
    if (stagedDataRafRef.current != null) {
      cancelAnimationFrame(stagedDataRafRef.current);
    }
    stagedDataRafRef.current = requestAnimationFrame(() => {
      stagedDataRafRef.current = null;
      sendStagedDataImmediate();
    });
  }, [sendStagedDataImmediate]);

  useEffect(() => {
    return () => {
      if (stagedDataRafRef.current != null) {
        cancelAnimationFrame(stagedDataRafRef.current);
      }
    };
  }, []);

  const syncMapSettings = useCallback(() => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    try {
      const s = effectiveSettings || {};
      // 1. Send Basemap
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_BASEMAP',
        basemap: s.defaultBasemap || DEFAULT_BASEMAP,
        customUrl: s.customBasemapUrl || '',
        opacity: (s.basemapOpacity ?? 100) / 100
      }, '*');

      // 2. Send Map Vector Layer Theme & Styling
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_MAP_THEME',
        settings: {
          publishedTrackColor: s.publishedTrackColor || '#10B981',
          stagingTrackColor: s.stagingTrackColor || '#F59E0B',
          defectTrackColor: s.defectTrackColor || '#EF4444',
          selectedTrackColor: s.selectedTrackColor || '#38BDF8',
          gridBoundaryColor: s.gridBoundaryColor || '#6366F1',
          lineWidth: s.poiTrackLineWidth || 3,
          enableGlow: s.enableLayerGlow !== false,
          opacity: (s.layerOpacity ?? 100) / 100,
          layerOpacity: (s.layerOpacity ?? 100) / 100
        }
      }, '*');

      // 3. Send Project Geographic Boundary (shape + focus/dim outside)
      const boundary = s.projectBoundary;
      if (boundary?.geojson || boundary?.bbox) {
        iframeRef.current.contentWindow.postMessage({
          type: 'SET_PROJECT_BOUNDARY',
          geojson: boundary.geojson,
          bbox: boundary.bbox
        }, '*');
        if (boundary.focusActive) {
          iframeRef.current.contentWindow.postMessage({
            type: 'FOCUS_BOUNDARY',
            bbox: boundary.bbox
          }, '*');
          iframeRef.current.contentWindow.postMessage({ type: 'DIM_OUTSIDE_BOUNDARY', enabled: true }, '*');
        } else {
          iframeRef.current.contentWindow.postMessage({ type: 'DIM_OUTSIDE_BOUNDARY', enabled: false }, '*');
        }
      } else {
        iframeRef.current.contentWindow.postMessage({ type: 'DIM_OUTSIDE_BOUNDARY', enabled: false }, '*');
        iframeRef.current.contentWindow.postMessage({ type: 'CLEAR_BOUNDARY_FOCUS' }, '*');
      }

      // 4. Send Storage / Dynamic Bucket Resolution Config so the WebGIS can resolve its own
      //    360 image URLs (single equirectangular OR multi-res tiles) against the active bucket.
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_STORAGE_CONFIG',
        storage: {
          storageProvider: s.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || '',
          imageStorageStrategy: s.imageStorageStrategy || 'single_equirectangular',
          panoramaMode: s.panoramaMode || '',
          multiResEnabled: s.imageStorageStrategy !== 'single_equirectangular',
          supabaseUrl: s.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || '',
          supabaseBucket: s.supabaseBucket || STORAGE_BUCKET_DEFAULT,
          r2Domain: s.r2Domain || '',
          r2PublicDomain: s.r2PublicDomain || '',
          r2PublicUrl: s.r2PublicUrl || '',
          customCdnUrl: s.customCdnUrl || '',
          cloudStorageBaseUrl: s.cloudStorageBaseUrl || '',
          customStorageUrl: s.customStorageUrl || '',
          singleImagePathPattern: s.singleImagePathPattern || s.imageFormatPattern || '',
          imageFormatPattern: s.imageFormatPattern || '',
          multiResTilePattern: s.multiResTilePattern || s.tilePathPattern || '',
          tilePathPattern: s.tilePathPattern || '',
          multiResFallbackPattern: s.multiResFallbackPattern || '',
          s3Bucket: s.s3Bucket || '',
          s3Region: s.s3Region || REGION_DEFAULTS.s3Region,
          gcsBucket: s.gcsBucket || '',
          azureAccount: s.azureAccount || '',
          azureContainer: s.azureContainer || '',
          wasabiBucket: s.wasabiBucket || '',
          wasabiRegion: s.wasabiRegion || REGION_DEFAULTS.wasabiRegion,
          nasServerUrl: s.nasServerUrl || ''
        }
      }, '*');
    } catch (e) { }
  }, [effectiveSettings]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // Security: only accept messages from the configured WebGIS iframe origin or same origin
      const allowedOrigin = (import.meta.env.VITE_MAP_URL || '').replace(/\/+$/, '');
      if (allowedOrigin && e.origin !== allowedOrigin && e.origin !== window.location.origin) {
        return;
      }
      if (e.data?.type === 'MAP_COORDS' && typeof e.data.lat === 'number') {
        const lngVal = typeof e.data.lng === 'number' ? e.data.lng : e.data.lon;
        if (typeof lngVal === 'number') {
          setCoords({ lat: e.data.lat, lng: lngVal });
        }
      }
      if (e.data?.type === 'MAP_READY' || e.data?.type === 'VIEWER_READY' || e.data?.type === 'WEBGIS_READY' || e.data?.type === 'MAP_LOADED') {
        syncMapSettings();
        sendStagedData();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [syncMapSettings, sendStagedData]);

  // Send postMessage subgrid filter and staged data updates to embedded WebGIS map iframe
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_SUBGRID_FILTER',
        subgrid: selectedSubgridFilter || '',
        isSingleRun: Boolean(selectedDailyRunId),
        runId: selectedDailyRunId || null,
        date: selectedDateFilter || ''
      }, '*');
    }
  }, [selectedSubgridFilter, selectedDailyRunId, selectedDateFilter]);

  useEffect(() => {
    syncMapSettings();
    sendStagedData();
  }, [syncMapSettings, sendStagedData, refreshKey, selectedDailyRunId]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-app">
      {/* Top-Left GeoSphere 360 Operations Hub Executive Floating Badge */}
      <div className="absolute top-3 left-3 z-20 pointer-events-none">
        <div className="bg-card backdrop-blur-xl border border-subtle rounded-2xl px-3.5 py-2 shadow-2xl flex items-center gap-3 shrink-0">
          <div className="p-2 bg-gradient-to-tr from-sky-600 to-emerald-500 rounded-xl shadow-md shadow-emerald-950/40 shrink-0">
            <Layers size={16} className="text-text-base" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-text-base font-bold text-xs sm:text-sm tracking-tight">
                GeoSphere 360 Operations Hub
              </h2>
            </div>
            <p className="text-[10px] text-text-muted font-medium mt-0.5">
              Mobile Mapping & Spatial Asset Intelligence
            </p>
          </div>
        </div>
      </div>
      {/* Live Cursor Coordinate Badge (bottom-right) — non-overlapping position */}
      <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
        <div className="bg-app backdrop-blur-md border border-subtle rounded-lg px-2.5 py-1 text-[11px] text-text-base shadow-xl flex items-center gap-2 font-sans">
          <span className="text-sky-400 font-semibold">EPSG:4326</span>
          <span className="text-text-muted">|</span>
          {coords ? (
            <span className="text-text-base">
              {coords.lat.toFixed(5)}° N, {coords.lng.toFixed(5)}° E
            </span>
          ) : (
            <span className="text-text-muted italic">Move cursor over map...</span>
          )}
        </div>
      </div>

      <iframe
        ref={(el) => {
          iframeRef.current = el;
          if (iframeRefCb) iframeRefCb(el);
        }}
        key="webgis-map"
        src={`${import.meta.env.VITE_MAP_URL || ''}/?embed=true&dashboard=true${dataManagement ? '&noSonar=1' : ''}`}
        onLoad={() => {
          if (iframeRef.current && iframeRef.current.contentWindow) {
            const dispatch = () => {
              if (!iframeRef.current || !iframeRef.current.contentWindow) return;
              try {
                iframeRef.current.contentWindow.postMessage({
                  type: 'SET_SUBGRID_FILTER',
                  subgrid: selectedSubgridFilter || '',
                  isSingleRun: Boolean(selectedDailyRunId),
                  runId: selectedDailyRunId || null,
                  date: selectedDateFilter || ''
                }, '*');
                syncMapSettings();
                sendStagedData();
              } catch (e) { }
            };

            dispatch();
            setTimeout(dispatch, 350);
            setTimeout(dispatch, 1000);
          }
        }}
        className="w-full h-full border-0"
        title="360 Mobile Mapping Map"
        allow="geolocation; camera; microphone"
      />
    </div>
  );
};

export default MapComponent;