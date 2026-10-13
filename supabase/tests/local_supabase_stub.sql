-- =====================================================================
-- GeoSphere 360 — Local/CI scaffolding for a bare supabase/postgres image
--
-- NOT PART OF THE PRODUCT SCHEMA. Do not apply this to a real Supabase
-- project; those objects already exist there and are managed by the Auth and
-- Storage services.
--
-- WHY IT EXISTS
--   The cross-tenant security gate (supabase/migrations/0011_security_tests.sql)
--   is the only executable proof that the tenant boundary holds. It needs a real
--   Postgres with two companies in it — vitest mocks Supabase, so no
--   application test can stand in.
--
--   `supabase/postgres` is the right base image (PostGIS, the `sec`/`auth`
--   schemas, the roles), but it is the DATABASE only. Three things migrations
--   assume are created elsewhere:
--
--     1. storage.buckets / storage.objects  — created by the Storage service
--     2. GRANT USAGE ON SCHEMA storage     — owned by supabase_admin
--     3. auth.jwt() / the real auth.uid()  — created by the GoTrue migration
--
--   Without them the gate cannot run, and a gate that cannot run is not a gate.
--   This file supplies them so `npm run db:gate` works on a laptop and in CI
--   from nothing but Docker.
--
-- Apply order:
--     psql -f this file            (once, before bootstrap.sql)
--     psql -f bootstrap.sql
--     psql -f this file            (again, for auth.jwt() only)
--     psql -f 0011_security_tests.sql
--
-- The second application is deliberate and idempotent: the storage grants are
-- already in place by then, and all statements here are IF NOT EXISTS /
-- CREATE OR REPLACE.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS storage;

-- ---------------------------------------------------------------------
-- Storage service tables.
--
-- Columns mirror the ones migrations touch: storage.buckets(id, name, public)
-- from 0021, and storage.objects(bucket_id, name, metadata) from 0028's
-- inventory trigger.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage.buckets (
  id         text PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  owner      uuid,
  public     boolean DEFAULT false,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id  text,
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- 0028's trigger upserts on (bucket, filename) via file_inventory, and the
-- gate seeds objects with ON CONFLICT DO NOTHING, so this key must exist for
-- either to work.
CREATE UNIQUE INDEX IF NOT EXISTS storage_objects_key ON storage.objects (bucket_id, name);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets  ENABLE ROW LEVEL SECURITY;

-- The Storage service's default grants. The schema belongs to supabase_admin,
-- so without an explicit USAGE grant `authenticated` cannot reach its tables at
-- all — the same class of omission that migration 0036 repaired for `sec`.
GRANT USAGE  ON SCHEMA storage TO authenticated, anon, service_role;

GRANT SELECT ON storage.objects TO anon;
GRANT ALL    ON storage.objects TO authenticated, service_role;
GRANT SELECT ON storage.buckets  TO anon;
GRANT ALL    ON storage.buckets  TO authenticated, service_role;

-- Seeded PUBLIC so migration 0041 has something real to flip: its verification
-- asserts these buckets are private afterwards, which is a vacuous check
-- against buckets that were never public.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('MMS_PIC',               'MMS_PIC',               true),
  ('panoramas',             'panoramas',             true),
  ('road-analysis-geometry','road-analysis-geometry',true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Auth service functions.
--
-- auth.uid() exists in the base image but reads only `request.jwt.claim.sub`,
-- while Supabase's reads the full claims JSON. The gate sets the JSON form, so
-- the JSON-aware definition is required for the caller's identity to resolve.
-- auth.jwt() is absent entirely.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$
    SELECT COALESCE(
      NULLIF(current_setting('request.jwt.claim.sub', true), ''),
      (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;

-- ---------------------------------------------------------------------
-- The image's broken GraphQL event trigger is disabled by the harness, not
-- here.
--
-- `supabase/postgres` installs `issue_graphql_placeholder` on `sql_drop`, whose
-- function body calls `graphql.increment_schema_version()` -> `nextval(...)` on
-- `graphql.seq_schema_version`. The image ships an EMPTY `graphql` schema, so
-- that relation does not exist, and the first DROP in the migration bundle
-- aborts the apply with "could not open relation with OID ...".
--
-- The product schema does not depend on it: it is service plumbing for
-- Supabase's GraphQL endpoint, not part of any migration.
--
-- It must be disabled as a standalone statement BEFORE this file runs, not from
-- inside it: `ALTER EVENT TRIGGER ... DISABLE` issued inside this script fails
-- for the same broken-graphql reason it is meant to avoid. `npm run db:gate`
-- and .github/workflows/ci.yml both do it as their own psql call.
--
--   psql -c "ALTER EVENT TRIGGER issue_graphql_placeholder DISABLE;"
-- ---------------------------------------------------------------------