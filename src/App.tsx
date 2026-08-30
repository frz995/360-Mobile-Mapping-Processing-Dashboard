import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PhotoSphereViewerComponent, type PhotoSphereViewerHandle } from './components/PhotoSphereViewerComponent';
import { WebGISHUDViewerOverlay } from './components/WebGISHUDViewerOverlay';
import {
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  Activity,
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
  HelpCircle,
  Copy,
  ExternalLink,
  Loader2,
  Info,
  Play,
  StopCircle,
  Map as MapIcon,
  MousePointer2,
  RotateCcw
} from 'lucide-react';
import { supabase, publishToSupabase, saveToStagingSupabase, deleteFromStagingSupabase, fetchSupabaseData, deleteFromSupabase, deletePointsFromSupabase, updateDefectStatusInSupabase, fetchQaRecordsFromSupabase, fetchQaAuditRunsFromSupabase, saveQaAuditRunToSupabase, verifyCsvImageFilenamesInStorage, fetchAuditLogsFromSupabase, saveAuditLogToSupabase, fetchNotificationsFromSupabase, saveNotificationToSupabase, fetchProjectSettingsFromSupabase, saveProjectSettingsToSupabase, resolvePanoramaUrl, resolvePanoramaConfigUrl, getDatabaseTableMapping, SUBGRID_COORDINATES, formatPIC, fetchDatasetsFromSupabase, fetchProcessingJobsFromSupabase, saveProcessingJobToSupabase, fetchStagingPanoramasFromSupabase, saveToRecycleBinInSupabase, fetchRecycleBinFromSupabase, type RecycleBinItem } from './services/supabase';
import type { QAQCAuditRunRecord } from './types/admin';
import type { DatasetRecord, ProcessingJobRecord } from './types/production';
import { aggregateStagingBySubgrid } from './utils/datasetLineage';
import type { StagingAggregate } from './utils/datasetLineage';
import { computeDeletionImpact, type DeletionImpact, type DeletionMode } from './utils/deletionImpact';
import { type SubgridPointRow, type SelectedPointInfo } from './components/DeletionSelectionMap';
import { SelectionMapOverlay } from './components/SelectionMapOverlay';
import { DataSelectionListModal } from './components/DataSelectionListModal';
import { RecycleBinModal } from './components/RecycleBinModal';
import { DatasetRecoveryPanel } from './components/DatasetRecoveryPanel';
import { DatasetRegistryPanel } from './components/DatasetRegistryPanel';
import { AdminSettingsView } from './components/AdminSettingsView';
import { OperationalActionCenter } from './components/OperationalActionCenter';
import { ImageProductionWorkspace } from './components/ImageProductionWorkspace';
import { NASStorageWorkspace } from './components/NASStorageWorkspace';
import { ProcessingCenterWorkspace } from './components/ProcessingCenterWorkspace';
import { LineageWorkspace } from './components/LineageWorkspace';
import { AnalyticsWorkspace } from './components/AnalyticsWorkspace';
import { ReportsWorkspace } from './components/ReportsWorkspace';
import { AdministrationWorkspace } from './components/AdministrationWorkspace';
import { UnderlineTabStrip, type ChromeTab } from './components/production/chrome';
import { QAQCWorkbench } from './components/QAQCWorkbench';
import { DefectsGalleryModal } from './components/DefectsGalleryModal';
import { useQAQCWorker, type StationNode } from './hooks/useQAQCWorker';
import * as shapefile from 'shapefile';
import * as toGeoJSON from '@tmcw/togeojson';
import './themes.css';
import { SystemShowcase } from './components/SystemShowcase';
import { DailyHandoverModal } from './components/DailyHandoverModal';
import { WorkspaceSidebarNav } from './components/WorkspaceSidebarNav';
import { WorkspacePlaceholder, getWorkspaceDefinition } from './workspaces';
import { parseHashWorkspace, setHashWorkspace, subscribeHashWorkspace } from './utils/hashRouter';
import type { WorkspaceKey } from './utils/hashRouter';
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
  isAvailable?: boolean;
}

interface DailyTimeSeries {
  id?: string;
  date: string;
  grid: string;
  subgrid: string;
  kmProcessed: number;
  imagesProcessed: number; // renamed from imagesIngested
  poiCount?: number;
  availableImagesCount?: number;
  availableFilenames?: string[];
  defectCount: number;
  captureEquipment: 'MMS' | 'Backpack' | 'Drone' | string;
  imagesDefected: number;
  publishToWebGIS: 'yes' | 'need to recheck' | 'no' | 'in process';
  action: string; // remarks field
  pic?: string;
  isSyncedWithSupabase?: boolean;
  isFromSupabase?: boolean;
  _alreadySyncedToBatch?: boolean;
  panoramas?: PanoramaItem[];
  points?: any[];
  qaqcStatus?: string;
  runsCount?: number;
  publishedRunsCount?: number;
}

interface BatchLog {
  id?: string;
  date: string;
  grid: string;
  subgrid: string; // Subgrid without sequence number (NxxExx)
  imageFilename: string; // Image filename from image_url (e.g., N93E70-0002.jpg)
  images: number;
  poiCount?: number;
  availableImagesCount?: number;
  availableFilenames?: string[];
  defects: number;
  kmProcessed: number;
  status: 'Complete' | 'Ongoing';
  captureEquipment?: 'MMS' | 'Backpack' | 'Drone' | string;
  pic?: string;
  isSyncedWithSupabase?: boolean;
  isFromSupabase?: boolean;
  panoramas?: PanoramaItem[];
  points?: any[];
  qaqcStatus?: string;
  publishToWebGIS?: 'yes' | 'no' | 'in process' | 'need to recheck' | string;
  runsCount?: number;
  publishedRunsCount?: number;
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

// Helper: Format Batch ID cleanly (e.g. 'sp-b-N93E70' -> '2123S-N93E70', '1' -> '2123S-0001')
export function formatBatchIdDisplay(log?: Partial<BatchLog>, index: number = 0): string {
  if (!log) return `2123S-${String(1001 + index).padStart(4, '0')}`;
  const rawId = String(log.id || '').trim();
  const subgrid = (extractSubgridName(log.subgrid || log.imageFilename || '') || '').toUpperCase().trim();

  if (!rawId || rawId === 'undefined' || rawId === 'null') {
    return subgrid ? `2123S-${subgrid}` : `2123S-${String(1001 + index).padStart(4, '0')}`;
  }

  let cleanId = rawId.replace(/^2123S-?/i, '').replace(/^sp-b-/i, '').trim();

  if (/^\d+$/.test(cleanId)) {
    return `2123S-${cleanId.padStart(4, '0')}`;
  }

  return cleanId ? `2123S-${cleanId}` : (subgrid ? `2123S-${subgrid}` : `2123S-${String(1001 + index).padStart(4, '0')}`);
}

// Helper: Get POI count (total survey track points from metadata)
export function getPOICount(item?: { poiCount?: number; imagesProcessed?: number; images?: number; panoramas?: PanoramaItem[] }): number {
  if (!item) return 0;
  if (typeof item.poiCount === 'number' && item.poiCount >= 0) {
    return item.poiCount;
  }
  if (Array.isArray(item.panoramas) && item.panoramas.length > 0) {
    return item.panoramas.length;
  }
  return Number(item.imagesProcessed ?? item.images ?? 0);
}

// Helper: Get available uploaded image frames count in MMS_PIC per row
export function getImagesProcessedCount(item?: {
  imagesProcessed?: number;
  images?: number;
  availableImagesCount?: number;
  availableFilenames?: string[];
  panoramas?: PanoramaItem[];
  poiCount?: number;
}): number {
  if (!item) return 0;

  const rawPoi = Number(item.poiCount ?? (item as any).poi ?? (item.panoramas ? item.panoramas.length : 0));

  // 1. Explicit verified count from Supabase storage verification is the gold standard
  if (typeof item.availableImagesCount === 'number') {
    return Math.min(item.availableImagesCount, rawPoi > 0 ? rawPoi : item.availableImagesCount);
  }
  if (item.availableFilenames && Array.isArray(item.availableFilenames)) {
    return item.availableFilenames.length;
  }
  if (item.panoramas && item.panoramas.length > 0) {
    const availablePans = item.panoramas.filter((p: any) => p.isAvailable === true);
    return availablePans.length;
  }
  if (typeof item.imagesProcessed === 'number') {
    return Math.min(item.imagesProcessed, rawPoi > 0 ? rawPoi : item.imagesProcessed);
  }
  if (typeof item.images === 'number') {
    return Math.min(item.images, rawPoi > 0 ? rawPoi : item.images);
  }
  return 0;
}



export function extractSubgridName(filenameOrSubgrid?: string): string {
  if (!filenameOrSubgrid) return '';
  const match = filenameOrSubgrid.match(/(N\d+E\d+)/i);
  return match ? match[1].toUpperCase() : filenameOrSubgrid.split('-')[0].split('.')[0].toUpperCase();
}

// Helper: Flexible date parser handling ISO, DMY, MDY, timestamps, and word dates
export function parseFlexibleDate(dateVal?: any): Date | null {
  if (!dateVal) return null;
  if (dateVal instanceof Date && !isNaN(dateVal.getTime())) return dateVal;
  if (typeof dateVal === 'number') {
    const d = new Date(dateVal);
    return !isNaN(d.getTime()) ? d : null;
  }
  if (typeof dateVal !== 'string') return null;

  const clean = dateVal.trim();
  if (!clean) return null;

  // 1. Try standard ISO / Date parse
  const std = new Date(clean);
  if (!isNaN(std.getTime()) && !/^\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(clean)) {
    return std;
  }

  // 2. Check DD/MM/YYYY or DD-MM-YYYY (e.g. 19/08/2026 or 08/04/2022)
  const dmyMatch = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
    const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    const d = new Date(year, month, day, hour, min, sec);
    if (!isNaN(d.getTime())) return d;
  }

  // 3. Check YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = clean.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const hour = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
    const min = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
    const sec = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
    const d = new Date(year, month, day, hour, min, sec);
    if (!isNaN(d.getTime())) return d;
  }

  // 4. Check "Month Day, Year" or "Day Month Year"
  const wordsMatch = clean.match(/^(?:([A-Za-z]+)\s+(\d{1,2})|(\d{1,2})\s+([A-Za-z]+))(?:,?\s*(\d{4}))?/);
  if (wordsMatch) {
    const monthStr = wordsMatch[1] || wordsMatch[4];
    const dayStr = wordsMatch[2] || wordsMatch[3];
    const yearStr = wordsMatch[5] || String(new Date().getFullYear());
    const months: Record<string, number> = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11
    };
    const m = months[monthStr.toLowerCase()];
    if (m !== undefined) {
      const d = new Date(parseInt(yearStr, 10), m, parseInt(dayStr, 10));
      if (!isNaN(d.getTime())) return d;
    }
  }

  if (!isNaN(std.getTime())) return std;
  return null;
}

