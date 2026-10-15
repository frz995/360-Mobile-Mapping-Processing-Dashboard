/**
 * The tenant's WebGIS host, resolved from the activated company.
 *
 * WHY A SEPARATE MODULE
 *   `mapOrigin.ts` stays pure — no storage, no Supabase, no React — so its
 *   precedence and validation rules can be tested directly. The seam that reads
 *   the activated tenant out of sessionStorage is impure, so it lives here and
 *   every call site imports one symbol instead of two. Six call sites each
 *   threading `getActiveOrganizationWebgis()` plus `import.meta.env` is exactly
 *   how the fallback shapes drifted apart in the first place.
 *
 *   Call sites that have a higher-priority source of their own — `MapComponent`
 *   takes a project-level `passedSettings.webgisUrl` — should call
 *   `resolveWebgisUrl` directly and pass that value as the tenant override.
 */

import { getActiveOrganizationWebgis } from '../services/tenantContext';
import { resolveWebgisUrl } from './mapOrigin';

/**
 * Resolve the WebGIS base URL for the tenant activated in this tab.
 *
 * Falls back to the platform default for a viewer who has not activated a
 * company, so it is safe to call on publicly reachable routes such as the
 * shared map.
 */
export function resolveActiveWebgisUrl(envUrl?: string | null): string {
  return resolveWebgisUrl(getActiveOrganizationWebgis(), envUrl);
}