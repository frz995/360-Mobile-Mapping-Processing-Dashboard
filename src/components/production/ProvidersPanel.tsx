import React, { useState } from 'react';
import { HardDrive, Plus, Trash2, Save, ServerCog } from 'lucide-react';
import type { ExtendedProjectSettings } from '../../types/admin';
import { saveProjectSettingsToSupabase } from '../../services/supabase';
import type { ProductionProviderSettings } from '../../types/production';
import { productionNasUrlFor } from './common';

export interface ProvidersPanelProps {
  projectSettings: ExtendedProjectSettings;
  setProjectSettings: React.Dispatch<React.SetStateAction<ExtendedProjectSettings>>;
  translate: (key: string) => string;
  isGuestUser?: boolean;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
}

const INPUT_CLASS =
  'w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60 placeholder:text-text-muted';

const EMPTY_PROVIDER: ProductionProviderSettings = {
  name: '',
  software: '',
  version: '',
  enabled: true
};

export const ProvidersPanel: React.FC<ProvidersPanelProps> = ({
  projectSettings,
  setProjectSettings,
  isGuestUser,
  onAddNotification,
  onAddAuditLog,
  userLabel
}) => {
  const providers: ProductionProviderSettings[] = projectSettings?.productionProviders || [];
  const [draft, setDraft] = useState<ProductionProviderSettings>(EMPTY_PROVIDER);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const setApi = (patch: Partial<ExtendedProjectSettings>) =>
    setProjectSettings((prev: ExtendedProjectSettings) => ({ ...(prev || {}), ...patch }));

  const saveAll = async () => {
    if (isGuestUser || saving) return;
    setSaving(true);
    const ok = await saveProjectSettingsToSupabase(projectSettings);
    if (ok) {
      onAddNotification?.({ title: 'Production Settings Saved', message: 'Provider + worker configuration persisted.', category: 'SYSTEM', read: false });
      onAddAuditLog?.('EDIT', 'Production Settings Updated', `${userLabel} updated worker/API/provider configuration.`, 'success');
    } else {
      onAddNotification?.({ title: 'Save Failed', message: 'Could not persist production settings.', category: 'ERROR', read: false });
    }
    setSaving(false);
  };

  const upsertProvider = () => {
    if (isGuestUser || !editing) return;
    const next = [...providers];
    const idx = next.findIndex((p) => p.name === draft.name && p.software === draft.software);
    if (idx >= 0) next[idx] = { ...draft };
    else next.push({ ...draft });
    setApi({ productionProviders: next });
    setDraft(EMPTY_PROVIDER);
    setEditing(false);
  };

  const removeProvider = (name: string, software: string) => {
    if (isGuestUser) return;
    setApi({
      productionProviders: providers.filter((p) => !(p.name === name && p.software === software))
    });
  };

  const toggleProvider = (name: string, software: string, enabled: boolean) => {
    if (isGuestUser) return;
    setApi({
      productionProviders: providers.map((p) =>
        p.name === name && p.software === software ? { ...p, enabled } : p
      )
    });
  };

  const nasPreview = productionNasUrlFor(projectSettings, 'stitchblur', 'N93E70-00001.jpg');

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
            <HardDrive size={20} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-base tracking-wide">Providers &amp; Worker</h2>
            <span className="text-[11px] text-text-muted">External PC software registry + NAS GPU Worker connectivity</span>
          </div>
        </div>
        {!isGuestUser && (
          <div className="flex items-center gap-2">
            <button onClick={saveAll} disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 active:bg-emerald-500/35 border border-emerald-500/40 text-emerald-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
              <Save size={13} /> {saving ? 'Saving…' : 'Save Settings'}
            </button>
            <button onClick={() => { setDraft(EMPTY_PROVIDER); setEditing(true); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-sky-500/15 hover:bg-sky-500/25 active:bg-sky-500/35 border border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
              <Plus size={13} /> Add Provider
            </button>
          </div>
        )}
      </div>

      {editing && !isGuestUser && (
        <div className="bg-card border border-subtle rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3 animate-in fade-in zoom-in-98 duration-150">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Provider Name</label>
            <input className={INPUT_CLASS} placeholder="e.g. Local PC / NAS GPU Worker"
              value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Software</label>
            <input className={INPUT_CLASS} placeholder="stitch/blur tool"
              value={draft.software} onChange={(e) => setDraft({ ...draft, software: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Version</label>
            <input className={INPUT_CLASS} placeholder="v2.3"
              value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} />
          </div>
          <div className="flex items-end">
            <button onClick={upsertProvider}
              className="w-full px-3 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
              Save Provider
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-subtle rounded-xl p-4">
          <h3 className="text-xs font-bold text-text-base mb-3 flex items-center gap-2">
            <ServerCog size={14} className="text-sky-400" /> Registered Providers
          </h3>
          {providers.length === 0 && (
            <p className="text-[11px] text-text-muted italic">No providers registered. External PC software used by this project appears here.</p>
          )}
          <div className="flex flex-col gap-2">
            {providers.map((p) => (
              <div key={`${p.name}-${p.software}`} className="flex items-center justify-between gap-2 bg-inner border border-subtle rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-text-base truncate">{p.name}</div>
                  <div className="text-[10px] text-text-muted">{p.software} {p.version && `· v${p.version}`}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleProvider(p.name, p.software, !p.enabled)}
                    disabled={isGuestUser}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                      p.enabled
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-500/15 text-slate-400 border-slate-600/50'
                    } ${isGuestUser ? 'opacity-60' : ''}`}
                  >
                    {p.enabled ? 'ENABLED' : 'DISABLED'}
                  </button>
                  {!isGuestUser && (
                    <button onClick={() => removeProvider(p.name, p.software)}
                      className="p-1 rounded-md border border-subtle hover:bg-red-500/20 hover:border-red-500/40 text-red-400 transition-colors cursor-pointer">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-subtle rounded-xl p-4">
          <h3 className="text-xs font-bold text-text-base mb-3 flex items-center gap-2">
            <HardDrive size={14} className="text-sky-400" /> NAS GPU Worker
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">API Mode</label>
              <select className={INPUT_CLASS} value={projectSettings?.productionApiMode || 'mock'} disabled={isGuestUser}
                onChange={(e) => setApi({ productionApiMode: e.target.value as any })}>
                <option value="mock">mock (simulated, dev)</option>
                <option value="http">http (NAS GPU Worker)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Worker URL</label>
              <input className={INPUT_CLASS} placeholder="http://192.168.1.110:8000" disabled={isGuestUser}
                value={projectSettings?.productionApiUrl || ''}
                onChange={(e) => setApi({ productionApiUrl: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Batch Concurrency</label>
              <input type="number" min={1} max={16} className={INPUT_CLASS} disabled={isGuestUser}
                value={projectSettings?.productionConcurrency || 1}
                onChange={(e) => setApi({ productionConcurrency: Number(e.target.value) || 1 })} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">NAS Working Base Path</label>
              <input className={INPUT_CLASS} placeholder="//nas/360_images" disabled={isGuestUser}
                value={projectSettings?.nasWorkBasePath || ''}
                onChange={(e) => setApi({ nasWorkBasePath: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">Preview URL (resolved)</label>
              <div className="text-[10px] font-mono text-sky-300/80 bg-inner border border-subtle rounded-lg px-3 py-2 break-all">
                {nasPreview || 'Set nasServerUrl in project settings to enable previews.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};