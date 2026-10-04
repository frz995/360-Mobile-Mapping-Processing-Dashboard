/**
 * AuthZ — the single permission vocabulary for the whole platform.
 *
 * IMPORTANT: Postgres `sec.can()` (supabase/migrations/0009_security_functions.sql)
 * and Row-Level Security remain the real enforcement boundary. The NAS worker
 * (`worker/app.py`) sits behind the Cloudflare Pages Functions, which gate every
 * private route in `functions/_middleware.js` before proxying, and add the
 * worker's own shared-secret token server-side.
 * This module decides which controls to SHOW or HIDE and mirrors the RLS matrix
 * for the subset the database actually gates — see
 * `ENFORCED_CAPABILITIES` below and src/lib/__tests__/authz_matches_rls.test.ts,
 * which pins that subset so the two can never silently drift.
 *
 * Capabilities are grouped to mirror docs/TWO_TRACK_MODEL.md:
 *   - `production` — Track 2, the operator-facing processing factory
 *   - `published`  — Track 1, the WebGIS published view
 *   - `governance` — cross-cutting administration
 */

export type UserRole = 'Administrator' | 'Survey Operator' | 'QA Inspector' | 'Viewer';

export const ROLE_ADMINISTRATOR: UserRole = 'Administrator';
export const ROLE_OPERATOR: UserRole = 'Survey Operator';
export const ROLE_QA_INSPECTOR: UserRole = 'QA Inspector';
export const ROLE_VIEWER: UserRole = 'Viewer';

/** Every role the administration matrix renders a column for, in display order. */
export const USER_ROLES: readonly UserRole[] = [
  ROLE_ADMINISTRATOR,
  ROLE_OPERATOR,
  ROLE_QA_INSPECTOR,
  ROLE_VIEWER
];

export type AuthzCapability =
  /* ---- Track 2 · Production Workspace ---- */
  | 'runIntake'                 // stitched intake, metadata pairing, NAS rename
  | 'runPipeline'               // 4-PC flight board progression (blur → stitch → enhance → mask)
  | 'operateStations'           // station agents + remote PC console (RDP)
  | 'manageStorage'             // NAS storage config, folder browser, processed-output validation
  | 'runQaqc'                   // acceptance QA inspection + defect logging
  | 'reviewQaqc'                // QA sign-off / defect resolution
  | 'publishSequences'          // cloud bucket image upload (deliverable pack)
  | 'publishToWebGIS'           // WebGIS release gate — promote records to the published layer
  /* ---- Track 1 · Published View (WebGIS) ---- */
  | 'importDatasets'            // import spatial datasets (CSV/KML/SHP)
  | 'manageDatasets'            // edit spatial attributes + publish status
  | 'flagDefects'               // flag field defects on street panoramas
  | 'manageRoadAnalysis'        // road analysis layer authoring
  | 'sharePublishedMaps'        // create / revoke public map share links
  | 'exportPublishedReports'    // export published layers, reports, CSV
  /* ---- Governance ---- */
  | 'manageUsers'               // provision accounts, assign roles
  | 'manageProjects'            // project provisioning + lifecycle
  | 'manageSettings'            // system / storage / security configuration
  | 'approveDeletions'          // approve or reject safe-deletion requests
  | 'deleteData'                // initiate or execute spatial safe deletion
  | 'viewAll';                  // read-only access across every track

export type AuthzScope = 'production' | 'published' | 'governance';

export interface RoleCapabilityItem {
  id: AuthzCapability;
  label: string;
  description: string;
  scope: AuthzScope;
  /**
   * The Administrator may never switch this off — removing it would leave the
   * platform unadministrable. Other roles may still be denied it.
   */
  locked?: boolean;
  /**
   * Structural baseline: granted to every role and not toggleable at all.
   * Read-only access has to exist for anyone to be able to sign in and look.
   */
  alwaysOn?: boolean;
  /** Capabilities `sec.can()` genuinely enforces in Postgres. */
  enforced?: boolean;
}

export type RoleCapabilitiesMap = Partial<Record<AuthzCapability, boolean>>;

export type RolePermissionsMatrix = Record<UserRole, RoleCapabilitiesMap>;

