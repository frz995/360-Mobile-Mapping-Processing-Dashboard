import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import {
  resolveBranding,
  brandTitle,
  brandAlternateNames,
  type Branding
} from './src/config/branding'

function devApiPlugin() {
  return {
    name: 'dev-api-plugin',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url && req.url.startsWith('/api/road-extraction')) {
          try {
            // @ts-ignore
            const { default: handler } = await import('./api/road-extraction.js');
            await handler(req, res);
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        next();
      });
    }
  };
}

/**
 * Local development talks to the real on-prem NAS GPU worker over the same
 * routes the Cloudflare Pages Functions serve in production. No local folder is
 * ever scanned and no fixture data exists: `NAS_API_URL` / `NAS_WORKER_TOKEN`
 * come from the developer's untracked .env, and the worker token is attached
 * here so it never reaches the browser. When they are absent the routes are
 * simply not registered, so the UI reports "not configured" instead of
 * inventing a NAS.
 */
function nasWorkerDevProxy(target: string, token: string): Record<string, any> {
  const origin = (target || '').replace(/\/+$/, '');
  if (!origin || !token) return {};
  const authorize = (proxy: any) => {
    proxy.on('proxyReq', (proxyReq: any) => {
      proxyReq.setHeader('Authorization', `Bearer ${token}`);
    });
  };
  return {
    '/api/nas-scan': { target: origin, changeOrigin: true, configure: authorize },
    '/api/nas-image': {
      target: origin,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api\/nas-image/, '/api/images'),
      configure: authorize,
    },
    '/api/worker': {
      target: origin,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/api\/worker/, ''),
      configure: authorize,
    },
  };
}

/**
 * Rewrite the reseller-facing metadata in index.html from the VITE_BRAND_* env.
 *
 * index.html is not a bundler-templated file, so the brand literals (15
 * occurrences of the original domain, the tab title, the OG/Twitter titles and
 * the JSON-LD names) are otherwise frozen at their authored values. Rewriting
 * them here — rather than templating index.html by hand — keeps the authored
 * file readable and makes an unset env a guaranteed no-op: every substitution
 * targets the default literal, so replacing it with itself changes nothing.
 *
 * The JSON-LD @type keys are left alone; only URL and name values move.
 */
function brandingHtmlPlugin(brand: Branding) {
  const title = brandTitle(brand)
  const alternates = brandAlternateNames(brand)

  return {
    name: 'branding-html',
    transformIndexHtml(html: string) {
      // Order matters: the URL sweep first, so no later name substitution can
      // re-introduce the original domain inside an already-rewritten URL.
      let out = html.replace(
        /https:\/\/app\.geosphere\.my/g,
        brand.siteUrl
      )

      // Titles. Only the brand literal is swapped, never the whole attribute:
      // the authored titles carry a non-brand suffix ("- WebGIS") that must
      // survive, otherwise an unset env would not be a no-op.
      out = out.replace(/GeoSphere 360(?=\s*(?:-\s*WebGIS|<\/title>))/g, title)
      out = out.replace(
        /(<meta (?:property|name)="(?:og:title|twitter:title)" content=")GeoSphere 360(-\s*WebGIS")/g,
        (_m, open: string, close: string) => `${open}${title}${close}`
      )

      // JSON-LD "name" on the WebSite and Organization nodes, plus the
      // alternateName list, which would otherwise keep the original strings.
      out = out.replace(
        /("name":\s*")GeoSphere 360(")/g,
        (_m, open: string, close: string) => `${open}${title}${close}`
      )
      // Reflowed to one line even when nothing changed, so the existing
      // block is kept verbatim whenever it already carries the derived names.
      out = out.replace(
        /("alternateName":\s*\[)([^\]]*)(\])/,
        (m, open: string, body: string, close: string) => {
          const current = body
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .join(',');
          const wanted = alternates.map((n) => JSON.stringify(n)).join(',');
          if (current === wanted) return m;
          return `${open}${wanted}${close}`;
        }
      )

      // Descriptions only where they actually embed the brand name. The og/twitter
      // pair deliberately does not, so they are left byte-identical.
      out = out.replace(
        /(<meta name="description" content=")GeoSphere 360([^"]*")/g,
        (_m, open: string, rest: string) => `${open}${title}${rest}`
      )

      return out
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // '.' is the project root; @types/node is not a dependency, so avoid process.
  const env = loadEnv(mode, '.', '');
  const hasWorkerProxy = Boolean(
    (env.NAS_API_URL || '').trim() && (env.NAS_WORKER_TOKEN || '').trim()
  );

  return {
    // Branding first: index.html is the identity surface, so it is rewritten
    // before the React transform ever sees the page. Reads as
    // "identity, then bundling".
    plugins: [brandingHtmlPlugin(resolveBranding(env)), react(), devApiPlugin()],
    // Compiled in so the client can tell "worker proxy not configured" apart
    // from "worker unreachable" instead of firing a request that can only 404.
    define: {
      __NAS_WORKER_DEV_PROXY__: JSON.stringify(hasWorkerProxy),
    },
    server: {
      proxy: nasWorkerDevProxy(env.NAS_API_URL, env.NAS_WORKER_TOKEN),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.indexOf('node_modules') === -1) return
            if (id.indexOf('@supabase') !== -1 || id.indexOf('postgrest') !== -1 || id.indexOf('supabase') !== -1) return 'vendor-supabase'
            if (id.indexOf('recharts') !== -1 || id.indexOf('/d3-') !== -1 || id.indexOf('victory-vendor') !== -1) return 'vendor-charts'
            if (id.indexOf('leaflet') !== -1) return 'vendor-maps'
            if (id.indexOf('@photo-sphere-viewer') !== -1) return 'vendor-psv'
            if (id.indexOf('@sentry') !== -1) return 'vendor-sentry'
            if (id.indexOf('lucide-react') !== -1) return 'vendor-icons'
            if (id.indexOf('react') !== -1 || id.indexOf('scheduler') !== -1) return 'vendor-react'
          },
        },
      },
    },
  };
});
