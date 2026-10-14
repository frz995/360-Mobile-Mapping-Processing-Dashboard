/**
 * Create / edit a client company.
 *
 * WHAT WAS ADDED AND WHY
 *   * **Status.** `createOrganization` hardcoded `status: 'active'` and the edit
 *     form never sent `patch.status`, so the `trial` and `suspended` filters on
 *     the directory could only ever match a row somebody had changed by hand in
 *     the database. `OrganizationStatus` also includes `'expired'`, which had no
 *     badge and no filter — such a row rendered a blank status cell, which reads
 *     as "nothing to report" rather than "this company is off".
 *
 *   * **Confirm dialog.** Delete moved off `window.confirm`.
 */

import React from 'react';
import { Building2, Database, Server, Sliders, Activity, Check, ShieldAlert } from 'lucide-react';
import {
  createOrganization,
  updateOrganization,
  testDedicatedDatabaseConnection,
  type Organization,
  type OrganizationDraft,
  type OrganizationStatus
} from '../../../services/tenantContext';
import { ModalShell, Field, inputClass } from './consoleUi';

export const ORG_STATUSES: OrganizationStatus[] = ['active', 'trial', 'suspended', 'expired'];

const EMPTY_SETTINGS = {
  allowedUserSeats: 10,
  storageQuotaGb: 200,
  contactEmail: '',
  nasApiUrl: ''
};

function draftFrom(org: Organization | null): OrganizationDraft {
  if (!org) {
    return {
      name: '',
      clientCode: '',
      logoUrl: '',
      databaseType: 'cloud_shared',
      databaseConfig: { url: '', anonKey: '' },
      settings: { ...EMPTY_SETTINGS }
    };
  }
  return {
    name: org.name,
    clientCode: org.clientCode,
    logoUrl: org.logoUrl || '',
    databaseType: org.databaseType,
    databaseConfig: org.databaseConfig || { url: '', anonKey: '' },
    settings: {
      // `?? 10` rather than `|| 10`: a company explicitly set to zero seats is
      // a real configuration and must not be silently rewritten to the default.
      allowedUserSeats: org.settings?.allowedUserSeats ?? 10,
      storageQuotaGb: org.settings?.storageQuotaGb ?? 200,
      contactEmail: org.settings?.contactEmail || '',
      nasApiUrl: org.settings?.nasApiUrl || ''
    }
  };
}

interface Props {
  editing: Organization | null;
  /** Pre-selected status when creating. Defaults to `active`. */
  initialStatus?: OrganizationStatus;
  onClose: () => void;
  onSaved: (message: string) => void;
  onFailed: (message: string) => void;
}

