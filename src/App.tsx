import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin,
  ZoomIn,
  ZoomOut,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Activity,
  Ruler,
  Clock,
  Camera,
  Navigation,
  BarChart2,
  Settings,
  LayoutDashboard,
  Plus,
  Save,
  Trash2,
  Edit2,
  Upload,
  X,
  Folder,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import {
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart
} from 'recharts';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { basemapLayer } from 'esri-leaflet';
import * as shapefile from 'shapefile';
import * as toGeoJSON from '@tmcw/togeojson';

// ==============================================
// Data Interfaces & Types
// ==============================================

interface DailyTimeSeries {
  date: string;
  grid: string;
  subgrid: string;
  kmProcessed: number;
  imagesProcessed: number; // renamed from imagesIngested
  defectCount: number;
  captureEquipment: 'MMS' | 'Backpack';
  imagesDefected: number; // renamed from defect rate (wait, no, user said defect rate → image defected, let's use imagesDefected)
  publishToUSVPRO: 'yes' | 'need to recheck' | 'no' | 'in process';
  action: string; // remarks field
}

interface BatchLog {
  id?: string;
  date: string;
  grid: string;
  subgrid: string;
  images: number;
  defects: number;
  kmProcessed: number;
  status: 'Success' | 'Flagged' | 'Recapture';
}

type Folder = {
  id: string;
  name: string;
  type: 'folder';
  expanded: boolean;
  children: (Layer | Folder)[];
  createdAt: string;
};

type Layer = {
  id: string;
  name: string;
  type: 'layer';
  color: string;
  visible: boolean;
  geojson: any;
  files: string[];
  uploadedAt: string;
};

// ==============================================
// Initial Mock Data
// ==============================================

const INITIAL_DAILY_DATA: DailyTimeSeries[] = [
  { 
    date: 'Jun 20', 
    grid: '1', 
    subgrid: 'N101E83', 
    kmProcessed: 150.2, 
    imagesProcessed: 52000, 
    defectCount: 45,
    imagesDefected: 45,
    captureEquipment: 'MMS',
    publishToUSVPRO: 'yes',
    action: 'Looks good, ready to go'
  },
  { 
    date: 'Jun 21', 
    grid: '2', 
    subgrid: 'N101E84', 
    kmProcessed: 180.5, 
    imagesProcessed: 65000, 
    defectCount: 62,
    imagesDefected: 62,
    captureEquipment: 'Backpack',
    publishToUSVPRO: 'need to recheck',
    action: 'Need to verify some areas'
  },
  { 
    date: 'Jun 22', 
    grid: '3', 
    subgrid: 'N101E85', 
    kmProcessed: 165.8, 
    imagesProcessed: 58000, 
    defectCount: 38,
    imagesDefected: 38,
    captureEquipment: 'MMS',
    publishToUSVPRO: 'in process',
    action: 'Currently being processed'
  },
  { 
    date: 'Jun 23', 
    grid: '4', 
    subgrid: 'N101E86', 
    kmProcessed: 210.3, 
    imagesProcessed: 75000, 
    defectCount: 89,
    imagesDefected: 89,
    captureEquipment: 'Backpack',
    publishToUSVPRO: 'no',
    action: 'Waiting for additional data'
  },
  { 
    date: 'Jun 24', 
    grid: '5', 
    subgrid: 'N101E87', 
    kmProcessed: 195.7, 
    imagesProcessed: 68000, 
    defectCount: 54,
    imagesDefected: 54,
    captureEquipment: 'MMS',
    publishToUSVPRO: 'yes',
    action: 'Verified and published'
  },
  { 
    date: 'Jun 25', 
    grid: '6', 
    subgrid: 'N101E88', 
    kmProcessed: 140.4, 
    imagesProcessed: 48000, 
    defectCount: 31,
    imagesDefected: 31,
    captureEquipment: 'Backpack',
    publishToUSVPRO: 'in process',
    action: 'Processing in progress'
  },
  { 
    date: 'Jun 26', 
    grid: '7', 
    subgrid: 'N102E83', 
    kmProcessed: 220.1, 
    imagesProcessed: 78000, 
    defectCount: 72,
    imagesDefected: 72,
    captureEquipment: 'MMS',
    publishToUSVPRO: 'yes',
    action: 'Ready'
  },
];

const INITIAL_BATCH_LOGS: BatchLog[] = [
  { id: '1', date: '2026-06-26 14:30', grid: '1', subgrid: 'N101E83', images: 78000, defects: 72, kmProcessed: 220.1, status: 'Success' },
  { id: '2', date: '2026-06-25 11:15', grid: '2', subgrid: 'N101E84', images: 48000, defects: 31, kmProcessed: 140.4, status: 'Flagged' },
  { id: '3', date: '2026-06-24 16:45', grid: '3', subgrid: 'N101E85', images: 68000, defects: 54, kmProcessed: 195.7, status: 'Success' },
  { id: '4', date: '2026-06-23 09:20', grid: '4', subgrid: 'N101E86', images: 75000, defects: 89, kmProcessed: 210.3, status: 'Recapture' },
];

// ==============================================
// Helper Functions
// ==============================================

// Flatten folder tree to get all layers
function flattenLayers(items: (Layer | Folder)[]): Layer[] {
  let layers: Layer[] = [];
  for (const item of items) {
    if (item.type === 'layer') {
      layers.push(item);
    } else {
      layers = [...layers, ...flattenLayers(item.children)];
    }
  }
  return layers;
}

