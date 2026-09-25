import React, { useState, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  FileQuestion
} from 'lucide-react';
import { PhotoSphereViewerComponent } from '../../PhotoSphereViewerComponent';
import { resolvePanoramaUrl } from '../../../services/storageUrls';
import { SectionLabel, MetaList, TextAction } from '../chrome';

export interface QAAuditStationProps {
  subgrid: string;
  surveyDate: string;
  totalFrames: number;
  projectSettings?: any;
  pairedRecords?: Array<{
    index: number;
    sourceFilename: string;
    targetFilename: string;
    timestamp: string;
    latitude: number;
    longitude: number;
    heading: number | null;
    isMatched: boolean;
    /** Only present when a real sharpness metric was measured upstream. */
    sharpness?: number;
  }>;
  onApproved: () => void;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
  isGuestUser?: boolean;
}

export interface DefectRecord {
  frameIdx: number;
  frameName: string;
  defectType: 'BLUR' | 'TILT' | 'OBSTRUCTION' | 'STITCH_SEAM' | 'GPS_JUMP';
  notes: string;
  timestamp: string;
}

const SHARPNESS_OUTLIER_THRESHOLD = 72;

const DEFECT_BUTTON_CLASS =
  'px-2.5 py-1.5 bg-inner border border-subtle hover:border-amber-500/40 text-text-base rounded-lg text-[11px] font-medium transition-colors text-left cursor-pointer';

const DEFECT_OPTIONS: Array<{ type: DefectRecord['defectType']; label: string }> = [
  { type: 'BLUR', label: 'Blurry Frame' },
  { type: 'TILT', label: 'Camera Tilt' },
  { type: 'OBSTRUCTION', label: 'Obstruction' },
  { type: 'STITCH_SEAM', label: 'Stitch Seam' }
];

