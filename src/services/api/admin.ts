import { supabase, scoped, getServiceProjectId } from './client';
import { STORAGE_BUCKET_DEFAULT } from '../../config/defaults';
import type { ExtendedProjectSettings } from '../../types/admin';
import { getStorageInventoryCacheTotalFiles } from './storage';
import { isUuid } from '../../utils/userAccountId';

/**
 * Fetch persisted audit logs from Supabase database.
 */
export async function fetchAuditLogsFromSupabase(settings?: ExtendedProjectSettings): Promise<any[]> {
  try {
    const table = settings?.auditLogsTable || 'audit_logs';
    const query = scoped(supabase.from(table).select('*'));
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !data || data.length === 0) return [];

    return data.map((item: any) => {
      const id = String(item.id || item.created_at || item.timestamp);
      return {
        id: item.id || `audit-${id}`,
        timestamp: item.timestamp || (item.created_at ? new Date(item.created_at).toLocaleString() : ''),
        type: item.type || 'SYSTEM',
        title: item.title,
        details: item.details,
        user: item.user_name || item.user || 'System',
        status: item.status || 'info',
        read: Boolean(item.read)
      };
    });
  } catch (err) {
    console.warn('Unable to fetch audit logs from Supabase:', err);
    return [];
  }
}

/**
 * Persist new audit log record to Supabase database.
 */
export async function saveAuditLogToSupabase(log: {
  timestamp: string;
  type: string;
  title: string;
  details: string;
  user: string;
  status: string;
}): Promise<boolean> {
  try {
    const pid = getServiceProjectId();
    const { error } = await supabase.from('audit_logs').insert([{
      timestamp: log.timestamp,
      type: log.type,
      title: log.title,
      details: log.details,
      user_name: log.user,
      status: log.status,
      ...(pid ? { project_id: pid } : {})
    }]);
    if (error) {
      console.warn('Audit log insert notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception inserting audit log:', err);
    return false;
  }
}

/**
 * Fetch persisted system notifications from Supabase database.
 */
export async function fetchNotificationsFromSupabase(settings?: ExtendedProjectSettings): Promise<any[]> {
  try {
    const table = settings?.notificationsTable || 'notifications';
    const query = scoped(supabase.from(table).select('*'));
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !data || data.length === 0) return [];

    return data.map((item: any) => {
      const id = String(item.id || item.created_at || item.timestamp);
      return {
        id: item.id || `notif-${id}`,
        timestamp: item.timestamp || (item.created_at ? new Date(item.created_at).toLocaleString() : ''),
        title: item.title,
        message: item.message,
        category: item.category || 'SYSTEM',
        read: Boolean(item.read),
        totalItems: item.total_items || item.totalItems
      };
    });
  } catch (err) {
    console.warn('Unable to fetch notifications from Supabase:', err);
    return [];
  }
}

/**
 * Persist new notification to Supabase database.
 */
