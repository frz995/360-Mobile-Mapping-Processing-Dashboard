# Deployment Topology

**Who this is for.** A reseller (or an engineer acting for one) deciding what a
client deployment actually requires: how many deployments, who owns what, what
has to be rebuilt, and what will break in the field.

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

**Why this shape and not a shared multi-tenant instance.** Isolation is real
here *by construction*: separate Supabase projects cannot leak into each other,
whatever the application code does. The alternative is discussed in §4, and the
short version is that the application's own `project_id` filter is a UI
convention rather than a security boundary.

**Where the data lives.** The NAS and the four station PCs sit at **the client's
site**. The licensor's machine is not in the request path. This matters
commercially: a subcontractor's own client will ask whose hardware holds their
survey data, and "theirs, on their site" is the only answer that satisfies the
usual data-handling questionnaire.

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

**What exists.** `projects` (migration `0015`), and `project_id` on the
operational tables added by `0016` — `panoramas`, `staging_panoramas`,
`qa_defects`, `qaqc_audit_runs`, `subgrids`, `datasets`, `processing_jobs`,
`audit_logs`, `notifications`, `deletion_requests`, `survey_recycle_bin`,
`file_inventory`, plus `batch_logs`. So **one instance can serve many survey
campaigns for one owner**, which is the normal case for a utility running the
same subgrid in successive seasons.

**What does not exist.** There is no organisation layer. No `org_id`,
`tenant_id` or `workspace_id` appears anywhere in `src/` — verified by search,
zero occurrences.

**RLS does not enforce `project_id`.** Every core policy is role-only:

```sql
CREATE POLICY "panoramas_select" ON public.panoramas
  FOR SELECT USING (sec.can('viewAll'));
```

The project filter is applied **in the client** — `scoped()` in
`src/services/api/client.ts:103` appends `.eq('project_id', id)`.

> ### ⚠️ Do not load two competing clients into one instance.
>
> `project_id` isolation is a UI convention, not a security boundary. A user who
> changes the stored active-project id can read another campaign's surveys. This
> is safe for many campaigns belonging to one owner. It is **not** a multi-tenant
> boundary, and it must not be sold as one.

One deployment per client is safe *by construction*, which is why it is the
recommended shape rather than a preference.

### One related check before enabling public sharing

`map_shares.project_id` is a plain `text` column (`0018_map_shares.sql`), and the
public read policy in `0019_map_shares_public_access.sql` filters only on share
state:

```sql
create policy "map_shares_public_read" on public.map_shares
  for select
  using (revoked_at is null
    and (expires_at is null or expires_at > now()));
```

There is no project filter and no role check — possession of the token is the
whole authorisation. That is the intended design for a share link, but confirm it
with the client before enabling public sharing on their instance.

---

## 5. Credential handover checklist (per install)

- [ ] Supabase project created **in the client's own cloud account**, not the
      licensor's or the reseller's
- [ ] PostGIS enabled **before** migrations (`01` §3.2)
- [ ] Migrations applied via `supabase/bootstrap.sql`, generated with
      `npm run migrations:bootstrap` (§13 of the implementation plan)
- [ ] Verification queries at the foot of `bootstrap.sql` return the expected
      results — in particular **zero** rows for "RLS enabled with no policy"
- [ ] Storage bucket created and **made public**; name recorded
- [ ] Anon key issued; **rotated** if a previous one was ever committed to git
- [ ] Cloudflare Pages project created; deploy previews used for acceptance
- [ ] Tunnel hostnames: five (1 NAS worker + 4 station agents) per `02` §3
- [ ] `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAP_URL` set
- [ ] `VITE_BRAND_*` set if deploying under the client's identity
- [ ] `npm run build` → `dist/` deployed
- [ ] First administrator bootstrapped; a **second** admin created via the
      directory
- [ ] `map_shares` public links reviewed (§4 above)
- [ ] Security test script `0011_security_tests.sql` run and passed separately —
      it is not a migration and `bootstrap.sql` deliberately excludes it

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

## 7. Two architectures that must not be used

1. **One shared instance for two competing clients.** See §4. `project_id` is not
   a security boundary.
2. **One `dist/` deployed to two clients.** See §1. The build inlines the
   database URL and credential; deploying it twice hands both clients the same
   configuration.

Both are recoverable, but neither is a configuration to enter by accident.

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