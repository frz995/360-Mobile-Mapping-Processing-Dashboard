/**
 * Brand identity — single source of truth for the product name, origin and the
 * seeded install defaults.
 *
 * A reseller deploying this under their own brand sets six VITE_BRAND_* vars at
 * build time. Every value defaults to the current literal, so an unset `.env`
 * is a no-op: the build reproduces today's behaviour exactly. That is deliberate
 * — the branding layer can be adopted without changing behaviour.
 *
 * Resolved through one pure function so the two places that read env agree.
 * `vite.config.ts` reads build env through `loadEnv(mode, '.', '')` because it
 * must rewrite index.html before the bundle exists; application code reads
 * `import.meta.env`. Two independent fallback chains would drift, so both call
 * `resolveBranding()` over their own env shape instead.
 *
 * No React, no side effects: reportPdf.ts and reportDocuments.ts build
 * standalone HTML documents outside the React tree and import this.
 */

export interface Branding {
  /**
   * Product wordmark, as it appears in the logo lockup. Note this is the word
   * only ("GeoSphere"), not the full product name — prose contexts use
   * `brandTitle()`.
   */
  productName: string;
  /** Trailing mark rendered in the accent colour in the logo. Set '' to omit. */
  productMark: string;
  /** Canonical origin, no trailing slash. Used for canonical/OG/JSON-LD URLs. */
  siteUrl: string;
  /** Default project name for a fresh install. */
  defaultProjectName: string;
  /** Default contract code for a fresh install. */
  defaultContractCode: string;
  /** Default client name for a fresh install. */
  defaultClientName: string;
}

/**
 * Current in-code values. Kept as the fallback for every VITE_BRAND_* var so an
 * absent variable reproduces today's behaviour exactly.
 */
export const BRANDING_DEFAULTS: Branding = {
  productName: 'GeoSphere',
  productMark: '360°',
  siteUrl: 'https://app.geosphere.my',
  defaultProjectName: '360 Mobile Mapping — Spatial Operations Division',
  defaultContractCode: 'MMS-2026-GEO-01',
  defaultClientName: 'Spatial Asset Operations'
};

/**
 * Trim and fall back on unset-or-blank. This is the rule for every variable
 * except the mark — an absent value must never render an empty brand.
 */
function read(raw: string | undefined, fallback: string): string {
  const value = (raw || '').trim();
  return value || fallback;
}

/**
 * The mark is the one field where blank is meaningful: '' is how a reseller
 * omits it. So an absent key falls back, while a present-but-blank key resolves
 * to ''. Without this split, there would be no way to drop the mark at all.
 */
function readMark(raw: string | undefined, fallback: string): string {
  return raw === undefined ? fallback : raw.trim();
}

/**
 * Resolve branding from an env bag. Accepts either the `ImportMetaEnv` shape or
 * the `Record<string, string>` shape `loadEnv` returns — both are read by key,
 * so no adapter is needed.
 *
 * @param env Env values, read as `VITE_BRAND_*` keys.
 * @param defaults Overrides for the fallback literals. Tests pass a variant to
 *   prove the fallback path is independent of the production literals.
 */
export function resolveBranding(
  env: Record<string, string | undefined> | undefined,
  defaults: Branding = BRANDING_DEFAULTS
): Branding {
  const e = env || {};
  return {
    productName: read(e.VITE_BRAND_NAME, defaults.productName),
    productMark: readMark(e.VITE_BRAND_MARK, defaults.productMark),
    // A trailing slash would double up against the "/favicon.svg" and "/#section"
    // suffixes in index.html, so normalise it away.
    siteUrl: read(e.VITE_BRAND_URL, defaults.siteUrl).replace(/\/+$/, ''),
    defaultProjectName: read(e.VITE_BRAND_PROJECT_NAME, defaults.defaultProjectName),
    defaultContractCode: read(e.VITE_BRAND_CONTRACT_CODE, defaults.defaultContractCode),
    defaultClientName: read(e.VITE_BRAND_CLIENT_NAME, defaults.defaultClientName)
  };
}

/** The mark without its degree ornament: "360°" -> "360". */
function markText(mark: string): string {
  return mark.replace(/°\s*$/, '').trim();
}

/**
 * Lockup form, no separator — used by the logo, where the mark sits tight
 * against the wordmark. Yields "GeoSphere360°".
 */
export function brandName(b: Branding = branding): string {
  return b.productMark ? `${b.productName}${b.productMark}` : b.productName;
}

/**
 * Prose form — tab title, report titles, PDF footers, JSON-LD. Spaced and
 * stripped of the degree ornament, which reads as noise in a title. Yields
 * "GeoSphere 360".
 *
 * A reseller who sets only VITE_BRAND_NAME gets "UE Geo 360" here; setting
 * VITE_BRAND_MARK to '' drops the mark from both forms.
 */
export function brandTitle(b: Branding = branding): string {
  const mark = markText(b.productMark);
  return mark && mark !== b.productName ? `${b.productName} ${mark}` : b.productName;
}

/**
 * Alternate names for JSON-LD, derived so a rebranded build keeps no stale
 * strings. The first entry is the bare wordmark (the logo's own text), the
 * other two the prose form — matching the authored list exactly.
 */
export function brandAlternateNames(b: Branding = branding): string[] {
  const title = brandTitle(b);
  return [b.productName, `${title} WebGIS`, `${title} Platform`];
}

/**
 * Bound once for the application bundle.
 *
 * The cast is deliberate. `import.meta.env` is populated by Vite in the client
 * build but is absent when esbuild bundles vite.config.ts, where an unguarded
 * access throws while the config loads. It is also untyped under
 * tsconfig.node.json, which does not load vite/client types — so the property is
 * read structurally rather than through the ImportMeta interface.
 */
export const branding: Branding = resolveBranding(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
);