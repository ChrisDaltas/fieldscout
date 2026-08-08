-- ============================================================================
-- 078: expose the applied migration list to the drift check
-- ============================================================================
-- The CI drift job compares production's applied migrations against the repo
-- (.github/workflows/db-drift.yml). Reading supabase_migrations.schema_migrations
-- normally means a direct Postgres connection, which needs the database
-- password AND the region-specific pooler hostname — two things that are
-- awkward to obtain and easy to get subtly wrong.
--
-- This wrapper lets the job read the same list over plain HTTPS with the
-- service-role key: one string, from the same dashboard page as the keys
-- already in Vercel. PostgREST only exposes `public`, hence the wrapper.
--
-- SECURITY: read-only, returns nothing but version strings, and EXECUTE is
-- revoked from anon and authenticated — only the service role (which never
-- reaches a browser) can call it. Migration history is not sensitive, but
-- there is no reason to publish it either.
--
-- Numbered 078 so it lands after 077's column drop; it touches no table.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.applied_migration_versions()
RETURNS TABLE (version TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT m.version::text
  FROM supabase_migrations.schema_migrations m
  ORDER BY m.version;
$$;

COMMENT ON FUNCTION public.applied_migration_versions() IS
  'Applied migration versions, for the CI drift check. Read-only; '
  'service-role only (EXECUTE revoked from anon and authenticated).';

REVOKE EXECUTE ON FUNCTION public.applied_migration_versions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.applied_migration_versions() TO service_role;
