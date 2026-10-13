// Type declarations for the Cloudflare Pages HMAC helpers.
// See ./tenantWorker.d.ts for why these exist rather than an `allowJs` widening.

/**
 * Mint `<expiresAt>.<organizationId>.<hmac>`.
 *
 * The organisation is a signed claim resolved from the caller's verified
 * membership; an empty string produces the legacy two-part shape.
 */
export declare function signAssetToken(
  secret: string,
  expiresAtSeconds: number,
  organizationId?: string
): Promise<string>;

/** Resolve to the organisation id, `''` for a valid legacy token, null when invalid. */
export declare function verifyAssetToken(
  secret: string,
  token: string | null | undefined,
  nowSeconds: number
): Promise<string | null>;