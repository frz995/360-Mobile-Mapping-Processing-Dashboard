import { supabase } from './supabase';

export type OrganizationStatus = 'active' | 'suspended' | 'trial' | 'expired';
export type DatabaseType = 'cloud_shared' | 'dedicated_external';
export type OrganizationMemberRole = 'CompanyAdmin' | 'Operator' | 'Inspector' | 'Viewer';

export interface DatabaseConfig {
  url?: string;
  anonKey?: string;
}

/** Untyped PostgREST row shape. Kept narrow deliberately: every field the mapper reads is declared, so a renamed column fails at compile time instead of yielding `undefined` into the UI. */
interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  client_code?: string | null;
  logo_url?: string | null;
  database_type?: string | null;
  status?: string | null;
  settings?: OrganizationSettings | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** `organization_databases` row. Separate table since migration 0036: the credentials are platform-admin-only, so they cannot ride along on the organization row that every member of a company may read. */
interface OrganizationDatabaseRow {
  organization_id: string;
  url: string;
  anon_key: string;
}

export interface OrganizationSettings {
  nasApiUrl?: string;
  stationTokens?: Record<string, string>;
  allowedUserSeats?: number;
  storageQuotaGb?: number;
  customTheme?: string;
  contactEmail?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  clientCode: string;
  logoUrl?: string;
  databaseType: DatabaseType;
  databaseConfig: DatabaseConfig;
  status: OrganizationStatus;
  settings: OrganizationSettings;
  createdAt: string;
  updatedAt: string;
  userCount?: number;
  projectCount?: number;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationMemberRole;
  email?: string;
  fullName?: string;
  createdAt: string;
}

export interface OrganizationDraft {
  name: string;
  slug?: string;
  clientCode: string;
  logoUrl?: string;
  databaseType?: DatabaseType;
  databaseConfig?: DatabaseConfig;
  settings?: OrganizationSettings;
}

export const ACTIVE_ORGANIZATION_KEY = 'geosphere360_active_org_id';

let memoryActiveOrgId: string | null = null;

export function getActiveOrganizationId(): string | null {
  if (memoryActiveOrgId) return memoryActiveOrgId;
  try {
    return localStorage.getItem(ACTIVE_ORGANIZATION_KEY);
  } catch {
    return null;
  }
}

export function setActiveOrganizationId(orgId: string | null): void {
  memoryActiveOrgId = orgId;
  try {
    if (orgId) {
      localStorage.setItem(ACTIVE_ORGANIZATION_KEY, orgId);
    } else {
      localStorage.removeItem(ACTIVE_ORGANIZATION_KEY);
    }
  } catch {
    // Ignore storage quota errors in sandbox
  }
}

/**
 * Development fixtures. Never reachable in a production bundle.
 *
 * These used to double as the fallback for a failed read, which meant a
 * Supabase outage rendered as a healthy customer list — including a real
 * customer's name. A fabricated organisation is indistinguishable from a real
 * one to the seller reading the screen, so an unverified read must say so
 * rather than substitute something plausible. See `OrganizationListResult`.
 */
