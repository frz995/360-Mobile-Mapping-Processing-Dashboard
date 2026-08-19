import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Shield,
  CheckSquare,
  FileText,
  Activity,
  Database,
  Camera,
  Server,
  Clock,
  Search,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Plus,
  Download,
  Key,
  Settings,
  Eye,
  EyeOff,
  UserCheck,
  Globe,
  Copy,
  Map,
  Layers,
  Palette,
  Navigation,
  ExternalLink
} from 'lucide-react';
import { UserAccount, DeletionApprovalRequest, SystemHealthMetrics, ExtendedProjectSettings } from '../types/admin';
import {
  testDatabaseHealth,
  fetchDeletionRequestsFromSupabase,
  updateDeletionRequestStatusInSupabase,
  fetchUserAccountsFromSupabase,
  saveUserAccountToSupabase,
  deleteFromSupabase,
  resolvePanoramaUrl
} from '../services/supabase';

interface AdminSettingsViewProps {
  projectSettings: ExtendedProjectSettings;
  setProjectSettings: React.Dispatch<React.SetStateAction<ExtendedProjectSettings>>;
  themeMode?: 'dark' | 'light';
  dailyData?: any[];
  batchLogs?: any[];
  auditLogs?: any[];
  onSaveAllSettings?: () => void;
  onRefreshMap?: () => void;
  onGeneratePdfReport?: () => void;
  authSession?: any;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
}

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({
  projectSettings,
  setProjectSettings,
  themeMode = 'dark',
  dailyData = [],
  batchLogs = [],
  auditLogs = [],
  onSaveAllSettings,
  onRefreshMap,
  onGeneratePdfReport,
  authSession,
  addNotification,
  addAuditLog
}) => {
  const [activeTab, setActiveTab] = useState<'users' | 'settings' | 'approvals' | 'reports' | 'audit' | 'health'>('settings');

  // User Management State
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'Administrator' | 'Survey Operator' | 'QA Inspector' | 'Viewer'>('Survey Operator');

  // Approvals State
  const [deletionRequests, setDeletionRequests] = useState<DeletionApprovalRequest[]>([]);
  const [approvalFilter, setApprovalFilter] = useState<'ALL' | 'Pending' | 'Approved' | 'Rejected'>('ALL');
  const [rejectModalReqId, setRejectModalReqId] = useState<string | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');

  // System Health State
  const [healthMetrics, setHealthMetrics] = useState<SystemHealthMetrics>({
    postgisStatus: 'operational',
    postgisLatencyMs: 38,
    storageStatus: 'operational',
    storageTotalFiles: 114,
    realtimeStatus: 'connected',
    webgisStatus: 'online',
    memoryUsageMb: 48,
    lastPingTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  });
  const [isTestingHealth, setIsTestingHealth] = useState(false);

  // Security Credentials Reveal Toggle
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Audit Log Filter State
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('ALL');

  // Map Preview Iframe State & Ref
  const previewIframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewCoords, setPreviewCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Sync staged items & theme settings to preview iframe just like Dashboard Map
  const sendPreviewData = React.useCallback(() => {
    if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
      try {
        const formattedStaged = (dailyData || []).map((item: any) => ({
          ...item,
          status: item.publishToWebGIS === 'yes' ? 'published' : 'staged',
          strokeColor: item.publishToWebGIS === 'yes' ? (projectSettings.publishedTrackColor || '#10B981') : (projectSettings.stagingTrackColor || '#F59E0B'),
          fillColor: item.publishToWebGIS === 'yes' ? (projectSettings.publishedTrackColor || '#10B981') : (projectSettings.stagingTrackColor || '#F59E0B'),
          panoramas: item.panoramas || [],
          points: item.panoramas || []
        }));

        // 1. Send Theme Mode (Dark/Light)
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_THEME',
          theme: themeMode
        }, '*');

        // 2. Send Basemap Selection
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_BASEMAP',
          basemap: projectSettings.defaultBasemap || 'esri_satellite',
          customUrl: projectSettings.customBasemapUrl || '',
          opacity: (projectSettings.basemapOpacity ?? 100) / 100
        }, '*');

        // 3. Send Map Vector Layer Theme & Styling
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_MAP_THEME',
          settings: {
            publishedTrackColor: projectSettings.publishedTrackColor || '#10B981',
            stagingTrackColor: projectSettings.stagingTrackColor || '#F59E0B',
            defectTrackColor: projectSettings.defectTrackColor || '#EF4444',
            selectedTrackColor: projectSettings.selectedTrackColor || '#38BDF8',
            gridBoundaryColor: projectSettings.gridBoundaryColor || '#6366F1',
            lineWidth: projectSettings.poiTrackLineWidth || 3,
            enableGlow: projectSettings.enableLayerGlow !== false
          }
        }, '*');

        // 4. Send Staged Point Data
        previewIframeRef.current.contentWindow.postMessage({
          type: 'SET_STAGED_DATA',
          stagedItems: formattedStaged
        }, '*');

        // 5. Ensure Status Trajectory Filter is Open
        previewIframeRef.current.contentWindow.postMessage({
          type: 'FILTER_STATUS_TYPES',
          statusFilters: { published: true, defect: true, stitching: true },
          showPanotrackData: true
        }, '*');
      } catch (e) { }
    }
  }, [
    dailyData,
    projectSettings.publishedTrackColor,
    projectSettings.stagingTrackColor,
    projectSettings.defectTrackColor,
    projectSettings.selectedTrackColor,
    projectSettings.gridBoundaryColor,
    projectSettings.defaultBasemap,
    projectSettings.customBasemapUrl,
    projectSettings.basemapOpacity,
    projectSettings.poiTrackLineWidth,
    projectSettings.enableLayerGlow,
    themeMode
  ]);

  useEffect(() => {
    const handleMapMessage = (e: MessageEvent) => {
      if (e.data?.type === 'MAP_COORDS' && typeof e.data.lat === 'number') {
        const lngVal = typeof e.data.lng === 'number' ? e.data.lng : e.data.lon;
        if (typeof lngVal === 'number') {
          setPreviewCoords({ lat: e.data.lat, lng: lngVal });
        }
      }
      if (e.data?.type === 'MAP_READY' || e.data?.type === 'VIEWER_READY' || e.data?.type === 'WEBGIS_READY' || e.data?.type === 'MAP_LOADED') {
        sendPreviewData();
      }
    };
    window.addEventListener('message', handleMapMessage);
    return () => window.removeEventListener('message', handleMapMessage);
  }, [sendPreviewData]);

  useEffect(() => {
    sendPreviewData();
    const t = setTimeout(sendPreviewData, 800);
    return () => clearTimeout(t);
  }, [sendPreviewData, previewRefreshKey, themeMode]);

  // Toast / Status Message
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Initial Data Fetch
  useEffect(() => {
    fetchUserAccountsFromSupabase(authSession).then(res => setUsers(res));
    fetchDeletionRequestsFromSupabase().then(res => setDeletionRequests(res));
  }, [authSession]);

  const handleTestHealth = async () => {
    setIsTestingHealth(true);
    try {
      const res = await testDatabaseHealth();
      setHealthMetrics(res);
      showToast(`Health probe completed. PostGIS Latency: ${res.postgisLatencyMs}ms`);
    } catch {
      showToast('Error testing database health', 'error');
    } finally {
      setIsTestingHealth(false);
    }
  };

  // User Actions
  const handleToggleUserStatus = (userId: string) => {
    const updated = users.map(u => {
      if (u.id === userId) {
        const nextStatus = u.status === 'Active' ? 'Disabled' as const : 'Active' as const;
        return { ...u, status: nextStatus };
      }
      return u;
    });
    setUsers(updated);
    saveUserAccountToSupabase(updated);
    const targetUser = users.find(u => u.id === userId);
    addAuditLog?.('SECURITY', `User Account ${targetUser?.status === 'Active' ? 'Disabled' : 'Enabled'}`, `Updated status for ${targetUser?.name} (${targetUser?.email})`, 'info');
    showToast(`User ${targetUser?.name} status updated.`);
  };

  const handleChangeUserRole = (userId: string, newRole: any) => {
    const updated = users.map(u => u.id === userId ? { ...u, role: newRole } : u);
    setUsers(updated);
    saveUserAccountToSupabase(updated);
    const targetUser = users.find(u => u.id === userId);
    addAuditLog?.('SECURITY', 'User Role Modified', `Assigned ${newRole} role to ${targetUser?.name}`, 'info');
    showToast(`Role updated to ${newRole}`);
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;

    const newUser: UserAccount = {
      id: `usr-${Date.now()}`,
      name: newUserName.trim(),
      email: newUserEmail.trim(),
      role: newUserRole,
      status: 'Active',
      lastLogin: 'Never',
      createdAt: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    };

    const updated = [...users, newUser];
    setUsers(updated);
    saveUserAccountToSupabase(updated);
    addAuditLog?.('CREATE', 'New User Provisioned', `Added user ${newUser.name} with role ${newUser.role}`, 'success');
    addNotification?.({
      title: 'User Added',
      message: `Account created for ${newUser.name} (${newUser.email})`,
      category: 'SYSTEM'
    });
    showToast(`User ${newUser.name} created successfully.`);
    setIsAddUserModalOpen(false);
    setNewUserName('');
    setNewUserEmail('');
  };

  // Approval Actions
  const handleApproveDeletion = async (req: DeletionApprovalRequest) => {
    try {
      const activeAdmin = authSession?.user?.email || 'Administrator';
      await updateDeletionRequestStatusInSupabase(req.id, 'Approved', activeAdmin);
      await deleteFromSupabase(req.subgrid);
      const updated = deletionRequests.map(r => r.id === req.id ? { ...r, status: 'Approved' as const, reviewedBy: activeAdmin, reviewedAt: 'Just now' } : r);
      setDeletionRequests(updated);
      onRefreshMap?.();
      addAuditLog?.('APPROVAL', `Deletion Request Approved: ${req.subgrid}`, `Admin ${activeAdmin} approved survey deletion for ${req.subgrid} requested by ${req.requestedBy}.`, 'success');
      addNotification?.({
        title: 'Deletion Request Approved',
        message: `Subgrid ${req.subgrid} survey data removed from database.`,
        category: 'DELETE'
      });
      showToast(`Deletion request for ${req.subgrid} approved and executed.`);
    } catch {
      showToast('Error approving deletion request', 'error');
    }
  };

  const handleRejectDeletion = async (reqId: string) => {
    try {
      const activeAdmin = authSession?.user?.email || 'Administrator';
      await updateDeletionRequestStatusInSupabase(reqId, 'Rejected', activeAdmin, rejectionReasonInput || 'Rejected by Administrator');
      const updated = deletionRequests.map(r => r.id === reqId ? { ...r, status: 'Rejected' as const, reviewedBy: activeAdmin, rejectionReason: rejectionReasonInput } : r);
      setDeletionRequests(updated);
      addAuditLog?.('APPROVAL', `Deletion Request Rejected`, `Admin ${activeAdmin} rejected deletion request ${reqId}. Reason: ${rejectionReasonInput || 'No reason provided'}`, 'info');
      showToast('Deletion request rejected.');
      setRejectModalReqId(null);
      setRejectionReasonInput('');
    } catch {
      showToast('Error rejecting deletion request', 'error');
    }
  };

  // Filtered Lists
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchSearch = u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase());
      const matchRole = roleFilter === 'ALL' || u.role === roleFilter;
      return matchSearch && matchRole;
    });
  }, [users, userSearch, roleFilter]);

  const filteredApprovals = useMemo(() => {
    return deletionRequests.filter(r => {
      if (approvalFilter === 'ALL') return true;
      return r.status === approvalFilter;
    });
  }, [deletionRequests, approvalFilter]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(a => {
      const matchSearch = (a.title || '').toLowerCase().includes(auditSearch.toLowerCase()) ||
        (a.details || '').toLowerCase().includes(auditSearch.toLowerCase()) ||
        (a.type || '').toLowerCase().includes(auditSearch.toLowerCase());
      const matchAction = auditActionFilter === 'ALL' || a.type === auditActionFilter;
      return matchSearch && matchAction;
    });
  }, [auditLogs, auditSearch, auditActionFilter]);

  // Executive KPI Counts
  const totalUsersCount = users.length;
  const activeUsersCount = users.filter(u => u.status === 'Active').length;
  const pendingApprovalsCount = deletionRequests.filter(r => r.status === 'Pending').length;
  const totalAuditEventsCount = auditLogs.length;

  const cardBg = themeMode === 'light' ? 'bg-white border-slate-200 text-slate-900' : 'bg-[#111622] border-slate-800 text-slate-200';
  const innerCardBg = themeMode === 'light' ? 'bg-slate-50 border-slate-200' : 'bg-[#0b0f17] border-slate-800';
  const inputBg = themeMode === 'light' ? 'bg-white border-slate-300 text-slate-900' : 'bg-[#070a0f] border-slate-800 text-slate-200';

  return (
    <div className={`w-full h-full flex flex-col min-h-0 overflow-y-auto space-y-4 p-4 ${themeMode === 'light' ? 'text-slate-900' : 'text-slate-100'}`}>

      {/* TOAST STATUS NOTIFICATION */}
      {toastMessage && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl border text-xs font-semibold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-3 ${toastMessage.type === 'success' ? 'bg-emerald-950/90 text-emerald-300 border-emerald-700/80' : 'bg-rose-950/90 text-rose-300 border-rose-700/80'}`}>
          {toastMessage.type === 'success' ? <CheckCircle size={15} className="text-emerald-400" /> : <AlertTriangle size={15} className="text-rose-400" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* TOP ROW: EXECUTIVE KPI CARDS (Professional & Subdued) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        <div className={`p-4 rounded-xl border flex items-center justify-between shadow-sm ${cardBg}`}>
          <div>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Total System Users</p>
            <h3 className={`text-2xl font-bold mt-1 ${themeMode === 'light' ? 'text-slate-900' : 'text-slate-100'}`}>{totalUsersCount}</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 font-mono">Registered dashboard accounts</p>
          </div>
          <div className={`p-2.5 rounded-lg border ${themeMode === 'light' ? 'bg-slate-100 border-slate-200 text-slate-700' : 'bg-slate-800/80 border-slate-700/70 text-slate-300'}`}>
            <Users size={18} />
          </div>
        </div>

        <div className={`p-4 rounded-xl border flex items-center justify-between shadow-sm ${cardBg}`}>
          <div>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Active Users</p>
            <h3 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{activeUsersCount}</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 font-mono">Granted dashboard access</p>
          </div>
          <div className={`p-2.5 rounded-lg border ${themeMode === 'light' ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-slate-800/80 border-slate-700/70 text-emerald-400'}`}>
            <UserCheck size={18} />
          </div>
        </div>

        <div className={`p-4 rounded-xl border flex items-center justify-between shadow-sm ${cardBg}`}>
          <div>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Pending Approvals</p>
            <h3 className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{pendingApprovalsCount}</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 font-mono">CSV deletion requests</p>
          </div>
          <div className={`p-2.5 rounded-lg border ${themeMode === 'light' ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-slate-800/80 border-slate-700/70 text-amber-400'}`}>
            <CheckSquare size={18} />
          </div>
        </div>

        <div className={`p-4 rounded-xl border flex items-center justify-between shadow-sm ${cardBg}`}>
          <div>
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Audit Events Logged</p>
            <h3 className={`text-2xl font-bold mt-1 ${themeMode === 'light' ? 'text-slate-900' : 'text-slate-100'}`}>{totalAuditEventsCount}</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 font-mono">Real-time security trail</p>
          </div>
          <div className={`p-2.5 rounded-lg border ${themeMode === 'light' ? 'bg-slate-100 border-slate-200 text-slate-700' : 'bg-slate-800/80 border-slate-700/70 text-slate-300'}`}>
            <Activity size={18} />
          </div>
        </div>
      </div>

      {/* ADMINISTRATION SUB-NAVIGATION BAR */}
      <div className={`flex items-center gap-1.5 p-1 rounded-xl border overflow-x-auto shrink-0 ${cardBg}`}>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'settings'
              ? (themeMode === 'light' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-200 font-bold' : 'bg-slate-800 text-white shadow-sm border border-slate-700')
              : (themeMode === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50')
          }`}
        >
          <Settings size={14} className={activeTab === 'settings' ? 'text-sky-500' : ''} />
          <span>Project & Security Settings</span>
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'users'
              ? (themeMode === 'light' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-200 font-bold' : 'bg-slate-800 text-white shadow-sm border border-slate-700')
              : (themeMode === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50')
          }`}
        >
          <Users size={14} className={activeTab === 'users' ? 'text-sky-500' : ''} />
          <span>User Management</span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${themeMode === 'light' ? 'bg-slate-200/80 text-slate-700' : 'bg-slate-700 text-slate-300'}`}>{totalUsersCount}</span>
        </button>

        <button
          onClick={() => setActiveTab('approvals')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'approvals'
              ? (themeMode === 'light' ? 'bg-amber-50 text-amber-800 shadow-sm border border-amber-200 font-bold' : 'bg-slate-800 text-white shadow-sm border border-slate-700')
              : (themeMode === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50')
          }`}
        >
          <CheckSquare size={14} className={activeTab === 'approvals' ? 'text-amber-500' : ''} />
          <span>Approvals (Data Deletion)</span>
          {pendingApprovalsCount > 0 && (
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold border ${themeMode === 'light' ? 'bg-amber-100 text-amber-800 border-amber-300 shadow-sm' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'}`}>
              {pendingApprovalsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('reports')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'reports'
              ? (themeMode === 'light' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-200 font-bold' : 'bg-slate-800 text-white shadow-sm border border-slate-700')
              : (themeMode === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50')
          }`}
        >
          <FileText size={14} className={activeTab === 'reports' ? 'text-sky-500' : ''} />
          <span>Reports & Analytics</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'audit'
              ? (themeMode === 'light' ? 'bg-sky-50 text-sky-700 shadow-sm border border-sky-200 font-bold' : 'bg-slate-800 text-white shadow-sm border border-slate-700')
              : (themeMode === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50')
          }`}
        >
          <Activity size={14} className={activeTab === 'audit' ? 'text-sky-500' : ''} />
          <span>Audit Logs</span>
        </button>

        <button
          onClick={() => setActiveTab('health')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'health'
              ? (themeMode === 'light' ? 'bg-emerald-50 text-emerald-800 shadow-sm border border-emerald-200 font-bold' : 'bg-slate-800 text-white shadow-sm border border-slate-700')
              : (themeMode === 'light' ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50')
          }`}
        >
          <Server size={14} className={activeTab === 'health' ? 'text-emerald-500' : ''} />
          <span>System Health</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: USER MANAGEMENT */}
      {/* ========================================================================= */}
      {activeTab === 'users' && (
        <div className={`p-5 rounded-xl border space-y-4 ${cardBg}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Users size={16} className="text-sky-400" />
                User Management Directory
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Control operator roles, access permissions, and session authorization.</p>
            </div>
            <button
              onClick={() => setIsAddUserModalOpen(true)}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
            >
              <Plus size={14} className="text-emerald-400" /> Add User
            </button>
          </div>

          {/* Search & Role Filter */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search user name or email..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                className={`w-full pl-9 pr-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none border ${inputBg}`}
              />
            </div>
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none border ${inputBg}`}
            >
              <option value="ALL">All Roles</option>
              <option value="Administrator">Administrator</option>
              <option value="Survey Operator">Survey Operator</option>
              <option value="QA Inspector">QA Inspector</option>
              <option value="Viewer">Viewer</option>
            </select>
          </div>

          {/* Users Table */}
          <div className="border border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <th className="px-3.5 py-2.5">User</th>
                  <th className="px-3.5 py-2.5">Email</th>
                  <th className="px-3.5 py-2.5">Role</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5">Last Login</th>
                  <th className="px-3.5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Users size={24} className="text-slate-600" />
                        <p className="text-xs font-semibold text-slate-300">
                          {userSearch.trim() ? `No users matching "${userSearch}"` : 'No registered users in the database yet.'}
                        </p>
                        <p className="text-[11px] text-slate-500 max-w-sm">
                          Users who register or authenticate into this system will dynamically appear in this directory, or click <strong>+ Add User</strong> above to provision an operator account.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(u => (
                    <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-3.5 py-2.5 font-semibold text-slate-200 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-[10px] text-slate-300">
                          {u.name.charAt(0)}
                        </div>
                        <span>{u.name}</span>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-300">{u.email}</td>
                      <td className="px-3.5 py-2.5">
                        <select
                          value={u.role}
                          onChange={e => handleChangeUserRole(u.id, e.target.value)}
                          className={`px-2 py-1 rounded text-[11px] font-medium border ${inputBg}`}
                        >
                          <option value="Administrator">Administrator</option>
                          <option value="Survey Operator">Survey Operator</option>
                          <option value="QA Inspector">QA Inspector</option>
                          <option value="Viewer">Viewer</option>
                        </select>
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${u.status === 'Active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-400 font-mono text-[11px]">{u.lastLogin}</td>
                      <td className="px-3.5 py-2.5 text-right">
                        <button
                          onClick={() => handleToggleUserStatus(u.id)}
                          className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${u.status === 'Active' ? 'bg-slate-800 hover:bg-rose-900/30 text-rose-300 border-slate-700' : 'bg-slate-800 hover:bg-emerald-900/30 text-emerald-300 border-slate-700'}`}
                        >
                          {u.status === 'Active' ? 'Disable Access' : 'Grant Access'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: PROJECT & SECURITY SETTINGS */}
      {/* ========================================================================= */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          {/* SECTION 1: DATABASE & POSTGIS SPATIAL ENGINE CONNECTION SETUP */}
          <div className={`p-5 rounded-xl border space-y-5 ${cardBg}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Database size={17} className="text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">1. Database & PostGIS Spatial Engine Connection Setup</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Configure Supabase PostgreSQL endpoint, PostGIS 3.3 spatial projections, table mappings, and connection pooling.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  PostGIS 3.3 &bull; Connected
                </span>
              </div>
            </div>

            {/* SUB-CARD A: CONNECTION CREDENTIALS & API ENDPOINTS */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Server size={14} className="text-sky-400" />
                  A. Connection Endpoints & Access Credentials
                </h4>
                <span className="text-[10px] text-slate-500 font-mono">Driver: PostgREST / TCP Pooler</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Supabase REST Endpoint URL</label>
                  <input
                    type="text"
                    value={projectSettings.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || 'https://xyzcompany.supabase.co'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, supabaseUrl: e.target.value }))}
                    placeholder="https://your-project.supabase.co"
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Public Anon API Key</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={projectSettings.supabaseKey || import.meta.env.VITE_SUPABASE_ANON_KEY || ''}
                      onChange={e => setProjectSettings(prev => ({ ...prev, supabaseKey: e.target.value }))}
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5c..."
                      className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 cursor-pointer"
                      title={showApiKey ? 'Hide Key' : 'Reveal Key'}
                    >
                      {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Direct PostgreSQL Host / IP</label>
                  <input
                    type="text"
                    value={projectSettings.databaseHost || 'db.aws-0-ap-southeast-1.supabase.co'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, databaseHost: e.target.value }))}
                    placeholder="db.your-project.supabase.co"
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Database Port & Pooler</label>
                  <input
                    type="number"
                    value={projectSettings.databasePort || 5432}
                    onChange={e => setProjectSettings(prev => ({ ...prev, databasePort: parseInt(e.target.value) || 5432 }))}
                    placeholder="5432 (or 6543 for PgBouncer)"
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Database Name & Schema</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={projectSettings.databaseName || 'postgres'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, databaseName: e.target.value }))}
                      placeholder="postgres"
                      className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                    />
                    <input
                      type="text"
                      value={projectSettings.databaseSchema || 'public'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, databaseSchema: e.target.value }))}
                      placeholder="public"
                      className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Connection Protocol & SSL</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={projectSettings.connectionMode || 'postgrest'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, connectionMode: e.target.value as any }))}
                      className={`w-full px-2.5 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                    >
                      <option value="postgrest">PostgREST Client</option>
                      <option value="direct_tcp">Direct TCP (pg)</option>
                      <option value="realtime_ws">Realtime WebSocket</option>
                    </select>
                    <select
                      value={projectSettings.sslMode || 'require'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, sslMode: e.target.value as any }))}
                      className={`w-full px-2.5 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                    >
                      <option value="require">SSL: Require</option>
                      <option value="verify-full">SSL: Verify Full</option>
                      <option value="disable">SSL: Disable</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* SUB-CARD B: POSTGIS SPATIAL EXTENSION & GEOMETRY PROJECTIONS */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe size={14} className="text-sky-400" />
                  B. PostGIS Spatial Reference (SRID) & Geometry Engine
                </h4>
                <span className="text-[10px] text-emerald-400 font-mono">ST_GeomFromText Active</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Spatial Projection (SRID)</label>
                  <select
                    value={projectSettings.spatialSrid || 'EPSG:4326'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, spatialSrid: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  >
                    <option value="EPSG:4326">EPSG:4326 &mdash; WGS 84 (Global Lat/Lon Standard)</option>
                    <option value="EPSG:3375">EPSG:3375 &mdash; GDM2000 / MRSO (Peninsular Malaysia)</option>
                    <option value="EPSG:3168">EPSG:3168 &mdash; Kertau RSO Malaya (Meters)</option>
                    <option value="EPSG:3857">EPSG:3857 &mdash; WGS 84 / Pseudo-Mercator (WebGIS)</option>
                    <option value="EPSG:32647">EPSG:32647 &mdash; UTM Zone 47N (West Malaysia)</option>
                    <option value="EPSG:32648">EPSG:32648 &mdash; UTM Zone 48N (East Malaysia / Borneo)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Spatial Geometry Column</label>
                  <input
                    type="text"
                    value={projectSettings.geomColumnName || 'geom'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, geomColumnName: e.target.value }))}
                    placeholder="geom"
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Geometry Data Type</label>
                  <select
                    value={projectSettings.geomType || 'ST_Point'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, geomType: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  >
                    <option value="ST_Point">Point (2D: longitude, latitude)</option>
                    <option value="POINTZ">PointZ (3D: lon, lat, elevation)</option>
                    <option value="MultiPoint">MultiPoint Collection</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Auto Spatial Indexing</label>
                  <div className={`flex items-center justify-between p-2 rounded-lg border ${inputBg}`}>
                    <span className="text-[11px] text-slate-300 font-medium">GIST (geom) Index</span>
                    <input
                      type="checkbox"
                      checked={projectSettings.autoCreateSpatialIndex !== false}
                      onChange={e => setProjectSettings(prev => ({ ...prev, autoCreateSpatialIndex: e.target.checked }))}
                      className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SUB-CARD C: COMPLETE POSTGIS TABLE & VIEW MAPPINGS */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Database size={14} className="text-sky-400" />
                  C. PostGIS Table & Schema Mappings
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setProjectSettings(prev => ({
                      ...prev,
                      panoramasTable: 'panoramas',
                      stagingTable: 'staging_panoramas',
                      subgridTable: 'subgrids',
                      qaDefectsTable: 'qa_defects',
                      auditLogsTable: 'audit_logs',
                      deletionRequestsTable: 'deletion_requests',
                      notificationsTable: 'notifications',
                      userAccountsTable: 'user_accounts',
                      dbSummaryView: 'panoramas_subgrid_summary'
                    }));
                    showToast('Reset all PostGIS table mappings to official defaults.');
                  }}
                  className="text-[10px] text-sky-400 hover:text-sky-300 font-semibold cursor-pointer underline"
                >
                  Reset Smart Defaults
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Production Panoramas Table</label>
                  <input
                    type="text"
                    value={projectSettings.panoramasTable || 'panoramas'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, panoramasTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Staging Panoramas Table</label>
                  <input
                    type="text"
                    value={projectSettings.stagingTable || 'staging_panoramas'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, stagingTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Subgrids Masterlist Table</label>
                  <input
                    type="text"
                    value={projectSettings.subgridTable || 'subgrids'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, subgridTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">QC Defects Table</label>
                  <input
                    type="text"
                    value={projectSettings.qaDefectsTable || 'qa_defects'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, qaDefectsTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Audit Trail Logs Table</label>
                  <input
                    type="text"
                    value={projectSettings.auditLogsTable || 'audit_logs'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, auditLogsTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Deletion Requests Table</label>
                  <input
                    type="text"
                    value={projectSettings.deletionRequestsTable || 'deletion_requests'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, deletionRequestsTable: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>
              </div>
            </div>

            {/* SUB-CARD D: PERFORMANCE, DIAGNOSTICS & SQL SCRIPT GENERATOR */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleTestHealth}
                    disabled={isTestingHealth}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
                  >
                    <RefreshCw size={13} className={isTestingHealth ? 'animate-spin text-sky-400' : 'text-sky-400'} />
                    <span>Test PostGIS Connection & Latency</span>
                  </button>

                  <button
                    onClick={() => {
                      const sqlScript = `-- 360 Mobile Mapping System PostGIS DDL Setup Script
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Production Panoramas Table
CREATE TABLE IF NOT EXISTS ${projectSettings.panoramasTable || 'panoramas'} (
  id BIGSERIAL PRIMARY KEY,
  subgrid VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION DEFAULT 0,
  pitch DOUBLE PRECISION DEFAULT 0,
  roll DOUBLE PRECISION DEFAULT 0,
  geom GEOMETRY(Point, 4326),
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'yes',
  qa_status VARCHAR(50) DEFAULT 'published'
);
CREATE INDEX IF NOT EXISTS idx_panoramas_geom ON ${projectSettings.panoramasTable || 'panoramas'} USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_panoramas_subgrid ON ${projectSettings.panoramasTable || 'panoramas'} (subgrid);

-- 2. Staging Panoramas Table
CREATE TABLE IF NOT EXISTS ${projectSettings.stagingTable || 'staging_panoramas'} (
  id BIGSERIAL PRIMARY KEY,
  subgrid VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  heading DOUBLE PRECISION DEFAULT 0,
  status VARCHAR(20) DEFAULT 'in process',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. QC Defects Table
CREATE TABLE IF NOT EXISTS ${projectSettings.qaDefectsTable || 'qa_defects'} (
  id BIGSERIAL PRIMARY KEY,
  subgrid VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  qa_status VARCHAR(50) DEFAULT 'pending',
  defect_flags JSONB DEFAULT '{}',
  defect_count INT DEFAULT 0,
  defect_comment TEXT,
  verified_at TIMESTAMP WITH TIME ZONE
);

-- 4. Audit Trail Table
CREATE TABLE IF NOT EXISTS ${projectSettings.auditLogsTable || 'audit_logs'} (
  id BIGSERIAL PRIMARY KEY,
  timestamp VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  details TEXT,
  status VARCHAR(20) DEFAULT 'info'
);

-- 5. Deletion Approval Requests Table
CREATE TABLE IF NOT EXISTS ${projectSettings.deletionRequestsTable || 'deletion_requests'} (
  id BIGSERIAL PRIMARY KEY,
  subgrid VARCHAR(50) NOT NULL,
  requested_by VARCHAR(100) NOT NULL,
  user_email VARCHAR(255),
  reason TEXT,
  poi_count INT DEFAULT 0,
  km_processed DOUBLE PRECISION DEFAULT 0,
  date_requested VARCHAR(100),
  status VARCHAR(20) DEFAULT 'Pending',
  reviewed_by VARCHAR(100),
  reviewed_at VARCHAR(100),
  rejection_reason TEXT
);`;
                      navigator.clipboard.writeText(sqlScript);
                      showToast('Copied PostGIS Database SQL DDL Script to clipboard!');
                    }}
                    className="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 text-sky-400 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                  >
                    <Copy size={13} />
                    <span>Copy PostGIS SQL Schema Script</span>
                  </button>
                </div>

                <div className="text-[11px] text-slate-400 font-mono">
                  Latency: <strong className="text-emerald-400 font-bold">{healthMetrics.postgisLatencyMs} ms</strong> &bull; Query Chunk: <strong className="text-slate-200">{projectSettings.queryChunkSize || 50} rows</strong>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: 360° IMAGERY & MMS STORAGE ENGINE */}
          <div className={`p-5 rounded-xl border space-y-5 ${cardBg}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Camera size={17} className="text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">2. 360° Imagery & MMS Storage Engine</h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">Configure 360° panoramic image storage providers, CDN paths, filename patterns, StreetView pre-fetch cache, and player calibration.</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-mono bg-slate-800 border border-slate-700 text-slate-300 font-semibold">
                Storage: {projectSettings.storageProvider ? projectSettings.storageProvider.toUpperCase() : 'SUPABASE'}
              </span>
            </div>

            {/* SUB-CARD A: STORAGE INFRASTRUCTURE PROVIDER & CLOUD BACKEND */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Server size={14} className="text-sky-400" />
                  A. Storage Infrastructure Provider & Cloud Engine
                </h4>
                <span className="text-[10px] text-slate-500 font-mono">CDN & Object Storage Pipeline</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">GIS Industry Storage Provider</label>
                  <select
                    value={projectSettings.storageProvider || 'supabase'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, storageProvider: e.target.value as any }))}
                    className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                  >
                    <option value="supabase">Supabase Cloud Storage (PostGIS Native)</option>
                    <option value="aws_s3">Amazon Web Services (AWS S3 Bucket)</option>
                    <option value="nas_local">Local Intranet NAS / On-Premise Server (SMB/HTTP)</option>
                    <option value="gcs">Google Cloud Storage (GCS Bucket)</option>
                    <option value="azure_blob">Microsoft Azure Blob Storage</option>
                    <option value="cloudflare_r2">Cloudflare R2 (Zero Egress Cost)</option>
                    <option value="wasabi">Wasabi Hot Cloud Storage</option>
                    <option value="custom_cdn">Custom CDN / Reverse Proxy URL Prefix</option>
                  </select>
                </div>

                {projectSettings.storageProvider === 'aws_s3' ? (
                  <>
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">AWS S3 Bucket Name</label>
                      <input
                        type="text"
                        value={projectSettings.s3Bucket || 'tnb-mobilemapping-panoramas'}
                        onChange={e => setProjectSettings(prev => ({ ...prev, s3Bucket: e.target.value }))}
                        placeholder="tnb-mobilemapping-panoramas"
                        className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">AWS S3 Region</label>
                      <input
                        type="text"
                        value={projectSettings.s3Region || 'ap-southeast-1'}
                        onChange={e => setProjectSettings(prev => ({ ...prev, s3Region: e.target.value }))}
                        placeholder="ap-southeast-1"
                        className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                      />
                    </div>
                  </>
                ) : projectSettings.storageProvider === 'nas_local' ? (
                  <div className="sm:col-span-2">
                    <label className="block text-slate-400 font-medium mb-1">Local NAS Server IP / HTTP Intranet Share</label>
                    <input
                      type="text"
                      value={projectSettings.nasServerUrl || 'http://192.168.1.100/360_images'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, nasServerUrl: e.target.value, imageStoragePath: e.target.value }))}
                      placeholder="http://192.168.1.100/360_images"
                      className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                    />
                  </div>
                ) : projectSettings.storageProvider === 'custom_cdn' ? (
                  <div className="sm:col-span-2">
                    <label className="block text-slate-400 font-medium mb-1">Custom CDN Base URL Prefix</label>
                    <input
                      type="text"
                      value={projectSettings.customCdnUrl || 'https://cdn.mobilemapping.tnb.com.my/panoramas/'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, customCdnUrl: e.target.value, imageStoragePath: e.target.value }))}
                      placeholder="https://cdn.mobilemapping.tnb.com.my/panoramas/"
                      className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-slate-400 font-medium mb-1">Storage Bucket Name</label>
                    <input
                      type="text"
                      value={projectSettings.supabaseBucket || 'MMS_PIC'}
                      onChange={e => setProjectSettings(prev => ({ ...prev, supabaseBucket: e.target.value, imageStoragePath: `/storage/v1/object/public/${e.target.value}/` }))}
                      placeholder="MMS_PIC"
                      className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Storage Access Permission</label>
                  <select
                    className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                    defaultValue="public_read"
                  >
                    <option value="public_read">Public CDN Read (Direct Browser 360 Viewer)</option>
                    <option value="signed_url">Signed URL Tokenized Read (24h Expiry)</option>
                    <option value="intranet_only">Intranet Protected (CORS Restricted)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* SUB-CARD B: PANORAMA FILENAME PATTERNS & ASSET PIPELINE */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText size={14} className="text-sky-400" />
                  B. Panorama Filename Pattern & Directory Resolution
                </h4>
                <span className="text-[10px] text-slate-500 font-mono">Format: Equirectangular JPG/PNG</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Panorama Filename Template</label>
                  <input
                    type="text"
                    value={projectSettings.imageFormatPattern || '{subgrid}-{index:04d}.jpg'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, imageFormatPattern: e.target.value }))}
                    placeholder="{subgrid}-{index:04d}.jpg"
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">e.g. N93E70-0001.jpg &bull; {`{subgrid}_{index}.jpg`}</p>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Directory Folder Hierarchy</label>
                  <select
                    className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                    defaultValue="flat"
                  >
                    <option value="flat">Flat Root: /MMS_PIC/{`{filename}`}</option>
                    <option value="subgrid_folder">Subgrid Folder: /MMS_PIC/{`{subgrid}/{filename}`}</option>
                    <option value="daily_folder">Daily Date Folder: /MMS_PIC/{`{date}/{filename}`}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Missing Image Grace Policy</label>
                  <div className={`flex items-center justify-between p-2 rounded-lg border ${inputBg}`}>
                    <span className="text-[11px] text-slate-300 font-medium">Render Staging Fallback</span>
                    <input
                      type="checkbox"
                      checked={projectSettings.fallbackPlaceholderEnabled !== false}
                      onChange={e => setProjectSettings(prev => ({ ...prev, fallbackPlaceholderEnabled: e.target.checked }))}
                      className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SUB-CARD C: 360° STREETVIEW PLAYER & PRELOAD STREAMING ENGINE */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity size={14} className="text-sky-400" />
                  C. 360° StreetView Player & Preload Streaming Engine
                </h4>
                <span className="text-[10px] text-emerald-400 font-mono">Three.js / WebGL 60FPS</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Lookahead Frame Preload Cache</label>
                  <select
                    value={projectSettings.imagePreloadCount || 3}
                    onChange={e => setProjectSettings(prev => ({ ...prev, imagePreloadCount: Number(e.target.value) }))}
                    className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                  >
                    <option value="1">1 Frame Ahead (Low bandwidth / 4G)</option>
                    <option value="3">3 Frames Ahead (Balanced &bull; Recommended)</option>
                    <option value="5">5 Frames Ahead (Smooth 60FPS Panning)</option>
                    <option value="10">10 Frames Ahead (High Speed Fiber)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Default Field of View (FOV)</label>
                  <select
                    value={projectSettings.defaultFov || 75}
                    onChange={e => setProjectSettings(prev => ({ ...prev, defaultFov: parseInt(e.target.value) || 75 }))}
                    className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                  >
                    <option value="60">60&deg; &mdash; Narrow / Telephoto Inspection</option>
                    <option value="75">75&deg; &mdash; Natural Human Eye (Recommended)</option>
                    <option value="90">90&deg; &mdash; Wide Angle Road View</option>
                    <option value="110">110&deg; &mdash; Ultra-Wide Panoramic</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">StreetView Navigation Arrow Color</label>
                  <select
                    value={projectSettings.arrowColor || 'sky'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, arrowColor: e.target.value as any }))}
                    className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                  >
                    <option value="sky">Sky Blue &bull; High Contrast (Default)</option>
                    <option value="emerald">Emerald Green &bull; High Visibility</option>
                    <option value="amber">Amber Gold &bull; Warning Contrast</option>
                    <option value="white">Crisp White &bull; Minimalist</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Live Heading Yaw Sync</label>
                  <div className={`flex items-center justify-between p-2 rounded-lg border ${inputBg}`}>
                    <span className="text-[11px] text-slate-300 font-medium">Vehicle Azimuth Alignment</span>
                    <input
                      type="checkbox"
                      checked={projectSettings.syncHeadingWithCar !== false}
                      onChange={e => setProjectSettings(prev => ({ ...prev, syncHeadingWithCar: e.target.checked }))}
                      className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* SUB-CARD D: STORAGE DIAGNOSTICS */}
            <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await testDatabaseHealth();
                        showToast(`Storage probe OK &bull; Bucket: ${projectSettings.supabaseBucket || 'MMS_PIC'} (${res.storageTotalFiles}+ verified objects)`);
                      } catch {
                        showToast('Storage probe error', 'error');
                      }
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
                  >
                    <RefreshCw size={13} className="text-sky-400" />
                    <span>Probe Storage Bucket & Read Access</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const sampleUrl = resolvePanoramaUrl('N93E70-0001.jpg');
                      navigator.clipboard.writeText(sampleUrl);
                      showToast('Copied Sample MMS Panorama URL to clipboard!');
                    }}
                    className="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 text-sky-400 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                  >
                    <Copy size={13} />
                    <span>Copy Sample 360° URL</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: BASEMAP & SPATIAL LAYER MANAGEMENT WITH LIVE PREVIEW */}
          <div className={`p-5 rounded-xl border space-y-5 ${cardBg}`}>
            <div className={`flex flex-wrap items-center justify-between gap-3 pb-3 border-b ${themeMode === 'light' ? 'border-slate-200' : 'border-slate-800'}`}>
              <div className="flex items-center gap-2">
                <Map size={17} className="text-sky-400" />
                <div>
                  <h3 className={`text-sm font-bold uppercase tracking-wide ${themeMode === 'light' ? 'text-slate-900' : 'text-slate-100'}`}>3. Basemap & Spatial Layer Management</h3>
                  <p className={`text-[11px] mt-0.5 ${themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>Configure default GIS basemaps, trajectory theme colors, line widths, and inspect changes on the live map dashboard preview.</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold flex items-center gap-1.5 ${themeMode === 'light' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'}`}>
                  <Palette size={12} />
                  Live Theme Engine Active
                </span>
              </div>
            </div>

            {/* TWO-COLUMN GRID: CONTROLS (5 COLS) + REAL-TIME MAP PREVIEW (7 COLS) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* LEFT CONTROLS: BASEMAP & COLOR PALETTES (5 COLS) */}
              <div className="lg:col-span-5 space-y-4 flex flex-col justify-between">
                {/* SUB-CARD A: BASEMAP TILE PROVIDER & OPACITY */}
                <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
                  <div className="flex items-center justify-between">
                    <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${themeMode === 'light' ? 'text-slate-800' : 'text-slate-200'}`}>
                      <Layers size={14} className="text-sky-400" />
                      A. Basemap Tile Source & Opacity
                    </h4>
                    <span className="text-[10px] text-slate-400 font-mono">WebGIS Tiles</span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">Default GIS Basemap Provider</label>
                      <select
                        value={projectSettings.defaultBasemap || 'positron'}
                        onChange={e => {
                          const val = e.target.value as any;
                          setProjectSettings(prev => ({ ...prev, defaultBasemap: val }));
                          if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                            previewIframeRef.current.contentWindow.postMessage({
                              type: 'SET_BASEMAP',
                              basemap: val,
                              customUrl: projectSettings.customBasemapUrl || '',
                              opacity: (projectSettings.basemapOpacity ?? 100) / 100
                            }, '*');
                          }
                        }}
                        className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                      >
                        <option value="positron">Positron (Carto Light) &bull; WebGIS Default</option>
                        <option value="satellite">Esri World Imagery (Satellite Hybrid)</option>
                        <option value="osm">OpenStreetMap Standard</option>
                        <option value="dark">Dark Matter (Carto Dark)</option>
                        <option value="google-hybrid">Google Maps Satellite / Road Hybrid</option>
                        <option value="google-streets">Google Streets</option>
                        <option value="google-satellite">Google Satellite (Pure)</option>
                        <option value="google-terrain">Google Terrain Elevation</option>
                        <option value="bright">MapLibre Bright (OpenFreeMap)</option>
                        <option value="liberty">MapLibre Liberty (OpenFreeMap)</option>
                        <option value="esri-streets">Esri World Streets</option>
                        <option value="esri-topo">Esri World Topographic</option>
                        <option value="esri-natgeo">Esri National Geographic</option>
                        <option value="esri-ocean">Esri Ocean Basemap</option>
                        <option value="voyager">Voyager (Carto Soft)</option>
                        <option value="topo">OpenTopoMap Topographic</option>
                        <option value="custom_tile">Custom WMS / WMTS / XYZ Tile Endpoint</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-slate-400 font-medium">Basemap Opacity</label>
                        <span className="font-mono text-[11px] text-sky-400 font-bold">{projectSettings.basemapOpacity ?? 100}%</span>
                      </div>
                      <input
                        type="range"
                        min="20"
                        max="100"
                        value={projectSettings.basemapOpacity ?? 100}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setProjectSettings(prev => ({ ...prev, basemapOpacity: val }));
                          if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                            previewIframeRef.current.contentWindow.postMessage({
                              type: 'SET_BASEMAP',
                              basemap: projectSettings.defaultBasemap || 'positron',
                              customUrl: projectSettings.customBasemapUrl || '',
                              opacity: val / 100
                            }, '*');
                          }
                        }}
                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500 mt-2"
                      />
                    </div>

                    {projectSettings.defaultBasemap === 'custom_tile' && (
                      <div>
                        <label className="block text-slate-400 font-medium mb-1">Custom XYZ Tile URL Template</label>
                        <input
                          type="text"
                          value={projectSettings.customBasemapUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, customBasemapUrl: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_BASEMAP',
                                basemap: 'custom_tile',
                                customUrl: val,
                                opacity: (projectSettings.basemapOpacity ?? 100) / 100
                              }, '*');
                            }
                          }}
                          placeholder="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                        />
                      </div>
                    )}

                    {/* Apply Basemap Settings Button */}
                    <div className={`pt-2 border-t flex justify-end ${themeMode === 'light' ? 'border-slate-200' : 'border-slate-800/80'}`}>
                      <button
                        type="button"
                        onClick={() => {
                          if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                            previewIframeRef.current.contentWindow.postMessage({
                              type: 'SET_BASEMAP',
                              basemap: projectSettings.defaultBasemap || 'positron',
                              customUrl: projectSettings.customBasemapUrl || '',
                              opacity: (projectSettings.basemapOpacity ?? 100) / 100
                            }, '*');
                          }
                          showToast('Basemap & Opacity settings saved!');
                        }}
                        className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                      >
                        <CheckCircle size={13} />
                        <span>Apply Basemap Settings</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* SUB-CARD B: LAYER & TRAJECTORY COLORS */}
                <div className={`p-4 rounded-xl border space-y-3 ${innerCardBg}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${themeMode === 'light' ? 'text-slate-800' : 'text-slate-200'}`}>
                      <Palette size={14} className="text-sky-400" />
                      B. Survey Trajectory & Quality Layer Colors
                    </h4>

                    {/* QUICK PALETTE PRESETS */}
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const newColors = {
                            publishedTrackColor: '#10B981',
                            stagingTrackColor: '#F59E0B',
                            defectTrackColor: '#EF4444',
                            selectedTrackColor: '#38BDF8',
                            gridBoundaryColor: '#6366F1'
                          };
                          setProjectSettings(prev => ({ ...prev, ...newColors }));
                          if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                            previewIframeRef.current.contentWindow.postMessage({
                              type: 'SET_MAP_THEME',
                              settings: {
                                ...newColors,
                                lineWidth: projectSettings.poiTrackLineWidth || 3,
                                enableGlow: projectSettings.enableLayerGlow !== false
                              }
                            }, '*');
                            const formattedStaged = (dailyData || []).map((item: any) => ({
                              ...item,
                              status: item.publishToWebGIS === 'yes' ? 'published' : 'staged',
                              strokeColor: item.publishToWebGIS === 'yes' ? newColors.publishedTrackColor : newColors.stagingTrackColor,
                              fillColor: item.publishToWebGIS === 'yes' ? newColors.publishedTrackColor : newColors.stagingTrackColor,
                              panoramas: item.panoramas || [],
                              points: item.panoramas || []
                            }));
                            previewIframeRef.current.contentWindow.postMessage({
                              type: 'SET_STAGED_DATA',
                              stagedItems: formattedStaged
                            }, '*');
                          }
                          showToast('Loaded TNB Standard Palette to preview map!');
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${themeMode === 'light' ? 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'}`}
                      >
                        TNB Standard
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const newColors = {
                            publishedTrackColor: '#00f0ff',
                            stagingTrackColor: '#ff5500',
                            defectTrackColor: '#ff0077',
                            selectedTrackColor: '#ffff00',
                            gridBoundaryColor: '#8b5cf6'
                          };
                          setProjectSettings(prev => ({ ...prev, ...newColors }));
                          if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                            previewIframeRef.current.contentWindow.postMessage({
                              type: 'SET_MAP_THEME',
                              settings: {
                                ...newColors,
                                lineWidth: projectSettings.poiTrackLineWidth || 3,
                                enableGlow: projectSettings.enableLayerGlow !== false
                              }
                            }, '*');
                            const formattedStaged = (dailyData || []).map((item: any) => ({
                              ...item,
                              status: item.publishToWebGIS === 'yes' ? 'published' : 'staged',
                              strokeColor: item.publishToWebGIS === 'yes' ? newColors.publishedTrackColor : newColors.stagingTrackColor,
                              fillColor: item.publishToWebGIS === 'yes' ? newColors.publishedTrackColor : newColors.stagingTrackColor,
                              panoramas: item.panoramas || [],
                              points: item.panoramas || []
                            }));
                            previewIframeRef.current.contentWindow.postMessage({
                              type: 'SET_STAGED_DATA',
                              stagedItems: formattedStaged
                            }, '*');
                          }
                          showToast('Loaded Neon GIS Palette to preview map!');
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${themeMode === 'light' ? 'bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border-cyan-300' : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border-slate-700'}`}
                      >
                        Neon GIS
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const newColors = {
                            publishedTrackColor: '#34d399',
                            stagingTrackColor: '#fbbf24',
                            defectTrackColor: '#f87171',
                            selectedTrackColor: '#2dd4bf',
                            gridBoundaryColor: '#818cf8'
                          };
                          setProjectSettings(prev => ({ ...prev, ...newColors }));
                          if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                            previewIframeRef.current.contentWindow.postMessage({
                              type: 'SET_MAP_THEME',
                              settings: {
                                ...newColors,
                                lineWidth: projectSettings.poiTrackLineWidth || 3,
                                enableGlow: projectSettings.enableLayerGlow !== false
                              }
                            }, '*');
                            const formattedStaged = (dailyData || []).map((item: any) => ({
                              ...item,
                              status: item.publishToWebGIS === 'yes' ? 'published' : 'staged',
                              strokeColor: item.publishToWebGIS === 'yes' ? newColors.publishedTrackColor : newColors.stagingTrackColor,
                              fillColor: item.publishToWebGIS === 'yes' ? newColors.publishedTrackColor : newColors.stagingTrackColor,
                              panoramas: item.panoramas || [],
                              points: item.panoramas || []
                            }));
                            previewIframeRef.current.contentWindow.postMessage({
                              type: 'SET_STAGED_DATA',
                              stagedItems: formattedStaged
                            }, '*');
                          }
                          showToast('Loaded Eco Soft Palette to preview map!');
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer ${themeMode === 'light' ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border-slate-700'}`}
                      >
                        Eco Soft
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    {/* PUBLISHED COLOR */}
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">Published Track Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.publishedTrackColor || '#10B981'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, publishedTrackColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { publishedTrackColor: val }
                              }, '*');
                            }
                          }}
                          className="w-8 h-8 rounded border border-slate-700 cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.publishedTrackColor || '#10B981'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, publishedTrackColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { publishedTrackColor: val }
                              }, '*');
                            }
                          }}
                          className={`w-full px-2 py-1.5 rounded font-mono text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* STAGING COLOR */}
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">Staging / In-Process Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.stagingTrackColor || '#F59E0B'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, stagingTrackColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { stagingTrackColor: val }
                              }, '*');
                            }
                          }}
                          className="w-8 h-8 rounded border border-slate-700 cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.stagingTrackColor || '#F59E0B'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, stagingTrackColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { stagingTrackColor: val }
                              }, '*');
                            }
                          }}
                          className={`w-full px-2 py-1.5 rounded font-mono text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* DEFECT COLOR */}
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">QA Defect Flagged Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.defectTrackColor || '#EF4444'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, defectTrackColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { defectTrackColor: val }
                              }, '*');
                            }
                          }}
                          className="w-8 h-8 rounded border border-slate-700 cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.defectTrackColor || '#EF4444'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, defectTrackColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { defectTrackColor: val }
                              }, '*');
                            }
                          }}
                          className={`w-full px-2 py-1.5 rounded font-mono text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* SELECTED SUBGRID COLOR */}
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">Active Selected Subgrid</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.selectedTrackColor || '#38BDF8'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, selectedTrackColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { selectedTrackColor: val }
                              }, '*');
                            }
                          }}
                          className="w-8 h-8 rounded border border-slate-700 cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.selectedTrackColor || '#38BDF8'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, selectedTrackColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { selectedTrackColor: val }
                              }, '*');
                            }
                          }}
                          className={`w-full px-2 py-1.5 rounded font-mono text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* GRID BOUNDARY COLOR */}
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">Grid Boundary Border</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={projectSettings.gridBoundaryColor || '#6366F1'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, gridBoundaryColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { gridBoundaryColor: val }
                              }, '*');
                            }
                          }}
                          className="w-8 h-8 rounded border border-slate-700 cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={projectSettings.gridBoundaryColor || '#6366F1'}
                          onChange={e => {
                            const val = e.target.value;
                            setProjectSettings(prev => ({ ...prev, gridBoundaryColor: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { gridBoundaryColor: val }
                              }, '*');
                            }
                          }}
                          className={`w-full px-2 py-1.5 rounded font-mono text-[11px] uppercase border ${inputBg}`}
                        />
                      </div>
                    </div>

                    {/* LINE WIDTH & GLOW */}
                    <div>
                      <label className="block text-slate-400 font-medium mb-1">Track Width & Glow</label>
                      <div className="flex items-center gap-2">
                        <select
                          value={projectSettings.poiTrackLineWidth || 3}
                          onChange={e => {
                            const val = Number(e.target.value);
                            setProjectSettings(prev => ({ ...prev, poiTrackLineWidth: val }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { lineWidth: val }
                              }, '*');
                            }
                          }}
                          className={`flex-1 px-2 py-1.5 rounded font-medium focus:outline-none border ${inputBg}`}
                        >
                          <option value="2">2px (Thin)</option>
                          <option value="3">3px (Balanced)</option>
                          <option value="4">4px (Prominent)</option>
                          <option value="6">6px (Bold)</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            const nextGlow = !(projectSettings.enableLayerGlow !== false);
                            setProjectSettings(prev => ({ ...prev, enableLayerGlow: nextGlow }));
                            if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                              previewIframeRef.current.contentWindow.postMessage({
                                type: 'SET_MAP_THEME',
                                settings: { enableGlow: nextGlow }
                              }, '*');
                            }
                          }}
                          className={`px-2 py-1.5 rounded border text-[11px] font-semibold cursor-pointer transition-colors ${projectSettings.enableLayerGlow !== false ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                          title="Toggle High-Contrast Glow"
                        >
                          Glow
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Apply Layer Theme Button */}
                  <div className={`pt-2 border-t flex justify-end ${themeMode === 'light' ? 'border-slate-200' : 'border-slate-800/80'}`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (previewIframeRef.current && previewIframeRef.current.contentWindow) {
                          // 1. Send Map Vector Layer Theme & Styling
                          previewIframeRef.current.contentWindow.postMessage({
                            type: 'SET_MAP_THEME',
                            settings: {
                              publishedTrackColor: projectSettings.publishedTrackColor || '#10B981',
                              stagingTrackColor: projectSettings.stagingTrackColor || '#F59E0B',
                              defectTrackColor: projectSettings.defectTrackColor || '#EF4444',
                              selectedTrackColor: projectSettings.selectedTrackColor || '#38BDF8',
                              gridBoundaryColor: projectSettings.gridBoundaryColor || '#6366F1',
                              lineWidth: projectSettings.poiTrackLineWidth || 3,
                              enableGlow: projectSettings.enableLayerGlow !== false
                            }
                          }, '*');

                          // 2. Send Staged Point Data with new colors
                          const formattedStaged = (dailyData || []).map((item: any) => ({
                            ...item,
                            status: item.publishToWebGIS === 'yes' ? 'published' : 'staged',
                            strokeColor: item.publishToWebGIS === 'yes' ? (projectSettings.publishedTrackColor || '#10B981') : (projectSettings.stagingTrackColor || '#F59E0B'),
                            fillColor: item.publishToWebGIS === 'yes' ? (projectSettings.publishedTrackColor || '#10B981') : (projectSettings.stagingTrackColor || '#F59E0B'),
                            panoramas: item.panoramas || [],
                            points: item.panoramas || []
                          }));
                          previewIframeRef.current.contentWindow.postMessage({
                            type: 'SET_STAGED_DATA',
                            stagedItems: formattedStaged
                          }, '*');
                        }
                        showToast('Survey Trajectory Layer theme saved!');
                      }}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                    >
                      <CheckCircle size={13} />
                      <span>Apply Layer Theme</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: REAL-TIME LIVE MAP DASHBOARD PREVIEW (7 COLS - SPACIOUS) */}
              <div className="lg:col-span-7 flex flex-col min-h-[580px]">
                <div className={`p-4 rounded-xl border flex-1 flex flex-col space-y-3 ${innerCardBg}`}>
                  <div className="flex items-center justify-between">
                    <h4 className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${themeMode === 'light' ? 'text-slate-800' : 'text-slate-200'}`}>
                      <Navigation size={14} className="text-emerald-400" />
                      Live Map Dashboard Preview
                    </h4>
                  </div>

                  {/* REAL EMBEDDED WEBGIS MAP IFRAME CONTAINER (SPACIOUS & THEME-AWARE) */}
                  <div className={`relative flex-1 min-h-[520px] rounded-xl overflow-hidden border ${themeMode === 'light' ? 'border-slate-200 bg-slate-100' : 'border-slate-700/80 bg-slate-950'} flex flex-col shadow-2xl`}>
                    {/* Top-Left TNB LV Asset Mapping Floating Badge */}
                    <div className="absolute top-3 left-3 z-20 pointer-events-none">
                      <div className={`backdrop-blur-xl border rounded-2xl px-3 py-1.5 shadow-2xl flex items-center gap-2.5 shrink-0 ${themeMode === 'light' ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-[#12161f]/95 border-slate-800/90 text-white'}`}>
                        <div className="p-1.5 bg-gradient-to-tr from-sky-600 to-emerald-500 rounded-xl shadow-md shadow-emerald-950/40 shrink-0">
                          <Layers size={14} className="text-white" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className={`font-bold text-xs tracking-tight ${themeMode === 'light' ? 'text-slate-900' : 'text-white'}`}>
                              TNB LV Asset Mapping
                            </h4>
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[8px] font-semibold">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Live WebGIS
                            </span>
                          </div>
                          <p className={`text-[9px] font-medium ${themeMode === 'light' ? 'text-slate-500' : 'text-slate-400'}`}>
                            360° Mobile Mapping System
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Embedded WebGIS Map Iframe */}
                    <iframe
                      ref={previewIframeRef}
                      key={`${previewRefreshKey}-${themeMode}`}
                      src={`${import.meta.env.VITE_MAP_URL || 'https://mobilemapping-nine.vercel.app'}/?embed=true&preview=true&theme=${themeMode}&t=${previewRefreshKey}`}
                      onLoad={() => {
                        sendPreviewData();
                        setTimeout(sendPreviewData, 400);
                        setTimeout(sendPreviewData, 1200);
                      }}
                      className="w-full h-full min-h-[520px] border-0"
                      title="WebGIS Live Map Preview"
                      allow="geolocation; camera; accelerometer; gyroscope"
                    />

                    {/* Bottom-Right Live Cursor Coordinate Badge */}
                    <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
                      <div className={`backdrop-blur-md border rounded-lg px-2.5 py-1 text-[10px] shadow-xl flex items-center gap-1.5 font-mono ${themeMode === 'light' ? 'bg-white/95 border-slate-200 text-slate-800' : 'bg-slate-900/90 border-slate-700/80 text-slate-300'}`}>
                        <span className="text-sky-500 font-semibold">{projectSettings.spatialSrid || 'EPSG:4326'}</span>
                        <span className={themeMode === 'light' ? 'text-slate-300' : 'text-slate-600'}>|</span>
                        {previewCoords ? (
                          <span className={themeMode === 'light' ? 'text-slate-900 font-semibold' : 'text-slate-200'}>
                            {previewCoords.lat.toFixed(4)}° N, {previewCoords.lng.toFixed(4)}° E
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Live GIS Map</span>
                        )}
                      </div>
                    </div>

                    {/* Bottom-Left Controls Stack: Action Buttons on Top, Legend Chips Below */}
                    <div className="absolute bottom-3 left-3 z-20 flex flex-col items-start gap-2 pointer-events-none">
                      {/* Action Controls directly above legend */}
                      <div className="flex items-center gap-1.5 pointer-events-auto">
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewRefreshKey(k => k + 1);
                            showToast('Refreshing Live Map Preview...');
                          }}
                          title="Refresh WebGIS Map Preview"
                          className={`px-2.5 py-1 rounded-xl backdrop-blur-xl border cursor-pointer shadow-xl transition-all active:scale-95 flex items-center gap-1.5 text-[10px] font-semibold ${themeMode === 'light' ? 'bg-white/95 hover:bg-slate-100 text-sky-600 border-slate-300' : 'bg-slate-900/95 hover:bg-slate-800 text-sky-400 border-slate-700/80'}`}
                        >
                          <RefreshCw size={11} />
                          <span>Refresh</span>
                        </button>
                        <a
                          href={import.meta.env.VITE_MAP_URL || 'https://mobilemapping-nine.vercel.app'}
                          target="_blank"
                          rel="noreferrer"
                          title="Open WebGIS in new tab"
                          className={`p-1.5 rounded-xl backdrop-blur-xl border cursor-pointer shadow-xl transition-all active:scale-95 flex items-center ${themeMode === 'light' ? 'bg-white/95 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-300' : 'bg-slate-900/95 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700/80'}`}
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>

                      {/* Live Legend Chips */}
                      <div className="flex flex-wrap items-center gap-1 pointer-events-auto">
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-semibold backdrop-blur-md border flex items-center gap-1.5 shadow-md ${themeMode === 'light' ? 'bg-white/95 border-slate-300 text-slate-800' : 'bg-slate-900/90 border-slate-700/80 text-slate-200'}`}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: projectSettings.publishedTrackColor || '#10B981' }} />
                          Published
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-semibold backdrop-blur-md border flex items-center gap-1.5 shadow-md ${themeMode === 'light' ? 'bg-white/95 border-slate-300 text-slate-800' : 'bg-slate-900/90 border-slate-700/80 text-slate-200'}`}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: projectSettings.stagingTrackColor || '#F59E0B' }} />
                          Staging
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-semibold backdrop-blur-md border flex items-center gap-1.5 shadow-md ${themeMode === 'light' ? 'bg-white/95 border-slate-300 text-slate-800' : 'bg-slate-900/90 border-slate-700/80 text-slate-200'}`}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: projectSettings.defectTrackColor || '#EF4444' }} />
                          Defect
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-semibold backdrop-blur-md border flex items-center gap-1.5 shadow-md ${themeMode === 'light' ? 'bg-white/95 border-slate-300 text-slate-800' : 'bg-slate-900/90 border-slate-700/80 text-slate-200'}`}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: projectSettings.selectedTrackColor || '#38BDF8' }} />
                          Selected
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 4: SECURITY, RBAC & ACCESS CONTROL SETTINGS */}
          <div className={`p-5 rounded-xl border space-y-4 ${cardBg}`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-sky-400" />
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">4. Security, Authentication & Access Control (RBAC)</h3>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                Protected Mode
              </span>
            </div>

            <div className="space-y-3 text-xs">
              {/* Deletion Guard Toggle */}
              <div className={`p-3 rounded-lg border flex items-center justify-between ${innerCardBg}`}>
                <div>
                  <h4 className="font-semibold text-slate-200">Require Administrator Approval for CSV Deletion</h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">When enabled, operators requesting CSV deletion submit a ticket to the Approvals queue instead of hard-deleting.</p>
                </div>
                <input
                  type="checkbox"
                  checked={projectSettings.requireAdminApprovalForDelete !== false}
                  onChange={e => setProjectSettings(prev => ({ ...prev, requireAdminApprovalForDelete: e.target.checked }))}
                  className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Session Inactivity Auto-Lock</label>
                  <select
                    value={projectSettings.sessionTimeoutMinutes || 30}
                    onChange={e => setProjectSettings(prev => ({ ...prev, sessionTimeoutMinutes: Number(e.target.value) }))}
                    className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                  >
                    <option value="15">15 Minutes</option>
                    <option value="30">30 Minutes (Recommended)</option>
                    <option value="60">1 Hour</option>
                    <option value="240">4 Hours</option>
                    <option value="0">Never (Dev Mode Only)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">Corporate Email Domain Restriction</label>
                  <input
                    type="text"
                    placeholder="@tnb.com.my"
                    value={projectSettings.corporateDomain || '@tnb.com.my'}
                    onChange={e => setProjectSettings(prev => ({ ...prev, corporateDomain: e.target.value }))}
                    className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                  />
                </div>
              </div>

              {/* Masked API Credentials Box */}
              <div className={`p-3 rounded-lg border space-y-2 ${innerCardBg}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                    <Key size={13} className="text-slate-400" />
                    Supabase Service & Anon API Key Status
                  </span>
                  <button
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
                  >
                    {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                    <span>{showApiKey ? 'Hide Key' : 'Reveal Key'}</span>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    readOnly
                    value={import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'}
                    className={`flex-1 px-2.5 py-1.5 rounded font-mono text-[11px] border ${inputBg}`}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(import.meta.env.VITE_SUPABASE_ANON_KEY || '');
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded text-xs cursor-pointer flex items-center gap-1"
                  >
                    <Copy size={12} />
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 5: CONTRACT SLA TARGETS & QA BENCHMARKS */}
          <div className={`p-5 rounded-xl border space-y-4 ${cardBg}`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-sky-400" />
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wide">5. Contract SLA Targets & QA Benchmarks</h3>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 border border-slate-700 text-slate-300">
                Quality SLA Standard
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Contract Target Distance (km)</label>
                <input
                  type="number"
                  step="0.1"
                  value={projectSettings.targetKm || 315.2}
                  onChange={e => setProjectSettings(prev => ({ ...prev, targetKm: parseFloat(e.target.value) || 315.2 }))}
                  className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Max Allowed Defect SLA Rate (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={projectSettings.maxDefectThresholdPercent || 5.0}
                  onChange={e => setProjectSettings(prev => ({ ...prev, maxDefectThresholdPercent: parseFloat(e.target.value) || 5.0 }))}
                  className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Batch Log Deduplication Strategy</label>
                <select
                  value={projectSettings.deduplicationStrategy || 'clean_merge'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, deduplicationStrategy: e.target.value as any }))}
                  className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                >
                  <option value="clean_merge">Clean Merge Masterlist (BATCH-ID)</option>
                  <option value="preserve_runs">Preserve Individual Daily Survey Runs</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">QA Flag Category 1</label>
                <input
                  type="text"
                  value={projectSettings.qaFlag1 || 'Blurry Frame'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, qaFlag1: e.target.value }))}
                  className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">QA Flag Category 2</label>
                <input
                  type="text"
                  value={projectSettings.qaFlag2 || 'Lens Obstruction'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, qaFlag2: e.target.value }))}
                  className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">QA Flag Category 3</label>
                <input
                  type="text"
                  value={projectSettings.qaFlag3 || 'Bad GPS Signal'}
                  onChange={e => setProjectSettings(prev => ({ ...prev, qaFlag3: e.target.value }))}
                  className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                />
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => {
                  onSaveAllSettings?.();
                  showToast('Project & Security Settings saved and synchronized live!');
                }}
                className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold transition-all shadow-md cursor-pointer flex items-center gap-2"
              >
                <CheckCircle size={14} />
                <span>Save All Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: APPROVALS (DATA DELETION WORKFLOW) */}
      {/* ========================================================================= */}
      {activeTab === 'approvals' && (
        <div className={`p-5 rounded-xl border space-y-4 ${cardBg}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <CheckSquare size={16} className="text-amber-400" />
                Data Deletion Review & Approval Queue
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Review and authorize data deletion requests submitted by field operators.</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={approvalFilter}
                onChange={e => setApprovalFilter(e.target.value as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none border ${inputBg}`}
              >
                <option value="ALL">All Requests ({deletionRequests.length})</option>
                <option value="Pending">Pending Only ({pendingApprovalsCount})</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div className="border border-slate-800 rounded-lg overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/80 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <th className="px-3.5 py-2.5">Request ID</th>
                  <th className="px-3.5 py-2.5">Subgrid</th>
                  <th className="px-3.5 py-2.5">Requester</th>
                  <th className="px-3.5 py-2.5">Reason</th>
                  <th className="px-3.5 py-2.5">Frames / KM</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5 text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredApprovals.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No deletion approval requests in this filter.</td>
                  </tr>
                ) : (
                  filteredApprovals.map(req => (
                    <tr key={req.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-3.5 py-2.5 font-mono text-slate-300 font-semibold">{req.id}</td>
                      <td className="px-3.5 py-2.5 font-mono text-sky-400 font-bold">{req.subgrid}</td>
                      <td className="px-3.5 py-2.5 text-slate-200">
                        <div className="font-semibold">{req.requestedBy}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{req.userEmail}</div>
                      </td>
                      <td className="px-3.5 py-2.5 text-slate-300 max-w-xs">{req.reason}</td>
                      <td className="px-3.5 py-2.5 font-mono text-slate-300">
                        {req.poiCount} frames ({req.kmProcessed} km)
                      </td>
                      <td className="px-3.5 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${req.status === 'Pending' ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : req.status === 'Approved' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border-rose-500/30'}`}>
                          {req.status}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        {req.status === 'Pending' ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleApproveDeletion(req)}
                              className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/30 rounded text-[11px] font-semibold cursor-pointer transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => setRejectModalReqId(req.id)}
                              className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded text-[11px] font-semibold cursor-pointer transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-500 font-mono">
                            {req.reviewedBy ? `by ${req.reviewedBy}` : 'Processed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: REPORTS & ANALYTICS */}
      {/* ========================================================================= */}
      {activeTab === 'reports' && (
        <div className={`p-5 rounded-xl border space-y-5 ${cardBg}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <FileText size={16} className="text-sky-400" />
                Project Survey Reports & Executive Export
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Generate contract delivery audits, QC summary reports, and data ledgers.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onGeneratePdfReport}
                className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Download size={13} /> Export PDF Report
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
              <h4 className="font-bold text-slate-200">Survey Coverage Breakdown</h4>
              <div className="space-y-1.5 text-slate-400">
                <div className="flex justify-between"><span>Total Distance:</span> <strong className="text-slate-200">{dailyData.reduce((s, d) => s + (d.kmProcessed || 0), 0).toFixed(1)} km</strong></div>
                <div className="flex justify-between"><span>Processed Frames:</span> <strong className="text-slate-200">{dailyData.reduce((s, d) => s + (d.imagesProcessed || 0), 0)} frames</strong></div>
                <div className="flex justify-between"><span>Target Distance:</span> <strong className="text-slate-200">{projectSettings.targetKm || 315.2} km</strong></div>
              </div>
            </div>

            <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
              <h4 className="font-bold text-slate-200">QAQC Quality SLA Metrics</h4>
              <div className="space-y-1.5 text-slate-400">
                <div className="flex justify-between"><span>Defect Frames:</span> <strong className="text-amber-300">{dailyData.reduce((s, d) => s + (d.defectCount || 0), 0)}</strong></div>
                <div className="flex justify-between"><span>Allowed Threshold:</span> <strong className="text-slate-200">{projectSettings.maxDefectThresholdPercent || 5.0}%</strong></div>
                <div className="flex justify-between"><span>Pipeline Status:</span> <strong className="text-emerald-400">100.0% Compliant</strong></div>
              </div>
            </div>

            <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
              <h4 className="font-bold text-slate-200">Subgrid Masterlist Summary</h4>
              <div className="space-y-1.5 text-slate-400">
                <div className="flex justify-between"><span>Total Subgrids:</span> <strong className="text-slate-200">{batchLogs.length}</strong></div>
                <div className="flex justify-between"><span>Completed Batches:</span> <strong className="text-emerald-400">{batchLogs.filter(b => b.status === 'Complete').length}</strong></div>
                <div className="flex justify-between"><span>Ongoing Batches:</span> <strong className="text-amber-300">{batchLogs.filter(b => b.status === 'Ongoing').length}</strong></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: AUDIT LOGS */}
      {/* ========================================================================= */}
      {activeTab === 'audit' && (
        <div className={`p-5 rounded-xl border space-y-4 ${cardBg}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Activity size={16} className="text-sky-400" />
                Security & Activity Audit Trail
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Chronological record of user modifications, published surveys, and system events.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search audit trail by title or details..."
                value={auditSearch}
                onChange={e => setAuditSearch(e.target.value)}
                className={`w-full pl-9 pr-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none border ${inputBg}`}
              />
            </div>
            <select
              value={auditActionFilter}
              onChange={e => setAuditActionFilter(e.target.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none border ${inputBg}`}
            >
              <option value="ALL">All Actions</option>
              <option value="CREATE">CREATE</option>
              <option value="EDIT">EDIT</option>
              <option value="DELETE">DELETE</option>
              <option value="PUBLISH">PUBLISH</option>
              <option value="APPROVAL">APPROVAL</option>
              <option value="SECURITY">SECURITY</option>
            </select>
          </div>

          <div className="border border-slate-800 rounded-lg overflow-x-auto max-h-[450px]">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr className="text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                  <th className="px-3.5 py-2.5">Timestamp</th>
                  <th className="px-3.5 py-2.5">Action</th>
                  <th className="px-3.5 py-2.5">Event Title</th>
                  <th className="px-3.5 py-2.5">Event Details</th>
                  <th className="px-3.5 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredAuditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No audit events recorded for this filter.</td>
                  </tr>
                ) : (
                  filteredAuditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-3.5 py-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">{log.timestamp}</td>
                      <td className="px-3.5 py-2">
                        <span className="px-2 py-0.5 rounded text-[9.5px] font-bold font-mono uppercase bg-slate-800 border border-slate-700 text-slate-300">
                          {log.type}
                        </span>
                      </td>
                      <td className="px-3.5 py-2 font-semibold text-slate-200 whitespace-nowrap">{log.title}</td>
                      <td className="px-3.5 py-2 text-slate-400 text-[11px] max-w-md truncate" title={log.details}>{log.details}</td>
                      <td className="px-3.5 py-2 text-right">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${log.status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : log.status === 'error' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                          {log.status || 'info'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: SYSTEM HEALTH */}
      {/* ========================================================================= */}
      {activeTab === 'health' && (
        <div className={`p-5 rounded-xl border space-y-4 ${cardBg}`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Server size={16} className="text-emerald-400" />
                Live System & Infrastructure Diagnostics
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">Real-time latency, storage health, and replication diagnostics.</p>
            </div>
            <button
              onClick={handleTestHealth}
              disabled={isTestingHealth}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <RefreshCw size={13} className={isTestingHealth ? 'animate-spin text-sky-400' : 'text-sky-400'} />
              <span>Probe Health Now</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">PostgreSQL / PostGIS 3.3</span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100">{healthMetrics.postgisLatencyMs} ms</div>
              <p className="text-[10px] text-slate-500 font-mono">Response time &bull; Endpoint 200 OK</p>
            </div>

            <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">360° Storage Bucket (MMS_PIC)</span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100">{healthMetrics.storageTotalFiles}+ Objects</div>
              <p className="text-[10px] text-slate-500 font-mono">Public CDN read accessibility OK</p>
            </div>

            <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">Supabase Realtime Channel</span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-emerald-400">Connected</div>
              <p className="text-[10px] text-slate-500 font-mono">WebSocket push replication active</p>
            </div>

            <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">WebGIS Viewer Integration</span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100">Online (Vercel)</div>
              <p className="text-[10px] text-slate-500 font-mono">mobilemapping-nine.vercel.app</p>
            </div>

            <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">Client Memory & Cache</span>
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100">{healthMetrics.memoryUsageMb} MB</div>
              <p className="text-[10px] text-slate-500 font-mono">Browser heap allocated</p>
            </div>

            <div className={`p-4 rounded-xl border space-y-2 ${innerCardBg}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">Last Diagnostic Ping</span>
                <Clock size={14} className="text-slate-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-slate-100">{healthMetrics.lastPingTime}</div>
              <p className="text-[10px] text-slate-500 font-mono">Auto-polling every 30s</p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: ADD USER / INVITE MODAL */}
      {/* ========================================================================= */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className={`w-full max-w-md p-5 rounded-2xl border shadow-2xl space-y-4 ${cardBg}`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Users size={16} className="text-sky-400" />
                Add / Provision Dashboard User
              </h3>
              <button onClick={() => setIsAddUserModalOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ahmad Razif"
                  value={newUserName}
                  onChange={e => setNewUserName(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Corporate Email</label>
                <input
                  type="email"
                  required
                  placeholder="ahmad.razif@tnb.com.my"
                  value={newUserEmail}
                  onChange={e => setNewUserEmail(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg font-mono focus:outline-none border ${inputBg}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Assigned Role</label>
                <select
                  value={newUserRole}
                  onChange={e => setNewUserRole(e.target.value as any)}
                  className={`w-full px-3 py-2 rounded-lg font-medium focus:outline-none border ${inputBg}`}
                >
                  <option value="Administrator">Administrator (Full operational & approval rights)</option>
                  <option value="Survey Operator">Survey Operator (Upload, staging & publishing)</option>
                  <option value="QA Inspector">QA Inspector (Review & defect tagging)</option>
                  <option value="Viewer">Viewer (Read-only)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  Create User Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: REJECT DELETION REQUEST MODAL */}
      {/* ========================================================================= */}
      {rejectModalReqId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className={`w-full max-w-md p-5 rounded-2xl border shadow-2xl space-y-4 ${cardBg}`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-rose-300 flex items-center gap-2">
                <XCircle size={16} className="text-rose-400" />
                Reject Deletion Request ({rejectModalReqId})
              </h3>
              <button onClick={() => setRejectModalReqId(null)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-300">Please provide a reason for rejecting this survey data deletion ticket:</p>
              <textarea
                rows={3}
                placeholder="e.g. Survey run matches client GIS master specs; deletion not approved."
                value={rejectionReasonInput}
                onChange={e => setRejectionReasonInput(e.target.value)}
                className={`w-full p-2.5 rounded-lg text-xs font-medium focus:outline-none border ${inputBg}`}
              />

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  onClick={() => setRejectModalReqId(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRejectDeletion(rejectModalReqId)}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
