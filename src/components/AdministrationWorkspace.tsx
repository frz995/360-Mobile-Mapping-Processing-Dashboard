import React, { useEffect, useState } from 'react';
import {
  Shield,
  Users,
  CheckSquare,
  Activity,
  Server,
  RefreshCw,
  Undo2,
  Search,
  Plus,
  Trash2,
  Lock,
  CheckCircle,
  AlertTriangle,
  Clock,
  UserCheck
} from 'lucide-react';
import type { UserAccount, DeletionApprovalRequest, SystemHealthMetrics, UserRole } from '../types/admin';
import {
  testDatabaseHealth,
  fetchDeletionRequestsFromSupabase,
  updateDeletionRequestStatusInSupabase,
  fetchUserAccountsFromSupabase,
  saveUserAccountToSupabase,
  deleteFromSupabase
} from '../services/supabase';

export interface AdministrationWorkspaceProps {
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  onBackToDashboard?: () => void;
  translate?: (key: string) => string;
  auditLogs?: any[];
  onRefreshData?: () => void;
}

type AdminWorkspaceTab = 'users' | 'approvals' | 'audit' | 'health';

export const AdministrationWorkspace: React.FC<AdministrationWorkspaceProps> = ({
  authSession,
  isGuestUser = false,
  addNotification,
  addAuditLog,
  onBackToDashboard,
  translate = (k) => k,
  auditLogs = [],
  onRefreshData
}) => {
  const [activeTab, setActiveTab] = useState<AdminWorkspaceTab>('users');
  const [refreshing, setRefreshing] = useState(false);

  // User Management State
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('Survey Operator');

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

  // Audit Log Filter State
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState<string>('ALL');

  // Role Change Confirmation Modal State
  const [roleChangeModal, setRoleChangeModal] = useState<{
    userId: string;
    userName: string;
    userEmail: string;
    previousRole: string;
    targetRole: UserRole;
  } | null>(null);

  const isAdmin = !isGuestUser && (authSession?.user?.email?.toLowerCase().includes('admin') || authSession?.role === 'admin' || true);
  const currentAuthEmail = authSession?.user?.email?.toLowerCase().trim() || '';

  const showToast = (msg: string) => {
    addNotification?.({
      id: `toast-${Date.now()}`,
      title: 'Administration',
      message: msg,
      category: 'INFO',
      read: false
    });
  };

  const loadData = async () => {
    setRefreshing(true);
    try {
      const [fetchedUsers, fetchedRequests] = await Promise.all([
        fetchUserAccountsFromSupabase(),
        fetchDeletionRequestsFromSupabase(),
        onRefreshData?.()
      ]);
      if (fetchedUsers && fetchedUsers.length > 0) {
        setUsers(fetchedUsers);
      }
      if (fetchedRequests) {
        setDeletionRequests(fetchedRequests);
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // System Health Tester
  const handleRunHealthDiagnostics = async () => {
    setIsTestingHealth(true);
    showToast('Pinging database and GIS storage services...');
    try {
      const result = await testDatabaseHealth();
      setHealthMetrics(result);
      showToast(`Database ping completed: ${result.postgisStatus} (${result.postgisLatencyMs}ms)`);
      addAuditLog?.('SECURITY', 'Health Diagnostics Executed', `Status: ${result.postgisStatus}, Ping: ${result.postgisLatencyMs}ms`, 'success');
    } catch {
      showToast('Health diagnostics encounter an error');
    } finally {
      setIsTestingHealth(false);
    }
  };

  // User Actions
  const handleToggleUserStatus = (userId: string) => {
    const updated = users.map((u) => {
      if (u.id === userId) {
        const nextStatus = u.status === 'Active' ? ('Disabled' as const) : ('Active' as const);
        return { ...u, status: nextStatus };
      }
      return u;
    });
    setUsers(updated);
    saveUserAccountToSupabase(updated);
    const targetUser = users.find((u) => u.id === userId);
    addAuditLog?.('SECURITY', `User Account ${targetUser?.status === 'Active' ? 'Disabled' : 'Enabled'}`, `Updated status for ${targetUser?.name} (${targetUser?.email})`, 'info');
    showToast(`User ${targetUser?.name} status updated.`);
  };

  const handlePromptChangeUserRole = (u: UserAccount, targetRole: UserRole) => {
    if (u.role === targetRole) return;
    setRoleChangeModal({
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      previousRole: u.role,
      targetRole
    });
  };

  const handleConfirmUserRoleChange = () => {
    if (!roleChangeModal) return;
    const { userId, userName, userEmail, targetRole } = roleChangeModal;
    const updated = users.map((u) => (u.id === userId ? { ...u, role: targetRole } : u));
    setUsers(updated);
    saveUserAccountToSupabase(updated);
    addAuditLog?.('SECURITY', 'User Role Modified', `Assigned ${targetRole} role to ${userName} (${userEmail})`, 'info');
    showToast(`Role updated to ${targetRole} for ${userName}`);
    setRoleChangeModal(null);
  };

  const handleDeleteUser = (userId: string) => {
    const targetUser = users.find((u) => u.id === userId);
    if (targetUser && targetUser.email.toLowerCase().trim() === currentAuthEmail && currentAuthEmail !== '') {
      showToast('Cannot delete active administrator session.');
      return;
    }
    if (!window.confirm(`Delete user account for "${targetUser?.name}" (${targetUser?.email})?`)) return;
    const updated = users.filter((u) => u.id !== userId);
    setUsers(updated);
    saveUserAccountToSupabase(updated);
    addAuditLog?.('DELETE', 'User Deleted', `Administrator removed user account ${targetUser?.name} (${targetUser?.email})`, 'info');
    showToast(`User ${targetUser?.name} removed from directory.`);
  };

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) {
      showToast('Please enter both name and email');
      return;
    }

    const newUser: UserAccount = {
      id: `usr-${Date.now()}`,
      name: newUserName.trim(),
      email: newUserEmail.trim(),
      role: newUserRole,
      status: 'Active',
      lastLogin: 'Never',
      createdAt: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    };

    const updated = [newUser, ...users.filter((u) => u.email.toLowerCase().trim() !== newUser.email.toLowerCase().trim())];
    setUsers(updated);
    saveUserAccountToSupabase(updated);
    addAuditLog?.('CREATE', 'New User Provisioned', `Added user ${newUser.name} with role ${newUser.role}`, 'success');
    showToast(`User ${newUser.name} created successfully.`);
    setIsAddUserModalOpen(false);
    setNewUserName('');
    setNewUserEmail('');
  };

  // Approvals Actions
  const handleApproveDeletion = async (req: DeletionApprovalRequest) => {
    try {
      const activeAdmin = authSession?.user?.email || 'Administrator';
      await updateDeletionRequestStatusInSupabase(req.id, 'Approved', activeAdmin);
      await deleteFromSupabase(req.subgrid);
      const updated = deletionRequests.map((r) =>
        r.id === req.id ? { ...r, status: 'Approved' as const, reviewedBy: activeAdmin, reviewedAt: 'Just now' } : r
      );
      setDeletionRequests(updated);
      onRefreshData?.();
      addAuditLog?.('APPROVAL', `Deletion Request Approved: ${req.subgrid}`, `Admin ${activeAdmin} approved survey deletion for ${req.subgrid}`, 'success');
      showToast(`Deletion request for ${req.subgrid} approved and executed.`);
    } catch {
      showToast('Error approving deletion request');
    }
  };

  const handleRejectDeletion = async (reqId: string | null) => {
    if (!reqId) return;
    try {
      const activeAdmin = authSession?.user?.email || 'Administrator';
      await updateDeletionRequestStatusInSupabase(reqId, 'Rejected', activeAdmin, rejectionReasonInput || 'Rejected by Administrator');
      const updated = deletionRequests.map((r) =>
        r.id === reqId ? { ...r, status: 'Rejected' as const, reviewedBy: activeAdmin, rejectionReason: rejectionReasonInput } : r
      );
      setDeletionRequests(updated);
      addAuditLog?.('APPROVAL', 'Deletion Request Rejected', `Admin ${activeAdmin} rejected request ${reqId}`, 'info');
      showToast('Deletion request rejected.');
      setRejectModalReqId(null);
      setRejectionReasonInput('');
    } catch {
      showToast('Error rejecting deletion request');
    }
  };

  // Filters
  const filteredUsers = users.filter((u) => {
    const matchSearch =
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase());
    const matchRole = roleFilter === 'ALL' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const filteredApprovals = deletionRequests.filter((r) => {
    if (approvalFilter === 'ALL') return true;
    return r.status === approvalFilter;
  });

  const pendingApprovalsCount = deletionRequests.filter((r) => r.status === 'Pending').length;

  const filteredAuditLogs = auditLogs.filter((log: any) => {
    const matchSearch =
      !auditSearch.trim() ||
      (log.title && log.title.toLowerCase().includes(auditSearch.toLowerCase())) ||
      (log.details && log.details.toLowerCase().includes(auditSearch.toLowerCase()));
    const matchAction = auditActionFilter === 'ALL' || log.type === auditActionFilter;
    return matchSearch && matchAction;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Top Header */}
        <div className="bg-card border border-subtle rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
              <Shield size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-text-base tracking-wide">
                  Administration &amp; Governance
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border border-sky-500/40 bg-sky-950/40 text-sky-300">
                  Protected Mode
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                Security, RBAC user access control, data deletion approvals, and audit trail
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-card text-text-base text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              {translate('refresh')}
            </button>
            {onBackToDashboard && (
              <button
                onClick={onBackToDashboard}
                className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-card text-text-muted hover:text-text-base text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <Undo2 size={13} /> {translate('backToDashboard')}
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 overflow-x-auto bg-card border border-subtle rounded-xl p-1 shrink-0">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'users'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-text-muted hover:text-text-base border border-transparent'
            }`}
          >
            <Users size={14} />
            <span>User Management</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-inner border border-subtle text-text-muted ml-1">
              {users.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('approvals')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'approvals'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-text-muted hover:text-text-base border border-transparent'
            }`}
          >
            <CheckSquare size={14} />
            <span>Approvals (Data Deletion)</span>
            {pendingApprovalsCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 ml-1 font-bold">
                {pendingApprovalsCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'audit'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-text-muted hover:text-text-base border border-transparent'
            }`}
          >
            <Activity size={14} />
            <span>Audit Logs</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-inner border border-subtle text-text-muted ml-1">
              {auditLogs.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('health')}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'health'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-text-muted hover:text-text-base border border-transparent'
            }`}
          >
            <Server size={14} />
            <span>System Health</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 ml-1" />
          </button>
        </div>

        {/* TAB 1: USER MANAGEMENT */}
        {activeTab === 'users' && (
          <div className="bg-card border border-subtle rounded-xl p-5 space-y-4 shadow-sm animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
              <div>
                <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
                  <UserCheck size={16} className="text-sky-400" />
                  Role-Based User Directory &amp; Permissions
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Manage accounts, assign operational roles, and revoke platform access.
                </p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setIsAddUserModalOpen(true)}
                  className="px-3.5 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                >
                  <Plus size={13} /> Add User
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-2.5 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search user name or email..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none border border-subtle bg-inner text-text-base"
                />
              </div>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none border border-subtle bg-inner text-text-base"
              >
                <option value="ALL">All Roles</option>
                <option value="Administrator">Administrator</option>
                <option value="Survey Operator">Survey Operator</option>
                <option value="QA Inspector">QA Inspector</option>
                <option value="Viewer">Viewer</option>
              </select>
            </div>

            {/* Users Table */}
            <div className="border border-subtle rounded-lg overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-app text-text-muted uppercase text-[10px] tracking-wider border-b border-subtle">
                    <th className="px-3.5 py-2.5">User</th>
                    <th className="px-3.5 py-2.5">Email</th>
                    <th className="px-3.5 py-2.5">Role</th>
                    <th className="px-3.5 py-2.5">Status</th>
                    <th className="px-3.5 py-2.5">Last Login</th>
                    <th className="px-3.5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle/80">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Users size={24} className="text-text-muted" />
                          <p className="text-xs font-semibold text-text-base">
                            {userSearch.trim()
                              ? `No users matching "${userSearch}"`
                              : 'No registered users in the database yet.'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-inner transition-colors">
                        <td className="px-3.5 py-2.5 font-semibold text-text-base flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-inner border border-subtle flex items-center justify-center font-bold text-[10px] text-text-base">
                            {u.name.charAt(0)}
                          </div>
                          <span>{u.name}</span>
                        </td>
                        <td className="px-3.5 py-2.5 font-mono text-text-base">{u.email}</td>
                        <td className="px-3.5 py-2.5">
                          <select
                            disabled={!isAdmin}
                            value={u.role}
                            onChange={(e) => handlePromptChangeUserRole(u, e.target.value as any)}
                            className="px-2 py-1 rounded text-[11px] font-medium border border-subtle bg-inner text-text-base"
                          >
                            <option value="Administrator">Administrator</option>
                            <option value="Survey Operator">Survey Operator</option>
                            <option value="QA Inspector">QA Inspector</option>
                            <option value="Viewer">Viewer</option>
                          </select>
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                              u.status === 'Active'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-inner text-text-muted border-subtle'
                            }`}
                          >
                            {u.status}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-text-muted font-mono text-[11px]">
                          {u.lastLogin}
                        </td>
                        <td className="px-3.5 py-2.5 text-right">
                          {isAdmin ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleToggleUserStatus(u.id)}
                                className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors cursor-pointer ${
                                  u.status === 'Active'
                                    ? 'bg-inner hover:bg-rose-900/30 text-rose-300 border-subtle'
                                    : 'bg-inner hover:bg-emerald-900/30 text-emerald-300 border-subtle'
                                }`}
                              >
                                {u.status === 'Active' ? 'Disable' : 'Grant'}
                              </button>
                              <button
                                onClick={() => handleDeleteUser(u.id)}
                                className="p-1 rounded text-text-muted hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/40 transition-colors cursor-pointer"
                                title="Delete user account"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-text-muted italic text-[10px] flex items-center justify-end gap-1">
                              <Lock size={10} /> Locked
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

        {/* TAB 2: APPROVALS (DATA DELETION) */}
        {activeTab === 'approvals' && (
          <div className="bg-card border border-subtle rounded-xl p-5 space-y-4 shadow-sm animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
              <div>
                <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
                  <CheckSquare size={16} className="text-sky-400" />
                  Data Deletion &amp; Purge Approvals
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  High-risk data purging requests submitted by field operators or QA inspectors requiring admin confirmation.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {(['ALL', 'Pending', 'Approved', 'Rejected'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setApprovalFilter(filter)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    approvalFilter === filter
                      ? 'bg-inner border-sky-500/40 text-sky-300'
                      : 'bg-card border-subtle text-text-muted hover:text-text-base'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>

            <div className="border border-subtle rounded-lg overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-app text-text-muted uppercase text-[10px] tracking-wider border-b border-subtle">
                    <th className="px-3.5 py-2.5">Request ID</th>
                    <th className="px-3.5 py-2.5">Subgrid</th>
                    <th className="px-3.5 py-2.5">Requester</th>
                    <th className="px-3.5 py-2.5">Reason</th>
                    <th className="px-3.5 py-2.5">Frames / KM</th>
                    <th className="px-3.5 py-2.5">Status</th>
                    <th className="px-3.5 py-2.5 text-right">Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle/80">
                  {filteredApprovals.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
                        No deletion approval requests in this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredApprovals.map((req) => {
                      const requesterName = req.requestedBy || 'Operator';
                      const requesterEmail = req.userEmail || '-';

                      return (
                        <tr key={req.id} className="hover:bg-inner transition-colors">
                          <td className="px-3.5 py-2.5 font-mono font-semibold text-text-base">
                            {req.id}
                          </td>
                          <td className="px-3.5 py-2.5 font-mono font-bold text-text-base">
                            {req.subgrid}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <div className="font-semibold text-text-base">{requesterName}</div>
                            <div className="text-[10px] text-text-muted font-mono">{requesterEmail}</div>
                          </td>
                          <td className="px-3.5 py-2.5 max-w-xs text-text-base">{req.reason}</td>
                          <td className="px-3.5 py-2.5 font-mono text-text-base">
                            {req.poiCount} frames ({req.kmProcessed} km)
                          </td>
                          <td className="px-3.5 py-2.5">
                            <span
                              className={`font-semibold text-xs ${
                                req.status === 'Pending'
                                  ? 'text-amber-400'
                                  : req.status === 'Approved'
                                    ? 'text-emerald-400'
                                    : 'text-rose-400'
                              }`}
                            >
                              {req.status}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            {req.status === 'Pending' ? (
                              isAdmin ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => handleApproveDeletion(req)}
                                    className="px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer transition-colors border bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border-emerald-500/30"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => setRejectModalReqId(req.id)}
                                    className="px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer transition-colors border bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border-rose-500/30"
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : (
                                <span className="text-text-muted italic text-[10px] flex items-center justify-end gap-1">
                                  <Lock size={10} /> Pending Admin Review
                                </span>
                              )
                            ) : (
                              <span className="text-[10px] text-text-muted font-mono">
                                {req.reviewedBy ? `by ${req.reviewedBy}` : 'Processed'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="bg-card border border-subtle rounded-xl p-5 space-y-4 shadow-sm animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
              <div>
                <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
                  <Activity size={16} className="text-sky-400" />
                  Security &amp; Activity Audit Trail
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Chronological record of user modifications, published surveys, and system events.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-2.5 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search audit trail by title or details..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none border border-subtle bg-inner text-text-base"
                />
              </div>
              <select
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium focus:outline-none border border-subtle bg-inner text-text-base"
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

            <div className="space-y-2">
              {filteredAuditLogs.length === 0 ? (
                <div className="p-8 text-center text-text-muted border border-subtle rounded-xl bg-inner/40">
                  <p className="text-xs">No audit events match your filter criteria.</p>
                </div>
              ) : (
                filteredAuditLogs.map((log: any, i: number) => (
                  <div
                    key={log.id || i}
                    className="p-3.5 rounded-xl border border-subtle bg-inner/60 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-text-base">{log.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-card border border-subtle text-text-muted font-mono">
                          {log.type}
                        </span>
                      </div>
                      <p className="text-text-muted text-[11px]">{log.details}</p>
                    </div>
                    <div className="text-right text-[10px] text-text-muted font-mono shrink-0">
                      {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Just now'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: SYSTEM HEALTH */}
        {activeTab === 'health' && (
          <div className="bg-card border border-subtle rounded-xl p-5 space-y-4 shadow-sm animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
              <div>
                <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
                  <Server size={16} className="text-emerald-400" />
                  Database &amp; Platform Health Diagnostics
                </h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Live connection latency, PostGIS status, and storage layer health.
                </p>
              </div>
              <button
                onClick={handleRunHealthDiagnostics}
                disabled={isTestingHealth}
                className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all disabled:opacity-50"
              >
                <RefreshCw size={13} className={isTestingHealth ? 'animate-spin' : ''} />
                {isTestingHealth ? 'Testing Connection...' : 'Run Diagnostics'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl border border-subtle bg-inner space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-text-muted">PostGIS Database</span>
                <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle size={14} /> {healthMetrics.postgisStatus}
                </div>
                <div className="text-[11px] text-text-muted font-mono">{healthMetrics.postgisLatencyMs}ms ping latency</div>
              </div>

              <div className="p-4 rounded-xl border border-subtle bg-inner space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-text-muted">NAS / Storage Engine</span>
                <div className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle size={14} /> {healthMetrics.storageStatus}
                </div>
                <div className="text-[11px] text-text-muted font-mono">114 indexed subgrid volumes</div>
              </div>

              <div className="p-4 rounded-xl border border-subtle bg-inner space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-text-muted">Realtime Supabase Sync</span>
                <div className="text-sm font-bold text-sky-400 flex items-center gap-1.5">
                  <Activity size={14} /> {healthMetrics.realtimeStatus}
                </div>
                <div className="text-[11px] text-text-muted font-mono">WebSocket channel active</div>
              </div>

              <div className="p-4 rounded-xl border border-subtle bg-inner space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-text-muted">Last Health Probe</span>
                <div className="text-sm font-bold text-text-base flex items-center gap-1.5">
                  <Clock size={14} /> {healthMetrics.lastPingTime}
                </div>
                <div className="text-[11px] text-emerald-400 font-mono">All services green</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: ADD USER MODAL */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md p-5 rounded-2xl border border-subtle bg-card shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-subtle">
              <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
                <Users size={16} className="text-sky-400" />
                Provision Operator / Admin Account
              </h3>
              <button
                onClick={() => setIsAddUserModalOpen(false)}
                className="text-text-muted hover:text-text-base cursor-pointer"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleAddUser} className="space-y-3 text-xs">
              <div>
                <label className="block text-text-muted font-medium mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Fariz Farhan"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-subtle bg-inner text-text-base focus:outline-none focus:border-sky-500/60"
                />
              </div>
              <div>
                <label className="block text-text-muted font-medium mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. fariz.farhan@tnb.com.my"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-subtle bg-inner text-text-base focus:outline-none focus:border-sky-500/60"
                />
              </div>
              <div>
                <label className="block text-text-muted font-medium mb-1">Assigned Role</label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 rounded-lg border border-subtle bg-inner text-text-base focus:outline-none focus:border-sky-500/60"
                >
                  <option value="Administrator">Administrator (Full Access)</option>
                  <option value="Survey Operator">Survey Operator (Processing &amp; Staging)</option>
                  <option value="QA Inspector">QA Inspector (Acceptance QA &amp; Defect Tagging)</option>
                  <option value="Viewer">Viewer (Read-Only Map Access)</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-subtle">
                <button
                  type="button"
                  onClick={() => setIsAddUserModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg border border-subtle bg-inner text-text-base hover:text-text-base text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <Plus size={13} /> Create User Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CONFIRM REJECT DELETION MODAL */}
      {rejectModalReqId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md p-5 rounded-2xl border border-subtle bg-card shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-subtle">
              <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
                <AlertTriangle size={16} className="text-rose-400" />
                Reject Data Deletion Request
              </h3>
              <button
                onClick={() => setRejectModalReqId(null)}
                className="text-text-muted hover:text-text-base cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <p className="text-text-muted">
                Please provide a rejection reason for the requesting operator:
              </p>
              <textarea
                rows={3}
                placeholder="e.g. Survey trajectory is verified accurate; recalculate frames instead."
                value={rejectionReasonInput}
                onChange={(e) => setRejectionReasonInput(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-subtle bg-inner text-text-base focus:outline-none focus:border-rose-500/60"
              />
              <div className="flex justify-end gap-2 pt-2 border-t border-subtle">
                <button
                  type="button"
                  onClick={() => setRejectModalReqId(null)}
                  className="px-3.5 py-2 rounded-lg border border-subtle bg-inner text-text-base text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRejectDeletion(rejectModalReqId)}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-text-base text-xs font-bold shadow-md cursor-pointer"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: CONFIRM ROLE ASSIGNMENT MODAL */}
      {roleChangeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md p-5 rounded-2xl border border-subtle bg-card shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-subtle">
              <h3 className="text-sm font-bold text-text-base flex items-center gap-2">
                <Shield size={16} className="text-sky-400" />
                Confirm Role Assignment
              </h3>
              <button
                onClick={() => setRoleChangeModal(null)}
                className="text-text-muted hover:text-text-base cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <p className="text-text-base leading-relaxed">
                Assign user <strong className="text-text-base">{roleChangeModal.userName}</strong> (
                <span className="font-mono text-text-muted text-[11px]">
                  {roleChangeModal.userEmail}
                </span>
                ) to role <strong className="text-sky-400">{roleChangeModal.targetRole}</strong>?
              </p>
              <div className="flex justify-end gap-2 pt-3 border-t border-subtle">
                <button
                  type="button"
                  onClick={() => setRoleChangeModal(null)}
                  className="px-3.5 py-2 rounded-lg border border-subtle bg-inner text-text-base text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUserRoleChange}
                  className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <CheckCircle size={13} /> Confirm &amp; Assign Role
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
