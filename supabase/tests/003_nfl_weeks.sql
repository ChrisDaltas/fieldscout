-- ============================================================================
-- nfl_weeks — migration 039 (spec §12.20; plan §8.1–8.2; task L.A0.5b item 4).
--
-- Falsifiability notes (2026-07-19 review standards):
--   * Read checks assert the 18 seeded rows and exact seeded instants
--     (results_eq on data — a policy rewritten to USING (false) fails here,
--     not just the policy-name pins; R7 lesson).
--   * INSERT with no policy raises 42501; UPDATE/DELETE with no policy are
--     silently filtered to 0 rows — so those deny-by-default tests count
--     affected rows via RETURNING (a permissive write policy would flip the
--     count to 18 and fail), rather than expecting an error that RLS never
--     raises.
--   * Seed spot checks pin the derivation: the published Wednesday opener
--     (week 1) and a post-DST week (week 9, EST) — a wrong offset or a
--     re-derived-from-bad-data seed fails on the exact instant.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

-- ---------------------------------------------------------------------------
-- Shape: §12.20 column-for-column, no additions, no omissions.
-- ---------------------------------------------------------------------------
select has_table('public', 'nfl_weeks', 'nfl_weeks exists');
select columns_are('public', 'nfl_weeks',
  array['season', 'week', 'starts_at', 'first_kickoff_at', 'last_game_ends_at', 'correction_window_ends_at'],
  'exact §12.20 column set');
select col_is_pk('public', 'nfl_weeks', array['season', 'week'], 'PK (season, week)');

-- ---------------------------------------------------------------------------
-- RLS surface: enabled; exactly one world-readable SELECT policy; no writes.
-- ---------------------------------------------------------------------------
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'nfl_weeks'),
  'RLS enabled on nfl_weeks');
select policies_are('public', 'nfl_weeks',
  array['nfl_weeks readable by everyone'],
  'exactly one policy — no write policies exist');
select policy_cmd_is('public', 'nfl_weeks', 'nfl_weeks readable by everyone', 'SELECT',
  'the one policy is SELECT-only');

-- ---------------------------------------------------------------------------
-- Seed integrity (service-role view, before role switching).
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select week from nfl_weeks where season = 2026 order by week $$,
  $$ select generate_series(1, 18) $$,
  '2026 seeded with exactly weeks 1..18');
select is_empty(
  $$ select week from nfl_weeks
     where correction_window_ends_at is null or correction_window_ends_at <= starts_at $$,
  'every week: starts_at < correction_window_ends_at, none null');
select is_empty(
  $$ select w.week from nfl_weeks w
     join nfl_weeks nxt on nxt.season = w.season and nxt.week = w.week + 1
     where nxt.starts_at <= w.starts_at $$,
  'starts_at strictly increasing across weeks');
select is_empty(
  $$ select week from nfl_weeks
     where first_kickoff_at is not null or last_game_ends_at is not null $$,
  'first_kickoff_at / last_game_ends_at NULL until nfl_games is written (Q1/D16)');
-- Derivation pins: published Wednesday opener; post-DST EST offset (week 9).
select results_eq(
  $$ select starts_at from nfl_weeks where season = 2026 and week = 1 $$,
  $$ values ('2026-09-09 00:00:00-04'::timestamptz) $$,
  'week 1 starts_at = Wed 2026-09-09 00:00 EDT (published opener day)');
select results_eq(
  $$ select starts_at, correction_window_ends_at from nfl_weeks where season = 2026 and week = 9 $$,
  $$ values ('2026-11-04 00:00:00-05'::timestamptz, '2026-11-12 06:00:00-05'::timestamptz) $$,
  'week 9 uses EST offsets (Nov 1 2026 DST fall-back handled)');

-- ---------------------------------------------------------------------------
-- anon: can read the seeded data; cannot write.
-- ---------------------------------------------------------------------------
set local role anon;
select results_eq(
  $$ select count(*) from nfl_weeks where season = 2026 $$,
  $$ values (18::bigint) $$,
  'anon SELECT sees all 18 seeded rows');
select throws_ok(
  $$ insert into nfl_weeks (season, week, starts_at) values (1999, 1, '1999-09-08 00:00:00-04') $$,
  '42501', null,
  'anon INSERT denied (no INSERT policy)');
select results_eq(
  $$ with u as (update nfl_weeks set week = week + 100 returning 1) select count(*) from u $$,
  $$ values (0::bigint) $$,
  'anon UPDATE affects zero rows (no UPDATE policy)');
select results_eq(
  $$ with d as (delete from nfl_weeks returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE affects zero rows (no DELETE policy)');
reset role;

-- ---------------------------------------------------------------------------
-- authenticated: same surface — read yes, write no.
-- ---------------------------------------------------------------------------
set local role authenticated;
select results_eq(
  $$ select count(*) from nfl_weeks where season = 2026 $$,
  $$ values (18::bigint) $$,
  'authenticated SELECT sees all 18 seeded rows');
select throws_ok(
  $$ insert into nfl_weeks (season, week, starts_at) values (1999, 2, '1999-09-15 00:00:00-04') $$,
  '42501', null,
  'authenticated INSERT denied (no INSERT policy)');
select results_eq(
  $$ with u as (update nfl_weeks set week = week + 100 returning 1)
     select count(*) from u $$,
  $$ values (0::bigint) $$,
  'authenticated UPDATE affects zero rows (no UPDATE policy)');
select results_eq(
  $$ with d as (delete from nfl_weeks returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'authenticated DELETE affects zero rows (no DELETE policy)');
reset role;

select * from finish();

rollback;
