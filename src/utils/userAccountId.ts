/**
 * `user_accounts.id` is a UUID column (supabase/migrations/0004_rls_application_tables.sql).
 * Directory entries built in the browser historically used `usr-<timestamp>` ids, which
 * Postgres rejects with `invalid input syntax for type uuid` — and because the save was
 * fire-and-forget, the row was never persisted while the UI reported success.
 *
 * Accounts are created in Supabase, so the browser never mints an id: this module only
 * needs to recognise one in order to decide whether a row may carry it.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}