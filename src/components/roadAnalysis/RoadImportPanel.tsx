import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  Upload,
  FileArchive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Info,
  Scissors
} from 'lucide-react';
import {
  parseGisImportFile,
  formatBytes,
  estimateGeometryBytes,
  analyzeImportGeometry,
  isImportMemoryError,
  IMPORT_MEMORY_ERROR_MESSAGE,
  type CatalogVectorLayer,
  type GisImportResult,
  type GisGeometryType
} from '../../utils/gisImportParser';
import { clipGeoJsonToRegions, bboxExceedsRegion } from '../../utils/subgridComparison';

export interface ImportPreview {
  mode: 'original' | 'clipped';
  color: string;
  geojson: any;
  /** Serialized GeoJSON string for heavyweight originals that crossed from the
   *  parse worker as bytes instead of an object graph (see GisImportResult). */
  geojsonJson?: string;
  featureCount: number;
  name: string;
  format: string;
}

export interface RoadImportPanelProps {
  onLayerImported: (layer: CatalogVectorLayer) => void;
  onNavigateToCatalog: () => void;
  /** Selected region geometry (districtsToGeoJSON(selectedDistricts).geojson). */
  districtsGeo?: any;
  /** Live overlay shown on the map while the user reviews original vs clipped. */
  onPreviewChange?: (preview: ImportPreview | null) => void;
}

const PRESET_COLORS = [
  '#38bdf8', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#f43f5e', // Rose
  '#14b8a6', // Teal
  '#f97316'  // Orange
];

const PREVIEW_COLORS = {
  original: '#38bdf8',
  clipped: '#10b981'
} as const;

type ImportPhase = 'idle' | 'processing' | 'resolve' | 'imported';

