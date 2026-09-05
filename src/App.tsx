import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PhotoSphereViewerComponent, type PhotoSphereViewerHandle } from './components/PhotoSphereViewerComponent';
import { WebGISHUDViewerOverlay } from './components/WebGISHUDViewerOverlay';
import { setHeading } from './utils/headingStore';
import { extractSubgridName } from './utils/subgrid';
import {
  AlertTriangle,
  CheckCircle,
  Activity,
  Clock,
  Camera,
  Edit2,
  X,
  Folder,
  ChevronRight,
  FileText,
  RefreshCw,
  Database,
  User,
  LogOut,
  Map as MapIcon,
  ShieldCheck,
  Maximize2,
  Filter,
  Globe,
  ClipboardList,
  History,
  Calendar,
  HelpCircle,
  ExternalLink,
  Loader2,
  Play,
  StopCircle
} from 'lucide-react';
import { supabase, fetchSupabaseData, updateDefectStatusInSupabase, saveQaAuditRunToSupabase, saveAuditLogToSupabase, saveNotificationToSupabase, saveProjectSettingsToSupabase, resolvePanoramaUrl, resolvePanoramaConfigUrl, getDatabaseTableMapping, SUBGRID_COORDINATES, saveProcessingJobToSupabase, pruneBloatedUserMetadata } from './services/supabase';
import type { QAQCAuditRunRecord } from './types/admin';
import { MapComponent } from './components/MapComponent';
export { MapComponent };
import { QCAuditModal } from './components/QCAuditModal';
export { QCAuditModal };
import { DataManagementPage } from './components/DataManagementPage';
export { DataManagementPage };
import { DefectsGalleryModal } from './components/DefectsGalleryModal';
import { ContentLoading } from './components/common/ContentLoading';
import { Toaster } from './components/common/Toaster';
import { WorkspaceErrorBoundary } from './components/common/WorkspaceErrorBoundary';
import { translate } from './lib/i18n';

const AdminSettingsView = React.lazy(() => import('./components/AdminSettingsView').then(m => ({ default: m.AdminSettingsView })));
const OperationalActionCenter = React.lazy(() => import('./components/OperationalActionCenter').then(m => ({ default: m.OperationalActionCenter })));
const ImageProductionWorkspace = React.lazy(() => import('./components/ImageProductionWorkspace').then(m => ({ default: m.ImageProductionWorkspace })));
const NASStorageWorkspace = React.lazy(() => import('./components/NASStorageWorkspace').then(m => ({ default: m.NASStorageWorkspace })));
const ProcessingCenterWorkspace = React.lazy(() => import('./components/ProcessingCenterWorkspace').then(m => ({ default: m.ProcessingCenterWorkspace })));
const LineageWorkspace = React.lazy(() => import('./components/LineageWorkspace').then(m => ({ default: m.LineageWorkspace })));
const AnalyticsWorkspace = React.lazy(() => import('./components/AnalyticsWorkspace').then(m => ({ default: m.AnalyticsWorkspace })));
const ReportsWorkspace = React.lazy(() => import('./components/ReportsWorkspace').then(m => ({ default: m.ReportsWorkspace })));
const AdministrationWorkspace = React.lazy(() => import('./components/AdministrationWorkspace').then(m => ({ default: m.AdministrationWorkspace })));
const RoadAnalysisWorkspace = React.lazy(() => import('./components/RoadAnalysisWorkspace'));
const QAQCWorkbench = React.lazy(() => import('./components/QAQCWorkbench').then(m => ({ default: m.QAQCWorkbench })));
import { useQAQCWorker, type StationNode } from './hooks/useQAQCWorker';
import { useAppData } from './hooks/useAppData';
import './themes.css';
import { SystemShowcase } from './components/SystemShowcase';
import { DailyHandoverModal } from './components/DailyHandoverModal';
import { SubgridImagesListModal } from './components/SubgridImagesListModal';
import { NotificationPopover } from './components/NotificationPopover';
import { WorkspaceSidebarNav } from './components/WorkspaceSidebarNav';
import { AboutPlatformModal } from './components/modals/AboutPlatformModal';
import { DashboardKpiSummary } from './components/dashboard/DashboardKpiSummary';
import { DashboardBatchTable } from './components/dashboard/DashboardBatchTable';
import { WorkspacePlaceholder, getWorkspaceDefinition } from './workspaces';
import { parseHashWorkspace, setHashWorkspace, subscribeHashWorkspace } from './utils/hashRouter';
import type { WorkspaceKey } from './utils/hashRouter';
// ==============================================
// Data Interfaces & Types
// ==============================================