export async function saveNotificationToSupabase(notif: {
  timestamp: string;
  title: string;
  message: string;
  category: string;
  read?: boolean;
  totalItems?: number;
}): Promise<boolean> {
  try {
    const pid = getServiceProjectId();
    const { error } = await supabase.from('notifications').insert([{
      timestamp: notif.timestamp,
      title: notif.title,
      message: notif.message,
      category: notif.category,
      read: notif.read || false,
      total_items: notif.totalItems || 0,
      ...(pid ? { project_id: pid } : {})
    }]);
    if (error) {
      console.warn('Notification insert notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception inserting notification:', err);
    return false;
  }
}

/**
 * Diagnostic health probe measuring PostGIS and Storage latency in real-time.
 *
 * Only measured values are reported. Values this probe cannot observe are
 * returned as null / 'unknown' rather than filled in with plausible constants,
 * which previously showed a green "34ms / 114 files / realtime connected /
 * WebGIS online" panel for a system that had never been checked.
 */
export async function testDatabaseHealth(): Promise<{
  postgisStatus: 'operational' | 'degraded' | 'offline';
  postgisLatencyMs: number;
  storageStatus: 'operational' | 'degraded' | 'offline';
  /** null when the inventory has not been enumerated, not a placeholder count. */
  storageTotalFiles: number | null;
  realtimeStatus: 'connected' | 'connecting' | 'disconnected' | 'unknown';
  webgisStatus: 'online' | 'degraded' | 'offline' | 'unknown';
  /** null when the browser does not expose heap metrics. */
  memoryUsageMb: number | null;
  lastPingTime: string;
}> {
  const startTime = performance.now();
  let postgisStatus: 'operational' | 'degraded' | 'offline' = 'operational';
  let storageStatus: 'operational' | 'degraded' | 'offline' = 'operational';
  let totalFiles: number | null = null;

  try {
    const { error } = await supabase.from('panoramas').select('id').limit(1);
    if (error) postgisStatus = 'degraded';
  } catch {
    postgisStatus = 'offline';
  }

  const postgisLatencyMs = Math.round(performance.now() - startTime);

  try {
    const bucket = import.meta.env.VITE_SUPABASE_BUCKET || STORAGE_BUCKET_DEFAULT;
    // Fast ping: probe storage reachability with a 1-item check rather than a 10,000-file sequential crawl
    const { error: storageErr } = await supabase.storage.from(bucket).list('', { limit: 1 });
    if (storageErr) {
      storageStatus = 'degraded';
    }
    const cachedTotal = getStorageInventoryCacheTotalFiles();
    totalFiles = typeof cachedTotal === 'number' && cachedTotal > 0 ? cachedTotal : null;
  } catch {
    storageStatus = 'degraded';
  }

  const heap = (typeof performance !== 'undefined' ? (performance as any).memory?.usedJSHeapSize : undefined);
  const memoryUsageMb = typeof heap === 'number' && heap > 0
    ? Math.round(heap / (1024 * 1024))
    : null;

  return {
    postgisStatus,
    postgisLatencyMs,
    storageStatus,
    storageTotalFiles: totalFiles,
    // This probe does not open a realtime channel or call the WebGIS host, so
    // it cannot assert either state.
    realtimeStatus: 'unknown',
    webgisStatus: 'unknown',
    memoryUsageMb,
    lastPingTime: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };
}

/**
 * One schema expectation this app depends on, and the migration that satisfies it.
 */
export interface SchemaExpectation {
  /** What the app needs, phrased for an operator who has to act on it. */
  label: string;
  /** The table or column set being checked. */
  relation: string;
  /** Columns that must exist. Empty means the table's mere presence is the check. */
  columns: string[];
  /** Migration that provides it, for the operator to go and apply. */
  migration: string;
}

/**
 * The schema this build REQUIRES, stated as data.
 *
 * WHY THIS LIST EXISTS
 *
 * Migrations 0032 and 0033 each added a column the app reads on every load, and
 * each shipped to a pilot-bound client before anyone checked whether the column
 * was there. On a database without `qa_defects.run_id` the select failed, the
 * failure was swallowed, and every survey run reported zero defects. That is a
 * system which looks perfectly healthy and is quietly wrong — the worst failure
 * mode available, and the reason a schema probe belongs next to the other
 * diagnostics.
 *
 * Each entry names the migration, so a failure tells the operator which file to
 * apply rather than only that something is wrong.
 */
export const SCHEMA_EXPECTATIONS: readonly SchemaExpectation[] = [
  {
    label: 'qa_defects.run_id — scopes a defect to one survey run',
    relation: 'qa_defects',
    columns: ['run_id'],
    migration: '0032_qa_defects_run_scope.sql'
  },
  {
    label: 'qa_defects.item_key — required NOT NULL column on the defect write',
    relation: 'qa_defects',
    columns: ['item_key'],
    migration: '0033_qa_defects_item_key.sql'
  },
  {
    label: 'panoramas.csv_file_name — migration 0029',
    relation: 'panoramas',
    columns: ['csv_file_name'],
    migration: '0029_csv_file_name.sql'
  }
] as const;

export interface SchemaCheckResult extends SchemaExpectation {
  /** 'ok' when the relation and every listed column exist. */
  status: 'ok' | 'missing_columns' | 'missing_relation' | 'unreachable';
  /** Measured names of the columns actually present; empty when unreachable. */
  foundColumns: string[];
  detail: string;
}

/**
 * Check that the schema this build needs is actually installed.
 *
 * Uses PostgREST rather than `to_regclass` because it needs no RPC, no extra
 * grant, and no `pg` dependency — the same reason `toQueryResult` exists at this
 * boundary. Selecting a column that does not exist returns an error naming it,
 * which is precisely the condition being detected, so the check cannot succeed
 * by accident.
 *
 * Every outcome is reported, including `unreachable`. A probe that returns
 * "fine" when it could not reach the database would be the same class of silent
 * failure it exists to detect.
 */
export async function checkSchemaExpectations(): Promise<SchemaCheckResult[]> {
  const results: SchemaCheckResult[] = [];

  // Group columns by relation so each table is queried once.
  const byRelation = new Map<string, string[]>();
  for (const expectation of SCHEMA_EXPECTATIONS) {
    const existing = byRelation.get(expectation.relation) ?? [];
    byRelation.set(expectation.relation, [...existing, ...expectation.columns]);
  }

  for (const [relation, columns] of byRelation) {
    // One query per relation, however many columns it is expected to have.
    // `thrown` is tracked separately from `message` because the two mean
    // different things to an operator: an error RESPONSE means the database
    // answered and the schema is wrong, while a rejection means the database was
    // never reached and the schema is simply unknown. Collapsing them is how a
    // connectivity blip gets reported as a missing migration.
    let observed:
      | { ok: true; found: string[] }
      | { ok: false; message: string; thrown: boolean }
      | null = null;

    try {
      const { data, error } = await supabase
        .from(relation)
        .select(columns.join(', '))
        .limit(1);

      if (error) {
        observed = { ok: false, message: error.message, thrown: false };
      } else {
        // An empty table still proves the columns exist: PostgREST validates the
        // select against the schema before returning rows, so reaching this
        // point without an error means every requested column resolved.
        observed = {
          ok: true,
          found: data && data.length > 0 ? Object.keys(data[0] ?? {}) : columns
        };
      }
    } catch (err) {
      observed = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        thrown: true
      };
    }

    for (const expectation of SCHEMA_EXPECTATIONS.filter((e) => e.relation === relation)) {
      // What the operator needs is the migration to apply. Postgres' own wording
      // means nothing to someone holding a deployment checklist, and a raw error
      // is how 0032 reached a pilot unnoticed.
      if (observed.ok) {
        const missing = expectation.columns.filter((c) => !observed.found.includes(c));
        results.push({
          ...expectation,
          status: missing.length === 0 ? 'ok' : 'missing_columns',
          foundColumns: observed.found,
          detail:
            missing.length === 0
              ? `present (migration ${expectation.migration} applied)`
              : `missing column(s): ${missing.join(', ')} — apply ${expectation.migration}`
        });
      } else if (observed.thrown) {
        // The database was never reached. Saying "missing" here would tell an
        // operator to apply a migration they do not need.
        results.push({
          ...expectation,
          status: 'unreachable',
          foundColumns: [],
          detail: `not checked — database unreachable (${observed.message})`
        });
      } else {
        results.push({
          ...expectation,
          // A missing relation and a missing column both surface as an error
          // response here; the message is the only thing that tells them apart.
          status: /column/i.test(observed.message) ? 'missing_columns' : 'missing_relation',
          foundColumns: [],
          detail: `${observed.message} — apply ${expectation.migration}`
        });
      }
    }
  }

  return results;
}

