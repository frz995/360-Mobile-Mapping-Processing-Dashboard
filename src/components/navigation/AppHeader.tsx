import {
  Menu,
  ExternalLink,
  Clock,
  HelpCircle,
  ClipboardList,
  History,
  Calendar,
  X,
  LogOut
} from 'lucide-react';
import { NotificationPopover } from '../NotificationPopover';

import type { Dispatch, SetStateAction } from 'react';
import type { NotificationItem } from '../../types/dashboard';

export interface AppHeaderProps {
  title: string;
  mobileNavOpen: boolean;
  onToggleMobileNav: () => void;
  tourStep: number | null;
  liveWebgisUrl?: string;
  onOpenBriefing: () => void;
  onOpenHelpGuide: () => void;
  isAuditLogOpen: boolean;
  setIsAuditLogOpen: (open: boolean) => void;
  unreadAuditCount: number;
  markAuditLogsAsRead: () => void;
  auditFilterTab: 'ALL' | 'EDIT' | 'DELETE' | 'CREATE' | 'PUBLISH' | 'ERROR';
  setAuditFilterTab: (tab: 'ALL' | 'EDIT' | 'DELETE' | 'CREATE' | 'PUBLISH' | 'ERROR') => void;
  auditDateFilter: string;
  setAuditDateFilter: (val: string) => void;
  availableAuditDates: string[];
  auditLogs: any[];
  isNotifOpen: boolean;
  setIsNotifOpen: (open: boolean) => void;
  notifications: NotificationItem[];
  unreadNotifCount: number;
  setNotifications: Dispatch<SetStateAction<NotificationItem[]>>;
  markNotificationsAsRead: () => void;
  clearNotifications: () => void;
  authSession?: any;
  isGuestUser?: boolean;
  onSignOut: () => void;
}