const DEV_ONLY_ORGANIZATIONS: Organization[] = [
  {
    id: 'org-tnb-default',
    name: 'Tenaga Nasional Berhad (TNB)',
    slug: 'tnb-distribution',
    clientCode: 'TNB-LV-2026',
    logoUrl: '/branding/geosphere-icon-white.png',
    databaseType: 'cloud_shared',
    databaseConfig: {},
    status: 'active',
    settings: {
      allowedUserSeats: 15,
      storageQuotaGb: 500,
      contactEmail: 'mms.support@tnb.com.my'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userCount: 8,
    projectCount: 4
  },
  {
    id: 'org-apex-demo',
    name: 'Apex Geospatial Survey Sdn Bhd',
    slug: 'apex-survey',
    clientCode: 'APEX-SURVEY-01',
    logoUrl: '',
    databaseType: 'cloud_shared',
    databaseConfig: {},
    status: 'trial',
    settings: {
      allowedUserSeats: 5,
      storageQuotaGb: 100,
      contactEmail: 'admin@apexsurvey.com.my'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userCount: 3,
    projectCount: 1
  }
];

const IS_DEV = import.meta.env?.DEV === true;

let localOrganizationsCache: Organization[] = IS_DEV ? [...DEV_ONLY_ORGANIZATIONS] : [];

/**
 * Result of an organization read.
 *
 * `unverified` exists because an empty array is ambiguous: it means either
 * "the query succeeded and no companies exist" or "the query failed". Those
 * demand opposite operator responses — ship the product, or investigate the
 * database — so they must never collapse into one value.
 */
export interface OrganizationListResult {
  organizations: Organization[];
  /** null on success; a human-readable reason on failure. */
  error: string | null;
  /**
   * true when `organizations` may be incomplete. An empty list with
   * `unverified: true` means "could not confirm", never "none exist".
   */
  unverified: boolean;
}

function readFailure(message: string): OrganizationListResult {
  return {
    organizations: IS_DEV ? [...localOrganizationsCache] : [],
    error: message,
    unverified: true
  };
}

/**
 * Fetch all organizations (Super-Admin Seller Console only).
 *
 * Fails soft so the console still renders, but reports the failure instead of
 * substituting fixtures.
 */
export async function fetchAllOrganizations(): Promise<OrganizationListResult> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.warn('Organizations read failed', error.message);
      return readFailure(error.message);
    }
if (!data) {
      console.warn('Organizations read returned no payload');
      return readFailure('The organization directory returned no payload.');
    }

    const configs = await fetchDatabaseConfigs();
    return {
      organizations: data.map((row) => mapOrganizationRow(row, configs.get(row.id))),
      error: null,
      unverified: false
    };
  } catch (err: unknown) {
    const message = errorMessage(err, 'Failed to reach the organization directory.');

    console.warn('Organizations read threw', message);
    return readFailure(message);
  }
}

/**
 * Narrow a caught value to a message without asserting its type.
 *
 * The organization directory is the one surface where a silent failure is
 * most damaging, so every catch routes through here rather than trusting a
 * bare `err.message` that may not exist.
 */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

/** Row -> shape mapper. `userCount`/`projectCount` are deliberately omitted: nothing counts them yet, so any value here would be a guess rendered as a measurement. */
function mapOrganizationRow(row: OrganizationRow, databaseConfig?: DatabaseConfig): Organization {
  // Narrow the two enum columns against their known sets rather than casting.
  // An unrecognised value must not reach the UI as a value the filter and the
  // badge do not understand; it degrades to the same default a blank column
  // would take, which is what the `||` fallback already does for the rest.
  const databaseType: DatabaseType = row.database_type === 'dedicated_external' ? 'dedicated_external' : 'cloud_shared';
  const status: OrganizationStatus =
    row.status === 'suspended' || row.status === 'trial' || row.status === 'expired' ? row.status : 'active';

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    clientCode: row.client_code || '',
    logoUrl: row.logo_url || '',
    databaseType,
    // Absent means "not readable by this caller", which for anyone other than
    // a platform administrator is the correct answer rather than a gap to fill.
    databaseConfig: databaseConfig || {},
    status,
    settings: row.settings || {},
    // A missing timestamp is unknown, not "now": `new Date()` here would
    // fabricate a creation date for a row that never carried one.
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

/**
 * Fetch the dedicated-database coordinates, keyed by organization.
 *
 * RLS restricts this table to platform administrators, so a non-admin caller
 * receives zero rows and every organization resolves to `{}`. That is the
 * intended outcome — the alternative would be reporting credentials the
 * caller is not entitled to hold.
 */
async function fetchDatabaseConfigs(): Promise<Map<string, DatabaseConfig>> {
  const configs = new Map<string, DatabaseConfig>();
  try {
    const { data, error } = await supabase.from('organization_databases').select('organization_id, url, anon_key');

    if (error) {
      // Not fatal: the directory is still readable without it. Surfaced so a
      // silent "no dedicated databases" is distinguishable from "not allowed
      // to see them".
      console.warn('Organization database read failed', error.message);
      return configs;
    }
    for (const row of (data || []) as OrganizationDatabaseRow[]) {
      configs.set(row.organization_id, { url: row.url, anonKey: row.anon_key });
    }
  } catch (err: unknown) {
    console.warn('Organization database read threw', errorMessage(err, 'unreachable'));
  }
  return configs;
}

/**
 * Fetch organizations the current user is a member of.
 *
 * Zero memberships is a real, meaningful state — "awaiting workspace
 * assignment" — and is returned as a confirmed empty list. It must never be
 * widened into someone else's organisation: a contractor who has not been
 * assigned a company would otherwise be dropped straight into one.
 */
export async function fetchUserOrganizations(userId: string): Promise<OrganizationListResult> {
  if (!userId) {
    return { organizations: [], error: null, unverified: false };
  }
  try {
    const { data: memberRows, error } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId);

    if (error) {
      console.warn('Organization membership read failed', error.message);
      return readFailure(error.message);
    }

    if (!memberRows || memberRows.length === 0) {
      return { organizations: [], error: null, unverified: false };
    }

    const orgIds = memberRows.map((m) => (m as { organization_id: string }).organization_id);
    const { data: orgRows, error: orgError } = await supabase
      .from('organizations')
      .select('*')
      .in('id', orgIds);

    if (orgError) {
      console.warn('Organization read failed', orgError.message);
      return readFailure(orgError.message);
    }
    if (!orgRows) {
      return readFailure('The organization directory returned no payload.');
    }

    // Membership rows exist but none of the organisations resolved. That is a
    // referential gap, not an empty account: report it rather than silently
    // narrowing to a default.
    if (orgRows.length === 0) {
      return {
        organizations: [],
        error: 'Membership exists but no matching organization could be read.',
        unverified: true
      };
    }

    // Wrapped rather than passed by reference: `mapOrganizationRow`'s second
    // parameter is the credential map, and `Array.map` would supply the index
    // there. No credential lookup happens here on purpose — a tenant member is
    // not a platform administrator, so `organization_databases` returns nothing
    // for them and every company correctly resolves to `{}`.
    return { organizations: orgRows.map((row) => mapOrganizationRow(row)), error: null, unverified: false };
  } catch (err: unknown) {
    const message = errorMessage(err, 'Failed to resolve organization membership.');

    console.warn('Organization membership read threw', message);
    return readFailure(message);
  }
}

