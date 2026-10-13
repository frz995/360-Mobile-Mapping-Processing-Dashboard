// Type declarations for the Cloudflare Pages Functions modules imported by the
// application test suite.
//
// `tsconfig.json` includes only `src`, so `functions/` is outside the program and
// TypeScript treats a direct import of the `.js` file as untyped. Enabling
// `allowJs` and widening `include` to `functions/` would pull the whole edge
// runtime into the app typecheck for the sake of two modules, and these files
// run on the Workers runtime rather than in the browser bundle.
//
// The signatures below are the contract the tests rely on. If an implementation
// changes shape, this file is what should fail — that is the point of declaring
// it rather than casting to `any` at the import site.

export interface TenantWorkerCredentials {
  base: string;
  token: string;
  /** 'organization' = per-company row; 'legacy' = install-wide env pair. */
  source: 'organization' | 'legacy';
}

export declare class TenantWorkerError extends Error {
  readonly status: number;
  constructor(status: number, message: string);
}

/** Active organisation ids for the caller, read with the caller's own bearer. */
export declare function resolveCallerOrganizations(
  env: Record<string, string | undefined>,
  authorization: string
): Promise<string[]>;

/** Choose the organisation to act as. Fails closed on ambiguity or forgery. */
export declare function selectOrganization(
  organizationIds: string[],
  requestedOrgId: string
): string;

export declare function resolveTenantWorker(
  env: Record<string, string | undefined>,
  organizationId: string
): Promise<TenantWorkerCredentials>;

export declare function authorizeTenantWorker(
  env: Record<string, string | undefined>,
  authorization: string,
  requestedOrgId: string
): Promise<TenantWorkerCredentials & { organizationId: string }>;

export declare const BOOTSTRAP_ORGANIZATION_ID: string;