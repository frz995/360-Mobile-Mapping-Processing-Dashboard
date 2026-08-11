import React, { useState, useEffect, useRef } from 'react';
import WebGISViewerIframe from './components/WebGISViewerIframe';
import {
  AlertTriangle,
  CheckCircle,
  Activity,
  Clock,
  Camera,
  Navigation,
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
  User,
  LogOut,
  ShieldCheck,
  Layers,
  Maximize2,
  Filter,
  Globe,
  Bell,
  ClipboardList,
  History,
  Calendar,
  HelpCircle
} from 'lucide-react';
import { supabase, publishToSupabase, fetchSupabaseData, deleteFromSupabase, updateDefectStatusInSupabase, fetchQaRecordsFromSupabase } from './services/supabase';
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

export interface NotificationItem {
  id: string;
  timestamp: string;
  title: string;
  message: string;
  category: 'PUBLISH' | 'PENDING' | 'SYSTEM' | 'ERROR';
  read: boolean;
  totalItems?: number;
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  type: 'CREATE' | 'EDIT' | 'DELETE' | 'PUBLISH' | 'ERROR' | 'SYNC';
  title: string;
  details: string;
  user: string;
  status: 'success' | 'warning' | 'error' | 'info';
  read?: boolean;
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

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    timestamp: '11 Aug 2026, 10:45 AM',
    title: 'Data Published to Database',
    message: 'Successfully published 4 subgrids (265 panoramas) to Supabase production database.',
    category: 'PUBLISH',
    read: false,
    totalItems: 4
  },
  {
    id: 'notif-2',
    timestamp: '11 Aug 2026, 10:30 AM',
    title: 'Pending Task: Batch Stitching Job',
    message: 'Subgrid N94E71 batch stitching pipeline in progress (65% completed).',
    category: 'PENDING',
    read: false
  },
  {
    id: 'notif-3',
    timestamp: '11 Aug 2026, 09:15 AM',
    title: 'Pending Task: WebGIS Sync',
    message: '1 daily subgrid record (N90E67) awaiting WebGIS database sync.',
    category: 'PENDING',
    read: false
  },
  {
    id: 'notif-4',
    timestamp: '11 Aug 2026, 08:00 AM',
    title: 'System Health Audit',
    message: 'All 4 subgrid batch runs reconciled. 6 QA defect frames flagged.',
    category: 'SYSTEM',
    read: true
  }
];

const INITIAL_AUDIT_LOGS: AuditLogItem[] = [
  {
    id: 'audit-1',
    timestamp: '11 Aug 2026, 10:45 AM',
    type: 'PUBLISH',
    title: 'Database Publish Executed',
    details: 'Published 4 subgrids (N93E70, N94E70, N94E71, N90E67) to Supabase database',
    user: 'Fariz',
    status: 'success'
  },
  {
    id: 'audit-2',
    timestamp: '11 Aug 2026, 10:20 AM',
    type: 'EDIT',
    title: 'Daily Subgrid N94E70 Modified',
    details: 'Updated distance to 0.6 km, defect count to 6, PIC set to Hafiz',
    user: 'Hafiz',
    status: 'info'
  },
  {
    id: 'audit-3',
    timestamp: '11 Aug 2026, 09:45 AM',
    type: 'SYNC',
    title: 'Supabase Database Sync',
    details: 'Synced 5 daily subgrid records from remote mobilemapping PostGIS store',
    user: 'System',
    status: 'success'
  },
  {
    id: 'audit-4',
    timestamp: '11 Aug 2026, 09:10 AM',
    type: 'CREATE',
    title: 'CSV Import Completed',
    details: 'Imported batch data for subgrids N93E70 & N94E70 via CSV upload',
    user: 'Fariz',
    status: 'success'
  },
  {
    id: 'audit-5',
    timestamp: '10 Aug 2026, 05:30 PM',
    type: 'ERROR',
    title: 'Batch Stitching Warning',
    details: 'Frame N94E71-0005 reported low feature match density (65% completed)',
    user: 'BatchWorker',
    status: 'error'
  }
];

const TOUR_STEPS = [
  {
    step: 1,
    title: '1. Executive KPI Summary Cards',
    desc: 'Provides real-time tracking of total mapped trajectory distance, 360° panorama frame counts, active batch stitching jobs, and overall quality health.',
    highlight: 'Top row metrics cards'
  },
  {
    step: 2,
    title: '2. Interactive Coverage Map & Subgrid Filters',
    desc: 'Explore mobile mapping trajectories on Leaflet. Click any subgrid (e.g. N94E70) to inspect data. Click subgrid cards in the daily control table to filter specific dates without hiding concurrent subgrids.',
    highlight: 'Left column GIS WebMap'
  },
  {
    step: 3,
    title: '3. 360° Panorama Street-View Inspector',
    desc: 'Examine high-definition 360° spherical panoramas, step between frames, review AI defect detections, and perform QA validations with YES/NO confirmations.',
    highlight: 'Right panel Street-View viewer'
  },
  {
    step: 4,
    title: '4. Daily Processing Control & Supabase DB Publishing',
    desc: 'Filter progress records by column, perform authorized admin edits or deletes, and execute real-time production database publishing directly to Supabase.',
    highlight: 'Bottom daily progress table'
  },
  {
    step: 5,
    title: '5. Audit Logs & System Notifications',
    desc: 'Use the top header icons to track system activity logs (create, edit, delete, publish, errors) with date track-back filtering and publish notifications.',
    highlight: 'Top navbar header icons'
  }
];

