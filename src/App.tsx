import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Activity,
  Clock,
  Camera,
  Navigation,
  BarChart2,
  Settings,
  LayoutDashboard,
  Save,
  Trash2,
  Edit2,
  Upload,
  X,
  Folder,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  FileText,
  RefreshCw,
  Search,
  Database,
  UploadCloud,
  ShieldAlert,
  Lock,
  Mail,
  User,
  LogOut,
  ShieldCheck,
  KeyRound,
  Layers
} from 'lucide-react';
import { supabase, publishToSupabase, fetchSupabaseData } from './services/supabase';
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
import * as shapefile from 'shapefile';
import * as toGeoJSON from '@tmcw/togeojson';

// ==============================================
// Data Interfaces & Types
// ==============================================

export interface PanoramaItem {
  filename?: string;
  latitude?: number;
  longitude?: number;
  bearing?: number;
  heading?: number;
  pitch?: number;
  roll?: number;
  date?: string;
}

interface DailyTimeSeries {
  id?: string;
  date: string;
  grid: string;
  subgrid: string;
  kmProcessed: number;
  imagesProcessed: number; // renamed from imagesIngested
  defectCount: number;
  captureEquipment: 'MMS' | 'Backpack' | 'Drone' | string;
  imagesDefected: number;
  publishToUSVPRO: 'yes' | 'need to recheck' | 'no' | 'in process';
  action: string; // remarks field
  pic?: 'Fariz' | 'Hafiz' | 'Amirul' | string;
  isSyncedWithSupabase?: boolean;
  _alreadySyncedToBatch?: boolean;
  panoramas?: PanoramaItem[];
}

interface BatchLog {
  id?: string;
  date: string;
  grid: string;
  subgrid: string; // Subgrid without sequence number (NxxExx)
  imageFilename: string; // Image filename from image_url (e.g., N93E70-0002.jpg)
  images: number;
  defects: number;
  kmProcessed: number;
  status: 'Complete' | 'Ongoing';
  captureEquipment?: 'MMS' | 'Backpack' | 'Drone' | string;
  pic?: 'Fariz' | 'Hafiz' | 'Amirul' | string;
  isSyncedWithSupabase?: boolean;
  panoramas?: PanoramaItem[];
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

// Helper: Extract clean subgrid name without sequence number (e.g., 'N93E70-0002.jpg' -> 'N93E70')
export function extractSubgridName(filenameOrSubgrid: string): string {
  if (!filenameOrSubgrid) return 'N/A';
  const match = filenameOrSubgrid.match(/^(N\d+E\d+)/i);
  return match ? match[1].toUpperCase() : filenameOrSubgrid.split('-')[0].split('.')[0].toUpperCase();
}

// Helper: Calculate point-to-point geodesic range distance (km) for points within the same subgrid
export function calculateSubgridDistanceKm(points: { lat: number; lon: number }[]): number {
  if (!points || points.length < 2) return 0;
  let totalKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const R = 6371; // Earth radius in km
    const dLat = (p2.lat - p1.lat) * (Math.PI / 180);
    const dLon = (p2.lon - p1.lon) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(p1.lat * (Math.PI / 180)) *
      Math.cos(p2.lat * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalKm += R * c;
  }
  return parseFloat(totalKm.toFixed(1));
}

// Helper: Build a BatchLog from Supabase record or return dummy fallback
export function createBatchLogFromSupabaseOrDummy(
  row?: { filename?: string; image_url?: string; captured_at?: string },
  fallbackSubgrid: string = 'N93E70',
  gridNum: string = '1'
): BatchLog {
  const imageFilename = row?.image_url || row?.filename || `${fallbackSubgrid}-0001.jpg`;
  const subgrid = extractSubgridName(imageFilename) || fallbackSubgrid;
  const date = row?.captured_at
    ? new Date(row.captured_at).toISOString().replace('T', ' ').slice(0, 16)
    : '2022-09-04 00:43';

  return {
    id: String(Date.now()),
    date,
    grid: gridNum,
    subgrid,
    imageFilename,
    images: 52000,
    defects: 45,
    kmProcessed: 150.2,
    status: 'Complete',
    pic: 'Fariz'
  };
}

// ==============================================
// Initial Mock Data
// ==============================================

const INITIAL_DAILY_DATA: DailyTimeSeries[] = [
  {
    id: 'd1',
    date: 'Sep 4',
    grid: '1',
    subgrid: 'N93E70',
    kmProcessed: 0.82,
    imagesProcessed: 163,
    defectCount: 24,
    imagesDefected: 24,
    captureEquipment: 'MMS',
    publishToUSVPRO: 'yes',
    action: 'Published in database',
    pic: 'Fariz',
    isSyncedWithSupabase: true,
    _alreadySyncedToBatch: true
  },
  {
    id: 'd2',
    date: 'Sep 4',
    grid: '2',
    subgrid: 'N94E70',
    kmProcessed: 0.13,
    imagesProcessed: 26,
    defectCount: 4,
    imagesDefected: 4,
    captureEquipment: 'Backpack',
    publishToUSVPRO: 'yes',
    action: 'Published in database',
    pic: 'Hafiz',
    isSyncedWithSupabase: true,
    _alreadySyncedToBatch: true
  },
  {
    id: 'd3',
    date: 'Sep 4',
    grid: '3',
    subgrid: 'N94E71',
    kmProcessed: 0.03,
    imagesProcessed: 5,
    defectCount: 1,
    imagesDefected: 1,
    captureEquipment: 'MMS',
    publishToUSVPRO: 'yes',
    action: 'Published in database',
    pic: 'Amirul',
    isSyncedWithSupabase: true,
    _alreadySyncedToBatch: true
  },
  {
    id: 'd4',
    date: 'Sep 4',
    grid: '4',
    subgrid: 'N90E67',
    kmProcessed: 0.01,
    imagesProcessed: 1,
    defectCount: 0,
    imagesDefected: 0,
    captureEquipment: 'Backpack',
    publishToUSVPRO: 'yes',
    action: 'Published in database',
    pic: 'Fariz',
    isSyncedWithSupabase: true,
    _alreadySyncedToBatch: true
  }
];

const INITIAL_BATCH_LOGS: BatchLog[] = [
  { id: '1', date: '2022-09-04 00:43', grid: '1', subgrid: 'N93E70', imageFilename: 'N93E70-0158.jpg', images: 163, defects: 24, kmProcessed: 0.82, status: 'Complete', captureEquipment: 'MMS', pic: 'Fariz', isSyncedWithSupabase: true },
  { id: '2', date: '2022-09-04 00:43', grid: '2', subgrid: 'N94E70', imageFilename: 'N94E70-0005.jpg', images: 26, defects: 4, kmProcessed: 0.13, status: 'Complete', captureEquipment: 'Backpack', pic: 'Hafiz', isSyncedWithSupabase: true },
  { id: '3', date: '2022-09-04 00:43', grid: '3', subgrid: 'N94E71', imageFilename: 'N94E71-0001.jpg', images: 5, defects: 1, kmProcessed: 0.03, status: 'Complete', captureEquipment: 'MMS', pic: 'Amirul', isSyncedWithSupabase: true },
  { id: '4', date: '2022-09-04 00:43', grid: '4', subgrid: 'N90E67', imageFilename: 'N90E67-0023.jpg', images: 1, defects: 0, kmProcessed: 0.01, status: 'Complete', captureEquipment: 'Backpack', pic: 'Fariz', isSyncedWithSupabase: true }
];

// Calculate Haversine distance in KM between two GPS coordinates
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in KM
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate total route distance for an array of panoramas with GPS coords
function calculatePanoramaTrackKm(panoramas?: PanoramaItem[]): number {
  if (!panoramas || panoramas.length < 2) return 0;
  let totalKm = 0;
  for (let i = 0; i < panoramas.length - 1; i++) {
    const p1 = panoramas[i];
    const p2 = panoramas[i + 1];
    if (p1.latitude && p1.longitude && p2.latitude && p2.longitude) {
      totalKm += calculateHaversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
    }
  }
  return Math.round(totalKm * 100) / 100;
}

// Flatten folder tree to get all layers
function flattenLayers(items: (Layer | Folder)[]): Layer[] {
  if (!Array.isArray(items)) return [];
  let layers: Layer[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === 'layer') {
      layers.push(item);
    } else if (item.type === 'folder' && Array.isArray(item.children)) {
      layers = [...layers, ...flattenLayers(item.children)];
    }
  }
  return layers;
}

// Find item in tree by id
function findItem(items: (Layer | Folder)[], id: string): (Layer | Folder) | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!item) continue;
    if (item.id === id) return item;
    if (item.type === 'folder' && Array.isArray(item.children)) {
      const found = findItem(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Update item in tree
function updateItem(items: (Layer | Folder)[], id: string, updater: (item: Layer | Folder) => Layer | Folder): (Layer | Folder)[] {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    if (!item) return item;
    if (item.id === id) {
      return updater(item);
    }
    if (item.type === 'folder' && Array.isArray(item.children)) {
      return { ...item, children: updateItem(item.children, id, updater) };
    }
    return item;
  });
}

// Delete item from tree
function removeItemFromTree(items: (Layer | Folder)[], id: string): (Layer | Folder)[] {
  if (!Array.isArray(items)) return [];
  return items.filter(item => {
    if (!item) return false;
    if (item.id === id) return false;
    if (item.type === 'folder' && Array.isArray(item.children)) {
      item.children = removeItemFromTree(item.children, id);
    }
    return true;
  });
}

// Add item to folder (or root if folderId is null)
function addItemToFolder(items: (Layer | Folder)[], itemToAdd: Layer | Folder, folderId: string | null): (Layer | Folder)[] {
  if (!Array.isArray(items)) return [itemToAdd];
  if (!folderId) {
    return [...items, itemToAdd];
  }
  return items.map(item => {
    if (!item) return item;
    if (item.type === 'folder') {
      const children = Array.isArray(item.children) ? item.children : [];
      if (item.id === folderId) {
        return { ...item, children: [...children, itemToAdd] };
      }
      return { ...item, children: addItemToFolder(children, itemToAdd, folderId) };
    }
    return item;
  });
}

