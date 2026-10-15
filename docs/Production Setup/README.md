# GeoSphere 360 — Production Setup (Single-Domain Platform)

Installation and operations documentation for the GeoSphere 360 Mobile Mapping
processing platform, as deployed on the single canonical domain
**`https://app.geosphere.my`**.

> ### ☁️ Who does what
> > **The Seller (GeoSphere)** deploys the platform **once** to
> > `https://app.geosphere.my` — Cloudflare Pages, the Supabase project, the
> > database migrations, the first platform administrator. Each client company is
> > then onboarded **through the Seller Console** at
> > **`https://app.geosphere.my/console`**. That procedure is
> > [02-Operations.md §4](02-Operations.md#4-onboarding-a-client-company).
> >
> > **The client company** receives sign-in credentials for its own workspace and
> > operates its own survey hardware — the NAS, the worker, and four station
> > agents. That hardware is theirs; the platform is not.

> ### 📄 Single-document deliverable
>
> **[GeoSphere-360-Production-Setup-Guide.pdf](<GeoSphere-360-Production-Setup-Guide.pdf>)** — the
> complete setup guide covering every section below in one document, with
> architecture diagrams, flowcharts and an acceptance sign-off sheet.
>
> Print it, hand it to a client, or issue it as the contractual
> installation manual. The Markdown files in this folder are the plain-text equivalents.
>
> Rebuild the PDF after editing `guide.html`:
> `node scripts/build-setup-pdf.mjs`
>
> ⚠️ `guide.html` is maintained **separately** from these Markdown files — the
> build script prints the HTML, it does not generate it from the Markdown. Keep
> both in step when you change either, or the PDF will contradict the manual.

**Start here.** Work through the documents below in order. Each has a numbered
section (§) so you can link straight to the part you need.

| # | Document | Covers | Audience |
| --- | --- | --- | --- |
| — | [README.md](README.md) *(this file)* | What the system is, topology, the Seller Console, install order | Both |
| 1 | [01-Infrastructure.md](01-Infrastructure.md) | **Platform deployment:** accounts, database, buckets, first platform administrator, Pages deploy | **Seller** |
| 2 | [02-Operations.md](02-Operations.md) | **Onboarding a company via the console**, then NAS, worker, station agents, verification | **Both** |
| 3 | [03-Reference.md](03-Reference.md) | Known limitations, troubleshooting, every environment variable, schema and API index | Both |
| 4 | [CHANGELOG.md](CHANGELOG.md) | Release history, bug fixes, architecture improvements, and new capabilities | Both |

Annexes (deeper reference, kept with the original sources):

- [`docs/Product Dashboard/production_worker_api.md`](../Product Dashboard/production_worker_api.md) — NAS worker HTTP contract
- [`docs/Product Dashboard/SMOKE_CHECKLIST.md`](../Product Dashboard/SMOKE_CHECKLIST.md) — post-install smoke test
- [`docs/Deployment-Topology.md`](../Deployment-Topology.md) — Track 1 (this platform) vs Track 2 (fully on-premises)

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
                            │    • 8 Pages Functions (/api/*)      │
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

### 1.4 The Seller Console

The console is at **`https://app.geosphere.my/console`** - a page on the same
domain, not a separate deployment.

**Who can open it.** Only a **platform administrator**. The check is a database
read (`public.console_access()`), not a UI check: PostgreSQL decides, and the
console refuses to render anything until that read answers. A Viewer or a Survey
Operator who navigates to `/console` sees a refusal screen. If the check cannot
reach the database at all, the screen says the answer is **unknown** rather than
guessing either way.

**What it is for.** Provisioning and staffing client companies:

| Panel | Purpose |
| --- | --- |
| **Dashboard** | Portfolio totals across every company |
| **Companies** | Create, edit and route each client company |
| **Team Members** | Invite staff, set their company role, suspend access |
| **Database Hub** | Where each company is routed: shared cloud or a dedicated instance |
| **Seat Licenses** | Licensed seats against confirmed members |
| **Settings** | The console account, and what is **not** enforced |

**It opens in a new tab.** The console renders its own shell and has no sidebar,
so navigating to it from inside the application would strand the operator with no
way back. Administration -> *Seller Console* opens it deliberately.

> **A company with no staff cannot be used.** Creating a company does not grant
> anybody access to it. Somebody must be invited, and that person must confirm
> their email address and sign in for the first time. See
> [02-Operations.md §4](02-Operations.md#4-onboarding-a-client-company).

---

## 2. Install order

Do these in sequence. Each step depends on the previous one.

| Step | Do this | Document | Est. |
| :-- | :--- | :--- | :--- |
| 1 | Create Cloudflare + Supabase accounts, buy/attach a domain | `01` §1 | 1 day |
| 2 | Create the Supabase project; **enable PostGIS first** | `01` §2 | 30 min |
| 3 | Apply migrations `0001`-`0045` (or run `bootstrap.sql`) | `01` §2 | 15 min |
| 4 | Create the `MMS_PIC` storage bucket (**public**) | `01` §3 | 5 min |
| 5 | Create the first **platform administrator** | `01` §4 | 15 min |
| 6 | Deploy to Cloudflare Pages | `01` §7 | 30 min |

**Then once per client company:**

| Step | Do this | Document | Est. |
| :-- | :--- | :--- | :-- |
| 7 | Create the company in the Seller Console | `02` §4.1 | 5 min |
| 8 | Set its status, seats and storage quota | `02` §4.1 | 5 min |
| 9 | Invite its staff | `02` §4.3 | 10 min |
| 10 | Build the NAS folder tree | `02` §1 | 1 day |
| 11 | Install + run the NAS Worker | `02` §2 | 30 min |
| 12 | Install + run 4 Station Agents | `02` §3 | 2 hrs |
| 13 | Create the Cloudflare Tunnels for that company's hardware | `01` §6 | 1 hr |
| 14 | Configure the application and **verify** | `02` §5 | 1 hr |

Steps 10-13 belong to the client company's own hardware and are commonly done in
parallel with 7-9.

> **You need HTTPS hostnames on your domain** for that company's tunnel
> hardware: one for the NAS worker and one per station agent. See
> `01-Infrastructure.md` §1 and §6. These are **per company**, not per platform.

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