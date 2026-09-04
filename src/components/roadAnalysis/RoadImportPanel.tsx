import React, { useState, useRef, useCallback } from 'react';
import {
  Upload,
  FileArchive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Info
} from 'lucide-react';
import {
  parseGisImportFile,
  formatBytes,
  type CatalogVectorLayer,
  type GisImportResult
} from '../../utils/gisImportParser';

export interface RoadImportPanelProps {
  onLayerImported: (layer: CatalogVectorLayer) => void;
  onNavigateToCatalog: () => void;
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

export const RoadImportPanel: React.FC<RoadImportPanelProps> = ({
  onLayerImported,
  onNavigateToCatalog
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastImported, setLastImported] = useState<CatalogVectorLayer | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const processFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      setErrorMsg(null);
      setWarnings([]);

      try {
        const result: GisImportResult = await parseGisImportFile(file);

        // Pick an alternating color from presets
        const color = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];

        const newLayer: CatalogVectorLayer = {
          id: `layer-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name.replace(/\.[^/.]+$/, ''),
          format: result.format,
          geojson: result.geojson,
          color,
          opacity: 0.85,
          strokeWidth: result.geometryType === 'LineString' ? 3.5 : 2,
          pointRadius: 5,
          visible: true,
          featureCount: result.featureCount,
          geometryType: result.geometryType,
          bbox: result.bbox,
          uploadedAt: new Date().toISOString(),
          fileSizeFormatted: formatBytes(file.size),
          hasRoadLines: result.hasRoadLines,
          lineRuns: result.lineRuns,
          totalDistanceKm: result.totalDistanceKm
        };

        if (result.warnings && result.warnings.length > 0) {
          setWarnings(result.warnings);
        }

        setLastImported(newLayer);
        onLayerImported(newLayer);
      } catch (err: any) {
        console.error('[RoadImport] Failed to parse GIS file:', err);
        setErrorMsg(err?.message || 'Failed to parse file. Ensure it is a valid GIS spatial format.');
      } finally {
        setIsProcessing(false);
      }
    },
    [onLayerImported]
  );

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
          onClick={() => !isProcessing && fileInputRef.current?.click()}
          className={`relative border border-dashed rounded-lg p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-sky-400 bg-sky-500/15 shadow-lg scale-[0.99]'
              : 'border-subtle bg-inner/40 hover:border-sky-500/50 hover:bg-inner/60'
          } ${isProcessing ? 'pointer-events-none opacity-60' : ''}`}
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

          {isProcessing ? (
            <div className="flex flex-col items-center gap-1.5 py-2">
              <Loader2 size={20} className="text-sky-400 animate-spin" />
              <span className="text-xs font-semibold text-text-base">Parsing spatial geometries…</span>
              <span className="text-[10px] text-text-muted">Decompressing and validating coordinate bounds</span>
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
