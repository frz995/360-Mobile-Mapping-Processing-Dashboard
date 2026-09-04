import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function devRoadExtractionPlugin() {
  return {
    name: 'dev-road-extraction-plugin',
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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), devRoadExtractionPlugin()],
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
})
