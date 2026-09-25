import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck
} from 'lucide-react';
import {
  createProductionAttempt,
  createProductionRun,
  fetchProductionAttempts,
  fetchProductionReleaseHandoffStatus,
  fetchProductionReleases,
  fetchProductionRuns,
  saveProductionRelease
} from '../../services/supabase';
import type { ProductionApiClient } from '../../services/productionApi';
import type {
  DatasetRecord,
  ProductionAttemptRecord,
  ProductionReleaseRecord,
  ProductionRunRecord
} from '../../types/production';
import { extractCanonicalSubgrid, extractSurveyDate } from '../../utils/datasetLineage';
import { buildReleaseFolder, type ReleaseManifest } from '../../utils/releaseNaming';
import { Surface } from './chrome';

export interface ReleasePanelProps {
  api: ProductionApiClient;
  datasets: DatasetRecord[];
  userLabel: string;
  initialSubgrid?: string;
  initialCaptureDate?: string;
  onOpenDataManagement?: (subgrid?: string) => void;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const ReleasePanel: React.FC<ReleasePanelProps> = ({
  api,
  datasets,
  userLabel,
  initialSubgrid,
  initialCaptureDate,
  onOpenDataManagement,
  onAddNotification,
  onAddAuditLog
}) => {
  const subgrids = useMemo(() => {
    const values = datasets
      .map((dataset) => extractCanonicalSubgrid(dataset.subgrid || ''))
      .filter(Boolean);
    if (initialSubgrid) values.push(extractCanonicalSubgrid(initialSubgrid));
    return Array.from(new Set(values.filter(Boolean))).sort();
  }, [datasets, initialSubgrid]);
  const captureDates = useMemo(() => {
    const values = datasets
      .map((dataset) => extractSurveyDate(dataset))
      .filter((value): value is string => Boolean(value));
    if (initialCaptureDate) values.push(initialCaptureDate);
    const uniqueValues = Array.from(new Set(values)).sort().reverse();
    return uniqueValues.length > 0 ? uniqueValues : [today()];
  }, [datasets, initialCaptureDate]);
  const [subgrid, setSubgrid] = useState(initialSubgrid || subgrids[0] || '');
  const [captureDate, setCaptureDate] = useState(initialCaptureDate || captureDates[0] || today());
  const [sourceFolder, setSourceFolder] = useState('');
  const [cameraModel, setCameraModel] = useState('');
  const [runs, setRuns] = useState<ProductionRunRecord[]>([]);
  const [attempts, setAttempts] = useState<ProductionAttemptRecord[]>([]);
  const [releases, setReleases] = useState<ProductionReleaseRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedAttemptId, setSelectedAttemptId] = useState('');
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [checkingHandoff, setCheckingHandoff] = useState(false);
  const [handoffStatus, setHandoffStatus] = useState<{ ready: boolean; reason: string } | null>(null);

  useEffect(() => {
    if (!subgrid && subgrids[0]) setSubgrid(subgrids[0]);
    if (!captureDate && captureDates[0]) setCaptureDate(captureDates[0]);
  }, [subgrid, captureDate, subgrids, captureDates]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || runs[0] || null,
    [runs, selectedRunId]
  );
  const selectedAttempt = useMemo(
    () => attempts.find((attempt) => attempt.id === selectedAttemptId) || attempts[0] || null,
    [attempts, selectedAttemptId]
  );
  const selectedRelease = useMemo(
    () => releases.find((release) => release.attempt_id === selectedAttempt?.id)
      || releases.find((release) => release.production_run_id === selectedRun?.id && release.is_active)
      || null,
    [releases, selectedRun, selectedAttempt]
  );