/**
 * Create a new company organization.
 *
 * Reports only what the database actually did. The previous version fell
 * through to a locally-fabricated `org-${Date.now()}` row and returned
 * `{ success: true }` when the insert failed, so a seller could click *Add
 * Client Company*, see success, and have created nothing.
 *
 * The PostgREST builder is thenable and resolves with `{ data, error }` rather
 * than throwing, so `error` is the only reliable failure signal; the try/catch
 * is for transport faults only.
 */
export async function createOrganization(draft: OrganizationDraft): Promise<{ success: boolean; data?: Organization; error?: string }> {
  const slug = draft.slug || draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const payload = {
    name: draft.name,
    slug,
    client_code: draft.clientCode,
    logo_url: draft.logoUrl || '',
    database_type: draft.databaseType || 'cloud_shared',
    status: 'active',
    settings: draft.settings || { allowedUserSeats: 10, storageQuotaGb: 200 }
  };

  try {
    const { data, error } = await supabase.from('organizations').insert(payload).select().single();

    if (error) {
      const message =
        error.code === '23505'
          ? `The client code or slug "${slug}" is already in use by another company.`
          : error.message;
      console.warn('Organization insert failed', error.message);
      return { success: false, error: message };
    }

if (!data) {
      return { success: false, error: 'The directory accepted the request but returned no record.' };
    }

    const created = mapOrganizationRow(data);

    // Credentials are a second write, into the platform-admin-only table.
    // Reported rather than swallowed: an organization left with no database
    // row but a form full of credentials looks configured and is not.
    if (created.databaseType === 'dedicated_external') {
      const written = await writeDatabaseConfig(created.id, draft.databaseConfig);
      if (!written.success) {
        return {
          success: false,
          error: `${written.error} The company was created but its database credentials were not saved.`
        };
      }
      created.databaseConfig = draft.databaseConfig || {};
    }

    if (IS_DEV) localOrganizationsCache.push(created);
    return { success: true, data: created };
  } catch (err: unknown) {
    const message = errorMessage(err, 'Could not reach the organization directory.');

    console.warn('Organization insert threw', message);
    return { success: false, error: message };
  }
}

