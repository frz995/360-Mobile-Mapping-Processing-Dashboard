import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gauge,
  FolderTree,
  ClipboardList,
  ShieldCheck,
  Database,
  HardDrive,
  RefreshCw,
  Undo2
} from 'lucide-react';
import { fetchDatasetsFromSupabase } from '../services/supabase';
import { createProductionApiClient } from '../services/productionApi';
import type { ProductionApiClient } from '../services/productionApi';
import type { DatasetRecord, StorageTab } from '../types/production';
import { getProductionApiSettings, STORAGE_TAB_LABELS } from './production/storage/storageCommon';
import { OverviewPanel } from './production/storage/OverviewPanel';
import { BrowserPanel } from './production/storage/BrowserPanel';
import { RawRegistryPanel } from './production/storage/RawRegistryPanel';
import { ValidationPanel } from './production/storage/ValidationPanel';
import { IndexPanel } from './production/storage/IndexPanel';

export interface NASStorageWorkspaceProps {
  projectSettings: any;
  setProjectSettings: React.Dispatch<React.SetStateAction<any>>;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  onBackToDashboard?: () => void;
  translate?: (key: string) => string;
}

const TABS: Array<{ key: StorageTab; icon: React.ComponentType<{ size?: number | string; className?: string }> }> = [
  { key: 'overview', icon: Gauge },
  { key: 'browser', icon: FolderTree },
  { key: 'rawregistry', icon: ClipboardList },
  { key: 'validation', icon: ShieldCheck },
  { key: 'index', icon: Database }
];

export const NASStorageWorkspace: React.FC<NASStorageWorkspaceProps> = ({
  projectSettings,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog,
  onBackToDashboard,
  translate = (k) => k
}) => {
  const [activeTab, setActiveTab] = useState<StorageTab>('overview');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const api: ProductionApiClient = useMemo(
    () => createProductionApiClient(getProductionApiSettings(projectSettings)),
    [projectSettings?.productionApiMode, projectSettings?.productionApiUrl, projectSettings?.productionConcurrency, projectSettings?.nasWorkBasePath]
  );

  const refreshDatasets = useCallback(
    () => fetchDatasetsFromSupabase().then(setDatasets),
    []
  );

  useEffect(() => {
    refreshDatasets();
  }, [refreshDatasets]);

  const userEmail =
    authSession?.user?.email || authSession?.user?.user_metadata?.full_name || 'Operator';
  const userLabel = isGuestUser ? 'Guest' : userEmail;

  const handleRefresh = () => {
    setRefreshing(true);
    refreshDatasets().finally(() => setRefreshing(false));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="bg-card border border-subtle rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
              <HardDrive size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-text-base tracking-wide">NAS Storage Manager</h2>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${
                  api.mode === 'mock'
                    ? 'text-sky-300 border-sky-500/40 bg-sky-950/40'
                    : 'text-emerald-300 border-emerald-500/40 bg-emerald-950/40'
                }`}>
                  {api.mode === 'mock' ? 'Mock Volume' : `${api.baseUrl || 'Worker'} · HTTP`}
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                NAS connectivity, capacity, folder browsing and RAW/produced dataset indexing. Metadata in Supabase only — image bytes never leave the NAS.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-card text-text-base text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> {translate('refresh')}
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

        {/* Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto bg-card border border-subtle rounded-xl p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    : 'text-text-muted hover:text-text-base border border-transparent'
                }`}>
                <Icon size={14} />
                {translate(STORAGE_TAB_LABELS[tab.key])}
              </button>
            );
          })}
        </div>

        {isGuestUser && (
          <div className="text-[11px] px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
            Read-only mode: you can inspect storage, capacity, folders and the registry, but cannot register datasets.
          </div>
        )}

        {/* Active tab panel */}
        <div className="bg-card border border-subtle rounded-xl p-4 min-h-0">
          {activeTab === 'overview' && (
            <OverviewPanel
              api={api}
              projectSettings={projectSettings}
              datasets={datasets}
              translate={translate}
            />
          )}
          {activeTab === 'browser' && (
            <BrowserPanel
              api={api}
              projectSettings={projectSettings}
              translate={translate}
              isGuestUser={isGuestUser}
              onAddNotification={addNotification}
              onAddAuditLog={addAuditLog}
              userLabel={userLabel}
            />
          )}
          {activeTab === 'rawregistry' && (
            <RawRegistryPanel
              api={api}
              datasets={datasets}
              translate={translate}
            />
          )}
          {activeTab === 'validation' && (
            <ValidationPanel
              api={api}
              datasets={datasets}
              translate={translate}
            />
          )}
          {activeTab === 'index' && (
            <IndexPanel
              datasets={datasets}
              translate={translate}
            />
          )}
        </div>
      </div>
    </div>
  );
};