/** The catalogue rendered by the administration Roles tab, grouped by track. */
export const ROLE_CAPABILITIES: RoleCapabilityItem[] = [
  /* ---------------- Track 2 · Production Workspace ---------------- */
  {
    id: 'runIntake',
    label: 'Stitched Intake & Pairing',
    description: 'Import survey CSV, pair metadata to stitched frames, rename on the NAS',
    scope: 'production'
  },
  {
    id: 'runPipeline',
    label: '4-PC Flight Board & Stage Progression',
    description: 'Advance the blur → stitch → enhance → mask batch and its 4-PC agents',
    scope: 'production'
  },
  {
    id: 'operateStations',
    label: 'Station Agents & Remote PC Console',
    description: 'Open RDP / remote panes on the processing workstations',
    scope: 'production'
  },
  {
    id: 'manageStorage',
    label: 'NAS Storage & Processed-Output Validation',
    description: 'Browse raw storage, configure mounts, validate processed output sets',
    scope: 'production'
  },
  {
    id: 'runQaqc',
    label: 'Acceptance QA Inspection & Defect Logging',
    description: 'Run frame-by-frame 360 inspection and tag defects',
    scope: 'production',
    enforced: true
  },
  {
    id: 'reviewQaqc',
    label: 'QA Sign-off & Defect Resolution',
    description: 'Approve a survey run and clear its defect records',
    scope: 'production',
    enforced: true
  },
  {
    id: 'publishSequences',
    label: 'Cloud Bucket Image Upload',
    description: 'Push the final deliverable image set to the cloud bucket',
    scope: 'production'
  },
  {
    id: 'publishToWebGIS',
    label: 'WebGIS Release & Record Promotion',
    description: 'Promote staged trajectory batches into the published WebGIS layer',
    scope: 'production'
  },

  /* ---------------- Track 1 · Published View (WebGIS) ---------------- */
  {
    id: 'importDatasets',
    label: 'Import Spatial Datasets (CSV/KML/SHP)',
    description: 'Bring road lines and survey runs into the published data registry',
    scope: 'published'
  },
  {
    id: 'manageDatasets',
    label: 'Edit Spatial Attributes & Publish Status',
    description: 'Edit station metadata, attributes and the publish-state column',
    scope: 'published',
    enforced: true
  },
  {
    id: 'flagDefects',
    label: 'Flag Field Defects',
    description: 'Mark defect markers on street panoramas from the published view',
    scope: 'published'
  },
  {
    id: 'manageRoadAnalysis',
    label: 'Road Analysis Layer Authoring',
    description: 'Draw and persist road analysis geometry for a subgrid',
    scope: 'published'
  },
  {
    id: 'sharePublishedMaps',
    label: 'Create & Revoke Public Map Shares',
    description: 'Mint and revoke public share links for the published map',
    scope: 'published'
  },
  {
    id: 'exportPublishedReports',
    label: 'Export Published Reports & Layers',
    description: 'Download report PDFs, coverage CSVs and layer extracts',
    scope: 'published'
  },

  /* ---------------- Governance ---------------- */
  {
    id: 'manageUsers',
    label: 'User Directory & Role Assignment',
    description: 'Provision accounts, assign roles and revoke platform access',
    scope: 'governance',
    locked: true,
    enforced: true
  },
  {
    id: 'manageProjects',
    label: 'Project Provisioning & Lifecycle',
    description: 'Create projects and manage their gallery, boundaries and archive state',
    scope: 'governance'
  },
  {
    id: 'manageSettings',
    label: 'System, Storage & Security Configuration',
    description: 'Modify NAS, cloud bucket, PostGIS, pipeline and security settings',
    scope: 'governance',
    locked: true,
    enforced: true
  },
  {
    id: 'approveDeletions',
    label: 'Approve / Reject Safe-Deletion Requests',
    description: 'Work the approvals queue for operator-raised deletion tickets',
    scope: 'governance',
    enforced: true
  },
  {
    id: 'deleteData',
    label: 'Spatial Safe Deletion (execute)',
    description: 'Initiate or execute spatial safe-deletion operations',
    scope: 'governance',
    enforced: true
  },
  {
    id: 'viewAll',
    label: 'Read-Only Access (all tracks)',
    description: 'Structural baseline — every authenticated role can browse both tracks',
    scope: 'governance',
    locked: true,
    alwaysOn: true,
    enforced: true
  }
];