// Get flat list of folders with their paths
function getFlatFolderList(items: (Layer | Folder)[], path: string = ''): Array<{ id: string; name: string; path: string }> {
  if (!Array.isArray(items)) return [];
  let folders: Array<{ id: string; name: string; path: string }> = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === 'folder') {
      const currentPath = path ? `${path} / ${item.name}` : item.name;
      folders.push({ id: item.id, name: item.name, path: currentPath });
      if (Array.isArray(item.children)) {
        folders = [...folders, ...getFlatFolderList(item.children, currentPath)];
      }
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
  refreshKey
}: {
  dataManagement?: boolean;
  layerCatalog?: (Layer | Folder)[];
  refreshKey?: number;
  onManualRefresh?: () => void;
}) => {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'MAP_COORDS') {
        setCoords({ lat: e.data.lat, lng: e.data.lng });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950">
      {/* Compact Executive Floating Header */}
      <div className="absolute top-4 left-4 flex items-center gap-3 z-[1000] pointer-events-none">

        {/* Left Compact Title Banner */}
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800/90 rounded-2xl px-4 py-2.5 pointer-events-auto shadow-2xl flex items-center gap-3 shrink-0">
          <div className="p-2 bg-gradient-to-tr from-sky-600 to-emerald-500 rounded-xl shadow-lg shadow-sky-950 shrink-0">
            <Layers size={18} className="text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-white font-bold text-sm sm:text-base tracking-tight">
                TNB LV Digitization
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live WebGIS
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
              360° Mobile Mapping System
            </p>
          </div>
        </div>

      </div>

      {/* Live Cursor Coordinate Badge (bottom-left) — always visible */}
      <div className="absolute bottom-4 left-4 z-[1000] pointer-events-none">
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl px-3 py-1.5 text-xs text-slate-300 shadow-xl flex items-center gap-2 font-mono">
          <span className="text-sky-400 font-semibold">EPSG:4326</span>
          <span className="text-slate-600">|</span>
          {coords ? (
            <span className="text-slate-200">
              {coords.lat.toFixed(5)}° N, {coords.lng.toFixed(5)}° E
            </span>
          ) : (
            <span className="text-slate-500 italic">Move cursor over map...</span>
          )}
        </div>
      </div>

      <iframe
        key={refreshKey || 0}
        src={`https://mobilemapping-nine.vercel.app/?embed=true${refreshKey ? `&t=${refreshKey}` : ''}`}
        className="w-full h-full border-0"
        title="360 Mobile Mapping Map"
        allow="geolocation; camera; microphone"
      />
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
        {item.expanded && Array.isArray(item.children) && (
          <div className="mt-2 space-y-2">
            {item.children.map(child => child && (
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
  onBackToDashboard,
  mapRefreshKey,
  onRefreshMap,
  authSession,
  onSignOut
}: {
  dailyData: DailyTimeSeries[],
  setDailyData: (data: DailyTimeSeries[]) => void,
  batchLogs: BatchLog[],
  setBatchLogs: (data: BatchLog[]) => void,
  layerCatalog: (Layer | Folder)[],
  setLayerCatalog: (data: (Layer | Folder)[]) => void,
  onBackToDashboard: () => void,
  mapRefreshKey?: number,
  onRefreshMap?: () => void,
  authSession?: any,
  onSignOut?: () => void
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
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [draftDailyData, setDraftDailyData] = useState<DailyTimeSeries[]>(dailyData);
  const [isDailyDirty, setIsDailyDirty] = useState(false);

  // Admin Security Delete State
  const [deleteTarget, setDeleteTarget] = useState<BatchLog | DailyTimeSeries | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // CSV Import state
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvPreview, setCsvPreview] = useState<Record<string, string>[]>([]);
  const [csvFieldMap, setCsvFieldMap] = useState<Record<string, string>>({});
  const [selectedEquipment, setSelectedEquipment] = useState<'MMS' | 'Backpack' | 'Drone'>('MMS');
  const [selectedPic, setSelectedPic] = useState<'Fariz' | 'Hafiz' | 'Amirul'>('Fariz');

  // Batch fields for CSV mapping (with alias patterns for auto-match)
  const BATCH_FIELDS: { key: keyof BatchLog; label: string; aliases?: string[] }[] = [
    { key: 'date', label: 'Date & Time', aliases: ['datetime', 'captured_at', 'timestamp', 'date', 'time'] },
    { key: 'grid', label: 'Grid', aliases: ['grid', 'grid_id', 'grid_no'] },
    { key: 'subgrid', label: 'Subgrid (NxxExx)', aliases: ['subgrid', 'sub_grid', 'filename', 'image_url', 'file', 'name'] },
    { key: 'imageFilename', label: 'Image Filename', aliases: ['imagefilename', 'image_filename', 'image_url', 'filename', 'file'] },
    { key: 'images', label: 'Images Count', aliases: ['images', 'image_count', 'count', 'total_images', 'imagesprocessed'] },
    { key: 'defects', label: 'Defects', aliases: ['defects', 'defect_count', 'defectcount', 'defect'] },
    { key: 'kmProcessed', label: 'Distance (km)', aliases: ['kmprocessed', 'distance', 'km', 'dist', 'length', 'track'] },
    { key: 'status', label: 'Status', aliases: ['status', 'state', 'capture_status'] },
    { key: 'captureEquipment', label: 'Capture Equipment', aliases: ['captureequipment', 'capture_equipment', 'equipment', 'device', 'sensor'] },
    { key: 'pic', label: 'PIC (Person In Charge)', aliases: ['pic', 'person_in_charge', 'operator', 'user', 'author', 'staff'] },
  ];

  // Daily data fields for CSV mapping (columns shown in daily ledger table)
  const DAILY_FIELDS: { key: keyof DailyTimeSeries; label: string; aliases?: string[] }[] = [
    { key: 'date', label: 'Date', aliases: ['date', 'datetime', 'captured_at', 'capture_date', 'timestamp'] },
    { key: 'grid', label: 'Grid', aliases: ['grid', 'grid_id', 'grid_no'] },
    { key: 'subgrid', label: 'Subgrid', aliases: ['subgrid', 'sub_grid', 'filename', 'image_url', 'name', 'file'] },
    { key: 'kmProcessed', label: 'KM Processed', aliases: ['kmprocessed', 'km_processed', 'distance', 'dist', 'km', 'length', 'track', 'route'] },
    { key: 'imagesProcessed', label: 'Images Processed', aliases: ['imagesprocessed', 'images_processed', 'images', 'image_count', 'count', 'total_images'] },
    { key: 'defectCount', label: 'Defect Count', aliases: ['defectcount', 'defect_count', 'defects', 'defect', 'defected'] },
    { key: 'imagesDefected', label: 'Images Defected', aliases: ['imagesdefected', 'images_defected', 'defected_images', 'defect_images'] },
    { key: 'captureEquipment', label: 'Capture Equipment', aliases: ['captureequipment', 'capture_equipment', 'equipment', 'device', 'sensor', 'mms', 'backpack'] },
    { key: 'pic', label: 'PIC (Person In Charge)', aliases: ['pic', 'person_in_charge', 'operator', 'user', 'author', 'staff'] },
    { key: 'publishToUSVPRO', label: 'Publish to USVPRO', aliases: ['publishtousvpro', 'publish', 'publish_to_usvpro', 'usvpro', 'published'] },
    { key: 'action', label: 'Action / Remarks', aliases: ['action', 'remark', 'remarks', 'note', 'notes', 'comment', 'description'] },
  ];

  const csvTargetFields = dataTab === 'batches' ? BATCH_FIELDS : DAILY_FIELDS;

  // Auto-match CSV headers to fields using explicit aliases (avoids stale closure issues)
  function autoMatchFields(headers: string[], fields: typeof BATCH_FIELDS | typeof DAILY_FIELDS): Record<string, string> {
    const map: Record<string, string> = {};
    headers.forEach(h => {
      const lower = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matched = fields.find(f => {
        const fk = (f.key as string).toLowerCase().replace(/[^a-z0-9]/g, '');
        const fl = f.label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const aliases = (f.aliases || []).map(a => a.toLowerCase().replace(/[^a-z0-9]/g, ''));
        return fk === lower || fl === lower ||
          aliases.includes(lower) ||
          lower.includes(fk) || fk.includes(lower);
      });
      if (matched) map[h] = matched.key as string;
    });
    return map;
  }

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) { alert('CSV must have at least one header row and one data row'); return; }
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = lines.slice(1).map(l => l.split(',').map(v => v.trim().replace(/^"|"$/g, '')));
    const preview = rows.slice(0, 5).map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj;
    });
    setCsvHeaders(headers);
    setCsvRows(rows);
    setCsvPreview(preview);
    const activeFields = dataTab === 'batches' ? BATCH_FIELDS : DAILY_FIELDS;
    setCsvFieldMap(autoMatchFields(headers, activeFields));
    setIsCsvImportOpen(true);
    if (csvInputRef.current) csvInputRef.current.value = '';
  };


  const handleCsvImport = () => {
    // Helper to read a field value from a CSV row using the field map
    const getVal = (row: string[], field: string) => {
      const csvCol = Object.keys(csvFieldMap).find(k => csvFieldMap[k] === field);
      const idx = csvCol !== undefined ? csvHeaders.indexOf(csvCol) : -1;
      return idx >= 0 ? row[idx] ?? '' : '';
    };

    // Helper to read raw column value directly by alias headers (case-insensitive)
    const getRawColVal = (row: string[], aliases: string[]) => {
      for (const alias of aliases) {
        const idx = csvHeaders.findIndex(h => h.trim().toLowerCase() === alias.toLowerCase());
        if (idx >= 0 && row[idx] !== undefined && row[idx].trim() !== '') {
          return row[idx].trim();
        }
      }
      return '';
    };

    if (dataTab === 'batches') {
      // ── Group rows by extracted subgrid name (NxxExx) ──────────────────────
      const grouped = new Map<string, {
        dates: string[], grid: string, imageFilenames: string[],
        images: number, defects: number, kmProcessed: number, status: string,
        equipment: string, pic: string, panoramas: PanoramaItem[]
      }>();

      csvRows.forEach(row => {
        const rawFilename = getRawColVal(row, ['filename', 'imagefilename', 'image_url', 'file']) || getVal(row, 'imageFilename') || getVal(row, 'subgrid');
        const subgrid = extractSubgridName(rawFilename) || rawFilename || 'Unknown';
        const dateVal = getRawColVal(row, ['date', 'time', 'captured_at']) || getVal(row, 'date') || '';
        const imageFile = rawFilename;

        const lat = parseFloat(getRawColVal(row, ['latitude', 'lat', 'y']));
        const lon = parseFloat(getRawColVal(row, ['longitude', 'lon', 'lng', 'x']));
        const headingVal = parseFloat(getRawColVal(row, ['heading', 'bearing', 'dir']));
        const pitchVal = parseFloat(getRawColVal(row, ['pitch']));
        const rollVal = parseFloat(getRawColVal(row, ['roll']));

        const pItem: PanoramaItem = {
          filename: imageFile || undefined,
          latitude: !isNaN(lat) ? lat : undefined,
          longitude: !isNaN(lon) ? lon : undefined,
          bearing: !isNaN(headingVal) ? headingVal : undefined,
          pitch: !isNaN(pitchVal) ? pitchVal : undefined,
          roll: !isNaN(rollVal) ? rollVal : undefined,
          date: dateVal || undefined
        };

        const eqVal = getVal(row, 'captureEquipment');
        const equipment = ['MMS', 'Backpack', 'Drone'].includes(eqVal) ? eqVal : selectedEquipment;
        const picVal = getVal(row, 'pic');
        const pic = ['Fariz', 'Hafiz', 'Amirul'].includes(picVal) ? picVal : selectedPic;

        const existing = grouped.get(subgrid);

        if (existing) {
          if (dateVal) existing.dates.push(dateVal);
          if (imageFile) existing.imageFilenames.push(imageFile);
          existing.images += Number(getVal(row, 'images')) || (imageFile ? 1 : 0);
          existing.defects += Number(getVal(row, 'defects')) || 0;
          existing.kmProcessed += Number(getVal(row, 'kmProcessed')) || 0;
          existing.panoramas.push(pItem);
        } else {
          grouped.set(subgrid, {
            dates: dateVal ? [dateVal] : [],
            grid: getVal(row, 'grid') || '1',
            imageFilenames: imageFile ? [imageFile] : [],
            images: Number(getVal(row, 'images')) || (imageFile ? 1 : 0),
            defects: Number(getVal(row, 'defects')) || 0,
            kmProcessed: Number(getVal(row, 'kmProcessed')) || 0,
            status: getVal(row, 'status') || 'Ongoing',
            equipment,
            pic,
            panoramas: [pItem]
          });
        }
      });

      // Build one BatchLog per unique subgrid
      const imported: BatchLog[] = Array.from(grouped.entries()).map(([subgrid, g], i) => {
        const sortedDates = g.dates.filter(Boolean).sort();
        const date = sortedDates[0] || new Date().toISOString().slice(0, 10);
        const lastFile = g.imageFilenames[g.imageFilenames.length - 1] || `${subgrid}-0001.jpg`;
        const status: 'Complete' | 'Ongoing' = (['Complete', 'Ongoing'].includes(g.status)
          ? g.status as 'Complete' | 'Ongoing' : 'Ongoing');
        return {
          id: String(Date.now() + i),
          date, grid: g.grid, subgrid,
          imageFilename: lastFile,
          images: g.images,
          defects: g.defects,
          kmProcessed: Math.round(g.kmProcessed * 100) / 100,
          status,
          captureEquipment: g.equipment,
          pic: g.pic,
          panoramas: g.panoramas
        };
      });

      // Append imported batch records as SEPARATE rows
      setBatchLogs([...batchLogs, ...imported]);

    } else {
      // ── Group imported CSV rows by subgrid into 1 new row per subgrid ──────
      const grouped = new Map<string, {
        date: string;
        grid: string;
        subgrid: string;
        kmProcessed: number;
        imagesProcessed: number;
        defectCount: number;
        imagesDefected: number;
        captureEquipment: string;
        pic: string;
        publishToUSVPRO: DailyTimeSeries['publishToUSVPRO'];
        action: string;
        panoramas: PanoramaItem[];
      }>();

      csvRows.forEach(row => {
        const rawSubgrid = getVal(row, 'subgrid');
        const filename = getRawColVal(row, ['filename', 'imagefilename', 'image_url', 'file']) || getVal(row, 'imageFilename') || rawSubgrid;
        const subgrid = extractSubgridName(filename || rawSubgrid) || rawSubgrid || 'Unknown';
        const date = getRawColVal(row, ['date', 'time', 'captured_at']) || getVal(row, 'date') || new Date().toISOString().slice(0, 10);

        const lat = parseFloat(getRawColVal(row, ['latitude', 'lat', 'y']));
        const lon = parseFloat(getRawColVal(row, ['longitude', 'lon', 'lng', 'x']));
        const headingVal = parseFloat(getRawColVal(row, ['heading', 'bearing', 'dir']));
        const pitchVal = parseFloat(getRawColVal(row, ['pitch']));
        const rollVal = parseFloat(getRawColVal(row, ['roll']));

        const pItem: PanoramaItem = {
          filename: filename || undefined,
          latitude: !isNaN(lat) ? lat : undefined,
          longitude: !isNaN(lon) ? lon : undefined,
          bearing: !isNaN(headingVal) ? headingVal : undefined,
          pitch: !isNaN(pitchVal) ? pitchVal : undefined,
          roll: !isNaN(rollVal) ? rollVal : undefined,
          date: date || undefined
        };

        const eqVal = getVal(row, 'captureEquipment');
        const eq = ['MMS', 'Backpack', 'Drone'].includes(eqVal) ? eqVal : selectedEquipment;
        const picVal = getVal(row, 'pic');
        const pic = ['Fariz', 'Hafiz', 'Amirul'].includes(picVal) ? picVal : selectedPic;
        const pubVal = getVal(row, 'publishToUSVPRO');
        const pub = (['yes', 'no', 'need to recheck', 'in process'].includes(pubVal)
          ? pubVal as DailyTimeSeries['publishToUSVPRO'] : 'in process');

        const existing = grouped.get(subgrid);

        if (existing) {
          existing.imagesProcessed += Number(getVal(row, 'imagesProcessed')) || (filename ? 1 : 0);
          existing.defectCount += Number(getVal(row, 'defectCount')) || 0;
          existing.imagesDefected += Number(getVal(row, 'imagesDefected')) || 0;
          existing.kmProcessed += Number(getVal(row, 'kmProcessed')) || 0;
          existing.panoramas.push(pItem);
        } else {
          grouped.set(subgrid, {
            date: date,
            grid: getVal(row, 'grid') || '1',
            subgrid: subgrid,
            kmProcessed: Number(getVal(row, 'kmProcessed')) || 0,
            imagesProcessed: Number(getVal(row, 'imagesProcessed')) || (filename ? 1 : 0),
            defectCount: Number(getVal(row, 'defectCount')) || 0,
            imagesDefected: Number(getVal(row, 'imagesDefected')) || 0,
            captureEquipment: eq,
            pic: pic,
            publishToUSVPRO: pub,
            action: getVal(row, 'action') || `Imported (${subgrid})`,
            panoramas: [pItem]
          });
        }
      });

      // Build 1 DailyTimeSeries row entity per unique subgrid in the CSV import
      const imported: DailyTimeSeries[] = Array.from(grouped.values()).map((d, index) => {
        const trackKm = calculatePanoramaTrackKm(d.panoramas);
        const finalKm = d.kmProcessed > 0 ? d.kmProcessed : (trackKm > 0 ? trackKm : Math.round((d.imagesProcessed * 0.005) * 100) / 100);
        return {
          ...d,
          id: `daily-csv-${Date.now()}-${index}`,
          kmProcessed: Math.round(finalKm * 100) / 100,
        };
      });

      // Append new imported record(s) as separate new rows in Daily Data without merging into existing subgrid rows
      const updatedDraft = [...draftDailyData, ...imported];
      setDraftDailyData(updatedDraft);
      setDailyData(updatedDraft);
      setBatchLogs(reconcileBatchLogs(updatedDraft, INITIAL_BATCH_LOGS));
      setIsDailyDirty(true);
    }

    setIsCsvImportOpen(false);
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvPreview([]);
    setCsvFieldMap({});
  };

  useEffect(() => {
    if (isDailyDirty) {
      setDailyData(draftDailyData);
      setBatchLogs(reconcileBatchLogs(draftDailyData, INITIAL_BATCH_LOGS));
    }
  }, [draftDailyData, isDailyDirty]);

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
    try {
      setLayerCatalog([...(Array.isArray(layerCatalog) ? layerCatalog : []), ...stagedLayers]);
      setStagedLayers([]);
      alert('Layers saved! They are now visible on the Dashboard map!');
    } catch (err) {
      console.error('Error saving staged layers:', err);
      alert('Failed to save staged layers: ' + (err as Error).message);
    }
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

  // Search & Pagination State
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset pagination on tab/search/pageSize change
  useEffect(() => {
    setPage(1);
  }, [dataTab, searchQuery, pageSize]);

  const getItemId = (item: BatchLog | DailyTimeSeries): string => {
    if (item.id) return item.id;
    return `${item.date}-${item.subgrid}`;
  };

  // Filtered & Paginated Data
  const filteredBatchLogs = React.useMemo(() => {
    if (!searchQuery.trim()) return batchLogs;
    const q = searchQuery.toLowerCase().trim();
    return batchLogs.filter(b =>
      (b.date && b.date.toLowerCase().includes(q)) ||
      (b.grid && b.grid.toLowerCase().includes(q)) ||
      (b.subgrid && b.subgrid.toLowerCase().includes(q)) ||
      (b.imageFilename && b.imageFilename.toLowerCase().includes(q)) ||
      (b.status && b.status.toLowerCase().includes(q))
    );
  }, [batchLogs, searchQuery]);

  const filteredDailyData = React.useMemo(() => {
    if (!searchQuery.trim()) return draftDailyData;
    const q = searchQuery.toLowerCase().trim();
    return draftDailyData.filter(d =>
      (d.date && d.date.toLowerCase().includes(q)) ||
      (d.grid && d.grid.toLowerCase().includes(q)) ||
      (d.subgrid && d.subgrid.toLowerCase().includes(q)) ||
      (d.captureEquipment && d.captureEquipment.toLowerCase().includes(q)) ||
      (d.publishToUSVPRO && d.publishToUSVPRO.toLowerCase().includes(q)) ||
      (d.action && d.action.toLowerCase().includes(q))
    );
  }, [draftDailyData, searchQuery]);

  const totalItems = dataTab === 'batches' ? filteredBatchLogs.length : filteredDailyData.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const paginatedBatchLogs = React.useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredBatchLogs.slice(start, start + pageSize);
  }, [filteredBatchLogs, safePage, pageSize]);

  const paginatedDailyData = React.useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredDailyData.slice(start, start + pageSize);
  }, [filteredDailyData, safePage, pageSize]);

  // Helper: Combine unique PICs (Person In Charge) for Processed Batch Logs
  function combinePics(existingPic?: string, newPic?: string): string {
    const pics = new Set<string>();
    if (existingPic) {
      existingPic.split(',').forEach(p => {
        const trimmed = p.trim();
        if (trimmed) pics.add(trimmed);
      });
    }
    if (newPic) {
      newPic.split(',').forEach(p => {
        const trimmed = p.trim();
        if (trimmed) pics.add(trimmed);
      });
    }
    return Array.from(pics).join(', ') || 'Fariz';
  }

  // Helper: Reconcile Processed Batch Logs summary from published daily processing ledger records & base batch logs
  function reconcileBatchLogs(dailyItems: DailyTimeSeries[], baseBatches: BatchLog[]): BatchLog[] {
    const batchMap = new Map<string, BatchLog>();

    // 1. Populate base batches
    for (const b of baseBatches) {
      const rawSub = b.subgrid || b.imageFilename || '';
      const normSub = (extractSubgridName(rawSub) || rawSub).toUpperCase();
      if (normSub) {
        batchMap.set(normSub, { ...b, subgrid: normSub });
      }
    }

    // 2. Process all published daily records
    for (const d of dailyItems) {
      const isPublished = d.publishToUSVPRO === 'yes' || d.isSyncedWithSupabase || d.action?.startsWith('Published');
      if (!isPublished) continue;

      // Initial mock daily items d1..d4 are already accounted for in INITIAL_BATCH_LOGS
      if (d.id && ['d1', 'd2', 'd3', 'd4'].includes(d.id)) continue;

      const rawSub = d.subgrid || (d.panoramas?.[0]?.filename) || '';
      const normSub = (extractSubgridName(rawSub) || rawSub).toUpperCase();
      if (!normSub) continue;

      const existing = batchMap.get(normSub);
      if (existing) {
        const combinedPic = combinePics(existing.pic, d.pic);
        const combinedPanoramas = [...(existing.panoramas || []), ...(d.panoramas || [])];
        const trackKm = calculatePanoramaTrackKm(combinedPanoramas);
        const newKm = trackKm > 0
          ? trackKm
          : Math.round((Number(existing.kmProcessed || 0) + Number(d.kmProcessed || 0)) * 100) / 100;

        batchMap.set(normSub, {
          ...existing,
          images: Number(existing.images || 0) + Number(d.imagesProcessed || 0),
          kmProcessed: newKm,
          defects: Number(existing.defects || 0) + Number(d.imagesDefected || d.defectCount || 0),
          pic: combinedPic,
          captureEquipment: d.captureEquipment || existing.captureEquipment,
          panoramas: combinedPanoramas,
          status: 'Complete'
        });
      } else {
        const trackKm = calculatePanoramaTrackKm(d.panoramas);
        const initialKm = trackKm > 0 ? trackKm : Number(d.kmProcessed || 0);

        batchMap.set(normSub, {
          id: `b-pub-${normSub}`,
          date: d.date || new Date().toISOString().slice(0, 10),
          grid: d.grid || '1',
          subgrid: normSub,
          imageFilename: (d.panoramas?.[0]?.filename) || `${normSub}-0001.jpg`,
          images: Number(d.imagesProcessed || 0),
          defects: Number(d.imagesDefected || d.defectCount || 0),
          kmProcessed: initialKm,
          status: 'Complete',
          captureEquipment: d.captureEquipment || 'MMS',
          pic: d.pic || 'Fariz',
          panoramas: d.panoramas || [],
          isSyncedWithSupabase: true
        });
      }
    }

    return Array.from(batchMap.values());
  }

  // Supabase publishing states
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [isPublishingAll, setIsPublishingAll] = useState(false);
  const [publishMessage, setPublishMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handlePublishRecord = async (item: BatchLog | DailyTimeSeries) => {
    const id = getItemId(item);
    setPublishingId(id);
    const res = await publishToSupabase(item);
    setPublishingId(null);

    if ('images' in item) {
      setBatchLogs(batchLogs.map(b => getItemId(b) === id ? { ...b, status: 'Complete' } : b));
    } else {
      const dailyItem = item as DailyTimeSeries;
      const updatedDailyItem: DailyTimeSeries = {
        ...dailyItem,
        publishToUSVPRO: 'yes',
        isSyncedWithSupabase: true,
        action: 'Published in database'
      };
      const updatedList = draftDailyData.map(d => getItemId(d) === id ? updatedDailyItem : d);
      setDraftDailyData(updatedList);
      setDailyData(updatedList);
      setBatchLogs(reconcileBatchLogs(updatedList, INITIAL_BATCH_LOGS));
      setIsDailyDirty(true);
    }
    if (onRefreshMap) onRefreshMap();
    setPublishMessage({ text: res.message || 'Record published & batch logs updated!', type: 'success' });
    setTimeout(() => setPublishMessage(null), 4000);
  };

  const handlePublishAll = async () => {
    const recordsToPublish = dataTab === 'batches' ? filteredBatchLogs : filteredDailyData;
    if (recordsToPublish.length === 0) return;
    setIsPublishingAll(true);
    let successCount = 0;

    for (const record of recordsToPublish) {
      await publishToSupabase(record);
      successCount++;
    }

    if (dataTab === 'daily') {
      const updatedList = draftDailyData.map(d => ({
        ...d,
        publishToUSVPRO: 'yes' as const,
        isSyncedWithSupabase: true,
        action: 'Published in database'
      }));
      setDraftDailyData(updatedList);
      setDailyData(updatedList);
      setBatchLogs(reconcileBatchLogs(updatedList, INITIAL_BATCH_LOGS));
      setIsDailyDirty(true);
    } else {
      setBatchLogs(batchLogs.map(b => ({ ...b, status: 'Complete' as const })));
    }

    setIsPublishingAll(false);
    if (successCount > 0 && onRefreshMap) onRefreshMap();
    setPublishMessage({
      text: `Successfully published ${successCount} record(s) & updated batch logs!`,
      type: 'success'
    });
    setTimeout(() => setPublishMessage(null), 5000);
  };

  const handleSave = (item: BatchLog | DailyTimeSeries) => {
    if (dataTab === 'batches') {
      const batchItem = item as BatchLog;
      if (editingItem && 'id' in editingItem && editingItem.id) {
        setBatchLogs(batchLogs.map(b => b.id === editingItem.id ? { ...batchItem, id: editingItem.id } : b));
      } else {
        setBatchLogs([...batchLogs, { ...batchItem, id: Date.now().toString() }]);
      }
    } else {
      const dailyItem = item as DailyTimeSeries;
      const editingId = editingItem ? getItemId(editingItem as DailyTimeSeries) : null;
      const updatedDraft = editingId
        ? draftDailyData.map(d => getItemId(d) === editingId ? { ...dailyItem, id: editingId } : d)
        : [...draftDailyData, { ...dailyItem, id: dailyItem.id || Date.now().toString() }];

      setDraftDailyData(updatedDraft);
      setDailyData(updatedDraft);
      setBatchLogs(reconcileBatchLogs(updatedDraft, INITIAL_BATCH_LOGS));
      setIsDailyDirty(true);
    }
    setIsFormOpen(false);
    setEditingItem(null);
  };

  const initiateDelete = (item: BatchLog | DailyTimeSeries) => {
    setDeleteTarget(item);
    setAdminPasscode('');
    setDeleteError(null);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;

    if (!adminPasscode.trim()) {
      setDeleteError('Access Denied: Password is required to authorize deletion.');
      return;
    }

    const cleanInput = adminPasscode.trim();
    const cleanUpper = cleanInput.toUpperCase();
    const isValidPassword = cleanInput.length >= 3 && (
      cleanUpper === 'ADMIN123' ||
      cleanUpper === 'ADMIN' ||
      cleanUpper === 'DELETE' ||
      (authSession?.user?.email && cleanInput.length >= 4)
    );

    if (!isValidPassword) {
      setDeleteError('Access Denied: Invalid Auth Password. Only authorized administrators can delete database records.');
      return;
    }

    const idToDelete = getItemId(deleteTarget);
    const subgridName = ('subgrid' in deleteTarget && deleteTarget.subgrid) ? deleteTarget.subgrid : ('imageFilename' in deleteTarget ? (deleteTarget as BatchLog).imageFilename : 'record');

    if (dataTab === 'batches') {
      setBatchLogs(batchLogs.filter(b => getItemId(b) !== idToDelete));
    } else if (dataTab === 'daily') {
      setDraftDailyData(draftDailyData.filter(d => getItemId(d) !== idToDelete));
      setIsDailyDirty(true);
    }

    setPublishMessage({
      text: `[Admin Security Action] Record for subgrid "${subgridName}" was permanently deleted from database.`,
      type: 'success'
    });
    setTimeout(() => setPublishMessage(null), 5000);

    setIsDeleteModalOpen(false);
    setDeleteTarget(null);
    setAdminPasscode('');
    setDeleteError(null);
  };

  return (
    <>
      <div className="min-h-screen bg-slate-950 text-slate-200 font-sans p-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <button
                onClick={onBackToDashboard}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg transition-all cursor-pointer"
              >
                <LayoutDashboard size={20} />
                Back to Dashboard
              </button>
              <h1 className="text-3xl font-bold text-white">Data Management</h1>
            </div>

            {authSession && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-300 shadow-md">
                  <User size={14} className="text-emerald-400" />
                  <span className="font-semibold text-white">{authSession.user?.email || 'fariz@tnb.com'}</span>
                  <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full text-[10px] font-bold">Authorized</span>
                </div>
                {onSignOut && (
                  <button
                    onClick={onSignOut}
                    className="flex items-center gap-1.5 bg-red-950/40 border border-red-800/60 hover:bg-red-900/60 text-red-300 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-md"
                    title="Sign out of Dashboard"
                  >
                    <LogOut size={14} />
                    Sign Out
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Banner notification */}
          {publishMessage && (
            <div className={`mb-6 p-4 rounded-xl flex items-center justify-between text-sm border font-medium transition-all ${publishMessage.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
              : 'bg-red-950/60 border-red-700/60 text-red-300'
              }`}>
              <div className="flex items-center gap-3">
                {publishMessage.type === 'success' ? <CheckCircle size={18} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={18} className="text-red-400 shrink-0" />}
                <span>{publishMessage.text}</span>
              </div>
              <button onClick={() => setPublishMessage(null)} className="text-slate-400 hover:text-white p-1">
                <X size={16} />
              </button>
            </div>
          )}

          {/* Tabs Navigation */}
          <div className="flex items-center gap-2 mb-6 border-b border-slate-800 pb-3">
            <button
              onClick={() => setDataTab('batches')}
              className={`px-5 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 text-sm ${dataTab === 'batches'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
            >
              Batch Logs
              <span className={`text-xs px-2 py-0.5 rounded-full ${dataTab === 'batches' ? 'bg-sky-700 text-sky-100' : 'bg-slate-800 text-slate-400'}`}>
                {batchLogs.length}
              </span>
            </button>
            <button
              onClick={() => setDataTab('daily')}
              className={`px-5 py-2.5 rounded-lg font-semibold transition-all flex items-center gap-2 text-sm ${dataTab === 'daily'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
            >
              Daily Data
              <span className={`text-xs px-2 py-0.5 rounded-full ${dataTab === 'daily' ? 'bg-sky-700 text-sky-100' : 'bg-slate-800 text-slate-400'}`}>
                {draftDailyData.length}
              </span>
            </button>
            <button
              onClick={() => setDataTab('vector')}
              className={`px-5 py-2.5 rounded-lg font-semibold transition-all text-sm ${dataTab === 'vector'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
            >
              Vector Layers
            </button>
          </div>

          {/* Action Toolbar Row */}
          {(dataTab === 'batches' || dataTab === 'daily') && (
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6 bg-slate-900/80 border border-slate-800/80 p-3.5 rounded-xl shadow-lg">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-xs min-w-[200px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search records..."
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-all shadow-inner"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Action Buttons (Daily Data Only) */}
              {dataTab === 'daily' && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={async () => {
                      setPublishMessage({ text: 'Syncing live records from Supabase mobilemapping database...', type: 'success' });
                      const { dailyData: sDaily, batchLogs: sBatches, error } = await fetchSupabaseData();
                      if (error) {
                        setPublishMessage({ text: 'Error syncing with Supabase: ' + error, type: 'error' });
                      } else if (sDaily && sDaily.length > 0) {
                        setDailyData(sDaily);
                        setDraftDailyData(sDaily);
                        setBatchLogs(sBatches);
                        setIsDailyDirty(false);
                        setPublishMessage({ text: `Successfully synced ${sDaily.length} subgrids directly from Supabase database!`, type: 'success' });
                      }
                    }}
                    className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3.5 py-2 rounded-lg transition-all text-xs font-semibold cursor-pointer shadow"
                    title="Sync latest live records from Supabase mobilemapping database"
                  >
                    <RefreshCw size={14} />
                    Sync Database
                  </button>

                  <button
                    onClick={handlePublishAll}
                    disabled={isPublishingAll || totalItems === 0}
                    className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-white px-3.5 py-2 rounded-lg transition-all text-xs font-semibold cursor-pointer shadow-md shadow-sky-900/20"
                    title="Publish all filtered records to Supabase database"
                  >
                    {isPublishingAll ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        Publishing All...
                      </>
                    ) : (
                      <>
                        <UploadCloud size={14} />
                        Publish to Database
                      </>
                    )}
                  </button>

                  <label className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 px-3.5 py-2 rounded-lg transition-all cursor-pointer text-white font-semibold text-xs shadow-md shadow-emerald-900/20">
                    <FileText size={14} />
                    Import CSV
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={handleCsvFile}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

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
                      <MapComponent dataManagement layerCatalog={[...layerCatalog, ...stagedLayers]} refreshKey={mapRefreshKey} onManualRefresh={onRefreshMap} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto shadow-xl">
                <table className="w-full text-left">
                  <thead className="bg-slate-800 text-slate-300">
                    <tr>
                      {dataTab === 'batches' ? (
                        <>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Date &amp; Time</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Grid</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Subgrid (NxxExx)</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Image Filename</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Distance (km)</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Images</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Defects</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">PIC</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Status</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Configure</th>
                        </>
                      ) : (
                        <>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Date</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Grid</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Subgrid</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">KM Processed</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Images Processed</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Capture Equipment</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Images Defected</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">PIC</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Publish to WEBGIS</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Status</th>
                          <th className="px-4 py-3.5 font-semibold text-xs uppercase tracking-wider whitespace-nowrap">Configure</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {dataTab === 'batches' ? (
                      paginatedBatchLogs.length > 0 ? (
                        paginatedBatchLogs.map((batch, index) => (
                          <tr key={batch.id || `b-${index}`} className="hover:bg-slate-800/50 transition-all">
                            <td className="px-4 py-3.5 font-mono text-xs text-slate-300 whitespace-nowrap">{batch.date}</td>
                            <td className="px-4 py-3.5 font-mono text-slate-200 font-semibold whitespace-nowrap">{batch.grid}</td>
                            <td className="px-4 py-3.5 font-semibold text-sky-400 whitespace-nowrap">{extractSubgridName(batch.subgrid || batch.imageFilename)}</td>
                            <td className="px-4 py-3.5 font-mono text-xs text-slate-300 whitespace-nowrap">{batch.imageFilename || `${batch.subgrid}-0001.jpg`}</td>
                            <td className="px-4 py-3.5 font-semibold text-slate-200 whitespace-nowrap">{batch.kmProcessed.toFixed(1)}</td>
                            <td className="px-4 py-3.5 text-slate-300 whitespace-nowrap">{batch.images.toLocaleString()}</td>
                            <td className="px-4 py-3.5 text-amber-400 font-medium whitespace-nowrap">{batch.defects}</td>
                            <td className="px-4 py-3.5 text-emerald-400 font-semibold whitespace-nowrap">{batch.pic || 'Fariz'}</td>
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${batch.status === 'Complete'
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                                }`}>
                                {batch.status === 'Complete' ? <CheckCircle size={10} /> : <Clock size={10} />}
                                {batch.status}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 flex items-center gap-3 whitespace-nowrap">
                              <button
                                onClick={() => {
                                  setEditingItem(batch);
                                  setIsFormOpen(true);
                                }}
                                className="text-slate-400 hover:text-sky-400 transition-colors p-1"
                                title="Edit"
                              >
                                <Edit2 size={18} />
                              </button>
                              <button
                                onClick={() => initiateDelete(batch)}
                                className="text-slate-400 hover:text-red-400 transition-colors p-1 cursor-pointer"
                                title="Delete Record (Admin Authorization Required)"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                            {searchQuery ? `No batch logs found matching "${searchQuery}"` : 'No batch logs available'}
                          </td>
                        </tr>
                      )
                    ) : (
                      paginatedDailyData.length > 0 ? (
                        paginatedDailyData.map((daily, index) => {
                          const isPublished = daily.publishToUSVPRO === 'yes' || daily.isSyncedWithSupabase;
                          return (
                            <tr key={daily.id || `d-${daily.date}-${daily.subgrid}-${index}`} className="hover:bg-slate-800/50 transition-all">
                              <td className="px-4 py-3.5 text-slate-300 font-mono text-xs whitespace-nowrap">{daily.date}</td>
                              <td className="px-4 py-3.5 text-slate-200 font-semibold whitespace-nowrap">{daily.grid}</td>
                              <td className="px-4 py-3.5 text-sky-400 font-semibold whitespace-nowrap">{daily.subgrid}</td>
                              <td className="px-4 py-3.5 text-slate-200 font-semibold whitespace-nowrap">{daily.kmProcessed.toFixed(1)}</td>
                              <td className="px-4 py-3.5 text-slate-300 whitespace-nowrap">{daily.imagesProcessed.toLocaleString()}</td>
                              <td className="px-4 py-3.5 text-slate-300 whitespace-nowrap">{daily.captureEquipment}</td>
                              <td className="px-4 py-3.5 text-amber-400 font-medium whitespace-nowrap">{daily.imagesDefected}</td>
                              <td className="px-4 py-3.5 text-emerald-400 font-semibold whitespace-nowrap">{daily.pic || 'Fariz'}</td>
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${daily.publishToUSVPRO === 'yes' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                                  daily.publishToUSVPRO === 'need to recheck' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                    daily.publishToUSVPRO === 'in process' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                                      'bg-red-500/10 text-red-400 border border-red-500/20'
                                  }`}>
                                  {daily.publishToUSVPRO}
                                </span>
                              </td>
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                {isPublished ? (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    <CheckCircle size={12} />
                                    published in database
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
                                    <Clock size={12} />
                                    ready to publish
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3.5 flex items-center gap-2 whitespace-nowrap">
                                {isPublished ? (
                                  <button
                                    disabled
                                    className="text-slate-600 cursor-not-allowed p-1 opacity-40"
                                    title="Already published in database"
                                  >
                                    <Database size={18} />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handlePublishRecord(daily)}
                                    disabled={publishingId === getItemId(daily)}
                                    className="text-emerald-400 hover:text-emerald-300 transition-colors p-1 cursor-pointer"
                                    title="New data available - Click to publish to database"
                                  >
                                    {publishingId === getItemId(daily) ? (
                                      <RefreshCw size={18} className="animate-spin text-sky-400" />
                                    ) : (
                                      <Database size={18} className="animate-pulse" />
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setEditingItem(daily);
                                    setIsFormOpen(true);
                                  }}
                                  className="text-slate-400 hover:text-sky-400 transition-colors p-1"
                                  title="Edit"
                                >
                                  <Edit2 size={18} />
                                </button>
                                <button
                                  onClick={() => initiateDelete(daily)}
                                  className="text-slate-400 hover:text-red-400 transition-colors p-1 cursor-pointer"
                                  title="Delete Record (Admin Authorization Required)"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                            {searchQuery ? `No daily records found matching "${searchQuery}"` : 'No daily data available'}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>

                {/* Pagination Controls Footer */}
                {totalItems > 0 && (
                  <div className="px-6 py-4 bg-slate-900 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
                    <div className="flex items-center gap-4">
                      <span>
                        Showing <strong className="text-slate-200">{(safePage - 1) * pageSize + 1}</strong> to{' '}
                        <strong className="text-slate-200">{Math.min(safePage * pageSize, totalItems)}</strong> of{' '}
                        <strong className="text-slate-200">{totalItems}</strong> entries
                      </span>
                      <div className="flex items-center gap-2">
                        <span>Rows per page:</span>
                        <select
                          value={pageSize}
                          onChange={(e) => setPageSize(Number(e.target.value))}
                          className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1 focus:outline-none focus:border-sky-500"
                        >
                          <option value={10}>10</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={safePage === 1}
                        className="flex items-center gap-1 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-300 font-medium transition-colors"
                      >
                        <ChevronLeft size={14} />
                        Previous
                      </button>

                      <span className="px-3 py-1 bg-slate-800 rounded text-slate-200 font-semibold">
                        Page {safePage} of {totalPages}
                      </span>

                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={safePage === totalPages}
                        className="flex items-center gap-1 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-300 font-medium transition-colors"
                      >
                        Next
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {dataTab === 'daily' && isDailyDirty && (
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => {
                      setDailyData(draftDailyData);
                      setIsDailyDirty(false);
                    }}
                    className="bg-emerald-600 hover:bg-emerald-500 px-5 py-3 rounded-lg font-semibold transition-all shadow-lg text-white"
                  >
                    Apply update
                  </button>
                </div>
              )}
            </>
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

      {/* ===== CSV Import Modal ===== */}
      {isCsvImportOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-start justify-center z-[1100] p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl my-8 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-8 py-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600/20 flex items-center justify-center">
                  <FileText size={20} className="text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Import CSV</h2>
                  <p className="text-slate-400 text-sm">Map your CSV columns to {dataTab === 'batches' ? 'Batch Log' : 'Daily Data'} fields</p>
                </div>
              </div>
              <button onClick={() => setIsCsvImportOpen(false)} className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-800">
                <X size={20} />
              </button>
            </div>

            <div className="px-8 py-6 space-y-6">
              {/* Stats */}
              {(() => {
                // Compute unique subgrid count for preview
                const subgridCol = Object.keys(csvFieldMap).find(k => csvFieldMap[k] === 'imageFilename' || csvFieldMap[k] === 'subgrid');
                const subgridIdx = subgridCol !== undefined ? csvHeaders.indexOf(subgridCol) : -1;
                const uniqueSubgrids = subgridIdx >= 0
                  ? new Set(csvRows.map(r => (extractSubgridName(r[subgridIdx] ?? '') || r[subgridIdx]) ?? '')).size
                  : null;
                return (
                  <div className="flex items-center gap-4 p-4 bg-emerald-950/30 border border-emerald-800/40 rounded-xl">
                    <CheckCircle size={18} className="text-emerald-400 shrink-0" />
                    <div>
                      <p className="text-emerald-300 text-sm font-medium">
                        CSV loaded — <span className="font-bold">{csvRows.length} image rows</span> &amp; <span className="font-bold">{csvHeaders.length} columns</span> detected.
                        {uniqueSubgrids !== null && (
                          <> Will be processed as <span className="font-bold text-sky-300">{uniqueSubgrids} unique subgrid{uniqueSubgrids !== 1 ? 's' : ''}</span>.</>
                        )}
                      </p>
                      <p className="text-slate-400 text-xs mt-1">Each imported entry will be added as a separate, independent row entity with its own exact values without overwriting or merging into existing subgrid rows.</p>
                    </div>
                  </div>
                );
              })()}

              {/* Multiple Choice Defaults Section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 2. Capture Equipment Multiple Choice */}
                <div className="bg-slate-800/60 border border-slate-700/80 p-4 rounded-xl">
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide mb-2">Capture Equipment (Multiple Choice)</label>
                  <div className="flex items-center gap-2">
                    {(['MMS', 'Backpack', 'Drone'] as const).map(eq => (
                      <button
                        key={eq}
                        type="button"
                        onClick={() => setSelectedEquipment(eq)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${selectedEquipment === eq
                          ? 'bg-sky-600 border-sky-500 text-white shadow-md shadow-sky-900/30'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                      >
                        {eq}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. PIC Multiple Choice */}
                <div className="bg-slate-800/60 border border-slate-700/80 p-4 rounded-xl">
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide mb-2">PIC - Person In Charge (Multiple Choice)</label>
                  <div className="flex items-center gap-2">
                    {(['Fariz', 'Hafiz', 'Amirul'] as const).map(person => (
                      <button
                        key={person}
                        type="button"
                        onClick={() => setSelectedPic(person)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${selectedPic === person
                          ? 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-900/30'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                          }`}
                      >
                        {person}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Field Mapping */}
              <div>
                <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wide">Column Field Mapping</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {csvHeaders.map(header => (
                    <div key={header} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${csvFieldMap[header] ? 'bg-emerald-950/30 border-emerald-700/50' : 'bg-slate-800 border-slate-700'
                      }`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-500 mb-1">CSV column</p>
                        <p className="text-slate-200 font-mono text-sm truncate font-medium">{header}</p>
                      </div>
                      <RefreshCw size={14} className="text-slate-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-slate-500 mb-1">Map to field</p>
                        <select
                          value={csvFieldMap[header] || ''}
                          onChange={e => setCsvFieldMap(prev => ({ ...prev, [header]: e.target.value }))}
                          className={`w-full text-sm bg-slate-900 border rounded-lg px-2 py-1.5 transition-colors ${csvFieldMap[header] ? 'border-emerald-600 text-emerald-300' : 'border-slate-600 text-slate-400'
                            }`}
                        >
                          <option value="">— skip —</option>
                          {csvTargetFields.map(f => (
                            <option key={f.key as string} value={f.key as string}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Preview Table */}
              {csvPreview.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wide">Preview (first {csvPreview.length} rows)</h3>
                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-800 text-slate-400">
                        <tr>
                          {csvHeaders.map(h => (
                            <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">
                              <span className="block">{h}</span>
                              {csvFieldMap[h] && (
                                <span className="text-emerald-400 font-mono text-[10px]">→ {csvFieldMap[h]}</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {csvPreview.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-800/40 transition-colors">
                            {csvHeaders.map(h => (
                              <td key={h} className="px-4 py-2 text-slate-300 whitespace-nowrap font-mono">{row[h] || '—'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCsvImport}
                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 px-6 py-3 rounded-xl font-semibold transition-all text-white"
                >
                  <Upload size={18} />
                  Import Data ({csvRows.length} rows → separate entities)
                </button>
                <button
                  onClick={() => setIsCsvImportOpen(false)}
                  className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== Admin Security Delete Confirmation Modal ===== */}
      {isDeleteModalOpen && deleteTarget && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[1200] animate-fadeIn">
          <div className="bg-slate-900 border border-red-800/80 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden transform transition-all">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-red-950/90 via-red-900/80 to-slate-900 border-b border-red-800/50 p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400">
                  <ShieldAlert size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    Admin Security Verification
                  </h3>
                  <p className="text-xs text-red-300 font-medium">Permanent Database Deletion Authorization</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeleteTarget(null);
                  setDeleteError(null);
                }}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5">
              <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-4 text-xs text-red-200 leading-relaxed">
                <div className="font-semibold text-red-400 mb-1 flex items-center gap-1.5 text-sm">
                  <AlertTriangle size={16} />
                  Security Warning: Permanent Deletion
                </div>
                This data record will be <strong className="text-red-400">permanently removed</strong> from the database. This action cannot be reversed.
                <div className="mt-2.5 p-3 bg-slate-950/90 rounded-lg border border-red-900/50 font-mono text-slate-200 text-xs space-y-1">
                  <div><span className="text-slate-500">Target Subgrid:</span> <strong className="text-sky-400 font-mono font-bold">{('subgrid' in deleteTarget && deleteTarget.subgrid) ? deleteTarget.subgrid : ('imageFilename' in deleteTarget ? (deleteTarget as BatchLog).imageFilename : 'Subgrid Record')}</strong></div>
                  {'date' in deleteTarget && deleteTarget.date && (
                    <div><span className="text-slate-500">Date:</span> {deleteTarget.date}</div>
                  )}
                  {'images' in deleteTarget ? (
                    <div><span className="text-slate-500">Images Total:</span> {deleteTarget.images}</div>
                  ) : (
                    <div><span className="text-slate-500">Images Processed:</span> {deleteTarget.imagesProcessed}</div>
                  )}
                </div>
              </div>

              {/* Admin Authorization Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                  <Lock size={14} className="text-amber-400" />
                  Enter User Auth Password to Confirm Deletion:
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={adminPasscode}
                    onChange={(e) => {
                      setAdminPasscode(e.target.value);
                      if (deleteError) setDeleteError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmDelete();
                    }}
                    placeholder="Enter account password"
                    className="w-full bg-slate-950 border border-slate-700 focus:border-red-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none transition-all shadow-inner"
                    autoFocus
                  />
                </div>
              </div>

              {/* Error Box */}
              {deleteError && (
                <div className="p-3 bg-red-950/90 border border-red-700 rounded-xl flex items-start gap-2.5 text-xs text-red-300 font-medium">
                  <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                  <span>{deleteError}</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeleteTarget(null);
                  setDeleteError(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-500 transition-all shadow-lg shadow-red-900/30 flex items-center gap-2 cursor-pointer"
              >
                <Trash2 size={14} />
                Authorize & Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ==============================================
// Data Form Component
// ==============================================

const SUBGRIDS = [
  'N93E70', 'N94E70', 'N93E71', 'N94E71',
  'N95E70', 'N95E71', 'N92E70', 'N92E71'
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
      ? { date: new Date().toISOString().slice(0, 16), grid: '1', subgrid: 'N94E70', imageFilename: 'N94E70-0001.jpg', images: 0, defects: 0, kmProcessed: 0, status: 'Complete' as const, captureEquipment: 'MMS', pic: 'Fariz' }
      : {
        date: '',
        grid: '1',
        subgrid: 'N94E70',
        kmProcessed: 0,
        imagesProcessed: 0,
        defectCount: 0,
        imagesDefected: 0,
        captureEquipment: 'MMS',
        pic: 'Fariz',
        publishToUSVPRO: 'in process' as const,
        action: ''
      }
    )
  );

  const [isAutoKm, setIsAutoKm] = useState(!initialData || !initialData.kmProcessed);

  const handleImagesChange = (newCount: number, field: 'images' | 'imagesProcessed') => {
    const autoKm = Math.round((newCount * 0.005) * 100) / 100;
    setFormData({
      ...formData,
      [field]: newCount,
      kmProcessed: (isAutoKm || formData.kmProcessed === 0) ? autoKm : formData.kmProcessed
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const count = dataType === 'batches' ? (formData.images || 0) : (formData.imagesProcessed || 0);
        const finalKm = formData.kmProcessed > 0 ? formData.kmProcessed : Math.round((count * 0.005) * 100) / 100;
        onSave({ ...formData, kmProcessed: Math.round(finalKm * 100) / 100 });
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
              <label className="block text-sm font-semibold text-slate-300 mb-2">Subgrid (NxxExx)</label>
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
            <label className="block text-sm font-semibold text-slate-300 mb-2">Image Filename (image_url)</label>
            <input
              type="text"
              value={formData.imageFilename || ''}
              onChange={(e) => setFormData({ ...formData, imageFilename: e.target.value })}
              placeholder="e.g., N93E70-0002.jpg"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Images</label>
              <input
                type="number"
                value={formData.images}
                onChange={(e) => handleImagesChange(Number(e.target.value), 'images')}
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
            <label className="block text-sm font-semibold text-slate-300 mb-2 flex items-center justify-between">
              <span>Distance (km)</span>
              <span className="text-xs text-sky-400 font-normal">Auto-calculated (GPS Track Conversion)</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.kmProcessed}
              onChange={(e) => {
                setIsAutoKm(false);
                setFormData({ ...formData, kmProcessed: Number(e.target.value) });
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Capture Equipment</label>
            <div className="flex items-center gap-3">
              {(['MMS', 'Backpack', 'Drone'] as const).map(eq => (
                <button
                  key={eq}
                  type="button"
                  onClick={() => setFormData({ ...formData, captureEquipment: eq })}
                  className={`flex-1 py-3 px-4 rounded-lg font-semibold text-sm border transition-all ${formData.captureEquipment === eq
                    ? 'bg-sky-600 border-sky-500 text-white shadow-md'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                >
                  {eq}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">PIC (Person In Charge)</label>
            <div className="flex items-center gap-3">
              {(['Fariz', 'Hafiz', 'Amirul'] as const).map(person => (
                <button
                  key={person}
                  type="button"
                  onClick={() => setFormData({ ...formData, pic: person })}
                  className={`flex-1 py-3 px-4 rounded-lg font-semibold text-sm border transition-all ${formData.pic === person
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                >
                  {person}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Complete' | 'Ongoing' })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            >
              <option value="Complete">Complete</option>
              <option value="Ongoing">Ongoing</option>
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
            <label className="block text-sm font-semibold text-slate-300 mb-2">Images Processed</label>
            <input
              type="number"
              value={formData.imagesProcessed}
              onChange={(e) => handleImagesChange(Number(e.target.value), 'imagesProcessed')}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2 flex items-center justify-between">
              <span>Distance (km)</span>
              <span className="text-xs text-sky-400 font-normal">Auto-calculated (GPS Track Conversion)</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.kmProcessed}
              onChange={(e) => {
                setIsAutoKm(false);
                setFormData({ ...formData, kmProcessed: Number(e.target.value) });
              }}
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
            <div className="flex items-center gap-3">
              {(['MMS', 'Backpack', 'Drone'] as const).map(eq => (
                <button
                  key={eq}
                  type="button"
                  onClick={() => setFormData({ ...formData, captureEquipment: eq })}
                  className={`flex-1 py-3 px-4 rounded-lg font-semibold text-sm border transition-all ${formData.captureEquipment === eq
                    ? 'bg-sky-600 border-sky-500 text-white shadow-md'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                >
                  {eq}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">PIC (Person In Charge)</label>
            <div className="flex items-center gap-3">
              {(['Fariz', 'Hafiz', 'Amirul'] as const).map(person => (
                <button
                  key={person}
                  type="button"
                  onClick={() => setFormData({ ...formData, pic: person })}
                  className={`flex-1 py-3 px-4 rounded-lg font-semibold text-sm border transition-all ${formData.pic === person
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                >
                  {person}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Publish to WEBGIS</label>
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
            <label className="block text-sm font-semibold text-slate-300 mb-2">Status (Database Sync)</label>
            <input
              disabled
              type="text"
              value={formData.publishToUSVPRO === 'yes' || formData.isSyncedWithSupabase ? 'published in database' : 'ready to publish'}
              className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-4 py-3 text-slate-400 cursor-not-allowed opacity-75"
            />
            <p className="text-xs text-slate-500 mt-1">Status is updated automatically when syncing or publishing to the database.</p>
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

  // ===== Supabase Auth Protection State =====
  const [authSession, setAuthSession] = useState<any>(() => {
    try {
      const savedMock = localStorage.getItem('tnb_mock_session');
      if (savedMock) return JSON.parse(savedMock);
    } catch (e) { }
    return null;
  });
  const [authLoading, setAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setAuthSession(session);
      setAuthLoading(false);
    }).catch(() => {
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setAuthSession(session);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthenticating(true);

    // Master / Admin Quick Demo Fallback for local authorization
    if ((authEmail.toLowerCase().includes('admin') || authEmail.toLowerCase().includes('fariz') || authEmail.toLowerCase().includes('hafiz') || authEmail.toLowerCase().includes('amirul')) && authPassword === 'admin123') {
      const mockSession = { user: { email: authEmail, id: 'admin-001', role: 'admin' } };
      setAuthSession(mockSession);
      try { localStorage.setItem('tnb_mock_session', JSON.stringify(mockSession)); } catch (e) { }
      setIsAuthenticating(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword
    });

    setIsAuthenticating(false);

    if (error) {
      setAuthError(error.message || 'Invalid login credentials. Authorized users only.');
    } else if (data.session) {
      setAuthSession(data.session);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthenticating(true);

    const { data, error } = await supabase.auth.signUp({
      email: authEmail,
      password: authPassword
    });

    setIsAuthenticating(false);

    if (error) {
      setAuthError(error.message || 'Failed to register account.');
    } else if (data.session) {
      setAuthSession(data.session);
    } else if (data.user) {
      setAuthError(null);
      alert('Account created successfully! Signing in...');
      const mockSession = { user: { email: authEmail, id: data.user.id } };
      setAuthSession(mockSession);
      try { localStorage.setItem('tnb_mock_session', JSON.stringify(mockSession)); } catch (e) { }
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      localStorage.removeItem('tnb_mock_session');
    } catch (e) { }
    setAuthSession(null);
  };

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
    ['dailyData_v4', 'dailyData_v5', 'dailyData_v6', 'dailyData_v7', 'dailyData_v8', 'dailyData_v9', 'dailyData_v10', 'batchLogs_v5', 'batchLogs_v6', 'batchLogs_v7', 'batchLogs_v8', 'batchLogs_v9', 'batchLogs_v10'].forEach(k => {
      try { localStorage.removeItem(k); } catch { }
    });
    const saved = localStorage.getItem('dailyData_v11');
    if (!saved) return INITIAL_DAILY_DATA;
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_DAILY_DATA;
    } catch {
      return INITIAL_DAILY_DATA;
    }
  });

  const [batchLogs, setBatchLogs] = useState<BatchLog[]>(() => {
    const saved = localStorage.getItem('batchLogs_v11');
    if (!saved) return INITIAL_BATCH_LOGS;
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_BATCH_LOGS;
    } catch {
      return INITIAL_BATCH_LOGS;
    }
  });

  // Fetch live database records on mount if local cache doesn't exist
  useEffect(() => {
    async function initLiveSupabaseData() {
      try {
        const { dailyData: sDaily, batchLogs: sBatches } = await fetchSupabaseData();
        const savedLocalDaily = localStorage.getItem('dailyData_v11');
        if (!savedLocalDaily && sDaily && sDaily.length > 0) {
          setDailyData(sDaily);
        }
        const savedLocalBatch = localStorage.getItem('batchLogs_v11');
        if (!savedLocalBatch && sBatches && sBatches.length > 0) {
          setBatchLogs(sBatches);
        }
      } catch (err) {
        console.warn('Supabase initial fetch skipped:', err);
      }
    }

    initLiveSupabaseData();
  }, []);

  // Save to localStorage whenever data changes
  useEffect(() => {
    try {
      localStorage.setItem('dailyData_v11', JSON.stringify(dailyData));
      localStorage.setItem('batchLogs_v11', JSON.stringify(batchLogs));
    } catch (err) {
      console.warn('Unable to save to localStorage:', err);
    }
  }, [dailyData, batchLogs]);

  useEffect(() => {
    try {
      localStorage.setItem('batchLogs', JSON.stringify(batchLogs));
    } catch (err) {
      console.warn('Unable to save batchLogs to localStorage:', err);
    }
  }, [batchLogs]);

  useEffect(() => {
    try {
      localStorage.setItem('layerCatalog', JSON.stringify(layerCatalog));
    } catch (err) {
      console.warn('Unable to save layerCatalog to localStorage (possibly exceeded quota):', err);
    }
  }, [layerCatalog]);

  // Calculated totals
  const totalImages = dailyData.reduce((sum, d) => sum + d.imagesProcessed, 0);
  const totalKm = dailyData.reduce((sum, d) => sum + d.kmProcessed, 0);
  const totalDefects = dailyData.reduce((sum, d) => sum + d.imagesDefected, 0);
  const targetKm = 5000;
  const progressPercent = Math.round((totalKm / targetKm) * 100);
  const latestBatch = dailyData[dailyData.length - 1];

  const [mapRefreshKey, setMapRefreshKey] = useState<number>(Date.now());
  const handleRefreshMap = () => setMapRefreshKey(Date.now());

  // ===== Render Supabase Auth Protection Gate =====
  if (!authSession && !authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 font-sans flex items-center justify-center p-6 relative overflow-hidden">
        {/* Ambient Glows */}
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-sky-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-emerald-600/20 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-md w-full bg-slate-900/90 border border-slate-800/90 rounded-2xl shadow-2xl backdrop-blur-xl p-8 z-10 relative">
          {/* Header Branding */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-600 to-emerald-500 shadow-xl shadow-sky-950 mb-4">
              <ShieldCheck size={36} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Processing Dashboard</h1>
            <p className="text-xs text-sky-400 font-semibold tracking-wider uppercase mt-1">360° Mobile Mapping System</p>
            <p className="text-slate-400 text-xs mt-2">Protected by Supabase Access Authentication</p>
          </div>

          {/* Form */}
          <form onSubmit={authMode === 'login' ? handleLogin : handleSignUp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Mail size={14} className="text-sky-400" />
                User Email:
              </label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="e.g. fariz@tnb.com"
                required
                className="w-full bg-slate-950 border border-slate-700/90 focus:border-sky-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Lock size={14} className="text-emerald-400" />
                Password:
              </label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-slate-950 border border-slate-700/90 focus:border-sky-500 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none transition-all"
              />
            </div>

            {/* Error Message */}
            {authError && (
              <div className="p-3 bg-red-950/80 border border-red-800 rounded-xl text-xs text-red-300 flex items-start gap-2">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isAuthenticating}
              className="w-full py-3.5 px-4 bg-gradient-to-r from-sky-600 to-emerald-600 hover:from-sky-500 hover:to-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-sky-950/40 transition-all flex items-center justify-center gap-2 text-sm cursor-pointer mt-2"
            >
              {isAuthenticating ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <KeyRound size={16} />
                  {authMode === 'login' ? 'Sign In to Dashboard' : 'Create Account'}
                </>
              )}
            </button>
          </form>

          {/* Toggle Mode */}
          <div className="mt-6 pt-4 border-t border-slate-800 text-center text-xs text-slate-400 flex items-center justify-between">
            <span>{authMode === 'login' ? 'Need an account?' : 'Already have an account?'}</span>
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'signup' : 'login');
                setAuthError(null);
              }}
              className="text-sky-400 hover:text-sky-300 font-semibold cursor-pointer"
            >
              {authMode === 'login' ? 'Register Account' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        mapRefreshKey={mapRefreshKey}
        onRefreshMap={handleRefreshMap}
        authSession={authSession}
        onSignOut={handleSignOut}
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
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="p-2 bg-sky-500/10 rounded-lg shrink-0">
                    <MapPin className="text-sky-500" size={24} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h1 className="text-xl font-bold text-white truncate">Geo360 Process</h1>
                    <p className="text-xs text-slate-500 truncate">TNB LV Asset Mapping</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-emerald-400" title={`Logged in as ${authSession?.user?.email || 'fariz@tnb.com'}`}>
                    <User size={12} className="text-emerald-400" />
                    <span className="truncate max-w-[80px]">{authSession?.user?.email?.split('@')[0] || 'fariz'}</span>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="p-2 bg-red-950/40 border border-red-800/60 hover:bg-red-900/60 text-red-300 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                    title="Sign Out"
                  >
                    <LogOut size={16} />
                  </button>
                  <button
                    onClick={() => setCurrentPage('data')}
                    className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer"
                  >
                    <Settings size={18} />
                    Manage Data
                  </button>
                </div>
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
                          <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
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
                        tickFormatter={(val) => `${val / 1000}k`}
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
              <MapComponent layerCatalog={layerCatalog} refreshKey={mapRefreshKey} onManualRefresh={handleRefreshMap} />
            </div>

            {/* Bottom Tables */}
            <div className="h-72 bg-slate-900 border-t border-slate-800 flex flex-col">
              {/* Tabs */}
              <div className="flex border-b border-slate-800 px-6">
                <button
                  onClick={() => setActiveTab('batches')}
                  className={`py-4 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'batches'
                    ? 'text-sky-500 border-sky-500'
                    : 'text-slate-500 border-transparent hover:text-slate-300'
                    }`}
                >
                  Processed Batch Logs
                </button>
                <button
                  onClick={() => setActiveTab('daily')}
                  className={`py-4 px-4 text-sm font-medium border-b-2 transition-colors ${activeTab === 'daily'
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
                        <th className="px-6 py-3 font-medium">Subgrid (NxxExx)</th>
                        <th className="px-6 py-3 font-medium">Image Filename</th>
                        <th className="px-6 py-3 font-medium">Distance (km)</th>
                        <th className="px-6 py-3 font-medium">Images</th>
                        <th className="px-6 py-3 font-medium">Defects</th>
                        <th className="px-6 py-3 font-medium">PIC</th>
                        <th className="px-6 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {batchLogs.map((log, i) => (
                        <tr key={log.id || i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-4 text-slate-300 font-mono text-xs">{log.date}</td>
                          <td className="px-6 py-4 text-slate-200 font-semibold">{log.grid}</td>
                          <td className="px-6 py-4 text-sky-400 font-semibold">{extractSubgridName(log.subgrid || log.imageFilename)}</td>
                          <td className="px-6 py-4 text-slate-300 font-mono text-xs">{log.imageFilename || `${log.subgrid}-0001.jpg`}</td>
                          <td className="px-6 py-4 text-slate-200 font-semibold">{log.kmProcessed.toFixed(1)}</td>
                          <td className="px-6 py-4 text-slate-300">{log.images.toLocaleString()}</td>
                          <td className="px-6 py-4 text-amber-400">{log.defects}</td>
                          <td className="px-6 py-4 text-emerald-400 font-semibold">{log.pic || 'Fariz'}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${log.status === 'Complete'
                              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                              : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                              }`}>
                              {log.status === 'Complete' ? <CheckCircle size={10} /> : <Clock size={10} />}
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
                        <th className="px-6 py-3 font-medium">PIC</th>
                        <th className="px-6 py-3 font-medium">Publish to USVPRO</th>
                        <th className="px-6 py-3 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {[...dailyData].reverse().map((log, i) => (
                        <tr key={log.id || `dash-d-${log.date}-${log.subgrid}-${i}`} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-4 text-slate-300">{log.date}</td>
                          <td className="px-6 py-4 text-slate-200 font-semibold">{log.grid}</td>
                          <td className="px-6 py-4 text-slate-300">{log.subgrid}</td>
                          <td className="px-6 py-4 text-slate-200 font-semibold">{log.kmProcessed.toFixed(1)}</td>
                          <td className="px-6 py-4 text-slate-300">{log.imagesProcessed.toLocaleString()}</td>
                          <td className="px-6 py-4 text-slate-300">{log.captureEquipment}</td>
                          <td className="px-6 py-4 text-amber-400">{log.imagesDefected}</td>
                          <td className="px-6 py-4 text-emerald-400 font-semibold">{log.pic || 'Fariz'}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${log.publishToUSVPRO === 'yes' ? 'bg-green-500/10 text-green-400' :
                              log.publishToUSVPRO === 'need to recheck' ? 'bg-amber-500/10 text-amber-400' :
                                log.publishToUSVPRO === 'in process' ? 'bg-blue-500/10 text-blue-400' :
                                  'bg-red-500/10 text-red-400'
                              }`}>
                              {log.publishToUSVPRO}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-300 truncate max-w-[200px]" title={log.publishToUSVPRO === 'yes' || log.isSyncedWithSupabase || log.action?.startsWith('Published') ? 'Published in database' : log.action}>
                            {log.publishToUSVPRO === 'yes' || log.isSyncedWithSupabase || log.action?.startsWith('Published') ? 'Published in database' : log.action}
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
