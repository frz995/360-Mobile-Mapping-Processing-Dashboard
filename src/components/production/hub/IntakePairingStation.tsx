import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Download,
  Search,
  Sparkles,
  ArrowRight,
  Layers,
  FolderOpen,
  Loader2,
  ChevronDown
} from 'lucide-react';
import { SectionLabel, MetaList, TextAction } from '../chrome';
import { trackLengthMeters } from '../common';
import { appendStageEventToSupabase } from '../../../services/api/stageEventLedger';
import { probeStationAgent, renameNasFilesOnStation } from '../../../services/stationAgentApi';
import { fetchDashboardApi } from '../../../services/cloudflareApi';
import { DEFAULT_4_WORKSTATIONS, type WorkstationStationConfig } from '../../../types/production';

export interface PairedFrameRecord {
  index: number;
  /** Metadata filename as written in the survey CSV (e.g. N93E70-0093.jpg). */
  sourceFilename: string;
  /** Rename target = the metadata name (see read-csv / CSV-upload parsers). */
  targetFilename: string;
  /** Actual stitched image on disk (e.g. 003485-20220630-170708-000000001.jpg). */
  originalFilename?: string;
  /** Set when the batch rename applied this pair on the NAS. */
  renamedAt?: string | null;
  /** Metadata `distancetoprevious` column (metres) — the authoritative
   * trajectory length source when the survey CSV carries it. */
  distanceToPrevious?: number | null;
  timestamp: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  isMatched: boolean;
}

// Pair metadata rows against the stitched output listing.
//
// Pass 1 — exact filename match (already-renamed folders / name-aligned rigs).
// Pass 2 — positional join: PTGui keeps the rig's own device naming
//          (003485-20220630-170708-000000001.jpg) while survey CSVs can start
//          at any index (N93E70-0093.jpg), so when both lists carry the same
//          count they pair in capture order — chronological on both sides.
// Anything left over is reported as unpaired instead of silently dropped.
export function applyPairing(
  rows: PairedFrameRecord[],
  images: string[]
): { records: PairedFrameRecord[]; unpairedImages: string[] } {
  const norm = (n: string) => n.trim().toLowerCase();
  // Keep the on-disk casing: rename operations need exact filenames.
  const imageByLower = new Map(images.map((n) => [norm(n), n]));
  const claimed = new Set<string>();
  const nameMatched: PairedFrameRecord[] = [];
  const unmatched: PairedFrameRecord[] = [];

  rows.forEach((r) => {
    const base = r.sourceFilename.trim().toLowerCase().replace(/^.*[\\/]/, '');
    let matchedName = '';
    if (base) {
      const hit = imageByLower.get(base);
      if (hit) {
        matchedName = hit;
      } else if (!/\.[a-z0-9]+$/i.test(base)) {
        for (const ext of ['.jpg', '.jpeg', '.png']) {
          const cand = imageByLower.get(base + ext);
          if (cand) {
            matchedName = cand;
            break;
          }
        }
      }
    }
    if (matchedName) {
      claimed.add(norm(matchedName));
      nameMatched.push({ ...r, originalFilename: matchedName, isMatched: true });
    } else {
      unmatched.push(r);
    }
  });

  const rest = images.filter((img) => !claimed.has(norm(img)));
  const positional: PairedFrameRecord[] = [];
  if (unmatched.length > 0 && rest.length === unmatched.length) {
    unmatched.forEach((r, k) => {
      const matchedName = rest[k];
      claimed.add(norm(matchedName));
      positional.push({ ...r, originalFilename: matchedName, isMatched: true });
    });
  } else {
    // Counts differ (or nothing to pair): verification stays unresolved.
    unmatched.forEach((r) => positional.push({ ...r, isMatched: false }));
  }

  const records = [...nameMatched, ...positional].sort((a, b) => a.index - b.index);
  const unpaired = images.filter((img) => !claimed.has(norm(img)));
  return { records, unpairedImages: unpaired };
}

/**
 * Trajectory length in km. The survey metadata's `distancetoprevious`
 * column (metres) is authoritative — sum it and convert to km. When the
 * CSV carries no distance column, fall back to recomputing the
 * great-circle length from the paired coordinates.
 */
export function computeTrajectorySpan(
  records: PairedFrameRecord[]
): { km: number | null; source: 'metadata' | 'coordinates' } {
  const withDistance = records.filter(
    (r) => typeof r.distanceToPrevious === 'number' && Number.isFinite(r.distanceToPrevious)
  );
  if (withDistance.length > 0) {
    const metres = withDistance.reduce((acc, r) => acc + (r.distanceToPrevious as number), 0);
    return { km: metres / 1000, source: 'metadata' };
  }
  const metres = trackLengthMeters(records);
  return { km: metres === null ? null : metres / 1000, source: 'coordinates' };
}

export interface SurveyFolderMeta {
  id: string;
  name: string;
  displayDate: string;
  rawDate: string;
  panoramasCount: number;
  samplePano: string;
  csvName: string;
  gpsCount: number;
  formatType: string;
  formatDesc: string;
  path: string;
}

function getFoldersForSubgrid(_sg: string): SurveyFolderMeta[] {
  return [];
}

export interface SubgridOption {
  code: string;
  label: string;
  existsInStitching: boolean;
}

export const DEFAULT_AVAILABLE_SUBGRIDS: SubgridOption[] = [];

export const AVAILABLE_SUBGRIDS = DEFAULT_AVAILABLE_SUBGRIDS;

export interface IntakeSessionSource {
  selectedFolderId?: string;
  csvFileName?: string;
  customFolderName?: string;
}

export interface IntakePairingStationProps {
  subgrid: string;
  setSubgrid: (s: string) => void;
  surveyDate: string;
  setSurveyDate: (d: string) => void;
  totalFrames: number;
  setTotalFrames: (n: number) => void;
  pairedRecords: PairedFrameRecord[];
  setPairedRecords: (records: PairedFrameRecord[]) => void;
  onAdvanceToNextStation: () => void;
  addNotification?: (item: any) => void;
  addAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  translate?: (key: string) => string;
  /** Restored Hub session (last activity) — seeds the Survey Source inputs. */
  sessionSource?: IntakeSessionSource;
  onSurveySourceChange?: (next: IntakeSessionSource) => void;
  /** Station config for the direct NAS rename (station-agent based). */
  projectSettings?: { workstationsConfig?: WorkstationStationConfig[] } & Record<string, unknown>;
  isGuestUser?: boolean;
}

