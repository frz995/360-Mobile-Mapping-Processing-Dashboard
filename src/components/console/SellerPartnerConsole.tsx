import React, { useState, useEffect, useMemo } from 'react';
import {
  Building2,
  Database,
  Users,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Edit3,
  Server,
  HardDrive,
  RefreshCw,
  LogOut,
  Eye,
  ExternalLink,
  X,
  LayoutDashboard,
  Settings,
  Bell,
  Calendar,
  Activity,
  Sliders,
  Check,
  ShieldAlert
} from 'lucide-react';
import {
  type Organization,
  type OrganizationDraft,
  fetchAllOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  setActiveOrganizationId,
  testDedicatedDatabaseConnection
} from '../../services/tenantContext';
import { toast } from '../common/toast';

interface SellerPartnerConsoleProps {
  onBackToApp: () => void;
  onSelectCompanyForPreview?: (org: Organization) => void;
  currentUserEmail?: string;
  onSignOut?: () => void;
}

type ConsoleTab = 'dashboard' | 'tenants' | 'database' | 'quotas' | 'settings';

export const SellerPartnerConsole: React.FC<SellerPartnerConsoleProps> = ({
  onBackToApp,
  onSelectCompanyForPreview,
  currentUserEmail,
  onSignOut
}) => {
  const [activeTab, setActiveTab] = useState<ConsoleTab>('dashboard');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // A failed directory read must not render as an empty customer list: the
  // seller would conclude there are no companies rather than that the query
  // failed, and those demand opposite responses. Holds the reason; `null` means
  // the last read was verified.
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'trial' | 'suspended'>('ALL');
  const [dbTypeFilter, setDbTypeFilter] = useState<'ALL' | 'cloud_shared' | 'dedicated_external'>('ALL');

  // Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [formData, setFormData] = useState<OrganizationDraft>({
    name: '',
    clientCode: '',
    logoUrl: '',
    databaseType: 'cloud_shared',
    databaseConfig: { url: '', anonKey: '' },
    settings: { allowedUserSeats: 10, storageQuotaGb: 200, contactEmail: '', nasApiUrl: '' }
  });

  // DB Test State
  const [isTestingDb, setIsTestingDb] = useState(false);
  const [dbTestResult, setDbTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadOrgs = async () => {
    setIsLoading(true);
    try {
      const result = await fetchAllOrganizations();
      setOrganizations(result.organizations);
      setDirectoryError(result.error);
} catch (err: unknown) {
      console.error('Failed to load organizations', err);
      setOrganizations([]);
      setDirectoryError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not reach the organization directory.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrgs();
  }, []);

  const filteredOrgs = useMemo(() => {
    return organizations.filter((org) => {
      const matchSearch =
        !searchQuery.trim() ||
        org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        org.clientCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        org.slug.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'ALL' || org.status === statusFilter;
      const matchDbType = dbTypeFilter === 'ALL' || org.databaseType === dbTypeFilter;
      return matchSearch && matchStatus && matchDbType;
    });
  }, [organizations, searchQuery, statusFilter, dbTypeFilter]);

  const handleOpenCreate = () => {
    setEditingOrg(null);
    setDbTestResult(null);
    setFormData({
      name: '',
      clientCode: '',
      logoUrl: '',
      databaseType: 'cloud_shared',
      databaseConfig: { url: '', anonKey: '' },
      settings: { allowedUserSeats: 10, storageQuotaGb: 200, contactEmail: '', nasApiUrl: '' }
    });
    setShowCreateModal(true);
  };

  const handleOpenEdit = (org: Organization) => {
    setEditingOrg(org);
    setDbTestResult(null);
    setFormData({
      name: org.name,
      clientCode: org.clientCode,
      logoUrl: org.logoUrl || '',
      databaseType: org.databaseType,
      databaseConfig: org.databaseConfig || { url: '', anonKey: '' },
      settings: {
        allowedUserSeats: org.settings?.allowedUserSeats || 10,
        storageQuotaGb: org.settings?.storageQuotaGb || 200,
        contactEmail: org.settings?.contactEmail || '',
        nasApiUrl: org.settings?.nasApiUrl || ''
      }
    });
    setShowCreateModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.clientCode.trim()) return;

    // The modal closes only on a confirmed write. Previously every result was
    // discarded, so a rejected insert looked identical to a saved company.
    const result = editingOrg
      ? await updateOrganization(editingOrg.id, {
          name: formData.name,
          clientCode: formData.clientCode,
          logoUrl: formData.logoUrl,
          databaseType: formData.databaseType,
          databaseConfig: formData.databaseConfig,
          settings: formData.settings
        })
      : await createOrganization(formData);

    if (!result.success) {
      toast.error(result.error || 'The company was not saved.');
      return;
    }

    setShowCreateModal(false);
    await loadOrgs();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete ${name}? This action cannot be undone.`)) return;
    const result = await deleteOrganization(id);
    if (!result.success) {
      toast.error(result.error || 'The company was not deleted.');
      return;
    }
    await loadOrgs();
  };

  const handleTestConnection = async () => {
    if (!formData.databaseConfig?.url || !formData.databaseConfig?.anonKey) {
      setDbTestResult({ success: false, message: 'Please enter Supabase URL and Key' });
      return;
    }
    setIsTestingDb(true);
    setDbTestResult(null);
    const result = await testDedicatedDatabaseConnection(
      formData.databaseConfig.url,
      formData.databaseConfig.anonKey
    );
    setDbTestResult(result);
    setIsTestingDb(false);
  };

  const handlePreviewCompany = (org: Organization) => {
    setActiveOrganizationId(org.id);
    if (onSelectCompanyForPreview) {
      onSelectCompanyForPreview(org);
    } else {
      window.open(`/dashboard?tenant=${encodeURIComponent(org.slug)}`, '_blank', 'noopener,noreferrer');
    }
  };

  // Metrics derived from the customer directory.
  //
  // These reduce over `organizations`, so a failed read (which yields an empty
  // list) would sum to 0 — a confident number for a quantity nobody measured.
  // `null` means "not measured"; the formatter renders it as unknown rather
  // than as a zero.
  const totalSeats = useMemo(() => {
    if (directoryError) return null;
    return organizations.reduce((acc, curr) => acc + (curr.settings?.allowedUserSeats || 0), 0);
  }, [organizations, directoryError]);

  const totalQuota = useMemo(() => {
    if (directoryError) return null;
    return organizations.reduce((acc, curr) => acc + (curr.settings?.storageQuotaGb || 0), 0);
  }, [organizations, directoryError]);

  const activeCount = useMemo(() => {
    if (directoryError) return null;
    return organizations.filter((org) => org.status === 'active').length;
  }, [organizations, directoryError]);

  const dedicatedCount = useMemo(() => {
    if (directoryError) return null;
    return organizations.filter((org) => org.databaseType === 'dedicated_external').length;
  }, [organizations, directoryError]);

  /** Renders an unmeasured metric as unknown. Never substitutes 0 for "not measured". */
  const metric = (value: number | null, suffix = '') => (value === null ? '—' : `${value}${suffix}`);

  // Current formatted date
  const todayFormatted = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
  }, []);

  const monthYearFormatted = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }, []);

  return (
    <div
      style={{ backgroundColor: '#f4f5f8', color: '#0f172a', colorScheme: 'light' }}
      className="console-canvas-bg h-screen w-screen max-w-full overflow-hidden flex font-sans antialiased selection:bg-slate-900 selection:text-white"
    >
      {/* ========================================================================= */}
      {/* 1. COLUMN 1: SLIM OBSIDIAN RAIL (64px / w-16, #0c0d0e)                     */}
      {/* ========================================================================= */}
      <aside
        style={{ backgroundColor: '#0c0d0e', color: '#ffffff', borderColor: '#17181c' }}
        className="console-rail-dark w-16 shrink-0 flex flex-col items-center justify-between py-5 border-r z-30 select-none h-screen"
      >
        {/* Top: Static GeoSphere Brand Mark & Circular Nav Buttons */}
        <div className="flex flex-col items-center gap-5 w-full">
          {/* GeoSphere Brand Mark (Non-button static white arrow logo) */}
          <div
            className="flex items-center justify-center shrink-0 w-10 h-10 select-none"
            aria-label="GeoSphere 360"
          >
            <img
              src="/branding/geosphere-arrow-icon-white.svg"
              alt="GeoSphere 360"
              className="w-7 h-7 object-contain select-none"
              draggable={false}
            />
          </div>

          {/* Navigation Stack */}
          <nav
            style={{ backgroundColor: 'transparent' }}
            className="flex flex-col items-center gap-2.5 w-full"
            aria-label="Console Navigation"
          >
            <button
              type="button"
              aria-label="Dashboard"
              onClick={() => setActiveTab('dashboard')}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '9999px',
                backgroundColor: activeTab === 'dashboard' ? '#ffffff' : 'transparent',
                color: activeTab === 'dashboard' ? '#0c0d0e' : '#94a3b8'
              }}
              className="flex items-center justify-center transition-all cursor-pointer hover:bg-white/10 hover:text-white shrink-0"
              title="Dashboard"
            >
              <LayoutDashboard size={18} />
              <span className="sr-only">Dashboard</span>
            </button>

            <button
              type="button"
              aria-label="Companies"
              onClick={() => setActiveTab('tenants')}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '9999px',
                backgroundColor: activeTab === 'tenants' ? '#ffffff' : 'transparent',
                color: activeTab === 'tenants' ? '#0c0d0e' : '#94a3b8'
              }}
              className="flex items-center justify-center transition-all cursor-pointer hover:bg-white/10 hover:text-white shrink-0"
              title="Companies"
            >
              <Building2 size={18} />
              <span className="sr-only">Companies</span>
            </button>

            <button
              type="button"
              aria-label="Database Hub"
              onClick={() => setActiveTab('database')}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '9999px',
                backgroundColor: activeTab === 'database' ? '#ffffff' : 'transparent',
                color: activeTab === 'database' ? '#0c0d0e' : '#94a3b8'
              }}
              className="flex items-center justify-center transition-all cursor-pointer hover:bg-white/10 hover:text-white shrink-0"
              title="Database Hub"
            >
              <Database size={18} />
              <span className="sr-only">Database Hub</span>
            </button>

            <button
              type="button"
              aria-label="Seat Licenses"
              onClick={() => setActiveTab('quotas')}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '9999px',
                backgroundColor: activeTab === 'quotas' ? '#ffffff' : 'transparent',
                color: activeTab === 'quotas' ? '#0c0d0e' : '#94a3b8'
              }}
              className="flex items-center justify-center transition-all cursor-pointer hover:bg-white/10 hover:text-white shrink-0"
              title="Seat Licenses"
            >
              <Users size={18} />
              <span className="sr-only">Seat Licenses</span>
            </button>

            {/* Quick Add Company Button */}
            <button
              type="button"
              aria-label="Add Client Company"
              onClick={handleOpenCreate}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '9999px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.15)'
              }}
              className="flex items-center justify-center hover:bg-white/20 transition-all cursor-pointer mt-1 shrink-0"
              title="Add Client Company"
            >
              <Plus size={18} />
              <span className="sr-only">Add Client Company</span>
            </button>
          </nav>
        </div>

        {/* Bottom: Settings & Logout */}
        <div className="flex flex-col items-center gap-2.5 w-full">
          <button
            type="button"
            aria-label="Settings"
            onClick={() => setActiveTab('settings')}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '9999px',
              backgroundColor: activeTab === 'settings' ? '#ffffff' : 'transparent',
              color: activeTab === 'settings' ? '#0c0d0e' : '#94a3b8'
            }}
            className="flex items-center justify-center transition-all cursor-pointer hover:bg-white/10 hover:text-white shrink-0"
            title="Settings"
          >
            <Settings size={18} />
            <span className="sr-only">Settings</span>
          </button>

          {onSignOut && (
            <button
              type="button"
              aria-label="Sign Out"
              onClick={onSignOut}
              style={{ width: '40px', height: '40px', borderRadius: '9999px', color: '#94a3b8' }}
              className="flex items-center justify-center hover:text-rose-400 hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              title="Sign Out"
            >
              <LogOut size={18} />
              <span className="sr-only">Sign Out</span>
            </button>
          )}
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. COLUMN 2: PROFILE & RESOURCE ALLOCATION SIDEBAR (280px / w-72, #ffffff) */}
      {/* ========================================================================= */}
      <aside
        style={{ backgroundColor: '#ffffff', color: '#0f172a', borderColor: '#edf0f4' }}
        className="console-sidebar-profile w-72 shrink-0 border-r flex flex-col justify-between p-6 select-none h-screen overflow-y-auto"
      >
        <div className="space-y-6">
          {/* Profile Header Block */}
          <div className="text-center pt-2">
            {/* Perfectly Circular Avatar with Docked Verified Badge */}
            <div className="relative inline-flex items-center justify-center mx-auto" style={{ width: '64px', height: '64px' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '9999px',
                  backgroundColor: '#0c0d0e',
                  color: '#ffffff',
                  border: '3px solid #f1f5f9'
                }}
                className="flex items-center justify-center text-xl font-black shadow-sm shrink-0"
              >
                {(currentUserEmail || 'SA').charAt(0).toUpperCase()}
              </div>
              <span
                style={{
                  width: '14px',
                  height: '14px',
                  borderRadius: '9999px',
                  backgroundColor: '#10b981',
                  border: '2px solid #ffffff'
                }}
                className="absolute bottom-0 right-0 shadow-xs"
                title="Online & Verified Partner Admin"
              />
            </div>

            <h2 className="text-base font-black text-slate-900 tracking-tight mt-3">
              {currentUserEmail ? currentUserEmail.split('@')[0] : 'Partner Admin'}
            </h2>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
              Partner Console Admin
            </div>

            {/* Verified Admin Status (Clean text, no box) */}
            <div className="inline-flex items-center gap-1.5 mt-2 text-emerald-600 text-xs font-semibold select-none">
              <span
                style={{ width: '6px', height: '6px', borderRadius: '9999px', backgroundColor: '#10b981' }}
                className="shrink-0"
              />
              <span>Partner Verified</span>
              <span className="text-slate-400 font-normal text-[11px]">· Super Admin</span>
            </div>
          </div>

          {/* Contact & Gateway Links */}
          <div className="space-y-3 pt-4 border-t border-slate-100 text-xs">
            <div className="flex items-center gap-2.5 text-slate-600">
              <div
                style={{ borderRadius: '8px' }}
                className="w-7 h-7 bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500 shrink-0"
              >
                <Users size={13} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] text-slate-400 font-medium leading-none">Email</span>
                <span className="font-semibold text-slate-900 truncate mt-0.5">
                  {currentUserEmail || 'admin@geosphere.io'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 text-slate-600">
              <div
                style={{ borderRadius: '8px' }}
                className="w-7 h-7 bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-500 shrink-0"
              >
                <ExternalLink size={13} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] text-slate-400 font-medium leading-none">Console Gateway</span>
                <span className="font-semibold text-slate-900 truncate mt-0.5">
                  https://geosphere.io/console
                </span>
              </div>
            </div>
          </div>

          {/* Logical Infrastructure Health & SLA Bars */}
          <div className="space-y-3 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-900 tracking-tight">System Infrastructure</span>
              <span className="text-[11px] font-bold text-emerald-600 tracking-wider">
                HEALTHY
              </span>
            </div>

            <div className="space-y-3">
              {/* Row-Level Security */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 text-[11px]">Row-Level Security</span>
                  <span className="font-mono text-[10px] font-bold text-slate-900">100% Active</span>
                </div>
                <div style={{ borderRadius: '9999px' }} className="h-2 bg-slate-100 overflow-hidden">
                  <div style={{ width: '100%', borderRadius: '9999px', backgroundColor: '#0c0d0e' }} className="h-full" />
                </div>
              </div>

              {/* Gateway SLA */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 text-[11px]">Gateway SLA</span>
                  <span className="font-mono text-[10px] font-bold text-slate-900">99.98% SLA</span>
                </div>
                <div style={{ borderRadius: '9999px' }} className="h-2 bg-slate-100 overflow-hidden">
                  <div style={{ width: '85%', borderRadius: '9999px', backgroundColor: '#1e293b' }} className="h-full" />
                </div>
              </div>

              {/* User Seats Allocation */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 text-[11px]">Active User Seats</span>
                  <span className="font-mono text-[10px] font-bold text-slate-900">{metric(totalSeats)} Allocated</span>
                </div>
                <div style={{ borderRadius: '9999px' }} className="h-2 bg-slate-100 overflow-hidden">
                  <div style={{ width: totalSeats ? '65%' : '8%', borderRadius: '9999px', backgroundColor: '#334155' }} className="h-full" />
                </div>
              </div>

              {/* Storage Quota Allocated */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 text-[11px]">Storage Allocated</span>
                  <span className="font-mono text-[10px] font-bold text-slate-900">{metric(totalQuota, ' GB')}</span>
                </div>
                <div style={{ borderRadius: '9999px' }} className="h-2 bg-slate-100 overflow-hidden">
                  <div style={{ width: totalQuota ? '50%' : '8%', borderRadius: '9999px', backgroundColor: '#64748b' }} className="h-full" />
                </div>
              </div>

              {/* Edge Node Processing */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 text-[11px]">Edge Ingestion</span>
                  <span className="font-mono text-[10px] font-bold text-slate-900">Cloud + NAS</span>
                </div>
                <div style={{ borderRadius: '9999px' }} className="h-2 bg-slate-100 overflow-hidden">
                  <div style={{ width: '75%', borderRadius: '9999px', backgroundColor: '#94a3b8' }} className="h-full" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Infrastructure Badge */}
        <div className="pt-4 border-t border-slate-100">
          <div
            style={{ borderRadius: '16px' }}
            className="p-3 bg-slate-50 border border-slate-100 flex items-center gap-3"
          >
            <div
              style={{ borderRadius: '10px' }}
              className="w-8 h-8 bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0"
            >
              <CheckCircle2 size={16} />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-bold text-slate-900 leading-tight">
                RLS Isolation Verified
              </span>
              <span className="text-[10px] text-slate-400">Multi-Tenant Cloud Guard</span>
            </div>
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 3. COLUMN 3: MAIN WORKSPACE CANVAS (CLEAN OFF-WHITE #f4f5f8)               */}
      {/* ========================================================================= */}
      <div
        style={{ backgroundColor: '#f4f5f8', color: '#0f172a' }}
        className="console-canvas-bg flex-1 flex flex-col min-w-0 h-screen overflow-y-auto"
      >
        {/* UNIFIED TOP BAR HEADER */}
        <header
          style={{ backgroundColor: '#ffffff', borderColor: '#edf0f4', color: '#0f172a' }}
          className="console-top-bar h-18 border-b px-8 flex items-center justify-between sticky top-0 z-20 shadow-xs shrink-0 gap-4"
        >
          {/* Left: Title & Subtitle */}
          <div className="flex flex-col min-w-0">
            <h1 className="text-xl font-black text-slate-900 tracking-tight leading-tight flex items-center gap-2">
              <span>Dashboard</span>
            </h1>
            <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
              {todayFormatted} · Enterprise Multi-Tenant Partner Hub
            </p>
          </div>

          {/* Center: Search Box */}
          <div className="relative flex-1 max-w-md mx-2">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search Here..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ borderRadius: '9999px', backgroundColor: '#f8fafc', color: '#0f172a', boxShadow: 'none' }}
              className="console-search-input w-full pl-10 pr-4 py-2 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all border border-slate-200/80"
            />
          </div>

          {/* Right: Actions Stack */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Date Pill */}
            <div
              style={{ borderRadius: '12px' }}
              className="px-3 py-1.5 border border-slate-200/80 bg-white text-xs font-semibold text-slate-700 flex items-center gap-1.5 shadow-2xs"
            >
              <Calendar size={13} className="text-slate-500" />
              <span>{monthYearFormatted}</span>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={loadOrgs}
              disabled={isLoading}
              style={{ borderRadius: '12px', backgroundColor: '#ffffff', color: '#334155' }}
              className="px-3.5 py-1.5 text-xs font-semibold border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              title="Refresh from Supabase"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>

            {/* Add Client Company Button (High Contrast Guaranteed) */}
            <button
              type="button"
              onClick={handleOpenCreate}
              style={{ borderRadius: '12px', backgroundColor: '#0c0d0e', color: '#ffffff' }}
              className="px-4 py-1.5 text-xs font-bold hover:bg-black flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Client Company</span>
            </button>

            {/* Open Client App Button (High Contrast Guaranteed) */}
            <button
              type="button"
              onClick={onBackToApp}
              style={{ borderRadius: '12px', backgroundColor: '#0c0d0e', color: '#ffffff' }}
              className="px-4 py-1.5 text-xs font-bold hover:bg-black flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              title="Open the client map viewer"
            >
              <span>Open Client App</span>
              <ExternalLink size={12} className="opacity-80" />
            </button>

            {/* Notification Bell */}
            <div
              style={{ borderRadius: '12px' }}
              className="p-2 border border-slate-200/80 bg-white text-slate-600 shadow-2xs cursor-pointer hover:bg-slate-50 transition-colors"
            >
              <Bell size={14} />
            </div>
          </div>
        </header>

        {/* MAIN BODY AREA */}
        <main className="flex-1 p-8 space-y-6 max-w-7xl w-full mx-auto">

          {/* ========================================================================= */}
          {/* 4. TOP BENTO GRID: 4 WHITE METRIC CARDS + 1 PITCH-BLACK HERO MAP CARD     */}
          {/* ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left 4 Cards: 2x2 Grid (Matching Reference Design) */}
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Card 1: Active Tenants */}
              <div
                style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
                className="console-card-white p-6 rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-xs transition-shadow"
              >
                <div>
                  <span className="text-3xl font-black tracking-tight text-slate-900 block">
                    {metric(activeCount)}
                  </span>
                  <span className="text-xs font-medium text-slate-400 mt-1 block">
                    Active Tenants
                  </span>
                </div>
                <div className="flex items-center justify-between mt-5 pt-3 border-t border-slate-100/80">
                  <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-700">
                    <Building2 size={18} />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400">
                    of {organizations.length} registered
                  </span>
                </div>
              </div>

              {/* Card 2: Licensed Seats */}
              <div
                style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
                className="console-card-white p-6 rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-xs transition-shadow"
              >
                <div>
                  <span className="text-3xl font-black tracking-tight text-slate-900 block">
                    {metric(totalSeats)}
                  </span>
                  <span className="text-xs font-medium text-slate-400 mt-1 block">
                    Licensed Seats
                  </span>
                </div>
                <div className="flex items-center justify-between mt-5 pt-3 border-t border-slate-100/80">
                  <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-700">
                    <Users size={18} />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400">
                    Across all clients
                  </span>
                </div>
              </div>

              {/* Card 3: Storage Quota */}
              <div
                style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
                className="console-card-white p-6 rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-xs transition-shadow"
              >
                <div>
                  <span className="text-3xl font-black tracking-tight text-slate-900 block">
                    {metric(totalQuota, ' GB')}
                  </span>
                  <span className="text-xs font-medium text-slate-400 mt-1 block">
                    Total Storage
                  </span>
                </div>
                <div className="flex items-center justify-between mt-5 pt-3 border-t border-slate-100/80">
                  <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-700">
                    <HardDrive size={18} />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400">
                    Cloud + On-Prem NAS
                  </span>
                </div>
              </div>

              {/* Card 4: Dedicated DBs */}
              <div
                style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
                className="console-card-white p-6 rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:shadow-xs transition-shadow"
              >
                <div>
                  <span className="text-3xl font-black tracking-tight text-slate-900 block">
                    {metric(dedicatedCount)}
                  </span>
                  <span className="text-xs font-medium text-slate-400 mt-1 block">
                    Dedicated DBs
                  </span>
                </div>
                <div className="flex items-center justify-between mt-5 pt-3 border-t border-slate-100/80">
                  <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-700">
                    <Server size={18} />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-400">
                    Enterprise Client Stacks
                  </span>
                </div>
              </div>
            </div>

            {/* Right Card: Dark Hero World/Regional Map Widget (Matching Reference "Top visitors") */}
            <div
              style={{ backgroundColor: '#0c0d0e', color: '#ffffff' }}
              className="lg:col-span-5 console-card-dark p-6 rounded-3xl bg-[#0c0d0e] text-white border border-[#1a1c22] shadow-xl flex flex-col justify-between relative overflow-hidden"
            >
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <h2 className="text-sm font-bold text-white tracking-tight">Top Regional Nodes</h2>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Online &amp; Active
                  </span>
                </div>

                {/* Sub-stats Row (Matching Reference Top Row: USA / INDIA / ENG) */}
                <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#ff4d15]" />
                    <span>TNB · 1,922,340</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    <span>APEX · 822,340</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>AWS SG · 23,302</span>
                  </div>
                </div>

                {/* Stylized Vector World/Regional Map Graphic with Glowing Nodes */}
                <div className="mt-4 h-40 w-full relative flex items-center justify-center">
                  <svg className="w-full h-full" viewBox="0 0 340 160" fill="none">
                    {/* Background subtle grid lines */}
                    <line x1="10" y1="40" x2="330" y2="40" stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
                    <line x1="10" y1="80" x2="330" y2="80" stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
                    <line x1="10" y1="120" x2="330" y2="120" stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
                    <line x1="85" y1="10" x2="85" y2="150" stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
                    <line x1="170" y1="10" x2="170" y2="150" stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
                    <line x1="255" y1="10" x2="255" y2="150" stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />

                    {/* Continents Silhouettes in Dark Slate */}
                    {/* North America */}
                    <path
                      d="M25,35 Q40,25 65,30 Q80,45 70,65 Q50,70 35,55 Z"
                      fill="#1c1e24"
                    />
                    {/* South America */}
                    <path
                      d="M60,80 Q75,85 70,115 Q60,135 50,110 Q50,90 60,80 Z"
                      fill="#1c1e24"
                    />
                    {/* Europe & Africa */}
                    <path
                      d="M130,30 Q155,25 160,45 Q145,55 130,45 Z"
                      fill="#1c1e24"
                    />
                    <path
                      d="M130,60 Q160,65 155,100 Q145,120 135,105 Q125,80 130,60 Z"
                      fill="#1c1e24"
                    />
                    {/* Asia */}
                    <path
                      d="M180,30 Q230,25 250,55 Q235,75 205,65 Q190,55 180,30 Z"
                      fill="#1c1e24"
                    />
                    {/* Southeast Asia / Malaysia highlighted zone */}
                    <path
                      d="M225,80 Q255,85 245,115 Q230,125 215,105 Q215,90 225,80 Z"
                      fill="#ff4d15"
                      fillOpacity="0.85"
                    />
                    {/* Australia */}
                    <path
                      d="M260,105 Q285,105 285,130 Q265,140 250,125 Z"
                      fill="#1c1e24"
                    />

                    {/* Connection arcs between nodes */}
                    <path
                      d="M 60,45 Q 140,20 230,95"
                      stroke="rgba(255,77,21,0.4)"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    <path
                      d="M 145,45 Q 185,60 230,95"
                      stroke="rgba(255,255,255,0.3)"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />

                    {/* Glowing Ping Rings and Dots */}
                    {/* Primary Highlighted Node */}
                    <circle cx="230" cy="95" r="7" fill="#ff4d15" fillOpacity="0.3" />
                    <circle cx="230" cy="95" r="3.5" fill="#ff4d15" />
                    {/* US Node */}
                    <circle cx="60" cy="45" r="2.5" fill="#ffffff" />
                    {/* EU Node */}
                    <circle cx="145" cy="45" r="2.5" fill="#ffffff" />
                  </svg>
                </div>
              </div>

              <div className="mt-2 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
                <span>Multi-Tenant Gateway Routing</span>
                <span className="font-mono text-emerald-400">99.98% Latency SLA</span>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 5. TOTAL ACTIVITY (PAIRED BAR CHART WITH FLOATING POPUP TOOLTIP)           */}
          {/* ========================================================================= */}
          <div
            style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
            className="console-card-white p-7 rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
          >
            {/* Header with Title and Legend */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
              <div>
                <h2 className="text-base font-black text-slate-900 tracking-tight">Total Activity</h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Platform Ingestion Trends · Live Seat &amp; Storage Distribution
                </p>
              </div>
              <div className="flex items-center gap-5 text-xs font-semibold">
                <span className="flex items-center gap-2 text-slate-900">
                  <span
                    style={{ width: '10px', height: '10px', borderRadius: '9999px', backgroundColor: '#ff4d15', display: 'inline-block' }}
                    className="shrink-0"
                  />
                  <span>360 Panoramas</span>
                </span>
                <span className="flex items-center gap-2 text-slate-600">
                  <span
                    style={{ width: '10px', height: '10px', borderRadius: '9999px', backgroundColor: '#0c0d0e', display: 'inline-block' }}
                    className="shrink-0"
                  />
                  <span>GIS Vector Layers</span>
                </span>
              </div>
            </div>

            {/* Body: Left Stats Summary + Right Paired Bar Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end mt-6">
              {/* Left Column: Today visitors & Weekly volume */}
              <div className="lg:col-span-3 space-y-6">
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                    Today Ingestion
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-3xl font-black text-slate-900">639</span>
                    <span className="text-xs font-semibold text-slate-400">frames</span>
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                    Weekly Volume
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-3xl font-black text-slate-900">120,370</span>
                    <span className="text-xs font-semibold text-slate-400">frames</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <span className="text-[11px] text-slate-500 block">
                    Total storage quota allocated: <strong className="text-slate-900">{metric(totalQuota, ' GB')}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('quotas')}
                    style={{ borderRadius: '12px', backgroundColor: '#0c0d0e', color: '#ffffff' }}
                    className="mt-3 px-3.5 py-1.5 text-xs font-bold hover:bg-black transition-colors cursor-pointer shadow-2xs"
                  >
                    Manage Quotas
                  </button>
                </div>
              </div>

              {/* Right Column: Modern Paired Bar Chart with Floating Tooltip (Matching Reference) */}
              <div className="lg:col-span-9">
                <div className="h-44 flex items-end justify-between gap-3 sm:gap-6 pt-10 pb-2 border-b border-slate-100 relative">
                  {/* Pair 1: 01 */}
                  <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div className="flex items-end gap-1.5 h-full w-full justify-center">
                      <div style={{ height: '32%', backgroundColor: '#0c0d0e', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                      <div style={{ height: '22%', backgroundColor: '#cbd5e1', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                    </div>
                  </div>

                  {/* Pair 2: 05 */}
                  <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div className="flex items-end gap-1.5 h-full w-full justify-center">
                      <div style={{ height: '55%', backgroundColor: '#0c0d0e', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                      <div style={{ height: '40%', backgroundColor: '#cbd5e1', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                    </div>
                  </div>

                  {/* Pair 3: 10 */}
                  <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div className="flex items-end gap-1.5 h-full w-full justify-center">
                      <div style={{ height: '45%', backgroundColor: '#0c0d0e', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                      <div style={{ height: '35%', backgroundColor: '#cbd5e1', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                    </div>
                  </div>

                  {/* Pair 4: 15 */}
                  <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div className="flex items-end gap-1.5 h-full w-full justify-center">
                      <div style={{ height: '65%', backgroundColor: '#0c0d0e', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                      <div style={{ height: '52%', backgroundColor: '#cbd5e1', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                    </div>
                  </div>

                  {/* Pair 5: 20 (FEATURED ACTIVE BAR WITH FLOATING TOOLTIP AS IN REFERENCE) */}
                  <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end relative">
                    {/* Floating Tooltip Card */}
                    <div
                      style={{ borderRadius: '12px' }}
                      className="absolute -top-14 left-1/2 -translate-x-1/2 bg-white shadow-lg border border-slate-100 px-3 py-1.5 text-center whitespace-nowrap z-20"
                    >
                      <span className="text-[10px] font-bold text-slate-400 block uppercase">Oct 13</span>
                      <div className="flex items-center gap-1.5 text-xs font-bold mt-0.5">
                        <span className="text-[#ff4d15]">850k</span>
                        <span className="text-slate-300">/</span>
                        <span className="text-[#0c0d0e]">460k</span>
                      </div>
                      <div className="w-2 h-2 bg-white border-r border-b border-slate-100 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2" />
                    </div>

                    <div className="flex items-end gap-1.5 h-full w-full justify-center">
                      <div style={{ height: '85%', backgroundColor: '#ff4d15', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4 shadow-sm" />
                      <div style={{ height: '68%', backgroundColor: '#0c0d0e', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                    </div>
                  </div>

                  {/* Pair 6: 25 */}
                  <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div className="flex items-end gap-1.5 h-full w-full justify-center">
                      <div style={{ height: '70%', backgroundColor: '#cbd5e1', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                      <div style={{ height: '58%', backgroundColor: '#e2e8f0', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                    </div>
                  </div>

                  {/* Pair 7: 30 */}
                  <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div className="flex items-end gap-1.5 h-full w-full justify-center">
                      <div style={{ height: '62%', backgroundColor: '#cbd5e1', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                      <div style={{ height: '48%', backgroundColor: '#e2e8f0', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }} className="w-3 sm:w-4" />
                    </div>
                  </div>
                </div>

                {/* X-axis Timeline Labels */}
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-2">
                  <span>01</span>
                  <span>05</span>
                  <span>10</span>
                  <span>15</span>
                  <span className="font-bold text-[#ff4d15]">20</span>
                  <span>25</span>
                  <span>30</span>
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 6. CLIENT DIRECTORY TABLE (MATCHING "RECENT USERS" STYLE FROM REFERENCE)   */}
          {/* ========================================================================= */}
          <div
            style={{ backgroundColor: '#ffffff', color: '#0f172a' }}
            className="console-card-white p-7 rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] space-y-5"
          >
            {/* Header & Filter Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-black text-slate-900 tracking-tight">
                  Client Companies &amp; Database Routing
                </h2>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Live Supabase tenants isolation via Row Level Security (RLS) &amp; Dedicated Instances
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  Showing <strong className="text-slate-900">{filteredOrgs.length}</strong> companies
                </span>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-400 mr-1">Status:</span>
              {(['ALL', 'active', 'trial', 'suspended'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3.5 py-1 rounded-full text-xs font-semibold capitalize transition-all cursor-pointer ${
                    statusFilter === st
                      ? 'bg-[#0c0d0e] text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {st === 'ALL' ? 'All Status' : st}
                </button>
              ))}

              <span className="text-xs font-bold text-slate-400 ml-3 mr-1">Database:</span>
              {(['ALL', 'cloud_shared', 'dedicated_external'] as const).map((dt) => (
                <button
                  key={dt}
                  type="button"
                  onClick={() => setDbTypeFilter(dt)}
                  className={`px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                    dbTypeFilter === dt
                      ? 'bg-[#0c0d0e] text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {dt === 'ALL' ? 'All Databases' : dt === 'cloud_shared' ? 'Cloud Shared' : 'Dedicated'}
                </button>
              ))}
            </div>

            {/* The Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full text-left text-xs text-slate-700">
                <thead
                  style={{ backgroundColor: '#f8fafc', borderColor: '#edf0f4', color: '#64748b' }}
                  className="border-b font-bold uppercase tracking-wider text-[10px]"
                >
                  <tr>
                    <th className="px-6 py-3.5">Company</th>
                    <th className="px-6 py-3.5">Client Code</th>
                    <th className="px-6 py-3.5">Database Routing</th>
                    <th className="px-6 py-3.5">Seats &amp; Storage</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                        <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-slate-600" />
                        <span>Querying live Supabase organizations...</span>
                      </td>
                    </tr>
                  ) : filteredOrgs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                        {directoryError ? (
                          <>
                            <AlertCircle size={24} className="mx-auto mb-2 text-rose-500" />
                            <div className="font-bold text-sm text-slate-800">Customer list could not be verified</div>
                            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                              This is a failed query, not an empty directory. The figures above are unknown until it
                              succeeds.
                            </p>
                            <p className="text-[11px] text-rose-600 mt-2 font-mono break-words max-w-sm mx-auto">
                              {directoryError}
                            </p>
                            <button
                              type="button"
                              onClick={loadOrgs}
                              className="mt-4 px-4 py-2 rounded-xl text-xs font-bold bg-[#0c0d0e] hover:bg-black text-white inline-flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                            >
                              <RefreshCw size={14} />
                              <span>Retry Query</span>
                            </button>
                          </>
                        ) : (
                          <>
                            <Building2 size={24} className="mx-auto mb-2 text-slate-400" />
                            <div className="font-bold text-sm text-slate-800">No client companies found</div>
                            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                              {searchQuery
                                ? `No records matching "${searchQuery}". Try clearing search filter.`
                                : 'Click "Add Client Company" to provision your first live organization.'}
                            </p>
                            <button
                              type="button"
                              onClick={handleOpenCreate}
                              className="mt-4 px-4 py-2 rounded-xl text-xs font-bold bg-[#0c0d0e] hover:bg-black text-white inline-flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                            >
                              <Plus size={14} />
                              <span>Add Client Company</span>
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredOrgs.map((org) => (
                      <tr key={org.id} className="hover:bg-slate-50/70 transition-colors">
                        {/* Company Details */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-[#0c0d0e] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                              {org.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 text-xs truncate">{org.name}</div>
                              <div className="text-[11px] text-slate-400 truncate">
                                {org.settings?.contactEmail || 'No contact email'}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Client Code */}
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs font-semibold text-slate-700">
                            {org.clientCode}
                          </span>
                        </td>

                        {/* Database Routing Mode */}
                        <td className="px-6 py-4">
                          {org.databaseType === 'dedicated_external' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-700">
                              <Server size={13} className="text-purple-600" />
                              Dedicated External
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700">
                              <Database size={13} className="text-sky-600" />
                              Cloud Shared RLS
                            </span>
                          )}
                        </td>

                        {/* Quotas */}
                        <td className="px-6 py-4 text-slate-600">
                          <span className="font-bold text-slate-900">{org.settings?.allowedUserSeats || 0}</span> seats ·{' '}
                          <span className="font-bold text-slate-900">{org.settings?.storageQuotaGb || 0}</span> GB
                        </td>

                        {/* Status */}
                        <td className="px-6 py-4">
                          {org.status === 'active' && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-bold">
                              <CheckCircle2 size={13} /> Active
                            </span>
                          )}
                          {org.status === 'trial' && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 font-bold">
                              <AlertCircle size={13} /> Trial / Pilot
                            </span>
                          )}
                          {org.status === 'suspended' && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-rose-600 font-bold">
                              <X size={13} /> Suspended
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Preview in New Tab */}
                            <button
                              type="button"
                              onClick={() => handlePreviewCompany(org)}
                              className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[#0c0d0e] hover:bg-black text-white flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                              title="Preview client workspace in a new tab"
                            >
                              <Eye size={12} />
                              <span>Preview</span>
                              <ExternalLink size={10} className="opacity-70" />
                            </button>

                            {/* Edit */}
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(org)}
                              className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                              title="Edit Configuration"
                            >
                              <Edit3 size={14} />
                            </button>

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={() => handleDelete(org.id, org.name)}
                              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Delete Company"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {/* ========================================================================= */}
      {/* 6. CREATE / EDIT MODAL (CLEAN MONOCHROME THEME)                            */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl animate-panel-enter">
            {/* Modal Header */}
            <div className="px-6 py-4.5 bg-[#121316] text-white flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Building2 size={16} className="text-white" />
                {editingOrg ? `Edit Client: ${editingOrg.name}` : 'Register New Client Company'}
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSave} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-slate-800">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Company Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Tenaga Nasional Berhad"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-black transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Client Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. TNB-LV-2026"
                    value={formData.clientCode}
                    onChange={(e) => setFormData({ ...formData, clientCode: e.target.value })}
                    className="w-full px-3.5 py-2 rounded-xl text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-black transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Contact Email</label>
                  <input
                    type="email"
                    placeholder="admin@client.com"
                    value={formData.settings?.contactEmail || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        settings: { ...formData.settings, contactEmail: e.target.value }
                      })
                    }
                    className="w-full px-3.5 py-2 rounded-xl text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-black transition-colors"
                  />
                </div>
              </div>

              {/* DATABASE MODE SELECTION */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-700">Database Routing Architecture</label>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`p-3.5 rounded-xl border text-xs cursor-pointer flex flex-col gap-1 transition-all ${
                      formData.databaseType === 'cloud_shared'
                        ? 'border-black bg-slate-50 text-slate-900 ring-1 ring-black'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="databaseType"
                      checked={formData.databaseType === 'cloud_shared'}
                      onChange={() => setFormData({ ...formData, databaseType: 'cloud_shared' })}
                      className="hidden"
                    />
                    <div className="font-bold flex items-center gap-1.5 text-slate-900">
                      <Database size={13} /> Cloud Shared (RLS)
                    </div>
                    <span className="text-[11px] leading-tight text-slate-500">
                      Standard SaaS. Isolated automatically via Row-Level Security.
                    </span>
                  </label>

                  <label
                    className={`p-3.5 rounded-xl border text-xs cursor-pointer flex flex-col gap-1 transition-all ${
                      formData.databaseType === 'dedicated_external'
                        ? 'border-black bg-slate-50 text-slate-900 ring-1 ring-black'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="databaseType"
                      checked={formData.databaseType === 'dedicated_external'}
                      onChange={() => setFormData({ ...formData, databaseType: 'dedicated_external' })}
                      className="hidden"
                    />
                    <div className="font-bold flex items-center gap-1.5 text-slate-900">
                      <Server size={13} /> Dedicated Client DB
                    </div>
                    <span className="text-[11px] leading-tight text-slate-500">
                      Self-hosted external Supabase / on-premises LAN database.
                    </span>
                  </label>
                </div>
              </div>

              {/* DEDICATED DB CONFIG (IF SELECTED) */}
              {formData.databaseType === 'dedicated_external' && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Sliders size={13} /> Dedicated Supabase Credentials
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                      Client Supabase URL
                    </label>
                    <input
                      type="url"
                      placeholder="https://client-project.supabase.co"
                      value={formData.databaseConfig?.url || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          databaseConfig: { ...formData.databaseConfig, url: e.target.value }
                        })
                      }
                      className="w-full px-3 py-1.5 rounded-lg text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-black font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                      Client Anon / Service Key
                    </label>
                    <input
                      type="password"
                      placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                      value={formData.databaseConfig?.anonKey || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          databaseConfig: { ...formData.databaseConfig, anonKey: e.target.value }
                        })
                      }
                      className="w-full px-3 py-1.5 rounded-lg text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-black font-mono"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={isTestingDb}
                      className="px-3 py-1 rounded-lg text-xs font-bold bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Activity size={12} className={isTestingDb ? 'animate-spin' : ''} />
                      <span>{isTestingDb ? 'Testing Connection...' : 'Test Connection'}</span>
                    </button>
                    {dbTestResult && (
                      <span
                        className={`text-xs flex items-center gap-1 font-semibold ${
                          dbTestResult.success ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {dbTestResult.success ? <Check size={13} /> : <ShieldAlert size={13} />}
                        {dbTestResult.message}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* SEATS & QUOTAS */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Licensed Seats</label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={formData.settings?.allowedUserSeats || 10}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        settings: { ...formData.settings, allowedUserSeats: parseInt(e.target.value, 10) || 1 }
                      })
                    }
                    className="w-full px-3.5 py-2 rounded-xl text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-black"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Storage Quota (GB)</label>
                  <input
                    type="number"
                    min="10"
                    max="10000"
                    value={formData.settings?.storageQuotaGb || 200}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        settings: { ...formData.settings, storageQuotaGb: parseInt(e.target.value, 10) || 10 }
                      })
                    }
                    className="w-full px-3.5 py-2 rounded-xl text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-black"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold bg-[#121316] hover:bg-black text-white shadow-xs transition-colors cursor-pointer"
                >
                  {editingOrg ? 'Save Changes' : 'Create Organization'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
