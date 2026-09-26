import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Send,
  Download,
  ArrowRight,
  AlertTriangle,
  X,
  Database
} from 'lucide-react';
import { supabase } from '../../../services/supabase';
import { SectionLabel, MetaList } from '../chrome';
import { appendStageEventToSupabase } from '../../../services/api/stageEventLedger';
import { computeTrajectorySpan } from './IntakePairingStation';

export interface WebGISPublishGateProps {
  subgrid: string;
  surveyDate: string;
  totalFrames: number;
  pairedRecords?: Array<{
    index: number;
    sourceFilename: string;
    targetFilename: string;
    timestamp: string;
    latitude: number;
    longitude: number;
    heading: number | null;
    isMatched: boolean;
  }>;
  projectSettings?: any;
  onViewOnMap: () => void;
  onViewInDataManagement?: (subgrid?: string) => void;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
  isGuestUser?: boolean;
}

export const WebGISPublishGate: React.FC<WebGISPublishGateProps> = ({
  subgrid,
  surveyDate,
  totalFrames,
  pairedRecords = [],
  projectSettings,
  onViewOnMap,
  onViewInDataManagement,
  addNotification,
  addAuditLog,
  userLabel,
  isGuestUser
}) => {
  const cleanSg = subgrid.trim().toUpperCase();
  const effectiveTotal = pairedRecords.length > 0 ? pairedRecords.length : totalFrames;
  const nasBase = (projectSettings?.nasWorkBasePath || '').replace(/\/+$/, '');
  const deliverablePath = cleanSg ? `${nasBase ? `${nasBase}/` : ''}DELIVERABLES/${cleanSg}/` : '';

  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isPublished, setIsPublished] = useState<boolean>(false);
  const [publishMessage, setPublishMessage] = useState<string>('');
  const [publishError, setPublishError] = useState<string>('');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState<boolean>(false);

  // A record is promotable only when intake actually paired a real source
  // file with a real GPS fix. Nothing is synthesised here: frames without a
  // verified filename or coordinates are counted and reported, never faked.
  const promotableRecords = useMemo(
    () =>
      pairedRecords.filter(
        (r) =>
          r.isMatched &&
          Boolean(r.targetFilename) &&
          typeof r.latitude === 'number' &&
          typeof r.longitude === 'number' &&
          Number.isFinite(r.latitude) &&
          Number.isFinite(r.longitude)
      ),
    [pairedRecords]
  );

  const skippedRecords = pairedRecords.length - promotableRecords.length;

  // Same source-of-truth rule as intake: the metadata `distancetoprevious`
  // column (metres) is authoritative; coordinates are only a fallback.
  const trajectorySpan = useMemo(
    () => computeTrajectorySpan(promotableRecords),
    [promotableRecords]
  );
  const trajectoryDistance = trajectorySpan.km !== null ? trajectorySpan.km * 1000 : null;

  const canPublish = promotableRecords.length > 0 && !isGuestUser;

  const buildRows = () =>
    promotableRecords.map((r) => {
      const capturedAt = /^\d{1,2}:\d{2}(:\d{2})?$/.test((r.timestamp || '').trim())
        ? `${surveyDate}T${r.timestamp.trim().length === 5 ? `${r.timestamp.trim()}:00` : r.timestamp.trim()}Z`
        : null;
      return {
        subgrid: cleanSg,
        filename: r.targetFilename,
        latitude: r.latitude,
        longitude: r.longitude,
        heading: typeof r.heading === 'number' && Number.isFinite(r.heading) ? r.heading : null,
        status: 'yes',
        // The click on this gate is the operator's release authorization.
        qa_status: 'published',
        captured_at: capturedAt,
        geom: {
          type: 'Point',
          coordinates: [r.longitude, r.latitude]
        }
      };
    });

  const handleRequestPublish = () => {
    setPublishError('');

    if (pairedRecords.length === 0) {
      const message =
        'No paired survey records. Complete Stitched Intake & Pairing for this subgrid before publishing — nothing is generated on your behalf.';
      setPublishError(message);
      addNotification?.({ type: 'warning', title: 'No Survey Records Available', message });
      return;
    }

    if (promotableRecords.length === 0) {
      const message = `None of the ${pairedRecords.length} paired record(s) have both a verified filename and a usable latitude/longitude. Fix the pairing or the source GPS data in Stitched Intake & Pairing before publishing.`;
      setPublishError(message);
      addNotification?.({ type: 'warning', title: 'No Publishable Records', message });
      return;
    }

    if (isGuestUser) {
      const message = 'Guest sessions cannot write to the GIS database. Sign in to promote records.';
      setPublishError(message);
      addNotification?.({ type: 'warning', title: 'Promotion Blocked', message });
      return;
    }

    setIsConfirmModalOpen(true);
  };

  const handlePublishToWebGIS = async () => {
    setPublishError('');
    setIsPublishing(true);
    setPublishMessage('');

    try {
      const rows = buildRows();
      const chunkSize = 50;
      const failures: string[] = [];
      let written = 0;

      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from('panoramas').upsert(chunk, { onConflict: 'filename' });
        if (error) {
          failures.push(`rows ${i + 1}-${i + chunk.length}: ${error.message}`);
        } else {
          written += chunk.length;
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `${written} of ${rows.length} rows written, then ${failures.length} chunk(s) failed — ${failures.join('; ')}`
        );
      }

      setIsPublished(true);
      setPublishMessage(
        `${written} record(s) written to public.panoramas.${
          skippedRecords > 0 ? ` ${skippedRecords} record(s) were skipped for lacking a verified filename or GPS fix.` : ''
        }`
      );

      void appendStageEventToSupabase({
        subgrid: cleanSg,
        stage: 'publish',
        event: 'PUBLISHED',
        via: 'operator',
        detail: `${written} record(s) promoted to public.panoramas`,
        counts: { written, paired: pairedRecords.length, skipped: skippedRecords },
        updated_by: userLabel || 'Operator'
      });

      addNotification?.({
        title: `Subgrid ${cleanSg} Published`,
        message: `${written} record(s) written to public.panoramas.`,
        category: 'SYSTEM',
        read: false
      });
      addAuditLog?.(
        'PUBLISH',
        'WebGIS Promotion',
        `Promoted ${written} of ${pairedRecords.length} paired records of ${cleanSg} to public.panoramas as ${userLabel}.`,
        'success'
      );
    } catch (err: any) {
      const message = err?.message || 'Unknown failure';
      setIsPublished(false);
      setPublishError(message);
      addNotification?.({ title: 'WebGIS Promotion Failed', message, category: 'ALERT', read: false });
      addAuditLog?.('PUBLISH', 'WebGIS Promotion Failed', message, 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleDownloadManifest = () => {
    const fileEntries = promotableRecords.map((r) => ({
      index: r.index,
      filename: r.targetFilename,
      latitude: r.latitude,
      longitude: r.longitude,
      heading: r.heading
    }));

    const manifest = {
      schemaVersion: 1,
      subgrid: cleanSg,
      surveyDate,
      totalFrames: fileEntries.length,
      outputFolder: deliverablePath,
      generatedAt: new Date().toISOString(),
      preparedBy: userLabel,
      // No station computes a content hash, so no integrity verdict is claimed.
      integrity: 'not_computed',
      source: 'paired-records',
      excludedIncompleteRecords: skippedRecords,
      files: fileEntries
    };

    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `manifest_${cleanSg}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="pb-3 border-b border-subtle flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-base tracking-tight">
            WebGIS Publication Gate &amp; Deliverable Release
          </h3>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            Release approved, location-linked survey records to the WebGIS.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadManifest}
          disabled={promotableRecords.length === 0}
          className="px-3 py-1.5 bg-inner border border-subtle hover:border-divider text-text-base rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
        >
          <Download size={13} className="text-text-muted" />
          <span>Download manifest.json</span>
        </button>
      </div>

      <div className="space-y-3">
        <SectionLabel>Release Ledger</SectionLabel>
        <MetaList
          items={[
            {
              key: 'subgrid',
              label: 'Subgrid Campaign',
              value: cleanSg ? <span className="font-mono font-bold">{cleanSg}</span> : 'Not set'
            },
            { key: 'date', label: 'Survey Capture Date', value: surveyDate },
            {
              key: 'frames',
              label: 'Paired Records',
              value: <span className="font-mono font-bold">{pairedRecords.length}</span>,
              note: effectiveTotal !== pairedRecords.length ? `Intake total: ${effectiveTotal}` : undefined
            },
            {
              key: 'promotable',
              label: 'Publishable',
              value: <span className="font-mono">{promotableRecords.length}</span>,
              note: skippedRecords > 0 ? `${skippedRecords} without a verified filename/GPS fix will be skipped` : undefined
            },
            {
              key: 'distance',
              label: 'Trajectory Distance',
              value: trajectoryDistance !== null ? `${(trajectoryDistance / 1000).toFixed(2)} km` : 'Not computable',
              note:
                trajectorySpan.source === 'metadata'
                  ? 'summed from metadata distance-to-previous (m → km)'
                  : 'summed from the paired coordinates'
            },
            {
              key: 'path',
              label: 'Deliverables Path',
              value: deliverablePath ? <span className="font-mono text-[11px] break-all">{deliverablePath}</span> : 'Not set'
            },
            {
              key: 'integrity',
              label: 'Integrity Hash',
              value: <span className="text-text-muted">Not computed</span>,
              note: 'no station hashes the delivered objects'
            }
          ]}
        />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap pt-4 border-t border-subtle">
        <div className="min-w-0 flex items-start gap-2.5">
          {!isPublished && publishError && <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />}
          {isPublished ? (
            <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-text-base">
                {isPublished ? 'Promotion Complete' : 'Ready to Publish to WebGIS'}
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                {isPublished
                  ? publishMessage
                  : publishError ||
                    `Upserts ${promotableRecords.length} record(s) into public.panoramas. This database write cannot be previewed or rolled back from here.`}
              </p>
            </div>
          )}
        </div>

        {!isPublished ? (
          <button
            type="button"
            onClick={handleRequestPublish}
            disabled={isPublishing || !canPublish}
            title={
              isGuestUser
                ? 'Guest sessions cannot write to the database'
                : promotableRecords.length === 0
                  ? 'No paired record has both a verified filename and a usable GPS fix'
                  : undefined
            }
            className="px-4 py-2 bg-text-base text-card hover:opacity-90 font-medium text-xs rounded-lg flex items-center gap-2 transition-all cursor-pointer disabled:opacity-40 shrink-0"
          >
            {isPublishing ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-card border-t-transparent rounded-full animate-spin" />
                <span>Writing to PostGIS...</span>
              </>
            ) : (
              <>
                <Send size={14} />
                <span>Publish to WebGIS</span>
              </>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {onViewInDataManagement && (
              <button
                type="button"
                onClick={() => onViewInDataManagement(cleanSg)}
                className="px-3.5 py-2 bg-inner hover:border-divider border border-subtle text-text-base font-medium text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Database size={13} className="text-text-muted" />
                <span>View in Daily Tab</span>
              </button>
            )}
            <button
              type="button"
              onClick={onViewOnMap}
              className="px-4 py-2 bg-text-base text-card hover:opacity-90 font-semibold text-xs rounded-lg flex items-center gap-2 transition-all cursor-pointer shrink-0"
            >
              <span>View on Map</span>
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Pre-flight confirmation modal strictly following global design style */}
      {isConfirmModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-publish-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        >
          <div className="bg-card border border-subtle w-full max-w-lg rounded-xl shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-4 py-3 border-b border-subtle flex items-center justify-between">
              <div>
                <h4 id="confirm-publish-title" className="text-sm font-semibold text-text-base">
                  Confirm WebGIS Promotion
                </h4>
                <p className="text-[11px] text-text-muted">
                  Verify campaign promotion target before committing
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="text-text-muted hover:text-text-base p-1 transition-colors cursor-pointer"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3.5 text-xs">
              <MetaList
                items={[
                  {
                    key: 'subgrid',
                    label: 'Subgrid Campaign',
                    value: <span className="font-mono font-bold">{cleanSg}</span>
                  },
                  {
                    key: 'date',
                    label: 'Metadata Date',
                    value: <span className="font-mono">{surveyDate}</span>
                  },
                  {
                    key: 'target_view',
                    label: 'Target View',
                    value: <span>Data Management &rarr; Daily Tab</span>,
                    note: `promotes as ${cleanSg} (${surveyDate})`
                  },
                  {
                    key: 'target_table',
                    label: 'Database Table',
                    value: <span className="font-mono">public.panoramas</span>,
                    note: 'PostGIS spatial point layer'
                  },
                  {
                    key: 'promotable',
                    label: 'Publishable POIs',
                    value: <span className="font-mono">{promotableRecords.length} records</span>
                  },
                  {
                    key: 'distance',
                    label: 'Track Distance',
                    value: trajectoryDistance !== null ? `${(trajectoryDistance / 1000).toFixed(2)} km` : 'Not computable'
                  }
                ]}
              />

              {skippedRecords > 0 && (
                <div className="flex items-start gap-2 text-[11px] text-text-muted">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5 text-text-muted" />
                  <span>
                    {skippedRecords} record(s) without verified coordinates or filenames will be skipped during promotion.
                  </span>
                </div>
              )}

              <p className="text-[11px] text-text-muted leading-relaxed">
                This data will be promoted to the Data Management table as <strong className="text-text-base font-semibold">{cleanSg}</strong> in the Daily tab, and published to the live WebGIS map layer.
              </p>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-inner border-t border-subtle flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isPublishing}
                className="px-3 py-1.5 bg-card border border-subtle hover:border-divider text-text-base rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsConfirmModalOpen(false);
                  await handlePublishToWebGIS();
                }}
                disabled={isPublishing}
                className="px-4 py-1.5 bg-text-base text-card hover:opacity-90 font-medium text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
              >
                <Send size={13} />
                <span>Confirm &amp; Promote</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
