import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PhotoSphereViewerComponent, type PhotoSphereViewerHandle } from './components/PhotoSphereViewerComponent';
import { WebGISHUDViewerOverlay } from './components/WebGISHUDViewerOverlay';
import { setHeading } from './utils/headingStore';
import { extractSubgridName } from './utils/subgrid';
import {
  AlertTriangle,
  CheckCircle,
  Activity,
    Camera,
  Edit2,
  X,
  Folder,
    FileText,
  RefreshCw,
  Database,
  User,
      ShieldCheck,
  Maximize2,
  Filter,
            Loader2,
  Play,
  StopCircle,
  ArrowLeft,
  } from 'lucide-react';
import { supabase, fetchSupabaseData, fetchProjectSettingsFromSupabase, updateDefectStatusInSupabase, saveQaAuditRunToSupabase, saveAuditLogToSupabase, saveNotificationToSupabase, saveProjectSettingsToSupabase, resolvePanoramaUrl, resolvePanoramaConfigUrl, getDatabaseTableMapping, SUBGRID_COORDINATES, saveProcessingJobToSupabase, pruneBloatedUserMetadata, fetchDeletionRequestsFromSupabase, configureSupabaseBackend } from './services/supabase';
import type { ExtendedProjectSettings, QAQCAuditRunRecord } from './types/admin';
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
import { GeoSphereIcon } from './components/common/GeoSphereLogo';
import { translate } from './lib/i18n';
import { APP_VERSION } from './config/defaults';
import { ProjectOnboarding, type GateStage } from './components/ProjectOnboarding';
import {
  fetchProjects,
  createProject as createProjectService,
  applyProjectScope,
  resolveUserStorageKey,
  saveActiveProjectId,
  loadActiveProjectId,
  clearActiveProjectId,
  setActiveProjectId,
  touchProjectOpened,
  buildSeedProjectFromSettings,
  markProjectSeeded,
  hasSeededProject,
  deleteProject as deleteProjectService,
  updateProject as updateProjectService,
  persistProjectScopeSettings,
  type UserProject,
  type ProjectDraft
} from './services/projects';

const AdminSettingsView = React.lazy(() => import('./components/AdminSettingsView').then(m => ({ default: m.AdminSettingsView })));
const OperationalActionCenter = React.lazy(() => import('./components/OperationalActionCenter').then(m => ({ default: m.OperationalActionCenter })));
const ProjectWorkspace = React.lazy(() => import('./components/ProjectWorkspace').then(m => ({ default: m.ProjectWorkspace })));
const QAQCWorkbench = React.lazy(() => import('./components/QAQCWorkbench').then(m => ({ default: m.QAQCWorkbench })));
import { useQAQCWorker, type StationNode } from './hooks/useQAQCWorker';
import { useAppData } from './hooks/useAppData';
import './themes.css';
import { SystemShowcase } from './components/SystemShowcase';
import { DailyHandoverModal } from './components/DailyHandoverModal';
import { SubgridImagesListModal } from './components/SubgridImagesListModal';
import { WorkspaceSidebarNav } from './components/WorkspaceSidebarNav';
import { AppTourGuide } from './components/onboarding/AppTourGuide';
import { HelpGuideModal } from './components/onboarding/HelpGuideModal';
import { AppHeader } from './components/navigation/AppHeader';
import { WorkspaceRouter } from './components/navigation/WorkspaceRouter';
import { AboutPlatformModal } from './components/modals/AboutPlatformModal';
import { DashboardKpiSummary } from './components/dashboard/DashboardKpiSummary';
import { DashboardBatchTable } from './components/dashboard/DashboardBatchTable';
import { parseWorkspace, pushWorkspace, replaceWorkspace, subscribeWorkspace, isExplicitRoute, getSubgridQuery } from './utils/urlRouter';
import type { WorkspaceKey, WorkspacePathQuery } from './utils/urlRouter';
import {
  getStoredWorkspaceKey,
  setStoredWorkspaceKey,
  restoreWorkspaceTab,
  persistWorkspaceTab,
  clearWorkspaceLocation,
  getLastActivityAgeMs,
  hasLastActivity,
  touchLastActivity,
  clearLastActivity
} from './utils/workspaceLocation';
import { can } from './lib/authz';

// Loading-workspace window shown after entering a project (or as a guest).
// ProjectOnboarding reaches 100% / all ticks at 3000ms; keep this a beat longer
// so the "complete" state is visible before the workspace mounts.
const GATE_LOADING_MS = 3600;

// ==============================================
// Data Interfaces & Types
// ==============================================

import type { PanoramaItem, DailyTimeSeries, BatchLog, NotificationItem, AuditLogItem } from './types/dashboard';
export type { PanoramaItem, DailyTimeSeries, BatchLog, NotificationItem, AuditLogItem };
import type { Layer as CatalogLayer, Folder as CatalogFolder } from './types/catalog';
type Layer = CatalogLayer;
type Folder = CatalogFolder;
export type { Layer, Folder };

import { formatBatchIdDisplay, getPOICount, getImagesProcessedCount, parseFlexibleDate, formatDisplayDate, toISODateString, calculateSubgridDistanceKm, reconcileBatchLogs } from './utils/dashboardData';
export { formatBatchIdDisplay, getPOICount, getImagesProcessedCount, parseFlexibleDate, formatDisplayDate, toISODateString, calculateSubgridDistanceKm, reconcileBatchLogs };
import { getItemId } from './utils/items';
export { getItemId };
import { openPrintableReport } from './utils/reportDocuments';
import { buildExecutivePdfHtml } from './components/reports/reportPdf';
import { Share2 } from 'lucide-react';
import { ShareMapDialog } from './share/ShareMapDialog';
import { buildWebgisSnapshot } from './utils/mapShares';

// ==============================================
// Initial State (Populated dynamically from Supabase)
// ==============================================

// TOUR_STEPS extracted to AppTourGuide

// ==============================================
// Main Application Component
// ==============================================

