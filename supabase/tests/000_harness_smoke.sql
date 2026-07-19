-- ============================================================================
-- pgTAP harness smoke test — L.A0.5a (M0 breakdown D9; delivery plan §8.2).
--
-- Proves the harness itself against an EXISTING table's policy — no new
-- schema is tested here (M0's nfl_weeks pgTAP lands with migration 037 in
-- L.A0.5b). Target: player_stats — world-readable via "Stats are viewable
-- by everyone" (migration 005), no write policies (service-role managed,
-- §8.2 deny-by-default).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

select has_table('public', 'player_stats', 'player_stats table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.player_stats'::regclass),
  'RLS is enabled on player_stats (001)'
);

select policies_are(
  'public', 'player_stats',
  array['Stats are viewable by everyone'],
  'player_stats has exactly the world-readable SELECT policy (005)'
);

select policy_cmd_is(
  'public', 'player_stats', 'Stats are viewable by everyone', 'SELECT',
  'the policy covers SELECT only — writes stay service-role (§8.2)'
);

-- Behavioral half: the policy actually admits reads and denies writes.
set local role anon;

select lives_ok(
  $$ select count(*) from public.player_stats $$,
  'anon can SELECT player_stats'
);

select throws_ok(
  $$ insert into public.player_stats (season) values (2026) $$,
  '42501',
  null,
  'anon INSERT into player_stats is denied (no write policy)'
);

reset role;

select * from finish();

rollback;
