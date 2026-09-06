import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, Check, Globe } from 'lucide-react';
import type { UserProject, ProjectDraft } from '../services/projects';

export type GateStage = 'idle' | 'welcome' | 'pick' | 'loading';

interface ProjectOnboardingProps {
  stage: GateStage;
  userName?: string;
  projects: UserProject[];
  projectsLoaded: boolean;
  activeProject?: UserProject | null;
  translate?: (key: string) => string;
  onContinue: (project: UserProject) => void;
  onCreateProject: (draft: ProjectDraft) => Promise<{ success: boolean; value?: UserProject; message?: string }>;
  onSkip: () => void;
  onRefreshProjects?: () => Promise<UserProject[]>;
}

const LOADING_STEPS = [
  'onboardingStepProjects',
  'onboardingStepScope',
  'onboardingStepInit',
  'onboardingStepFinalize'
];

export const ProjectOnboarding: React.FC<ProjectOnboardingProps> = ({
  stage,
  userName,
  projects,
  projectsLoaded,
  activeProject,
  translate = (k) => k,
  onContinue,
  onCreateProject,
  onSkip,
  onRefreshProjects
}) => {
  const [stepIndex, setStepIndex] = useState(0);

  // Create-form local state for the picker stage.
  const [name, setName] = useState('');
  const [region, setRegion] = useState('peninsular_malaysia');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (stage !== 'loading') return;
    setStepIndex(0);
    const timer = setInterval(() => {
      setStepIndex((i) => (i < LOADING_STEPS.length - 1 ? i + 1 : i));
    }, 700);
    return () => clearInterval(timer);
  }, [stage]);

  // Auto-load the project list once the picker opens.
  useEffect(() => {
    if (stage === 'pick' && !projectsLoaded && onRefreshProjects) {
      onRefreshProjects();
    }
  }, [stage, projectsLoaded, onRefreshProjects]);

  const recent = useMemo(
    () => projects.slice(0, 6),
    [projects]
  );

  const lastProject = activeProject || recent[0] || null;

  const handleCreateAndContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const res = await onCreateProject({
        name: name.trim(),
        region,
        status: 'active',
        scope: { crs: 'EPSG:4326', region, bbox: [99.6, 1.2, 104.6, 6.8], basemap: 'dark', equipment: 'MMS' }
      });
      if (res.success && res.value) onContinue(res.value);
    } finally {
      setCreating(false);
    }
  };

  if (stage === 'idle') return null;

  const displayName = userName || 'there';

  return (
    <div className="fixed inset-0 z-[5000] bg-app overflow-hidden select-none">
      {/* Ambient blurred orb */}
      <div className="absolute -top-32 -right-32 w-[560px] h-[560px] rounded-full bg-sky-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute -bottom-40 -left-32 w-[560px] h-[560px] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />

      {stage === 'welcome' && (
        <div className="relative h-full w-full flex flex-col items-center justify-center px-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-card border border-subtle shadow-sm mb-6">
            <Globe size={30} className="text-sky-400" />
          </div>
          <h1 className="text-2xl font-bold text-text-base tracking-tight animate-waterfall">
            {translate('onboardingWelcome').replace('{name}', displayName)}
          </h1>
          <p className="mt-2 text-sm text-text-muted max-w-md text-center animate-waterfall stagger-1">
            {translate('onboardingWelcomeSub')}
          </p>
          <div className="mt-8 w-44 aurora-shimmer h-1.5 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-sky-500/0 via-sky-400 to-sky-500/0 rounded-full animate-pulse" />
          </div>
        </div>
      )}

      {stage === 'pick' && (
        <div className="relative h-full w-full flex items-center justify-center px-6 py-10 overflow-y-auto">
          <div className="w-full max-w-2xl flex flex-col gap-4 animate-waterfall">
            <div className="text-center">
              <h1 className="text-xl font-bold text-text-base tracking-tight">
                {translate('onboardingPickTitle')}
              </h1>
              <p className="mt-1 text-xs text-text-muted">{translate('onboardingPickSub')}</p>
            </div>

            {/* Last project one-tap */}
            {lastProject && (
              <button
                onClick={() => lastProject && onContinue(lastProject)}
                className="group w-full flex items-center justify-between gap-3 p-4 bg-card border border-subtle hover:border-sky-400/50 rounded-2xl shadow-sm transition-all cursor-pointer stagger-1"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="p-2.5 bg-inner border border-subtle rounded-xl text-sky-400 shrink-0">
                    <Briefcase size={18} />
                  </span>
                  <div className="min-w-0 text-left">
                    <div className="text-[9px] uppercase tracking-wider text-text-muted font-semibold">
                      {translate('onboardingContinue').replace('{name}', '')}
                    </div>
                    <div className="text-sm font-bold text-text-base truncate">{lastProject.name}</div>
                    <div className="text-[10px] text-text-muted">{lastProject.contractCode || lastProject.region || ''}</div>
                  </div>
                </div>
                <span className="text-sky-400 font-bold text-xs uppercase tracking-wider group-hover:translate-x-0.5 transition-transform">
                  →
                </span>
              </button>
            )}

            {/* Recent list */}
            {recent.length > 1 && (
              <div className="flex flex-col gap-2">
                {recent.filter((p) => p.id !== lastProject?.id).slice(0, 3).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onContinue(p)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 bg-card border border-subtle hover:border-sky-400/50 rounded-xl transition-all cursor-pointer text-left"
                  >
                    <span className="p-1.5 bg-inner border border-subtle rounded-lg text-text-muted">
                      <Briefcase size={14} />
                    </span>
                    <span className="text-xs font-semibold text-text-base truncate">{p.name}</span>
                    <span className="ml-auto text-[9px] text-text-muted shrink-0">{p.region}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Create new project */}
            {recent.length === 0 && (
              <p className="text-center text-[11px] text-text-muted">{translate('onboardingNoProjects')}</p>
            )}
            <form onSubmit={handleCreateAndContinue} className="bg-card border border-subtle rounded-2xl p-4 flex flex-col gap-2.5">
              <div className="grid sm:grid-cols-[1fr_160px] gap-2.5">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={translate('projectNamePlaceholder')}
                  className="bg-inner border border-subtle rounded-lg px-3 py-2.5 text-xs text-text-base placeholder:text-text-muted/60 focus:outline-none focus:border-sky-400/50"
                />
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="bg-inner border border-subtle rounded-lg px-3 py-2.5 text-xs text-text-base focus:outline-none focus:border-sky-400/50"
                >
                  <option value="peninsular_malaysia">Peninsular Malaysia</option>
                  <option value="sabah">Sabah</option>
                  <option value="sarawak">Sarawak</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="py-2 px-3 bg-sky-500/15 hover:bg-sky-500/25 text-sky-400 border border-sky-500/30 text-xs font-bold rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creating ? '…' : `+ ${translate('projectCreateBtn')}`}
              </button>
            </form>

            <button
              onClick={onSkip}
              className="self-center text-[11px] text-text-muted hover:text-text-base transition-colors cursor-pointer"
            >
              {translate('onboardingSkip')}
            </button>
          </div>
        </div>
      )}

      {stage === 'loading' && (
        <div className="relative h-full w-full flex items-center justify-center px-6">
          <div className="w-full max-w-sm flex flex-col gap-5 animate-waterfall">
            <div className="text-center">
              <h1 className="text-lg font-bold text-text-base tracking-tight">
                {translate('onboardingLoadingTitle')}
              </h1>
              <p className="mt-1 text-xs text-text-muted">{translate('onboardingLoadingSub')}</p>
            </div>
            <div className="flex flex-col gap-2.5">
              {LOADING_STEPS.map((key, i) => {
                const done = i < stepIndex;
                const active = i === stepIndex;
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all ${active ? 'border-sky-400/40 bg-inner' : 'border-transparent'}`}
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/20 text-emerald-400' : active ? 'text-sky-400' : 'text-text-muted/40'}`}>
                      {done ? <Check size={12} /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                    </span>
                    <span className={`text-xs ${done ? 'text-text-muted' : active ? 'text-text-base' : 'text-text-muted/40'}`}>
                      {translate(key)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="h-1.5 rounded-full overflow-hidden aurora-shimmer">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 rounded-full transition-all duration-700"
                style={{ width: `${((stepIndex + 1) / LOADING_STEPS.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};