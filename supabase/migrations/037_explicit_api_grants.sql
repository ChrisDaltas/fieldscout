-- ============================================================================
-- Explicit API-role grants — L.A0.5c (resolves PROGRESS decision D18).
--
-- The hosted FieldScout project was provisioned under Supabase's legacy grant
-- model: anon/authenticated/service_role hold ALL privileges on every public
-- table, and postgres-owned default ACLs auto-grant the same to future
-- tables/sequences/functions (verified 2026-07-19 against production
-- pg_default_acl and information_schema.role_table_grants — all 36 tables).
-- RLS is the effective gate (spec §12); grants are deliberately broad.
--
-- Locally the CLI's deprecated auto_expose_new_tables flag emulated that
-- model; the flag is removed from the CLI on 2026-10-30. This migration makes
-- the grant model explicit and versioned instead: replaying the chain in any
-- environment (local reset, or a future re-provisioned hosted project on the
-- new no-auto-grant default) lands on production's exact model.
--
-- Future migrations therefore need NO per-object GRANT statements; the
-- security surface for new tables remains RLS, proven per-table by pgTAP
-- (plan §8.1–8.2). Any deliberate narrowing (e.g. an internal service-role-
-- only function) must be an explicit REVOKE in that migration.
-- ============================================================================

-- Schema usage (already held everywhere; idempotent).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Catch-up for the existing 001–036 surface (no-op in production, which
-- already holds these; restores them on a fresh local reset).
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

-- Future objects: reproduce production's postgres-owned default ACLs
-- (tables arwdDxtm / sequences rwU / functions X, per pg_default_acl).
-- Migrations run as postgres both locally and via db push, so every object
-- created by a later migration picks these up.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
