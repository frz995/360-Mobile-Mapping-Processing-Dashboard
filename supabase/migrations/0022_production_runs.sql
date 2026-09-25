CREATE TABLE IF NOT EXISTS public.production_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id),
    subgrid VARCHAR(50) NOT NULL,
    capture_date DATE NOT NULL,
    run_code VARCHAR(120) NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
    status VARCHAR(30) NOT NULL DEFAULT 'CAPTURED' CHECK (status IN ('CAPTURED', 'PROCESSING', 'QA_PENDING', 'RELEASED', 'ARCHIVED')),
    camera_model VARCHAR(120),
    source_folder TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by VARCHAR(100) NOT NULL DEFAULT 'System',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, subgrid, capture_date, sequence),
    UNIQUE (project_id, run_code)
);

CREATE TABLE IF NOT EXISTS public.production_run_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id),
    production_run_id UUID NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PROCESSING', 'QA_PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
    source_dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
    output_dataset_id UUID REFERENCES public.datasets(id) ON DELETE SET NULL,
    processing_job_id UUID REFERENCES public.processing_jobs(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by VARCHAR(100) NOT NULL DEFAULT 'System',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (production_run_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS public.production_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id),
    production_run_id UUID NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL REFERENCES public.production_run_attempts(id) ON DELETE CASCADE,
    release_code VARCHAR(160) NOT NULL,
    subgrid VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PREPARING' CHECK (status IN ('PREPARING', 'READY', 'PUBLISHED', 'FAILED', 'ARCHIVED')),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    source_folder TEXT NOT NULL DEFAULT '',
    release_folder TEXT NOT NULL DEFAULT '',
    manifest_path TEXT NOT NULL DEFAULT '',
    file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
    total_size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (total_size_bytes >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    published_by VARCHAR(100),
    created_by VARCHAR(100) NOT NULL DEFAULT 'System',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, release_code),
    UNIQUE (project_id, production_run_id, attempt_id)
);

ALTER TABLE public.production_runs
    ADD COLUMN IF NOT EXISTS active_release_id UUID REFERENCES public.production_releases(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.production_release_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id),
    release_id UUID NOT NULL REFERENCES public.production_releases(id) ON DELETE CASCADE,
    source_path TEXT NOT NULL,
    source_name TEXT NOT NULL,
    release_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    media_type VARCHAR(100) NOT NULL DEFAULT 'image',
    size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    sha256 VARCHAR(64),
    sort_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (release_id, release_name)
);

