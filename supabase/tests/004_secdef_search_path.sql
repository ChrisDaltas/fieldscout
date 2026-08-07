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

SELECT plan(4);

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

-- 2. The seven each pin search_path to one of the two SANCTIONED forms — the
--    048 legacy convention `public, pg_temp`, or the stricter spec form `''`
--    (plan §8.3 / spec §12.0). Falsifiable against a partial 048 revert, an
--    unpinned function, or a proconfig typo: anything that is neither exact
--    string fails.
--
--    This originally demanded `public, pg_temp` from all seven, contradicting
--    this file's own header. It went red when 073 moved handle_new_user to
--    `''` while fixing a production signup outage — the STRICTER pin, and the
--    one the house rules mandate for SECURITY DEFINER work. A test that fails
--    when a function is hardened is testing the wrong thing, and a
--    permanently-red test hides the next real regression.
SELECT is_empty(
  $$ SELECT p.proname::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('handle_new_user', 'update_follow_counts',
                         'update_list_player_count', 'update_tag_use_count',
                         'update_expert_follower_count', 'update_list_like_count',
                         'reorder_list_players')
       AND NOT (
            COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_temp']
         OR COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']
       ) $$,
  'all seven C15 functions pin search_path (public, pg_temp — or the stricter '''')');

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
