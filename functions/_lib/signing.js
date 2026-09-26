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

/** Mint `<expiresAtSeconds>.<hmac>` for the NAS image proxy. */
export async function signAssetToken(secret, expiresAtSeconds) {
  return `${expiresAtSeconds}.${await hmacBase64Url(secret, `nas-image.${expiresAtSeconds}`)}`;
}

/** Validate an asset token's signature and expiry. */
export async function verifyAssetToken(secret, token, nowSeconds) {
  if (!secret || typeof token !== 'string') return false;
  const separator = token.indexOf('.');
  if (separator <= 0) return false;
  const expiresAt = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || !signature) return false;
  if (expiresAt <= nowSeconds) return false;
  return constantTimeEquals(signature, await hmacBase64Url(secret, `nas-image.${expiresAt}`));
}
