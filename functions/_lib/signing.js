// HMAC helpers for short-lived, signed same-origin asset URLs.
// Cloudflare Pages Functions run on the Workers runtime, so only Web Crypto is
// available here (no Node `crypto`).

const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacBase64Url(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
  return toBase64Url(signature);
}

function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Mint `<expiresAt>.<organizationId>.<hmac>` for the NAS image proxy.
 *
 * The organisation is a SIGNED CLAIM, not a hint. It is resolved from the
 * caller's verified membership at mint time (see _middleware.js) and covered by
 * the HMAC, so an `<img src>` request cannot select a different company's
 * worker by editing the query string — the signature would no longer match.
 *
 * `organizationId` is omitted for a legacy single-tenant install, producing the
 * older two-part shape `<expiresAt>.<hmac>`, which `verifyAssetToken` still
 * accepts and reports with a null organization.
 */
export async function signAssetToken(secret, expiresAtSeconds, organizationId) {
  const org = organizationId ? String(organizationId) : '';
  const payload = `nas-image.${expiresAtSeconds}.${org}`;
  return `${expiresAtSeconds}.${org}.${await hmacBase64Url(secret, payload)}`;
}

/**
 * Validate an asset token's signature and expiry.
 *
 * Returns the organisation id on success, an empty string for a valid legacy
 * token, and null when the token is invalid or expired. The caller treats null
 * as "refuse" and empty as "no tenant scoping — use the install-wide worker",
 * which is only correct while the install has exactly one tenant.
 */
export async function verifyAssetToken(secret, token, nowSeconds) {
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2 || parts.length > 3) return null;

  const expiresAt = Number(parts[0]);
  const organizationId = parts.length === 3 ? parts[1] : '';
  const signature = parts[parts.length - 1];
  if (!Number.isFinite(expiresAt) || !signature) return null;
  if (expiresAt <= nowSeconds) return null;

  const expected = await hmacBase64Url(secret, `nas-image.${expiresAt}.${organizationId}`);
  return constantTimeEquals(signature, expected) ? organizationId : null;
}