export const RoadImportPanel: React.FC<RoadImportPanelProps> = ({
  onLayerImported,
  onNavigateToCatalog,
  districtsGeo,
  onPreviewChange
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [processingStage, setProcessingStage] = useState<string | null>(null);
  const [parseTransport, setParseTransport] = useState<'worker' | 'inline' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastImported, setLastImported] = useState<CatalogVectorLayer | null>(null);
  const [lastImportClipped, setLastImportClipped] = useState<{
    districtCount: number;
    featureCountBefore: number;
    featureCountAfter: number;
  } | null>(null);
  // When OFF (default) the full uploaded geometry is imported immediately,
  // matching the speed of a plain GIS viewer. When ON, the dataset is clipped
  // to the selected district(s) off the main thread (in the parse worker).
  const [clipToDistrict, setClipToDistrict] = useState(false);
  // Parsed result held while waiting for the clip decision (phase === 'resolve').
  const [pendingParsed, setPendingParsed] = useState<GisImportResult | null>(null);
  // Polygon clip + its statistics computed OFF the main thread (in the parse
  // worker) when a clip was needed, so a large dataset is never re-walked on
  // the UI thread. Reused while the district selection is unchanged — the memo
  // below only re-clips on the main thread when the Region tab selection
  // actually differs from what the worker clipped against.
  const [stagedClip, setStagedClip] = useState<{
    districtsGeo: any;
    fc: any;
    stats?: {
      bbox: [number, number, number, number] | null;
      geometryType: GisGeometryType;
      lineCount: number;
      totalDistanceKm: number;
    };
    geometryBytes?: number;
  } | null>(null);
  const [previewMode, setPreviewMode] = useState<'original' | 'clipped'>('original');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileSizeFormattedRef = useRef<string>('');

  const regionCount = Array.isArray(districtsGeo?.features) ? districtsGeo.features.length : 0;

  // Clipped result, re-derived live so changing the Region tab (or its selected
  // district boundary) recomputes exactly what the polygon clip will produce.
  // Reuses the clip computed at parse time when the district selection is
  // unchanged, so importing a large file does not run the clip twice.
  const clippedFc = useMemo(() => {
    if (!pendingParsed || regionCount === 0) return null;
    if (stagedClip && stagedClip.districtsGeo === districtsGeo) return stagedClip.fc;
    return clipGeoJsonToRegions(pendingParsed.geojson, districtsGeo);
  }, [pendingParsed, districtsGeo, regionCount, stagedClip]);

  const clippedStats = useMemo(() => {
    if (!clippedFc) return null;
    // The parse worker already computed the clip's statistics; reuse them when
    // the district selection matches what the worker clipped against, instead
    // of re-walking the clipped geometry on the main thread.
    if (stagedClip && stagedClip.districtsGeo === districtsGeo && stagedClip.stats) {
      return stagedClip.stats;
    }
    return analyzeImportGeometry(clippedFc);
  }, [clippedFc, stagedClip, districtsGeo]);

  const clippedFeatureCount = clippedFc ? clippedFc.features.length : 0;

  const exceedsRegion = useMemo(
    () => (pendingParsed && clippedFc ? clippedFc.features.length < pendingParsed.featureCount : false),
    [pendingParsed, clippedFc]
  );

  // Lifted live preview overlay (only during the resolve stage).
  useEffect(() => {
    if (phase !== 'resolve' || !pendingParsed) {
      onPreviewChange?.(null);
      return;
    }
    const useClip = previewMode === 'clipped' && clippedFc;
    onPreviewChange?.({
      mode: previewMode,
      color: PREVIEW_COLORS[previewMode],
      geojson: useClip ? clippedFc : pendingParsed.geojson,
      geojsonJson: useClip ? undefined : pendingParsed.geojsonJson,
      featureCount: useClip
        ? clippedFeatureCount
        : pendingParsed.featureCount,
      name: pendingParsed.filename || 'Import preview',
      format: pendingParsed.format
    });
  }, [phase, previewMode, pendingParsed, clippedFc, clippedFeatureCount, onPreviewChange]);

  // Clear the lifted preview overlay if the panel unmounts (tab switch).
  useEffect(() => {
    return () => onPreviewChange?.(null);
  }, [onPreviewChange]);

  const importResult = useCallback(
    async (
      result: GisImportResult,
      geojson: any,
      clipped: boolean,
      fileSizeFormatted: string,
      precomputedStats?: NonNullable<GisImportResult['regionClip']> | null,
      precomputedBytes?: number
    ) => {
      // Prefer statistics already computed off the main thread (in the parse
      // worker); fall back to a local walk only when the district selection
      // changed after import, which re-runs the clip on the main thread anyway.
      const stats =
        clipped && geojson !== result.geojson
          ? precomputedStats
            ? {
                bbox: precomputedStats.bbox,
                geometryType: precomputedStats.geometryType,
                lineCount: precomputedStats.lineCount,
                totalDistanceKm: precomputedStats.totalDistanceKm
              }
            : analyzeImportGeometry(geojson)
          : null;
      const color = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
      const featureCount = (precomputedStats && clipped) ? precomputedStats.featureCount : clipped ? geojson.features.length : result.featureCount;

      const newLayer: CatalogVectorLayer = {
        id: `layer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: (result.filename || '').replace(/\.[^/.]+$/, '') || 'Imported layer',
        format: result.format,
        geojson,
        // Heavy datasets cross from the worker as a flat JSON string; preserve
        // it on the layer so the map can feed MapLibre a blob URL (its worker
        // fetches+parses) instead of re-cloning the graph on the UI thread.
        geojsonJson: result.geojsonJson,
        color,
        opacity: 0.85,
        strokeWidth: stats?.geometryType === 'LineString' || result.geometryType === 'LineString' ? 3.5 : 2,
        pointRadius: 5,
        visible: true,
        featureCount,
        geometryType: stats?.geometryType ?? result.geometryType,
        bbox: stats?.bbox ?? result.bbox,
        uploadedAt: new Date().toISOString(),
        fileSizeFormatted,
        hasRoadLines: stats ? stats.lineCount > 0 : result.hasRoadLines,
        totalDistanceKm: stats?.totalDistanceKm ?? result.totalDistanceKm,
        geometryBytes: clipped ? precomputedBytes ?? estimateGeometryBytes(geojson) : result.geometryBytes
      };

      if (clipped) {
        setLastImportClipped({
          districtCount: regionCount,
          featureCountBefore: result.featureCount,
          featureCountAfter: featureCount
        });
      } else {
        setLastImportClipped(null);
      }

      setLastImported(newLayer);
      setPendingParsed(null);
      setStagedClip(null);
      onPreviewChange?.(null);
      setPhase('imported');
      onLayerImported(newLayer);
    },
    [onLayerImported, regionCount, onPreviewChange]
  );

  const processFile = useCallback(
    async (file: File) => {
      setPhase('processing');
      setErrorMsg(null);
      setWarnings([]);
      setProcessingStage(null);
      setParseTransport(null);
      setLastImportClipped(null);
      setPendingParsed(null);
      setStagedClip(null);
      setPreviewMode('original');
      onPreviewChange?.(null);
      fileSizeFormattedRef.current = formatBytes(file.size);

      try {
        // The parse worker ALSO performs the bbox gate + polygon clip + clipped
        // statistics off the UI thread when a region is selected AND the
        // clip-to-district option is enabled, so large imports never re-walk
        // the dataset (or clip it) on the main thread. With the option OFF the
        // full uploaded dataset is parsed and imported immediately.
        const result: GisImportResult = await parseGisImportFile(
          file,
          (stage) => setProcessingStage(stage),
          clipToDistrict && regionCount > 0 ? districtsGeo : undefined,
          (mode) => setParseTransport(mode)
        );

        if (result.warnings && result.warnings.length > 0) {
          setWarnings(result.warnings);
        }

        // Yield one frame so the "read" progress state paints before the
        // remaining synchronous layer-commit work below, keeping the panel
        // visibly responsive after a large worker result arrives.
        setProcessingStage('Import complete — finalising layer…');
        await new Promise<void>((r) => requestAnimationFrame(() => r()));

        if (clipToDistrict && regionCount > 0) {
          const clip = result.regionClip;
          // Worker path (GeoJSON/CSV/Shapefile): the parse worker already ran
          // the bbox gate + polygon clip + statistics off the UI thread. Its
          // answer is authoritative — no main-thread geometry work is needed.
          if (clip) {
            if (clip.featureCount < clip.originalFeatureCount) {
              // The polygon clip actually trims the dataset: stage it for the
              // Original-vs-Clipped review.
              setStagedClip({
                districtsGeo,
                fc: clip.fc,
                stats: {
                  bbox: clip.bbox,
                  geometryType: clip.geometryType,
                  lineCount: clip.lineCount,
                  totalDistanceKm: clip.totalDistanceKm
                },
                geometryBytes: clip.geometryBytes
              });
              setPendingParsed(result);
              setPhase('resolve');
              return;
            }
            // Worker clipped but removed nothing (e.g. bounds poking out with
            // all features still inside polygons) — import immediately.
            await importResult(result, result.geojson, false, formatBytes(file.size));
            return;
          }
          if (clip === null) {
            // Worker decided the dataset bbox fits inside the region — no clip
            // stage needed.
            await importResult(result, result.geojson, false, formatBytes(file.size));
            return;
          }
          // Inline parse path (XML formats: KML/KMZ/GPX, .zip archives): the
          // worker could not run. Cheap bbox check first; only the
          // boundary-following clip when bbox exceeds. Trade-off: data inside
          // the bbox but outside a concave district's shape imports un-clipped.
          if (bboxExceedsRegion(result.bbox, districtsGeo)) {
            const clippedCheck = clipGeoJsonToRegions(result.geojson, districtsGeo);
            if (clippedCheck.features.length < result.featureCount) {
              const stats = analyzeImportGeometry(clippedCheck);
              setStagedClip({
                districtsGeo,
                fc: clippedCheck,
                stats: {
                  bbox: stats.bbox,
                  geometryType: stats.geometryType,
                  lineCount: stats.lineCount,
                  totalDistanceKm: stats.totalDistanceKm
                },
                geometryBytes: estimateGeometryBytes(clippedCheck)
              });
              setPendingParsed(result);
              setPhase('resolve');
              return;
            }
          }
        }

        await importResult(result, result.geojson, false, formatBytes(file.size));
      } catch (err: any) {
        console.error('[RoadImport] Failed to parse GIS file:', err);
        setErrorMsg(
          isImportMemoryError(err)
            ? IMPORT_MEMORY_ERROR_MESSAGE
            : err?.message || 'Failed to parse file. Ensure it is a valid GIS spatial format.'
        );
        setPhase(lastImported ? 'imported' : 'idle');
      }
    },
    [districtsGeo, onPreviewChange, importResult, lastImported, clipToDistrict]
  );

  const handleApplyClipAndImport = useCallback(() => {
    if (!pendingParsed || !clippedFc) return;
    setPreviewMode('clipped');
    const useWorkerStats = stagedClip && stagedClip.districtsGeo === districtsGeo;
    const clipStats = useWorkerStats && stagedClip.stats;
    const clipBytes = useWorkerStats ? stagedClip.geometryBytes : undefined;
    importResult(
      pendingParsed,
      clippedFc,
      true,
      fileSizeFormattedRef.current,
      clipStats
        ? {
            fc: clippedFc,
            featureCount: clippedFc.features.length,
            geometryType: clipStats.geometryType,
            bbox: clipStats.bbox,
            hasRoadLines: clipStats.lineCount > 0,
            lineCount: clipStats.lineCount,
            totalDistanceKm: clipStats.totalDistanceKm,
            geometryBytes: clipBytes ?? 0,
            originalFeatureCount: pendingParsed.featureCount
          }
        : null,
      clipBytes
    );
  }, [pendingParsed, clippedFc, importResult, stagedClip, districtsGeo]);

  const handleImportFull = useCallback(() => {
    if (!pendingParsed) return;
    setPreviewMode('original');
    importResult(pendingParsed, pendingParsed.geojson, false, fileSizeFormattedRef.current);
  }, [pendingParsed, importResult]);

  const handleCancelResolve = useCallback(() => {
    onPreviewChange?.(null);
    setPendingParsed(null);
    setStagedClip(null);
    setPreviewMode('original');
    setPhase(lastImported ? 'imported' : 'idle');
  }, [onPreviewChange, lastImported]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        processFile(files[0]);
      }
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const isBusy = phase === 'processing';

  return (
    <div className="flex flex-col gap-3 p-0.5 text-text-base animate-in fade-in duration-300">
      {/* Upload Section Header */}
      <div>
        <h3 className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-1.5">
          Upload GIS Dataset
        </h3>

        {/* Drag and Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !isBusy && fileInputRef.current?.click()}
          className={`relative border border-dashed rounded-lg p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-sky-400 bg-sky-500/15 shadow-lg scale-[0.99]'
              : 'border-subtle bg-inner/40 hover:border-sky-500/50 hover:bg-inner/60'
          } ${isBusy ? 'pointer-events-none opacity-60' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json,.kml,.kmz,.zip,.shp,.gpx,.csv,application/json,application/zip,application/x-zip-compressed,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) processFile(f);
              e.target.value = '';
            }}
          />

          {isBusy ? (
            <div className="flex flex-col items-center gap-1.5 py-2">
              <Loader2 size={20} className="text-sky-400 animate-spin" />
              <span className="text-xs font-semibold text-text-base">Importing dataset…</span>
              <span className="text-[10px] text-text-muted animate-pulse">
                {processingStage || 'Preparing to read file'}
              </span>
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-full border font-mono ${
                  parseTransport === 'worker'
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                    : parseTransport === 'inline'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-subtle bg-inner/40 text-text-muted'
                }`}
              >
                {parseTransport === 'worker'
                  ? 'background thread'
                  : parseTransport === 'inline'
                    ? 'main thread'
                    : 'starting…'}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 py-1">
              <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                <Upload size={16} />
              </div>
              <div>
                <span className="text-xs font-semibold text-text-base block">Click to browse or drop file</span>
                <span className="block text-[10px] text-text-muted mt-0.5">
                  Shapefile (.zip), KML/KMZ, GeoJSON, GPX, or CSV
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Clip-to-district opt-in. Default OFF: the full uploaded dataset is
          imported immediately (geolibre-style speed). ON clips to the selected
          district(s) off the main thread. */}
      <label
        className={`flex items-start gap-2 p-2 rounded-lg border border-subtle bg-inner/40 cursor-pointer ${
          regionCount === 0 ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        <input
          type="checkbox"
          checked={clipToDistrict}
          onChange={(e) => setClipToDistrict(e.target.checked)}
          className="mt-0.5 w-3.5 h-3.5 text-sky-600 bg-inner border-subtle rounded focus:ring-sky-500"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-[11px] font-semibold text-text-base">
            Clip to selected district{regionCount === 1 ? '' : 's'}
          </span>
          <span className="text-[10px] text-text-muted leading-snug">
            {regionCount === 0
              ? 'Select districts on the Region tab to enable clipping.'
              : 'Trim the imported data to the selected district(s). Leave OFF to import the full file — faster for large or boundary-crossing layers.'}
          </span>
        </span>
      </label>

      {/* Region-aware staging card (file held while the user decides on the clip) */}
      {phase === 'resolve' && pendingParsed && (
        <div
          className={`flex flex-col gap-2 p-2.5 rounded-lg border animate-in fade-in ${
            exceedsRegion
              ? 'border-amber-500/30 bg-amber-500/10'
              : 'border-emerald-500/30 bg-emerald-500/10'
          }`}
        >
          {exceedsRegion ? (
            <>
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-snug">
                  <span className="block text-xs font-semibold text-amber-300">
                    Import exceeds the selected region
                  </span>
                  <span className="block text-[10px] text-amber-200/90 mt-0.5 leading-relaxed">
                    “{pendingParsed.filename}” spans {pendingParsed.featureCount.toLocaleString()}{' '}
                    features across an area larger than the selected district(s). Clipping to the selected
                    district(s) keeps only the geometry you are analysing — the map stays fast
                    and nothing outside your working area is imported.
                  </span>
                </div>
              </div>

              {/* Live map preview toggle: Original vs clipped result */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] uppercase tracking-widest text-text-muted font-bold shrink-0">
                  Map preview
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewMode('original')}
                  className={`px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer ${
                    previewMode === 'original'
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                      : 'border-subtle bg-inner/40 text-text-muted hover:text-text-base'
                  }`}
                >
                  Original
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('clipped')}
                  disabled={!clippedFc}
                  className={`px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    previewMode === 'clipped'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                      : 'border-subtle bg-inner/40 text-text-muted hover:text-text-base'
                  }`}
                >
                  Clipped
                </button>
              </div>

              {clippedFc && (
                <div className="text-[10px] text-text-muted leading-relaxed">
                  Clipping to the selected {regionCount === 1 ? 'district' : 'districts'} reduces
                  the dataset from{' '}
                  <span className="font-semibold text-text-base">{pendingParsed.featureCount.toLocaleString()}</span>{' '}
                  to{' '}
                  <span className="font-semibold text-emerald-300">{clippedFeatureCount.toLocaleString()}</span>{' '}
                  features
                  {clippedStats?.totalDistanceKm
                    ? ` (${clippedStats.totalDistanceKm.toFixed(2)} km)` : ''}
                  {clippedFeatureCount < pendingParsed.featureCount
                    ? ` — ${Math.round((1 - clippedFeatureCount / pendingParsed.featureCount) * 100)}% smaller`
                    : ''}
                  .
                </div>
              )}
              {!clippedFc && (
                <div className="text-[10px] text-text-muted">
                  Select a district on the Region tab to preview the clipped result.
                </div>
              )}
              {clippedFc && clippedFeatureCount === 0 && (
                <div className="text-[10px] text-amber-200/80">
                  Nothing from this file falls inside the selected district(s). Review with the
                  Original preview or import the full dataset to see the whole file.
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={handleApplyClipAndImport}
                  disabled={!clippedFc || clippedFeatureCount === 0}
                  className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Scissors size={13} />
                  <span>
                    Apply clip &amp; import
                    {clippedFc ? ` (${clippedFeatureCount.toLocaleString()} features)` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleImportFull}
                  className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg border border-subtle bg-inner/40 hover:bg-inner/70 text-[11px] font-semibold text-text-muted hover:text-text-base transition-colors cursor-pointer"
                >
                  Import full dataset ({pendingParsed.featureCount.toLocaleString()} features)
                </button>
                <button
                  type="button"
                  onClick={handleCancelResolve}
                  className="w-full text-[10px] text-text-muted/70 hover:text-text-base hover:underline text-center transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              <span className="text-[11px] text-emerald-300 leading-snug">
                Dataset now fits within the selected district(s) — ready to import.
              </span>
              <button
                type="button"
                onClick={handleApplyClipAndImport}
                disabled={!clippedFc}
                className="ml-auto px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-40"
              >
                Clip &amp; import
              </button>
            </div>
          )}
        </div>
      )}

      {/* Explicit Shapefile ZIP Requirement Guide */}
      <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg border border-subtle bg-inner/40">
        <FileArchive size={14} className="text-sky-400 shrink-0 mt-0.5" />
        <div className="leading-snug">
          <span className="block text-xs font-semibold text-text-base">Shapefile Archive (.ZIP)</span>
          <span className="block text-[10px] text-text-muted mt-0.5 leading-relaxed">
            Bundle companion files (.shp, .dbf, .shx) together in a single .zip archive for complete attribute geometry import.
          </span>
        </div>
      </div>

      {/* Error Message Banner */}
      {errorMsg && (
        <div className="p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-start gap-2 animate-in fade-in">
          <AlertCircle size={14} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="leading-snug">
            <span className="font-semibold block">Import Error</span>
            <span className="text-[11px] text-rose-200">{errorMsg}</span>
          </div>
        </div>
      )}

      {/* Warning Notice */}
      {warnings.length > 0 && (
        <div className="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px] flex items-start gap-2 animate-in fade-in">
          <Info size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-snug">
            {warnings.map((w, idx) => (
              <span key={idx} className="block text-[10px] text-amber-200 mb-0.5">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Success Notification Card */}
      {lastImported && (
        <div className="border-t border-divider pt-2 mt-1 flex flex-col gap-1.5 animate-in fade-in">
          <h3 className="text-[9px] uppercase tracking-widest text-text-muted font-bold mb-0.5">
            Imported Result
          </h3>
          <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-text-base truncate">
                  {lastImported.name}
                </span>
              </div>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                {lastImported.format}
              </span>
            </div>

            {lastImportClipped && (
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-200">
                <Scissors size={11} className="text-emerald-400 shrink-0" />
                <span>
                  Clipped to {lastImportClipped.districtCount}{' '}
                  {lastImportClipped.districtCount === 1 ? 'district' : 'districts'}:{' '}
                  {lastImportClipped.featureCountAfter.toLocaleString()} features
                  {lastImportClipped.featureCountAfter < lastImportClipped.featureCountBefore
                    ? ` (was ${lastImportClipped.featureCountBefore.toLocaleString()} — ${Math.round(
                        (1 - lastImportClipped.featureCountAfter / lastImportClipped.featureCountBefore) * 100
                      )}% smaller)`
                    : ''}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1 text-[10px] text-text-muted">
              <div>Features: <span className="font-semibold text-text-base">{lastImported.featureCount}</span></div>
              <div>Type: <span className="font-semibold text-text-base">{lastImported.geometryType}</span></div>
              {lastImported.totalDistanceKm && lastImported.totalDistanceKm > 0 ? (
                <div className="col-span-2">
                  Length: <span className="font-semibold text-text-base">{lastImported.totalDistanceKm.toFixed(2)} km</span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onNavigateToCatalog}
              className="mt-0.5 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              <span>Open in Data Catalog</span>
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};