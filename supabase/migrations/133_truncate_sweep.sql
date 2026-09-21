-- ============================================================================
-- THE TRUNCATE SWEEP — migration 133
-- (task L.E1.17 of M6A, inserted by ruling — Chris 2026-09-21, reversing his
-- 2026-09-13 deferral; PROGRESS F349 / F348 / R998 / D350 / D367. Amends the
-- D18 -> D23 grant model that migration 037 versioned.)
--
-- WHAT WAS WRONG. 037 versioned production's grant model as `GRANT ALL ON
-- ALL TABLES ... TO anon, authenticated, service_role` plus the matching
-- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres`, on the doctrine "RLS is the
-- effective gate". RLS gates SELECT / INSERT / UPDATE / DELETE. It does NOT
-- gate TRUNCATE. Measured on a fresh local stack at the 132 head: 72
-- ordinary tables in `public`, 64 granting TRUNCATE to BOTH `anon` and
-- `authenticated`; the 8 that did not are exactly the ones 123 / 125-130
-- revoked one at a time under D350.
--
-- WHAT THIS DOES — two statements, both complete by construction:
--
--   1. `REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public` — every relation in
--      the schema, not a hand-typed list that can miss one. (It also sweeps
--      the one view and the one materialized view; TRUNCATE cannot run on
--      either, so that is tidiness, not protection.) PUBLIC is named for
--      parity with the house per-table form (123:410); it held nothing.
--
--   2. `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE
--      TRUNCATE ON TABLES` — the SOURCE. Measured, local AND hosted: every
--      `public` table is owned by `postgres`, every migration runs as
--      `postgres`, and the default ACL that re-grants TRUNCATE to a new
--      table is the per-schema `postgres` entry 037 wrote. The revoke
--      targets that same per-schema entry, so it takes effect (a per-schema
--      default cannot subtract from a GLOBAL one; this one is per-schema).
--
-- WHAT THIS CANNOT DO. `supabase_admin` carries an identical per-schema
-- default ACL (`anon=arwdDxtm/supabase_admin`, measured local and hosted).
-- `postgres` is not a superuser and is not a member of `supabase_admin`
-- (measured both), so `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` is
-- refused to a migration. It is inert for this repo — no table is owned by
-- `supabase_admin` and no migration runs as it — but a table created by a
-- path that runs as `supabase_admin` would still be born with the grant.
-- pgTAP 081's schema-wide cell is the enforcer for that case, and D350's
-- per-table REVOKE stays legal and harmless.
--
-- UNTOUCHED, deliberately: `service_role` and `postgres` keep TRUNCATE (in
-- the table ACLs and in the defaults). Every other privilege of every role
-- is untouched — REFERENCES / TRIGGER / MAINTAIN are measured and FILED
-- (F372), not changed here.
--
-- NOTHING LEGITIMATE USES IT (measured): no TRUNCATE is executed as `anon`
-- or `authenticated` anywhere in src/, scripts/, e2e/, supabase/seed.sql or
-- supabase/tests/ — the only executed TRUNCATE in the repo is pgTAP
-- 071:365, run as the OWNER against the audit log's statement trigger.
-- PostgREST exposes no TRUNCATE verb.
--
-- LOUD POSTCONDITION (CLAUDE.md "never let 'nothing happened' mean 'it
-- worked'"). A REVOKE of a grant made by a DIFFERENT grantor is a silent
-- no-op with a warning. Measured on hosted: every TRUNCATE grant's grantor is
-- `postgres`, so the revoke lands — but the DO block below re-measures and
-- RAISES, naming the tables, if any grant survived, rather than recording a
-- migration that did not do its job.
--
-- CHECKLIST (tasks-M* §4.4). No table, column, policy, trigger, function or
-- index. Grants only. R6/D38 waivers not needed (no DDL on a relation's
-- shape). Typegen: 0-line diff expected and measured. pgTAP 001's two
-- "all 8 privileges for all 3 roles" pins are RE-CUT in the same PR (they
-- pinned the defect): service_role keeps 8, anon/authenticated hold 7.
--
-- PRODUCTION IS NOT PROTECTED UNTIL CHRIS RUNS `npx supabase db push` — never
-- applied by hand (CLAUDE.md "Migration discipline"). He owes 125-132 plus
-- this file.
-- ============================================================================

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_left TEXT;
BEGIN
  SELECT string_agg(c.relname || ' <- ' || r.rolname, ', ' ORDER BY c.relname, r.rolname)
    INTO v_left
    FROM pg_catalog.pg_class c
    CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p')
     AND pg_catalog.has_table_privilege(r.rolname, c.oid, 'TRUNCATE');
  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION
      'migration 133: TRUNCATE survived the sweep on: % — a grant made by a grantor other than the migration role is not revoked by it; reconcile before re-pushing (F349)',
      v_left;
  END IF;
END;
$$;