  const loadRuns = useCallback(async () => {
    if (!subgrid || !captureDate) {
      setRuns([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await fetchProductionRuns({ subgrid, captureDate });
      setRuns(result);
      setSelectedRunId((current) => result.some((run) => run.id === current) ? current : result[0]?.id || '');
    } catch (err) {
      setRuns([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [subgrid, captureDate]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const loadRunDetails = useCallback(async () => {
    if (!selectedRun) {
      setAttempts([]);
      setReleases([]);
      setManifest(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [nextAttempts, nextReleases] = await Promise.all([
        fetchProductionAttempts(selectedRun.id || ''),
        fetchProductionReleases({ productionRunId: selectedRun.id })
      ]);
      setAttempts(nextAttempts);
      setReleases(nextReleases);
      const preferredAttemptId = nextAttempts.some((attempt) => attempt.id === selectedAttemptId)
        ? selectedAttemptId
        : nextAttempts[0]?.id || '';
      setSelectedAttemptId(preferredAttemptId);
      const currentRelease = nextReleases.find((release) => release.attempt_id === preferredAttemptId && release.is_active)
        || nextReleases.find((release) => release.attempt_id === preferredAttemptId)
        || nextReleases.find((release) => release.is_active)
        || nextReleases[0];
      setManifest((currentRelease?.metadata as unknown as ReleaseManifest) || null);
    } catch (err) {
      setAttempts([]);
      setReleases([]);
      setManifest(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedRun, selectedAttemptId]);

  useEffect(() => {
    void loadRunDetails();
  }, [loadRunDetails]);

  const checkHandoff = useCallback(async () => {
    if (!selectedRun?.id || !selectedAttempt?.id || !selectedRelease?.id) {
      setCheckingHandoff(false);
      const status = { ready: false, reason: 'Select a release attempt before opening WebGIS handoff.' };
      setHandoffStatus(status);
      return status;
    }
    setCheckingHandoff(true);
    try {
      const status = await fetchProductionReleaseHandoffStatus(
        selectedRun.id,
        selectedAttempt.id,
        selectedRelease.id
      );
      setHandoffStatus(status);
      return status;
    } catch (err) {
      const status = {
        ready: false,
        reason: err instanceof Error ? err.message : String(err)
      };
      setHandoffStatus(status);
      return status;
    } finally {
      setCheckingHandoff(false);
    }
  }, [selectedAttempt?.id, selectedRelease?.id, selectedRun?.id]);

  useEffect(() => {
    void checkHandoff();
  }, [checkHandoff]);

  const openHandoff = async () => {
    const status = await checkHandoff();
    if (!status.ready) {
      setError(status.reason);
      return;
    }
    onOpenDataManagement?.(selectedRelease?.subgrid || selectedRun?.subgrid);
  };

  useEffect(() => {
    if (!selectedRun) return;
    const matchingDataset = datasets.find((dataset) => {
      const datasetSubgrid = extractCanonicalSubgrid(dataset.subgrid || '');
      return datasetSubgrid === selectedRun.subgrid && extractSurveyDate(dataset) === selectedRun.capture_date;
    });
    if (matchingDataset) {
      setSourceFolder((current) => current || matchingDataset.output_folder || matchingDataset.source_folder || `05_Final/${selectedRun.subgrid}`);
    } else {
      setSourceFolder((current) => current || `05_Final/${selectedRun.subgrid}`);
    }
    setCameraModel((current) => current || selectedRun.camera_model || '');
  }, [datasets, selectedRun]);

  const createRun = async () => {
    if (!subgrid || !captureDate) {
      setError('Choose a subgrid and capture date first');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await createProductionRun({
        subgrid,
        captureDate,
        sourceFolder: sourceFolder.trim(),
        cameraModel: cameraModel.trim(),
        createdBy: userLabel
      });
      setSelectedRunId(result.run.id || '');
      setSelectedAttemptId(result.attempt.id || '');
      await loadRuns();
      onAddNotification?.({
        title: 'Capture run created',
        message: `${result.run.run_code} is ready for processing.`,
        category: 'SYSTEM',
        read: false
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onAddNotification?.({ title: 'Could not create capture run', message, category: 'ERROR', read: false });
    } finally {
      setSaving(false);
    }
  };

  const createAttempt = async () => {
    if (!selectedRun?.id) return;
    setSaving(true);
    setError('');
    try {
      const attempt = await createProductionAttempt({
        productionRunId: selectedRun.id,
        createdBy: userLabel
      });
      setSelectedAttemptId(attempt.id || '');
      await loadRunDetails();
      onAddAuditLog?.('CREATE', `Attempt ${attempt.attempt_number} created`, `Capture run ${selectedRun.run_code}`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const prepareRelease = async () => {
    if (!selectedRun || !selectedAttempt) {
      setError('Choose a capture run and attempt first');
      return;
    }
    if (!api.baseUrl) {
      setError('Configure the NAS worker or BFF URL before preparing a release');
      return;
    }
    if (!sourceFolder.trim()) {
      setError('Enter the NAS source folder');
      return;
    }
    setSaving(true);
    setError('');
    const releaseFolder = buildReleaseFolder('/DELIVERABLES', selectedRun.subgrid, selectedRun.run_code);
    try {
      const result = await api.prepareRelease({
        sourceFolder: sourceFolder.trim(),
        releaseFolder,
        subgrid: selectedRun.subgrid,
        runCode: selectedRun.run_code,
        projectId: selectedRun.project_id || '',
        runId: selectedRun.id || '',
        attemptId: selectedAttempt.id || '',
        captureDate: selectedRun.capture_date
      });
      if (!result.ok || !result.manifest) {
        throw new Error(result.message || 'Release preparation failed');
      }
      const release = await saveProductionRelease({
        productionRunId: selectedRun.id || '',
        attemptId: selectedAttempt.id || '',
        sourceFolder: sourceFolder.trim(),
        releaseFolder,
        manifest: result.manifest,
        createdBy: userLabel
      });
      setManifest(result.manifest);
      setReleases((current) => [release, ...current.filter((item) => item.id !== release.id)]);
      await loadRunDetails();
      onAddNotification?.({
        title: 'Release prepared',
        message: `${release.release_code} contains ${result.manifest.fileCount} files.`,
        category: 'SYSTEM',
        read: false
      });
      onAddAuditLog?.('CREATE', `Release ${release.release_code} prepared`, release.release_folder, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onAddNotification?.({ title: 'Release preparation failed', message, category: 'ERROR', read: false });
    } finally {
      setSaving(false);
    }
  };

  const releaseFolder = selectedRun
    ? buildReleaseFolder('/DELIVERABLES', selectedRun.subgrid, selectedRun.run_code)
    : '/DELIVERABLES/{subgrid}/{run}';

  return (
    <Surface className="p-4 space-y-4 font-sans">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-text-base tracking-wide">Release Manager</h2>
          <p className="text-[11px] text-text-muted mt-0.5">
            Create a durable capture run, then prepare a non-destructive subgrid-named NAS release.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadRuns()}
            disabled={loading || saving}
            className="p-2 rounded-lg border border-subtle bg-inner text-text-muted hover:text-text-base disabled:opacity-50"
            title="Refresh capture runs"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={createRun}
            disabled={saving || !subgrid || !captureDate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-accent bg-[var(--accent-bg)] text-accent text-[11px] font-semibold disabled:opacity-50"
          >
            <Plus size={13} />
            New capture run
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-subtle bg-inner px-3 py-2 text-[11px] text-text-base">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-3">
        <section className="rounded-xl border border-subtle bg-inner p-3 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-text-base">
            <FolderOpen size={14} className="text-text-muted" />
            Capture identity
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-[10px] text-text-muted">
              Subgrid
              <select
                value={subgrid}
                onChange={(event) => {
                  setSubgrid(event.target.value);
                  setSelectedRunId('');
                }}
                className="mt-1 w-full rounded-lg border border-subtle bg-card px-2.5 py-2 text-xs text-text-base outline-none"
              >
                <option value="">Select subgrid</option>
                {subgrids.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-text-muted">
              Capture date
              <select
                value={captureDate}
                onChange={(event) => {
                  setCaptureDate(event.target.value);
                  setSelectedRunId('');
                }}
                className="mt-1 w-full rounded-lg border border-subtle bg-card px-2.5 py-2 text-xs text-text-base outline-none"
              >
                {captureDates.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-[10px] text-text-muted">
            NAS source folder
            <input
              value={sourceFolder}
              onChange={(event) => setSourceFolder(event.target.value)}
              placeholder="05_Final/N93E70"
              className="mt-1 w-full rounded-lg border border-subtle bg-card px-2.5 py-2 text-xs font-mono text-text-base outline-none placeholder:text-text-muted"
            />
          </label>
          <label className="block text-[10px] text-text-muted">
            Camera model <span className="text-text-muted">(optional audit field)</span>
            <input
              value={cameraModel}
              onChange={(event) => setCameraModel(event.target.value)}
              placeholder="e.g. 003485"
              className="mt-1 w-full rounded-lg border border-subtle bg-card px-2.5 py-2 text-xs font-mono text-text-base outline-none placeholder:text-text-muted"
            />
          </label>
          <div className="rounded-lg border border-subtle bg-card px-3 py-2 text-[10px] text-text-muted font-mono">
            Output folder: <span className="text-text-base">{releaseFolder}</span>
          </div>
        </section>

        <section className="rounded-xl border border-subtle bg-inner p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-base">
              <ClipboardCheck size={14} className="text-accent" />
              Runs and attempts
            </div>
            <button
              type="button"
              onClick={createAttempt}
              disabled={saving || !selectedRun}
              className="flex items-center gap-1 px-2 py-1 rounded border border-subtle bg-card text-[10px] text-text-base disabled:opacity-50"
            >
              <Plus size={11} /> Attempt
            </button>
          </div>
          {runs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-subtle px-3 py-5 text-center text-[11px] text-text-muted">
              No capture run exists for this subgrid/date.
            </div>
          ) : (
            <div className="space-y-2">
              <select
                value={selectedRun?.id || ''}
                onChange={(event) => setSelectedRunId(event.target.value)}
                className="w-full rounded-lg border border-subtle bg-card px-2.5 py-2 text-xs font-mono text-text-base outline-none"
              >
                {runs.map((run) => <option key={run.id} value={run.id}>{run.run_code} · {run.status}</option>)}
              </select>
              <div className="flex flex-wrap gap-2">
                {attempts.map((attempt) => (
                  <button
                    key={attempt.id}
                    type="button"
                    onClick={() => setSelectedAttemptId(attempt.id || '')}
                    className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-mono ${
                      selectedAttempt?.id === attempt.id
                        ? 'border-accent bg-[var(--accent-bg)] text-accent'
                        : 'border-subtle bg-card text-text-muted'
                    }`}
                  >
                    Attempt {attempt.attempt_number} · {attempt.status}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-subtle bg-inner p-3 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-semibold text-text-base">
            <ShieldCheck size={14} className="text-accent" />
            NAS release output
          </div>
          <div className="flex items-center gap-2">
            {selectedRelease && (
              <span className={`rounded-full border px-2 py-1 text-[10px] font-mono ${
                selectedRelease.status === 'PUBLISHED'
? 'border-accent bg-[var(--accent-bg)] text-accent'
                   : 'border-subtle bg-card text-text-muted'
              }`}>
                {selectedRelease.status}
              </span>
            )}
            {onOpenDataManagement && selectedRelease && (
              <button
                type="button"
                onClick={() => void openHandoff()}
                disabled={checkingHandoff}
                title={handoffStatus?.ready ? handoffStatus.reason : handoffStatus?.reason || 'Check the remote QA decision before opening WebGIS handoff'}
                className="flex items-center gap-1.5 rounded-lg border border-subtle bg-card px-2.5 py-1.5 text-[10px] font-semibold text-text-base hover:bg-inner disabled:opacity-50"
              >
                {checkingHandoff ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                {handoffStatus?.ready ? 'Open WebGIS handoff' : 'Check QA handoff'}
              </button>
            )}
            <button
              type="button"
              onClick={prepareRelease}
              disabled={saving || !selectedRun || !selectedAttempt}
              className="flex items-center gap-1.5 rounded-lg border border-accent bg-[var(--accent-bg)] px-3 py-2 text-[11px] font-semibold text-accent disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Prepare release copy
            </button>
          </div>
        </div>
        {handoffStatus && !handoffStatus.ready && (
          <div className="flex items-start gap-2 rounded-lg border border-subtle bg-card px-3 py-2 text-[10px] text-text-muted">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{handoffStatus.reason}</span>
          </div>
        )}
        {manifest ? (
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div className="rounded-lg border border-subtle bg-card p-3 text-[10px] font-mono text-text-muted space-y-1">
              <div>Run: <span className="text-text-base">{manifest.runCode}</span></div>
              <div>Source: <span className="text-text-base break-all">{manifest.sourceFolder}</span></div>
              <div>Release: <span className="text-text-base break-all">{manifest.releaseFolder}</span></div>
              <div>Files: <span className="text-text-base">{manifest.fileCount}</span></div>
              <div>Bytes: <span className="text-text-base">{manifest.totalSizeBytes.toLocaleString()}</span></div>
            </div>
            <div className="rounded-lg border border-subtle bg-card p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                <FileText size={12} /> Manifest sample
              </div>
              <div className="max-h-32 overflow-auto space-y-1 text-[10px] font-mono text-text-muted">
                {manifest.files.slice(0, 12).map((file) => (
                  <div key={file.releaseName} className="flex justify-between gap-2">
                    <span className="truncate text-text-base">{file.releaseName}</span>
                    <span>{file.mediaType}</span>
                  </div>
                ))}
                {manifest.files.length > 12 && <div>+{manifest.files.length - 12} more</div>}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-subtle px-3 py-5 text-center text-[11px] text-text-muted">
            Prepare a release to generate the subgrid-named copy and manifest.
          </div>
        )}
      </section>
    </Surface>
  );
};