export const IntakePairingStation: React.FC<IntakePairingStationProps> = ({
  subgrid,
  setSubgrid,
  surveyDate,
  setSurveyDate,
  totalFrames,
  setTotalFrames,
  pairedRecords,
  setPairedRecords,
  onAdvanceToNextStation,
  addNotification,
  addAuditLog,
  sessionSource,
  onSurveySourceChange,
  projectSettings,
  isGuestUser
}) => {
  const [availableSubgrids, setAvailableSubgrids] = useState<SubgridOption[]>(DEFAULT_AVAILABLE_SUBGRIDS);
  const [hasScannedSubgrids, setHasScannedSubgrids] = useState<boolean>(false);
  const [isCustomSubgrid, setIsCustomSubgrid] = useState<boolean>(() => !DEFAULT_AVAILABLE_SUBGRIDS.some((s) => s.code === subgrid));
  const [isScanningFolders, setIsScanningFolders] = useState<boolean>(false);
  const [subgridFolders, setSubgridFolders] = useState<SurveyFolderMeta[]>(() => getFoldersForSubgrid(subgrid));
  const [selectedFolderId, setSelectedFolderId] = useState<string>(() => sessionSource?.selectedFolderId || '__none__');
  const [customFolderName, setCustomFolderName] = useState<string>(() => sessionSource?.customFolderName || '');
  const [rawFolderPath, setRawFolderPath] = useState<string>(
    `/03_Stitching/Project-OUT/Grid 1/${subgrid || '{subgrid}'}/{survey-run}/`
  );
  const [csvFileName, setCsvFileName] = useState<string>(() => sessionSource?.csvFileName || '');
  const [searchTerm, setSearchTerm] = useState<string>('');
  // Actual image files listed from the selected survey folder on disk. null =
  // never verified (no folder listing available); [] = folder exists but empty.
  const [folderImages, setFolderImages] = useState<string[] | null>(null);
  const [unpairedImages, setUnpairedImages] = useState<string[]>([]);
  const [probeDone, setProbeDone] = useState(false);

  // Probe NAS endpoint on mount to detect which subgrids exist in 03_Stitching
  useEffect(() => {
    let isMounted = true;
    fetchDashboardApi('/api/nas-scan?action=subgrids')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isMounted) return;
        if (data && Array.isArray(data.subgrids)) {
          setAvailableSubgrids(data.subgrids);
          setHasScannedSubgrids(true);
        }
      })
        .catch(() => {
          // Scan unavailable: the subgrid field stays "unverified" below.
        })
        .finally(() => {
          if (!isMounted) return;
          setProbeDone(true);
        });
      return () => {
        isMounted = false;
      };
    }, []);

  // Presence of the subgrid in 03_Stitching, straight from the NAS scan.
  // Anything else (including a failed scan) is reported as unverified rather
  // than optimistically assumed present.
  const subgridDetection = useMemo<'unverified' | 'present' | 'absent'>(() => {
    if (!hasScannedSubgrids) return 'unverified';
    const found = availableSubgrids.find((s) => s.code === subgrid.trim().toUpperCase());
    if (!found) return 'absent';
    return found.existsInStitching ? 'present' : 'absent';
  }, [hasScannedSubgrids, availableSubgrids, subgrid]);
  const isSubgridDetected = subgridDetection === 'present';
  const subgridDetectionLabel =
    subgridDetection === 'present'
      ? 'Detected in 03_Stitching'
      : subgridDetection === 'absent'
        ? 'Not found in 03_Stitching'
        : 'Scan unavailable';

  // Active folder details
  const activeFolderMeta = useMemo<SurveyFolderMeta>(() => {
    const list = subgridFolders;
    if (selectedFolderId === '__custom__') {
      return {
        id: '__custom__',
        name: customFolderName || 'custom_survey',
        displayDate: surveyDate || 'Custom Date',
        rawDate: surveyDate,
        panoramasCount: totalFrames,
        samplePano: '',
        csvName: csvFileName,
        gpsCount: totalFrames,
        formatType: 'Custom Survey Run',
        formatDesc: 'User specified directory and CSV',
        path: rawFolderPath
      };
    }
    const found = list.find((f) => f.id === selectedFolderId) || list[0] || null;
    if (found) return found;
    return {
      id: '__none__',
      name: 'No Stitched Folder',
      displayDate: 'Not Stitched Yet',
      rawDate: '',
      panoramasCount: 0,
      samplePano: '',
      csvName: '',
      gpsCount: 0,
      formatType: 'Unstitched',
      formatDesc: 'Requires running the stitching station first',
      path: rawFolderPath
    };
  }, [subgridFolders, selectedFolderId, subgrid, customFolderName, surveyDate, totalFrames, csvFileName, rawFolderPath]);

  // Handle Subgrid dropdown selection with scanning of exact survey folders
  const handleSubgridSelect = async (newSg: string, opts?: { silent?: boolean }) => {
    if (newSg === '__custom__') {
      setIsCustomSubgrid(true);
      return;
    }
    setIsCustomSubgrid(false);
    const clean = newSg.toUpperCase().trim();
    setSubgrid(clean);

    // Dynamic scanning state to read exact survey folders in NAS
    setIsScanningFolders(true);

    try {
      const res = await fetchDashboardApi(`/api/nas-scan?action=survey-folders&subgrid=${encodeURIComponent(clean)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.folders) && data.folders.length > 0) {
          setSubgridFolders(data.folders);
          // Session restore: prefer the previously selected survey folder when
          // the scan still contains it, instead of always resetting to first.
          const sesFolder = sessionSource?.selectedFolderId;
          const chosen =
            sesFolder && data.folders.some((f: SurveyFolderMeta) => f.id === sesFolder)
              ? sesFolder
              : data.folders[0].id;
          const target =
            data.folders.find((f: SurveyFolderMeta) => f.id === chosen) || data.folders[0];
          setSelectedFolderId(chosen);
          setSurveyDate(target.rawDate);
          setRawFolderPath(target.path);
          if (chosen === sesFolder && sessionSource?.csvFileName) {
            setCsvFileName(sessionSource.csvFileName);
          } else {
            setCsvFileName(target.csvName);
          }
          if (chosen !== sesFolder) {
            setTotalFrames(target.panoramasCount);
          }
          setIsScanningFolders(false);
          // Refresh the paired records from the disk CSV for the chosen run —
          // restored sessions pick up newer metadata fields (distance column,
          // verified status) without a manual re-pair. Silent on restore.
          void readSurveyCsv(clean, chosen, target.csvName, opts?.silent === true);
          return;
        } else if (sessionSource?.selectedFolderId) {
          // Scan found nothing for this subgrid, but a session selection
          // exists — keep the restored selections instead of wiping them.
          setSubgridFolders([]);
          setRawFolderPath(`/03_Stitching/Project-OUT/Grid 1/${clean}/`);
          setIsScanningFolders(false);
          return;
        }
      }
    } catch {
      // fall through to offline defaults below
    }
    if (sessionSource?.selectedFolderId || sessionSource?.customFolderName) {
      // NAS scan unavailable: retain the restored session selections.
      setSubgridFolders([]);
      setRawFolderPath(`/03_Stitching/Project-OUT/Grid 1/${clean}/`);
      setIsScanningFolders(false);
      return;
    }

    setSubgridFolders([]);
    setSelectedFolderId('__none__');
    setRawFolderPath(`/03_Stitching/Project-OUT/Grid 1/${clean}/`);
    setCsvFileName('');
    setTotalFrames(0);
    setIsScanningFolders(false);
  };

  // Report the Survey Source selections upward so the Hub session persists
  // the operator's last activity (restored on refresh / tab re-entry).
  useEffect(() => {
    onSurveySourceChange?.({
      selectedFolderId,
      csvFileName,
      customFolderName
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolderId, csvFileName, customFolderName]);

  // On mount (or restored subgrid), re-scan the NAS folder list once so the
  // Survey Source continues the last session rather than showing placeholders.
  const restoredScanRef = useRef<string>('');
  useEffect(() => {
    if (!subgrid || restoredScanRef.current !== '') return;
    restoredScanRef.current = subgrid;
    void handleSubgridSelect(subgrid, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subgrid]);

  // Hydration race: the intake can mount BEFORE the Hub session fetch lands.
  // Apply the session seeds once when they first arrive.
  const sessionAppliedRef = useRef(false);
  useEffect(() => {
    if (sessionAppliedRef.current) return;
    const s = sessionSource;
    if (!s || (!s.selectedFolderId && !s.csvFileName && !s.customFolderName)) return;
    sessionAppliedRef.current = true;
    if (s.selectedFolderId) setSelectedFolderId(s.selectedFolderId);
    if (s.csvFileName) setCsvFileName(s.csvFileName);
    if (s.customFolderName) setCustomFolderName(s.customFolderName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionSource]);

  // A restored (session) subgrid must stay visible/selectable even when the
  // NAS scan probe fails or doesn't list it: fall back to the custom entry
  // input, then revert to the dropdown once the scan confirms the code.
  const restoredSgRef = useRef<string>('');
  useEffect(() => {
    if (restoredSgRef.current) return;
    if (!subgrid) return;
    restoredSgRef.current = subgrid;
  }, [subgrid]);
  useEffect(() => {
    if (!restoredSgRef.current || !probeDone || isCustomSubgrid) return;
    const scannedOk = hasScannedSubgrids && availableSubgrids.some((sg) => sg.code === subgrid);
    if (scannedOk) {
      if (isCustomSubgrid) setIsCustomSubgrid(false);
      return;
    }
    if (subgridDetection === 'absent' || (!hasScannedSubgrids && probeDone)) {
      setIsCustomSubgrid(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probeDone, subgridDetection, hasScannedSubgrids, availableSubgrids, subgrid, isCustomSubgrid]);

  // List the real image files inside the selected survey folder on disk.
  // Returns null when the folder cannot be listed (pairing stays unverified).
  const fetchFolderImages = async (sg: string, folderId: string): Promise<string[] | null> => {
    if (!sg || !folderId || folderId === '__none__' || folderId === '__custom__') return null;
    try {
      const res = await fetchDashboardApi(`/api/nas-scan?action=folder-images&subgrid=${encodeURIComponent(sg)}&folder=${encodeURIComponent(folderId)}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.success && Array.isArray(data.images)) return data.images as string[];
      return null;
    } catch {
      return null;
    }
  };

  // Verify each metadata row against the actual folder images by filename.
  // A row is matched only when its file really exists on disk; leftover images
  // are exactly the files no metadata row claims. (Implementation: the module
  // level `applyPairing` above — exact-name pass + positional join.)

  // Surface count mismatches with explicit reasons instead of silently
  // accepting whatever the CSV and folder happen to contain.
  const notifyPairingOutcome = (records: PairedFrameRecord[], images: string[] | null) => {
    if (!addNotification) return;
    const matched = records.filter((r) => r.isMatched).length;
    const noFilename = records.filter((r) => !r.sourceFilename.trim()).length;
    const missingImage = records.filter((r) => r.sourceFilename.trim() && !r.isMatched).length;
    const reasons: string[] = [];
    if (images !== null && images.length !== records.length) {
      reasons.push(
        images.length > records.length
          ? `${images.length} image(s) in the survey folder but only ${records.length} metadata row(s) — ${images.length - records.length} image(s) have no metadata entry.`
          : `${records.length} metadata row(s) but only ${images.length} image(s) in the survey folder — ${records.length - images.length} metadata row(s) have no image.`
      );
    }
    if (missingImage > 0) {
      reasons.push(`${missingImage} metadata row(s) reference filenames that do not exist in the survey folder.`);
    }
    if (noFilename > 0) {
      reasons.push(`${noFilename} metadata row(s) carry no filename — their pair cannot be verified.`);
    }
    addNotification({
      title: images !== null && reasons.length === 0 ? 'Auto-Pair Verified' : 'Auto-Pair Completed With Mismatches',
      message:
        reasons.length > 0
          ? `${matched} of ${records.length} metadata row(s) verified against disk. ${reasons.join(' ')}`
          : `All ${records.length} metadata row(s) verified 1-to-1 against the ${images?.length ?? 0} image(s) in the survey folder.`,
      category: 'SYSTEM',
      read: false
    });
  };

  // Helper to read actual survey CSV from NAS 01_Metadata. `silent` skips the
  // outcome notification (used by the session-restore auto-refresh).
  const readSurveyCsv = async (sg: string, folderId: string, csvName: string, silent = false): Promise<boolean> => {
    try {
      const res = await fetchDashboardApi(`/api/nas-scan?action=read-csv&subgrid=${encodeURIComponent(sg)}&folder=${encodeURIComponent(folderId)}&csv=${encodeURIComponent(csvName)}`);
      if (!res.ok) return false;
      const data = await res.json();
      if (!(data.success && Array.isArray(data.records) && data.records.length > 0)) return false;

      // Pair against the real image files on disk whenever the folder can be
      // listed; a metadata row counts as matched only when its file exists.
      const images = await fetchFolderImages(sg, folderId);
      let records: PairedFrameRecord[];
      if (images !== null) {
        const result = applyPairing(data.records, images);
        records = result.records;
        setFolderImages(images);
        setUnpairedImages(result.unpairedImages);
      } else {
        records = data.records.map((r: PairedFrameRecord) => ({ ...r, isMatched: Boolean(r.sourceFilename) }));
        setFolderImages(null);
        setUnpairedImages([]);
      }
      setPairedRecords(records);
      setTotalFrames(records.length);
      if (data.csvPath) setCsvFileName(data.csvPath);
      if (!silent) notifyPairingOutcome(records, images);
      return true;
    } catch {
      // ignore
    }
    return false;
  };

  // Update raw folder template when custom subgrid text changes
  const handleSubgridChange = (newSg: string) => {
    const clean = newSg.toUpperCase().trim();
    setSubgrid(clean);
    const folder = selectedFolderId === '__custom__' ? customFolderName || '{survey-run}' : selectedFolderId;
    setRawFolderPath(`/03_Stitching/Project-OUT/Grid 1/${clean || '{subgrid}'}/${folder}/`);
  };

  // Switch survey folder
  const handleFolderSelect = (folderId: string) => {
    setSelectedFolderId(folderId);
    if (folderId !== '__custom__' && folderId !== '__none__') {
      const target = subgridFolders.find((f) => f.id === folderId);
      if (target) {
        setSurveyDate(target.rawDate);
        setRawFolderPath(target.path);
        setCsvFileName(target.csvName);
        setTotalFrames(target.panoramasCount);
        void readSurveyCsv(subgrid.toUpperCase().trim(), folderId, target.csvName);
      }
    }
  };

  // Auto-pair records from the selected data folder by reading actual survey CSV on disk
  const handleAutoPairFromFolder = async () => {
    const cleanSg = subgrid.trim().toUpperCase();
    if (!cleanSg) {
      addNotification?.({
        type: 'warning',
        title: 'No Subgrid Set',
        message: 'Enter or select a subgrid code before auto-pairing.'
      });
      return;
    }
    const folderId = selectedFolderId !== '__none__' && selectedFolderId !== '__custom__' ? selectedFolderId : (subgridFolders[0]?.id || '');
    const csvTarget = activeFolderMeta.csvName || (folderId ? `${folderId}.csv` : '');

    if (!csvTarget) {
      addNotification?.({
        type: 'warning',
        title: 'No Survey CSV Selected',
        message: `No stitched run with a survey CSV is selected for ${cleanSg}. Choose a run, or upload a CSV.`
      });
      return;
    }

    const success = await readSurveyCsv(cleanSg, folderId, csvTarget);
    if (success) {
      addNotification?.({
        title: 'Survey Data Loaded',
        message: `Read real coordinate records from ${csvTarget} for ${cleanSg}.`,
        category: 'SYSTEM',
        read: false
      });
      return;
    }

    addNotification?.({
      type: 'warning',
      title: 'Survey CSV Not Found On Disk',
      message: `Could not read ${csvTarget} from 01_Metadata for ${cleanSg}. Upload a CSV using the file picker instead.`
    });
  };

  // CSV File Upload Handler
  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        addNotification?.({
          type: 'warning',
          title: 'CSV Has No Data Rows',
          message: `${file.name} contains a header but no records.`
        });
        return;
      }

      const header = lines[0].toLowerCase().split(/[,\t]/).map((h) => h.trim());
      const latIdx = header.findIndex((h) => h.includes('lat'));
      const lonIdx = header.findIndex((h) => h.includes('lon') || h.includes('lng'));
      const fileIdx = header.findIndex((h) => h.includes('file') || h.includes('name') || h.includes('img'));
      const headIdx = header.findIndex((h) => h.includes('head') || h.includes('yaw') || h.includes('azimuth'));
      const timeIdx = header.findIndex((h) => h.includes('time') || h.includes('date'));
      const distIdx = header.findIndex((h) => h.includes('distance'));

      // Coordinates are mandatory. Without them nothing is paired — inventing a
      // track here would publish fabricated geometry to PostGIS downstream.
      if (latIdx < 0 || lonIdx < 0) {
        addNotification?.({
          type: 'warning',
          title: 'CSV Missing Coordinate Columns',
          message: `${file.name} needs a latitude and a longitude column. Found headers: ${header.join(', ') || 'none'}. No records were created.`
        });
        return;
      }

      const cleanSg = subgrid.trim().toUpperCase();
      const parsed: PairedFrameRecord[] = [];
      let skipped = 0;
      let seq = 0;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(/[,\t]/).map((p) => p.trim());
        if (parts.length < 2) continue;

        const lat = Number.parseFloat(parts[latIdx]);
        const lon = Number.parseFloat(parts[lonIdx]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          skipped += 1;
          continue;
        }

        seq += 1;
        const seqStr = String(seq).padStart(4, '0');
        const heading = headIdx >= 0 ? Number.parseFloat(parts[headIdx]) : NaN;
        const srcName = fileIdx >= 0 && parts[fileIdx] ? parts[fileIdx] : '';
        // The CSV's own filename is the canonical metadata name (rename
        // target); the row-index name is only a fallback for bare CSVs.
        const targetName = srcName || (cleanSg.length > 0 ? `${cleanSg}-${seqStr}.jpg` : '');
        const distRaw = distIdx >= 0 && parts[distIdx] ? Number.parseFloat(parts[distIdx]) : NaN;
        const distanceToPrevious = Number.isFinite(distRaw) ? distRaw : null;

        parsed.push({
          index: seq,
          sourceFilename: srcName,
          targetFilename: targetName,
          timestamp: timeIdx >= 0 ? parts[timeIdx] : '',
          latitude: Number.parseFloat(lat.toFixed(6)),
          longitude: Number.parseFloat(lon.toFixed(6)),
          heading: Number.isFinite(heading) ? Number.parseFloat(heading.toFixed(1)) : null,
          distanceToPrevious,
          isMatched: Boolean(srcName) && cleanSg.length > 0
        });
      }

      if (parsed.length === 0) {
        addNotification?.({
          type: 'warning',
          title: 'No Usable Coordinate Rows',
          message: `None of the ${lines.length - 1} row(s) in ${file.name} parsed as a valid latitude/longitude pair.`
        });
        return;
      }

      // Try to verify the uploaded CSV against the actual survey folder on
      // disk; without a folder listing the filename presence is all that can
      // be asserted and the mismatch panel says verification is pending.
      const folderId = selectedFolderId !== '__none__' && selectedFolderId !== '__custom__' ? selectedFolderId : (subgridFolders[0]?.id || '');
      const images = await fetchFolderImages(cleanSg, folderId);
      let finalRecords = parsed;
      if (images !== null) {
        const result = applyPairing(parsed, images);
        finalRecords = result.records;
        setFolderImages(images);
        setUnpairedImages(result.unpairedImages);
      } else {
        setFolderImages(null);
        setUnpairedImages([]);
      }

      setPairedRecords(finalRecords);
      setTotalFrames(finalRecords.length);
      notifyPairingOutcome(finalRecords, images);

      const renamed = finalRecords.filter((r) => r.isMatched).length;
      void appendStageEventToSupabase({
        subgrid: cleanSg,
        stage: 'intake',
        event: 'COMPLETED',
        via: 'operator',
        detail: `${finalRecords.length} coordinate record(s) parsed from ${file.name}${
          renamed < finalRecords.length ? `, ${finalRecords.length - renamed} unpaired` : ''
        }`,
        counts: { total: finalRecords.length, matched: renamed },
        updated_by: 'Operator'
      });

      addAuditLog?.(
        'IMPORT',
        'Survey CSV Ingested',
        `Parsed ${finalRecords.length} coordinate record(s) from ${file.name}${
          skipped ? `, skipped ${skipped} without a usable fix` : ''
        }${renamed < finalRecords.length ? `, ${finalRecords.length - renamed} unpaired` : ''}.`,
        'success'
      );
      addNotification?.({
        title: 'Survey CSV Parsed',
        message: `${finalRecords.length} record(s) loaded from ${file.name}.${
          skipped ? ` ${skipped} row(s) had no usable coordinates and were skipped.` : ''
        }`,
        category: 'SYSTEM',
        read: false
      });
    };
    reader.readAsText(file);
  };

  // Filtered view for search
  const filteredRecords = useMemo(() => {
    if (!searchTerm.trim()) return pairedRecords;
    const q = searchTerm.toLowerCase();
    return pairedRecords.filter(
      (r) =>
        r.sourceFilename.toLowerCase().includes(q) ||
        r.targetFilename.toLowerCase().includes(q) ||
        String(r.index).includes(q) ||
        String(r.latitude).includes(q) ||
        String(r.longitude).includes(q)
    );
  }, [pairedRecords, searchTerm]);

  // Generate downloadable Windows Batch (.bat) Rename Script
  const generateRenameBatchScript = () => {
    const renamable = pairedRecords.filter((r) => (r.originalFilename || r.sourceFilename) && r.targetFilename);
    const lines = [
      '@echo off',
      `echo ====================================================`,
      `echo GeoSphere 360 — Auto-Renaming Script for ${subgrid || '{subgrid}'}`,
      `echo Target folder: ${rawFolderPath}`,
      `echo ${renamable.length} mapping(s) from ${pairedRecords.length} paired record(s)`,
      `echo ====================================================`,
      `cd /d "%~dp0"`,
      ''
    ];

    renamable.forEach((r) => {
      // The on-disk stitched name is the original; metadata names only exist
      // after the rename. Fall back to sourceFilename for unlisted folders.
      const from = r.originalFilename || r.sourceFilename;
      lines.push(`if exist "${from}" ren "${from}" "${r.targetFilename}"`);
    });

    if (renamable.length === 0) {
      lines.push('echo Nothing to rename: no record carries both a source and a target filename.');
    }

    lines.push('', 'pause');
    return lines.join('\r\n');
  };

  const handleDownloadRenameScript = () => {
    if (pairedRecords.length === 0) return;
    const content = generateRenameBatchScript();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rename_${subgrid || 'subgrid'}.bat`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // === One-click NAS rename: renames the stitched images to the metadata
  // names through the first reachable station agent (all PCs see the NAS).
  const [renameBusy, setRenameBusy] = useState(false);

  const renameableRecords = pairedRecords.filter(
    (r) => r.isMatched && r.originalFilename && r.targetFilename && !r.renamedAt && r.originalFilename !== r.targetFilename
  );

  const handleRenameOnNas = async () => {
    if (renameBusy || renameableRecords.length === 0) return;
    const workstations: WorkstationStationConfig[] =
      (projectSettings?.workstationsConfig as WorkstationStationConfig[] | undefined) || DEFAULT_4_WORKSTATIONS;
    const candidates = ['stitch', 'blur', 'lightroom', 'photoshop']
      .map((id) => workstations.find((w) => w.id === id))
      .filter((w): w is WorkstationStationConfig => !!w && !!w.ipAddress && w.enabled !== false);
    if (candidates.length === 0) {
      addNotification?.({
        type: 'warning',
        title: 'No Station Agent Configured',
        message: 'Set a workstation IP under Providers → Workstations (station-agent running) to rename on the NAS.'
      });
      return;
    }

    setRenameBusy(true);
    const cleanSg = subgrid.trim().toUpperCase();
    const stageDir = `${(rawFolderPath || '').replace(/^\//, '').replace(/\/+$/, '')}/panoramas`;
    const renames = renameableRecords.map((r) => ({ src: r.originalFilename as string, dst: r.targetFilename }));
    try {
      // Fail fast: probe each candidate with a short health check instead of
      // letting unreachable IPs burn the long rename timeout one by one.
      let agent: WorkstationStationConfig | null = null;
      for (const ws of candidates) {
        const probe = await probeStationAgent(ws, { timeoutMs: 2_000 });
        if (probe.online) {
          agent = ws;
          break;
        }
      }
      if (!agent) {
        addNotification?.({
          type: 'warning',
          title: 'No Station Agent Reachable',
          message: 'All workstation agents are offline — start station-agent on a PC, or use the .BAT script instead.'
        });
        return;
      }
      const result = await renameNasFilesOnStation(agent, stageDir, renames, { timeoutMs: 60_000 });
      if (!result) {
        addNotification?.({
          type: 'warning',
          title: 'Agent Dropped Mid-Rename',
          message: 'The station agent became unreachable while renaming. Re-run Rename Batch to continue (existing targets are skipped, so it is idempotent).'
        });
        return;
      }
      if (!result.ok) {
        addNotification?.({
          type: 'warning',
          title: 'Rename Rejected',
          message: result.message || 'The station agent refused the rename request.'
        });
        return;
      }
      const renamedAt = new Date().toISOString();
      const doneSet = new Set(renameableRecords.map((r) => r.index));
      setPairedRecords(
        pairedRecords.map((r) => (doneSet.has(r.index) ? { ...r, renamedAt, isMatched: true } : r))
      );
      const skipped = result.skipped?.length || 0;
      addNotification?.({
        title: skipped > 0 ? 'Rename Batch Finished With Skips' : 'Rename Batch Complete',
        message: `${result.renamed || 0} image(s) renamed to metadata names on ${stageDir}${
          skipped > 0 ? `; ${skipped} skipped: ${(result.skipped || []).map((s) => `${s.src} (${s.reason})`).join(', ')}` : ''
        }`,
        category: 'SYSTEM',
        read: false
      });
      addAuditLog?.(
        'EDIT',
        'NAS Batch Rename Applied',
        `${result.renamed || 0} image(s) renamed to metadata names under ${stageDir}${skipped > 0 ? ` (${skipped} skipped)` : ''} by ${isGuestUser ? 'Guest' : 'Operator'}.`,
        skipped > 0 ? 'warning' : 'success'
      );
      void appendStageEventToSupabase({
        subgrid: cleanSg,
        stage: 'intake',
        event: 'PROGRESS',
        via: 'operator',
        detail: `${result.renamed || 0} stitched image(s) renamed to metadata names (${stageDir})`,
        counts: { renamed: result.renamed || 0, skipped, total: pairedRecords.length },
        updated_by: isGuestUser ? 'Guest' : 'Operator'
      });
    } finally {
      setRenameBusy(false);
    }
  };

  const matchedCount = pairedRecords.filter((r) => r.isMatched).length;
  const trajectory = useMemo(() => computeTrajectorySpan(pairedRecords), [pairedRecords]);
  const trajectorySpanKm = trajectory.km !== null ? trajectory.km.toFixed(2) : null;
  const trajectoryNote =
    trajectory.km === null
      ? 'needs 2+ coordinate records'
      : trajectory.source === 'metadata'
        ? 'summed from metadata distance-to-previous (m → km)'
        : 'summed from paired coordinates';
  const gpsSyncLabel =
    pairedRecords.length === 0
      ? 'Awaiting CSV / Sequence'
      : folderImages === null
        ? matchedCount === pairedRecords.length
          ? 'All records carry a filename (not verified on disk)'
          : `${matchedCount} of ${pairedRecords.length} carry a filename`
        : matchedCount === pairedRecords.length
          ? 'All pairs verified on disk'
          : `${matchedCount} of ${pairedRecords.length} verified on disk`;

  // Folder-vs-metadata count reconciliation with explicit reasons.
  const pairCheck = useMemo(() => {
    if (pairedRecords.length === 0) return null;
    const folderCount = folderImages === null ? null : folderImages.length;
    const noFilename = pairedRecords.filter((r) => !r.sourceFilename.trim()).length;
    const missingRows = pairedRecords.filter((r) => r.sourceFilename.trim() && !r.isMatched);
    const reasons: string[] = [];
    if (folderCount !== null && folderCount !== pairedRecords.length) {
      reasons.push(
        folderCount > pairedRecords.length
          ? `Images (${folderCount}) outnumber metadata rows (${pairedRecords.length}) — ${
              folderCount - pairedRecords.length
            } image(s) have no metadata entry.`
          : `Metadata rows (${pairedRecords.length}) outnumber images (${folderCount}) — ${
              pairedRecords.length - folderCount
            } metadata row(s) have no image.`
      );
    }
    if (missingRows.length > 0) {
      const names = missingRows.map((r) => r.sourceFilename);
      reasons.push(
        `${missingRows.length} metadata row(s) have no matching image on disk: ${names
          .slice(0, 3)
          .join(', ')}${names.length > 3 ? '…' : ''}`
      );
    }
    if (unpairedImages.length > 0) {
      reasons.push(
        `${unpairedImages.length} image(s) in the folder have no metadata row: ${unpairedImages
          .slice(0, 3)
          .join(', ')}${unpairedImages.length > 3 ? '…' : ''}`
      );
    }
    if (noFilename > 0) {
      reasons.push(`${noFilename} metadata row(s) carry no filename — their pair cannot be verified.`);
    }
    return { folderCount, reasons, inSync: folderCount !== null && reasons.length === 0 };
  }, [pairedRecords, folderImages, unpairedImages]);

  return (
    <div className="flex flex-col gap-5">
      {/* Header toolbar — one surface, one primary action */}
      <div className="pb-3 border-b border-subtle flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-base tracking-tight">
            Stitched Panorama Intake &amp; Spatial Pairing
          </h3>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed max-w-2xl">
            Prepare survey source data and pair metadata with the selected imagery.
          </p>
        </div>

        <button
          onClick={handleAutoPairFromFolder}
          className="px-3.5 py-1.5 bg-text-base text-card hover:opacity-90 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-opacity cursor-pointer shrink-0"
          title="Populate 1-to-1 pairing sequence from active survey folder"
        >
          <Sparkles size={13} />
          <span>Auto-Pair Survey Sequence</span>
        </button>
      </div>

      {/* Survey source — bare form grid under a section label */}
      <div className="space-y-3">
        <SectionLabel icon={<FolderOpen size={12} />}>Survey Source</SectionLabel>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {/* Subgrid Code Dropdown List with Custom Support */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Subgrid Code
              </label>
              <span
                className={`text-[10px] font-mono ${
                  isSubgridDetected ? 'text-emerald-400 font-semibold' : 'text-text-muted'
                }`}
              >
                {subgridDetectionLabel}
              </span>
            </div>
            <div className="relative">
              <select
                value={isCustomSubgrid ? '__custom__' : subgrid}
                onChange={(e) => handleSubgridSelect(e.target.value)}
                className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 pr-8 text-xs font-bold text-text-base focus:outline-none focus:border-divider uppercase tracking-wide cursor-pointer font-mono appearance-none"
              >
                {availableSubgrids.map((sg) => (
                  <option key={sg.code} value={sg.code}>
                    {sg.code}
                  </option>
                ))}
                <option value="__custom__">+ Enter Custom Subgrid...</option>
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted"
              />
            </div>
            {isCustomSubgrid && (
              <input
                type="text"
                value={subgrid}
                onChange={(e) => handleSubgridChange(e.target.value)}
                placeholder="e.g. N93E70"
                className="mt-1.5 w-full bg-inner border border-subtle rounded-lg px-3 py-1.5 text-xs font-mono font-bold uppercase text-text-base focus:outline-none focus:border-divider"
                autoFocus
              />
            )}
          </div>

          {/* Survey Data Folder Selection Dropdown with Loading State */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Survey Data Folder
              </label>
              <span className="text-[10px] font-mono text-text-muted">
                {isScanningFolders ? 'Scanning...' : subgridFolders.length === 0 ? 'No Stitched Data' : activeFolderMeta.rawDate}
              </span>
            </div>
            {isScanningFolders ? (
              <div className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-muted flex items-center gap-2 font-mono">
                <Loader2 size={13} className="animate-spin text-text-muted" />
                <span className="truncate">Reading 03_Stitching folders...</span>
              </div>
            ) : (
              <div className="relative">
                <select
                  value={selectedFolderId}
                  onChange={(e) => handleFolderSelect(e.target.value)}
                  className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 pr-8 text-xs font-semibold text-text-base focus:outline-none focus:border-divider font-mono cursor-pointer appearance-none"
                >
                  {subgridFolders.length === 0 ? (
                    <option value="__none__" disabled>
                      No stitched runs found in 03_Stitching
                    </option>
                  ) : (
                    subgridFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.displayDate} · {f.panoramasCount} imgs)
                      </option>
                    ))
                  )}
                  <option value="__custom__">+ Enter Custom Date/Folder...</option>
                </select>
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                />
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted block mb-1">
              Stitched Folder Path (NAS)
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={rawFolderPath}
                onChange={(e) => setRawFolderPath(e.target.value)}
                placeholder="/03_Stitching/Project-OUT/Grid 1/{subgrid}/{survey-run}/"
                className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs font-mono text-text-base focus:outline-none focus:border-divider"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted block mb-1">
              Survey CSV (01_Metadata)
            </label>
            <div className="relative">
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleCsvFileUpload}
                id="survey-csv-upload"
                className="hidden"
              />
              <label
                htmlFor="survey-csv-upload"
                className="w-full bg-inner border border-subtle hover:border-divider rounded-lg px-3 py-2 text-xs font-medium text-text-muted hover:text-text-base flex items-center justify-between cursor-pointer truncate transition-colors"
              >
                <span className="truncate">{csvFileName || 'Choose CSV file...'}</span>
                <FileSpreadsheet size={14} className="text-text-muted shrink-0 ml-1.5" />
              </label>
            </div>
          </div>
        </div>

        {/* Custom Folder & Date Entry Row (Visible only when __custom__ is picked) */}
        {selectedFolderId === '__custom__' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-subtle animate-in fade-in">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted block mb-1">
                Custom Folder Name
              </label>
              <input
                type="text"
                value={customFolderName}
                onChange={(e) => {
                  setCustomFolderName(e.target.value);
                  setRawFolderPath(`/03_Stitching/Project-OUT/Grid 1/${subgrid}/${e.target.value}/`);
                }}
                placeholder="e.g. 20220904 or BP_20220630"
                className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs font-mono text-text-base focus:outline-none focus:border-divider"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted block mb-1">
                Survey Calendar Date
              </label>
              <input
                type="date"
                value={surveyDate}
                onChange={(e) => setSurveyDate(e.target.value)}
                className="w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-xs font-medium text-text-base focus:outline-none focus:border-divider"
              />
            </div>
          </div>
        )}

        {/* Folder-vs-metadata reconciliation: counts must agree, mismatches are explained */}
        {pairCheck && (
          pairCheck.inSync ? (
            <div className="px-3 py-2 bg-inner border border-subtle rounded-lg text-xs flex items-start gap-2">
              <CheckCircle2 size={14} className="shrink-0 mt-px text-emerald-400" />
              <span>
                <span className="font-semibold text-text-base">In sync</span> —{' '}
                {pairCheck.folderCount} image(s) = {pairedRecords.length} metadata row(s), every pair verified on disk.
              </span>
            </div>
          ) : (
            <div className="px-3 py-2 bg-inner border border-subtle rounded-lg text-xs flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-px text-amber-400" />
              <div className="space-y-1">
                <div className="font-semibold text-text-base">
                  Survey data folder and metadata CSV do not match
                  {pairCheck.folderCount !== null
                    ? ` — folder images: ${pairCheck.folderCount}, metadata rows: ${pairedRecords.length}`
                    : ' — folder listing unavailable, pairing not verified on disk'}
                  :
                </div>
                <ul className="list-disc pl-4 space-y-0.5 text-text-muted">
                  {pairCheck.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>
          )
        )}

        {/* Alert when unstitched subgrid is selected */}
        {activeFolderMeta.panoramasCount === 0 && !isScanningFolders && (
          <div className="px-3 py-2 bg-inner border border-subtle rounded-lg text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-px text-amber-400" />
            <span className="text-text-muted">
              No stitched survey runs found in <span className="font-mono text-text-base">{activeFolderMeta.path}</span>. Run the 4-PC Multi-Station board to process raw multi-lens captures, or enter a custom path.
            </span>
          </div>
        )}
      </div>

      {/* Pairing summary — one divided list instead of four stat cards */}
      <div className="space-y-3">
        <SectionLabel icon={<CheckCircle2 size={12} />}>Pairing Summary</SectionLabel>
        <MetaList
          items={[
            { key: 'frames', label: 'Total Frames', value: `${pairedRecords.length}`, note: 'panoramas' },
            { key: 'gps', label: 'GPS Sync Status', value: gpsSyncLabel },
            {
              key: 'span',
              label: 'Trajectory Distance',
              value: trajectorySpanKm !== null ? `${trajectorySpanKm} km` : 'Not computable',
              note: trajectoryNote
            },
            {
              key: 'rename',
              label: 'Renaming Tool',
              value:
                pairedRecords.length > 0 ? `${matchedCount} of ${pairedRecords.length} mappable` : 'Awaiting records',
              note: 'Rename Batch (agent) or .BAT script'
            }
          ]}
        />
      </div>

      {/* Verification ledger — a single table surface */}
      <div className="space-y-3">
        <SectionLabel
          icon={<Layers size={12} />}
          note={`${filteredRecords.length} records`}
          actions={
            <>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search file, coordinate..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-inner border border-subtle rounded-lg pl-8 pr-3 py-1.5 text-xs text-text-base placeholder:text-text-muted focus:outline-none focus:border-divider w-44 sm:w-52"
                />
              </div>
              <TextAction
                icon={<FileSpreadsheet size={11} />}
                onClick={handleRenameOnNas}
                disabled={isGuestUser || renameBusy || renameableRecords.length === 0}
                title="Batch-rename the stitched images to their metadata names directly on the NAS via a station agent"
              >
                {renameBusy ? 'Renaming…' : renameableRecords.length > 0 ? `Rename Batch (${renameableRecords.length})` : 'Rename Batch'}
              </TextAction>
              <TextAction
                icon={<Download size={11} />}
                onClick={handleDownloadRenameScript}
                disabled={pairedRecords.length === 0}
                title="Download .bat rename script for local NAS drive"
              >
                .BAT Script
              </TextAction>
            </>
          }
        >
          Spatial Pairing Verification Ledger
        </SectionLabel>

        <div className="rounded-xl border border-subtle bg-card overflow-hidden flex flex-col">
          {filteredRecords.length === 0 ? (
            <div className="py-12 px-4 text-center flex flex-col items-center justify-center gap-2 text-text-muted">
              <Layers size={32} className="opacity-40" />
              <p className="text-xs font-medium">No pairing records loaded yet.</p>
              <p className="text-[11px] max-w-sm">
                Upload a survey CSV or run <span className="font-semibold text-text-base">Auto-Pair Survey Sequence</span> to verify filename-to-GPS alignment.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs min-w-[1080px]">
                <thead>
                  <tr className="border-b border-divider bg-inner text-[10px] uppercase font-bold text-text-muted tracking-wider sticky top-0 z-10">
                    <th className="py-2.5 px-3 w-14">#</th>
                    <th className="py-2.5 px-3">Original Tour Filename</th>
                    <th className="py-2.5 px-3">Metadata Filename</th>
                    <th className="py-2.5 px-3">Target Subgrid Name</th>
                    <th className="py-2.5 px-3 w-24">Time</th>
                    <th className="py-2.5 px-3 w-28">Latitude</th>
                    <th className="py-2.5 px-3 w-28">Longitude</th>
                    <th className="py-2.5 px-3 w-20">Heading</th>
                    <th className="py-2.5 px-3 w-24 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider font-mono">
                  {filteredRecords.map((r) => (
                    <tr key={r.index} className="hover:bg-inner transition-colors">
                      <td className="py-2 px-3 text-text-muted text-[11px]">{r.index}</td>
                      <td className="py-2 px-3 text-text-muted truncate max-w-[260px]" title={r.originalFilename || r.sourceFilename}>
                        {r.originalFilename || r.sourceFilename || '—'}
                      </td>
                      <td className="py-2 px-3 text-text-muted truncate max-w-[200px]" title={r.sourceFilename}>
                        {r.sourceFilename || '—'}
                      </td>
                      <td className="py-2 px-3">
                        {r.isMatched && r.originalFilename && r.targetFilename && r.originalFilename !== r.targetFilename ? (
                          r.renamedAt ? (
                            <div className="flex flex-col leading-tight">
                              <span className="text-text-base font-semibold truncate max-w-[220px]" title={r.targetFilename}>{r.targetFilename}</span>
                              <span className="text-[9px] font-sans text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 size={9} />
                                <span>renamed {r.renamedAt ? new Date(r.renamedAt).toLocaleString() : ''}</span>
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-text-muted truncate max-w-[180px]" title={r.originalFilename}>{r.originalFilename}</span>
                              <ArrowRight size={11} className="text-sky-400 shrink-0" />
                              <span className="text-text-base font-semibold truncate max-w-[180px]" title={r.targetFilename}>{r.targetFilename}</span>
                            </div>
                          )
                        ) : (
                          <span className="text-text-base font-semibold truncate max-w-[220px] inline-block" title={r.targetFilename}>
                            {r.targetFilename || '—'}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-text-muted">{r.timestamp || '—'}</td>
                      <td className="py-2 px-3 text-text-base">{r.latitude.toFixed(6)}°</td>
                      <td className="py-2 px-3 text-text-base">{r.longitude.toFixed(6)}°</td>
                      <td className="py-2 px-3 text-text-muted">
                        {r.heading === null ? '—' : `${r.heading.toFixed(1)}°`}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {r.renamedAt ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-sans font-medium text-emerald-400">
                            <CheckCircle2 size={11} />
                            <span>Renamed</span>
                          </span>
                        ) : r.isMatched ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-sans font-medium text-text-base">
                            <CheckCircle2 size={11} className="text-emerald-500" />
                            <span>Matched</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-sans font-medium text-text-muted">
                            <AlertTriangle size={11} />
                            <span>Check</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="p-3 border-t border-divider flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px] text-text-muted">
              {pairedRecords.length > 0
                ? `Ready to dispatch ${pairedRecords.length} verified records to Multi-PC Station Board.`
                : 'Configure subgrid and pair frames to proceed.'}
            </span>

            <button
              onClick={onAdvanceToNextStation}
              disabled={pairedRecords.length === 0}
              className="px-4 py-2 bg-text-base text-card hover:opacity-90 font-semibold text-xs rounded-lg flex items-center gap-2 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <span>Proceed to 4-PC Assembly Board</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