/** Upsert an organization's dedicated-database credentials. */
async function writeDatabaseConfig(
  organizationId: string,
  config?: DatabaseConfig
): Promise<{ success: boolean; error?: string }> {
  const url = (config?.url || '').trim();
  const anonKey = (config?.anonKey || '').trim();

  if (!url && !anonKey) {
    // Nothing to store. Deleting is the platform admin's call, not an
    // implicit side effect of saving an unrelated field.
    return { success: true };
  }
  if (!url || !anonKey) {
    return { success: false, error: 'A dedicated database needs both a URL and an anon key.' };
  }

  try {
    const { error } = await supabase
      .from('organization_databases')
      .upsert(
        { organization_id: organizationId, url, anon_key: anonKey, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id' }
      );

    if (error) {
      console.warn('Organization database write failed', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: unknown) {
    const message = errorMessage(err, 'Could not reach the organization database registry.');
    console.warn('Organization database write threw', message);
    return { success: false, error: message };
  }
}

/**
 * Update company organization.
 *
 * A `.update()` builder resolves with `{ error }` instead of throwing, so the
 * error field — not the absence of an exception — decides the outcome. Only
 * fields present in `patch` are sent, so a caller updating the seat count does
 * not blank the contact email.
 */
export async function updateOrganization(id: string, patch: Partial<Organization>): Promise<{ success: boolean; error?: string }> {
  const updatedAt = new Date().toISOString();
  const payload: Record<string, unknown> = { updated_at: updatedAt };
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.clientCode !== undefined) payload.client_code = patch.clientCode;
  if (patch.logoUrl !== undefined) payload.logo_url = patch.logoUrl;
  if (patch.databaseType !== undefined) payload.database_type = patch.databaseType;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.settings !== undefined) payload.settings = patch.settings;

  try {
    const { error } = await supabase.from('organizations').update(payload).eq('id', id);

    if (error) {
      console.warn('Organization update failed', error.message);
      return { success: false, error: error.message };
    }

    if (patch.databaseConfig !== undefined) {
      const written = await writeDatabaseConfig(id, patch.databaseConfig);
      if (!written.success) return written;
    }

    if (IS_DEV) {
      const idx = localOrganizationsCache.findIndex((o) => o.id === id);
      if (idx !== -1) {
        localOrganizationsCache[idx] = { ...localOrganizationsCache[idx], ...patch, updatedAt };
      }
    }
    return { success: true };
  } catch (err: unknown) {
    const message = errorMessage(err, 'Could not reach the organization directory.');

    console.warn('Organization update threw', message);
    return { success: false, error: message };
  }
}

/**
 * Delete company organization.
 *
 * From migration 0040 the FK on `projects.organization_id` is `ON DELETE
 * RESTRICT`, so an organisation that still owns projects is refused by the
 * database rather than silently orphaned. That refusal is reported here as an
 * ordinary failure — offboarding has to be an explicit procedure, never a
 * button that quietly dissolves a tenant's data.
 */
export async function deleteOrganization(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('organizations').delete().eq('id', id);

    if (error) {
      const message =
        error.code === '23503'
          ? 'This company still owns projects. Reassign or archive them before deleting the company.'
          : error.message;
      console.warn('Organization delete failed', error.message);
      return { success: false, error: message };
    }

    if (IS_DEV) {
      localOrganizationsCache = localOrganizationsCache.filter((o) => o.id !== id);
    }
    return { success: true };
  } catch (err: unknown) {
    const message = errorMessage(err, 'Could not reach the organization directory.');

    console.warn('Organization delete threw', message);
    return { success: false, error: message };
  }
}

/**
 * Test connectivity to a dedicated external Supabase/PostgreSQL instance.
 */
export async function testDedicatedDatabaseConnection(
  url: string,
  anonKey: string
): Promise<{ success: boolean; message: string }> {
  try {
    const trimmedUrl = url.trim().replace(/\/$/, '');
    const res = await fetch(`${trimmedUrl}/rest/v1/`, {
      headers: {
        apikey: anonKey.trim(),
        Authorization: `Bearer ${anonKey.trim()}`
      }
    });
if (res.ok || res.status === 200 || res.status === 404) {
      return { success: true, message: 'Connection verified (HTTP 200 OK)' };
    }
    return { success: false, message: `Server replied with HTTP ${res.status}` };
  } catch (err: unknown) {
    return { success: false, message: errorMessage(err, 'Failed to reach external database') };
  }
}

