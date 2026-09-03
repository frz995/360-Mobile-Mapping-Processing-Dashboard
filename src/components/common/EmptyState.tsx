import React from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  hint,
  action,
  icon: Icon = Inbox,
  className = ''
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-10 text-center animate-panel-enter ${className}`}
    >
      <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-inner border border-subtle text-text-muted">
        <Icon size={22} strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text-base">{title}</p>
        {hint && <p className="text-xs text-text-muted max-w-sm mx-auto leading-relaxed">{hint}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
};
