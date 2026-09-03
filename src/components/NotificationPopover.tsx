import type { Dispatch, SetStateAction } from 'react';
import { Activity, Bell, Clock, Trash2, UploadCloud, X } from 'lucide-react';
import type { NotificationItem } from '../types/dashboard';

interface NotificationPopoverProps {
  isOpen: boolean;
  notifications: NotificationItem[];
  unreadCount: number;
  setNotifications: Dispatch<SetStateAction<NotificationItem[]>>;
  onToggleOpen: () => void;
  onClose: () => void;
  clearAll: () => void;
}

export function NotificationPopover({
  isOpen,
  notifications,
  unreadCount,
  setNotifications,
  onToggleOpen,
  onClose,
  clearAll
}: NotificationPopoverProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggleOpen}
        className={`p-1.5 transition-colors cursor-pointer relative ${isOpen ? 'text-sky-400 bg-inner rounded-lg border border-subtle' : 'hover:text-text-base'
          }`}
        title="Notifications (Publish Progress & Pending Tasks)"
      >
        <Activity size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1.5 px-1 py-0.2 min-w-[15px] h-[15px] rounded-full bg-red-500 text-text-base text-[9px] font-bold flex items-center justify-center shadow-md">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-10 w-96 max-w-[90vw] bg-card border border-subtle rounded-xl shadow-2xl z-50 overflow-hidden text-text-base animate-in fade-in duration-150 backdrop-blur-md">
          <div className="p-3 bg-card border-b border-subtle flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell size={15} className="text-sky-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-text-base">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="bg-inner text-sky-400 border border-subtle text-[10px] font-medium px-1.5 py-0.2 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-text-muted hover:text-rose-400 text-[10px] font-medium transition-colors flex items-center gap-1 cursor-pointer"
                  title="Clear all notifications"
                >
                  <Trash2 size={11} /> Clear All
                </button>
              )}
              <button
                onClick={onClose}
                className="text-text-muted hover:text-text-base p-0.5 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-[rgba(255,255,255,0.06)] p-1">
            {notifications.length > 0 ? (
              notifications.map(notif => {
                const isPublish = notif.category === 'PUBLISH';
                const isPending = notif.category === 'PENDING';

                return (
                  <div
                    key={notif.id}
                    className={`p-3 transition-colors rounded-lg space-y-1.5 relative group ${!notif.read ? 'bg-card border-l-2 border-sky-400' : 'hover:bg-inner'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {isPublish ? (
                          <span className="bg-sky-950/60 text-sky-300 border border-sky-800/60 px-1.5 py-0.2 rounded text-[9px] font-medium">
                            PUBLISH SUCCESS
                          </span>
                        ) : isPending ? (
                          <span className="bg-inner text-text-base border border-subtle px-1.5 py-0.2 rounded text-[9px] font-medium">
                            PENDING TASK
                          </span>
                        ) : (
                          <span className="bg-inner text-text-muted border border-subtle px-1.5 py-0.2 rounded text-[9px] font-medium">
                            {notif.category}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-text-muted">{notif.timestamp}</span>
                        <button
                          onClick={() => {
                            const strId = String(notif.id);
                            try {
                              const currentRead = new Set(JSON.parse(localStorage.getItem('app_read_notif_ids') || '[]'));
                              currentRead.add(strId);
                              currentRead.add(`notif-${strId}`);
                              localStorage.setItem('app_read_notif_ids', JSON.stringify(Array.from(currentRead)));
                            } catch (_) { }
                            setNotifications(prev => prev.filter(n => String(n.id) !== strId));
                          }}
                          className="text-text-muted hover:text-rose-400 p-0.5 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                          title="Dismiss notification"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="text-xs font-medium text-text-base flex items-center gap-1.5">
                      {isPublish ? <UploadCloud size={14} className="text-sky-400 shrink-0" /> : isPending ? <Clock size={14} className="text-text-muted shrink-0" /> : <Activity size={14} className="text-sky-400 shrink-0" />}
                      <span>{notif.title}</span>
                    </div>

                    <p className="text-[11px] text-text-muted leading-snug">{notif.message}</p>

                    {isPublish && (
                      <div className="pt-1.5 border-t border-subtle flex items-center justify-between text-[10px]">
                        <span className="text-text-muted">Total Data Included: <strong className="text-text-base">{notif.totalItems || 1} subgrid(s)</strong></span>
                        <span className="text-text-muted">Date Published: <strong className="text-sky-400">{notif.timestamp}</strong></span>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-text-muted text-xs">
                No notifications available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