/** Back-compat alias — the administration UI historically imported this name. */
export const DEFAULT_ROLE_CAPABILITIES = ROLE_CAPABILITIES;

const DEFAULT_ROLE_GRANTS: Record<UserRole, readonly AuthzCapability[]> = {
  Administrator: ROLE_CAPABILITIES.map((c) => c.id),
  'Survey Operator': [
    'runIntake', 'runPipeline', 'operateStations', 'manageStorage', 'runQaqc',
    'publishSequences', 'publishToWebGIS',
    'importDatasets', 'manageDatasets', 'flagDefects', 'manageRoadAnalysis',
    'sharePublishedMaps', 'exportPublishedReports',
    'deleteData', 'viewAll'
  ],
  'QA Inspector': [
    'runQaqc', 'reviewQaqc', 'publishToWebGIS',
    'manageDatasets', 'flagDefects', 'manageRoadAnalysis',
    'sharePublishedMaps', 'exportPublishedReports',
    'viewAll'
  ],
  Viewer: ['exportPublishedReports', 'viewAll']
};

/**
 * Shipped defaults. `alwaysOn` capabilities are folded in here so the raw
 * constant and `resolveMatrix()` always agree — otherwise a structural row
 * could read as denied before any matrix has been resolved.
 */
export const DEFAULT_ROLE_PERMISSIONS: RolePermissionsMatrix = USER_ROLES.reduce(
  (acc, role) => {
    const row: RoleCapabilitiesMap = {};
    for (const id of DEFAULT_ROLE_GRANTS[role]) row[id] = true;
    for (const item of ROLE_CAPABILITIES) {
      if (item.alwaysOn) row[item.id] = true;
    }
    acc[role] = row;
    return acc;
  },
  {} as RolePermissionsMatrix
);

/**
 * The capabilities Postgres `sec.can()` and the BFF actually gate. Everything
 * else in the union is a UX mirror only. Pinned by authz_matches_rls.test.ts.
 */
export const ENFORCED_CAPABILITIES: readonly AuthzCapability[] = [
  'manageDatasets',
  'manageSettings',
  'manageUsers',
  'approveDeletions',
  'deleteData',
  'runQaqc',
  'reviewQaqc',
  'viewAll'
];

/**
 * Stored `project_settings.role_permissions` rows predate the track split and
 * use the old 11-id vocabulary. Map every legacy id onto the current one so an
 * existing deployment never silently loses (or gains) a capability on upgrade.
 * Ids with no legacy equivalent fall back to the defaults.
 */
export const LEGACY_CAPABILITY_ALIASES: Record<string, AuthzCapability[]> = {
  manageUsers: ['manageUsers'],
  manageSettings: ['manageSettings'],
  publishSequences: ['publishSequences', 'publishToWebGIS'],
  runPipeline: ['runPipeline'],
  reviewQaqc: ['reviewQaqc'],
  deleteData: ['deleteData'],
  webgisUpload: ['importDatasets'],
  webgisEditAttributes: ['manageDatasets'],
  webgisFlagDefects: ['flagDefects'],
  webgisExportData: ['exportPublishedReports']
  // webgisCameraCalibration deliberately has no target: it described a control
  // inside the separate WebGIS app, which this repository cannot enforce.
};

