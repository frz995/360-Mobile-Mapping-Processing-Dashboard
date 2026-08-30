import React from 'react';

/* =====================================================================
   Production Workspace console chrome.
   All token-driven so every theme (midnight/obsidian/graphite/teal-slate/
   daylight) and the legacy .light-mode layer keep working.
   ===================================================================== */

export interface MastheadReadout {
  key: string;
  label: string;
  value: string;
  tone?: string;
}

export interface MastheadProps {
  icon?: React.ReactNode;
  title: string;
  context?: string;
  subtitle?: string;
  badge?: React.ReactNode;
  readouts?: MastheadReadout[];
  actions?: React.ReactNode;
}

export function Masthead({ icon, title, context, subtitle, badge, readouts = [], actions }: MastheadProps) {
  return (
    <div className="flex flex-col gap-2.5 shrink-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="p-2.5 bg-card border border-subtle rounded-xl text-sky-400 shrink-0 shadow-sm">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            {context && (
              <div className="text-[9px] text-text-muted font-sans uppercase tracking-widest mb-0.5 truncate max-w-[420px]">
                {context}
              </div>
            )}
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-base font-bold text-text-base tracking-tight">{title}</h2>
              {badge}
            </div>
            {subtitle && (
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed max-w-2xl">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {readouts.length > 0 && (
        <div className="flex items-center gap-0 divide-x divide-divider rounded-lg bg-card border border-subtle px-1 py-1.5 overflow-x-auto">
          {readouts.map((r) => (
            <div key={r.key} className="flex items-baseline gap-1.5 px-3 shrink-0">
              <span className="text-[9px] uppercase tracking-wider text-text-muted font-bold">{r.label}</span>
              <span className={`text-xs font-sans font-bold ${r.tone || 'text-text-base'}`}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ChromeTab<K extends string> {
  key: K;
  label?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

export function UnderlineTabStrip<K extends string>({
  tabs,
  active,
  onChange,
  tabLabel
}: {
  tabs: ChromeTab<K>[];
  active: K;
  onChange: (key: K) => void;
  tabLabel?: (key: K) => string;
}) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto border-b border-divider shrink-0">
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap transition-colors cursor-pointer ${
              isActive ? 'text-sky-400' : 'text-text-muted hover:text-text-base'
            }`}
          >
            {tab.icon}
            {tabLabel ? tabLabel(tab.key) : tab.label}
            {tab.badge}
            {isActive && <span className="absolute inset-x-2 bottom-0 h-[2px] bg-sky-400 rounded-full" />}
          </button>
        );
      })}
    </div>
  );
}

export interface ProcessSegment<K extends string = string> {
  key: K;
  label: string;
  status: 'COMPLETE' | 'IN_PROGRESS' | 'FAILED' | 'WAITING';
  pct?: number;
  note?: string;
  active?: boolean;
}

const SEGMENT_LABEL: Record<ProcessSegment['status'], string> = {
  COMPLETE: 'text-emerald-300',
  IN_PROGRESS: 'text-amber-300',
  FAILED: 'text-red-300',
  WAITING: 'text-text-muted'
};

const SEGMENT_DOT: Record<ProcessSegment['status'], string> = {
  COMPLETE: 'bg-emerald-400',
  IN_PROGRESS: 'bg-amber-400',
  FAILED: 'bg-red-400',
  WAITING: 'bg-text-muted/60'
};

const SEGMENT_BAR: Record<ProcessSegment['status'], string> = {
  COMPLETE: '#34d399',
  IN_PROGRESS: '#fbbf24',
  FAILED: '#f87171',
  WAITING: '#64748b'
};

export function ProcessStrip<K extends string>({
  segments,
  onSelect,
  flush = false
}: {
  segments: ProcessSegment<K>[];
  onSelect?: (key: K | null) => void;
  flush?: boolean;
}) {
  return (
    <div
      className={`w-full flex items-stretch ${
        flush ? '' : 'bg-card border border-subtle rounded-xl shadow-sm overflow-hidden'
      } shrink-0`}
    >
      {segments.map((s, i) => (
        <button
          key={s.key}
          onClick={() => onSelect?.(s.active ? null : s.key)}
          className={`relative flex-1 min-w-0 px-3 py-2.5 text-left transition-colors cursor-pointer group ${
            s.active ? 'bg-sky-500/10' : 'hover:bg-inner/50'
          } ${i > 0 ? 'border-l border-divider' : ''}`}
        >
          <div className="flex items-center justify-between gap-1 mb-1.5">
            <span className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider truncate ${SEGMENT_LABEL[s.status]}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEGMENT_DOT[s.status]} ${s.status === 'IN_PROGRESS' ? 'animate-pulse' : ''}`} />
              {s.label}
            </span>
            {s.status === 'IN_PROGRESS' && typeof s.pct === 'number' && (
              <span className="text-[9px] font-sans text-text-base shrink-0">{s.pct}%</span>
            )}
          </div>
          <div className="w-full h-1 bg-inner border border-subtle/40 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width:
                  s.status === 'COMPLETE'
                    ? '100%'
                    : s.status === 'IN_PROGRESS'
                      ? `${Math.min(100, s.pct || 0)}%`
                      : '0%',
                background: SEGMENT_BAR[s.status]
              }}
            />
          </div>
          {s.note && <div className="mt-1.5 text-[9px] text-text-muted truncate">{s.note}</div>}
          {s.active && <span className="absolute inset-x-0 top-0 h-[2px] bg-sky-400" />}
        </button>
      ))}
    </div>
  );
}

export function Surface({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-subtle rounded-xl overflow-hidden shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function StatusDot({ tone = 'text-text-muted', pulse = false }: { tone?: string; pulse?: boolean }) {
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone} ${pulse ? 'animate-pulse' : ''}`} />;
}