export const AppHeader = ({
  title,
  mobileNavOpen,
  onToggleMobileNav,
  tourStep,
  liveWebgisUrl,
  onOpenBriefing,
  onOpenHelpGuide,
  isAuditLogOpen,
  setIsAuditLogOpen,
  unreadAuditCount,
  markAuditLogsAsRead,
  auditFilterTab,
  setAuditFilterTab,
  auditDateFilter,
  setAuditDateFilter,
  availableAuditDates,
  auditLogs,
  isNotifOpen,
  setIsNotifOpen,
  notifications,
  unreadNotifCount,
  setNotifications,
  markNotificationsAsRead,
  clearNotifications,
  authSession,
  isGuestUser,
  onSignOut
}: AppHeaderProps) => {
  return (
    <header className="min-h-14 py-2 sm:py-0 px-3 sm:px-4 bg-card border-b border-subtle flex items-center justify-between shrink-0 z-20 gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={onToggleMobileNav}
          aria-label="Open navigation menu"
          aria-expanded={mobileNavOpen}
          className="md:hidden p-2 -ml-1 rounded-lg text-text-muted hover:text-text-base hover:bg-inner transition-colors cursor-pointer shrink-0"
        >
          <Menu size={20} />
        </button>
        <div className="flex flex-col select-none min-w-0">
          <h1 className="text-sm sm:text-base md:text-lg font-bold text-text-base tracking-tight font-sans leading-tight truncate">
            {title}
          </h1>
          <span className="text-[10px] sm:text-[11px] text-text-muted font-normal tracking-normal mt-0.5 hidden sm:inline truncate">
            Spatial Trajectory Processing &amp; Quality Assurance Pipeline
          </span>
          <span className="text-[9px] text-text-muted font-normal tracking-normal mt-0.5 sm:hidden truncate">
            Spatial Pipeline
          </span>
        </div>
      </div>

      {/* Top Right Controls */}
      <div
        className={`flex items-center gap-1.5 sm:gap-3 text-text-muted relative shrink-0 transition-all duration-300 ${
          tourStep === 5
            ? 'ring-2 ring-sky-400/90 shadow-[0_0_35px_rgba(56,189,248,0.4)] z-30 relative bg-app px-2 py-1 rounded-xl'
            : tourStep !== null
            ? 'opacity-30 blur-[1.5px] pointer-events-none'
            : ''
        }`}
      >
        {/* LIVE WEBGIS LINK */}
        <a
          href={liveWebgisUrl || ''}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 hover:text-sky-400 transition-colors cursor-pointer relative flex items-center justify-center text-text-muted"
          title="Open Live WebGIS"
          aria-label="Open Live WebGIS"
        >
          <ExternalLink size={18} />
        </a>

        {/* DAILY OPERATIONS BRIEFING ICON */}
        <button
          onClick={onOpenBriefing}
          className="p-1.5 hover:text-sky-400 transition-colors cursor-pointer relative"
          title="Daily Operations Briefing"
        >
          <Clock size={18} />
        </button>

        {/* HELP & USER GUIDE ICON */}
        <button
          onClick={onOpenHelpGuide}
          className="p-1.5 hover:text-sky-400 transition-colors cursor-pointer relative"
          title="Help & User Guide (Interactive WebMap Tour & Manual)"
        >
          <HelpCircle size={18} />
        </button>

        {/* BATCH AUDIT LOGS ICON */}
        <div className="relative">
          <button
            onClick={() => {
              const nextState = !isAuditLogOpen;
              setIsAuditLogOpen(nextState);
              if (nextState) {
                markAuditLogsAsRead();
              }
              setIsNotifOpen(false);
            }}
            className={`p-1.5 transition-colors cursor-pointer relative ${
              isAuditLogOpen ? 'text-sky-400 bg-inner rounded-lg border border-subtle' : 'hover:text-text-base'
            }`}
            title="Batch & System Audit Logs (Track user edits, creates, deletes, errors)"
          >
            <ClipboardList size={18} />
            {unreadAuditCount > 0 && (
              <span className="absolute -top-1 -right-1.5 px-1 py-0.2 min-w-[15px] h-[15px] rounded-full bg-red-500 text-text-base text-[9px] font-bold flex items-center justify-center shadow-md">
                {unreadAuditCount}
              </span>
            )}
          </button>

          {/* BATCH AUDIT LOGS POPOVER */}
          {isAuditLogOpen && (
            <div className="absolute right-0 top-10 w-96 max-w-[90vw] bg-card border border-subtle rounded-xl shadow-2xl z-50 overflow-hidden text-text-base animate-in fade-in duration-150 backdrop-blur-md">
              <div className="p-3 bg-card border-b border-subtle flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 shrink-0">
                  <History size={15} className="text-sky-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-base">
                    Audit Logs
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-card border border-subtle rounded px-2 py-0.5 text-[10px]">
                    <Calendar size={11} className="text-sky-400 shrink-0" />
                    <select
                      value={auditDateFilter}
                      onChange={(e) => setAuditDateFilter(e.target.value)}
                      className="bg-transparent text-text-base text-[10px] focus:outline-none cursor-pointer"
                      title="Filter audit logs by track-back date"
                    >
                      <option value="" className="bg-card">All Dates</option>
                      {availableAuditDates.map(date => (
                        <option key={date} value={date} className="bg-card">{date}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => setIsAuditLogOpen(false)}
                    className="text-text-muted hover:text-text-base p-0.5 cursor-pointer shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="px-3 py-1.5 bg-card border-b border-subtle flex items-center gap-1 overflow-x-auto text-[10px]">
                {(['ALL', 'EDIT', 'DELETE', 'CREATE', 'PUBLISH', 'ERROR'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setAuditFilterTab(tab)}
                    className={`px-2 py-0.5 rounded font-medium transition-all cursor-pointer whitespace-nowrap border ${
                      auditFilterTab === tab
                        ? 'bg-card text-text-base border-subtle'
                        : 'text-text-muted border-transparent hover:text-text-base hover:bg-inner'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Audit Logs List */}
              <div className="max-h-80 overflow-y-auto divide-y divide-[rgba(255,255,255,0.06)] p-1">
                {auditLogs.filter(item => {
                  if (auditFilterTab !== 'ALL' && item.type !== auditFilterTab) return false;
                  if (auditDateFilter && !item.timestamp.toLowerCase().includes(auditDateFilter.toLowerCase())) return false;
                  return true;
                }).length > 0 ? (
                  auditLogs
                    .filter(item => {
                      if (auditFilterTab !== 'ALL' && item.type !== auditFilterTab) return false;
                      if (auditDateFilter && !item.timestamp.toLowerCase().includes(auditDateFilter.toLowerCase())) return false;
                      return true;
                    })
                    .map(log => {
                      const badgeColor =
                        log.type === 'CREATE' ? 'bg-inner text-sky-300 border-subtle' :
                          log.type === 'EDIT' ? 'bg-inner text-text-base border-subtle' :
                            log.type === 'DELETE' ? 'bg-inner text-rose-300 border-subtle' :
                              log.type === 'PUBLISH' ? 'bg-sky-950/60 text-sky-300 border-sky-800/60' :
                                log.type === 'ERROR' ? 'bg-rose-950/60 text-rose-300 border-rose-900/60' :
                                  'bg-inner text-text-base border-subtle';

                      return (
                        <div key={log.id} className="p-2.5 hover:bg-inner transition-colors rounded-lg space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className={`px-1.5 py-0.2 rounded font-semibold uppercase border ${badgeColor}`}>
                              {log.type}
                            </span>
                            <span className="text-text-muted text-[10px]">{log.timestamp}</span>
                          </div>
                          <div className="text-xs font-medium text-text-base">{log.title}</div>
                          <div className="text-[11px] text-text-muted">{log.details}</div>
                          <div className="text-[9px] text-text-muted text-right">User: <span className="text-text-base font-medium">{log.user}</span></div>
                        </div>
                      );
                    })
                ) : (
                  <div className="p-8 text-center text-text-muted text-xs">
                    No audit log records found for filter "{auditFilterTab}"{auditDateFilter ? ` on date ${auditDateFilter}` : ''}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* NOTIFICATIONS ICON */}
        <NotificationPopover
          isOpen={isNotifOpen}
          notifications={notifications}
          unreadCount={unreadNotifCount}
          setNotifications={setNotifications}
          onToggleOpen={() => {
            const nextState = !isNotifOpen;
            setIsNotifOpen(nextState);
            if (nextState) {
              markNotificationsAsRead();
            }
            setIsAuditLogOpen(false);
          }}
          onClose={() => setIsNotifOpen(false)}
          clearAll={clearNotifications}
        />

        <div className="flex items-center gap-2 pl-2 border-l border-subtle">
          {/* User Avatar Initial */}
          <div
            className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold ${
              isGuestUser ? 'bg-amber-900/40 border-amber-700 text-amber-400' : 'bg-inner border-subtle text-sky-400'
            }`}
            title={`Logged in as ${authSession?.user?.email || (isGuestUser ? 'Guest' : 'User')}`}
          >
            {isGuestUser
              ? 'G'
              : (authSession?.user?.email?.charAt(0).toUpperCase() ||
                 authSession?.user?.user_metadata?.full_name?.charAt(0).toUpperCase() ||
                 'U')}
          </div>
          {isGuestUser && (
            <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-md">
              Guest
            </span>
          )}
          <button
            onClick={onSignOut}
            className="p-1 hover:text-red-400 transition-colors"
            title="Sign Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
};