import type { PanoramaItem, DailyTimeSeries, BatchLog, NotificationItem, AuditLogItem } from './types/dashboard';
export type { PanoramaItem, DailyTimeSeries, BatchLog, NotificationItem, AuditLogItem };
import type { Layer as CatalogLayer, Folder as CatalogFolder } from './types/catalog';
type Layer = CatalogLayer;
type Folder = CatalogFolder;
export type { Layer, Folder };

import { formatBatchIdDisplay, getPOICount, getImagesProcessedCount, parseFlexibleDate, formatDisplayDate, toISODateString, calculateSubgridDistanceKm, createBatchLogFromSupabaseOrDummy, reconcileBatchLogs } from './utils/dashboardData';
export { formatBatchIdDisplay, getPOICount, getImagesProcessedCount, parseFlexibleDate, formatDisplayDate, toISODateString, calculateSubgridDistanceKm, createBatchLogFromSupabaseOrDummy, reconcileBatchLogs };
import { getItemId } from './utils/items';
export { getItemId };

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

// ==============================================
// Main Application Component
// ==============================================

export default function App() {
  const [currentPage, setCurrentPage] = useState<WorkspaceKey>(() => parseHashWorkspace());
  const dashboardPsvRef = useRef<PhotoSphereViewerHandle | null>(null);
  const inspectionMapIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [showLanding, setShowLanding] = useState<boolean>(true);
  const [authSession, setAuthSession] = useState<any>(null);
  const [pendingModule, setPendingModule] = useState<string | null>(null);
  const [selectedDailyRunId, setSelectedDailyRunId] = useState<string | null>(null);

  // Daily Operations Handover & Briefing Modal State
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState<boolean>(false);
  const hasAutoOpenedBriefingRef = useRef<boolean>(false);

  // 1. Core Dynamic States (owned by useAppData hook)
  const {
    notifications,
    setNotifications,
    auditLogs,
    setAuditLogs,
    dailyData,
    setDailyData,
    batchLogs,
    setBatchLogs,
    qaqcAuditRuns,
    setQaqcAuditRuns,
    qaSubgridRecords,
    setQaSubgridRecords,
    isDataLoading,
    supabaseError,
    setSupabaseError,
    projectSettings,
    setProjectSettings
  } = useAppData();

  // Explicit startup warning when required env configuration is missing.
  // Never silently fall back to a hardcoded project/map URL (see implementation_plan_v13.md).
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL) {
      console.warn('[config] Missing VITE_SUPABASE_URL — Supabase data & storage features will not work. Set it in your .env / deployment environment.');
    }
    if (!import.meta.env.VITE_MAP_URL) {
      console.warn('[config] Missing VITE_MAP_URL — embedded WebGIS map links will be blank. Set it in your .env / deployment environment.');
    }
  }, []);

  // Pop up daily briefing modal once initial dashboard data loading completes (unless suppressed for today)
  useEffect(() => {
    if (!isDataLoading && !hasAutoOpenedBriefingRef.current) {
      hasAutoOpenedBriefingRef.current = true;
      const todayStr = new Date().toISOString().slice(0, 10);
      const suppressedDate = localStorage.getItem('geosphere360_briefing_suppressed_date');
      if (suppressedDate !== todayStr) {
        setIsHandoverModalOpen(true);
      }
    }
  }, [isDataLoading]);

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
    } else if (targetView === 'webgis' || targetView === 'dashboard') {
      // 1. WebGIS & Main Dashboard
      goToWorkspace('dashboard');
      setFocusedSection('map');
    } else if (targetView === 'data' || targetView === 'processing') {
      // 2. Data Management & Masterlist Ledgers
      goToWorkspace('data');
      setFocusedSection(null);
    } else if (targetView === 'production') {
      // 3. Production Workspace & 4-Station Processing
      goToWorkspace('production');
      setFocusedSection(null);
    } else if (targetView === 'qaqc' || targetView === 'qa-inspector') {
      // 4. QA/QC 360° Spherical Defect Workspace
      goToWorkspace('dashboard');
      setFocusedSection('qa');
    } else if (targetView === 'postgis') {
      // 5. PostGIS Spatial Hub & Vector Staging
      goToWorkspace('data');
      setFocusedSection(null);
    } else if (targetView === 'reports' || targetView === 'reports-rbac' || targetView === 'analytics-audit' || targetView === 'settings') {
      // 6. Reports, Audit Trail & RBAC Governance
      goToWorkspace('reports');
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

  // Unified Theme State (Clean Professional GIS Themes)
  const [currentTheme, setCurrentTheme] = useState<string>(() => {
    return localStorage.getItem('app_dashboard_theme') || 'graphite';
  });

  // Derived themeMode for backward compatibility
  const themeMode = currentTheme === 'daylight' || currentTheme === 'alabaster' ? 'light' : 'dark';

  // Global Theme Listener
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);

    const handleThemeEvent = (e: any) => {
      if (e.detail) {
        setCurrentTheme(e.detail);
        if (e.detail !== 'daylight' && e.detail !== 'alabaster') {
          localStorage.setItem('app_last_dark_theme', e.detail);
        }
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
        pruneBloatedUserMetadata();
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
        pruneBloatedUserMetadata();
      }
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const isGuestUser = Boolean(authSession?.isGuest || authSession?.user?.role === 'guest' || authSession?.user?.email?.toLowerCase().includes('guest'));

  useEffect(() => {
    if (!authSession || authLoading || isGuestUser) return;
    try {
      if (localStorage.getItem('tourFirstRunSeen')) return;
      const t = window.setTimeout(() => setTourFirstRunOpen(true), 1400);
      return () => window.clearTimeout(t);
    } catch {
      // localStorage unavailable — skip the auto-suggest
    }
  }, [authSession, authLoading, isGuestUser]);

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
      pruneBloatedUserMetadata();

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
        const poiCount = getPOICount(d) || frameCount;
        if (poiCount === 0 && frameCount === 0) return sum;

        const isThisRowActive = (qaqcWorkerState.isRunning || qaqcWorkerState.isCompleted) && (
          qaqcWorkerState.runId ? qaqcWorkerState.runId === runId : false
        );

        let cachedDefects: number | undefined;
        const cached = (runId ? qaqcAuditRuns[`${dailySubgrid}_${runId}`] : undefined) ||
          qaqcAuditRuns[`${dailySubgrid}_default`] ||
          Object.entries(qaqcAuditRuns).find(([k]) => k.startsWith(`${dailySubgrid}_`))?.[1];
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

        const maxCap = poiCount > 0 ? poiCount : frameCount;
        return sum + Math.min(count, maxCap);
      }, 0);
    }

    return batchLogs.reduce((sum, b) => {
      const sg = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
      const bFrames = getImagesProcessedCount(b);
      const bPoi = (typeof b.poiCount === 'number' && b.poiCount > 0) ? b.poiCount : (b.images || 0);
      if (bPoi === 0 && bFrames === 0) return sum;

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

      const maxCap = bPoi > 0 ? bPoi : bFrames;
      return sum + Math.min(count, maxCap);
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

  const totalPoiForHealth = useMemo(() => {
    if (dailyData.length > 0) {
      const sumDaily = dailyData.reduce((sum, d) => sum + getPOICount(d), 0);
      if (sumDaily > 0) return sumDaily;
    }
    if (batchLogs.length > 0) {
      const sumBatch = batchLogs.reduce((sum, b) => sum + (typeof b.poiCount === 'number' && b.poiCount > 0 ? b.poiCount : (b.images || 0)), 0);
      if (sumBatch > 0) return sumBatch;
    }
    return totalImages > 0 ? totalImages : 1;
  }, [dailyData, batchLogs, totalImages]);

  const pipelineHealthPercent = totalPoiForHealth > 0
    ? (totalDefects === 0 ? '100.0' : Math.max(0, ((totalPoiForHealth - totalDefects) / totalPoiForHealth) * 100).toFixed(1))
    : null;
  const targetKm = Number(projectSettings?.targetKm) || (totalKm > 0 ? totalKm : 0);
  const progressPercent = targetKm > 0 ? Math.min(100, Math.round((totalKm / targetKm) * 100)) : 0;
  const ongoingMasterlistCount = batchLogs.filter(b => b.status === 'Ongoing').length;
  const stagedDailyBatchesCount = dailyData.filter(d => (d.publishToWebGIS || (d as any).publishToUSVPRO) !== 'yes').length;

  const dailyDataBySubgrid = useMemo(() => {
    const map = new Map<string, DailyTimeSeries[]>();
    dailyData.forEach((d) => {
      const sg = (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim();
      if (!map.has(sg)) map.set(sg, []);
      map.get(sg)!.push(d);
    });
    return map;
  }, [dailyData]);

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
          const poiCount = getPOICount(sd) || frameCount;
          const cachedAudit = (runId && qaqcAuditRuns[`${sg}_${runId}`]) || qaqcAuditRuns[`${sg}_default`];
          const cachedCount = cachedAudit && typeof cachedAudit.defectCount === 'number' ? cachedAudit.defectCount : 0;
          const prevCount = (matchedPrev && typeof matchedPrev.defectCount === 'number') ? matchedPrev.defectCount : 0;
          const maxDefects = Math.max(sd.defectCount || 0, prevCount, cachedCount);
          const finalCount = (poiCount > 0 || frameCount > 0) ? Math.min(maxDefects, Math.max(poiCount, frameCount)) : maxDefects;
          const isPub = sd.publishToWebGIS === 'yes';
          const qaqcStatus = sd.qaqcStatus || matchedPrev?.qaqcStatus || (cachedAudit ? `QAQC Completed (${cachedCount} Defect${cachedCount === 1 ? '' : 's'} Found)` : (isPub ? 'Published' : undefined));

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
            const dPoi = getPOICount(d) || fCount;
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
              const cap = dPoi > 0 ? dPoi : (fCount > 0 ? fCount : undefined);
              dailyDefectsSum += cap !== undefined ? Math.min(def, cap) : def;
            }
          });

          const cachedAudit = qaqcAuditRuns[`${sg}_default`];
          const cachedCount = cachedAudit && typeof cachedAudit.defectCount === 'number' ? cachedAudit.defectCount : 0;
          const prevCount = (matchedPrev && typeof matchedPrev.defects === 'number') ? matchedPrev.defects : 0;

          const batchPoi = (typeof sb.poiCount === 'number' && sb.poiCount > 0) ? sb.poiCount : (sb.images || 0);
          const maxBatchCap = batchPoi > 0 ? batchPoi : (totalSubFrames > 0 ? totalSubFrames : undefined);

          let finalCount = hasDailyInspection
            ? dailyDefectsSum
            : Math.max(sb.defects || 0, prevCount, cachedCount);

          if (maxBatchCap !== undefined) {
            finalCount = Math.min(finalCount, maxBatchCap);
          }

          const qaqcStatus = sb.qaqcStatus || matchedPrev?.qaqcStatus || (cachedAudit ? `QAQC Completed (${cachedCount} Defect${cachedCount === 1 ? '' : 's'} Found)` : undefined);

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
  const [helpGuideTab, setHelpGuideTab] = useState<'map' | 'panorama' | 'data' | 'audit' | 'shortcuts'>('map');
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [settingsSaveToast, setSettingsSaveToast] = useState<{ show: boolean; message: string } | null>(null);
  const [tourFirstRunOpen, setTourFirstRunOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?') {
        e.preventDefault();
        setHelpGuideTab('shortcuts');
        setTourStep(null);
        setIsHelpGuideOpen(true);
      } else if (e.key === 'Escape') {
        if (isHelpGuideOpen) {
          setIsHelpGuideOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isHelpGuideOpen]);

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

  const filteredDailyData = useMemo(() => {
    return [...dailyData]
      .reverse()
      .filter(log => {
        if (dashDailyFilters.grid && log.grid !== dashDailyFilters.grid) return false;
        if (dashDailyFilters.subgrid && (log.subgrid || '').toUpperCase().trim() !== dashDailyFilters.subgrid.toUpperCase().trim()) return false;
        if (dashDailyFilters.pic && (log.pic || '') !== dashDailyFilters.pic) return false;
        if (dashDailyFilters.equipment && (log.captureEquipment || 'MMS') !== dashDailyFilters.equipment) return false;
        return true;
      });
  }, [dailyData, dashDailyFilters]);
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
                        ${isSynced ? 'VERIFIED & PUBLISHED' : 'NOT PUBLISHED'}
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
              image_url: (p.image_url && (p.image_url.startsWith('http://') || p.image_url.startsWith('https://')))
                ? p.image_url
                : resolvePanoramaUrl(p.image_url || cleanFn, projectSettings, { subgrid: cleanSg }),
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
              image_url: (p.image_url && (p.image_url.startsWith('http://') || p.image_url.startsWith('https://')))
                ? p.image_url
                : resolvePanoramaUrl(p.image_url || cleanFn, projectSettings, { subgrid: cleanSg })
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
    pic: string;
    customThresholds?: any;
  }) => {
    const { subgrid, runId = null, stations, config, pic, customThresholds } = params;
    const cleanSub = subgrid.toUpperCase().trim();
    const effectivePic = pic || activeAuthUserName || (authSession?.user?.email ? authSession.user.email.split('@')[0] : '') || 'Operator';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const timestampStr = `${dateStr}, ${timeStr}`;

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

          // Asynchronously persist audit run and staging update to Supabase (Single Source of Truth)
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

  useEffect(() => {
    const handlePanoramaMessage = (e: MessageEvent) => {
      // Prevent clicks inside QAQC Workbench from triggering the background main dashboard map & viewer
      if (isQAQCRunnerModalOpen || e.data?.source === 'qaqcWorkbench' || e.data?.isQAQC) {
        return;
      }

      // ONLY update inspector coords when a valid point track is explicitly selected (prevents minimap point moving bug)
      if (e.data?.type === 'MAP_POINT_SELECTED') {
        const pt = e.data.point || e.data.payload;
        if (pt) {
          setHasSelectedPoint(true);
          const rawFn = (pt.filename || '').replace(/^\/+/, '').replace(/^MMS_PIC\//i, '')
            || (typeof pt.image_url === 'string' ? pt.image_url.split('?')[0].split('/').pop()?.replace(/^MMS_PIC\//i, '') : '')
            || '';
          const fn = rawFn.trim();
          if (fn) {
            setActivePanoramaFilename(fn);
          }

          const ptSubgrid = (pt.subgrid ? (extractSubgridName(pt.subgrid) || pt.subgrid) : inspectorSubgrid || selectedSubgridFilter || '').toString().toUpperCase().trim();

          // Authoritative resolution using the Dashboard's active projectSettings (Cloudflare R2 / Supabase)
          const imageUrl = fn
            ? resolvePanoramaUrl(fn, projectSettings, { subgrid: ptSubgrid })
            : (pt.image_url && typeof pt.image_url === 'string' && pt.image_url.trim().length > 0
              ? resolvePanoramaUrl(pt.image_url, projectSettings, { subgrid: ptSubgrid })
              : '');

          if (imageUrl) {
            setActivePanoramaUrl(imageUrl);
          } else {
            setActivePanoramaUrl('');
          }
          if (typeof pt.bearing === 'number' || typeof pt.heading === 'number') {
            const yaw = pt.bearing ?? pt.heading;
            setPanoramaTelemetry(prev => ({ ...prev, yaw }));
            setHeading(yaw);
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

        // Publish live heading to the store (HUD reads it without re-rendering App).
        setHeading(yawVal);
      }
    };
    window.addEventListener('message', handlePanoramaMessage);
    return () => window.removeEventListener('message', handlePanoramaMessage);
  }, [qaSubgridRecords, activePanoramaFilename, inspectorSubgrid, isQAQCRunnerModalOpen]);

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
                config_url: def.fn ? resolvePanoramaConfigUrl(def.fn, projectSettings, nextSubgrid) : '',
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
          image_url: (p.image_url && (p.image_url.startsWith('http://') || p.image_url.startsWith('https://')))
            ? p.image_url
            : resolvePanoramaUrl(actualFn, projectSettings, { subgrid: normSg }),
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
            config_url: fn ? resolvePanoramaConfigUrl(fn, projectSettings, normSg) : '',
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
            config_url: fn ? resolvePanoramaConfigUrl(fn, projectSettings, normSg) : '',
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



  const t = (key: string) => translate(projectSettings?.language, key);
  return (
    <div
      data-theme={currentTheme}
      style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)' }}
      className="min-h-screen md:h-screen w-full max-w-full font-sans flex flex-col overflow-x-hidden overflow-y-auto md:overflow-hidden transition-colors duration-200"
    >
      {/* GLOBAL TOAST NOTIFICATION VIEWPORT */}
      <Toaster />

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
          {/* LIVE WEBGIS LINK (Symbol only, points to VITE_MAP_URL) */}
          <a
            href={import.meta.env.VITE_MAP_URL || ''}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 hover:text-sky-400 transition-colors cursor-pointer relative flex items-center justify-center text-text-muted hover:text-sky-400"
            title="Open Live WebGIS"
            aria-label="Open Live WebGIS"
          >
            <ExternalLink size={18} />
          </a>

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
          <NotificationPopover
            isOpen={isNotifOpen}
            notifications={notifications}
            unreadCount={unreadNotifCount}
            setNotifications={setNotifications}
            onToggleOpen={() => {
              const nextState = !isNotifOpen;
              setIsNotifOpen(nextState);
              if (nextState) {
                markNotificationsAsRead();
              }
              setIsAuditLogOpen(false);
            }}
            onClose={() => setIsNotifOpen(false)}
            clearAll={clearNotifications}
          />
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

          <WorkspaceErrorBoundary resetKey={currentPage}>
          <React.Suspense fallback={<ContentLoading label="Loading workspace..." variant="spinner" sublabel="Preparing your module" />}>
          <div
            className={`flex-1 flex flex-col min-h-0 overflow-hidden ${
              currentPage === 'dashboard'
                ? 'relative'
                : 'absolute inset-0 pointer-events-none opacity-0 -z-50 invisible'
            }`}
            aria-hidden={currentPage !== 'dashboard'}
          >
            <div key="dashboard-canvas" className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto md:overflow-hidden animate-workspace-focus">
              {/* TOP ROW: EXECUTIVE KPI SUMMARY (4 Cards) */}
              <DashboardKpiSummary
                tourStep={tourStep}
                t={t}
                isDataLoading={isDataLoading}
                totalKm={totalKm}
                progressPercent={progressPercent}
                targetKm={targetKm}
                lastUpdateDate={lastUpdateDate}
                totalImages={totalImages}
                ongoingMasterlistCount={ongoingMasterlistCount}
                stagedDailyBatchesCount={stagedDailyBatchesCount}
                pipelineHealthPercent={pipelineHealthPercent}
                totalDefects={totalDefects}
              />

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
                                <span className="text-[11px]">Not yet on WebGIS</span>
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
                          : (activeDailyLog.qaqcStatus || (activeDefects > 0 ? `QAQC Flagged (${activeDefects} Defects)` : 'Not yet on WebGIS')))
                        : (activeBatchLog?.status === 'Complete' ? 'Published to WebGIS' : 'Not yet on WebGIS');

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
                      iframeRefCb={(el) => { inspectionMapIframeRef.current = el; }}
                    />
                  </div>
                </div>

                {/* RIGHT COLUMN: PROCESSING CONTROL & 360 QA INSPECTOR (5 Cols) */}
                <div className="col-span-1 lg:col-span-5 flex flex-col gap-3 min-h-[400px] lg:min-h-0">

                  {/* TOP RIGHT PANEL: WEBGIS DATABASE & ADMIN */}
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
                          <span>{t('processingControlTitle')}</span>
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
                    <DashboardBatchTable
                      activeTab={activeTab}
                      isDataLoading={isDataLoading}
                      activeBatchLogs={activeBatchLogs}
                      dailyData={dailyData}
                      filteredDailyData={filteredDailyData}
                      selectedSubgridFilter={selectedSubgridFilter}
                      toggleSubgridFilter={toggleSubgridFilter}
                      dailyDataBySubgrid={dailyDataBySubgrid}
                      setImagesListModal={setImagesListModal}
                      qaqcWorkerState={qaqcWorkerState}
                      qaqcAuditRuns={qaqcAuditRuns}
                      setSelectedDefectSubgrid={setSelectedDefectSubgrid}
                      setDefectGalleryContext={setDefectGalleryContext}
                      setIsDefectsGalleryOpen={setIsDefectsGalleryOpen}
                      setIsQAQCRunnerModalOpen={setIsQAQCRunnerModalOpen}
                      selectedDailyRunId={selectedDailyRunId}
                      handleSelectDailyRun={handleSelectDailyRun}
                      activeAuthUserName={activeAuthUserName}
                      t={t}
                    />
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

                              const provider = projectSettings?.storageProvider || import.meta.env.VITE_STORAGE_PROVIDER || 'supabase';
                              const isMultiResStrategy = projectSettings?.imageStorageStrategy === 'multires_tiles' ||
                                projectSettings?.imageStorageStrategy === 'multi_resolution' ||
                                projectSettings?.panoramaMode === 'multi_res';
                              const hasCdnDomain = Boolean(
                                projectSettings?.r2Domain || import.meta.env.VITE_R2_DOMAIN || projectSettings?.customCdnUrl
                              );

                              const shouldUseMultiRes = isMultiResStrategy && hasCdnDomain && (
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
                              const dynamicPanoUrl = targetFilename
                                ? resolvePanoramaUrl(targetFilename, projectSettings, { subgrid: targetSubgrid })
                                : activePanoramaUrl;

                              return (
                                <PhotoSphereViewerComponent
                                  ref={dashboardPsvRef}
                                  key={`pano-psv-${provider}`}
                                  configUrl={shouldUseMultiRes && dynamicConfigUrl ? dynamicConfigUrl : undefined}
                                  panoramaUrl={dynamicPanoUrl || undefined}
                                  initialYaw={panoramaTelemetry.yaw}
                                  initialFov={projectSettings?.defaultFov}
                                  onPositionChange={(pos) => {
                                    // Live heading-cone sync: broadcast 360 camera rotation to the
                                    // embedded WebGIS map so its sonar/heading cone follows the view.
                                    // NOTE: React state (panoramaTelemetry) is intentionally NOT updated
                                    // here — rotation would re-render the entire dashboard. The live
                                    // heading is published via the heading store (see
                                    // PhotoSphereViewerComponent) for the HUD readout without App re-render.
                                    const yawDeg = Math.round(pos.yaw * 100) / 100;
                                    const pitchDeg = Math.round(pos.pitch * 100) / 100;
                                    const cameraMsg = {
                                      type: 'CAMERA_ROTATED',
                                      source: 'parent',
                                      yaw: yawDeg,
                                      pitch: pitchDeg
                                    };
                                    const mapIframe = inspectionMapIframeRef.current;
                                    if (mapIframe?.contentWindow) {
                                      try {
                                        mapIframe.contentWindow.postMessage(cameraMsg, '*');
                                      } catch (_) { }
                                    }
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

                                const nextFn = targetStation?.filename || `${cleanSg}-${String(targetIdx + 1).padStart(4, '0')}.jpg`;
                                const nextUrl = nextFn ? resolvePanoramaUrl(nextFn, projectSettings, { subgrid: cleanSg }) : (targetStation?.image_url || '');
                                const nextLat = Number(targetStation?.latitude ?? (targetStation as any)?.lat ?? inspectorCoords.lat);
                                const nextLng = Number(targetStation?.longitude ?? (targetStation as any)?.lng ?? (targetStation as any)?.lon ?? inspectorCoords.lng);
                                const nextBearing = targetStation?.bearing ?? (targetStation as any)?.heading ?? ((targetIdx * 12) % 360);

                                // Preload adjacent stations into browser cache for instant 0ms stepping
                                const aheadStation = stations[targetIdx + 1];
                                if (aheadStation) {
                                  const aheadFn = aheadStation.filename || (aheadStation.image_url ? aheadStation.image_url.split('?')[0].split('/').pop() : '');
                                  const url = aheadFn ? resolvePanoramaUrl(aheadFn, projectSettings, { subgrid: cleanSg }) : aheadStation.image_url;
                                  if (url) { const img = new Image(); img.src = url; }
                                }
                                const behindStation = stations[targetIdx - 1];
                                if (behindStation) {
                                  const behindFn = behindStation.filename || (behindStation.image_url ? behindStation.image_url.split('?')[0].split('/').pop() : '');
                                  const url = behindFn ? resolvePanoramaUrl(behindFn, projectSettings, { subgrid: cleanSg }) : behindStation.image_url;
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
                                  config_url: nextFn ? resolvePanoramaConfigUrl(nextFn, projectSettings, cleanSg) : '',
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
          </div>
          {currentPage === 'data' ? (
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
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
              <div className="flex-1 min-h-0 overflow-y-auto">
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
              </div>
            </div>
          ) : currentPage === 'production' ? (
            <ImageProductionWorkspace
              key="workspace-production"
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
              key="workspace-storage"
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
              key="workspace-processing"
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
              key="workspace-lineage"
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
              key="workspace-analytics"
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
              key="workspace-reports"
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
              key="workspace-administration"
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
              onBackToDashboard={() => goToWorkspace('dashboard')}
              translate={t}
              auditLogs={auditLogs}
              onRefreshData={handleRefreshMap}
            />
          ) : currentPage === 'roadAnalysis' ? (
            <RoadAnalysisWorkspace
              key="workspace-road-analysis"
              projectSettings={projectSettings}
              batchLogs={activeBatchLogs}
              dailyData={dailyData}
              defectsList={allKnownDefects}
              onRefreshData={handleRefreshMap}
              translate={t}
              onBackToDashboard={() => goToWorkspace('dashboard')}
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
            />
          ) : currentPage === 'dashboard' ? null : (
            <div key={`workspace-${currentPage}`} className="flex-1 flex flex-col min-h-0 overflow-hidden animate-panel-enter">
              <WorkspacePlaceholder workspace={getWorkspaceDefinition(currentPage)} translate={t} />
            </div>
          )}
          </React.Suspense>
          </WorkspaceErrorBoundary>
        </main>

        {/* Subgrid Image Filenames List View Modal (Main Canvas) */}
        <SubgridImagesListModal
          modal={imagesListModal}
          onClose={() => setImagesListModal(null)}
        />

        {/* ========================================================= */}
        {/* FIRST-RUN ONBOARDING NUDGE (auto-suggested once, dismissible) */}
        {/* ========================================================= */}
        {tourFirstRunOpen && tourStep === null && !isHelpGuideOpen && (
          <div className="fixed bottom-6 right-6 z-[99998] w-[340px] max-w-[calc(100vw-2rem)] bg-card border border-subtle rounded-2xl shadow-2xl p-4 text-text-base backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-start justify-between gap-3 mb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-sky-500/15 text-sky-400">
                  <MapIcon style={{ width: 14, height: 14 }} />
                </span>
                <h4 className="text-xs font-bold text-text-base tracking-wide">
                  New here? Take the interactive tour
                </h4>
              </div>
              <button
                onClick={() => { setTourFirstRunOpen(false); try { localStorage.setItem('tourFirstRunSeen', '1'); } catch { /* ignore */ } }}
                className="text-text-muted hover:text-text-base p-1 rounded-lg hover:bg-inner transition-colors cursor-pointer"
                title="Dismiss onboarding"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed mb-3">
              A short guided spotlight walks through the Dashboard KPIs, WebGIS map, 360° inspector and data tools.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setTourFirstRunOpen(false);
                  setTourStep(1);
                  try { localStorage.setItem('tourFirstRunSeen', '1'); } catch { /* ignore */ }
                }}
                className="flex-1 px-3 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-subtle text-xs font-semibold rounded-lg transition-all cursor-pointer"
              >
                Start Tour
              </button>
              <button
                onClick={() => { setTourFirstRunOpen(false); try { localStorage.setItem('tourFirstRunSeen', '1'); } catch { /* ignore */ } }}
                className="px-3 py-1.5 bg-inner hover:bg-inner text-text-muted hover:text-text-base border border-subtle text-xs font-medium rounded-lg transition-all cursor-pointer"
              >
                Not now
              </button>
            </div>
          </div>
        )}

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
                    { id: 'audit', label: 'Notifications & Audit' },
                    { id: 'shortcuts', label: 'Keyboard Shortcuts' }
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

                  {helpGuideTab === 'shortcuts' && (
                    <div className="space-y-1.5">
                      {[
                        { keys: ['?'], action: 'Open this keyboard shortcuts / help guide' },
                        { keys: ['Esc'], action: 'Close any open modal, dialog or help guide' },
                        { keys: ['Tab'], action: 'Move focus between panels, toolbars and tables' },
                        { keys: ['↑ ↓'], action: 'Navigate rows within the active data table' },
                        { keys: ['← →'], action: 'Step forward / backward through 360° trajectory frames' },
                        { keys: ['Enter'], action: 'Confirm the focused action or selection' },
                        { keys: ['Space'], action: 'Toggle selection / check the focused checkbox' }
                      ].map((row, idx) => (
                        <div key={idx} className="flex items-center gap-3 bg-card p-3 rounded-lg border border-subtle">
                          <div className="flex flex-wrap gap-1.5 shrink-0">
                            {row.keys.map(k => (
                              <kbd key={k} className="px-2 py-1 bg-inner border border-subtle rounded-md font-mono text-[10px] text-text-base shadow-sm">{k}</kbd>
                            ))}
                          </div>
                          <span className="text-text-muted">{row.action}</span>
                        </div>
                      ))}
                      <p className="pt-1 text-[11px] text-text-muted">
                        Press <kbd className="px-1.5 py-0.5 bg-inner border border-subtle rounded font-mono text-[10px]">?</kbd> from the main dashboard to reopen this guide at any time.
                      </p>
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
        <AboutPlatformModal
          isOpen={isAboutModalOpen}
          onClose={() => setIsAboutModalOpen(false)}
          projectSettings={projectSettings}
        />

        {/* ========================================================= */}
        {/* AUTOMATED QA/QC FULL CANVAS WORKBENCH */}
        {/* ========================================================= */}
        {
          isQAQCRunnerModalOpen && (
            <React.Suspense fallback={<ContentLoading label="Loading QA/QC Workbench..." variant="spinner" />}>
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
              }}
              onOpenDefectsGallery={(sg) => {
                setSelectedDefectSubgrid(sg);
                setIsDefectsGalleryOpen(true);
              }}
            />
            </React.Suspense>
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
                  setHeading(target.bearing || 0);
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
          currentUser={authSession?.user?.user_metadata?.full_name || authSession?.user?.email?.split('@')[0] || 'Operator'}
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
