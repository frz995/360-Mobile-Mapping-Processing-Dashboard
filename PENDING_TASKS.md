# 📋 Pending Tasks — 360° Mobile Mapping Processing Dashboard

> Tasks identified for future improvement. To be done in order of priority.

---

## UI / UX Polish

- `[x]` **Mobile Responsiveness** — Dense grid layout likely breaks on smaller screens. Adapt layout to stack panels vertically on tablet/mobile viewports.
- `[x]` **Loading States** — Replace empty dashes (`—`) during data fetch with skeleton loaders for KPI cards, table rows, and map panels.
- `[x]` **Empty State Design** — When no data exists, show illustrated/descriptive empty states instead of blank panels (e.g., "No batch logs yet. Import a CSV to get started.").

## Reliability & Robustness

- `[x]` **Error Boundaries** — Add graceful UI fallback when Supabase is unreachable or returns an error (currently may silently fail).

## Accessibility

- `[x]` **Keyboard Navigation** — Ensure all interactive elements (buttons, tabs, map controls) are reachable and operable via keyboard.
- `[x]` **ARIA Labels** — Add descriptive `aria-label` attributes to icon-only buttons, toggle controls, and modal dialogs.