CREATE INDEX IF NOT EXISTS idx_production_runs_project_subgrid
    ON public.production_runs(project_id, subgrid, capture_date DESC, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_production_runs_project_status
    ON public.production_runs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_production_run_attempts_project_run
    ON public.production_run_attempts(project_id, production_run_id, attempt_number DESC);
CREATE INDEX IF NOT EXISTS idx_production_releases_project_subgrid
    ON public.production_releases(project_id, subgrid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_releases_project_status
    ON public.production_releases(project_id, status);
CREATE INDEX IF NOT EXISTS idx_production_release_files_project_release
    ON public.production_release_files(project_id, release_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_releases_one_active
    ON public.production_releases(project_id, subgrid)
    WHERE is_active = TRUE AND status IN ('READY', 'PUBLISHED');

ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS production_run_id UUID REFERENCES public.production_runs(id) ON DELETE SET NULL;
ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS production_attempt_id UUID REFERENCES public.production_run_attempts(id) ON DELETE SET NULL;
ALTER TABLE public.datasets ADD COLUMN IF NOT EXISTS production_release_id UUID REFERENCES public.production_releases(id) ON DELETE SET NULL;
ALTER TABLE public.processing_jobs ADD COLUMN IF NOT EXISTS production_run_id UUID REFERENCES public.production_runs(id) ON DELETE SET NULL;
ALTER TABLE public.processing_jobs ADD COLUMN IF NOT EXISTS production_attempt_id UUID REFERENCES public.production_run_attempts(id) ON DELETE SET NULL;
ALTER TABLE public.staging_panoramas ADD COLUMN IF NOT EXISTS production_run_id UUID REFERENCES public.production_runs(id) ON DELETE SET NULL;
ALTER TABLE public.staging_panoramas ADD COLUMN IF NOT EXISTS production_attempt_id UUID REFERENCES public.production_run_attempts(id) ON DELETE SET NULL;
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS production_run_id UUID REFERENCES public.production_runs(id) ON DELETE SET NULL;
ALTER TABLE public.qaqc_audit_runs ADD COLUMN IF NOT EXISTS production_attempt_id UUID REFERENCES public.production_run_attempts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_datasets_production_run
    ON public.datasets(project_id, production_run_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_production_run
    ON public.processing_jobs(project_id, production_run_id);
CREATE INDEX IF NOT EXISTS idx_staging_panoramas_production_run
    ON public.staging_panoramas(project_id, production_run_id);
CREATE INDEX IF NOT EXISTS idx_qaqc_audit_runs_production_run
    ON public.qaqc_audit_runs(project_id, production_run_id);

ALTER TABLE public.production_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_release_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_runs_select ON public.production_runs;
DROP POLICY IF EXISTS production_runs_insert ON public.production_runs;
DROP POLICY IF EXISTS production_runs_update ON public.production_runs;
DROP POLICY IF EXISTS production_runs_delete ON public.production_runs;
CREATE POLICY production_runs_select ON public.production_runs FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY production_runs_insert ON public.production_runs FOR INSERT WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY production_runs_update ON public.production_runs FOR UPDATE USING (sec.can('manageDatasets') OR sec.can('runQaqc')) WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY production_runs_delete ON public.production_runs FOR DELETE USING (sec.can('manageDatasets'));

DROP POLICY IF EXISTS production_run_attempts_select ON public.production_run_attempts;
DROP POLICY IF EXISTS production_run_attempts_insert ON public.production_run_attempts;
DROP POLICY IF EXISTS production_run_attempts_update ON public.production_run_attempts;
DROP POLICY IF EXISTS production_run_attempts_delete ON public.production_run_attempts;
CREATE POLICY production_run_attempts_select ON public.production_run_attempts FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY production_run_attempts_insert ON public.production_run_attempts FOR INSERT WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY production_run_attempts_update ON public.production_run_attempts FOR UPDATE USING (sec.can('manageDatasets') OR sec.can('runQaqc')) WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY production_run_attempts_delete ON public.production_run_attempts FOR DELETE USING (sec.can('manageDatasets'));

DROP POLICY IF EXISTS production_releases_select ON public.production_releases;
DROP POLICY IF EXISTS production_releases_insert ON public.production_releases;
DROP POLICY IF EXISTS production_releases_update ON public.production_releases;
DROP POLICY IF EXISTS production_releases_delete ON public.production_releases;
CREATE POLICY production_releases_select ON public.production_releases FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY production_releases_insert ON public.production_releases FOR INSERT WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY production_releases_update ON public.production_releases FOR UPDATE USING (sec.can('manageDatasets') OR sec.can('runQaqc')) WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY production_releases_delete ON public.production_releases FOR DELETE USING (sec.can('manageDatasets'));

DROP POLICY IF EXISTS production_release_files_select ON public.production_release_files;
DROP POLICY IF EXISTS production_release_files_insert ON public.production_release_files;
DROP POLICY IF EXISTS production_release_files_update ON public.production_release_files;
DROP POLICY IF EXISTS production_release_files_delete ON public.production_release_files;
CREATE POLICY production_release_files_select ON public.production_release_files FOR SELECT USING (sec.can('viewAll'));
CREATE POLICY production_release_files_insert ON public.production_release_files FOR INSERT WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY production_release_files_update ON public.production_release_files FOR UPDATE USING (sec.can('manageDatasets') OR sec.can('runQaqc')) WITH CHECK (sec.can('manageDatasets') OR sec.can('runQaqc'));
CREATE POLICY production_release_files_delete ON public.production_release_files FOR DELETE USING (sec.can('manageDatasets'));

DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.production_runs;
    EXCEPTION WHEN duplicate_object THEN
        NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.production_run_attempts;
    EXCEPTION WHEN duplicate_object THEN
        NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.production_releases;
    EXCEPTION WHEN duplicate_object THEN
        NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.production_release_files;
    EXCEPTION WHEN duplicate_object THEN
        NULL;
    END;
END $$;
