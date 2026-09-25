import React, { useState } from 'react';
import {
  FolderInput,
  Monitor,
  ShieldCheck,
  Database,
  Globe,
  HardDrive
} from 'lucide-react';
import { Masthead, UnderlineTabStrip, type ChromeTab } from '../chrome';
import { IntakePairingStation, type PairedFrameRecord } from './IntakePairingStation';
import { MultiPCStationBoard } from './MultiPCStationBoard';
import { QAAuditStation } from './QAAuditStation';
import { BucketPublicationGate } from './BucketPublicationGate';
import { WebGISPublishGate } from './WebGISPublishGate';

export type ProductionHubStationKey = 'intake' | 'stations' | 'qa' | 'bucket' | 'publish';

export interface ProductionHubWorkspaceProps {
  projectSettings: any;
  setProjectSettings: React.Dispatch<React.SetStateAction<any>>;
  authSession?: any;
  isGuestUser?: boolean;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  onBackToDashboard?: () => void;
  onOpenDataManagement?: (subgrid?: string) => void;
  onOpenStorage?: () => void;
  translate?: (key: string) => string;
}

const STATION_TABS: ChromeTab<ProductionHubStationKey>[] = [
  { key: 'intake', label: 'Stitched Intake & Pairing', icon: <FolderInput size={14} /> },
  { key: 'stations', label: '4-PC Multi-Station Flight Board', icon: <Monitor size={14} /> },
  { key: 'qa', label: 'Acceptance QA & 360° Inspection', icon: <ShieldCheck size={14} /> },
  { key: 'bucket', label: 'Cloud Bucket Gate', icon: <Database size={14} /> },
  { key: 'publish', label: 'WebGIS Release Gate', icon: <Globe size={14} /> }
];

export const ProductionHubWorkspace: React.FC<ProductionHubWorkspaceProps> = ({
  projectSettings,
  authSession,
  isGuestUser,
  addNotification,
  addAuditLog,
  onBackToDashboard,
  onOpenStorage,
  translate = (k) => k
}) => {
  const [activeStation, setActiveStation] = useState<ProductionHubStationKey>('intake');
  const [subgrid, setSubgrid] = useState<string>('');
  const [surveyDate, setSurveyDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [totalFrames, setTotalFrames] = useState<number>(0);
  const [pairedRecords, setPairedRecords] = useState<PairedFrameRecord[]>([]);

  const userEmail =
    authSession?.user?.email || authSession?.user?.user_metadata?.full_name || 'Operator';
  const userLabel = isGuestUser ? 'Guest' : userEmail;

  // Storage readouts must reflect real project configuration only: an unconfigured
  // project reports "Not configured" rather than a placeholder bucket or mount.
  const activeBucket =
    projectSettings?.supabaseBucket ||
    projectSettings?.r2Bucket ||
    projectSettings?.s3Bucket ||
    projectSettings?.gcsBucket ||
    projectSettings?.azureContainer ||
    projectSettings?.wasabiBucket ||
    '';
  const activeProvider = projectSettings?.storageProvider || '';
  const nasWorkBase = projectSettings?.nasWorkBasePath || '';

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 p-4 min-h-full pb-32">
        {/* Top Masthead Console */}
        <Masthead
          title="Production Hub"
          subtitle="Unified multi-workstation assembly hub: raw sensor intake, 4-PC pipeline tracking, 360° QA review, and WebGIS publication."
          readouts={[
            {
              key: 'bucket',
              label: 'Storage Bucket',
              value: activeBucket
                ? `${activeBucket}${activeProvider ? ` (${activeProvider.toUpperCase()})` : ''}`
                : 'Not configured',
              tone: activeBucket ? undefined : 'text-text-muted'
            },
            {
              key: 'nas',
              label: 'NAS Working Base',
              value: nasWorkBase || 'Not configured',
              tone: nasWorkBase ? undefined : 'text-text-muted'
            }
          ]}
          actions={
            onOpenStorage ? (
              <button
                onClick={onOpenStorage}
                className="px-3 py-1.5 bg-card border border-subtle hover:border-divider text-text-base rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Browse files and folders on NAS & Daemon"
              >
                <HardDrive size={13} className="text-text-muted" />
                <span>Browse NAS &amp; Daemon</span>
              </button>
            ) : undefined
          }
        />

        {/* Linear Assembly Station Navigation Strip */}
        <div className="bg-card border border-subtle rounded-2xl shadow-sm flex flex-col">
          <div className="px-3 pt-1 border-b border-divider bg-card">
            <UnderlineTabStrip
              tabs={STATION_TABS}
              active={activeStation}
              onChange={setActiveStation}
            />
          </div>

          {/* Active Station Workspace View */}
          <div className="p-4 flex flex-col">
            {activeStation === 'intake' && (
              <IntakePairingStation
                subgrid={subgrid}
                setSubgrid={setSubgrid}
                surveyDate={surveyDate}
                setSurveyDate={setSurveyDate}
                totalFrames={totalFrames}
                setTotalFrames={setTotalFrames}
                pairedRecords={pairedRecords}
                setPairedRecords={setPairedRecords}
                onAdvanceToNextStation={() => setActiveStation('stations')}
                addNotification={addNotification}
                addAuditLog={addAuditLog}
                translate={translate}
              />
            )}

            {activeStation === 'stations' && (
              <MultiPCStationBoard
                subgrid={subgrid}
                surveyDate={surveyDate}
                totalFrames={totalFrames}
                onAdvanceToQA={() => setActiveStation('qa')}
                addNotification={addNotification}
                addAuditLog={addAuditLog}
                userLabel={userLabel}
                isGuestUser={isGuestUser}
              />
            )}

            {activeStation === 'qa' && (
              <QAAuditStation
                subgrid={subgrid}
                surveyDate={surveyDate}
                totalFrames={totalFrames}
                pairedRecords={pairedRecords}
                projectSettings={projectSettings}
                onApproved={() => setActiveStation('bucket')}
                addNotification={addNotification}
                addAuditLog={addAuditLog}
                userLabel={userLabel}
                isGuestUser={isGuestUser}
              />
            )}

            {activeStation === 'bucket' && (
              <BucketPublicationGate
                subgrid={subgrid}
                surveyDate={surveyDate}
                totalFrames={totalFrames}
                projectSettings={projectSettings}
                onAdvanceToWebGIS={() => setActiveStation('publish')}
                addNotification={addNotification}
                addAuditLog={addAuditLog}
                userLabel={userLabel}
                isGuestUser={isGuestUser}
              />
            )}

            {activeStation === 'publish' && (
              <WebGISPublishGate
                subgrid={subgrid}
                surveyDate={surveyDate}
                totalFrames={totalFrames}
                pairedRecords={pairedRecords}
                projectSettings={projectSettings}
                onViewOnMap={() => onBackToDashboard?.()}
                addNotification={addNotification}
                addAuditLog={addAuditLog}
                userLabel={userLabel}
                isGuestUser={isGuestUser}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
