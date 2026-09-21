import { supabase, scoped, getServiceProjectId } from './client';
import { DATABASE_TABLE_DEFAULTS } from '../../config/defaults';
import type { QADefectRecord, QAQCAuditRunRecord } from '../../types/admin';
import { saveAuditLogToSupabase } from './admin';

function extractSubgrid(filename: string): string {
  if (!filename) return '';
  const clean = filename.split('/').pop() || filename;
  const match = clean.match(/(N\d+E\d+)/i);
  if (match) return match[1].toUpperCase();
  const base = clean.replace(/\.[^/.]+$/, '').trim();
  return base || '';
}

/**
 * Real-time update of defect count, QA status, and defect flags in Supabase database.
 * Supports updating both individual panotrack image records and subgrid aggregates.
 */
export async function updateDefectStatusInSupabase(
  itemKey: string,
  defectCount: number,
  qaStatus: string = 'Reviewing',
  defectFlags?: any,
  authUser?: { id?: string; email?: string; name?: string },
  settings?: any
): Promise<{ success: boolean; message: string }> {
  try {
    const cleanKey = (itemKey || '').trim();
    if (!cleanKey) return { success: false, message: 'No subgrid or image key provided' };
    const isFilename = cleanKey.includes('-') || cleanKey.toLowerCase().endsWith('.jpg');

    const panoramasTable = settings?.panoramasTable || import.meta.env.VITE_DB_PANORAMAS_TABLE || DATABASE_TABLE_DEFAULTS.panoramasTable;
    const qaDefectsTable = settings?.qaDefectsTable || import.meta.env.VITE_DB_QA_DEFECTS_TABLE || DATABASE_TABLE_DEFAULTS.qaDefectsTable;

    // 1. Update panoramas table (by exact/matched filename or subgrid prefix)
    try {
      let query = supabase.from(panoramasTable).update({
        defect_count: defectCount,
        qa_status: qaStatus,
        defect_flags: defectFlags || {}
      });

      if (isFilename) {
        query = query.or(`filename.ilike.%${cleanKey}%,image_url.ilike.%${cleanKey}%`);
      } else {
        query = query.ilike('filename', `${cleanKey}%`);
      }
      await query;
    } catch (panoramaError: any) {
      console.warn('Supabase panoramas update notice (non-fatal):', panoramaError?.message);
    }

    // 2. Upsert into qa_defects table for persistent QA logging per item
    try {
      const subgrid = (defectFlags?.subgrid || extractSubgrid(cleanKey) || cleanKey.split('-')[0] || cleanKey).toUpperCase().trim();
      const pointId = defectFlags?.point_id || cleanKey;
      const isResolved = qaStatus?.toLowerCase().includes('passed') || qaStatus?.toLowerCase().includes('clean');

      await supabase.from(qaDefectsTable).upsert({
        subgrid: subgrid,
        point_id: pointId,
        frame_index: typeof defectFlags?.frame_index === 'number' ? defectFlags.frame_index : 0,
        defect_flags: defectFlags?.selectedQaFlags || defectFlags || {},
        defect_type: defectFlags?.defect_type || (qaStatus === 'flagged' ? 'Defect Detected' : 'Manual QAQC Inspection'),
        pic: defectFlags?.pic || authUser?.name || 'Operator',
        image_url: defectFlags?.image_url || null,
        lat: defectFlags?.lat || null,
        lng: defectFlags?.lng || null,
        bearing: defectFlags?.bearing || null,
        is_resolved: isResolved,
        resolved_at: isResolved ? new Date().toISOString() : null,
        user_id: authUser?.id || null,
        user_email: authUser?.email || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'subgrid,point_id' });
    } catch (qaErr) {
      console.warn('qa_defects sync notice (non-fatal):', qaErr);
    }

    return { success: true, message: `Synced QA status for ${cleanKey} in Supabase` };
  } catch (err) {
    console.warn('Supabase defect update error:', err);
    return { success: false, message: (err as Error).message };
  }
}

/**
 * Fetch saved QA records from Supabase database to restore state on page load.
 */
