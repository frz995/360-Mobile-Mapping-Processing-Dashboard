import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

export interface HelpGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartTour: () => void;
  initialTab?: 'map' | 'panorama' | 'data' | 'audit' | 'shortcuts';
}

export const HelpGuideModal = ({
  isOpen,
  onClose,
  onStartTour,
  initialTab = 'map'
}: HelpGuideModalProps) => {
  const [helpGuideTab, setHelpGuideTab] = useState<'map' | 'panorama' | 'data' | 'audit' | 'shortcuts'>(initialTab);

  useEffect(() => {
    if (initialTab) setHelpGuideTab(initialTab);
  }, [initialTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-app backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-card border border-subtle rounded-xl w-full max-w-3xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden text-text-base">

        {/* Modal Header */}
        <div className="p-4 bg-card border-b border-subtle flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-text-base tracking-tight">
              User Guide & System Manual
            </h2>
            <p className="text-[11px] text-text-muted mt-0.5">
              360° WebGIS Mobile Mapping Operations Manual
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onStartTour();
              }}
              className="px-3 py-1.5 bg-card hover:bg-inner text-text-base hover:text-text-base border border-subtle text-xs font-semibold rounded-lg transition-all cursor-pointer"
              title="Start guided step-by-step tour"
            >
              Start Interactive Tour
            </button>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-base p-1 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="px-4 py-2 bg-card border-b border-subtle flex items-center gap-1.5 overflow-x-auto text-xs">
          {[
            { id: 'map', label: 'Interactive Map' },
            { id: 'panorama', label: '360° Street View' },
            { id: 'data', label: 'Daily Progress & DB' },
            { id: 'audit', label: 'Notifications & Audit' },
            { id: 'shortcuts', label: 'Keyboard Shortcuts' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setHelpGuideTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer whitespace-nowrap border font-medium ${
                helpGuideTab === tab.id
                  ? 'bg-card text-text-base border-subtle'
                  : 'text-text-muted border-transparent hover:text-text-base hover:bg-inner'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Modal Body Content */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1 text-xs text-text-base leading-relaxed">
          {helpGuideTab === 'map' && (
            <div className="space-y-3">
              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">1. Subgrid Selection &amp; Key Normalization</h4>
                <p className="text-text-muted">
                  Clicking any subgrid on the map or inside the control table isolates all trajectory points for that region. Subgrid keys are automatically normalized (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">XX-YY &rarr; XXYY</code>) across CSV imports and database queries.
                </p>
              </div>

              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">2. Date Filter Behavior</h4>
                <p className="text-text-muted">
                  Selecting a capture date filters trajectory frames associated with that specific survey run while preserving concurrent subgrid boundary geometry and vector layer overlays.
                </p>
              </div>

              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">3. WebGIS Layer Controls &amp; Base Maps</h4>
                <p className="text-text-muted">
                  Use the map layer panel to toggle subgrid bounding boxes, trajectory polyline features, 360° panorama capture nodes, and high-voltage electrical grid lines.
                </p>
              </div>
            </div>
          )}

          {helpGuideTab === 'panorama' && (
            <div className="space-y-3">
              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">1. Equirectangular 360° VR Camera Controls</h4>
                <p className="text-text-muted">
                  Click and drag inside the 360° viewer to rotate pitch and yaw. Use the step controls or keyboard arrow keys to navigate forward/backward along vehicle trajectory frames.
                </p>
              </div>

              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">2. Defect Inspection &amp; QA Benchmark Verification</h4>
                <p className="text-text-muted">
                  Frames with flagged defects (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">Blurry Frame, Lens Obstruction, GPS Offset</code>) display automated defect questionnaires. Operator YES/NO validations immediately update defect status in Supabase.
                </p>
              </div>
            </div>
          )}

          {helpGuideTab === 'data' && (
            <div className="space-y-3">
              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">1. Masterlist Trajectories vs Preserved Daily Passes</h4>
                <p className="text-text-muted">
                  Toggle between <strong>Masterlist Aggregated Trajectories</strong> (consolidates subgrid survey distance &amp; POIs) and <strong>Preserved Daily Survey Runs</strong> (retains unique survey dates &amp; PIC operator history).
                </p>
              </div>

              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">2. Passcode-Protected Admin Edits &amp; Deletions</h4>
                <p className="text-text-muted">
                  Table records can be edited or deleted. Record deletions require security passcode verification to prevent unauthorized data loss and ensure audit trail integrity.
                </p>
              </div>

              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">3. Real-Time Supabase PostgreSQL Sync</h4>
                <p className="text-text-muted">
                  Click <strong>Publish All to Database</strong> to synchronize processed subgrid trajectories directly to Supabase production tables with live notifications.
                </p>
              </div>
            </div>
          )}

          {helpGuideTab === 'audit' && (
            <div className="space-y-3">
              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">1. Chronological Activity Audit Logs</h4>
                <p className="text-text-muted">
                  Click the audit log icon in top header to view logged user actions (create, edit, delete, publish, error) with date track-back filtering and user signatures.
                </p>
              </div>

              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">2. Real-Time Publish Notifications</h4>
                <p className="text-text-muted">
                  The notification bell alerts you whenever survey runs or masterlists are published to Supabase, showing total items updated and timestamp.
                </p>
              </div>

              <div className="bg-card p-3.5 rounded-lg border border-subtle space-y-1">
                <h4 className="font-semibold text-text-base text-xs">3. Executive Client PDF Deliverable Generator</h4>
                <p className="text-text-muted">
                  Export one-click PDF QA summary reports containing subgrid defect pass rates, total surveyed kilometers, and client SLA verification sign-offs.
                </p>
              </div>
            </div>
          )}

          {helpGuideTab === 'shortcuts' && (
            <div className="space-y-1.5">
              {[
                { keys: ['?'], action: 'Open this keyboard shortcuts / help guide' },
                { keys: ['Esc'], action: 'Close any open modal, dialog or help guide' },
                { keys: ['Tab'], action: 'Move focus between panels, toolbars and tables' },
                { keys: ['↑ ↓'], action: 'Navigate rows within the active data table' },
                { keys: ['← →'], action: 'Step forward / backward through 360° trajectory frames' },
                { keys: ['Enter'], action: 'Confirm the focused action or selection' },
                { keys: ['Space'], action: 'Toggle selection / check the focused checkbox' }
              ].map((row, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-card p-3 rounded-lg border border-subtle">
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {row.keys.map(k => (
                      <kbd key={k} className="px-2 py-1 bg-inner border border-subtle rounded-md font-mono text-[10px] text-text-base shadow-sm">{k}</kbd>
                    ))}
                  </div>
                  <span className="text-text-muted">{row.action}</span>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-text-muted">
                Press <kbd className="px-1.5 py-0.5 bg-inner border border-subtle rounded font-mono text-[10px]">?</kbd> from the main dashboard to reopen this guide at any time.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
