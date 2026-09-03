/**
 * Core dashboard data interfaces.
 * Extracted from App.tsx so that extracted components can import them
 * without creating circular dependencies.
 */

export interface PanoramaItem {
  id?: string;
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

export interface DailyTimeSeries {
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

export interface BatchLog {
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