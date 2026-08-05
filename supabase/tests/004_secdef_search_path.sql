-- ============================================================================
-- pgTAP: every SECURITY DEFINER function in public pins search_path — C15
-- (migration 048). Universal by design: a FUTURE search_path-less SECURITY
-- DEFINER function anywhere in public fails test 4 loudly, not just the seven
-- 048 fixed.
--
-- "Pins search_path" = proconfig carries a `search_path=...` entry. Both repo
-- forms pass: the legacy-app convention `public, pg_temp` (017–038, 048) and
-- the spec form `''` (plan §8.3 / spec §12.0) that every M1+ league RPC uses.
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
RESET ROLE;

SELECT plan(5);

-- 1. Witness: the seven C15 functions exist and are still SECURITY DEFINER.
--    Guards test 4 against a "fix" that drops SECURITY DEFINER instead of
--    pinning search_path (which would fall out of test 4's scope silently).
SELECT is_empty(
  $$ SELECT expected
     FROM unnest(ARRAY['handle_new_user', 'update_follow_counts',
                       'update_list_player_count', 'update_tag_use_count',
                       'update_expert_follower_count', 'update_list_like_count',
                       'reorder_list_players']) AS expected
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef AND p.proname = expected
     ) $$,
  'the seven C15 functions exist and are SECURITY DEFINER');

-- 2. SIX of the seven carry exactly the 048 pin (public, pg_temp) —
--    falsifiable against a partial 048 revert or a proconfig typo.
--    handle_new_user is deliberately EXCLUDED here and pinned at its own
--    stricter form in test 2b: migration 073 moved it to the spec form ''
--    (+ full schema qualification) because GoTrue's minimal search_path made
--    the unqualified body fail on every real Auth signup. Splitting the
--    assertion keeps both forms pinned exactly, rather than loosening this
--    one to "any value" (test 4 already owns the any-value floor).
SELECT is_empty(
  $$ SELECT p.proname::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('update_follow_counts',
                         'update_list_player_count', 'update_tag_use_count',
                         'update_expert_follower_count', 'update_list_like_count',
                         'reorder_list_players')
       AND NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_temp']) $$,
  'the six legacy-convention C15 functions carry SET search_path = public, pg_temp');

-- 2b. handle_new_user carries the SPEC form '' (073/074). Pinned exactly, so
--     a revert to the unqualified `public, pg_temp` body — which is what broke
--     production signups — fails here loudly instead of passing test 4's floor.
SELECT ok(
  (SELECT COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'),
  'handle_new_user carries SET search_path = '''' (073 — GoTrue signup fix)');

-- 3. Non-vacuity: public holds a meaningful SECURITY DEFINER population, so
--    test 4's empty result means "all pinned", never "nothing matched".
--    12 = the seven C15 functions + enforce_free_list_caps (018/028) +
--    notify_list_followers (019/038) + the three 025/026 guard triggers.
SELECT cmp_ok(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef),
  '>=', 12::bigint,
  'public has >= 12 SECURITY DEFINER functions (universal check is not vacuous)');

-- 4. THE PIN: no SECURITY DEFINER function in public lacks a search_path
--    proconfig entry. Any value passes (incl. the spec form ''); absence fails.
SELECT is_empty(
  $$ SELECT n.nspname || '.' || p.proname || '('
            || pg_get_function_identity_arguments(p.oid) || ')'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef
       AND NOT EXISTS (
         SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
         WHERE cfg LIKE 'search_path=%'
       ) $$,
  'every SECURITY DEFINER function in public sets an explicit search_path');

SELECT * FROM finish();
ROLLBACK;