export const OrganizationFormModal: React.FC<Props> = ({
  editing,
  initialStatus = 'active',
  onClose,
  onSaved,
  onFailed
}) => {
  const [formData, setFormData] = React.useState<OrganizationDraft>(() => draftFrom(editing));
  const [status, setStatus] = React.useState<OrganizationStatus>(editing?.status ?? initialStatus);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isTestingDb, setIsTestingDb] = React.useState(false);
  const [dbTestResult, setDbTestResult] = React.useState<{ success: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (!formData.name.trim() || !formData.clientCode.trim()) return;

    setIsSaving(true);

    // The modal closes only on a confirmed write. Previously every result was
    // discarded, so a rejected insert looked identical to a saved company.
    const result = editing
      ? await updateOrganization(editing.id, {
          name: formData.name,
          clientCode: formData.clientCode,
          logoUrl: formData.logoUrl,
          databaseType: formData.databaseType,
          databaseConfig: formData.databaseConfig,
          status,
          settings: formData.settings
        })
      : await createOrganization(formData);

    setIsSaving(false);

    if (!result.success) {
      onFailed(result.error || 'The company was not saved.');
      return;
    }
    onSaved(editing ? 'Company updated.' : 'Company created.');
  };

  const handleTestConnection = async () => {
    if (!formData.databaseConfig?.url || !formData.databaseConfig?.anonKey) {
      setDbTestResult({ success: false, message: 'Enter both the URL and the key.' });
      return;
    }
    setIsTestingDb(true);
    setDbTestResult(null);
    // The test genuinely performs the read. It is not a stamp.
    const result = await testDedicatedDatabaseConnection(
      formData.databaseConfig.url,
      formData.databaseConfig.anonKey
    );
    setDbTestResult(result);
    setIsTestingDb(false);
  };

  return (
    <ModalShell
      title={editing ? `Edit Client: ${editing.name}` : 'Register New Client Company'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-slate-800">
        <Field label="Company Name" required>
          <input
            type="text"
            required
            placeholder="e.g. Tenaga Nasional Berhad"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Client Code" required>
            <input
              type="text"
              required
              placeholder="e.g. TNB-LV-2026"
              value={formData.clientCode}
              onChange={(e) => setFormData({ ...formData, clientCode: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Contact Email">
            <input
              type="email"
              placeholder="admin@client.com"
              value={formData.settings?.contactEmail || ''}
              onChange={(e) => setFormData({ ...formData, settings: { ...formData.settings, contactEmail: e.target.value } })}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Status">
          <div className="flex flex-wrap gap-2">
            {ORG_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize transition-all cursor-pointer ${
                  status === s ? 'bg-[#0c0d0e] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>

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
              <span className="font-bold flex items-center gap-1.5 text-slate-900">
                <Database size={13} /> Cloud Shared (RLS)
              </span>
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
              <span className="font-bold flex items-center gap-1.5 text-slate-900">
                <Server size={13} /> Dedicated Client DB
              </span>
              <span className="text-[11px] leading-tight text-slate-500">
                Self-hosted external Supabase / on-premises LAN database.
              </span>
            </label>
          </div>
        </div>

        {formData.databaseType === 'dedicated_external' ? (
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Sliders size={13} /> Dedicated Supabase Credentials
            </div>
            <Field label="Client Supabase URL">
              <input
                type="url"
                placeholder="https://client-project.supabase.co"
                value={formData.databaseConfig?.url || ''}
                onChange={(e) =>
                  setFormData({ ...formData, databaseConfig: { ...formData.databaseConfig, url: e.target.value } })
                }
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label="Client Anon / Service Key">
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
                className={`${inputClass} font-mono`}
              />
            </Field>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingDb}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <Activity size={12} className={isTestingDb ? 'animate-spin' : ''} />
                <span>{isTestingDb ? 'Testing Connection…' : 'Test Connection'}</span>
              </button>
              {dbTestResult ? (
                <span
                  className={`text-xs flex items-center gap-1 font-semibold ${
                    dbTestResult.success ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {dbTestResult.success ? <Check size={13} /> : <ShieldAlert size={13} />}
                  {dbTestResult.message}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
          <Field label="Licensed Seats">
            <input
              type="number"
              min="0"
              max="1000"
              value={formData.settings?.allowedUserSeats ?? 10}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  settings: { ...formData.settings, allowedUserSeats: Number(e.target.value) || 0 }
                })
              }
              className={inputClass}
            />
          </Field>
          <Field label="Storage Quota (GB)">
            <input
              type="number"
              min="0"
              max="100000"
              value={formData.settings?.storageQuotaGb ?? 200}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  settings: { ...formData.settings, storageQuotaGb: Number(e.target.value) || 0 }
                })
              }
              className={inputClass}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
            <Building2 size={12} />
            {editing ? 'Editing an existing company' : 'Creates a company that cannot be used until staff are invited'}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              style={{ backgroundColor: '#121316', borderRadius: '12px' }}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white hover:bg-black transition-colors cursor-pointer disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : editing ? 'Save Changes' : 'Create Organization'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
};

export default OrganizationFormModal;