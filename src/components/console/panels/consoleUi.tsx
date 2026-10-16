/**
 * Local primitives for the Seller Partner Console.
 *
 * WHY THESE LIVE HERE RATHER THAN IN `src/components/common/`
 *   The console deliberately runs outside the app's design system: it strips
 *   `data-theme` from the document and renders its own fixed light shell (see
 *   `SellerConsolePage.tsx`). `themes.css` carries a dedicated
 *   `#seller-console-root` isolation block for exactly that reason. Pulling
 *   console-styled components into `common/` would import the token-based
 *   system the console is built to avoid, so these are scoped to the console
 *   surface and to nothing else.
 *
 * WHY NOT `window.confirm`
 *   Tenant deletion used `window.confirm`, which cannot be styled, cannot show
 *   what is about to happen to which company, and is suppressed in some embedded
 *   contexts — where it silently returns `false` and the operator is left
 *   believing a deletion was declined rather than never attempted.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle } from 'lucide-react';
import { useDialogEscape } from '../../common/dialog';

/** Panel heading. The title is the panel name, not the word "Dashboard". */
export const PanelHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({
  title,
  subtitle,
  actions
}) => (
  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-100">
    <div className="min-w-0">
      <h2 className="text-base font-black text-slate-900 tracking-tight">{title}</h2>
      {subtitle ? <p className="text-xs text-slate-500 font-medium mt-0.5">{subtitle}</p> : null}
    </div>
    {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
  </div>
);

/** White surface matching the console's card treatment. */
export const PanelCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`console-card-white p-7 rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] ${className}`}>
    {children}
  </div>
);

/**
 * A metric tile.
 *
 * `value` is pre-formatted by the caller's `formatMetric`, which renders an
 * unmeasured figure as an em dash. The tile does not decide what is unknown —
 * it is handed the answer, which keeps the null rule in one place.
 */
export const KpiCard: React.FC<{
  label: string;
  value: string;
  caption: string;
  icon?: React.ReactNode;
  /** Rendered dark. Used for at most one tile per panel. */
  tone?: 'light' | 'dark';
}> = ({ label, value, caption, icon, tone = 'light' }) => {
  const dark = tone === 'dark';
  return (
    <div
      style={{ backgroundColor: dark ? '#0c0d0e' : '#ffffff', color: dark ? '#ffffff' : '#0f172a' }}
      className={`${dark ? 'console-card-dark' : 'console-card-white'} p-6 rounded-3xl border border-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col justify-between`}
    >
      <div>
        <span className={`text-3xl font-black tracking-tight block ${dark ? 'text-white' : 'text-slate-900'}`}>
          {value}
        </span>
        <span className={`text-xs font-medium mt-1 block ${dark ? 'text-slate-400' : 'text-slate-400'}`}>{label}</span>
      </div>
      <div
        className={`flex items-center justify-between mt-5 pt-3 border-t ${
          dark ? 'border-white/10' : 'border-slate-100/80'
        }`}
      >
        {icon ? (
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              dark ? 'bg-white/5 text-slate-300' : 'bg-slate-50 border border-slate-100 text-slate-700'
            }`}
          >
            {icon}
          </div>
        ) : (
          <span />
        )}
        <span className={`text-[11px] font-semibold ${dark ? 'text-slate-400' : 'text-slate-400'}`}>{caption}</span>
      </div>
    </div>
  );
};

/** The console's primary action button. */
export const PrimaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  icon?: React.ReactNode;
}> = ({ children, onClick, type = 'button', disabled, title, icon }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{ borderRadius: '12px', backgroundColor: '#0c0d0e', color: '#ffffff' }}
    className="px-4 py-1.5 text-xs font-bold hover:bg-black flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {icon}
    <span>{children}</span>
  </button>
);

export const SecondaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  icon?: React.ReactNode;
}> = ({ children, onClick, disabled, title, icon }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{ borderRadius: '12px', backgroundColor: '#ffffff', color: '#334155' }}
    className="px-3.5 py-1.5 text-xs font-semibold border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {icon}
    <span>{children}</span>
  </button>
);

/**
 * A blocking confirmation.
 *
 * `body` is required because the operator has to be told which record is about
 * to change. A generic "Are you sure?" on a screen whose whole job is managing
 * several companies at once is how the wrong company gets deleted.
 */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, body, confirmLabel = 'Confirm', destructive, busy, onConfirm, onCancel }) => {
  useDialogEscape(onCancel);

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const dialog = (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs overflow-y-auto p-4 sm:p-6 flex min-h-full items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-console-modal="true"
        style={{ colorScheme: 'light' }}
        className="bg-white border border-slate-200 rounded-2xl max-w-md w-full shadow-2xl my-auto shrink-0 relative"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-slate-900 tracking-tight">{title}</h3>
              <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">{body}</p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              style={{ backgroundColor: destructive ? '#e11d48' : '#0c0d0e', borderRadius: '12px' }}
              className="px-5 py-2 rounded-xl text-xs font-bold text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return dialog;
  return createPortal(dialog, document.body);
};

/**
 * The console's failure surface for a panel-level read.
 *
 * Says "this could not be verified", not "there is nothing here", because those
 * demand opposite responses from the operator.
 */
export const ReadFailure: React.FC<{
  reason: string;
  /** What failed, so the operator is not left guessing which list is empty. */
  subject: string;
  onRetry?: () => void;
  retryLabel?: string;
}> = ({ reason, subject, onRetry, retryLabel = 'Retry Query' }) => (
  <div className="py-12 px-6 text-center">
    <AlertTriangle size={24} className="mx-auto mb-2 text-rose-500" />
    <div className="font-bold text-sm text-slate-800">This {subject} could not be verified</div>
    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
      This is a failed query, not an empty list. Every figure on this page is unknown until it succeeds.
    </p>
    <p className="text-[11px] text-rose-600 mt-2 font-mono break-words max-w-sm mx-auto">{reason}</p>
    {onRetry ? (
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 px-4 py-2 rounded-xl text-xs font-bold bg-[#0c0d0e] hover:bg-black text-white transition-colors cursor-pointer"
      >
        {retryLabel}
      </button>
    ) : null}
  </div>
);

/** Modal frame shared by the console's forms. */
export const ModalShell: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, onClose, children }) => {
  useDialogEscape(onClose);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const modal = (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs overflow-y-auto p-4 sm:p-6 flex min-h-full items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-console-modal="true"
        style={{ colorScheme: 'light' }}
        className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl my-auto shrink-0 relative"
      >
        <div className="px-6 py-4.5 bg-[#121316] text-white flex items-center justify-between shrink-0">
          <h3 className="font-bold text-sm flex items-center gap-2">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
};

export const Field: React.FC<{ label: string; children: React.ReactNode; required?: boolean }> = ({
  label,
  children,
  required
}) => (
  <div>
    <label className="block text-xs font-bold text-slate-700 mb-1">
      {label}
      {required ? ' *' : ''}
    </label>
    {children}
  </div>
);

export const inputClass =
  'w-full px-3.5 py-2 rounded-xl text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-black transition-colors [color-scheme:light]';

export const selectClass =
  'w-full px-3.5 py-2 rounded-xl text-xs bg-white border border-slate-300 text-slate-900 focus:outline-none focus:border-black transition-colors [color-scheme:light]';