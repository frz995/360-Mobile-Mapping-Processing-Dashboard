import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, FolderOpen, Plus, Archive, Trash2, AlertTriangle, X } from 'lucide-react';
import { restoreWorkspaceTab, persistWorkspaceTab } from '../utils/workspaceLocation';
import { Masthead, UnderlineTabStrip, type ChromeTab, StatusDot } from './production/chrome';
import { EmptyState } from './common/EmptyState';
import { SkeletonLine } from './common/Skeleton';
import type { UserProject, ProjectDraft, ProjectStatus } from '../services/projects';

type ProjectTab = 'all' | 'active' | 'archived';

interface ProjectWorkspaceProps {
  isGuestUser?: boolean;
  translate?: (key: string) => string;
  activeProject?: UserProject | null;
  projectList?: UserProject[];
  projectsLoaded?: boolean;
  onLoadProject?: (project: UserProject) => void;
  onCreateProject?: (draft: ProjectDraft) => Promise<{ success: boolean; value?: UserProject; message?: string }>;
  onRefreshProjects?: () => Promise<UserProject[]>;
  onDeleteProject?: (project: UserProject) => void;
  onBackToDashboard?: () => void;
}

const TABS: ChromeTab<ProjectTab>[] = [
  { key: 'all', icon: <FolderOpen size={14} /> },
  { key: 'active', icon: <Briefcase size={14} /> },
  { key: 'archived', icon: <Archive size={14} /> }
];

const STATUS_TONE: Record<ProjectStatus, string> = {
  planning: 'text-amber-400',
  active: 'text-emerald-400',
  paused: 'text-sky-400',
  completed: 'text-text-base',
  archived: 'text-text-muted'
};

const STATUS_KEY: Record<ProjectStatus, string> = {
  planning: 'projectStatusPlanning',
  active: 'projectStatusActive',
  paused: 'projectStatusPaused',
  completed: 'projectStatusCompleted',
  archived: 'projectStatusArchived'
};

/** Region presets → auto-fill GIS scope (crs, bbox, basemap, equipment). */
const REGION_PRESETS: Record<string, { crs: string; region: string; bbox: [number, number, number, number] }> = {
  peninsular_malaysia: { crs: 'EPSG:4326', region: 'peninsular_malaysia', bbox: [99.6, 1.2, 104.6, 6.8] },
  sabah: { crs: 'EPSG:4326', region: 'sabah', bbox: [115.0, 4.0, 119.4, 7.5] },
  sarawak: { crs: 'EPSG:4326', region: 'sarawak', bbox: [109.0, 0.5, 115.8, 5.5] }
};

