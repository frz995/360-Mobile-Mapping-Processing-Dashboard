import { signAssetToken } from '../_lib/signing';

const TOKEN_TTL_SECONDS = 3600;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/** Issues the short-lived HMAC token that lets `<img src>` / tile-config
 * requests reach /api/nas-image. Those requests cannot carry the Supabase
 * Authorization header, so the middleware accepts either a bearer session or a
 * valid signed `t` parameter. Requires a valid signed-in user (middleware). */
export async function onRequestGet({ env }) {
  const secret = env.NAS_IMAGE_TOKEN_SECRET || env.NAS_WORKER_TOKEN || '';
  if (!secret) {
    return json({ error: 'Configure NAS_IMAGE_TOKEN_SECRET (or NAS_WORKER_TOKEN) in Cloudflare Pages.' }, 503);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return json({ token: await signAssetToken(secret, expiresAt), expiresAt });
}
