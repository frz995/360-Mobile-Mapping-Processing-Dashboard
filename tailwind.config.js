/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
      },
      colors: {
        app: 'var(--bg-app)',
        card: 'var(--bg-card)',
        inner: 'var(--bg-inner)',
        subtle: 'var(--border-subtle)',
        accent: 'var(--accent)',
        'text-base': 'var(--text-primary)',
        'text-muted': 'var(--text-muted)',
      }
    },
  },
  plugins: [],
}