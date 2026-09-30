import React from 'react';

/* =====================================================================
   Production Workspace console chrome.
   Token-driven across all palettes and the light-mode surface layer.
   ===================================================================== */

interface MastheadReadout {
  key: string;
  label: string;
  value: string;
  tone?: string;
}

interface MastheadProps {
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
  const tabsRef = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    const currentIndex = tabs.findIndex((t) => t.key === active);
    if (currentIndex < 0) return;
    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    onChange(tabs[nextIndex].key);
    tabsRef.current[String(tabs[nextIndex].key)]?.focus();
  };

  return (
    <div role="tablist" aria-label="Panel tabs" className="flex items-stretch gap-1 overflow-x-auto border-b border-divider shrink-0">
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            ref={(el) => { tabsRef.current[String(tab.key)] = el; }}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={onKeyDown}
            className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap transition-all duration-200 ease-out cursor-pointer ${
              isActive ? 'text-text-base' : 'text-text-muted hover:text-text-base'
            }`}
          >
            {tab.icon}
            {tabLabel ? tabLabel(tab.key) : tab.label}
            {tab.badge}
            {isActive && (
              <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full animate-[tabUnderlineBreathable_0.22s_cubic-bezier(0.16,1,0.3,1)_forwards]" style={{ backgroundColor: 'var(--text-primary)', boxShadow: '0 0 8px color-mix(in srgb, var(--text-primary) 70%, transparent)' }} />
            )}
          </button>
        );
      })}
    </div>
  );
}


/* ── Flat tab-content primitives (Theme Packages canvas idiom) ─────────────
   Sections are a small uppercase label + bare content, separated by
   whitespace. No card-in-card stacks; secondary controls are text links. */

export function SectionLabel({
  icon,
  children,
  note,
  actions
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  note?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5 min-w-0">
        {icon}
        <span className="truncate">{children}</span>
        {note && <span className="font-mono text-[10px] tracking-normal normal-case">{note}</span>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}

interface MetaRowItem {
  key: string;
  label: string;
  value?: React.ReactNode;
  note?: React.ReactNode;
  actions?: React.ReactNode;
}

export function MetaList({ items, className = '' }: { items: MetaRowItem[]; className?: string }) {
  return (
    <div className={`rounded-lg border border-subtle divide-y divide-[var(--divider)] overflow-hidden ${className}`}>
      {items.map((row) => (
        <div key={row.key} className="flex items-center gap-x-3 gap-y-1 px-3 py-2.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted w-28 sm:w-40 shrink-0">
            {row.label}
          </span>
          <div className="flex-1 min-w-0 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
            {row.value !== undefined && row.value !== null && (
              <span className="text-xs font-medium text-text-base">{row.value}</span>
            )}
            {row.note !== undefined && row.note !== null && (
              <span className="text-[11px] text-text-muted min-w-0 truncate">{row.note}</span>
            )}
          </div>
          {row.actions && <div className="flex items-center gap-3 shrink-0 ml-auto">{row.actions}</div>}
        </div>
      ))}
    </div>
  );
}

export function TextAction({
  icon,
  children,
  onClick,
  disabled = false,
  title
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="text-[11px] text-text-muted hover:text-text-base disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 transition-colors cursor-pointer"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function StatusDot({ tone = 'text-text-muted', pulse = false }: { tone?: string; pulse?: boolean }) {
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone} ${pulse ? 'animate-pulse' : ''}`} />;
}
