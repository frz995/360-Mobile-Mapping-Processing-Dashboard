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
  type OrganizationStatus,
  type LicenseType
} from '../../../services/tenantContext';
import { ModalShell, Field, inputClass } from './consoleUi';

export const LICENSE_TYPES: { key: LicenseType; label: string }[] = [
  { key: 'cloud_saas', label: 'Cloud SaaS' },
  { key: 'enterprise_dedicated', label: 'Enterprise Dedicated (Self-Hosted)' },
  { key: 'trial', label: 'Trial / Pilot' },
  { key: 'perpetual', label: 'Perpetual License' }
];

export const ORG_STATUSES: OrganizationStatus[] = ['active', 'trial', 'suspended', 'expired'];

const EMPTY_SETTINGS = {
  allowedUserSeats: 10,
  storageQuotaGb: 200,
  contactEmail: '',
  nasApiUrl: '',
  storage: {
    provider: 'supabase' as const,
    bucketName: '',
    cdnUrl: '',
    region: ''
  }
};

export const STORAGE_PROVIDERS = [
  { key: 'supabase', label: 'Supabase Platform Storage (Default Shared)' },
  { key: 'cloudflare_r2', label: 'Cloudflare R2 (Recommended BYOS - Zero Egress Fees)' },
  { key: 'aws_s3', label: 'Amazon S3' },
  { key: 'wasabi', label: 'Wasabi Hot Cloud Storage' },
  { key: 'gcs', label: 'Google Cloud Storage' },
  { key: 'nas_local', label: 'On-Premises NAS / Local Storage' },
  { key: 'custom_cdn', label: 'Custom Object CDN' }
] as const;

function draftFrom(org: Organization | null): OrganizationDraft {
  if (!org) {
    return {
      name: '',
      clientCode: '',
      logoUrl: '',
      databaseType: 'cloud_shared',
      licenseType: 'cloud_saas',
      licenseExpiresAt: null,
      databaseConfig: { url: '', anonKey: '' },
      settings: { ...EMPTY_SETTINGS }
    };
  }
  return {
    name: org.name,
    clientCode: org.clientCode,
    logoUrl: org.logoUrl || '',
    databaseType: org.databaseType,
    licenseType: org.licenseType || (org.databaseType === 'dedicated_external' ? 'enterprise_dedicated' : 'cloud_saas'),
    licenseExpiresAt: org.licenseExpiresAt || null,
    databaseConfig: org.databaseConfig || { url: '', anonKey: '' },
    settings: {
      // `?? 10` rather than `|| 10`: a company explicitly set to zero seats is
      // a real configuration and must not be silently rewritten to the default.
      allowedUserSeats: org.settings?.allowedUserSeats ?? 10,
      storageQuotaGb: org.settings?.storageQuotaGb ?? 200,
      contactEmail: org.settings?.contactEmail || '',
      nasApiUrl: org.settings?.nasApiUrl || '',
      storage: org.settings?.storage || {
        provider: 'supabase',
        bucketName: '',
        cdnUrl: '',
        region: ''
      }
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
          licenseType: formData.licenseType,
          licenseExpiresAt: formData.licenseExpiresAt,
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
            <Field label="Client Anon Key">
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

        {/* Commercial Licensing & Expiration */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <label className="block text-xs font-bold text-slate-700">Commercial Licensing & Expiry</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="License Model">
              <select
                value={formData.licenseType || 'cloud_saas'}
                onChange={(e) => setFormData({ ...formData, licenseType: e.target.value as LicenseType })}
                className={inputClass}
              >
                {LICENSE_TYPES.map((lt) => (
                  <option key={lt.key} value={lt.key}>
                    {lt.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="License Expiry Date">
              <div className="space-y-1">
                <input
                  type="date"
                  value={formData.licenseExpiresAt ? formData.licenseExpiresAt.split('T')[0] : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormData({
                      ...formData,
                      licenseExpiresAt: val ? `${val}T23:59:59Z` : null
                    });
                  }}
                  className={inputClass}
                />
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{formData.licenseExpiresAt ? 'Expiry active' : 'Empty = Perpetual'}</span>
                  {formData.licenseExpiresAt ? (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, licenseExpiresAt: null })}
                      className="text-xs text-rose-600 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </Field>
          </div>
        </div>

        {/* Dynamic Bucket & 360 Image Storage */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <label className="block text-xs font-bold text-slate-700">360 Image Storage & Dynamic Bucket Hosting</label>
          <Field label="Storage Provider">
            <select
              value={formData.settings?.storage?.provider || 'supabase'}
              onChange={(e) => {
                const prov = e.target.value as any;
                setFormData({
                  ...formData,
                  settings: {
                    ...formData.settings,
                    storage: {
                      ...formData.settings?.storage,
                      provider: prov
                    }
                  }
                });
              }}
              className={inputClass}
            >
              {STORAGE_PROVIDERS.map((sp) => (
                <option key={sp.key} value={sp.key}>
                  {sp.label}
                </option>
              ))}
            </select>
          </Field>

          {formData.settings?.storage?.provider && formData.settings.storage.provider !== 'supabase' ? (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="text-[11px] font-bold text-slate-900">
                Dynamic External Bucket Parameters (BYOS)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Bucket Name">
                  <input
                    type="text"
                    placeholder="e.g. tnb-panoramas-2026"
                    value={formData.settings?.storage?.bucketName || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        settings: {
                          ...formData.settings,
                          storage: {
                            ...formData.settings?.storage,
                            bucketName: e.target.value
                          }
                        }
                      })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </Field>
                <Field label="Public CDN / Base URL">
                  <input
                    type="url"
                    placeholder="https://pub-xxxxxx.r2.dev or https://cdn.client.com"
                    value={formData.settings?.storage?.cdnUrl || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        settings: {
                          ...formData.settings,
                          storage: {
                            ...formData.settings?.storage,
                            cdnUrl: e.target.value
                          }
                        }
                      })
                    }
                    className={`${inputClass} font-mono`}
                  />
                </Field>
              </div>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Images served from this dynamic bucket bypass parent Supabase storage quota. Base URL overrides default storage for viewer tiles and panoramas. Ensure objects follow the standard subgrid/tile structure.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              Uses the parent Supabase Storage instance (`MMS_PIC`, `panoramas`). Subject to platform storage limits. Ensure object keys follow <code className="text-slate-600 font-mono text-[10px]">orgs/&#123;company_id&#125;/...</code> so inventory metrics and storage quotas attribute correctly.
            </p>
          )}
        </div>

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