/**
 * The company directory: search, filter, and CRUD over every tenant.
 *
 * WHAT CHANGED
 *   * Delete uses a real confirmation dialog naming the company, instead of
 *     `window.confirm` (see `consoleUi.tsx` for why).
 *   * The `expired` status now has a badge. It was in the type union from
 *     migration 0036 and rendered as a blank cell.
 *   * "Preview" no longer opens a URL carrying a `?tenant=` parameter that
 *     nothing in the application reads.
 */

import React from 'react';
import { Building2, Database, Server, Eye, Edit3, Trash2, ExternalLink } from 'lucide-react';
import { deleteOrganization, setActiveOrganizationId, setActiveOrganizationStorage, setActiveOrganizationWebgis, type Organization } from '../../../services/tenantContext';
import type { ConsoleDirectory } from '../useConsoleDirectory';
import { STATUS_LABEL, STATUS_TONE } from '../useConsoleDirectory';
import { ConfirmDialog, PanelCard, PanelHeader, ReadFailure } from './consoleUi';
import OrganizationFormModal from './OrganizationFormModal';
import { wantsConsoleCreate } from '../../../utils/consoleRouter';
import { getLicenseExpiryStatus } from './ConsoleDashboardPanel';
import { toast } from '../../common/toast';

interface Props {
  directory: ConsoleDirectory;
  /** Company currently open in the Members / Database / Seats panels. */
  selectedOrgId: string;
  onSelectOrg: (orgId: string) => void;
  onOpenMembers: (orgId: string) => void;
  onBackToApp: () => void;
  /**
   * Called when the create form opens or closes from the `?new=1` intent, so
   * the shell can strip the flag from the address bar.
   */
  onCreateIntentHandled?: (open: boolean) => void;
}

