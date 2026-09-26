import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // '.' is the project root; @types/node is not a dependency, so avoid process.
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react(), devApiPlugin()],
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
