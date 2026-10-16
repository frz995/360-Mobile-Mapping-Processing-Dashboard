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
import { fetchR2BucketUsage } from '../../../services/tenantStorage';

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
    region: '',
    imageStorageStrategy: 'multires_tiles' as const
  }
};

export const STORAGE_PROVIDERS = [
  { key: 'supabase', label: 'Supabase Platform Storage (Default Shared)' },
  { key: 'supabase_self_hosted', label: 'Self-Hosted Supabase Storage (Local / Docker / On-Premise)' },
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
      webgisUrl: org.settings?.webgisUrl || '',
      nasApiUrl: org.settings?.nasApiUrl || '',
      storage: {
        provider: 'supabase',
        bucketName: '',
        cdnUrl: '',
        region: '',
        imageStorageStrategy: 'multires_tiles',
        ...org.settings?.storage
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
  const [isSyncingR2, setIsSyncingR2] = React.useState(false);
  const [r2SyncResult, setR2SyncResult] = React.useState<{ success: boolean; message: string } | null>(null);

  const handleSyncR2 = async () => {
    const storage = formData.settings?.storage;
    if (!storage?.accountId || !storage?.bucketName || !storage?.readMetricsToken) {
      setR2SyncResult({
        success: false,
        message: 'Please provide Account ID, Bucket Name, and Read-Only Metrics Token.'
      });
      return;
    }
    setIsSyncingR2(true);
    setR2SyncResult(null);
    try {
      const res = await fetchR2BucketUsage(storage.accountId, storage.bucketName, storage.readMetricsToken);
      if (res.success) {
        setFormData((prev) => ({
          ...prev,
          settings: {
            ...prev.settings,
            storage: {
              ...prev.settings?.storage,
              byosConsumedBytes: res.storageSizeBytes,
              byosObjectCount: res.objectCount,
              byosLastCheckedAt: new Date().toISOString()
            }
          }
        }));
        const sizeGb = (res.storageSizeBytes / (1024 * 1024 * 1024)).toFixed(2);
        setR2SyncResult({
          success: true,
          message: `Synced: ${sizeGb} GB (${res.objectCount.toLocaleString()} files)`
        });
      } else {
        setR2SyncResult({
          success: false,
          message: res.error || 'Failed to sync R2 usage'
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setR2SyncResult({
        success: false,
        message: errMsg || 'Error querying Cloudflare R2'
      });
    } finally {
      setIsSyncingR2(false);
    }
  };

  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (formRef.current) {
      formRef.current.scrollTop = 0;
    }
  }, [editing]);

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
      <form ref={formRef} onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto text-slate-800">
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
                style={{ colorScheme: 'light' }}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                style={{ colorScheme: 'light' }}
              >
                {STORAGE_PROVIDERS.map((sp) => (
                  <option key={sp.key} value={sp.key}>
                    {sp.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="360° Storage & Slicing Strategy">
              <select
                value={formData.settings?.storage?.imageStorageStrategy || 'multires_tiles'}
                onChange={(e) => {
                  const strategy = e.target.value as 'multires_tiles' | 'single_equirectangular';
                  setFormData({
                    ...formData,
                    settings: {
                      ...formData.settings,
                      storage: {
                        ...formData.settings?.storage,
                        imageStorageStrategy: strategy
                      }
                    }
                  });
                }}
                className={inputClass}
                style={{ colorScheme: 'light' }}
              >
                <option value="multires_tiles">Multi-Resolution Tile Pyramid (Deep Zoom 60FPS / Zero Blur)</option>
                <option value="single_equirectangular">Single Equirectangular Full Image (Standard)</option>
              </select>
            </Field>
          </div>

          {formData.settings?.storage?.provider && formData.settings.storage.provider !== 'supabase' ? (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="text-[11px] font-bold text-slate-900">
                {formData.settings.storage.provider === 'supabase_self_hosted'
                  ? 'Self-Hosted Supabase Storage Configuration'
                  : 'Dynamic External Bucket Parameters (BYOS)'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Bucket Name">
                  <input
                    type="text"
                    placeholder={formData.settings.storage.provider === 'supabase_self_hosted' ? 'e.g. MMS_PIC or panoramas' : 'e.g. tnb-panoramas-2026'}
                    value={formData.settings?.storage?.bucketName || ''}
                    onChange={(e) => setFormData({ ...formData, settings: { ...formData.settings, storage: { ...formData.settings?.storage, bucketName: e.target.value } } })}
                    className={`${inputClass} font-mono`}
                  />
                </Field>
                <Field label={formData.settings.storage.provider === 'supabase_self_hosted' ? 'Self-Hosted Storage / API URL' : 'Public CDN / Base URL'}>
                  <input
                    type="url"
                    placeholder={formData.settings.storage.provider === 'supabase_self_hosted' ? 'http://localhost:8000 or http://192.168.1.100:8000' : 'https://pub-xxxxxx.r2.dev or https://cdn.client.com'}
                    value={formData.settings?.storage?.cdnUrl || ''}
                    onChange={(e) => setFormData({ ...formData, settings: { ...formData.settings, storage: { ...formData.settings?.storage, cdnUrl: e.target.value } } })}
                    className={`${inputClass} font-mono`}
                  />
                </Field>
              </div>

              {formData.settings.storage.provider !== 'supabase_self_hosted' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-200/60">
                    <Field label="Contracted BYOS Quota (GB)">
                      <input
                        type="number"
                        min="1"
                        placeholder="e.g. 500, 1000, 5000"
                        value={formData.settings?.storage?.byosQuotaGb ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : undefined;
                          setFormData({
                            ...formData,
                            settings: {
                              ...formData.settings,
                              storage: { ...formData.settings?.storage, byosQuotaGb: val }
                            }
                          });
                        }}
                        className={inputClass}
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Client contract limit. Triggers capacity warnings at 80% and 90%.
                      </p>
                    </Field>

                    <Field label="Tracked Consumed BYOS Size (GB)">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="e.g. 67.5"
                        value={
                          formData.settings?.storage?.byosConsumedBytes != null
                            ? Number((formData.settings.storage.byosConsumedBytes / (1024 ** 3)).toFixed(2))
                            : ''
                        }
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : undefined;
                          setFormData({
                            ...formData,
                            settings: {
                              ...formData.settings,
                              storage: {
                                ...formData.settings?.storage,
                                byosConsumedBytes: val != null ? Math.round(val * 1024 * 1024 * 1024) : undefined,
                                byosLastCheckedAt: new Date().toISOString()
                              }
                            }
                          });
                        }}
                        className={inputClass}
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Manual override or synced from Cloudflare metrics.
                      </p>
                    </Field>
                  </div>

                  {formData.settings.storage.provider === 'cloudflare_r2' ? (
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200 space-y-2.5">
                      <div className="text-[11px] font-bold text-slate-900 flex items-center justify-between">
                        <span>Cloudflare R2 Live Metrics Sync (Option 1)</span>
                        {formData.settings?.storage?.byosLastCheckedAt ? (
                          <span className="text-[10px] text-slate-400 font-normal">
                            Checked {new Date(formData.settings.storage.byosLastCheckedAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                            Cloudflare Account ID
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. d2a8b9f1... (from R2 dashboard)"
                            value={formData.settings?.storage?.accountId || ''}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                settings: {
                                  ...formData.settings,
                                  storage: { ...formData.settings?.storage, accountId: e.target.value }
                                }
                              })
                            }
                            className={`${inputClass} text-[11px] font-mono`}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-600 mb-0.5">
                            Read-Only Metrics API Token
                          </label>
                          <input
                            type="password"
                            placeholder="Token with R2:Read permission"
                            value={formData.settings?.storage?.readMetricsToken || ''}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                settings: {
                                  ...formData.settings,
                                  storage: { ...formData.settings?.storage, readMetricsToken: e.target.value }
                                }
                              })
                            }
                            className={`${inputClass} text-[11px] font-mono`}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-[10px] text-slate-400">
                          Calls Cloudflare R2 bucket usage endpoint without Class A file listing costs.
                        </span>
                        <button
                          type="button"
                          disabled={isSyncingR2}
                          onClick={handleSyncR2}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0c0d0e] hover:bg-black text-white transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          {isSyncingR2 ? 'Querying R2…' : 'Sync R2 Usage'}
                        </button>
                      </div>
                      {r2SyncResult ? (
                        <div
                          className={`text-[11px] p-2 rounded-lg ${
                            r2SyncResult.success
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {r2SyncResult.message}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              <p className="text-[10px] text-slate-600 leading-relaxed">
                {formData.settings.storage.provider === 'supabase_self_hosted'
                  ? 'Connects to a dedicated/on-premise Supabase Storage API endpoint. If URL is left empty, the company’s dedicated database URL is automatically inherited.'
                  : 'Images served from this dynamic bucket bypass parent Supabase storage quota. Base URL overrides default storage for viewer tiles and panoramas. Ensure objects follow the standard subgrid/tile structure.'}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              Uses the parent Supabase Storage instance (`MMS_PIC`, `panoramas`). Subject to platform storage limits. Ensure object keys follow <code className="text-slate-600 font-mono text-[10px]">orgs/&#123;company_id&#125;/...</code> so inventory metrics and storage quotas attribute correctly.
            </p>
          )}
        </div>

        <div className="pt-2 border-t border-slate-100">
          <Field label="External WebGIS & Portal URL">
            <input
              type="url"
              placeholder="https://map.geosphere.my"
              value={formData.settings?.webgisUrl || ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  settings: { ...formData.settings, webgisUrl: e.target.value }
                })
              }
              className={`${inputClass} font-mono`}
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Base URL for the 360 WebGIS map. Leave empty to default to <code className="font-mono text-slate-600">https://map.geosphere.my</code>.
            </p>
          </Field>
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