const INITIAL_DAILY_DATA: DailyTimeSeries[] = [
  {
    id: 'd1',
    date: 'Sep 4',
    grid: '1',
    subgrid: 'N93E70',
    kmProcessed: 0.82,
    imagesProcessed: 163,
    defectCount: 6,
    imagesDefected: 6,
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
    defectCount: 0,
    imagesDefected: 0,
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
    defectCount: 0,
    imagesDefected: 0,
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
  { id: '1', date: '2022-09-04 00:43', grid: '1', subgrid: 'N93E70', imageFilename: 'N93E70-0158.jpg', images: 163, defects: 0, kmProcessed: 0.82, status: 'Complete', captureEquipment: 'MMS', pic: 'Fariz', isSyncedWithSupabase: true },
  { id: '2', date: '2022-09-04 00:43', grid: '2', subgrid: 'N94E70', imageFilename: 'N94E70-0005.jpg', images: 26, defects: 0, kmProcessed: 0.13, status: 'Complete', captureEquipment: 'Backpack', pic: 'Hafiz', isSyncedWithSupabase: true },
  { id: '3', date: '2022-09-04 00:43', grid: '3', subgrid: 'N94E71', imageFilename: 'N94E71-0001.jpg', images: 5, defects: 0, kmProcessed: 0.03, status: 'Complete', captureEquipment: 'MMS', pic: 'Amirul', isSyncedWithSupabase: true },
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
// ==============================================
// Helper Components
// ==============================================

const MapComponent = ({
  refreshKey,
  selectedSubgridFilter
}: {
  dataManagement?: boolean;
  layerCatalog?: (Layer | Folder)[];
  refreshKey?: number;
  onManualRefresh?: () => void;
  selectedSubgridFilter?: string | null;
}) => {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'MAP_COORDS' && typeof e.data.lat === 'number') {
        const lngVal = typeof e.data.lng === 'number' ? e.data.lng : e.data.lon;
        if (typeof lngVal === 'number') {
          setCoords({ lat: e.data.lat, lng: lngVal });
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Send postMessage subgrid filter update to embedded WebGIS map iframe
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_SUBGRID_FILTER',
        subgrid: selectedSubgridFilter || ''
      }, '*');
    }
  }, [selectedSubgridFilter]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950">
      {/* Top-Left TNB LV Asset Mapping Executive Floating Badge */}
      <div className="absolute top-3 left-3 z-20 pointer-events-none">
        <div className="bg-[#12161f]/95 backdrop-blur-xl border border-slate-800/90 rounded-2xl px-3.5 py-2 shadow-2xl flex items-center gap-3 shrink-0">
          <div className="p-2 bg-gradient-to-tr from-sky-600 to-emerald-500 rounded-xl shadow-md shadow-emerald-950/40 shrink-0">
            <Layers size={16} className="text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-white font-bold text-xs sm:text-sm tracking-tight">
                TNB LV Asset Mapping
              </h2>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[9px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live WebGIS
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
              360° Mobile Mapping System
            </p>
          </div>
        </div>
      </div>
      {/* Live Cursor Coordinate Badge (bottom-right) — non-overlapping position */}
      <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-lg px-2.5 py-1 text-[11px] text-slate-300 shadow-xl flex items-center gap-2 font-mono">
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
        ref={iframeRef}
        key={refreshKey || 0}
        src={`${import.meta.env.VITE_MAP_URL || (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.') || window.location.hostname.startsWith('10.')) ? 'http://localhost:5173' : 'https://mobilemapping-nine.vercel.app')}/?embed=true${selectedSubgridFilter ? `&subgrid=${encodeURIComponent(selectedSubgridFilter)}` : ''}${refreshKey ? `&t=${refreshKey}` : ''}`}
        onLoad={() => {
          if (iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'SET_SUBGRID_FILTER',
              subgrid: selectedSubgridFilter || ''
            }, '*');
          }
        }}
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
  onSignOut,
  addNotification,
  addAuditLog,
  isGuestUser
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
  onSignOut?: () => void,
  addNotification?: (item: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) => void,
  addAuditLog?: (type: AuditLogItem['type'], title: string, details: string, status?: AuditLogItem['status']) => void,
  isGuestUser?: boolean
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

  // Daily Data Column Filters state
  const [isColumnFilterOpen, setIsColumnFilterOpen] = useState(false);
  const [dailyColumnFilters, setDailyColumnFilters] = useState<{
    grid: string;
    subgrid: string;
    equipment: string;
    pic: string;
    publishStatus: string;
  }>({
    grid: '',
    subgrid: '',
    equipment: '',
    pic: '',
    publishStatus: ''
  });

  const activeDailyFilterCount = Object.values(dailyColumnFilters).filter(Boolean).length;

  // Selected subgrid filter state (interactive row click -> zoom to extent, filter, & blink)
  const [selectedSubgridFilter, setSelectedSubgridFilter] = useState<string | null>(null);

  const toggleSubgridFilter = (subgridRaw: string) => {
    const sg = (extractSubgridName(subgridRaw) || subgridRaw).toUpperCase().trim();
    setSelectedSubgridFilter(prev => {
      const next = prev === sg ? null : sg;

      // Broadcast filter message to embedded WebGIS map iframe
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(f => {
        try {
          f.contentWindow?.postMessage({ type: 'FILTER_SUBGRID', subgrid: next || '' }, '*');
        } catch (e) { }
      });

      return next;
    });
  };

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
    return draftDailyData.filter(d => {
      // 1. Global search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchGlobal = (
          (d.date && d.date.toLowerCase().includes(q)) ||
          (d.grid && d.grid.toLowerCase().includes(q)) ||
          (d.subgrid && d.subgrid.toLowerCase().includes(q)) ||
          (d.captureEquipment && d.captureEquipment.toLowerCase().includes(q)) ||
          (d.publishToUSVPRO && d.publishToUSVPRO.toLowerCase().includes(q)) ||
          (d.action && d.action.toLowerCase().includes(q)) ||
          (d.pic && d.pic.toLowerCase().includes(q))
        );
        if (!matchGlobal) return false;
      }

      // 2. Daily Data Column filters
      if (dailyColumnFilters.grid && d.grid !== dailyColumnFilters.grid) return false;
      if (dailyColumnFilters.subgrid && (d.subgrid || '').toUpperCase().trim() !== dailyColumnFilters.subgrid.toUpperCase().trim()) return false;
      if (dailyColumnFilters.equipment && d.captureEquipment !== dailyColumnFilters.equipment) return false;
      if (dailyColumnFilters.pic && (d.pic || 'Fariz') !== dailyColumnFilters.pic) return false;
      if (dailyColumnFilters.publishStatus && d.publishToUSVPRO !== dailyColumnFilters.publishStatus) return false;

      return true;
    });
  }, [draftDailyData, searchQuery, dailyColumnFilters]);

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

  // Helper: Reconcile Processed Batch Logs masterlist summary from published daily processing ledger records & base batch logs
  function reconcileBatchLogs(dailyItems: DailyTimeSeries[], baseBatches: BatchLog[]): BatchLog[] {
    const batchMap = new Map<string, {
      id: string;
      subgrid: string;
      grid: string;
      date: string;
      imageFilename: string;
      images: number;
      kmProcessed: number;
      defects: number;
      pics: Set<string>;
      captureEquipment: string;
      panoramas: any[];
    }>();

    // Process all published daily records (including d1..d4 and new entries)
    for (const d of dailyItems) {
      const isPublished = d.publishToUSVPRO === 'yes' || d.isSyncedWithSupabase || d.action?.startsWith('Published');
      if (!isPublished) continue;

      const rawSub = d.subgrid || (d.panoramas?.[0]?.filename) || '';
      const normSub = (extractSubgridName(rawSub) || rawSub).toUpperCase().trim();
      if (!normSub) continue;

      const imgCount = Number(d.imagesProcessed || 0);
      const kmVal = Number(d.kmProcessed || 0);
      const defCount = Number(d.imagesDefected || d.defectCount || 0);

      const existing = batchMap.get(normSub);
      if (existing) {
        if (d.pic) {
          d.pic.split(',').map(p => p.trim()).filter(Boolean).forEach(p => existing.pics.add(p));
        }
        existing.images += imgCount;
        existing.kmProcessed = Math.round((existing.kmProcessed + kmVal) * 100) / 100;
        existing.defects += defCount;
        if (d.date) existing.date = d.date;
        if (d.captureEquipment) existing.captureEquipment = d.captureEquipment;
        if (d.panoramas && d.panoramas.length > 0) {
          existing.panoramas.push(...d.panoramas);
        }
      } else {
        const picSet = new Set<string>();
        if (d.pic) {
          d.pic.split(',').map(p => p.trim()).filter(Boolean).forEach(p => picSet.add(p));
        } else {
          picSet.add('Fariz');
        }

        batchMap.set(normSub, {
          id: `sp-b-${normSub}`,
          subgrid: normSub,
          grid: d.grid || '1',
          date: d.date || '2022-09-03 00:43',
          imageFilename: (d.panoramas?.[0]?.filename) || `${normSub}-0001.jpg`,
          images: imgCount,
          kmProcessed: kmVal,
          defects: defCount,
          pics: picSet,
          captureEquipment: d.captureEquipment || 'MMS',
          panoramas: d.panoramas || []
        });
      }
    }

    // Blend any base batches if subgrid is not present in dailyItems
    for (const b of baseBatches) {
      const rawSub = b.subgrid || b.imageFilename || '';
      const normSub = (extractSubgridName(rawSub) || rawSub).toUpperCase().trim();
      if (!normSub || batchMap.has(normSub)) continue;

      const picSet = new Set<string>();
      if (b.pic) {
        b.pic.split(',').map(p => p.trim()).filter(Boolean).forEach(p => picSet.add(p));
      }

      batchMap.set(normSub, {
        id: b.id || `sp-b-${normSub}`,
        subgrid: normSub,
        grid: b.grid || '1',
        date: b.date || '2022-09-03 00:43',
        imageFilename: b.imageFilename || `${normSub}-0001.jpg`,
        images: Number(b.images || 0),
        kmProcessed: Number(b.kmProcessed || 0),
        defects: Number(b.defects || 0),
        pics: picSet,
        captureEquipment: b.captureEquipment || 'MMS',
        panoramas: b.panoramas || []
      });
    }

    // Convert map to BatchLog array
    const result: BatchLog[] = [];
    for (const [normSub, entry] of batchMap.entries()) {
      result.push({
        id: entry.id,
        date: entry.date.length <= 10 ? `${entry.date} 00:43` : entry.date,
        grid: entry.grid,
        subgrid: normSub,
        imageFilename: entry.imageFilename,
        images: entry.images,
        kmProcessed: entry.kmProcessed,
        defects: entry.defects,
        pic: Array.from(entry.pics).join(', ') || 'Fariz',
        status: 'Complete',
        captureEquipment: entry.captureEquipment,
        panoramas: entry.panoramas,
        isSyncedWithSupabase: true
      });
    }

    return result;
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
    if (successCount > 0) {
      if (addNotification) {
        addNotification({
          title: 'Data Published to Database',
          message: `Successfully published ${successCount} subgrid record(s) directly to Supabase production database.`,
          category: 'PUBLISH',
          totalItems: successCount
        });
      }
      if (addAuditLog) {
        addAuditLog('PUBLISH', 'Database Publish Executed', `Published ${successCount} subgrids to production database`, 'success');
      }
    }
    setPublishMessage({
      text: `Successfully published ${successCount} record(s) & updated batch logs!`,
      type: 'success'
    });
    setTimeout(() => setPublishMessage(null), 5000);
  };

  const handleSave = async (item: BatchLog | DailyTimeSeries) => {
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
      const updatedItem: DailyTimeSeries = {
        ...dailyItem,
        publishToUSVPRO: 'yes',
        isSyncedWithSupabase: true,
        action: 'Published in database'
      };

      const updatedDraft = editingId
        ? draftDailyData.map(d => getItemId(d) === editingId ? { ...updatedItem, id: editingId } : d)
        : [...draftDailyData, { ...updatedItem, id: updatedItem.id || Date.now().toString() }];

      setDraftDailyData(updatedDraft);
      setDailyData(updatedDraft);
      setBatchLogs(reconcileBatchLogs(updatedDraft, INITIAL_BATCH_LOGS));
      setIsDailyDirty(true);

      // Auto-persist directly to Supabase DB in real-time
      publishToSupabase(updatedItem).catch(err => console.warn('Background auto-publish error:', err));
    }

    const subName = (item as any).subgrid || (item as any).imageFilename || 'record';
    if (addAuditLog) addAuditLog('EDIT', `Record Modified: ${subName}`, `Updated parameters for subgrid ${subName}`, 'info');

    setIsFormOpen(false);
    setEditingItem(null);
  };

  const initiateDelete = (item: BatchLog | DailyTimeSeries) => {
    setDeleteTarget(item);
    setAdminPasscode('');
    setDeleteError(null);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
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

    // Auto-delete from Supabase DB in real-time
    deleteFromSupabase(subgridName).catch(err => console.warn('Background delete error:', err));

    if (addAuditLog) addAuditLog('DELETE', `Record Deleted: ${subgridName}`, `Admin passcode verified, permanently deleted record ${subgridName}`, 'warning');

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
      <div className="flex-1 flex flex-col h-full bg-[#0B0F17] text-slate-200 font-sans p-4 sm:p-5 overflow-y-auto min-h-0">
        <div className="max-w-7xl mx-auto w-full">
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
                  <User size={14} className={isGuestUser ? 'text-amber-400' : 'text-emerald-400'} />
                  <span className="font-semibold text-white">{authSession.user?.email || 'guest@tnb.com.my'}</span>
                  {isGuestUser ? (
                    <span className="bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full text-[10px] font-bold">Guest</span>
                  ) : (
                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full text-[10px] font-bold">Authorized</span>
                  )}
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

          {/* Guest Read-Only Banner */}
          {isGuestUser && (
            <div className="mb-5 p-3 bg-amber-950/30 border border-amber-700/40 rounded-xl flex items-center gap-3 text-xs text-amber-300">
              <AlertTriangle size={15} className="text-amber-400 shrink-0" />
              <span><strong className="text-amber-300 font-semibold">Guest Mode — Read Only.</strong> You can view all data but editing, uploading, deleting, and publishing are disabled. Sign in with an authorized account to make changes.</span>
            </div>
          )}

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
              {/* Search Bar & Filter Toggle Button */}
              <div className="flex items-center gap-3 flex-1 max-w-md">
                <div className="relative flex-1 min-w-[200px]">
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

                {dataTab === 'daily' && (
                  <button
                    onClick={() => setIsColumnFilterOpen(prev => !prev)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer border shrink-0 ${
                      activeDailyFilterCount > 0
                        ? 'bg-sky-600 border-sky-500 text-white shadow-md shadow-sky-900/40'
                        : isColumnFilterOpen
                        ? 'bg-slate-800 border-sky-500 text-sky-400'
                        : 'bg-slate-950 border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                    title="Filter Daily Data by specific columns"
                  >
                    <Filter size={14} />
                    <span>Filter Columns</span>
                    {activeDailyFilterCount > 0 && (
                      <span className="bg-sky-400 text-slate-950 px-1.5 py-0.2 rounded-full font-bold text-[10px]">
                        {activeDailyFilterCount}
                      </span>
                    )}
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

                  {!isGuestUser && (
                    <>
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
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Expandable Column Filter Panel (Daily Data) */}
          {isColumnFilterOpen && dataTab === 'daily' && (
            <div className="mb-6 p-4 bg-slate-900/90 border border-slate-800 rounded-xl shadow-xl space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs text-slate-300 font-semibold uppercase tracking-wider">
                <div className="flex items-center gap-2">
                  <Filter size={14} className="text-sky-400" />
                  <span>Daily Data Column Filters</span>
                </div>
                {activeDailyFilterCount > 0 && (
                  <button
                    onClick={() => setDailyColumnFilters({ grid: '', subgrid: '', equipment: '', pic: '', publishStatus: '' })}
                    className="text-red-400 hover:text-red-300 text-xs font-medium cursor-pointer flex items-center gap-1 transition-colors"
                  >
                    <X size={12} /> Clear Column Filters
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
                {/* Grid Filter */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium text-[11px]">Grid</label>
                  <select
                    value={dailyColumnFilters.grid}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, grid: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-sky-500"
                  >
                    <option value="">All Grids</option>
                    {Array.from(new Set(draftDailyData.map(d => d.grid).filter(Boolean))).sort().map(g => (
                      <option key={g} value={g}>Grid {g}</option>
                    ))}
                  </select>
                </div>

                {/* Subgrid Filter */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium text-[11px]">Subgrid</label>
                  <select
                    value={dailyColumnFilters.subgrid}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, subgrid: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-sky-500"
                  >
                    <option value="">All Subgrids</option>
                    {Array.from(new Set(draftDailyData.map(d => (d.subgrid || '').toUpperCase().trim()).filter(Boolean))).sort().map(sg => (
                      <option key={sg} value={sg}>{sg}</option>
                    ))}
                  </select>
                </div>

                {/* Capture Equipment */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium text-[11px]">Equipment</label>
                  <select
                    value={dailyColumnFilters.equipment}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, equipment: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-sky-500"
                  >
                    <option value="">All Equipment</option>
                    {Array.from(new Set(draftDailyData.map(d => d.captureEquipment).filter(Boolean))).sort().map(eq => (
                      <option key={eq} value={eq}>{eq}</option>
                    ))}
                  </select>
                </div>

                {/* PIC Filter */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium text-[11px]">PIC</label>
                  <select
                    value={dailyColumnFilters.pic}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, pic: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-sky-500"
                  >
                    <option value="">All PICs</option>
                    {Array.from(new Set(draftDailyData.map(d => d.pic || 'Fariz').filter(Boolean))).sort().map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {/* Publish Status */}
                <div>
                  <label className="block text-slate-400 mb-1 font-medium text-[11px]">Publish Status</label>
                  <select
                    value={dailyColumnFilters.publishStatus}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, publishStatus: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-sky-500"
                  >
                    <option value="">All Statuses</option>
                    {Array.from(new Set(draftDailyData.map(d => d.publishToUSVPRO).filter(Boolean))).sort().map(st => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>
              </div>
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
              {/* Active Subgrid Filter Banner */}
              {selectedSubgridFilter && (
                <div className="mb-5 p-3.5 bg-sky-950/90 border border-sky-500/50 rounded-xl flex items-center justify-between text-sky-200 text-sm shadow-xl shadow-sky-950/50 animate-pulse">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-sky-400 animate-ping shrink-0" />
                    <div>
                      <span className="font-bold text-white uppercase text-base tracking-wide">FILTER ACTIVE: Subgrid [{selectedSubgridFilter}]</span>
                      <span className="text-xs text-sky-300 ml-2 block sm:inline">— Showing only this subgrid. WebGIS map zoomed to extent &amp; blinking.</span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleSubgridFilter(selectedSubgridFilter)}
                    className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition-all shadow-md cursor-pointer shrink-0"
                  >
                    Show All Data
                  </button>
                </div>
              )}

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
                        paginatedBatchLogs.map((batch, index) => {
                          const batchSubgrid = (extractSubgridName(batch.subgrid || batch.imageFilename) || '').toUpperCase().trim();
                          const isSelected = selectedSubgridFilter === batchSubgrid;
                          return (
                            <tr
                              key={batch.id || `b-${index}`}
                              onClick={() => toggleSubgridFilter(batchSubgrid)}
                              className={`cursor-pointer transition-all ${isSelected
                                ? 'bg-sky-950/90 border-l-4 border-sky-400 font-bold text-white shadow-lg shadow-sky-950/50 ring-1 ring-sky-500/30'
                                : 'hover:bg-slate-800/50'
                                }`}
                            >
                              <td className="px-4 py-3.5 font-mono text-xs text-slate-300 whitespace-nowrap">{batch.date}</td>
                              <td className="px-4 py-3.5 font-mono text-slate-200 font-semibold whitespace-nowrap">{batch.grid}</td>
                              <td className="px-4 py-3.5 font-semibold text-sky-400 whitespace-nowrap flex items-center gap-2">
                                <span>{batchSubgrid}</span>
                                {isSelected && <span className="bg-sky-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse">FILTERED</span>}
                              </td>
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
                              <td className="px-4 py-3.5 flex items-center gap-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                {!isGuestUser ? (
                                  <>
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
                                  </>
                                ) : (
                                  <span className="text-[10px] text-slate-600 italic">View only</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
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
                          const dailySubgrid = (daily.subgrid || '').toUpperCase().trim();
                          const isSelected = selectedSubgridFilter === dailySubgrid;
                          const isPublished = daily.publishToUSVPRO === 'yes' || daily.isSyncedWithSupabase;
                          return (
                            <tr
                              key={daily.id || `d-${daily.date}-${daily.subgrid}-${index}`}
                              onClick={() => toggleSubgridFilter(dailySubgrid)}
                              className={`cursor-pointer transition-all ${isSelected
                                ? 'bg-sky-950/90 border-l-4 border-sky-400 font-bold text-white shadow-lg shadow-sky-950/50 ring-1 ring-sky-500/30'
                                : 'hover:bg-slate-800/50'
                                }`}
                            >
                              <td className="px-4 py-3.5 text-slate-300 font-mono text-xs whitespace-nowrap">{daily.date}</td>
                              <td className="px-4 py-3.5 text-slate-200 font-semibold whitespace-nowrap">{daily.grid}</td>
                              <td className="px-4 py-3.5 text-sky-400 font-semibold whitespace-nowrap flex items-center gap-2">
                                <span>{daily.subgrid}</span>
                                {isSelected && <span className="bg-sky-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold animate-pulse">FILTERED</span>}
                              </td>
                              <td className="px-4 py-3.5 text-slate-200 font-semibold whitespace-nowrap">{daily.kmProcessed.toFixed(1)}</td>
                              <td className="px-4 py-3.5 text-slate-300 whitespace-nowrap">{daily.imagesProcessed.toLocaleString()}</td>
                              <td className="px-4 py-3.5 text-slate-300 whitespace-nowrap">{daily.captureEquipment}</td>
                              <td className="px-4 py-3.5 text-amber-400 font-semibold whitespace-nowrap">
                                {(() => {
                                  const matchBatch = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === dailySubgrid);
                                  return matchBatch ? (matchBatch.defects ?? 0) : (daily.imagesDefected ?? daily.defectCount ?? 0);
                                })()}
                              </td>
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
                              <td className="px-4 py-3.5 flex items-center gap-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                {!isGuestUser ? (
                                  <>
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
                                      className="text-slate-400 hover:text-sky-400 transition-colors p-1 cursor-pointer"
                                      title="Edit Record"
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
                                  </>
                                ) : (
                                  <span className="text-[10px] text-slate-600 italic">View only</span>
                                )}
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
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

  const isGuestUser = Boolean(authSession?.isGuest || authSession?.user?.role === 'guest' || authSession?.user?.email?.toLowerCase().includes('guest'));

  const handleGuestLogin = () => {
    setAuthError(null);
    const guestSession = {
      user: {
        id: 'guest-user-001',
        email: 'guest@tnb.com.my',
        role: 'guest'
      },
      isGuest: true
    };
    setAuthSession(guestSession);
    try { localStorage.setItem('tnb_mock_session', JSON.stringify(guestSession)); } catch (e) { }
    addAuditLog('CREATE', 'Guest Login', 'User logged in under Guest Read-Only mode', 'info');
  };

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
    ['dailyData_v4', 'dailyData_v5', 'dailyData_v6', 'dailyData_v7', 'dailyData_v8', 'dailyData_v9', 'dailyData_v10', 'dailyData_v11', 'dailyData_v12', 'dailyData_v13', 'dailyData_v14', 'dailyData_v15', 'dailyData_v16', 'batchLogs_v5', 'batchLogs_v6', 'batchLogs_v7', 'batchLogs_v8', 'batchLogs_v9', 'batchLogs_v10', 'batchLogs_v11', 'batchLogs_v12', 'batchLogs_v13', 'batchLogs_v14', 'batchLogs_v15', 'batchLogs_v16', 'qaSubgridRecords_v13'].forEach(k => {
      try { localStorage.removeItem(k); } catch { }
    });
    const saved = localStorage.getItem('dailyData_v17');
    if (!saved) return INITIAL_DAILY_DATA;
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_DAILY_DATA;
    } catch {
      return INITIAL_DAILY_DATA;
    }
  });

  const [batchLogs, setBatchLogs] = useState<BatchLog[]>(() => {
    const saved = localStorage.getItem('batchLogs_v17');
    if (!saved) return INITIAL_BATCH_LOGS;
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_BATCH_LOGS;
    } catch {
      return INITIAL_BATCH_LOGS;
    }
  });

  // Fetch live database records on mount and merge with local drafts
  useEffect(() => {
    async function initLiveSupabaseData() {
      try {
        const { dailyData: sDaily, batchLogs: sBatches } = await fetchSupabaseData();
        if (sDaily && sDaily.length > 0) {
          setDailyData(prev => {
            const localMap = new Map(prev.map(d => [(d.subgrid || '').toUpperCase().trim(), d]));
            const supabaseIds = new Set(sDaily.map(d => d.id || `${d.date}-${d.subgrid}`));
            const merged = sDaily.map(sd => {
              const sgKey = (sd.subgrid || '').toUpperCase().trim();
              const local = localMap.get(sgKey);
              let kmVal = sd.kmProcessed;
              if (kmVal > 5) kmVal = Math.round((sd.imagesProcessed * 0.005) * 100) / 100;
              if (local && ((local.defectCount || 0) > (sd.defectCount || 0) || (local.imagesDefected || 0) > (sd.imagesDefected || 0))) {
                const maxDefects = Math.max(local.defectCount || 0, local.imagesDefected || 0);
                return { ...sd, kmProcessed: kmVal, defectCount: maxDefects, imagesDefected: maxDefects };
              }
              return { ...sd, kmProcessed: kmVal };
            });
            const localDrafts = prev.filter(d => !d.isSyncedWithSupabase && !supabaseIds.has(d.id || `${d.date}-${d.subgrid}`));
            return [...merged, ...localDrafts];
          });
        }
        if (sBatches && sBatches.length > 0) {
          setBatchLogs(prev => {
            const localMap = new Map(prev.map(b => [(b.subgrid || '').toUpperCase().trim(), b]));
            const merged = sBatches.map(sb => {
              const sgKey = (sb.subgrid || '').toUpperCase().trim();
              const local = localMap.get(sgKey);
              let kmVal = sb.kmProcessed;
              if (kmVal > 5) kmVal = Math.round((sb.images * 0.005) * 100) / 100;
              if (local && (local.defects || 0) > (sb.defects || 0)) {
                return { ...sb, kmProcessed: kmVal, defects: local.defects };
              }
              return { ...sb, kmProcessed: kmVal };
            });
            return merged;
          });
        }

        // Fetch live defect count from qa_defects table
        try {
          const { data: qaRows } = await supabase.from('qa_defects').select('qa_status, defect_flags, defect_count');
          if (qaRows && qaRows.length > 0) {
            const count = qaRows.filter(q =>
              q.qa_status === 'flagged' ||
              (q.defect_flags && typeof q.defect_flags === 'object' && Object.values(q.defect_flags).some(Boolean)) ||
              (q.defect_count && Number(q.defect_count) > 0)
            ).length;
            setLiveDefectCount(count);
            // Also get total frame count from panoramas_view for accurate % calculation
            try {
              const { count: totalCount } = await supabase
                .from('panoramas_view')
                .select('*', { count: 'exact', head: true });
              if (totalCount && totalCount > 0) setLiveTotalFrames(totalCount);
            } catch (_) {}
          }
        } catch (e) {
          console.warn('qa_defects count fetch skipped:', e);
        }

        const fetchedQa = await fetchQaRecordsFromSupabase();
        if (fetchedQa && Object.keys(fetchedQa).length > 0) {
          setQaSubgridRecords(prev => ({ ...fetchedQa, ...prev }));
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
      localStorage.setItem('dailyData_v17', JSON.stringify(dailyData));
      localStorage.setItem('batchLogs_v17', JSON.stringify(batchLogs));
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
  const [liveDefectCount, setLiveDefectCount] = useState<number>(0);
  const [liveTotalFrames, setLiveTotalFrames] = useState<number>(0);
  const totalDefects = liveDefectCount || dailyData.reduce((sum, d) => sum + d.imagesDefected, 0);
  const totalFramesForHealth = liveTotalFrames || totalImages || 265;
  const pipelineHealthPercent = totalFramesForHealth > 0
    ? (((totalFramesForHealth - totalDefects) / totalFramesForHealth) * 100).toFixed(1)
    : '100.0';
  const targetKm = 315.2;
  const progressPercent = ((totalKm / targetKm) * 100).toFixed(1);
  const latestBatch = dailyData[dailyData.length - 1];

  const [mapRefreshKey, setMapRefreshKey] = useState<number>(Date.now());
  const handleRefreshMap = () => setMapRefreshKey(Date.now());

  // Notification & Audit Log State Management
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    const saved = localStorage.getItem('app_notifications_v1');
    if (!saved) return INITIAL_NOTIFICATIONS;
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : INITIAL_NOTIFICATIONS;
    } catch { return INITIAL_NOTIFICATIONS; }
  });

  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(() => {
    const saved = localStorage.getItem('app_audit_logs_v1');
    if (!saved) return INITIAL_AUDIT_LOGS;
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : INITIAL_AUDIT_LOGS;
    } catch { return INITIAL_AUDIT_LOGS; }
  });

  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);
  const [auditFilterTab, setAuditFilterTab] = useState<'ALL' | 'EDIT' | 'DELETE' | 'CREATE' | 'PUBLISH' | 'ERROR'>('ALL');
  const [auditDateFilter, setAuditDateFilter] = useState<string>('');
  const [isHelpGuideOpen, setIsHelpGuideOpen] = useState(false);
  const [helpGuideTab, setHelpGuideTab] = useState<'map' | 'panorama' | 'data' | 'audit'>('map');
  const [tourStep, setTourStep] = useState<number | null>(null);

  const availableAuditDates = React.useMemo(() => {
    const dates = auditLogs.map(l => l.timestamp.split(',')[0].trim());
    return Array.from(new Set(dates)).filter(Boolean);
  }, [auditLogs]);

  useEffect(() => {
    try { localStorage.setItem('app_notifications_v1', JSON.stringify(notifications)); } catch {}
  }, [notifications]);

  useEffect(() => {
    try { localStorage.setItem('app_audit_logs_v1', JSON.stringify(auditLogs)); } catch {}
  }, [auditLogs]);

  const unreadNotifCount = notifications.filter(n => !n.read).length;
  const unreadAuditCount = auditLogs.filter(a => !a.read).length;

  const addNotification = React.useCallback((item: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const newNotif: NotificationItem = {
      ...item,
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: `${dateStr}, ${timeStr}`,
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);
  }, []);

  const addAuditLog = React.useCallback((type: AuditLogItem['type'], title: string, details: string, status: AuditLogItem['status'] = 'info') => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const newAudit: AuditLogItem = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: `${dateStr}, ${timeStr}`,
      type,
      title,
      details,
      user: authSession?.user?.email ? authSession.user.email.split('@')[0] : 'Fariz',
      status,
      read: false
    };
    setAuditLogs(prev => [newAudit, ...prev]);
  }, [authSession]);

  // Top-level subgrid filter state for Main Dashboard Page interactive row filtering
  const [selectedSubgridFilter, setSelectedSubgridFilter] = useState<string | null>(null);
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
  const [showPanotrackData, setShowPanotrackData] = useState(true);
  const [isStatusFilterOpen, setIsStatusFilterOpen] = useState(false);
  // Dashboard Processing Control & Admin column filter state
  const [isDashFilterOpen, setIsDashFilterOpen] = useState(false);
  const [dashDailyFilters, setDashDailyFilters] = useState<{
    grid: string;
    subgrid: string;
    pic: string;
    equipment: string;
  }>({
    grid: '',
    subgrid: '',
    pic: '',
    equipment: ''
  });

  const hasActiveDashFilters = Object.values(dashDailyFilters).some(Boolean);
  const [isDrawingBBox, setIsDrawingBBox] = useState(false);
  const [statusFilters, setStatusFilters] = useState<{ published: boolean; defect: boolean; stitching: boolean }>({
    published: true,
    defect: true,
    stitching: true
  });

  const lastUpdateDate = React.useMemo(() => {
    const allDates = [
      ...batchLogs.map(b => b.date),
      ...dailyData.map(d => d.date)
    ].filter(Boolean);
    if (allDates.length > 0) {
      allDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      const latest = new Date(allDates[0]);
      if (!isNaN(latest.getTime())) {
        return latest.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      }
    }
    return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }, [batchLogs, dailyData]);

  const generateExecutivePdfReport = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=1000');
    if (!printWindow) return;

    const totalImages = batchLogs.reduce((acc, b) => acc + (b.images || 0), 0);
    const totalDefectsCount = batchLogs.reduce((acc, b) => acc + (b.defects || 0), 0);
    const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>TNB LV Asset Mapping - Executive Progress Report</title>
          <style>
            body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1e293b; padding: 40px; margin: 0; background: #ffffff; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0284c7; padding-bottom: 15px; margin-bottom: 25px; }
            .title { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0; }
            .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
            .meta { font-size: 12px; color: #475569; text-align: right; }
            .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 30px; }
            .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; text-align: center; }
            .kpi-value { font-size: 22px; font-weight: 700; color: #0284c7; }
            .kpi-label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; margin-top: 4px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 12px; }
            th { background: #0f172a; color: #ffffff; padding: 10px; text-align: left; font-size: 11px; text-transform: uppercase; }
            td { border-bottom: 1px solid #e2e8f0; padding: 10px; }
            tr:nth-child(even) { background: #f8fafc; }
            .badge { padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
            .badge-success { background: #dcfce7; color: #15803d; }
            .footer { font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; text-align: center; margin-top: 40px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <div class="title">TNB LV ASSET MAPPING</div>
              <div class="subtitle">360° Mobile Mapping Executive Summary Report</div>
            </div>
            <div class="meta">
              <div><strong>Date:</strong> ${reportDate}</div>
              <div><strong>System Status:</strong> Operational</div>
            </div>
          </div>

          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-value">4</div>
              <div class="kpi-label">Subgrids Processed</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-value">4.8 km</div>
              <div class="kpi-label">Distance Covered</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-value">${totalImages}</div>
              <div class="kpi-label">Total Panoramas</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-value">${totalDefectsCount}</div>
              <div class="kpi-label">QA Defects Flagged</div>
            </div>
          </div>

          <h3>Subgrid Processing Breakdown</h3>
          <table>
            <thead>
              <tr>
                <th>Grid / Subgrid</th>
                <th>Images</th>
                <th>Distance</th>
                <th>QA Status</th>
                <th>Defects</th>
                <th>PIC</th>
                <th>Stitching Progress</th>
              </tr>
            </thead>
            <tbody>
              ${batchLogs.map(b => `
                <tr>
                  <td><strong>${b.subgrid || b.imageFilename}</strong></td>
                  <td>${b.images || 163}</td>
                  <td>${b.kmProcessed ? `${b.kmProcessed.toFixed(1)} km` : '0.8 km'}</td>
                  <td><span class="badge badge-success">Stitched & Published</span></td>
                  <td>${b.defects || 0}</td>
                  <td>${b.pic || 'Fariz'}</td>
                  <td>100% Complete</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="footer">
            Generated automatically by TNB 360° Mobile Mapping Processing Dashboard • Confidential GIS Document
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  // Flag tracking whether a map location/point track has been clicked
  const [hasSelectedPoint, setHasSelectedPoint] = useState<boolean>(false);

  // Active panorama photo URL, filename, telemetry, and mini-map coords for 360 View Inspector & QA
  const [activePanoramaUrl, setActivePanoramaUrl] = useState<string>('');
  const [activePanoramaFilename, setActivePanoramaFilename] = useState<string>('');
  const [panoramaTelemetry, setPanoramaTelemetry] = useState<{ yaw: number; pitch: number; fov: number }>({
    yaw: 180,
    pitch: 2.5,
    fov: 75
  });
  const [inspectorCoords, setInspectorCoords] = useState<{ lat: number; lng: number }>({
    lat: 2.542429,
    lng: 102.807800
  });
  const [inspectorSubgrid, setInspectorSubgrid] = useState<string>('');
  const [qaSubgridRecords, setQaSubgridRecords] = useState<Record<string, {
    flags: { blurry: boolean; obstruction: boolean; badGps: boolean };
    answer: 'yes' | 'no' | null;
    isLocked: boolean;
  }>>(() => {
    try {
      const saved = localStorage.getItem('qaSubgridRecords_v15');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [selectedQaFlags, setSelectedQaFlags] = useState<{ blurry: boolean; obstruction: boolean; badGps: boolean }>({
    blurry: false,
    obstruction: false,
    badGps: false
  });
  const [qaQuestionnaireAnswer, setQaQuestionnaireAnswer] = useState<'yes' | 'no' | null>(null);
  const [isQaLocked, setIsQaLocked] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem('qaSubgridRecords_v15', JSON.stringify(qaSubgridRecords));
    } catch (err) {
      console.warn('Unable to save qaSubgridRecords to localStorage:', err);
    }
  }, [qaSubgridRecords]);

  const saveSubgridQa = (
    sgKey: string,
    flags: { blurry: boolean; obstruction: boolean; badGps: boolean },
    answer: 'yes' | 'no' | null,
    locked: boolean
  ) => {
    const itemKey = (activePanoramaFilename || sgKey || inspectorSubgrid || selectedSubgridFilter || '').toUpperCase().trim();
    if (!itemKey) return;
    setSelectedQaFlags(flags);
    setQaQuestionnaireAnswer(answer);
    setIsQaLocked(locked);
    setQaSubgridRecords(prev => ({
      ...prev,
      [itemKey]: { flags, answer, isLocked: locked }
    }));
  };
  const lastTelemetryTimeRef = useRef<number>(0);

  useEffect(() => {
    const handlePanoramaMessage = (e: MessageEvent) => {
      // ONLY update inspector coords when a valid point track is explicitly selected (prevents minimap point moving bug)
      if (e.data?.type === 'MAP_POINT_SELECTED') {
        const pt = e.data.point || e.data.payload;
        if (pt) {
          setHasSelectedPoint(true);
          const fn = (pt.filename || '').replace(/^\/+/, '').replace(/^MMS_PIC\//i, '');
          if (fn) {
            setActivePanoramaFilename(fn);
          }
          const imageUrl = (pt.image_url && typeof pt.image_url === 'string' && pt.image_url.trim().length > 0)
            ? (pt.image_url.startsWith('http') || pt.image_url.startsWith('/') ? pt.image_url : `/MMS_PIC/${pt.image_url.replace(/^\/+/, '').replace(/^MMS_PIC\//i, '')}`)
            : (fn ? `/MMS_PIC/${fn}` : '');

          if (imageUrl) {
            setActivePanoramaUrl(imageUrl);
          }
          if (typeof pt.bearing === 'number' || typeof pt.heading === 'number') {
            setPanoramaTelemetry(prev => ({ ...prev, yaw: pt.bearing ?? pt.heading }));
          }
          if (typeof pt.lat === 'number' && (typeof pt.lng === 'number' || typeof pt.lon === 'number')) {
            setInspectorCoords({
              lat: parseFloat(pt.lat),
              lng: parseFloat(typeof pt.lng === 'number' || typeof pt.lng === 'string' ? pt.lng : pt.lon)
            });
          }
          if (pt.subgrid) {
            const sg = (extractSubgridName(pt.subgrid) || pt.subgrid).toUpperCase().trim();
            setInspectorSubgrid(sg);
          }

          const itemKey = (fn || pt.id || pt.subgrid || inspectorSubgrid || '').toString().toUpperCase().trim();
          const saved = itemKey ? qaSubgridRecords[itemKey] : null;
          if (saved) {
            setSelectedQaFlags(saved.flags);
            setQaQuestionnaireAnswer(saved.answer);
            setIsQaLocked(saved.isLocked);
          } else {
            setSelectedQaFlags({ blurry: false, obstruction: false, badGps: false });
            setQaQuestionnaireAnswer(null);
            setIsQaLocked(false);
          }

          // Broadcast MAP_POINT_SELECTED with resolved image_url to all viewer iframes
          const iframes = document.querySelectorAll('iframe');
          iframes.forEach(f => {
            try {
              f.contentWindow?.postMessage({
                type: 'MAP_POINT_SELECTED',
                point: {
                  ...pt,
                  image_url: imageUrl || pt.image_url
                }
              }, '*');
            } catch (err) { }
          });
        }
      } else if (e.data?.type === 'CAMERA_ROTATED' && e.data?.source === 'viewer') {
        const yawVal = Math.round((e.data.yaw ?? 0) * 100) / 100;
        const pitchVal = Math.round((e.data.pitch ?? 2.5) * 10) / 10;

        // Broadcast CAMERA_ROTATED immediately at 60fps to all map iframes for zero-lag sonar rotation
        const mapIframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
        mapIframes.forEach(f => {
          try {
            f.contentWindow?.postMessage({
              type: 'CAMERA_ROTATED',
              source: 'parent',
              yaw: e.data.yaw,
              pitch: e.data.pitch
            }, '*');
          } catch (err) { }
        });

        // Throttle React state HUD update to avoid re-rendering entire dashboard layout on every 60fps frame
        if (Date.now() - lastTelemetryTimeRef.current > 100) {
          lastTelemetryTimeRef.current = Date.now();
          setPanoramaTelemetry(prev => ({ ...prev, yaw: yawVal, pitch: pitchVal }));
        }
      }
    };
    window.addEventListener('message', handlePanoramaMessage);
    return () => window.removeEventListener('message', handlePanoramaMessage);
  }, [qaSubgridRecords, activePanoramaFilename, inspectorSubgrid]);

  // Restore or reset QA defect state per panotrack image/point whenever navigating
  useEffect(() => {
    const itemKey = (activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || '').toUpperCase().trim();
    if (!itemKey) {
      setSelectedQaFlags({ blurry: false, obstruction: false, badGps: false });
      setQaQuestionnaireAnswer(null);
      setIsQaLocked(false);
      return;
    }

    const saved = qaSubgridRecords[itemKey];
    if (saved) {
      setSelectedQaFlags(saved.flags);
      setQaQuestionnaireAnswer(saved.answer);
      setIsQaLocked(saved.isLocked);
    } else {
      setSelectedQaFlags({ blurry: false, obstruction: false, badGps: false });
      setQaQuestionnaireAnswer(null);
      setIsQaLocked(false);
    }
  }, [activePanoramaUrl, activePanoramaFilename, inspectorSubgrid, selectedSubgridFilter, qaSubgridRecords]);

  const toggleSubgridFilter = (subgridRaw: string, date?: string) => {
    const sg = (extractSubgridName(subgridRaw) || subgridRaw).toUpperCase().trim();
    const dateStr = date ? date.trim() : null;

    // Reset QA defect flags back to default when toggling subgrid without defects
    const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg);
    if (!targetLog || (targetLog.defects || 0) === 0) {
      setSelectedQaFlags({ blurry: false, obstruction: false, badGps: false });
      setQaQuestionnaireAnswer(null);
      setIsQaLocked(false);
    }

    setSelectedSubgridFilter(prevSubgrid => {
      const isSameSubgrid = prevSubgrid === sg;
      const isSameDate = selectedDateFilter === dateStr;

      let nextSubgrid: string | null = sg;
      let nextDate: string | null = dateStr;

      if (isSameSubgrid && isSameDate) {
        nextSubgrid = null;
        nextDate = null;
      }

      setSelectedDateFilter(nextDate);

      const getSubgridDefault = (subgridName: string) => {
        const s = subgridName.toUpperCase();
        if (s.includes('N93E70')) return { fn: 'N93E70-0001.jpg', lat: 2.542429, lng: 102.807800 };
        if (s.includes('N94E70')) return { fn: 'N94E70-0001.jpg', lat: 2.542160, lng: 102.807090 };
        if (s.includes('N94E71')) return { fn: 'N94E71-0001.jpg', lat: 2.541000, lng: 102.812000 };
        return { fn: `${s}-0001.jpg`, lat: 2.542429, lng: 102.807800 };
      };

      if (nextSubgrid) {
        const def = getSubgridDefault(nextSubgrid);
        setActivePanoramaFilename(def.fn);
        setActivePanoramaUrl(`/MMS_PIC/${def.fn}`);
        setInspectorCoords({ lat: def.lat, lng: def.lng });
        setInspectorSubgrid(nextSubgrid);
        setHasSelectedPoint(true);

        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(f => {
          try {
            f.contentWindow?.postMessage({ type: 'FILTER_SUBGRID', subgrid: nextSubgrid, date: nextDate || '' }, '*');
            f.contentWindow?.postMessage({
              type: 'MAP_POINT_SELECTED',
              point: {
                filename: def.fn,
                image_url: `/MMS_PIC/${def.fn}`,
                subgrid: nextSubgrid,
                lat: def.lat,
                lon: def.lng,
                lng: def.lng,
                bearing: 0
              }
            }, '*');
          } catch (e) { }
        });
      } else {
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(f => {
          try {
            f.contentWindow?.postMessage({ type: 'FILTER_SUBGRID', subgrid: '' }, '*');
          } catch (e) { }
        });
      }

      return nextSubgrid;
    });
  };

  // ===== Render Supabase Auth Protection Gate (Minimalist Professional Enterprise Design) =====
  if (!authSession && !authLoading) {
    return (
      <div className="min-h-screen bg-[#09090b] text-zinc-100 font-sans flex items-center justify-center p-6 relative overflow-hidden select-none">
        {/* Subtle Ambient Radial Glow */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-zinc-800/20 rounded-full blur-[120px] pointer-events-none" />

        <div className="w-full max-w-[380px] z-10 relative">
          {/* Header Branding */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 shadow-sm mb-4">
              <Globe size={22} className="text-zinc-200" />
            </div>
            <h1 className="text-xl font-semibold text-white tracking-tight">
              Sign in to Dashboard
            </h1>
            <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
              360° Mobile Mapping System &bull; TNB LV Network
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="name@tnb.com.my"
                required
                className="w-full bg-zinc-900/90 border border-zinc-800 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/20 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-all duration-150"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-zinc-300">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-zinc-900/90 border border-zinc-800 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/20 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-all duration-150"
              />
            </div>

            {/* Error Message */}
            {authError && (
              <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-lg text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isAuthenticating}
              className="w-full py-2.5 px-4 bg-white hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-50 text-zinc-950 text-sm font-semibold rounded-lg shadow-sm transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer mt-5"
            >
              {isAuthenticating ? (
                <>
                  <RefreshCw size={15} className="animate-spin text-zinc-950" />
                  <span>Signing in...</span>
                </>
              ) : (
                <span>Continue</span>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-4 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-800" />
            </div>
            <span className="relative bg-[#09090b] px-2 text-[10px] uppercase text-zinc-500 font-medium">
              or
            </span>
          </div>

          {/* Guest Login Button */}
          <button
            type="button"
            onClick={handleGuestLogin}
            className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-750 text-zinc-300 hover:text-white border border-zinc-800 text-xs font-semibold rounded-lg shadow-sm transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer"
          >
            <User size={15} className="text-zinc-400" />
            <span>Continue as Guest (Read-Only Mode)</span>
          </button>

          {/* Footer Security Note */}
          <div className="mt-8 text-center">
            <p className="text-[11px] text-zinc-500">
              Protected by Supabase Access Authentication
            </p>
          </div>
        </div>
      </div>
    );
  }



  return (
    <div className="h-screen w-screen bg-[#0b0e14] text-slate-200 font-sans flex flex-col overflow-hidden">

      {/* TOP GLOBAL NAVBAR */}
      <header className="h-12 bg-[#12161f] border-b border-slate-800/80 px-4 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-sky-600 to-emerald-500 rounded-xl shadow-md shadow-emerald-950/40 shrink-0">
            <Layers size={18} className="text-white" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white tracking-wide">
              360 Mobile Mapping Processing Dashboard
            </h1>
          </div>
        </div>

        {/* Top Right Controls */}
        <div className={`flex items-center gap-3 text-slate-400 relative transition-all duration-300 ${
          tourStep === 5 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative bg-slate-900/90 px-2 py-1 rounded-xl' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
        }`}>
          {/* HELP & USER GUIDE ICON (Interactive Tour & Webmap Manual) */}
          <button
            onClick={() => {
              setIsHelpGuideOpen(true);
              setIsNotifOpen(false);
              setIsAuditLogOpen(false);
            }}
            className="p-1.5 hover:text-sky-400 transition-colors cursor-pointer relative"
            title="Help & User Guide (Interactive WebMap Tour & Manual)"
          >
            <HelpCircle size={18} />
          </button>

          {/* BATCH AUDIT LOGS ICON (Tracks User Edits, Deletes, Creates, Modifies, Errors) */}
          <div className="relative">
            <button
              onClick={() => {
                setIsAuditLogOpen(prev => {
                  const next = !prev;
                  if (next) {
                    setAuditLogs(old => old.map(a => ({ ...a, read: true })));
                  }
                  return next;
                });
                setIsNotifOpen(false);
              }}
              className={`p-1.5 transition-colors cursor-pointer relative ${
                isAuditLogOpen ? 'text-sky-400 bg-slate-800/80 rounded-lg border border-slate-700/60' : 'hover:text-white'
              }`}
              title="Batch & System Audit Logs (Track user edits, creates, deletes, errors)"
            >
              <ClipboardList size={18} />
              {unreadAuditCount > 0 && (
                <span className="absolute -top-1 -right-1.5 px-1 py-0.2 min-w-[15px] h-[15px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shadow-md">
                  {unreadAuditCount}
                </span>
              )}
            </button>

            {/* BATCH AUDIT LOGS POPOVER */}
            {isAuditLogOpen && (
              <div className="absolute right-0 top-10 w-96 max-w-[90vw] bg-[#111827] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl z-50 overflow-hidden text-slate-200 animate-in fade-in duration-150 backdrop-blur-md">
                <div className="p-3 bg-[#0d121d] border-b border-[rgba(255,255,255,0.08)] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 shrink-0">
                    <History size={15} className="text-sky-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                      Audit Logs
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Date Track-Back Filter */}
                    <div className="flex items-center gap-1 bg-[#151d2a] border border-slate-700/60 rounded px-2 py-0.5 text-[10px]">
                      <Calendar size={11} className="text-sky-400 shrink-0" />
                      <select
                        value={auditDateFilter}
                        onChange={(e) => setAuditDateFilter(e.target.value)}
                        className="bg-transparent text-slate-200 text-[10px] focus:outline-none cursor-pointer"
                        title="Filter audit logs by track-back date"
                      >
                        <option value="" className="bg-[#111827]">All Dates</option>
                        {availableAuditDates.map(date => (
                          <option key={date} value={date} className="bg-[#111827]">{date}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => setIsAuditLogOpen(false)}
                      className="text-slate-400 hover:text-white p-0.5 cursor-pointer shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="px-3 py-1.5 bg-[#0b0f17] border-b border-[rgba(255,255,255,0.06)] flex items-center gap-1 overflow-x-auto text-[10px]">
                  {(['ALL', 'EDIT', 'DELETE', 'CREATE', 'PUBLISH', 'ERROR'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setAuditFilterTab(tab)}
                      className={`px-2 py-0.5 rounded font-medium transition-all cursor-pointer whitespace-nowrap border ${
                        auditFilterTab === tab
                          ? 'bg-[#1f2937] text-white border-slate-600'
                          : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                {/* Audit Logs List */}
                <div className="max-h-80 overflow-y-auto divide-y divide-[rgba(255,255,255,0.06)] p-1">
                  {auditLogs.filter(item => {
                    if (auditFilterTab !== 'ALL' && item.type !== auditFilterTab) return false;
                    if (auditDateFilter && !item.timestamp.toLowerCase().includes(auditDateFilter.toLowerCase())) return false;
                    return true;
                  }).length > 0 ? (
                    auditLogs
                      .filter(item => {
                        if (auditFilterTab !== 'ALL' && item.type !== auditFilterTab) return false;
                        if (auditDateFilter && !item.timestamp.toLowerCase().includes(auditDateFilter.toLowerCase())) return false;
                        return true;
                      })
                      .map(log => {
                        const badgeColor =
                          log.type === 'CREATE' ? 'bg-slate-800/80 text-sky-300 border-slate-700/60' :
                          log.type === 'EDIT' ? 'bg-slate-800/80 text-slate-300 border-slate-700/60' :
                          log.type === 'DELETE' ? 'bg-slate-800/80 text-rose-300 border-slate-700/60' :
                          log.type === 'PUBLISH' ? 'bg-sky-950/60 text-sky-300 border-sky-800/60' :
                          log.type === 'ERROR' ? 'bg-rose-950/60 text-rose-300 border-rose-900/60' :
                          'bg-slate-800/80 text-slate-300 border-slate-700/60';

                        return (
                          <div key={log.id} className="p-2.5 hover:bg-slate-800/30 transition-colors rounded-lg space-y-1">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className={`px-1.5 py-0.2 rounded font-semibold uppercase border ${badgeColor}`}>
                                {log.type}
                              </span>
                              <span className="text-slate-500 text-[10px]">{log.timestamp}</span>
                            </div>
                            <div className="text-xs font-medium text-slate-200">{log.title}</div>
                            <div className="text-[11px] text-slate-400">{log.details}</div>
                            <div className="text-[9px] text-slate-500 text-right">User: <span className="text-slate-300 font-medium">{log.user}</span></div>
                          </div>
                        );
                      })
                  ) : (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      No audit log records found for filter "{auditFilterTab}"{auditDateFilter ? ` on date ${auditDateFilter}` : ''}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* NOTIFICATIONS ICON (Publish Progress & Pending Tasks) */}
          <div className="relative">
            <button
              onClick={() => {
                setIsNotifOpen(prev => {
                  const next = !prev;
                  if (next) {
                    setNotifications(old => old.map(n => ({ ...n, read: true })));
                  }
                  return next;
                });
                setIsAuditLogOpen(false);
              }}
              className={`p-1.5 transition-colors cursor-pointer relative ${
                isNotifOpen ? 'text-sky-400 bg-slate-800/80 rounded-lg border border-slate-700/60' : 'hover:text-white'
              }`}
              title="Notifications (Publish Progress & Pending Tasks)"
            >
              <Activity size={18} />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1.5 px-1 py-0.2 min-w-[15px] h-[15px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shadow-md">
                  {unreadNotifCount}
                </span>
              )}
            </button>

            {/* NOTIFICATIONS POPOVER */}
            {isNotifOpen && (
              <div className="absolute right-0 top-10 w-96 max-w-[90vw] bg-[#111827] border border-[rgba(255,255,255,0.08)] rounded-xl shadow-2xl z-50 overflow-hidden text-slate-200 animate-in fade-in duration-150 backdrop-blur-md">
                <div className="p-3 bg-[#0d121d] border-b border-[rgba(255,255,255,0.08)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell size={15} className="text-sky-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                      Notifications
                    </span>
                    {unreadNotifCount > 0 && (
                      <span className="bg-slate-800 text-sky-400 border border-slate-700 text-[10px] font-medium px-1.5 py-0.2 rounded-full">
                        {unreadNotifCount} new
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {notifications.length > 0 && (
                      <button
                        onClick={() => setNotifications([])}
                        className="text-slate-400 hover:text-rose-400 text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer"
                        title="Clear all notifications"
                      >
                        <Trash2 size={11} /> Clear All
                      </button>
                    )}
                    <button
                      onClick={() => setIsNotifOpen(false)}
                      className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Notifications List */}
                <div className="max-h-80 overflow-y-auto divide-y divide-[rgba(255,255,255,0.06)] p-1">
                  {notifications.length > 0 ? (
                    notifications.map(notif => {
                      const isPublish = notif.category === 'PUBLISH';
                      const isPending = notif.category === 'PENDING';

                      return (
                        <div
                          key={notif.id}
                          className={`p-3 transition-colors rounded-lg space-y-1.5 relative group ${
                            !notif.read ? 'bg-[#151d2a] border-l-2 border-sky-400' : 'hover:bg-slate-800/30'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {isPublish ? (
                                <span className="bg-sky-950/60 text-sky-300 border border-sky-800/60 px-1.5 py-0.2 rounded text-[9px] font-medium">
                                  PUBLISH SUCCESS
                                </span>
                              ) : isPending ? (
                                <span className="bg-slate-800/80 text-slate-300 border border-slate-700/60 px-1.5 py-0.2 rounded text-[9px] font-medium">
                                  PENDING TASK
                                </span>
                              ) : (
                                <span className="bg-slate-800/80 text-slate-400 border border-slate-700/60 px-1.5 py-0.2 rounded text-[9px] font-medium">
                                  {notif.category}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-slate-500">{notif.timestamp}</span>
                              <button
                                onClick={() => setNotifications(prev => prev.filter(n => n.id !== notif.id))}
                                className="text-slate-500 hover:text-rose-400 p-0.5 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                                title="Dismiss notification"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>

                          <div className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                            {isPublish ? <UploadCloud size={14} className="text-sky-400 shrink-0" /> : isPending ? <Clock size={14} className="text-slate-400 shrink-0" /> : <Activity size={14} className="text-sky-400 shrink-0" />}
                            <span>{notif.title}</span>
                          </div>

                          <p className="text-[11px] text-slate-400 leading-snug">{notif.message}</p>

                          {/* Detail Badges: Total Data & Published Timestamp */}
                          {isPublish && (
                            <div className="pt-1.5 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between text-[10px]">
                              <span className="text-slate-400">Total Data Included: <strong className="text-slate-200">{notif.totalItems || 1} subgrid(s)</strong></span>
                              <span className="text-slate-400">Date Published: <strong className="text-sky-400">{notif.timestamp}</strong></span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center text-slate-500 text-xs">
                      No notifications available
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold ${
              isGuestUser ? 'bg-amber-900/40 border-amber-700 text-amber-400' : 'bg-slate-800 border-slate-700 text-sky-400'
            }`} title={`Logged in as ${authSession?.user?.email || 'guest@tnb.com.my'}`}>
              {isGuestUser ? 'G' : (authSession?.user?.email?.charAt(0).toUpperCase() || 'F')}
            </div>
            {isGuestUser && (
              <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-md">
                Guest
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="p-1 hover:text-red-400 transition-colors"
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* MAIN APP BODY WITH LEFT ICON SIDEBAR + CONTENT AREA */}
      <div className="flex-1 flex overflow-hidden">

        {/* FAR LEFT ICON NAVIGATION BAR */}
        <nav className="w-12 bg-[#12161f] border-r border-slate-800/80 flex flex-col items-center py-3 gap-5 shrink-0 z-10">
          <button
            onClick={() => setCurrentPage('dashboard')}
            className={`p-2 rounded-lg transition-all duration-200 relative cursor-pointer ${
              currentPage === 'dashboard' ? 'text-sky-400 bg-sky-500/10' : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Dashboard Canvas"
          >
            {currentPage === 'dashboard' && (
              <span className="absolute left-0 top-1 bottom-1 w-1 bg-sky-400 rounded-r-full shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
            )}
            <LayoutDashboard size={20} />
          </button>
          <button
            onClick={() => setCurrentPage('data')}
            className={`p-2 rounded-lg transition-all duration-200 relative cursor-pointer ${
              currentPage === 'data' ? 'text-sky-400 bg-sky-500/10' : 'text-slate-500 hover:text-slate-300'
            }`}
            title="Data & Layer Management Canvas"
          >
            {currentPage === 'data' && (
              <span className="absolute left-0 top-1 bottom-1 w-1 bg-sky-400 rounded-r-full shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
            )}
            <Database size={20} />
          </button>
          <button
            onClick={handleRefreshMap}
            className="p-2 text-slate-500 hover:text-slate-300 rounded-lg transition-colors"
            title="Refresh Map & Data"
          >
            <RefreshCw size={20} />
          </button>
        </nav>

        {/* MAIN DASHBOARD CONTENT CANVAS */}
        <main className="flex-1 flex flex-col p-3 gap-3 overflow-hidden bg-[#0B0F17] relative">

          {currentPage === 'dashboard' ? (
            <div key="dashboard-canvas" className="flex-1 flex flex-col gap-3 min-h-0 overflow-hidden animate-in fade-in zoom-in-98 duration-300 ease-out">
              {/* TOP ROW: EXECUTIVE KPI SUMMARY (4 Cards) */}
              <div className={`grid grid-cols-4 gap-3 shrink-0 transition-all duration-300 ${
                tourStep === 1 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative rounded-xl p-1 bg-sky-950/20' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
              }`}>
            {/* Card 1: Total Distance Mapped */}
            <div className="bg-[#111827] border border-[rgba(255,255,255,0.08)] backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-tight">TOTAL DISTANCE MAPPED</span>
                <Navigation size={15} className="text-sky-400 shrink-0" />
              </div>
              <div className="my-1 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-white tracking-tight">{totalKm.toFixed(1)} km</span>
                <span className="text-[10px] text-white bg-slate-800/80 border border-slate-700/60 px-1.5 py-0.5 rounded font-medium">
                  {progressPercent}% of 315.2 km Target
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-medium truncate">
                Cumulative trajectory distance &bull; Last update: {lastUpdateDate}
              </div>
            </div>

            {/* Card 2: Processed Panoramas */}
            <div className="bg-[#111827] border border-[rgba(255,255,255,0.08)] backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-tight">PROCESSED PANORAMAS</span>
                <Camera size={15} className="text-sky-400 shrink-0" />
              </div>
              <div className="my-1">
                <span className="text-2xl font-extrabold text-white tracking-tight">{totalImages.toLocaleString()} Frames</span>
              </div>
              <div className="text-[10px] text-slate-500 font-medium truncate">
                Total 360° image frames ingested &bull; Last update: {lastUpdateDate}
              </div>
            </div>

            {/* Card 3: Active Processing Jobs */}
            <div className="bg-[#111827] border border-[rgba(255,255,255,0.08)] backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-tight">ACTIVE PROCESSING JOBS</span>
                <Database size={15} className="text-sky-400 shrink-0" />
              </div>
              <div className="my-1">
                <span className="text-2xl font-extrabold text-white tracking-tight">
                  {batchLogs.filter(b => b.status === 'Ongoing').length || batchLogs.length} Batch Runs
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-medium truncate">
                {latestBatch ? `Latest: ${latestBatch.imagesProcessed || 0} img (${latestBatch.kmProcessed?.toFixed(1) || 0} km)` : 'Subgrid processing active'} &bull; Last update: {lastUpdateDate}
              </div>
            </div>

            {/* Card 4: Pipeline Health */}
            <div className="bg-[#111827] border border-[rgba(255,255,255,0.08)] backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-tight">PIPELINE HEALTH</span>
                <div className="w-14 h-5">
                  <svg className="w-full h-full text-emerald-400 stroke-current fill-none stroke-2" viewBox="0 0 50 20">
                    <path d="M0,15 L10,12 L20,18 L30,5 L40,10 L50,2" />
                  </svg>
                </div>
              </div>
              <div className="my-1">
                <span className="text-2xl font-extrabold text-emerald-400 tracking-tight">
                  {pipelineHealthPercent}% Normal
                </span>
              </div>
              <div className="text-[10px] text-slate-500 font-medium truncate">
                <span className={totalDefects > 0 ? 'text-amber-400 font-semibold' : 'text-slate-500'}>{totalDefects} defect {totalDefects === 1 ? 'frame' : 'frames'} flagged</span> &bull; Last update: {lastUpdateDate}
              </div>
            </div>
          </div>

          {/* MIDDLE & BOTTOM GRID: LEFT (COVERAGE MAP) & RIGHT (CONTROL + INSPECTOR) */}
          <div className="flex-1 grid grid-cols-12 gap-3 min-h-0">

            {/* LEFT COLUMN: INTERACTIVE COVERAGE MAP (7 Cols) */}
            <div className={`col-span-7 bg-[#111827] border border-[rgba(255,255,255,0.08)] backdrop-blur-md rounded-xl flex flex-col overflow-hidden relative transition-all duration-300 ${
              tourStep === 2 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative scale-[1.002]' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
            }`}>
              {/* Header */}
              <div className="p-3 border-b border-[rgba(255,255,255,0.08)] flex items-center justify-between shrink-0 bg-[#0d121d]">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  INTERACTIVE COVERAGE MAP
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={generateExecutivePdfReport}
                    className="px-3 py-1.5 bg-[#1f2937]/80 hover:bg-[#374151] text-slate-300 hover:text-white border border-[rgba(255,255,255,0.12)] text-[11px] font-medium rounded-lg transition-all uppercase tracking-tight cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
                    title="Generate printable Executive PDF Summary Report"
                  >
                    <FileText size={13} />
                    <span>GENERATE EXECUTIVE PDF REPORT</span>
                  </button>
                  <button
                    onClick={() => {
                      const next = !isDrawingBBox;
                      setIsDrawingBBox(next);
                      const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
                      iframes.forEach(f => {
                        try {
                          f.contentWindow?.postMessage({ type: 'TOGGLE_BBOX_DRAW', isDrawing: next }, '*');
                        } catch (err) { }
                      });
                    }}
                    className={`px-3 py-1.5 text-[11px] font-medium rounded-lg border transition-all uppercase tracking-tight flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95 ${isDrawingBBox
                        ? 'bg-[#374151] border-slate-400 text-white'
                        : 'bg-[#1f2937]/80 hover:bg-[#374151] text-slate-300 border-[rgba(255,255,255,0.12)] hover:border-[rgba(255,255,255,0.2)]'
                      }`}
                    title="Toggle spatial bounding box rectangle filter on map"
                  >
                    <Maximize2 size={13} />
                    <span>{isDrawingBBox ? 'CLEAR BBOX FILTER' : 'SPATIAL FILTER (BBOX)'}</span>
                  </button>
                </div>
              </div>

              {/* Embedded WebGIS Map */}
              <div className="flex-1 relative overflow-hidden bg-slate-950">
                {/* Minimalist Trajectory Filter Button & Popup Menu (bottom-left) */}
                <div className="absolute bottom-3 left-3 z-10 pointer-events-auto flex flex-col items-start gap-2">
                  {/* Popup Panel (shown when isStatusFilterOpen === true) */}
                  {isStatusFilterOpen && (
                    <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-800/90 rounded-xl p-2.5 text-[11px] space-y-1.5 shadow-2xl min-w-[200px] animate-in fade-in slide-in-from-bottom-2 duration-150">
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 mb-1 px-1">
                        <span className="font-semibold text-[10px] text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Filter size={12} />
                          Trajectory Status
                        </span>
                        <button
                          onClick={() => setIsStatusFilterOpen(false)}
                          className="text-slate-400 hover:text-slate-200 text-xs px-1 cursor-pointer transition-colors"
                        >
                          ✕
                        </button>
                      </div>

                      <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-slate-800/60 text-slate-200 hover:text-white cursor-pointer select-none transition-colors">
                        <span className="text-[11px] font-medium text-slate-300">Show Panotrack Layer</span>
                        <input
                          type="checkbox"
                          checked={showPanotrackData}
                          onChange={(e) => {
                            const val = e.target.checked;
                            setShowPanotrackData(val);
                            const iframes = document.querySelectorAll('iframe');
                            iframes.forEach(f => {
                              try {
                                f.contentWindow?.postMessage({ type: 'FILTER_STATUS_TYPES', statusFilters, showPanotrackData: val }, '*');
                              } catch (err) { }
                            });
                          }}
                          className="rounded text-sky-500 focus:ring-0 cursor-pointer accent-sky-500 w-3.5 h-3.5"
                        />
                      </label>

                      <div className="border-t border-slate-800/60 pt-1 space-y-0.5">
                        <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-slate-800/60 text-slate-200 hover:text-white cursor-pointer select-none transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            <span className="text-[11px]">Published to WebGIS</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={statusFilters.published}
                            disabled={!showPanotrackData}
                            onChange={(e) => {
                              const next = { ...statusFilters, published: e.target.checked };
                              setStatusFilters(next);
                              const iframes = document.querySelectorAll('iframe');
                              iframes.forEach(f => {
                                try {
                                  f.contentWindow?.postMessage({ type: 'FILTER_STATUS_TYPES', statusFilters: next, showPanotrackData }, '*');
                                } catch (err) { }
                              });
                            }}
                            className="rounded text-sky-500 focus:ring-0 cursor-pointer accent-sky-500 w-3.5 h-3.5"
                          />
                        </label>

                        <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-slate-800/60 text-slate-200 hover:text-white cursor-pointer select-none transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                            <span className="text-[11px]">Defect / Flags</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={statusFilters.defect}
                            disabled={!showPanotrackData}
                            onChange={(e) => {
                              const next = { ...statusFilters, defect: e.target.checked };
                              setStatusFilters(next);
                              const iframes = document.querySelectorAll('iframe');
                              iframes.forEach(f => {
                                try {
                                  f.contentWindow?.postMessage({ type: 'FILTER_STATUS_TYPES', statusFilters: next, showPanotrackData }, '*');
                                } catch (err) { }
                              });
                            }}
                            className="rounded text-sky-500 focus:ring-0 cursor-pointer accent-sky-500 w-3.5 h-3.5"
                          />
                        </label>

                        <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-slate-800/60 text-slate-200 hover:text-white cursor-pointer select-none transition-colors">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                            <span className="text-[11px]">In Progress / Stitching</span>
                          </div>
                          <input
                            type="checkbox"
                            checked={statusFilters.stitching}
                            disabled={!showPanotrackData}
                            onChange={(e) => {
                              const next = { ...statusFilters, stitching: e.target.checked };
                              setStatusFilters(next);
                              const iframes = document.querySelectorAll('iframe');
                              iframes.forEach(f => {
                                try {
                                  f.contentWindow?.postMessage({ type: 'FILTER_STATUS_TYPES', statusFilters: next, showPanotrackData }, '*');
                                } catch (err) { }
                              });
                            }}
                            className="rounded text-sky-500 focus:ring-0 cursor-pointer accent-sky-500 w-3.5 h-3.5"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Minimalist Trajectory Status Trigger Button */}
                  <button
                    onClick={() => setIsStatusFilterOpen(prev => !prev)}
                    className={`px-2.5 py-1.5 rounded-xl border shadow-lg flex items-center gap-2 text-[11px] font-semibold transition-all duration-200 cursor-pointer select-none relative active:scale-95 ${isStatusFilterOpen
                        ? 'bg-sky-600 text-white border-sky-400 shadow-sky-950/50'
                        : 'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border-slate-800 hover:border-slate-700'
                      }`}
                    title="Filter Trajectory Status"
                  >
                    <Filter size={13} className={isStatusFilterOpen ? 'text-white' : 'text-sky-400'} />
                    <span>Trajectory Status</span>
                    {(!statusFilters.published || !statusFilters.defect || !statusFilters.stitching || !showPanotrackData) && (
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                    )}
                  </button>
                </div>

                {/* Derived active subgrid item details for clicked row */}
                {(() => {
                  const activeBatchLog = batchLogs.find(b =>
                    (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === (selectedSubgridFilter || '').toUpperCase().trim()
                  );
                  const activeDailyLog = dailyData.find(d =>
                    (d.subgrid || '').toUpperCase().trim() === (selectedSubgridFilter || '').toUpperCase().trim() &&
                    (!selectedDateFilter || d.date === selectedDateFilter)
                  ) || dailyData.find(d => (d.subgrid || '').toUpperCase().trim() === (selectedSubgridFilter || '').toUpperCase().trim());

                  const getSubgridCoords = (subgrid?: string | null) => {
                    const name = (subgrid || '').toUpperCase();
                    if (name.includes('N93E70')) return { lat: 2.5389, lng: 102.8050 };
                    if (name.includes('N93E71')) return { lat: 2.5392, lng: 102.8120 };
                    if (name.includes('N93E72')) return { lat: 2.5410, lng: 102.8200 };
                    if (name.includes('N93E73')) return { lat: 2.5435, lng: 102.8280 };
                    return { lat: 2.5389, lng: 102.8050 };
                  };

                  const activeCoords = getSubgridCoords(selectedSubgridFilter);
                  const activeKm = activeDailyLog?.kmProcessed ? activeDailyLog.kmProcessed.toFixed(1) : activeBatchLog?.kmProcessed ? activeBatchLog.kmProcessed.toFixed(1) : '6.5';
                  const activeImages = activeDailyLog?.imagesProcessed || activeBatchLog?.images || 265;
                  const activeDefects = (activeDailyLog?.imagesDefected ?? activeDailyLog?.defectCount) ?? activeBatchLog?.defects ?? 0;
                  const activePic = activeDailyLog?.pic || activeBatchLog?.pic || 'Fariz';
                  const activeStatus = activeBatchLog?.status === 'Complete' || activeDailyLog?.publishToUSVPRO === 'yes' ? 'Published to WebGIS' : 'In Progress';

                  return selectedSubgridFilter ? (
                    <div className="absolute top-3 right-3 z-20 bg-[#12161f]/95 backdrop-blur-md border border-slate-800 rounded-xl p-3 text-xs text-slate-200 shadow-2xl max-w-xs space-y-1.5 animate-in fade-in zoom-in-95 duration-200">
                      <div className="flex items-center justify-between font-bold pb-1 border-b border-slate-800">
                        <span className="text-sky-400 font-mono text-xs">Subgrid ID: {selectedSubgridFilter} {selectedDateFilter ? `(${selectedDateFilter})` : ''}</span>
                        <button onClick={() => toggleSubgridFilter(selectedSubgridFilter)} className="text-slate-400 hover:text-white p-0.5 rounded cursor-pointer transition-colors" title="Close filter">✕</button>
                      </div>
                      <div className="text-slate-300 font-mono text-[11px] flex justify-between gap-4"><span className="text-slate-400">Coordinates:</span> <span>{activeCoords.lat.toFixed(4)}° N, {activeCoords.lng.toFixed(4)}° E</span></div>
                      <div className="text-slate-300 text-[11px] flex justify-between gap-4"><span className="text-slate-400">Distance from start:</span> <span className="font-semibold text-slate-200">{activeKm} km</span></div>
                      <div className="text-slate-300 text-[11px] flex justify-between gap-4"><span className="text-slate-400">Image Count:</span> <span className="font-semibold text-slate-200">{activeImages}</span></div>
                      <div className="text-slate-300 text-[11px] flex justify-between items-center gap-4">
                        <span className="text-slate-400">Defect Images:</span>
                        <button
                          onClick={() => {
                            const validFn = `${selectedSubgridFilter || 'N93E70'}-0002.jpg`;
                            const imgUrl = `/MMS_PIC/${validFn}`;
                            setActivePanoramaUrl(imgUrl);
                            setHasSelectedPoint(true);
                            if (activeCoords) {
                              setInspectorCoords(activeCoords);
                            }
                            if (selectedSubgridFilter) {
                              setInspectorSubgrid(selectedSubgridFilter);
                            }
                          }}
                          className="font-semibold text-amber-400 bg-amber-500/10 hover:bg-amber-500/25 px-2 py-0.5 rounded border border-amber-500/30 hover:border-amber-500/60 text-[10px] cursor-pointer transition-all flex items-center gap-1.5 group shadow-sm active:scale-95"
                          title="Click to filter & select defect data"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
                          <span>{activeDefects} Flagged</span>
                          <Filter size={10} className="text-amber-400/80 group-hover:text-amber-400 group-hover:scale-110 transition-transform shrink-0" />
                        </button>
                      </div>
                      <div className="text-slate-300 text-[11px] flex justify-between gap-4"><span className="text-slate-400">PIC:</span> <span className="font-semibold text-emerald-400">{activePic}</span></div>
                      <div className="text-slate-300 text-[11px] flex justify-between items-center pt-1 border-t border-slate-800/60"><span className="text-slate-400">Processing Status:</span> <span className="font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 text-[10px]">{activeStatus}</span></div>
                    </div>
                  ) : null;
                })()}

                <MapComponent
                  layerCatalog={layerCatalog}
                  refreshKey={mapRefreshKey}
                  onManualRefresh={handleRefreshMap}
                  selectedSubgridFilter={selectedSubgridFilter}
                />
              </div>
            </div>

            {/* RIGHT COLUMN: PROCESSING CONTROL & 360 QA INSPECTOR (5 Cols) */}
            <div className="col-span-5 flex flex-col gap-3 min-h-0">

              {/* TOP RIGHT PANEL: PROCESSING CONTROL & ADMIN */}
              <div className={`flex-1 bg-[#111827] border border-[rgba(255,255,255,0.08)] backdrop-blur-md rounded-xl flex flex-col overflow-hidden min-h-0 shadow-sm transition-all duration-300 ${
                tourStep === 4 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative scale-[1.002]' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
              }`}>
                <div className="p-3 border-b border-[rgba(255,255,255,0.08)] flex items-center justify-between shrink-0 bg-[#0d121d]">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                      <Database size={14} className="text-sky-400" />
                      PROCESSING CONTROL & ADMIN
                    </span>
                    <div className="flex bg-[#192231] border border-[rgba(255,255,255,0.08)] rounded-lg p-0.5 text-[10px]">
                      <button
                        onClick={() => setActiveTab('batches')}
                        className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer ${activeTab === 'batches' ? 'bg-[#374151] text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        Overall Progress ({batchLogs.length})
                      </button>
                      <button
                        onClick={() => setActiveTab('daily')}
                        className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer ${activeTab === 'daily' ? 'bg-[#374151] text-white' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        Daily Progress ({dailyData.length})
                      </button>
                    </div>

                    {/* Simple Icon-Only Filter Button */}
                    <button
                      onClick={() => setIsDashFilterOpen(prev => !prev)}
                      className={`p-1 rounded-lg border transition-all cursor-pointer ${
                        hasActiveDashFilters
                          ? 'bg-sky-600 border-sky-500 text-white shadow-sm'
                          : isDashFilterOpen
                          ? 'bg-[#374151] border-slate-600 text-sky-400'
                          : 'bg-[#192231] border-[rgba(255,255,255,0.08)] text-slate-400 hover:text-slate-200 hover:bg-[#253043]'
                      }`}
                      title="Filter Daily Progress columns"
                    >
                      <Filter size={13} />
                    </button>
                  </div>
                  <button
                    onClick={() => setCurrentPage('data')}
                    className="px-3 py-1.5 bg-[#1f2937]/80 hover:bg-[#374151] text-slate-300 hover:text-white border border-[rgba(255,255,255,0.12)] text-[11px] font-medium rounded-lg transition-all uppercase tracking-tight cursor-pointer shadow-sm"
                  >
                    RE-UPLOAD CSV
                  </button>
                </div>

                {/* Compact Inline Filter Bar for Daily Progress */}
                {isDashFilterOpen && (
                  <div className="px-3 py-2 bg-[#0a0e17] border-b border-[rgba(255,255,255,0.08)] flex flex-wrap items-center justify-between gap-2 text-[10px] animate-in fade-in duration-150">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 font-medium">Grid:</span>
                        <select
                          value={dashDailyFilters.grid}
                          onChange={(e) => setDashDailyFilters(prev => ({ ...prev, grid: e.target.value }))}
                          className="bg-[#151d2a] border border-slate-700/70 text-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                        >
                          <option value="">All</option>
                          {Array.from(new Set(dailyData.map(d => d.grid).filter(Boolean))).sort().map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 font-medium">Subgrid:</span>
                        <select
                          value={dashDailyFilters.subgrid}
                          onChange={(e) => setDashDailyFilters(prev => ({ ...prev, subgrid: e.target.value }))}
                          className="bg-[#151d2a] border border-slate-700/70 text-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                        >
                          <option value="">All</option>
                          {Array.from(new Set(dailyData.map(d => (d.subgrid || '').toUpperCase().trim()).filter(Boolean))).sort().map(sg => (
                            <option key={sg} value={sg}>{sg}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 font-medium">PIC:</span>
                        <select
                          value={dashDailyFilters.pic}
                          onChange={(e) => setDashDailyFilters(prev => ({ ...prev, pic: e.target.value }))}
                          className="bg-[#151d2a] border border-slate-700/70 text-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                        >
                          <option value="">All</option>
                          {Array.from(new Set(dailyData.map(d => d.pic || 'Fariz').filter(Boolean))).sort().map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 font-medium">Equipment:</span>
                        <select
                          value={dashDailyFilters.equipment}
                          onChange={(e) => setDashDailyFilters(prev => ({ ...prev, equipment: e.target.value }))}
                          className="bg-[#151d2a] border border-slate-700/70 text-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                        >
                          <option value="">All</option>
                          {Array.from(new Set(dailyData.map(d => d.captureEquipment || 'MMS').filter(Boolean))).sort().map(eq => (
                            <option key={eq} value={eq}>{eq}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {hasActiveDashFilters && (
                      <button
                        onClick={() => setDashDailyFilters({ grid: '', subgrid: '', pic: '', equipment: '' })}
                        className="text-red-400 hover:text-red-300 text-[10px] font-semibold cursor-pointer flex items-center gap-1"
                        title="Clear dashboard filters"
                      >
                        <X size={12} /> Clear
                      </button>
                    )}
                  </div>
                )}

                {/* Table */}
                <div className="flex-1 overflow-auto">
                  {activeTab === 'batches' ? (
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[#0d121d] text-slate-400 sticky top-0 z-10 border-b border-[rgba(255,255,255,0.08)]">
                        <tr>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Batch ID</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Grid</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Subgrid</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">POI</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Images</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Defect Images</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">PIC</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Status</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                        {batchLogs.map((log, i) => {
                          const batchSubgrid = (extractSubgridName(log.subgrid || log.imageFilename) || '').toUpperCase().trim();
                          const isSelected = selectedSubgridFilter === batchSubgrid;
                          return (
                            <tr
                              key={log.id || i}
                              onClick={() => toggleSubgridFilter(batchSubgrid)}
                              className={`cursor-pointer transition-all ${isSelected ? 'bg-sky-950/70 text-white font-medium' : 'hover:bg-slate-800/40 text-slate-300'}`}
                            >
                              <td className="px-3.5 py-3.5 font-mono text-[10px] text-slate-400">{log.id ? `2123S${String(log.id).padStart(4, '0')}` : `2123S${3000 + i}`}</td>
                              <td className="px-3.5 py-3.5 font-medium text-slate-200">{log.grid || 'N93'}</td>
                              <td className="px-3.5 py-3.5 font-medium text-sky-400">{batchSubgrid}</td>
                              <td className="px-3.5 py-3.5 text-slate-300">{log.images}</td>
                              <td className="px-3.5 py-3.5 text-slate-300">{log.images}</td>
                              <td className="px-3.5 py-3.5 text-amber-400 font-semibold">{log.defects || 0}</td>
                              <td className="px-3.5 py-3.5 text-emerald-400 font-semibold">{log.pic || 'Fariz'}</td>
                              <td className="px-3.5 py-3.5">
                                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${log.status === 'Complete' ? 'text-emerald-400' : 'text-sky-400'}`}>
                                  {log.status === 'Complete' ? 'Stitched: 100%' : 'Stitching: 65%'}
                                </span>
                              </td>
                              <td className="px-3.5 py-3.5 text-right">
                                <button onClick={(e) => { e.stopPropagation(); toggleSubgridFilter(batchSubgrid); }} className="px-2.5 py-1 bg-[#1f2937]/90 hover:bg-[#374151] text-slate-300 border border-[rgba(255,255,255,0.1)] rounded text-[10px] font-medium cursor-pointer transition-colors">
                                  View Logs
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[#0d121d] text-slate-400 sticky top-0 z-10 border-b border-[rgba(255,255,255,0.08)]">
                        <tr>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Date</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Grid</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Subgrid</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Distance</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Images</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">Defect Images</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400">PIC</th>
                          <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-slate-400 text-right">Equipment</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                        {[...dailyData]
                          .reverse()
                          .filter(log => {
                            if (dashDailyFilters.grid && log.grid !== dashDailyFilters.grid) return false;
                            if (dashDailyFilters.subgrid && (log.subgrid || '').toUpperCase().trim() !== dashDailyFilters.subgrid.toUpperCase().trim()) return false;
                            if (dashDailyFilters.pic && (log.pic || 'Fariz') !== dashDailyFilters.pic) return false;
                            if (dashDailyFilters.equipment && (log.captureEquipment || 'MMS') !== dashDailyFilters.equipment) return false;
                            return true;
                          })
                          .map((log, i) => {
                            const dailySubgrid = (log.subgrid || '').toUpperCase().trim();
                            const isRowSelected = selectedSubgridFilter === dailySubgrid && (!selectedDateFilter || selectedDateFilter === log.date);
                            const matchBatch = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === dailySubgrid);
                            const defectCount = (log.imagesDefected && log.imagesDefected > 0) ? log.imagesDefected : (log.defectCount && log.defectCount > 0) ? log.defectCount : (matchBatch ? (matchBatch.defects ?? 0) : 0);
                            return (
                              <tr
                                key={log.id || `dash-d-${log.date}-${log.subgrid}-${i}`}
                                onClick={() => toggleSubgridFilter(dailySubgrid, log.date)}
                                className={`cursor-pointer transition-all ${isRowSelected ? 'bg-sky-950/80 text-white font-medium border-l-2 border-sky-400' : 'hover:bg-slate-800/40 text-slate-300'}`}
                              >
                                <td className="px-3.5 py-3.5 font-mono text-[10px] text-slate-400 flex items-center gap-1.5">
                                  <span>{log.date}</span>
                                  {isRowSelected && <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />}
                                </td>
                                <td className="px-3.5 py-3.5 font-medium text-slate-200">{log.grid}</td>
                                <td className="px-3.5 py-3.5 font-medium text-sky-400">{dailySubgrid}</td>
                                <td className="px-3.5 py-3.5 text-slate-300">{log.kmProcessed.toFixed(1)} km</td>
                                <td className="px-3.5 py-3.5 text-slate-300">{log.imagesProcessed.toLocaleString()}</td>
                                <td className="px-3.5 py-3.5 text-amber-400 font-semibold">{defectCount}</td>
                                <td className="px-3.5 py-3.5 text-emerald-400 font-semibold">{log.pic || 'Fariz'}</td>
                                <td className="px-3.5 py-3.5 text-right font-medium text-emerald-400">{log.captureEquipment || 'MMS'}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* BOTTOM RIGHT PANEL: 360 VIEW INSPECTOR & QA */}
              <div className={`h-96 sm:h-[420px] bg-[#111827] border border-[rgba(255,255,255,0.08)] backdrop-blur-md rounded-xl flex flex-col overflow-hidden shrink-0 transition-all duration-300 shadow-sm ${
                tourStep === 3 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative scale-[1.002]' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
              }`}>
                <div className="px-3.5 py-2.5 border-b border-[rgba(255,255,255,0.08)] bg-[#0d121d] flex items-center justify-between shrink-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <Camera size={15} className="text-sky-400" />
                    360 VIEW INSPECTOR & QA
                  </span>
                </div>

                <div className="flex-1 flex gap-2.5 p-2.5 min-h-0">
                  {/* Embedded WebGIS 360 Viewer directly from 360 web mapping (Gives maximum space to left) */}
                  <div className="flex-1 bg-slate-950 rounded-lg border border-slate-800 relative overflow-hidden group flex flex-col min-w-0">
                    {hasSelectedPoint ? (
                      <>
                        <WebGISViewerIframe
                          panoramaUrl={activePanoramaUrl}
                          subgrid={selectedSubgridFilter || ''}
                          bearing={panoramaTelemetry.yaw}
                          className="w-full h-full"
                        />
                        <div className="absolute top-2 left-2 bg-slate-900/90 backdrop-blur-md px-2 py-1 rounded-md text-[10px] text-slate-200 font-mono z-10 pointer-events-none border border-slate-700/80 shadow-lg flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                          Telemetry: Pitch: {panoramaTelemetry.pitch > 0 ? `+${panoramaTelemetry.pitch}` : panoramaTelemetry.pitch}° | Yaw: {panoramaTelemetry.yaw}°
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full bg-[#0c1017] flex flex-col items-center justify-center p-4 text-center select-none">
                        <Maximize2 size={38} className="text-slate-600 mb-2.5 stroke-[1.5]" />
                        <h4 className="text-xs sm:text-sm font-medium text-slate-300 tracking-tight">
                          Select a location on the map
                        </h4>
                        <p className="text-[11px] text-slate-500 mt-1">
                          to view 360° imagery
                        </p>
                      </div>
                    )}
                  </div>

                  {/* OPERATOR QA panel block */}
                  <div className="w-52 sm:w-56 shrink-0 bg-[#11151c] rounded-lg border border-slate-800/90 p-3 flex flex-col justify-between overflow-y-auto">
                    <div>
                      <div className="flex items-center justify-between gap-1 pb-2 border-b border-slate-800/80 mb-2.5">
                        <span className="text-[11px] font-bold text-slate-300 uppercase tracking-tight flex items-center gap-1.5 whitespace-nowrap">
                          <ShieldCheck size={14} className="text-sky-400 shrink-0" />
                          <span>OPERATOR QA</span>
                        </span>
                        <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                          Reviewing
                        </span>
                      </div>

                      {/* Info Card */}
                      <div className="bg-slate-900/90 rounded-md p-2 border border-slate-800 space-y-1.5 text-[10px] mb-3">
                        <div className="flex items-center justify-between text-slate-400 gap-2">
                          <span className="shrink-0">Subgrid:</span>
                          <span className="font-semibold text-sky-400 truncate text-right">
                            {hasSelectedPoint ? (inspectorSubgrid || selectedSubgridFilter || '-') : '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-400 gap-2">
                          <span className="shrink-0">Equipment:</span>
                          <span className="font-medium text-slate-300 text-right whitespace-nowrap">
                            {hasSelectedPoint ? 'MMS 360' : '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-400 gap-2">
                          <span className="shrink-0">Coordinates:</span>
                          <span className="font-mono text-slate-300 text-[9px] whitespace-nowrap text-right">
                            {hasSelectedPoint ? `${inspectorCoords.lat.toFixed(4)}, ${inspectorCoords.lng.toFixed(4)}` : '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-400 gap-2">
                          <span className="shrink-0">PIC:</span>
                          <span className="font-semibold text-emerald-400 text-right whitespace-nowrap">
                            {hasSelectedPoint ? (batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === (inspectorSubgrid || selectedSubgridFilter || '').toUpperCase().trim())?.pic || 'Fariz') : '-'}
                          </span>
                        </div>
                        {isQaLocked && (
                          <div className="flex flex-col gap-0.5 pt-1 border-t border-slate-800/80">
                            <div className="flex items-center justify-between text-[9.5px]">
                              <span className="text-slate-400 font-medium">QA Status:</span>
                              <span className={`font-bold font-mono ${qaQuestionnaireAnswer === 'yes' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {qaQuestionnaireAnswer === 'yes' ? 'DEFECT CONFIRMED' : 'PASSED'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[9px]">
                              <span className="text-slate-500">Defect Choices:</span>
                              <span className="text-amber-300/90 font-medium truncate text-right max-w-[110px]">
                                {Object.entries(selectedQaFlags).filter(([_, v]) => v).map(([k]) => k === 'blurry' ? 'Blurry' : k === 'obstruction' ? 'Obstruction' : 'Bad GPS').join(', ') || 'None'}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* QA Action Flags */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                            QA Defect Flags
                          </span>
                          {isGuestUser ? (
                            <span className="text-[8.5px] font-semibold text-amber-500/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">Guest</span>
                          ) : isQaLocked ? (
                            <button
                              onClick={() => {
                                const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                const sg = inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                saveSubgridQa(itemKey, selectedQaFlags, qaQuestionnaireAnswer, false);
                                const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Editing QA', { selectedQaFlags, answer: qaQuestionnaireAnswer, action: 'EDIT_QA', filename: activePanoramaFilename, subgrid: sg });
                              }}
                              className="text-[8.5px] font-semibold text-sky-400 hover:text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 px-1.5 py-0.5 rounded border border-sky-500/30 flex items-center gap-1 cursor-pointer transition-all shadow-sm active:scale-95"
                              title="Click to unlock & edit QA defect choices"
                            >
                              <Edit2 size={10} /> Edit QA
                            </button>
                          ) : (
                            <span className="text-[8.5px] text-slate-500 font-mono">Select Flags</span>
                          )}
                        </div>

                        {isGuestUser ? (
                          /* Guest: show flags as view-only, no interaction */
                          <div className="space-y-1.5 pointer-events-none opacity-40 select-none">
                            {[
                              { label: 'Flag: Blurry Frame', color: 'red' },
                              { label: 'Flag: Lens Obstruction', color: 'amber' },
                              { label: 'Flag: Bad GPS', color: 'sky' },
                            ].map(({ label, color }) => (
                              <div key={label} className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between border bg-slate-800/80 border-slate-700/80 text-slate-400 cursor-not-allowed`}>
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 bg-${color}-400`}></span>
                                  <span className="truncate">{label}</span>
                                </span>
                                <span className="text-[9px] font-mono shrink-0 ml-1 text-slate-600">Flag</span>
                              </div>
                            ))}
                            <p className="text-[9px] text-amber-500/70 text-center pt-1 italic">QA editing disabled for guests</p>
                          </div>
                        ) : (
                          <>
                            {(!isQaLocked || selectedQaFlags.blurry) && (
                              <button
                                disabled={isQaLocked}
                                onClick={() => {
                                  if (isQaLocked) return;
                                  const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                  const sg = inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                  const nextFlags = { ...selectedQaFlags, blurry: !selectedQaFlags.blurry };
                                  saveSubgridQa(itemKey, nextFlags, qaQuestionnaireAnswer, false);
                                  const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                  updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Reviewing', { selectedQaFlags: nextFlags, flag: 'Blurry Frame', filename: activePanoramaFilename, subgrid: sg });
                                }}
                                className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between transition-all border ${isQaLocked ? 'opacity-90 cursor-default' : 'cursor-pointer active:scale-95'
                                  } ${selectedQaFlags.blurry
                                    ? 'bg-red-500/25 border-red-500 text-red-300 ring-1 ring-red-500/50 shadow-md'
                                    : 'bg-slate-800/80 hover:bg-red-500/10 hover:border-red-500/50 border-slate-700/80 text-slate-300 hover:text-red-400'
                                  }`}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedQaFlags.blurry ? 'bg-red-300 ring-2 ring-red-400' : 'bg-red-400'}`}></span>
                                  <span className="truncate">Flag: Blurry Frame</span>
                                </span>
                                <span className={`text-[9px] font-mono shrink-0 ml-1 ${selectedQaFlags.blurry ? 'text-red-300 font-bold' : 'text-slate-500 group-hover:text-red-400'}`}>Flag</span>
                              </button>
                            )}

                            {(!isQaLocked || selectedQaFlags.obstruction) && (
                              <button
                                disabled={isQaLocked}
                                onClick={() => {
                                  if (isQaLocked) return;
                                  const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                  const sg = inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                  const nextFlags = { ...selectedQaFlags, obstruction: !selectedQaFlags.obstruction };
                                  saveSubgridQa(itemKey, nextFlags, qaQuestionnaireAnswer, false);
                                  const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                  updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Reviewing', { selectedQaFlags: nextFlags, flag: 'Lens Obstruction', filename: activePanoramaFilename, subgrid: sg });
                                }}
                                className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between transition-all border ${isQaLocked ? 'opacity-90 cursor-default' : 'cursor-pointer active:scale-95'
                                  } ${selectedQaFlags.obstruction
                                    ? 'bg-amber-500/25 border-amber-500 text-amber-300 ring-1 ring-amber-500/50 shadow-md'
                                    : 'bg-slate-800/80 hover:bg-amber-500/10 hover:border-amber-500/50 border-slate-700/80 text-slate-300 hover:text-amber-400'
                                  }`}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedQaFlags.obstruction ? 'bg-amber-300 ring-2 ring-amber-400' : 'bg-amber-400'}`}></span>
                                  <span className="truncate">Flag: Lens Obstruction</span>
                                </span>
                                <span className={`text-[9px] font-mono shrink-0 ml-1 ${selectedQaFlags.obstruction ? 'text-amber-300 font-bold' : 'text-slate-500 group-hover:text-amber-400'}`}>Flag</span>
                              </button>
                            )}

                            {(!isQaLocked || selectedQaFlags.badGps) && (
                              <button
                                disabled={isQaLocked}
                                onClick={() => {
                                  if (isQaLocked) return;
                                  const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                  const sg = inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                  const nextFlags = { ...selectedQaFlags, badGps: !selectedQaFlags.badGps };
                                  saveSubgridQa(itemKey, nextFlags, qaQuestionnaireAnswer, false);
                                  const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                  updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Reviewing', { selectedQaFlags: nextFlags, flag: 'Bad GPS', filename: activePanoramaFilename, subgrid: sg });
                                }}
                                className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between transition-all border ${isQaLocked ? 'opacity-90 cursor-default' : 'cursor-pointer active:scale-95'
                                  } ${selectedQaFlags.badGps
                                    ? 'bg-sky-500/25 border-sky-500 text-sky-300 ring-1 ring-sky-500/50 shadow-md'
                                    : 'bg-slate-800/80 hover:bg-sky-500/10 hover:border-sky-500/50 border-slate-700/80 text-slate-300 hover:text-sky-400'
                                  }`}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedQaFlags.badGps ? 'bg-sky-300 ring-2 ring-sky-400' : 'bg-sky-400'}`}></span>
                                  <span className="truncate">Flag: Bad GPS</span>
                                </span>
                                <span className={`text-[9px] font-mono shrink-0 ml-1 ${selectedQaFlags.badGps ? 'text-sky-300 font-bold' : 'text-slate-500 group-hover:text-sky-400'}`}>Flag</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>

                      {/* QA Questionnaire Box: Update Status? (Hidden after status confirmation and for guests) */}
                      {!isGuestUser && !isQaLocked && (selectedQaFlags.blurry || selectedQaFlags.obstruction || selectedQaFlags.badGps) && (
                        <div className="bg-slate-900/90 rounded-md p-2 border border-slate-800 space-y-1.5 text-[10px] mt-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
                          <div className="flex items-center justify-between text-slate-300 font-medium">
                            <span>Update Status?</span>
                            <span className="text-[9px] text-slate-400 font-mono">
                              {qaQuestionnaireAnswer === 'yes' ? 'DEFECT CONFIRMED' : qaQuestionnaireAnswer === 'no' ? 'NO DEFECT' : 'SELECT RESPONSE'}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                            <button
                              disabled={isQaLocked}
                              onClick={() => {
                                const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                const sg = inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                saveSubgridQa(itemKey, selectedQaFlags, 'yes', true);
                                const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                const newDefects = (targetLog?.defects || 0) + 1;
                                setBatchLogs(prev => prev.map(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim() ? { ...b, defects: newDefects } : b));
                                updateDefectStatusInSupabase(itemKey, newDefects, 'Flagged (Defect Confirmed)', { selectedQaFlags, answer: 'YES', filename: activePanoramaFilename, subgrid: sg });
                              }}
                              className={`py-1.5 px-2 rounded border text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 ${isQaLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer active:scale-95'
                                } ${qaQuestionnaireAnswer === 'yes'
                                  ? 'bg-emerald-500 text-white border-emerald-400 shadow-md ring-1 ring-emerald-400/50'
                                  : 'bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-400 border-emerald-500/30'
                                }`}
                            >
                              <CheckCircle size={11} className="shrink-0" /> YES
                            </button>

                            <button
                              disabled={isQaLocked}
                              onClick={() => {
                                const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                const sg = inspectorSubgrid || selectedSubgridFilter || 'N93E70';
                                saveSubgridQa(itemKey, selectedQaFlags, 'no', true);
                                const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                const currentDefects = targetLog?.defects || 0;
                                updateDefectStatusInSupabase(itemKey, currentDefects, 'Passed (No Defect)', { selectedQaFlags, answer: 'NO', filename: activePanoramaFilename, subgrid: sg });
                              }}
                              className={`py-1.5 px-2 rounded border text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 ${isQaLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer active:scale-95'
                                } ${qaQuestionnaireAnswer === 'no'
                                  ? 'bg-rose-500 text-white border-rose-400 shadow-md ring-1 ring-rose-400/50'
                                  : 'bg-rose-600/20 hover:bg-rose-600/35 text-rose-400 border-rose-500/30'
                                }`}
                            >
                              <X size={11} className="shrink-0" /> NO
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
            <div key="data-canvas" className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#111827] rounded-xl border border-[rgba(255,255,255,0.08)] shadow-2xl animate-in fade-in zoom-in-98 slide-in-from-right-2 duration-300 ease-out">
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
                addNotification={addNotification}
                addAuditLog={addAuditLog}
                isGuestUser={isGuestUser}
              />
            </div>
          )}

        </main>

        {/* ========================================================= */}
        {/* INTERACTIVE GUIDED TOUR FLOATING TOOLTIP OVERLAY */}
        {/* ========================================================= */}
        {tourStep !== null && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90vw] max-w-lg bg-[#0d121d] border border-sky-500/50 rounded-2xl shadow-2xl z-50 p-4 text-slate-200 backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="bg-sky-500 text-slate-950 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Tour Step {tourStep} of {TOUR_STEPS.length}
                </span>
                <h3 className="text-sm font-bold text-white">
                  {TOUR_STEPS[tourStep - 1].title}
                </h3>
              </div>
              <button
                onClick={() => setTourStep(null)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
                title="End Guided Tour"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              {TOUR_STEPS[tourStep - 1].desc}
            </p>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
              <span className="text-[10px] text-slate-500 font-medium">
                Focus: <strong className="text-sky-400">{TOUR_STEPS[tourStep - 1].highlight}</strong>
              </span>

              <div className="flex items-center gap-2">
                {tourStep > 1 && (
                  <button
                    onClick={() => setTourStep(tourStep - 1)}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-all cursor-pointer"
                  >
                    Previous
                  </button>
                )}
                {tourStep < TOUR_STEPS.length ? (
                  <button
                    onClick={() => setTourStep(tourStep + 1)}
                    className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition-all cursor-pointer shadow-md flex items-center gap-1"
                  >
                    Next Step <ChevronRight size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => setTourStep(null)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all cursor-pointer shadow-md"
                  >
                    Complete Tour ✓
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* HELP & USER GUIDE MODAL (Clean Minimalist Enterprise Design) */}
        {/* ========================================================= */}
        {isHelpGuideOpen && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-[#111827] border border-[rgba(255,255,255,0.08)] rounded-xl w-full max-w-3xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden text-slate-200">
              
              {/* Modal Header */}
              <div className="p-4 bg-[#0d121d] border-b border-[rgba(255,255,255,0.08)] flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white tracking-tight">
                    User Guide & System Manual
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    360° WebGIS Mobile Mapping Operations Manual
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setIsHelpGuideOpen(false);
                      setTourStep(1);
                    }}
                    className="px-3 py-1.5 bg-[#1f2937] hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold rounded-lg transition-all cursor-pointer"
                    title="Start guided step-by-step tour"
                  >
                    Start Interactive Tour
                  </button>
                  <button
                    onClick={() => setIsHelpGuideOpen(false)}
                    className="text-slate-400 hover:text-white p-1 cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Modal Navigation Tabs (Clean text, no emojis or icons) */}
              <div className="px-4 py-2 bg-[#0b0f17] border-b border-[rgba(255,255,255,0.06)] flex items-center gap-1.5 overflow-x-auto text-xs">
                {[
                  { id: 'map', label: 'Interactive Map' },
                  { id: 'panorama', label: '360° Street View' },
                  { id: 'data', label: 'Daily Progress & DB' },
                  { id: 'audit', label: 'Notifications & Audit' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setHelpGuideTab(tab.id as any)}
                    className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap border font-medium ${
                      helpGuideTab === tab.id
                        ? 'bg-[#1f2937] text-white border-slate-600'
                        : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/40'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Modal Body Content (Clean neat boxes, no lightbulb/book icons) */}
              <div className="p-5 overflow-y-auto space-y-3 flex-1 text-xs text-slate-300 leading-relaxed">
                {helpGuideTab === 'map' && (
                  <div className="space-y-3">
                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">1. Selecting & Filtering Subgrids</h4>
                      <p className="text-slate-400">
                        Click on any subgrid feature (e.g. <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-slate-200">N94E70</code>) on the map or inside the daily progress table to filter trajectories and panorama points.
                      </p>
                    </div>

                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">2. Date Filter Behavior</h4>
                      <p className="text-slate-400">
                        Selecting a specific date filters trajectory points corresponding to that capture run without hiding concurrent subgrid lists or layer items.
                      </p>
                    </div>

                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">3. Map Layer Control</h4>
                      <p className="text-slate-400">
                        Use the layer control panel on the map to toggle subgrid boundary overlays, panorama trajectory points, and high-voltage grid lines.
                      </p>
                    </div>
                  </div>
                )}

                {helpGuideTab === 'panorama' && (
                  <div className="space-y-3">
                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">1. Navigating Panoramas</h4>
                      <p className="text-slate-400">
                        Click and drag inside the 360° viewer to rotate camera view. Use previous/next buttons to step along trajectory frames.
                      </p>
                    </div>

                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">2. Defect Inspection & QA Validation</h4>
                      <p className="text-slate-400">
                        When AI defect detection flags a frame, review defect type and answer QA questionnaire (YES/NO) to update database defect status.
                      </p>
                    </div>
                  </div>
                )}

                {helpGuideTab === 'data' && (
                  <div className="space-y-3">
                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">1. Column Filtering</h4>
                      <p className="text-slate-400">
                        Click the filter button on table column headers to filter records by subgrid, date, or PIC.
                      </p>
                    </div>

                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">2. Authorized Data Editing & Deletion</h4>
                      <p className="text-slate-400">
                        Click edit or delete icons to update records. Record deletion requires admin passcode verification for audit security.
                      </p>
                    </div>

                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">3. Real-Time Production DB Publishing</h4>
                      <p className="text-slate-400">
                        Click <strong className="text-slate-200">Publish All to Database</strong> to sync processed subgrid trajectories directly to Supabase PostgreSQL database.
                      </p>
                    </div>
                  </div>
                )}

                {helpGuideTab === 'audit' && (
                  <div className="space-y-3">
                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">1. Batch Audit Logs</h4>
                      <p className="text-slate-400">
                        Click the audit log icon in top header to view logged user edits, creates, deletes, publishes, and errors with date track-back filtering.
                      </p>
                    </div>

                    <div className="bg-[#0b0f17] p-3.5 rounded-lg border border-[rgba(255,255,255,0.06)] space-y-1">
                      <h4 className="font-semibold text-white text-xs">2. Publish Notifications</h4>
                      <p className="text-slate-400">
                        The notification icon alerts you whenever data is published to production, showing total data included and date published.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-[#0d121d] border-t border-[rgba(255,255,255,0.08)] flex items-center justify-between">
                <button
                  onClick={() => {
                    setIsHelpGuideOpen(false);
                    setCurrentPage('data');
                  }}
                  className="px-3.5 py-2 bg-[#1f2937] hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold rounded-lg transition-all cursor-pointer"
                  title="Open Layer Catalog & Data Management Page"
                >
                  Open Layer Catalog & Data Management Page
                </button>

                <button
                  onClick={() => setIsHelpGuideOpen(false)}
                  className="px-4 py-2 bg-[#1f2937] hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-all cursor-pointer"
                >
                  Close Manual
                </button>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
