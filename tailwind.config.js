/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
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