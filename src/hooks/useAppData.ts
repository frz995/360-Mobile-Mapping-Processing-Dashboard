import { useEffect, useRef, useState } from 'react';
import {
  supabase,
  fetchSupabaseData,
  fetchQaRecordsFromSupabase,
  fetchQaAuditRunsFromSupabase,
  fetchAuditLogsFromSupabase,
  fetchNotificationsFromSupabase,
  fetchProjectSettingsFromSupabase
} from '../services/supabase';
import { extractSubgridName } from '../utils/subgrid';
import { getItemId } from '../utils/items';
import { STORAGE_BUCKET_DEFAULT, STORAGE_PATH_PREFIX_DEFAULT, DATABASE_TABLE_DEFAULTS } from '../config/defaults';
import { getImagesProcessedCount, getPOICount } from '../utils/dashboardData';
import type { QAQCAuditRunRecord } from '../types/admin';
import type { DailyTimeSeries, BatchLog, NotificationItem, AuditLogItem } from '../types/dashboard';

export interface QAFlagState {
  flags: { blurry: boolean; obstruction: boolean; badGps: boolean };
  answer: 'yes' | 'no' | null;
  isLocked: boolean;
}

const DEFAULT_PROJECT_SETTINGS = {
  projectName: '360 Mobile Mapping — Spatial Operations Division',
  contractCode: 'MMS-2026-GEO-01',
  targetKm: 315.2,
  targetImages: 50000,
  targetDeadline: '2026-12-31',
  maxDefectRatePercent: 1.5,
  minGpsAccuracyM: 1.0,
  cameraResolution: '8K 360° Equirectangular',
  defaultEquipment: 'MMS',
  leadPic: '',
  regionZone: 'Central Operations Region',
  clientName: 'Spatial Asset Operations',
  // Database & Image Fetching Settings
  storageProvider: 'supabase',
  imageStorageStrategy: 'single_equirectangular',
  supabaseBucket: STORAGE_BUCKET_DEFAULT,
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  dbAutoSyncSec: 60,
  dbTableName: DATABASE_TABLE_DEFAULTS.batchLogsTable,
  imageFetchSource: 'supabase',
  imageStoragePath: STORAGE_PATH_PREFIX_DEFAULT,
  imageFormatPattern: '{subgrid}-{index:04d}.jpg',
  imagePreloadCount: 3,
  enableImageRetryFallback: true,
  // GIS Spatial Reference & Bounding Box Settings
  selectedCrs: 'EPSG:4326',
  selectedRegionBBox: 'peninsular_malaysia',
  minLat: 1.2,
  maxLat: 6.8,
  minLon: 99.6,
  maxLon: 104.6,
  autoDeduplicateSubgrids: true,
  deduplicationStrategy: 'clean_merge',
  enableBBoxFilter: true,
  autoPanOnTrackClick: true,
  defaultBasemapStyle: 'dark',
  defectThreshold: 85,
  aiDefectThresholdPercent: 85,
  csvLatAliases: 'latitude, lat, y, y_coord',
  csvLonAliases: 'longitude, lon, lng, x, x_coord',
  csvHeadingAliases: 'heading, bearing, dir, orientation',
  csvFilenameAliases: 'filename, imagefilename, image_url, file, frame_id',
  csvSubgridAliases: 'subgrid, grid_id, section, tile',
  csvDateAliases: 'date, time, captured_at, timestamp',
  dropZeroGpsRows: true,
  csvTimestampFormat: 'auto'
};

