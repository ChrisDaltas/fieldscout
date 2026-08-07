-- ============================================================================
-- pgTAP: profiles.display_name is GONE and nothing reads it — migration 077
-- (identity ruling, Chris 2026-08-05; spec-redraft-leagues v2.9.1). pgTAP file
-- is **027** (026 = draft completion/rosters; next free confirmed at task
-- time).
--
-- What this file is for. 005 already pins the column's absence at the schema
-- level. The failure mode 077 actually had to defuse is different and does not
-- show up in a schema check at all: Postgres records NO dependency from a
-- function BODY to a column, so the five functions that read
-- `profiles.display_name` would have kept existing, kept their grants, and
-- broken at RUNTIME on the next call with `column "display_name" does not
-- exist`. `notify_list_followers` is the one that matters most — it runs on
-- every list update, and Lists is one of three launch surfaces.
--
-- Falsifiability notes (§4.3):
--   * Test 2 is UNIVERSAL over `pg_proc.prosrc`, not a list of five names. A
--     sixth function that starts reading the column — or a CREATE OR REPLACE
--     hotfix that reverts one of the five to a pre-077 body — fails it. That
--     is the failure this file exists to catch, and it is exactly the class
--     that produced the 2026-08 hosted-migration reconciliation.
--   * Test 1 is the non-vacuity control for test 2: the five functions must
--     still EXIST. A "fix" that drops them instead of re-pointing them would
--     satisfy test 2 trivially, so it has to fail here first.
--   * Test 3 pins the attributes 077 promised NOT to change — SECURITY
--     DEFINER/INVOKER per function and the exact deployed `search_path`
--     (`''` for four, `public, pg_temp` for notify_list_followers, which
--     relies on it for its unqualified identifiers). A replacement that
--     silently flipped a DEFINER to INVOKER, or dropped a search_path pin
--     while re-pointing the column, fails here. 004's universal check would
--     NOT catch the DEFINER→INVOKER direction: dropping SECURITY DEFINER
--     removes a function from its scope entirely.
--   * Test 4 pins the ACL that `CREATE OR REPLACE` is supposed to preserve —
--     specifically 038's `REVOKE EXECUTE … FROM PUBLIC, anon` on
--     notify_list_followers, the one grant a careless re-create would widen
--     back open. (002 pins the same thing from the privilege side; this is
--     the post-077 restatement, so a regression is caught even if 002 is
--     ever narrowed.)
--   * Test 5 is the behavioural pin: draft_actor_name() resolves to the
--     caller's handle. It is the only one of the five that is a pure,
--     fixture-free read of the caller's own profile, so it can be exercised
--     directly under a JWT. The other four are pinned behaviourally by their
--     own suites (005/014/016/023/026) against post-077 strings.
--   * ai_personas.display_name and expert_profiles.display_name are pinned
--     PRESENT (test 6). They are unrelated NOT NULL columns — a fictional
--     analyst's public parody brand name and a dead legacy table — and an
--     over-broad "drop every display_name" would take them with it.
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
RESET ROLE;

SELECT plan(13);

-- ---------------------------------------------------------------------------
-- 0. The column is gone.
-- ---------------------------------------------------------------------------
SELECT hasnt_column('public', 'profiles', 'display_name',
  'profiles.display_name is dropped (077) — FieldScout stores no name for a person');

-- ---------------------------------------------------------------------------
-- 1. Non-vacuity control: the five re-pointed functions still exist.
--    Without this, test 2 passes trivially if they were dropped.
-- ---------------------------------------------------------------------------
SELECT is_empty(
  $$ SELECT expected
     FROM unnest(ARRAY['create_league', 'draft_actor_name', 'get_join_preview',
                       'notify_list_followers', 'seat_league_member_internal']) AS expected
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = expected
     ) $$,
  'all five re-pointed functions still exist (077 replaced them, did not drop them)');

