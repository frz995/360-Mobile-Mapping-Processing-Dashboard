import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  Clock,
  Camera,
  Navigation,
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
  ShieldAlert,
  Lock,
  Layers,
  Filter,
  Globe,
  ClipboardList,
  Calendar,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Info,
  Map as MapIcon,
  MousePointer2,
  RotateCcw
} from 'lucide-react';
import { SelectionMapOverlay } from './SelectionMapOverlay';
import { DataSelectionListModal } from './DataSelectionListModal';
import { RecycleBinModal } from './RecycleBinModal';
import { DatasetRecoveryPanel } from './DatasetRecoveryPanel';
import { DatasetRegistryPanel } from './DatasetRegistryPanel';
import { UnderlineTabStrip, type ChromeTab } from './production/chrome';
import { MapComponent } from './MapComponent';
import { QCAuditModal } from './QCAuditModal';
import { toast } from './common/toast';
import { EmptyState } from './common/EmptyState';
import {
  publishToSupabase,
  saveToStagingSupabase,
  deleteFromStagingSupabase,
  fetchSupabaseData,
  deleteFromSupabase,
  deletePointsFromSupabase,
  verifyCsvImageFilenamesInStorage,
  fetchDatasetsFromSupabase,
  fetchProcessingJobsFromSupabase,
  fetchStagingPanoramasFromSupabase,
  saveToRecycleBinInSupabase,
  fetchRecycleBinFromSupabase,
  formatPIC,
  saveAuditLogToSupabase,
  type RecycleBinItem
} from '../services/supabase';
import type { DatasetRecord, ProcessingJobRecord } from '../types/production';
import { aggregateStagingBySubgrid, type StagingAggregate } from '../utils/datasetLineage';
import { computeDeletionImpact, type DeletionImpact, type DeletionMode } from '../utils/deletionImpact';
import type { SubgridPointRow, SelectedPointInfo } from './DeletionSelectionMap';
import { extractSubgridName, generateImageFilenamesList } from '../utils/subgrid';
import {
  getPOICount,
  getImagesProcessedCount,
  formatDisplayDate,
  toISODateString,
  reconcileBatchLogs
} from '../utils/dashboardData';
import { getItemId } from '../utils/items';
import type { PanoramaItem, DailyTimeSeries, BatchLog, NotificationItem, AuditLogItem } from '../types/dashboard';
import type { Layer as CatalogLayer, Folder as CatalogFolder } from '../types/catalog';
type Layer = CatalogLayer;
type Folder = CatalogFolder;
import * as shapefile from 'shapefile';
import * as toGeoJSON from '@tmcw/togeojson';

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
          className="bg-inner border border-subtle rounded-lg p-4"
          style={{ marginLeft: `${depth * 16}px` }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => onToggleFolder(item.id)}>
              {item.expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <Folder size={16} className="text-amber-500" />
              <span className="text-text-base font-medium truncate max-w-[120px]">
                {item.name}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); onMove(item, catalog); }}
                className="text-text-muted hover:text-emerald-400 transition-colors p-1"
                title="Move"
              >
                <Navigation size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                className="text-text-muted hover:text-sky-400 transition-colors p-1"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                className="text-text-muted hover:text-red-400 transition-colors p-1"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <p className="text-xs text-text-muted">
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
        className="bg-inner border border-subtle rounded-lg p-4"
        style={{ marginLeft: `${depth * 16}px` }}
      >
        <div className="flex items-center justify-between mb-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={item.visible}
              onChange={() => onToggleLayer(item.id)}
              className="w-4 h-4 text-sky-600 bg-inner border-subtle rounded focus:ring-sky-500"
            />
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-text-base font-medium truncate max-w-[120px]">
                {item.name}
              </span>
            </div>
          </label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onMove(item, catalog)}
              className="text-text-muted hover:text-emerald-400 transition-colors p-1"
              title="Move"
            >
              <Navigation size={14} />
            </button>
            <button
              onClick={() => onEdit(item)}
              className="text-text-muted hover:text-sky-400 transition-colors p-1"
              title="Edit"
            >
              <Edit2 size={14} />
            </button>
            <button
              onClick={() => onDelete(item.id)}
              className="text-text-muted hover:text-red-400 transition-colors p-1"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <p className="text-xs text-text-muted">
          Uploaded: {new Date(item.uploadedAt).toLocaleString()}
        </p>
      </div>
    );
  }
};

