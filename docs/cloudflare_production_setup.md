# Cloudflare Pages production setup

The browser app is deployed on Cloudflare Pages. NAS filesystem access and
workstation agents remain on-premises; Pages Functions authenticate the
signed-in Supabase user, then proxy over HTTPS Cloudflare Tunnels. The Pages
runtime never reads a Windows path and no NAS/agent credential is sent to the
browser.

## 1. Pages build

In Cloudflare Pages, connect this repository and set:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | repository root |

`public/_redirects` keeps SPA routes working. The `functions/` directory
contains the Pages Functions; do not deploy the Vite-only `api/nas-scan.js`
as the production NAS service.

## 2. Pages build-time variables

Set these for Production (and Preview if you use a preview deployment):

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `VITE_NAS_API_ENABLED` | Set to `true`; routes worker calls through the Pages proxy |
| `VITE_PRODUCTION_API_URL` | HTTPS worker/tunnel URL for other direct worker integrations and upload-channel availability |

The frontend only contains the public Supabase anon key. Never put the
Supabase service-role key, NAS worker token, station-agent tokens, or Cloudflare
Access service token in a `VITE_` variable.

## 3. On-prem origins and Pages Function secrets

Run the NAS GPU Worker with the real NAS root configured in its environment:

```env
NAS_BASE_PATH=<the NAS mount/share root containing 00_Raw_data, 01_Metadata, 03_Stitching, 05_Final, DELIVERABLES>
NAS_WORKER_TOKEN=<long random secret>
```

Expose the NAS worker through a Cloudflare Tunnel HTTPS hostname, e.g.
`https://nas-api.<your-domain>`. The purchased domain can be attached later;
Pages can be deployed and tested on its `*.pages.dev` hostname first.

Set these Cloudflare Pages runtime variables/secrets:

| Variable / Secret | Value |
| --- | --- |
| `SUPABASE_URL` | same project URL (server-side Pages Functions auth check) |
| `SUPABASE_ANON_KEY` | same anon/publishable key |
| `NAS_API_URL` | HTTPS Tunnel origin for the on-prem NAS worker (no trailing slash) |
| `NAS_WORKER_TOKEN` | must match the worker's `NAS_WORKER_TOKEN` |
| `NAS_IMAGE_TOKEN_SECRET` | separate HMAC secret for short-lived signed image URLs; falls back to `NAS_WORKER_TOKEN` if unset |
| `STATION_AGENT_URLS` | JSON map, e.g. `{"blur":"https://pc1-agent...","stitch":"https://pc2-agent...","lightroom":"https://pc3-agent...","photoshop":"https://pc4-agent..."}` |
| `STATION_AGENT_TOKENS` | JSON map of station id → that agent's `AGENT_TOKEN` |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | optional Cloudflare Access service token forwarded to the private Tunnel apps |

Pages Functions authenticate each private API request against Supabase before
proxying it. They then use the server-side worker/agent tokens and stream the
response back on the same HTTPS origin. Configure the Tunnel hostnames with
Cloudflare Access as an additional origin-level gate when available.

### NAS preview images and signed URLs

`/api/nas-image` serves NAS bytes, but `<img src>` and tile-config loaders
cannot attach the `Authorization` header. After login the app requests
`/api/nas-image-token` (authenticated like every other private route) and gets
a 1-hour HMAC token, which it appends as `?t=`. The middleware accepts either
the bearer session or a valid unexpired signature, so previews work without
exposing any long-lived secret to the page.

## 4. Station agents and remote desktop

Install `station-agent/` on each PC and configure `STATION_ID`, `WATCH_ROOT`,
`PROCESS_NAMES`, and a unique `AGENT_TOKEN`. The Cloudflare Tunnel URL in
`STATION_AGENT_URLS` must use HTTPS and reach that PC's agent port. The browser
uses same-origin `/api/station-agent` Pages Functions for health, reports,
rename, and CLI sync jobs; it does not call private `http://192.168.x.x`
addresses from the HTTPS Pages app.

For embedded VNC/noVNC, set each workstation's **VNC Live URL** in Providers
to its HTTPS Tunnel URL (e.g. `https://pc2-remote.<your-domain>/vnc.html`). A
private HTTP VNC URL is deliberately not embedded on an HTTPS production page.
Native `.rdp` download remains available to operators on the LAN.

## 5. Supabase migrations

Apply the repository migrations in order, including:

- `0023_station_board_items.sql`
- `0024_stage_event_ledger.sql`
- `0025_station_board_metric_unit.sql`
- `0026_hub_session_state.sql`

These provide persisted station snapshots, event history, capture-point units,
and the Production Hub last-activity session.

## Local development

`vite.config.ts` mounts `api/nas-scan.js` and `api/nas-image.js` as local-only
development adapters. The former's `Project_Test` root is a development
fixture only; deployed Cloudflare Pages requests go through the Pages
Functions to the worker's configured `NAS_BASE_PATH`.

## Readiness boundary

The repository contains the deployable Pages Functions and the on-prem API
contract, but production operation still requires the Pages variables/secrets,
Tunnel routes, worker deployment, four agent installs, actual station addresses,
and the migrations above. Without those environment-specific resources the
frontend can deploy, but NAS/PC operations correctly report unavailable rather
than using local test data.
