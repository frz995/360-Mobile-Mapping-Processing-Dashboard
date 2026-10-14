# Deployment Topology

**Who this is for.** A reseller (or an engineer acting for one) deciding what a
client deployment actually requires: how many deployments, who owns what, what
has to be rebuilt, and what will break in the field.

> ### 🧭 Architectural Update (Plan v29 — Dual-Tier Architecture)
>
> GeoSphere 360 provides two commercial delivery tracks:
> 1. **GeoSphere Cloud (`https://app.geosphere.my`) — The "ArcGIS Online" SaaS Track:** Single source of truth. Users log in through a single central portal and are routed to their organization's projects and datasets. Zero client web infrastructure setup.
> 2. **GeoSphere Enterprise — Dedicated On-Premises Track:** The physical per-client isolation model detailed in this document, where a client runs their own dedicated stack (database + private server/LAN) for strict security or air-gapped requirements.
>
> **Status of Track 1 — read this before quoting it.** The tenant boundary is now
> built and verified: migrations `0036`–`0042` scope every operational,
> production and ledger table by `organization_id`, re-gate the two
> `SECURITY DEFINER` RPCs, namespace storage object keys under
> `orgs/{organization_id}/`, and the cross-tenant gate in
> `0011_security_tests.sql` proves the boundary by executing it. Run
> `npm run db:gate`; it is a blocking CI job.
>
> Three Track 1 capabilities are **still not built**, and this document used to
> claim otherwise below:
> - **Seat and quota enforcement.** `allowedUserSeats` / `storageQuotaGb` are
>   displayed, not enforced.
> - **User invitation.** `organization_members.status` exists, but no invitation
>   is sent and no member-management API exists.
> - **Tenant export and offboarding deletion.** No way to export or delete a
>   company's data, which a Track 1 contract needs for PDPA.
>
> **Sections 3 and 4 below describe Track 2 and the pre-tenant state of Track 1.**
> They are retained because the reasoning is still load-bearing, but §4's claim
> that no organisation layer exists is now out of date, and it says so inline.

It answers the three questions that come up before anyone signs: *what do I
need?*, *what do I own?*, and *what will go wrong?*

---

## 1. Read this before anything else — the build constraint

Four variables are **inlined into `dist/` at build time** by Vite:

| Variable | Effect of changing it |
| --- | --- |
| `VITE_SUPABASE_URL` | Which database the build talks to |
| `VITE_SUPABASE_ANON_KEY` | Which credential it presents |
| `VITE_MAP_URL` | Which WebGIS app the iframes load |
| `VITE_BRAND_*` (six) | Product name, tab title, report footers, metadata |

Consequences, stated plainly because they drive everything below:

- **One `npm run build` per client.** Pointing a deployment at a different
  database is a *rebuild*, not a settings change. There is no runtime switch for
  these four.
- **Therefore one app deployment per client**, each with its own `dist/`. The
  dashboard and the WebGIS instance are still two apps linked by `VITE_MAP_URL`.
- The Admin Settings `configureSupabaseBackend()` switch
  (`src/services/api/client.ts:151`) **re-points a running build** between hosts
  at runtime. That is useful for testing against a second project. It is **not**
  tenant isolation: one build plus that switch still means one build's users and
  one build's settings.

> Deploying the same `dist/` to two clients is not a supported configuration.
> Build twice.

---

## 2. Recommended shape: one deployment per client

```
                         YOU (licensor)
                     GeoSphere 360 · the product
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    DELIVERABLE           DELIVERABLE          DELIVERABLE
    one-time:             per-install:          recurring:
    source + build        setup + migration     support (optional)
                          + training
                              │
         ┌────────────────────┴────────────────────┐
         │            RESELLER (UE)                 │
         │   holds the licence, owns the client      │
         └────────────────────┬────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
    CLIENT A: TNB LV                 CLIENT B: (reseller's
    ────────────────                other TNB LV work)
    App deploy #1                   App deploy #N
    Supabase project A              Supabase project N
    WebGIS instance A               WebGIS instance N
    NAS + 4 station PCs             NAS + 4 station PCs
    ON PREMISES (their site)        ON PREMISES (their site)
```

