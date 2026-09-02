import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ContentLoadingProps {
  label?: string;
  sublabel?: string;
  variant?: 'table' | 'cards' | 'spinner' | 'inline';
  rows?: number;
  className?: string;
}

export const ContentLoading: React.FC<ContentLoadingProps> = ({
  label = 'Loading data...',
  sublabel,
  variant = 'spinner',
  rows = 5,
  className = ''
}) => {
  if (variant === 'table') {
    return (
      <div className={`bg-card border border-subtle rounded-2xl p-4 shadow-sm space-y-3 animate-panel-enter ${className}`}>
        {label && (
          <div className="flex items-center gap-2 text-xs font-semibold text-text-muted pb-2 border-b border-subtle">
            <Loader2 size={13} className="animate-spin text-sky-400" />
            <span>{label}</span>
          </div>
        )}
        <div className="space-y-2.5">
          {Array.from({ length: rows }).map((_, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3.5 p-3 rounded-xl bg-inner/40 border border-subtle/50 aurora-shimmer"
            >
              <div className="w-5 h-5 rounded-md bg-inner border border-subtle/60 shrink-0" />
              <div className="h-3.5 w-1/4 rounded bg-inner border border-subtle/60" />
              <div className="h-3.5 w-1/6 rounded bg-inner border border-subtle/60" />
              <div className="h-3.5 w-1/5 rounded bg-inner border border-subtle/60" />
              <div className="h-3.5 w-1/8 rounded bg-inner border border-subtle/60 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 animate-panel-enter ${className}`}>
        {Array.from({ length: rows }).map((_, idx) => (
          <div
            key={idx}
            className="bg-card border border-subtle rounded-2xl p-4 space-y-3 aurora-shimmer shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-1/3 rounded bg-inner border border-subtle/60" />
              <div className="w-6 h-6 rounded-full bg-inner border border-subtle/60" />
            </div>
            <div className="h-3 w-3/4 rounded bg-inner/60 border border-subtle/40" />
            <div className="h-8 w-full rounded-xl bg-inner/40 border border-subtle/50 mt-2" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`inline-flex items-center gap-2 text-xs text-text-muted animate-panel-enter ${className}`}>
        <Loader2 size={13} className="animate-spin text-sky-400" />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div className={`bg-card/70 border border-subtle rounded-2xl p-10 sm:p-14 text-center flex flex-col items-center justify-center gap-3.5 shadow-sm animate-panel-enter ${className}`}>
      <div className="relative flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-sky-500/20 border-t-sky-400 animate-spin" />
        <div className="absolute w-6 h-6 rounded-full bg-sky-500/10 blur-sm" />
      </div>
      <div className="space-y-1">
        <h4 className="text-xs font-bold text-text-base tracking-wide">{label}</h4>
        {sublabel && <p className="text-[11px] text-text-muted max-w-sm">{sublabel}</p>}
      </div>
    </div>
  );
};
