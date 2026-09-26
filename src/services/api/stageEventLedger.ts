import { supabase, scoped, getServiceProjectId } from './client';
import type {
  StageEventLedgerRow,
  StageLedgerEvent,
  StageLedgerStage
} from '../../types/production';

const STAGE_LEDGER_TABLE = 'stage_event_ledger';

export interface StageEventAppendInput extends Partial<StageEventLedgerRow> {
  subgrid: string;
  stage: StageLedgerStage;
  event: StageLedgerEvent;
}

/** Local mirror: only rows that failed to reach Supabase (offline/guest mode). */
interface PendingLedgerRow extends StageEventLedgerRow {
  _pending?: boolean;
}

function getLedgerStorageKey(): string {
  const pid = getServiceProjectId();
  return pid ? `geosphere_stage_events_${pid}` : 'geosphere_stage_events';
}

function getLocalPending(): PendingLedgerRow[] {
  try {
    const raw = localStorage.getItem(getLedgerStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function setLocalPending(rows: PendingLedgerRow[]): void {
  try {
    localStorage.setItem(getLedgerStorageKey(), JSON.stringify(rows.slice(-500)));
  } catch (_) { }
}

async function insertEvent(row: StageEventLedgerRow): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(STAGE_LEDGER_TABLE)
      .insert([row]);
    return !error;
  } catch (_) {
    return false;
  }
}

function clientEventId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) { }
  return `evt-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

/** Retry rows stuck in the offline queue; remove each on success. */
async function flushPendingLedger(): Promise<void> {
  const pending = getLocalPending().filter((r) => r._pending);
  if (pending.length === 0) return;
  for (const row of pending) {
    const ok = await insertEvent(row);
    if (ok) {
      const next = getLocalPending().filter((r) => r.id !== row.id);
      setLocalPending(next);
    }
  }
}

/** Append one immutable pipeline event. Fire-and-forget friendly: persists a
 * pending local copy first and removes it once Supabase accepts the insert. */
export async function appendStageEventToSupabase(input: StageEventAppendInput): Promise<boolean> {
  const row: PendingLedgerRow = {
    id: input.id || clientEventId(),
    project_id: input.project_id || getServiceProjectId() || null,
    subgrid: (input.subgrid || '').trim().toUpperCase(),
    stage: input.stage,
    event: input.event,
    occurrence: input.occurrence || new Date().toISOString(),
    recorded_at: input.recorded_at || new Date().toISOString(),
    via: input.via || 'system',
    detail: input.detail || null,
    counts: input.counts || null,
    updated_by: input.updated_by || null,
    _pending: true
  };
  const local = getLocalPending();
  local.push(row);
  setLocalPending(local);
  const ok = await insertEvent(row);
  if (ok) {
    setLocalPending(getLocalPending().filter((r) => r.id !== row.id));
    return true;
  }
  return false;
}

/** Full ledger timeline for a subgrid (oldest → newest). Supabase rows win;
 * still-pending offline rows are merged in and flushed first. */
export async function fetchStageEventLedgerFromSupabase(subgrid?: string): Promise<StageEventLedgerRow[]> {
  await flushPendingLedger();
  const target = (subgrid || '').trim().toUpperCase();
  let remote: StageEventLedgerRow[] = [];
  try {
    const query = scoped(supabase
      .from(STAGE_LEDGER_TABLE)
      .select('*'));
    const { data, error } = await query.order('occurrence', { ascending: true });
    if (!error && Array.isArray(data)) remote = data as StageEventLedgerRow[];
  } catch (_) { }
  const pending = getLocalPending()
    .filter((r) => r._pending)
    .filter((r) => !target || (r.subgrid || '').trim().toUpperCase() === target);
  let rows = [...remote, ...pending];
  if (target) rows = rows.filter((r) => (r.subgrid || '').trim().toUpperCase() === target);
  // Belt-and-braces: guarantee chronological order even with NULL recorded order.
  rows.sort((a, b) => new Date(a.occurrence || a.recorded_at || 0).getTime() - new Date(b.occurrence || b.recorded_at || 0).getTime());
  return rows;
}