export default function App() {
  const [currentPage, setCurrentPage] = useState<WorkspaceKey>(() => {
    const fromRoute = parseWorkspace();
    if (fromRoute === 'onboarding' || fromRoute === 'landing' || fromRoute === 'signin') {
      return getStoredWorkspaceKey() || 'dashboard';
    }
    if (isExplicitRoute() && fromRoute !== 'dashboard') return fromRoute;
    return getStoredWorkspaceKey() || fromRoute;
  });
  const [storageFocusPath, setStorageFocusPath] = useState<string | null>(null);
  const dashboardPsvRef = useRef<PhotoSphereViewerHandle | null>(null);
  const inspectionMapIframeRef = useRef<HTMLIFrameElement | null>(null);
  const [showLanding, setShowLanding] = useState<boolean>(() => parseWorkspace() !== 'signin');
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
    setProjectSettings,
    refreshData
  } = useAppData();

  // Settings are edited in a local DRAFT and only committed to the app-wide
  // projectSettings when the user presses an Apply / Save action.
  const [settingsDraft, setSettingsDraft] = useState<ExtendedProjectSettings | undefined>(projectSettings);
  const [settingsDraftTouched, setSettingsDraftTouched] = useState(false);

  // Keep the draft in sync with committed settings ONLY until the user starts
  // editing. Once touched, background refreshes / realtime updates must never
  // clobber the user's in-progress configuration back to the last persisted
  // (e.g. default Supabase Cloud) values.
  useEffect(() => {
    if (!settingsDraftTouched) {
      setSettingsDraft(projectSettings);
    }
  }, [projectSettings, settingsDraftTouched]);

  const handleSettingsDraftChange = (
    update: ExtendedProjectSettings | ((prev: ExtendedProjectSettings) => ExtendedProjectSettings)
  ) => {
    setSettingsDraft(prev => (typeof update === 'function' ? (update as any)(prev) : update));
    setSettingsDraftTouched(true);
  };

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

  const [dataManagementTab, setDataManagementTab] = useState<'batches' | 'daily' | 'datasets' | 'recovery'>(() => {
    const dataTabs = ['batches', 'daily', 'datasets', 'recovery'] as const;
    return restoreWorkspaceTab<typeof dataTabs[number]>('data', dataTabs) ?? 'batches';
  });
  const [dataManagementSearch, setDataManagementSearch] = useState<string>(() => getSubgridQuery());

  useEffect(() => {
    persistWorkspaceTab('data', dataManagementTab);
  }, [dataManagementTab]);

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

  // Lightweight path-based workspace routing (History API, no external dependency)
  const goToWorkspace = useCallback((key: WorkspaceKey, query?: WorkspacePathQuery) => {
    if (key === 'landing') {
      setShowLanding(true);
      setProjectGate('idle');
      pushWorkspace('landing');
      return;
    }
    if (key === 'signin') {
      setShowLanding(false);
      setProjectGate('idle');
      pushWorkspace('signin');
      return;
    }
    if (key === 'onboarding') {
      setShowLanding(false);
      setProjectGate((prev) => (prev === 'idle' ? 'pick' : prev));
      pushWorkspace('onboarding');
      return;
    }
    setProjectGate('idle');
    setShowLanding(false);
    setCurrentPage(key);
    setFocusedSection(null);
    if (key === 'data' && query?.subgrid !== undefined) {
      setDataManagementSearch(query.subgrid);
    }
    pushWorkspace(key, query);
    setStoredWorkspaceKey(key);
  }, []);

  const openStorageAtPath = useCallback(
    (path: string) => {
      setStorageFocusPath(path);
      goToWorkspace('storage');
    },
    [goToWorkspace]
  );

  useEffect(() => {
    return subscribeWorkspace((key) => {
      if (key === 'landing') {
        setShowLanding(true);
        setProjectGate('idle');
      } else if (key === 'signin') {
        setShowLanding(false);
        setProjectGate('idle');
      } else if (key === 'onboarding') {
        setShowLanding(false);
        setProjectGate((prev) => (prev === 'idle' ? 'pick' : prev));
      } else {
        setShowLanding(false);
        setProjectGate('idle');
        setCurrentPage((prev) => (prev === key ? prev : key));
        if (key === 'data') {
          setDataManagementSearch(getSubgridQuery());
        }
      }
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'batches' | 'daily'>('batches');

  // Unified Theme State (Clean Professional GIS Themes)
  const [currentTheme, setCurrentTheme] = useState<string>(() => {
    return localStorage.getItem('app_dashboard_theme') || 'graphite';
  });

  // Derived themeMode for backward compatibility
  const themeMode = currentTheme === 'daylight' || currentTheme === 'alabaster' ? 'light' : 'dark';

  // A user who has applied ANY dashboard theme has finished onboarding — the
  // theme step is the last interactive config a campaign needs, so once it's
  // set the showcase/onboarding gate must never auto-trigger for them again.
  const markOnboarded = useCallback((userKey: string): void => {
    try {
      localStorage.setItem(`geosphere360_onboarded_${userKey}`, '1');
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, []);

  // Latest auth-derived storage key, readable from stable event listeners.
  const sessionUserKeyRef = useRef<string | null>(null);

  // True when the current session was restored from persistent storage on load
  // (page refresh / new tab) rather than created by an explicit sign-in this page
  // — a restored session must never re-trigger the onboarding gate.
  const restoredSessionRef = useRef(false);

  // Global Theme Listener
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);

    // Restore style widget custom properties from localStorage
    const radiusMap: Record<string, string> = { sharp: '4px', default: '12px', rounded: '16px', pill: '24px' };
    const densityGapMap: Record<string, string> = { compact: '8px', default: '12px', spacious: '16px' };
    const densityPadMap: Record<string, string> = { compact: '10px', default: '14px', spacious: '18px' };
    const r = localStorage.getItem('app_style_radius') || 'default';
    const d = localStorage.getItem('app_style_density') || 'default';
    const s = localStorage.getItem('app_style_split') || 'balanced';
    const su = localStorage.getItem('app_style_surface') || 'card';
    const root = document.documentElement;
    root.style.setProperty('--card-radius', radiusMap[r] || '12px');
    root.style.setProperty('--ui-gap', densityGapMap[d] || '12px');
    root.style.setProperty('--ui-padding', densityPadMap[d] || '14px');
    root.setAttribute('data-surface', su);
    // Apply data-split attribute for map-panel split
    const splitGrid = document.querySelector('.dashboard-split-grid');
    if (splitGrid) splitGrid.setAttribute('data-split', s);

    const handleThemeEvent = (e: any) => {
      if (e.detail) {
        setCurrentTheme(e.detail);
        if (e.detail !== 'daylight' && e.detail !== 'alabaster') {
          localStorage.setItem('app_last_dark_theme', e.detail);
        }
        // Any user-initiated theme apply (onboarding step 4, dashboard theme
        // selector, or a project with a saved scope.theme) completes onboarding.
        const onboardKey = sessionUserKeyRef.current;
        if (onboardKey) markOnboarded(onboardKey);
      }
    };

    // Listen for style widget changes from Theme System Engine
    const handleStyleEvent = (e: any) => {
      if (e.detail) {
        const { split } = e.detail;
        const sg = document.querySelector('.dashboard-split-grid');
        if (sg && split) sg.setAttribute('data-split', split);
      }
    };

    window.addEventListener('app-theme-changed', handleThemeEvent);
    window.addEventListener('app-style-changed', handleStyleEvent);
    return () => {
      window.removeEventListener('app-theme-changed', handleThemeEvent);
      window.removeEventListener('app-style-changed', handleStyleEvent);
    };
  }, [currentTheme, markOnboarded]);


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

    // Guests get the same "Workspace Loading" experience before entering the
    // read-only app, then route to their requested module.
    const targetModule = pendingModule || 'webgis';
    setProjectGate('loading');
    window.setTimeout(() => {
      setProjectGate('idle');
      handleEnterModule(targetModule);
    }, GATE_LOADING_MS);
    setPendingModule(null);

    addAuditLog('CREATE', 'Guest Login', 'User logged in under Guest Read-Only mode', 'info');
  };

  // ---- v14 Hybrid sign-in gate (welcome → pick → loading); guests stay idle ----
  const [projectGate, setProjectGate] = useState<GateStage>('idle');
  const [welcomeUserName, setWelcomeUserName] = useState<string>('');

  // 3. Sign Out Handler
  const handleSignOut = useCallback(async () => {
    try {
      const userKey = resolveUserStorageKey(authSession, authSession?.isGuest);
      clearActiveProjectId(userKey);
    } catch { /* ignore */ }
    try {
      await supabase.auth.signOut();
    } catch (e) { }
    setAuthSession(null);
    setShowLanding(true);
    setProjectGate('idle');
    clearWorkspaceLocation();
    clearLastActivity();
    replaceWorkspace('landing');
  }, [authSession]);

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
    // Tracks whether a session already existed, so late auth pulses (tab refocus,
    // token refresh) don't re-trigger workspace navigation.
    let hadSession = false;
    // Check persistent Supabase Auth session on refresh
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        hadSession = true;
        restoredSessionRef.current = true;
        setAuthSession(session);
        setShowLanding(false); // Authenticated user stays on Dashboard
        pruneBloatedUserMetadata();
      } else {
        setAuthSession(null);
        setShowLanding(true);  // Guest / unauthenticated user returns to Landing
        clearWorkspaceLocation();
        clearLastActivity();
      }
      setAuthLoading(false);
    }).catch(() => {
      setAuthLoading(false);
      setShowLanding(true);
      clearWorkspaceLocation();
      clearLastActivity();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        if (_event === 'INITIAL_SESSION' || _event === 'TOKEN_REFRESHED') {
          restoredSessionRef.current = true;
        }
        setAuthSession(session);
        // Supabase re-emits auth pulses (SIGNED_IN/TOKEN_REFRESHED) when the tab
        // regains focus. Only the FIRST session (no previous one) may switch the
        // workspace — otherwise a re-emitted pulse yanks the user off the
        // landing showcase they navigated to via the onboarding Back button and
        // dumps them on a stale dashboard page.
        if (hadSession) {
          pruneBloatedUserMetadata();
          setAuthLoading(false);
          return;
        }
        hadSession = true;
        setShowLanding(false);
        pruneBloatedUserMetadata();
      } else {
        hadSession = false;
        setAuthSession(null);
        setShowLanding(true);
        clearWorkspaceLocation();
        clearLastActivity();
      }
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const isGuestUser = Boolean(authSession?.isGuest || authSession?.user?.role === 'guest' || authSession?.user?.email?.toLowerCase().includes('guest'));

  // Track the current auth-derived storage key so theme-apply events (which
  // complete onboarding) always target the active user.
  useEffect(() => {
    sessionUserKeyRef.current = resolveUserStorageKey(authSession, isGuestUser);
  }, [authSession, isGuestUser]);

  const effectiveUserRole =
    authSession?.user?.user_metadata?.role ||
    authSession?.user?.raw_user_meta_data?.role ||
    authSession?.user?.role ||
    authSession?.user?.app_metadata?.role ||
    authSession?.user?.raw_app_meta_data?.role;
  const canHandleApprovals = !isGuestUser && can(effectiveUserRole, 'approveDeletions');

  // Admin-visible pending deletion-request badge on the Administration icon.
  useEffect(() => {
    if (!canHandleApprovals) {
      setPendingApprovalCount(0);
      return;
    }
    let disposed = false;
    const refresh = async () => {
      try {
        const reqs = await fetchDeletionRequestsFromSupabase();
        if (!disposed) setPendingApprovalCount(reqs.filter((r) => r.status === 'Pending').length);
      } catch { /* badge refresh is best-effort */ }
    };
    refresh();
    const id = window.setInterval(refresh, 10000);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, [canHandleApprovals]);

  // ---- v14 Project registry state ----
  const [projectList, setProjectList] = useState<UserProject[]>([]);
  const [activeProject, setActiveProject] = useState<UserProject | null>(null);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  // Incremented whenever a project is (re)loaded so the dashboard map can show
  // a "preparing" overlay while the WebGIS applies basemap/boundary/settings.
  const [mapPrepareKey, setMapPrepareKey] = useState<number>(0);

  // Decide welcome vs straight-to-picker: full welcome on first-ever login per
  // user, or whenever the app version changed. Sign-out never resets flags.
  const shouldShowWelcome = useCallback((userKey: string): boolean => {
    try {
      const seenKey = `geosphere360_welcome_seen_${userKey}`;
      const seenVersion = localStorage.getItem('geosphere360_welcome_version');
      const appNewer = seenVersion !== APP_VERSION;
      if (appNewer) {
        localStorage.setItem('geosphere360_welcome_seen_' + userKey, '1');
        localStorage.setItem('geosphere360_welcome_version', APP_VERSION);
        return true;
      }
      const seen = localStorage.getItem(seenKey);
      if (!seen) {
        localStorage.setItem(seenKey, '1');
        localStorage.setItem('geosphere360_welcome_version', APP_VERSION);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  // Trigger the gate on authenticated login (non-guest).
  const triggerGate = useCallback((session: any, isGuest: boolean) => {
    if (isGuest) {
      // Guests still get the "Workspace Loading" experience on session restore,
      // then resume the page they were viewing.
      setProjectGate('loading');
      window.setTimeout(() => {
        setProjectGate('idle');
        handleEnterModule(currentPage);
      }, GATE_LOADING_MS);
      return;
    }

    // A session restored from persistent storage (page refresh/new tab while
    // already signed in) must land straight on the workspace — the onboarding
    // gate is reserved for genuine sign-ins.
    if (restoredSessionRef.current) {
      setProjectGate('idle');
      return;
    }

    const showWelcome = shouldShowWelcome(resolveUserStorageKey(session, false));

    // The onboarding gate always shows on sign-in (welcome on the first login,
    // picker on every subsequent one), so the current project is always chosen
    // explicitly instead of being silently carried over.
    const authUserName =
      session?.user?.user_metadata?.full_name ||
      session?.user?.user_metadata?.name ||
      session?.user?.user_metadata?.username ||
      session?.user?.email ||
      '';
    setWelcomeUserName(authUserName);
    setProjectGate(showWelcome ? 'welcome' : 'pick');
    pushWorkspace('onboarding');
  }, [shouldShowWelcome, pushWorkspace, currentPage]);

  const handleGateContinue = useCallback((project: UserProject) => {
    setProjectGate('loading');
    setActiveProject(project);
    const userKey = resolveUserStorageKey(authSession, isGuestUser);
    saveActiveProjectId(userKey, project.id);
    setProjectSettings((prev: any) => applyProjectScope(prev, project));
    touchProjectOpened(project.id);
    // Hold the gate until the loading workspace has fully completed (100% +
    // all ticks), then settle the dashboard.
    window.setTimeout(() => {
      setProjectGate('idle');
      goToWorkspace('dashboard');
    }, GATE_LOADING_MS);
  }, [authSession, isGuestUser, goToWorkspace, setProjectSettings]);

  const handleGateCreateProject = useCallback(async (draft: ProjectDraft) => {
    const res = await createProjectService(draft);
    if (!res.success) return { success: false as const, message: res.message };
    setProjectList((prev) => [res.value, ...prev.filter((p) => p.id !== res.value.id)]);
    return { success: true as const, value: res.value };
  }, []);

  // Show the picker/welcome gate after auth resolves (covers page refresh with
  // a persisted session, and the explicit sign-in path — both funnel here).
  const gateTriggeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading) return;
    const sessionUid = authSession?.user?.id || (authSession?.isGuest ? 'guest' : null);
    if (!sessionUid) {
      restoredSessionRef.current = false;
      setProjectGate('idle');
      gateTriggeredRef.current = null;
      return;
    }
    const isGuest = Boolean(authSession?.isGuest || authSession?.user?.role === 'guest' || authSession?.user?.email?.toLowerCase().includes('guest'));
    // Only trigger once per session uid so repeated auth pulses don't re-show.
    if (gateTriggeredRef.current === sessionUid) return;
    gateTriggeredRef.current = sessionUid;
    triggerGate(authSession, isGuest);
  }, [authLoading, authSession, triggerGate]);

  // Auto-advance the welcome animation to the project picker after ~2.2s.
  useEffect(() => {
    if (projectGate !== 'welcome') return;
    const t = window.setTimeout(() => setProjectGate('pick'), 2200);
    return () => window.clearTimeout(t);
  }, [projectGate]);

  const refreshProjects = useCallback(async () => {
    const projects = await fetchProjects();
    setProjectList(projects);
    setProjectsLoaded(true);
    return projects;
  }, []);

  // v14 carry-forward — register the pre-v14 "current production project"
  // (from projectSettings) into the registry once per user + no active project.
  const ensureSeedProject = useCallback(
    async (settings: Record<string, unknown> | undefined) => {
      const userKey = resolveUserStorageKey(authSession, isGuestUser);
      const draft = buildSeedProjectFromSettings(settings);
      if (!draft) return null;
      const res = await createProjectService(draft);
      if (!res.success) {
        // Do NOT pin a local-only stub as active: a `local-*` id matches zero
        // rows in every scoped query (everything goes blank). A failed DB
        // insert just leaves the picker empty so the user can create a real
        // project, and the seed flag stays reusable on retry.
        clearActiveProjectId(userKey);
        return null;
      }
      const project = res.value;
      markProjectSeeded(userKey);
      saveActiveProjectId(userKey, project.id);
      setActiveProject(project);
      setProjectList((prev) => [project, ...prev.filter((p) => p.id !== project.id)]);
      // v15: adoption moves every legacy (project_id IS NULL) row onto this
      // carried-forward production project so nothing already in the database
      // is lost or hidden. Fresh projects never run this RPC.
      try {
        await supabase.rpc('projects_adopt_legacy_rows', { p_project_id: project.id });
      } catch {
        // Non-fatal: rows simply stay unscoped until the RPC succeeds.
      }
      return project;
    },
    [authSession, isGuestUser]
  );

  // Run the seed once after the project list has loaded (so an existing
  // registry/active project short-circuits it) and settings are present.
  const seedProjectRef = useRef(false);
  useEffect(() => {
    if (authLoading || !authSession || isGuestUser) return;
    if (seedProjectRef.current) return;
    if (!projectsLoaded) return;
    const userKey = resolveUserStorageKey(authSession, isGuestUser);
    const savedId = loadActiveProjectId(userKey);
    if (savedId && !savedId.startsWith('local-')) {
      seedProjectRef.current = true;
      return;
    }
    // A deleted/no-longer-active project must NOT resurrect: the seed flag is
    // set only after a successful DB insert, so once the user has intentionally
    // deleted their seeded project the app falls through to an empty picker.
    if (hasSeededProject(userKey)) {
      seedProjectRef.current = true;
      return;
    }
    // A `local-*` stub (left by a failed v14 seed) is not a real project —
    // clear it and re-seed so the carried-forward production project actually
    // gets a real DB row (otherwise every scoped query returns 0 rows).
    if (savedId) clearActiveProjectId(userKey);
    if (projectList.length > 0) {
      seedProjectRef.current = true;
      return;
    }
    seedProjectRef.current = true;
    ensureSeedProject(projectSettings as Record<string, unknown> | undefined);
  }, [authLoading, authSession, isGuestUser, projectsLoaded, projectList, projectSettings, ensureSeedProject]);

  // Restore the persisted active project for the current user once logged in.
  useEffect(() => {
    if (authLoading) return;
    if (!authSession || isGuestUser) {
      setActiveProject(null);
      setProjectList([]);
      setProjectsLoaded(false);
      setActiveProjectId(null);
      return;
    }
    const userKey = resolveUserStorageKey(authSession, isGuestUser);
    const savedId = loadActiveProjectId(userKey);
    (async () => {
      const projects = await refreshProjects();
      if (savedId && projects.length > 0) {
        const found = projects.find((p) => p.id === savedId && p.status !== 'archived');
        if (found) {
          setActiveProject(found);
          setActiveProjectId(found.id);
        }
      }
    })();
  }, [authSession, authLoading, isGuestUser, refreshProjects]);

  // Apply the active project's GIS scope and theme into projectSettings whenever it changes.
  useEffect(() => {
    if (!activeProject) return;
    setProjectSettings((prev: any) => applyProjectScope(prev, activeProject));
    if (activeProject.scope?.theme) {
      document.documentElement.setAttribute('data-theme', activeProject.scope.theme);
      try {
        localStorage.setItem('app_dashboard_theme', activeProject.scope.theme);
      } catch {}
      window.dispatchEvent(new CustomEvent('app-theme-changed', { detail: activeProject.scope.theme }));
    }
  }, [activeProject, setProjectSettings]);

  const handleLoadProject = useCallback(async (project: UserProject) => {
    setActiveProject(project);
    // Live-project scoping must change immediately, otherwise every subsequent
    // fetch (and the map's staged data) still targets the previous project until
    // a full page refresh.
    setActiveProjectId(project.id);
    const userKey = resolveUserStorageKey(authSession, isGuestUser);
    saveActiveProjectId(userKey, project.id);
    setProjectSettings((prev: any) => applyProjectScope(prev, project));
    // Drop the previous session project's in-memory data (data of project B must
    // never bleed into project A's map), then refetch for the freshly active one.
    setDailyData([]);
    setBatchLogs([]);
    setQaqcAuditRuns({});
    setQaSubgridRecords({});
    setSelectedSubgridFilter(null);
    setSelectedDailyRunId(null);
    setMapPrepareKey((k) => k + 1);
    refreshData();
    touchProjectOpened(project.id);
    goToWorkspace('dashboard');
    addNotification({ category: 'SYSTEM', title: 'Project Loaded', message: `Now working under ${project.name}` });
  }, [authSession, isGuestUser, addNotification, goToWorkspace, setProjectSettings, refreshData, setBatchLogs, setDailyData, setQaSubgridRecords, setQaqcAuditRuns]);

  const handleCreateProject = useCallback(async (draft: ProjectDraft) => {
    const res = await createProjectService(draft);
    if (!res.success) {
      addNotification({ category: 'ERROR', title: 'Project Error', message: res.message });
      return { success: false as const, message: res.message };
    }
    // A freshly created project is the "current" project (same rule as
    // onboarding: current project => active card, no Load button needed).
    setActiveProject(res.value);
    setActiveProjectId(res.value.id);
    const userKey = resolveUserStorageKey(authSession, isGuestUser);
    saveActiveProjectId(userKey, res.value.id);
    touchProjectOpened(res.value.id);
    setProjectSettings((prev: any) => applyProjectScope(prev, res.value));
    setProjectList((prev) => [res.value, ...prev.filter((p) => p.id !== res.value.id)]);
    addNotification({ category: 'SYSTEM', title: 'Project Created', message: res.value.name });
    return { success: true as const, value: res.value };
  }, [addNotification, authSession, isGuestUser, setProjectSettings]);

  const handleUpdateProject = useCallback(async (id: string, patch: Partial<ProjectDraft>) => {
    const res = await updateProjectService(id, patch);
    if (!res.success) {
      addNotification({ category: 'ERROR', title: 'Update Failed', message: res.message });
      return { success: false as const, message: res.message };
    }
    setProjectList((prev) => prev.map((p) => (p.id === id ? res.value : p)));
    if (activeProject?.id === id) {
      setActiveProject(res.value);
      setProjectSettings((prev: any) => applyProjectScope(prev, res.value));
    }
    addNotification({ category: 'SYSTEM', title: 'Project Updated', message: res.value.name });
    return { success: true as const, value: res.value };
  }, [activeProject, addNotification, setProjectSettings]);

  const handleDeleteProject = useCallback(async (project: UserProject) => {
    const res = await deleteProjectService(project.id);
    if (!res.success) {
      addNotification({ category: 'ERROR', title: 'Delete Failed', message: res.message });
      return;
    }
    setProjectList((prev) => prev.filter((p) => p.id !== project.id));
    if (activeProject?.id === project.id) {
      const userKey = resolveUserStorageKey(authSession, isGuestUser);
      clearActiveProjectId(userKey);
      setActiveProjectId(null);
      setActiveProject(null);
    }
    addNotification({ category: 'SYSTEM', title: 'Project Deleted', message: project.name });
    goToWorkspace('project');
  }, [activeProject, authSession, isGuestUser, addNotification, goToWorkspace]);

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

  // Session inactivity lock — signs out authenticated users who go idle
  // beyond projectSettings.sessionTimeoutMinutes (0 == never, undefined defaults 30).
  // Activity inside embedded maps/360 iframes is not observable from the parent
  // window, so sustained work inside those panes may still count as idle.
  const sessionTimeoutMinutes = projectSettings?.sessionTimeoutMinutes ?? 30;

  useEffect(() => {
    if (!authSession || authLoading || isGuestUser || isDataLoading) return;
    if (!sessionTimeoutMinutes || sessionTimeoutMinutes <= 0) return;

    const timeoutMs = sessionTimeoutMinutes * 60 * 1000;
    let lastActiveAt = Date.now();
    let writeDebounce: ReturnType<typeof setTimeout> | null = null;

    const markActive = () => {
      lastActiveAt = Date.now();
      if (writeDebounce) return;
      writeDebounce = setTimeout(() => {
        touchLastActivity();
        writeDebounce = null;
      }, 5000);
    };

    // On same-session refresh while idle past the limit, sign out immediately
    // ("refresh out from session inactivity lock") instead of restoring the page.
    // Only meaningful when a previous session actually recorded activity — a
    // first-ever visit (no marker) must never be treated as "idle".
    if (hasLastActivity() && getLastActivityAgeMs() >= timeoutMs) {
      void handleSignOut();
      return;
    }

    const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['pointerdown', 'mousemove', 'keydown', 'wheel', 'touchstart', 'scroll'];
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, markActive, { passive: true }));

    const notifyActivityFromIframe = () => markActive();

    const interval = window.setInterval(() => {
      if (Date.now() - lastActiveAt >= timeoutMs) {
        void handleSignOut();
      }
    }, 30000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastActiveAt >= timeoutMs) {
          void handleSignOut();
        }
      }
    };
    document.removeEventListener('visibilitychange', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);

    // Map/QA panels render inside iframes, which swallow pointer/keyboard events
    // from the parent window. Listen for focus/entry crossing so sustained work
    // inside those panes is not mistaken for idle.
    window.addEventListener('focus', notifyActivityFromIframe);
    document.addEventListener('mouseenter', notifyActivityFromIframe);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, markActive));
      window.removeEventListener('focus', notifyActivityFromIframe);
      document.removeEventListener('mouseenter', notifyActivityFromIframe);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
      if (writeDebounce) clearTimeout(writeDebounce);
    };
  }, [authSession, authLoading, isGuestUser, isDataLoading, sessionTimeoutMinutes, handleSignOut]);

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

    let result: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
    try {
      result = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword
      });
    } catch (err) {
      setIsAuthenticating(false);
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(
        /JSON\.parse|Unexpected token|unexpected character|not valid JSON/i.test(msg)
          ? 'The login server returned an HTML page instead of JSON — your Supabase REST URL or anon key is wrong, or the backend host is unreachable. Check Admin Settings → Database Host, or the .env values.'
          : msg || 'Unexpected error during sign-in.'
      );
      return;
    }

    setIsAuthenticating(false);

    const { data, error } = result;
    if (error) {
      setAuthError(error.message || 'Invalid login credentials. Authorized users only.');
    } else if (data.session) {
      setAuthSession(data.session);
      setShowLanding(false);
      pruneBloatedUserMetadata();
      touchLastActivity();

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

  // While the navigation rail animates its width (300ms), the embedded WebGIS
  // iframe continuously re-renders its tiles/3D scene → visible map flicker.
  // A short opaque veil over the map hides that repaint so the dashboard stays
  // clean; it is lifted once the layout has settled.
  const [mapVeilActive, setMapVeilActive] = useState<boolean>(false);
  const mapVeilTimerRef = useRef<number | null>(null);
  const handleToggleSidebar = useCallback(() => {
    setIsSidebarExpanded((prev) => !prev);
    setMapVeilActive(true);
    if (mapVeilTimerRef.current !== null) window.clearTimeout(mapVeilTimerRef.current);
    mapVeilTimerRef.current = window.setTimeout(() => {
      mapVeilTimerRef.current = null;
      setMapVeilActive(false);
    }, 380);
  }, []);

  useEffect(() => () => {
    if (mapVeilTimerRef.current !== null) window.clearTimeout(mapVeilTimerRef.current);
  }, []);

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
  const [helpGuideInitialTab, setHelpGuideInitialTab] = useState<'map' | 'panorama' | 'data' | 'audit' | 'shortcuts'>('map');
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [settingsSaveToast, setSettingsSaveToast] = useState<{ show: boolean; message: string } | null>(null);
  const [tourFirstRunOpen, setTourFirstRunOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?') {
        e.preventDefault();
        setHelpGuideInitialTab('shortcuts');
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
      const next = { ...(settingsDraft as ExtendedProjectSettings) };
      const provider = next.databaseProvider || 'supabase_cloud';
      const providerConfigs = {
        ...(next.providerConfigs || {}),
        [provider]: {
          supabaseUrl: next.supabaseUrl || import.meta.env.VITE_SUPABASE_URL,
          supabaseKey: next.supabaseKey || next.databaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY,
          databaseAnonKey: next.databaseAnonKey || next.supabaseKey || import.meta.env.VITE_SUPABASE_ANON_KEY,
          serviceRoleKey: next.serviceRoleKey,
          databaseHost: next.databaseHost,
          databasePort: next.databasePort,
          databaseName: next.databaseName,
          databaseSchema: next.databaseSchema,
          databaseUser: next.databaseUser,
          connectionMode: next.connectionMode,
          sslMode: next.sslMode
        }
      };
      const committed = { ...next, providerConfigs };
      setProjectSettings(committed);
      setSettingsDraftTouched(false);
      saveProjectSettingsToSupabase(committed).catch(err => console.warn('Supabase settings save notice:', err));
      const backendSwitched = configureSupabaseBackend({
        url: committed?.supabaseUrl,
        anonKey: committed?.supabaseKey || committed?.databaseAnonKey
      });
      if (backendSwitched) {
        // The saveProjectSettingsToSupabase above ran against the PREVIOUS host.
        // Persist the committed settings to the newly active backend as well so a
        // reload on the new host keeps the storage provider / R2 domain config
        // (otherwise the frame KPI collapses to 0 after local <-> cloud switches).
        // Merge so new-host-only keys (project boundary, scopes, etc.) survive.
        (async () => {
          try {
            const existing = await fetchProjectSettingsFromSupabase();
            const merged = existing && typeof existing === 'object'
              ? { ...existing, ...committed }
              : committed;
            await saveProjectSettingsToSupabase(merged);
          } catch (err) {
            console.warn('New-host settings sync notice:', err);
          }
        })();
      }
      if (activeProject?.id) {
        persistProjectScopeSettings({
          targetKm: typeof (next as any)?.targetKm === 'number' ? (next as any).targetKm : 0,
          targetImages: typeof (next as any)?.targetImages === 'number' ? (next as any).targetImages : 0,
          targetDeadline: (next as any)?.targetDeadline,
          crs: (next as any)?.selectedCrs,
          region: (next as any)?.selectedRegionBBox,
          basemap: (next as any)?.defaultBasemapStyle,
          equipment: (next as any)?.defaultEquipment
        }).catch(err => console.warn('Project scope update notice:', err));
      }
      const sampleUrl = getPanoramaUrl('sample.jpg');
      const tables = getDatabaseTableMapping(next);
      addAuditLog(
        'EDIT',
        'Saved Project & Database Settings',
        `Updated database host to ${next.databaseProvider || 'supabase_cloud'} and storage provider to ${next.storageProvider || 'supabase'}${backendSwitched ? ' — backend reconnected' : ''} (Panoramas table: ${tables.panoramasTable}, Sample URL: ${sampleUrl})`,
        'info'
      );
      addNotification({
        title: 'Settings Saved & Synced',
        message: `Project settings saved. Storage provider: ${next.storageProvider || 'supabase'}, Language: ${next.language || 'en'}.`,
        category: 'SYSTEM'
      });
      handleRefreshMap();
      fetchSupabaseData(committed).then(({ dailyData: sDaily, batchLogs: sBatches }) => {
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
      setMapVeilActive(true);
      if (mapVeilTimerRef.current !== null) window.clearTimeout(mapVeilTimerRef.current);
      mapVeilTimerRef.current = window.setTimeout(() => {
        mapVeilTimerRef.current = null;
        setMapVeilActive(false);
      }, 380);
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

  const [shareMapOpen, setShareMapOpen] = useState(false);

  const generateExecutivePdfReport = () => {
    openPrintableReport(
      'GeoSphere 360 - Executive Progress & Quality Audit Report',
      buildExecutivePdfHtml({
        batches: activeBatchLogs,
        auditLogs,
        qaSubgridRecords,
        projectSettings: projectSettings || {},
        operatorUser: authSession?.user?.email ? authSession.user.email : 'GIS Engineer'
      })
    );
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
        // Never invent a filename: an unresolvable one produces a broken image
        // with no error. Callers fall back to their own empty state.
        const fn = firstPan?.filename || foundDaily?.availableFilenames?.[0] || (foundBatch?.imageFilename) || '';
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
    const fn = firstPan?.filename || daily.availableFilenames?.[0] || (daily as any)?.imageFilename || '';
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
  if (showLanding) {
    return (
      <SystemShowcase
        dailyData={dailyData}
        batchLogs={batchLogs}
        projectSettings={projectSettings}
        activeProject={activeProject}
        onEnterDashboard={(targetView?: string) => {
          if (!authSession) {
            if (targetView === 'auth') {
              goToWorkspace('signin');
              return;
            }
            setPendingModule(targetView || 'webgis');
            goToWorkspace('signin');
          } else {
            setShowLanding(false);
            if (targetView === 'auth') {
              goToWorkspace('dashboard');
              return;
            }
            handleEnterModule(targetView || 'webgis');
          }
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
              <GeoSphereIcon size={32} colorful className="shrink-0" />
            </div>
            <h1 className="text-xl font-semibold text-text-base tracking-tight">
              Sign in to GeoSphere 360
            </h1>
            <p className="text-xs text-text-muted mt-1.5 leading-relaxed">
              Operations Hub &bull; Mobile Mapping &amp; Spatial Intelligence
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

          {/* Footer Security Note & Back Navigation */}
          <div className="mt-8 text-center flex flex-col items-center gap-3">
            <p className="text-[11px] text-text-muted">
              Protected by Supabase Access Authentication
            </p>
            <button
              type="button"
              onClick={() => goToWorkspace('landing')}
              className="inline-flex items-center justify-center gap-2 text-xs font-medium text-text-muted hover:text-text-base transition-colors cursor-pointer group"
            >
              <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
              <span>Back to System Showcase</span>
            </button>
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
      className="app-canvas h-[100dvh] md:h-screen w-full max-w-full font-sans flex flex-col overflow-x-hidden overflow-y-auto md:overflow-hidden transition-colors duration-200"
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

      {/* v14 HYBRID SIGN-IN GATE — sits above the mounted app so data preloads underneath */}
      {projectGate !== 'idle' && (
        <ProjectOnboarding
          stage={projectGate}
          userName={
            welcomeUserName ||
            authSession?.user?.user_metadata?.full_name ||
            authSession?.user?.user_metadata?.name ||
            authSession?.user?.user_metadata?.username ||
            authSession?.user?.email ||
            ''
          }
          projects={projectList}
          projectsLoaded={projectsLoaded}
          activeProject={activeProject}
          translate={t}
          onContinue={handleGateContinue}
          onCreateProject={handleGateCreateProject}
          onBackToLanding={() => {
            setProjectGate('idle');
            goToWorkspace('landing');
          }}
          onRefreshProjects={refreshProjects}
        />
      )}

      {/* TOP GLOBAL NAVBAR */}
      <AppHeader
        title={t('appTitle')}
        mobileNavOpen={mobileNavOpen}
        onToggleMobileNav={() => setMobileNavOpen((prev) => !prev)}
        tourStep={tourStep}
        liveWebgisUrl={import.meta.env.VITE_MAP_URL}
        onOpenBriefing={() => setIsHandoverModalOpen(true)}
        onOpenHelpGuide={() => {
          setHelpGuideInitialTab('map');
          setIsHelpGuideOpen(true);
          setIsNotifOpen(false);
          setIsAuditLogOpen(false);
        }}
        isAuditLogOpen={isAuditLogOpen}
        setIsAuditLogOpen={setIsAuditLogOpen}
        unreadAuditCount={unreadAuditCount}
        markAuditLogsAsRead={markAuditLogsAsRead}
        auditFilterTab={auditFilterTab}
        setAuditFilterTab={setAuditFilterTab}
        auditDateFilter={auditDateFilter}
        setAuditDateFilter={setAuditDateFilter}
        availableAuditDates={availableAuditDates}
        auditLogs={auditLogs}
        isNotifOpen={isNotifOpen}
        setIsNotifOpen={setIsNotifOpen}
        notifications={notifications}
        unreadNotifCount={unreadNotifCount}
        setNotifications={setNotifications}
        markNotificationsAsRead={markNotificationsAsRead}
        clearNotifications={clearNotifications}
        authSession={authSession}
        isGuestUser={isGuestUser}
        onSignOut={handleSignOut}
      />

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
          onOpenAbout={() => {
            setMobileNavOpen(false);
            setIsAboutModalOpen(true);
          }}
          onToggleSidebar={handleToggleSidebar}
          approvalBadgeCount={pendingApprovalCount}
          mobileNavOpen={mobileNavOpen}
          onCloseMobileNav={() => setMobileNavOpen(false)}
        />

        {/* MAIN DASHBOARD CONTENT CANVAS */}
        <main className={`flex-1 flex flex-col p-3 gap-3 overflow-y-auto md:overflow-hidden relative ${currentPage !== 'dashboard' ? 'mobile-compact' : ''} ${currentPage === 'dashboard' ? 'bg-card' : 'bg-app [background:var(--canvas-bg)]'}`}>

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
            className={`flex flex-col md:flex-1 md:min-h-0 md:overflow-hidden ${
              currentPage === 'dashboard'
                ? 'relative'
                : 'absolute inset-0 pointer-events-none opacity-0 -z-50 invisible'
            }`}
            aria-hidden={currentPage !== 'dashboard'}
          >
            <div key="dashboard-canvas" className="flex flex-col gap-3 md:flex-1 md:min-h-0 md:overflow-hidden animate-workspace-focus dashboard-density-grid">
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
                canHandleApprovals={canHandleApprovals}
                onOpenQAQCWorkbench={(subgridKey) => {
                  setQaqcWorkbenchSubgrid(subgridKey || null);
                  setIsQAQCRunnerModalOpen(true);
                }}
                onOpenDefectsGallery={(subgridKey) => {
                  if (subgridKey) setSelectedDefectSubgrid(subgridKey);
                  setIsDefectsGalleryOpen(true);
                }}
                onNavigate={(ws, params) => {
                  if (ws === 'administration' && params && params.tab) {
                    persistWorkspaceTab('administration', params.tab);
                  }
                  goToWorkspace(ws);
                  if (ws === 'data' && params) {
                    if (params.tab && params.tab !== 'approvals') setDataManagementTab(params.tab);
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
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:flex-1 lg:min-h-0 lg:overflow-hidden dashboard-split-grid dashboard-density-grid">

                {/* LEFT COLUMN: INTERACTIVE COVERAGE MAP (7 Cols) */}
                <div className={`col-span-1 lg:col-span-7 map-column min-h-[340px] sm:min-h-[440px] lg:min-h-0 bg-card border border-subtle backdrop-blur-md rounded-xl flex flex-col overflow-hidden relative transition-all duration-300 ${tourStep === 2 ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative scale-[1.002]' : tourStep !== null ? 'opacity-30 blur-[1.5px] pointer-events-none' : ''
                  }`}>
                  {/* Header */}
                  <div className="p-2 sm:p-3 border-b border-subtle flex flex-row flex-wrap items-center justify-between gap-1.5 sm:gap-2 shrink-0 bg-card min-w-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-text-base truncate flex-1 min-w-0">
                      INTERACTIVE COVERAGE MAP
                    </span>
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-none ml-auto">
                      <button
                        onClick={generateExecutivePdfReport}
                        className="px-2 sm:px-3 py-1 bg-card hover:bg-inner text-text-base hover:text-text-base border border-subtle text-[10px] sm:text-[11px] font-medium rounded-lg transition-all uppercase tracking-tight cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:scale-95 whitespace-nowrap"
                        title="Generate printable Executive PDF Summary Report"
                      >
                        <FileText size={12} className="shrink-0" />
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
                        className={`px-2 sm:px-3 py-1 text-[10px] sm:text-[11px] font-medium rounded-lg border transition-all uppercase tracking-tight flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95 whitespace-nowrap ${isDrawingBBox
                          ? 'bg-card border-slate-400 text-text-base'
                          : 'bg-card hover:bg-inner text-text-base border-subtle hover:border-subtle'
                          }`}
                        title="Toggle spatial bounding box rectangle filter on map"
                      >
                        <Maximize2 size={12} className="shrink-0" />
                        <span>{isDrawingBBox ? 'CLEAR BBOX' : 'BBOX FILTER'}</span>
                      </button>
                      {!isGuestUser && (
                        <button
                          onClick={() => setShareMapOpen(true)}
                          className="px-2 sm:px-3 py-1 bg-card hover:bg-inner text-text-base border border-subtle text-[10px] sm:text-[11px] font-medium rounded-lg transition-all uppercase tracking-tight cursor-pointer flex items-center justify-center gap-1.5 shadow-sm active:scale-95 whitespace-nowrap"
                          title="Create a public read-only share link for this survey map"
                        >
                          <Share2 size={12} className="shrink-0" />
                          <span>SHARE MAP</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Embedded WebGIS Map */}
                  <div className="flex-1 relative overflow-hidden bg-app">
                    {/* Resize veil: masks the iframe's tile/3D repaint while the
                        nav rail width animates (prevents map flicker on expand/collapse). */}
                    <div className={`absolute inset-0 z-10 bg-app pointer-events-none select-none transition-opacity duration-200 ${mapVeilActive ? 'opacity-100' : 'opacity-0'}`} />
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
                        <span className="hidden sm:inline">Trajectory Status</span>
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
                      prepareKey={mapPrepareKey}
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
                    <ShareMapDialog
                      open={shareMapOpen}
                      kind="webgis"
                      defaultTitle={`${projectSettings?.projectName || 'GeoSphere 360'} — Survey Map`}
                      buildSnapshot={() => buildWebgisSnapshot(dailyData, projectSettings)}
                      basemap={projectSettings?.defaultBasemap || 'ofm-positron'}
                      createdBy={authSession?.user?.id || null}
                      onClose={() => setShareMapOpen(false)}
                    />
                  </div>
                </div>

                {/* RIGHT COLUMN: PROCESSING CONTROL & 360 QA INSPECTOR (5 Cols) */}
                <div className="col-span-1 lg:col-span-5 panel-column flex flex-col gap-3 min-h-[420px] sm:min-h-[520px] lg:min-h-0">

                  {/* TOP RIGHT PANEL: WEBGIS DATABASE & ADMIN */}
                  <div className={`flex-none lg:flex-1 bg-card border border-subtle backdrop-blur-md rounded-xl flex flex-col overflow-hidden transition-all duration-700 ${focusedSection === 'processing'
                    ? 'relative z-30 ring-4 ring-emerald-400 shadow-[0_0_50px_rgba(52,211,153,0.5)] scale-[1.005]'
                    : focusedSection
                      ? 'filter blur-[4px] opacity-25 pointer-events-none'
                      : ''
                    }`}>
                    <div className="p-2.5 sm:p-3 border-b border-subtle flex flex-wrap items-center justify-between gap-2 shrink-0 bg-card">
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <span className="text-xs font-bold uppercase tracking-wider text-text-base flex items-center gap-1.5 sm:gap-2">
                          <Database size={14} className="text-text-base shrink-0" />
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
                        className="px-2.5 sm:px-3 py-1.5 bg-card hover:bg-inner text-text-base hover:text-text-base border border-subtle text-[10px] sm:text-[11px] font-medium rounded-lg transition-all uppercase tracking-tight cursor-pointer shadow-sm shrink-0 self-center whitespace-nowrap"
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
                    <div className="flex-1 flex flex-col lg:flex-row gap-2.5 p-2.5 min-h-0">
                      {/* Left: 360 Panorama Canvas + Floating HUD Overlay */}
                      <div className="flex-1 bg-app rounded-lg border border-subtle relative overflow-hidden group flex flex-col min-w-0 min-h-[280px] sm:min-h-[340px] lg:min-h-0">
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
                              imageName={activePanoramaFilename || 'Inspection Node'}
                              currentIndex={
                                (() => {
                                  const cleanSg = (inspectorSubgrid || selectedSubgridFilter || '').toUpperCase().trim();
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
                                  const cleanSg = (inspectorSubgrid || selectedSubgridFilter || '').toUpperCase().trim();
                                  const stations = getStationsForSubgrid(cleanSg, selectedDailyRunId);
                                  if (stations.length > 0) return stations.length;
                                  const currentItem = dailyData.find(
                                    (d) => (extractSubgridName(d.subgrid) || '').toUpperCase() === cleanSg
                                  );
                                  return currentItem ? getImagesProcessedCount(currentItem) : totalImages;
                                })()
                              }
                              coordinates={inspectorCoords}
                              heading={panoramaTelemetry.yaw}
                              gpsAccuracy="0.0m"
                              equipType={projectSettings?.defaultEquipment || 'MMS 360'}
                              onIndexChange={(newIdx: number) => {
                                const cleanSg = (inspectorSubgrid || selectedSubgridFilter || '').toUpperCase().trim();

                                // Retrieve sorted sequential station track
                                const stations = getStationsForSubgrid(cleanSg, selectedDailyRunId);
                                // With no real station records there is nothing to step to.
                                // Synthesising "<subgrid>-0001.jpg" and a bearing here would
                                // push an invented panorama into app state, the map iframe
                                // and the 360 camera, so refuse instead.
                                if (stations.length === 0) return;

                                // Clamp strictly to array boundaries
                                const targetIdx = Math.max(0, Math.min(newIdx, stations.length - 1));
                                const targetStation = stations[targetIdx];
                                if (!targetStation) return;

                                const nextFn = targetStation.filename || (targetStation.image_url ? targetStation.image_url.split('?')[0].split('/').pop() || '' : '');
                                const nextUrl = nextFn ? resolvePanoramaUrl(nextFn, projectSettings, { subgrid: cleanSg }) : (targetStation?.image_url || '');
                                const nextLat = Number(targetStation?.latitude ?? (targetStation as any)?.lat ?? inspectorCoords.lat);
                                const nextLng = Number(targetStation?.longitude ?? (targetStation as any)?.lng ?? (targetStation as any)?.lon ?? inspectorCoords.lng);
                                // Hold the current heading rather than inventing one, so the
                                // camera does not swing to a fabricated bearing.
                                const nextBearing = targetStation?.bearing ?? (targetStation as any)?.heading ?? panoramaTelemetry.yaw;

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
                      <div className="w-full lg:w-56 shrink-0 bg-card rounded-lg border border-subtle p-3 flex flex-col lg:justify-between overflow-y-auto">
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
          {currentPage === 'project' ? (
            <ProjectWorkspace
              key="workspace-project"
              isGuestUser={isGuestUser}
              translate={t}
              activeProject={activeProject}
              projectList={projectList}
              projectsLoaded={projectsLoaded}
              totalKm={totalKm}
              projectSettings={projectSettings}
              onLoadProject={handleLoadProject}
              onCreateProject={handleCreateProject}
              onUpdateProject={handleUpdateProject}
              onRefreshProjects={refreshProjects}
              onDeleteProject={handleDeleteProject}
              onBackToDashboard={() => goToWorkspace('dashboard')}
            />
          ) : currentPage === 'data' ? (
            <div className="flex flex-col md:flex-1 md:min-h-0 md:overflow-hidden animate-in fade-in duration-500">
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
                canHandleApprovals={canHandleApprovals}
              />
            </div>
          ) : currentPage === 'settings' ? (
            <div className="flex flex-col md:flex-1 md:min-h-0 md:overflow-hidden animate-in fade-in duration-500">
              <div className="flex-1 min-h-0 md:overflow-y-auto">
                <AdminSettingsView
                  projectSettings={settingsDraft as any}
                  setProjectSettings={handleSettingsDraftChange as any}
                  committedSettings={projectSettings as any}
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
          ) : null}
            <WorkspaceRouter
              currentPage={currentPage}
              projectSettings={projectSettings}
              setProjectSettings={setProjectSettings}
              authSession={authSession}
              isGuestUser={isGuestUser}
              addNotification={addNotification}
              addAuditLog={addAuditLog}
              goToWorkspace={goToWorkspace}
              translate={t}
              storageFocusPath={storageFocusPath}
              openStorageAtPath={openStorageAtPath}
              activeBatchLogs={activeBatchLogs}
              dailyData={dailyData}
              handleRefreshMap={handleRefreshMap}
              auditLogs={auditLogs}
              allKnownDefects={allKnownDefects}
            />
          </React.Suspense>
          </WorkspaceErrorBoundary>
        </main>

        {/* Subgrid Image Filenames List View Modal (Main Canvas) */}
        <SubgridImagesListModal
          modal={imagesListModal}
          onClose={() => setImagesListModal(null)}
        />

                <AppTourGuide
          tourStep={tourStep}
          setTourStep={setTourStep}
          tourFirstRunOpen={tourFirstRunOpen}
          onDismissFirstRun={() => {
            setTourFirstRunOpen(false);
            try { localStorage.setItem('tourFirstRunSeen', '1'); } catch { /* ignore */ }
          }}
          onStartTour={() => {
            setTourFirstRunOpen(false);
            setTourStep(1);
            try { localStorage.setItem('tourFirstRunSeen', '1'); } catch { /* ignore */ }
          }}
          isHelpGuideOpen={isHelpGuideOpen}
        />

        <HelpGuideModal
          isOpen={isHelpGuideOpen}
          onClose={() => setIsHelpGuideOpen(false)}
          onStartTour={() => setTourStep(1)}
          initialTab={helpGuideInitialTab}
        />

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
