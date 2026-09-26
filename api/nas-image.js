import fs from 'node:fs';
import path from 'node:path';

// Vite development adapter only. Cloudflare Pages uses functions/api/nas-image.js
// to proxy to the authenticated on-prem worker; this local adapter reads the
// developer's NAS test root so the same browser route works in `npm run dev`.
const DEFAULT_DEV_NAS_ROOT = 'D:/Webmap/360 web mapping/Project_Test';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const base = process.env.NAS_DEV_ROOT || DEFAULT_DEV_NAS_ROOT;
    const rel = (url.searchParams.get('path') || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid NAS image path.' }));
      return;
    }
    const root = path.resolve(base);
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Image path escapes the configured NAS root.' }));
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Image not found on the dev NAS root.' }));
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', ext === '.png' ? 'image/png' : 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(target).pipe(res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