/**
 * Fetch data deletion approval requests from Supabase.
 */
export async function fetchDeletionRequestsFromSupabase(_currentUser?: any): Promise<any[]> {
  try {
    const { data, error } = await scoped(supabase.from('deletion_requests').select('*')).order('date_requested', { ascending: false });
    if (!error && data && data.length > 0) {
      return data.map((r: any) => ({
        id: r.id || r.request_id,
        subgrid: r.subgrid,
        requestedBy: r.requested_by,
        userEmail: r.user_email || '',
        reason: r.reason,
        poiCount: r.poi_count || 0,
        kmProcessed: r.km_processed || 0,
        dateRequested: r.date_requested,
        status: r.status || 'Pending',
        reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_at,
        rejectionReason: r.rejection_reason,
        filenames: r.filenames || []
      }));
    }
  } catch (e) {
    console.warn('Deletion requests query notice:', e);
  }

  return [];
}

/**
 * Save new data deletion approval request.
 */
export async function saveDeletionRequestToSupabase(req: any): Promise<boolean> {
  try {
    const pid = getServiceProjectId();
    const { error } = await supabase.from('deletion_requests').insert([{
      subgrid: req.subgrid,
      requested_by: req.requestedBy,
      user_email: req.userEmail,
      reason: req.reason,
      poi_count: req.poiCount,
      km_processed: req.kmProcessed,
      date_requested: req.dateRequested,
      status: 'Pending',
      filenames: req.filenames || [],
      ...(pid ? { project_id: pid } : {})
    }]);
    if (error) {
      console.warn('Deletion request insert notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception saving deletion request:', err);
    return false;
  }
}

/**
 * Update deletion approval status (Approve / Reject).
 */
export async function updateDeletionRequestStatusInSupabase(
  id: string,
  status: 'Approved' | 'Rejected',
  reviewedBy: string,
  rejectionReason?: string
): Promise<boolean> {
  const reviewedAt = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  try {
    const { error } = await supabase.from('deletion_requests').update({
      status,
      reviewed_by: reviewedBy,
      reviewed_at: reviewedAt,
      rejection_reason: rejectionReason || null
    }).eq('id', id);
    if (error) {
      console.warn('Update deletion request notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception updating deletion request:', err);
    return false;
  }
}

const CACHED_USER_ACCOUNTS_KEY = 'geosphere_cached_user_accounts';

/**
 * Synchronously read cached user accounts from localStorage for instant 0ms rendering.
 */
export function getCachedUserAccounts(): any[] {
  try {
    const raw = localStorage.getItem(CACHED_USER_ACCOUNTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return [];
}

/**
 * Fetch registered user accounts directory dynamically.
 * Captures real registered users from Supabase Auth, user_accounts table, and dynamic sessions.
 */
export async function fetchUserAccountsFromSupabase(currentSession?: any): Promise<any[]> {
  const userMap = new Map<string, any>();

  // 1. Fetch live records from Supabase `user_accounts` table
  try {
    const { data, error } = await supabase.from('user_accounts').select('*');
    if (!error && Array.isArray(data) && data.length > 0) {
      data.forEach(u => {
        if (u && (u.email || u.id)) {
          const key = (u.email || u.id).toLowerCase().trim();
          userMap.set(key, fromUserAccountRow(u));
        }
      });
    }
  } catch (err) {
    console.warn('Could not query user_accounts table:', err);
  }

  // 2. Dynamically capture the authenticated user or guest from live session / Auth
  try {
    let authUser = currentSession?.user;
    if (!authUser && !currentSession?.isGuest) {
      const { data } = await supabase.auth.getUser();
      if (data?.user) authUser = data.user;
    }

    // Guest Mode
    if (currentSession?.isGuest || authUser?.role === 'guest' || (authUser?.email || '').toLowerCase().includes('guest')) {
      const guestEmail = (authUser?.email || 'guest@example.com').toLowerCase().trim();
      userMap.set(guestEmail, {
        id: 'guest-user-001',
        name: 'Guest',
        email: guestEmail,
        role: 'Viewer',
        status: 'Active',
        lastLogin: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        createdAt: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      });
    }
    // Real Authenticated User
    else if (authUser && authUser.email) {
      const email = authUser.email.toLowerCase().trim();
      const existing = userMap.get(email);

      const name = authUser.user_metadata?.full_name ||
        authUser.user_metadata?.name ||
        existing?.name ||
        email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

      // Live database role from user_accounts or Supabase Auth metadata takes strict priority
      const liveRole =
        existing?.role ||
        authUser.user_metadata?.role ||
        authUser.raw_user_meta_data?.role ||
        authUser.app_metadata?.role ||
        authUser.raw_app_meta_data?.role ||
        (authUser.role === 'admin' || currentSession?.role === 'admin' ? 'Administrator' : null) ||
        'Viewer';

      const nowFormatted = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const createdFormatted = authUser.created_at
        ? new Date(authUser.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : (existing?.createdAt || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));

      const sessionUserData = {
        id: existing?.id || authUser.id || `usr-${Date.now()}`,
        name,
        email: authUser.email,
        role: liveRole,
        status: existing?.status || 'Active',
        lastLogin: nowFormatted,
        createdAt: createdFormatted
      };

      userMap.set(email, sessionUserData);

      // Opportunistically sync active user to public.user_accounts
      if (!existing) {
        saveUserAccountToSupabase([sessionUserData]).catch(() => { });
      }
    }
  } catch (err) {
    console.warn('Error evaluating dynamic session user:', err);
  }

  const results = Array.from(userMap.values());
  if (results.length > 0) {
    try {
      localStorage.setItem(CACHED_USER_ACCOUNTS_KEY, JSON.stringify(results));
    } catch {
      // storage quota or disabled
    }
  }
  return results;
}

/** A directory entry in either the camelCase UI shape or the raw database shape. */
type DirectoryEntry = Record<string, unknown> & {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  avatar?: string;
  permissions?: unknown;
  lastLogin?: string;
  createdAt?: string;
  last_login?: string;
  created_at?: string;
  updated_at?: string;
};

/**
 * Map a directory entry (camelCase, as typed by UserAccount) to a database row.
 * Only keys that exist as columns are sent, and `id` is dropped unless valid.
 */
function toUserAccountRow(user: DirectoryEntry): Record<string, unknown> {
  const row: Record<string, unknown> = {
    name: user?.name ?? null,
    email: user?.email ?? null,
    role: user?.role ?? null,
    status: user?.status ?? null,
  };
  if (isUuid(user?.id)) row.id = user.id;
  if (user?.avatar !== undefined) row.avatar = user.avatar;
  if (user?.permissions !== undefined) row.permissions = user.permissions;
  if (user?.lastLogin !== undefined) row.last_login = user.lastLogin;
  if (user?.createdAt !== undefined) row.created_at = user.createdAt;
  if (user?.updated_at !== undefined) row.updated_at = user.updated_at;
  return row;
}

/** Inverse of {@link toUserAccountRow}: expose DB rows in the camelCase the UI types expect. */
function fromUserAccountRow(row: DirectoryEntry): DirectoryEntry {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    lastLogin: row.lastLogin ?? row.last_login ?? undefined,
    createdAt: row.createdAt ?? row.created_at ?? undefined,
  };
}

/**
 * Save user directory list to database.
 *
 * Matching on the unique `email` keeps this idempotent: a row whose id is not a
 * valid UUID (legacy cache entries, the guest placeholder) updates the existing
 * email-matched row instead of failing or duplicating.
 */
export async function saveUserAccountToSupabase(users: any[]): Promise<boolean> {
  try {
    if (!Array.isArray(users) || users.length === 0) return true;
    try {
      localStorage.setItem(CACHED_USER_ACCOUNTS_KEY, JSON.stringify(users));
    } catch {
      // ignore
    }
    const rows = users.map(toUserAccountRow);
    const { error } = await supabase.from('user_accounts').upsert(rows, { onConflict: 'email' });
    if (error) {
      console.warn('User accounts upsert notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception saving user account:', err);
    return false;
  }
}

/**
 * Fetch dynamic project settings from Supabase (with localStorage fallback).
 */
export async function fetchProjectSettingsFromSupabase(): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .from('project_settings')
      .select('id, settings, updated_at')
      .eq('id', 'default')
      .maybeSingle();

    if (!error && data) {
      const parsed = data.settings || data;
      try {
        localStorage.setItem('geosphere_project_settings', JSON.stringify(parsed));
      } catch (_) { }
      return parsed;
    }
  } catch (err) {
    console.warn('Project settings query notice:', err);
  }

  // Fallback to localStorage cache — but only if it parses to a real object.
  // Corrupt/legacy entries (e.g. the literal string "undefined", or settings
  // persisted against an OLD host) must never survive as authoritative
  // settings: treating them as truth is what re-pointed the boot client at a
  // dead/HTML-serving backend and broke sign-in.
  try {
    const cached = localStorage.getItem('geosphere_project_settings');
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    localStorage.removeItem('geosphere_project_settings');
  } catch (_) {
    try { localStorage.removeItem('geosphere_project_settings'); } catch (__) { }
  }

  return null;
}

/**
 * Persist project settings to Supabase database with instant localStorage caching.
 */
export async function saveProjectSettingsToSupabase(settings: any): Promise<boolean> {
  try {
    // 1. Immediately persist to localStorage
    try {
      localStorage.setItem('geosphere_project_settings', JSON.stringify(settings));
    } catch (_) { }

    // 2. Persist to Supabase project_settings table
    const { error } = await supabase.from('project_settings').upsert([
      {
        id: 'default',
        settings: settings,
        updated_at: new Date().toISOString()
      }
    ], { onConflict: 'id' });

    if (error) {
      console.warn('Project settings Supabase upsert notice:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Exception saving project settings:', err);
    return false;
  }
}
