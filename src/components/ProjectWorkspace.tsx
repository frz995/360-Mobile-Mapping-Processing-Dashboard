import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, FolderPlus, FolderOpen, Plus, Archive, AlertTriangle, X, Edit2 } from 'lucide-react';
import { restoreWorkspaceTab, persistWorkspaceTab } from '../utils/workspaceLocation';
import { Masthead, UnderlineTabStrip, type ChromeTab } from './production/chrome';
import { EmptyState } from './common/EmptyState';
import { SkeletonLine } from './common/Skeleton';
import { ProjectGalleryCard, resolveUserBasemapKey } from './common/ProjectGalleryCard';
import { FocusCardGrid, FocusCard } from './common/FocusCards';
import type { UserProject, ProjectDraft, ProjectStatus } from '../services/projects';

type ProjectTab = 'all' | 'active' | 'archived';

interface ProjectWorkspaceProps {
  isGuestUser?: boolean;
  translate?: (key: string) => string;
  activeProject?: UserProject | null;
  projectList?: UserProject[];
  projectsLoaded?: boolean;
  totalKm?: number;
  projectSettings?: Record<string, unknown> | null;
  onLoadProject?: (project: UserProject) => void;
  onCreateProject?: (draft: ProjectDraft) => Promise<{ success: boolean; value?: UserProject; message?: string }>;
  onUpdateProject?: (id: string, patch: Partial<ProjectDraft>) => Promise<{ success: boolean; value?: UserProject; message?: string }>;
  onRefreshProjects?: () => Promise<UserProject[]>;
  onDeleteProject?: (project: UserProject) => void;
  onBackToDashboard?: () => void;
}

const TABS: ChromeTab<ProjectTab>[] = [
  { key: 'all', icon: <FolderOpen size={14} /> },
  { key: 'active', icon: <Briefcase size={14} /> },
  { key: 'archived', icon: <Archive size={14} /> }
];

/** Region presets → auto-fill GIS scope (crs, bbox, basemap, equipment). */
const REGION_PRESETS: Record<string, { crs: string; region: string; bbox: [number, number, number, number] }> = {
  peninsular_malaysia: { crs: 'EPSG:4326', region: 'peninsular_malaysia', bbox: [99.6, 1.2, 104.6, 6.8] },
  sabah: { crs: 'EPSG:4326', region: 'sabah', bbox: [115.0, 4.0, 119.4, 7.5] },
  sarawak: { crs: 'EPSG:4326', region: 'sarawak', bbox: [109.0, 0.5, 115.8, 5.5] }
};

