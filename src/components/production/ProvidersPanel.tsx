import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  ServerCog,
  Cpu,
  Monitor,
  Layers,
  EyeOff,
  SlidersHorizontal,
  Wand2,
  Info,
  Check
} from 'lucide-react';
import type { ExtendedProjectSettings } from '../../types/admin';
import { saveProjectSettingsToSupabase } from '../../services/supabase';
import type {
  ProductionProviderSettings,
  WorkstationStationConfig
} from '../../types/production';
import { DEFAULT_4_WORKSTATIONS } from '../../types/production';

export interface ProvidersPanelProps {
  projectSettings: ExtendedProjectSettings;
  setProjectSettings: React.Dispatch<React.SetStateAction<ExtendedProjectSettings>>;
  translate: (key: string) => string;
  isGuestUser?: boolean;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
}

const STATION_ICONS: Record<string, any> = {
  stitch: Layers,
  blur: EyeOff,
  lightroom: SlidersHorizontal,
  photoshop: Wand2
};

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
  const engineMode = projectSettings?.processingEngineMode || 'multi_pc_workstations';
  const workstations: WorkstationStationConfig[] =
    (projectSettings?.workstationsConfig as WorkstationStationConfig[]) || DEFAULT_4_WORKSTATIONS;

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
      onAddNotification?.({
        title: 'Production Settings Saved',
        message: 'Engine mode + workstation configuration persisted.',
        category: 'SYSTEM',
        read: false
      });
      onAddAuditLog?.(
        'EDIT',
        'Production Settings Updated',
        `${userLabel} updated engine mode (${engineMode}) and workstation configuration.`,
        'success'
      );
    } else {
      onAddNotification?.({
        title: 'Save Failed',
        message: 'Could not persist production settings.',
        category: 'ERROR',
        read: false
      });
    }
    setSaving(false);
  };

  const handleStationChange = (index: number, patch: Partial<WorkstationStationConfig>) => {
    if (isGuestUser) return;
    const next = [...workstations];
    next[index] = { ...next[index], ...patch };
    setApi({ workstationsConfig: next });
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

  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Top Header & Save Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-1">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-inner text-text-base rounded-xl border border-subtle shrink-0">
            <Monitor size={20} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-base tracking-wide">
              Processing Engine &amp; Workstations
            </h2>
            <p className="text-[11px] text-text-muted mt-0.5">
              Select primary execution model and configure workstation directory routing
            </p>
          </div>
        </div>

        {!isGuestUser && (
          <button
            onClick={saveAll}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            <Save size={14} />
            <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        )}
      </div>

      {/* Symmetrical Dual-Engine Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Mode 1: 4-PC Workstations */}
        <div
          onClick={() => !isGuestUser && setApi({ processingEngineMode: 'multi_pc_workstations' })}
          className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
            engineMode === 'multi_pc_workstations'
              ? 'bg-inner/90 border-sky-500/60 shadow-sm ring-1 ring-sky-500/30'
              : 'bg-card border-subtle hover:border-subtle/90 opacity-70 hover:opacity-100'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg border ${
                engineMode === 'multi_pc_workstations'
                  ? 'bg-card text-sky-400 border-sky-500/40'
                  : 'bg-inner text-text-muted border-subtle'
              }`}>
                <Monitor size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-text-base">4-Station Multi-PC Workflow</h3>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                    engineMode === 'multi_pc_workstations'
                      ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                      : 'bg-inner text-text-muted border-subtle'
                  }`}>
                    {engineMode === 'multi_pc_workstations' ? 'Active Mode' : 'Standby'}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted mt-1">
                  Sequential desktop handoff across Stitching, Privacy Blur, Lightroom, and Photoshop PCs
                </p>
              </div>
            </div>
            <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
              engineMode === 'multi_pc_workstations' ? 'border-sky-400 bg-sky-500 text-slate-950' : 'border-subtle bg-inner'
            }`}>
              {engineMode === 'multi_pc_workstations' && <Check size={10} className="stroke-[3]" />}
            </div>
          </div>
        </div>

        {/* Mode 2: GPU Worker */}
        <div
          onClick={() => !isGuestUser && setApi({ processingEngineMode: 'gpu_worker' })}
          className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
            engineMode === 'gpu_worker'
              ? 'bg-inner/90 border-sky-500/60 shadow-sm ring-1 ring-sky-500/30'
              : 'bg-card border-subtle hover:border-subtle/90 opacity-70 hover:opacity-100'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg border ${
                engineMode === 'gpu_worker'
                  ? 'bg-card text-sky-400 border-sky-500/40'
                  : 'bg-inner text-text-muted border-subtle'
              }`}>
                <Cpu size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-text-base">Automated NAS GPU Worker</h3>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border uppercase ${
                    engineMode === 'gpu_worker'
                      ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                      : 'bg-inner text-text-muted border-subtle'
                  }`}>
                    {engineMode === 'gpu_worker' ? 'Active Mode' : 'Standby'}
                  </span>
                </div>
                <p className="text-[11px] text-text-muted mt-1">
                  Automated headless execution via background FastAPI daemon + PyTorch CUDA worker
                </p>
              </div>
            </div>
            <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
              engineMode === 'gpu_worker' ? 'border-sky-400 bg-sky-500 text-slate-950' : 'border-subtle bg-inner'
            }`}>
              {engineMode === 'gpu_worker' && <Check size={10} className="stroke-[3]" />}
            </div>
          </div>
        </div>
      </div>

      {/* Mode-Specific Settings View */}
      {engineMode === 'multi_pc_workstations' ? (
        /* 4-Workstations Profile Configuration */
        <div className="space-y-3">
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-text-base">
              <Layers size={15} className="text-sky-400" />
              <h3 className="text-xs font-bold">4-Station Workstation Directory &amp; Software Setup</h3>
            </div>
            <span className="text-[11px] text-text-muted">4 dedicated stations active</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {workstations.map((ws, idx) => {
              const IconComponent = STATION_ICONS[ws.id] || Layers;

              return (
                <div
                  key={ws.id}
                  className="bg-inner/60 border border-subtle rounded-xl p-4 space-y-3.5 hover:border-subtle transition-all shadow-sm"
                >
                  <div className="flex items-center justify-between border-b border-subtle pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-md border border-subtle bg-card text-text-muted">
                        <IconComponent size={13} />
                      </div>
                      <input
                        type="text"
                        disabled={isGuestUser}
                        value={ws.name}
                        onChange={(e) => handleStationChange(idx, { name: e.target.value })}
                        className="bg-transparent font-bold text-xs text-text-base focus:outline-none border-b border-transparent focus:border-sky-500/40 w-48 truncate"
                      />
                    </div>
                    <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded bg-card text-text-muted border border-subtle">
                      STEP {ws.stepNumber}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
                        Primary Software
                      </label>
                      <input
                        className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base outline-none focus:border-sky-500/60 transition-colors"
                        disabled={isGuestUser}
                        value={ws.software}
                        onChange={(e) => handleStationChange(idx, { software: e.target.value })}
                        placeholder="e.g. PTGui / Photoshop"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
                        Default Operator
                      </label>
                      <input
                        className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base outline-none focus:border-sky-500/60 transition-colors"
                        disabled={isGuestUser}
                        value={ws.defaultOperator}
                        onChange={(e) => handleStationChange(idx, { defaultOperator: e.target.value })}
                        placeholder="e.g. Operator"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
                        NAS Input Folder
                      </label>
                      <input
                        className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs font-mono text-text-base outline-none focus:border-sky-500/60 transition-colors"
                        disabled={isGuestUser}
                        value={ws.sourceFolderTemplate}
                        onChange={(e) => handleStationChange(idx, { sourceFolderTemplate: e.target.value })}
                        placeholder="/RAW/{subgrid}/"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">
                        NAS Output Folder
                      </label>
                      <input
                        className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs font-mono text-text-base outline-none focus:border-sky-500/60 transition-colors"
                        disabled={isGuestUser}
                        value={ws.outputFolderTemplate}
                        onChange={(e) => handleStationChange(idx, { outputFolderTemplate: e.target.value })}
                        placeholder="/STITCHED/{subgrid}/"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] text-text-muted italic pt-1 border-t border-subtle/50">
                    <Info size={12} className="shrink-0 text-text-muted" />
                    <span className="truncate">{ws.description}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* GPU Worker Settings */
        <div className="bg-inner/60 border border-subtle rounded-xl p-4 space-y-3.5 shadow-sm">
          <div className="flex items-center gap-2 border-b border-subtle pb-2.5">
            <Cpu size={15} className="text-sky-400" />
            <h3 className="text-xs font-bold text-text-base">Automated GPU Worker Configuration</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">API Mode</label>
              <select
                className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base outline-none focus:border-sky-500/60"
                value={projectSettings?.productionApiMode || 'mock'}
                disabled={isGuestUser}
                onChange={(e) => setApi({ productionApiMode: e.target.value as any })}
              >
                <option value="mock">mock (simulated live dev)</option>
                <option value="http">http (FastAPI Worker)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">Worker Server URL</label>
              <input
                className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base outline-none focus:border-sky-500/60"
                placeholder="http://192.168.1.110:8000"
                disabled={isGuestUser}
                value={projectSettings?.productionApiUrl || ''}
                onChange={(e) => setApi({ productionApiUrl: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">Max Concurrency</label>
              <input
                type="number"
                min={1}
                max={16}
                className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base outline-none focus:border-sky-500/60"
                disabled={isGuestUser}
                value={projectSettings?.productionConcurrency || 1}
                onChange={(e) => setApi({ productionConcurrency: Number(e.target.value) || 1 })}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">NAS Base Path</label>
              <input
                className="w-full bg-card border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base outline-none focus:border-sky-500/60"
                placeholder="//nas/360_images"
                disabled={isGuestUser}
                value={projectSettings?.nasWorkBasePath || ''}
                onChange={(e) => setApi({ nasWorkBasePath: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}

      {/* Custom Providers / External Tools Registry */}
      <div className="bg-inner/40 border border-subtle rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ServerCog size={15} className="text-sky-400" />
            <h3 className="text-xs font-bold text-text-base">External Software &amp; Tool Registry</h3>
          </div>
          {!isGuestUser && (
            <button
              onClick={() => {
                setDraft(EMPTY_PROVIDER);
                setEditing(true);
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-inner hover:bg-card border border-subtle text-text-base text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Plus size={13} /> Add Custom Tool
            </button>
          )}
        </div>

        {editing && !isGuestUser && (
          <div className="bg-card border border-subtle rounded-xl p-3.5 grid grid-cols-1 md:grid-cols-4 gap-3 animate-in fade-in">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">Tool Name</label>
              <input
                className="w-full bg-inner border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base outline-none focus:border-sky-500/60"
                placeholder="e.g. PTGui Pro Batch"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">Executable / Software</label>
              <input
                className="w-full bg-inner border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base outline-none focus:border-sky-500/60"
                placeholder="ptgui.exe"
                value={draft.software}
                onChange={(e) => setDraft({ ...draft, software: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">Version</label>
              <input
                className="w-full bg-inner border border-subtle rounded-lg px-3 py-1.5 text-xs text-text-base outline-none focus:border-sky-500/60"
                placeholder="v13.2"
                value={draft.version}
                onChange={(e) => setDraft({ ...draft, version: e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={upsertProvider}
                className="w-full px-4 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs rounded-lg transition-colors cursor-pointer shadow"
              >
                Save Tool
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
          {providers.map((p) => (
            <div
              key={`${p.name}-${p.software}`}
              className="flex items-center justify-between gap-2 bg-card border border-subtle rounded-lg px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-text-base truncate">{p.name}</div>
                <div className="text-[10px] text-text-muted">
                  {p.software} {p.version && `· v${p.version}`}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => toggleProvider(p.name, p.software, !p.enabled)}
                  disabled={isGuestUser}
                  className={`text-[9px] font-bold px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                    p.enabled
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-inner text-text-muted border-subtle'
                  }`}
                >
                  {p.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
                {!isGuestUser && (
                  <button
                    onClick={() => removeProvider(p.name, p.software)}
                    className="p-1.5 rounded-md border border-subtle hover:bg-red-500/20 hover:border-red-500/40 text-red-400 transition-colors cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {providers.length === 0 && (
            <p className="text-[11px] text-text-muted italic sm:col-span-3 py-1">
              Standard 4-station tools (PTGui, YOLO Blur, Lightroom, Photoshop) are active. Additional custom tools can be added above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