export function useAppData() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [dailyData, setDailyData] = useState<DailyTimeSeries[]>([]);
  const [batchLogs, setBatchLogs] = useState<BatchLog[]>([]);
  const [qaqcAuditRuns, setQaqcAuditRuns] = useState<Record<string, QAQCAuditRunRecord>>({});
  const [qaSubgridRecords, setQaSubgridRecords] = useState<Record<string, QAFlagState>>({});
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [projectSettings, setProjectSettings] = useState<any>(() => ({ ...DEFAULT_PROJECT_SETTINGS }));
  const [liveDefectCount, setLiveDefectCount] = useState<number>(0);

  // Only flash the loading overlay on the very first load; subsequent refreshes keep cached data visible
  const hasLoadedDataRef = useRef(false);

  useEffect(() => {
    async function initLiveSupabaseData(isSilent: boolean = false) {
      if (!isSilent && !hasLoadedDataRef.current) {
        setIsDataLoading(true);
      }

      try {
        // Fetch all data sources concurrently in parallel
        const [supabaseDataRes, qaRes, fetchedQa, fetchedAuditRuns, dbAuditLogs, dbNotifications, dbSettingsRes] = await Promise.allSettled([
          fetchSupabaseData(projectSettings),
          supabase.from(projectSettings?.qaDefectsTable || 'qa_defects').select('qa_status, defect_flags, defect_count, subgrid'),
          fetchQaRecordsFromSupabase(projectSettings),
          fetchQaAuditRunsFromSupabase(projectSettings),
          fetchAuditLogsFromSupabase(projectSettings),
          fetchNotificationsFromSupabase(projectSettings),
          fetchProjectSettingsFromSupabase()
        ]);

        // Process Project Settings
        if (dbSettingsRes.status === 'fulfilled' && dbSettingsRes.value) {
          setProjectSettings((prev: any) => ({ ...prev, ...dbSettingsRes.value }));
        }

        // Purge legacy ghost caches to ensure Supabase is 100% Single Source of Truth
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('app_qaqc_audit_cache_v2');
            localStorage.removeItem('geosphere_staged_daily_cache_v1');
          }
        } catch (_) { }

        // Process Cloud QAQC Audit Runs directly from Supabase (Single Source of Truth)
        let cloudAuditMap: Record<string, QAQCAuditRunRecord> = {};
        if (fetchedAuditRuns.status === 'fulfilled' && fetchedAuditRuns.value) {
          cloudAuditMap = { ...fetchedAuditRuns.value };
        }
        setQaqcAuditRuns(cloudAuditMap);

        // Process QA Defects map first from qaRes
        const defectsPerSubgrid = new Map<string, number>();
        let totalFlaggedCount = 0;
        if (qaRes.status === 'fulfilled' && qaRes.value.data) {
          const qaRows = qaRes.value.data;
          qaRows.forEach((q: any) => {
            const isFlagged = q.qa_status === 'flagged' ||
              (q.defect_flags && typeof q.defect_flags === 'object' && Object.values(q.defect_flags).some(Boolean)) ||
              (q.defect_count && Number(q.defect_count) > 0);

            if (isFlagged) {
              totalFlaggedCount++;
              if (q.subgrid) {
                const normSg = (extractSubgridName(q.subgrid) || q.subgrid).toUpperCase().trim();
                defectsPerSubgrid.set(normSg, (defectsPerSubgrid.get(normSg) || 0) + 1);
              }
            }
          });
          setLiveDefectCount(totalFlaggedCount);
        }

        // Process Core Daily & Batch Data directly from Supabase (Single Source of Truth)
        if (supabaseDataRes.status === 'fulfilled') {
          const { dailyData: sDaily, batchLogs: sBatches } = supabaseDataRes.value;

          const hydratedDaily = (sDaily || []).map((d: any) => {
            const sg = (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim();
            const runId = getItemId(d);
            const frameCount = getImagesProcessedCount(d);
            const poiCount = getPOICount(d) || frameCount;
            const subgridDefectsFromDb = defectsPerSubgrid.get(sg) || 0;
            const cachedAudit = (runId ? cloudAuditMap[`${sg}_${runId}`] : undefined) || cloudAuditMap[`${sg}_default`] || Object.entries(cloudAuditMap).find(([k]) => k.startsWith(`${sg}_`))?.[1];
            const cachedDefects = (cachedAudit && typeof cachedAudit.defectCount === 'number')
              ? cachedAudit.defectCount
              : (d.defectCount || d.imagesDefected || subgridDefectsFromDb || 0);
            const finalDefects = (poiCount > 0 || frameCount > 0)
              ? Math.min(cachedDefects, Math.max(poiCount, frameCount))
              : cachedDefects;
            const isPub = d.publishToWebGIS === 'yes' || d.isSyncedWithSupabase === true;

            const qaqcStatus = cachedAudit
              ? (isPub
                ? (finalDefects === 0 ? 'Published (QAQC Verified)' : `Published (${finalDefects} Defect${finalDefects === 1 ? '' : 's'} Found)`)
                : (finalDefects === 0 ? 'QAQC Passed (Ready to Publish)' : `QAQC Flagged (${finalDefects} Defect${finalDefects === 1 ? '' : 's'} Found)`)
              )
              : (d.qaqcStatus ? d.qaqcStatus : (isPub ? 'Published' : undefined));

            return {
              ...d,
              defectCount: finalDefects,
              imagesDefected: finalDefects,
              ...(qaqcStatus ? { qaqcStatus } : {})
            };
          });

          const hydratedBatches = (sBatches || []).map((b: any) => {
            const sg = (extractSubgridName(b.subgrid || b.imageFilename) || b.subgrid || '').toUpperCase().trim();
            const matchingDaily = hydratedDaily.filter((d: any) => (extractSubgridName(d.subgrid) || d.subgrid || '').toUpperCase().trim() === sg);
            const dailyDefectsSum = matchingDaily.reduce((acc: number, d: any) => acc + (d.defectCount || 0), 0);
            const cachedAudit = cloudAuditMap[`${sg}_default`] || Object.entries(cloudAuditMap).find(([k]) => k.startsWith(`${sg}_`))?.[1];
            const cachedDefects = (cachedAudit && typeof cachedAudit.defectCount === 'number') ? cachedAudit.defectCount : 0;
            const finalDefects = dailyDefectsSum > 0 ? dailyDefectsSum : (cachedDefects > 0 ? cachedDefects : (typeof b.defects === 'number' ? b.defects : 0));

            const qaqcStatus = b.qaqcStatus || (cachedAudit
              ? (cachedDefects === 0 ? 'QAQC Passed (Ready to Publish)' : `QAQC Flagged (${cachedDefects} Defect${cachedDefects === 1 ? '' : 's'} Found)`)
              : (finalDefects > 0 ? `QAQC Completed (${finalDefects} Defects Found)` : undefined));

            return {
              ...b,
              defects: finalDefects,
              ...(qaqcStatus ? { qaqcStatus } : {})
            };
          });

          setDailyData(hydratedDaily);
          setBatchLogs(hydratedBatches);
        }

        // Process QA Records
        if (fetchedQa.status === 'fulfilled' && fetchedQa.value && Object.keys(fetchedQa.value).length > 0) {
          setQaSubgridRecords(prev => ({ ...fetchedQa.value, ...prev }));
        }

        // Process Audit Logs with dynamic read persistence
        if (dbAuditLogs.status === 'fulfilled' && dbAuditLogs.value.length > 0) {
          let readAuditSet = new Set<string>();
          let lastReadAuditTime = 0;
          try {
            readAuditSet = new Set(JSON.parse(localStorage.getItem('app_read_audit_ids') || '[]'));
            lastReadAuditTime = Number(localStorage.getItem('app_last_read_audit_time') || '0');
          } catch (_) { }

          setAuditLogs(prev => {
            return dbAuditLogs.value.map((a: any) => {
              const strId = String(a.id);
              const itemTime = a.created_at ? new Date(a.created_at).getTime() : 0;
              const isRead = Boolean(a.read) ||
                readAuditSet.has(strId) ||
                readAuditSet.has(`audit-${strId}`) ||
                (lastReadAuditTime > 0 && itemTime > 0 && itemTime <= lastReadAuditTime) ||
                prev.some(p => String(p.id) === strId && p.read);
              return {
                ...a,
                read: isRead
              };
            });
          });
        }

        // Process Notifications with dynamic read & clear persistence
        if (dbNotifications.status === 'fulfilled' && dbNotifications.value.length > 0) {
          let readNotifSet = new Set<string>();
          let lastReadNotifTime = 0;
          let clearedNotifTime = 0;
          try {
            readNotifSet = new Set(JSON.parse(localStorage.getItem('app_read_notif_ids') || '[]'));
            lastReadNotifTime = Number(localStorage.getItem('app_last_read_notif_time') || '0');
            clearedNotifTime = Number(localStorage.getItem('app_cleared_notif_time') || '0');
          } catch (_) { }

          setNotifications(prev => {
            return dbNotifications.value
              .filter((n: any) => {
                if (clearedNotifTime > 0) {
                  const itemTime = n.created_at ? new Date(n.created_at).getTime() : 0;
                  if (itemTime > 0 && itemTime <= clearedNotifTime) return false;
                }
                return true;
              })
              .map((n: any) => {
                const strId = String(n.id);
                const itemTime = n.created_at ? new Date(n.created_at).getTime() : 0;
                const isRead = Boolean(n.read) ||
                  readNotifSet.has(strId) ||
                  readNotifSet.has(`notif-${strId}`) ||
                  (lastReadNotifTime > 0 && itemTime > 0 && itemTime <= lastReadNotifTime) ||
                  prev.some(p => String(p.id) === strId && p.read);
                return {
                  ...n,
                  read: isRead
                };
              });
          });
        }
      } catch (err) {
        console.warn('Supabase fetch notice:', err);
        setSupabaseError('Unable to connect to Supabase backend. Operating in offline cached mode.');
      } finally {
        if (!isSilent) {
          setIsDataLoading(false);
        }
      }
    }

    initLiveSupabaseData(false);

    // Realtime channel subscriptions
    const channelName = `live-dashboard-sync-${Date.now()}`;
    const liveChannel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: projectSettings?.panoramasTable || 'panoramas' }, () => {
        initLiveSupabaseData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: projectSettings?.qaDefectsTable || 'qa_defects' }, () => {
        initLiveSupabaseData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: projectSettings?.qaqcRunsTable || 'qaqc_audit_runs' }, () => {
        initLiveSupabaseData(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_settings' }, () => {
        initLiveSupabaseData(true);
      });

    try {
      liveChannel.subscribe();
    } catch (e) {
      console.warn('Realtime subscription notice:', e);
    }

    // 30s Polling fallback
    const liveInterval = setInterval(() => {
      initLiveSupabaseData(true);
    }, 30000);

    return () => {
      try { supabase.removeChannel(liveChannel); } catch { }
      clearInterval(liveInterval);
    };
  }, []);

  return {
    notifications,
    setNotifications,
    auditLogs,
    setAuditLogs,
    dailyData,
    setDailyData,
    batchLogs,
    setBatchLogs,
    qaqcAuditRuns,
    setQaqcAuditRuns,
    qaSubgridRecords,
    setQaSubgridRecords,
    isDataLoading,
    setIsDataLoading,
    supabaseError,
    setSupabaseError,
    projectSettings,
    setProjectSettings,
    liveDefectCount,
    setLiveDefectCount
  };
}