export async function fetchQaRecordsFromSupabase(settings?: any): Promise<Record<string, { flags: any; answer: any; isLocked: boolean }>> {
  try {
    const qaDefectsTable = settings?.qaDefectsTable || import.meta.env.VITE_DB_QA_DEFECTS_TABLE || DATABASE_TABLE_DEFAULTS.qaDefectsTable;
    const records: Record<string, any> = {};
    const { data, error } = await scoped(supabase.from(qaDefectsTable).select('*'));
    if (!error && data && data.length > 0) {
      data.forEach((item: any) => {
        const key = (item.point_id || item.filename || item.item_key || item.subgrid || '').toUpperCase().trim();
        if (key) {
          records[key] = {
            flags: item.defect_flags?.selectedQaFlags || item.defect_flags || { blurry: false, obstruction: false, badGps: false },
            answer: item.answer || (item.is_resolved ? 'no' : (item.qa_status?.toLowerCase().includes('flagged') || !item.is_resolved) ? 'yes' : null),
            isLocked: true
          };
        }
      });
    }
    return records;
  } catch (err) {
    console.warn('Unable to fetch QA records from Supabase:', err);
    return {};
  }
}

/**
 * Fetch all QA/QC audit run summaries directly from Supabase cloud database.
 */
export async function fetchQaAuditRunsFromSupabase(settings?: any): Promise<Record<string, QAQCAuditRunRecord>> {
  try {
    const qaqcRunsTable = settings?.qaqcRunsTable || import.meta.env.VITE_DB_QAQC_RUNS_TABLE || DATABASE_TABLE_DEFAULTS.qaqcRunsTable;
    const { data, error } = await scoped(supabase.from(qaqcRunsTable).select('subgrid, run_id, id, total_stations, defect_count, pass_rate, mean_tenengrad_score, defects_list, history, pic, user_id, user_email, completed_at, created_at, updated_at')).order('completed_at', { ascending: false });
    if (error) {
      console.warn('fetchQaAuditRunsFromSupabase notice:', error.message);
      return {};
    }
    const result: Record<string, QAQCAuditRunRecord> = {};
    (data || []).forEach((row: any) => {
      const normSg = (extractSubgrid(row.subgrid) || row.subgrid || '').toUpperCase().trim();
      const runId = row.run_id || 'default';
      const record: QAQCAuditRunRecord = {
        id: row.id,
        subgrid: normSg,
        runId: row.run_id || null,
        totalStations: Number(row.total_stations) || 0,
        defectCount: Number(row.defect_count) || 0,
        passRate: Number(row.pass_rate) || 100,
        meanTenengradScore: Number(row.mean_tenengrad_score) || 0,
        defectsList: Array.isArray(row.defects_list) ? row.defects_list : [],
        history: Array.isArray(row.history) ? row.history : [],
        pic: row.pic || '',
        user_id: row.user_id || undefined,
        user_email: row.user_email || undefined,
        completedAt: row.completed_at || row.created_at || new Date().toISOString(),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
      result[`${normSg}_${runId}`] = record;
      if (!result[`${normSg}_default`]) {
        result[`${normSg}_default`] = record;
      }
    });

    return result;
  } catch (err) {
    console.warn('fetchQaAuditRunsFromSupabase catch:', err);
    return {};
  }
}

/**
 * Persist completed QA/QC audit run to Supabase cloud database with user context.
 */
export async function saveQaAuditRunToSupabase(
  record: QAQCAuditRunRecord,
  authUser?: { id?: string; email?: string; name?: string },
  settings?: any
): Promise<boolean> {
  try {
    const qaqcRunsTable = settings?.qaqcRunsTable || import.meta.env.VITE_DB_QAQC_RUNS_TABLE || DATABASE_TABLE_DEFAULTS.qaqcRunsTable;
    const normSg = (extractSubgrid(record.subgrid) || record.subgrid || '').toUpperCase().trim();
    const runId = record.runId || 'default';

    const pid = getServiceProjectId();
    const payload = {
      ...(pid ? { project_id: pid } : {}),
      subgrid: normSg,
      run_id: runId,
      total_stations: record.totalStations || 0,
      defect_count: record.defectCount || 0,
      pass_rate: record.passRate || 100,
      mean_tenengrad_score: record.meanTenengradScore || 0,
      defects_list: record.defectsList || [],
      history: record.history || [],
      pic: record.pic || authUser?.name || 'Operator',
      user_id: record.user_id || authUser?.id || null,
      user_email: record.user_email || authUser?.email || null,
      completed_at: record.completedAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from(qaqcRunsTable).upsert(payload, { onConflict: 'subgrid,run_id' });
    if (error) {
      console.warn('saveQaAuditRunToSupabase notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('saveQaAuditRunToSupabase catch:', err);
    return false;
  }
}

/**
 * Fetch all QA defect anomaly records for a specific subgrid.
 */
export async function fetchQADefectsForSubgrid(subgrid: string): Promise<QADefectRecord[]> {
  try {
    const cleanSub = (subgrid || '').toUpperCase().trim();
    if (!cleanSub) return [];

    const defectMap = new Map<string, QADefectRecord>();

    // 1. Fetch from dedicated qa_defects table
    try {
      const { data: qaRows, error } = await scoped(supabase
        .from('qa_defects')
        .select('point_id, filename, item_key, id, subgrid, frame_index, defect_flags, defect_type, pic, image_url, lat, lng, bearing, is_resolved, resolved_at, created_at'))
        .eq('subgrid', cleanSub)
        .order('frame_index', { ascending: true });

      if (!error && Array.isArray(qaRows)) {
        qaRows.forEach((row: any) => {
          const ptId = (row.point_id || row.filename || row.item_key || '').replace(/^.*[\\\/]/, '');
          if (!ptId) return;
          defectMap.set(ptId.toUpperCase(), {
            id: row.id,
            subgrid: row.subgrid || cleanSub,
            point_id: ptId,
            frame_index: row.frame_index || 1,
            defect_flags: typeof row.defect_flags === 'object' ? row.defect_flags : {},
            defect_type: row.defect_type || 'QA Defect',
            pic: row.pic || 'Inspector',
            image_url: row.image_url,
            lat: row.lat,
            lng: row.lng,
            bearing: row.bearing,
            is_resolved: Boolean(row.is_resolved),
            resolved_at: row.resolved_at,
            created_at: row.created_at
          });
        });
      }
    } catch (_) { }

    // 2. Also fetch from qaqc_audit_runs where defects_list JSON is stored
    try {
      const { data: auditRows, error: auditError } = await scoped(supabase
        .from('qaqc_audit_runs')
        .select('id, defects_list, pic, created_at'))
        .ilike('subgrid', `%${cleanSub}%`)
        .order('created_at', { ascending: false });

      if (!auditError && Array.isArray(auditRows)) {
        auditRows.forEach((audit: any) => {
          if (Array.isArray(audit.defects_list)) {
            audit.defects_list.forEach((d: any, idx: number) => {
              const ptId = (d.point_id || d.filename || d.imageFilename || `${cleanSub}-${String(idx + 1).padStart(4, '0')}.jpg`).replace(/^.*[\\\/]/, '');
              const key = ptId.toUpperCase();
              if (!defectMap.has(key)) {
                defectMap.set(key, {
                  id: d.id || `audit-${audit.id}-${idx}`,
                  subgrid: d.subgrid || cleanSub,
                  point_id: ptId,
                  frame_index: d.frame_index || (idx + 1),
                  defect_flags: typeof d.defect_flags === 'object' ? d.defect_flags : { blur: d.defect_type?.toLowerCase().includes('blur'), obstruction: d.defect_type?.toLowerCase().includes('obstruction'), badGps: d.defect_type?.toLowerCase().includes('gps') },
                  defect_type: d.defect_type || 'QA Defect',
                  pic: d.pic || audit.pic || 'Inspector',
                  image_url: d.image_url,
                  lat: d.lat ?? d.latitude,
                  lng: d.lng ?? d.lon ?? d.longitude,
                  bearing: d.bearing,
                  is_resolved: Boolean(d.is_resolved),
                  resolved_at: d.resolved_at,
                  created_at: d.created_at || audit.created_at
                });
              }
            });
          }
        });
      }
    } catch (_) { }

    return Array.from(defectMap.values());
  } catch (err) {
    console.warn('fetchQADefectsForSubgrid catch:', err);
    return [];
  }
}

/**
 * Update QA defect record as resolved/dismissed in Supabase.
 */
export async function resolveQADefectInSupabase(subgrid: string, pointId: string, resolvedBy?: string): Promise<boolean> {
  try {
    const cleanSub = (subgrid || '').toUpperCase().trim();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('qa_defects')
      .update({
        is_resolved: true,
        resolved_at: now
      })
      .eq('subgrid', cleanSub)
      .eq('point_id', pointId);

    if (error) {
      console.warn('resolveQADefectInSupabase error:', error.message);
      return false;
    }

    // Save audit trail
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    saveAuditLogToSupabase({
      timestamp: `${dateStr}, ${timeStr}`,
      type: 'EDIT',
      title: `QA Defect Resolved: ${pointId}`,
      details: `Defect on node ${pointId} in subgrid ${cleanSub} marked as resolved/dismissed by ${resolvedBy || 'Operator'}.`,
      user: resolvedBy || 'Operator',
      status: 'success'
    }).catch(() => { });

    return true;
  } catch (err) {
    console.warn('resolveQADefectInSupabase catch:', err);
    return false;
  }
}
