-- ============================================================================
-- pgTAP: the identity contract after migration 075 — the username is the only
-- name the product renders; `profiles.full_name` is private (Chris's ruling,
-- 2026-08-05; spec-redraft-leagues §7.2 / changelog v2.9).
--
-- What this pins, all falsifiable against a partial revert of 075:
--   1. The columns landed under their new names, and the OLD names are gone
--      (a re-added `display_name` fails loudly rather than drifting back).
--   2. No function in `public` reads `display_name` any more — the universal
--      form, so a FUTURE function that reaches for it fails here.
--   3. The name-deriving RPCs render the HANDLE: a profile carrying a real
--      full_name produces "@username's Team" and '@username' actor lines,
--      never the real name. This is the behavioural half — (1) and (2) would
--      both pass if a function had been re-pointed at full_name instead.
--   4. handle_new_user still seeds full_name from the OAuth full_name claim
--      (semantically correct now that the field is private) while the 049/050
--      username guards stay in force (074).
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
RESET ROLE;

SELECT plan(10);

-- ---------------------------------------------------------------------------
-- 1. Column shape
-- ---------------------------------------------------------------------------
SELECT has_column('public', 'profiles', 'full_name',
  'profiles.full_name exists (renamed from display_name in 075)');
SELECT hasnt_column('public', 'profiles', 'display_name',
  'profiles.display_name is GONE — the concept is retired, not duplicated');
SELECT has_column('public', 'ai_personas', 'persona_name',
  'ai_personas.persona_name exists — the persona''s PUBLIC parody name');
SELECT hasnt_column('public', 'ai_personas', 'display_name',
  'ai_personas.display_name is GONE');

-- ---------------------------------------------------------------------------
-- 2. No function reads the retired column (universal — future-proof)
-- ---------------------------------------------------------------------------
SELECT is_empty(
  $$ SELECT p.proname::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosrc ILIKE '%display_name%' $$,
  'no function in public references display_name');

-- ---------------------------------------------------------------------------
-- 3. Behaviour: the derived names are handles, never the private full name
-- ---------------------------------------------------------------------------
-- A signed-up user carrying a REAL full name (exactly the OAuth case that
-- caused the ruling: Google supplies full_name, nothing else does).
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', '77000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-fn01@fieldscout.local', 'x', now(),
   '{"provider": "google", "providers": ["google"]}',
   '{"username": "fn_scout_01", "full_name": "Jason Jones"}',
   now(), now());

SELECT is(
  (SELECT full_name FROM profiles WHERE id = '77000000-0000-4000-8000-000000000001'),
  'Jason Jones',
  'handle_new_user seeds the PRIVATE full_name from the OAuth full_name claim (075: now semantically correct)');

SELECT is(
  (SELECT username FROM profiles WHERE id = '77000000-0000-4000-8000-000000000001'),
  'fn_scout_01',
  'the metadata handle is still honoured — 074''s username contract survives 075');

-- create_league's default franchise name (the ONE sanctioned writer, 060/075).
SELECT set_config('request.jwt.claims',
  '{"sub":"77000000-0000-4000-8000-000000000001","role":"authenticated","email":"pgtap-fn01@fieldscout.local"}',
  true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$ select public.create_league(
       'pgtap-fn-league', 2026, 8, '{}'::jsonb, '{"bench": 6}'::jsonb,
       (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
       null, 'ac000000-0000-4000-8000-0000000000f1',
       'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'the full-name-carrying user can create a league');

-- draft_actor_name reads auth.uid() — assert it while still signed in.
SELECT is(
  draft_actor_name(),
  '@fn_scout_01',
  'draft_actor_name renders the handle — a chat/system post never carries the private full name (Jason Jones)');

RESET ROLE;

SELECT is(
  (SELECT t.name FROM teams t JOIN leagues l ON l.id = t.league_id
   WHERE l.creation_action_id = 'ac000000-0000-4000-8000-0000000000f1'),
  'fn_scout_01''s Team',
  'create_league derives "<username>''s Team" — the private full name never reaches a franchise label');

SELECT * FROM finish();
ROLLBACK;