**Why this shape and not a shared multi-tenant instance.** *(written before
0036; read as the reasoning that motivated the Track 1 build, not as a
statement of current state)*

Isolation was real here *by construction*: separate Supabase projects cannot
leak into each other, whatever the application code does. The alternative — one
shared instance — was rejected because the application's own `project_id` filter
was a UI convention rather than a security boundary, and a `USING (true)` policy
meant `anon` could read the whole inventory.

**That reasoning is why `0036`–`0042` exist.** They replaced `project_id` as the
isolation key with `organization_id`, moved the boundary from the browser into
PostgreSQL, and made it executable (`npm run db:gate`). A shared instance is now
a *supported* shape for Track 1 rather than a rejected one.

It is still not the default, for two reasons that survive the fix:

1. **Cost of a mistake.** Separate projects cannot cross-contaminate at all.
   One shared database can, and the failure mode is another client's survey
   imagery — which is exactly the claim the pitch is built on.
2. **Where the data lives.** Under Track 2 the NAS and station PCs sit at *the
   client's site*, and "theirs, on their site" is the answer that satisfies the
   usual data-handling questionnaire. Under Track 1 the Vendor holds every
   client's data in one bucket, which is a different answer to the same
   question and a different contract clause (see §5).

**Where the data lives (Track 2).** The NAS and the four station PCs sit at
**the client's site**. The licensor's machine is not in the request path. This
matters commercially: a subcontractor's own client will ask whose hardware holds
their survey data, and "theirs, on their site" is the only answer that satisfies
the usual data-handling questionnaire.

---

## 3. Hosting

Per `Pitch-One-Pager.md` §5, hosting is **Cloudflare Pages**. There is no
container image and no on-premises server package.

If a client requires self-hosting the *application* (not just the field
hardware), that is additional work and must be scoped separately. Say so during
the pilot rather than discovering it at install.

Note the distinction, because it is easy to conflate:

| Layer | Needs the NAS worker / station agents? |
| --- | --- |
| WebGIS, Data Management, Road Analysis, Reporting | **No** — these are browser-facing |
| PC Monitoring / NAS Storage (the station board) | **Yes** — this is the only board that does |

A client who wants the reporting and analysis surfaces but no field capture
stations can be deployed with the tunnel hostnames omitted entirely.

---

## 4. Isolation: what is real, and what is not

This section is deliberately blunt, because the difference decides how many
deployments you sell.

> **This section was rewritten on 13 October 2026.** The version it replaces
> said *"There is no organisation layer… zero occurrences"* and *"it must not be
> sold as one."* Both statements were true when written and are now false:
> `organizations`, `organization_members` and `organization_databases` exist, and
> the tenant boundary is enforced in PostgreSQL. The warning has been inverted —
> it now describes what is still unsafe rather than what is missing.

### 4.1 Track 1 — the tenant boundary (current)

**The isolation key is `organization_id`, not `project_id`.** Migration `0037`
carries it onto 22 operational, production and ledger tables; `0038`–`0040`
rewrite the policies so every `SELECT`, `UPDATE` and `DELETE` carries
`sec.in_org(organization_id)`; `0041` namespaces storage object keys under
`orgs/{organization_id}/` and flips the panorama buckets private.

The predicate is one function, so the rules live in one place (`0038` §1):

```sql
-- sec.in_org(row_organization)
sec.is_platform_admin()                              -- Seller staff, across tenants
OR (row_organization IS NOT NULL                     -- NULL is invisible, never a wildcard
    AND row_organization = sec.current_org())
```

`sec.current_org()` resolves the caller's company from `organization_members`,
validated server-side. It deliberately does **not** read browser state — the
`localStorage` active-tenant hint narrows lookups but cannot widen them, because
the storage and table policies compare the row or key's own company.