// Find item in tree by id
function findItem(items: (Layer | Folder)[], id: string): (Layer | Folder) | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.type === 'folder') {
      const found = findItem(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Update item in tree
function updateItem(items: (Layer | Folder)[], id: string, updater: (item: Layer | Folder) => Layer | Folder): (Layer | Folder)[] {
  return items.map(item => {
    if (item.id === id) {
      return updater(item);
    }
    if (item.type === 'folder') {
      return { ...item, children: updateItem(item.children, id, updater) };
    }
    return item;
  });
}

// Delete item from tree
function removeItemFromTree(items: (Layer | Folder)[], id: string): (Layer | Folder)[] {
  return items.filter(item => {
    if (item.id === id) return false;
    if (item.type === 'folder') {
      item.children = removeItemFromTree(item.children, id);
    }
    return true;
  });
}

// Add item to folder (or root if folderId is null)
function addItemToFolder(items: (Layer | Folder)[], itemToAdd: Layer | Folder, folderId: string | null): (Layer | Folder)[] {
  if (!folderId) {
    return [...items, itemToAdd];
  }
  return items.map(item => {
    if (item.type === 'folder') {
      if (item.id === folderId) {
        return { ...item, children: [...item.children, itemToAdd] };
      }
      return { ...item, children: addItemToFolder(item.children, itemToAdd, folderId) };
    }
    return item;
  });
}

// Get flat list of folders with their paths
function getFlatFolderList(items: (Layer | Folder)[], path: string = ''): Array<{ id: string; name: string; path: string }> {
  let folders: Array<{ id: string; name: string; path: string }> = [];
  for (const item of items) {
    if (item.type === 'folder') {
      const currentPath = path ? `${path} / ${item.name}` : item.name;
      folders.push({ id: item.id, name: item.name, path: currentPath });
      folders = [...folders, ...getFlatFolderList(item.children, currentPath)];
    }
  }
  return folders;
}

// ==============================================
// Helper Components
// ==============================================

const KpiCard = ({ 
  title, 
  value, 
  delta, 
  icon: Icon, 
  colorClass, 
  progress, 
  subValue 
}: { 
  title: string; 
  value: string; 
  delta?: string; 
  icon: any; 
  colorClass: string; 
  progress?: number; 
  subValue?: string; 
}) => (
  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg hover:shadow-sky-900/20 transition-all duration-300">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <p className="text-slate-400 text-sm font-medium mb-2">{title}</p>
        <h3 className="text-2xl font-bold text-white mb-1">{value}</h3>
        {subValue && <p className="text-xs text-slate-500">{subValue}</p>}
        {delta && (
          <p className={`text-xs font-semibold mt-2 flex items-center gap-1 ${colorClass}`}>
            <TrendingUp size={12} />
            {delta}
          </p>
        )}
        {progress !== undefined && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>Progress</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ease-out ${colorClass.replace('text-', 'bg-')}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
      <div className={`p-3 rounded-lg bg-opacity-10 ${colorClass.replace('text-', 'bg-')}`}>
        <Icon className={colorClass} size={24} />
      </div>
    </div>
  </div>
);

const MapComponent = ({
  dataManagement = false,
  layerCatalog = []
}: {
  dataManagement?: boolean;
  layerCatalog?: (Layer | Folder)[];
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const uploadedLayersRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Initialize Leaflet map
    const map = L.map(mapContainerRef.current, {
      center: [3.1390, 101.6869], // Klang Valley
      zoom: 11,
      zoomControl: false, // Hide default zoom controls since we have custom ones
    });

    // Add Esri Light Gray Basemap
    basemapLayer('Gray').addTo(map);

    // Create layer group for uploaded data
    const layerGroup = L.layerGroup().addTo(map);
    uploadedLayersRef.current = layerGroup;

    mapRef.current = map;

    // Cleanup on unmount
    return () => {
      map.remove();
    };
  }, []);

  // Update layers when layerCatalog or visibility changes
  useEffect(() => {
    if (uploadedLayersRef.current) {
      uploadedLayersRef.current.clearLayers();
      const visibleLayers = flattenLayers(layerCatalog).filter(layer => layer.visible);
      const allBounds: L.LatLngBounds[] = [];

      for (const layer of visibleLayers) {
        if (!layer.geojson) continue;

        try {
          const geoJsonLayer = L.geoJSON(layer.geojson, {
            style: () => ({ color: layer.color, weight: 2 }),
            pointToLayer: (_feature, latlng) =>
              L.circleMarker(latlng, { radius: 6, fillColor: layer.color, color: '#fff', weight: 2 }),
          }).addTo(uploadedLayersRef.current);

          const bounds = geoJsonLayer.getBounds();
          if (bounds.isValid()) {
            allBounds.push(bounds);
          }
        } catch (err) {
          console.error('Error rendering layer:', layer.name, err);
          alert(`Error rendering layer ${layer.name}: ${(err as Error).message}`);
        }
      }

      // Fit bounds to visible layers if there are any
      if (allBounds.length > 0) {
        try {
          const combinedBounds = new L.LatLngBounds(allBounds[0].getSouthWest(), allBounds[0].getNorthEast());
          for (let i = 1; i < allBounds.length; i++) {
            combinedBounds.extend(allBounds[i]);
          }
          mapRef.current?.fitBounds(combinedBounds, { padding: [50, 50] });
        } catch (err) {
          console.error('Error fitting map bounds:', err);
        }
      }
    }
  }, [layerCatalog]);

  if (dataManagement) {
    return (
      <div className="relative w-full h-full overflow-hidden rounded-xl border border-slate-800">
        <div
          ref={mapContainerRef}
          className="w-full h-full bg-[#f5f5f5]"
          style={{ height: '100%', width: '100%' }}
        />
        {/* Zoom controls */}
        <div className="absolute right-4 top-4 z-[1000] flex flex-col gap-2">
          <button
            onClick={() => mapRef.current?.zoomIn()}
            className="w-10 h-10 bg-slate-900/95 border border-slate-800 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-600 transition-all"
          >
            <ZoomIn size={20} />
          </button>
          <button
            onClick={() => mapRef.current?.zoomOut()}
            className="w-10 h-10 bg-slate-900/95 border border-slate-800 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-600 transition-all"
          >
            <ZoomOut size={20} />
          </button>
        </div>
      </div>
    );
  }

  // Original Dashboard Map
  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Floating Header */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-[1000]">
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg px-4 py-2">
          <h2 className="text-white font-bold text-lg">TNB Low Voltage Network Digitization</h2>
          <p className="text-xs text-slate-400">Klang Valley Sector</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-400">EPSG:4326 (WGS 84)</p>
          </div>
          <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg px-3 py-2 flex items-center gap-2">
            <CheckCircle size={14} className="text-green-500" />
            <span className="text-xs text-white font-medium">System Sync: Stable</span>
          </div>
        </div>
      </div>

      {/* Leaflet Map Container */}
      <div ref={mapContainerRef} className="w-full h-full bg-[#f5f5f5]" style={{ height: '100%', width: '100%' }} />

      {/* Custom Zoom Controls */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-[1000] flex flex-col gap-2">
        <button
          onClick={() => mapRef.current?.zoomIn()}
          className="w-10 h-10 bg-slate-900/95 border border-slate-800 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-600 transition-all"
        >
          <ZoomIn size={20} />
        </button>
        <button
          onClick={() => mapRef.current?.zoomOut()}
          className="w-10 h-10 bg-slate-900/95 border border-slate-800 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-600 transition-all"
        >
          <ZoomOut size={20} />
        </button>
        <button className="w-10 h-10 bg-slate-900/95 border border-slate-800 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-600 transition-all">
          <Ruler size={20} />
        </button>
      </div>

      {/* Coordinates Overlay */}
      <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-lg px-3 py-2 z-[1000]">
        <p className="text-xs text-slate-400">
          Center: 3.1390° N, 101.6869° E | Covered: Subang/PJ/Cheras
        </p>
      </div>
    </div>
  );
};

// ==============================================
// Data Management Page Component
// ==============================================

// Component to render catalog items (layers or folders)
const CatalogItem = ({ 
  item, 
  depth = 0,
  catalog,
  onToggleFolder,
  onToggleLayer,
  onEdit,
  onDelete,
  onMove
}: {
  item: Layer | Folder;
  depth?: number;
  catalog: 'staged' | 'saved';
  onToggleFolder: (id: string) => void;
  onToggleLayer: (id: string) => void;
  onEdit: (item: Layer | Folder) => void;
  onDelete: (id: string) => void;
  onMove: (item: Layer | Folder, catalog: 'staged' | 'saved') => void;
}) => {
  if (item.type === 'folder') {
    return (
      <div>
        <div 
          className="bg-slate-800 border border-slate-700 rounded-lg p-4"
          style={{ marginLeft: `${depth * 16}px` }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => onToggleFolder(item.id)}>
              {item.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Folder size={16} className="text-amber-500" />
              <span className="text-slate-200 font-medium truncate max-w-[120px]">
                {item.name}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={(e) => { e.stopPropagation(); onMove(item, catalog); }}
                className="text-slate-400 hover:text-emerald-400 transition-colors p-1"
                title="Move"
              >
                <Navigation size={14} />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                className="text-slate-400 hover:text-sky-400 transition-colors p-1"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                className="text-slate-400 hover:text-red-400 transition-colors p-1"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Created: {new Date(item.createdAt).toLocaleString()}
          </p>
        </div>
        {item.expanded && (
          <div className="mt-2">
            {item.children.map(child => (
              <CatalogItem
                key={child.id}
                item={child}
                depth={depth + 1}
                catalog={catalog}
                onToggleFolder={onToggleFolder}
                onToggleLayer={onToggleLayer}
                onEdit={onEdit}
                onDelete={onDelete}
                onMove={onMove}
              />
            ))}
          </div>
        )}
      </div>
    );
  } else {
    return (
      <div 
        className="bg-slate-800 border border-slate-700 rounded-lg p-4"
        style={{ marginLeft: `${depth * 16}px` }}
      >
        <div className="flex items-center justify-between mb-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input 
              type="checkbox" 
              checked={item.visible} 
              onChange={() => onToggleLayer(item.id)}
              className="w-4 h-4 text-sky-600 bg-slate-700 border-slate-600 rounded focus:ring-sky-500"
            />
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: item.color }}
              />
              <span className="text-slate-200 font-medium truncate max-w-[120px]">
                {item.name}
              </span>
            </div>
          </label>
          <div className="flex items-center gap-1">
            <button 
              onClick={() => onMove(item, catalog)}
              className="text-slate-400 hover:text-emerald-400 transition-colors p-1"
              title="Move"
            >
              <Navigation size={14} />
            </button>
            <button 
              onClick={() => onEdit(item)}
              className="text-slate-400 hover:text-sky-400 transition-colors p-1"
              title="Edit"
            >
              <Edit2 size={14} />
            </button>
            <button 
              onClick={() => onDelete(item.id)}
              className="text-slate-400 hover:text-red-400 transition-colors p-1"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Uploaded: {new Date(item.uploadedAt).toLocaleString()}
        </p>
      </div>
    );
  }
};

const DataManagementPage = ({ 
  dailyData, 
  setDailyData, 
  batchLogs, 
  setBatchLogs,
  layerCatalog,
  setLayerCatalog,
  onBackToDashboard
}: { 
  dailyData: DailyTimeSeries[], 
  setDailyData: (data: DailyTimeSeries[]) => void, 
  batchLogs: BatchLog[], 
  setBatchLogs: (data: BatchLog[]) => void,
  layerCatalog: (Layer | Folder)[],
  setLayerCatalog: (data: (Layer | Folder)[]) => void,
  onBackToDashboard: () => void
}) => {
  const [dataTab, setDataTab] = useState<'batches' | 'daily' | 'vector'>('batches');
  const [editingItem, setEditingItem] = useState<BatchLog | DailyTimeSeries | Layer | Folder | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLayerEditModalOpen, setIsLayerEditModalOpen] = useState(false);
  const [isFolderCreateModalOpen, setIsFolderCreateModalOpen] = useState(false);
  const [isFolderEditModalOpen, setIsFolderEditModalOpen] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [stagedLayers, setStagedLayers] = useState<(Layer | Folder)[]>([]);
  const [movingItem, setMovingItem] = useState<{ item: Layer | Folder; catalog: 'staged' | 'saved' } | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draftDailyData, setDraftDailyData] = useState<DailyTimeSeries[]>(dailyData);
  const [isDailyDirty, setIsDailyDirty] = useState(false);

  useEffect(() => {
    if (!isDailyDirty) {
      setDraftDailyData(dailyData);
    }
  }, [dailyData, isDailyDirty]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const colors = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    for (const file of files) {
      try {
        console.log('Processing file:', file.name);
        let geojson: any = null;

        if (file.name.toLowerCase().endsWith('.geojson') || file.name.toLowerCase().endsWith('.json')) {
          const text = await file.text();
          geojson = JSON.parse(text);
        } else if (file.name.toLowerCase().endsWith('.kml')) {
          const text = await file.text();
          const parser = new DOMParser();
          const kmlDoc = parser.parseFromString(text, 'text/xml');
          // Check for XML parsing errors
          const parserError = kmlDoc.querySelector('parsererror');
          if (parserError) throw new Error('Invalid KML format');
          geojson = toGeoJSON.kml(kmlDoc);
        } else if (file.name.toLowerCase().endsWith('.gpx')) {
          const text = await file.text();
          const parser = new DOMParser();
          const gpxDoc = parser.parseFromString(text, 'text/xml');
          const parserError = gpxDoc.querySelector('parsererror');
          if (parserError) throw new Error('Invalid GPX format');
          geojson = toGeoJSON.gpx(gpxDoc);
        } else if (file.name.toLowerCase().endsWith('.shp')) {
          const buffer = await file.arrayBuffer();
          const shpData = await shapefile.open(buffer);
          const features = [];
          let result = await shpData.read();
          while (!result.done) {
            features.push(result.value);
            result = await shpData.read();
          }
          geojson = { type: 'FeatureCollection', features };
        } else if (file.name.toLowerCase().endsWith('.csv')) {
          const text = await file.text();
          const lines = text.split('\n').filter(line => line.trim());
          if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row');
          const headers = lines[0].split(',').map(h => h.trim());
          const latIdx = headers.findIndex(h => h.toLowerCase().includes('lat') || h.toLowerCase().includes('latitude'));
          const lngIdx = headers.findIndex(h => h.toLowerCase().includes('lng') || h.toLowerCase().includes('lon') || h.toLowerCase().includes('longitude'));

          if (latIdx !== -1 && lngIdx !== -1) {
            const features = lines.slice(1).map(line => {
              const values = line.split(',').map(v => v.trim());
              const lat = parseFloat(values[latIdx]);
              const lng = parseFloat(values[lngIdx]);
              if (isNaN(lat) || isNaN(lng)) {
                console.warn('Skipping invalid coordinate:', values[latIdx], values[lngIdx]);
                return null;
              }
              return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lng, lat] },
                properties: {}
              };
            }).filter(Boolean);
            geojson = { type: 'FeatureCollection', features };
          } else {
            throw new Error('CSV must have columns with "lat"/"latitude" and "lng"/"lon"/"longitude"');
          }
        } else {
          console.warn('Unsupported file format:', file.name);
          alert(`${file.name} is an unsupported format. Please use GeoJSON, KML, GPX, SHP, or CSV.`);
          continue;
        }

        // Validate GeoJSON
        if (!geojson) throw new Error('Failed to parse file');
        if (!geojson.type) geojson = { type: 'FeatureCollection', features: [geojson] };
        if (geojson.type === 'Feature' && !geojson.geometry) throw new Error('Invalid GeoJSON: feature missing geometry');
        if (geojson.type === 'FeatureCollection' && !Array.isArray(geojson.features)) {
          geojson.features = [];
        }

        console.log('Parsed GeoJSON:', geojson);

        const newLayer: Layer = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          type: 'layer',
          name: file.name,
          color: colors[(flattenLayers(layerCatalog).length + flattenLayers(stagedLayers).length) % colors.length],
          visible: true,
          geojson: geojson,
          files: [file.name],
          uploadedAt: new Date().toISOString(),
        };
        setStagedLayers([...stagedLayers, newLayer]);
      } catch (err) {
        console.error('Error processing file:', err);
        alert(`Error processing ${file.name}: ${(err as Error).message}`);
      }
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Catalog functions
  const toggleFolder = (catalog: 'staged' | 'saved', folderId: string) => {
    if (catalog === 'staged') {
      setStagedLayers(updateItem(stagedLayers, folderId, item => ({
        ...(item as Folder),
        expanded: !(item as Folder).expanded
      })));
    } else {
      setLayerCatalog(updateItem(layerCatalog, folderId, item => ({
        ...(item as Folder),
        expanded: !(item as Folder).expanded
      })));
    }
  };

  const toggleLayerVisibility = (catalog: 'staged' | 'saved', layerId: string) => {
    if (catalog === 'staged') {
      setStagedLayers(updateItem(stagedLayers, layerId, item => ({
        ...(item as Layer),
        visible: !(item as Layer).visible
      })));
    } else {
      setLayerCatalog(updateItem(layerCatalog, layerId, item => ({
        ...(item as Layer),
        visible: !(item as Layer).visible
      })));
    }
  };

  const deleteItem = (catalog: 'staged' | 'saved', itemId: string) => {
    const item = catalog === 'staged' ? findItem(stagedLayers, itemId) : findItem(layerCatalog, itemId);
    const confirmMessage = item?.type === 'folder' 
      ? 'Are you sure you want to delete this folder and all its contents?'
      : 'Are you sure you want to delete this layer?';
    
    if (confirm(confirmMessage)) {
      if (catalog === 'staged') {
        setStagedLayers(removeItemFromTree(stagedLayers, itemId));
      } else {
        setLayerCatalog(removeItemFromTree(layerCatalog, itemId));
      }
    }
  };

  const editItem = (item: Layer | Folder) => {
    setEditingItem(item);
    if (item.type === 'folder') {
      setIsFolderEditModalOpen(true);
      setNewFolderName(item.name);
    } else {
      setIsLayerEditModalOpen(true);
    }
  };

  const saveLayerEdit = (updatedLayer: Layer) => {
    const isStaged = stagedLayers.some(l => l.id === updatedLayer.id);
    if (isStaged) {
      setStagedLayers(updateItem(stagedLayers, updatedLayer.id, () => updatedLayer));
    } else {
      setLayerCatalog(updateItem(layerCatalog, updatedLayer.id, () => updatedLayer));
    }
    setIsLayerEditModalOpen(false);
    setEditingItem(null);
  };

  const createFolder = (name: string) => {
    const newFolder: Folder = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      type: 'folder',
      name: name,
      expanded: true,
      children: [],
      createdAt: new Date().toISOString()
    };
    setStagedLayers([...stagedLayers, newFolder]);
    setIsFolderCreateModalOpen(false);
    setNewFolderName('');
  };

  const saveFolderEdit = (updatedName: string) => {
    // Type guard to check if editingItem is a Folder
    const isFolder = (item: any): item is Folder => {
      return item && 'type' in item && item.type === 'folder';
    };
    if (!editingItem || !isFolder(editingItem)) return;
    const updatedFolder: Folder = { ...editingItem, name: updatedName };
    
    const isStaged = stagedLayers.some(l => l.id === updatedFolder.id);
    if (isStaged) {
      setStagedLayers(updateItem(stagedLayers, updatedFolder.id, () => updatedFolder));
    } else {
      setLayerCatalog(updateItem(layerCatalog, updatedFolder.id, () => updatedFolder));
    }
    setIsFolderEditModalOpen(false);
    setEditingItem(null);
    setNewFolderName('');
  };

  const saveStagedLayers = () => {
    setLayerCatalog([...layerCatalog, ...stagedLayers]);
    setStagedLayers([]);
    alert('Layers saved! They are now visible on the Dashboard map!');
  };

  const clearStagedLayers = () => {
    if (confirm('Are you sure you want to discard all staged layers and folders?')) {
      setStagedLayers([]);
    }
  };

  const moveItemToFolder = (itemId: string, sourceCatalog: 'staged' | 'saved', targetFolderId: string | null) => {
    // Get the item first
    const sourceItems = sourceCatalog === 'staged' ? stagedLayers : layerCatalog;
    const item = findItem(sourceItems, itemId);
    if (!item) return;

    // Check if we're trying to move a folder into itself or its child
    if (item.type === 'folder') {
      const isDescendant = (folder: Folder, targetId: string | null): boolean => {
        if (!targetId) return false;
        if (folder.id === targetId) return true;
        for (const child of folder.children) {
          if (child.type === 'folder' && isDescendant(child, targetId)) return true;
        }
        return false;
      };
      if (isDescendant(item, targetFolderId)) {
        alert('Cannot move a folder into itself or its subfolder');
        return;
      }
    }

    // Remove from source
    let updatedSource = removeItemFromTree(sourceItems, itemId);
    
    // Add to target (same catalog)
    updatedSource = addItemToFolder(updatedSource, item, targetFolderId);
    
    if (sourceCatalog === 'staged') {
      setStagedLayers(updatedSource);
    } else {
      setLayerCatalog(updatedSource);
    }
  };

  const handleMoveItem = () => {
    if (!movingItem) return;
    moveItemToFolder(movingItem.item.id, movingItem.catalog, targetFolderId);
    setIsMoveModalOpen(false);
    setMovingItem(null);
    setTargetFolderId(null);
  };

  const handleSave = (item: BatchLog | DailyTimeSeries) => {
    if (dataTab === 'batches') {
      const batchItem = item as BatchLog;
      if (editingItem && 'id' in editingItem) {
        setBatchLogs(batchLogs.map(b => b.id === editingItem.id ? { ...batchItem, id: editingItem.id } : b));
      } else {
        setBatchLogs([...batchLogs, { ...batchItem, id: Date.now().toString() }]);
      }
    } else {
      const dailyItem = item as DailyTimeSeries;
      if (editingItem && !( 'id' in editingItem)) {
        setDraftDailyData(draftDailyData.map(d => d.date === editingItem.date ? dailyItem : d));
      } else {
        setDraftDailyData([...draftDailyData, dailyItem]);
      }
      setIsDailyDirty(true);
    }
    setIsFormOpen(false);
    setEditingItem(null);
  };

  const handleDelete = (item: BatchLog | DailyTimeSeries) => {
    if (dataTab === 'batches' && 'id' in item) {
      setBatchLogs(batchLogs.filter(b => b.id !== item.id));
    } else if (dataTab === 'daily') {
      setDraftDailyData(draftDailyData.filter(d => d.date !== item.date));
      setIsDailyDirty(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBackToDashboard}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition-all"
            >
              <LayoutDashboard size={20} />
              Back to Dashboard
            </button>
            <h1 className="text-3xl font-bold text-white">Data Management</h1>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-slate-800 pb-4">
          <button 
            onClick={() => setDataTab('batches')}
            className={`px-6 py-3 rounded-t-lg font-semibold transition-all ${
              dataTab === 'batches' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Batch Logs
          </button>
          <button 
            onClick={() => setDataTab('daily')}
            className={`px-6 py-3 rounded-t-lg font-semibold transition-all ${
              dataTab === 'daily' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Daily Data
          </button>
          <button 
            onClick={() => setDataTab('vector')}
            className={`px-6 py-3 rounded-t-lg font-semibold transition-all ${
              dataTab === 'vector' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Vector Layers
          </button>
          {(dataTab === 'batches' || dataTab === 'daily') && (
            <button 
              onClick={() => {
                setEditingItem(null);
                setIsFormOpen(true);
              }}
              className="ml-auto flex items-center gap-2 bg-sky-600 hover:bg-sky-500 px-4 py-2 rounded-lg transition-all"
            >
              <Plus size={20} />
              Add New
            </button>
          )}
        </div>

        {/* Tab Content */}
        {dataTab === 'vector' ? (
          /* Vector Layers Section */
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column: Upload & Catalog */}
              <div className="lg:col-span-1 space-y-6">
                {/* Upload Area */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                  <h2 className="text-xl font-bold text-white mb-4">Upload Vector Data</h2>
                  <p className="text-slate-400 mb-6">Supported formats: GeoJSON, KML, GPX, Shapefile, CSV</p>
                  
                  <div className="flex flex-col gap-4">
                    <label className="flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 px-6 py-3 rounded-lg transition-all cursor-pointer">
                      <Upload size={20} />
                      Select Files
                      <input 
                        ref={fileInputRef}
                        type="file" 
                        accept=".geojson,.json,.kml,.gpx,.shp,.csv"
                        multiple
                        hidden
                        onChange={handleFileUpload}
                      />
                    </label>
                    
                    <button 
                      onClick={() => setIsFolderCreateModalOpen(true)}
                      className="flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 px-6 py-3 rounded-lg transition-all"
                    >
                      <Folder size={20} />
                      Create Folder
                    </button>
                    
                    {stagedLayers.length > 0 && (
                      <div className="flex gap-2">
                        <button 
                          onClick={saveStagedLayers}
                          className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 px-6 py-3 rounded-lg transition-all"
                        >
                          <Save size={20} />
                          Save to Dashboard
                        </button>
                        <button 
                          onClick={clearStagedLayers}
                          className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 px-6 py-3 rounded-lg transition-all"
                        >
                          <X size={20} />
                          Discard
                        </button>
                      </div>
                    )}
                    
                    {layerCatalog.length > 0 && (
                      <button 
                        onClick={() => {
                          setLayerCatalog([]);
                        }}
                        className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 px-6 py-3 rounded-lg transition-all"
                      >
                        <X size={20} />
                        Clear All Saved Layers
                      </button>
                    )}
                  </div>
                </div>

                {/* Layer Catalog */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-white">Layer Catalog</h2>
                    <span className="text-slate-400 text-sm">
                      {flattenLayers(layerCatalog).length} saved, {flattenLayers(stagedLayers).length} staged
                    </span>
                  </div>
                  
                  {/* Staged Items */}
                  {stagedLayers.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold text-amber-500 mb-2 flex items-center gap-2">
                        <AlertTriangle size={16} />
                        Staged for Save
                      </h3>
                      <div className="space-y-3">
                        {stagedLayers.map(item => (
                          <CatalogItem
                            key={item.id}
                            item={item}
                            catalog="staged"
                            onToggleFolder={(id) => toggleFolder('staged', id)}
                            onToggleLayer={(id) => toggleLayerVisibility('staged', id)}
                            onEdit={editItem}
                            onDelete={(id) => deleteItem('staged', id)}
                            onMove={(item, catalog) => {
                              setMovingItem({ item, catalog });
                              setTargetFolderId(null);
                              setIsMoveModalOpen(true);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Saved Items */}
                  {layerCatalog.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-sky-500 mb-2 flex items-center gap-2">
                        <CheckCircle size={16} />
                        Saved to Dashboard
                      </h3>
                      <div className="space-y-3">
                        {layerCatalog.map(item => (
                          <CatalogItem
                            key={item.id}
                            item={item}
                            catalog="saved"
                            onToggleFolder={(id) => toggleFolder('saved', id)}
                            onToggleLayer={(id) => toggleLayerVisibility('saved', id)}
                            onEdit={editItem}
                            onDelete={(id) => deleteItem('saved', id)}
                            onMove={(item, catalog) => {
                              setMovingItem({ item, catalog });
                              setTargetFolderId(null);
                              setIsMoveModalOpen(true);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {stagedLayers.length === 0 && layerCatalog.length === 0 && (
                    <div className="text-slate-500 text-center py-8">
                      <p>No layers or folders yet</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Map Preview */}
              <div className="lg:col-span-2">
                <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                  <h2 className="text-xl font-bold text-white p-4 border-b border-slate-800">Basemap Preview</h2>
                  <div className="h-[600px]">
                    <MapComponent dataManagement layerCatalog={[...layerCatalog, ...stagedLayers]} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Data Table (Batches or Daily) */
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-800">
                <tr>
                  {dataTab === 'batches' ? (
                    <>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Date & Time</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Grid</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Subgrid</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Distance (km)</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Images</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Defects</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Status</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Actions</th>
                    </>
                  ) : (
                    <>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Date</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Grid</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Subgrid</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">KM Processed</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Images Processed</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Capture Equipment</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Images Defected</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Publish to USVPRO</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Action</th>
                      <th className="px-6 py-4 text-slate-400 font-semibold">Actions</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {dataTab === 'batches' ? (
                  batchLogs.map((batch) => (
                    <tr key={batch.id} className="hover:bg-slate-800/50 transition-all">
                      <td className="px-6 py-4">{batch.date}</td>
                      <td className="px-6 py-4 font-mono">{batch.grid}</td>
                      <td className="px-6 py-4">{batch.subgrid}</td>
                      <td className="px-6 py-4">{batch.kmProcessed.toFixed(1)}</td>
                      <td className="px-6 py-4">{batch.images.toLocaleString()}</td>
                      <td className="px-6 py-4 text-amber-400">{batch.defects}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          batch.status === 'Success' ? 'bg-green-500/20 text-green-400' :
                          batch.status === 'Flagged' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>
                          {batch.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 flex gap-2">
                        <button 
                          onClick={() => {
                            setEditingItem(batch);
                            setIsFormOpen(true);
                          }}
                          className="text-slate-400 hover:text-sky-400 transition-colors"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          onClick={() => handleDelete(batch)}
                          className="text-slate-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  draftDailyData.map((daily) => (
                    <tr key={daily.date} className="hover:bg-slate-800/50 transition-all">
                      <td className="px-6 py-4">{daily.date}</td>
                      <td className="px-6 py-4">{daily.grid}</td>
                      <td className="px-6 py-4">{daily.subgrid}</td>
                      <td className="px-6 py-4">{daily.kmProcessed.toFixed(1)}</td>
                      <td className="px-6 py-4">{daily.imagesProcessed.toLocaleString()}</td>
                      <td className="px-6 py-4">{daily.captureEquipment}</td>
                      <td className="px-6 py-4 text-amber-400">{daily.imagesDefected}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          daily.publishToUSVPRO === 'yes' ? 'bg-green-500/10 text-green-400' :
                          daily.publishToUSVPRO === 'need to recheck' ? 'bg-amber-500/10 text-amber-400' :
                          daily.publishToUSVPRO === 'in process' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-red-500/10 text-red-400'
                        }`}>
                          {daily.publishToUSVPRO}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-300 truncate max-w-[150px]" title={daily.action}>
                        {daily.action}
                      </td>
                      <td className="px-6 py-4 flex gap-2">
                        <button 
                          onClick={() => {
                            setEditingItem(daily);
                            setIsFormOpen(true);
                          }}
                          className="text-slate-400 hover:text-sky-400 transition-colors"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          onClick={() => handleDelete(daily)}
                          className="text-slate-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {dataTab === 'daily' && isDailyDirty && (
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => {
                  setDailyData(draftDailyData);
                  setIsDailyDirty(false);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 px-5 py-3 rounded-lg font-semibold transition-all"
              >
                Apply update
              </button>
            </div>
          )}
        )}

        {/* Add/Edit Form */}
        {isFormOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-2xl w-full mx-4">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white">
                  {editingItem ? 'Edit' : 'Add New'} {dataTab === 'batches' ? 'Batch' : 'Daily Record'}
                </h2>
                <button 
                  onClick={() => {
                    setIsFormOpen(false);
                    setEditingItem(null);
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  &times;
                </button>
              </div>
              <DataForm 
                initialData={editingItem as BatchLog | DailyTimeSeries | null}
                dataType={dataTab as 'batches' | 'daily'}
                onSave={handleSave}
                onCancel={() => {
                  setIsFormOpen(false);
                  setEditingItem(null);
                }}
              />
            </div>
          </div>
        )}

        {/* Layer Edit Modal */}
        {isLayerEditModalOpen && editingItem && 'id' in editingItem && (() => {
          const layer = editingItem as Layer;
          return (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md w-full mx-4">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-white">Edit Layer</h2>
                  <button 
                    onClick={() => {
                      setIsLayerEditModalOpen(false);
                      setEditingItem(null);
                    }}
                    className="text-slate-400 hover:text-white"
                  >
                    &times;
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">Layer Name</label>
                    <input 
                      type="text"
                      value={layer.name}
                      onChange={(e) => setEditingItem({ ...layer, name: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">Color</label>
                    <div className="flex items-center gap-4">
                      <input 
                        type="color"
                        value={layer.color}
                        onChange={(e) => setEditingItem({ ...layer, color: e.target.value })}
                        className="w-12 h-12 cursor-pointer rounded-lg border border-slate-700"
                      />
                      <span className="text-slate-400 text-sm font-mono">{layer.color}</span>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button 
                      onClick={() => saveLayerEdit(editingItem as Layer)}
                      className="flex-1 bg-sky-600 hover:bg-sky-500 px-4 py-3 rounded-lg transition-all"
                    >
                      Save Changes
                    </button>
                    <button 
                      onClick={() => {
                        setIsLayerEditModalOpen(false);
                        setEditingItem(null);
                      }}
                      className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-3 rounded-lg transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Folder Create Modal */}
        {isFolderCreateModalOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md w-full mx-4">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white">Create Folder</h2>
                <button 
                  onClick={() => {
                    setIsFolderCreateModalOpen(false);
                    setNewFolderName('');
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  &times;
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Folder Name</label>
                  <input 
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Enter folder name"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => {
                      if (newFolderName.trim()) {
                        createFolder(newFolderName.trim());
                        setNewFolderName('');
                      }
                    }}
                    disabled={!newFolderName.trim()}
                    className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 px-4 py-3 rounded-lg transition-all"
                  >
                    Create Folder
                  </button>
                  <button 
                    onClick={() => {
                      setIsFolderCreateModalOpen(false);
                      setNewFolderName('');
                    }}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-3 rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Folder Edit Modal */}
        {isFolderEditModalOpen && editingItem && 'id' in editingItem && 'type' in editingItem && (editingItem as any).type === 'folder' && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md w-full mx-4">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white">Edit Folder</h2>
                <button 
                  onClick={() => {
                    setIsFolderEditModalOpen(false);
                    setEditingItem(null);
                    setNewFolderName('');
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  &times;
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-2">Folder Name</label>
                  <input 
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => saveFolderEdit(newFolderName)}
                    disabled={!newFolderName.trim()}
                    className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 px-4 py-3 rounded-lg transition-all"
                  >
                    Save Changes
                  </button>
                  <button 
                    onClick={() => {
                      setIsFolderEditModalOpen(false);
                      setEditingItem(null);
                      setNewFolderName('');
                    }}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-3 rounded-lg transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Move Item Modal */}
        {isMoveModalOpen && movingItem && (() => {
          const currentCatalogItems = movingItem.catalog === 'staged' ? stagedLayers : layerCatalog;
          const availableFolders = getFlatFolderList(currentCatalogItems).filter(f => f.id !== movingItem.item.id);
          return (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000]">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 max-w-md w-full mx-4">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-white">
                    Move {movingItem.item.type === 'folder' ? 'Folder' : 'Layer'}
                  </h2>
                  <button 
                    onClick={() => {
                      setIsMoveModalOpen(false);
                      setMovingItem(null);
                      setTargetFolderId(null);
                    }}
                    className="text-slate-400 hover:text-white"
                  >
                    &times;
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-300 mb-2">Move to</label>
                    <select 
                      value={targetFolderId || ''}
                      onChange={(e) => setTargetFolderId(e.target.value || null)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                    >
                      <option value="">Root</option>
                      {availableFolders.map(folder => (
                        <option key={folder.id} value={folder.id}>
                          {folder.path}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button 
                      onClick={handleMoveItem}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 px-4 py-3 rounded-lg transition-all"
                    >
                      Move
                    </button>
                    <button 
                      onClick={() => {
                        setIsMoveModalOpen(false);
                        setMovingItem(null);
                        setTargetFolderId(null);
                      }}
                      className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-3 rounded-lg transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

// ==============================================
// Data Form Component
// ==============================================

const SUBGRIDS = [
  'N101E83', 'N101E84', 'N101E85', 'N101E86', 
  'N101E87', 'N101E88', 'N102E83', 'N102E84', 
  'N102E85', 'N102E86', 'N102E87', 'N102E88'
];
const GRIDS = Array.from({ length: 12 }, (_, i) => (i + 1).toString());

const DataForm = ({ 
  initialData, 
  dataType, 
  onSave, 
  onCancel 
}: { 
  initialData: BatchLog | DailyTimeSeries | null, 
  dataType: 'batches' | 'daily',
  onSave: (data: any) => void,
  onCancel: () => void
}) => {
  const [formData, setFormData] = useState<any>(
    initialData || 
    (dataType === 'batches' 
      ? { date: new Date().toISOString().slice(0, 16), grid: '1', subgrid: 'N101E83', images: 0, defects: 0, kmProcessed: 0, status: 'Success' as const }
      : { 
          date: '', 
          grid: '1', 
          subgrid: 'N101E83', 
          kmProcessed: 0, 
          imagesProcessed: 0, 
          defectCount: 0,
          imagesDefected: 0,
          captureEquipment: 'MMS' as const,
          publishToUSVPRO: 'in process' as const,
          action: ''
        }
    )
  );

  return (
    <form 
      onSubmit={(e) => {
        e.preventDefault();
        onSave(formData);
      }}
      className="space-y-6"
    >
      {dataType === 'batches' ? (
        <>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Date & Time</label>
            <input 
              type="datetime-local"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Grid</label>
              <select 
                value={formData.grid}
                onChange={(e) => setFormData({ ...formData, grid: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                required
              >
                {GRIDS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Subgrid</label>
              <select 
                value={formData.subgrid}
                onChange={(e) => setFormData({ ...formData, subgrid: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                required
              >
                {SUBGRIDS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Images</label>
              <input 
                type="number"
                value={formData.images}
                onChange={(e) => setFormData({ ...formData, images: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Defects</label>
              <input 
                type="number"
                value={formData.defects}
                onChange={(e) => setFormData({ ...formData, defects: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Distance (km)</label>
            <input 
              type="number"
              step="0.1"
              value={formData.kmProcessed}
              onChange={(e) => setFormData({ ...formData, kmProcessed: Number(e.target.value) })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Status</label>
            <select 
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Success' | 'Flagged' | 'Recapture' })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            >
              <option value="Success">Success</option>
              <option value="Flagged">Flagged</option>
              <option value="Recapture">Recapture</option>
            </select>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Date</label>
            <input 
              type="text"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              placeholder="e.g., Jun 27"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Grid</label>
              <select 
                value={formData.grid}
                onChange={(e) => setFormData({ ...formData, grid: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                required
              >
                {GRIDS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Subgrid</label>
              <select 
                value={formData.subgrid}
                onChange={(e) => setFormData({ ...formData, subgrid: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
                required
              >
                {SUBGRIDS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">KM Processed</label>
            <input 
              type="number"
              step="0.1"
              value={formData.kmProcessed}
              onChange={(e) => setFormData({ ...formData, kmProcessed: Number(e.target.value) })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Images Processed</label>
            <input 
              type="number"
              value={formData.imagesProcessed}
              onChange={(e) => setFormData({ ...formData, imagesProcessed: Number(e.target.value) })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Images Defected</label>
            <input 
              type="number"
              value={formData.imagesDefected}
              onChange={(e) => setFormData({ ...formData, imagesDefected: Number(e.target.value) })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Capture Equipment</label>
            <select 
              value={formData.captureEquipment}
              onChange={(e) => setFormData({ ...formData, captureEquipment: e.target.value as 'MMS' | 'Backpack' })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            >
              <option value="MMS">MMS</option>
              <option value="Backpack">Backpack</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Publish to USVPRO</label>
            <select 
              value={formData.publishToUSVPRO}
              onChange={(e) => setFormData({ ...formData, publishToUSVPRO: e.target.value as 'yes' | 'need to recheck' | 'no' | 'in process' })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            >
              <option value="yes">yes</option>
              <option value="need to recheck">need to recheck</option>
              <option value="no">no</option>
              <option value="in process">in process</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Action</label>
            <input 
              type="text"
              value={formData.action}
              onChange={(e) => setFormData({ ...formData, action: e.target.value })}
              placeholder="Enter remarks or actions taken..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
            />
          </div>
        </>
      )}
      
      <div className="flex justify-end gap-4 pt-4">
        <button 
          type="button"
          onClick={onCancel}
          className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-all"
        >
          Cancel
        </button>
        <button 
          type="submit"
          className="flex items-center gap-2 px-6 py-3 bg-sky-600 hover:bg-sky-500 rounded-lg font-semibold transition-all"
        >
          <Save size={20} />
          Save
        </button>
      </div>
    </form>
  );
};

// ==============================================
// Main Application Component
// ==============================================

export default function App() {
  const [currentPage, setCurrentPage] = useState<'dashboard' | 'data'>('dashboard');
  const [activeTab, setActiveTab] = useState<'batches' | 'daily'>('batches');
  const [layerCatalog, setLayerCatalog] = useState<(Layer | Folder)[]>(() => {
    const saved = localStorage.getItem('layerCatalog');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });



  // Load data from localStorage or use initial data
  const [dailyData, setDailyData] = useState<DailyTimeSeries[]>(() => {
    const saved = localStorage.getItem('dailyData');
    if (!saved) return INITIAL_DAILY_DATA;
    const parsed = JSON.parse(saved);
    // Add defaults for missing fields to prevent errors
    return parsed.map((d: any) => ({
      ...d,
      imagesProcessed: d.imagesProcessed ?? d.imagesIngested ?? 0,
      captureEquipment: d.captureEquipment ?? 'MMS',
      imagesDefected: d.imagesDefected ?? d.defectCount ?? 0,
      publishToUSVPRO: d.publishToUSVPRO ?? 'in process',
      action: d.action ?? ''
    }));
  });

  const [batchLogs, setBatchLogs] = useState<BatchLog[]>(() => {
    const saved = localStorage.getItem('batchLogs');
    if (!saved) return INITIAL_BATCH_LOGS;
    const parsed = JSON.parse(saved);
    // Add default kmProcessed if missing
    return parsed.map((log: any) => ({
      ...log,
      kmProcessed: log.kmProcessed ?? 0
    }));
  });

  // Save to localStorage whenever data changes
  useEffect(() => {
    localStorage.setItem('dailyData', JSON.stringify(dailyData));
  }, [dailyData]);

  useEffect(() => {
    localStorage.setItem('batchLogs', JSON.stringify(batchLogs));
  }, [batchLogs]);

  useEffect(() => {
    localStorage.setItem('layerCatalog', JSON.stringify(layerCatalog));
  }, [layerCatalog]);

  // Sync batch logs to daily data by subgrid (only update computed fields)
  useEffect(() => {
    // Group batch logs by subgrid
    const batchBySubgrid = batchLogs.reduce((acc, batch) => {
      if (!acc[batch.subgrid]) {
        acc[batch.subgrid] = { totalImages: 0, totalDefects: 0, totalKm: 0 };
      }
      acc[batch.subgrid].totalImages += batch.images;
      acc[batch.subgrid].totalDefects += batch.defects;
      acc[batch.subgrid].totalKm += batch.kmProcessed;
      return acc;
    }, {} as Record<string, { totalImages: number; totalDefects: number; totalKm: number }>);

    // Update daily data with batch sums (only update computed fields, preserve user edits)
    const updatedDailyData = dailyData.map(daily => {
      if (batchBySubgrid[daily.subgrid]) {
        const { totalImages, totalDefects, totalKm } = batchBySubgrid[daily.subgrid];
        // Check if any computed fields need updating
        const needsUpdate = 
          daily.imagesProcessed !== totalImages ||
          daily.imagesDefected !== totalDefects ||
          daily.defectCount !== totalDefects ||
          daily.kmProcessed !== totalKm;

        if (needsUpdate) {
          return {
            ...daily,
            imagesProcessed: totalImages,
            imagesDefected: totalDefects,
            defectCount: totalDefects,
            kmProcessed: totalKm
          };
        }
      }
      return daily;
    });

    // Only update state if there are actual changes to avoid infinite loops
    const hasChanges = JSON.stringify(updatedDailyData) !== JSON.stringify(dailyData);
    if (hasChanges) {
      setDailyData(updatedDailyData);
    }
  }, [batchLogs]);

  // Calculated totals
  const totalImages = dailyData.reduce((sum, d) => sum + d.imagesProcessed, 0);
  const totalKm = dailyData.reduce((sum, d) => sum + d.kmProcessed, 0);
  const totalDefects = dailyData.reduce((sum, d) => sum + d.imagesDefected, 0);
  const targetKm = 5000;
  const progressPercent = Math.round((totalKm / targetKm) * 100);
  const latestBatch = dailyData[dailyData.length - 1];

  // If on data management page, render that instead
  if (currentPage === 'data') {
    return (
      <DataManagementPage 
        dailyData={dailyData}
        setDailyData={setDailyData}
        batchLogs={batchLogs}
        setBatchLogs={setBatchLogs}
        layerCatalog={layerCatalog}
        setLayerCatalog={setLayerCatalog}
        onBackToDashboard={() => setCurrentPage('dashboard')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      <div className="flex flex-col h-screen">
        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar - Analytics */}
          <div className="w-[30%] bg-slate-900 border-r border-slate-800 flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-slate-800">
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2 bg-sky-500/10 rounded-lg">
                  <MapPin className="text-sky-500" size={24} />
                </div>
                <div className="flex-1">
                  <h1 className="text-xl font-bold text-white">Geo360 Process</h1>
                  <p className="text-xs text-slate-500">TNB LV Asset Mapping</p>
                </div>
                <button 
                  onClick={() => setCurrentPage('data')}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-sm font-semibold transition-all"
                >
                  <Settings size={18} />
                  Manage Data
                </button>
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
                <Clock size={14} />
                Last Updated: {new Date().toLocaleString()}
              </div>
            </div>

            {/* KPI Cards */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <KpiCard 
                title="Total Images Processed"
                value={totalImages.toLocaleString()}
                delta={`+${latestBatch.imagesProcessed.toLocaleString()} last batch`}
                icon={Camera}
                colorClass="text-sky-500"
              />
              <KpiCard 
                title="Total Distance Processed"
                value={`${totalKm.toFixed(1)} km`}
                delta={`+${latestBatch.kmProcessed.toFixed(1)} km last batch`}
                icon={Navigation}
                colorClass="text-emerald-500"
              />
              <KpiCard 
                title="Overall Project Mileage"
                value={`${totalKm.toFixed(1)} km`}
                subValue="Target: 5,000 km"
                icon={BarChart2}
                colorClass="text-amber-500"
                progress={progressPercent}
              />
              <div className="grid grid-cols-2 gap-4">
                <KpiCard 
                  title="Image Defects"
                  value={totalDefects.toLocaleString()}
                  icon={AlertTriangle}
                  colorClass="text-amber-500"
                />
                <KpiCard 
                  title="Recapture Required"
                  value="85 km"
                  icon={Activity}
                  colorClass="text-red-500"
                />
              </div>

              {/* Timeseries Chart */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-300 mb-4">Daily Performance</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dailyData}>
                      <defs>
                        <linearGradient id="colorKm" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#64748b" 
                        fontSize={10} 
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis 
                        yAxisId="left"
                        stroke="#0ea5e9" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${val}km`}
                      />
                      <YAxis 
                        yAxisId="right"
                        orientation="right"
                        stroke="#f59e0b" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${val/1000}k`}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }}
                        itemStyle={{ color: '#f8fafc' }}
                      />
                      <Area 
                        yAxisId="left"
                        type="monotone" 
                        dataKey="kmProcessed" 
                        stroke="#0ea5e9" 
                        strokeWidth={2}
                        fillOpacity={1} 
                        fill="url(#colorKm)" 
                      />
                      <Line 
                        yAxisId="right"
                        type="monotone" 
                        dataKey="imagesProcessed" 
                        stroke="#f59e0b" 
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#f59e0b' }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side - Map & Tables */}
          <div className="flex-1 flex flex-col">
            {/* Map Component */}
            <div className="flex-1 relative">
              <MapComponent layerCatalog={layerCatalog} />
            </div>

            {/* Bottom Tables */}
            <div className="h-72 bg-slate-900 border-t border-slate-800 flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-slate-800 px-6">
                <button 
                  onClick={() => setActiveTab('batches')}
                  className={`py-4 px-4 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'batches' 
                      ? 'text-sky-500 border-sky-500' 
                      : 'text-slate-500 border-transparent hover:text-slate-300'
                  }`}
                >
                  Processed Batch Logs
                </button>
                <button 
                  onClick={() => setActiveTab('daily')}
                  className={`py-4 px-4 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'daily' 
                      ? 'text-sky-500 border-sky-500' 
                      : 'text-slate-500 border-transparent hover:text-slate-300'
                  }`}
                >
                  Day-by-Day Processing Ledger
                </button>
              </div>

              {/* Table Content */}
              <div className="flex-1 overflow-auto">
                {activeTab === 'batches' ? (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-800/50 text-slate-400 sticky top-0">
                      <tr>
                        <th className="px-6 py-3 font-medium">Upload Date</th>
                        <th className="px-6 py-3 font-medium">Grid</th>
                        <th className="px-6 py-3 font-medium">Subgrid</th>
                        <th className="px-6 py-3 font-medium">Distance (km)</th>
                        <th className="px-6 py-3 font-medium">Images</th>
                        <th className="px-6 py-3 font-medium">Defects</th>
                        <th className="px-6 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {batchLogs.map((log, i) => (
                        <tr key={log.id || i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-4 text-slate-300 font-mono text-xs">{log.date}</td>
                          <td className="px-6 py-4 text-slate-200 font-semibold">{log.grid}</td>
                          <td className="px-6 py-4 text-slate-300">{log.subgrid}</td>
                          <td className="px-6 py-4 text-slate-200 font-semibold">{log.kmProcessed.toFixed(1)}</td>
                          <td className="px-6 py-4 text-slate-300">{log.images.toLocaleString()}</td>
                          <td className="px-6 py-4 text-amber-400">{log.defects}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              log.status === 'Success' ? 'bg-green-500/10 text-green-400' :
                              log.status === 'Flagged' ? 'bg-amber-500/10 text-amber-400' :
                              'bg-red-500/10 text-red-400'
                            }`}>
                              {log.status === 'Success' ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-800/50 text-slate-400 sticky top-0">
                      <tr>
                        <th className="px-6 py-3 font-medium">Date</th>
                        <th className="px-6 py-3 font-medium">Grid</th>
                        <th className="px-6 py-3 font-medium">Subgrid</th>
                        <th className="px-6 py-3 font-medium">Distance (km)</th>
                        <th className="px-6 py-3 font-medium">Images Processed</th>
                        <th className="px-6 py-3 font-medium">Capture Equipment</th>
                        <th className="px-6 py-3 font-medium">Images Defected</th>
                        <th className="px-6 py-3 font-medium">Publish to USVPRO</th>
                        <th className="px-6 py-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {[...dailyData].reverse().map((log, i) => (
                        <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-4 text-slate-300">{log.date}</td>
                          <td className="px-6 py-4 text-slate-200 font-semibold">{log.grid}</td>
                          <td className="px-6 py-4 text-slate-300">{log.subgrid}</td>
                          <td className="px-6 py-4 text-slate-200 font-semibold">{log.kmProcessed.toFixed(1)}</td>
                          <td className="px-6 py-4 text-slate-300">{log.imagesProcessed.toLocaleString()}</td>
                          <td className="px-6 py-4 text-slate-300">{log.captureEquipment}</td>
                          <td className="px-6 py-4 text-amber-400">{log.imagesDefected}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              log.publishToUSVPRO === 'yes' ? 'bg-green-500/10 text-green-400' :
                              log.publishToUSVPRO === 'need to recheck' ? 'bg-amber-500/10 text-amber-400' :
                              log.publishToUSVPRO === 'in process' ? 'bg-blue-500/10 text-blue-400' :
                              'bg-red-500/10 text-red-400'
                            }`}>
                              {log.publishToUSVPRO}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-300 truncate max-w-[200px]" title={log.action}>
                            {log.action}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