export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({
  isGuestUser = false,
  translate = (k) => k,
  activeProject,
  projectList = [],
  projectsLoaded = false,
  totalKm = 0,
  projectSettings,
  onLoadProject,
  onCreateProject,
  onUpdateProject,
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
  const [targetKmInput, setTargetKmInput] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit project state
  const [editingProject, setEditingProject] = useState<UserProject | null>(null);
  const [editName, setEditName] = useState('');
  const [editContractCode, setEditContractCode] = useState('');
  const [editClientName, setEditClientName] = useState('');
  const [editRegion, setEditRegion] = useState('peninsular_malaysia');
  const [editTargetKm, setEditTargetKm] = useState('');
  const [editActualKm, setEditActualKm] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<ProjectStatus>('active');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectsLoaded && onRefreshProjects) {
      onRefreshProjects();
    }
  }, [projectsLoaded, onRefreshProjects]);

  const canWrite = !isGuestUser;

  const userBasemapKey =
    resolveUserBasemapKey((projectSettings as any)?.defaultBasemap) ??
    resolveUserBasemapKey((projectSettings as any)?.defaultBasemapStyle);

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
      const parsedTargetKm = parseFloat(targetKmInput) || 0;
      const scope = preset
        ? { crs: preset.crs, region: preset.region, bbox: preset.bbox, basemap: 'dark', equipment: 'MMS', targetKm: parsedTargetKm, actualKm: 0, targetImages: 0 }
        : { crs: 'EPSG:4326', region, basemap: 'dark', equipment: 'MMS', targetKm: parsedTargetKm, actualKm: 0, targetImages: 0 };
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
      setTargetKmInput('');
      setDescription('');
    } finally {
      setSubmitting(false);
    }
  }, [name, contractCode, clientName, region, targetKmInput, description, onCreateProject, translate]);

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

  const handleOpenEdit = useCallback((p: UserProject) => {
    setEditingProject(p);
    setEditName(p.name || '');
    setEditContractCode(p.contractCode || '');
    setEditClientName(p.clientName || '');
    setEditRegion(p.region || 'peninsular_malaysia');
    const isAct = p.id === activeProject?.id;
    const currentTarget = isAct && typeof (projectSettings as any)?.targetKm === 'number' && (projectSettings as any).targetKm > 0
      ? (projectSettings as any).targetKm
      : (p.scope?.targetKm || 0);
    const currentActual = isAct && typeof totalKm === 'number'
      ? totalKm
      : (p.scope?.actualKm || 0);
    setEditTargetKm(currentTarget ? String(currentTarget) : '');
    setEditActualKm(currentActual ? String(currentActual) : '');
    setEditDescription(p.description || '');
    setEditStatus(p.status || 'active');
    setEditError(null);
  }, [activeProject, projectSettings, totalKm]);

  const handleSaveEdit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !onUpdateProject || !editName.trim()) return;
    setEditSubmitting(true);
    setEditError(null);
    try {
      const preset = REGION_PRESETS[editRegion];
      const parsedTargetKm = parseFloat(editTargetKm);
      const parsedActualKm = parseFloat(editActualKm);
      const updatedScope = {
        ...(editingProject.scope || {}),
        region: editRegion,
        targetKm: !isNaN(parsedTargetKm) ? parsedTargetKm : (editingProject.scope?.targetKm || 0),
        actualKm: !isNaN(parsedActualKm) ? parsedActualKm : (editingProject.scope?.actualKm || 0),
        ...(preset ? { crs: preset.crs, bbox: preset.bbox } : {})
      };
      const res = await onUpdateProject(editingProject.id, {
        name: editName.trim(),
        contractCode: editContractCode.trim(),
        clientName: editClientName.trim(),
        region: editRegion,
        description: editDescription.trim(),
        status: editStatus,
        scope: updatedScope
      });
      if (!res.success) {
        setEditError(res.message || 'Failed to update project');
        return;
      }
      setEditingProject(null);
    } catch (err) {
      setEditError((err as Error).message || 'Failed to update project');
    } finally {
      setEditSubmitting(false);
    }
  }, [editingProject, onUpdateProject, editName, editContractCode, editClientName, editRegion, editTargetKm, editActualKm, editDescription, editStatus]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-in fade-in duration-500">
      <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto p-4">
        <Masthead
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
                  icon={FolderPlus}
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
              <FocusCardGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 items-start">
                {filtered.map((p, idx) => {
                  const isCardActive = activeProject?.id === p.id;
                  const actualKm = isCardActive
                    ? (typeof totalKm === 'number' ? totalKm : (Number(p.scope?.actualKm) || 0))
                    : (Number(p.scope?.actualKm) || 0);

                  const targetKm = Number(p.scope?.targetKm) || 0;

                  const progressPct = targetKm > 0
                    ? Math.min(100, Math.round(((actualKm / targetKm) * 100) * 10) / 10)
                    : (actualKm > 0 ? 100 : 0);

                  return (
                    <FocusCard key={p.id} index={idx}>
                      <ProjectGalleryCard
                        project={p}
                        active={isCardActive}
                        actualKm={actualKm}
                        targetKm={targetKm}
                        progressPct={progressPct}
                        canWrite={canWrite}
                        basemapKey={userBasemapKey ?? undefined}
                        translate={translate}
                        onLoadProject={onLoadProject}
                        onEdit={onUpdateProject ? handleOpenEdit : undefined}
                        onDelete={onDeleteProject ? setConfirmDelete : undefined}
                      />
                    </FocusCard>
                  );
                })}
              </FocusCardGrid>
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
              <div className="grid grid-cols-2 gap-2">
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
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">Target Distance (km)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={targetKmInput}
                    onChange={(e) => setTargetKmInput(e.target.value)}
                    placeholder="0.0"
                    disabled={!canWrite || submitting}
                    className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                  />
                </label>
              </div>
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

      {/* Edit project dialog */}
      {editingProject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => !editSubmitting && setEditingProject(null)}
        >
          <div
            className="bg-card border border-subtle rounded-xl p-5 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-subtle pb-3">
              <div className="flex items-center gap-2">
                <Edit2 size={16} className="text-sky-400" />
                <h3 className="text-xs font-bold text-text-base uppercase tracking-wider">
                  Edit Project
                </h3>
              </div>
              <button
                onClick={() => !editSubmitting && setEditingProject(null)}
                aria-label="Close"
                className="p-1 text-text-muted hover:text-text-base rounded transition-colors cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">
                  {translate('projectNameField')}
                </span>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={translate('projectNamePlaceholder')}
                  disabled={editSubmitting}
                  className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">
                    {translate('projectContractField')}
                  </span>
                  <input
                    value={editContractCode}
                    onChange={(e) => setEditContractCode(e.target.value)}
                    placeholder={translate('projectContractPlaceholder')}
                    disabled={editSubmitting}
                    className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">
                    {translate('projectClientField')}
                  </span>
                  <input
                    value={editClientName}
                    onChange={(e) => setEditClientName(e.target.value)}
                    placeholder={translate('projectClientPlaceholder')}
                    disabled={editSubmitting}
                    className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">
                    {translate('projectRegionField')}
                  </span>
                  <select
                    value={editRegion}
                    onChange={(e) => setEditRegion(e.target.value)}
                    disabled={editSubmitting}
                    className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                  >
                    <option value="peninsular_malaysia">Peninsular Malaysia</option>
                    <option value="sabah">Sabah</option>
                    <option value="sarawak">Sarawak</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">
                    Status
                  </span>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as ProjectStatus)}
                    disabled={editSubmitting}
                    className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                  >
                    <option value="active">Active</option>
                    <option value="planning">Planning</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">
                    Target Distance (km)
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editTargetKm}
                    onChange={(e) => setEditTargetKm(e.target.value)}
                    placeholder="0.0"
                    disabled={editSubmitting}
                    className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">
                    Actual Mapped (km)
                  </span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editActualKm}
                    onChange={(e) => setEditActualKm(e.target.value)}
                    placeholder="0.0"
                    disabled={editSubmitting}
                    className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50"
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">
                  {translate('projectDescField')}
                </span>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={translate('projectDescPlaceholder')}
                  rows={3}
                  disabled={editSubmitting}
                  className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50 disabled:opacity-50 resize-none"
                />
              </label>

              {editError && (
                <p className="text-[10px] text-rose-400">{editError}</p>
              )}

              <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-subtle">
                <button
                  type="button"
                  onClick={() => setEditingProject(null)}
                  disabled={editSubmitting}
                  className="px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-base border border-subtle rounded-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting || !editName.trim()}
                  className="px-4 py-1.5 text-xs font-bold text-sky-400 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {editSubmitting ? '…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};