function formatRelative(lastOpened?: string | null): string {
  if (!lastOpened) return '';
  const then = new Date(lastOpened).getTime();
  if (isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(lastOpened).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({
  isGuestUser = false,
  translate = (k) => k,
  activeProject,
  projectList = [],
  projectsLoaded = false,
  onLoadProject,
  onCreateProject,
  onRefreshProjects,
  onDeleteProject,
  onBackToDashboard
}) => {
  const [activeTab, setActiveTab] = useState<ProjectTab>(() => {
    const states: ProjectTab[] = ['all', 'active', 'archived'];
    return restoreWorkspaceTab<ProjectTab>('project', states) ?? 'all';
  });
  useEffect(() => {
    persistWorkspaceTab('project', activeTab);
  }, [activeTab]);

  const [confirmDelete, setConfirmDelete] = useState<UserProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [name, setName] = useState('');
  const [contractCode, setContractCode] = useState('');
  const [clientName, setClientName] = useState('');
  const [region, setRegion] = useState('peninsular_malaysia');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectsLoaded && onRefreshProjects) {
      onRefreshProjects();
    }
  }, [projectsLoaded, onRefreshProjects]);

  const canWrite = !isGuestUser;

  const filtered = useMemo(() => {
    if (activeTab === 'active') return projectList.filter((p) => p.status !== 'archived');
    if (activeTab === 'archived') return projectList.filter((p) => p.status === 'archived');
    return projectList;
  }, [projectList, activeTab]);

  const counts = useMemo(() => {
    const active = projectList.filter((p) => p.status === 'active').length;
    const completed = projectList.filter((p) => p.status === 'completed').length;
    return { total: projectList.length, active, completed };
  }, [projectList]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !onCreateProject) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const preset = REGION_PRESETS[region];
      const scope = preset
        ? { crs: preset.crs, region: preset.region, bbox: preset.bbox, basemap: 'dark', equipment: 'MMS', targetKm: 0, targetImages: 0 }
        : { crs: 'EPSG:4326', region, basemap: 'dark', equipment: 'MMS', targetKm: 0, targetImages: 0 };
      const res = await onCreateProject({
        name: name.trim(),
        contractCode: contractCode.trim(),
        clientName: clientName.trim(),
        region,
        description: description.trim(),
        status: 'active',
        scope
      });
      if (!res.success) {
        setCreateError(res.message || translate('projectCreateError'));
        return;
      }
      setName('');
      setContractCode('');
      setClientName('');
      setDescription('');
    } finally {
      setSubmitting(false);
    }
  }, [name, contractCode, clientName, region, description, onCreateProject, translate]);

  const handleConfirmDelete = useCallback(() => {
    if (!confirmDelete || !onDeleteProject) return;
    setDeleting(true);
    try {
      onDeleteProject(confirmDelete);
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }, [confirmDelete, onDeleteProject]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        <Masthead
          icon={<Briefcase size={20} />}
          context={translate('workspaceProject')}
          title={translate('projectPanelTitle')}
          subtitle={translate('projectPanelSubtitle')}
          readouts={[
            { key: 'total', label: translate('projectTotal'), value: String(counts.total), tone: 'text-text-base' },
            { key: 'active', label: translate('projectActiveCount'), value: String(counts.active), tone: 'text-emerald-400' },
            { key: 'completed', label: translate('projectCompletedCount'), value: String(counts.completed), tone: 'text-text-base' }
          ]}
        />

        <UnderlineTabStrip
          tabs={TABS}
          active={activeTab}
          onChange={setActiveTab}
          tabLabel={(k) => translate(`projectTab${k[0].toUpperCase()}${k.slice(1)}`)}
        />

        <div className="grid lg:grid-cols-[1fr_340px] gap-3 min-h-0 items-start">
          {/* Recent projects rail */}
          <div className="flex flex-col gap-2 min-h-0">
            {!projectsLoaded ? (
              <div className="bg-card border border-subtle rounded-xl p-4 flex flex-col gap-3">
                <SkeletonLine className="h-8" />
                <SkeletonLine className="h-16" />
                <SkeletonLine className="h-16" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="bg-card border border-subtle rounded-xl">
                <EmptyState
                  icon={Briefcase}
                  title={activeTab === 'all' && projectList.length === 0 ? translate('projectNoProjects') : translate('projectEmptyFiltered')}
                  hint={activeTab === 'all' && projectList.length === 0 ? translate('projectNoProjectsDesc') : undefined}
                  action={canWrite ? (
                    <button
                      onClick={() => setActiveTab('all')}
                      className="px-3 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-subtle text-xs font-semibold rounded-lg transition-all cursor-pointer"
                    >
                      + {translate('projectCreateBtn')}
                    </button>
                  ) : undefined}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2 bg-card border border-subtle rounded-xl p-2">
                {filtered.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 rounded-xl bg-inner border border-subtle hover:border-sky-400/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-text-base truncate">{p.name}</span>
                          {activeProject?.id === p.id && (
                            <span className="text-[9px] font-bold uppercase tracking-wider text-sky-400 bg-sky-500/15 border border-sky-500/30 rounded px-1.5 py-0.5 shrink-0">
                              {translate('projectCurrent')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {p.region && (
                            <span className="text-[9px] text-text-muted bg-card border border-subtle rounded px-1.5 py-0.5 uppercase tracking-wide">
                              {p.region}
                            </span>
                          )}
                          <span className="text-[9px] text-text-muted font-mono">{p.contractCode || '—'}</span>
                          <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide">
                            <StatusDot tone={STATUS_TONE[p.status]} pulse={p.status === 'active'} />
                            {translate(STATUS_KEY[p.status])}
                          </span>
                        </div>
                      </div>
                      {canWrite && onLoadProject && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {activeProject?.id === p.id ? (
                            <span className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 rounded-lg">
                              {translate('projectActiveButton')}
                            </span>
                          ) : (
                            <button
                              onClick={() => onLoadProject(p)}
                              className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-sky-400 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 rounded-lg transition-all cursor-pointer"
                            >
                              {translate('projectLoad')}
                            </button>
                          )}
                          {canWrite && onDeleteProject && (
                            <button
                              onClick={() => setConfirmDelete(p)}
                              aria-label="Delete project"
                              title={translate('projectDelete')}
                              className="p-1.5 text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/15 border border-transparent hover:border-rose-500/30 rounded-lg transition-all cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-text-muted">
                      <span>{translate('projectLastOpened')}: {formatRelative(p.lastOpenedAt) || translate('projectNoDate')}</span>
                      <div className="flex-1 h-1 bg-card border border-subtle rounded-full overflow-hidden max-w-[90px]">
                        <div
                          className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 rounded-full"
                          style={{ width: p.status === 'completed' ? '100%' : p.status === 'active' ? '65%' : '20%' }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create form */}
          <div className="bg-card border border-subtle rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Plus size={15} className="text-sky-400" />
              <h3 className="text-xs font-bold text-text-base uppercase tracking-wider">{translate('projectCreateTitle')}</h3>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">{translate('projectNameField')}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={translate('projectNamePlaceholder')}
                  disabled={!canWrite || submitting}
                  className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">{translate('projectContractField')}</span>
                  <input
                    value={contractCode}
                    onChange={(e) => setContractCode(e.target.value)}
                    placeholder={translate('projectContractPlaceholder')}
                    disabled={!canWrite || submitting}
                    className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">{translate('projectClientField')}</span>
                  <input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder={translate('projectClientPlaceholder')}
                    disabled={!canWrite || submitting}
                    className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">{translate('projectRegionField')}</span>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  disabled={!canWrite || submitting}
                  className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                >
                  <option value="peninsular_malaysia">Peninsular Malaysia</option>
                  <option value="sabah">Sabah</option>
                  <option value="sarawak">Sarawak</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">{translate('projectDescField')}</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={translate('projectDescPlaceholder')}
                  rows={2}
                  disabled={!canWrite || submitting}
                  className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50 resize-none"
                />
              </label>
              {createError && (
                <p className="text-[10px] text-rose-400">{createError}</p>
              )}
              <button
                type="submit"
                disabled={!canWrite || submitting || !name.trim()}
                className="mt-1 px-3 py-2 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/30 text-xs font-bold rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? '…' : `+ ${translate('projectCreateBtn')}`}
              </button>
            </form>
            {onBackToDashboard && (
              <button
                onClick={onBackToDashboard}
                className="self-start text-[10px] text-text-muted hover:text-text-base transition-colors cursor-pointer mt-1"
              >
                ← Back to Dashboard
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div
            className="bg-card border border-rose-500/30 rounded-xl p-5 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
                <AlertTriangle size={17} className="text-rose-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-text-base">{translate('projectDeleteTitle')}</h3>
                <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                  {translate('projectDeleteConfirm')} <span className="text-rose-400 font-semibold">{confirmDelete.name}</span>
                </p>
              </div>
              <button
                onClick={() => !deleting && setConfirmDelete(null)}
                aria-label="Close"
                className="shrink-0 p-1 text-text-muted hover:text-text-base rounded transition-colors cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="px-3 py-1.5 text-[11px] font-semibold text-text-muted hover:text-text-base border border-subtle rounded-lg transition-all cursor-pointer disabled:opacity-50"
              >
                {translate('projectDeleteCancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-3 py-1.5 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deleting ? '…' : translate('projectDeleteConfirmBtn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};