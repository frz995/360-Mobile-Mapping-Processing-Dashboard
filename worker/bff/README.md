# GeoSphere 360 BFF Gateway (Stream A2)

A thin authentication + authorization gateway that sits in front of the NAS
GPU Worker. It keeps the worker's shared-secret token out of the browser,
verifies the caller's Supabase token server-side, resolves the caller's
application role, and proxies the worker's `/api/*` contract while enforcing
capabilities.

## Why

- **Fix unauthenticated worker routes.** The worker's `POST /api/jobs/{id}/cancel`
  historically called `_guard(None)` (no auth). The BFF now requires a valid,
  role-authorized caller for every cancel.
- **Keep the worker token out of the browser.** Today the dashboard can send a
  raw worker API key to the worker directly. Behind the BFF, the browser sends
  only its Supabase JWT; the gateway injects the worker token server-side.
- **Single enforcement point** that mirrors the PostgreSQL `sec.can()` boundary
  (Stream A1) so the UI cannot be the only auth gate.

## Routes (identical to the worker contract)

| Method | Path                       | Required capability |
|--------|----------------------------|---------------------|
| GET    | `/health`                  | none (health)       |
| POST   | `/api/jobs`                | `runQaqc`           |
| GET    | `/api/jobs/{job_id}`       | `viewAll`           |
| POST   | `/api/jobs/{job_id}/cancel`| `runQaqc`           |
| GET    | `/api/folders`             | `viewAll`           |
| GET    | `/api/storage`             | `viewAll`           |

Capabilities mirror `src/lib/authz.ts` / `supabase/security_functions.sql`.

## Run

```bash
cd worker/bff
cp .env.example .env        # fill real values
python -m venv .venv
.venv\Scripts\activate      # (Windows) or source .venv/bin/activate
pip install -r requirements.txt
uvicorn bff.app:app --host 0.0.0.0 --port 9000
```

## Wire the dashboard

The dashboard's `ProductionApiClient` (`src/services/productionApi.ts`) talks to
the worker's base URL. Point it at the BFF instead:

- Set the worker base URL to `http://<bff-host>:9000`.
- The client should send its **Supabase access token** in the `Authorization`
  header (the BFF forwards it to Supabase Auth to verify).

Because the BFF is route-compatible with the worker, this is a pure address
change with no client code changes required.

## Environment variables

| Variable                  | Purpose                                            |
|---------------------------|----------------------------------------------------|
| `SUPABASE_URL`            | Supabase project URL                               |
| `SUPABASE_SERVICE_ROLE_KEY`| Service-role key (role resolution, RLS bypass)    |
| `WORKER_BASE_URL`         | Where the NAS GPU Worker lives                     |
| `NAS_WORKER_TOKEN`        | Shared secret the worker itself expects            |
| `BFF_ALLOWED_ORIGINS`     | Comma-separated browser origins for CORS           |

## Security notes

- The service-role key is used ONLY server-side, never shipped to the browser.
- If `SUPABASE_SERVICE_ROLE_KEY` is unset, role resolution degrades to `Viewer`
  (read-only) rather than failing open.
- For best defense-in-depth, additionally bind the worker to a private network
  and/or restrict it so it only accepts connections from the BFF host.
