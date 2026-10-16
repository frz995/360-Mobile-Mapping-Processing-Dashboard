-- Migration: 0039_panoramas_view_organization_id.sql
-- Description: Refresh public.panoramas_view to include organization_id and all current columns of public.panoramas

DO $view$
DECLARE
    v_cols text;
    v_where text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'panoramas') THEN
        RAISE NOTICE 'panoramas_view skipped: public.panoramas does not exist';
        RETURN;
    END IF;

    DROP VIEW IF EXISTS public.panoramas_view CASCADE;

    SELECT string_agg('p.' || quote_ident(column_name) || ' AS ' || quote_ident(column_name), E',\n' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'panoramas'
      AND column_name NOT IN ('lat', 'lon');

    IF v_cols IS NULL OR v_cols = '' THEN
        RAISE NOTICE 'panoramas_view skipped: panoramas has no columns';
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'panoramas' AND column_name = 'latitude') THEN
        v_cols := v_cols || E',\n' || 'p.latitude AS lat';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'panoramas' AND column_name = 'longitude') THEN
        v_cols := v_cols || E',\n' || 'p.longitude AS lon';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'panoramas' AND column_name = 'status')
       AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'panoramas' AND column_name = 'qa_status') THEN
        v_where := 'p.status = ''yes'' OR p.qa_status = ''published''';
    ELSE
        v_where := 'true';
    END IF;

    EXECUTE 'CREATE VIEW public.panoramas_view WITH (security_invoker = true) AS '
            || 'SELECT ' || v_cols || ' FROM public.panoramas p WHERE ' || v_where;

    EXECUTE 'GRANT SELECT ON public.panoramas_view TO anon, authenticated, service_role';
END;
$view$;
