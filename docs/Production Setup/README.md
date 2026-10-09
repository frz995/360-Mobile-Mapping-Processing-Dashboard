# GeoSphere 360 — Production Setup

Client-facing installation and operations documentation for the GeoSphere 360
Mobile Mapping processing platform.

> ### 📄 Single-document deliverable
>
> **[GeoSphere-360-Production-Setup-Guide.pdf](<GeoSphere-360-Production-Setup-Guide.pdf>)** — the
> complete 42-page guide covering every section below in one document, with
> architecture diagrams, flowcharts and an acceptance sign-off sheet.
>
> Print it, hand it to a client, or issue it as the contractual installation
> manual. The Markdown files in this folder are the plain-text equivalents.
>
> Rebuild the PDF after editing `guide.html`:
> `node scripts/build-setup-pdf.mjs`

**Start here.** Work through the documents below in order. Each has a numbered
section (§) so you can link straight to the part you need.

| # | Document | Covers |
| --- | --- | --- |
| — | [README.md](README.md) *(this file)* | What the system is, topology, install order |
| 1 | [01-Infrastructure.md](01-Infrastructure.md) | Accounts, database, storage buckets, first administrator, Cloudflare Tunnel, Pages deploy |
| 2 | [02-Operations.md](02-Operations.md) | NAS layout, worker, station agents, first-run configuration, verification |
| 3 | [03-Reference.md](03-Reference.md) | Known limitations, troubleshooting, every environment variable, schema and API index |
| 4 | [CHANGELOG.md](CHANGELOG.md) | Release history, bug fixes, architecture improvements, and new capabilities |

Annexes (deeper reference, kept with the original sources):

- [`docs/production_worker_api.md`](../production_worker_api.md) — NAS worker HTTP contract
- [`docs/SMOKE_CHECKLIST.md`](../SMOKE_CHECKLIST.md) — post-install smoke test

---

## 1. What this system is

GeoSphere 360 is a **WebGIS dashboard** with an **on-premises survey pipeline**.

An operator drives the browser application; four workstation PCs run the
photogrammetry desktop software (blurring, stitching, Lightroom, Photoshop); a
small Python service on the NAS exposes the survey filesystem to the dashboard.
Supabase stores the spatial database, authentication and object storage.

### 1.1 There is no server-side image processing

This matters when planning hardware, so it is stated plainly:

> **The platform does not perform image processing on a server.**
> There is no GPU worker, no batch enhancement pipeline, and no job queue.

Panorama quality analysis — sharpness, privacy blur, obstruction, glare — runs
**in the browser** on a WebGL shader path, with a CPU fallback
(`src/utils/gpuAnalyzer.ts`, `src/workers/qaqc.worker.ts`).

Image *editing* (blur, stitch, enhance, mask) is done by **operators in desktop
software on four PCs**, and the dashboard observes their progress. It does not
run them.

**You do not need:** an NVIDIA GPU, CUDA, PyTorch, OpenCV, LaMa, or a
GPU-equipped workstation. A normal office PC per station is sufficient. See
`01-Infrastructure.md` §1 for the actual hardware list.

### 1.2 Topology

```
                            ┌──────────────────────────────────────┐
    BROWSER  ── HTTPS ────▶ │  CLOUDFLARE PAGES                    │
                            │    • SPA (React build → dist/)       │
                            │    • 7 Pages Functions (/api/*)      │
                            │      authenticate the Supabase      │
                            │      session, then proxy on-prem    │
                            └───────────────┬──────────────────────┘
                                            │
                   ┌────────────────────────┴────────────────────────┐
                   │                                                 │
                   ▼                                                 ▼
    ┌──────────────────────────────┐              ┌──────────────────────────────┐
    │ SUPABASE (cloud)             │              │ CLOUDFLARE TUNNEL (5 hosts)  │
    │  • Postgres 15 + PostGIS     │              │  outbound-only, no inbound   │
    │  • Auth (users/roles)        │              │  firewall rule needed        │
    │  • Storage (MMS_PIC bucket)  │              └───────┬───────────┬──────────┘
    └──────────────────────────────┘                      │           │
                                                          ▼           ▼
                                            ┌──────────────────┐  ┌──────────────────┐
                                            │ NAS WORKER       │  │ STATION AGENTS   │
                                            │ (on the NAS PC)  │  │ ×4, one per PC   │
                                            │ FastAPI, :8000   │  │ FastAPI, :8000   │
                                            │ 5 read-only      │  │ progress + rename│
                                            │ filesystem routes│  │ + bucket upload │
                                            └────────┬─────────┘  └──────────────────┘
                                                     ▼
                                            ┌──────────────────┐
                                            │ NAS / SURVEY     │
                                            │ FILE SYSTEM      │
                                            └──────────────────┘
```

### 1.3 What each component is responsible for

| Component | Responsibility | Authoritative for |
| --- | --- | --- |
| Cloudflare Pages | Serves the SPA; hosts the private-API proxy | — |
| Pages Functions | Validate the Supabase session, inject on-prem tokens server-side | Never exposes a NAS credential to the browser |
| Supabase | Spatial database, auth, object storage | All persistent state |
| NAS Worker | Read-only view of the survey filesystem | What is on disk |
| Station Agents ×4 | Report workstation progress; NAS rename; bucket upload | Per-PC work state |
| Browser | Panorama QA/QC analysis (WebGL) | Quality verdicts |

The database is the single source of truth. The NAS is read-only to the
dashboard — the worker refuses any path that escapes its configured base.

---

## 2. Install order

Do these in sequence. Each step depends on the previous one.

| Step | Do this | Document | Est. |
| :-- | :--- | :--- | :--- |
| 1 | Create Cloudflare + Supabase accounts, buy/attach a domain | `01` §1 | 1 day |
| 2 | Create the Supabase project; **enable PostGIS first** | `01` §2 | 30 min |
| 3 | Apply migrations `0001`–`0035` (or run `bootstrap.sql`) | `01` §2 | 15 min |
| 4 | Create the `MMS_PIC` storage bucket (**public**) | `01` §3 | 5 min |
| 5 | Create the first Administrator | `01` §4 | 15 min |
| 6 | Build the NAS folder tree | `02` §1 | 1 day |
| 7 | Install + run the NAS Worker | `02` §2 | 30 min |
| 8 | Install + run 4 Station Agents | `02` §3 | 2 hrs |
| 9 | Create 5 Cloudflare Tunnels | `01` §6 | 1 hr |
| 10 | Deploy to Cloudflare Pages | `01` §7 | 30 min |
| 11 | Configure the application | `02` §4 | 45 min |
| 12 | **Verify** | `02` §5 | 30 min |

Steps 6–9 are the on-premises half and can be done in parallel with 1–5.

> **You need five HTTPS hostnames on your domain**, not one: one for the NAS
> worker and one per station agent. See `01-Infrastructure.md` §1 and §6.

---

## 3. Conventions used in these documents

- **Placeholders** appear as `<ANGLE_BRACKETS>` — replace them, including the
  angle brackets.
- Environment variables are shown with their exact names. Names are
  case-sensitive and must be typed exactly.
- `VITE_*` variables are compiled into the browser bundle at **build time**.
  Changing one requires a **rebuild**, not just a restart. Non-`VITE_` secrets
  are read server-side by Cloudflare and never reach the browser.
- Commands marked **Windows** are PowerShell; others are bash.
- Every `§` reference is a section number inside the named document.