**It is verified, not asserted.** `npm run db:gate` applies the bundle to a
throwaway Postgres and runs `0011_security_tests.sql`, which builds two
companies, three users (active, suspended, unassigned) and a platform admin, and
asserts 13 properties — including that a Tenant B caller reads exactly its own
rows, that `anon` reaches nothing, and that deleting a company that owns projects
is refused. It runs as a blocking CI job.

### 4.2 What is still not safe on Track 1

| Risk | Detail |
| --- | --- |
| **Seat and quota are not enforced** | `allowedUserSeats` / `storageQuotaGb` are stored and displayed, and the Seller Console counts `active` / `invited` / `suspended` separately so a breach is detectable. Nothing blocks a 16th seat. |
| **No tenant export or offboarding deletion** | Nothing can export or delete a company's data. A Track 1 contract needs both for PDPA. |
| **`project_settings` is a single global row** | The storage provider, base URL and worker settings are install-wide, not per-company. Switching provider for one tenant changes it for all of them. |
| **Legacy flat-path storage objects** | `0041` made un-namespaced keys reachable only by a platform administrator, so an existing install's panoramas will not render for a tenant until they are re-keyed. See §5. |
| **The NAS worker is per-organisation — RESOLVED in `0043`** | ~~`worker/app.py:53-94` has one `NAS_BASE_PATH` and one shared token~~ **Fixed.** Migration `0043` added `organization_workers`, holding a per-company worker endpoint and bearer token, and `functions/_lib/tenantWorker.js` resolves the credential from the caller's *verified membership* rather than a request parameter. One worker row per company is required; the install-wide `NAS_WORKER_TOKEN` fallback applies only while `organization_workers` is entirely empty. See `02-Operations.md` §2.2 |

> ### ⚠️ What is still required before onboarding a second company
>
> The database boundary is enforced and gated. The worker boundary is now
> enforced too, by `0043`.
>
> **One action is still required per company:** register its worker row in
> `organization_workers` (`organization_id`, `nas_api_url`, `worker_token`) —
> see `02-Operations.md` §2.2. Until a company has its own row, the edge
> **refuses** to route it (`TenantWorkerError`, HTTP 409) rather than falling
> back to the install-wide worker, which is the safe failure.
>
> Seat quotas, storage quotas, `dedicated_external` routing and tenant export
> remain unenforced. They are listed above and in `03-Reference.md` §1.0.

### 4.3 Track 2 — why separate projects remain the default

Under Track 2 isolation is real *by construction*: separate Supabase projects
cannot cross-contaminate whatever the application code does. That is a stronger
guarantee than any policy, and it is why this shape stays the default even though
the shared option is now supported.

### 4.4 One related check before enabling public sharing

`map_shares.project_id` is a plain `text` column (`0018_map_shares.sql`), and the
public read policy in `0019_map_shares_public_access.sql` filters only on share
state. Migration `0040` preserved that verbatim — possession of a live token is
the whole authorisation, which is the intended design for a share link.

What `0040` changed is the ability to *create* one: `0019` had granted
`map_shares_insert` to `anon` with `WITH CHECK (true)`, so anyone could mint a
share. It now requires the caller's own company and `created_by` to match.

Confirm the public-read behaviour with the client before enabling sharing on
their instance.

---

## 5. Credential handover checklist (per install)

- [ ] Supabase project created **in the client's own cloud account**, not the
      licensor's or the reseller's
- [ ] PostGIS enabled **before** migrations (`01` §3.2)
- [ ] `supabase/bootstrap.sql` generated with `npm run migrations:bootstrap`.
      **The file is gitignored** — it is a build artifact, not a deliverable in
      the repository, so the buyer must generate it. `npm run db:gate` proves the
      generation *and* the apply in one command
- [ ] Migrations applied via `supabase/bootstrap.sql`
- [ ] Verification queries at the foot of `bootstrap.sql` return the expected
      results — in particular **zero** rows for "RLS enabled with no policy"
