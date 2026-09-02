import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { subscribeToasts, dismissToast, type ToastItem } from './toast';

const KIND_STYLES: Record<ToastItem['kind'], { icon: React.ReactNode; ring: string; iconColor: string; label: string }> = {
  success: {
    icon: <CheckCircle2 size={17} />,
    ring: 'border-emerald-500/40',
    iconColor: 'text-emerald-400',
    label: 'Success'
  },
  error: {
    icon: <AlertCircle size={17} />,
    ring: 'border-rose-500/40',
    iconColor: 'text-rose-400',
    label: 'Error'
  },
  info: {
    icon: <Info size={17} />,
    ring: 'border-sky-500/40',
    iconColor: 'text-sky-400',
    label: 'Info'
  }
};

export const Toaster: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-[1000] flex flex-col gap-2 w-[min(20rem,calc(100vw-2rem))] pointer-events-none"
    >
      {items.map((item) => {
        const style = KIND_STYLES[item.kind];
        return (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border ${style.ring} bg-card shadow-lg px-3 py-2.5 backdrop-blur-md animate-in fade-in duration-300`}
          >
            <span className={`${style.iconColor} shrink-0 mt-0.5`}>{style.icon}</span>
            <p className="flex-1 text-xs text-text-base leading-snug min-w-0">
              <span className="sr-only">{style.label}: </span>
              {item.message}
            </p>
            <button
              onClick={() => dismissToast(item.id)}
              aria-label="Dismiss notification"
              className="text-text-muted hover:text-text-base shrink-0 mt-0.5 rounded p-0.5 cursor-pointer transition-colors hover:bg-inner"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}