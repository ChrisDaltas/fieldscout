-- ============================================================================
-- league_player_values — pgTAP 085 (M6A task L.E1.20; migration 137;
-- PROGRESS Q62 RULED / F379 second third / D374; spec v2.16.45 §12.28 + §14;
-- tasks-M6A §4 rules 1–15 — rule 3 (the no-write-policy pattern per role with
-- RETURNING counts), rule 14(c) (premises asserted by value), rule 15).
--
-- Numbering: pgTAP head measured 084 at task time (`ls supabase/tests/ |
-- tail -1`) ⇒ 085 (D161).
--
-- What this pins:
--   §A FORM — the table, its exact columns, the (league, season, week,
--      player) PK, the three FKs (leagues / players ON DELETE CASCADE;
--      (season, week) → nfl_weeks), NUMERIC(8,2) points, NOT NULL where
--      stated, NO default on computed_at, RLS ON with EXACTLY one policy
--      (SELECT, TO authenticated, member-scoped).
--   §B THE CHECKS, each beside a success twin: a missing value always NAMES
--      why and a value never carries a reason; the reason vocabularies; the
--      unscored list iff a value; the fetch instant iff a line; and NULL IS
--      NOT ZERO — season_points NULL ⇔ season_games = 0 (a 0.00 with no
--      games, or a NULL with games, is refused).
--   §C THE ROLE WALK (RETURNING counts): anon reads 0 rows and writes
--      nothing; an authenticated NON-member reads 0 rows (member-readable,
--      not public) and writes nothing; a LEAGUE MEMBER reads the league's rows
--      and writes nothing (INSERT 42501, UPDATE / DELETE 0 rows); the rows are
--      byte-identical after the walk. service_role — the job's writer —
--      INSERTs, UPDATEs and DELETEs (the positive half).
--   §D TRUNCATE per role via has_table_privilege (081 §A's shape).
--   §E THE SCHEDULE: exactly one pg_cron row, the literal schedule +
--      command, idempotent re-run, the neighbouring jobs untouched.
--   §F ON DELETE CASCADE from leagues and players.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';

select plan(65);

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select has_table('public', 'league_player_values', 'A1 league_player_values exists (137)');
select columns_are('public', 'league_player_values',
  array['league_id', 'season', 'week', 'player_id', 'projected_points', 'projected_missing', 'projected_unscored',
        'projection_fetched_at', 'season_points', 'season_games', 'preseason_points', 'preseason_missing',
        'preseason_unscored', 'computed_at'],
  'A2 exact column set');
select col_is_pk('public', 'league_player_values', array['league_id', 'season', 'week', 'player_id'],
  'A3 PK = (league_id, season, week, player_id) — one value row per player per league-week');
select fk_ok('public', 'league_player_values', 'league_id', 'public', 'leagues', 'id', 'A4 league_id → leagues(id)');
select fk_ok('public', 'league_player_values', 'player_id', 'public', 'players', 'id', 'A5 player_id → players(id)');
select fk_ok('public', 'league_player_values', array['season', 'week'], 'public', 'nfl_weeks', array['season', 'week'],
  'A6 (season, week) → nfl_weeks — the calendar decides which weeks exist (§23.3)');
select is(
  (select string_agg(confdeltype::text, ',' order by conname) from pg_constraint
    where conname in ('league_player_values_league_id_fkey', 'league_player_values_player_id_fkey')),
  'c,c', 'A7 the leagues and players FKs are ON DELETE CASCADE');
select is(
  (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.league_player_values'::regclass and a.attname like '%_points'),
  'preseason_points numeric(8,2), projected_points numeric(8,2), season_points numeric(8,2)',
  'A8 every points column is NUMERIC(8,2) — §7.3.3''s stored precision');
select ok(
  (select bool_and(a.attnotnull) from pg_attribute a
    where a.attrelid = 'public.league_player_values'::regclass
      and a.attname in ('league_id', 'season', 'week', 'player_id', 'season_games', 'computed_at')),
  'A9 league_id, season, week, player_id, season_games, computed_at are NOT NULL');
select col_hasnt_default('public', 'league_player_values', 'computed_at',
  'A10 computed_at has NO default — the job stamps its TimeProvider instant, never the database clock');
select ok((select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'league_player_values'),
  'A11 RLS is ON');
select policies_are('public', 'league_player_values',
  array['League player values viewable by league members'],
  'A12 exactly ONE policy — no write policy for any role');
select is(
  (select cmd || ' TO ' || array_to_string(roles, ',') || ' USING ' || qual from pg_policies
    where schemaname = 'public' and tablename = 'league_player_values'),
  'SELECT TO authenticated USING is_league_member(league_id)',
  'A13 …and it is SELECT, TO authenticated, scoped by is_league_member (member-readable, task text item (1))');

-- ---------------------------------------------------------------------------
-- Fixture (as postgres). Premises by value (rule 14(c)).
-- ---------------------------------------------------------------------------
insert into players (id, full_name, position, team) values
  ('q85-rb', 'Q85 Runner', 'RB', 'DET'),
  ('q85-wr', 'Q85 Receiver', 'WR', 'SEA'),
  ('q85-gone', 'Q85 Departed', 'TE', 'KC');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('98500000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-q85-' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       json_build_object('username', 'q85_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id,
                     scoring_rules_snapshot, lineup_lock, waiver_type, settings, roster_settings) values
 ('b8500000-0000-4000-8000-000000000001', '98500000-0000-4000-8000-000000000001', 'pgtap-q85-L1', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'Scout Standard'),
  (select rules from scoring_systems where is_template and name = 'Scout Standard'),
  'per_player_kickoff', 'faab', '{}'::jsonb, '{}'::jsonb);
insert into teams (id, owner_id, name, league_id, status) values
 ('c8500000-0000-4000-8000-000000000001', '98500000-0000-4000-8000-000000000001', 'Q85 Team', 'b8500000-0000-4000-8000-000000000001', 'active');
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
 ('b8500000-0000-4000-8000-000000000001', '98500000-0000-4000-8000-000000000001', 'c8500000-0000-4000-8000-000000000001', 'commissioner', false);

insert into league_player_values (league_id, season, week, player_id, projected_points, projected_missing, projected_unscored,
                                  projection_fetched_at, season_points, season_games, preseason_points, preseason_missing,
                                  preseason_unscored, computed_at) values
  ('b8500000-0000-4000-8000-000000000001', 2026, 4, 'q85-rb', 23.17, null, '{fumble_recovery_td,return_td}',
   '2026-09-27 12:40:00+00', 41.30, 3, null, 'no_line', null, '2026-09-27 12:50:00+00'),
  ('b8500000-0000-4000-8000-000000000001', 2026, 4, 'q85-wr', null, 'no_line', null,
   null, null, 0, 110.00, null, '{pass_2pt}', '2026-09-27 12:50:00+00');

select is((select count(*)::int from league_player_values where player_id like 'q85-%'), 2,
  'PREMISE: two planted value rows (as postgres)');
select is((select week from nfl_weeks where season = 2026 and week = 4), 4,
  'PREMISE: 2026 week 4 is in the calendar (039''s seed)');
select is((select count(*)::int from nfl_weeks where season = 2026 and week = 19), 0,
  'PREMISE: 2026 week 19 is NOT in the calendar (§B12 depends on it)');

-- ---------------------------------------------------------------------------
-- B. The checks, each with its success twin
-- ---------------------------------------------------------------------------
-- A tiny helper: insert one row for q85-gone at week 5 with the given shape.
create function pg_temp.q85_ins(p_proj numeric, p_pmiss text, p_punsc text[], p_fetched timestamptz,
                                p_season numeric, p_games int, p_pre numeric, p_premiss text, p_preunsc text[],
                                p_week int default 5)
returns void language sql as $fn$
  insert into public.league_player_values values
    ('b8500000-0000-4000-8000-000000000001', 2026, p_week, 'q85-gone', p_proj, p_pmiss, p_punsc, p_fetched,
     p_season, p_games, p_pre, p_premiss, p_preunsc, '2026-09-27 12:50:00+00');
$fn$;

select throws_ok($$ select pg_temp.q85_ins(null, null, null, '2026-09-27 12:40+00', null, 0, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_projected_named"', 'B1 a missing projected value MUST name why (NULL points, NULL reason → 23514)');
select throws_ok($$ select pg_temp.q85_ins(9.5, 'stale_line', '{}', '2026-09-27 12:40+00', null, 0, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_projected_named"', 'B2 a projected VALUE never carries a reason (23514)');
select throws_ok($$ select pg_temp.q85_ins(null, 'gone', null, '2026-09-27 12:40+00', null, 0, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_projected_missing_vocab"', 'B3 the projected reason vocabulary is no_line | stale_line (23514)');
select throws_ok($$ select pg_temp.q85_ins(null, 'no_line', '{}', null, null, 0, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_projected_unscored_iff_value"', 'B4 an unscored list without a projected value is refused (23514)');
select throws_ok($$ select pg_temp.q85_ins(9.5, null, null, '2026-09-27 12:40+00', null, 0, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_projected_unscored_iff_value"', 'B5 a projected value WITHOUT its unscored list is refused (23514) — the under-count is always named');
select throws_ok($$ select pg_temp.q85_ins(null, 'no_line', null, '2026-09-27 12:40+00', null, 0, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_fetched_iff_line"', 'B6 "no_line" carries no fetch instant (23514)');
select throws_ok($$ select pg_temp.q85_ins(9.5, null, '{}', null, null, 0, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_fetched_iff_line"', 'B7 a scored line carries its fetch instant (23514) — the read at lock bounds it (F387)');
select lives_ok($$ select pg_temp.q85_ins(null, 'stale_line', null, '2026-09-27 06:00+00', null, 0, null, 'no_line', null) $$,
  'B7b …its twin: a STALE line is NULL, named, and keeps its fetch instant');
delete from league_player_values where player_id = 'q85-gone';
select throws_ok($$ select pg_temp.q85_ins(null, 'no_line', null, null, 0, 0, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_season_null_iff_no_games"', 'B8 NULL IS NOT ZERO: a 0.00 season with 0 games is refused (23514) — no games is NULL');
select throws_ok($$ select pg_temp.q85_ins(null, 'no_line', null, null, null, 2, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_season_null_iff_no_games"', 'B9 …and a NULL season with games played is refused (23514)');
select lives_ok($$ select pg_temp.q85_ins(null, 'no_line', null, null, 0, 1, null, 'no_line', null) $$,
  'B9b …its twin: a REAL 0.00 with one game lives');
delete from league_player_values where player_id = 'q85-gone';
select throws_ok($$ select pg_temp.q85_ins(null, 'no_line', null, null, 1, -1, null, 'no_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_season_games_nonneg"', 'B10 season_games is never negative (23514)');
select throws_ok($$ select pg_temp.q85_ins(null, 'no_line', null, null, null, 0, null, null, null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_preseason_named"', 'B11 a missing preseason value MUST name why (23514)');
select throws_ok($$ select pg_temp.q85_ins(null, 'no_line', null, null, null, 0, null, 'stale_line', null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_preseason_missing_vocab"', 'B11b the preseason reason vocabulary is no_line | other_season (23514)');
select throws_ok($$ select pg_temp.q85_ins(null, 'no_line', null, null, null, 0, 80, null, null) $$,
  '23514', 'new row for relation "league_player_values" violates check constraint "league_player_values_preseason_unscored_iff_value"', 'B11c a preseason value WITHOUT its unscored list is refused (23514)');
select lives_ok($$ select pg_temp.q85_ins(null, 'no_line', null, null, null, 0, null, 'other_season', null) $$,
  'B11d …its twin: another season''s line is NULL and named');
delete from league_player_values where player_id = 'q85-gone';
select throws_ok($$ select pg_temp.q85_ins(null, 'no_line', null, null, null, 0, null, 'no_line', null, 19) $$,
  '23503', null, 'B12 a week the calendar does not know is unstorable (23503 — the nfl_weeks FK)');
select throws_ok(
  $$ insert into league_player_values (league_id, season, week, player_id, projected_missing, season_games, preseason_missing)
     values ('b8500000-0000-4000-8000-000000000001', 2026, 5, 'q85-gone', 'no_line', 0, 'no_line') $$,
  '23502', null, 'B13 omitting computed_at is refused (23502) — no default stamps the database clock');

-- ---------------------------------------------------------------------------
-- C. The role walk — RETURNING counts (§4.2)
-- ---------------------------------------------------------------------------
create temp table q85_before as
  select * from league_player_values where player_id like 'q85-%';
grant select on q85_before to anon, authenticated, service_role;

-- anon
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from league_player_values where player_id like 'q85-%'), 0,
  'C1 ANON reads ZERO rows');
select throws_ok(
  $$ insert into league_player_values (league_id, season, week, player_id, projected_missing, season_games, preseason_missing, computed_at)
     values ('b8500000-0000-4000-8000-000000000001', 2026, 4, 'q85-gone', 'no_line', 0, 'no_line', now()) $$,
  '42501', null, 'C2 ANON cannot INSERT (42501)');
select results_eq(
  $$ with u as (update league_player_values set season_games = season_games where player_id like 'q85-%' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'C3 ANON UPDATE touches 0 rows');
select results_eq(
  $$ with d as (delete from league_player_values where player_id like 'q85-%' returning 1) select count(*)::int from d $$,
  $$ values (0) $$, 'C4 ANON DELETE touches 0 rows');
reset role;

-- authenticated, NOT a member of the league
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "98500000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(public.is_league_member('b8500000-0000-4000-8000-000000000001'), false,
  'C5 PREMISE: this caller is NOT a member of the league');
select is((select count(*)::int from league_player_values where player_id like 'q85-%'), 0,
  'C6 an AUTHENTICATED NON-member reads ZERO rows — member-readable, not public');
select throws_ok(
  $$ insert into league_player_values (league_id, season, week, player_id, projected_missing, season_games, preseason_missing, computed_at)
     values ('b8500000-0000-4000-8000-000000000001', 2026, 4, 'q85-gone', 'no_line', 0, 'no_line', now()) $$,
  '42501', null, 'C7 …cannot INSERT (42501)');
select results_eq(
  $$ with u as (update league_player_values set season_games = season_games where player_id like 'q85-%' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'C8 …UPDATE touches 0 rows');
select results_eq(
  $$ with d as (delete from league_player_values where player_id like 'q85-%' returning 1) select count(*)::int from d $$,
  $$ values (0) $$, 'C9 …DELETE touches 0 rows');

-- a LEAGUE MEMBER (the commissioner)
select set_config('request.jwt.claims', '{"sub": "98500000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(public.is_league_member('b8500000-0000-4000-8000-000000000001'), true,
  'C10 PREMISE: this caller IS a member (the commissioner) of the league');
select is((select count(*)::int from league_player_values where player_id like 'q85-%'), 2,
  'C11 a LEAGUE MEMBER reads the league''s two rows');
select throws_ok(
  $$ insert into league_player_values (league_id, season, week, player_id, projected_missing, season_games, preseason_missing, computed_at)
     values ('b8500000-0000-4000-8000-000000000001', 2026, 4, 'q85-gone', 'no_line', 0, 'no_line', now()) $$,
  '42501', null, 'C12 …cannot INSERT (42501) — membership, even the commissioner''s, grants no write');
select results_eq(
  $$ with u as (update league_player_values set projected_points = 99, season_games = season_games where player_id like 'q85-%' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'C13 …UPDATE touches 0 rows (a member cannot move autopilot''s sort)');
select results_eq(
  $$ with d as (delete from league_player_values where player_id like 'q85-%' returning 1) select count(*)::int from d $$,
  $$ values (0) $$, 'C14 …DELETE touches 0 rows');
reset role;
select set_config('request.jwt.claims', '', true);

select set_eq(
  $$ select * from league_player_values where player_id like 'q85-%' $$,
  $$ select * from q85_before $$,
  'C15 the rows are BYTE-IDENTICAL after the three client walks');

-- service_role — the job's writer (the positive half)
set local role service_role;
select results_eq(
  $$ with i as (insert into league_player_values (league_id, season, week, player_id, projected_missing, season_games, preseason_missing, computed_at)
       values ('b8500000-0000-4000-8000-000000000001', 2026, 4, 'q85-gone', 'no_line', 0, 'no_line', '2026-09-27 12:50:00+00') returning 1)
     select count(*)::int from i $$,
  $$ values (1) $$, 'C16 SERVICE_ROLE inserts (1 row)');
select results_eq(
  $$ with u as (update league_player_values set season_points = 44.10, season_games = 4, computed_at = '2026-09-27 13:50:00+00'
       where player_id = 'q85-rb' and week = 4 returning 1) select count(*)::int from u $$,
  $$ values (1) $$, 'C17 SERVICE_ROLE updates (1 row)');
select results_eq(
  $$ with d as (delete from league_player_values where player_id = 'q85-wr' and week = 4 returning 1) select count(*)::int from d $$,
  $$ values (1) $$, 'C18 SERVICE_ROLE deletes (1 row) — the job''s dropped-player removal');
select is((select count(*)::int from league_player_values where player_id like 'q85-%'), 2,
  'C19 SERVICE_ROLE reads what it wrote (bypasses RLS): q85-rb + q85-gone');
reset role;

-- ---------------------------------------------------------------------------
-- D. TRUNCATE per role (081 §A's shape; D350 / D367)
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.league_player_values', 'TRUNCATE'), 'D1 anon holds NO TRUNCATE');
select ok(not has_table_privilege('authenticated', 'public.league_player_values', 'TRUNCATE'), 'D2 authenticated holds NO TRUNCATE');
select ok(has_table_privilege('service_role', 'public.league_player_values', 'TRUNCATE'), 'D3 service_role keeps TRUNCATE (133''s posture)');
select ok(has_table_privilege('anon', 'public.league_player_values', 'SELECT'),
  'D4 anon keeps the table''s default SELECT grant (037/D23) — C1''s zero rows are RLS''s answer, not a missing grant');

-- ---------------------------------------------------------------------------
-- E. The schedule — one pg_cron row, literal
-- ---------------------------------------------------------------------------
select is(
  (select schedule || ' | ' || command from cron.job where jobname = 'league-player-values-ping'),
  '50 * * * * | SELECT public.cron_ping_route(''/api/cron/league-player-values'')',
  'E1 hourly at :50 (ten minutes after 136''s projections sync), pinging the route through 124''s cron_ping_route');
select is((select count(*)::int from cron.job where jobname = 'league-player-values-ping'), 1, 'E2 exactly ONE such job');
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'league-player-values-ping') then
    perform cron.unschedule('league-player-values-ping');
  end if;
  perform cron.schedule('league-player-values-ping', '50 * * * *',
    'SELECT public.cron_ping_route(''/api/cron/league-player-values'')');
end;
$do$;
select is((select count(*)::int from cron.job where jobname = 'league-player-values-ping'), 1,
  'E3 the migration''s DO block is idempotent — re-run, still ONE job');
select is(
  (select string_agg(jobname || ' ' || schedule, '; ' order by jobname) from cron.job
    where jobname in ('sync-weekly-projections-ping', 'sync-live-ping', 'score-week-ping', 'scoring-stall-check', 'lineup-lock')),
  'lineup-lock * * * * *; score-week-ping * * * * *; scoring-stall-check * * * * *; sync-live-ping * * * * *; sync-weekly-projections-ping 40 * * * *',
  'E4 the neighbouring jobs are untouched (136''s projections ping still :40; 124''s three + 116''s lineup-lock)');

-- ---------------------------------------------------------------------------
-- F. ON DELETE CASCADE from players and leagues
-- ---------------------------------------------------------------------------
select is((select count(*)::int from league_player_values where player_id = 'q85-gone'), 1, 'F0 PREMISE: q85-gone has a value row');
delete from players where id = 'q85-gone';
select is((select count(*)::int from league_player_values where player_id = 'q85-gone'), 0,
  'F1 deleting the player removes his value rows (CASCADE)');
select is((select count(*)::int from league_player_values where player_id = 'q85-rb'), 1, 'F2 …and only his');
delete from league_members where league_id = 'b8500000-0000-4000-8000-000000000001';
delete from teams where league_id = 'b8500000-0000-4000-8000-000000000001';
delete from leagues where id = 'b8500000-0000-4000-8000-000000000001';
select is((select count(*)::int from league_player_values where league_id = 'b8500000-0000-4000-8000-000000000001'), 0,
  'F3 deleting the league removes its value rows (CASCADE)');

select * from finish();
rollback;