- [ ] **`npm run db:gate` run against a scratch database and passing** before
      the real database is touched. It applies the bundle and runs the
      cross-tenant gate; a failure here means the install will fail too
- [ ] Storage bucket created. Migration `0041` makes `MMS_PIC`, `panoramas` and
      `road-analysis-geometry` **private** — confirm the application is configured
      with `isPrivateBucket` / `useSignedUrls`, or panoramas will not load
- [ ] **Existing objects re-keyed** under `orgs/{organization_id}/`. `0041`
      restricts un-namespaced keys to platform administrators, so objects left at
      the legacy flat path will not render for a tenant. `0041` §5 prints the
      count on apply
- [ ] Anon key issued; **rotated** if a previous one was ever committed to git
- [ ] Cloudflare Pages project created; deploy previews used for acceptance
- [ ] Tunnel hostnames: five (1 NAS worker + 4 station agents) per `02` §3
- [ ] `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAP_URL` set
- [ ] `VITE_BRAND_*` set if deploying under the client's identity
- [ ] `npm run build` → `dist/` deployed
- [ ] First administrator bootstrapped; a **second** admin created via the
      directory
- [ ] `user_accounts.is_platform_admin` set **only** for Seller staff. This is the
      single grant that bypasses tenant isolation; it must never be granted to a
      customer account
- [ ] `map_shares` public links reviewed (§4.4 above)
- [ ] Security test script `0011_security_tests.sql` run against the **installed**
      database, not only a scratch one — it is not a migration and `bootstrap.sql`
      deliberately excludes it

---

## 6. Self-deploy checklist — where the real risk is

The dashboard installs cleanly. The field hardware is what fails. Budget the
time accordingly, and walk this list with someone who has actually done it.

- [ ] NAS mounted and readable by the worker; `NAS_API_URL` and
      `NAS_WORKER_TOKEN` set
- [ ] All four station agents reachable through the tunnel; the token identical
      on each
- [ ] RDP or noVNC verified from **both** an office LAN and a field connection
- [ ] **Clock sync on every PC** — QA/QC evidence timestamps depend on it, and a
      skewed clock silently corrupts the audit trail
- [ ] Uplink tested at actual survey sites, not only from the office
- [ ] Storage quota checked; `MMS_PIC` bucket contents confirmed with the client
- [ ] Station board reporting for all four stations before the crew leaves site

---

## 7. Architectures that must not be used

1. ~~**One shared instance for two competing clients.**~~ **Superseded 13 Oct 2026.**
   This was correct until `0042` and is now a supported shape: the boundary is
   `organization_id`, enforced in PostgreSQL and proven by `npm run db:gate`.
   One qualifier survives — see the warning in §4.2. A shared instance is fine
   **unless** the tenants need the station board, because the NAS worker is still
   single-tenant with one shared token.
2. **One `dist/` deployed to two clients.** **Still holds.** See §1. The build
   inlines the database URL and credential; deploying it twice hands both clients
   the same configuration. Track 1 removes this constraint by using one build,
   which is part of what makes the shared model attractive.
3. **A Track 1 tenant with a station board, before the worker is
   per-organisation.** New, and the one most likely to be entered by accident,
   because everything else in §4 looks finished. See §4.2.

---

## See also

- [`Production Setup/01-Infrastructure.md`](<Production Setup/01-Infrastructure.md>) —
  Supabase, Cloudflare, tunnel, and the Tier-1/Tier-2 verification queries
- [`Production Setup/02-Operations.md`](<Production Setup/02-Operations.md>) —
  NAS folder tree, station agents, day-to-day operation
- [`Production Setup/03-Reference.md`](<Production Setup/03-Reference.md>) —
  every environment variable, the migration list, troubleshooting
- [`Commercial/Pitch-One-Pager.md`](<Commercial/Pitch-One-Pager.md>) — commercial
  terms and hosting position