import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gauge,
  FolderTree,
  ClipboardList,
  ShieldCheck,
  Database
} from 'lucide-react';
import { fetchDatasetsFromSupabase } from '../services/supabase';
import { createProductionApiClient } from '../services/productionApi';
import type { ProductionApiClient } from '../services/productionApi';
import type { DatasetRecord, StorageTab } from '../types/production';
import { getProductionApiSettings, STORAGE_TAB_LABELS } from './production/storage/storageCommon';
import { UnderlineTabStrip, type ChromeTab } from './production/chrome';
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

const TABS: ChromeTab<StorageTab>[] = [
  { key: 'overview', icon: <Gauge size={14} /> },
  { key: 'browser', icon: <FolderTree size={14} /> },
  { key: 'rawregistry', icon: <ClipboardList size={14} /> },
  { key: 'validation', icon: <ShieldCheck size={14} /> },
  { key: 'index', icon: <Database size={14} /> }
];

export const NASStorageWorkspace: React.FC<NASStorageWorkspaceProps> = ({
  projectSettings,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog,
  onBackToDashboard: _onBackToDashboard,
  translate = (k) => k
}) => {
  const [activeTab, setActiveTab] = useState<StorageTab>('overview');
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);

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

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        {/* Header */}
        <div className="px-1">
          <h2 className="text-base font-bold text-text-base tracking-wide">
            NAS Storage Manager
          </h2>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            NAS connectivity, capacity, folder browsing and RAW/produced dataset indexing. Metadata in Supabase only — image bytes never leave the NAS.
          </p>
        </div>

        {/* Main Panel Canvas */}
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col min-h-0">
          <div className="px-3 pt-2 border-b border-divider bg-card">
            <UnderlineTabStrip
              tabs={TABS}
              active={activeTab}
              onChange={setActiveTab}
              tabLabel={(key) => translate(STORAGE_TAB_LABELS[key])}
            />
          </div>

          <div key={activeTab} className="p-4 flex-1 flex flex-col min-h-0 overflow-y-auto animate-panel-enter">
            {/* Active tab panel */}
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
    </div>
  );
};