export const ConsoleCompaniesPanel: React.FC<Props> = ({
  directory,
  selectedOrgId,
  onSelectOrg,
  onOpenMembers,
  onBackToApp,
  onCreateIntentHandled
}) => {
  const { organizations, isLoading, directoryError, reload } = directory;

  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'ALL' | 'active' | 'trial' | 'suspended' | 'expired'>('ALL');
  const [dbTypeFilter, setDbTypeFilter] = React.useState<'ALL' | 'cloud_shared' | 'dedicated_external'>('ALL');

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Organization | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Organization | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  // The shell's "Add Client Company" button is on every panel, so it arrives
  // here as a URL intent rather than shared state. Watches the flag rather than
  // running on mount, because the button is also on THIS panel — a mount-only
  // effect would make pressing it while already here do nothing.
  const createIntent = wantsConsoleCreate();
  React.useEffect(() => {
    if (!createIntent) return;
    setFormOpen(true);
    onCreateIntentHandled?.(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createIntent]);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return organizations.filter((org) => {
      const matchSearch =
        !q ||
        org.name.toLowerCase().includes(q) ||
        org.clientCode.toLowerCase().includes(q) ||
        org.slug.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'ALL' || org.status === statusFilter;
      const matchDb = dbTypeFilter === 'ALL' || org.databaseType === dbTypeFilter;
      return matchSearch && matchStatus && matchDb;
    });
  }, [organizations, search, statusFilter, dbTypeFilter]);

  const openEdit = (org: Organization) => {
    setEditing(org);
    setFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deleteOrganization(pendingDelete.id);
    setIsDeleting(false);
    if (!result.success) {
      toast.error(result.error || 'The company was not deleted.');
      return;
    }
    setPendingDelete(null);
    toast.success('Company deleted.');
    await reload();
  };

  /**
   * Hand the tenant to the client application.
   *
   * The previous version opened `/dashboard?tenant=<slug>`. That parameter was
   * read by nothing — the tenant reached the app only because `window.open`
   * shares `localStorage['geosphere360_active_org_id']`, which is a single
   * browser-wide key, so two clients open in two tabs silently overwrite each
   * other. The explicit key write is stated in the UI for that reason.
   *
   * The WebGIS host is staged here for the same reason BYOS storage is: the
   * client app reads it through `getActiveOrganizationWebgis()`, so it must be
   * written before `onBackToApp()` mounts. `null` for a company with no
   * override is deliberate — a stale URL from the previously activated company
   * would point this client's workspace at another tenant's map.
   */
  const openClientApp = (org: Organization) => {
    setActiveOrganizationId(org.id);
    setActiveOrganizationStorage(org.settings?.storage || null);
    setActiveOrganizationWebgis(org.settings?.webgisUrl || null);
    onSelectOrg(org.id);
    onBackToApp();
  };

  return (
    <div className="space-y-6">
      <PanelCard>
        <PanelHeader
          title="Client Companies"
          subtitle="Provision, edit and route every company on this installation."
        />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mt-5">
          <input
            type="text"
            placeholder="Search by name, client code or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search companies"
            style={{ borderRadius: '9999px', backgroundColor: '#f8fafc' }}
            className="console-search-input w-full lg:max-w-xs pl-4 pr-4 py-2 text-xs placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all border border-slate-200/80"
          />
          <span className="text-xs font-semibold text-slate-500">
            Showing <strong className="text-slate-900">{filtered.length}</strong> of {organizations.length} companies
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="text-xs font-bold text-slate-400 mr-1">Status:</span>
          {(['ALL', 'active', 'trial', 'suspended', 'expired'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              aria-pressed={statusFilter === st}
              className={`px-3.5 py-1 rounded-full text-xs font-semibold capitalize transition-all cursor-pointer ${
                statusFilter === st ? 'bg-[#0c0d0e] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
              aria-pressed={dbTypeFilter === dt}
              className={`px-3.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                dbTypeFilter === dt ? 'bg-[#0c0d0e] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {dt === 'ALL' ? 'All Databases' : dt === 'cloud_shared' ? 'Cloud Shared' : 'Dedicated'}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-100 mt-5">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b font-bold uppercase tracking-wider text-[10px]" style={{ backgroundColor: '#f8fafc' }}>
              <tr>
                <th className="px-6 py-3.5">Company</th>
                <th className="px-6 py-3.5">Client Code</th>
                <th className="px-6 py-3.5">Database Routing</th>
                <th className="px-6 py-3.5">License &amp; Expiry</th>
                <th className="px-6 py-3.5">Seats &amp; Storage</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <>
                  {[1, 2, 3, 4].map((i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-slate-200 shrink-0" />
                          <div className="space-y-1.5 flex-1">
                            <div className="h-3.5 w-32 bg-slate-200 rounded" />
                            <div className="h-2.5 w-40 bg-slate-100 rounded" />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4"><div className="h-3 w-16 bg-slate-200 rounded" /></td>
                      <td className="px-6 py-4"><div className="h-3.5 w-24 bg-slate-200 rounded" /></td>
                      <td className="px-6 py-4"><div className="h-5 w-20 bg-slate-200 rounded-full" /></td>
                      <td className="px-6 py-4"><div className="h-3 w-12 bg-slate-200 rounded" /></td>
                      <td className="px-6 py-4"><div className="h-5 w-16 bg-slate-200 rounded-full" /></td>
                      <td className="px-6 py-4 text-right"><div className="h-7 w-14 bg-slate-200 rounded-xl ml-auto" /></td>
                    </tr>
                  ))}
                </>
              ) : directoryError ? (
                <tr>
                  <td colSpan={7}>
                    <ReadFailure reason={directoryError} subject="company list" onRetry={() => void reload()} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    <Building2 size={24} className="mx-auto mb-2 text-slate-400" />
                    <div className="font-bold text-sm text-slate-800">
                      {search || statusFilter !== 'ALL' || dbTypeFilter !== 'ALL'
                        ? 'No companies match these filters'
                        : 'No client companies found'}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {search || statusFilter !== 'ALL' || dbTypeFilter !== 'ALL'
                        ? 'Clear the search or filters to see the full directory.'
                        : 'Use “Add Client Company” to provision your first live organization.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((org) => (
                  <tr
                    key={org.id}
                    className={`transition-colors ${org.id === selectedOrgId ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#0c0d0e] text-white flex items-center justify-center font-bold text-xs shrink-0">
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
                    <td className="px-6 py-4 font-mono font-semibold">{org.clientCode || '—'}</td>
                    <td className="px-6 py-4">
                      {org.databaseType === 'dedicated_external' ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            <Server size={13} className="text-slate-600" /> Dedicated External
                          </span>
                          {org.settings?.storage?.provider && org.settings.storage.provider !== 'supabase' ? (
                            <div>
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-200">
                                {org.settings.storage.provider.replace('_', ' ')} BYOS
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                            <Database size={13} className="text-slate-600" /> Cloud Shared RLS
                          </span>
                          {org.settings?.storage?.provider && org.settings.storage.provider !== 'supabase' ? (
                            <div>
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-200">
                                {org.settings.storage.provider.replace('_', ' ')} BYOS
                              </span>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-xs text-slate-800 capitalize">
                          {(org.licenseType || 'cloud_saas').replace('_', ' ')}
                        </div>
                        <div className="text-[11px]">
                          {org.licenseExpiresAt ? (
                            (() => {
                              const exp = getLicenseExpiryStatus(org.licenseExpiresAt);
                              return (
                                <span
                                  className={
                                    exp.tone === 'active'
                                      ? 'text-emerald-700 font-semibold'
                                      : exp.tone === 'warning'
                                      ? 'text-amber-700 font-semibold'
                                      : exp.tone === 'expired'
                                      ? 'text-rose-700 font-semibold'
                                      : 'text-slate-500'
                                  }
                                >
                                  {exp.label}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="text-slate-400 font-medium">Perpetual</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {/* `?? 0` rather than `|| 0` — same reason as the form. */}
                      <span className="font-bold text-slate-900">{org.settings?.allowedUserSeats ?? 0}</span> seats ·{' '}
                      <span className="font-bold text-slate-900">{org.settings?.storageQuotaGb ?? 0}</span> GB
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-bold ${STATUS_TONE[org.status]}`}>{STATUS_LABEL[org.status]}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openClientApp(org)}
                          title={`Open the client application as ${org.name}`}
                          className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[#0c0d0e] hover:bg-black text-white flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Eye size={12} />
                          <span>Open</span>
                          <ExternalLink size={10} className="opacity-70" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenMembers(org.id)}
                          title={`Manage team members for ${org.name}`}
                          className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <UsersIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(org)}
                          title={`Edit ${org.name}`}
                          className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(org)}
                          title={`Delete ${org.name}`}
                          className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
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
      </PanelCard>

      {formOpen ? (
        <OrganizationFormModal
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSaved={(message) => {
            setFormOpen(false);
            toast.success(message);
            void reload();
          }}
          onFailed={(message) => toast.error(message)}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this company?"
        body={`“${pendingDelete?.name ?? ''}” and its configuration will be removed. A company that still owns projects is refused by the database — reassign or archive them first. This does not delete any panorama or dataset.`}
        confirmLabel="Delete Company"
        destructive
        busy={isDeleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

/** Members shortcut, kept local so the table's action row reads consistently. */
const UsersIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export default ConsoleCompaniesPanel;