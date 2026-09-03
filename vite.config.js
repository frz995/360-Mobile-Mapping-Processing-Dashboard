import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                manualChunks: function (id) {
                    if (id.indexOf('node_modules') === -1)
                        return;
                    if (id.indexOf('@supabase') !== -1 || id.indexOf('postgrest') !== -1 || id.indexOf('supabase') !== -1)
                        return 'vendor-supabase';
                    if (id.indexOf('recharts') !== -1 || id.indexOf('/d3-') !== -1 || id.indexOf('victory-vendor') !== -1)
                        return 'vendor-charts';
                    if (id.indexOf('leaflet') !== -1)
                        return 'vendor-maps';
                    if (id.indexOf('@photo-sphere-viewer') !== -1)
                        return 'vendor-psv';
                    if (id.indexOf('@sentry') !== -1)
                        return 'vendor-sentry';
                    if (id.indexOf('lucide-react') !== -1)
                        return 'vendor-icons';
                    if (id.indexOf('react') !== -1 || id.indexOf('scheduler') !== -1)
                        return 'vendor-react';
                },
            },
        },
    },
});
