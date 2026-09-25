import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { restoreWorkspaceTab, persistWorkspaceTab } from '../utils/workspaceLocation';
import {
  Gauge,
  FolderTree,
  ShieldCheck,
  ArrowRight
} from 'lucide-react';
import { fetchDatasetsFromSupabase } from '../services/supabase';
import { createProductionApiClient } from '../services/productionApi';
import type { ProductionApiClient } from '../services/productionApi';
import type { DatasetRecord, StorageTab } from '../types/production';
import { getProductionApiSettings } from './production/storage/storageCommon';
import { Masthead, UnderlineTabStrip, type ChromeTab } from './production/chrome';
import { OverviewPanel } from './production/storage/OverviewPanel';
import { BrowserPanel } from './production/storage/BrowserPanel';
import { ValidationPanel } from './production/storage/ValidationPanel';

export interface NASStorageWorkspaceProps {
  projectSettings: any;
  setProjectSettings: React.Dispatch<React.SetStateAction<any>>;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  onBackToDashboard?: () => void;
  onOpenProductionHub?: (path?: string, subgrid?: string) => void;
  translate?: (key: string) => string;
  initialFocusPath?: string;
}

const TABS: ChromeTab<StorageTab>[] = [
  { key: 'browser', label: '1. Directory Explorer', icon: <FolderTree size={14} /> },
  { key: 'overview', label: '2. Capacity & Volumes', icon: <Gauge size={14} /> },
  { key: 'validation', label: '3. Integrity Verification', icon: <ShieldCheck size={14} /> }
];

const TAB_TITLES: Record<string, string> = {
  browser: '1. Directory Explorer',
  overview: '2. Capacity & Volumes',
  validation: '3. Integrity Verification'
};

export const NASStorageWorkspace: React.FC<NASStorageWorkspaceProps> = ({
  projectSettings,
  setProjectSettings,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog,
  onBackToDashboard: _onBackToDashboard,
  onOpenProductionHub,
  translate = (k) => k,
  initialFocusPath
}) => {
  const [activeTab, setActiveTab] = useState<StorageTab>(() => {
    const storageTabs = ['browser', 'overview', 'validation'] as const;
    return initialFocusPath ? 'browser' : restoreWorkspaceTab<typeof storageTabs[number]>('storage', storageTabs) ?? 'browser';
  });
  useEffect(() => {
    persistWorkspaceTab('storage', activeTab);
  }, [activeTab]);
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
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 p-4 min-h-full pb-32">
        {/* Top Masthead Console */}
        <Masthead
          title="NAS & Daemon"
          subtitle="Direct high-speed NAS network volume explorer, folder sequence validator, and disk storage capacity monitor."
          readouts={[
            { key: 'mode', label: 'Storage Mode', value: (projectSettings?.productionApiMode || 'direct').toUpperCase() },
            { key: 'nasBase', label: 'NAS Mount Base', value: projectSettings?.nasWorkBasePath || '/nas/360_images' },
            { key: 'api', label: 'Worker Endpoint', value: projectSettings?.productionApiUrl || 'Local Native' }
          ]}
          actions={
            onOpenProductionHub ? (
              <button
                onClick={() => onOpenProductionHub?.('/03_Stitching', 'N93E70')}
                className="px-3 py-1.5 bg-card border border-subtle hover:border-divider text-text-base rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Return to Production Hub"
              >
                <ArrowRight size={13} className="text-zinc-400" />
                <span>Go to Production Hub</span>
              </button>
            ) : undefined
          }
        />

        {/* Main Panel Canvas */}
        <div className="bg-card border border-subtle rounded-2xl shadow-md overflow-hidden flex flex-col">
          <div className="px-3 pt-2 border-b border-divider bg-card">
            <UnderlineTabStrip
              tabs={TABS}
              active={activeTab}
              onChange={setActiveTab}
              tabLabel={(key) => TAB_TITLES[key] || translate(key)}
            />
          </div>

          <div key={activeTab} className="p-4 flex-1 flex flex-col min-h-0 animate-panel-enter">
            {/* Active tab panel */}
            {activeTab === 'browser' && (
              <BrowserPanel
                api={api}
                projectSettings={projectSettings}
                translate={translate}
                isGuestUser={isGuestUser}
                onAddNotification={addNotification}
                onAddAuditLog={addAuditLog}
                onOpenProductionHub={onOpenProductionHub}
                userLabel={userLabel}
                initialPath={initialFocusPath}
              />
            )}
            {activeTab === 'overview' && (
              <OverviewPanel
                api={api}
                projectSettings={projectSettings}
                setProjectSettings={setProjectSettings}
                addNotification={addNotification}
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
          </div>
        </div>
      </div>
    </div>
  );
};