# Implementation Plan v21 — Cloudflare Pages Production Go-Live & `geosphere.my` Domain Cutover

## Goal

Take the GeoSphere 360 dashboard from its verified Cloudflare Pages deployment (`360-mobile-mapping-processing-dashboard.pages.dev`) to the branded production entry point **`app.geosphere.my`** — including DNS cutover at MYNIC/BigDomain, Cloudflare custom domains + redirects, Supabase auth allowlist, and a full smoke-test/rollback matrix. No application code changes; this is infra + configuration.

## Pre-conditions (blocking)

1. MYNIC activates `geosphere.my` → verify with `nslookup geosphere.my` (currently resolves to BigDomain/MYNIC nameservers).
2. Existing Pages deployment stays live in parallel until cutover completes.

## Execution Strategy

```
┌──────────────────────────────────────────────────────────────────┐
│ Phase A: Cloudflare zone + DNS cutover (geosphere.my)            │
│ Phase B: Pages custom domains + 301 redirects (app/root/www)     │
│ Phase C: Supabase auth/CORS allowlist for new origins            │
│ Phase D: Env-parity check (Pages vars == .env.production)        │
│ Phase E: Verification & smoke-test matrix + DNS propagation watch│
│ Phase F: Optional follow-ups (Git auto-deploy, map migration)    │
└──────────────────────────────────────────────────────────────────┘
```

## Phase A — Cloudflare zone & nameserver cutover

1. **Cloudflare dashboard → Add site** `geosphere.my` (Free plan) → note the **2 assigned nameservers** (e.g. `xxx.ns.cloudflare.com`).
2. **Record current NS at BigDomain** (rollback baseline): `nslookup -type=NS geosphere.my`.
3. **BigDomain → Nameservers** → replace with Cloudflare's pair.
4. **Propagation watch:** poll until `nslookup -type=NS geosphere.my` returns the Cloudflare nameservers. `.my` can take **up to ~48h**; typical is faster. The zone shows "Active" in Cloudflare when confirmed.
5. Do **not** add any DNS records manually yet — Cloudflare's zone import copies existing records; Pages custom domains will add their own.

## Phase B — Pages custom domains & redirects

1. **Pages project → Custom domains → Add** `app.geosphere.my` (**primary/apex-of-choice**). Pages auto-issues/validates the cert (free) — wait for **Active SSL**.
2. **Add** `geosphere.my` (root) and `www.geosphere.my` as additional domains on the same project.
3. **Redirect Rules** (`rules.geosphere.my`): create 301 rules so:
   - `geosphere.my` → `https://app.geosphere.my`
   - `www.geosphere.my` → `https://app.geosphere.my`
   - (Free plan supports basic 301 redirect rules; if the dashboard UI restricts, use Pages **Bulk Redirects**.)
4. Confirm SSL certificate list now covers `app.geosphere.my`, `geosphere.my`, `www.geosphere.my`.

## Phase C — Supabase auth/CORS allowlist

1. **Supabase → Authentication → URL Configuration → Redirect URLs** — add:
   - `https://app.geosphere.my`
   - `https://geosphere.my`
   - `https://www.geosphere.my`
   - (keep `https://360-mobile-mapping-processing-dashboard.pages.dev` and `http://localhost:5174` for dev/rollback)
2. **Allowed CORS origins** — add the same three production origins.
3. **Email templates** (optional): update site name/URL links to `app.geosphere.my` so confirmation/password emails point at the branded URL.

## Phase D — Environment parity (no new deploy expected)

1. Pages project **Settings → Environment variables** must match `.env.production` on this machine:
   - `VITE_SUPABASE_URL=https://tqqybumedywzylujjkqa.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=<same>`
   - `VITE_MAP_URL=https://mobilemapping-nine.vercel.app/`
2. If the dashboard vars are already set (future git builds) they must match; otherwise the current CLI-baked deployment is the source of truth — **no redeploy unless VITE_MAP_URL changes**.

## Phase E — Verification / smoke-test matrix

| Check | Expected |
|---|---|
| `https://app.geosphere.my` | HTTP 200, `<title>GeoSphere 360 Operations Hub</title>` |
| `https://geosphere.my` / `www` | 301 → `app.geosphere.my` |
| TLS | Valid cert, no mixed-content warning |
| Login (email/password) | Redirect round-trip works on new origin |
| Dashboard home | Loads project stats (Supabase Cloud data) |
| 360 map iframe | `VITE_MAP_URL` app renders (Vercel map) |
| Road Analysis | Fetch `/api/road-extraction` returns `lines` array |
| Mobile (≤640px) | `app` loads, `.mobile-compact` intact |
| `nslookup -type=NS geosphere.my` | Both of Cloudflare's NS |

## Phase F — Optional follow-ups (deferred, non-blocking)

1. **Push-to-deploy:** commit `functions/` + `public/_redirects`; connect GitHub repo in Pages → auto-builds on `main` pushes. (Requires explicit confirmation.)
2. **Retire Vercel fully:** migrate the 360 map app (`mobilemapping-nine`) to `map.geosphere.my` on Pages → update `VITE_MAP_URL` → rebuild/redeploy → then decommission Vercel.
3. **WHOIS privacy** for `geosphere.my` at BigDomain.
4. Optional `staging.geosphere.my` environment if ever needed (not in current 2-env model).

## Rollback plan

- **DNS:** revert nameservers at BigDomain to the recorded originals → whole zone returns to pre-Cloudflare state; `pages.dev` remains serving.
- **Custom domains:** remove `app`/root/`www` from Pages + delete redirect rules.
- **Supabase:** remove the three production origins from Redirect URLs / CORS (keep pages.dev).
- No code changes were made, so no git rollback required.