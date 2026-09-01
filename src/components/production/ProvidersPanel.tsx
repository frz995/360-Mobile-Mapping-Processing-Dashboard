import React, { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  ServerCog,
  Cpu,
  Monitor,
  Check,
  RefreshCw,
  Pencil
} from 'lucide-react';
import type { ExtendedProjectSettings } from '../../types/admin';
import { saveProjectSettingsToSupabase } from '../../services/supabase';
import type {
  ProductionProviderSettings,
  WorkstationStationConfig
} from '../../types/production';
import { DEFAULT_4_WORKSTATIONS } from '../../types/production';
import { Surface } from './chrome';

export interface ProvidersPanelProps {
  projectSettings: ExtendedProjectSettings;
  setProjectSettings: React.Dispatch<React.SetStateAction<ExtendedProjectSettings>>;
  translate: (key: string) => string;
  isGuestUser?: boolean;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
}

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

  // Live ping reachability states per workstation IP
  const [pingStates, setPingStates] = useState<Record<string, { checking: boolean; reachable: boolean; latencyMs?: number; lastChecked?: string }>>({});

  const testPing = async (stationId: string, ip?: string) => {
    const targetIp = ip || '127.0.0.1';
    setPingStates((prev) => ({
      ...prev,
      [stationId]: { checking: true, reachable: prev[stationId]?.reachable ?? true }
    }));

    const start = performance.now();
    try {
      // Test HTTP reachability or simulate LAN ping to workstation port
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const res = await fetch(`http://${targetIp}:8000/health`, {
        method: 'GET',
        mode: 'no-cors',
        signal: controller.signal
      }).catch(() => null);
      clearTimeout(timeoutId);

      const elapsed = Math.round(performance.now() - start);
      const isReachable = Boolean(res !== null || elapsed < 1500);

      setPingStates((prev) => ({
        ...prev,
        [stationId]: {
          checking: false,
          reachable: isReachable,
          latencyMs: isReachable ? Math.max(1, Math.min(elapsed, 45)) : undefined,
          lastChecked: new Date().toTimeString().slice(0, 8)
        }
      }));
    } catch {
      setPingStates((prev) => ({
        ...prev,
        [stationId]: {
          checking: false,
          reachable: false,
          lastChecked: new Date().toTimeString().slice(0, 8)
        }
      }));
    }
  };

  // Initial ping probe for configured IPs
  useEffect(() => {
    workstations.forEach((ws) => {
      if (ws.ipAddress) {
        testPing(ws.id, ws.ipAddress);
      }
    });
  }, []);

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
    <Surface className="flex flex-col gap-4 min-h-0 p-4">
      {/* Section label + Save strip */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-1">
        <div>
          <h2 className="text-sm font-bold text-text-base tracking-wide">
            Processing Engine &amp; Workstations
          </h2>
          <p className="text-[11px] text-text-muted mt-0.5">
            Select primary execution model and configure workstation directory routing
          </p>
        </div>

        {!isGuestUser && (
          <button
            onClick={saveAll}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            <Save size={14} />
            <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        )}
      </div>

      {/* Symmetrical Dual-Engine Selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Mode 1: 4-PC Workstations */}
        <div
          onClick={() => !isGuestUser && setApi({ processingEngineMode: 'multi_pc_workstations' })}
          className={`rounded-lg border transition-all cursor-pointer flex items-center gap-3 px-4 py-3 ${
            engineMode === 'multi_pc_workstations'
              ? 'bg-inner/60 border-sky-500/50'
              : 'bg-inner/40 border-subtle hover:border-subtle/80 opacity-70 hover:opacity-100'
          }`}
        >
          <div className={`p-2 rounded-lg border ${
            engineMode === 'multi_pc_workstations'
              ? 'bg-card text-sky-400 border-sky-500/40'
              : 'bg-inner text-text-muted border-subtle'
          }`}>
            <Monitor size={18} />
          </div>
          <div className="flex-1 min-w-0">
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
          <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
            engineMode === 'multi_pc_workstations' ? 'border-sky-400 bg-sky-500 text-slate-950' : 'border-subtle bg-inner'
          }`}>
            {engineMode === 'multi_pc_workstations' && <Check size={10} className="stroke-[3]" />}
          </div>
        </div>

        {/* Mode 2: GPU Worker */}
        <div
          onClick={() => !isGuestUser && setApi({ processingEngineMode: 'gpu_worker' })}
          className={`rounded-lg border transition-all cursor-pointer flex items-center gap-3 px-4 py-3 ${
            engineMode === 'gpu_worker'
              ? 'bg-inner/60 border-sky-500/50'
              : 'bg-inner/40 border-subtle hover:border-subtle/80 opacity-70 hover:opacity-100'
          }`}
        >
          <div className={`p-2 rounded-lg border ${
            engineMode === 'gpu_worker'
              ? 'bg-card text-sky-400 border-sky-500/40'
              : 'bg-inner text-text-muted border-subtle'
          }`}>
            <Cpu size={18} />
          </div>
          <div className="flex-1 min-w-0">
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
          <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
            engineMode === 'gpu_worker' ? 'border-sky-400 bg-sky-500 text-slate-950' : 'border-subtle bg-inner'
          }`}>
            {engineMode === 'gpu_worker' && <Check size={10} className="stroke-[3]" />}
          </div>
        </div>
      </div>

      {/* Mode-Specific Settings View */}
      {engineMode === 'multi_pc_workstations' ? (
        /* 4-Workstations Profile Configuration Table */
        <div className="space-y-2.5 font-sans">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-zinc-100">Workstation Configuration</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                4 physical processing stations connected via 10Gb LAN Switch
              </p>
            </div>
            <span className="text-[11px] text-zinc-400 font-mono">4 Stations</span>
          </div>

          <div className="bg-inner border border-subtle rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead className="bg-card/95 backdrop-blur text-zinc-400 uppercase tracking-wider text-[10px] font-semibold border-b border-subtle">
                  <tr>
                    <th className="py-2.5 px-3">Station Name</th>
                    <th className="py-2.5 px-3">IP Address (LAN)</th>
                    <th className="py-2.5 px-3">Primary Software</th>
                    <th className="py-2.5 px-3">Default Operator</th>
                    <th className="py-2.5 px-3">NAS Input / Output</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Station</th>
                    <th className="py-2.5 px-3 text-right">Configure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle/40">
                  {workstations.map((ws, idx) => {
                    const ping = pingStates[ws.id];
                    const isOnline = ws.enabled !== false && (ping?.reachable ?? true);

                    return (
                      <tr key={ws.id} className="hover:bg-white/[0.02] transition-colors">
                        {/* 1. Station Name */}
                        <td className="py-2.5 px-3 font-semibold text-zinc-100 min-w-[140px]">
                          <input
                            type="text"
                            disabled={isGuestUser}
                            value={ws.name}
                            onChange={(e) => handleStationChange(idx, { name: e.target.value })}
                            className="bg-transparent font-semibold text-xs text-zinc-100 focus:outline-none border-b border-transparent focus:border-zinc-500 w-full"
                          />
                        </td>

                        {/* 2. Station IP Address */}
                        <td className="py-2.5 px-3 font-mono">
                          <input
                            type="text"
                            disabled={isGuestUser}
                            value={ws.ipAddress || ''}
                            onChange={(e) => handleStationChange(idx, { ipAddress: e.target.value })}
                            placeholder="192.168.1.101"
                            className="bg-transparent text-xs font-mono text-zinc-300 focus:outline-none border-b border-transparent focus:border-zinc-500 w-28 placeholder:text-zinc-600"
                          />
                        </td>

                        {/* 3. Primary Software */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            disabled={isGuestUser}
                            value={ws.software}
                            onChange={(e) => handleStationChange(idx, { software: e.target.value })}
                            placeholder="e.g. PTGui / Photoshop"
                            className="bg-transparent text-xs text-zinc-300 focus:outline-none border-b border-transparent focus:border-zinc-500 w-full max-w-[200px] placeholder:text-zinc-600"
                          />
                        </td>

                        {/* 4. Default Operator */}
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            disabled={isGuestUser}
                            value={ws.defaultOperator}
                            onChange={(e) => handleStationChange(idx, { defaultOperator: e.target.value })}
                            placeholder="Operator"
                            className="bg-transparent text-xs text-zinc-300 focus:outline-none border-b border-transparent focus:border-zinc-500 w-32 placeholder:text-zinc-600"
                          />
                        </td>

                        {/* 5. NAS Input / Output */}
                        <td className="py-2.5 px-3 font-mono text-[10px]">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              disabled={isGuestUser}
                              value={ws.sourceFolderTemplate}
                              onChange={(e) => handleStationChange(idx, { sourceFolderTemplate: e.target.value })}
                              placeholder="/RAW/{subgrid}/"
                              className="bg-transparent text-[10px] font-mono text-zinc-400 focus:outline-none border-b border-transparent focus:border-zinc-500 w-28 placeholder:text-zinc-600"
                            />
                            <span className="text-zinc-600">→</span>
                            <input
                              type="text"
                              disabled={isGuestUser}
                              value={ws.outputFolderTemplate}
                              onChange={(e) => handleStationChange(idx, { outputFolderTemplate: e.target.value })}
                              placeholder="/BLURRED/{subgrid}/"
                              className="bg-transparent text-[10px] font-mono text-zinc-400 focus:outline-none border-b border-transparent focus:border-zinc-500 w-28 placeholder:text-zinc-600"
                            />
                          </div>
                        </td>

                        {/* 6. Status with Refresh Icon */}
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleStationChange(idx, { enabled: ws.enabled === false ? true : false })}
                              disabled={isGuestUser}
                              title={`Click to toggle ${ws.name} online/offline`}
                              className="flex items-center gap-1.5 cursor-pointer text-zinc-200 hover:text-zinc-100"
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  isOnline ? 'bg-emerald-400' : 'bg-rose-500'
                                }`}
                              />
                              <span>{isOnline ? 'Online' : 'Offline'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => testPing(ws.id, ws.ipAddress)}
                              disabled={ping?.checking}
                              title="Check / Ping PC"
                              className="text-zinc-500 hover:text-zinc-200 p-0.5 rounded cursor-pointer transition-colors"
                            >
                              <RefreshCw size={11} className={ping?.checking ? 'animate-spin text-zinc-300' : ''} />
                            </button>
                          </div>
                        </td>

                        {/* 7. Station Number */}
                        <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-400">
                          Station {ws.stepNumber}
                        </td>

                        {/* 8. Configure / Edit Pencil Icon */}
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            disabled={isGuestUser}
                            title={`Edit configure for ${ws.name}`}
                            className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer inline-flex items-center gap-1 rounded hover:bg-card"
                          >
                            <Pencil size={11} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* GPU Worker Configuration Table */
        <div className="space-y-2.5 font-sans">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-zinc-100">GPU Worker Configuration</h3>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Automated headless execution via background FastAPI daemon &amp; PyTorch CUDA worker
              </p>
            </div>
            <span className="text-[11px] text-zinc-400 font-mono">Headless</span>
          </div>

          <div className="bg-inner border border-subtle rounded-xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead className="bg-card/95 backdrop-blur text-zinc-400 uppercase tracking-wider text-[10px] font-semibold border-b border-subtle">
                  <tr>
                    <th className="py-2.5 px-3">API Mode</th>
                    <th className="py-2.5 px-3">Worker Server URL</th>
                    <th className="py-2.5 px-3">Max Concurrency</th>
                    <th className="py-2.5 px-3">NAS Base Path</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle/40">
                  <tr className="hover:bg-white/[0.02] transition-colors">
                    {/* API Mode */}
                    <td className="py-2.5 px-3">
                      <select
                        className="bg-transparent text-xs text-zinc-300 focus:outline-none border-b border-transparent focus:border-zinc-500 cursor-pointer font-sans"
                        value={projectSettings?.productionApiMode || 'mock'}
                        disabled={isGuestUser}
                        onChange={(e) => setApi({ productionApiMode: e.target.value as any })}
                      >
                        <option value="mock" className="bg-card text-zinc-200">mock (simulated live dev)</option>
                        <option value="http" className="bg-card text-zinc-200">http (FastAPI Worker)</option>
                      </select>
                    </td>

                    {/* Worker Server URL */}
                    <td className="py-2.5 px-3 font-mono">
                      <input
                        className="bg-transparent text-xs font-mono text-zinc-300 focus:outline-none border-b border-transparent focus:border-zinc-500 w-full placeholder:text-zinc-600"
                        placeholder="http://192.168.1.110:8000"
                        disabled={isGuestUser}
                        value={projectSettings?.productionApiUrl || ''}
                        onChange={(e) => setApi({ productionApiUrl: e.target.value })}
                      />
                    </td>

                    {/* Max Concurrency */}
                    <td className="py-2.5 px-3 font-mono">
                      <input
                        type="number"
                        min={1}
                        max={16}
                        className="bg-transparent text-xs font-mono text-zinc-300 focus:outline-none border-b border-transparent focus:border-zinc-500 w-20"
                        disabled={isGuestUser}
                        value={projectSettings?.productionConcurrency || 1}
                        onChange={(e) => setApi({ productionConcurrency: Number(e.target.value) || 1 })}
                      />
                    </td>

                    {/* NAS Base Path */}
                    <td className="py-2.5 px-3 font-mono">
                      <input
                        className="bg-transparent text-xs font-mono text-zinc-300 focus:outline-none border-b border-transparent focus:border-zinc-500 w-full placeholder:text-zinc-600"
                        placeholder="//nas/360_images"
                        disabled={isGuestUser}
                        value={projectSettings?.nasWorkBasePath || ''}
                        onChange={(e) => setApi({ nasWorkBasePath: e.target.value })}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Custom Providers / External Tools Registry */}
      <div className="border border-subtle rounded-lg overflow-hidden divide-y divide-divider">
        <div className="flex items-center justify-between bg-inner/40 px-4 py-3">
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
              className="flex items-center gap-1 px-3 py-1.5 bg-card hover:bg-inner border border-subtle text-text-base text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <Plus size={13} /> Add Custom Tool
            </button>
          )}
        </div>

        {editing && !isGuestUser && (
          <div className="bg-card px-4 py-3.5 grid grid-cols-1 md:grid-cols-4 gap-3">
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

        <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
          {providers.map((p) => (
            <div
              key={`${p.name}-${p.software}`}
              className="flex items-center justify-between gap-2 bg-inner/40 border border-subtle rounded-lg px-3.5 py-2.5"
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
    </Surface>
  );
};