export const DataManagementPage = ({
  dailyData,
  setDailyData,
  batchLogs,
  setBatchLogs,
  layerCatalog,
  setLayerCatalog,
  onBackToDashboard: _onBackToDashboard,
  mapRefreshKey,
  onRefreshMap,
  authSession,
  onSignOut: _onSignOut,
  addNotification,
  addAuditLog,
  isGuestUser,
  projectSettings,
  qaSubgridRecords,
  translate,
  initialTab,
  initialSearch
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
  isGuestUser?: boolean,
  projectSettings?: any,
  qaSubgridRecords?: Record<string, { flags: { blurry: boolean; obstruction: boolean; badGps: boolean }; answer: 'yes' | 'no' | null; isLocked: boolean }>,
  translate?: (key: string) => string,
  initialTab?: 'batches' | 'daily' | 'vector' | 'datasets' | 'recovery',
  initialSearch?: string
}) => {
  const tf = translate || ((key: string) => key);
  type DataTab = 'batches' | 'daily' | 'vector' | 'datasets' | 'recovery';
  const defaultTab: DataTab = initialTab || ((projectSettings?.defaultDataTab === 'daily' || projectSettings?.defaultDataTab === 'vector' || projectSettings?.defaultDataTab === 'datasets' || projectSettings?.defaultDataTab === 'recovery') ? projectSettings.defaultDataTab : 'batches');
  const [dataTab, setDataTab] = useState<DataTab>(defaultTab);
  const [recycleBinCount, setRecycleBinCount] = useState<number>(0);

  useEffect(() => {
    if (initialTab) setDataTab(initialTab);
  }, [initialTab]);

  const refreshRecycleBinCount = useCallback(async () => {
    try {
      const items = await fetchRecycleBinFromSupabase();
      setRecycleBinCount(items.length);
    } catch { }
  }, []);

  useEffect(() => {
    refreshRecycleBinCount();
  }, [refreshRecycleBinCount, dataTab]);

  const activeAuthUserName = React.useMemo(() => {
    if (!authSession || !authSession.user) return 'Fariz.farhan95';
    const u = authSession.user;
    const raw = u.user_metadata?.username || u.user_metadata?.full_name || u.user_metadata?.name || (u.email ? u.email.split('@')[0] : '');
    if (!raw) return 'Fariz.farhan95';
    return formatPIC(raw, 'Fariz.farhan95');
  }, [authSession]);

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
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [isBulkPublishing, setIsBulkPublishing] = useState(false);

  const handleBulkPublish = async () => {
    if (selectedRowIds.size === 0) return;
    setIsBulkPublishing(true);

    // 1. Instant Optimistic UI Update for ALL selected rows (0ms latency)
    const updatedDraft = draftDailyData.map(d => {
      if (selectedRowIds.has(getItemId(d))) {
        return {
          ...d,
          publishToWebGIS: 'yes' as const,
          publishToUSVPRO: 'yes' as const,
          isSyncedWithSupabase: true,
          action: 'Published in database'
        };
      }
      return d;
    });

    const updatedBatches = batchLogs.map(b => {
      if (selectedRowIds.has(getItemId(b))) {
        return {
          ...b,
          status: 'Complete' as const,
          isSyncedWithSupabase: true
        };
      }
      return b;
    });

    setDraftDailyData(updatedDraft);
    setDailyData(updatedDraft);
    setBatchLogs(reconcileBatchLogs(updatedDraft, updatedBatches));
    setIsDailyDirty(true);

    // 2. Parallel Background Publish for all selected records
    const targetList = dataTab === 'batches' ? activeBatchLogs : draftDailyData;
    const itemsToPublish = targetList.filter(item => selectedRowIds.has(getItemId(item)));

    try {
      await Promise.all(itemsToPublish.map(async item => {
        try {
          await publishToSupabase(item);
        } catch (err) {
          console.warn('Bulk publish item error:', err);
        }
      }));

      if (onRefreshMap) onRefreshMap();
      if (addNotification) {
        addNotification({
          title: 'Bulk Publish Complete',
          message: `Successfully published ${itemsToPublish.length} selected record(s) to database.`,
          category: 'PUBLISH'
        });
      }
      setPublishMessage({ text: `Successfully published ${itemsToPublish.length} selected record(s) to Supabase database!`, type: 'success' });
      setTimeout(() => setPublishMessage(null), 4000);
    } catch (err) {
      console.error('Bulk publish error:', err);
    } finally {
      setIsBulkPublishing(false);
      setSelectedRowIds(new Set());
    }
  };

  const handleBulkDelete = () => {
    if (selectedRowIds.size === 0) return;
    setDeleteTarget('BULK_SELECTION' as any);
    openDeleteModalForMode('bulk');
  };

  const handleBulkExportCsv = () => {
    if (selectedRowIds.size === 0) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const targetList = dataTab === 'batches' ? activeBatchLogs : draftDailyData;
    const items = targetList.filter(item => selectedRowIds.has(getItemId(item)));
    if (items.length === 0) return;

    let headers: string[];
    let rows: string[];
    if (dataTab === 'batches') {
      headers = ['Date', 'Grid', 'Subgrid', 'Image Filename', 'Images', 'POI Count', 'Available', 'Defects', 'KM Processed', 'Status', 'Equipment', 'PIC'];
      rows = (items as BatchLog[]).map(b => [
        esc(b.date), esc(b.grid), esc(b.subgrid), esc(b.imageFilename), String(b.images),
        String(b.poiCount ?? ''), String(b.availableImagesCount ?? ''), String(b.defects),
        String(b.kmProcessed), esc(b.status), esc(b.captureEquipment ?? ''), esc(b.pic ?? '')
      ].join(','));
    } else {
      headers = ['Date', 'Grid', 'Subgrid', 'Images Processed', 'POI Count', 'Available', 'Defects', 'Images Defected', 'KM Processed', 'Equipment', 'Publish To WebGIS', 'PIC', 'Action'];
      rows = (items as DailyTimeSeries[]).map(d => [
        esc(d.date), esc(d.grid), esc(d.subgrid), String(d.imagesProcessed),
        String(d.poiCount ?? ''), String(d.availableImagesCount ?? ''), String(d.defectCount),
        String(d.imagesDefected), String(d.kmProcessed), esc(d.captureEquipment),
        esc(d.publishToWebGIS), esc(d.pic ?? ''), esc(d.action)
      ].join(','));
    }

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Data_${dataTab}_Selected_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Sync draftDailyData whenever dailyData changes
  useEffect(() => {
    setDraftDailyData(dailyData);
  }, [dailyData]);
  const [imagesListModal, setImagesListModal] = useState<{
    isOpen: boolean;
    subgrid: string;
    count: number;
    poiCount?: number;
    baseFilename?: string;
    customFilenames?: string[];
  } | null>(null);

  const [qcModal, setQcModal] = useState<{
    isOpen: boolean;
    subgrid: string;
    poiCount: number;
    availableCount: number;
    baseFilename?: string;
    availableFilenames?: string[];
    expectedFilenames?: string[];
  } | null>(null);

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



  // Admin Security Delete State
  const [deleteTarget, setDeleteTarget] = useState<BatchLog | DailyTimeSeries | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /* ---- Safe Deletion + Dataset Registry state ---- */
  const [deleteMode, setDeleteMode] = useState<DeletionMode>('single');
  const [deleteModeActive, setDeleteModeActive] = useState(false);
  const [spatialSubgrids, setSpatialSubgrids] = useState<string[]>([]);
  const [spatialSelectedPoints, setSpatialSelectedPoints] = useState<SelectedPointInfo[]>([]);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [impactData, setImpactData] = useState<DeletionImpact | null>(null);
  const [isComputingImpact, setIsComputingImpact] = useState(false);
  const [isSelectionMapOpen, setIsSelectionMapOpen] = useState(false);
  const [isSelectionListModalOpen, setIsSelectionListModalOpen] = useState(false);
  const [isRecycleBinOpen, setIsRecycleBinOpen] = useState(false);
  const [, setFocusSubgrid] = useState<string | null>(null);
  const [registryDatasets, setRegistryDatasets] = useState<DatasetRecord[]>([]);
  const [registryJobs, setRegistryJobs] = useState<ProcessingJobRecord[]>([]);
  const [registryStaging, setRegistryStaging] = useState<StagingAggregate[]>([]);
  const [isRegistryLoading, setIsRegistryLoading] = useState(false);
  const [mapSubgridFilter, setMapSubgridFilter] = useState<string>('');
  const [selectionNavMode, setSelectionNavMode] = useState<'navigate' | 'select'>('select');

  const spatialSelectionSet = useMemo(
    () => new Set(spatialSubgrids.map((s) => (s || '').toUpperCase().trim())),
    [spatialSubgrids]
  );
  const safeDeletionMapItems = useMemo(() => (Array.isArray(dailyData) ? dailyData : []), [dailyData]);
  const safeDeletionAfterItems = useMemo(() => (Array.isArray(dailyData) ? dailyData : []), [dailyData]);
  const subgridFilterFn = (all: any[]): any[] => {
    if (!mapSubgridFilter) return all;
    const f = mapSubgridFilter.toUpperCase().trim();
    return all.filter((d: any) => {
      const raw = d?.subgrid || d?.imageFilename || '';
      const sg = (extractSubgridName(raw) || raw || '').toUpperCase().trim();
      return sg === f;
    });
  };
  const filteredCurrentMapItems = useMemo(() => subgridFilterFn(safeDeletionMapItems), [safeDeletionMapItems, mapSubgridFilter]);
  const filteredAfterMapItems = useMemo(() => subgridFilterFn(safeDeletionAfterItems), [safeDeletionAfterItems, mapSubgridFilter]);

  const availableSubgridList = useMemo(() => {
    return Array.from(new Set([
      ...batchLogs.map((b) => (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim()),
      ...dailyData.map((d) => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim()),
    ])).filter(Boolean) as string[];
  }, [batchLogs, dailyData]);

  const currentMapIframeRef = useRef<HTMLIFrameElement | null>(null);
  const afterMapIframeRef = useRef<HTMLIFrameElement | null>(null);
  const currentMapContainerRef = useRef<HTMLDivElement | null>(null);

  const subgridPoints = useMemo<SubgridPointRow[]>(() => {
    // 1. Collect all unique subgrids from batchLogs (Masterlist) and dailyData
    const allSubgridNames = new Set<string>();
    (batchLogs || []).forEach((b) => {
      const raw = b?.subgrid || b?.imageFilename || '';
      const sg = (extractSubgridName(raw) || '').toUpperCase().trim();
      if (sg) allSubgridNames.add(sg);
    });
    (dailyData || []).forEach((d) => {
      const raw = d?.subgrid || (d as any)?.imageFilename || '';
      const sg = (extractSubgridName(raw) || '').toUpperCase().trim();
      if (sg) allSubgridNames.add(sg);
    });

    const out: SubgridPointRow[] = [];

    allSubgridNames.forEach((sg) => {
      // Find authoritative masterlist record
      const masterRec = (batchLogs || []).find((b) => {
        const raw = b?.subgrid || b?.imageFilename || '';
        return (extractSubgridName(raw) || '').toUpperCase().trim() === sg;
      });

      const dailyRecs = (dailyData || []).filter((d) => {
        const raw = d?.subgrid || (d as any)?.imageFilename || '';
        return (extractSubgridName(raw) || '').toUpperCase().trim() === sg;
      });

      // Target POI / Frame count from Masterlist
      const masterCount =
        masterRec && typeof masterRec.poiCount === 'number' && masterRec.poiCount > 0
          ? masterRec.poiCount
          : masterRec && typeof masterRec.availableImagesCount === 'number' && masterRec.availableImagesCount > 0
            ? masterRec.availableImagesCount
            : masterRec && typeof masterRec.images === 'number' && masterRec.images > 0
              ? masterRec.images
              : masterRec?.panoramas?.length || 0;

      const dailyCount = dailyRecs.reduce((sum, d) => {
        const c = d?.poiCount || d?.availableImagesCount || (d as any)?.images || d?.panoramas?.length || 0;
        return Math.max(sum, c);
      }, 0);

      const targetCount = masterCount > 0 ? masterCount : dailyCount;

      // Collect points from masterlist panoramas/points first, then dailyData
      const ptsMap = new Map<string, { lat: number; lng: number; filename?: string; pointId?: string }>();

      const ingestCoords = (recList: any[]) => {
        recList.forEach((rec) => {
          const coords = [].concat(rec?.points || [], rec?.panoramas || []);
          coords.forEach((p: any, pIdx: number) => {
            const lat = Number(p?.lat ?? p?.latitude ?? p?.y);
            const lng = Number(p?.lng ?? p?.lon ?? p?.longitude ?? p?.x);
            const filename =
              p?.filename ||
              p?.imageFilename ||
              p?.image_url ||
              `${sg}-${String(pIdx + 1).padStart(4, '0')}.jpg`;
            const pointId = p?.pointId || p?.id || p?.point_id || `pt-${sg}-${pIdx}`;
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              const key = filename || `${lat.toFixed(6)},${lng.toFixed(6)}`;
              if (!ptsMap.has(key)) {
                ptsMap.set(key, { lat, lng, filename, pointId });
              }
            }
          });
        });
      };

      if (masterRec) ingestCoords([masterRec]);
      ingestCoords(dailyRecs);

      let pts = Array.from(ptsMap.values());

      if (targetCount > 0 && pts.length > targetCount) {
        pts = pts.slice(0, targetCount);
      }

      // Sort points deterministically by filename/id
      pts.sort((a, b) => (a.filename || a.pointId || '').localeCompare(b.filename || b.pointId || '', undefined, { numeric: true }));

      // Determine status & color for subgrid matching dashboard
      const isPub = Boolean(
        masterRec?.status === 'Complete' ||
        masterRec?.publishToWebGIS === 'yes' ||
        masterRec?.isSyncedWithSupabase ||
        dailyRecs.some((d) => d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase)
      );
      const masterDefects = masterRec?.defects || 0;
      const hasDefects = Boolean(
        masterDefects > 0 ||
        dailyRecs.some((d) => ((d as any).defects && (d as any).defects > 0) || d.publishToWebGIS === 'need to recheck' || d.publishToWebGIS === 'no') ||
        (qaSubgridRecords && Object.entries(qaSubgridRecords).some(([k, v]) => {
          return k.toUpperCase().includes(sg) && v?.flags && (v.flags.blurry || v.flags.obstruction || v.flags.badGps);
        }))
      );
      const statusColor = hasDefects ? '#ef4444' : isPub ? '#10b981' : '#f59e0b';
      const statusName = hasDefects ? 'defect' : isPub ? 'yes' : 'in process';

      const enrichedPts = pts.map((p, pIdx) => {
        const fnClean = (p.filename || '').split('/').pop()?.toUpperCase().trim();
        const isPtDefect = Boolean(
          (p as any).isDefect ||
          (p as any).is_defect ||
          (p as any).status === 'defect' ||
          (p as any).qa_status === 'defect' ||
          (masterDefects > 0 && pIdx < masterDefects) ||
          (qaSubgridRecords && (
            (fnClean && qaSubgridRecords[fnClean]?.flags && (qaSubgridRecords[fnClean].flags.blurry || qaSubgridRecords[fnClean].flags.obstruction || qaSubgridRecords[fnClean].flags.badGps)) ||
            (qaSubgridRecords[sg]?.flags && (qaSubgridRecords[sg].flags.blurry || qaSubgridRecords[sg].flags.obstruction || qaSubgridRecords[sg].flags.badGps))
          ))
        );

        const ptColor = isPtDefect ? '#ef4444' : isPub ? '#10b981' : '#f59e0b';
        const ptStatus = isPtDefect ? 'defect' : isPub ? 'yes' : 'in process';

        return {
          ...p,
          status: ptStatus,
          statusColor: ptColor,
          color: ptColor,
          isDefect: isPtDefect,
          is_defect: isPtDefect,
          isPublished: isPub && !isPtDefect,
          opacity: isPtDefect ? 1.0 : (isPub ? 1.0 : 0.8)
        };
      });

      if (pts.length > 0 || targetCount > 0) {
        out.push({
          subgrid: sg,
          points: enrichedPts,
          totalPoi: targetCount > 0 ? targetCount : pts.length,
          status: statusName,
          statusColor: statusColor,
          color: statusColor,
          isPublished: isPub
        });
      }
    });

    return out.sort((a, b) => a.subgrid.localeCompare(b.subgrid, undefined, { numeric: true, sensitivity: 'base' }));
  }, [dailyData, batchLogs, qaSubgridRecords]);

  const handleSpatialAdd = useCallback((list: string[], points?: SelectedPointInfo[]) => {
    setSpatialSubgrids((prev) => Array.from(new Set([...prev, ...list])));
    if (points && points.length > 0) {
      setSpatialSelectedPoints((prev) => {
        const m = new Map(prev.map((p) => [p.subgrid.toUpperCase().trim() + '_' + (p.filename || p.pointId || (p.lat ?? 0) + ',' + (p.lng ?? 0)), p]));
        points.forEach((p) => m.set(p.subgrid.toUpperCase().trim() + '_' + (p.filename || p.pointId || (p.lat ?? 0) + ',' + (p.lng ?? 0)), p));
        return Array.from(m.values());
      });
    } else if (list && list.length > 0) {
      // Auto-populate all points for newly selected subgrids
      setSpatialSelectedPoints((prev) => {
        const newPts = [...prev];
        const existingSgs = new Set(prev.map((p) => p.subgrid.toUpperCase().trim()));
        list.forEach((sg) => {
          const norm = sg.toUpperCase().trim();
          if (!existingSgs.has(norm)) {
            const sgRow = subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === norm);
            if (sgRow?.points) {
              sgRow.points.forEach((p) => {
                newPts.push({
                  subgrid: norm,
                  filename: p.filename,
                  pointId: p.pointId,
                  lat: p.lat,
                  lng: p.lng
                });
              });
            }
          }
        });
        return newPts;
      });
    }
  }, [subgridPoints]);

  const handleFlyToSelection = useCallback((subgrid: string, points?: SelectedPointInfo[]) => {
    const iframes = [currentMapIframeRef.current, afterMapIframeRef.current].filter(Boolean) as HTMLIFrameElement[];
    if (iframes.length === 0) return;
    const validPts = (points || []).filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (validPts.length > 0) {
      const minLat = Math.min(...validPts.map((p) => p.lat!));
      const maxLat = Math.max(...validPts.map((p) => p.lat!));
      const minLng = Math.min(...validPts.map((p) => p.lng!));
      const maxLng = Math.max(...validPts.map((p) => p.lng!));
      const padLat = Math.max(0.0015, (maxLat - minLat) * 0.15);
      const padLng = Math.max(0.0015, (maxLng - minLng) * 0.15);
      iframes.forEach((ifr) => {
        try {
          ifr.contentWindow?.postMessage({ type: 'FOCUS_BOUNDARY', bbox: [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat] }, '*');
          ifr.contentWindow?.postMessage({ type: 'FLY_TO', lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2, lon: (minLng + maxLng) / 2, zoom: 17 }, '*');
        } catch { }
      });
    } else if (subgrid) {
      iframes.forEach((ifr) => {
        try {
          ifr.contentWindow?.postMessage({ type: 'SET_SUBGRID_FILTER', subgrid, date: '', isSingleRun: false, runId: null }, '*');
        } catch { }
      });
    }
  }, []);

  const loadRegistryData = useCallback(async () => {
    setIsRegistryLoading(true);
    try {
      const [ds, js, st] = await Promise.all([
        fetchDatasetsFromSupabase(),
        fetchProcessingJobsFromSupabase(),
        fetchStagingPanoramasFromSupabase()
      ]);
      const datasets = (ds || []) as DatasetRecord[];
      const jobs = (js || []) as ProcessingJobRecord[];
      const staging = aggregateStagingBySubgrid(st || []);
      setRegistryDatasets(datasets);
      setRegistryJobs(jobs);
      setRegistryStaging(staging);
      return { datasets, jobs, staging };
    } finally {
      setIsRegistryLoading(false);
    }
  }, []);

  // Synchronize both maps whenever user changes subgrid dropdown selection
  useEffect(() => {
    const iframes = [currentMapIframeRef.current, afterMapIframeRef.current].filter(Boolean) as HTMLIFrameElement[];
    if (iframes.length === 0) return;

    if (mapSubgridFilter) {
      const norm = mapSubgridFilter.toUpperCase().trim();
      const targetRow = subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === norm);
      const pts = (targetRow?.points || []).filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng));

      if (pts.length > 0) {
        const minLat = Math.min(...pts.map((p) => p.lat!));
        const maxLat = Math.max(...pts.map((p) => p.lat!));
        const minLng = Math.min(...pts.map((p) => p.lng!));
        const maxLng = Math.max(...pts.map((p) => p.lng!));
        const padLat = Math.max(0.0015, (maxLat - minLat) * 0.15);
        const padLng = Math.max(0.0015, (maxLng - minLng) * 0.15);

        iframes.forEach((ifr) => {
          if (!ifr || !ifr.contentWindow) return;
          try {
            ifr.contentWindow.postMessage({
              type: 'FOCUS_BOUNDARY',
              bbox: [minLng - padLng, minLat - padLat, maxLng + padLng, maxLat + padLat]
            }, '*');
            ifr.contentWindow.postMessage({
              type: 'FLY_TO',
              lat: (minLat + maxLat) / 2,
              lng: (minLng + maxLng) / 2,
              lon: (minLng + maxLng) / 2,
              zoom: 17
            }, '*');
            ifr.contentWindow.postMessage({
              type: 'SET_SUBGRID_FILTER',
              subgrid: norm,
              date: '',
              isSingleRun: false,
              runId: null
            }, '*');
          } catch { }
        });
      }
    } else {
      const allPts = subgridPoints.flatMap((r) => r.points || []).filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng));
      if (allPts.length > 0) {
        const minLat = Math.min(...allPts.map((p) => p.lat!));
        const maxLat = Math.max(...allPts.map((p) => p.lat!));
        const minLng = Math.min(...allPts.map((p) => p.lng!));
        const maxLng = Math.max(...allPts.map((p) => p.lng!));

        iframes.forEach((ifr) => {
          if (!ifr || !ifr.contentWindow) return;
          try {
            ifr.contentWindow.postMessage({ type: 'CLEAR_BOUNDARY_FOCUS' }, '*');
            ifr.contentWindow.postMessage({
              type: 'FLY_TO',
              lat: (minLat + maxLat) / 2,
              lng: (minLng + maxLng) / 2,
              lon: (minLng + maxLng) / 2,
              zoom: 15
            }, '*');
            ifr.contentWindow.postMessage({
              type: 'SET_SUBGRID_FILTER',
              subgrid: '',
              date: '',
              isSingleRun: false,
              runId: null
            }, '*');
          } catch { }
        });
      }
    }
  }, [mapSubgridFilter, subgridPoints]);

  const resolveDeleteSubgrids = useCallback((mode: DeletionMode): string[] => {
    if (mode === 'single') {
      if (!deleteTarget || typeof deleteTarget === 'string') return [];
      const raw = ('subgrid' in deleteTarget && deleteTarget.subgrid)
        ? deleteTarget.subgrid
        : ('imageFilename' in deleteTarget ? (deleteTarget as BatchLog).imageFilename : '');
      const sg = (extractSubgridName(raw) || '').toUpperCase().trim();
      return sg ? [sg] : [];
    }
    if (mode === 'bulk') {
      const set = new Set<string>();
      selectedRowIds.forEach((id) => {
        const d = dailyData.find((x) => getItemId(x) === id);
        const b = batchLogs.find((x) => getItemId(x) === id);
        const raw = d?.subgrid || b?.subgrid || b?.imageFilename;
        if (raw) set.add((extractSubgridName(raw) || '').toUpperCase().trim());
      });
      return Array.from(set).filter(Boolean);
    }
    return spatialSubgrids;
  }, [deleteTarget, selectedRowIds, dailyData, batchLogs, spatialSubgrids]);

  const computeImpactForMode = useCallback(async (mode: DeletionMode) => {
    const subgrids = resolveDeleteSubgrids(mode);
    setIsComputingImpact(true);
    let ds = registryDatasets;
    let js = registryJobs;
    let stg = registryStaging;
    if (ds.length === 0 && js.length === 0) {
      try {
        const res = await loadRegistryData();
        ds = res.datasets;
        js = res.jobs;
        stg = res.staging;
      } catch {
        /* ignore — impact still computed with empty registry data */
      }
    }
    const impact = computeDeletionImpact({
      mode,
      subgrids,
      dailyData,
      batchLogs,
      qaRecords: qaSubgridRecords,
      stagingAggregates: stg,
      datasets: ds,
      jobs: js
    });
    setImpactData(impact);
    setIsComputingImpact(false);
  }, [resolveDeleteSubgrids, registryDatasets, registryJobs, registryStaging, loadRegistryData, dailyData, batchLogs, qaSubgridRecords]);

  const openDeleteModalForMode = useCallback((mode: DeletionMode) => {
    setDeleteMode(mode);
    setDeleteConfirmText('');
    setAdminPasscode('');
    setDeleteError(null);
    setImpactData(null);
    setIsDeleteModalOpen(true);
    computeImpactForMode(mode);
  }, [computeImpactForMode]);

  const openDeleteModeToggle = useCallback(() => {
    setIsSelectionMapOpen(true);
    setDeleteModeActive((prev) => !prev);
  }, []);

  // CSV Import state
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvPreview, setCsvPreview] = useState<Record<string, string>[]>([]);
  const [csvFieldMap, setCsvFieldMap] = useState<Record<string, string>>({});
  const [csvFileList, setCsvFileList] = useState<{ fileName: string; headers: string[]; rows: string[][] }[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<'MMS' | 'Backpack' | 'Drone'>('MMS');
  const [selectedPic, setSelectedPic] = useState<string>(() => {
    if (!authSession?.user) return '';
    return (
      authSession.user.user_metadata?.full_name ||
      authSession.user.user_metadata?.name ||
      authSession.user.email?.split('@')[0] ||
      authSession.user.email ||
      ''
    );
  });
  const [selectedGrid, setSelectedGrid] = useState<string>('1');
  const [fileGridMap, setFileGridMap] = useState<Record<string, string>>({});
  const [isImportingCsv, setIsImportingCsv] = useState(false);

  // Batch fields for CSV mapping (with alias patterns for auto-match)
  const BATCH_FIELDS: { key: string; label: string; aliases?: string[] }[] = [
    { key: 'date', label: 'Date & Time', aliases: ['datetime', 'captured_at', 'timestamp', 'date', 'time'] },
    { key: 'grid', label: 'Grid', aliases: ['grid', 'grid_id', 'grid_no'] },
    { key: 'subgrid', label: 'Subgrid', aliases: ['subgrid', 'sub_grid'] },
    { key: 'imageFilename', label: 'Filename / Image', aliases: ['imagefilename', 'image_filename', 'image_url', 'filename', 'file', 'poi'] },
    { key: 'latitude', label: 'Latitude', aliases: ['latitude', 'lat', 'y'] },
    { key: 'longitude', label: 'Longitude', aliases: ['longitude', 'lon', 'lng', 'x'] },
    { key: 'heading', label: 'Heading / Bearing', aliases: ['heading', 'bearing', 'dir', 'orientation'] },
    { key: 'pitch', label: 'Pitch', aliases: ['pitch'] },
    { key: 'roll', label: 'Roll', aliases: ['roll'] },
    { key: 'images', label: 'Images Count', aliases: ['images', 'image_count', 'count', 'total_images', 'imagesprocessed'] },
    { key: 'defects', label: 'Defects', aliases: ['defects', 'defect_count', 'defectcount', 'defect'] },
    { key: 'kmProcessed', label: 'Distance (km)', aliases: ['kmprocessed', 'distance', 'km', 'dist', 'length', 'track'] },
    { key: 'status', label: 'Status', aliases: ['status', 'state', 'capture_status'] },
    { key: 'captureEquipment', label: 'Capture Equipment', aliases: ['captureequipment', 'capture_equipment', 'equipment', 'device', 'sensor'] },
    { key: 'pic', label: 'PIC (Person In Charge)', aliases: ['pic', 'person_in_charge', 'operator', 'user', 'author', 'staff'] },
  ];

  // Daily data fields for CSV mapping (columns shown in daily ledger table)
  const DAILY_FIELDS: { key: string; label: string; aliases?: string[] }[] = [
    { key: 'date', label: 'Date', aliases: ['date', 'datetime', 'captured_at', 'capture_date', 'timestamp'] },
    { key: 'grid', label: 'Grid', aliases: ['grid', 'grid_id', 'grid_no'] },
    { key: 'subgrid', label: 'Subgrid', aliases: ['subgrid', 'sub_grid'] },
    { key: 'imageFilename', label: 'Filename / Image', aliases: ['imagefilename', 'image_filename', 'image_url', 'filename', 'file', 'poi'] },
    { key: 'latitude', label: 'Latitude', aliases: ['latitude', 'lat', 'y'] },
    { key: 'longitude', label: 'Longitude', aliases: ['longitude', 'lon', 'lng', 'x'] },
    { key: 'heading', label: 'Heading / Bearing', aliases: ['heading', 'bearing', 'dir', 'orientation'] },
    { key: 'pitch', label: 'Pitch', aliases: ['pitch'] },
    { key: 'roll', label: 'Roll', aliases: ['roll'] },
    { key: 'kmProcessed', label: 'KM Processed', aliases: ['kmprocessed', 'km_processed', 'distance', 'dist', 'km', 'length', 'track', 'route'] },
    { key: 'imagesProcessed', label: 'Images Processed', aliases: ['imagesprocessed', 'images_processed', 'images', 'image_count', 'count', 'total_images'] },
    { key: 'defectCount', label: 'Defect Count', aliases: ['defectcount', 'defect_count', 'defects', 'defect', 'defected'] },
    { key: 'imagesDefected', label: 'Images Defected', aliases: ['imagesdefected', 'images_defected', 'defected_images', 'defect_images'] },
    { key: 'captureEquipment', label: 'Capture Equipment', aliases: ['captureequipment', 'capture_equipment', 'equipment', 'device', 'sensor', 'mms', 'backpack'] },
    { key: 'pic', label: 'PIC (Person In Charge)', aliases: ['pic', 'person_in_charge', 'operator', 'user', 'author', 'staff'] },
    { key: 'publishToWebGIS', label: 'Publish to WebGIS', aliases: ['publishtowebgis', 'publish', 'publish_to_webgis', 'webgis', 'published', 'publishtousvpro'] },
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
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const list: { fileName: string; headers: string[]; rows: string[][] }[] = [];

    for (const file of files) {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) continue;
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map(l => l.split(',').map(v => v.trim().replace(/^"|"$/g, '')));
      list.push({ fileName: file.name, headers, rows });
    }

    if (list.length === 0) {
      toast.error('Selected CSV file(s) must have at least a header row and one data row');
      return;
    }

    const combinedHeaders = list[0].headers;
    const combinedRows = list.flatMap(f => f.rows);
    const preview = combinedRows.slice(0, 5).map(row => {
      const obj: Record<string, string> = {};
      combinedHeaders.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj;
    });

    setCsvFileList(list);
    setCsvHeaders(combinedHeaders);
    setCsvRows(combinedRows);
    setCsvPreview(preview);
    const initialGridMap: Record<string, string> = {};
    list.forEach(f => {
      initialGridMap[f.fileName] = selectedGrid || '1';
    });
    setFileGridMap(initialGridMap);
    const activeFields = dataTab === 'batches' ? BATCH_FIELDS : DAILY_FIELDS;
    setCsvFieldMap(autoMatchFields(combinedHeaders, activeFields));
    setIsCsvImportOpen(true);
    if (csvInputRef.current) csvInputRef.current.value = '';
  };


  const handleCsvImport = async (directPublish = false) => {
    setIsImportingCsv(true);
    const imported: DailyTimeSeries[] = [];
    const filesToProcess = csvFileList.length > 0
      ? csvFileList
      : [{ fileName: 'imported.csv', headers: csvHeaders, rows: csvRows }];

    for (let fIdx = 0; fIdx < filesToProcess.length; fIdx++) {
      const fileItem = filesToProcess[fIdx];
      const fHeaders = fileItem.headers;
      const fRows = fileItem.rows;
      const fileSpecificGrid = fileGridMap[fileItem.fileName] || selectedGrid || '1';

      const getVal = (row: string[], field: string) => {
        const csvCol = Object.keys(csvFieldMap).find(k => csvFieldMap[k] === field);
        const idx = csvCol !== undefined ? fHeaders.indexOf(csvCol) : -1;
        return idx >= 0 ? row[idx] ?? '' : '';
      };

      const getRawColVal = (row: string[], aliases: string[]) => {
        for (const alias of aliases) {
          const idx = fHeaders.findIndex(h => h.trim().toLowerCase() === alias.toLowerCase());
          if (idx >= 0 && row[idx] !== undefined && row[idx].trim() !== '') {
            return row[idx].trim();
          }
        }
        return '';
      };

      const groupedInFile = new Map<string, {
        date: string;
        grid: string;
        subgrid: string;
        kmProcessed: number;
        imagesProcessed: number;
        defectCount: number;
        imagesDefected: number;
        captureEquipment: string;
        pic: string;
        publishToWebGIS: DailyTimeSeries['publishToWebGIS'];
        action: string;
        panoramas: PanoramaItem[];
      }>();

      const fileSubgrid = extractSubgridName(fileItem.fileName);

      fRows.forEach(row => {
        const rawSubgrid = getVal(row, 'subgrid');
        // Read the actual image filename from CSV — do NOT fall back to subgrid code
        const rawFilename = getRawColVal(row, ['filename', 'imagefilename', 'image_url', 'file', 'image', 'img']) || getVal(row, 'imageFilename');
        // Only treat it as a valid filename if it looks like a file (has extension or hyphen-number pattern)
        const isValidFilename = rawFilename && (rawFilename.includes('.') || /[-_]\d{3,}/.test(rawFilename));
        const filename = isValidFilename ? rawFilename : '';
        const rowSubgrid = extractSubgridName(rawSubgrid) || (rawFilename ? extractSubgridName(rawFilename) : '');
        const subgrid = fileSubgrid || rowSubgrid || rawSubgrid || fileItem.fileName.replace(/\.[^/.]+$/, '') || '';
        const date = getVal(row, 'date') || getRawColVal(row, ['date', 'time', 'captured_at']) || new Date().toISOString().slice(0, 10);

        const latStr = getVal(row, 'latitude') || getRawColVal(row, ['latitude', 'lat', 'y']);
        const lonStr = getVal(row, 'longitude') || getRawColVal(row, ['longitude', 'lon', 'lng', 'x']);
        const headingStr = getVal(row, 'heading') || getRawColVal(row, ['heading', 'bearing', 'dir']);
        const pitchStr = getVal(row, 'pitch') || getRawColVal(row, ['pitch']);
        const rollStr = getVal(row, 'roll') || getRawColVal(row, ['roll']);

        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);
        const headingVal = parseFloat(headingStr);
        const pitchVal = parseFloat(pitchStr);
        const rollVal = parseFloat(rollStr);

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

        const fallbackPic =
          authSession?.user?.user_metadata?.username ||
          authSession?.user?.user_metadata?.full_name ||
          authSession?.user?.user_metadata?.name ||
          (authSession?.user?.email ? authSession.user.email.split('@')[0] : '') ||
          selectedPic ||
          'Operator';

        const pic = (picVal && picVal.trim() && picVal.trim().toLowerCase() !== 'unassigned') ? picVal.trim() : fallbackPic;

        const pubVal = getVal(row, 'publishToWebGIS') || getVal(row, 'publishToUSVPRO');
        const pub = directPublish ? 'yes' : (['yes', 'no', 'need to recheck', 'in process'].includes(pubVal)
          ? pubVal as DailyTimeSeries['publishToWebGIS'] : 'in process');

        const existing = groupedInFile.get(subgrid);
        if (existing) {
          existing.imagesProcessed += Number(getVal(row, 'imagesProcessed')) || (filename ? 1 : 0);
          existing.defectCount += Number(getVal(row, 'defectCount')) || 0;
          existing.imagesDefected += Number(getVal(row, 'imagesDefected')) || 0;
          existing.kmProcessed += Number(getVal(row, 'kmProcessed')) || 0;
          existing.panoramas.push(pItem);
        } else {
          groupedInFile.set(subgrid, {
            date: date,
            grid: getVal(row, 'grid') || fileSpecificGrid,
            subgrid: subgrid,
            kmProcessed: Number(getVal(row, 'kmProcessed')) || 0,
            imagesProcessed: Number(getVal(row, 'imagesProcessed')) || (filename ? 1 : 0),
            defectCount: Number(getVal(row, 'defectCount')) || 0,
            imagesDefected: Number(getVal(row, 'imagesDefected')) || 0,
            captureEquipment: eq,
            pic: pic,
            publishToWebGIS: pub,
            action: getVal(row, 'action') || `Imported (${fileItem.fileName || subgrid})`,
            panoramas: [pItem]
          });
        }
      });

      const subgridsList = Array.from(groupedInFile.keys());
      for (let sIdx = 0; sIdx < subgridsList.length; sIdx++) {
        const sgKey = subgridsList[sIdx];
        const d = groupedInFile.get(sgKey)!;
        const trackKm = calculatePanoramaTrackKm(d.panoramas);
        const finalKm = d.kmProcessed > 0 ? d.kmProcessed : (trackKm > 0 ? trackKm : Math.round((d.panoramas.length * 0.005) * 100) / 100);
        const panCount = d.panoramas.length;

        // Verify CSV filenames against Supabase Storage bucket for accurate available image count
        const rowFilenames = d.panoramas.map(p => p.filename).filter((fn): fn is string => Boolean(fn));
        let verifiedCount = 0;
        let verifiedFilenamesList: string[] = [];
        if (rowFilenames.length > 0) {
          try {
            const verifyRes = await verifyCsvImageFilenamesInStorage(rowFilenames, projectSettings);
            verifiedCount = verifyRes.availableCount;
            verifiedFilenamesList = verifyRes.verifiedFilenames;
          } catch {
            verifiedCount = 0;
            verifiedFilenamesList = [];
          }
        }

        const markedPanoramas = d.panoramas.map(p => ({
          ...p,
          isAvailable: verifiedFilenamesList.length > 0
            ? (p.filename ? (verifiedFilenamesList.includes(p.filename) || verifiedFilenamesList.some(vf => vf.toLowerCase() === p.filename!.toLowerCase())) : false)
            : true
        }));

        imported.push({
          ...d,
          poiCount: panCount,
          imagesProcessed: verifiedCount,
          availableImagesCount: verifiedCount,
          availableFilenames: verifiedFilenamesList.length > 0 ? verifiedFilenamesList : undefined,
          defectCount: d.defectCount || 0,
          imagesDefected: d.imagesDefected || 0,
          publishToWebGIS: directPublish ? 'yes' : d.publishToWebGIS,
          isSyncedWithSupabase: directPublish,
          id: `daily-csv-${Date.now()}-${fIdx}-${sIdx}`,
          kmProcessed: Math.round(finalKm * 100) / 100,
          panoramas: markedPanoramas
        });
      }
    }

    // 1. Preserve each imported CSV entry as a separate Daily Data record
    const updatedDraft: DailyTimeSeries[] = [...draftDailyData];

    imported.forEach(newImp => {
      const existingIndex = updatedDraft.findIndex(d => d.id === newImp.id || getItemId(d) === getItemId(newImp));
      if (existingIndex >= 0) {
        updatedDraft[existingIndex] = newImp;
      } else {
        updatedDraft.push(newImp);
      }
    });

    const updatedBatchLogs = reconcileBatchLogs(updatedDraft, batchLogs);

    // 2. INSTANT UI UPDATE (0ms latency)
    setDraftDailyData(updatedDraft);
    setDailyData(updatedDraft);
    setBatchLogs(updatedBatchLogs);
    setIsDailyDirty(true);
    setIsImportingCsv(false);
    setIsCsvImportOpen(false);

    setPublishMessage({
      text: `Successfully imported ${imported.length} record(s) into Daily Data Staging!`,
      type: 'success'
    });
    addAuditLog?.('CREATE', 'CSV Import Executed', `Imported ${imported.length} separate record(s) into Daily Data staging list.`, 'success');

    // 8.5 — Durable import trace to audit_logs (operator, date, source files,
    // generated subgrid set) so a corrupted import can be traced back.
    const importOperator = authSession?.user?.email?.split('@')[0] || authSession?.user?.user_metadata?.full_name || 'Operator';
    const importedFileNames = filesToProcess.map(f => f.fileName);
    const generatedSubgrids = Array.from(new Set(imported.map(i => i.subgrid).filter(Boolean)));
    void saveAuditLogToSupabase({
      timestamp: new Date().toISOString(),
      type: 'IMPORT',
      title: `CSV upload trace: ${importedFileNames.join(', ')}`,
      details: JSON.stringify({
        files: importedFileNames,
        recordCount: imported.length,
        subgrids: generatedSubgrids,
        operator: importOperator,
        date: new Date().toISOString().slice(0, 10),
        directPublish: Boolean(directPublish),
        invalidGpsWarning: imported.reduce((acc, imp) => {
          let bad = 0;
          (imp.panoramas || []).forEach(p => {
            if (!(typeof p.latitude === 'number' && typeof p.longitude === 'number' && p.latitude !== 0 && p.longitude !== 0)) bad++;
          });
          return acc + bad;
        }, 0)
      }),
      user: importOperator,
      status: 'success'
    });

    // 3. Persist imported items to staging_panoramas in Supabase asynchronously
    imported.forEach(imp => {
      saveToStagingSupabase(imp).catch(err => console.warn('Background staging insert notice:', err));
    });

    // Broadcast staged data update (with 50% opacity & matching trajectory colors) to WebGIS map iframes
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(f => {
      try {
        const itemPub = (item: any) => item.publishToWebGIS || item.publishToUSVPRO;
        f.contentWindow?.postMessage({
          type: 'SET_STAGED_DATA',
          stagedItems: updatedDraft.map(item => ({
            subgrid: item.subgrid,
            grid: item.grid,
            status: itemPub(item),
            isPublished: itemPub(item) === 'yes' || item.isSyncedWithSupabase,
            opacity: itemPub(item) === 'yes' || item.isSyncedWithSupabase ? 1.0 : 0.5,
            statusColor: (itemPub(item) === 'yes' || item.isSyncedWithSupabase) ? '#10b981' : (itemPub(item) === 'need to recheck' || itemPub(item) === 'no' ? '#ef4444' : '#f59e0b'),
            panoramas: item.panoramas || []
          }))
        }, '*');
      } catch (err) { }
    });

    if (addNotification) {
      addNotification({
        title: directPublish ? 'CSV Data Published' : 'CSV Data Staged for Preview',
        message: directPublish
          ? `Imported & published ${imported.length} subgrids to database.`
          : `Staged ${imported.length} subgrids. Rendered on Dashboard Map with 50% opacity preview.`,
        category: 'PUBLISH'
      });
    }
    // Count valid vs invalid (0,0 or missing) coordinates
    let invalidGpsCount = 0;
    let validGpsCount = 0;
    imported.forEach(imp => {
      (imp.panoramas || []).forEach(p => {
        if (typeof p.latitude === 'number' && typeof p.longitude === 'number' && p.latitude !== 0 && p.longitude !== 0) {
          validGpsCount++;
        } else {
          invalidGpsCount++;
        }
      });
    });

    const importedSubgrids = Array.from(new Set(imported.map(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim()).filter(Boolean)));
    const subgridStr = importedSubgrids.join(', ') || 'Unknown';
    const count = imported.length;
    const addMsg = `${count} data added : ${subgridStr}`;

    setPublishMessage({
      text: addMsg,
      type: 'success'
    });
    setTimeout(() => setPublishMessage(null), 6000);

    setIsCsvImportOpen(false);
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvPreview([]);
    setCsvFieldMap({});
    setIsImportingCsv(false);
  };

  useEffect(() => {
    if (isDailyDirty) {
      setDailyData(draftDailyData);
      setBatchLogs(reconcileBatchLogs(draftDailyData, batchLogs));
    }
  }, [draftDailyData, isDailyDirty]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const colors = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    for (const file of files) {
      try {
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
          toast.error(`${file.name} is an unsupported format. Please use GeoJSON, KML, GPX, SHP, or CSV.`);
          continue;
        }

        // Validate GeoJSON
        if (!geojson) throw new Error('Failed to parse file');
        if (!geojson.type) geojson = { type: 'FeatureCollection', features: [geojson] };
        if (geojson.type === 'Feature' && !geojson.geometry) throw new Error('Invalid GeoJSON: feature missing geometry');
        if (geojson.type === 'FeatureCollection' && !Array.isArray(geojson.features)) {
          geojson.features = [];
        }

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
        toast.error(`Error processing ${file.name}: ${(err as Error).message}`);
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
      toast.success('Layers saved! They are now visible on the Dashboard map!');
    } catch (err) {
      console.error('Error saving staged layers:', err);
      toast.error('Failed to save staged layers: ' + (err as Error).message);
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
        toast.error('Cannot move a folder into itself or its subfolder');
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
  const [searchQuery, setSearchQuery] = useState(initialSearch || '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    if (initialSearch !== undefined) setSearchQuery(initialSearch);
  }, [initialSearch]);

  // Reset pagination on tab/search/pageSize change
  useEffect(() => {
    setPage(1);
  }, [dataTab, searchQuery, pageSize]);

  // Filtered & Paginated Data
  const activeBatchLogs = React.useMemo(() => {
    return reconcileBatchLogs(draftDailyData, batchLogs);
  }, [draftDailyData, batchLogs]);

  const filteredBatchLogs = React.useMemo(() => {
    if (!searchQuery.trim()) return activeBatchLogs;
    const q = searchQuery.toLowerCase().trim();
    return activeBatchLogs.filter(b =>
      (b.date && b.date.toLowerCase().includes(q)) ||
      (b.grid && b.grid.toLowerCase().includes(q)) ||
      (b.subgrid && b.subgrid.toLowerCase().includes(q)) ||
      (b.imageFilename && b.imageFilename.toLowerCase().includes(q)) ||
      (b.status && b.status.toLowerCase().includes(q))
    );
  }, [activeBatchLogs, searchQuery]);

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
          (d.publishToWebGIS && d.publishToWebGIS.toLowerCase().includes(q)) ||
          (d.action && d.action.toLowerCase().includes(q)) ||
          (d.pic && d.pic.toLowerCase().includes(q))
        );
        if (!matchGlobal) return false;
      }

      // 2. Daily Data Column filters
      if (dailyColumnFilters.grid && d.grid !== dailyColumnFilters.grid) return false;
      if (dailyColumnFilters.subgrid && (d.subgrid || '').toUpperCase().trim() !== dailyColumnFilters.subgrid.toUpperCase().trim()) return false;
      if (dailyColumnFilters.equipment && d.captureEquipment !== dailyColumnFilters.equipment) return false;
      if (dailyColumnFilters.pic && (d.pic || '') !== dailyColumnFilters.pic) return false;
      if (dailyColumnFilters.publishStatus && (d.publishToWebGIS || (d as any).publishToUSVPRO) !== dailyColumnFilters.publishStatus) return false;

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

  // Memoized column-filter option lists (pure derivation from draftDailyData;
  // avoids re-deriving Sets on every render/keystroke when data is unchanged).
  const dailyColumnOptions = React.useMemo(() => {
    const uniq = (vals: Array<string | undefined | null>) =>
      Array.from(new Set(vals.filter((v): v is string => Boolean(v)))).sort();
    return {
      grids: uniq(draftDailyData.map(d => d.grid)),
      subgrids: uniq(draftDailyData.map(d => (d.subgrid || '').toUpperCase().trim())),
      equipment: uniq(draftDailyData.map(d => d.captureEquipment)),
      pics: uniq(draftDailyData.map(d => d.pic)),
      publishStatus: uniq(draftDailyData.map(d => d.publishToWebGIS)),
    };
  }, [draftDailyData]);



  // Supabase publishing states
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handlePublishRecord = async (item: BatchLog | DailyTimeSeries) => {
    const id = getItemId(item);
    setPublishingId(id);

    // 1. Instant Optimistic UI Update (0ms delay)
    if (!('images' in item)) {
      const dailyItem = item as DailyTimeSeries;
      const optimisticItem: DailyTimeSeries = {
        ...dailyItem,
        publishToWebGIS: 'yes',
        isSyncedWithSupabase: true,
        action: 'Published in database'
      };
      const updatedList = draftDailyData.map(d => getItemId(d) === id ? optimisticItem : d);
      setDraftDailyData(updatedList);
      setDailyData(updatedList);
      setBatchLogs(reconcileBatchLogs(updatedList, batchLogs));
      setIsDailyDirty(true);

    } else {
      const updatedBatches = batchLogs.map(b => getItemId(b) === id ? { ...b, status: 'Complete' as const, isSyncedWithSupabase: true } : b);
      setBatchLogs(updatedBatches);
    }

    // 2. Async Background Publish & Storage Verification
    try {
      const res = await publishToSupabase(item);

      if (!res.success) {
        if (!('images' in item)) {
          const revertedItem: DailyTimeSeries = {
            ...(item as DailyTimeSeries),
            publishToWebGIS: 'in process',
            isSyncedWithSupabase: false,
            action: 'Publish failed'
          };
          const revertedList = draftDailyData.map(d => getItemId(d) === id ? revertedItem : d);
          setDraftDailyData(revertedList);
          setDailyData(revertedList);

        }
        setPublishMessage({ text: res.message || 'Failed to publish record to database.', type: 'error' });
        setTimeout(() => setPublishMessage(null), 5000);
        return;
      }

      if (!('images' in item)) {
        const dailyItem = item as DailyTimeSeries;

        // Dynamically calculate the starting sequence index (e.g. 15 for Track 2)
        const startIdx = (dailyItem as any).startFrameIndex ||
          (dailyItem as any).startSequence ||
          (dailyItem as any).startImageIndex ||
          1;

        const filenames = (dailyItem.panoramas && dailyItem.panoramas.length > 0)
          ? dailyItem.panoramas.map((p: any) => p.filename).filter((fn: any): fn is string => Boolean(fn))
          : Array.from(
            { length: dailyItem.poiCount || 1 },
            (_, i) => `${dailyItem.subgrid}-${String(startIdx + i).padStart(4, '0')}.jpg`
          );

        let matchedCount = 0;
        let verifiedFiles: string[] = [];

        if (filenames.length > 0) {
          try {
            // Passes projectSettings dynamically to handle R2 vs Supabase
            const { availableCount, verifiedFilenames } = await verifyCsvImageFilenamesInStorage(
              filenames,
              projectSettings
            );
            matchedCount = availableCount >= 0 ? availableCount : 0;
            verifiedFiles = verifiedFilenames || [];
          } catch {
            matchedCount = 0;
            verifiedFiles = [];
          }
        }

        const finalItem: DailyTimeSeries = {
          ...dailyItem,
          imagesProcessed: matchedCount,
          availableImagesCount: matchedCount,
          availableFilenames: verifiedFiles.length > 0 ? verifiedFiles : dailyItem.availableFilenames,
          defectCount: dailyItem.defectCount || 0,
          imagesDefected: dailyItem.imagesDefected || 0,
          publishToWebGIS: 'yes',
          isSyncedWithSupabase: true,
          action: 'Published in database',
          panoramas: dailyItem.panoramas?.map(p => ({
            ...p,
            isAvailable: verifiedFiles.length > 0 ? (p.filename ? (verifiedFiles.includes(p.filename) || verifiedFiles.some(vf => vf.toLowerCase() === p.filename!.toLowerCase())) : false) : p.isAvailable
          }))
        };
        const finalDailyList = draftDailyData.map(d => getItemId(d) === id ? finalItem : d);
        setDraftDailyData(finalDailyList);
        setDailyData(finalDailyList);
        setBatchLogs(reconcileBatchLogs(finalDailyList, batchLogs));

      }

      if (onRefreshMap) onRefreshMap();
      if (addNotification) {
        addNotification({
          title: 'Record Published',
          message: 'Successfully published subgrid record to database.',
          category: 'PUBLISH'
        });
      }
      setPublishMessage({ text: res.message || 'Record published to Supabase database!', type: 'success' });
      setTimeout(() => setPublishMessage(null), 4000);
    } catch (err) {
      console.error('Publish error:', err);
      setPublishMessage({ text: 'Error publishing record to database.', type: 'error' });
      setTimeout(() => setPublishMessage(null), 4000);
    } finally {
      setPublishingId(null);
    }
  };

  const handleSave = async (item: BatchLog | DailyTimeSeries) => {
    if (dataTab === 'batches') {
      const batchItem = item as BatchLog;
      if (editingItem && 'id' in editingItem && editingItem.id) {
        const normSg = (extractSubgridName(batchItem.subgrid || batchItem.imageFilename) || batchItem.subgrid || '').toUpperCase().trim();
        const updatedBatches = batchLogs.map(b => {
          const bNorm = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
          if (b.id === editingItem.id || (bNorm && bNorm === normSg)) {
            return {
              ...b,
              ...batchItem,
              id: b.id
            };
          }
          return b;
        });
        setBatchLogs(updatedBatches);
      } else {
        setBatchLogs([...batchLogs, { ...batchItem, id: Date.now().toString() }]);
      }
    } else {
      const dailyItem = item as DailyTimeSeries;
      const editingId = editingItem ? getItemId(editingItem as DailyTimeSeries) : null;
      const pubStatus = (dailyItem.publishToWebGIS || (dailyItem as any).publishToUSVPRO || 'in process') as 'yes' | 'need to recheck' | 'no' | 'in process';
      const isPub = pubStatus === 'yes';

      const updatedItem: DailyTimeSeries = {
        ...dailyItem,
        publishToWebGIS: pubStatus,
        isSyncedWithSupabase: isPub,
        action: isPub ? 'Published in database' : 'Ready to publish'
      };

      const updatedDraft = editingId
        ? draftDailyData.map(d => getItemId(d) === editingId ? { ...updatedItem, id: editingId } : d)
        : [...draftDailyData, { ...updatedItem, id: updatedItem.id || Date.now().toString() }];

      setDraftDailyData(updatedDraft);
      setDailyData(updatedDraft);
      setBatchLogs(reconcileBatchLogs(updatedDraft, batchLogs));
      setIsDailyDirty(true);

      // Auto-persist directly to Supabase DB in real-time if published
      if (isPub) {
        publishToSupabase(updatedItem).catch(err => console.warn('Background auto-publish error:', err));
      }
    }

    const subName = (item as any).subgrid || (item as any).imageFilename || 'record';
    if (addAuditLog) addAuditLog('EDIT', `Record Modified: ${subName}`, `Updated parameters for subgrid ${subName}`, 'info');

    setIsFormOpen(false);
    setEditingItem(null);
  };

  const initiateDelete = (item: BatchLog | DailyTimeSeries) => {
    setDeleteTarget(item);
    openDeleteModalForMode('single');
  };

  const handleConfirmSpatialDelete = async () => {
    const targets = spatialSubgrids.filter(Boolean);
    if (targets.length === 0) return;

    const matchSub = (raw?: string) => (extractSubgridName(raw || '') || '').toUpperCase().trim();
    const affected = new Set(targets.map((sg) => sg.toUpperCase().trim()));

    let deletedPointsTotal = 0;
    let wholeDeletedSubgridsCount = 0;
    const partialSummary: string[] = [];

    const operatorName = authSession?.user?.email ? authSession.user.email.split('@')[0] : 'Operator';

    // Group daily records by normalized subgrid
    const dailyBySubgrid = new Map<string, DailyTimeSeries[]>();
    draftDailyData.forEach((d) => {
      const sg = matchSub(d.subgrid);
      const list = dailyBySubgrid.get(sg) || [];
      list.push(d);
      dailyBySubgrid.set(sg, list);
    });

    const updatedDaily: DailyTimeSeries[] = [];

    // Process each subgrid
    dailyBySubgrid.forEach((runs, sg) => {
      if (!affected.has(sg)) {
        updatedDaily.push(...runs);
        return;
      }

      const ptsForSg = spatialSelectedPoints.filter((p) => p.subgrid.toUpperCase().trim() === sg);
      const sgRow = subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === sg);
      const totalSubgridPoi =
        sgRow?.points?.length ||
        runs.reduce((sum, r) => sum + (r.poiCount || r.panoramas?.length || (r as any).images || 0), 0);

      // If no points are selected for this subgrid, keep all runs untouched
      if (ptsForSg.length === 0) {
        updatedDaily.push(...runs);
        return;
      }

      const isWholeSubgridDelete = ptsForSg.length >= totalSubgridPoi;

      if (isWholeSubgridDelete) {
        // Whole subgrid deletion
        wholeDeletedSubgridsCount += 1;
        deleteFromStagingSupabase(sg).catch((err) => console.warn('Spatial staging delete error:', err));
        deleteFromSupabase(sg).catch((err) => console.warn('Spatial delete error:', err));

        const allPanos = (sgRow?.points || runs.flatMap((r) => r.panoramas || [])).map((p: any, idx: number) => ({
          filename: p.filename || `${sg}-${String(idx + 1).padStart(4, '0')}.jpg`,
          lat: Number(p.latitude ?? p.lat ?? 0),
          lng: Number(p.longitude ?? p.lng ?? 0),
          bearing: Number(p.bearing ?? p.heading ?? 0)
        }));

        saveToRecycleBinInSupabase({
          id: `recycle-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          subgrid: sg,
          grid: runs[0]?.grid || '1',
          type: 'whole_subgrid',
          deleted_at: new Date().toISOString(),
          deleted_by: operatorName,
          poi_count: totalSubgridPoi,
          km_processed: runs.reduce((sum, r) => sum + (r.kmProcessed || 0), 0),
          points: allPanos,
          original_record: runs[0]
        }).catch((err) => console.warn('Recycle bin whole subgrid save error:', err));
      } else {
        // Partial points deletion (save ONE single recycle bin item for this subgrid)
        const delFilenames = ptsForSg.map((p) => p.filename).filter((f): f is string => Boolean(f));
        const delCoords = new Set(ptsForSg.map((p) => `${p.lat?.toFixed(5)},${p.lng?.toFixed(5)}`));
        const delCoords4 = new Set(ptsForSg.map((p) => `${p.lat?.toFixed(4)},${p.lng?.toFixed(4)}`));

        if (delFilenames.length > 0) {
          deletePointsFromSupabase(delFilenames, sg).catch((err) =>
            console.warn('Point deletion DB error:', err)
          );
        }

        const deletedPointSnapshots = ptsForSg.map((p) => ({
          filename: p.filename,
          pointId: p.pointId,
          lat: Number(p.lat ?? 0),
          lng: Number(p.lng ?? 0)
        }));

        saveToRecycleBinInSupabase({
          id: `recycle-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          subgrid: sg,
          grid: runs[0]?.grid || '1',
          type: 'partial_points',
          deleted_at: new Date().toISOString(),
          deleted_by: operatorName,
          poi_count: ptsForSg.length,
          km_processed: Math.round(ptsForSg.length * 0.005 * 100) / 100,
          points: deletedPointSnapshots,
          original_record: runs[0]
        }).catch((err) => console.warn('Recycle bin partial save error:', err));

        deletedPointsTotal += ptsForSg.length;
        let pointsLeftToDeduct = ptsForSg.length;

        // Distribute point removals across daily runs
        runs.forEach((r, rIdx) => {
          const runPanos = (r.panoramas && r.panoramas.length > 0)
            ? r.panoramas
            : (rIdx === 0 && sgRow?.points && sgRow.points.length > 0)
            ? sgRow.points.map((p, idx) => ({
                filename: p.filename || `${sg}-${String(idx + 1).padStart(4, '0')}.jpg`,
                latitude: p.lat,
                longitude: p.lng,
                lat: p.lat,
                lng: p.lng,
                isAvailable: (p as any).isAvailable !== false
              }))
            : [];

          if (runPanos.length > 0) {
            const remainingPanos = runPanos.filter((p) => {
              const pFn = (p.filename || '').split('/').pop()?.toUpperCase().trim();
              if (pFn && delFilenames.some((df) => df.toUpperCase().trim() === pFn)) return false;
              const latVal = Number(p.latitude ?? (p as any).lat);
              const lngVal = Number(p.longitude ?? (p as any).lng);
              const key1 = `${latVal.toFixed(5)},${lngVal.toFixed(5)}`;
              const key2 = `${latVal.toFixed(4)},${lngVal.toFixed(4)}`;
              if (delCoords.has(key1) || delCoords4.has(key2)) return false;
              return true;
            });

            const remainingFiles = (r.availableFilenames || []).filter((fn) => !delFilenames.includes(fn));
            const newCount = remainingPanos.length;
            const newKm = remainingPanos.length > 1
              ? calculatePanoramaTrackKm(remainingPanos)
              : Math.round(newCount * 0.005 * 100) / 100;

            if (newCount > 0) {
              updatedDaily.push({
                ...r,
                poiCount: newCount,
                imagesProcessed: newCount,
                availableImagesCount: remainingFiles.length > 0 ? remainingFiles.length : (r.availableImagesCount !== undefined ? Math.max(0, r.availableImagesCount - (r.availableFilenames?.filter(f => delFilenames.includes(f)).length || 0)) : undefined),
                kmProcessed: newKm,
                panoramas: remainingPanos,
                availableFilenames: remainingFiles.length > 0 ? remainingFiles : undefined
              });
            }
          } else {
            // Count-based fallback when panoramas array is not embedded
            const runPoi = r.poiCount || (r as any).images || 0;
            const deduct = Math.min(pointsLeftToDeduct, runPoi);
            pointsLeftToDeduct = Math.max(0, pointsLeftToDeduct - deduct);
            const newCount = Math.max(0, runPoi - deduct);
            const newKm = Math.round(newCount * 0.005 * 100) / 100;

            if (newCount > 0) {
              updatedDaily.push({
                ...r,
                poiCount: newCount,
                imagesProcessed: newCount,
                availableImagesCount: r.availableImagesCount !== undefined ? Math.max(0, r.availableImagesCount - deduct) : undefined,
                kmProcessed: newKm
              });
            }
          }
        });

        const finalRemainingSubgridPoi = Math.max(0, totalSubgridPoi - ptsForSg.length);
        partialSummary.push(`${sg}: -${ptsForSg.length} pts (${finalRemainingSubgridPoi} remaining)`);
      }
    });

    setDailyData(updatedDaily);
    setDraftDailyData(updatedDaily);
    setBatchLogs(reconcileBatchLogs(updatedDaily, batchLogs));
    setIsDailyDirty(true);

    const iframes = [currentMapIframeRef.current, afterMapIframeRef.current].filter(Boolean) as HTMLIFrameElement[];
    iframes.forEach((ifr) => {
      try {
        ifr.contentWindow?.postMessage({
          type: 'SET_STAGED_DATA',
          stagedItems: updatedDaily,
          isSingleRun: false,
          runId: null
        }, '*');
      } catch {}
    });

    if (onRefreshMap) onRefreshMap();

    if (addAuditLog) {
      if (deletedPointsTotal > 0) {
        addAuditLog(
          'DELETE',
          `Partial Points Deleted: ${partialSummary.join(', ')}`,
          `Deleted ${deletedPointsTotal} points from subgrid(s)`,
          'warning'
        );
      }
      if (wholeDeletedSubgridsCount > 0) {
        addAuditLog(
          'DELETE',
          `Subgrids Deleted: ${Array.from(affected).join(', ')}`,
          `Permanently deleted ${wholeDeletedSubgridsCount} subgrid(s)`,
          'warning'
        );
      }
    }

    const msg =
      deletedPointsTotal > 0 && wholeDeletedSubgridsCount === 0
        ? `[Database Updated] Successfully deleted ${deletedPointsTotal} point(s). Subgrid records updated dynamically (${partialSummary.join(', ')}).`
        : `[Database Updated] ${wholeDeletedSubgridsCount} subgrid(s) and ${deletedPointsTotal} point(s) permanently deleted.`;

    setPublishMessage({ text: msg, type: 'success' });
    setTimeout(() => setPublishMessage(null), 5000);

    setSpatialSubgrids([]);
    setSpatialSelectedPoints([]);
    setIsSelectionListModalOpen(false);
    setTimeout(() => refreshRecycleBinCount(), 300);
  };

  const handleRestoreRecycleBinItem = async (item: RecycleBinItem) => {
    const normSub = (extractSubgridName(item.subgrid) || item.subgrid).toUpperCase().trim();
    const matchSub = (raw?: string) => (extractSubgridName(raw || '') || '').toUpperCase().trim();

    const existingDaily = draftDailyData.find(d => matchSub(d.subgrid) === normSub);

    let updatedDaily: DailyTimeSeries[];

    if (existingDaily) {
      // Restore points into existing subgrid
      const existingPanos = existingDaily.panoramas || [];
      const restoredPanos = item.points.map(p => ({
        filename: p.filename,
        latitude: p.lat,
        longitude: p.lng,
        bearing: p.bearing || 0,
        pitch: p.pitch || 0,
        roll: p.roll || 0,
        isAvailable: true
      }));

      const existingFnSet = new Set(existingPanos.map((p: any) => p.filename).filter(Boolean));
      const newPanos = [...existingPanos];
      restoredPanos.forEach(p => {
        if (!p.filename || !existingFnSet.has(p.filename)) {
          newPanos.push(p as any);
        }
      });

      const newCount = newPanos.length;
      const newKm = newPanos.length > 1
        ? calculatePanoramaTrackKm(newPanos)
        : Math.round(newCount * 0.005 * 100) / 100;

      const updatedItem: DailyTimeSeries = {
        ...existingDaily,
        poiCount: newCount,
        imagesProcessed: newCount,
        availableImagesCount: newCount,
        kmProcessed: newKm,
        panoramas: newPanos
      };

      updatedDaily = draftDailyData.map(d => matchSub(d.subgrid) === normSub ? updatedItem : d);
      saveToStagingSupabase(updatedItem).catch(err => console.warn('Restore staging save error:', err));
    } else {
      // Re-create the subgrid entry
      const restoredPanos = item.points.map(p => ({
        filename: p.filename,
        latitude: p.lat,
        longitude: p.lng,
        bearing: p.bearing || 0,
        pitch: p.pitch || 0,
        roll: p.roll || 0,
        isAvailable: true
      }));

      const newCount = item.poi_count || restoredPanos.length || 1;
      const newKm = restoredPanos.length > 1
        ? calculatePanoramaTrackKm(restoredPanos)
        : (item.km_processed || Math.round(newCount * 0.005 * 100) / 100);

      const newItem: DailyTimeSeries = item.original_record ? {
        ...item.original_record,
        id: item.original_record.id || Date.now().toString(),
        poiCount: newCount,
        imagesProcessed: newCount,
        availableImagesCount: newCount,
        kmProcessed: newKm,
        panoramas: restoredPanos
      } : {
        id: Date.now().toString(),
        date: new Date().toISOString().slice(0, 10),
        grid: item.grid || '1',
        subgrid: normSub,
        kmProcessed: newKm,
        imagesProcessed: newCount,
        defectCount: 0,
        imagesDefected: 0,
        poiCount: newCount,
        availableImagesCount: newCount,
        captureEquipment: 'MMS',
        pic: 'Operator',
        publishToUSVPRO: 'in process',
        panoramas: restoredPanos
      };

      updatedDaily = [newItem, ...draftDailyData];
      saveToStagingSupabase(newItem).catch(err => console.warn('Restore staging save error:', err));
    }

    setDailyData(updatedDaily);
    setDraftDailyData(updatedDaily);
    setBatchLogs(reconcileBatchLogs(updatedDaily, batchLogs));
    setIsDailyDirty(true);

    if (onRefreshMap) onRefreshMap();

    if (addAuditLog) {
      addAuditLog(
        'EDIT',
        `Restored Data from Recycle Bin: ${normSub}`,
        `Restored ${item.points.length} points for subgrid ${normSub}`,
        'info'
      );
    }

    setPublishMessage({
      text: `[Restored from Recycle Bin] Successfully restored ${item.points.length} point(s) for ${normSub}.`,
      type: 'success'
    });
    setTimeout(() => setPublishMessage(null), 5000);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    /* Explicit confirmation safety gate */
    const expectedPhrase = (() => {
      if (deleteMode === 'single') {
        if (!deleteTarget || typeof deleteTarget === 'string') return '';
        const raw = ('subgrid' in deleteTarget && deleteTarget.subgrid)
          ? deleteTarget.subgrid
          : ('imageFilename' in deleteTarget ? (deleteTarget as BatchLog).imageFilename : '');
        return (extractSubgridName(raw) || '').toUpperCase().trim();
      }
      return 'DELETE';
    })();
    if (!deleteConfirmText.trim() || deleteConfirmText.trim().toUpperCase() !== expectedPhrase) {
      setDeleteError(
        deleteMode === 'single'
          ? `Access Denied: type the exact subgrid code "${expectedPhrase}" to confirm permanent deletion.`
          : 'Access Denied: type "DELETE" to confirm permanent deletion.'
      );
      return;
    }

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

    if (deleteMode === 'spatial') {
      const targets = spatialSubgrids.filter(Boolean);
      const matchSub = (raw?: string) => (extractSubgridName(raw || '') || '').toUpperCase().trim();
      const affected = new Set(targets.map((sg) => sg.toUpperCase().trim()));

      // Check if partial point deletion is taking place for any subgrid
      let deletedPointsTotal = 0;
      let wholeDeletedSubgridsCount = 0;
      const partialSummary: string[] = [];

      const updatedDaily: DailyTimeSeries[] = [];

      // Process each daily entry
      draftDailyData.forEach((d) => {
        const sg = matchSub(d.subgrid);
        if (!affected.has(sg)) {
          updatedDaily.push(d);
          return;
        }

        const ptsForSg = spatialSelectedPoints.filter((p) => p.subgrid === sg);
        const existingCount = d.panoramas?.length || d.availableImagesCount || d.poiCount || (d as any).images || 0;

        // If specific subset of points are selected (e.g. 4 points out of 14)
        if (ptsForSg.length > 0 && ptsForSg.length < existingCount) {
          const delFilenames = ptsForSg.map((p) => p.filename).filter((f): f is string => Boolean(f));
          const delCoords = new Set(ptsForSg.map((p) => `${p.lat?.toFixed(5)},${p.lng?.toFixed(5)}`));

          // Delete specific points from Supabase database
          if (delFilenames.length > 0) {
            deletePointsFromSupabase(delFilenames, sg).catch((err) =>
              console.warn('Point deletion DB error:', err)
            );
          }

          // Filter panoramas
          const remainingPanos = (d.panoramas || []).filter((p) => {
            if (p.filename && delFilenames.includes(p.filename)) return false;
            const latVal = Number(p.latitude ?? (p as any).lat);
            const lngVal = Number(p.longitude ?? (p as any).lng);
            const key = `${latVal.toFixed(5)},${lngVal.toFixed(5)}`;
            if (delCoords.has(key)) return false;
            return true;
          });

          const remainingFiles = (d.availableFilenames || []).filter((fn) => !delFilenames.includes(fn));
          const newCount =
            remainingPanos.length > 0
              ? remainingPanos.length
              : Math.max(0, existingCount - ptsForSg.length);
          const newKm =
            remainingPanos.length > 1
              ? calculatePanoramaTrackKm(remainingPanos)
              : Math.round(newCount * 0.005 * 100) / 100;

          deletedPointsTotal += ptsForSg.length;
          partialSummary.push(`${sg}: -${ptsForSg.length} pts (${newCount} remaining)`);

          if (newCount > 0) {
            updatedDaily.push({
              ...d,
              poiCount: newCount,
              imagesProcessed: newCount,
              availableImagesCount: newCount,
              kmProcessed: newKm,
              panoramas: remainingPanos,
              availableFilenames: remainingFiles.length > 0 ? remainingFiles : undefined
            });
          }
        } else {
          // Whole subgrid deletion
          wholeDeletedSubgridsCount += 1;
          deleteFromStagingSupabase(sg).catch((err) => console.warn('Spatial staging delete error:', err));
          deleteFromSupabase(sg).catch((err) => console.warn('Spatial delete error:', err));
        }
      });

      setDailyData(updatedDaily);
      setDraftDailyData(updatedDaily);
      setBatchLogs(reconcileBatchLogs(updatedDaily, batchLogs));
      setIsDailyDirty(true);

      if (onRefreshMap) onRefreshMap();

      if (addAuditLog) {
        if (deletedPointsTotal > 0) {
          addAuditLog(
            'DELETE',
            `Partial Points Deleted: ${partialSummary.join(', ')}`,
            `Deleted ${deletedPointsTotal} points from subgrid(s)`,
            'warning'
          );
        }
        if (wholeDeletedSubgridsCount > 0) {
          addAuditLog(
            'DELETE',
            `Subgrids Deleted: ${Array.from(affected).join(', ')}`,
            `Permanently deleted ${wholeDeletedSubgridsCount} subgrid(s)`,
            'warning'
          );
        }
      }

      const msg =
        deletedPointsTotal > 0 && wholeDeletedSubgridsCount === 0
          ? `[Database Updated] Successfully deleted ${deletedPointsTotal} point(s). Subgrid records updated dynamically (${partialSummary.join(', ')}).`
          : `[Database Updated] ${wholeDeletedSubgridsCount} subgrid(s) and ${deletedPointsTotal} point(s) permanently deleted.`;

      setPublishMessage({ text: msg, type: 'success' });
      setTimeout(() => setPublishMessage(null), 5000);

      setSpatialSubgrids([]);
      setSpatialSelectedPoints([]);
      setDeleteConfirmText('');
      setIsDeleteModalOpen(false);
      setDeleteTarget(null);
      setAdminPasscode('');
      setDeleteError(null);
      return;
    }

    if (typeof deleteTarget === 'string' && deleteTarget === 'BULK_SELECTION') {
      const idsToDelete = Array.from(selectedRowIds);
      const updatedDaily = dailyData.filter(d => !selectedRowIds.has(getItemId(d)));
      const updatedDraft = draftDailyData.filter(d => !selectedRowIds.has(getItemId(d)));
      setDailyData(updatedDaily);
      setDraftDailyData(updatedDraft);

      const updatedBatches = batchLogs.filter(b => !selectedRowIds.has(getItemId(b)));
      setBatchLogs(reconcileBatchLogs(updatedDaily, updatedBatches));
      setIsDailyDirty(true);

      const deletedSubgrids = new Set<string>();
      idsToDelete.forEach(id => {
        const d = dailyData.find(item => getItemId(item) === id);
        const b = batchLogs.find(item => getItemId(item) === id);
        const sg = d?.subgrid || b?.subgrid || b?.imageFilename;
        if (sg) {
          const normSub = (extractSubgridName(sg) || sg).toUpperCase().trim();
          deletedSubgrids.add(normSub);
        }
      });

      deletedSubgrids.forEach(sg => {
        deleteFromSupabase(sg).catch(err => console.warn('Bulk delete error:', err));
      });

      setSelectedRowIds(new Set());
      setIsDeleteModalOpen(false);
      setDeleteTarget(null);
      setAdminPasscode('');
      setDeleteConfirmText('');
      if (onRefreshMap) onRefreshMap();
      setPublishMessage({ text: `Successfully deleted ${idsToDelete.length} selected record(s).`, type: 'success' });
      setTimeout(() => setPublishMessage(null), 4000);
      deletedSubgrids.forEach((sg) => {
        if (addAuditLog) addAuditLog('DELETE', `Record Deleted: ${sg}`, `Bulk selection permanently deleted subgrid ${sg}`, 'warning');
      });
      return;
    }

    const idToDelete = getItemId(deleteTarget);
    const subgridName = ('subgrid' in deleteTarget && deleteTarget.subgrid) ? deleteTarget.subgrid : ('imageFilename' in deleteTarget ? (deleteTarget as BatchLog).imageFilename : 'record');
    const normSub = (extractSubgridName(subgridName) || subgridName).toUpperCase().trim();

    // Robust record matcher by ID, getItemId, or normalized subgrid + date/grid
    const isTargetMatch = (item: DailyTimeSeries | BatchLog) => {
      if (item.id && deleteTarget.id && item.id === deleteTarget.id) return true;
      if (getItemId(item) === idToDelete) return true;
      const itemSub = (extractSubgridName(('subgrid' in item && item.subgrid) ? item.subgrid : ('imageFilename' in item ? item.imageFilename : '')) || '').toUpperCase().trim();
      if (itemSub && normSub && itemSub === normSub) {
        if (item.date === deleteTarget.date || (item as any).grid === (deleteTarget as any).grid) {
          return true;
        }
      }
      return false;
    };

    const isDailyRecord = dataTab === 'daily' || ('date' in deleteTarget && 'kmProcessed' in deleteTarget && !('imageFilename' in deleteTarget));

    if (isDailyRecord) {
      // 1. In Daily Data mode, remove target daily record from dailyData & draftDailyData
      const updatedDaily = dailyData.filter(d => !isTargetMatch(d));
      const updatedDraft = draftDailyData.filter(d => !isTargetMatch(d));

      setDailyData(updatedDaily);
      setDraftDailyData(updatedDraft);

      // Check if any other daily records for this subgrid remain
      const hasRemainingDailyRows = updatedDaily.some(d => (extractSubgridName(d.subgrid || '') || '').toUpperCase().trim() === normSub);
      if (!hasRemainingDailyRows) {
        const updatedBatches = batchLogs.filter(b => (extractSubgridName(b.subgrid || b.imageFilename || '') || '').toUpperCase().trim() !== normSub);
        setBatchLogs(updatedBatches);
      } else {
        setBatchLogs(reconcileBatchLogs(updatedDaily, batchLogs));
      }
      setIsDailyDirty(true);
    } else {
      // 2. In Masterlist Batch Logs mode, delete the subgrid batch and associated daily records
      const updatedBatches = batchLogs.filter(b => !isTargetMatch(b) && (extractSubgridName(b.subgrid || b.imageFilename || '') || '').toUpperCase().trim() !== normSub);
      const updatedDaily = dailyData.filter(d => (extractSubgridName(d.subgrid || '') || '').toUpperCase().trim() !== normSub);
      const updatedDraft = draftDailyData.filter(d => (extractSubgridName(d.subgrid || '') || '').toUpperCase().trim() !== normSub);

      setBatchLogs(updatedBatches);
      setDailyData(updatedDaily);
      setDraftDailyData(updatedDraft);
      setIsDailyDirty(true);
    }



    try {
      await deleteFromStagingSupabase(normSub || subgridName);
      await deleteFromSupabase(normSub || subgridName);
    } catch (err) {
      console.warn('Background delete error:', err);
    }

    if (onRefreshMap) onRefreshMap();

    if (addAuditLog) addAuditLog('DELETE', `Record Deleted: ${subgridName}`, `Admin passcode verified, permanently deleted record ${subgridName}`, 'warning');

    setPublishMessage({
      text: `[Admin Security Action] Record for subgrid "${subgridName}" was permanently deleted from database.`,
      type: 'success'
    });
    setTimeout(() => setPublishMessage(null), 5000);

    setIsDeleteModalOpen(false);
    setDeleteTarget(null);
    setAdminPasscode('');
    setDeleteConfirmText('');
    setDeleteError(null);
  };

  const expectedDeletePhrase = (() => {
    if (deleteMode !== 'single') return 'DELETE';
    if (!deleteTarget || typeof deleteTarget === 'string') return 'SUBGRID';
    const raw = ('subgrid' in deleteTarget && deleteTarget.subgrid)
      ? deleteTarget.subgrid
      : ('imageFilename' in deleteTarget ? (deleteTarget as BatchLog).imageFilename : '');
    return (extractSubgridName(raw) || 'SUBGRID').toUpperCase().trim();
  })();

  const impactTotals = impactData?.totals;
  const hasSevereImpact = !!(impactData && (impactData.hasPublished || impactData.hasDeliverables || impactData.hasLinkedJobs || impactData.hasOrphanRisk));

  const DATA_TABS: ChromeTab<string>[] = useMemo(() => [
    {
      key: 'batches',
      label: 'Masterlist Data',
      icon: <ClipboardList size={14} />,
      badge: (
        <span className={`text-[10px] font-sans px-2 py-0.5 rounded-full ${dataTab === 'batches' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' : 'bg-inner text-text-muted border border-subtle'}`}>
          {batchLogs.length}
        </span>
      )
    },
    {
      key: 'daily',
      label: 'Daily Data',
      icon: <Calendar size={14} />,
      badge: (
        <span className={`text-[10px] font-sans px-2 py-0.5 rounded-full ${dataTab === 'daily' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' : 'bg-inner text-text-muted border border-subtle'}`}>
          {draftDailyData.length}
        </span>
      )
    },
    {
      key: 'vector',
      label: 'Vector Layers',
      icon: <Layers size={14} />
    },
    {
      key: 'datasets',
      label: tf('dataRegistryTab'),
      icon: <Database size={14} />,
      badge: isRegistryLoading ? (
        <Loader2 size={12} className="animate-spin text-sky-400" />
      ) : registryDatasets.length > 0 ? (
        <span className={`text-[10px] font-sans px-2 py-0.5 rounded-full ${dataTab === 'datasets' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' : 'bg-inner text-text-muted border border-subtle'}`}>
          {registryDatasets.length}
        </span>
      ) : null
    },
    {
      key: 'recovery',
      label: 'Dataset Recovery',
      icon: <RotateCcw size={14} />,
      badge: recycleBinCount > 0 ? (
        <span className={`text-[10px] font-sans px-2 py-0.5 rounded-full ${dataTab === 'recovery' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' : 'bg-inner text-text-muted border border-subtle'}`}>
          {recycleBinCount}
        </span>
      ) : null
    }
  ], [dataTab, batchLogs.length, draftDailyData.length, tf, isRegistryLoading, registryDatasets.length, recycleBinCount]);

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
        <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">

          {/* Header */}
          <div className="px-1">
            <h2 className="text-base font-bold text-text-base tracking-wide">
              PostgreSQL / PostGIS Data Management
            </h2>
            <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
              Inspect, query, filter, edit, and publish subgrid trajectories and GIS vector layers to production database
            </p>
          </div>

          {/* Guest Read-Only Banner */}
          {isGuestUser && (
            <div className="p-3 bg-card border border-subtle rounded-xl flex items-center gap-3 text-xs text-text-base shadow-sm">
              <AlertTriangle size={15} className="text-sky-400 shrink-0" />
              <span><strong className="text-text-base font-semibold">Guest Mode — Read Only.</strong> You can view all data but editing, uploading, deleting, and publishing are disabled. Sign in with an authorized account to make changes.</span>
            </div>
          )}

          {/* Banner notification */}
          {publishMessage && (
            <div className="p-4 rounded-xl flex items-center justify-between text-xs border font-semibold transition-all shadow-md bg-card border-subtle text-text-base">
              <div className="flex items-center gap-3">
                {publishMessage.type === 'success' ? <CheckCircle size={16} className="text-sky-400 shrink-0" /> : <AlertTriangle size={16} className="text-text-muted shrink-0" />}
                <span>{publishMessage.text}</span>
              </div>
              <button onClick={() => setPublishMessage(null)} className="text-text-muted hover:text-text-base p-1 cursor-pointer">
                <X size={15} />
              </button>
            </div>
          )}

          {/* MAIN PANEL CONTENT BACK CANVAS */}
          <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col shrink-0">
            {/* Integrated Sub-Tabs Underline Strip */}
            <div className="px-3 pt-2 border-b border-divider bg-card">
              <UnderlineTabStrip
                tabs={DATA_TABS}
                active={dataTab}
                onChange={(k) => {
                  setDataTab(k as any);
                  setSearchQuery('');
                }}
              />
            </div>

            <div key={dataTab} className="p-4 flex-1 flex flex-col gap-4 animate-panel-enter">

            {/* Selection Map + Safe Deletion panel */}
            <div className="bg-inner/40 border border-subtle rounded-xl shadow-sm overflow-hidden">
            <div className="p-3.5 flex flex-wrap items-center gap-3 border-b border-subtle">
              <button
                onClick={() => { if (dataTab === 'datasets' && !isSelectionMapOpen) setDataTab('batches'); setIsSelectionMapOpen(o => !o); }}
                className="flex items-center gap-2 text-xs font-bold text-text-base cursor-pointer hover:text-sky-300 transition-colors"
              >
                <MapIcon size={15} className="text-sky-400" />
                <span>{tf('dataSelectionMapTitle')}</span>
                {isSelectionMapOpen ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
              </button>
              <span className="text-[10px] text-text-muted hidden sm:inline">
                {tf('dataSelectionMapHint')}
              </span>
              <div className="flex-1" />
              {isSelectionMapOpen && (
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <Layers size={12} className="text-sky-400" />
                  <span className="hidden sm:inline">Subgrid</span>
                  <select
                    value={mapSubgridFilter}
                    onChange={(e) => setMapSubgridFilter(e.target.value)}
                    className="bg-inner border border-subtle rounded-md px-2 py-1 text-[11px] text-text-base cursor-pointer outline-none focus:border-sky-500/50 max-w-[160px]"
                  >
                    <option value="">All Subgrids</option>
                    {availableSubgridList.map((sg) => (
                      <option key={sg} value={sg}>{sg}</option>
                    ))}
                  </select>
                </label>
              )}
              {isGuestUser ? (
                <span className="text-[10px] text-text-muted border border-subtle px-2 py-1 rounded-md bg-inner">{tf('dataSelectionMapGuest')}</span>
              ) : (
                <button
                  onClick={() => {
                    if (isSelectionMapOpen && deleteModeActive && spatialSubgrids.length > 0) {
                      setPublishMessage({ text: 'Deletion mode left active with pending selection. Review it or clear before exiting.', type: 'error' });
                      return;
                    }
                    if (isSelectionMapOpen && !deleteModeActive) {
                      setSpatialSubgrids([]);
                    }
                    openDeleteModeToggle();
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer border ${deleteModeActive
                    ? 'bg-rose-600/90 text-white border-rose-500/50'
                    : 'bg-inner text-text-base border-subtle hover:text-text-base hover:bg-inner'
                    }`}
                >
                  <MousePointer2 size={13} className={deleteModeActive ? 'text-white' : 'text-sky-400'} />
                  <span>{deleteModeActive ? tf('dataDeleteModeOn') : tf('dataDeleteModeOff')}</span>
                </button>
              )}
            </div>
            {isSelectionMapOpen && (
              <div className="p-3.5 space-y-3">
                {deleteModeActive && (
                  <div className="p-3 bg-card/90 border border-rose-500/30 rounded-xl flex flex-wrap items-center justify-between gap-2.5 text-xs text-text-base shadow-lg backdrop-blur-md">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
                        <Trash2 size={14} className="text-rose-400" />
                      </div>
                      <div>
                        <span className="font-bold text-text-base text-xs">Safe Spatial Deletion Active</span>
                        <p className="text-[11px] text-text-muted">
                          Draw a bounding box by dragging over the map, or click a station point to select existing survey subgrids.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-sans font-semibold px-2 py-0.5 rounded bg-inner border border-subtle text-text-muted">
                        Available in DB: {Array.from(new Set([...batchLogs.map(b => (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim()), ...dailyData.map(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim())])).filter(Boolean).length} Subgrids
                      </span>
                    </div>
                  </div>
                )}
                {deleteModeActive ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 p-2 bg-inner/60 rounded-xl">
                    {/* Pane 1: Current Production WebGIS (all survey data) */}
                    <div className="relative flex flex-col rounded-xl overflow-hidden border border-subtle bg-slate-950 min-h-[300px]">
                      <div className="px-3 py-1.5 bg-card border-b border-subtle flex items-center justify-between text-xs shrink-0">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 size={12} className="text-sky-400" />
                          <span className="font-bold text-sky-300 text-[11px]">Current Production WebGIS</span>
                        </div>
                        <span className="text-[10px] text-text-muted font-sans">
                          {mapSubgridFilter
                            ? `Subgrid: ${mapSubgridFilter} (${filteredCurrentMapItems.reduce((acc, it) => acc + (it.panoramas?.length || it.points?.length || 0), 0)} pts)`
                            : `All survey data (${availableSubgridList.length} subgrid${availableSubgridList.length === 1 ? '' : 's'})`}
                        </span>
                        <div className="flex items-center gap-1 p-0.5 bg-inner border border-subtle rounded-lg">
                          <button
                            onClick={() => setSelectionNavMode('select')}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${selectionNavMode === 'select' ? 'bg-rose-600/90 text-white' : 'text-text-muted hover:text-text-base'}`}
                          >
                            Select
                          </button>
                          <button
                            onClick={() => setSelectionNavMode('navigate')}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${selectionNavMode === 'navigate' ? 'bg-sky-600/90 text-white' : 'text-text-muted hover:text-text-base'}`}
                          >
                            Navigate
                          </button>
                        </div>
                      </div>
                      <div ref={currentMapContainerRef} className="relative w-full overflow-hidden" style={{ height: 640 }}>
                        <MapComponent
                          dataManagement
                          refreshKey={mapRefreshKey}
                          stagedItems={filteredCurrentMapItems}
                          selectedSubgrids={spatialSubgrids}
                          selectedPoints={spatialSelectedPoints}
                          selectedSubgridFilter={mapSubgridFilter}
                          iframeRefCb={(el) => { currentMapIframeRef.current = el; }}
                        />
                        <SelectionMapOverlay
                          iframeRef={currentMapIframeRef}
                          containerRef={currentMapContainerRef}
                          deletionMode={deleteModeActive && !isGuestUser}
                          mode={selectionNavMode}
                          onAddSubgrids={handleSpatialAdd}
                          subgridPoints={subgridPoints}
                          availableSubgrids={availableSubgridList}
                          selectedSubgrids={spatialSubgrids}
                          selectedPoints={spatialSelectedPoints}
                          subgridFilter={mapSubgridFilter}
                          onFlyTo={handleFlyToSelection}
                        />
                      </div>
                    </div>
                    {/* Pane 2: After Deletion Preview (selected subgrids removed) */}
                    <div className="relative flex flex-col rounded-xl overflow-hidden border border-subtle bg-slate-950 min-h-[300px]">
                      <div className="px-3 py-1.5 bg-card border-b border-subtle flex items-center justify-between text-xs shrink-0">
                        <div className="flex items-center gap-1.5">
                          <Trash2 size={12} className="text-rose-400" />
                          <span className="font-bold text-rose-300 text-[11px]">After Deletion Preview</span>
                        </div>
                        <span className="text-[10px] text-text-muted font-sans">
                          {mapSubgridFilter
                            ? (spatialSelectionSet.has(mapSubgridFilter.toUpperCase().trim())
                              ? `Subgrid: ${mapSubgridFilter} (Purged)`
                              : `Subgrid: ${mapSubgridFilter} (${filteredAfterMapItems.reduce((acc, it) => acc + (it.panoramas?.length || it.points?.length || 0), 0)} pts)`)
                            : (spatialSubgrids.length > 0 ? `${spatialSubgrids.length} Target(s) Purged` : '0 Selected')}
                        </span>
                        <div className="flex items-center gap-1 p-0.5 bg-inner border border-subtle rounded-lg">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold text-text-muted">Read Only</span>
                        </div>
                      </div>
                      <div className="relative w-full overflow-hidden" style={{ height: 640 }}>
                        <MapComponent
                          dataManagement
                          refreshKey={mapRefreshKey}
                          stagedItems={filteredAfterMapItems}
                          selectedSubgrids={spatialSubgrids}
                          selectedPoints={spatialSelectedPoints}
                          selectedSubgridFilter={mapSubgridFilter}
                          isAfterDeletionPreview={true}
                          iframeRefCb={(el) => { afterMapIframeRef.current = el; }}
                        />
                        {spatialSubgrids.length > 0 && (
                          <div className="absolute bottom-2 left-2 right-2 z-10 pointer-events-none flex justify-center">
                            <div className="bg-slate-950/90 backdrop-blur-md border border-rose-500/40 rounded-xl px-3 py-1.5 text-center shadow-2xl max-w-sm">
                              <p className="text-[11px] font-medium text-slate-200">
                                <strong className="font-sans text-rose-300">{spatialSubgrids.join(', ')}</strong> will be purged from active WebGIS layers.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-[460px] sm:h-[500px] lg:h-[520px]">
                    <MapComponent dataManagement refreshKey={mapRefreshKey} stagedItems={safeDeletionMapItems} projectSettings={projectSettings} />
                  </div>
                )}
                {deleteModeActive && (
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => setIsSelectionListModalOpen(true)}
                        disabled={spatialSubgrids.length === 0}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-inner hover:bg-card text-text-base border border-subtle hover:border-sky-500/40 rounded-xl text-xs font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                      >
                        <Layers size={13} className="text-sky-400" />
                        <span>Inspect Data Selection ({spatialSelectedPoints.length > 0 ? `${spatialSelectedPoints.length} pts` : `${spatialSubgrids.length} subgrids`})</span>
                      </button>

                      <button
                        onClick={() => {
                          setSpatialSubgrids([]);
                          setSpatialSelectedPoints([]);
                        }}
                        disabled={spatialSubgrids.length === 0}
                        className="px-3 py-2 text-xs text-text-muted hover:text-text-base transition-colors cursor-pointer disabled:opacity-40"
                      >
                        {tf('dataClearSelection')}
                      </button>

                      <button
                        onClick={() => {
                          setDataTab('recovery');
                          setIsSelectionMapOpen(false);
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 bg-inner hover:bg-card text-text-muted hover:text-text-base border border-subtle rounded-xl text-xs font-medium transition-all cursor-pointer shadow-sm"
                        title="Open Dataset Recovery tab to restore deleted survey data"
                      >
                        <RotateCcw size={12} className="text-sky-400" />
                        <span>Dataset Recovery</span>
                        {recycleBinCount > 0 && (
                          <span className="text-[10px] font-sans px-1.5 py-0.2 rounded-full bg-sky-500/20 text-sky-400">
                            {recycleBinCount}
                          </span>
                        )}
                      </button>
                    </div>

                    <div className="text-[11px] text-text-muted font-sans">
                      {spatialSubgrids.length > 0 ? (
                        <span>{spatialSubgrids.length} subgrid(s) selected ({spatialSelectedPoints.length > 0 ? `${spatialSelectedPoints.length} points` : 'All points'})</span>
                      ) : (
                        <span>Select survey points or draw a bbox</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Toolbar Row */}
          {(dataTab === 'batches' || dataTab === 'daily') && (
            <div className="flex flex-wrap items-center justify-between gap-4 bg-card border border-subtle p-3 rounded-2xl shadow-sm">
              {/* Search Bar & Filter Toggle Button */}
              <div className="flex items-center gap-3 flex-1 max-w-md">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search subgrid, grid, date, or PIC..."
                    className="w-full bg-card border border-subtle rounded-xl pl-9 pr-8 py-2 text-xs text-text-base placeholder-text-muted focus:outline-none focus:border-sky-500/80 focus:ring-1 focus:ring-sky-500/20 transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-base cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {dataTab === 'daily' && (
                  <button
                    onClick={() => setIsColumnFilterOpen(prev => !prev)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer border shrink-0 ${activeDailyFilterCount > 0
                      ? 'bg-sky-600 border-sky-500 text-text-base shadow-md'
                      : isColumnFilterOpen
                        ? 'bg-inner border-sky-500 text-sky-400'
                        : 'bg-card border-subtle text-text-base hover:bg-inner hover:text-text-base'
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

              {/* Action Buttons */}
              {(dataTab === 'daily' || dataTab === 'batches') && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={async () => {
                      setPublishMessage({ text: 'Syncing live records from Supabase mobilemapping database...', type: 'success' });
                      const { dailyData: sDaily, batchLogs: sBatches, error } = await fetchSupabaseData();
                      if (error) {
                        setPublishMessage({ text: 'Error syncing with Supabase: ' + error, type: 'error' });
                      } else {
                        setDailyData(sDaily || []);
                        setDraftDailyData(sDaily || []);
                        setBatchLogs(sBatches || []);
                        setIsDailyDirty(false);
                        setPublishMessage({ text: `Successfully synced ${sDaily ? sDaily.length : 0} records directly from Supabase!`, type: 'success' });
                      }
                    }}
                    className="flex items-center gap-2 bg-card hover:bg-inner border border-subtle text-text-base px-3.5 py-2 rounded-xl transition-all text-xs font-semibold cursor-pointer shadow-sm"
                    title="Sync latest live records from Supabase mobilemapping database"
                  >
                    <RefreshCw size={13} className="text-sky-400" />
                    <span>Sync Now</span>
                  </button>

                  {!isGuestUser && (
                    <label className="flex items-center gap-2 bg-card hover:bg-inner border border-subtle px-3.5 py-2 rounded-xl transition-all cursor-pointer text-text-base font-semibold text-xs shadow-sm active:scale-95">
                      <FileText size={13} className="text-emerald-400" />
                      <span>Import CSV</span>
                      <input
                        ref={csvInputRef}
                        type="file"
                        accept=".csv"
                        multiple
                        className="hidden"
                        onChange={handleCsvFile}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Expandable Column Filter Panel (Daily Data) */}
          {isColumnFilterOpen && dataTab === 'daily' && (
            <div className="p-4 bg-card border border-subtle rounded-2xl shadow-xl space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-subtle text-xs text-text-base font-bold uppercase tracking-wider">
                <div className="flex items-center gap-2">
                  <Filter size={14} className="text-sky-400" />
                  <span>Daily Data Column Filters</span>
                </div>
                {activeDailyFilterCount > 0 && (
                  <button
                    onClick={() => setDailyColumnFilters({ grid: '', subgrid: '', equipment: '', pic: '', publishStatus: '' })}
                    className="text-rose-400 hover:text-rose-300 text-xs font-semibold cursor-pointer flex items-center gap-1 transition-colors"
                  >
                    <X size={12} /> Clear Column Filters
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
                {/* Grid Filter */}
                <div>
                  <label className="block text-text-muted mb-1 font-medium text-[11px]">Grid</label>
                  <select
                    value={dailyColumnFilters.grid}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, grid: e.target.value }))}
                    className="w-full bg-card border border-subtle text-text-base rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-sky-500/80"
                  >
                    <option value="">All Grids</option>
                    {dailyColumnOptions.grids.map(g => (
                      <option key={g} value={g}>Grid {g}</option>
                    ))}
                  </select>
                </div>

                {/* Subgrid Filter */}
                <div>
                  <label className="block text-text-muted mb-1 font-medium text-[11px]">Subgrid</label>
                  <select
                    value={dailyColumnFilters.subgrid}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, subgrid: e.target.value }))}
                    className="w-full bg-card border border-subtle text-text-base rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-sky-500/80"
                  >
                    <option value="">All Subgrids</option>
                    {dailyColumnOptions.subgrids.map(sg => (
                      <option key={sg} value={sg}>{sg}</option>
                    ))}
                  </select>
                </div>

                {/* Capture Equipment */}
                <div>
                  <label className="block text-text-muted mb-1 font-medium text-[11px]">Equipment</label>
                  <select
                    value={dailyColumnFilters.equipment}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, equipment: e.target.value }))}
                    className="w-full bg-card border border-subtle text-text-base rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-sky-500/80"
                  >
                    <option value="">All Equipment</option>
                    {dailyColumnOptions.equipment.map(eq => (
                      <option key={eq} value={eq}>{eq}</option>
                    ))}
                  </select>
                </div>

                {/* PIC Filter */}
                <div>
                  <label className="block text-text-muted mb-1 font-medium text-[11px]">PIC</label>
                  <select
                    value={dailyColumnFilters.pic}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, pic: e.target.value }))}
                    className="w-full bg-card border border-subtle text-text-base rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-sky-500/80"
                  >
                    <option value="">All PICs</option>
                    {dailyColumnOptions.pics.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                {/* Publish Status */}
                <div>
                  <label className="block text-text-muted mb-1 font-medium text-[11px]">Publish Status</label>
                  <select
                    value={dailyColumnFilters.publishStatus}
                    onChange={(e) => setDailyColumnFilters(prev => ({ ...prev, publishStatus: e.target.value }))}
                    className="w-full bg-card border border-subtle text-text-base rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-sky-500/80"
                  >
                    <option value="">All Statuses</option>
                    {dailyColumnOptions.publishStatus.map(st => (
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
                  <div className="bg-card border border-subtle rounded-2xl p-6 shadow-sm">
                    <h2 className="text-base font-bold text-text-base mb-2">Upload Vector Data</h2>
                    <p className="text-xs text-text-muted mb-5">Supported formats: GeoJSON, KML, GPX, Shapefile, CSV</p>

                    <div className="flex flex-col gap-3">
                      <label className="flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 px-5 py-2.5 rounded-xl transition-all cursor-pointer text-xs font-bold text-text-base shadow-md">
                        <Upload size={16} />
                        <span>Select Files</span>
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
                        className="flex items-center justify-center gap-2 bg-inner hover:bg-inner text-text-base border border-subtle px-5 py-2.5 rounded-xl transition-all text-xs font-semibold cursor-pointer"
                      >
                        <Folder size={16} className="text-amber-400" />
                        <span>Create Folder</span>
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
                  <div className="bg-card border border-subtle rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-base font-bold text-text-base">Layer Catalog</h2>
                      <span className="text-text-muted text-xs">
                        {flattenLayers(layerCatalog).length} saved, {flattenLayers(stagedLayers).length} staged
                      </span>
                    </div>

                    {/* Staged Items */}
                    {stagedLayers.length > 0 && (
                      <div className="mb-4">
                        <h3 className="text-xs font-semibold text-amber-500 mb-2 flex items-center gap-2">
                          <AlertTriangle size={14} />
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
                        <h3 className="text-xs font-semibold text-sky-500 mb-2 flex items-center gap-2">
                          <CheckCircle size={14} />
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
                      <div className="text-text-muted text-center py-8">
                        <p>No layers or folders yet</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Map Preview */}
                <div className="lg:col-span-2">
                  <div className="bg-card border border-subtle rounded-2xl overflow-hidden shadow-xl">
                    <h2 className="text-sm font-bold text-text-base p-4 border-b border-subtle flex items-center gap-2">
                      <Globe size={16} className="text-sky-400" />
                      <span>Basemap Preview</span>
                    </h2>
                    <div className="h-[600px]">
                      <MapComponent dataManagement layerCatalog={[...layerCatalog, ...stagedLayers]} refreshKey={mapRefreshKey} onManualRefresh={onRefreshMap} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : dataTab === 'datasets' ? (
            /* Dataset Registry Section */
            <div className="space-y-6">
              <DatasetRegistryPanel
                translate={tf}
                isGuestUser={isGuestUser}
                userLabel={authSession?.user?.email || 'Operator'}
                onAddNotification={addNotification}
                onAddAuditLog={addAuditLog}
                onOpenInMap={(sg) => {
                  setFocusSubgrid(sg);
                  setIsSelectionMapOpen(true);
                  if (dataTab === 'datasets') setDataTab('batches');
                }}
              />
            </div>
          ) : dataTab === 'recovery' ? (
            /* Dataset Recovery / Recycle Bin Section */
            <div className="space-y-6">
              <DatasetRecoveryPanel
                onRestoreItem={async (item) => {
                  await handleRestoreRecycleBinItem(item);
                  refreshRecycleBinCount();
                }}
                isGuestUser={isGuestUser}
                onRefreshMap={onRefreshMap}
              />
            </div>
          ) : (
            <>


              {/* Bulk Selection Bar */}
              {selectedRowIds.size > 0 && (
                <div className="bg-app border border-subtle rounded-2xl px-5 py-3 flex flex-wrap items-center justify-between gap-4 shadow-xl animate-fadeIn text-xs">
                  <div className="flex items-center gap-2.5 text-text-base font-medium">
                    <span className="bg-sky-500/20 text-sky-400 border border-sky-500/30 px-2.5 py-0.5 rounded-full font-sans font-bold text-xs">{selectedRowIds.size}</span>
                    <span>record(s) selected</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleBulkPublish}
                      disabled={isBulkPublishing}
                      className="px-4 py-2 bg-emerald-600/90 hover:bg-emerald-600 text-text-base rounded-xl font-semibold flex items-center gap-2 transition-all shadow-sm cursor-pointer disabled:opacity-50 active:scale-95"
                    >
                      {isBulkPublishing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                      <span>Publish Selected ({selectedRowIds.size})</span>
                    </button>
                    {!isGuestUser && (
                      <button
                        onClick={handleBulkDelete}
                        className="px-4 py-2 bg-inner hover:bg-red-950/80 text-red-400 hover:text-red-300 border border-red-900/60 rounded-xl font-semibold flex items-center gap-2 transition-all shadow-sm cursor-pointer active:scale-95"
                      >
                        <Trash2 size={14} />
                        <span>Delete Selected ({selectedRowIds.size})</span>
                      </button>
                    )}
                    <button
                      onClick={handleBulkExportCsv}
                      className="px-4 py-2 bg-inner hover:bg-sky-950/60 text-sky-400 hover:text-sky-300 border border-subtle rounded-xl font-semibold flex items-center gap-2 transition-all shadow-sm cursor-pointer active:scale-95"
                      title="Export the selected records as a CSV file"
                    >
                      <Download size={14} />
                      <span>Export Selected ({selectedRowIds.size})</span>
                    </button>
                    <button
                      onClick={() => setSelectedRowIds(new Set())}
                      className="px-3 py-2 text-text-muted hover:text-text-base transition-colors cursor-pointer text-xs"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-card border border-subtle rounded-2xl shadow-sm overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-card text-text-muted border-b border-subtle select-none">
                      <tr>
                        <th className="px-3 py-3.5 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={
                              dataTab === 'batches'
                                ? paginatedBatchLogs.length > 0 && paginatedBatchLogs.every(b => selectedRowIds.has(getItemId(b)))
                                : paginatedDailyData.length > 0 && paginatedDailyData.every(d => selectedRowIds.has(getItemId(d)))
                            }
                            onChange={(e) => {
                              const currentList = dataTab === 'batches' ? paginatedBatchLogs : paginatedDailyData;
                              if (e.target.checked) {
                                setSelectedRowIds(prev => {
                                  const next = new Set(prev);
                                  currentList.forEach(item => next.add(getItemId(item)));
                                  return next;
                                });
                              } else {
                                setSelectedRowIds(prev => {
                                  const next = new Set(prev);
                                  currentList.forEach(item => next.delete(getItemId(item)));
                                  return next;
                                });
                              }
                            }}
                            className="rounded border-subtle bg-app text-sky-500 focus:ring-sky-500 cursor-pointer w-4 h-4 accent-sky-500"
                            title="Select / Deselect all rows"
                          />
                        </th>
                        {dataTab === 'batches' ? (
                          <>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Date</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Grid</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Subgrid</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Frames</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">KM Processed</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Images Processed</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Defects</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">PIC</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Status</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Configure</th>
                          </>
                        ) : (
                          <>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Date</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Grid</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Subgrid</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Frames</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">KM Processed</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Images Processed</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Capture Equipment</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Defects</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">PIC</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Publish to WebGIS</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Status</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap text-text-muted">Configure</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {dataTab === 'batches' ? (
                        paginatedBatchLogs.length > 0 ? (
                          paginatedBatchLogs.map((batch, index) => {
                            const batchSubgrid = (extractSubgridName(batch.subgrid || batch.imageFilename) || '').toUpperCase().trim();
                            return (
                              <tr
                                key={batch.id || `b-${index}`}
                                className="border-t border-subtle hover:bg-inner/60 transition-colors text-text-base"
                              >
                                <td className="px-3 py-3.5 w-10 text-center" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={selectedRowIds.has(getItemId(batch))}
                                    onChange={(e) => {
                                      const id = getItemId(batch);
                                      setSelectedRowIds(prev => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(id);
                                        else next.delete(id);
                                        return next;
                                      });
                                    }}
                                    className="rounded border-subtle bg-app text-sky-500 focus:ring-sky-500 cursor-pointer w-4 h-4 accent-sky-500"
                                  />
                                </td>
                                <td className="px-4 py-3.5 text-xs text-text-base whitespace-nowrap font-medium">{formatDisplayDate(batch.date)}</td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-bold whitespace-nowrap">{batch.grid}</td>
                                <td className="px-4 py-3.5 text-xs font-bold text-text-base whitespace-nowrap flex items-center gap-2">
                                  <span>{batchSubgrid}</span>
                                </td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-medium whitespace-nowrap">{getPOICount(batch).toLocaleString()}</td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-medium whitespace-nowrap">{batch.kmProcessed.toFixed(1)}</td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const customFn = batch.availableFilenames && batch.availableFilenames.length > 0
                                        ? batch.availableFilenames
                                        : (batch.panoramas && batch.panoramas.length > 0
                                          ? batch.panoramas.filter((p: any) => p.isAvailable !== false).map((p: any) => p.filename).filter((f): f is string => Boolean(f))
                                          : undefined);
                                      setImagesListModal({
                                        isOpen: true,
                                        subgrid: batchSubgrid,
                                        count: getImagesProcessedCount(batch),
                                        poiCount: getPOICount(batch),
                                        baseFilename: batch.imageFilename,
                                        customFilenames: customFn && customFn.length > 0 ? customFn : undefined
                                      });
                                    }}
                                    className="text-text-base hover:text-sky-300 hover:underline font-medium text-xs cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                                    title="Click to view list of image filenames"
                                  >
                                    <span>{getImagesProcessedCount(batch).toLocaleString()} frames</span>
                                    <ExternalLink size={11} className="shrink-0 text-text-muted" />
                                  </button>
                                </td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-medium whitespace-nowrap">
                                  {batch.defects || 0}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-medium whitespace-nowrap">
                                  {(batch.pic && batch.pic.trim().toLowerCase() !== 'unassigned') ? batch.pic : (activeAuthUserName || 'Admin')}
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  {batch.status === 'Complete' ? (
                                    <div className="inline-flex items-center gap-2 text-xs font-medium text-text-base whitespace-nowrap">
                                      <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                                      <span>Published in database</span>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-2 text-xs font-medium text-text-base whitespace-nowrap">
                                      <Clock size={14} className="text-amber-400 shrink-0" />
                                      <span>Ready to publish</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 flex items-center gap-2.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => setQcModal({
                                      isOpen: true,
                                      subgrid: batchSubgrid,
                                      poiCount: getPOICount(batch),
                                      availableCount: getImagesProcessedCount(batch),
                                      baseFilename: batch.imageFilename,
                                      availableFilenames: batch.availableFilenames,
                                      expectedFilenames: batch.panoramas?.map((p: any) => p.filename).filter(Boolean)
                                    })}
                                    className="text-text-base hover:text-white text-xs font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5 p-1"
                                    title="View QC Audit Details"
                                  >
                                    <ShieldAlert size={14} className="text-rose-400 shrink-0" />
                                    <span>QC Audit</span>
                                  </button>
                                  {!isGuestUser ? (
                                    <>
                                      <button
                                        onClick={() => {
                                          setEditingItem(batch);
                                          setIsFormOpen(true);
                                        }}
                                        className="text-text-muted hover:text-sky-400 transition-colors p-1 cursor-pointer"
                                        title="Edit Record"
                                      >
                                        <Edit2 size={16} />
                                      </button>
                                      <button
                                        onClick={() => initiateDelete(batch)}
                                        className="text-text-muted hover:text-rose-400 transition-colors p-1 cursor-pointer"
                                        title="Delete Record (Admin Authorization Required)"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-text-muted italic">View only</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={10} className="px-4 py-6">
                              <EmptyState
                                className="py-6"
                                icon={FileText}
                                title={searchQuery ? `No batch logs found matching "${searchQuery}"` : 'No batch logs available'}
                                hint="Upload a new batch from the toolbar, or adjust your filters to see more records."
                              />
                            </td>
                          </tr>
                        )
                      ) : (
                        paginatedDailyData.length > 0 ? (
                          paginatedDailyData.map((daily, index) => {
                            const dailySubgrid = (daily.subgrid || '').toUpperCase().trim();
                            const isPublished = daily.publishToWebGIS === 'yes';
                            return (
                              <tr
                                key={daily.id || `d-${daily.date}-${daily.subgrid}-${index}`}
                                className="border-t border-subtle hover:bg-inner/60 transition-colors text-text-base"
                              >
                                <td className="px-3 py-3.5 w-10 text-center" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={selectedRowIds.has(getItemId(daily))}
                                    onChange={(e) => {
                                      const id = getItemId(daily);
                                      setSelectedRowIds(prev => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(id);
                                        else next.delete(id);
                                        return next;
                                      });
                                    }}
                                    className="rounded border-subtle bg-app text-sky-500 focus:ring-sky-500 cursor-pointer w-4 h-4 accent-sky-500"
                                  />
                                </td>
                                <td className="px-4 py-3.5 text-xs text-text-base whitespace-nowrap font-medium">{formatDisplayDate(daily.date)}</td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-bold whitespace-nowrap">{daily.grid}</td>
                                <td className="px-4 py-3.5 text-xs font-bold text-text-base whitespace-nowrap flex items-center gap-2">
                                  <span>{dailySubgrid}</span>
                                </td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-medium whitespace-nowrap">{getPOICount(daily).toLocaleString()}</td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-medium whitespace-nowrap">{daily.kmProcessed.toFixed(1)}</td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const subFilter = (extractSubgridName(dailySubgrid) || dailySubgrid).toUpperCase().trim();
                                      const customFn = daily.availableFilenames && daily.availableFilenames.length > 0
                                        ? daily.availableFilenames
                                        : (daily.panoramas && daily.panoramas.length > 0
                                          ? daily.panoramas.filter((p: any) => p.isAvailable !== false).map((p: any) => p.filename).filter((f): f is string => Boolean(f) && (extractSubgridName(f) || '').toUpperCase().trim() === subFilter)
                                          : undefined);
                                      const rowFrameCount = getImagesProcessedCount(daily);
                                      setImagesListModal({
                                        isOpen: true,
                                        subgrid: dailySubgrid,
                                        count: customFn && customFn.length > 0 ? customFn.length : rowFrameCount,
                                        poiCount: getPOICount(daily),
                                        baseFilename: (daily.panoramas?.[0]?.filename) || `${dailySubgrid}-0001.jpg`,
                                        customFilenames: customFn && customFn.length > 0 ? customFn : undefined
                                      });
                                    }}
                                    className="text-text-base hover:text-sky-300 hover:underline font-medium text-xs cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                                    title="Click to view list of image filenames"
                                  >
                                    <span>{getImagesProcessedCount(daily).toLocaleString()} frames</span>
                                    <ExternalLink size={11} className="shrink-0 text-text-muted" />
                                  </button>
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  <select
                                    value={daily.captureEquipment || 'MMS'}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      const updated = draftDailyData.map(d => getItemId(d) === getItemId(daily) ? { ...d, captureEquipment: val } : d);
                                      setDraftDailyData(updated);
                                      setDailyData(updated);
                                      setBatchLogs(reconcileBatchLogs(updated, batchLogs));
                                    }}
                                    className="bg-card border border-subtle hover:border-slate-600 rounded-lg px-2.5 py-1 text-xs font-semibold text-text-base focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                                  >
                                    <option value="MMS" className="bg-card text-text-base">MMS</option>
                                    <option value="Backpack" className="bg-card text-text-base">Backpack</option>
                                    <option value="Drone" className="bg-card text-text-base">Drone</option>
                                    <option value="Handheld" className="bg-card text-text-base">Handheld</option>
                                  </select>
                                </td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-medium whitespace-nowrap">
                                  {daily.imagesDefected || daily.defectCount || 0}
                                </td>
                                <td className="px-4 py-3.5 text-xs text-text-base font-medium whitespace-nowrap">
                                  {(daily.pic && daily.pic.trim().toLowerCase() !== 'unassigned')
                                    ? daily.pic
                                    : (activeAuthUserName || (authSession?.user?.email ? authSession.user.email.split('@')[0] : '') || 'Operator')}
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  <select
                                    value={daily.publishToWebGIS || 'in process'}
                                    onChange={(e) => {
                                      const val = e.target.value as DailyTimeSeries['publishToWebGIS'];
                                      if (val === 'yes') {
                                        handlePublishRecord(daily);
                                      } else {
                                        const updated = draftDailyData.map(d => getItemId(d) === getItemId(daily) ? { ...d, publishToWebGIS: val, isSyncedWithSupabase: false } : d);
                                        setDraftDailyData(updated);
                                        setDailyData(updated);
                                      }
                                    }}
                                    className="bg-card border border-subtle hover:border-slate-600 rounded-lg px-2.5 py-1 text-xs font-semibold text-text-base focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                                  >
                                    <option value="in process" className="bg-card text-text-base">In Process</option>
                                    <option value="yes" className="bg-card text-text-base">Yes - Publish</option>
                                    <option value="need to recheck" className="bg-card text-text-base">Need to Recheck</option>
                                    <option value="no" className="bg-card text-text-muted">No</option>
                                  </select>
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  {isPublished ? (
                                    <div className="inline-flex items-center gap-2 text-xs font-medium text-text-base whitespace-nowrap">
                                      <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                                      <span>Published in database</span>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-2 text-xs font-medium text-text-base whitespace-nowrap">
                                      <Clock size={14} className="text-amber-400 shrink-0" />
                                      <span>Ready to publish</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 flex items-center gap-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                  {!isGuestUser ? (
                                    <>
                                      <button
                                        onClick={() => handlePublishRecord(daily)}
                                        disabled={isPublished || publishingId === getItemId(daily)}
                                        className={`p-1.5 rounded-lg transition-colors ${isPublished ? 'text-text-muted cursor-not-allowed opacity-40' : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer'}`}
                                        title={isPublished ? 'Already published in database' : 'Click to publish to database'}
                                      >
                                        {publishingId === getItemId(daily) ? (
                                          <RefreshCw size={16} className="animate-spin text-sky-400" />
                                        ) : (
                                          <Database size={16} />
                                        )}
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingItem(daily);
                                          setIsFormOpen(true);
                                        }}
                                        className="text-text-muted hover:text-sky-400 hover:bg-sky-500/10 transition-colors p-1.5 rounded-lg cursor-pointer"
                                        title="Edit Record"
                                      >
                                        <Edit2 size={16} />
                                      </button>
                                      <button
                                        onClick={() => initiateDelete(daily)}
                                        className="text-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors p-1.5 rounded-lg cursor-pointer"
                                        title="Delete Record (Admin Authorization Required)"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-text-muted italic">View only</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={12} className="px-4 py-6">
                              <EmptyState
                                className="py-6"
                                icon={ClipboardList}
                                title={searchQuery ? `No daily records found matching "${searchQuery}"` : 'No daily data available'}
                                hint="Register daily data from the production workspace, or try clearing your search and filters."
                              />
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls Footer */}
                {totalItems > 0 && (
                  <div className="px-5 py-3.5 bg-card border-t border-subtle flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
                    <div className="flex items-center gap-4">
                      <span>
                        Showing <strong className="text-text-base font-bold">{(safePage - 1) * pageSize + 1}</strong> to{' '}
                        <strong className="text-text-base font-bold">{Math.min(safePage * pageSize, totalItems)}</strong> of{' '}
                        <strong className="text-text-base font-bold">{totalItems}</strong> entries
                      </span>
                      <div className="flex items-center gap-2">
                        <span>Rows per page:</span>
                        <select
                          value={pageSize}
                          onChange={(e) => setPageSize(Number(e.target.value))}
                          className="bg-card border border-subtle hover:border-slate-600 text-text-base rounded-lg px-2.5 py-1 text-xs font-semibold focus:outline-none focus:border-sky-500 cursor-pointer"
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
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-card hover:bg-inner disabled:opacity-40 text-text-base font-medium transition-colors cursor-pointer border border-subtle text-xs"
                      >
                        <ChevronLeft size={14} />
                        Previous
                      </button>

                      <span className="px-3.5 py-1.5 bg-card rounded-lg text-text-base font-semibold border border-subtle text-xs">
                        Page {safePage} of {totalPages}
                      </span>

                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={safePage === totalPages}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-card hover:bg-inner disabled:opacity-40 text-text-base font-medium transition-colors cursor-pointer border border-subtle text-xs"
                      >
                        Next
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
            </div>
          </div>

          {/* Dual-View Add/Edit Record Modal (Left: Form Data, Right: Interactive Map Preview) */}
          {isFormOpen && (() => {
            const editSubgrid = editingItem ? (extractSubgridName((editingItem as any).subgrid || (editingItem as any).imageFilename) || (editingItem as any).subgrid || '') : '';
            const editGrid = editingItem ? ((editingItem as any).grid || '1') : '1';
            const isPub = editingItem ? ((editingItem as any).publishToWebGIS === 'yes' || (editingItem as any).publishToUSVPRO === 'yes') : false;
            const statusVal = isPub ? 'yes' : ((editingItem as any)?.publishToWebGIS || (editingItem as any)?.status || 'in process');
            const op = isPub ? 1.0 : 0.5;
            const colorHex = isPub ? '#10b981' : (statusVal === 'need to recheck' || statusVal === 'no' ? '#ef4444' : '#f59e0b');

            const rawPans = editingItem ? ((editingItem as any).panoramas || (editingItem as any).points || []) : [];
            const pans = rawPans.map((p: any, idx: number) => ({
              ...p,
              filename: p.filename || p.image_url || `${editSubgrid}-${String(idx + 1).padStart(4, '0')}.jpg`,
              subgrid: editSubgrid,
              grid: editGrid,
              latitude: p.latitude ?? p.lat,
              longitude: p.longitude ?? p.lon,
              lat: p.lat ?? p.latitude,
              lon: p.lon ?? p.longitude,
              status: statusVal,
              publishToWebGIS: statusVal,
              isPublished: isPub,
              opacity: op,
              color: colorHex
            }));

            const editStagedItems = [{
              subgrid: editSubgrid,
              grid: editGrid,
              status: statusVal,
              publishToWebGIS: statusVal,
              isSyncedWithSupabase: isPub,
              isStagingPreview: true,
              isPublished: isPub,
              opacity: op,
              color: colorHex,
              statusColor: colorHex,
              panoramas: pans,
              points: pans
            }];

            return (
              <div role="dialog" aria-modal="true" className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 sm:p-6 backdrop-blur-sm overflow-y-auto">
                <div className="bg-card border border-subtle rounded-2xl w-[96vw] max-w-[1750px] h-[94vh] max-h-[94vh] flex flex-col shadow-2xl overflow-hidden my-auto border-t border-t-slate-700/50 animate-fadeIn">

                  {/* Modal Header */}
                  <div className="bg-card px-6 py-4 border-b border-subtle flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                        <Edit2 size={18} />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-text-base tracking-wide flex items-center gap-2">
                          <span>{editingItem ? 'Edit Record & Spatial Map Inspector' : 'Add New Record'}</span>
                          <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-inner text-text-base font-sans font-normal border border-subtle">
                            {dataTab === 'batches' ? 'Masterlist Data' : 'Daily Data'}
                          </span>
                        </h2>
                        <p className="text-xs text-text-muted font-medium">
                          {editingItem ? `Inspecting subgrid properties & spatial map preview for ${editSubgrid}` : 'Configure record details and preview spatial map coverage'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setIsFormOpen(false);
                        setEditingItem(null);
                      }}
                      className="text-text-muted hover:text-text-base text-xl p-1.5 cursor-pointer transition-colors rounded-lg hover:bg-inner"
                      aria-label="Close edit popup dialog"
                    >
                      &times;
                    </button>
                  </div>

                  {/* Dual Column Layout */}
                  <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">

                    {/* Left Column: Data Form Inputs (5 cols) */}
                    <div className="lg:col-span-5 bg-card border border-subtle rounded-2xl p-6 shadow-sm space-y-5 flex flex-col justify-between overflow-y-auto">
                      <div>
                        <h3 className="text-xs font-bold text-text-base uppercase tracking-wider mb-4 pb-2.5 border-b border-subtle flex items-center justify-between">
                          <span>Record Configuration</span>
                          <span className="text-[11px] text-text-muted font-normal font-sans">ID: {(editingItem as any)?.id || 'NEW'}</span>
                        </h3>
                        <DataForm
                          initialData={editingItem as BatchLog | DailyTimeSeries | null}
                          dataType={dataTab as 'batches' | 'daily'}
                          activeAuthUserName={activeAuthUserName}
                          onSave={handleSave}
                          onCancel={() => {
                            setIsFormOpen(false);
                            setEditingItem(null);
                          }}
                        />
                      </div>
                    </div>

                    {/* Right Column: Spatial Map Preview (7 cols) */}
                    <div className="lg:col-span-7 flex flex-col space-y-3">
                      <div className="bg-card border border-subtle rounded-2xl overflow-hidden shadow-md flex-1 flex flex-col min-h-[580px]">
                        <div className="bg-card px-5 py-3 border-b border-subtle flex items-center justify-between">
                          <div className="flex items-center gap-2 text-xs font-bold text-text-base">
                            <Globe size={15} className="text-sky-400" />
                            <span>Record Trajectory & Spatial Map View</span>
                          </div>
                          <span className="px-2.5 py-1 rounded-md bg-sky-500/10 text-sky-300 border border-sky-500/20 text-[11px] font-semibold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" /> Live Spatial Preview
                          </span>
                        </div>
                        <div className="flex-1 relative min-h-[550px]">
                          <MapComponent dataManagement refreshKey={0} stagedItems={editStagedItems} />
                        </div>
                      </div>
                      <div className="p-3.5 bg-card border border-subtle rounded-xl flex items-center justify-between text-xs text-text-muted">
                        <span>💡 Click survey points on map preview to open 360° street view imagery.</span>
                        <span className="font-sans text-text-base font-semibold text-xs">Subgrid: {editSubgrid}</span>
                      </div>
                    </div>

                  </div>

                </div>
              </div>
            );
          })()}

          {/* Subgrid Image Filenames List View Modal */}
          {imagesListModal && imagesListModal.isOpen && (() => {
            const filenames = (imagesListModal.customFilenames && imagesListModal.customFilenames.length > 0)
              ? imagesListModal.customFilenames
              : generateImageFilenamesList(imagesListModal.subgrid, imagesListModal.count > 0 ? imagesListModal.count : (imagesListModal.poiCount || 1), imagesListModal.baseFilename);
            return (
              <div role="dialog" aria-modal="true" className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 backdrop-blur-sm">
                <div className="bg-card border border-subtle rounded-xl p-5 max-w-md w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex justify-between items-center pb-3 mb-3 border-b border-subtle shrink-0">
                    <div>
                      <h2 className="text-sm font-bold text-text-base tracking-wide flex items-center gap-2">
                        <Camera size={16} className="text-sky-400" />
                        Subgrid {imagesListModal.subgrid} Filenames
                      </h2>
                      <span className="text-[11px] text-text-muted font-sans">
                        {imagesListModal.poiCount !== undefined ? `POI: ${imagesListModal.poiCount.toLocaleString()}  •  ` : ''}
                        Available Frames: <strong className="text-sky-400 font-bold">{filenames.length.toLocaleString()}</strong>
                      </span>
                    </div>
                    <button
                      onClick={() => setImagesListModal(null)}
                      className="text-text-muted hover:text-text-base text-lg p-1 cursor-pointer transition-colors"
                      aria-label="Close image filenames popup dialog"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto font-sans text-xs text-text-base space-y-1 p-2 bg-card rounded-lg border border-subtle max-h-96">
                    {filenames.map((name, idx) => (
                      <div key={idx} className="flex items-center justify-between px-2.5 py-1 hover:bg-inner rounded transition-colors">
                        <span className="text-text-muted text-[10px] w-10 shrink-0">{idx + 1}.</span>
                        <span className="text-text-base font-semibold flex-1 truncate">{name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pt-3 border-t border-subtle flex items-center justify-between shrink-0">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(filenames.join('\n'));
                        toast.success(`Copied ${filenames.length} image filenames to clipboard!`);
                      }}
                      className="px-3 py-1.5 bg-inner hover:bg-inner text-text-base border border-subtle rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5"
                    >
                      <Copy size={13} /> Copy List ({filenames.length})
                    </button>
                    <button
                      onClick={() => setImagesListModal(null)}
                      className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-text-base rounded-lg text-xs font-medium cursor-pointer transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* QC Audit Modal */}
          {qcModal && qcModal.isOpen && (
            <QCAuditModal
              subgrid={qcModal.subgrid}
              poiCount={qcModal.poiCount}
              availableCount={qcModal.availableCount}
              baseFilename={qcModal.baseFilename}
              availableFilenames={qcModal.availableFilenames}
              expectedFilenames={qcModal.expectedFilenames}
              onClose={() => setQcModal(null)}
            />
          )}

          {/* Layer Edit Modal */}
          {isLayerEditModalOpen && editingItem && 'id' in editingItem && (() => {
            const layer = editingItem as Layer;
            return (
              <div role="dialog" aria-modal="true" className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000]">
                <div className="bg-app border border-subtle rounded-xl p-8 max-w-md w-full mx-4">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-text-base">Edit Layer</h2>
                    <button
                      onClick={() => {
                        setIsLayerEditModalOpen(false);
                        setEditingItem(null);
                      }}
                      className="text-text-muted hover:text-text-base"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-text-base mb-2">Layer Name</label>
                      <input
                        type="text"
                        value={layer.name}
                        onChange={(e) => setEditingItem({ ...layer, name: e.target.value })}
                        className="w-full bg-inner border border-subtle rounded-lg px-4 py-3 text-text-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-text-base mb-2">Color</label>
                      <div className="flex items-center gap-4">
                        <input
                          type="color"
                          value={layer.color}
                          onChange={(e) => setEditingItem({ ...layer, color: e.target.value })}
                          className="w-12 h-12 cursor-pointer rounded-lg border border-subtle"
                        />
                        <span className="text-text-muted text-sm font-sans">{layer.color}</span>
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
                        className="flex-1 bg-inner hover:bg-inner px-4 py-3 rounded-lg transition-all"
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
            <div role="dialog" aria-modal="true" className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000]">
              <div className="bg-app border border-subtle rounded-xl p-8 max-w-md w-full mx-4">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-text-base">Create Folder</h2>
                  <button
                    onClick={() => {
                      setIsFolderCreateModalOpen(false);
                      setNewFolderName('');
                    }}
                    className="text-text-muted hover:text-text-base"
                  >
                    &times;
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-text-base mb-2">Folder Name</label>
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="Enter folder name"
                      className="w-full bg-inner border border-subtle rounded-lg px-4 py-3 text-text-base"
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
                      className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-inner px-4 py-3 rounded-lg transition-all"
                    >
                      Create Folder
                    </button>
                    <button
                      onClick={() => {
                        setIsFolderCreateModalOpen(false);
                        setNewFolderName('');
                      }}
                      className="flex-1 bg-inner hover:bg-inner px-4 py-3 rounded-lg transition-all"
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
            <div role="dialog" aria-modal="true" className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000]">
              <div className="bg-app border border-subtle rounded-xl p-8 max-w-md w-full mx-4">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-text-base">Edit Folder</h2>
                  <button
                    onClick={() => {
                      setIsFolderEditModalOpen(false);
                      setEditingItem(null);
                      setNewFolderName('');
                    }}
                    className="text-text-muted hover:text-text-base"
                  >
                    &times;
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-text-base mb-2">Folder Name</label>
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      className="w-full bg-inner border border-subtle rounded-lg px-4 py-3 text-text-base"
                    />
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => saveFolderEdit(newFolderName)}
                      disabled={!newFolderName.trim()}
                      className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-inner px-4 py-3 rounded-lg transition-all"
                    >
                      Save Changes
                    </button>
                    <button
                      onClick={() => {
                        setIsFolderEditModalOpen(false);
                        setEditingItem(null);
                        setNewFolderName('');
                      }}
                      className="flex-1 bg-inner hover:bg-inner px-4 py-3 rounded-lg transition-all"
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
              <div role="dialog" aria-modal="true" className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000]">
                <div className="bg-app border border-subtle rounded-xl p-8 max-w-md w-full mx-4">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-text-base">
                      Move {movingItem.item.type === 'folder' ? 'Folder' : 'Layer'}
                    </h2>
                    <button
                      onClick={() => {
                        setIsMoveModalOpen(false);
                        setMovingItem(null);
                        setTargetFolderId(null);
                      }}
                      className="text-text-muted hover:text-text-base"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-text-base mb-2">Move to</label>
                      <select
                        value={targetFolderId || ''}
                        onChange={(e) => setTargetFolderId(e.target.value || null)}
                        className="w-full bg-inner border border-subtle rounded-lg px-4 py-3 text-text-base"
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
                        className="flex-1 bg-inner hover:bg-inner px-4 py-3 rounded-lg transition-all"
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

      {/* Import CSV Modal */}
      {isCsvImportOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1100] p-4 sm:p-6 backdrop-blur-sm overflow-y-auto">
          <div className="bg-card border border-subtle rounded-2xl w-[96vw] max-w-[1750px] h-[94vh] max-h-[94vh] flex flex-col shadow-2xl overflow-hidden my-auto border-t border-t-slate-700/50">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-subtle shrink-0 bg-card">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-inner border border-subtle flex items-center justify-center">
                  <FileText size={18} className="text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-text-base tracking-wide">Import CSV Metadata &amp; Staging Preview</h2>
                  <p className="text-text-muted text-xs">Configure field mapping and preview data &amp; map trajectories side-by-side</p>
                </div>
              </div>

              <button onClick={() => setIsCsvImportOpen(false)} className="text-text-muted hover:text-text-base transition-colors p-1.5 rounded-lg hover:bg-inner">
                <X size={18} />
              </button>
            </div>

            {/* Scrollable Modal Body (Side-by-Side 2 Columns) */}
            <div className="p-6 overflow-y-auto flex-1 text-xs">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">

                {/* LEFT COLUMN: Controls, Defaults & Column Mapping (col-span-5) */}
                <div className="lg:col-span-5 space-y-4">

                  {/* Stats & Subgrid Detection Summary */}
                  {(() => {
                    const subgridCol = Object.keys(csvFieldMap).find(k => csvFieldMap[k] === 'imageFilename' || csvFieldMap[k] === 'subgrid');
                    const subgridIdx = subgridCol !== undefined ? csvHeaders.indexOf(subgridCol) : -1;

                    const detectedList: string[] = [];
                    if (csvFileList.length > 0) {
                      csvFileList.forEach(file => {
                        const sg = extractSubgridName(file.fileName);
                        if (sg) detectedList.push(sg);
                      });
                    }
                    if (csvRows.length > 0) {
                      csvRows.forEach(r => {
                        const val = subgridIdx >= 0 ? r[subgridIdx] : (r[0] || '');
                        const sg = extractSubgridName(val);
                        if (sg) detectedList.push(sg);
                      });
                    }

                    const detectedSubgrids = Array.from(new Set(detectedList.filter(Boolean)));
                    const displaySubgrids = detectedSubgrids;
                    const isMultiFile = csvFileList.length > 1;

                    const existingSubgridSet = new Set(dailyData.map(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim()).filter(Boolean));
                    const duplicateDetectedSubgrids = detectedSubgrids.filter(sg => existingSubgridSet.has(sg.toUpperCase().trim()));
                    const hasDuplicates = duplicateDetectedSubgrids.length > 0;

                    return (
                      <div className="space-y-2">
                        {/* Duplicate Detection Notice Banner */}
                        {hasDuplicates && (
                          <div className="p-3 bg-card border border-amber-500/50 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-200 shadow-md">
                            <div className="flex items-center gap-2.5">
                              <AlertTriangle size={16} className="text-amber-400 shrink-0 animate-pulse" />
                              <div>
                                <span className="font-bold text-amber-300">Multiple data detected</span>
                                <span className="text-amber-200/90 ml-2 font-sans text-[11px]">
                                  Subgrid(s) <strong className="text-amber-100 font-bold font-sans">{duplicateDetectedSubgrids.join(', ')}</strong> already exist in records.
                                </span>
                              </div>
                            </div>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                              {duplicateDetectedSubgrids.length} Duplicate{duplicateDetectedSubgrids.length > 1 ? 's' : ''} Detected
                            </span>
                          </div>
                        )}

                        <div className="p-3 bg-card border border-subtle rounded-xl space-y-2">
                          <div className="flex items-start gap-3">
                            <CheckCircle size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              {isMultiFile ? (
                                <>
                                  <p className="text-text-base text-xs font-semibold">
                                    CSV loaded &bull; <span className="font-bold text-text-base">{csvFileList.length} separate CSV files selected</span> ({csvFileList.map(f => `${f.rows.length} rows`).join(', ')}).
                                  </p>
                                  <p className="text-text-muted text-[11px]">
                                    Will be imported as <strong className="text-text-base">{csvFileList.length} separate daily entries</strong>.
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="text-text-base text-xs font-semibold">
                                    CSV loaded &bull; <span className="font-bold">{csvRows.length} image rows</span> &amp; <span className="font-bold">{csvHeaders.length} columns</span> detected.
                                    <> Will be processed as <span className="font-bold text-text-base">{displaySubgrids.length} unique subgrid{displaySubgrids.length !== 1 ? 's' : ''}</span>.</>
                                  </p>
                                  <p className="text-text-muted text-[11px]">Each imported entry will be added as a separate entity without overwriting existing rows.</p>
                                </>
                              )}

                              {/* Detected Subgrids Badge Display */}
                              <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">Detected Subgrid(s):</span>
                                {displaySubgrids.map(sg => {
                                  const isSubDup = existingSubgridSet.has(sg.toUpperCase().trim());
                                  return (
                                    <span key={sg} className={`px-2 py-0.5 rounded-md text-[11px] font-sans font-bold flex items-center gap-1 ${isSubDup
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                      : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                                      }`}>
                                      {sg}
                                      {isSubDup && <span className="text-[9px] font-sans font-semibold text-amber-400 ml-1">(multiple data detected)</span>}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Multiple Choice Defaults Section */}
                  <div className="grid grid-cols-1 gap-3">
                    {/* 1. Grid selector */}
                    {csvFileList.length > 1 ? (
                      <div className="bg-card border border-subtle p-3 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider">
                            Grid Number Per CSV File ({csvFileList.length} files selected)
                          </label>
                          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                            <span>Set All:</span>
                            <select
                              value=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                const val = e.target.value;
                                setSelectedGrid(val);
                                const updated: Record<string, string> = {};
                                csvFileList.forEach(f => { updated[f.fileName] = val; });
                                setFileGridMap(updated);
                              }}
                              className="bg-app border border-subtle rounded px-2 py-0.5 text-xs text-text-base focus:outline-none focus:border-subtle"
                            >
                              <option value="">Apply to all...</option>
                              {GRIDS.map(g => <option key={g} value={g}>Grid {g}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                          {csvFileList.map((file) => (
                            <div key={file.fileName} className="flex items-center justify-between gap-2 p-2 bg-app border border-subtle rounded-lg">
                              <span className="text-xs text-text-base truncate font-sans flex-1" title={file.fileName}>
                                {file.fileName}
                              </span>
                              <select
                                value={fileGridMap[file.fileName] || selectedGrid || '1'}
                                onChange={(e) => setFileGridMap({ ...fileGridMap, [file.fileName]: e.target.value })}
                                className="bg-app border border-subtle rounded px-2 py-1 text-xs text-text-base focus:outline-none focus:border-subtle shrink-0"
                              >
                                {GRIDS.map(g => <option key={g} value={g}>Grid {g}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-card border border-subtle p-3 rounded-xl">
                        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Grid Number</label>
                        <select
                          value={selectedGrid}
                          onChange={(e) => {
                            setSelectedGrid(e.target.value);
                            if (csvFileList[0]) {
                              setFileGridMap({ [csvFileList[0].fileName]: e.target.value });
                            }
                          }}
                          className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
                        >
                          {GRIDS.map(g => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </div>
                    )}

                    {/* 2. Capture Equipment & PIC */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-card border border-subtle p-3 rounded-xl">
                        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">Capture Equipment</label>
                        <div className="flex items-center gap-1.5">
                          {(['MMS', 'Backpack', 'Drone'] as const).map(eq => (
                            <button
                              key={eq}
                              type="button"
                              onClick={() => setSelectedEquipment(eq)}
                              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium border transition-all ${selectedEquipment === eq
                                ? 'bg-inner border-subtle text-text-base shadow-sm font-semibold'
                                : 'bg-app border-subtle text-text-muted hover:text-text-base'
                                }`}
                            >
                              {eq}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="bg-card border border-subtle p-3 rounded-xl">
                        <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">Person In Charge (PIC)</label>
                        <input
                          type="text"
                          value={selectedPic}
                          onChange={(e) => setSelectedPic(e.target.value)}
                          placeholder="Enter PIC name (or leave empty for Auth User)"
                          className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base placeholder-text-muted focus:outline-none focus:border-sky-500 font-medium"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Field Mapping Section */}
                  <div>
                    <h3 className="text-xs font-bold text-text-base mb-2 uppercase tracking-wider">Column Field Mapping</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                      {csvHeaders.map(header => (
                        <div key={header} className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all ${csvFieldMap[header] ? 'bg-app border-subtle' : 'bg-card border-subtle'
                          }`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-text-muted">CSV column</p>
                            <p className="text-text-base font-sans text-xs truncate font-medium">{header}</p>
                          </div>
                          <RefreshCw size={12} className="text-text-muted shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-text-muted">Map to field</p>
                            <select
                              value={csvFieldMap[header] || ''}
                              onChange={e => setCsvFieldMap(prev => ({ ...prev, [header]: e.target.value }))}
                              className={`w-full text-xs bg-app border rounded-lg px-2 py-1 transition-colors ${csvFieldMap[header] ? 'border-subtle text-text-base font-medium' : 'border-subtle text-text-muted'
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

                </div>

                {/* RIGHT COLUMN: Map Preview & Data Table Preview (col-span-7) */}
                <div className="lg:col-span-7 space-y-4">

                  {/* Interactive Trajectory Map Preview Box (Expanded Height) */}
                  <div className="bg-card border border-subtle rounded-xl overflow-hidden shadow-md">
                    <div className="bg-card px-4 py-2 border-b border-subtle flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold text-text-base">
                        <Globe size={14} className="text-sky-400" />
                        <span>Interactive Trajectory Map Preview</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Preview
                      </span>
                    </div>
                    {(() => {
                      const getMappedOrAliasVal = (row: string[], fieldKey: string, aliases: string[]) => {
                        const mappedHeader = Object.keys(csvFieldMap).find(k => csvFieldMap[k] === fieldKey);
                        if (mappedHeader !== undefined) {
                          const idx = csvHeaders.indexOf(mappedHeader);
                          if (idx >= 0 && row[idx] !== undefined && row[idx].trim() !== '') {
                            return row[idx].trim();
                          }
                        }
                        for (const alias of aliases) {
                          const idx = csvHeaders.findIndex(h => h.trim().toLowerCase() === alias.toLowerCase());
                          if (idx >= 0 && row[idx] !== undefined && row[idx].trim() !== '') {
                            return row[idx].trim();
                          }
                        }
                        return '';
                      };

                      const subgridCol = Object.keys(csvFieldMap).find(k => csvFieldMap[k] === 'imageFilename' || csvFieldMap[k] === 'subgrid');
                      const subgridIdx = subgridCol !== undefined ? csvHeaders.indexOf(subgridCol) : -1;
                      const rawSubgridVal = (csvRows.length > 0 && subgridIdx >= 0) ? csvRows[0][subgridIdx] : '';
                      const parsedSubgrid = extractSubgridName(rawSubgridVal) || rawSubgridVal || '';

                      const modalStagedItems = [{
                        subgrid: parsedSubgrid,
                        grid: selectedGrid || '1',
                        status: 'in process',
                        publishToUSVPRO: 'in process',
                        isSyncedWithSupabase: false,
                        isStagingPreview: true,
                        isPublished: false,
                        published: false,
                        opacity: 0.5,
                        fillOpacity: 0.5,
                        strokeOpacity: 0.5,
                        color: '#f59e0b',
                        statusColor: '#f59e0b',
                        strokeColor: '#f59e0b',
                        fillColor: '#f59e0b',
                        panoramas: csvRows.map((r, rIdx) => {
                          const fn = subgridIdx >= 0 ? r[subgridIdx] : `${parsedSubgrid}-${String(rIdx + 1).padStart(4, '0')}.jpg`;
                          const latStr = getMappedOrAliasVal(r, 'latitude', ['latitude', 'lat', 'y']);
                          const lonStr = getMappedOrAliasVal(r, 'longitude', ['longitude', 'lon', 'lng', 'x']);
                          const dateVal = getMappedOrAliasVal(r, 'date', ['date', 'time', 'captured_at']);

                          const lat = parseFloat(latStr);
                          const lon = parseFloat(lonStr);

                          return {
                            filename: fn,
                            image_url: fn,
                            subgrid: parsedSubgrid,
                            grid: selectedGrid || '1',
                            latitude: !isNaN(lat) ? lat : undefined,
                            longitude: !isNaN(lon) ? lon : undefined,
                            lat: !isNaN(lat) ? lat : undefined,
                            lon: !isNaN(lon) ? lon : undefined,
                            lng: !isNaN(lon) ? lon : undefined,
                            y: !isNaN(lat) ? lat : undefined,
                            x: !isNaN(lon) ? lon : undefined,
                            date: dateVal || undefined,
                            captured_at: dateVal || undefined,
                            status: 'in process',
                            qa_status: 'in process',
                            publishToUSVPRO: 'in process',
                            isPublished: false,
                            published: false,
                            opacity: 0.5,
                            fillOpacity: 0.5,
                            strokeOpacity: 0.5,
                            color: '#f59e0b',
                            statusColor: '#f59e0b',
                            strokeColor: '#f59e0b',
                            fillColor: '#f59e0b'
                          };
                        })
                      }];

                      return (
                        <div className="h-[480px] relative">
                          <MapComponent dataManagement refreshKey={0} stagedItems={modalStagedItems} />
                        </div>
                      );
                    })()}
                  </div>

                  {/* Sample Data Rows Preview Table */}
                  {csvPreview.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-bold text-text-base uppercase tracking-wider">Sample Data Preview (First 5 Rows)</h3>
                        <span className="text-[11px] text-text-muted font-sans">{csvRows.length} total records</span>
                      </div>
                      <div className="overflow-x-auto rounded-xl border border-subtle max-h-40">
                        <table className="w-full text-[11px] text-left">
                          <thead className="bg-card text-text-muted sticky top-0">
                            <tr>
                              {csvHeaders.map(h => (
                                <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                                  <span className="block">{h}</span>
                                  {csvFieldMap[h] && (
                                    <span className="text-emerald-400 font-sans text-[9px]">→ {csvFieldMap[h]}</span>
                                  )}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-subtle/60 font-sans">
                            {csvPreview.map((row, i) => (
                              <tr key={i} className="hover:bg-inner transition-colors">
                                {csvHeaders.map(h => (
                                  <td key={h} className="px-3 py-1.5 text-text-base whitespace-nowrap">{row[h] || '—'}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Parsed Subgrids Summary Table */}
                  <div>
                    <h3 className="text-xs font-bold text-text-base mb-2 uppercase tracking-wider">
                      Staging Subgrids Summary ({csvFileList.length > 0 ? csvFileList.length : 1} file(s))
                    </h3>
                    <div className="overflow-x-auto rounded-xl border border-subtle max-h-32">
                      <table className="w-full text-[11px] text-left">
                        <thead className="bg-card text-text-muted sticky top-0">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Subgrid</th>
                            <th className="px-3 py-2 font-semibold">Grid</th>
                            <th className="px-3 py-2 font-semibold">Frames</th>
                            <th className="px-3 py-2 font-semibold">Equipment</th>
                            <th className="px-3 py-2 font-semibold">PIC</th>
                            <th className="px-3 py-2 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-subtle/60 font-sans">
                          {csvFileList.map((file, idx) => (
                            <tr key={file.fileName || idx} className="hover:bg-inner">
                              <td className="px-3 py-2 font-bold text-text-base">{extractSubgridName(file.fileName) || `Subgrid ${idx + 1}`}</td>
                              <td className="px-3 py-2 text-text-base">Grid {fileGridMap[file.fileName] || selectedGrid || '1'}</td>
                              <td className="px-3 py-2 text-text-base">{file.rows.length}</td>
                              <td className="px-3 py-2 text-text-base">{selectedEquipment}</td>
                              <td className="px-3 py-2 text-text-base">{selectedPic}</td>
                              <td className="px-3 py-2">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950/40 text-amber-300 border border-amber-500/30 opacity-80 inline-flex items-center gap-1">
                                  <Clock size={10} className="text-amber-400" /> Staged (50%)
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>

              </div>
            </div>

            {/* Actions Footer */}
            <div className="p-4 border-t border-subtle flex items-center justify-between shrink-0 bg-card gap-3">
              <button
                onClick={() => setIsCsvImportOpen(false)}
                className="px-4 py-2 rounded-xl bg-inner hover:bg-inner text-text-base text-xs font-medium transition-all cursor-pointer border border-subtle"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isImportingCsv}
                onClick={() => handleCsvImport(false)}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800/60 disabled:opacity-60 disabled:cursor-not-allowed border border-emerald-500/60 px-5 py-2 rounded-xl font-semibold transition-all text-text-base text-xs shadow-md cursor-pointer active:scale-95"
              >
                {isImportingCsv ? (
                  <>
                    <RefreshCw size={14} className="animate-spin text-text-base" />
                    <span>Importing & Verifying...</span>
                  </>
                ) : (
                  <>
                    <Upload size={14} className="text-text-base" />
                    <span>Import Data</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ===== Admin Security Delete Confirmation Modal ===== */}
      {isDeleteModalOpen && deleteTarget && (
        <div className="fixed inset-0 bg-app backdrop-blur-md flex items-center justify-center p-4 z-[1200] animate-fadeIn">
          <div className="bg-app border border-subtle rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden transform transition-all max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="bg-app border-b border-subtle p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-inner border border-subtle flex items-center justify-center text-text-base">
                  <ShieldAlert size={20} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-text-base flex items-center gap-2">
                    Admin Security Verification
                  </h3>
                  <p className="text-xs text-text-muted font-medium">Permanent Database Deletion Authorization</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeleteTarget(null);
                  setDeleteError(null);
                  setDeleteConfirmText('');
                }}
                className="text-text-muted hover:text-text-base p-1 rounded-lg hover:bg-inner transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-5 overflow-y-auto min-h-0">
              {/* Impact Preview */}
              <div>
                <div className="font-semibold text-text-base mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide">
                  <Database size={14} className="text-sky-400" />
                  {tf('dataImpactPreview')}
                </div>

                {isComputingImpact ? (
                  <div className="flex items-center gap-2 text-[11px] text-text-muted py-6 justify-center">
                    <Loader2 size={14} className="animate-spin text-sky-400" /> {tf('dataImpactComputing')}
                  </div>
                ) : impactData && impactTotals ? (
                  <div className="space-y-3">
                    {/* KPI grid */}
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {[
                        { label: tf('dataImpactSubgrids'), value: String(impactTotals.subgrids), tone: 'text-sky-300' },
                        { label: tf('dataImpactRuns'), value: String(impactTotals.runs), tone: 'text-text-base' },
                        { label: tf('dataImpactBatch'), value: String(impactTotals.batch), tone: 'text-text-base' },
                        { label: tf('dataImpactPoi'), value: String(impactTotals.poi), tone: 'text-text-base' },
                        { label: tf('dataImpactFrames'), value: String(impactTotals.frames), tone: 'text-text-base' },
                        { label: tf('dataImpactKm'), value: `${impactTotals.km.toLocaleString()} km`, tone: 'text-text-base' },
                        { label: tf('dataImpactDefects'), value: String(impactTotals.defects), tone: impactTotals.defects > 0 ? 'text-amber-300' : 'text-text-base' },
                        { label: tf('dataImpactQa'), value: String(impactTotals.qa), tone: 'text-text-base' },
                        { label: tf('dataImpactStaging'), value: String(impactTotals.staging), tone: impactTotals.staging > 0 ? 'text-amber-300' : 'text-text-base' },
                        { label: tf('dataImpactPublished'), value: String(impactTotals.published), tone: impactTotals.published > 0 ? 'text-rose-300' : 'text-text-base' },
                        { label: tf('dataImpactDatasets'), value: String(impactTotals.datasets), tone: impactTotals.datasets > 0 ? 'text-amber-300' : 'text-text-base' },
                        { label: tf('dataImpactDeliverables'), value: String(impactTotals.deliverables), tone: impactTotals.deliverables > 0 ? 'text-rose-300' : 'text-text-base' },
                        { label: tf('dataImpactJobs'), value: String(impactTotals.jobs), tone: impactTotals.jobs > 0 ? 'text-amber-300' : 'text-text-base' }
                      ].map((c) => (
                        <div key={c.label} className="bg-inner border border-subtle rounded-lg px-2.5 py-2">
                          <div className={`text-sm font-bold leading-none ${c.tone}`}>{c.value}</div>
                          <div className="text-[9px] uppercase tracking-wider text-text-muted mt-1 truncate" title={c.label}>{c.label}</div>
                        </div>
                      ))}
                    </div>

                    {/* Per-subgrid breakdown */}
                    {impactData.rows.length > 0 && (
                      <div className="overflow-x-auto rounded-lg border border-subtle max-h-[220px] overflow-y-auto">
                        <table className="w-full text-left text-[10px]">
                          <thead className="bg-inner text-text-muted border-b border-subtle sticky top-0">
                            <tr>
                              <th className="px-2.5 py-2">{tf('dataRegistryColSubgrid')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactRuns')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactPoi')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactFrames')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactKm')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactDefects')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactQa')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactStaging')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactPublished')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactDatasets')}</th>
                              <th className="px-2.5 py-2 text-right">{tf('dataImpactDeliverables')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {impactData.rows.map((r) => (
                              <tr key={r.subgrid} className="border-t border-subtle">
                                <td className="px-2.5 py-1.5 font-sans text-sky-300 font-semibold">{r.subgrid}</td>
                                <td className="px-2.5 py-1.5 text-right text-text-muted">{r.runs}</td>
                                <td className="px-2.5 py-1.5 text-right text-text-muted">{r.poi}</td>
                                <td className="px-2.5 py-1.5 text-right text-text-muted">{r.frames}</td>
                                <td className="px-2.5 py-1.5 text-right text-text-muted">{r.km}</td>
                                <td className="px-2.5 py-1.5 text-right text-text-muted">{r.defects}</td>
                                <td className="px-2.5 py-1.5 text-right text-text-muted">{r.qa}</td>
                                <td className="px-2.5 py-1.5 text-right text-text-muted">{r.staging}</td>
                                <td className="px-2.5 py-1.5 text-right text-rose-300 font-semibold">{r.published}</td>
                                <td className="px-2.5 py-1.5 text-right text-amber-300 font-semibold">{r.datasets}</td>
                                <td className="px-2.5 py-1.5 text-right text-rose-300 font-semibold">{r.deliverables}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Dependent-data warnings */}
                    {hasSevereImpact ? (
                      <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-red-300 uppercase tracking-wide mb-1.5">
                          <AlertTriangle size={13} className="text-red-400" />
                          {tf('dataImpactDependents')}
                        </div>
                        <ul className="text-[11px] text-red-200 space-y-1 list-disc list-inside">
                          {impactData.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    ) : impactData.warnings.length > 0 ? (
                      <div className="p-3 bg-amber-950/30 border border-amber-700/40 rounded-xl">
                        <ul className="text-[11px] text-amber-200 space-y-1 list-disc list-inside">
                          {impactData.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Security Warning (unchanged semantics) */}
              <div className="bg-app border border-subtle rounded-xl p-4 text-xs text-text-base leading-relaxed">
                <div className="font-semibold text-text-base mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wide">
                  <AlertTriangle size={14} className="text-red-400" />
                  Security Warning: Permanent Deletion
                </div>
                This data will be <strong className="text-red-400 font-medium">permanently removed</strong> from the database. This action cannot be reversed.
                {deleteMode === 'bulk' && (
                  <div className="mt-3 p-3 bg-app rounded-lg border border-subtle font-sans text-text-base text-xs space-y-1.5">
                    <div className="flex justify-between items-center"><span className="text-text-muted">Target Selection:</span> <strong className="text-text-base font-sans font-semibold">Bulk Delete</strong></div>
                    <div className="flex justify-between items-center"><span className="text-text-muted">Records Selected:</span> <span className="text-red-400 font-bold">{selectedRowIds.size} records</span></div>
                  </div>
                )}
                {deleteMode === 'spatial' && (
                  <div className="mt-3 p-3 bg-app rounded-lg border border-subtle font-sans text-text-base text-xs space-y-1.5">
                    <div className="flex justify-between items-center"><span className="text-text-muted">Target Selection:</span> <strong className="text-text-base font-sans font-semibold">Map Spatial Selection</strong></div>
                    <div className="flex justify-between items-center"><span className="text-text-muted">Subgrids Selected:</span> <span className="text-red-400 font-bold">{spatialSubgrids.length} subgrids</span></div>
                  </div>
                )}
              </div>

              {/* Explicit Confirmation Input */}
              <div>
                <label className="block text-xs font-medium text-text-base mb-2 flex items-center gap-1.5">
                  <Info size={14} className="text-text-muted" />
                  {tf('dataConfirmPhrase')}
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => {
                    setDeleteConfirmText(e.target.value);
                    if (deleteError) setDeleteError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmDelete();
                  }}
                  placeholder={expectedDeletePhrase}
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="w-full bg-app border border-subtle focus:border-rose-500/70 rounded-xl px-4 py-2.5 text-sm font-sans text-text-base placeholder-text-muted focus:outline-none transition-all shadow-inner uppercase"
                />
                <p className="text-[10px] text-text-muted mt-1.5">
                  {tf('dataConfirmInstruction')} <strong className="text-text-base font-sans">{expectedDeletePhrase}</strong>
                </p>
              </div>

              {/* Admin Authorization Input */}
              <div>
                <label className="block text-xs font-medium text-text-base mb-2 flex items-center gap-1.5">
                  <Lock size={14} className="text-text-muted" />
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
                    className="w-full bg-app border border-subtle focus:border-subtle rounded-xl px-4 py-2.5 text-sm text-text-base placeholder-text-muted focus:outline-none transition-all shadow-inner"
                  />
                </div>
              </div>

              {/* Error Box */}
              {deleteError && (
                <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl flex items-start gap-2.5 text-xs text-red-300 font-medium">
                  <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                  <span>{deleteError}</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-app border-t border-subtle flex items-center justify-end gap-3 shrink-0">
              <button
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setDeleteTarget(null);
                  setDeleteError(null);
                  setDeleteConfirmText('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium text-text-base hover:text-text-base bg-inner hover:bg-inner border border-subtle transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isComputingImpact || !impactData || deleteConfirmText.trim().toUpperCase() !== expectedDeletePhrase.toUpperCase() || !adminPasscode.trim()}
                className="px-5 py-2.5 rounded-xl text-xs font-semibold text-text-base bg-red-600/90 hover:bg-red-600 border border-red-500/30 transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={14} />
                Authorize & Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Data Selection & Point Inspector Modal */}
      <DataSelectionListModal
        isOpen={isSelectionListModalOpen}
        onClose={() => setIsSelectionListModalOpen(false)}
        selectedSubgrids={spatialSubgrids}
        selectedPoints={spatialSelectedPoints}
        subgridPoints={subgridPoints}
        dailyData={dailyData}
        batchLogs={batchLogs}
        onTogglePoint={(point) => {
          setSpatialSelectedPoints((prev) => {
            const norm = point.subgrid.toUpperCase().trim();
            const pKey = point.filename || point.pointId || `${point.lat},${point.lng}`;
            const key = norm + '_' + pKey;

            const exists = prev.some(
              (p) => (p.subgrid.toUpperCase().trim() + '_' + (p.filename || p.pointId || `${p.lat},${p.lng}`)) === key
            );
            if (exists) {
              return prev.filter(
                (p) => (p.subgrid.toUpperCase().trim() + '_' + (p.filename || p.pointId || `${p.lat},${p.lng}`)) !== key
              );
            }
            return [...prev, point];
          });
        }}
        onSelectAllPointsForSubgrid={(subgrid) => {
          const norm = subgrid.toUpperCase().trim();
          const sgRow = subgridPoints.find((r) => r.subgrid.toUpperCase().trim() === norm);
          if (!sgRow) return;
          const allPts: SelectedPointInfo[] = sgRow.points.map((p) => ({
            subgrid: norm,
            filename: p.filename,
            pointId: p.pointId,
            lat: p.lat,
            lng: p.lng
          }));
          setSpatialSelectedPoints((prev) => {
            const other = prev.filter((p) => p.subgrid.toUpperCase().trim() !== norm);
            return [...other, ...allPts];
          });
        }}
        onClearSubgridPoints={(subgrid) => {
          const norm = subgrid.toUpperCase().trim();
          setSpatialSelectedPoints((prev) => prev.filter((p) => p.subgrid.toUpperCase().trim() !== norm));
        }}
        onRemoveSubgrid={(sg) => {
          setSpatialSubgrids((prev) => prev.filter((x) => x !== sg));
          setSpatialSelectedPoints((prev) => prev.filter((p) => p.subgrid !== sg));
        }}
        onClearAll={() => {
          setSpatialSubgrids([]);
          setSpatialSelectedPoints([]);
        }}
        onConfirmDelete={handleConfirmSpatialDelete}
        onOpenRecycleBin={() => {
          setDataTab('recovery');
          setIsSelectionListModalOpen(false);
          setIsSelectionMapOpen(false);
        }}
      />

      {/* Recycle Bin & Restore Modal */}
      <RecycleBinModal
        isOpen={isRecycleBinOpen}
        onClose={() => setIsRecycleBinOpen(false)}
        onRestoreItem={handleRestoreRecycleBinItem}
      />
    </>
  );
};

// ==============================================
// Data Form Component
// ==============================================


const GRIDS = Array.from({ length: 12 }, (_, i) => (i + 1).toString());

const DataForm = ({
  initialData,
  dataType,
  activeAuthUserName,
  onSave,
  onCancel
}: {
  initialData: BatchLog | DailyTimeSeries | null,
  dataType: 'batches' | 'daily',
  activeAuthUserName?: string,
  onSave: (data: any) => void,
  onCancel: () => void
}) => {
  const [formData, setFormData] = useState<any>(
    initialData ||
    (dataType === 'batches'
      ? { date: new Date().toISOString().slice(0, 10), grid: '1', subgrid: '', imageFilename: '', images: 0, defects: 0, kmProcessed: 0, status: 'Ongoing' as const, captureEquipment: 'MMS', pic: 'Admin' }
      : {
        date: '',
        grid: '1',
        subgrid: '',
        kmProcessed: 0,
        imagesProcessed: 0,
        defectCount: 0,
        imagesDefected: 0,
        captureEquipment: 'MMS',
        pic: activeAuthUserName || 'Operator',
        publishToUSVPRO: 'in process' as const,
        action: ''
      }
    )
  );



  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const count = dataType === 'batches' ? (formData.images || 0) : (formData.imagesProcessed || 0);
        const finalKm = formData.kmProcessed > 0 ? formData.kmProcessed : Math.round((count * 0.005) * 100) / 100;
        onSave({ ...formData, kmProcessed: Math.round(finalKm * 100) / 100 });
      }}
      className="space-y-3 text-xs"
    >
      {dataType === 'batches' ? (
        <>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Date</label>
            <input
              type="date"
              value={toISODateString(formData.date)}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
              required
            />
          </div>

          {/* System Calculated Metrics Panel */}
          <div className="bg-app border border-subtle rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-subtle pb-1.5">
              <span>System Metrics</span>
              <span className="text-[9px] text-text-muted bg-inner border border-subtle px-1.5 py-0.5 rounded font-normal">System Generated</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Grid / Subgrid</span>
                <strong className="text-text-base font-semibold">{formData.grid || '—'} / {formData.subgrid || '—'}</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">POI Count</span>
                <strong className="text-text-base font-semibold">{formData.poiCount ?? 0}</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Images</span>
                <strong className="text-text-base font-semibold">{formData.images ?? 0} frames</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Distance</span>
                <strong className="text-text-base font-semibold">{formData.kmProcessed ?? 0} km</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Defects</span>
                <strong className="text-text-base font-semibold">{formData.defects ?? 0}</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle truncate">
                <span className="text-[10px] text-text-muted block font-medium">First Image</span>
                <strong className="text-text-base font-sans text-[11px] truncate block" title={formData.imageFilename}>{formData.imageFilename || '—'}</strong>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Capture Equipment</label>
            <div className="flex items-center gap-2">
              {(['MMS', 'Backpack', 'Drone'] as const).map(eq => (
                <button
                  key={eq}
                  type="button"
                  onClick={() => setFormData({ ...formData, captureEquipment: eq })}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-medium text-xs border transition-all cursor-pointer ${formData.captureEquipment === eq
                    ? 'bg-inner border-subtle text-text-base shadow-sm font-semibold'
                    : 'bg-app border-subtle text-text-muted hover:text-text-base'
                    }`}
                >
                  {eq}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">PIC (Person In Charge)</label>
            <input
              type="text"
              value={formData.pic || ''}
              onChange={(e) => setFormData({ ...formData, pic: e.target.value })}
              placeholder="Enter PIC Name"
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Status</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Complete' | 'Ongoing' })}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
              required
            >
              <option value="Ongoing">Ongoing</option>
              <option value="Complete">Complete</option>
            </select>
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Date</label>
            <input
              type="date"
              value={toISODateString(formData.date)}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
              required
            />
          </div>

          {/* System Calculated Metrics Panel */}
          <div className="bg-app border border-subtle rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-subtle pb-1.5">
              <span>System Metrics</span>
              <span className="text-[9px] text-text-muted bg-inner border border-subtle px-1.5 py-0.5 rounded font-normal">System Generated</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Grid / Subgrid</span>
                <strong className="text-text-base font-semibold">{formData.grid || '—'} / {formData.subgrid || '—'}</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Images Processed</span>
                <strong className="text-text-base font-semibold">{formData.imagesProcessed ?? 0} frames</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle">
                <span className="text-[10px] text-text-muted block font-medium">Distance</span>
                <strong className="text-text-base font-semibold">{formData.kmProcessed ?? 0} km</strong>
              </div>
              <div className="bg-app p-2 rounded-lg border border-subtle col-span-2 sm:col-span-3">
                <span className="text-[10px] text-text-muted block font-medium">Defects</span>
                <strong className="text-text-base font-semibold">{formData.imagesDefected ?? 0}</strong>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Capture Equipment</label>
            <div className="flex items-center gap-2">
              {(['MMS', 'Backpack', 'Drone'] as const).map(eq => (
                <button
                  key={eq}
                  type="button"
                  onClick={() => setFormData({ ...formData, captureEquipment: eq })}
                  className={`flex-1 py-1.5 px-3 rounded-lg font-medium text-xs border transition-all cursor-pointer ${formData.captureEquipment === eq
                    ? 'bg-inner border-subtle text-text-base shadow-sm font-semibold'
                    : 'bg-app border-subtle text-text-muted hover:text-text-base'
                    }`}
                >
                  {eq}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">PIC (Person In Charge)</label>
            <input
              type="text"
              value={formData.pic || ''}
              onChange={(e) => setFormData({ ...formData, pic: e.target.value })}
              placeholder="Enter PIC Name"
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Publish to WEBGIS</label>
            <select
              value={formData.publishToWebGIS || 'in process'}
              onChange={(e) => {
                const val = e.target.value as 'yes' | 'need to recheck' | 'no' | 'in process';
                setFormData({
                  ...formData,
                  publishToWebGIS: val,
                  publishToUSVPRO: val,
                  isSyncedWithSupabase: val === 'yes'
                });
              }}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base focus:outline-none focus:border-subtle"
              required
            >
              <option value="yes">yes</option>
              <option value="need to recheck">need to recheck</option>
              <option value="no">no</option>
              <option value="in process">in process</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-base mb-1">Status (Database Sync)</label>
            <input
              disabled
              type="text"
              value={formData.publishToWebGIS === 'yes' ? 'published in database' : 'ready to publish'}
              className="w-full bg-app border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-muted cursor-not-allowed"
            />
            <p className="text-[10px] text-text-muted mt-0.5">Status is updated automatically when syncing or publishing to database.</p>
          </div>
        </>
      )}

      <div className="flex justify-end gap-2.5 pt-3 border-t border-subtle">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 bg-inner hover:bg-inner text-text-base rounded-lg font-medium text-xs transition-all cursor-pointer border border-subtle"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex items-center gap-1.5 px-4 py-1.5 bg-inner hover:bg-inner text-text-base rounded-lg font-medium text-xs transition-all cursor-pointer shadow-sm border border-subtle active:scale-95"
        >
          <Save size={14} />
          Save Changes
        </button>
      </div>
    </form>
  );
};