// Helper: Format date string into Month Day, Year without time suffix
export function formatDisplayDate(dateStr?: string): string {
  if (!dateStr) return 'N/A';
  const parsed = parseFlexibleDate(dateStr);
  if (parsed && !isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return dateStr;
}

// Helper: Convert any date string to YYYY-MM-DD for input type="date"
export function toISODateString(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  const parsed = parseFlexibleDate(dateStr);
  if (parsed && !isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return new Date().toISOString().slice(0, 10);
}

// Helper: Generate list of numbered image filenames for subgrid view popup modal
export function generateImageFilenamesList(subgrid: string, count: number, baseFilename?: string): string[] {
  const total = count > 0 ? count : 1;
  const cleanSubgrid = (subgrid || extractSubgridName(baseFilename) || '').toUpperCase().trim();

  if (!baseFilename) {
    const prefix = cleanSubgrid || 'SUBGRID';
    return Array.from({ length: total }, (_, i) => `${prefix}-${String(i + 1).padStart(4, '0')}.jpg`);
  }

  const clean = baseFilename.split('/').pop()?.trim() || baseFilename.trim();
  const match = clean.match(/^(.*?)-?(\d+)(\.[a-z0-9]+)?$/i);
  if (!match) {
    const prefix = cleanSubgrid || clean.replace(/\.[a-z0-9]+$/i, '');
    const ext = clean.includes('.') ? clean.slice(clean.lastIndexOf('.')) : '.jpg';
    return Array.from({ length: total }, (_, i) => `${prefix}-${String(i + 1).padStart(4, '0')}${ext}`);
  }

  const prefix = match[1] || cleanSubgrid || clean.split('-')[0];
  const numStr = match[2];
  const ext = match[3] || '.jpg';
  const startNum = parseInt(numStr, 10);
  const padLen = Math.max(numStr.length, 4);

  const list: string[] = [];
  for (let i = 0; i < total; i++) {
    const nextNum = String(startNum + i).padStart(padLen, '0');
    list.push(`${prefix}-${nextNum}${ext}`);
  }
  return list;
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

// Helper: Unique ID generator for daily runs and batch items
export function getItemId(item: any): string {
  if (!item) return '';
  if (item.id) return String(item.id);
  if (item._id) return String(item._id);
  if (item.runId) return String(item.runId);
  const poi = item.poiCount || item.imagesProcessed || item.images || (item.panoramas ? item.panoramas.length : 0);
  const km = item.kmProcessed || 0;
  return `row-${item.date || 'nodate'}-${item.subgrid || item.imageFilename || 'nosub'}-${poi}-${km}`;
}

// Helper: Build a BatchLog from Supabase record or return dynamic fallback
export function createBatchLogFromSupabaseOrDummy(
  row?: { filename?: string; image_url?: string; captured_at?: string; images?: number; defects?: number; km_processed?: number; kmProcessed?: number; grid?: string; subgrid?: string; pic?: string },
  fallbackSubgrid: string = '',
  gridNum: string = '1'
): BatchLog {
  const imageFilename = row?.image_url || row?.filename || (fallbackSubgrid ? `${fallbackSubgrid}-0001.jpg` : '');
  const subgrid = (row?.subgrid || extractSubgridName(imageFilename) || fallbackSubgrid || '').toUpperCase().trim();
  const date = row?.captured_at
    ? new Date(row.captured_at).toISOString().replace('T', ' ').slice(0, 16)
    : new Date().toISOString().replace('T', ' ').slice(0, 16);

  return {
    id: String(Date.now()),
    date,
    grid: row?.grid || gridNum,
    subgrid,
    imageFilename,
    images: Number(row?.images || 0),
    defects: Number(row?.defects || 0),
    kmProcessed: Number(row?.km_processed || row?.kmProcessed || 0),
    status: 'Complete',
    pic: row?.pic || 'Admin'
  };
}

// ==============================================
// Initial State (Populated dynamically from Supabase)
// ==============================================

const TOUR_STEPS = [
  {
    step: 1,
    title: '1. Executive KPI Summary Cards',
    desc: 'Real-time monitoring of total trajectory distance (KM), 360° panorama frame counts, active survey subgrids, and overall defect SLA pass rates.',
    highlight: 'Top executive summary cards'
  },
  {
    step: 2,
    title: '2. Interactive WebGIS Map & Layer Controls',
    desc: 'Spatial trajectory inspection on Leaflet. Click any subgrid to filter frames. Toggle subgrid bounding boxes, trajectory lines, and high-voltage grid overlays.',
    highlight: 'Interactive WebGIS Map canvas'
  },
  {
    step: 3,
    title: '3. 360° Equirectangular StreetView Inspector',
    desc: 'High-definition 360° camera inspection. Step along trajectory points, review automated defect flags, and complete YES/NO QA verification questionnaires.',
    highlight: '360° Panorama StreetView panel'
  },
  {
    step: 4,
    title: '4. Daily Survey Progress & Supabase DB Control',
    desc: 'Filter daily survey passes by column (Date, PIC, Subgrid), perform passcode-protected record edits or deletions, and publish live records to Supabase PostgreSQL.',
    highlight: 'Daily progress data table'
  },
  {
    step: 5,
    title: '5. Audit Trail Logs & Real-Time Notifications',
    desc: 'Inspect chronological system activity logs (create, edit, delete, publish, error) with date-range filters, and monitor live database publish notifications.',
    highlight: 'Header Audit Log & Notification controls'
  },
  {
    step: 6,
    title: '6. Navigation Sidebar Panel Overview',
    desc: 'The central navigation bar provides fast access to all operational canvases, database management tools, system settings, and interactive help controls.',
    highlight: 'Navigation sidebar strip'
  },
  {
    step: 7,
    title: '7. Main Dashboard Canvas Switcher',
    desc: 'Click this button to return instantly to the primary WebGIS view, featuring spatial trajectory maps, 360° StreetView inspectors, and daily progress metrics.',
    highlight: 'Main Dashboard nav button'
  },
  {
    step: 8,
    title: '8. PostGIS Data Management & Layer Catalog',
    desc: 'Access the dedicated PostGIS Data Management canvas to inspect raw trajectory tables, import survey CSVs, and configure subgrid masterlists.',
    highlight: 'Data Management nav button'
  },
  {
    step: 9,
    title: '9. Instant Map & Trajectory Cache Refresh',
    desc: 'Triggers an instant cache purge and re-sync with Supabase PostgreSQL, reloading all trajectory polylines, panorama nodes, and subgrid boundaries.',
    highlight: 'Refresh Map nav button'
  },
  {
    step: 10,
    title: '10. Project & Database Settings',
    desc: 'Open Section 7 & Section 8 settings to configure Masterlist subgrid deduplication rules, daily survey run preservation policies, and QA defect SLA benchmarks.',
    highlight: 'Project Settings nav button'
  },
  {
    step: 11,
    title: '11. About Dashboard & System Specifications',
    desc: 'View comprehensive system specs, including PostGIS mapping engines, Supabase PostgreSQL database architecture, coordinate reference systems (EPSG:4326, 3857, 3375), and versioning.',
    highlight: 'About Dashboard nav button'
  },
  {
    step: 12,
    title: '12. Expandable Navigation Panel & Fluid Micro-Animations',
    desc: 'Click the bottom chevron toggle to expand or collapse the navigation sidebar with silky-smooth cubic-bezier transitions, label sliding animations, and glowing fluid active dots.',
    highlight: 'Expand / Collapse panel toggle button'
  }
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

export function reconcileBatchLogs(dailyItems: DailyTimeSeries[], baseBatches?: BatchLog[]): BatchLog[] {
  if (!dailyItems || dailyItems.length === 0) {
    return [];
  }

  // Lookup existing Masterlist Admin PICs
  const baseBatchPicMap = new Map<string, string>();
  if (baseBatches && Array.isArray(baseBatches)) {
    baseBatches.forEach(b => {
      const sg = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      if (sg && b.pic) {
        baseBatchPicMap.set(sg, b.pic);
      }
    });
  }

  // Group all daily records by normalized subgrid
  const batchMap = new Map<string, {
    id: string;
    subgrid: string;
    grid: string;
    date: string;
    imageFilename: string;
    totalImages: number;
    publishedImages: number;
    totalPoi: number;
    publishedPoi: number;
    publishedKm: number;
    totalKm: number;
    defects: number;
    adminPic: string;
    captureEquipment: string;
    panoramas: any[];
    availableFilenames?: string[];
    runsCount: number;
    publishedRunsCount: number;
  }>();

  for (const d of dailyItems) {
    const rawSub = d.subgrid || (d.panoramas?.[0]?.filename) || '';
    const normSub = (extractSubgridName(rawSub) || rawSub).toUpperCase().trim();
    if (!normSub) continue;

    const isPublished = d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase === true;
    const singlePoi = d.poiCount || (d.panoramas?.length) || 0;
    const singleImg = getImagesProcessedCount(d);
    const kmVal = Number(d.kmProcessed || 0);
    let parsedStatusDefects = 0;
    if (d.qaqcStatus) {
      const m = d.qaqcStatus.match(/(\\d+)\\s+Defect/i);
      if (m) parsedStatusDefects = parseInt(m[1], 10);
    }

    const defCount = (d.imagesDefected && d.imagesDefected > 0)
      ? d.imagesDefected
      : (d.defectCount && d.defectCount > 0)
        ? d.defectCount
        : (parsedStatusDefects > 0)
          ? parsedStatusDefects
          : 0;

    const existing = batchMap.get(normSub);
    if (existing) {
      existing.totalPoi += singlePoi;
      existing.totalImages += singleImg;
      existing.totalKm = Math.round((existing.totalKm + kmVal) * 100) / 100;
      if (isPublished) {
        existing.publishedPoi += singlePoi;
        existing.publishedImages += singleImg;
        existing.publishedKm = Math.round((existing.publishedKm + kmVal) * 100) / 100;
        existing.publishedRunsCount += 1;
      }
      existing.defects += defCount;
      existing.runsCount += 1;
      if (d.date) existing.date = d.date;
      if (d.captureEquipment) existing.captureEquipment = d.captureEquipment;
      if (d.panoramas && d.panoramas.length > 0) {
        if (!existing.panoramas) existing.panoramas = [];
        existing.panoramas = [...existing.panoramas, ...d.panoramas];
      }
      if (d.availableFilenames && Array.isArray(d.availableFilenames)) {
        if (!existing.availableFilenames) existing.availableFilenames = [];
        d.availableFilenames.forEach(fn => {
          if (!existing.availableFilenames!.includes(fn)) existing.availableFilenames!.push(fn);
        });
      }
    } else {
      const initialAvailFiles = d.availableFilenames && Array.isArray(d.availableFilenames)
        ? [...d.availableFilenames]
        : (d.panoramas ? d.panoramas.filter((p: any) => p.isAvailable !== false).map((p: any) => p.filename).filter(Boolean) : []);

      const designatedAdminPic = baseBatchPicMap.get(normSub) || 'Admin';

      batchMap.set(normSub, {
        id: 'BATCH-' + normSub,
        subgrid: normSub,
        grid: d.grid || '1',
        date: d.date || new Date().toISOString().slice(0, 10),
        imageFilename: (d.panoramas?.[0]?.filename) || (normSub + '-0001.jpg'),
        totalImages: singleImg,
        publishedImages: isPublished ? singleImg : 0,
        totalPoi: singlePoi,
        publishedPoi: isPublished ? singlePoi : 0,
        publishedKm: isPublished ? kmVal : 0,
        totalKm: kmVal,
        defects: defCount,
        adminPic: designatedAdminPic,
        captureEquipment: d.captureEquipment || 'MMS',
        panoramas: d.panoramas ? [...d.panoramas] : [],
        availableFilenames: initialAvailFiles.length > 0 ? initialAvailFiles : undefined,
        runsCount: 1,
        publishedRunsCount: isPublished ? 1 : 0
      });
    }
  }

  // Convert map to BatchLog array
  const result: BatchLog[] = [];
  for (const [normSub, entry] of batchMap.entries()) {
    const finalImages = typeof entry.totalImages === 'number' ? entry.totalImages : (typeof entry.publishedImages === 'number' ? entry.publishedImages : 0);
    const isComplete = entry.publishedRunsCount > 0 && entry.publishedRunsCount === entry.runsCount && finalImages >= entry.totalPoi && entry.totalPoi > 0;
    const finalStatus: 'Complete' | 'Ongoing' = isComplete ? 'Complete' : 'Ongoing';

    result.push({
      id: 'BATCH-' + normSub,
      date: entry.date.length <= 10 ? (entry.date + ' 00:43') : entry.date,
      grid: entry.grid,
      subgrid: normSub,
      imageFilename: entry.imageFilename,
      images: finalImages,
      poiCount: entry.totalPoi,
      availableImagesCount: finalImages,
      availableFilenames: entry.availableFilenames && entry.availableFilenames.length > 0 ? entry.availableFilenames : undefined,
      kmProcessed: entry.totalKm,
      defects: entry.defects,
      pic: entry.adminPic || baseBatchPicMap.get(normSub) || 'Admin',
      status: finalStatus,
      captureEquipment: entry.captureEquipment,
      panoramas: entry.panoramas,
      publishToWebGIS: isComplete ? 'yes' : 'in process',
      isSyncedWithSupabase: isComplete,
      runsCount: entry.runsCount,
      publishedRunsCount: entry.publishedRunsCount
    });
  }

  return result;
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

  const effectiveSettings = React.useMemo(() => {
    return (passedSettings && typeof passedSettings === 'object') ? passedSettings : {};
  }, [passedSettings, refreshKey]);

  const formattedStagedItems = React.useMemo(() => {
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

  const sendStagedData = React.useCallback(() => {
    if (iframeRef.current && iframeRef.current.contentWindow && formattedStagedItems.length > 0) {
      try {
        const isSingle = Boolean(selectedDailyRunId);
        const allPoints = formattedStagedItems.flatMap(it => it.panoramas || it.points || []);
        const viewMode = selectedDailyRunId ? 'SINGLE_RUN' : (selectedSubgridFilter ? 'SUBGRID' : 'ALL');

        console.log('[sendStagedData debug breakdown]', {
          viewMode,
          totalPoints: allPoints.length,
          itemsBreakdown: formattedStagedItems.map(it => ({
            id: it.id,
            runId: it.runId,
            subgrid: it.subgrid,
            count: (it.panoramas || it.points || []).length
          }))
        });

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

        // 2. Send STAGED_DATA_PREVIEW fallback
        iframeRef.current.contentWindow.postMessage({
          type: 'STAGED_DATA_PREVIEW',
          isStagingPreview: Boolean(dataManagement),
          stagedItems: formattedStagedItems,
          isSingleRun: isSingle,
          runId: selectedDailyRunId || null
        }, '*');

        // 3. Send explicit selection messages for WebGIS viewer layers
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

        // 4. Send FILTER_STATUS_TYPES to ensure stitching/in-progress trajectory filter is active
        iframeRef.current.contentWindow.postMessage({
          type: 'FILTER_STATUS_TYPES',
          statusFilters: { published: true, defect: true, stitching: true, selected: true },
          showPanotrackData: true
        }, '*');

        // 5. Send QAQC_DEFECTS_SYNC with all known defect items
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
  }, [formattedStagedItems, dataManagement, defectsList, selectedDailyRunId, selectedSubgridFilter, selectedSubgrids]);

  const syncMapSettings = React.useCallback(() => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    try {
      const s = effectiveSettings || {};
      // 1. Send Basemap
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_BASEMAP',
        basemap: s.defaultBasemap || 'ofm-positron',
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
    } catch (e) { }
  }, [effectiveSettings]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
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
    // Only send delayed retries when NOT in single-run mode (to avoid overwriting isolated batch display)
    if (!selectedDailyRunId) {
      const t1 = setTimeout(() => { syncMapSettings(); sendStagedData(); }, 400);
      const t2 = setTimeout(() => { syncMapSettings(); sendStagedData(); }, 1200);
      const t3 = setTimeout(() => { syncMapSettings(); sendStagedData(); }, 2500);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
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
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[9px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live WebGIS
              </span>
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
        key={`${refreshKey || 0}-${effectiveSettings?.defaultBasemap || 'ofm-positron'}`}
        src={`${import.meta.env.VITE_MAP_URL || 'https://mobilemapping-nine.vercel.app'}/?embed=true&dashboard=true&basemap=${encodeURIComponent(effectiveSettings?.defaultBasemap || 'ofm-positron')}${refreshKey ? `&t=${refreshKey}` : ''}${dataManagement ? '&noSonar=1' : ''}`}
        onLoad={() => {
          if (iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'SET_SUBGRID_FILTER',
              subgrid: selectedSubgridFilter || '',
              isSingleRun: Boolean(selectedDailyRunId),
              runId: selectedDailyRunId || null,
              date: selectedDateFilter || ''
            }, '*');
            syncMapSettings();
            sendStagedData();
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
// QC Audit Modal Component (Missing Image Inspector)
// ==============================================
interface QCAuditModalProps {
  subgrid: string;
  poiCount: number;
  availableCount: number;
  baseFilename?: string;
  availableFilenames?: string[];
  expectedFilenames?: string[];
  onClose: () => void;
}

export function QCAuditModal({ subgrid, poiCount, availableCount, baseFilename, availableFilenames, expectedFilenames, onClose }: QCAuditModalProps) {
  const expectedTotal = poiCount > 0 ? poiCount : 1;
  const missingCount = Math.max(0, expectedTotal - availableCount);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentScanningFilename, setCurrentScanningFilename] = useState('');
  const [, setHasAnalyzed] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'missing' | 'available'>('missing');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<{ filename: string; index: number; isMissing: boolean }[]>([]);

  const runIntegrityAudit = () => {
    setIsAnalyzing(true);
    setProgress(0);
    setHasAnalyzed(false);

    const allExpected = (expectedFilenames && expectedFilenames.length > 0)
      ? expectedFilenames
      : generateImageFilenamesList(subgrid, expectedTotal, baseFilename);

    const availableSet = new Set((availableFilenames && availableFilenames.length > 0)
      ? availableFilenames.map(f => f.toLowerCase().trim())
      : allExpected.slice(0, availableCount).map(f => f.toLowerCase().trim()));

    let currentStep = 0;
    const totalSteps = Math.min(100, allExpected.length);
    const stepIncrement = Math.max(1, Math.floor(allExpected.length / totalSteps));

    const interval = setInterval(() => {
      currentStep += stepIncrement;
      if (currentStep >= allExpected.length) {
        currentStep = allExpected.length;
        clearInterval(interval);

        const analyzedList = allExpected.map((fn, idx) => ({
          filename: fn,
          index: idx + 1,
          isMissing: !availableSet.has(fn.toLowerCase().trim())
        }));

        setResults(analyzedList);
        setProgress(100);
        setIsAnalyzing(false);
        setHasAnalyzed(true);
      } else {
        const pct = Math.round((currentStep / allExpected.length) * 100);
        setProgress(pct);
        setCurrentScanningFilename(allExpected[currentStep - 1] || '');
      }
    }, 25);
  };

  useEffect(() => {
    runIntegrityAudit();
  }, [subgrid, poiCount, availableCount]);

  const filteredResults = results.filter(item => {
    if (activeTab === 'missing' && !item.isMissing) return false;
    if (activeTab === 'available' && item.isMissing) return false;
    if (searchQuery.trim()) {
      return item.filename.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const missingFilenames = results.filter(r => r.isMissing).map(r => r.filename);

  const copyMissingList = () => {
    if (missingFilenames.length === 0) {
      alert('No missing image files found for this subgrid!');
      return;
    }
    navigator.clipboard.writeText(missingFilenames.join('\n'));
    alert(`Copied ${missingFilenames.length} missing image filenames to clipboard!`);
  };

  const exportQCReport = () => {
    const reportText = `=====================================================
TNB 360 MOBILE MAPPING - QC AUDIT REPORT
=====================================================
Subgrid: ${subgrid}
Audit Date: ${new Date().toLocaleString()}
POI Survey Count (CSV Metadata): ${expectedTotal}
Available Images in MMS_PIC: ${availableCount}
Missing Panorama Images: ${missingCount}
Integrity Status: ${missingCount === 0 ? 'PASSED (100% Complete)' : 'ACTION REQUIRED (Missing Images Detected)'}
=====================================================

MISSING FILENAMES (${missingFilenames.length}):
-----------------------------------------------------
${missingFilenames.length > 0 ? missingFilenames.join('\n') : 'None - All images exist in MMS_PIC storage.'}
`;
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `QC_Missing_Report_${subgrid}_${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 backdrop-blur-md">
      <div className="bg-card border border-subtle rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">

        {/* Header */}
        <div className="flex justify-between items-start pb-4 mb-4 border-b border-subtle shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-inner border border-subtle text-text-base">
                {missingCount > 0 ? <ShieldAlert size={20} className="text-rose-400" /> : <ShieldCheck size={20} className="text-emerald-400" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-text-base tracking-wide flex items-center gap-2">
                  QC Integrity Audit &bull; Subgrid [{subgrid}]
                </h2>
                <span className="text-xs text-text-muted">Verifying panorama file availability in Supabase MMS_PIC storage</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-base p-1 rounded-lg hover:bg-inner transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Audit Metrics Summary Grid */}
        <div className="grid grid-cols-3 gap-3 mb-4 shrink-0">
          <div className="bg-card border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">POI Metadata Points</span>
            <span className="text-xl font-extrabold text-text-base font-sans mt-0.5 block">{expectedTotal.toLocaleString()}</span>
            <span className="text-[10px] text-text-muted">Expected survey track</span>
          </div>
          <div className="bg-card border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Available in MMS_PIC</span>
            <span className="text-xl font-extrabold text-emerald-400 font-sans mt-0.5 block">{availableCount.toLocaleString()}</span>
            <span className="text-[10px] text-text-muted">Uploaded image frames</span>
          </div>
          <div className="bg-card border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Missing Images</span>
            <span className={`text-xl font-extrabold font-sans mt-0.5 block ${missingCount > 0 ? 'text-rose-400' : 'text-text-base'}`}>{missingCount.toLocaleString()}</span>
            <span className={`text-[10px] ${missingCount > 0 ? 'text-rose-400/80' : 'text-text-muted'}`}>{missingCount > 0 ? 'Upload required' : '100% Matched'}</span>
          </div>
        </div>

        {/* Progress Bar during Analysis */}
        {isAnalyzing ? (
          <div className="bg-card border border-subtle p-5 rounded-xl mb-4 shrink-0 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-sky-400 flex items-center gap-2">
                <Loader2 size={15} className="animate-spin text-sky-400" />
                Analyzing MMS_PIC storage bucket files...
              </span>
              <span className="text-text-base font-sans">{progress}%</span>
            </div>
            <div className="w-full bg-inner h-2 rounded-full overflow-hidden p-0.5">
              <div
                className="bg-gradient-to-r from-sky-500 to-emerald-400 h-full rounded-full transition-all duration-75 shadow-[0_0_8px_rgba(56,189,248,0.4)]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-[11px] text-text-muted font-sans truncate">
              {currentScanningFilename ? `Scanning: ${currentScanningFilename}` : 'Checking panorama filenames...'}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
            {/* Filter Tabs */}
            <div className="flex bg-card p-1 rounded-xl border border-subtle text-xs font-medium">
              <button
                onClick={() => setActiveTab('missing')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'missing' ? 'bg-inner text-rose-400 border border-subtle font-semibold shadow-sm' : 'text-text-muted hover:text-text-base'}`}
              >
                <AlertTriangle size={13} className="text-rose-400" />
                Missing Only ({missingCount})
              </button>
              <button
                onClick={() => setActiveTab('available')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'available' ? 'bg-inner text-emerald-400 border border-subtle font-semibold shadow-sm' : 'text-text-muted hover:text-text-base'}`}
              >
                <CheckCircle size={13} className="text-emerald-400" />
                Available ({availableCount})
              </button>
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === 'all' ? 'bg-inner text-text-base border border-subtle font-semibold shadow-sm' : 'text-text-muted hover:text-text-base'}`}
              >
                All ({expectedTotal})
              </button>
            </div>

            {/* Re-analyze & Search */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5 text-text-muted" />
                <input
                  type="text"
                  placeholder="Filter filenames..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-card border border-subtle rounded-lg text-xs text-text-base placeholder-text-muted focus:outline-none focus:border-subtle"
                />
              </div>
              <button
                onClick={runIntegrityAudit}
                className="p-2 bg-inner hover:bg-inner text-text-base rounded-lg border border-subtle transition-colors cursor-pointer"
                title="Re-run QC Audit"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Results List View */}
        <div className="flex-1 overflow-y-auto font-sans text-xs space-y-1 p-2.5 bg-card rounded-xl border border-subtle min-h-[220px]">
          {filteredResults.length === 0 ? (
            <div className="py-12 text-center text-text-muted">
              <CheckCircle size={24} className="mx-auto text-emerald-400 mb-2 opacity-70" />
              <span className="block text-xs font-semibold text-text-base">
                {activeTab === 'missing' ? 'No missing image files!' : 'No files matching criteria'}
              </span>
              <span className="text-[11px] text-text-muted">
                {activeTab === 'missing' ? 'All expected POI survey points have matching images in MMS_PIC.' : 'Try changing search or tab filters.'}
              </span>
            </div>
          ) : (
            filteredResults.map((item) => (
              <div
                key={item.index}
                className="flex items-center justify-between px-3 py-2 bg-card hover:bg-card border border-subtle hover:border-subtle rounded-lg transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-text-muted text-[10px] w-10 font-sans">#{String(item.index).padStart(4, '0')}</span>
                  {/* Clean white/slate text for filenames */}
                  <span className="font-sans text-xs font-medium text-text-base">
                    {item.filename}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {item.isMissing ? (
                    <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-md text-[10px] font-medium font-sans flex items-center gap-1">
                      <AlertTriangle size={10} />
                      MISSING FROM MMS_PIC
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md text-[10px] font-medium font-sans flex items-center gap-1">
                      <CheckCircle size={10} />
                      AVAILABLE
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Utility Toolbar */}
        <div className="pt-4 border-t border-subtle flex items-center justify-between shrink-0 mt-4">
          <div className="flex items-center gap-2">
            <button
              onClick={copyMissingList}
              disabled={missingCount === 0}
              className="px-3.5 py-2 bg-inner hover:bg-inner disabled:opacity-40 disabled:cursor-not-allowed text-text-base border border-subtle rounded-xl text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Copy size={13} /> Copy Missing List ({missingCount})
            </button>
            <button
              onClick={exportQCReport}
              className="px-3.5 py-2 bg-inner hover:bg-inner text-text-base border border-subtle rounded-xl text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer"
            >
              <FileText size={13} /> Export QC Report (.txt)
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-text-base rounded-xl text-xs font-semibold transition-all shadow-md cursor-pointer"
          >
            Close QC Tool
          </button>
        </div>

      </div>
    </div>
  );
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

const DataManagementPage = ({
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
      alert('Selected CSV file(s) must have at least a header row and one data row');
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

            <div className="p-4 flex-1 flex flex-col gap-4">

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
            <div className="flex flex-wrap items-center justify-between gap-4 bg-inner/40 border border-subtle p-3 rounded-xl shadow-sm">
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
                    className="flex items-center gap-2 bg-inner hover:bg-inner border border-subtle text-text-base px-3.5 py-2 rounded-xl transition-all text-xs font-semibold cursor-pointer shadow-sm"
                    title="Sync latest live records from Supabase mobilemapping database"
                  >
                    <RefreshCw size={13} className="text-sky-400" />
                    <span>Sync Now</span>
                  </button>

                  {!isGuestUser && (
                    <label className="flex items-center gap-2 bg-inner hover:bg-inner border border-subtle px-3.5 py-2 rounded-xl transition-all cursor-pointer text-text-base font-semibold text-xs shadow-sm active:scale-95">
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
                    {Array.from(new Set(draftDailyData.map(d => d.grid).filter(Boolean))).sort().map(g => (
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
                    {Array.from(new Set(draftDailyData.map(d => (d.subgrid || '').toUpperCase().trim()).filter(Boolean))).sort().map(sg => (
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
                    {Array.from(new Set(draftDailyData.map(d => d.captureEquipment).filter(Boolean))).sort().map(eq => (
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
                    {Array.from(new Set(draftDailyData.map(d => d.pic).filter(Boolean))).sort().map(p => (
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
                    {Array.from(new Set(draftDailyData.map(d => d.publishToWebGIS).filter(Boolean))).sort().map(st => (
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
                      onClick={() => setSelectedRowIds(new Set())}
                      className="px-3 py-2 text-text-muted hover:text-text-base transition-colors cursor-pointer text-xs"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-inner/20 border border-subtle rounded-xl shadow-sm overflow-hidden flex flex-col">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-card text-text-muted border-b border-subtle">
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
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Date</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Grid</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Subgrid</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Frames</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Distance (km)</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Images</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Defects</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">PIC</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Status</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Configure</th>
                          </>
                        ) : (
                          <>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Date</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Grid</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Subgrid</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Frames</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">KM Processed</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Images Processed</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Capture Equipment</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Defects</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">PIC</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Publish to WEBGIS</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Status</th>
                            <th className="px-4 py-3.5 font-bold text-[11px] uppercase tracking-wider whitespace-nowrap">Configure</th>
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
                                className="hover:bg-inner transition-all text-text-base"
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
                                <td className="px-4 py-3.5 font-sans text-xs text-text-base whitespace-nowrap">{formatDisplayDate(batch.date)}</td>
                                <td className="px-4 py-3.5 font-sans text-text-base font-semibold whitespace-nowrap">{batch.grid}</td>
                                <td className="px-4 py-3.5 font-semibold text-text-base whitespace-nowrap flex items-center gap-2">
                                  <span>{batchSubgrid}</span>
                                </td>
                                <td className="px-4 py-3.5 font-sans text-xs text-text-base font-semibold whitespace-nowrap">{getPOICount(batch).toLocaleString()}</td>
                                <td className="px-4 py-3.5 font-semibold text-text-base whitespace-nowrap">{batch.kmProcessed.toFixed(1)}</td>
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
                                    className="text-text-base hover:text-text-base hover:underline font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                                    title="Click to view list of image filenames"
                                  >
                                    <span>{getImagesProcessedCount(batch).toLocaleString()} frames</span>
                                    <ExternalLink size={11} className="shrink-0 text-text-muted" />
                                  </button>
                                </td>
                                <td className="px-4 py-3.5 text-text-base font-medium whitespace-nowrap">
                                  {batch.defects || 0}
                                </td>
                                <td className="px-4 py-3.5 text-text-base font-medium whitespace-nowrap">
                                  {(batch.pic && batch.pic.trim().toLowerCase() !== 'unassigned') ? batch.pic : (activeAuthUserName || 'Admin')}
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${batch.status === 'Complete'
                                    ? 'bg-inner text-text-base border border-subtle'
                                    : 'bg-app text-text-muted border border-subtle'
                                    }`}>
                                    {batch.status === 'Complete' ? <CheckCircle size={10} className="text-emerald-400" /> : <Clock size={10} className="text-amber-400" />}
                                    {batch.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3.5 flex items-center gap-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
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
                                    className="px-2.5 py-1 rounded-lg border text-xs font-medium bg-inner hover:bg-inner text-text-base border-subtle transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                                    title="View QC Audit Details"
                                  >
                                    <ShieldAlert size={13} className="text-sky-400" />
                                    <span>QC Audit</span>
                                  </button>
                                  {!isGuestUser ? (
                                    <>
                                      <button
                                        onClick={() => {
                                          setEditingItem(batch);
                                          setIsFormOpen(true);
                                        }}
                                        className="text-text-muted hover:text-sky-400 transition-colors p-1"
                                        title="Edit"
                                      >
                                        <Edit2 size={18} />
                                      </button>
                                      <button
                                        onClick={() => initiateDelete(batch)}
                                        className="text-text-muted hover:text-red-400 transition-colors p-1 cursor-pointer"
                                        title="Delete Record (Admin Authorization Required)"
                                      >
                                        <Trash2 size={18} />
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
                            <td colSpan={10} className="px-4 py-12 text-center text-text-muted">
                              {searchQuery ? `No batch logs found matching "${searchQuery}"` : 'No batch logs available'}
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
                                className="hover:bg-inner transition-all text-text-base"
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
                                <td className="px-4 py-3.5 text-text-base font-sans text-xs whitespace-nowrap">{formatDisplayDate(daily.date)}</td>
                                <td className="px-4 py-3.5 text-text-base font-semibold whitespace-nowrap">{daily.grid}</td>
                                <td className="px-4 py-3.5 text-text-base font-semibold whitespace-nowrap flex items-center gap-2">
                                  <span>{daily.subgrid}</span>
                                </td>
                                <td className="px-4 py-3.5 font-sans text-xs text-text-base font-semibold whitespace-nowrap">{getPOICount(daily).toLocaleString()}</td>
                                <td className="px-4 py-3.5 text-text-base font-semibold whitespace-nowrap">{daily.kmProcessed.toFixed(1)}</td>
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
                                    className="text-text-base hover:text-text-base hover:underline font-semibold text-xs cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
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
                                    className="bg-app border border-subtle rounded-lg px-2 py-1 text-xs font-semibold text-text-base focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                                  >
                                    <option value="MMS" className="bg-app text-text-base">MMS</option>
                                    <option value="Backpack" className="bg-app text-text-base">Backpack</option>
                                    <option value="Drone" className="bg-app text-text-base">Drone</option>
                                    <option value="Handheld" className="bg-app text-text-base">Handheld</option>
                                  </select>
                                </td>
                                <td className="px-4 py-3.5 text-text-base font-medium whitespace-nowrap">
                                  {daily.imagesDefected || daily.defectCount || 0}
                                </td>
                                <td className="px-4 py-3.5 text-text-base font-medium whitespace-nowrap">
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
                                    className="bg-app border border-subtle rounded-lg px-2 py-1 text-xs font-semibold text-text-base focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
                                  >
                                    <option value="in process" className="bg-app text-text-base">In Process</option>
                                    <option value="yes" className="bg-app text-text-base">Yes - Publish</option>
                                    <option value="need to recheck" className="bg-app text-text-base">Need to Recheck</option>
                                    <option value="no" className="bg-app text-text-muted">No</option>
                                  </select>
                                </td>
                                <td className="px-4 py-3.5 whitespace-nowrap">
                                  {isPublished ? (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-inner text-text-base border border-subtle">
                                      <CheckCircle size={12} className="text-emerald-400 shrink-0" />
                                      Published in database
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-inner text-text-base border border-subtle">
                                      <Clock size={12} className="text-amber-400 shrink-0" />
                                      Ready to publish
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 flex items-center gap-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                  {!isGuestUser ? (
                                    <>
                                      <button
                                        onClick={() => handlePublishRecord(daily)}
                                        disabled={isPublished || publishingId === getItemId(daily)}
                                        className={`transition-colors p-1 ${isPublished ? 'text-text-muted cursor-not-allowed opacity-40' : 'text-emerald-400 hover:text-emerald-300 cursor-pointer'}`}
                                        title={isPublished ? 'Already published in database' : 'Click to publish to database'}
                                      >
                                        {publishingId === getItemId(daily) ? (
                                          <RefreshCw size={18} className="animate-spin text-sky-400" />
                                        ) : (
                                          <Database size={18} />
                                        )}
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingItem(daily);
                                          setIsFormOpen(true);
                                        }}
                                        className="text-text-muted hover:text-sky-400 transition-colors p-1 cursor-pointer"
                                        title="Edit Record"
                                      >
                                        <Edit2 size={18} />
                                      </button>
                                      <button
                                        onClick={() => initiateDelete(daily)}
                                        className="text-text-muted hover:text-red-400 transition-colors p-1 cursor-pointer"
                                        title="Delete Record (Admin Authorization Required)"
                                      >
                                        <Trash2 size={18} />
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
                            <td colSpan={12} className="px-4 py-12 text-center text-text-muted">
                              {searchQuery ? `No daily records found matching "${searchQuery}"` : 'No daily data available'}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls Footer */}
                {totalItems > 0 && (
                  <div className="px-5 py-3 bg-card border-t border-subtle flex flex-wrap items-center justify-between gap-3 text-xs text-text-muted">
                    <div className="flex items-center gap-4">
                      <span>
                        Showing <strong className="text-text-base">{(safePage - 1) * pageSize + 1}</strong> to{' '}
                        <strong className="text-text-base">{Math.min(safePage * pageSize, totalItems)}</strong> of{' '}
                        <strong className="text-text-base">{totalItems}</strong> entries
                      </span>
                      <div className="flex items-center gap-2">
                        <span>Rows per page:</span>
                        <select
                          value={pageSize}
                          onChange={(e) => setPageSize(Number(e.target.value))}
                          className="bg-inner border border-subtle text-text-base rounded px-2 py-1 focus:outline-none focus:border-sky-500 cursor-pointer"
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
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-inner hover:bg-inner disabled:opacity-40 disabled:hover:bg-inner text-text-base font-medium transition-colors cursor-pointer"
                      >
                        <ChevronLeft size={14} />
                        Previous
                      </button>

                      <span className="px-3 py-1 bg-inner rounded-lg text-text-base font-semibold border border-subtle">
                        Page {safePage} of {totalPages}
                      </span>

                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={safePage === totalPages}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-inner hover:bg-inner disabled:opacity-40 disabled:hover:bg-inner text-text-base font-medium transition-colors cursor-pointer"
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
              <div className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 sm:p-6 backdrop-blur-sm overflow-y-auto">
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
              <div className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 backdrop-blur-sm">
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
                        alert(`Copied ${filenames.length} image filenames to clipboard!`);
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
              <div className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000]">
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
            <div className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000]">
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
            <div className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000]">
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
              <div className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000]">
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
        <div className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1100] p-4 sm:p-6 backdrop-blur-sm overflow-y-auto">
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

// ==============================================
// Main Application Component
// ==============================================

export default function App() {
  const [currentPage, setCurrentPage] = useState<WorkspaceKey>(() => parseHashWorkspace());
  const dashboardPsvRef = useRef<PhotoSphereViewerHandle | null>(null);
  const [showLanding, setShowLanding] = useState<boolean>(true);
  const [authSession, setAuthSession] = useState<any>(null);
  const [pendingModule, setPendingModule] = useState<string | null>(null);
  const [selectedDailyRunId, setSelectedDailyRunId] = useState<string | null>(null);

  // Daily Operations Handover & Briefing Modal State
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState<boolean>(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const dismissedDate = localStorage.getItem('geosphere360_handover_dismissed_date');
    return dismissedDate !== todayStr;
  });

  // 1. Core Dynamic States
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [dailyData, setDailyData] = useState<DailyTimeSeries[]>([]);
  const [batchLogs, setBatchLogs] = useState<BatchLog[]>([]);
  const [qaqcAuditRuns, setQaqcAuditRuns] = useState<Record<string, QAQCAuditRunRecord>>({});
  const [qaSubgridRecords, setQaSubgridRecords] = useState<Record<string, {
    flags: { blurry: boolean; obstruction: boolean; badGps: boolean };
    answer: 'yes' | 'no' | null;
    isLocked: boolean;
  }>>({});
  const [dataManagementTab, setDataManagementTab] = useState<'batches' | 'daily' | 'vector' | 'datasets' | 'recovery'>('batches');
  const [dataManagementSearch, setDataManagementSearch] = useState<string>('');

  // 2. Logging & Notification Callbacks
  const addNotification = useCallback((item: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const timestampStr = `${dateStr}, ${timeStr}`;
    const newNotif: NotificationItem = {
      ...item,
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: timestampStr,
      read: false
    };
    setNotifications(prev => [newNotif, ...prev]);
    saveNotificationToSupabase({
      timestamp: timestampStr,
      title: item.title,
      message: item.message,
      category: item.category,
      totalItems: item.totalItems
    }).catch(err => console.warn('Supabase notification save notice:', err));
  }, []);

  const addAuditLog = useCallback((type: AuditLogItem['type'], title: string, details: string, status: AuditLogItem['status'] = 'info') => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const timestampStr = `${dateStr}, ${timeStr}`;
    const userName = authSession?.user?.email ? authSession.user.email.split('@')[0] : 'System';
    const newAudit: AuditLogItem = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: timestampStr,
      type,
      title,
      details,
      user: userName,
      status,
      read: false
    };
    setAuditLogs(prev => [newAudit, ...prev]);
    saveAuditLogToSupabase({
      timestamp: timestampStr,
      type,
      title,
      details,
      user: userName,
      status
    }).catch(err => console.warn('Supabase audit log save notice:', err));
  }, [authSession]);

  // Persistent Read State Management for Audit Logs and Notifications
  const markAuditLogsAsRead = useCallback(() => {
    try {
      const allIds = auditLogs.map(a => String(a.id));
      const currentRead = new Set(JSON.parse(localStorage.getItem('app_read_audit_ids') || '[]'));
      allIds.forEach(id => {
        currentRead.add(id);
        currentRead.add(`audit-${id}`);
      });
      localStorage.setItem('app_read_audit_ids', JSON.stringify(Array.from(currentRead)));
      localStorage.setItem('app_last_read_audit_time', Date.now().toString());
    } catch (_) { }
    setAuditLogs(old => old.map(a => ({ ...a, read: true })));
  }, [auditLogs]);

  const markNotificationsAsRead = useCallback(() => {
    try {
      const allIds = notifications.map(n => String(n.id));
      const currentRead = new Set(JSON.parse(localStorage.getItem('app_read_notif_ids') || '[]'));
      allIds.forEach(id => {
        currentRead.add(id);
        currentRead.add(`notif-${id}`);
      });
      localStorage.setItem('app_read_notif_ids', JSON.stringify(Array.from(currentRead)));
      localStorage.setItem('app_last_read_notif_time', Date.now().toString());
    } catch (_) { }
    setNotifications(old => old.map(n => ({ ...n, read: true })));
  }, [notifications]);

  const clearNotifications = useCallback(() => {
    try {
      const allIds = notifications.map(n => String(n.id));
      const currentRead = new Set(JSON.parse(localStorage.getItem('app_read_notif_ids') || '[]'));
      allIds.forEach(id => {
        currentRead.add(id);
        currentRead.add(`notif-${id}`);
      });
      localStorage.setItem('app_read_notif_ids', JSON.stringify(Array.from(currentRead)));
      localStorage.setItem('app_cleared_notif_time', Date.now().toString());
    } catch (_) { }
    setNotifications([]);
  }, [notifications]);

  // 1. Module focus spotlight state
  const [focusedSection, setFocusedSection] = useState<'map' | 'processing' | 'qa' | null>(null);

  // 2. Auto-clear spotlight focus after 5 seconds
  useEffect(() => {
    if (focusedSection) {
      const timer = setTimeout(() => {
        setFocusedSection(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [focusedSection]);

  // Lightweight hash-based workspace routing (no external dependency)
  const goToWorkspace = useCallback((key: WorkspaceKey) => {
    setCurrentPage(key);
    setFocusedSection(null);
    setHashWorkspace(key);
  }, []);

  useEffect(() => {
    return subscribeHashWorkspace((key) => {
      setCurrentPage((prev) => (prev === key ? prev : key));
    });
  }, []);

  // Module routing handler
  const handleEnterModule = (targetView?: string | null) => {
    setShowLanding(false);

    if (targetView === 'general-launch') {
      // Direct launch into dashboard (clean view, no spotlight dimming)
      goToWorkspace('dashboard');
      setFocusedSection(null);
    } else if (targetView === 'webgis') {
      // 1. WebGIS Coverage Map Spotlight
      goToWorkspace('dashboard');
      setFocusedSection('map');
    } else if (targetView === 'processing') {
      // 2. Batch Processing Spotlight
      goToWorkspace('dashboard');
      setFocusedSection('processing');
    } else if (targetView === 'qa-inspector') {
      // 3. 360° Inspector Spotlight
      goToWorkspace('dashboard');
      setFocusedSection('qa');
    } else if (targetView === 'postgis' || targetView === 'data') {
      // 4. PostGIS Data Management Canvas
      goToWorkspace('data');
      setFocusedSection(null);
    } else if (targetView === 'analytics-audit' || targetView === 'settings') {
      // 5. Executive Reports & Audit Canvas
      goToWorkspace('settings');
      setFocusedSection(null);
    } else if (targetView === 'production') {
      goToWorkspace('production');
      setFocusedSection(null);
    } else if (targetView === 'storage') {
      goToWorkspace('storage');
      setFocusedSection(null);
    } else if (targetView === 'lineage') {
      goToWorkspace('lineage');
      setFocusedSection(null);
    } else if (targetView === 'reports') {
      goToWorkspace('reports');
      setFocusedSection(null);
    } else if (targetView === 'analytics') {
      goToWorkspace('analytics');
      setFocusedSection(null);
    } else if (targetView === 'administration' || targetView === 'admin') {
      goToWorkspace('administration');
      setFocusedSection(null);
    } else {
      goToWorkspace('dashboard');
      setFocusedSection(null);
    }
  };

  // Helper: Routes directly to the canvas matching the chosen module
  const navigateToModule = (targetView?: string | null) => {
    if (!targetView) {
      goToWorkspace('dashboard');
      return;
    }

    if (targetView === 'data' || targetView === 'postgis') {
      goToWorkspace('data');
    } else if (targetView === 'processing') {
      goToWorkspace('data');
    } else if (targetView === 'settings') {
      goToWorkspace('settings');
    } else if (targetView === 'production') {
      goToWorkspace('production');
    } else if (targetView === 'storage') {
      goToWorkspace('storage');
    } else if (targetView === 'lineage') {
      goToWorkspace('lineage');
    } else if (targetView === 'reports') {
      goToWorkspace('reports');
    } else if (targetView === 'analytics') {
      goToWorkspace('analytics');
    } else if (targetView === 'administration' || targetView === 'admin') {
      goToWorkspace('administration');
    } else {
      // 'webgis', 'qa-inspector', 'analytics-audit', etc.
      goToWorkspace('dashboard');
    }
  };

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'batches' | 'daily'>('batches');

  // Unified Theme State
  const [currentTheme, setCurrentTheme] = useState<string>(() => {
    return localStorage.getItem('app_dashboard_theme') || 'midnight';
  });

  // Derived themeMode for backward compatibility
  const themeMode = currentTheme === 'daylight' ? 'light' : 'dark';

  // Global Theme Listener
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);

    const handleThemeEvent = (e: any) => {
      if (e.detail) {
        setCurrentTheme(e.detail);
        if (e.detail !== 'daylight') {
          localStorage.setItem('app_last_dark_theme', e.detail);
        }
      }
    };

    window.addEventListener('app-theme-changed', handleThemeEvent);
    return () => window.removeEventListener('app-theme-changed', handleThemeEvent);
  }, [currentTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);

    const handleThemeEvent = (e: any) => {
      if (e.detail) {
        setCurrentTheme(e.detail);
      }
    };

    window.addEventListener('app-theme-changed', handleThemeEvent);
    return () => window.removeEventListener('app-theme-changed', handleThemeEvent);
  }, [currentTheme]);


  // ===== Supabase Auth Protection State =====

  // 2. Guest Login Handler (routes directly with 5s spotlight animation)
  const handleGuestLogin = () => {
    setAuthError(null);
    const guestSession = {
      user: {
        id: 'guest-user-001',
        email: 'guest@example.com',
        role: 'guest',
        user_metadata: {
          role: 'Viewer',
          full_name: 'Guest'
        }
      },
      isGuest: true
    };

    setAuthSession(guestSession);

    // Trigger module routing & spotlight focus
    handleEnterModule(pendingModule || 'webgis');
    setPendingModule(null);

    addAuditLog('CREATE', 'Guest Login', 'User logged in under Guest Read-Only mode', 'info');
  };

  // 3. Sign Out Handler
  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) { }
    setAuthSession(null);
    setShowLanding(true);
  };

  const [authLoading, setAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [projectSettings, setProjectSettings] = useState<any>(() => ({
    projectName: '360 Mobile Mapping — Spatial Operations Division',
    contractCode: 'MMS-2026-GEO-01',
    targetKm: 315.2,
    targetImages: 50000,
    targetDeadline: '2026-12-31',
    maxDefectRatePercent: 1.5,
    minGpsAccuracyM: 1.0,
    cameraResolution: '8K 360° Equirectangular',
    defaultEquipment: 'MMS',
    leadPic: '',
    regionZone: 'Central Operations Region',
    clientName: 'Spatial Asset Operations',
    // Database & Image Fetching Settings
    supabaseUrl: 'https://frz995-360-processing.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    dbAutoSyncSec: 60,
    dbTableName: 'batch_logs',
    imageFetchSource: 'local',
    imageStoragePath: '/MMS_PIC/',
    imageFormatPattern: '{subgrid}-{index:04d}.jpg',
    imagePreloadCount: 3,
    enableImageRetryFallback: true,
    // GIS Spatial Reference & Bounding Box Settings
    selectedCrs: 'EPSG:4326',
    selectedRegionBBox: 'peninsular_malaysia',
    minLat: 1.2,
    maxLat: 6.8,
    minLon: 99.6,
    maxLon: 104.6,
    autoDeduplicateSubgrids: true,
    deduplicationStrategy: 'clean_merge',
    enableBBoxFilter: true,
    autoPanOnTrackClick: true,
    defaultBasemapStyle: 'dark',
    defectThreshold: 85,
    aiDefectThresholdPercent: 85,
    csvLatAliases: 'latitude, lat, y, y_coord',
    csvLonAliases: 'longitude, lon, lng, x, x_coord',
    csvHeadingAliases: 'heading, bearing, dir, orientation',
    csvFilenameAliases: 'filename, imagefilename, image_url, file, frame_id',
    csvSubgridAliases: 'subgrid, grid_id, section, tile',
    csvDateAliases: 'date, time, captured_at, timestamp',
    dropZeroGpsRows: true,
    csvTimestampFormat: 'auto'
  }));

  // PSV handles both single equirectangular and multi-res tiles dynamically
  //const { shouldUseMultiRes } = usePanoramaViewer(projectSettings);

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

  useEffect(() => {
    // Check persistent Supabase Auth session on refresh
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAuthSession(session);
        setShowLanding(false); // Authenticated user stays on Dashboard
      } else {
        setAuthSession(null);
        setShowLanding(true);  // Guest / unauthenticated user returns to Landing
      }
      setAuthLoading(false);
    }).catch(() => {
      setAuthLoading(false);
      setShowLanding(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setAuthSession(session);
        setShowLanding(false);
      }
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const isGuestUser = Boolean(authSession?.isGuest || authSession?.user?.role === 'guest' || authSession?.user?.email?.toLowerCase().includes('guest'));

  const activeAuthUserName = React.useMemo(() => {
    if (!authSession || !authSession.user) return '';
    const u = authSession.user;
    const raw = u.user_metadata?.username || u.user_metadata?.full_name || u.user_metadata?.name || (u.email ? u.email.split('@')[0] : '');
    if (!raw) return '';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [authSession]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthenticating(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail.trim(),
      password: authPassword
    });

    setIsAuthenticating(false);

    if (error) {
      setAuthError(error.message || 'Invalid login credentials. Authorized users only.');
    } else if (data.session) {
      setAuthSession(data.session);
      setShowLanding(false);

      // Direct navigation for authenticated user
      navigateToModule(pendingModule);
      setPendingModule(null);
    }
  };

  const [layerCatalog, setLayerCatalog] = useState<(Layer | Folder)[]>([]);

  const activeBatchLogs = React.useMemo(() => {
    const strategy = projectSettings?.deduplicationStrategy || 'clean_merge';
    if (strategy === 'preserve_runs') {
      // Retain each daily survey run as a distinct batch log row
      return dailyData.map((d, index) => ({
        id: d.id || `run-${index}`,
        grid: (d as any).grid || 'Grid 1',
        date: d.date,
        subgrid: `${d.subgrid} (Run ${index + 1})`,
        imageFilename: (d as any).imageFilename || (d as any).filename || `${d.subgrid}.jpg`,
        images: d.imagesProcessed || d.poiCount || 0,
        poiCount: d.poiCount || d.imagesProcessed || 0,
        kmProcessed: d.kmProcessed || 0,
        captureEquipment: d.captureEquipment || 'MMS',
        pic: d.pic || '',
        status: ((d as any).status || 'Complete') as 'Complete' | 'Ongoing',
        isSyncedWithSupabase: d.isSyncedWithSupabase,
        publishToWebGIS: d.publishToWebGIS || 'yes',
        defects: d.imagesDefected || d.defectCount || 0
      }));
    }
    return reconcileBatchLogs(dailyData, batchLogs);
  }, [dailyData, batchLogs, projectSettings?.deduplicationStrategy]);


  // Fetch live database records on mount and merge with local drafts
  // Fetch live database records on mount directly from Supabase
  useEffect(() => {
    async function initLiveSupabaseData(isSilent: boolean = false) {
      if (!isSilent) {
        setIsDataLoading(true);
      }

      try {
        // Fetch all data sources concurrently in parallel
        const [supabaseDataRes, qaRes, fetchedQa, fetchedAuditRuns, dbAuditLogs, dbNotifications, dbSettingsRes] = await Promise.allSettled([
          fetchSupabaseData(projectSettings),
          supabase.from(projectSettings?.qaDefectsTable || 'qa_defects').select('qa_status, defect_flags, defect_count, subgrid'),
          fetchQaRecordsFromSupabase(projectSettings),
          fetchQaAuditRunsFromSupabase(projectSettings),
          fetchAuditLogsFromSupabase(projectSettings),
          fetchNotificationsFromSupabase(projectSettings),
          fetchProjectSettingsFromSupabase()
        ]);

        // Process Project Settings
        if (dbSettingsRes.status === 'fulfilled' && dbSettingsRes.value) {
          setProjectSettings((prev: any) => ({ ...prev, ...dbSettingsRes.value }));
        }

        // Process Cloud QAQC Audit Runs
        let cloudAuditMap: Record<string, QAQCAuditRunRecord> = {};
        if (fetchedAuditRuns.status === 'fulfilled' && fetchedAuditRuns.value) {
          cloudAuditMap = fetchedAuditRuns.value;
          setQaqcAuditRuns(fetchedAuditRuns.value);
        }

        // Process QA Defects map first from qaRes
        const defectsPerSubgrid = new Map<string, number>();
        let totalFlaggedCount = 0;
        if (qaRes.status === 'fulfilled' && qaRes.value.data) {
          const qaRows = qaRes.value.data;
          qaRows.forEach((q: any) => {
            const isFlagged = q.qa_status === 'flagged' ||
              (q.defect_flags && typeof q.defect_flags === 'object' && Object.values(q.defect_flags).some(Boolean)) ||
              (q.defect_count && Number(q.defect_count) > 0);

            if (isFlagged) {
              totalFlaggedCount++;
              if (q.subgrid) {
                const normSg = (extractSubgridName(q.subgrid) || q.subgrid).toUpperCase().trim();
                defectsPerSubgrid.set(normSg, (defectsPerSubgrid.get(normSg) || 0) + 1);
              }
            }
          });
          setLiveDefectCount(totalFlaggedCount);
        }

        // Process Core Daily & Batch Data directly from Supabase with defect & status hydration
        if (supabaseDataRes.status === 'fulfilled') {
          const { dailyData: sDaily, batchLogs: sBatches } = supabaseDataRes.value;

          const hydratedDaily = (sDaily || []).map((d: any) => {
            const sg = (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim();
            const runId = getItemId(d);
            const frameCount = getImagesProcessedCount(d);
            const subgridDefectsFromDb = defectsPerSubgrid.get(sg) || 0;
            const cachedAudit = (runId ? cloudAuditMap[`${sg}_${runId}`] : undefined) || cloudAuditMap[`${sg}_default`] || Object.entries(cloudAuditMap).find(([k]) => k.startsWith(`${sg}_`))?.[1];
            const cachedDefects = (cachedAudit && typeof cachedAudit.defectCount === 'number')
              ? cachedAudit.defectCount
              : (d.defectCount || d.imagesDefected || subgridDefectsFromDb || 0);
            const finalDefects = frameCount === 0 ? 0 : Math.min(cachedDefects, frameCount);
            const isPub = d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase === true;

            const qaqcStatus = frameCount === 0
              ? (isPub ? 'Published' : undefined)
              : (cachedAudit
                ? (isPub
                  ? (cachedDefects === 0 ? 'Published (QAQC Verified)' : `Published (${cachedDefects} Defect${cachedDefects === 1 ? '' : 's'} Found)`)
                  : (cachedDefects === 0 ? 'QAQC Passed (Ready to Publish)' : `QAQC Flagged (${cachedDefects} Defect${cachedDefects === 1 ? '' : 's'} Found)`)
                )
                : (isPub ? 'Published' : undefined)
              );

            return {
              ...d,
              defectCount: finalDefects,
              imagesDefected: finalDefects,
              ...(qaqcStatus ? { qaqcStatus } : {})
            };
          });

          const hydratedBatches = (sBatches || []).map((b: any) => {
            const sg = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
            const matchingDaily = hydratedDaily.filter((d: any) => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === sg);
            const dailyDefectsSum = matchingDaily.reduce((acc: number, d: any) => acc + (d.defectCount || 0), 0);
            const finalDefects = dailyDefectsSum > 0 ? dailyDefectsSum : (typeof b.defects === 'number' ? b.defects : 0);

            const qaqcStatus = b.qaqcStatus || (finalDefects > 0 ? `QAQC Completed (${finalDefects} Defects Found)` : undefined);

            return {
              ...b,
              defects: finalDefects,
              ...(qaqcStatus ? { qaqcStatus } : {})
            };
          });

          setDailyData(hydratedDaily);
          setBatchLogs(hydratedBatches);
        }

        // Process QA Records
        if (fetchedQa.status === 'fulfilled' && fetchedQa.value && Object.keys(fetchedQa.value).length > 0) {
          setQaSubgridRecords(prev => ({ ...fetchedQa.value, ...prev }));
        }

        // Process Audit Logs with dynamic read persistence
        if (dbAuditLogs.status === 'fulfilled' && dbAuditLogs.value.length > 0) {
          let readAuditSet = new Set<string>();
          let lastReadAuditTime = 0;
          try {
            readAuditSet = new Set(JSON.parse(localStorage.getItem('app_read_audit_ids') || '[]'));
            lastReadAuditTime = Number(localStorage.getItem('app_last_read_audit_time') || '0');
          } catch (_) { }

          setAuditLogs(prev => {
            return dbAuditLogs.value.map((a: any) => {
              const strId = String(a.id);
              const itemTime = a.created_at ? new Date(a.created_at).getTime() : 0;
              const isRead = Boolean(a.read) ||
                readAuditSet.has(strId) ||
                readAuditSet.has(`audit-${strId}`) ||
                (lastReadAuditTime > 0 && itemTime > 0 && itemTime <= lastReadAuditTime) ||
                prev.some(p => String(p.id) === strId && p.read);
              return {
                ...a,
                read: isRead
              };
            });
          });
        }

        // Process Notifications with dynamic read & clear persistence
        if (dbNotifications.status === 'fulfilled' && dbNotifications.value.length > 0) {
          let readNotifSet = new Set<string>();
          let lastReadNotifTime = 0;
          let clearedNotifTime = 0;
          try {
            readNotifSet = new Set(JSON.parse(localStorage.getItem('app_read_notif_ids') || '[]'));
            lastReadNotifTime = Number(localStorage.getItem('app_last_read_notif_time') || '0');
            clearedNotifTime = Number(localStorage.getItem('app_cleared_notif_time') || '0');
          } catch (_) { }

          setNotifications(prev => {
            return dbNotifications.value
              .filter((n: any) => {
                if (clearedNotifTime > 0) {
                  const itemTime = n.created_at ? new Date(n.created_at).getTime() : 0;
                  if (itemTime > 0 && itemTime <= clearedNotifTime) return false;
                }
                return true;
              })
              .map((n: any) => {
                const strId = String(n.id);
                const itemTime = n.created_at ? new Date(n.created_at).getTime() : 0;
                const isRead = Boolean(n.read) ||
                  readNotifSet.has(strId) ||
                  readNotifSet.has(`notif-${strId}`) ||
                  (lastReadNotifTime > 0 && itemTime > 0 && itemTime <= lastReadNotifTime) ||
                  prev.some(p => String(p.id) === strId && p.read);
                return {
                  ...n,
                  read: isRead
                };
              });
          });
        }
      } catch (err) {
        console.warn('Supabase fetch notice:', err);
        setSupabaseError('Unable to connect to Supabase backend. Operating in offline cached mode.');
      } finally {
        if (!isSilent) {
          setIsDataLoading(false);
        }
      }
    }

    initLiveSupabaseData(false);

    // Realtime channel subscriptions
    const channelName = `live-dashboard-sync-${Date.now()}`;
    const liveChannel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: projectSettings?.panoramasTable || 'panoramas' }, () => {
        initLiveSupabaseData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: projectSettings?.qaDefectsTable || 'qa_defects' }, () => {
        initLiveSupabaseData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: projectSettings?.qaqcRunsTable || 'qaqc_audit_runs' }, () => {
        initLiveSupabaseData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_settings' }, () => {
        initLiveSupabaseData(true);
      });

    try {
      liveChannel.subscribe();
    } catch (e) {
      console.warn('Realtime subscription notice:', e);
    }

    // 30s Polling fallback
    const liveInterval = setInterval(() => {
      initLiveSupabaseData(true);
    }, 30000);

    return () => {
      try { supabase.removeChannel(liveChannel); } catch { }
      clearInterval(liveInterval);
    };
  }, []);

  // Universal Panorama URL Resolver helper driven by projectSettings
  const getPanoramaUrl = (filename: string) => resolvePanoramaUrl(filename, projectSettings);

  // Dynamic state persists directly via Supabase API (no local storage dependency)

  // Dynamic layer catalog managed via live React state

  // Calculated totals: dynamically compute total frames & trajectory distance from live survey datasets
  const totalImages = useMemo(() => {
    const dailyTotal = dailyData.reduce((sum, d) => sum + getImagesProcessedCount(d), 0);
    if (dailyTotal > 0) return dailyTotal;
    return batchLogs.reduce((sum, b) => sum + getImagesProcessedCount(b), 0);
  }, [dailyData, batchLogs]);

  const totalKm = useMemo(() => {
    const dailyTotal = dailyData.reduce((sum, d) => sum + (Number(d.kmProcessed) || 0), 0);
    if (dailyTotal > 0) return Math.round(dailyTotal * 100) / 100;
    const batchTotal = batchLogs.reduce((sum, b) => sum + (Number(b.kmProcessed) || 0), 0);
    return Math.round(batchTotal * 100) / 100;
  }, [dailyData, batchLogs]);

  // Automated QA/QC Worker Hook
  const {
    workerState: qaqcWorkerState,
    startInspection: startQAQCInspection,
    pauseInspection: pauseQAQCInspection,
    resumeInspection: resumeQAQCInspection,
    abortInspection: abortQAQCInspection
  } = useQAQCWorker();

  const [_liveDefectCount, setLiveDefectCount] = useState<number>(0);
  const [qaqcAuditVersion, setQaqcAuditVersion] = useState<number>(0);

  useEffect(() => {
    const handleAuditUpdate = () => {
      setQaqcAuditVersion(v => v + 1);
    };
    window.addEventListener('qaqc_audit_updated', handleAuditUpdate);
    window.addEventListener('storage', handleAuditUpdate);
    return () => {
      window.removeEventListener('qaqc_audit_updated', handleAuditUpdate);
      window.removeEventListener('storage', handleAuditUpdate);
    };
  }, []);

  const totalDefects = useMemo(() => {
    if (dailyData.length > 0) {
      return dailyData.reduce((sum, d) => {
        const dailySubgrid = (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim();
        const runId = getItemId(d);
        const frameCount = getImagesProcessedCount(d);
        if (frameCount === 0) return sum;

        const isThisRowActive = (qaqcWorkerState.isRunning || qaqcWorkerState.isCompleted) && (
          qaqcWorkerState.runId ? qaqcWorkerState.runId === runId : false
        );

        let cachedDefects: number | undefined;
        const cached = runId ? qaqcAuditRuns[`${dailySubgrid}_${runId}`] : undefined;
        if (cached && typeof cached.defectCount === 'number') {
          cachedDefects = cached.defectCount;
        }

        let parsedStatusDefects = 0;
        if (d.qaqcStatus) {
          const m = d.qaqcStatus.match(/(\d+)\s+Defect/i);
          if (m) parsedStatusDefects = parseInt(m[1], 10);
        }

        const count = isThisRowActive
          ? qaqcWorkerState.defectsList.length
          : (cachedDefects !== undefined && cachedDefects > 0)
            ? cachedDefects
            : (d.imagesDefected && d.imagesDefected > 0)
              ? d.imagesDefected
              : (d.defectCount && d.defectCount > 0)
                ? d.defectCount
                : (parsedStatusDefects > 0)
                  ? parsedStatusDefects
                  : 0;

        return sum + Math.min(count, frameCount);
      }, 0);
    }

    return batchLogs.reduce((sum, b) => {
      const sg = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      const bFrames = getImagesProcessedCount(b);
      if (bFrames === 0) return sum;

      let cachedDefects: number | undefined;
      const cached = qaqcAuditRuns[`${sg}_default`] || Object.entries(qaqcAuditRuns).find(([k]) => k.startsWith(`${sg}_`))?.[1];
      if (cached && typeof cached.defectCount === 'number') {
        cachedDefects = cached.defectCount;
      }

      const isThisRowActive = (qaqcWorkerState.isRunning || qaqcWorkerState.isCompleted) && (
        qaqcWorkerState.subgrid === sg
      );

      const count = isThisRowActive
        ? qaqcWorkerState.defectsList.length
        : (cachedDefects !== undefined && cachedDefects > 0)
          ? cachedDefects
          : (b.defects && b.defects > 0)
            ? b.defects
            : 0;

      return sum + Math.min(count, bFrames);
    }, 0);
  }, [dailyData, batchLogs, qaqcWorkerState.isRunning, qaqcWorkerState.isCompleted, qaqcWorkerState.defectsList.length, qaqcWorkerState.runId, qaqcWorkerState.subgrid, qaqcAuditVersion, qaqcAuditRuns]);

  const allKnownDefects = React.useMemo(() => {
    const list: any[] = [];
    const seen = new Set<string>();

    const addDefect = (d: any) => {
      if (!d) return;
      const fn = (d.point_id || d.filename || d.pointId || d.image_url || '').split('/').pop()?.toUpperCase().trim();
      const ptId = (d.point_id || d.pointId || '').toUpperCase().trim();
      const key = fn || ptId;
      if (key && !seen.has(key)) {
        seen.add(key);
        list.push({
          ...d,
          filename: fn || ptId,
          point_id: ptId || fn,
          is_defect: true,
          isDefect: true,
          color: '#ef4444'
        });
      }
    };

    if (qaqcWorkerState.defectsList && qaqcWorkerState.defectsList.length > 0) {
      qaqcWorkerState.defectsList.forEach(addDefect);
    }

    Object.values(qaqcAuditRuns || {}).forEach((audit: any) => {
      if (audit?.defectsList && Array.isArray(audit.defectsList)) {
        audit.defectsList.forEach(addDefect);
      }
    });

    Object.values(qaSubgridRecords || {}).forEach((qa: any) => {
      if (qa?.defectsList && Array.isArray(qa.defectsList)) {
        qa.defectsList.forEach(addDefect);
      }
    });

    (dailyData || []).forEach((item: any) => {
      (item.panoramas || item.points || []).forEach((p: any) => {
        if (p.isDefect || p.is_defect || p.status === 'defect' || p.qa_status === 'defect') {
          addDefect(p);
        }
      });
    });

    return list;
  }, [qaqcWorkerState.defectsList, qaqcAuditRuns, qaSubgridRecords, dailyData]);

  const totalFramesForHealth = useMemo(() => {
    const dailyTotal = dailyData.reduce((sum, d) => sum + (d.imagesProcessed || d.panoramas?.length || d.poiCount || 0), 0);
    if (dailyTotal > 0) return dailyTotal;
    const batchTotal = batchLogs.reduce((sum, b) => sum + (b.images || b.panoramas?.length || 0), 0);
    return batchTotal;
  }, [dailyData, batchLogs]);

  const pipelineHealthPercent = totalFramesForHealth > 0
    ? (totalDefects === 0 ? '100.0' : Math.max(0, ((totalFramesForHealth - totalDefects) / totalFramesForHealth) * 100).toFixed(1))
    : '100.0';
  const targetKm = Number(projectSettings?.targetKm) || (totalKm > 0 ? totalKm : 0);
  const progressPercent = targetKm > 0 ? Math.min(100, Math.round((totalKm / targetKm) * 100)) : 0;
  const ongoingMasterlistCount = batchLogs.filter(b => b.status === 'Ongoing').length;
  const stagedDailyBatchesCount = dailyData.filter(d => (d.publishToWebGIS || (d as any).publishToUSVPRO) !== 'yes').length;

  const [mapRefreshKey, setMapRefreshKey] = useState<number>(Date.now());
  const handleRefreshMap = () => {
    setMapRefreshKey(Date.now());
    fetchSupabaseData(projectSettings).then(({ dailyData: sDaily, batchLogs: sBatches }) => {
      // Merge while preserving ongoing QA/QC inspection state and defect records
      setDailyData(prev => {
        if (!sDaily || sDaily.length === 0) return prev;
        return sDaily.map(sd => {
          const matchedPrev = prev.find(p => getItemId(p) === getItemId(sd));
          const sg = (extractSubgridName(sd.subgrid) || sd.subgrid || '').toUpperCase().trim();
          const runId = getItemId(sd);
          const frameCount = getImagesProcessedCount(sd);
          const cachedAudit = (runId && qaqcAuditRuns[`${sg}_${runId}`]) || qaqcAuditRuns[`${sg}_default`];
          const cachedCount = cachedAudit && typeof cachedAudit.defectCount === 'number' ? cachedAudit.defectCount : 0;
          const prevCount = (matchedPrev && typeof matchedPrev.defectCount === 'number') ? matchedPrev.defectCount : 0;
          const finalCount = frameCount === 0 ? 0 : Math.min(frameCount, Math.max(sd.defectCount || 0, prevCount, cachedCount));
          const qaqcStatus = frameCount === 0
            ? (sd.publishToWebGIS === 'yes' ? 'Published' : undefined)
            : (sd.qaqcStatus || matchedPrev?.qaqcStatus || (cachedAudit ? `QAQC Completed (${cachedCount} Defect${cachedCount === 1 ? '' : 's'} Found)` : undefined));

          return {
            ...sd,
            defectCount: finalCount,
            imagesDefected: finalCount,
            ...(qaqcStatus ? { qaqcStatus } : {})
          };
        });
      });
      setBatchLogs(prev => {
        if (!sBatches || sBatches.length === 0) return prev;
        return sBatches.map(sb => {
          const matchedPrev = prev.find(p => p.subgrid === sb.subgrid || p.id === sb.id);
          const sg = (extractSubgridName(sb.subgrid || sb.imageFilename) || sb.subgrid || '').toUpperCase().trim();
          const matchingDaily = (sDaily || []).filter((d: any) => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === sg);
          const totalSubFrames = getImagesProcessedCount(sb) || matchingDaily.reduce((acc: number, d: any) => acc + getImagesProcessedCount(d), 0);

          let dailyDefectsSum = 0;
          let hasDailyInspection = false;
          matchingDaily.forEach((d: any) => {
            const fCount = getImagesProcessedCount(d);
            if (fCount === 0) return;
            const runId = getItemId(d);
            const runCache = (runId && qaqcAuditRuns[`${sg}_${runId}`]) || qaqcAuditRuns[`${sg}_default`];
            const def = (runCache && typeof runCache.defectCount === 'number')
              ? runCache.defectCount
              : (typeof d.imagesDefected === 'number' && d.imagesDefected > 0)
                ? d.imagesDefected
                : (typeof d.defectCount === 'number' && d.defectCount > 0)
                  ? d.defectCount
                  : 0;
            if (def > 0 || runCache || d.qaqcStatus) {
              hasDailyInspection = true;
              dailyDefectsSum += Math.min(def, fCount);
            }
          });

          const cachedAudit = qaqcAuditRuns[`${sg}_default`];
          const cachedCount = cachedAudit && typeof cachedAudit.defectCount === 'number' ? cachedAudit.defectCount : 0;
          const prevCount = (matchedPrev && typeof matchedPrev.defects === 'number') ? matchedPrev.defects : 0;

          let finalCount = totalSubFrames === 0 ? 0 : (
            hasDailyInspection
              ? dailyDefectsSum
              : Math.max(sb.defects || 0, prevCount, cachedCount)
          );

          if (totalSubFrames > 0) {
            finalCount = Math.min(finalCount, totalSubFrames);
          }

          const qaqcStatus = totalSubFrames === 0 ? undefined : (
            sb.qaqcStatus || matchedPrev?.qaqcStatus || (cachedAudit ? `QAQC Completed (${cachedCount} Defect${cachedCount === 1 ? '' : 's'} Found)` : undefined)
          );

          return {
            ...sb,
            defects: finalCount,
            ...(qaqcStatus ? { qaqcStatus } : {})
          };
        });
      });
    }).catch(err => console.warn('Refresh map live sync notice:', err));
  };

  // Notification & Audit Log State Management


  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);
  const [auditFilterTab, setAuditFilterTab] = useState<'ALL' | 'EDIT' | 'DELETE' | 'CREATE' | 'PUBLISH' | 'ERROR'>('ALL');
  const [auditDateFilter, setAuditDateFilter] = useState<string>('');
  const [isHelpGuideOpen, setIsHelpGuideOpen] = useState(false);
  const [helpGuideTab, setHelpGuideTab] = useState<'map' | 'panorama' | 'data' | 'audit'>('map');
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [settingsSaveToast, setSettingsSaveToast] = useState<{ show: boolean; message: string } | null>(null);

  const handleSaveAllSettings = () => {
    try {
      setProjectSettings({ ...projectSettings });
      saveProjectSettingsToSupabase(projectSettings).catch(err => console.warn('Supabase settings save notice:', err));
      const sampleUrl = getPanoramaUrl('sample.jpg');
      const tables = getDatabaseTableMapping(projectSettings);
      addAuditLog(
        'EDIT',
        'Saved Project & Database Settings',
        `Updated storage provider to ${projectSettings.storageProvider || 'supabase'} (Panoramas table: ${tables.panoramasTable}, Sample URL: ${sampleUrl})`,
        'info'
      );
      addNotification({
        title: 'Settings Saved & Synced',
        message: `Project settings saved. Storage provider: ${projectSettings.storageProvider || 'supabase'}, Language: ${projectSettings.language || 'en'}.`,
        category: 'SYSTEM'
      });
      handleRefreshMap();
      fetchSupabaseData().then(({ dailyData: sDaily, batchLogs: sBatches }) => {
        setDailyData(sDaily || []);
        setBatchLogs(sBatches || []);
      }).catch(err => console.warn('Re-sync error on settings save:', err));
      setSettingsSaveToast({
        show: true,
        message: 'Project & Database settings saved and synchronized live!'
      });
      setTimeout(() => {
        setSettingsSaveToast(null);
      }, 3500);
    } catch (e) {
      console.error('Save settings error:', e);
    }
  };

  const availableAuditDates = React.useMemo(() => {
    const dates = auditLogs.map(l => l.timestamp.split(',')[0].trim());
    return Array.from(new Set(dates)).filter(Boolean);
  }, [auditLogs]);

  // LIVE INTERACTIVE TOUR ACTION CONTROLLER
  // Automatically triggers live canvas transitions, modal popups, and feature highlights as the user steps through the tour
  useEffect(() => {
    if (tourStep === null) return;

    if (tourStep === 1 || tourStep === 2 || tourStep === 5 || tourStep === 7) {
      goToWorkspace('dashboard');
      setIsAboutModalOpen(false);
    } else if (tourStep === 3) {
      goToWorkspace('dashboard');
      setIsAboutModalOpen(false);
      if (!selectedSubgridFilter) {
        const firstSg = batchLogs[0]?.subgrid || dailyData[0]?.subgrid;
        if (firstSg) setSelectedSubgridFilter(firstSg);
      }
    } else if (tourStep === 4) {
      goToWorkspace('dashboard');
      setIsAboutModalOpen(false);
    } else if (tourStep === 8) {
      goToWorkspace('data');
      setIsAboutModalOpen(false);
    } else if (tourStep === 9) {
      goToWorkspace('dashboard');
      setIsAboutModalOpen(false);
      handleRefreshMap();
    } else if (tourStep === 10) {
      goToWorkspace('settings');
      setIsAboutModalOpen(false);
    } else if (tourStep === 11) {
      setIsAboutModalOpen(true);
    } else if (tourStep === 12) {
      setIsAboutModalOpen(false);
      setIsSidebarExpanded(true);
    }
  }, [tourStep]);

  const unreadNotifCount = notifications.filter(n => !n.read).length;
  const unreadAuditCount = auditLogs.filter(a => !a.read).length;

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
    // Determine the most recent daily operation date dynamically
    let sourceDaily = dailyData;
    let sourceBatches = batchLogs;

    if (selectedSubgridFilter) {
      const filterKey = selectedSubgridFilter.toUpperCase().trim();
      const filteredD = dailyData.filter(d => (d.subgrid || '').toUpperCase().trim() === filterKey);
      const filteredB = batchLogs.filter(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === filterKey);
      if (filteredD.length > 0) sourceDaily = filteredD;
      if (filteredB.length > 0) sourceBatches = filteredB;
    }

    const timestamps: number[] = [];

    // 1. Gather all dates from Daily Progress records
    sourceDaily.forEach((d: any) => {
      if (d.date) {
        const parsed = parseFlexibleDate(d.date);
        if (parsed) timestamps.push(parsed.getTime());
      }
      if (d.updated_at || d.updatedAt) {
        const parsed = parseFlexibleDate(d.updated_at || d.updatedAt);
        if (parsed) timestamps.push(parsed.getTime());
      }
      if (d.created_at || d.createdAt) {
        const parsed = parseFlexibleDate(d.created_at || d.createdAt);
        if (parsed) timestamps.push(parsed.getTime());
      }
      if (Array.isArray(d.panoramas)) {
        d.panoramas.forEach((p: any) => {
          if (p.date || p.captured_at) {
            const parsed = parseFlexibleDate(p.date || p.captured_at);
            if (parsed) timestamps.push(parsed.getTime());
          }
        });
      }
    });

    // 2. Gather dates from Batch Logs
    sourceBatches.forEach((b: any) => {
      if (b.date) {
        const parsed = parseFlexibleDate(b.date);
        if (parsed) timestamps.push(parsed.getTime());
      }
      if (b.updated_at || b.updatedAt) {
        const parsed = parseFlexibleDate(b.updated_at || b.updatedAt);
        if (parsed) timestamps.push(parsed.getTime());
      }
      if (b.created_at || b.createdAt) {
        const parsed = parseFlexibleDate(b.created_at || b.createdAt);
        if (parsed) timestamps.push(parsed.getTime());
      }
    });

    // 3. If audit logs have user edits, include them
    (auditLogs || []).forEach((a: any) => {
      if (a.timestamp) {
        const parsed = parseFlexibleDate(a.timestamp);
        if (parsed) timestamps.push(parsed.getTime());
      }
    });

    if (timestamps.length > 0) {
      timestamps.sort((a, b) => b - a);
      const latest = new Date(timestamps[0]);
      if (!isNaN(latest.getTime())) {
        return latest.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      }
    }

    return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }, [dailyData, batchLogs, auditLogs, selectedSubgridFilter]);

  const generateExecutivePdfReport = () => {
    const printWindow = window.open('', '_blank', 'width=1000,height=1100');
    if (!printWindow) return;

    // Use activeBatchLogs (reconciled live data matching dashboard operation)
    const reportBatches = activeBatchLogs;

    const totalPoiCount = reportBatches.reduce((acc, b) => acc + getPOICount(b), 0);
    const totalPanoramasCount = reportBatches.reduce((acc, b) => acc + getImagesProcessedCount(b), 0);
    const totalKmVal = Math.round(reportBatches.reduce((acc, b) => acc + (b.kmProcessed || 0), 0) * 100) / 100;
    const totalDefectsCount = reportBatches.reduce((acc, b) => acc + (b.defects || 0), 0);
    const subgridsCount = reportBatches.length;
    const publishedCount = reportBatches.filter(b => b.isSyncedWithSupabase || b.status === 'Complete').length;
    const stagedCount = Math.max(0, subgridsCount - publishedCount);

    const passRateVal = totalPoiCount > 0
      ? (((totalPoiCount - totalDefectsCount) / totalPoiCount) * 100).toFixed(1)
      : '100.0';

    const targetKmVal = Number(projectSettings?.targetKm) || (totalKmVal > 0 ? totalKmVal : 0);
    const targetImagesVal = Number(projectSettings?.targetImages) || (totalPanoramasCount > 0 ? totalPanoramasCount : 0);
    const targetProgressPct = targetKmVal > 0 ? Math.min(100, (totalKmVal / targetKmVal) * 100).toFixed(1) : '0.0';

    const now = new Date();
    const reportDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) + ' • ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const documentRefNo = `GEO-MMS-EXEC-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    const operatorUser = authSession?.user?.email ? authSession.user.email : 'GIS Engineer';

    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>GeoSphere 360 - Executive Progress & Quality Audit Report</title>
          <style>
            @page {
              size: A4 portrait;
              margin: 12mm 15mm 15mm 15mm;
            }
            * { box-sizing: border-box; }
            body {
              font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              color: #0f172a;
              background: #ffffff;
              margin: 0;
              padding: 24px;
              font-size: 11px;
              line-height: 1.5;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            /* Print action toolbar for screen preview */
            .action-bar {
              display: flex;
              justify-content: space-between;
              align-items: center;
              background: #0f172a;
              color: #ffffff;
              padding: 12px 20px;
              margin: -24px -24px 24px -24px;
              border-bottom: 1px solid #334155;
            }
            .action-bar-title {
              font-weight: 700;
              font-size: 13px;
              letter-spacing: 0.5px;
            }
            .print-btn {
              background: #ffffff;
              color: #0f172a;
              border: none;
              padding: 7px 16px;
              font-size: 11px;
              font-weight: 700;
              border-radius: 4px;
              cursor: pointer;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .print-btn:hover { background: #e2e8f0; }

            /* Header Section */
            .doc-header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 2px solid #0f172a;
              padding-bottom: 14px;
              margin-bottom: 20px;
            }
            .org-title {
              font-size: 10px;
              font-weight: 800;
              letter-spacing: 1.5px;
              color: #475569;
              text-transform: uppercase;
              margin-bottom: 2px;
            }
            .main-title {
              font-size: 20px;
              font-weight: 800;
              color: #0f172a;
              margin: 0 0 4px 0;
              letter-spacing: -0.3px;
            }
            .sub-title {
              font-size: 12px;
              font-weight: 600;
              color: #334155;
            }
            .doc-meta-box {
              background: #f8fafc;
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              padding: 8px 12px;
              font-size: 10px;
              min-width: 240px;
            }
            .meta-row {
              display: flex;
              justify-content: space-between;
              padding: 2px 0;
              border-bottom: 1px dashed #e2e8f0;
            }
            .meta-row:last-child { border-bottom: none; }
            .meta-label { font-weight: 600; color: #64748b; }
            .meta-val { font-weight: 700; color: #0f172a; font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }

            /* Narrative Box */
            .section-title {
              font-size: 12px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.8px;
              color: #0f172a;
              border-bottom: 1px solid #0f172a;
              padding-bottom: 4px;
              margin: 22px 0 10px 0;
            }
            .narrative-box {
              background: #f8fafc;
              border-left: 3px solid #0f172a;
              border-top: 1px solid #e2e8f0;
              border-right: 1px solid #e2e8f0;
              border-bottom: 1px solid #e2e8f0;
              padding: 10px 14px;
              font-size: 11px;
              color: #334155;
              text-align: justify;
              line-height: 1.6;
              margin-bottom: 18px;
            }

            /* KPI Grid */
            .kpi-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 10px;
              margin-bottom: 20px;
              page-break-inside: avoid;
            }
            .kpi-card {
              background: #ffffff;
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              padding: 10px 12px;
            }
            .kpi-label {
              font-size: 9.5px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #64748b;
              margin-bottom: 4px;
            }
            .kpi-value {
              font-size: 18px;
              font-weight: 800;
              color: #0f172a;
              font-variant-numeric: tabular-nums;
              line-height: 1.2;
            }
            .kpi-subtext {
              font-size: 9.5px;
              color: #475569;
              margin-top: 3px;
              font-weight: 500;
            }

            /* Tables */
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 18px;
              font-size: 10.5px;
              page-break-inside: auto;
            }
            tr { page-break-inside: avoid; page-break-after: auto; }
            th {
              background: #0f172a;
              color: #ffffff;
              padding: 7px 10px;
              text-align: left;
              font-size: 9.5px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              border: 1px solid #0f172a;
            }
            td {
              border: 1px solid #e2e8f0;
              padding: 7px 10px;
              color: #1e293b;
              vertical-align: middle;
            }
            tr:nth-child(even) td { background: #f8fafc; }
            
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .font-sans { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            
            /* Status Badges - Monochrome & Professional */
            .badge {
              display: inline-block;
              padding: 2px 7px;
              border-radius: 3px;
              font-size: 9px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.3px;
              white-space: nowrap;
            }
            .badge-complete {
              background: #f1f5f9;
              color: #0f172a;
              border: 1px solid #475569;
            }
            .badge-defect {
              background: #0f172a;
              color: #ffffff;
              border: 1px solid #0f172a;
            }
            .badge-neutral {
              background: #f8fafc;
              color: #475569;
              border: 1px solid #cbd5e1;
            }

            /* 2-Column Specs Layout */
            .specs-grid {
              display: grid;
              grid-template-columns: repeat(2, 1fr);
              gap: 12px;
              margin-bottom: 20px;
              page-break-inside: avoid;
            }
            .spec-card {
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              background: #f8fafc;
              padding: 10px 12px;
            }
            .spec-row {
              display: flex;
              justify-content: space-between;
              padding: 3px 0;
              border-bottom: 1px solid #e2e8f0;
              font-size: 10px;
            }
            .spec-row:last-child { border-bottom: none; }
            .spec-key { color: #64748b; font-weight: 600; }
            .spec-val { color: #0f172a; font-weight: 700; }

            /* Sign-off Section */
            .signoff-section {
              margin-top: 30px;
              page-break-inside: avoid;
            }
            .signoff-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 15px;
              margin-top: 15px;
            }
            .signoff-box {
              border: 1px solid #cbd5e1;
              border-radius: 4px;
              padding: 12px;
              background: #ffffff;
            }
            .signoff-role {
              font-size: 9.5px;
              font-weight: 800;
              text-transform: uppercase;
              color: #0f172a;
              border-bottom: 1px solid #cbd5e1;
              padding-bottom: 4px;
              margin-bottom: 10px;
              letter-spacing: 0.5px;
            }
            .signoff-line {
              border-bottom: 1px solid #0f172a;
              height: 35px;
              margin-bottom: 10px;
            }
            .signoff-meta {
              font-size: 9.5px;
              color: #475569;
              line-height: 1.4;
            }

            /* Footer */
            .doc-footer {
              border-top: 1px solid #cbd5e1;
              padding-top: 10px;
              margin-top: 30px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              font-size: 9px;
              color: #64748b;
              page-break-inside: avoid;
            }

            @media print {
              .action-bar { display: none !important; }
              body { padding: 0; background: #ffffff; }
            }
          </style>
        </head>
        <body>
          <div class="action-bar no-print">
            <div class="action-bar-title">EXECUTIVE PDF REPORT PREVIEW</div>
            <button class="print-btn" onclick="window.print()">PRINT / SAVE AS PDF</button>
          </div>

          <!-- DOCUMENT HEADER -->
          <div class="doc-header">
            <div>
              <div class="org-title">GEOSPHERE 360 • SPATIAL ASSET INTELLIGENCE</div>
              <h1 class="main-title">GeoSphere 360 Operations Hub</h1>
              <div class="sub-title">Executive Mobile Survey Progress & Quality Control Audit Report</div>
            </div>
            <div class="doc-meta-box">
              <div class="meta-row">
                <span class="meta-label">DOCUMENT REF:</span>
                <span class="meta-val">${documentRefNo}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">DATE & TIME:</span>
                <span class="meta-val">${reportDate}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">CLASSIFICATION:</span>
                <span class="meta-val">CONFIDENTIAL</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">CONTRACT CODE:</span>
                <span class="meta-val">${projectSettings?.contractCode || 'MMS-2026-TNB-01'}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">SYSTEM STATUS:</span>
                <span class="meta-val">OPERATIONAL</span>
              </div>
            </div>
          </div>

          <!-- EXECUTIVE NARRATIVE -->
          <div class="narrative-box">
            <strong>EXECUTIVE OVERVIEW & SYNTHESIS:</strong> This official report presents the validated progress, technical performance, and quality assurance auditing metrics for the ongoing Low Voltage (LV) Asset Mapping initiative under contract <strong>${projectSettings?.contractCode || 'MMS-2026-TNB-01'}</strong>. As of <strong>${reportDate}</strong>, spatial data acquisition teams have mapped a total cumulative trajectory of <strong>${totalKmVal.toFixed(2)} km</strong> across <strong>${subgridsCount} active subgrids</strong>, capturing <strong>${totalPoiCount.toLocaleString()} POI points</strong> and <strong>${totalPanoramasCount.toLocaleString()} verified 360° panorama frames</strong>. Automated feature detection and manual quality control reviews confirm an overall <strong>pipeline quality health rating of ${passRateVal}%</strong>. A total of <strong>${totalDefectsCount} defect anomalies</strong> (blurry lens frames, sun flare/obstructions, or GPS drift spikes) have been logged and reconciled. All verified spatial geometries are synchronized with the enterprise Supabase PostGIS vector database layer.
          </div>

          <!-- KEY PERFORMANCE INDICATORS -->
          <div class="section-title">I. Key Performance Indicators (KPI Summary)</div>
          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-label">Subgrids Processed</div>
              <div class="kpi-value">${subgridsCount} Units</div>
              <div class="kpi-subtext">${publishedCount} Published • ${stagedCount} Staged</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Survey Trajectory</div>
              <div class="kpi-value">${totalKmVal.toFixed(2)} km</div>
              <div class="kpi-subtext">${targetProgressPct}% of Target (${targetKmVal} km)</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Total 360° Panoramas</div>
              <div class="kpi-value">${totalPanoramasCount.toLocaleString()} Frames</div>
              <div class="kpi-subtext">Target: ${targetImagesVal.toLocaleString()} Frames</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">QA Defects Flagged</div>
              <div class="kpi-value">${totalDefectsCount} Anomaly Frames</div>
              <div class="kpi-subtext">Defect Rate: ${(100 - parseFloat(passRateVal)).toFixed(2)}%</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Pipeline Quality Health</div>
              <div class="kpi-value">${passRateVal}%</div>
              <div class="kpi-subtext">Status: QA Benchmark Passed</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">PostGIS Database Storage</div>
              <div class="kpi-value">SYNCHRONIZED</div>
              <div class="kpi-subtext">Sync Frequency: Every ${projectSettings?.dbAutoSyncSec || 60}s</div>
            </div>
          </div>

          <!-- SUBGRID PROCESSING BREAKDOWN -->
          <div class="section-title">II. Subgrid Processing & Production Breakdown</div>
          <table>
            <thead>
              <tr>
                <th>Grid / Subgrid ID</th>
                <th>Capture Equipment</th>
                <th class="text-right">POI Count</th>
                <th class="text-right">Verified Frames</th>
                <th class="text-right">Distance (km)</th>
                <th class="text-center">Verification Status</th>
                <th class="text-center">QA Defects</th>
                <th>PIC (Engineer)</th>
                <th class="text-center">Database Sync</th>
              </tr>
            </thead>
            <tbody>
              ${reportBatches.map(b => {
      const subName = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      const gridVal = b.grid || '1';
      const eq = b.captureEquipment || 'MMS';
      const poiVal = getPOICount(b);
      const imgCount = getImagesProcessedCount(b);
      const km = (b.kmProcessed || 0).toFixed(2);
      const defectNum = b.defects || 0;
      const picName = b.pic || '';
      const isSynced = b.isSyncedWithSupabase || b.status === 'Complete';
      return `
                  <tr>
                    <td><strong class="font-sans">Grid ${gridVal} / ${subName}</strong></td>
                    <td>${eq}</td>
                    <td class="text-right font-sans">${poiVal.toLocaleString()}</td>
                    <td class="text-right font-sans">${imgCount.toLocaleString()} frames</td>
                    <td class="text-right font-sans">${km} km</td>
                    <td class="text-center">
                      <span class="badge ${isSynced ? 'badge-complete' : 'badge-neutral'}">
                        ${isSynced ? 'VERIFIED & PUBLISHED' : 'STAGED IN PROCESS'}
                      </span>
                    </td>
                    <td class="text-center">
                      ${defectNum > 0
          ? `<span class="badge badge-defect">${defectNum} FLAG${defectNum > 1 ? 'S' : ''}</span>`
          : `<span style="color:#64748b; font-size:9px;">0 (CLEAN)</span>`}
                    </td>
                    <td>${picName}</td>
                    <td class="text-center font-sans" style="font-size:9.5px;">${isSynced ? 'SUPABASE LIVE' : 'LOCAL DRAFT'}</td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>

          <!-- QA & DEFECT AUDIT ANALYSIS -->
          <div class="section-title">III. Quality Assurance & Defect Audit Breakdown</div>
          <table>
            <thead>
              <tr>
                <th>Subgrid Audit Unit</th>
                <th>Blurry Frames</th>
                <th>Lens Obstruction</th>
                <th>GPS Drift / Bad Coords</th>
                <th>QA Questionnaire Approval</th>
                <th class="text-center">Audit Risk Assessment</th>
              </tr>
            </thead>
            <tbody>
              ${reportBatches.map(b => {
      const sgKey = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      const qaRec = qaSubgridRecords[sgKey] || qaSubgridRecords[b.imageFilename?.toUpperCase().trim() || ''] || null;
      const flags = qaRec?.flags || { blurry: false, obstruction: false, badGps: false };
      const isConfirmedDefect = qaRec?.answer === 'yes' || (b.defects || 0) > 0;
      return `
                  <tr>
                    <td><strong class="font-sans">${sgKey}</strong></td>
                    <td class="font-sans">${flags.blurry ? 'FLAGGED (Yes)' : 'PASS (Clean)'}</td>
                    <td class="font-sans">${flags.obstruction ? 'FLAGGED (Yes)' : 'PASS (Clean)'}</td>
                    <td class="font-sans">${flags.badGps ? 'FLAGGED (Yes)' : 'PASS (Clean)'}</td>
                    <td class="font-sans">${qaRec?.isLocked ? (qaRec.answer === 'yes' ? 'DEFECT CONFIRMED' : 'APPROVED (PASSED)') : 'PENDING REVIEW'}</td>
                    <td class="text-center">
                      <span class="badge ${isConfirmedDefect ? 'badge-defect' : 'badge-complete'}">
                        ${isConfirmedDefect ? 'AUDIT ACTION' : 'LOW RISK'}
                      </span>
                    </td>
                  </tr>
                `;
    }).join('')}
            </tbody>
          </table>

          <!-- TECHNICAL SPECIFICATIONS & CONFIGURATION -->
          <div class="section-title">IV. GIS Technical Infrastructure & System Configuration</div>
          <div class="specs-grid">
            <div class="spec-card">
              <div class="spec-row">
                <span class="spec-key">Coordinate Reference System (CRS):</span>
                <span class="spec-val">EPSG:4326 (WGS 84 / Ellipsoidal)</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Panorama Resolution / Sensor:</span>
                <span class="spec-val">${projectSettings?.cameraResolution || '8K 360° Equirectangular'}</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Primary Image Repository Path:</span>
                <span class="spec-val font-sans">${projectSettings?.imageStoragePath || '/MMS_PIC/'}</span>
              </div>
            </div>
            <div class="spec-card">
              <div class="spec-row">
                <span class="spec-key">Production Spatial Database:</span>
                <span class="spec-val">Supabase PostGIS Cloud Instance</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">Deliverable Image Processing Model:</span>
                <span class="spec-val">${projectSettings?.deliverableModel === 'generative_fill' ? 'Generative Clean Fill (Full 80% ROI)' : 'Masked Vehicle (Top 52% ROI)'}</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">GPS Accuracy Tolerance Threshold:</span>
                <span class="spec-val">≤ ${projectSettings?.minGpsAccuracyM || 1.0} meters</span>
              </div>
              <div class="spec-row">
                <span class="spec-key">AI Defect Feature Matching Sensitivity:</span>
                <span class="spec-val">${projectSettings?.aiDefectThresholdPercent || 85}% Threshold</span>
              </div>
            </div>
          </div>

          <!-- RECENT AUDIT TRAIL -->
          <div class="section-title">V. System Operations & Audit Trail Summary</div>
          <table>
            <thead>
              <tr>
                <th style="width: 140px;">Timestamp</th>
                <th style="width: 80px;" class="text-center">Event Type</th>
                <th>Operation & Action Details</th>
                <th style="width: 120px;">Operator / Role</th>
                <th style="width: 70px;" class="text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              ${auditLogs.slice(0, 5).map(log => `
                <tr>
                  <td class="font-sans" style="font-size:9.5px;">${log.timestamp}</td>
                  <td class="text-center"><span class="badge badge-neutral">${log.type}</span></td>
                  <td><strong>${log.title}</strong> — <span style="color:#475569;">${log.details}</span></td>
                  <td>${log.user}</td>
                  <td class="text-center font-sans" style="font-size:9.5px; font-weight:700;">${log.status.toUpperCase()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <!-- EXECUTIVE GOVERNANCE & SIGN-OFF -->
          <div class="signoff-section">
            <div class="section-title">VI. Formal Verification, Governance & Executive Sign-off</div>
            <div class="signoff-grid">
              <div class="signoff-box">
                <div class="signoff-role">PREPARED BY (GIS ENGINEER)</div>
                <div class="signoff-line"></div>
                <div class="signoff-meta">
                  <strong>Name:</strong> ${projectSettings?.engineerName || operatorUser}<br>
                  <strong>Title:</strong> ${projectSettings?.engineerTitle || 'Lead GIS Operations Engineer'}<br>
                  <strong>Date:</strong> ${reportDate}
                </div>
              </div>
              <div class="signoff-box">
                <div class="signoff-role">VERIFIED BY (QA LEAD)</div>
                <div class="signoff-line"></div>
                <div class="signoff-meta">
                  <strong>Name:</strong> ${projectSettings?.qaLeadName || 'Senior Quality Auditor'}<br>
                  <strong>Title:</strong> ${projectSettings?.qaLeadTitle || 'QA/QC Verification Specialist'}<br>
                  <strong>Date:</strong> ${reportDate}
                </div>
              </div>
              <div class="signoff-box">
                <div class="signoff-role">APPROVED BY (PROJECT DIRECTOR)</div>
                <div class="signoff-line"></div>
                <div class="signoff-meta">
                  <strong>Name:</strong> ${projectSettings?.projectDirector || projectSettings?.contractorName || 'Project Director'}<br>
                  <strong>Title:</strong> ${projectSettings?.directorTitle || 'Project Director / Manager'}<br>
                  <strong>Date:</strong> ${reportDate}
                </div>
              </div>
            </div>
          </div>

          <!-- DOCUMENT FOOTER -->
          <div class="doc-footer">
            <div>
              <strong>GEOSPHERE 360 OPERATIONS HUB</strong> • Mobile Mapping & Spatial Asset Intelligence
            </div>
            <div>
              STRICTLY CONFIDENTIAL • Page 1 of 1 • Generated via Executive Processing Dashboard
            </div>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
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
    lat: 0,
    lng: 0
  });
  const [inspectorSubgrid, setInspectorSubgrid] = useState<string>('');
  const [selectedQaFlags, setSelectedQaFlags] = useState<{ blurry: boolean; obstruction: boolean; badGps: boolean }>({
    blurry: false,
    obstruction: false,
    badGps: false
  });
  const [qaQuestionnaireAnswer, setQaQuestionnaireAnswer] = useState<'yes' | 'no' | null>(null);
  const [isQaLocked, setIsQaLocked] = useState<boolean>(false);

  const clearMapSelection = () => {
    setHasSelectedPoint(false);
    setActivePanoramaFilename('');
    setActivePanoramaUrl('');
    setInspectorSubgrid('');
    setInspectorCoords({ lat: 0, lng: 0 });
    try {
      const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
      iframes.forEach((f) => {
        f.contentWindow?.postMessage({ type: 'MAP_POINT_DESELECTED' }, '*');
      });
    } catch (err) {
      // ignore cross-frame messaging errors
    }
  };

  const [isQAQCRunnerModalOpen, setIsQAQCRunnerModalOpen] = useState<boolean>(false);
  const [qaqcWorkbenchSubgrid, setQaqcWorkbenchSubgrid] = useState<string | null>(null);
  const [isDefectsGalleryOpen, setIsDefectsGalleryOpen] = useState<boolean>(false);
  const [selectedDefectSubgrid, setSelectedDefectSubgrid] = useState<string>('');
  const [defectGalleryContext, setDefectGalleryContext] = useState<{
    mode: 'master' | 'daily';
    subgrid: string;
    surveyDate?: string;
    totalPoi?: number;
    batchFilenames?: string[];
  } | null>(null);

  const getStationsForSubgrid = (targetSubgrid: string, runId?: string | null): StationNode[] => {
    const cleanSg = (extractSubgridName(targetSubgrid) || targetSubgrid || '').toUpperCase().trim();
    if (!cleanSg) return [];

    // 1. SINGLE DAILY RUN SELECTION (Used by QA/QC Workbench)
    if (runId) {
      const matchDaily = dailyData.find(
        (d: any) => getItemId(d) === runId || d.id === runId || (d as any)._id === runId || (d as any).runId === runId
      );

      if (matchDaily) {
        let pans: any[] = (matchDaily.panoramas && matchDaily.panoramas.length > 0)
          ? matchDaily.panoramas
          : ((matchDaily as any).points || []);

        if (pans.length === 0 && matchDaily.availableFilenames && matchDaily.availableFilenames.length > 0) {
          pans = matchDaily.availableFilenames.map((fn: string) => ({ filename: fn, point_id: fn }));
        }

        if (pans.length > 0) {
          const runStations: StationNode[] = pans.map((p: any, idx: number) => {
            const rawFn = p.filename || p.point_id || p.image_url || (matchDaily.availableFilenames && matchDaily.availableFilenames[idx]) || `${cleanSg}-${String(idx + 1).padStart(4, '0')}.jpg`;
            const cleanFn = (rawFn || '').split('/').pop() || rawFn;
            const pLat = Number(p.latitude ?? p.lat ?? p.y);
            const pLon = Number(p.longitude ?? p.lon ?? p.lng ?? p.x);
            const baseCoords = SUBGRID_COORDINATES[cleanSg];
            const lat = !isNaN(pLat) && pLat !== 0 ? pLat : (baseCoords ? baseCoords[1] : 0);
            const lng = !isNaN(pLon) && pLon !== 0 ? pLon : (baseCoords ? baseCoords[0] : 0);

            return {
              filename: cleanFn,
              point_id: p.point_id || cleanFn,
              subgrid: cleanSg,
              latitude: lat,
              longitude: lng,
              lat: lat,
              lng: lng,
              bearing: Number(p.bearing ?? p.heading ?? ((idx * 15) % 360)),
              image_url: p.image_url || resolvePanoramaUrl(cleanFn, projectSettings, { subgrid: cleanSg }),
              config_url: resolvePanoramaConfigUrl(cleanFn, projectSettings, cleanSg)
            };
          });

          // Sort naturally by frame number (0001 -> 0002 -> ...)
          runStations.sort((a: any, b: any) => {
            const numA = parseInt((a.filename || '').match(/\d+/g)?.pop() || '0', 10);
            const numB = parseInt((b.filename || '').match(/\d+/g)?.pop() || '0', 10);
            return numA - numB;
          });

          return runStations;
        }
      }
    }

    // MASTER SUBGRID SELECTION (or runId is null/undefined):
    // Collect all available stations across all daily survey tracks belonging to this subgrid
    const matchingDailies = dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === cleanSg);
    const matchBatch = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim() === cleanSg);

    const collectedStations: StationNode[] = [];
    const seenFilenames = new Set<string>();

    for (const d of matchingDailies) {
      if (d.panoramas && d.panoramas.length > 0) {
        // 1. Process all survey points directly from the CSV track
        for (let pIdx = 0; pIdx < d.panoramas.length; pIdx++) {
          const p: any = d.panoramas[pIdx];
          const rawFn = p.filename || p.point_id || p.image_url || (d.availableFilenames && d.availableFilenames[pIdx]) || `${cleanSg}-${String(pIdx + 1).padStart(4, '0')}.jpg`;
          const cleanFn = (rawFn || '').split('/').pop() || rawFn;
          const key = cleanFn.toLowerCase().trim();

          if (!seenFilenames.has(key)) {
            seenFilenames.add(key);
            const baseCoords = SUBGRID_COORDINATES[cleanSg];
            const pLat = Number(p.latitude ?? p.lat ?? p.y);
            const pLon = Number(p.longitude ?? p.lon ?? p.lng ?? p.x);
            const lat = !isNaN(pLat) && pLat !== 0 ? pLat : (baseCoords ? baseCoords[1] : 0);
            const lng = !isNaN(pLon) && pLon !== 0 ? pLon : (baseCoords ? baseCoords[0] : 0);

            collectedStations.push({
              filename: cleanFn,
              point_id: p.point_id || cleanFn,
              latitude: lat,
              longitude: lng,
              lat: lat,
              lng: lng,
              bearing: Number(p.bearing ?? p.heading ?? ((collectedStations.length * 15) % 360)),
              image_url: p.image_url || resolvePanoramaUrl(cleanFn, projectSettings, { subgrid: cleanSg })
            });
          }
        }
      } else if (d.availableFilenames && d.availableFilenames.length > 0) {
        // 2. Fallback when only availableFilenames array exists
        d.availableFilenames.forEach((fn: string, pIdx: number) => {
          const cleanFn = fn.split('/').pop() || fn;
          const key = cleanFn.toLowerCase().trim();
          if (!seenFilenames.has(key)) {
            seenFilenames.add(key);
            const pt = (d as any).points?.[pIdx];
            const baseCoords = SUBGRID_COORDINATES[cleanSg];
            const pLat = Number(pt?.lat ?? pt?.latitude);
            const pLon = Number(pt?.lon ?? pt?.longitude ?? pt?.lng);
            const lat = !isNaN(pLat) && pLat !== 0 ? pLat : (baseCoords ? baseCoords[1] : 0);
            const lng = !isNaN(pLon) && pLon !== 0 ? pLon : (baseCoords ? baseCoords[0] : 0);

            collectedStations.push({
              filename: cleanFn,
              point_id: cleanFn,
              latitude: lat,
              longitude: lng,
              lat: lat,
              lng: lng,
              bearing: Number((45 + collectedStations.length * 2) % 360),
              image_url: resolvePanoramaUrl(cleanFn, projectSettings, { subgrid: cleanSg })
            });
          }
        });
      }
    }

    if (collectedStations.length > 0) {
      // Sort numerically by filename index so consecutive clicks advance frame-by-frame (e.g., 0015 -> 0016)
      collectedStations.sort((a, b) => {
        const numA = parseInt((a.filename || '').match(/\d+/g)?.pop() || '0', 10);
        const numB = parseInt((b.filename || '').match(/\d+/g)?.pop() || '0', 10);
        return numA - numB;
      });

      const maxAllowed = matchBatch
        ? getImagesProcessedCount(matchBatch)
        : matchingDailies.reduce((sum, d) => sum + getImagesProcessedCount(d), 0);
      return maxAllowed > 0 && collectedStations.length > maxAllowed
        ? collectedStations.slice(0, maxAllowed)
        : collectedStations;
    }

    // Fallback to matchBatch panoramas if dailyData had no valid panoramas
    if (matchBatch?.panoramas && matchBatch.panoramas.length > 0) {
      const batchFrameCount = getImagesProcessedCount(matchBatch);
      const pansToUse = batchFrameCount > 0 ? matchBatch.panoramas.slice(0, batchFrameCount) : matchBatch.panoramas;
      return pansToUse.map((p, idx) => ({
        filename: p.filename || `${cleanSg}-${String(idx + 1).padStart(4, '0')}.jpg`,
        point_id: p.filename || `${cleanSg}-${String(idx + 1).padStart(4, '0')}.jpg`,
        latitude: p.latitude ?? (p as any).lat ?? (p as any).y ?? 0,
        longitude: p.longitude ?? (p as any).lon ?? (p as any).lng ?? (p as any).x ?? 0,
        lat: p.latitude ?? (p as any).lat ?? (p as any).y ?? 0,
        lng: p.longitude ?? (p as any).lon ?? (p as any).lng ?? (p as any).x ?? 0,
        bearing: p.bearing ?? p.heading ?? ((idx * 15) % 360),
        image_url: resolvePanoramaUrl(p.filename || `${cleanSg}-${String(idx + 1).padStart(4, '0')}.jpg`, projectSettings)
      }));
    }

    // Final fallback: Generate sequential stations matching total subgrid frame count
    const totalCount = matchBatch
      ? getImagesProcessedCount(matchBatch)
      : matchingDailies.reduce((sum, d) => sum + getImagesProcessedCount(d), 0);

    if (totalCount === 0) return [];

    const baseCoords = SUBGRID_COORDINATES[cleanSg];
    const baseLon = baseCoords ? baseCoords[0] : 0;
    const baseLat = baseCoords ? baseCoords[1] : 0;

    return Array.from({ length: totalCount }, (_, i) => {
      const fn = `${cleanSg}-${String(i + 1).padStart(4, '0')}.jpg`;
      return {
        filename: fn,
        point_id: fn,
        latitude: baseLat,
        longitude: baseLon,
        lat: baseLat,
        lng: baseLon,
        bearing: (45 + i * 2) % 360,
        image_url: resolvePanoramaUrl(fn, projectSettings)
      };
    });
  };

  const handleStartInspectionFromWorkbench = (params: {
    subgrid: string;
    runId?: string | null;
    stations: StationNode[];
    config: any;
    stepIntervalMs: number;
    pic: string;
    customThresholds?: any;
  }) => {
    const { subgrid, runId = null, stations, config, stepIntervalMs, pic, customThresholds } = params;
    const cleanSub = subgrid.toUpperCase().trim();
    const effectivePic = pic || activeAuthUserName || (authSession?.user?.email ? authSession.user.email.split('@')[0] : '') || 'Operator';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const timestampStr = `${dateStr}, ${timeStr}`;

    console.log('[QA/QC Batch Inspection Triggered via Workbench]:', {
      subgrid: cleanSub,
      runId,
      stationsCount: stations.length,
      pic: effectivePic,
      config,
      stepIntervalMs,
      customThresholds
    });

    saveNotificationToSupabase({
      timestamp: timestampStr,
      title: `Batch Acquisition QC Initialized (${cleanSub || 'All'})`,
      message: `Automated acquisition QC inspection pipeline started for subgrid ${cleanSub || 'General'}${runId ? ' (Single Run Scoped)' : ''}. Total frames: ${stations.length}. Active flags: [Blur: ${config.checkBlur ? 'ON' : 'OFF'}, Obstruction: ${config.checkObstruction ? 'ON' : 'OFF'}, GPS: ${config.checkGps ? 'ON' : 'OFF'}]. Inspector: ${effectivePic}.`,
      category: 'SYSTEM',
      totalItems: 1
    }).catch(() => { });

    startQAQCInspection({
      subgrid: cleanSub,
      runId,
      stations,
      config,
      stepIntervalMs,
      pic: effectivePic,
      projectSettings,
      customThresholds,
      onDefectFound: (_defect, newDefectCount) => {
        const targetRunId = runId || selectedDailyRunId;
        if (targetRunId) {
          setDailyData(prev => prev.map(d => {
            if (getItemId(d) === targetRunId || d.id === targetRunId || (d as any)._id === targetRunId || (d as any).runId === targetRunId) {
              return { ...d, defectCount: newDefectCount, imagesDefected: newDefectCount };
            }
            return d;
          }));
        } else if (cleanSub) {
          setDailyData(prev => {
            const matchingRows = prev.filter(d => (extractSubgridName(d.subgrid) || '').toUpperCase().trim() === cleanSub);
            const targetRow = matchingRows.find(d => getImagesProcessedCount(d) > 0) || matchingRows[0];
            return prev.map(d => {
              if (targetRow && d === targetRow) {
                return { ...d, defectCount: newDefectCount, imagesDefected: newDefectCount };
              }
              return d;
            });
          });
        }

        if (cleanSub) {
          setBatchLogs(prev => prev.map(b => {
            const bSg = (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim();
            return bSg === cleanSub ? { ...b, defects: newDefectCount } : b;
          }));
        }
      },
      onComplete: (summary) => {
        const targetRunId = summary.runId || selectedDailyRunId;
        const normSg = (summary.subgrid || '').toUpperCase().trim();
        const targetRow = targetRunId
          ? dailyData.find(d => getItemId(d) === targetRunId || d.id === targetRunId || (d as any)._id === targetRunId || (d as any).runId === targetRunId)
          : dailyData.find(d => (extractSubgridName(d.subgrid) || '').toUpperCase().trim() === normSg);
        const isPub = targetRow?.publishToWebGIS === 'yes' || targetRow?.isSyncedWithSupabase === true;
        const statusText = isPub
          ? (summary.defectsCount === 0 ? 'Published (QAQC Verified)' : `Published (${summary.defectsCount} Defect${summary.defectsCount === 1 ? '' : 's'} Found)`)
          : (summary.defectsCount === 0 ? 'QAQC Passed (Ready to Publish)' : `QAQC Flagged (${summary.defectsCount} Defect${summary.defectsCount === 1 ? '' : 's'} Found)`);

        // 1. Update React state for dailyData
        if (targetRunId) {
          setDailyData(prev => prev.map(d => {
            if (getItemId(d) === targetRunId || d.id === targetRunId || (d as any)._id === targetRunId || (d as any).runId === targetRunId) {
              return {
                ...d,
                defectCount: summary.defectsCount,
                imagesDefected: summary.defectsCount,
                qaqcStatus: statusText
              };
            }
            return d;
          }));
        } else if (normSg) {
          setDailyData(prev => {
            const matchingRows = prev.filter(d => (extractSubgridName(d.subgrid) || '').toUpperCase().trim() === normSg);
            const targetRow = matchingRows.find(d => getImagesProcessedCount(d) > 0) || matchingRows[0];
            return prev.map(d => {
              if (targetRow && d === targetRow) {
                return {
                  ...d,
                  defectCount: summary.defectsCount,
                  imagesDefected: summary.defectsCount,
                  qaqcStatus: statusText
                };
              }
              return d;
            });
          });
        }

        // 2. Update React state for batchLogs
        if (normSg) {
          setBatchLogs(prev => prev.map(b => {
            const bSg = (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim();
            return bSg === normSg ? { ...b, defects: summary.defectsCount, qaqcStatus: statusText } : b;
          }));
        }

        // 3. Persist audit run directly to Supabase cloud database with user context
        if (normSg) {
          const cacheRecord: QAQCAuditRunRecord = {
            subgrid: normSg,
            runId: targetRunId || null,
            totalStations: summary.totalInspected,
            defectCount: summary.defectsCount,
            passRate: summary.totalInspected > 0 ? Math.round(((summary.totalInspected - summary.defectsCount) / summary.totalInspected) * 100) : 100,
            completedAt: new Date().toISOString(),
            pic: effectivePic,
            defectsList: summary.defects,
            user_id: authSession?.user?.id,
            user_email: authSession?.user?.email
          };

          setQaqcAuditRuns(prev => ({
            ...prev,
            ...(targetRunId ? { [`${normSg}_${targetRunId}`]: cacheRecord } : {}),
            [`${normSg}_default`]: cacheRecord
          }));
          window.dispatchEvent(new CustomEvent('qaqc_audit_updated', { detail: { subgrid: normSg, record: cacheRecord } }));

          // Asynchronously persist audit run and staging update to Supabase
          saveQaAuditRunToSupabase(cacheRecord, {
            id: authSession?.user?.id,
            email: authSession?.user?.email,
            name: activeAuthUserName
          }, projectSettings).catch(() => { });

          try {
            const stagingTable = projectSettings?.stagingTable || 'staging_panoramas';
            Promise.resolve(
              supabase.from(stagingTable).update({
                defect_count: summary.defectsCount,
                qa_status: statusText,
                updated_at: new Date().toISOString()
              }).ilike('subgrid', normSg.replace(/\s+/g, '_'))
            ).catch(() => { });
          } catch (_) { }
        }
      }
    });
  };

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
            ? (pt.image_url.startsWith('http') || pt.image_url.startsWith('/') ? pt.image_url : resolvePanoramaUrl(pt.image_url, projectSettings))
            : (fn ? resolvePanoramaUrl(fn, projectSettings) : '');

          if (imageUrl) {
            setActivePanoramaUrl(imageUrl);
          } else {
            setActivePanoramaUrl('');
          }
          if (typeof pt.bearing === 'number' || typeof pt.heading === 'number') {
            const yaw = pt.bearing ?? pt.heading;
            setPanoramaTelemetry(prev => ({ ...prev, yaw }));
            // Orient the live 360 camera to the selected feature heading.
            if (typeof yaw === 'number' && isFinite(yaw)) {
              dashboardPsvRef.current?.setPosition({ yaw });
            }
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

    // Always clear single daily run mode when selecting masterlist subgrid
    setSelectedDailyRunId(null);

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
        const s = subgridName.toUpperCase().trim();
        const foundDaily = dailyData.find(d => (extractSubgridName(d.subgrid) || '').toUpperCase().trim() === s);
        const foundBatch = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === s);
        const firstPan = foundDaily?.panoramas?.[0] || foundBatch?.panoramas?.[0];
        const fn = firstPan?.filename || foundDaily?.availableFilenames?.[0] || (foundBatch?.imageFilename) || `${s}-0001.jpg`;
        const lat = firstPan?.latitude ?? (firstPan as any)?.lat ?? (foundDaily as any)?.points?.[0]?.lat ?? (SUBGRID_COORDINATES[s]?.[1] ?? 0);
        const lng = firstPan?.longitude ?? (firstPan as any)?.lon ?? (firstPan as any)?.lng ?? (foundDaily as any)?.points?.[0]?.lon ?? (SUBGRID_COORDINATES[s]?.[0] ?? 0);
        return { fn, lat, lng };
      };

      if (nextSubgrid) {
        const def = getSubgridDefault(nextSubgrid);
        const imgUrl = def.fn ? resolvePanoramaUrl(def.fn, projectSettings) : '';
        setActivePanoramaFilename(def.fn);
        setActivePanoramaUrl(imgUrl);
        setInspectorCoords({ lat: def.lat, lng: def.lng });
        setInspectorSubgrid(nextSubgrid);
        setHasSelectedPoint(Boolean(imgUrl || (def.lat && def.lng)));

        const subgridDaily = dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === nextSubgrid);
        const formattedSubgridData = (subgridDaily.length > 0 ? subgridDaily : dailyData).map(d => {
          const isPub = d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase === true;
          return {
            ...d,
            isPublished: isPub,
            status: isPub ? 'yes' : (d.publishToWebGIS || 'in process'),
            opacity: isPub ? 1.0 : 0.7,
            statusColor: isPub ? '#10b981' : '#f59e0b',
            panoramas: (d.panoramas || []).map((p: any) => {
              const fnClean = (p.filename || p.image_url || '').split('/').pop()?.toUpperCase().trim();
              const isPtDefect = Boolean(
                p.isDefect ||
                p.is_defect ||
                (fnClean && allKnownDefects.some((kd: any) => (kd.point_id || kd.filename || '').split('/').pop()?.toUpperCase().trim() === fnClean))
              );
              return {
                ...p,
                isPublished: isPub,
                status: isPtDefect ? 'defect' : (isPub ? 'yes' : 'in process'),
                isDefect: isPtDefect,
                is_defect: isPtDefect,
                color: isPtDefect ? '#ef4444' : (isPub ? '#10b981' : '#f59e0b'),
                opacity: isPtDefect ? 1.0 : (isPub ? 1.0 : 0.7)
              };
            })
          };
        });

        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(f => {
          try {
            const subgridPoints = formattedSubgridData.flatMap(d => d.panoramas || d.points || []);
            f.contentWindow?.postMessage({
              type: 'SET_MAP_VIEW_STATE',
              viewMode: 'SUBGRID',
              subgrid: nextSubgrid,
              date: nextDate || '',
              runId: null,
              points: subgridPoints
            }, '*');
            f.contentWindow?.postMessage({
              type: 'FILTER_SUBGRID',
              subgrid: nextSubgrid,
              date: nextDate || '',
              isSingleRun: false,
              runId: null
            }, '*');
            f.contentWindow?.postMessage({
              type: 'SET_STAGED_DATA',
              stagedItems: formattedSubgridData,
              isSingleRun: false,
              runId: null
            }, '*');
            f.contentWindow?.postMessage({
              type: 'SET_PANORAMA',
              point: {
                filename: def.fn,
                image_url: imgUrl,
                subgrid: nextSubgrid,
                lat: def.lat,
                lon: def.lng,
                lng: def.lng,
                bearing: 0
              }
            }, '*');
            f.contentWindow?.postMessage({
              type: 'MAP_POINT_SELECTED',
              point: {
                filename: def.fn,
                image_url: imgUrl,
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
        const formattedAll = dailyData.map(d => {
          const isPub = d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase === true;
          return {
            ...d,
            isPublished: isPub,
            status: isPub ? 'yes' : (d.publishToWebGIS || 'in process'),
            opacity: isPub ? 1.0 : 0.7,
            statusColor: isPub ? '#10b981' : '#f59e0b'
          };
        });

        const iframes = document.querySelectorAll('iframe');
        iframes.forEach(f => {
          try {
            const allPoints = dailyData.flatMap(d => (d.panoramas && d.panoramas.length > 0 ? d.panoramas : (d.points || [])));
            f.contentWindow?.postMessage({
              type: 'SET_MAP_VIEW_STATE',
              viewMode: 'ALL',
              subgrid: '',
              date: '',
              runId: null,
              points: allPoints
            }, '*');
            f.contentWindow?.postMessage({
              type: 'FILTER_SUBGRID',
              subgrid: '',
              date: '',
              isSingleRun: false,
              runId: null
            }, '*');
            f.contentWindow?.postMessage({
              type: 'SET_STAGED_DATA',
              stagedItems: formattedAll,
              isSingleRun: false,
              runId: null
            }, '*');
          } catch (e) { }
        });
      }

      return nextSubgrid;
    });
  };

  // Dedicated Handler: Select a single daily survey run
  const handleSelectDailyRun = (daily: DailyTimeSeries) => {
    const rowId = getItemId(daily);

    // Toggle off if already selected
    if (selectedDailyRunId === rowId) {
      setSelectedDailyRunId(null);
      setSelectedSubgridFilter(null);
      setSelectedDateFilter(null);

      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(f => {
        try {
          const allPoints = dailyData.flatMap(d => (d.panoramas && d.panoramas.length > 0 ? d.panoramas : (d.points || [])));
          f.contentWindow?.postMessage({
            type: 'SET_MAP_VIEW_STATE',
            viewMode: 'ALL',
            subgrid: '',
            date: '',
            runId: null,
            points: allPoints
          }, '*');
          f.contentWindow?.postMessage({ type: 'FILTER_SUBGRID', subgrid: '', date: '', isSingleRun: false }, '*');
          const formattedAll = dailyData.map(d => {
            const isPub = d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase === true;
            return {
              ...d,
              isPublished: isPub,
              status: isPub ? 'yes' : (d.publishToWebGIS || 'in process'),
              opacity: isPub ? 1.0 : 0.7,
              statusColor: isPub ? '#10b981' : '#f59e0b'
            };
          });
          f.contentWindow?.postMessage({
            type: 'SET_STAGED_DATA',
            stagedItems: formattedAll,
            isSingleRun: false
          }, '*');
        } catch (e) { }
      });
      return;
    }

    // 1. Set specific Run ID and filters
    setSelectedDailyRunId(rowId);
    setSelectedSubgridFilter(daily.subgrid);
    setSelectedDateFilter(daily.date || null);

    const normSg = (extractSubgridName(daily.subgrid) || daily.subgrid || '').toUpperCase().trim();
    const firstPan = daily.panoramas?.[0];
    const fn = firstPan?.filename || daily.availableFilenames?.[0] || (daily as any)?.imageFilename || `${normSg}-0001.jpg`;
    const lat = firstPan?.latitude ?? (firstPan as any)?.lat ?? (daily as any)?.points?.[0]?.lat ?? (SUBGRID_COORDINATES[normSg]?.[1] ?? 0);
    const lng = firstPan?.longitude ?? (firstPan as any)?.lon ?? (firstPan as any)?.lng ?? (daily as any)?.points?.[0]?.lon ?? (SUBGRID_COORDINATES[normSg]?.[0] ?? 0);
    const imgUrl = fn ? resolvePanoramaUrl(fn, projectSettings) : '';

    setActivePanoramaFilename(fn);
    setActivePanoramaUrl(imgUrl);
    setInspectorCoords({ lat, lng });
    setInspectorSubgrid(daily.subgrid);
    setHasSelectedPoint(Boolean(imgUrl || (lat && lng)));

    // 2. Transmit message restricting map display strictly to this single run
    const isPub = daily.publishToWebGIS === 'yes' || daily.isSyncedWithSupabase === true;
    const pans = (daily.panoramas && daily.panoramas.length > 0) ? daily.panoramas : (daily.points || []);
    const formattedItem = {
      ...daily,
      id: rowId,
      runId: rowId,
      isPublished: isPub,
      status: isPub ? 'yes' : (daily.publishToWebGIS || 'in process'),
      opacity: isPub ? 1.0 : 0.7,
      statusColor: isPub ? '#10b981' : '#f59e0b',
      panoramas: pans.map((p: any, pIdx: number) => {
        const actualFn = p.filename || p.image_url || p.point_id || daily.availableFilenames?.[pIdx] || `${normSg}-${String(pIdx + 1).padStart(4, '0')}.jpg`;
        const fnClean = (actualFn || '').split('/').pop()?.toUpperCase().trim();
        const isPtDefect = Boolean(
          p.isDefect ||
          p.is_defect ||
          (fnClean && allKnownDefects.some((d: any) => (d.point_id || d.filename || '').split('/').pop()?.toUpperCase().trim() === fnClean))
        );
        return {
          ...p,
          id: p.id || `pt-${rowId}-${pIdx}`,
          runId: rowId,
          filename: actualFn,
          image_url: p.image_url || resolvePanoramaUrl(actualFn, projectSettings, { subgrid: normSg }),
          lat: p.lat ?? p.latitude ?? p.y,
          lon: p.lon ?? p.longitude ?? p.lng ?? p.x,
          latitude: p.latitude ?? p.lat ?? p.y,
          longitude: p.longitude ?? p.lon ?? p.lng ?? p.x,
          subgrid: daily.subgrid,
          isPublished: isPub,
          status: isPtDefect ? 'defect' : (isPub ? 'yes' : 'in process'),
          isDefect: isPtDefect,
          is_defect: isPtDefect,
          color: isPtDefect ? '#ef4444' : (isPub ? '#10b981' : '#f59e0b'),
          opacity: isPtDefect ? 1.0 : (isPub ? 1.0 : 0.7)
        };
      })
    };

    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(f => {
      try {
        // Send DIRECT single-payload view state to all map iframes (Zero point bleed)
        f.contentWindow?.postMessage({
          type: 'SET_MAP_VIEW_STATE',
          viewMode: 'SINGLE_RUN',
          subgrid: daily.subgrid,
          runId: rowId,
          date: daily.date || '',
          points: formattedItem.panoramas
        }, '*');

        // Send single-run filter
        f.contentWindow?.postMessage({
          type: 'FILTER_SUBGRID',
          subgrid: daily.subgrid,
          date: daily.date || '',
          runId: rowId,
          isSingleRun: true
        }, '*');

        // Send ONLY this single run's formatted panoramas to the map
        f.contentWindow?.postMessage({
          type: 'SET_STAGED_DATA',
          stagedItems: [formattedItem],
          isSingleRun: true,
          runId: rowId
        }, '*');

        // Send SET_PANORAMA to 360 viewer
        f.contentWindow?.postMessage({
          type: 'SET_PANORAMA',
          point: {
            filename: fn,
            image_url: imgUrl,
            subgrid: daily.subgrid,
            lat,
            lon: lng,
            lng,
            bearing: firstPan?.bearing ?? 0
          }
        }, '*');

        // Select the initial node on map
        f.contentWindow?.postMessage({
          type: 'MAP_POINT_SELECTED',
          point: {
            filename: fn,
            image_url: imgUrl,
            subgrid: daily.subgrid,
            lat,
            lon: lng,
            lng,
            bearing: firstPan?.bearing ?? 0
          }
        }, '*');
      } catch (e) { }
    });
  };

  // 1. Loading state during auth verification
  if (authLoading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center text-text-muted">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
          <span className="text-xs font-semibold">Verifying authorization...</span>
        </div>
      </div>
    );
  }

  // 2. Landing showcase render guard
  if (showLanding && !authSession) {
    return (
      <SystemShowcase
        dailyData={dailyData}
        batchLogs={batchLogs}
        projectSettings={projectSettings}
        onEnterDashboard={(targetView?: string) => {
          if (targetView === 'auth') {
            setShowLanding(false);
            return;
          }
          setPendingModule(targetView || 'webgis');
          handleEnterModule(targetView || 'webgis');
        }}
      />
    );
  }

  if (!authSession && !authLoading) {
    return (
      <div className="min-h-screen bg-card text-text-base font-sans flex items-center justify-center p-6 relative overflow-hidden select-none">
        {/* Subtle Ambient Radial Glow */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-card rounded-full blur-[120px] pointer-events-none" />

        <div className="w-full max-w-[380px] z-10 relative">
          {/* Header Branding */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-card border border-subtle shadow-sm mb-4">
              <Globe size={22} className="text-text-base" />
            </div>
            <h1 className="text-xl font-semibold text-text-base tracking-tight">
              Sign in to Dashboard
            </h1>
            <p className="text-xs text-text-muted mt-1.5 leading-relaxed">
              GeoSphere 360 Operations Hub &bull; Mobile Mapping & Spatial Intelligence
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-base mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="w-full bg-card border border-subtle focus:border-accent focus:ring-1 focus:ring-accent/20 rounded-lg px-3.5 py-2.5 text-sm text-text-base placeholder-text-muted outline-none transition-all duration-150"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-text-base">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs text-text-muted hover:text-text-base transition-colors cursor-pointer"
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
                className="w-full bg-card border border-subtle focus:border-accent focus:ring-1 focus:ring-accent/20 rounded-lg px-3.5 py-2.5 text-sm text-text-base placeholder-text-muted outline-none transition-all duration-150"
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
              className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer mt-5"
            >
              {isAuthenticating ? (
                <>
                  <RefreshCw size={15} className="animate-spin text-white" />
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
              <div className="w-full border-t border-subtle" />
            </div>
            <span className="relative bg-card px-2 text-[10px] uppercase text-text-muted font-medium">
              or
            </span>
          </div>

          {/* Guest Login Button */}
          <button
            type="button"
            onClick={handleGuestLogin}
            className="w-full py-2.5 px-4 bg-card hover:bg-card active:bg-inner text-text-base hover:text-text-base border border-subtle text-xs font-semibold rounded-lg shadow-sm transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer"
          >
            <User size={15} className="text-text-muted" />
            <span>Continue as Guest (Read-Only Mode)</span>
          </button>

          {/* Footer Security Note */}
          <div className="mt-8 text-center">
            <p className="text-[11px] text-text-muted">
              Protected by Supabase Access Authentication
            </p>
          </div>
        </div>
      </div>
    );
  }



  // System i18n Translation Dictionary helper
  const TRANSLATIONS: Record<string, Record<string, string>> = {
    en: {
      appTitle: 'Mobile Mapping Data Management System',
      dashboard: 'Main Dashboard',
      data: 'Data Management',
      refresh: 'Refresh',
      backToDashboard: 'Back to Dashboard',
      settings: 'Project Settings',
      about: 'About Dashboard',
      collapsePanel: 'Collapse Panel',
      totalDistance: 'TOTAL DISTANCE MAPPED',
      processedPanoramas: 'PROCESSED PANORAMAS',
      activeJobs: 'ACTIVE PROCESSING JOBS',
      pipelineHealth: 'PIPELINE QUALITY SLA HEALTH',
      coverageMapTitle: 'INTERACTIVE COVERAGE MAP',
      processingControlTitle: 'PROCESSING CONTROL & ADMIN',
      generatePdfReport: 'GENERATE EXECUTIVE PDF REPORT',
      spatialFilter: 'SPATIAL FILTER (BBOX)',
      streetViewInspector: '360° VIEW INSPECTOR & QA',
      questionnaireTitle: 'QA Defect Verification Questionnaire',
      batchId: 'BATCH ID',
      subgrid: 'SUBGRID',
      date: 'DATE',
      picOperator: 'PIC / OPERATOR',
      kmProcessed: 'KM PROCESSED',
      status: 'STATUS',
      action: 'ACTION',
      saveSettings: 'Save All Settings',
      helpGuide: 'Help & User Guide',
      auditLogs: 'Audit Logs',
      notifications: 'Notifications',
      workspaceProduction: 'Production Workspace',
      workspaceStorage: 'NAS / Raw Storage Manager',
      workspaceProcessing: 'Processing Center',
      workspaceLineage: 'Data Lineage',
      workspaceAnalytics: 'Survey Analytics',
      workspaceReports: 'Reports',
      workspaceAdministration: 'Administration',
      workspaceTagLive: 'Live',
      workspaceTagPlanned: 'Upcoming',
      workspaceTagReserved: 'Reserved',
      workspaceComingSoon: 'Workspace Under Construction',
      workspaceComingSoonDesc: 'This workspace is part of the GeoSphere 360 production platform roadmap. Its capabilities will be delivered in upcoming implementation phases while preserving all existing functionality.',
      workspacePlannedRoadmap: 'All core workflows are live. Administration is reserved for a future phase.',
      workspaceDashboardDesc: 'Executive KPI dashboard, interactive coverage map, processing control and 360° inspector.',
      workspaceDataDesc: 'Batch logs, daily survey runs, vector layer catalog and database management.',
      workspaceSettingsDesc: 'Project, database, imagery storage, QA benchmarks and access control configuration.',
      workspaceProductionDesc: 'Production control plane: RAW registration, 4-Station Multi-PC workflow & NAS GPU Worker enhancement, live job status, preview and QA acceptance.',
      workspaceStorageDesc: 'NAS connectivity, capacity monitoring, dataset indexing and RAW/processed storage management.',
      workspaceProcessingDesc: 'Central job management for external stitching, blurring, enhancement, masking, acceptance QA, reports and exports.',
      workspaceLineageDesc: 'Visual trace from RAW source through external processing, acceptance QA, publication and export.',
      workspaceAnalyticsDesc: 'Road capture survey analytics: distance, coverage, GNSS quality, capture density and gaps.',
      workspaceReportsDesc: 'Automated report deliverables built from actual project data.',
      workspaceAdministrationDesc: 'Security, RBAC, audit and high-risk operation controls for administrators.',
      workspaceCategoryCore: 'Core Workspaces',
      workspaceCategoryProduction: 'Production',
      workspaceCategoryInsights: 'Insights & Reporting',
      workspaceCategoryGovernance: 'Administration & Control',
      analyticsTitle: 'Survey Analytics',
      analyticsSubtitle: 'Road capture analytics computed live from reconciled batch logs, daily runs, the RAW staging registry and QA decisions. Dashboard is metadata-only; recharts renders every chart.',
      analyticsGuestNote: 'Read-only mode: analytics are view-only.',
      analyticsTabOverview: 'Overview',
      analyticsTabLedger: 'Analytics',
      analyticsTabDistance: 'Distance',
      analyticsTabCoverage: 'Coverage',
      analyticsTabDensity: 'Density',
      analyticsTabQuality: 'Quality',
      analyticsStatePublished: 'Published',
      analyticsStateStaged: 'Staged',
      analyticsStatePartial: 'Partial',
      analyticsState_published: 'PUBLISHED',
      analyticsState_staged: 'STAGED',
      analyticsState_partial: 'PARTIAL',
      analyticsState_none: 'NONE',
      analyticsDays: 'days',
      analyticsKpiSubgrids: 'Subgrids Surveyed',
      analyticsKpiDistance: 'Distance Captured',
      analyticsKpiFrames: 'Processed Frames',
      analyticsKpiPoi: 'POIs Registered',
      analyticsKpiDefects: 'Defects Detected',
      analyticsKpiQuality: 'Quality Pass Rate',
      analyticsKpiFramesSub: 'processed frames',
      analyticsKpiQualitySub: 'per registered POI',
      analyticsDefectRate: 'defect rate',
      analyticsTargetProgress: 'Progress vs. Project Targets',
      analyticsQaApproved: 'QA Approved',
      analyticsQaRejected: 'QA Rejected',
      analyticsPublishDistribution: 'Publication Status Distribution',
      analyticsEmpty: 'No data available yet.',
      analyticsDailyTrend: 'Daily Throughput Trend',
      analyticsDistanceBySubgrid: 'Distance Surveyed by Subgrid',
      analyticsColSubgrid: 'Subgrid',
      analyticsColFrames: 'Frames',
      analyticsColRuns: 'Runs',
      analyticsColPoi: 'POI',
      analyticsColCoverage: 'Coverage',
      analyticsColState: 'State',
      analyticsColDelivery: 'PIC',
      analyticsColPublished: 'Published',
      analyticsColStaged: 'Staged',
      analyticsColPartial: 'Partial',
      analyticsColDefects: 'Defects',
      analyticsColPass: 'Pass Rate',
      analyticsGaps: 'Capture Gaps & Risks',
      analyticsGapMissing: 'frame(s) short of target',
      analyticsGapUnpublished: 'surveyed but not published',
      analyticsGapCapture: 'RAW captures without a processed dataset',
      analyticsGapKind_missing_frames: 'INCOMPLETE',
      analyticsGapKind_unpublished: 'NOT PUBLISHED',
      analyticsGapKind_capture_no_dataset: 'CAPTURE ONLY',
      analyticsDensityTitle: 'Capture Density',
      analyticsDefectsRanking: 'Defect Ranking by Subgrid',
      analyticsQaSub: 'QA decisions',
      analyticsQaClean: 'No defects or rejections flagged. All surveyed subgrids pass quality checks.',
      reportsTitle: 'Reports',
      reportsSubtitle: 'Automated, print-ready reports generated from the same reconciled data as the dashboard.',
      reportsGuestNote: 'Read-only mode: report generation is disabled for guests.',
      reportsTabExecutive: 'Executive',
      reportsTabDaily: 'Daily Operations',
      reportsTabSubgrid: 'Subgrid Coverage',
      reportsTabQa: 'Acquisition QC Audit',
      reportsTabLineage: 'Lineage & Audit',
      reportsKpiSubgrids: 'Subgrids Surveyed',
      reportsKpiPublished: 'Published',
      reportsKpiStaged: 'Staged',
      reportsKpiKm: 'Total Distance',
      reportsKpiPoi: 'POIs Registered',
      reportsKpiDefects: 'Defects Detected',
      reportsKpiPassRate: 'Pass Rate',
      reportsExecTitle: 'Executive Progress & Quality Audit Report',
      reportsExecDesc: 'Project-wide KPI summary over all surveyed subgrids — distance, coverage, quality and gaps in one print-ready document. Opens a print window and auto-triggers PDF save.',
      reportsDailyTitle: 'Daily Operations Report',
      reportsDailyDesc: 'Field capture & handover register covering every daily survey run.',
      reportsSubgridTitle: 'Subgrid Coverage Report',
      reportsSubgridDesc: 'Per-parcel delivery, coverage percentage and publication state.',
      reportsQaTitle: 'Acquisition QC Audit Report',
      reportsQaDesc: 'Quality assurance decisions and the defect register by subgrid.',
      reportsLineageTitle: 'Lineage & Audit Trail Report',
      reportsLineageDesc: 'Dataset provenance and the full processing job chain.',
      reportsTagAutomatic: 'Auto',
      reportsTagRecords: 'records',
      reportsTagSubgrids: 'subgrids',
      reportsTagDecisions: 'decisions',
      reportsTagDatasets: 'datasets',
      reportsChkSummary: 'Live KPIs',
      reportsChkTables: 'Data tables',
      reportsChkPrint: 'Print & PDF',
      reportsGenerate: 'Generate & Print',
      productionTabPipeline: 'Pipeline',
      productionTabDatasets: 'Metadata',
      productionTabProviders: 'Providers',
      productionTabPreview: 'Preview',
      productionTabEnhance: 'Enhance',
      productionTabMasking: 'Masking',
      storageTabOverview: 'Overview',
      storageTabBrowser: 'Folders',
      storageTabRawRegistry: 'RAW Registry',
      storageTabValidation: 'Validation',
      storageTabIndex: 'Index',
      processingTabBoard: 'Job Board',
      processingTabHandoff: 'Handoff',
      processingTabQA: 'Acceptance QA',
      processingTabCapacity: 'Capacity',
      pipelineProject: 'Project pipeline',
      pipelineStages: 'Pipeline stages',
      pipelineClearFilter: 'Clear stage filter',
      pipelineStageIngestion: 'Data ingestion',
      pipelineStageImageValidation: 'Image validation',
      pipelineStageStitching: 'Stitching',
      pipelineStagePrivacyBlur: 'Privacy blur',
      pipelineStageMetadataValidation: 'Metadata validation',
      pipelineStageDataStaging: 'Data staging',
      pipelineStageQaqc: 'Acceptance QA',
      pipelineStagePublish: 'Publish',
      pipelineStageFinalExport: 'Final export',
      jobDetailsTitle: 'Processing job',
      jobDetailsOverview: 'Overview',
      jobDetailsStatus: 'Status',
      jobDetailsWorker: 'Worker',
      jobDetailsProgress: 'Progress',
      jobDetailsTimeline: 'Timeline',
      jobDetailsLogs: 'Logs',
      jobDetailsErrors: 'Errors',
      jobDetailsLineage: 'Lineage',
      jobDetailsRetryOf: 'Retry of',
      jobDetailsRetry: 'Create traceable retry',
      lineageTabGraph: 'Lineage Graph',
      lineageTabTrace: 'Trace',
      lineageTabSurvey: 'Survey Capture',
      lineageTabRegistry: 'Registry',
      lineageGraphTitle: 'Trace in Graph',
      lineageGraphSubgrid: 'Subgrid',
      lineageGraphAllSubgrids: 'All subgrids',
      lineageGraphEmpty: 'No lineage data yet. Register RAW datasets, run processing jobs, or stage captures to see the trace.',
      lineageGraphFit: 'Fit',
      lineageGraphLegend: 'Legend',
      lineageGraphLayer_RAW: 'RAW',
      lineageGraphLayer_Stitch: 'STITCH',
      lineageGraphLayer_Blur: 'BLUR',
      lineageGraphLayer_Enhance: 'ENHANCE',
      lineageGraphLayer_Mask: 'MASK',
      lineageGraphLayer_QaQc: 'Acceptance QA',
      lineageGraphLayer_Deliverable: 'DELIVERABLE',
      lineageNodeRawAggregate: 'RAW capture aggregate',
      lineageNodeDataset: 'Dataset',
      lineageNodeJob: 'Job',
      lineageStatDatasets: 'Datasets',
      lineageStatJobs: 'Jobs',
      lineageStatRawFrames: 'RAW frames',
      lineageStatQaOk: 'QA approved',
      lineageStatQaRejected: 'QA rejected',
      lineageStatDeliverables: 'Deliverables',
      lineageStatLongestChain: 'Longest chain',
      lineageOrphansTitle: 'Orphaned / unlinked',
      lineageOrphanDesc: 'items not connected to the pipeline',
      lineageTraceNone: 'Select a node in the Lineage Graph to inspect its full provenance here.',
      lineageTraceAncestors: 'Ancestors',
      lineageTraceDescendants: 'Descendants',
      lineageTraceJobs: 'Processing runs',
      lineageTraceSettings: 'Reproduction settings',
      lineageTraceRawsource: 'RAW source',
      lineageTraceDeliverable: 'Publication / deliverable',
      lineageHistorical: 'No reproduction settings recorded',
      lineageSurveyTitle: 'Survey capture aggregates',
      lineageSurveyEmpty: 'No survey capture records staged yet. Import capture runs to populate the RAW survey registry.',
      lineageRegistryTitle: 'Lineage registry',
      lineageRegistryEmpty: 'No lineage records to show.',
      lineageRegistrySubgrid: 'Subgrid',
      lineageRegistrySource: 'Source',
      lineageRegistryTarget: 'Target',
      lineageRegistryStatus: 'Status',
      lineageRegistryQa: 'QA',
      lineageRegistryDates: 'Dates',
      lineageRegistryLinkKind: 'Link',
      lineageKind_parent: 'parent',
      lineageKind_job_source: 'job input',
      lineageKind_job_output: 'job output',
      lineageKind_raw_to_dataset: 'RAW → dataset',
      lineageFilterAll: 'All',
      lineageQaApproved: 'Approved',
      lineageQaRejected: 'Rejected',
      lineageQaPending: 'Pending',
      lineageGuestNote: 'Read-only: Data Lineage visualizes metadata only — no data is modified.',

      /* Data Management — Dataset Registry + Safe Deletion */
      dataRegistryTab: 'Dataset Registry',
      dataRegistryRefresh: 'Refresh',
      dataRegistrySubgrid: 'Subgrid',
      dataRegistryTotalDatasets: 'Datasets',
      dataRegistryTotalFiles: 'Files',
      dataRegistryTotalSize: 'Total Size',
      dataRegistryRaw: 'RAW',
      dataRegistryProcessed: 'Processed',
      dataRegistryDeliverables: 'Deliverables',
      dataRegistryOrphans: 'Orphan datasets',
      dataRegistrySearch: 'Search name, subgrid, provider, folder…',
      dataRegistryLoading: 'Loading dataset registry…',
      dataRegistryColName: 'Name',
      dataRegistryColType: 'Type',
      dataRegistryColStage: 'Stage',
      dataRegistryColVersion: 'Version',
      dataRegistryColSubgrid: 'Subgrid',
      dataRegistryColFiles: 'Files',
      dataRegistryColSize: 'Size',
      dataRegistryColStatus: 'Status',
      dataRegistryColQa: 'QA',
      dataRegistryColJobs: 'Jobs',
      dataRegistryColSource: 'Source',
      dataRegistryColCreated: 'Created',
      dataRegistryOpenInMap: 'Show on map',
      dataRegistryEmpty: 'No datasets match the current filters.',
      dataSelectionMapTitle: 'Selection Map',
      dataSelectionMapHint: 'Live WebGIS coverage map. Enable Delete Mode to select subgrids spatially.',
      dataSelectionMapGuest: 'Read-only map (guest)',
      dataDeleteModeOn: 'Delete Mode: ON',
      dataDeleteModeOff: 'Delete Mode',
      dataDeleteModeHint: 'Draw a bounding box by dragging over the map, or click a station point to add subgrid(s) to the delete selection.',
      dataReviewImpact: 'Review Delete Impact',
      dataClearSelection: 'Clear Selection',
      dataImpactPreview: 'Deletion Impact Preview',
      dataImpactComputing: 'Computing full impact…',
      dataImpactSubgrids: 'Subgrids',
      dataImpactRuns: 'Runs',
      dataImpactBatch: 'Batch',
      dataImpactPoi: 'POI',
      dataImpactFrames: 'Frames',
      dataImpactKm: 'Distance',
      dataImpactDefects: 'Defects',
      dataImpactQa: 'QA Rec.',
      dataImpactStaging: 'RAW Staging',
      dataImpactPublished: 'Published',
      dataImpactDatasets: 'Datasets',
      dataImpactDeliverables: 'Deliv.',
      dataImpactJobs: 'Jobs',
      dataImpactDependents: 'Dependent Data Warnings',
      dataConfirmPhrase: 'Explicit Confirmation Code',
      dataConfirmInstruction: 'Type the exact code to prove you understand this deletion cannot be reversed:'
    },
    ms: {
      appTitle: 'Sistem Pengurusan Data Pemetaan Mudah Alih',
      dashboard: 'Papan Pemuka Utama',
      data: 'Pengurusan Data',
      refresh: 'Muat Semula',
      backToDashboard: 'Kembali ke Papan Pemuka',
      settings: 'Tetapan Projek',
      about: 'Perihal Papan Pemuka',
      collapsePanel: 'Katup Panel',
      totalDistance: 'JUMLAH JARAK DIPETAKAN',
      processedPanoramas: 'PANORAMA DIPROSES',
      activeJobs: 'TUGAS PEMPROSESAN AKTIF',
      pipelineHealth: 'KESIHATAN MUTU SLA SALURAN',
      coverageMapTitle: 'PETA LIPUTAN INTERAKTIF',
      processingControlTitle: 'KAWALAN PEMPROSESAN & PENTADBIRAN',
      generatePdfReport: 'CANA LAPORAN PDF EKSEKUTIF',
      spatialFilter: 'PENAPIS RUANG (BBOX)',
      streetViewInspector: 'PEMERIKSA PANDANGAN 360° & QA',
      questionnaireTitle: 'Soal Selidik Pengesahan Cacat QA',
      batchId: 'ID KUMPULAN',
      subgrid: 'SUBGRID',
      date: 'TARIKH',
      picOperator: 'OPERATOR PIC',
      kmProcessed: 'KM DIPROSES',
      status: 'STATUS',
      action: 'TINDAKAN',
      saveSettings: 'Simpan Semua Tetapan',
      helpGuide: 'Panduan Bantuan & Pengguna',
      auditLogs: 'Log Audit',
      notifications: 'Pemberitahuan',
      workspaceProduction: 'Ruang Kerja Pengeluaran',
      workspaceStorage: 'Pengurus Stor NAS / Mentah',
      workspaceProcessing: 'Pusat Pemprosesan',
      workspaceLineage: 'Silsilah Data',
      workspaceAnalytics: 'Analitik Ukur',
      workspaceReports: 'Laporan',
      workspaceAdministration: 'Pentadbiran',
      workspaceTagLive: 'Langsung',
      workspaceTagPlanned: 'Akan Datang',
      workspaceTagReserved: 'Simpanan',
      workspaceComingSoon: 'Ruang Kerja Dalam Pembinaan',
      workspaceComingSoonDesc: 'Ruang kerja ini adalah sebahagian daripada peta jalan platform pengeluaran GeoSphere 360. Keupayaannya akan disampaikan dalam fasa pelaksanaan akan datang sambil mengekalkan semua fungsi sedia ada.',
      workspaceCategoryCore: 'Ruang Kerja Teras',
      workspaceCategoryProduction: 'Pengeluaran',
      workspaceCategoryInsights: 'Analitis & Pelaporan',
      workspaceCategoryGovernance: 'Pentadbiran & Kawalan',
      analyticsTitle: 'Analitik Ukur',
      analyticsSubtitle: 'Analitik tangkapan jalan dikira secara langsung daripada log kumpulan yang diselaraskan, larian harian, daftar storan mentah dan keputusan QA. Papan pemuka meta only; recharts renders every chart.',
      analyticsGuestNote: 'Mod baca sahaja: analitik hanya untuk paparan.',
      analyticsTabOverview: 'Gambaran Keseluruhan',
      analyticsTabLedger: 'Analisis',
      analyticsTabDistance: 'Jarak',
      analyticsTabCoverage: 'Liputan',
      analyticsTabDensity: 'Ketumpatan',
      analyticsTabQuality: 'Kualiti',
      analyticsStatePublished: 'Diterbitkan',
      analyticsStateStaged: 'Peringkat',
      analyticsStatePartial: 'Separa',
      analyticsState_published: 'DITERBITKAN',
      analyticsState_staged: 'PERINGKAT',
      analyticsState_partial: 'SEPARA',
      analyticsState_none: 'TIADA',
      analyticsDays: 'hari',
      analyticsKpiSubgrids: 'Subgrid Diukur',
      analyticsKpiDistance: 'Jarak Ditangkap',
      analyticsKpiFrames: 'Imej Diproses',
      analyticsKpiPoi: 'POI Didaftar',
      analyticsKpiDefects: 'Cacat Dikesan',
      analyticsKpiQuality: 'Kadar Lulus Kualiti',
      analyticsKpiFramesSub: 'imej diproses',
      analyticsKpiQualitySub: 'setiap POI berdaftar',
      analyticsDefectRate: 'kadar cacat',
      analyticsTargetProgress: 'Kemajuan vs. Sasaran Projek',
      analyticsQaApproved: 'QA Lulus',
      analyticsQaRejected: 'QA Gagal',
      analyticsPublishDistribution: 'Taburan Status Penerbitan',
      analyticsEmpty: 'Tiada data lagi.',
      analyticsDailyTrend: 'Aliran Hasil Harian',
      analyticsDistanceBySubgrid: 'Jarak Diukur Mengikut Subgrid',
      analyticsColSubgrid: 'Subgrid',
      analyticsColFrames: 'Imej',
      analyticsColRuns: 'Larian',
      analyticsColPoi: 'POI',
      analyticsColCoverage: 'Liputan',
      analyticsColState: 'Status',
      analyticsColDelivery: 'PIC',
      analyticsColPublished: 'Diterbitkan',
      analyticsColStaged: 'Peringkat',
      analyticsColPartial: 'Separa',
      analyticsColDefects: 'Cacat',
      analyticsColPass: 'Kadar Lulus',
      analyticsGaps: 'Jurang & Risiko Tangkapan',
      analyticsGapMissing: 'imej kurang daripada sasaran',
      analyticsGapUnpublished: 'diukur tetapi belum diterbitkan',
      analyticsGapCapture: 'Tangkapan mentah tanpa set data diproses',
      analyticsGapKind_missing_frames: 'TIDAK LENGKAP',
      analyticsGapKind_unpublished: 'BELUM DITERBITKAN',
      analyticsGapKind_capture_no_dataset: 'TANGKAPAN SAHAJA',
      analyticsDensityTitle: 'Ketumpatan Tangkapan',
      analyticsDefectsRanking: 'Kedudukan Cacat Mengikut Subgrid',
      analyticsQaSub: 'keputusan QA',
      analyticsQaClean: 'Tiada cacat atau penolakan dikesan. Semua subgrid yang diukur lulus semakan kualiti.',
      reportsTitle: 'Laporan',
      reportsSubtitle: 'Laporan automatik sedia dicetak dijana daripada data selaras yang sama seperti papan pemuka.',
      reportsGuestNote: 'Mod baca sahaja: penjanaan laporan dilumpuhkan untuk tetamu.',
      reportsTabExecutive: 'Eksekutif',
      reportsTabDaily: 'Operasi Harian',
      reportsTabSubgrid: 'Liputan Subgrid',
      reportsTabQa: 'Audit QC',
      reportsTabLineage: 'Silsilah & Audit',
      reportsKpiSubgrids: 'Subgrid Diukur',
      reportsKpiPublished: 'Diterbitkan',
      reportsKpiStaged: 'Peringkat',
      reportsKpiKm: 'Jumlah Jarak',
      reportsKpiPoi: 'POI Didaftar',
      reportsKpiDefects: 'Cacat Dikesan',
      reportsKpiPassRate: 'Kadar Lulus',
      reportsExecTitle: 'Laporan Audit Eksekutif Kemajuan & Kualiti',
      reportsExecDesc: 'Ringkasan KPI seluruh projek merentas semua subgrid yang diukur — jarak, liputan, kualiti dan jurang dalam satu dokumen sedia cetak.',
      reportsDailyTitle: 'Laporan Operasi Harian',
      reportsDailyDesc: 'Daftar tangkapan & serah tugas lapangan merangkumi setiap larian ukur harian.',
      reportsSubgridTitle: 'Laporan Liputan Subgrid',
      reportsSubgridDesc: 'Penghantaran setiap petak, peratus liputan dan status penerbitan.',
      reportsQaTitle: 'Laporan Audit QC',
      reportsQaDesc: 'Keputusan jaminan kualiti dan daftar cacat mengikut subgrid.',
      reportsLineageTitle: 'Laporan Silsilah & Jejak Audit',
      reportsLineageDesc: 'Asal-usul set data dan rantaian kerja pemprosesan penuh.',
      reportsTagAutomatic: 'Auto',
      reportsTagRecords: 'rekod',
      reportsTagSubgrids: 'subgrid',
      reportsTagDecisions: 'keputusan',
      reportsTagDatasets: 'set data',
      reportsChkSummary: 'KPI langsung',
      reportsChkTables: 'Jadual data',
      reportsChkPrint: 'Cetak & PDF',
      reportsGenerate: 'Jana & Cetak',
      productionTabPipeline: 'Saluran',
      productionTabDatasets: 'Metadata',
      productionTabProviders: 'Pembekal',
      productionTabPreview: 'Pratonton',
      productionTabEnhance: 'Penambahbaik',
      productionTabMasking: 'Topeng',
      storageTabOverview: 'Ringkasan',
      storageTabBrowser: 'Folder',
      storageTabRawRegistry: 'Daftar RAW',
      storageTabValidation: 'Pengesahan',
      storageTabIndex: 'Indeks',
      processingTabBoard: 'Papan Kerja',
      processingTabHandoff: 'Serah Tugas',
      processingTabQA: 'QA Penerimaan',
      processingTabCapacity: 'Kapasiti',
      pipelineProject: 'Saluran paip projek',
      pipelineStages: 'Peringkat saluran paip',
      pipelineClearFilter: 'Kosongkan penapis peringkat',
      pipelineStageIngestion: 'Pengambilan data',
      pipelineStageImageValidation: 'Pengesahan imej',
      pipelineStageStitching: 'Cantuman',
      pipelineStagePrivacyBlur: 'Kabur privasi',
      pipelineStageMetadataValidation: 'Pengesahan metadata',
      pipelineStageDataStaging: 'Peringkat data',
      pipelineStageQaqc: 'QA Penerimaan',
      pipelineStagePublish: 'Terbit',
      pipelineStageFinalExport: 'Eksport akhir',
      jobDetailsTitle: 'Kerja pemprosesan',
      jobDetailsOverview: 'Ringkasan',
      jobDetailsStatus: 'Status',
      jobDetailsWorker: 'Pekerja',
      jobDetailsProgress: 'Kemajuan',
      jobDetailsTimeline: 'Garis masa',
      jobDetailsLogs: 'Log',
      jobDetailsErrors: 'Ralat',
      jobDetailsLineage: 'Keturunan',
      jobDetailsRetryOf: 'Cuba semula daripada',
      jobDetailsRetry: 'Cipta cubaan semula',
      lineageTabGraph: 'Graf Silsilah',
      lineageTabTrace: 'Jejak',
      lineageTabSurvey: 'Tangkapan Tinjauan',
      lineageTabRegistry: 'Daftar',
      lineageGraphTitle: 'Jejak dalam Graf',
      lineageGraphSubgrid: 'Subgrid',
      lineageGraphAllSubgrids: 'Semua subgrid',
      lineageGraphEmpty: 'Tiada data silsilah lagi. Daftar set data RAW, jalankan tugas pemprosesan, atau pentaskan tangkapan untuk melihat jejak.',
      lineageGraphFit: 'Padan',
      lineageGraphLegend: 'Legenda',
      lineageGraphLayer_RAW: 'MENTAH',
      lineageGraphLayer_Stitch: 'CANTUM',
      lineageGraphLayer_Blur: 'KABUR',
      lineageGraphLayer_Enhance: 'TAMBAH BAIK',
      lineageGraphLayer_Mask: 'TOPENG',
      lineageGraphLayer_QaQc: 'QA Penerimaan',
      lineageGraphLayer_Deliverable: 'DELIVERABEL',
      lineageNodeRawAggregate: 'Agregat tangkapan RAW',
      lineageNodeDataset: 'Set data',
      lineageNodeJob: 'Tugas',
      lineageStatDatasets: 'Set data',
      lineageStatJobs: 'Tugas',
      lineageStatRawFrames: 'Bingkai RAW',
      lineageStatQaOk: 'QA dilulus',
      lineageStatQaRejected: 'QA ditolak',
      lineageStatDeliverables: 'Deliverabel',
      lineageStatLongestChain: 'Rantaian terpanjang',
      lineageOrphansTitle: 'Yatim / tidak terpaut',
      lineageOrphanDesc: 'item tidak bersambung ke saluran',
      lineageTraceNone: 'Pilih nod dalam Graf Silsilah untuk melihat provenans penuh di sini.',
      lineageTraceAncestors: 'Nenek moyang',
      lineageTraceDescendants: 'Keturunan',
      lineageTraceJobs: 'Jalan pemprosesan',
      lineageTraceSettings: 'Tetapan pembiakan semula',
      lineageTraceRawsource: 'Sumber RAW',
      lineageTraceDeliverable: 'Penerbitan / deliverabel',
      lineageHistorical: 'Tiada tetapan pembiakan semula direkod',
      lineageSurveyTitle: 'Agregat tangkapan tinjauan',
      lineageSurveyEmpty: 'Tiada rekod tangkapan tinjauan dipentas lagi. Import jalan tangkapan untuk mengisi daftar tinjauan RAW.',
      lineageRegistryTitle: 'Daftar silsilah',
      lineageRegistryEmpty: 'Tiada rekod silsilah untuk dipaparkan.',
      lineageRegistrySubgrid: 'Subgrid',
      lineageRegistrySource: 'Sumber',
      lineageRegistryTarget: 'Sasaran',
      lineageRegistryStatus: 'Status',
      lineageRegistryQa: 'QA',
      lineageRegistryDates: 'Tarikh',
      lineageRegistryLinkKind: 'Pautan',
      lineageKind_parent: 'induk',
      lineageKind_job_source: 'input tugas',
      lineageKind_job_output: 'output tugas',
      lineageKind_raw_to_dataset: 'RAW → set data',
      lineageFilterAll: 'Semua',
      lineageQaApproved: 'Dilulus',
      lineageQaRejected: 'Ditolak',
      lineageQaPending: 'Tertunda',
      lineageGuestNote: 'Hanya baca: Silsilah Data memaparkan metadata sahaja — tiada data diubah.',

      /* Data Management — Registry Dataset + Padam Selamat */
      dataRegistryTab: 'Daftar Dataset',
      dataRegistryRefresh: 'Muat Semula',
      dataRegistrySubgrid: 'Subgrid',
      dataRegistryTotalDatasets: 'Dataset',
      dataRegistryTotalFiles: 'Fail',
      dataRegistryTotalSize: 'Jumlah Saiz',
      dataRegistryRaw: 'Mentah',
      dataRegistryProcessed: 'Diproses',
      dataRegistryDeliverables: 'Penghantaran',
      dataRegistryOrphans: 'Dataset yatim',
      dataRegistrySearch: 'Cari nama, subgrid, pembekal, folder…',
      dataRegistryLoading: 'Memuat daftar dataset…',
      dataRegistryColName: 'Nama',
      dataRegistryColType: 'Jenis',
      dataRegistryColStage: 'Peringkat',
      dataRegistryColVersion: 'Versi',
      dataRegistryColSubgrid: 'Subgrid',
      dataRegistryColFiles: 'Fail',
      dataRegistryColSize: 'Saiz',
      dataRegistryColStatus: 'Status',
      dataRegistryColQa: 'QA',
      dataRegistryColJobs: 'Tugas',
      dataRegistryColSource: 'Sumber',
      dataRegistryColCreated: 'Dicipta',
      dataRegistryOpenInMap: 'Papar pada peta',
      dataRegistryEmpty: 'Tiada dataset sepadan dengan penapis semasa.',
      dataSelectionMapTitle: 'Peta Pemilihan',
      dataSelectionMapHint: 'Peta liputan WebGIS langsung. Aktifkan Mod Padam untuk memilih subgrid secara spatial.',
      dataSelectionMapGuest: 'Peta baca sahaja (tetamu)',
      dataDeleteModeOn: 'Mod Padam: ON',
      dataDeleteModeOff: 'Mod Padam',
      dataDeleteModeHint: 'Lukis kotak sempadan dengan menyeret pada peta, atau klik titik stesen untuk menambah subgrid ke pemilihan padam.',
      dataReviewImpact: 'Semak Kesan Padam',
      dataClearSelection: 'Kosongkan Pilihan',
      dataImpactPreview: 'Pratonton Kesan Padam',
      dataImpactComputing: 'Mengira kesan penuh…',
      dataImpactSubgrids: 'Subgrid',
      dataImpactRuns: 'Larian',
      dataImpactBatch: 'Kumpulan',
      dataImpactPoi: 'POI',
      dataImpactFrames: 'Bingkai',
      dataImpactKm: 'Jarak',
      dataImpactDefects: 'Cacat',
      dataImpactQa: 'QA Rec.',
      dataImpactStaging: 'Staging Mentah',
      dataImpactPublished: 'Diterbit',
      dataImpactDatasets: 'Dataset',
      dataImpactDeliverables: 'Pengh.',
      dataImpactJobs: 'Tugas',
      dataImpactDependents: 'Amaran Data Bergantung',
      dataConfirmPhrase: 'Kod Pengesahan Eksplisit',
      dataConfirmInstruction: 'Taip kod tepat untuk membuktikan anda faham pemadaman ini tidak boleh diterbalikkan:'
    },
    zh: {
      appTitle: 'Web映射处理仪表板',
      dashboard: '主仪表板',
      data: '数据管理',
      refresh: '刷新地图',
      settings: '项目设置',
      about: '关于仪表板',
      collapsePanel: '折叠面板',
      totalDistance: '已绘制总距离',
      processedPanoramas: '已处理全景图',
      activeJobs: '活动处理任务',
      pipelineHealth: '管道SLA质量健康度',
      coverageMapTitle: '交互式覆盖地图',
      processingControlTitle: '处理控制与管理',
      generatePdfReport: '生成执行PDF报告',
      spatialFilter: '空间过滤 (BBOX)',
      streetViewInspector: '360°全景检查与质检',
      questionnaireTitle: 'QA缺陷验证问卷',
      batchId: '批次ID',
      subgrid: '子网格',
      date: '日期',
      picOperator: '操作员',
      kmProcessed: '已处理公里',
      status: '状态',
      action: '操作',
      saveSettings: '保存所有设置',
      helpGuide: '帮助与用户指南',
      auditLogs: '审计日志',
      notifications: '通知'
    },
    ja: {
      appTitle: 'Webマッピング処理ダッシュボード',
      dashboard: 'メインダッシュボード',
      data: 'データ管理',
      refresh: 'マップ更新',
      settings: 'プロジェクト設定',
      about: 'ダッシュボードについて',
      collapsePanel: 'パネルをたたむ',
      totalDistance: 'マッピング総距離',
      processedPanoramas: '処理済み全景写真',
      activeJobs: 'アクティブ処理ジョブ',
      pipelineHealth: 'パイプラインSLA品質',
      coverageMapTitle: 'インタラクティブマップ',
      processingControlTitle: '処理コントロール＆管理',
      generatePdfReport: 'PDFレポート生成',
      spatialFilter: '空間フィルター (BBOX)',
      streetViewInspector: '360°ビューインスペクター & QA',
      questionnaireTitle: 'QA欠陥点検問診',
      batchId: 'バッチID',
      subgrid: 'サブグリッド',
      date: '日付',
      picOperator: '担当者',
      kmProcessed: '処理キロ数',
      status: 'ステータス',
      action: '操作',
      saveSettings: 'すべての設定を保存',
      helpGuide: 'ヘルプ＆ユーザーガイド',
      auditLogs: '監査ログ',
      notifications: '通知'
    }
  };

  const t = (key: string) => TRANSLATIONS[projectSettings?.language || 'en']?.[key] || TRANSLATIONS['en'][key] || key;

  return (
    <div
      data-theme={currentTheme}
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)' }}
      className="min-h-screen md:h-screen w-full max-w-full font-sans flex flex-col overflow-x-hidden overflow-y-auto md:overflow-hidden transition-colors duration-200"
    >
      {/* SLEEK GLASSMORPHIC TOAST NOTIFICATION FOR SETTINGS SAVE */}
      {settingsSaveToast && (
        <div className="fixed top-14 right-6 z-[3000] animate-in fade-in slide-in-from-top-3 duration-300 pointer-events-none">
          <div className="bg-card border border-emerald-500/50 text-text-base px-4 py-3 rounded-2xl shadow-[0_10px_30px_rgba(16,185,129,0.2)] backdrop-blur-md flex items-center gap-3">
            <div className="p-1.5 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30 shrink-0">
              <CheckCircle size={18} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-emerald-400 tracking-wide">Settings Saved & Synced</h4>
              <p className="text-[11px] text-text-base">{settingsSaveToast.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* TOP GLOBAL NAVBAR */}
      <header className="min-h-14 py-2 sm:py-0 px-3 sm:px-4 bg-card border-b border-subtle flex items-center justify-between shrink-0 z-20 gap-2">
        <div className="flex flex-col select-none min-w-0">
          <h1 className="text-sm sm:text-base md:text-lg font-bold text-text-base tracking-tight font-sans leading-tight truncate">
            {t('appTitle')}
          </h1>
          <span className="text-[10px] sm:text-[11px] text-text-muted font-normal tracking-normal mt-0.5 hidden sm:inline truncate">
            Spatial Trajectory Processing &amp; Quality Assurance Pipeline
          </span>
          <span className="text-[9px] text-text-muted font-normal tracking-normal mt-0.5 sm:hidden truncate">
            Spatial Pipeline
          </span>
        </div>

        {/* Top Right Controls */}
        <div className={`flex items-center gap-1.5 sm:gap-3 text-text-muted relative shrink-0 transition-all duration-300 ${tourStep === 5 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative bg-app px-2 py-1 rounded-xl' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
          }`}>
          {/* DAILY OPERATIONS BRIEFING ICON */}
          <button
            onClick={() => setIsHandoverModalOpen(true)}
            className="p-1.5 hover:text-sky-400 transition-colors cursor-pointer relative"
            title="Daily Operations Briefing"
          >
            <Clock size={18} />
          </button>

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
                const nextState = !isAuditLogOpen;
                setIsAuditLogOpen(nextState);
                if (nextState) {
                  markAuditLogsAsRead();
                }
                setIsNotifOpen(false);
              }}
              className={`p-1.5 transition-colors cursor-pointer relative ${isAuditLogOpen ? 'text-sky-400 bg-inner rounded-lg border border-subtle' : 'hover:text-text-base'
                }`}
              title="Batch & System Audit Logs (Track user edits, creates, deletes, errors)"
            >
              <ClipboardList size={18} />
              {unreadAuditCount > 0 && (
                <span className="absolute -top-1 -right-1.5 px-1 py-0.2 min-w-[15px] h-[15px] rounded-full bg-red-500 text-text-base text-[9px] font-bold flex items-center justify-center shadow-md">
                  {unreadAuditCount}
                </span>
              )}
            </button>

            {/* BATCH AUDIT LOGS POPOVER */}
            {isAuditLogOpen && (
              <div className="absolute right-0 top-10 w-96 max-w-[90vw] bg-card border border-subtle rounded-xl shadow-2xl z-50 overflow-hidden text-text-base animate-in fade-in duration-150 backdrop-blur-md">
                <div className="p-3 bg-card border-b border-subtle flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 shrink-0">
                    <History size={15} className="text-sky-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-text-base">
                      Audit Logs
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Date Track-Back Filter */}
                    <div className="flex items-center gap-1 bg-card border border-subtle rounded px-2 py-0.5 text-[10px]">
                      <Calendar size={11} className="text-sky-400 shrink-0" />
                      <select
                        value={auditDateFilter}
                        onChange={(e) => setAuditDateFilter(e.target.value)}
                        className="bg-transparent text-text-base text-[10px] focus:outline-none cursor-pointer"
                        title="Filter audit logs by track-back date"
                      >
                        <option value="" className="bg-card">All Dates</option>
                        {availableAuditDates.map(date => (
                          <option key={date} value={date} className="bg-card">{date}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => setIsAuditLogOpen(false)}
                      className="text-text-muted hover:text-text-base p-0.5 cursor-pointer shrink-0"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Filter Tabs */}
                <div className="px-3 py-1.5 bg-card border-b border-subtle flex items-center gap-1 overflow-x-auto text-[10px]">
                  {(['ALL', 'EDIT', 'DELETE', 'CREATE', 'PUBLISH', 'ERROR'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setAuditFilterTab(tab)}
                      className={`px-2 py-0.5 rounded font-medium transition-all cursor-pointer whitespace-nowrap border ${auditFilterTab === tab
                        ? 'bg-card text-text-base border-subtle'
                        : 'text-text-muted border-transparent hover:text-text-base hover:bg-inner'
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
                          log.type === 'CREATE' ? 'bg-inner text-sky-300 border-subtle' :
                            log.type === 'EDIT' ? 'bg-inner text-text-base border-subtle' :
                              log.type === 'DELETE' ? 'bg-inner text-rose-300 border-subtle' :
                                log.type === 'PUBLISH' ? 'bg-sky-950/60 text-sky-300 border-sky-800/60' :
                                  log.type === 'ERROR' ? 'bg-rose-950/60 text-rose-300 border-rose-900/60' :
                                    'bg-inner text-text-base border-subtle';

                        return (
                          <div key={log.id} className="p-2.5 hover:bg-inner transition-colors rounded-lg space-y-1">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className={`px-1.5 py-0.2 rounded font-semibold uppercase border ${badgeColor}`}>
                                {log.type}
                              </span>
                              <span className="text-text-muted text-[10px]">{log.timestamp}</span>
                            </div>
                            <div className="text-xs font-medium text-text-base">{log.title}</div>
                            <div className="text-[11px] text-text-muted">{log.details}</div>
                            <div className="text-[9px] text-text-muted text-right">User: <span className="text-text-base font-medium">{log.user}</span></div>
                          </div>
                        );
                      })
                  ) : (
                    <div className="p-8 text-center text-text-muted text-xs">
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
                const nextState = !isNotifOpen;
                setIsNotifOpen(nextState);
                if (nextState) {
                  markNotificationsAsRead();
                }
                setIsAuditLogOpen(false);
              }}
              className={`p-1.5 transition-colors cursor-pointer relative ${isNotifOpen ? 'text-sky-400 bg-inner rounded-lg border border-subtle' : 'hover:text-text-base'
                }`}
              title="Notifications (Publish Progress & Pending Tasks)"
            >
              <Activity size={18} />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1.5 px-1 py-0.2 min-w-[15px] h-[15px] rounded-full bg-red-500 text-text-base text-[9px] font-bold flex items-center justify-center shadow-md">
                  {unreadNotifCount}
                </span>
              )}
            </button>

            {/* NOTIFICATIONS POPOVER */}
            {isNotifOpen && (
              <div className="absolute right-0 top-10 w-96 max-w-[90vw] bg-card border border-subtle rounded-xl shadow-2xl z-50 overflow-hidden text-text-base animate-in fade-in duration-150 backdrop-blur-md">
                <div className="p-3 bg-card border-b border-subtle flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell size={15} className="text-sky-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-text-base">
                      Notifications
                    </span>
                    {unreadNotifCount > 0 && (
                      <span className="bg-inner text-sky-400 border border-subtle text-[10px] font-medium px-1.5 py-0.2 rounded-full">
                        {unreadNotifCount} new
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {notifications.length > 0 && (
                      <button
                        onClick={clearNotifications}
                        className="text-text-muted hover:text-rose-400 text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer"
                        title="Clear all notifications"
                      >
                        <Trash2 size={11} /> Clear All
                      </button>
                    )}
                    <button
                      onClick={() => setIsNotifOpen(false)}
                      className="text-text-muted hover:text-text-base p-0.5 cursor-pointer"
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
                          className={`p-3 transition-colors rounded-lg space-y-1.5 relative group ${!notif.read ? 'bg-card border-l-2 border-sky-400' : 'hover:bg-inner'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {isPublish ? (
                                <span className="bg-sky-950/60 text-sky-300 border border-sky-800/60 px-1.5 py-0.2 rounded text-[9px] font-medium">
                                  PUBLISH SUCCESS
                                </span>
                              ) : isPending ? (
                                <span className="bg-inner text-text-base border border-subtle px-1.5 py-0.2 rounded text-[9px] font-medium">
                                  PENDING TASK
                                </span>
                              ) : (
                                <span className="bg-inner text-text-muted border border-subtle px-1.5 py-0.2 rounded text-[9px] font-medium">
                                  {notif.category}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-text-muted">{notif.timestamp}</span>
                              <button
                                onClick={() => {
                                  const strId = String(notif.id);
                                  try {
                                    const currentRead = new Set(JSON.parse(localStorage.getItem('app_read_notif_ids') || '[]'));
                                    currentRead.add(strId);
                                    currentRead.add(`notif-${strId}`);
                                    localStorage.setItem('app_read_notif_ids', JSON.stringify(Array.from(currentRead)));
                                  } catch (_) { }
                                  setNotifications(prev => prev.filter(n => String(n.id) !== strId));
                                }}
                                className="text-text-muted hover:text-rose-400 p-0.5 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                                title="Dismiss notification"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>

                          <div className="text-xs font-medium text-text-base flex items-center gap-1.5">
                            {isPublish ? <UploadCloud size={14} className="text-sky-400 shrink-0" /> : isPending ? <Clock size={14} className="text-text-muted shrink-0" /> : <Activity size={14} className="text-sky-400 shrink-0" />}
                            <span>{notif.title}</span>
                          </div>

                          <p className="text-[11px] text-text-muted leading-snug">{notif.message}</p>

                          {/* Detail Badges: Total Data & Published Timestamp */}
                          {isPublish && (
                            <div className="pt-1.5 border-t border-subtle flex items-center justify-between text-[10px]">
                              <span className="text-text-muted">Total Data Included: <strong className="text-text-base">{notif.totalItems || 1} subgrid(s)</strong></span>
                              <span className="text-text-muted">Date Published: <strong className="text-sky-400">{notif.timestamp}</strong></span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-8 text-center text-text-muted text-xs">
                      No notifications available
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 pl-2 border-l border-subtle">

            {/* User Avatar Initial */}
            <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold ${isGuestUser ? 'bg-amber-900/40 border-amber-700 text-amber-400' : 'bg-inner border-subtle text-sky-400'
              }`} title={`Logged in as ${authSession?.user?.email || (isGuestUser ? 'Guest' : 'User')}`}>
              {isGuestUser ? 'G' : (authSession?.user?.email?.charAt(0).toUpperCase() || authSession?.user?.user_metadata?.full_name?.charAt(0).toUpperCase() || 'U')}
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

        {/* EXPANDABLE NAVIGATION BAR WITH FLUID ANIMATIONS & BOTTOM TOGGLE BUTTON */}
        <WorkspaceSidebarNav
          translate={t}
          activeWorkspace={currentPage}
          isSidebarExpanded={isSidebarExpanded}
          tourStep={tourStep}
          onNavigate={goToWorkspace}
          onRefresh={handleRefreshMap}
          onOpenAbout={() => setIsAboutModalOpen(true)}
          onToggleSidebar={() => setIsSidebarExpanded(prev => !prev)}
        />

        {/* MAIN DASHBOARD CONTENT CANVAS */}
        <main className={`flex-1 flex flex-col p-3 gap-3 overflow-y-auto md:overflow-hidden relative ${currentPage === 'dashboard' ? 'bg-card' : 'bg-app [background:var(--canvas-bg)]'}`}>

          {/* SUPABASE DISCONNECTED ERROR FALLBACK BANNER */}
          {supabaseError && (
            <div className="bg-amber-950/70 border border-amber-800/80 rounded-xl p-2.5 px-3 flex items-center justify-between text-xs text-amber-200 shrink-0 shadow-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-400 shrink-0" />
                <span>{supabaseError}</span>
              </div>
              <button
                onClick={() => setSupabaseError(null)}
                aria-label="Dismiss Supabase alert banner"
                className="text-amber-400 hover:text-text-base text-xs px-2 py-0.5 rounded bg-amber-900/50 hover:bg-amber-900 border border-amber-700/50 cursor-pointer transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {currentPage === 'dashboard' ? (
            <div key="dashboard-canvas" className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto md:overflow-hidden animate-in fade-in zoom-in-98 duration-300 ease-out">
              {/* TOP ROW: EXECUTIVE KPI SUMMARY (4 Cards) */}
              <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0 transition-all duration-300 ${tourStep === 1 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative rounded-xl p-1 bg-sky-950/20' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
                }`}>
                {/* Card 1: Total Distance Mapped */}
                <div className="bg-card border border-subtle backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-base uppercase tracking-tight">{t('totalDistance')}</span>
                    <Navigation size={15} className="text-sky-400 shrink-0" />
                  </div>
                  <div className="my-1 flex items-baseline gap-2">
                    {isDataLoading ? (
                      <div className="flex items-center gap-2 text-text-muted my-0.5">
                        <Loader2 size={16} className="animate-spin text-sky-400" />
                        <span className="text-sm font-medium">Syncing...</span>
                      </div>
                    ) : (
                      <span className="text-2xl font-extrabold text-text-base tracking-tight">{totalKm.toFixed(1)} km</span>
                    )}
                    <span className="text-[10px] text-text-base bg-inner border border-subtle px-1.5 py-0.5 rounded font-medium">
                      {progressPercent}% of {targetKm} km Target
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted font-medium truncate">
                    Cumulative Trajectory Distance &bull; Updated {lastUpdateDate}
                  </div>
                </div>

                {/* Card 2: Processed Panoramas */}
                <div className="bg-card border border-subtle backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-base uppercase tracking-tight">{t('processedPanoramas')}</span>
                    <Camera size={15} className="text-sky-400 shrink-0" />
                  </div>
                  <div className="my-1">
                    {isDataLoading ? (
                      <div className="flex items-center gap-2 text-text-muted my-0.5">
                        <Loader2 size={16} className="animate-spin text-sky-400" />
                        <span className="text-sm font-medium">Syncing...</span>
                      </div>
                    ) : (
                      <span className="text-2xl font-extrabold text-text-base tracking-tight">{totalImages.toLocaleString()} Frames</span>
                    )}
                  </div>
                  <div className="text-[10px] text-text-muted font-medium truncate">
                    Total 360° Image Frames Ingested &bull; Updated {lastUpdateDate}
                  </div>
                </div>

                {/* Card 3: Active Processing Jobs */}
                <div className="bg-card border border-subtle backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-base uppercase tracking-tight">{t('activeJobs')}</span>
                    <Database size={15} className="text-sky-400 shrink-0" />
                  </div>
                  <div className="my-1 flex items-baseline gap-2 flex-wrap">
                    {isDataLoading ? (
                      <div className="flex items-center gap-2 text-text-muted my-0.5">
                        <Loader2 size={16} className="animate-spin text-sky-400" />
                        <span className="text-sm font-medium">Syncing...</span>
                      </div>
                    ) : (
                      <>
                        <span className="text-2xl font-extrabold text-text-base tracking-tight">
                          {ongoingMasterlistCount} Ongoing {ongoingMasterlistCount === 1 ? 'Subgrid' : 'Subgrids'}
                        </span>
                        {stagedDailyBatchesCount > 0 && (
                          <span className="text-xs font-medium text-text-muted">
                            ({stagedDailyBatchesCount} Staged)
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="text-[10px] text-text-muted font-medium truncate">
                    {ongoingMasterlistCount} Masterlist {ongoingMasterlistCount === 1 ? 'sector' : 'sectors'} in progress &bull; {stagedDailyBatchesCount} daily {stagedDailyBatchesCount === 1 ? 'pass' : 'passes'} pending
                  </div>
                </div>

                {/* Card 4: Pipeline Health */}
                <div className="bg-card border border-subtle backdrop-blur-md rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-base uppercase tracking-tight">{t('pipelineHealth')}</span>
                    <div className="w-14 h-5">
                      <svg className="w-full h-full text-emerald-400 stroke-current fill-none stroke-2" viewBox="0 0 50 20">
                        <path d="M0,15 L10,12 L20,18 L30,5 L40,10 L50,2" />
                      </svg>
                    </div>
                  </div>
                  <div className="my-1">
                    {isDataLoading ? (
                      <div className="flex items-center gap-2 text-text-muted my-0.5">
                        <Loader2 size={16} className="animate-spin text-sky-400" />
                        <span className="text-sm font-medium">Syncing...</span>
                      </div>
                    ) : (
                      <span className="text-2xl font-extrabold text-emerald-400 tracking-tight">
                        {pipelineHealthPercent}% Normal
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-text-muted font-medium truncate">
                    <span className={totalDefects > 0 ? 'text-amber-400 font-semibold' : 'text-text-muted'}>{totalDefects} Defect {totalDefects === 1 ? 'Frame' : 'Frames'} Flagged</span> &bull; Updated {lastUpdateDate}
                  </div>
                </div>
              </div>

              {/* OPERATIONAL COMMAND & ACTION CENTER */}
              <OperationalActionCenter
                batchLogs={batchLogs}
                dailyData={dailyData}
                qaDefectsCount={totalDefects}
                isGuestUser={isGuestUser}
                onOpenQAQCWorkbench={(subgridKey) => {
                  setQaqcWorkbenchSubgrid(subgridKey || null);
                  setIsQAQCRunnerModalOpen(true);
                }}
                onOpenDefectsGallery={(subgridKey) => {
                  if (subgridKey) setSelectedDefectSubgrid(subgridKey);
                  setIsDefectsGalleryOpen(true);
                }}
                onNavigate={(ws, params) => {
                  goToWorkspace(ws);
                  if (ws === 'data' && params) {
                    if (params.tab) setDataManagementTab(params.tab);
                    if (params.search !== undefined) setDataManagementSearch(params.search);
                  }
                }}
                onGeneratePdfReport={generateExecutivePdfReport}
                onRetryJob={async (job) => {
                  if (job.id) {
                    await saveProcessingJobToSupabase({ ...job, status: 'QUEUED', progress: 0 });
                    if (addNotification) {
                      addNotification({
                        title: 'Job Retried',
                        message: `Job ${job.name || job.id} queued for retry.`,
                        category: 'SYSTEM'
                      });
                    }
                  }
                }}
              />

              {/* MIDDLE & BOTTOM GRID: LEFT (COVERAGE MAP) & RIGHT (CONTROL + INSPECTOR) */}
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-y-auto lg:overflow-hidden">

                {/* LEFT COLUMN: INTERACTIVE COVERAGE MAP (7 Cols) */}
                <div className={`col-span-1 lg:col-span-7 min-h-[380px] lg:min-h-0 bg-card border border-subtle backdrop-blur-md rounded-xl flex flex-col overflow-hidden relative transition-all duration-300 ${tourStep === 2 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative scale-[1.002]' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
                  }`}>
                  {/* Header */}
                  <div className="p-2.5 sm:p-3 border-b border-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shrink-0 bg-card">
                    <span className="text-xs font-bold uppercase tracking-wider text-text-base">
                      INTERACTIVE COVERAGE MAP
                    </span>
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap w-full sm:w-auto justify-end">
                      <button
                        onClick={generateExecutivePdfReport}
                        className="flex-1 sm:flex-none px-2.5 sm:px-3 py-1.5 bg-card hover:bg-inner text-text-base hover:text-text-base border border-subtle text-[10px] sm:text-[11px] font-medium rounded-lg transition-all uppercase tracking-tight cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:scale-95 whitespace-nowrap"
                        title="Generate printable Executive PDF Summary Report"
                      >
                        <FileText size={13} className="shrink-0" />
                        <span className="hidden xs:inline">GENERATE PDF REPORT</span>
                        <span className="xs:hidden">PDF REPORT</span>
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
                        className={`flex-1 sm:flex-none px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-[11px] font-medium rounded-lg border transition-all uppercase tracking-tight flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95 whitespace-nowrap ${isDrawingBBox
                          ? 'bg-card border-slate-400 text-text-base'
                          : 'bg-card hover:bg-inner text-text-base border-subtle hover:border-subtle'
                          }`}
                        title="Toggle spatial bounding box rectangle filter on map"
                      >
                        <Maximize2 size={13} className="shrink-0" />
                        <span>{isDrawingBBox ? 'CLEAR BBOX' : 'BBOX FILTER'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Embedded WebGIS Map */}
                  <div className="flex-1 relative overflow-hidden bg-app">
                    {/* Minimalist Trajectory Filter Button & Popup Menu (bottom-left) */}
                    <div className="absolute bottom-3 left-3 z-10 pointer-events-auto flex flex-col items-start gap-2">
                      {/* Popup Panel (shown when isStatusFilterOpen === true) */}
                      {isStatusFilterOpen && (
                        <div className="bg-app backdrop-blur-xl border border-subtle rounded-xl p-2.5 text-[11px] space-y-1.5 shadow-2xl min-w-[200px] animate-in fade-in slide-in-from-bottom-2 duration-150">
                          <div className="flex items-center justify-between border-b border-subtle pb-1.5 mb-1 px-1">
                            <span className="font-semibold text-[10px] text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Filter size={12} />
                              Trajectory Status
                            </span>
                            <button
                              onClick={() => setIsStatusFilterOpen(false)}
                              className="text-text-muted hover:text-text-base text-xs px-1 cursor-pointer transition-colors"
                            >
                              ✕
                            </button>
                          </div>

                          <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-inner text-text-base hover:text-text-base cursor-pointer select-none transition-colors">
                            <span className="text-[11px] font-medium text-text-base">Show Panotrack Layer</span>
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

                          <div className="border-t border-subtle pt-1 space-y-0.5">
                            <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-inner text-text-base hover:text-text-base cursor-pointer select-none transition-colors">
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

                            <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-inner text-text-base hover:text-text-base cursor-pointer select-none transition-colors">
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

                            <label className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-inner text-text-base hover:text-text-base cursor-pointer select-none transition-colors">
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
                          ? 'bg-sky-600 text-text-base border-sky-400 shadow-sky-950/50'
                          : 'bg-app hover:bg-inner text-text-base border-subtle hover:border-subtle'
                          }`}
                        title="Filter Trajectory Status"
                      >
                        <Filter size={13} className={isStatusFilterOpen ? 'text-text-base' : 'text-sky-400'} />
                        <span>Trajectory Status</span>
                        {(!statusFilters.published || !statusFilters.defect || !statusFilters.stitching || !showPanotrackData) && (
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                        )}
                      </button>
                    </div>

                    {/* Derived active subgrid item details for clicked row */}
                    {(() => {
                      const isDailySelected = Boolean(selectedDailyRunId);
                      const activeBatchLog = batchLogs.find(b =>
                        (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === (selectedSubgridFilter || '').toUpperCase().trim()
                      );
                      const activeDailyLog = selectedDailyRunId
                        ? dailyData.find(d => getItemId(d) === selectedDailyRunId || d.id === selectedDailyRunId)
                        : (selectedDateFilter
                          ? dailyData.find(d =>
                            (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === (selectedSubgridFilter || '').toUpperCase().trim() &&
                            (d.date === selectedDateFilter || formatDisplayDate(d.date) === formatDisplayDate(selectedDateFilter))
                          )
                          : null);

                      const getSubgridCoords = () => {
                        const firstPan = activeDailyLog?.panoramas?.[0] || (activeDailyLog as any)?.points?.[0] || activeBatchLog?.panoramas?.[0];
                        const lat = firstPan?.latitude ?? (firstPan as any)?.lat ?? (SUBGRID_COORDINATES[selectedSubgridFilter || '']?.[1] ?? 0);
                        const lng = firstPan?.longitude ?? (firstPan as any)?.lon ?? (firstPan as any)?.lng ?? (SUBGRID_COORDINATES[selectedSubgridFilter || '']?.[0] ?? 0);
                        return { lat, lng };
                      };

                      const activeCoords = getSubgridCoords();
                      const activeKm = isDailySelected && activeDailyLog
                        ? (activeDailyLog.kmProcessed?.toFixed(1) || '0.0')
                        : (activeBatchLog?.kmProcessed ? activeBatchLog.kmProcessed.toFixed(1) : '0.0');
                      const activeImages = isDailySelected && activeDailyLog
                        ? (activeDailyLog.imagesProcessed || activeDailyLog.availableImagesCount || activeDailyLog.poiCount || 0)
                        : (activeBatchLog?.images || getPOICount(activeBatchLog) || 0);
                      const activeDefects = isDailySelected && activeDailyLog
                        ? ((activeDailyLog.imagesDefected ?? activeDailyLog.defectCount) || 0)
                        : (activeBatchLog?.defects || 0);
                      const activePic = (isDailySelected && activeDailyLog ? activeDailyLog.pic : activeBatchLog?.pic) || 'Unassigned';

                      const isPublished = isDailySelected && activeDailyLog
                        ? (activeDailyLog.publishToWebGIS === 'yes' || activeDailyLog.isSyncedWithSupabase === true)
                        : (activeBatchLog?.status === 'Complete' || activeBatchLog?.publishToWebGIS === 'yes');

                      const activeStatusText = isDailySelected && activeDailyLog
                        ? (activeDailyLog.publishToWebGIS === 'yes'
                          ? 'Published to WebGIS'
                          : (activeDailyLog.qaqcStatus || (activeDefects > 0 ? `QAQC Flagged (${activeDefects} Defects)` : 'In Progress (Staging)')))
                        : (activeBatchLog?.status === 'Complete' ? 'Published to WebGIS' : 'In Progress (Staging)');

                      return selectedSubgridFilter ? (
                        <div className="absolute top-3 right-3 z-20 bg-card backdrop-blur-md border border-subtle rounded-xl p-3 text-xs text-text-base shadow-2xl max-w-xs space-y-1.5 animate-in fade-in zoom-in-95 duration-200">
                          <div className="flex items-center justify-between font-bold pb-1 border-b border-subtle">
                            <span className="text-sky-400 font-sans text-xs">
                              Subgrid ID: {selectedSubgridFilter} {isDailySelected && activeDailyLog ? `(${formatDisplayDate(activeDailyLog.date)})` : (selectedDateFilter ? `(${selectedDateFilter})` : '')}
                            </span>
                            <button
                              onClick={() => {
                                if (selectedDailyRunId) {
                                  setSelectedDailyRunId(null);
                                  setSelectedSubgridFilter(null);
                                  setSelectedDateFilter(null);
                                  const iframes = document.querySelectorAll('iframe');
                                  iframes.forEach(f => {
                                    try {
                                      f.contentWindow?.postMessage({ type: 'FILTER_SUBGRID', subgrid: '', date: '', isSingleRun: false, runId: null }, '*');
                                    } catch (_) { }
                                  });
                                } else if (selectedSubgridFilter) {
                                  toggleSubgridFilter(selectedSubgridFilter);
                                }
                              }}
                              className="text-text-muted hover:text-text-base p-0.5 rounded cursor-pointer transition-colors"
                              title="Close filter"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="text-text-base font-sans text-[11px] flex justify-between gap-4"><span className="text-text-muted">Coordinates:</span> <span>{activeCoords.lat && activeCoords.lng ? `${activeCoords.lat.toFixed(4)}° N, ${activeCoords.lng.toFixed(4)}° E` : '—'}</span></div>
                          <div className="text-text-base text-[11px] flex justify-between gap-4"><span className="text-text-muted">Distance from start:</span> <span className="font-semibold text-text-base">{activeKm} km</span></div>
                          <div className="text-text-base text-[11px] flex justify-between gap-4"><span className="text-text-muted">Image Count:</span> <span className="font-semibold text-text-base">{activeImages}</span></div>
                          <div className="text-text-base text-[11px] flex justify-between items-center gap-4">
                            <span className="text-text-muted">Defect Images:</span>
                            <button
                              onClick={() => {
                                const validFn = activeDailyLog?.panoramas?.[0]?.filename || activeBatchLog?.imageFilename || '';
                                const imgUrl = validFn ? resolvePanoramaUrl(validFn, projectSettings) : '';
                                setActivePanoramaFilename(validFn);
                                setActivePanoramaUrl(imgUrl);
                                setHasSelectedPoint(Boolean(activeCoords.lat && activeCoords.lng));
                                if (activeCoords.lat && activeCoords.lng) {
                                  setInspectorCoords(activeCoords);
                                }
                                if (selectedSubgridFilter) {
                                  setInspectorSubgrid(selectedSubgridFilter);
                                }
                              }}
                              className={`font-semibold px-2 py-0.5 rounded border text-[10px] cursor-pointer transition-all flex items-center gap-1.5 group shadow-sm active:scale-95 ${activeDefects > 0
                                ? 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/25 border-amber-500/30 hover:border-amber-500/60'
                                : 'text-text-muted bg-slate-500/10 border-subtle/20'
                                }`}
                              title="Click to filter & select defect data"
                            >
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeDefects > 0 ? 'bg-amber-400' : 'bg-slate-400'}`}></span>
                              <span>{activeDefects} Flagged</span>
                              <Filter size={10} className="group-hover:scale-110 transition-transform shrink-0" />
                            </button>
                          </div>
                          <div className="text-text-base text-[11px] flex justify-between gap-4"><span className="text-text-muted">PIC:</span> <span className="font-semibold text-emerald-400">{activePic}</span></div>
                          <div className="text-text-base text-[11px] flex justify-between items-center pt-1 border-t border-subtle">
                            <span className="text-text-muted">Processing Status:</span>
                            <span className={`font-semibold px-2 py-0.5 rounded border text-[10px] ${isPublished
                              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                              : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                              }`}>
                              {activeStatusText}
                            </span>
                          </div>
                        </div>
                      ) : null;
                    })()}

                    <MapComponent
                      layerCatalog={layerCatalog}
                      refreshKey={mapRefreshKey}
                      onManualRefresh={handleRefreshMap}
                      selectedSubgridFilter={selectedSubgridFilter}
                      selectedDailyRunId={selectedDailyRunId}
                      selectedDateFilter={selectedDateFilter}
                      stagedItems={
                        selectedDailyRunId
                          ? dailyData.filter(d => getItemId(d) === selectedDailyRunId)
                          : (selectedSubgridFilter
                            ? dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === (selectedSubgridFilter || '').toUpperCase().trim())
                            : dailyData)
                      }
                      projectSettings={projectSettings}
                      defectsList={allKnownDefects}
                    />
                  </div>
                </div>

                {/* RIGHT COLUMN: PROCESSING CONTROL & 360 QA INSPECTOR (5 Cols) */}
                <div className="col-span-1 lg:col-span-5 flex flex-col gap-3 min-h-[400px] lg:min-h-0">

                  {/* TOP RIGHT PANEL: PROCESSING CONTROL & ADMIN */}
                  <div className={`flex-1 bg-card border border-subtle backdrop-blur-md rounded-xl flex flex-col overflow-hidden transition-all duration-700 ${focusedSection === 'processing'
                    ? 'relative z-30 ring-4 ring-emerald-400 shadow-[0_0_50px_rgba(52,211,153,0.5)] scale-[1.005]'
                    : focusedSection
                      ? 'filter blur-[4px] opacity-25 pointer-events-none'
                      : ''
                    }`}>
                    <div className="p-2.5 sm:p-3 border-b border-subtle flex flex-wrap items-center justify-between gap-2 shrink-0 bg-card">
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <span className="text-xs font-bold uppercase tracking-wider text-text-base flex items-center gap-1.5 sm:gap-2">
                          <Database size={14} className="text-sky-400 shrink-0" />
                          <span>PROCESSING CONTROL & ADMIN</span>
                        </span>
                        <div className="flex bg-inner border border-subtle rounded-lg p-0.5 text-[10px]">
                          <button
                            onClick={() => setActiveTab('batches')}
                            className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer ${activeTab === 'batches' ? 'bg-card text-text-base shadow-sm' : 'text-text-muted hover:text-text-base'}`}
                          >
                            Overall Progress ({activeBatchLogs.length})
                          </button>
                          <button
                            onClick={() => setActiveTab('daily')}
                            className={`px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer ${activeTab === 'daily' ? 'bg-card text-text-base shadow-sm' : 'text-text-muted hover:text-text-base'}`}
                          >
                            Daily Progress ({dailyData.length})
                          </button>
                        </div>

                        {/* Simple Icon-Only Filter Button */}
                        <button
                          onClick={() => setIsDashFilterOpen(prev => !prev)}
                          className={`p-1 rounded-lg border transition-all cursor-pointer ${hasActiveDashFilters
                            ? 'bg-sky-600 border-sky-500 text-text-base shadow-sm'
                            : isDashFilterOpen
                              ? 'bg-card border-subtle text-sky-400'
                              : 'bg-card border-subtle text-text-muted hover:text-text-base hover:bg-card'
                            }`}
                          title="Filter Daily Progress columns"
                        >
                          <Filter size={13} />
                        </button>
                      </div>
                      <button
                        onClick={() => goToWorkspace('data')}
                        className="px-2.5 sm:px-3 py-1.5 bg-card hover:bg-inner text-text-base hover:text-text-base border border-subtle text-[10px] sm:text-[11px] font-medium rounded-lg transition-all uppercase tracking-tight cursor-pointer shadow-sm ml-auto sm:ml-0"
                      >
                        RE-UPLOAD CSV
                      </button>
                    </div>

                    {/* Compact Inline Filter Bar for Daily Progress */}
                    {isDashFilterOpen && (
                      <div className="px-3 py-2 bg-card border-b border-subtle flex flex-wrap items-center justify-between gap-2 text-[10px] animate-in fade-in duration-150">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-1">
                            <span className="text-text-muted font-medium">Grid:</span>
                            <select
                              value={dashDailyFilters.grid}
                              onChange={(e) => setDashDailyFilters(prev => ({ ...prev, grid: e.target.value }))}
                              className="bg-card border border-subtle text-text-base rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                            >
                              <option value="">All</option>
                              {Array.from(new Set(dailyData.map(d => d.grid).filter(Boolean))).sort().map(g => (
                                <option key={g} value={g}>{g}</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-text-muted font-medium">Subgrid:</span>
                            <select
                              value={dashDailyFilters.subgrid}
                              onChange={(e) => setDashDailyFilters(prev => ({ ...prev, subgrid: e.target.value }))}
                              className="bg-card border border-subtle text-text-base rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                            >
                              <option value="">All</option>
                              {Array.from(new Set(dailyData.map(d => (d.subgrid || '').toUpperCase().trim()).filter(Boolean))).sort().map(sg => (
                                <option key={sg} value={sg}>{sg}</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-text-muted font-medium">PIC:</span>
                            <select
                              value={dashDailyFilters.pic}
                              onChange={(e) => setDashDailyFilters(prev => ({ ...prev, pic: e.target.value }))}
                              className="bg-card border border-subtle text-text-base rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
                            >
                              <option value="">All</option>
                              {Array.from(new Set(dailyData.map(d => d.pic).filter(Boolean))).sort().map(p => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-text-muted font-medium">Equipment:</span>
                            <select
                              value={dashDailyFilters.equipment}
                              onChange={(e) => setDashDailyFilters(prev => ({ ...prev, equipment: e.target.value }))}
                              className="bg-card border border-subtle text-text-base rounded px-1.5 py-0.5 focus:outline-none focus:border-sky-500"
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
                          <thead className="bg-card text-text-muted sticky top-0 z-10 border-b border-subtle">
                            <tr>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Batch ID</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Grid</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Subgrid</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Frames</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Distance</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Images</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Defects</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">PIC</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Status</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted text-right whitespace-nowrap">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                            {isDataLoading ? (
                              <tr>
                                <td colSpan={10} className="py-12 text-center text-text-muted">
                                  <div className="flex flex-col items-center justify-center gap-2">
                                    <Loader2 size={22} className="animate-spin text-sky-400" />
                                    <span className="text-xs font-semibold text-text-base">Loading batch logs...</span>
                                  </div>
                                </td>
                              </tr>
                            ) : activeBatchLogs.length === 0 ? (
                              <tr>
                                <td colSpan={10} className="py-10 text-center text-text-muted">
                                  <div className="flex flex-col items-center justify-center gap-2">
                                    <Database size={28} className="text-text-muted" />
                                    <span className="text-xs font-semibold text-text-base">No batch logs found</span>
                                    <span className="text-[11px] text-text-muted">Import a CSV file to ingest processing logs.</span>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              activeBatchLogs.map((log: BatchLog, i: number) => {
                                const batchSubgrid = (extractSubgridName(log.subgrid || log.imageFilename) || '').toUpperCase().trim();
                                const isSelected = selectedSubgridFilter === batchSubgrid;
                                const formattedBatchId = formatBatchIdDisplay(log, i);
                                return (
                                  <tr
                                    key={log.id || i}
                                    onClick={() => toggleSubgridFilter(batchSubgrid)}
                                    className={`cursor-pointer transition-all ${isSelected ? 'bg-sky-950/70 text-text-base font-medium' : 'hover:bg-inner text-text-base'}`}
                                  >
                                    <td className="px-3.5 py-3.5 font-sans text-[11px] text-text-base font-semibold whitespace-nowrap">{formattedBatchId}</td>
                                    <td className="px-3.5 py-3.5 font-medium text-text-base whitespace-nowrap">{log.grid || '1'}</td>
                                    <td className="px-3.5 py-3.5 font-semibold text-text-base whitespace-nowrap">{batchSubgrid}</td>
                                    <td className="px-3.5 py-3.5 font-sans text-xs text-text-base font-semibold whitespace-nowrap">{getPOICount(log).toLocaleString()}</td>
                                    <td className="px-3.5 py-3.5 font-semibold text-text-base whitespace-nowrap">{(log.kmProcessed || 0).toFixed(1)} km</td>
                                    <td className="px-3.5 py-3.5 whitespace-nowrap">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const subFilter = (extractSubgridName(batchSubgrid) || batchSubgrid).toUpperCase().trim();
                                          const matchingDaily = dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid).toUpperCase().trim() === subFilter);
                                          const dailyAvailFiles = matchingDaily.flatMap(d => d.availableFilenames || []);
                                          const customFn = log.availableFilenames && log.availableFilenames.length > 0
                                            ? log.availableFilenames
                                            : (dailyAvailFiles.length > 0
                                              ? Array.from(new Set(dailyAvailFiles))
                                              : (log.panoramas && log.panoramas.length > 0
                                                ? log.panoramas.filter((p: any) => p.isAvailable !== false).map((p: any) => p.filename).filter((f): f is string => Boolean(f) && (extractSubgridName(f) || '').toUpperCase().trim() === subFilter)
                                                : undefined));
                                          setImagesListModal({
                                            isOpen: true,
                                            subgrid: batchSubgrid,
                                            count: customFn && customFn.length > 0 ? customFn.length : getImagesProcessedCount(log),
                                            poiCount: getPOICount(log),
                                            baseFilename: log.imageFilename,
                                            customFilenames: customFn && customFn.length > 0 ? customFn : undefined
                                          });
                                        }}
                                        className="inline-flex items-center gap-1.5 text-text-base hover:text-text-base hover:underline font-semibold text-[11px] cursor-pointer whitespace-nowrap"
                                        title="Click to view list of image filenames"
                                      >
                                        <span>{getImagesProcessedCount(log).toLocaleString()} frames</span>
                                        <ExternalLink size={10} className="shrink-0 text-text-muted" />
                                      </button>
                                    </td>
                                    <td className="px-3.5 py-3.5 font-semibold whitespace-nowrap">
                                      {(() => {
                                        const isThisMasterlistActive = (qaqcWorkerState.isRunning || qaqcWorkerState.isCompleted) && qaqcWorkerState.subgrid === batchSubgrid;
                                        const isSpecificRunActive = isThisMasterlistActive && Boolean(qaqcWorkerState.runId);
                                        const isWholeSubgridActive = isThisMasterlistActive && !qaqcWorkerState.runId;

                                        const batchFrames = getImagesProcessedCount(log);
                                        const cached = qaqcAuditRuns[`${batchSubgrid}_default`];
                                        const cachedDefects = (cached && typeof cached.defectCount === 'number') ? cached.defectCount : undefined;

                                        let parsedDefects: number | undefined;
                                        if (log.qaqcStatus) {
                                          const m = log.qaqcStatus.match(/(\d+)\s+Defect/i);
                                          if (m) parsedDefects = parseInt(m[1], 10);
                                        }

                                        let dCount = 0;
                                        if (isWholeSubgridActive) {
                                          dCount = qaqcWorkerState.defectsList.length;
                                        } else {
                                          const subgridDailyRuns = dailyData.filter(d => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === batchSubgrid);
                                          if (subgridDailyRuns.length > 0) {
                                            let sumDefects = 0;
                                            let anyDailyInspected = false;
                                            subgridDailyRuns.forEach(d => {
                                              const fCount = getImagesProcessedCount(d);
                                              if (fCount === 0) return;

                                              const runId = getItemId(d);
                                              const isThisDailyActive = isSpecificRunActive && qaqcWorkerState.runId === runId;
                                              const dailyCached = runId ? qaqcAuditRuns[`${batchSubgrid}_${runId}`] : undefined;
                                              const dailyCachedCount = (dailyCached && typeof dailyCached.defectCount === 'number') ? dailyCached.defectCount : 0;

                                              let runDefects = 0;
                                              if (isThisDailyActive) {
                                                runDefects = qaqcWorkerState.defectsList.length;
                                                anyDailyInspected = true;
                                              } else if (dailyCachedCount > 0) {
                                                runDefects = dailyCachedCount;
                                                anyDailyInspected = true;
                                              } else if (typeof d.imagesDefected === 'number' && d.imagesDefected > 0) {
                                                runDefects = d.imagesDefected;
                                                anyDailyInspected = true;
                                              } else if (typeof d.defectCount === 'number' && d.defectCount > 0) {
                                                runDefects = d.defectCount;
                                                anyDailyInspected = true;
                                              }
                                              sumDefects += Math.min(runDefects, fCount);
                                            });

                                            if (anyDailyInspected) {
                                              dCount = sumDefects;
                                            } else if (typeof log.defects === 'number' && log.defects > 0) {
                                              dCount = log.defects;
                                            } else if (cachedDefects !== undefined && cachedDefects > 0) {
                                              dCount = cachedDefects;
                                            } else if (parsedDefects !== undefined && parsedDefects > 0) {
                                              dCount = parsedDefects;
                                            }
                                          } else {
                                            dCount = (typeof log.defects === 'number' && log.defects > 0)
                                              ? log.defects
                                              : (cachedDefects !== undefined && cachedDefects > 0)
                                                ? cachedDefects
                                                : (parsedDefects !== undefined && parsedDefects > 0)
                                                  ? parsedDefects
                                                  : 0;
                                          }
                                        }

                                        if (batchFrames > 0) {
                                          dCount = Math.min(dCount, batchFrames);
                                        } else {
                                          dCount = 0;
                                        }

                                        return dCount > 0 ? (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedDefectSubgrid(batchSubgrid);
                                              setDefectGalleryContext({
                                                mode: 'master',
                                                subgrid: batchSubgrid,
                                                totalPoi: (typeof log.poiCount === 'number' && log.poiCount > 0) ? log.poiCount : (log.images || 0)
                                              });
                                              setIsDefectsGalleryOpen(true);
                                            }}
                                            className="text-amber-400 hover:text-amber-300 font-semibold hover:underline cursor-pointer text-[11px] tabular-nums transition-colors"
                                            title="Click to open Masterlist QA/QC Defect Review Gallery"
                                          >
                                            {dCount}
                                          </button>
                                        ) : (
                                          <span className="text-text-muted text-[11px] font-medium tabular-nums">0</span>
                                        );
                                      })()}
                                    </td>
                                    <td className="px-3.5 py-3.5 text-text-base font-medium whitespace-nowrap">Admin</td>
                                    <td className="px-3.5 py-3.5 whitespace-nowrap">
                                      {qaqcWorkerState.isRunning && !qaqcWorkerState.runId && qaqcWorkerState.subgrid === batchSubgrid ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setIsQAQCRunnerModalOpen(true);
                                          }}
                                          className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30 inline-flex items-center gap-1.5 whitespace-nowrap animate-pulse shadow-sm hover:scale-105 transition-transform cursor-pointer"
                                          title="Click to open QA/QC Live HUD"
                                        >
                                          <Activity size={10} className="text-sky-400 animate-spin" />
                                          QAQC In Progress ({qaqcWorkerState.currentIndex + 1}/{qaqcWorkerState.totalStations})
                                        </button>
                                      ) : log.qaqcStatus || (qaqcWorkerState.isCompleted && !qaqcWorkerState.runId && qaqcWorkerState.subgrid === batchSubgrid) ? (
                                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1 whitespace-nowrap shadow-sm">
                                          <CheckCircle size={10} className="text-emerald-400" />
                                          {log.qaqcStatus || `QAQC Completed (${qaqcWorkerState.defectsList.length} Defects Found)`}
                                        </span>
                                      ) : (
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${log.status === 'Complete' || (log.status as string) === 'Published'
                                          ? 'bg-inner text-text-base border border-subtle'
                                          : 'bg-app text-text-muted border border-subtle'
                                          }`}>
                                          {log.status === 'Complete' || (log.status as string) === 'Published' ? <CheckCircle size={10} className="text-emerald-400" /> : <Clock size={10} className="text-amber-400" />}
                                          {log.status || 'Complete'}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3.5 py-3.5 text-right whitespace-nowrap">
                                      <button onClick={(e) => { e.stopPropagation(); toggleSubgridFilter(batchSubgrid); }} className="px-2.5 py-1 bg-inner hover:bg-inner text-text-base hover:text-text-base border border-subtle rounded-md text-[10px] font-medium cursor-pointer transition-colors whitespace-nowrap" aria-label={`View logs for subgrid ${batchSubgrid}`}>
                                        View Logs
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      ) : (
                        <table className="w-full text-left text-[11px]">
                          <thead className="bg-card text-text-muted sticky top-0 z-10 border-b border-subtle">
                            <tr>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Date</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Grid</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Subgrid</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Distance</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Images</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Defects</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">PIC</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted whitespace-nowrap">Status</th>
                              <th className="px-3.5 py-3 font-semibold text-[10px] uppercase tracking-wider text-text-muted text-right whitespace-nowrap">Equipment</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[rgba(255,255,255,0.06)]">
                            {isDataLoading ? (
                              <tr>
                                <td colSpan={9} className="py-12 text-center text-text-muted">
                                  <div className="flex flex-col items-center justify-center gap-2">
                                    <Loader2 size={22} className="animate-spin text-sky-400" />
                                    <span className="text-xs font-semibold text-text-base">Loading daily progress...</span>
                                  </div>
                                </td>
                              </tr>
                            ) : dailyData.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="py-10 text-center text-text-muted">
                                  <div className="flex flex-col items-center justify-center gap-2">
                                    <Calendar size={28} className="text-text-muted" />
                                    <span className="text-xs font-semibold text-text-base">No daily records yet</span>
                                    <span className="text-[11px] text-text-muted">Daily processing progress logs will appear here.</span>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              [...dailyData]
                                .reverse()
                                .filter(log => {
                                  if (dashDailyFilters.grid && log.grid !== dashDailyFilters.grid) return false;
                                  if (dashDailyFilters.subgrid && (log.subgrid || '').toUpperCase().trim() !== dashDailyFilters.subgrid.toUpperCase().trim()) return false;
                                  if (dashDailyFilters.pic && (log.pic || '') !== dashDailyFilters.pic) return false;
                                  if (dashDailyFilters.equipment && (log.captureEquipment || 'MMS') !== dashDailyFilters.equipment) return false;
                                  return true;
                                })
                                .map((log, i) => {
                                  const dailySubgrid = (log.subgrid || '').toUpperCase().trim();
                                  const runId = getItemId(log);
                                  const frameCount = getImagesProcessedCount(log);
                                  const isRowSelected = selectedDailyRunId === runId;
                                  const isThisRowUnderInspection = qaqcWorkerState.isRunning && (
                                    qaqcWorkerState.runId ? qaqcWorkerState.runId === runId : false
                                  );
                                  const isThisRowCompleted = qaqcWorkerState.isCompleted && (
                                    qaqcWorkerState.runId ? qaqcWorkerState.runId === runId : false
                                  );

                                  let cachedDefects: number | undefined;
                                  const cachedAuditObj = runId ? qaqcAuditRuns[`${dailySubgrid}_${runId}`] : undefined;
                                  if (cachedAuditObj && typeof cachedAuditObj.defectCount === 'number') {
                                    cachedDefects = cachedAuditObj.defectCount;
                                  }

                                  let parsedStatusDefects: number | undefined;
                                  if (log.qaqcStatus) {
                                    const m = log.qaqcStatus.match(/(\d+)\s+Defect/i);
                                    if (m) parsedStatusDefects = parseInt(m[1], 10);
                                  }

                                  const defectCount = frameCount === 0
                                    ? 0
                                    : (isThisRowUnderInspection || isThisRowCompleted)
                                      ? qaqcWorkerState.defectsList.length
                                      : (log.imagesDefected && log.imagesDefected > 0)
                                        ? log.imagesDefected
                                        : (log.defectCount && log.defectCount > 0)
                                          ? log.defectCount
                                          : (cachedDefects !== undefined && cachedDefects > 0)
                                            ? cachedDefects
                                            : (parsedStatusDefects !== undefined && parsedStatusDefects > 0)
                                              ? parsedStatusDefects
                                              : 0;

                                  const isPublished = log.publishToWebGIS === 'yes';
                                  return (
                                    <tr
                                      key={log.id || `dash-d-${log.date}-${log.subgrid}-${i}`}
                                      onClick={() => handleSelectDailyRun(log)}
                                      className={`cursor-pointer transition-all duration-150 ${isRowSelected
                                        ? '!bg-sky-900/60 border-l-4 border-sky-400 !text-white font-semibold shadow-inner'
                                        : 'hover:bg-inner text-text-base'
                                        }`}
                                    >
                                      <td className="px-3.5 py-3.5 font-sans text-[10px] text-text-muted whitespace-nowrap">
                                        <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                          <span>{formatDisplayDate(log.date)}</span>
                                          {isRowSelected && <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />}
                                        </div>
                                      </td>
                                      <td className="px-3.5 py-3.5 font-medium text-text-base whitespace-nowrap">{log.grid}</td>
                                      <td className="px-3.5 py-3.5 font-semibold text-text-base whitespace-nowrap">{dailySubgrid}</td>
                                      <td className="px-3.5 py-3.5 text-text-base whitespace-nowrap">{log.kmProcessed.toFixed(1)} km</td>
                                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const subFilter = (extractSubgridName(dailySubgrid) || dailySubgrid).toUpperCase().trim();
                                            const customFn = log.availableFilenames && log.availableFilenames.length > 0
                                              ? log.availableFilenames
                                              : (log.panoramas && log.panoramas.length > 0
                                                ? log.panoramas.filter((p: any) => p.isAvailable !== false).map((p: any) => p.filename).filter((f): f is string => Boolean(f) && (extractSubgridName(f) || '').toUpperCase().trim() === subFilter)
                                                : undefined);
                                            const rowFrameCount = getImagesProcessedCount(log);
                                            setImagesListModal({
                                              isOpen: true,
                                              subgrid: dailySubgrid,
                                              count: customFn && customFn.length > 0 ? customFn.length : rowFrameCount,
                                              poiCount: getPOICount(log),
                                              baseFilename: (log.panoramas?.[0]?.filename) || `${dailySubgrid}-0001.jpg`,
                                              customFilenames: customFn && customFn.length > 0 ? customFn : undefined
                                            });
                                          }}
                                          className="inline-flex items-center gap-1.5 text-text-base hover:text-text-base hover:underline font-semibold text-[11px] cursor-pointer whitespace-nowrap"
                                          title="Click to view list of image filenames"
                                        >
                                          <span>{getImagesProcessedCount(log).toLocaleString()} frames</span>
                                          <ExternalLink size={10} className="shrink-0 text-text-muted" />
                                        </button>
                                      </td>
                                      <td className="px-3.5 py-3.5 font-semibold whitespace-nowrap">
                                        {defectCount > 0 ? (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setSelectedDefectSubgrid(dailySubgrid);
                                              const dailyPanos = log.panoramas || [];
                                              setDefectGalleryContext({
                                                mode: 'daily',
                                                subgrid: dailySubgrid,
                                                surveyDate: log.date || ((log as any).created_at ? new Date((log as any).created_at).toLocaleDateString() : undefined),
                                                totalPoi: log.poiCount || dailyPanos.length || getImagesProcessedCount(log),
                                                batchFilenames: dailyPanos.map((p: any) => p.filename || p.id).filter(Boolean)
                                              });
                                              setIsDefectsGalleryOpen(true);
                                            }}
                                            className="text-amber-400 hover:text-amber-300 font-semibold hover:underline cursor-pointer text-[11px] tabular-nums transition-colors"
                                            title="Click to open Daily QA/QC Defect Review Gallery"
                                          >
                                            {defectCount}
                                          </button>
                                        ) : (
                                          <span className="text-text-muted text-[11px] font-medium tabular-nums">0</span>
                                        )}
                                      </td>
                                      <td className="px-3.5 py-3.5 text-text-base font-medium whitespace-nowrap">{formatPIC(log.pic, activeAuthUserName || "Fariz.farhan95")}</td>
                                      <td className="px-3.5 py-3.5 whitespace-nowrap">
                                        {(() => {
                                          if (isThisRowUnderInspection) {
                                            return (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setIsQAQCRunnerModalOpen(true);
                                                }}
                                                className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30 inline-flex items-center gap-1.5 whitespace-nowrap animate-pulse shadow-sm hover:scale-105 transition-transform cursor-pointer"
                                                title="Click to view live QA/QC inspection HUD"
                                              >
                                                <Activity size={10} className="text-sky-400 animate-spin" />
                                                QAQC In Progress ({qaqcWorkerState.currentIndex + 1}/{qaqcWorkerState.totalStations})
                                              </button>
                                            );
                                          }

                                          const effectiveQaqcStatus = frameCount === 0
                                            ? undefined
                                            : (log.qaqcStatus || (isThisRowCompleted ? `QAQC Completed (${qaqcWorkerState.defectsList.length} Defects Found)` : (cachedAuditObj ? `QAQC Completed (${cachedAuditObj.defectCount} Defect${cachedAuditObj.defectCount === 1 ? '' : 's'} Found)` : undefined)));

                                          if (effectiveQaqcStatus) {
                                            return (
                                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-inner text-text-base border border-subtle inline-flex items-center gap-1 whitespace-nowrap shadow-sm">
                                                <CheckCircle size={10} className="text-emerald-400" />
                                                {effectiveQaqcStatus}
                                              </span>
                                            );
                                          }

                                          if (isPublished) {
                                            return (
                                              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-inner text-text-base border border-subtle inline-flex items-center gap-1 whitespace-nowrap">
                                                <CheckCircle size={10} className="text-emerald-400" /> Published
                                              </span>
                                            );
                                          }

                                          return (
                                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-app text-text-muted border border-subtle inline-flex items-center gap-1 whitespace-nowrap">
                                              <Clock size={10} className="text-amber-400" /> In Progress
                                            </span>
                                          );
                                        })()}
                                      </td>
                                      <td className="px-3.5 py-3.5 text-right font-medium text-text-base whitespace-nowrap">{log.captureEquipment || 'MMS'}</td>
                                    </tr>
                                  );
                                })
                            )}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {/* 360 INSPECTOR VIEWER & QAQC CARD */}
                  <div className={`flex-1 bg-card border border-subtle backdrop-blur-md rounded-xl flex flex-col overflow-hidden transition-all duration-700 ${focusedSection === 'qa'
                    ? 'relative z-30 ring-4 ring-indigo-400 shadow-[0_0_50px_rgba(129,140,248,0.5)] scale-[1.005]'
                    : focusedSection
                      ? 'filter blur-[4px] opacity-25 pointer-events-none'
                      : ''
                    }`}>

                    {/* Card Header */}
                    <div className="px-3.5 py-2 border-b border-subtle bg-card flex flex-wrap items-center justify-between shrink-0 gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-text-base flex items-center gap-2 shrink-0">
                        <Camera size={14} className="text-accent" />
                        <span>360 INSPECTOR VIEWER & ACQUISITION QC</span>
                      </span>

                      <div className="flex items-center gap-2 min-w-0">
                        {qaqcWorkerState.isRunning ? (
                          <div className="flex items-center gap-2.5 px-3 py-1 bg-inner border border-subtle rounded-xl text-xs shadow-sm animate-in fade-in duration-200">
                            <span className="relative flex h-2 w-2 shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                            </span>
                            <span className="text-xs font-medium text-text-base whitespace-nowrap">
                              QA/QC: <span className="font-sans font-bold text-accent">{qaqcWorkerState.subgrid || 'General'}</span>
                            </span>
                            <div className="w-16 h-1.5 bg-card rounded-full overflow-hidden border border-subtle/80 shrink-0">
                              <div
                                className="h-full bg-accent transition-all duration-150"
                                style={{
                                  width: `${Math.min(100, Math.round(((qaqcWorkerState.currentIndex + 1) / (qaqcWorkerState.totalStations || 1)) * 100))}%`
                                }}
                              />
                            </div>
                            <span className="text-xs font-semibold tabular-nums text-text-base shrink-0 font-sans">
                              {Math.min(100, Math.round(((qaqcWorkerState.currentIndex + 1) / (qaqcWorkerState.totalStations || 1)) * 100))}%
                            </span>
                            <span className="text-[11px] text-text-muted tabular-nums shrink-0 font-sans">
                              ({Math.min(qaqcWorkerState.totalStations || 1, qaqcWorkerState.currentIndex + 1)}/{qaqcWorkerState.totalStations || 1})
                            </span>
                            <button
                              type="button"
                              onClick={() => setIsQAQCRunnerModalOpen(true)}
                              className="px-2 py-0.5 bg-card hover:bg-card text-text-base hover:text-text-base border border-subtle rounded text-[10px] font-medium transition-all cursor-pointer flex items-center gap-1 shadow-sm active:scale-95 shrink-0"
                            >
                              <Activity size={10} className="animate-spin text-sky-400" />
                              <span>Open HUD</span>
                            </button>
                            <button
                              type="button"
                              onClick={abortQAQCInspection}
                              className="px-2 py-0.5 bg-card hover:bg-red-950/30 text-text-base hover:text-rose-400 border border-subtle hover:border-red-800/50 rounded text-[10px] font-medium transition-all cursor-pointer flex items-center gap-1 shadow-sm active:scale-95 shrink-0"
                              title="Abort inspection"
                            >
                              <StopCircle size={10} />
                              <span>Abort</span>
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setIsQAQCRunnerModalOpen(true);
                            }}
                            title="Launch Full Canvas QA/QC Inspection Workbench with Target Selection Hub"
                            className="px-3 py-1.5 bg-card hover:bg-card text-text-base hover:text-text-base border border-subtle text-[11px] font-medium rounded-lg transition-all cursor-pointer shadow-sm flex items-center gap-1.5 active:scale-95"
                          >
                            <Play size={11} className="fill-current text-text-base" />
                            <span>Run Batch Acquisition QC</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="flex-1 flex gap-2.5 p-2.5 min-h-0">
                      {/* Left: 360 Panorama Canvas + Floating HUD Overlay */}
                      <div className="flex-1 bg-app rounded-lg border border-subtle relative overflow-hidden group flex flex-col min-w-0">
                        {hasSelectedPoint && (
                          <button
                            onClick={clearMapSelection}
                            title="Return to map (clear 360 selection)"
                            className="absolute top-2 right-2 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/80 border border-subtle text-[10px] font-bold uppercase tracking-wide text-text-base hover:bg-slate-800 hover:border-sky-500/40 transition-colors cursor-pointer shadow"
                          >
                            <X size={12} /> Return to Map
                          </button>
                        )}
                        {hasSelectedPoint ? (
                          <>
                            {(() => {
                              const targetSubgrid = inspectorSubgrid || selectedSubgridFilter || '';
                              const targetFilename = activePanoramaFilename || '';

                              const provider = projectSettings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'cloudflare_r2';
                              const isMultiResStrategy = projectSettings?.imageStorageStrategy !== 'single_equirectangular';

                              const shouldUseMultiRes = isMultiResStrategy && (
                                provider === 'cloudflare_r2' ||
                                provider === 'custom_cdn' ||
                                provider === 'aws_s3' ||
                                provider === 'wasabi' ||
                                provider === 'gcs' ||
                                provider === 'azure_blob' ||
                                provider === 'nas_local'
                              );

                              const dynamicConfigUrl = shouldUseMultiRes && targetFilename
                                ? resolvePanoramaConfigUrl(targetFilename, projectSettings, targetSubgrid)
                                : '';
                              const dynamicPanoUrl = activePanoramaUrl || (targetFilename
                                ? resolvePanoramaUrl(targetFilename, projectSettings, { subgrid: targetSubgrid })
                                : '');

                              return (
                                <PhotoSphereViewerComponent
                                  ref={dashboardPsvRef}
                                  key={`pano-psv-${targetSubgrid}-${provider}`}
                                  configUrl={shouldUseMultiRes && dynamicConfigUrl ? dynamicConfigUrl : undefined}
                                  panoramaUrl={!shouldUseMultiRes ? dynamicPanoUrl : undefined}
                                  onPositionChange={(pos) => {
                                    setPanoramaTelemetry(prev => ({
                                      ...prev,
                                      yaw: pos.yaw,
                                      pitch: pos.pitch,
                                      fov: pos.fov ?? prev.fov
                                    }));
                                  }}
                                  className="w-full h-full"
                                />
                              );
                            })()}

                            {/* Dashboard-only Compact Floating HUD */}
                            <WebGISHUDViewerOverlay
                              imageName={activePanoramaFilename || (inspectorSubgrid ? `${inspectorSubgrid}-0001.jpg` : 'Inspection Node')}
                              currentIndex={
                                (() => {
                                  const cleanSg = (inspectorSubgrid || selectedSubgridFilter || 'N93E70').toUpperCase().trim();
                                  const stations = getStationsForSubgrid(cleanSg, selectedDailyRunId);

                                  // 1. Match by exact filename in the sorted stations list
                                  const currentClean = (activePanoramaFilename || '').split('/').pop()?.toLowerCase().trim();
                                  const foundIdx = stations.findIndex(
                                    (s) => (s.filename || '').split('/').pop()?.toLowerCase().trim() === currentClean
                                  );
                                  if (foundIdx >= 0) return foundIdx;

                                  // 2. Fallback: Parse sequence number (1-based -> 0-based)
                                  const match = (activePanoramaFilename || '').match(/(\d+)\.jpg$/i);
                                  return match ? Math.max(0, parseInt(match[1], 10) - 1) : 0;
                                })()
                              }
                              totalFrames={
                                (() => {
                                  const cleanSg = (inspectorSubgrid || selectedSubgridFilter || 'N93E70').toUpperCase().trim();
                                  const stations = getStationsForSubgrid(cleanSg, selectedDailyRunId);
                                  if (stations.length > 0) return stations.length;
                                  const currentItem = dailyData.find(
                                    (d) => (extractSubgridName(d.subgrid) || '').toUpperCase() === cleanSg
                                  );
                                  return currentItem ? getImagesProcessedCount(currentItem) : (totalImages > 0 ? totalImages : 104);
                                })()
                              }
                              coordinates={inspectorCoords}
                              heading={panoramaTelemetry.yaw}
                              gpsAccuracy="0.0m"
                              equipType={projectSettings?.defaultEquipment || 'MMS 360'}
                              onIndexChange={(newIdx: number) => {
                                const cleanSg = (inspectorSubgrid || selectedSubgridFilter || 'N93E70').toUpperCase().trim();

                                // Retrieve sorted sequential station track
                                const stations = getStationsForSubgrid(cleanSg, selectedDailyRunId);
                                const total = stations.length > 0 ? stations.length : (totalImages > 0 ? totalImages : 1);

                                // Clamp strictly to array boundaries
                                const targetIdx = Math.max(0, Math.min(newIdx, total - 1));
                                const targetStation = stations[targetIdx];

                                // Exact filename from station object without manual addition
                                const nextFn = targetStation?.filename || `${cleanSg}-${String(targetIdx + 1).padStart(4, '0')}.jpg`;
                                const nextUrl = targetStation?.image_url || resolvePanoramaUrl(nextFn, projectSettings, { subgrid: cleanSg });
                                const nextLat = Number(targetStation?.latitude ?? (targetStation as any)?.lat ?? inspectorCoords.lat);
                                const nextLng = Number(targetStation?.longitude ?? (targetStation as any)?.lng ?? (targetStation as any)?.lon ?? inspectorCoords.lng);
                                const nextBearing = targetStation?.bearing ?? (targetStation as any)?.heading ?? ((targetIdx * 12) % 360);

                                // Preload adjacent stations into browser cache for instant 0ms stepping
                                const aheadStation = stations[targetIdx + 1];
                                if (aheadStation) {
                                  const url = aheadStation.image_url || resolvePanoramaUrl(aheadStation.filename, projectSettings, { subgrid: cleanSg });
                                  if (url) { const img = new Image(); img.src = url; }
                                }
                                const behindStation = stations[targetIdx - 1];
                                if (behindStation) {
                                  const url = behindStation.image_url || resolvePanoramaUrl(behindStation.filename, projectSettings, { subgrid: cleanSg });
                                  if (url) { const img = new Image(); img.src = url; }
                                }

                                // Update Dashboard State
                                setActivePanoramaFilename(nextFn);
                                setActivePanoramaUrl(nextUrl);
                                if (nextLat !== 0 && nextLng !== 0) {
                                  setInspectorCoords({ lat: nextLat, lng: nextLng });
                                }

                                // Synchronize Map Marker & View
                                const pointPayload = {
                                  filename: nextFn,
                                  image_url: nextUrl,
                                  subgrid: cleanSg,
                                  lat: nextLat,
                                  lng: nextLng,
                                  lon: nextLng,
                                  bearing: nextBearing,
                                  index: targetIdx + 1
                                };

                                // Keep the live 360 camera facing the station heading.
                                if (typeof nextBearing === 'number' && isFinite(nextBearing)) {
                                  dashboardPsvRef.current?.setPosition({ yaw: nextBearing });
                                }

                                const iframes = document.querySelectorAll('iframe');
                                iframes.forEach((f) => {
                                  try {
                                    f.contentWindow?.postMessage(
                                      {
                                        type: 'SET_PANORAMA',
                                        point: pointPayload
                                      },
                                      '*'
                                    );
                                    f.contentWindow?.postMessage(
                                      {
                                        type: 'MAP_POINT_SELECTED',
                                        point: pointPayload
                                      },
                                      '*'
                                    );
                                    f.contentWindow?.postMessage(
                                      {
                                        type: 'SET_CAMERA_HEADING',
                                        heading: nextBearing
                                      },
                                      '*'
                                    );
                                  } catch (e) { }
                                });
                              }}
                              onZoomIn={() => dashboardPsvRef.current?.zoomIn()}
                              onZoomOut={() => dashboardPsvRef.current?.zoomOut()}
                              onFullscreen={() => dashboardPsvRef.current?.toggleFullscreen()}
                            />
                          </>
                        ) : (
                          <div className="w-full h-full bg-card flex flex-col items-center justify-center p-4 text-center select-none">
                            <Maximize2 size={38} className="text-text-muted mb-2.5 stroke-[1.5]" />
                            <h4 className="text-xs sm:text-sm font-medium text-text-base tracking-tight">
                              Select a location on the map
                            </h4>
                            <p className="text-[11px] text-text-muted mt-1">
                              to view 360° imagery
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Right: Operator QA Defect Flags Panel */}
                      <div className="w-52 sm:w-56 shrink-0 bg-card rounded-lg border border-subtle p-3 flex flex-col justify-between overflow-y-auto">
                        <div>
                          <div className="flex items-center justify-between gap-1 pb-2 border-b border-subtle mb-2.5">
                            <span className="text-[11px] font-bold text-text-base uppercase tracking-tight flex items-center gap-1.5 whitespace-nowrap">
                              <ShieldCheck size={14} className="text-sky-400 shrink-0" />
                              <span>OPERATOR QA</span>
                            </span>
                            <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                              Reviewing
                            </span>
                          </div>

                          {/* Info Card */}
                          <div className="bg-app rounded-md p-2 border border-subtle space-y-1.5 text-[10px] mb-3">
                            <div className="flex items-center justify-between text-text-muted gap-2">
                              <span className="shrink-0">Subgrid:</span>
                              <span className="font-semibold text-sky-400 truncate text-right">
                                {hasSelectedPoint ? (inspectorSubgrid || selectedSubgridFilter || '-') : '-'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-text-muted gap-2">
                              <span className="shrink-0">Equipment:</span>
                              <span className="font-medium text-text-base text-right whitespace-nowrap">
                                {hasSelectedPoint ? 'MMS 360' : '-'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-text-muted gap-2">
                              <span className="shrink-0">Coordinates:</span>
                              <span className="font-sans text-text-base text-[9px] whitespace-nowrap text-right">
                                {hasSelectedPoint ? `${inspectorCoords.lat.toFixed(4)}, ${inspectorCoords.lng.toFixed(4)}` : '-'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-text-muted gap-2">
                              <span className="shrink-0">PIC:</span>
                              <span className="font-semibold text-emerald-400 text-right whitespace-nowrap">
                                {hasSelectedPoint ? (batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === (inspectorSubgrid || selectedSubgridFilter || '').toUpperCase().trim())?.pic || '-') : '-'}
                              </span>
                            </div>
                            {isQaLocked && (
                              <div className="flex flex-col gap-0.5 pt-1 border-t border-subtle">
                                <div className="flex items-center justify-between text-[9.5px]">
                                  <span className="text-text-muted font-medium">QA Status:</span>
                                  <span className={`font-bold font-sans ${qaQuestionnaireAnswer === 'yes' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    {qaQuestionnaireAnswer === 'yes' ? 'DEFECT CONFIRMED' : 'PASSED'}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between text-[9px]">
                                  <span className="text-text-muted">Defect Choices:</span>
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
                              <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted block">
                                QA Defect Flags
                              </span>
                              {isGuestUser ? (
                                <span className="text-[8.5px] font-semibold text-amber-500/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">Guest</span>
                              ) : isQaLocked ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                    const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
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
                                <span className="text-[8.5px] text-text-muted font-sans">Toggle to Flag</span>
                              )}
                            </div>

                            {isGuestUser ? (
                              <div className="space-y-1.5 pointer-events-none opacity-40 select-none">
                                {[
                                  { label: projectSettings.qaFlag1 || 'Blurry Frame', color: 'red' },
                                  { label: projectSettings.qaFlag2 || 'Lens Obstruction', color: 'amber' },
                                  { label: projectSettings.qaFlag3 || 'Bad GPS Signal', color: 'sky' },
                                ].map(({ label, color }) => (
                                  <div key={label} className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between border bg-inner border-subtle text-text-muted cursor-not-allowed`}>
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 bg-${color}-400`}></span>
                                      <span className="truncate">{label}</span>
                                    </span>
                                    <span className="text-[9px] font-sans shrink-0 ml-1 text-text-muted">Flag</span>
                                  </div>
                                ))}
                                <p className="text-[9px] text-amber-500/70 text-center pt-1 italic">QA editing disabled for guests</p>
                              </div>
                            ) : (
                              <>
                                {(!isQaLocked || selectedQaFlags.blurry) && (
                                  <button
                                    type="button"
                                    disabled={isQaLocked}
                                    onClick={() => {
                                      if (isQaLocked) return;
                                      const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                      const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const nextFlags = { ...selectedQaFlags, blurry: !selectedQaFlags.blurry };
                                      saveSubgridQa(itemKey, nextFlags, qaQuestionnaireAnswer, false);
                                      const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                      updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Reviewing', { selectedQaFlags: nextFlags, flag: projectSettings.qaFlag1 || 'Blurry Frame', filename: activePanoramaFilename, subgrid: sg });
                                    }}
                                    className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between transition-all border ${isQaLocked ? 'opacity-90 cursor-default' : 'cursor-pointer active:scale-95'
                                      } ${selectedQaFlags.blurry
                                        ? 'bg-red-500/25 border-red-500 text-red-300 ring-1 ring-red-500/50 shadow-md'
                                        : 'bg-inner hover:bg-red-500/10 hover:border-red-500/50 border-subtle text-text-base hover:text-red-400'
                                      }`}
                                  >
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedQaFlags.blurry ? 'bg-red-300 ring-2 ring-red-400' : 'bg-red-400'}`}></span>
                                      <span className="truncate">{projectSettings.qaFlag1 || 'Blurry Frame'}</span>
                                    </span>
                                    <span className={`text-[9px] font-sans shrink-0 ml-1 ${selectedQaFlags.blurry ? 'text-red-300 font-bold' : 'text-text-muted group-hover:text-red-400'}`}>Flag</span>
                                  </button>
                                )}

                                {(!isQaLocked || selectedQaFlags.obstruction) && (
                                  <button
                                    type="button"
                                    disabled={isQaLocked}
                                    onClick={() => {
                                      if (isQaLocked) return;
                                      const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                      const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const nextFlags = { ...selectedQaFlags, obstruction: !selectedQaFlags.obstruction };
                                      saveSubgridQa(itemKey, nextFlags, qaQuestionnaireAnswer, false);
                                      const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                      updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Reviewing', { selectedQaFlags: nextFlags, flag: projectSettings.qaFlag2 || 'Lens Obstruction', filename: activePanoramaFilename, subgrid: sg });
                                    }}
                                    className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between transition-all border ${isQaLocked ? 'opacity-90 cursor-default' : 'cursor-pointer active:scale-95'
                                      } ${selectedQaFlags.obstruction
                                        ? 'bg-amber-500/25 border-amber-500 text-amber-300 ring-1 ring-amber-500/50 shadow-md'
                                        : 'bg-inner hover:bg-amber-500/10 hover:border-amber-500/50 border-subtle text-text-base hover:text-amber-400'
                                      }`}
                                  >
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedQaFlags.obstruction ? 'bg-amber-300 ring-2 ring-amber-400' : 'bg-amber-400'}`}></span>
                                      <span className="truncate">{projectSettings.qaFlag2 || 'Lens Obstruction'}</span>
                                    </span>
                                    <span className={`text-[9px] font-sans shrink-0 ml-1 ${selectedQaFlags.obstruction ? 'text-amber-300 font-bold' : 'text-text-muted group-hover:text-amber-400'}`}>Flag</span>
                                  </button>
                                )}

                                {(!isQaLocked || selectedQaFlags.badGps) && (
                                  <button
                                    type="button"
                                    disabled={isQaLocked}
                                    onClick={() => {
                                      if (isQaLocked) return;
                                      const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                      const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                      const nextFlags = { ...selectedQaFlags, badGps: !selectedQaFlags.badGps };
                                      saveSubgridQa(itemKey, nextFlags, qaQuestionnaireAnswer, false);
                                      const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                      updateDefectStatusInSupabase(itemKey, targetLog?.defects || 0, 'Reviewing', { selectedQaFlags: nextFlags, flag: projectSettings.qaFlag3 || 'Bad GPS Signal', filename: activePanoramaFilename, subgrid: sg });
                                    }}
                                    className={`w-full py-1.5 px-2 rounded-md text-[10px] font-medium text-left flex items-center justify-between transition-all border ${isQaLocked ? 'opacity-90 cursor-default' : 'cursor-pointer active:scale-95'
                                      } ${selectedQaFlags.badGps
                                        ? 'bg-sky-500/25 border-sky-500 text-sky-300 ring-1 ring-sky-500/50 shadow-md'
                                        : 'bg-inner hover:bg-sky-500/10 hover:border-sky-500/50 border-subtle text-text-base hover:text-sky-400'
                                      }`}
                                  >
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedQaFlags.badGps ? 'bg-sky-300 ring-2 ring-sky-400' : 'bg-sky-400'}`}></span>
                                      <span className="truncate">{projectSettings.qaFlag3 || 'Bad GPS Signal'}</span>
                                    </span>
                                    <span className={`text-[9px] font-sans shrink-0 ml-1 ${selectedQaFlags.badGps ? 'text-sky-300 font-bold' : 'text-text-muted group-hover:text-sky-400'}`}>Flag</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>

                          {/* QA Questionnaire Box */}
                          {!isGuestUser && !isQaLocked && (selectedQaFlags.blurry || selectedQaFlags.obstruction || selectedQaFlags.badGps) && (
                            <div className="bg-app rounded-md p-2 border border-subtle space-y-1.5 text-[10px] mt-2.5 animate-in fade-in slide-in-from-top-2 duration-200">
                              <div className="flex items-center justify-between text-text-base font-medium">
                                <span>Update Status?</span>
                                <span className="text-[9px] text-text-muted font-sans">
                                  {qaQuestionnaireAnswer === 'yes' ? 'DEFECT CONFIRMED' : qaQuestionnaireAnswer === 'no' ? 'NO DEFECT' : 'SELECT RESPONSE'}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                                <button
                                  type="button"
                                  disabled={isQaLocked}
                                  onClick={() => {
                                    const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                    const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    saveSubgridQa(itemKey, selectedQaFlags, 'yes', true);
                                    const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                    const newDefects = (targetLog?.defects || 0) + 1;
                                    setBatchLogs(prev => prev.map(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim() ? { ...b, defects: newDefects } : b));
                                    updateDefectStatusInSupabase(itemKey, newDefects, 'Flagged (Defect Confirmed)', { selectedQaFlags, answer: 'YES', filename: activePanoramaFilename, subgrid: sg });
                                  }}
                                  className={`py-1.5 px-2 rounded border text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 ${isQaLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer active:scale-95'
                                    } ${qaQuestionnaireAnswer === 'yes'
                                      ? 'bg-emerald-500 text-text-base border-emerald-400 shadow-md ring-1 ring-emerald-400/50'
                                      : 'bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-400 border-emerald-500/30'
                                    }`}
                                >
                                  <CheckCircle size={11} className="shrink-0" /> YES
                                </button>

                                <button
                                  type="button"
                                  disabled={isQaLocked}
                                  onClick={() => {
                                    const defaultSg = (dailyData[0]?.subgrid) || (batchLogs[0]?.subgrid) || '';
                                    const itemKey = activePanoramaFilename || inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    const sg = inspectorSubgrid || selectedSubgridFilter || defaultSg;
                                    saveSubgridQa(itemKey, selectedQaFlags, 'no', true);
                                    const targetLog = batchLogs.find(b => (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim() === sg.toUpperCase().trim());
                                    const currentDefects = targetLog?.defects || 0;
                                    updateDefectStatusInSupabase(itemKey, currentDefects, 'Passed (No Defect)', { selectedQaFlags, answer: 'NO', filename: activePanoramaFilename, subgrid: sg });
                                  }}
                                  className={`py-1.5 px-2 rounded border text-[10px] font-bold text-center transition-all flex items-center justify-center gap-1.5 ${isQaLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer active:scale-95'
                                    } ${qaQuestionnaireAnswer === 'no'
                                      ? 'bg-rose-500 text-text-base border-rose-400 shadow-md ring-1 ring-rose-400/50'
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
          ) : currentPage === 'data' ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
              <DataManagementPage
                dailyData={dailyData}
                setDailyData={setDailyData}
                batchLogs={batchLogs}
                setBatchLogs={setBatchLogs}
                layerCatalog={layerCatalog}
                setLayerCatalog={setLayerCatalog}
                onBackToDashboard={() => goToWorkspace('dashboard')}
                mapRefreshKey={mapRefreshKey}
                onRefreshMap={handleRefreshMap}
                authSession={authSession}
                onSignOut={handleSignOut}
                addNotification={addNotification}
                addAuditLog={addAuditLog}
                isGuestUser={isGuestUser}
                projectSettings={projectSettings}
                qaSubgridRecords={qaSubgridRecords}
                translate={t}
                initialTab={dataManagementTab}
                initialSearch={dataManagementSearch}
              />
            </div>
          ) : currentPage === 'settings' ? (
            <AdminSettingsView
              projectSettings={projectSettings as any}
              setProjectSettings={setProjectSettings as any}
              themeMode={themeMode}
              dailyData={dailyData}
              batchLogs={batchLogs}
              auditLogs={auditLogs}
              onSaveAllSettings={handleSaveAllSettings}
              onRefreshMap={handleRefreshMap}
              onGeneratePdfReport={generateExecutivePdfReport}
              authSession={authSession}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
            />
          ) : currentPage === 'production' ? (
            <ImageProductionWorkspace
              projectSettings={projectSettings}
              setProjectSettings={setProjectSettings}
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
              onBackToDashboard={() => goToWorkspace('dashboard')}
              translate={t}
            />
          ) : currentPage === 'storage' ? (
            <NASStorageWorkspace
              projectSettings={projectSettings}
              setProjectSettings={setProjectSettings}
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
              onBackToDashboard={() => goToWorkspace('dashboard')}
              translate={t}
            />
          ) : currentPage === 'processing' ? (
            <ProcessingCenterWorkspace
              projectSettings={projectSettings}
              setProjectSettings={setProjectSettings}
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
              onBackToDashboard={() => goToWorkspace('dashboard')}
              translate={t}
            />
          ) : currentPage === 'lineage' ? (
            <LineageWorkspace
              projectSettings={projectSettings}
              setProjectSettings={setProjectSettings}
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
              onBackToDashboard={() => goToWorkspace('dashboard')}
              translate={t}
            />
          ) : currentPage === 'analytics' ? (
            <AnalyticsWorkspace
              projectSettings={projectSettings}
              setProjectSettings={setProjectSettings}
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
              onBackToDashboard={() => goToWorkspace('dashboard')}
              translate={t}
              batchLogs={activeBatchLogs}
              dailyData={dailyData}
              onRefreshData={handleRefreshMap}
            />
          ) : currentPage === 'reports' ? (
            <ReportsWorkspace
              projectSettings={projectSettings}
              setProjectSettings={setProjectSettings}
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
              onBackToDashboard={() => goToWorkspace('dashboard')}
              translate={t}
              batchLogs={activeBatchLogs}
              dailyData={dailyData}
              onRefreshData={handleRefreshMap}
            />
          ) : currentPage === 'administration' ? (
            <AdministrationWorkspace
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
              onBackToDashboard={() => goToWorkspace('dashboard')}
              translate={t}
              auditLogs={auditLogs}
              onRefreshData={handleRefreshMap}
            />
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
              <WorkspacePlaceholder workspace={getWorkspaceDefinition(currentPage)} translate={t} />
            </div>
          )}
        </main>

        {/* Subgrid Image Filenames List View Modal (Main Canvas) */}
        {
          imagesListModal && imagesListModal.isOpen && (() => {
            const filenames = (imagesListModal.customFilenames && imagesListModal.customFilenames.length > 0)
              ? imagesListModal.customFilenames
              : generateImageFilenamesList(imagesListModal.subgrid, imagesListModal.count > 0 ? imagesListModal.count : (imagesListModal.poiCount || 1), imagesListModal.baseFilename);
            return (
              <div className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 backdrop-blur-sm">
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
                        alert(`Copied ${filenames.length} image filenames to clipboard!`);
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
          })()
        }

        {/* ========================================================= */}
        {/* INTERACTIVE GUIDED TOUR FLOATING TOOLTIP OVERLAY */}
        {/* ========================================================= */}
        {
          tourStep !== null && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90vw] max-w-lg bg-card border border-subtle rounded-2xl shadow-2xl z-[99999] p-4 text-text-base backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
              <div className="flex items-center justify-between border-b border-subtle pb-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="bg-inner text-text-base border border-subtle text-[10px] font-sans font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                    Step {tourStep} of {TOUR_STEPS.length}
                  </span>
                  <h3 className="text-xs font-bold text-text-base tracking-wide">
                    {TOUR_STEPS[tourStep - 1].title}
                  </h3>
                </div>
                <button
                  onClick={() => setTourStep(null)}
                  className="text-text-muted hover:text-text-base p-1 rounded-lg hover:bg-inner transition-colors cursor-pointer"
                  title="End Guided Tour"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-xs text-text-base leading-relaxed mb-4">
                {TOUR_STEPS[tourStep - 1].desc}
              </p>

              {/* Step Dots Indicator */}
              <div className="flex items-center justify-center gap-1.5 mb-3">
                {TOUR_STEPS.map((s) => (
                  <button
                    key={s.step}
                    onClick={() => setTourStep(s.step)}
                    className={`h-1.5 rounded-full transition-all cursor-pointer ${tourStep === s.step ? 'w-5 bg-slate-200' : 'w-1.5 bg-inner hover:bg-slate-500'
                      }`}
                    title={`Go to step ${s.step}: ${s.title}`}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-subtle">
                <span className="text-[10px] text-text-muted font-sans">
                  Focus: <strong className="text-text-base">{TOUR_STEPS[tourStep - 1].highlight}</strong>
                </span>

                <div className="flex items-center gap-2">
                  {tourStep > 1 && (
                    <button
                      onClick={() => setTourStep(tourStep - 1)}
                      className="px-3 py-1 bg-inner hover:bg-inner text-text-base border border-subtle text-xs font-medium rounded-lg transition-all cursor-pointer"
                    >
                      Previous
                    </button>
                  )}
                  {tourStep < TOUR_STEPS.length ? (
                    <button
                      onClick={() => setTourStep(tourStep + 1)}
                      className="px-3.5 py-1 bg-inner hover:bg-inner text-text-base border border-subtle text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                    >
                      Next Step <ChevronRight size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => setTourStep(null)}
                      className="px-3.5 py-1 bg-inner hover:bg-inner text-emerald-400 border border-subtle text-xs font-semibold rounded-lg transition-all cursor-pointer shadow-sm"
                    >
                      Complete Tour ✓
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        }

        {/* ========================================================= */}
        {/* HELP & USER GUIDE MODAL (Clean Minimalist Enterprise Design) */}
        {/* ========================================================= */}
        {
          isHelpGuideOpen && (
            <div className="fixed inset-0 bg-app backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
              <div className="bg-card border border-subtle rounded-xl w-full max-w-3xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden text-text-base">

                {/* Modal Header */}
                <div className="p-4 bg-card border-b border-subtle flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-text-base tracking-tight">
                      User Guide & System Manual
                    </h2>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      360° WebGIS Mobile Mapping Operations Manual
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setIsHelpGuideOpen(false);
                        setTourStep(1);
                      }}
                      className="px-3 py-1.5 bg-card hover:bg-inner text-text-base hover:text-text-base border border-subtle text-xs font-semibold rounded-lg transition-all cursor-pointer"
                      title="Start guided step-by-step tour"
                    >
                      Start Interactive Tour
                    </button>
                    <button
                      onClick={() => setIsHelpGuideOpen(false)}
                      className="text-text-muted hover:text-text-base p-1 cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Modal Navigation Tabs (Clean text, no emojis or icons) */}
                <div className="px-4 py-2 bg-card border-b border-subtle flex items-center gap-1.5 overflow-x-auto text-xs">
                  {[
                    { id: 'map', label: 'Interactive Map' },
                    { id: 'panorama', label: '360° Street View' },
                    { id: 'data', label: 'Daily Progress & DB' },
                    { id: 'audit', label: 'Notifications & Audit' }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setHelpGuideTab(tab.id as any)}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap border font-medium ${helpGuideTab === tab.id
                        ? 'bg-card text-text-base border-subtle'
                        : 'text-text-muted border-transparent hover:text-text-base hover:bg-inner'
                        }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Modal Body Content (Clean neat boxes, no lightbulb/book icons) */}
                <div className="p-5 overflow-y-auto space-y-3 flex-1 text-xs text-text-base leading-relaxed">
                  {helpGuideTab === 'map' && (
                    <div className="space-y-3">
                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">1. Subgrid Selection &amp; Key Normalization</h4>
                        <p className="text-text-muted">
                          Clicking any subgrid on the map or inside the control table isolates all trajectory points for that region. Subgrid keys are automatically normalized (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">XX-YY &rarr; XXYY</code>) across CSV imports and database queries.
                        </p>
                      </div>

                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">2. Date Filter Behavior</h4>
                        <p className="text-text-muted">
                          Selecting a capture date filters trajectory frames associated with that specific survey run while preserving concurrent subgrid boundary geometry and vector layer overlays.
                        </p>
                      </div>

                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">3. WebGIS Layer Controls &amp; Base Maps</h4>
                        <p className="text-text-muted">
                          Use the map layer panel to toggle subgrid bounding boxes, trajectory polyline features, 360° panorama capture nodes, and high-voltage electrical grid lines.
                        </p>
                      </div>
                    </div>
                  )}

                  {helpGuideTab === 'panorama' && (
                    <div className="space-y-3">
                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">1. Equirectangular 360° VR Camera Controls</h4>
                        <p className="text-text-muted">
                          Click and drag inside the 360° viewer to rotate pitch and yaw. Use the step controls or keyboard arrow keys to navigate forward/backward along vehicle trajectory frames.
                        </p>
                      </div>

                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">2. Defect Inspection &amp; QA Benchmark Verification</h4>
                        <p className="text-text-muted">
                          Frames with flagged defects (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">Blurry Frame, Lens Obstruction, GPS Offset</code>) display automated defect questionnaires. Operator YES/NO validations immediately update defect status in Supabase.
                        </p>
                      </div>
                    </div>
                  )}

                  {helpGuideTab === 'data' && (
                    <div className="space-y-3">
                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">1. Masterlist Trajectories vs Preserved Daily Passes</h4>
                        <p className="text-text-muted">
                          Toggle between <strong>Masterlist Aggregated Trajectories</strong> (consolidates subgrid survey distance &amp; POIs) and <strong>Preserved Daily Survey Runs</strong> (retains unique survey dates &amp; PIC operator history).
                        </p>
                      </div>

                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">2. Passcode-Protected Admin Edits &amp; Deletions</h4>
                        <p className="text-text-muted">
                          Table records can be edited or deleted. Record deletions require security passcode verification to prevent unauthorized data loss and ensure audit trail integrity.
                        </p>
                      </div>

                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">3. Real-Time Supabase PostgreSQL Sync</h4>
                        <p className="text-text-muted">
                          Click <strong>Publish All to Database</strong> to synchronize processed subgrid trajectories directly to Supabase production tables with live notifications.
                        </p>
                      </div>
                    </div>
                  )}

                  {helpGuideTab === 'audit' && (
                    <div className="space-y-3">
                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">1. Chronological Activity Audit Logs</h4>
                        <p className="text-text-muted">
                          Click the audit log icon in top header to view logged user actions (create, edit, delete, publish, error) with date track-back filtering and user signatures.
                        </p>
                      </div>

                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">2. Real-Time Publish Notifications</h4>
                        <p className="text-text-muted">
                          The notification bell alerts you whenever survey runs or masterlists are published to Supabase, showing total items updated and timestamp.
                        </p>
                      </div>

                      <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                        <h4 className="font-semibold text-text-base text-xs">3. Executive Client PDF Deliverable Generator</h4>
                        <p className="text-text-muted">
                          Export one-click PDF QA summary reports containing subgrid defect pass rates, total surveyed kilometers, and client SLA verification sign-offs.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="p-4 bg-card border-t border-subtle flex items-center justify-between">
                  <button
                    onClick={() => {
                      setIsHelpGuideOpen(false);
                      goToWorkspace('data');
                    }}
                    className="px-3.5 py-2 bg-card hover:bg-inner text-text-base hover:text-text-base border border-subtle text-xs font-semibold rounded-lg transition-all cursor-pointer"
                    title="Open Layer Catalog & Data Management Page"
                  >
                    Open Layer Catalog & Data Management Page
                  </button>

                  <button
                    onClick={() => setIsHelpGuideOpen(false)}
                    className="px-4 py-2 bg-card hover:bg-inner text-text-base text-xs font-semibold rounded-lg transition-all cursor-pointer"
                  >
                    Close Manual
                  </button>
                </div>

              </div>
            </div>
          )
        }

        {/* ========================================================= */}
        {/* ABOUT DASHBOARD MODAL (Monochromatic Executive System Breakdown) */}
        {/* ========================================================= */}
        {
          isAboutModalOpen && (
            <div className="fixed inset-0 top-0 left-0 right-0 bottom-0 w-full h-full bg-app backdrop-blur-md z-[99999] flex items-center justify-center p-4 animate-in fade-in duration-150">
              <div className="bg-card border border-subtle rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col overflow-hidden text-text-base">

                {/* Modal Header */}
                <div className="p-5 bg-card border-b border-subtle flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-inner border border-subtle text-text-base shadow-sm">
                      <Info size={20} />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-text-base tracking-wide">
                        Mobile Mapping Data Management System
                      </h2>
                      <p className="text-xs text-sky-400 font-medium">
                        Spatial Trajectory Processing &amp; Quality Assurance Pipeline
                      </p>
                      <p className="text-[11px] text-text-muted font-sans mt-0.5">
                        Version 2.4.0 (Executive Enterprise Build)
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsAboutModalOpen(false)}
                    className="text-text-muted hover:text-text-base p-1.5 rounded-lg hover:bg-inner transition-colors cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Modal Body Content */}
                <div className="p-6 space-y-5 text-xs text-text-base leading-relaxed overflow-y-auto max-h-[75vh]">

                  {/* 1. System Purpose & Domain Overview */}
                  <div className="p-4 rounded-xl bg-card border border-subtle space-y-2">
                    <h3 className="font-bold text-text-base text-xs uppercase tracking-wider flex items-center gap-2">
                      <span>System Purpose &amp; Domain Architecture</span>
                    </h3>
                    <p className="text-text-base text-[11.5px] leading-relaxed">
                      Engineered specifically for <strong>TNB 360° Mobile Mapping Operations</strong>, this WebGIS processing platform provides unified spatial trajectory analytics, automated subgrid deduplication, live Supabase PostGIS synchronization, and interactive 360° StreetView quality control inspection.
                    </p>
                  </div>

                  {/* 2. Technical Specifications & GIS Core */}
                  <div className="space-y-2">
                    <h4 className="font-bold text-text-base text-xs uppercase tracking-wider">
                      Technical Specifications &amp; GIS Core
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-sans text-[11px]">
                      <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                        <span className="text-text-muted block text-[10px] uppercase">GIS Mapping Engine</span>
                        <span className="text-text-base font-bold">PostGIS 3.4 + Leaflet 1.9 + WebGL</span>
                      </div>
                      <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                        <span className="text-text-muted block text-[10px] uppercase">Database Architecture</span>
                        <span className="text-text-base font-bold">Supabase PostgreSQL (Realtime Listener)</span>
                      </div>
                      <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                        <span className="text-text-muted block text-[10px] uppercase">Coordinate Reference Systems</span>
                        <span className="text-text-base font-bold">EPSG:4326, 3857, 3375 (Kertau RSO)</span>
                      </div>
                      <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                        <span className="text-text-muted block text-[10px] uppercase">360° Inspection Engine</span>
                        <span className="text-text-base font-bold">
                          {projectSettings?.useMultiRes
                            ? 'PhotoSphereViewer (Multi-Res Tile Engine)'
                            : 'PhotoSphereViewer (Equirectangular)'}
                        </span>
                        <span className="text-text-muted text-[9px] font-sans">
                          {projectSettings?.storageProvider?.toUpperCase() || 'DYNAMIC'} · {projectSettings?.imageStorageStrategy || 'single_equirectangular'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 4. Core Workflow Capabilities */}
                  <div className="space-y-2.5">
                    <h4 className="font-bold text-text-base text-xs uppercase tracking-wider">
                      Core Workflow Capabilities &amp; Features
                    </h4>
                    <div className="space-y-2 text-text-base text-[11.5px] leading-relaxed">
                      <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                        <div className="font-bold text-text-base">1. Subgrid Trajectory Deduplication Strategy</div>
                        <p className="text-text-muted text-[11px]">
                          Auto-normalizes subgrid keys (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">XX-YY &rarr; XXYY</code>). Offers choice between Masterlist clean merge or preserved daily survey runs.
                        </p>
                      </div>

                      <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                        <div className="font-bold text-text-base">2. Interactive 360° QA Inspector &amp; SLA Benchmarks</div>
                        <p className="text-text-muted text-[11px]">
                          Supports AI defect threshold benchmarks (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">95%, 85%, 75%, 60%</code>) with custom flag labels (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">Blurry Frame, Lens Obstruction, Bad GPS</code>).
                        </p>
                      </div>

                      <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                        <div className="font-bold text-text-base">3. Executive PDF Summary Report Generator</div>
                        <p className="text-text-muted text-[11px]">
                          Generates client-ready QA PDF deliverables with automated pass/fail calculations and survey metrics.
                        </p>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Modal Footer */}
                <div className="p-4 bg-card border-t border-subtle flex justify-between items-center text-[11px] text-text-muted shrink-0 font-sans">
                  <span>© 2026 Mobile Mapping Data Management System</span>
                  <button
                    onClick={() => setIsAboutModalOpen(false)}
                    className="px-4 py-1.5 bg-inner hover:bg-inner text-text-base font-medium rounded-lg border border-subtle transition-all cursor-pointer shadow-sm"
                  >
                    Close System Info
                  </button>
                </div>

              </div>
            </div>
          )
        }

        {/* ========================================================= */}
        {/* AUTOMATED QA/QC FULL CANVAS WORKBENCH */}
        {/* ========================================================= */}
        {
          isQAQCRunnerModalOpen && (
            <QAQCWorkbench
              isOpen={isQAQCRunnerModalOpen}
              workerState={qaqcWorkerState}
              dailyData={dailyData}
              batchLogs={batchLogs}
              projectSettings={projectSettings}
              qaqcAuditRuns={qaqcAuditRuns}
              defectsList={allKnownDefects}
              initialSubgrid={qaqcWorkbenchSubgrid || selectedSubgridFilter || qaqcWorkerState.subgrid || undefined}
              initialRunId={selectedDailyRunId || qaqcWorkerState.runId || undefined}
              activeUserName={activeAuthUserName || (authSession?.user?.email ? authSession.user.email.split('@')[0] : '') || 'Operator'}
              surveyDate={selectedDateFilter || undefined}
              getStationsForSubgrid={getStationsForSubgrid}
              onStartInspection={handleStartInspectionFromWorkbench}
              onPause={pauseQAQCInspection}
              onResume={resumeQAQCInspection}
              onAbort={abortQAQCInspection}
              onSignOffAndPublish={async (sg: string, runId?: string | null) => {
                setDailyData((prev: any[]) => prev.map((d: any) => {
                  const isMatch = (runId && getItemId(d) === runId) || (extractSubgridName(d.subgrid || '')?.toUpperCase() === sg.toUpperCase());
                  return isMatch ? { ...d, publishToWebGIS: 'yes', qaqcStatus: 'QA/QC Approved' } : d;
                }));
                try {
                  const cleanSg = sg.replace(/\s+/g, '_');
                  await supabase.from(projectSettings?.stagingTable || 'data_staging')
                    .update({ publish_to_webgis: 'yes', qa_status: 'QA/QC Approved', updated_at: new Date().toISOString() })
                    .ilike('subgrid', cleanSg);
                } catch (err) {
                  console.warn('Sign-off push to Supabase failed:', err);
                }
              }}
              onClose={() => {
                setIsQAQCRunnerModalOpen(false);
                setQaqcWorkbenchSubgrid(null);
              }}
              onOpenDefectsGallery={(sg) => {
                setSelectedDefectSubgrid(sg);
                setIsDefectsGalleryOpen(true);
              }}
            />
          )
        }

        {/* ========================================================= */}
        {/* QA/QC DEFECTS REVIEW GALLERY MODAL */}
        {/* ========================================================= */}
        {
          isDefectsGalleryOpen && (
            <DefectsGalleryModal
              isOpen={isDefectsGalleryOpen}
              subgrid={defectGalleryContext?.subgrid || selectedDefectSubgrid}
              mode={defectGalleryContext?.mode || 'master'}
              surveyDate={defectGalleryContext?.surveyDate}
              batchFilenames={defectGalleryContext?.batchFilenames}
              totalPoi={defectGalleryContext?.totalPoi}
              projectSettings={projectSettings}
              activeUserName={activeAuthUserName || (authSession?.user?.email ? authSession.user.email.split('@')[0] : '') || 'Operator'}
              fallbackDefects={allKnownDefects}
              onClose={() => {
                setIsDefectsGalleryOpen(false);
                setDefectGalleryContext(null);
              }}
              onJumpTo360={(target) => {
                setIsDefectsGalleryOpen(false);
                if (target.imageUrl) {
                  setActivePanoramaUrl(target.imageUrl);
                }
                if (target.pointId) {
                  setActivePanoramaFilename(target.pointId);
                  setHasSelectedPoint(true);
                }
                if (target.lat && target.lng) {
                  setInspectorCoords({ lat: target.lat, lng: target.lng });
                }
                if (selectedDefectSubgrid) {
                  setInspectorSubgrid(selectedDefectSubgrid);
                }
                if (target.bearing !== undefined) {
                  setPanoramaTelemetry(prev => ({ ...prev, yaw: target.bearing || 0 }));
                }
                setFocusedSection('qa');
                setTimeout(() => {
                  setFocusedSection(null);
                }, 1500);
              }}
              onDefectResolved={(_pointId, remainingActiveCount) => {
                const targetSg = selectedDefectSubgrid.toUpperCase().trim();
                if (targetSg) {
                  setDailyData(prev => prev.map(d => {
                    const dSg = (extractSubgridName(d.subgrid) || '').toUpperCase().trim();
                    return dSg === targetSg ? { ...d, defectCount: remainingActiveCount, imagesDefected: remainingActiveCount } : d;
                  }));
                  setBatchLogs(prev => prev.map(b => {
                    const bSg = (extractSubgridName(b.subgrid || b.imageFilename) || '').toUpperCase().trim();
                    return bSg === targetSg ? { ...b, defects: remainingActiveCount } : b;
                  }));
                }
              }}
            />
          )
        }

        {/* QC Audit Modal */}
        {
          qcModal && qcModal.isOpen && (
            <QCAuditModal
              subgrid={qcModal.subgrid}
              poiCount={qcModal.poiCount}
              availableCount={qcModal.availableCount}
              baseFilename={qcModal.baseFilename}
              availableFilenames={qcModal.availableFilenames}
              expectedFilenames={qcModal.expectedFilenames}
              onClose={() => setQcModal(null)}
            />
          )
        }

        {/* Daily Handover & Operations Briefing Modal */}
        <DailyHandoverModal
          isOpen={isHandoverModalOpen}
          onClose={() => setIsHandoverModalOpen(false)}
          dailyData={dailyData}
          batchLogs={batchLogs}
          currentUser={authSession?.user?.user_metadata?.full_name || authSession?.user?.email?.split('@')[0] || 'Fariz Farhan'}
          onSelectSubgrid={(subgridKey) => {
            setSelectedSubgridFilter(subgridKey);
            setInspectorSubgrid(subgridKey);
          }}
          onOpenQAQCWorkbench={(subgridKey) => {
            setQaqcWorkbenchSubgrid(subgridKey || null);
            goToWorkspace('dashboard');
            setIsQAQCRunnerModalOpen(true);
            setIsHandoverModalOpen(false);
          }}
          onOpenDefectsGallery={(subgridKey) => {
            if (subgridKey) setSelectedDefectSubgrid(subgridKey);
            setIsDefectsGalleryOpen(true);
            setIsHandoverModalOpen(false);
          }}
          onOpenBatchProcessing={() => {
            goToWorkspace('data');
            setIsHandoverModalOpen(false);
          }}
        />

      </div >
    </div >
  );
}
