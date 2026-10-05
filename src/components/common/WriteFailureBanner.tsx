import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import {
  subscribeWriteFailures,
  dismissWriteFailure,
  clearWriteFailures,
  type WriteFailure
} from '../../lib/writeFailures';

/**
 * Persistent banner for failed Supabase writes.
 *
 * Sits above the Toaster because these are not transient notifications: a
 * rejected write means an audit decision or a survey record did not persist,
 * and the operator must see that until it is resolved. Theme tokens only.
 */
export const WriteFailureBanner: React.FC = () => {
  const [failures, setFailures] = useState<WriteFailure[]>([]);

  useEffect(() => subscribeWriteFailures(setFailures), []);

  if (failures.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="write-failure-banner"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[1100] w-[min(34rem,calc(100vw-2rem))] flex flex-col gap-2"
    >
      <div className="rounded-xl border border-rose-500/40 bg-card shadow-lg px-3.5 py-3 backdrop-blur-md animate-in fade-in slide-in-from-top-3 duration-300">
        <div className="flex items-start gap-2.5">
          <AlertTriangle size={17} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="text-xs font-semibold text-text-base leading-snug">
              {failures.length === 1
                ? '1 change could not be saved to the database'
                : `${failures.length} changes could not be saved to the database`}
            </p>
            <ul className="space-y-1">
              {failures.map((f) => (
                <li key={f.op} className="flex items-start gap-2 text-[11px] text-text-muted leading-snug">
                  <span className="min-w-0 flex-1">
                    <span className="text-text-base font-medium">{f.label}</span>
                    {f.count > 1 && (
                      <span className="text-text-muted"> ({f.count} failed attempts)</span>
                    )}
                    {f.detail && (
                      <span className="block font-mono text-[10px] text-text-muted/80 break-words">
                        {f.detail}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => dismissWriteFailure(f.op)}
                    aria-label={`Dismiss ${f.label} save failure`}
                    className="text-text-muted hover:text-text-base shrink-0 rounded p-0.5 cursor-pointer transition-colors hover:bg-inner"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-text-muted/80 leading-snug">
              Data shown on screen may not be stored. Re-run the action, or check your connection.
            </p>
          </div>
        </div>
      </div>
      {failures.length > 1 && (
        <button
          onClick={clearWriteFailures}
          className="self-end text-[10px] font-medium text-text-muted hover:text-text-base cursor-pointer transition-colors px-1.5 py-0.5 rounded hover:bg-inner"
        >
          Dismiss all
        </button>
      )}
    </div>
  );
};

export default WriteFailureBanner;
