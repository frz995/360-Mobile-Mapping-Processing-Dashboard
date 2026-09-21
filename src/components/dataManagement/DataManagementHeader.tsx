import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { UnderlineTabStrip, type ChromeTab } from '../production/chrome';

export interface DataManagementHeaderProps {
  isGuestUser?: boolean;
  publishMessage: { text: string; type: 'success' | 'error' } | null;
  onDismissMessage: () => void;
  tabs: ChromeTab<string>[];
  activeTab: string;
  onTabChange: (tabKey: string) => void;
}

export const DataManagementHeader = ({
  isGuestUser,
  publishMessage,
  onDismissMessage,
  tabs,
  activeTab,
  onTabChange
}: DataManagementHeaderProps) => {
  return (
    <>
      {/* Header Title */}
      <div className="px-1">
        <h2 className="text-base font-bold text-text-base tracking-wide">
          PostgreSQL / PostGIS Data Management
        </h2>
        <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
          Inspect, query, filter, edit, and publish subgrid trajectories and GIS vector layers to production database
        </p>
      </div>

      {/* Guest Read-Only Banner */}
      {isGuestUser && (
        <div className="p-3 bg-card border border-subtle rounded-xl flex items-center gap-3 text-xs text-text-base shadow-sm">
          <AlertTriangle size={15} className="text-sky-400 shrink-0" />
          <span><strong className="text-text-base font-semibold">Guest Mode — Read Only.</strong> You can view all data but editing, uploading, deleting, and publishing are disabled. Sign in with an authorized account to make changes.</span>
        </div>
      )}

      {/* Banner notification */}
      {publishMessage && (
        <div className="p-4 rounded-xl flex items-center justify-between text-xs border font-semibold transition-all shadow-md bg-card border-subtle text-text-base">
          <div className="flex items-center gap-3">
            {publishMessage.type === 'success' ? <CheckCircle size={16} className="text-sky-400 shrink-0" /> : <AlertTriangle size={16} className="text-text-muted shrink-0" />}
            <span>{publishMessage.text}</span>
          </div>
          <button onClick={onDismissMessage} className="text-text-muted hover:text-text-base p-1 cursor-pointer">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Integrated Sub-Tabs Underline Strip */}
      <div className="px-3 pt-2 border-b border-divider bg-card">
        <UnderlineTabStrip
          tabs={tabs}
          active={activeTab}
          onChange={onTabChange}
        />
      </div>
    </>
  );
};