export const QAAuditStation: React.FC<QAAuditStationProps> = ({
  subgrid,
  totalFrames,
  projectSettings,
  pairedRecords = [],
  onApproved,
  addNotification,
  addAuditLog,
  userLabel
}) => {
  const cleanSg = subgrid.trim().toUpperCase();
  const batchTotal = pairedRecords.length > 0 ? pairedRecords.length : totalFrames;

  const [currentFrameIdx, setCurrentFrameIdx] = useState<number | null>(null);
  const [samplingMode, setSamplingMode] = useState<'ALL' | 'OUTLIERS' | 'SAMPLE'>('SAMPLE');
  const [defects, setDefects] = useState<DefectRecord[]>([]);

  // Frame list is built from real paired survey records only. Sharpness stays
  // undefined unless a metric was actually measured and stored upstream.
  const frameList = useMemo(
    () =>
      pairedRecords.map((p) => ({
        idx: p.index,
        filename: p.targetFilename,
        sharpness: typeof p.sharpness === 'number' && Number.isFinite(p.sharpness) ? p.sharpness : null
      })),
    [pairedRecords]
  );

  const measuredCount = useMemo(
    () => frameList.filter((f) => f.sharpness !== null).length,
    [frameList]
  );

  const activeFrameSubset = useMemo(() => {
    if (frameList.length === 0) return [];
    if (samplingMode === 'OUTLIERS') {
      // Only frames with a real measured score can be judged as outliers.
      return frameList.filter((f) => f.sharpness !== null && f.sharpness < SHARPNESS_OUTLIER_THRESHOLD);
    }
    if (samplingMode === 'SAMPLE') {
      return frameList.filter((_, i) => i % 10 === 0);
    }
    return frameList;
  }, [samplingMode, frameList]);

  const currentFrame = useMemo(() => {
    if (frameList.length === 0) return null;
    return frameList.find((f) => f.idx === currentFrameIdx) || activeFrameSubset[0] || frameList[0];
  }, [frameList, activeFrameSubset, currentFrameIdx]);

  const avgSharpness = useMemo(() => {
    const scored = frameList.filter((f) => f.sharpness !== null) as Array<{ sharpness: number }>;
    if (scored.length === 0) return null;
    return (scored.reduce((acc, f) => acc + f.sharpness, 0) / scored.length).toFixed(1);
  }, [frameList]);

  const panoramaUrl = useMemo(
    () => (currentFrame ? resolvePanoramaUrl(currentFrame.filename, projectSettings, { subgrid: cleanSg }) : ''),
    [currentFrame, projectSettings, cleanSg]
  );

  const subsetNotice = useMemo(() => {
    if (frameList.length === 0) return null;
    if (samplingMode === 'OUTLIERS') {
      if (measuredCount === 0) {
        return `Outlier review needs measured sharpness scores. None are stored for ${cleanSg}, so no frame can be classified.`;
      }
      if (activeFrameSubset.length === 0) {
        return `No frame scored below ${SHARPNESS_OUTLIER_THRESHOLD}. Switch to another sampling mode to keep inspecting.`;
      }
      return null;
    }
    return null;
  }, [frameList.length, samplingMode, measuredCount, activeFrameSubset.length, cleanSg]);

  const step = (delta: number) => {
    if (activeFrameSubset.length === 0) return;
    const currentPos = activeFrameSubset.findIndex((f) => f.idx === currentFrame?.idx);
    const base = currentPos >= 0 ? currentPos : 0;
    const nextPos = (base + delta + activeFrameSubset.length) % activeFrameSubset.length;
    setCurrentFrameIdx(activeFrameSubset[nextPos].idx);
  };

  const handleFlagDefect = (type: DefectRecord['defectType']) => {
    if (!currentFrame) return;
    const newDefect: DefectRecord = {
      frameIdx: currentFrame.idx,
      frameName: currentFrame.filename,
      defectType: type,
      notes: `Flagged during ${samplingMode} review.`,
      timestamp: new Date().toISOString()
    };
    setDefects((prev) => [...prev, newDefect]);

    addNotification?.({
      title: `Defect Flagged: ${currentFrame.filename}`,
      message: `Categorized as ${type}. Logged to QA defect ledger.`,
      category: 'SYSTEM',
      read: false
    });

    addAuditLog?.('CREATE', 'QA Defect Flagged', `${type} on ${currentFrame.filename}`, 'warning');
  };

  const handleSignOff = () => {
    addNotification?.({
      title: `Subgrid ${cleanSg} Approved!`,
      message: `QA sign-off completed by ${userLabel}. Ready for WebGIS publication.`,
      category: 'SYSTEM',
      read: false
    });
    addAuditLog?.(
      'EDIT',
      'QA Subgrid Sign-off',
      `Approved ${cleanSg} with ${defects.length} defect notes. Automated privacy and nadir checks were not run.`,
      'success'
    );
    onApproved();
  };

  if (frameList.length === 0) {
    return (
      <div className="flex flex-col gap-3 py-12 items-center text-center">
        <FileQuestion size={32} className="text-text-muted" />
        <h3 className="text-sm font-semibold text-text-base tracking-tight">No Survey Frames Available For QA Inspection</h3>
        <p className="text-xs text-text-muted max-w-md">
          Pair and load real survey data in Stitched Intake &amp; Pairing for{' '}
          <span className="font-mono text-text-base">{cleanSg || 'the active subgrid'}</span> to inspect its frames.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="pb-3 border-b border-subtle flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-base tracking-tight">
            Acceptance QA &amp; 360° Inspection
          </h3>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            Inspect final processed equirectangular frames from{' '}
            <span className="font-mono text-text-base">/05_Final/{cleanSg}/</span> before publication. Automated
            privacy and nadir-cap checks are not wired to this station, so every result below is either measured or
            reported as unmeasured.
          </p>
        </div>

        <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-text-muted shrink-0">
          Sampling
          <select
            value={samplingMode}
            onChange={(e) => setSamplingMode(e.target.value as any)}
            className="bg-inner border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-text-base font-semibold focus:outline-none focus:border-sky-500 cursor-pointer normal-case tracking-normal"
          >
            <option value="SAMPLE">10% Systematic Verification</option>
            <option value="OUTLIERS">Outliers Only (Sharpness &lt; {SHARPNESS_OUTLIER_THRESHOLD})</option>
            <option value="ALL">All Frames (100% Comprehensive)</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-xl border border-subtle overflow-hidden flex flex-col min-h-[460px]">
          <div className="px-3 py-2 border-b border-divider flex items-center justify-between flex-wrap gap-2 text-xs">
            <span className="font-mono font-bold text-text-base truncate">{currentFrame?.filename}</span>
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              <span className="font-mono">
                Frame {currentFrame?.idx} of {batchTotal}
              </span>
              <span>
                Tenengrad:{' '}
                {currentFrame?.sharpness !== null && currentFrame?.sharpness !== undefined ? (
                  <span
                    className={`font-mono font-bold ${
                      currentFrame.sharpness >= 75 ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {currentFrame.sharpness}
                  </span>
                ) : (
                  <span className="text-text-muted">Not measured</span>
                )}
              </span>
            </div>
          </div>

          <div className="flex-1 relative bg-slate-950 flex items-center justify-center min-h-[380px]">
            {panoramaUrl ? (
              <PhotoSphereViewerComponent panoramaUrl={panoramaUrl} className="w-full h-full min-h-[380px]" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-center px-6">
                <FileQuestion size={28} className="text-zinc-600" />
                <p className="text-xs text-zinc-400">
                  No resolvable panorama URL for{' '}
                  <span className="font-mono">{currentFrame?.filename}</span>. Check the storage provider settings for
                  this project.
                </p>
              </div>
            )}
          </div>

          <div className="px-3 py-2 border-t border-divider flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <TextAction icon={<ChevronLeft size={13} />} onClick={() => step(-1)} disabled={activeFrameSubset.length === 0}>
                Previous
              </TextAction>
              <span className="text-text-muted/40 text-[11px]">|</span>
              <TextAction onClick={() => step(1)} disabled={activeFrameSubset.length === 0}>
                Next
                <ChevronRight size={13} />
              </TextAction>
            </div>
            <div className="text-[11px] text-text-muted font-mono text-right">
              {activeFrameSubset.length} of {frameList.length} frames in this subset
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2.5">
            <SectionLabel>Inspection Ledger</SectionLabel>
            <MetaList
              items={[
                {
                  key: 'batch',
                  label: 'Frames In Batch',
                  value: <span className="font-mono">{batchTotal}</span>
                },
                {
                  key: 'measured',
                  label: 'Sharpness Measured',
                  value: (
                    <span className="font-mono">
                      {measuredCount} / {frameList.length}
                    </span>
                  ),
                  note: measuredCount === 0 ? 'no sharpness metric stored upstream' : undefined
                },
                {
                  key: 'average',
                  label: 'Average Sharpness',
                  value: avgSharpness !== null ? <span className="font-mono">{avgSharpness}</span> : 'Not measured'
                },
                {
                  key: 'defects',
                  label: 'Flagged Defects',
                  value: (
                    <span className={`font-mono font-bold ${defects.length > 0 ? 'text-amber-400' : ''}`}>
                      {defects.length}
                    </span>
                  )
                },
                {
                  key: 'automated',
                  label: 'Privacy / Nadir Checks',
                  value: <span className="text-text-muted">Not automated</span>
                }
              ]}
            />
            {subsetNotice && (
              <p className="text-[11px] text-amber-400/90 leading-relaxed">{subsetNotice}</p>
            )}
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionLabel note="on current frame">Flag Issue</SectionLabel>
            <div className="grid grid-cols-2 gap-1.5">
              {DEFECT_OPTIONS.map((d) => (
                <button
                  key={d.type}
                  type="button"
                  onClick={() => handleFlagDefect(d.type)}
                  disabled={!currentFrame}
                  className={DEFECT_BUTTON_CLASS}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <SectionLabel>Auditor Sign-off Gate</SectionLabel>
            <p className="text-xs text-text-muted leading-relaxed">
              Approving records the manual audit for this batch and unlocks promotion to the WebGIS map. It does not
              assert that privacy, nadir or sharpness checks passed — those are not computed here.
            </p>
            <button
              type="button"
              onClick={handleSignOff}
              disabled={!cleanSg}
              className="self-start px-3.5 py-2 bg-text-base text-card hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-xs rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Check size={14} />
              <span>Approve Subgrid Batch</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