export function normalizeRole(role?: string | null): UserRole {
  const r = (role || '').trim();
  if (r === 'Administrator' || r === 'admin' || r === 'Admin') return ROLE_ADMINISTRATOR;
  if (r === 'Survey Operator' || r === 'operator' || r === 'Operator') return ROLE_OPERATOR;
  if (r === 'QA Inspector' || r === 'inspector' || r === 'QA Officer') return ROLE_QA_INSPECTOR;
  return ROLE_VIEWER;
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

const KNOWN_CAPABILITIES = new Set<string>(ROLE_CAPABILITIES.map((c) => c.id));

export function isAuthzCapability(value: unknown): value is AuthzCapability {
  return typeof value === 'string' && KNOWN_CAPABILITIES.has(value);
}

/** Effective capability list for a role under the default matrix. */
export function getRoleCapabilities(role?: string | null): AuthzCapability[] {
  const granted = DEFAULT_ROLE_PERMISSIONS[normalizeRole(role)];
  return ROLE_CAPABILITIES.map((c) => c.id).filter((id) => !!granted?.[id]);
}

/**
 * Capability check. Pass the stored matrix to honour admin overrides; omitting
 * it falls back to the shipped defaults (used where no matrix is loaded yet).
 */
export function can(
  role: string | null | undefined,
  capability: AuthzCapability | string,
  matrix?: RolePermissionsMatrix | null
): boolean {
  const source = matrix || DEFAULT_ROLE_PERMISSIONS;
  const granted = source[normalizeRole(role)];
  return granted?.[capability as AuthzCapability] === true;
}

/** True when the role holds ANY of the listed capabilities (empty = no guard). */
export function canAny(
  role: string | null | undefined,
  capabilities: readonly AuthzCapability[],
  matrix?: RolePermissionsMatrix | null
): boolean {
  if (capabilities.length === 0) return true;
  return capabilities.some((cap) => can(role, cap, matrix));
}

/** Convenience accessors used by the current UI toggles. */
export function isAdminRole(role?: string | null): boolean {
  return normalizeRole(role) === ROLE_ADMINISTRATOR;
}

/**
 * Coerce an arbitrary JSON value into a full matrix: unknown roles are dropped,
 * legacy ids are aliased onto the current vocabulary, and any capability a role
 * has no stored opinion on keeps its default so a partial row cannot silently
 * revoke access.
 */
export function resolveMatrix(raw?: unknown): RolePermissionsMatrix {
  const resolved = {} as RolePermissionsMatrix;
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  for (const role of USER_ROLES) {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role];
    const row = (source[role] && typeof source[role] === 'object' ? source[role] : {}) as Record<string, unknown>;
    const merged: RoleCapabilitiesMap = { ...defaults };

    for (const [storedId, rawValue] of Object.entries(row)) {
      if (typeof rawValue !== 'boolean') continue;
      // An id can be BOTH a current capability and a legacy alias source
      // (`publishSequences` now covers bucket upload *and* the WebGIS release),
      // so both the direct target and the alias targets must be written.
      const targets = new Set<AuthzCapability>();
      if (isAuthzCapability(storedId)) targets.add(storedId);
      for (const target of LEGACY_CAPABILITY_ALIASES[storedId] || []) targets.add(target);
      if (targets.size === 0) continue;
      for (const target of targets) merged[target] = rawValue;
    }

    // Structural rows: `alwaysOn` for everybody, `locked` for the Administrator
    // (whose governance rights cannot be revoked from this screen).
    for (const item of ROLE_CAPABILITIES) {
      if (item.alwaysOn || (item.locked && role === ROLE_ADMINISTRATOR)) {
        merged[item.id] = true;
      }
    }

    resolved[role] = merged;
  }

  return resolved;
}

/** Strip ids the current vocabulary does not know, ready for persistence. */
export function serializeMatrix(matrix: RolePermissionsMatrix): RolePermissionsMatrix {
  const out = {} as RolePermissionsMatrix;
  for (const role of USER_ROLES) {
    const row = matrix[role] || {};
    const clean: RoleCapabilitiesMap = {};
    for (const [id, value] of Object.entries(row)) {
      if (isAuthzCapability(id)) clean[id] = value === true;
    }
    out[role] = clean;
  }
  return out;
}

/**
 * Email-based guess (legacy behaviour). Several screens currently treat an
 * email containing "admin" as admin or "guest" as a guest viewer. Kept here
 * so the ad-hoc logic lives in exactly one place and reads the same way.
 */
export function roleFromEmail(email?: string | null): UserRole {
  const e = (email || '').toLowerCase();
  if (!e) return ROLE_VIEWER;
  if (e.includes('guest')) return ROLE_VIEWER;
  if (e.includes('admin')) return ROLE_ADMINISTRATOR;
  return ROLE_OPERATOR;
}

export function isGuestEmail(email?: string | null): boolean {
  return (email || '').toLowerCase().includes('guest');
}