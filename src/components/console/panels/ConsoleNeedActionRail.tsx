/**
 * The console's "Need Action" report — the operator's alert centre.
 *
 * WHY THIS IS A COMPONENT
 *   It is the single most trust-bearing widget in the console: a green dot
 *   next to "All systems nominal" is the thing a seller looks at first. That
 *   makes it the worst possible place for a three-state bug, and it had one.
 *
 * THE DEFECT THIS EXISTS TO PREVENT
 *   The report was derived from the company list and nothing else. A failed
 *   directory read yields an empty list, so an empty list rendered as
 *   "All systems nominal / No company issues detected" — a Supabase outage
 *   displayed itself as a healthy portfolio, in the one widget whose whole job
 *   is to say something is wrong.
 *
 * THE THREE STATES
 *   loading   the read has not answered. Nothing is claimed.
 *   unknown   the read failed. No company's status was checked, so no issue can
 *             be ruled out either. This is NOT the same as "no issues".
 *   known     the read succeeded. Zero items means zero issues, which is a
 *             measurement.
 */

import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { ConsolePanel } from '../../../utils/consoleRouter';

export interface ActionItem {
  id: string;
  orgId: string;
  title: string;
  subtitle: string;
  severity: 'urgent' | 'warning' | 'info';
  targetPanel: ConsolePanel;
}

interface Props {
  items: ActionItem[];
  isLoading: boolean;
  /** null when the last read was verified. A reason when it was not. */
  error: string | null;
  onSelect: (item: ActionItem) => void;
  onRetry: () => void;
}

export const ConsoleNeedActionRail: React.FC<Props> = ({ items, isLoading, error, onSelect, onRetry }) => {
  const unknown = Boolean(error);

  return (
    <div className="space-y-3 pt-4 border-t border-slate-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-black text-slate-900 tracking-tight">Need Action</span>
          {unknown ? (
            <span
              className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200"
              title="The company directory could not be verified, so the number of issues is unknown."
            >
              —
            </span>
          ) : items.length > 0 ? (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[#0c0d0e] text-white">
              {items.length}
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
              0
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-10 bg-slate-100 rounded-xl" />
            <div className="h-10 bg-slate-100 rounded-xl" />
          </div>
        ) : unknown ? (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200/90 flex items-start gap-2">
            <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-amber-900">Company status unknown</div>
              <div className="text-[10px] text-amber-700 leading-snug mt-0.5">
                The directory could not be verified. No company&rsquo;s status was checked, so no issue can be ruled out.
              </div>
              <div className="text-[10px] text-amber-600 font-mono mt-1 break-words">{error}</div>
              <button
                type="button"
                onClick={onRetry}
                className="mt-1.5 text-[10px] font-bold text-amber-800 underline underline-offset-2 hover:text-amber-950 cursor-pointer"
              >
                Retry the read
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 mt-1" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-slate-800">All systems nominal</div>
              <div className="text-[10px] text-slate-400">No company issues detected</div>
            </div>
          </div>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              className="w-full text-left p-2 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-100 transition-colors flex items-start gap-2 group cursor-pointer"
              title={`Click to navigate to ${item.targetPanel} and resolve`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 mt-1 ${
                  item.severity === 'urgent'
                    ? 'bg-rose-500'
                    : item.severity === 'warning'
                      ? 'bg-amber-500'
                      : 'bg-slate-400'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold text-slate-900 truncate group-hover:text-black">
                  {item.title}
                </div>
                <div className="text-[10px] text-slate-500 truncate">{item.subtitle}</div>
              </div>
              <ChevronRight size={12} className="text-slate-400 shrink-0 mt-1 group-hover:text-slate-700" />
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export default ConsoleNeedActionRail;
