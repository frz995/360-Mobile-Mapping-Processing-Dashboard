import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**/*.ts', 'src/components/**/*.tsx'],
      exclude: ['src/test/**', '**/*.d.ts', '**/*.config.*'],
    },
  },
})