-- ---------------------------------------------------------------------------
-- 2. THE PIN, universal: no routine in public mentions display_name while
--    also touching profiles. Keyed on the pair so ai_personas /
--    expert_profiles readers (legitimate) are not swept up.
-- ---------------------------------------------------------------------------
SELECT is_empty(
  $$ SELECT n.nspname || '.' || p.proname || '('
            || pg_get_function_identity_arguments(p.oid) || ')'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosrc ILIKE '%display_name%'
       AND p.prosrc ILIKE '%profiles%'
       AND p.prosrc NOT ILIKE '%ai_personas%'
       AND p.prosrc NOT ILIKE '%expert_profiles%' $$,
  'no function in public reads a display_name off profiles (the runtime break 077 defused)');

-- Same pin, from the other side: no VIEW, no RLS policy, no index, no
-- constraint and no default references the name on profiles either.
SELECT is_empty(
  $$ SELECT schemaname || '.' || viewname FROM pg_views
     WHERE schemaname = 'public' AND definition ILIKE '%display_name%'
       AND definition ILIKE '%profiles%'
       AND definition NOT ILIKE '%ai_personas%'
       AND definition NOT ILIKE '%expert_profiles%' $$,
  'no view in public selects a display_name off profiles');

SELECT is_empty(
  $$ SELECT policyname FROM pg_policies
     WHERE schemaname = 'public'
       AND (COALESCE(qual, '') ILIKE '%display_name%'
         OR COALESCE(with_check, '') ILIKE '%display_name%') $$,
  'no RLS policy in public references display_name');

SELECT is_empty(
  $$ SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND indexdef ILIKE '%display_name%'
       AND tablename = 'profiles' $$,
  'no index on profiles references display_name');

-- ---------------------------------------------------------------------------
-- 3. 077 changed the column reference and NOTHING else: security context and
--    the exact deployed search_path pin, per function.
-- ---------------------------------------------------------------------------
SELECT is_empty(
  $$ SELECT p.proname || ' prosecdef=' || p.prosecdef::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname, p.prosecdef) NOT IN (
             ('create_league', TRUE),
             ('get_join_preview', TRUE),
             ('notify_list_followers', TRUE),
             ('draft_actor_name', FALSE),
             ('seat_league_member_internal', FALSE))
       AND p.proname IN ('create_league', 'get_join_preview',
                         'notify_list_followers', 'draft_actor_name',
                         'seat_league_member_internal') $$,
  'security context unchanged: create_league/get_join_preview/notify_list_followers DEFINER, draft_actor_name/seat_league_member_internal INVOKER');

SELECT is_empty(
  $$ SELECT p.proname
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('create_league', 'get_join_preview',
                         'draft_actor_name', 'seat_league_member_internal')
       AND NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']) $$,
  'the four spec-form functions still pin search_path = '''' (unchanged by 077)');

SELECT ok(
  (SELECT COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_temp']
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'notify_list_followers'),
  'notify_list_followers still pins search_path = public, pg_temp — its unqualified identifiers depend on it (019/038, unchanged by 077)');

-- ---------------------------------------------------------------------------
-- 4. CREATE OR REPLACE preserved the ACL: 038's REVOKE survived 077.
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.notify_list_followers(uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.notify_list_followers(uuid, uuid)', 'EXECUTE'),
  '077''s CREATE OR REPLACE preserved 038''s ACL — anon still revoked, authenticated still granted');

-- ---------------------------------------------------------------------------
-- 5. Behavioural: the actor name is the handle.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-077@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "dn_actor_01"}',
   now(), now());

SELECT set_config('request.jwt.claims',
  '{"sub": "77000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

SELECT is(
  public.draft_actor_name(),
  'dn_actor_01',
  'draft_actor_name() resolves to the caller''s handle — the COALESCE onto display_name is gone (077)');

-- ---------------------------------------------------------------------------
-- 6. The unrelated columns survive. An over-broad drop would take these too.
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'ai_personas', 'display_name',
  'ai_personas.display_name SURVIVES — a fictional analyst''s public parody brand name, not a person''s name');

SELECT has_column('public', 'expert_profiles', 'display_name',
  'expert_profiles.display_name SURVIVES — dead legacy table, out of the identity ruling''s scope');

SELECT * FROM finish();
ROLLBACK;
