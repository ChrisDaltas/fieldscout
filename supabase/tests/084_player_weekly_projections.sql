-- ============================================================================
-- player_weekly_projections — pgTAP 084 (M6A task L.E1.19; migration 136;
-- PROGRESS Q62 RULED / F379 first third / D373; spec v2.16.44 §12.27 + §14;
-- tasks-M6A §4 rules 1–15 — rule 3 (the no-write-policy pattern per role with
-- RETURNING counts), rule 14(c) (premises asserted by value), rule 15).
--
-- Numbering: pgTAP head measured 083 at task time (`ls supabase/tests/ |
-- tail -1`) ⇒ 084 (D161).
--
-- What this pins:
--   §A FORM — the table, its exact columns, the (season, week, player_id)
--      PK, the two FKs (players ON DELETE CASCADE; (season, week) →
--      nfl_weeks), NOT NULL where stated, NO default on fetched_at (the
--      writer must stamp its TimeProvider instant), RLS ON with EXACTLY one
--      policy (SELECT, TO authenticated).
--   §B THE CHECKS, each beside a success twin: stats must be an object of
--      NUMBERS (23514 on a string value), raw_stats an object, source
--      non-blank; a week the calendar does not know is unstorable (23503).
--   §C THE ROLE WALK (RETURNING counts): anon reads 0 rows (no policy) and
--      writes nothing; an authenticated NON-member and a LEAGUE MEMBER read
--      every row and write nothing (INSERT 42501, UPDATE / DELETE 0 rows);
--      the rows are byte-identical after the walk. service_role — the
--      sync's writer — INSERTs, UPDATEs and DELETEs (the positive half).
--   §D TRUNCATE per role via has_table_privilege (081 §A's shape): anon /
--      authenticated cannot; service_role can.
--   §E THE SCHEDULE: exactly one pg_cron row, the literal schedule + command,
--      and the migration's DO block is idempotent (run twice → still one).
--   §F ON DELETE CASCADE from players (a player the sync can no longer see
--      takes his lines with him — no orphan line to outrank anyone).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';

select plan(54);

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select has_table('public', 'player_weekly_projections', 'A1 player_weekly_projections exists (136)');
select columns_are('public', 'player_weekly_projections',
  array['season', 'week', 'player_id', 'stats', 'raw_stats', 'source', 'source_updated_at', 'fetched_at'],
  'A2 exact column set');
select col_is_pk('public', 'player_weekly_projections', array['season', 'week', 'player_id'],
  'A3 PK = (season, week, player_id) — one line per player per week');
select fk_ok('public', 'player_weekly_projections', 'player_id', 'public', 'players', 'id',
  'A4 player_id → players(id)');
select fk_ok('public', 'player_weekly_projections', array['season', 'week'], 'public', 'nfl_weeks', array['season', 'week'],
  'A5 (season, week) → nfl_weeks — the calendar decides which weeks exist (§23.3)');
select is(
  (select confdeltype::text from pg_constraint where conname = 'player_weekly_projections_player_id_fkey'),
  'c', 'A6 the players FK is ON DELETE CASCADE');
select ok(
  (select bool_and(a.attnotnull) from pg_attribute a
    where a.attrelid = 'public.player_weekly_projections'::regclass
      and a.attname in ('season', 'week', 'player_id', 'stats', 'raw_stats', 'source', 'fetched_at')),
  'A7 season, week, player_id, stats, raw_stats, source, fetched_at are NOT NULL');
select col_is_null('public', 'player_weekly_projections', 'source_updated_at',
  'A8 source_updated_at is nullable (the source may send none)');
select col_hasnt_default('public', 'player_weekly_projections', 'fetched_at',
  'A9 fetched_at has NO default — the writer stamps its TimeProvider instant, never the database clock');
select ok((select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'player_weekly_projections'),
  'A10 RLS is ON');
select policies_are('public', 'player_weekly_projections',
  array['player_weekly_projections readable by signed-in users'],
  'A11 exactly ONE policy — no write policy for any role');
select is(
  (select string_agg(cmd || ' TO ' || array_to_string(roles, ','), '; ' order by policyname) from pg_policies
    where schemaname = 'public' and tablename = 'player_weekly_projections'),
  'SELECT TO authenticated',
  'A12 …and it is SELECT, TO authenticated only');

-- ---------------------------------------------------------------------------
-- Fixture (as postgres). Premises by value (rule 14(c)).
-- ---------------------------------------------------------------------------
insert into players (id, full_name, position, team) values
  ('q84-qb', 'Q84 Quarterback', 'QB', 'BUF'),
  ('q84-k',  'Q84 Kicker',      'K',  'IND'),
  ('q84-gone', 'Q84 Departed',  'WR', 'KC');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('98400000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-q84-' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       json_build_object('username', 'q84_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id,
                     scoring_rules_snapshot, lineup_lock, waiver_type, settings, roster_settings) values
 ('b8400000-0000-4000-8000-000000000001', '98400000-0000-4000-8000-000000000001', 'pgtap-q84-L1', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab', '{}'::jsonb, '{}'::jsonb);
insert into teams (id, owner_id, name, league_id, status) values
 ('c8400000-0000-4000-8000-000000000001', '98400000-0000-4000-8000-000000000001', 'Q84 Team', 'b8400000-0000-4000-8000-000000000001', 'active');
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
 ('b8400000-0000-4000-8000-000000000001', '98400000-0000-4000-8000-000000000001', 'c8400000-0000-4000-8000-000000000001', 'commissioner', false);

insert into player_weekly_projections (season, week, player_id, stats, raw_stats, source, source_updated_at, fetched_at) values
  (2026, 4, 'q84-qb', '{"pass_yards": 241.87, "pass_tds": 1.59}', '{"pass_yd": 241.87, "pass_td": 1.59, "pts_ppr": 23.27}', 'sleeper', '2026-09-24 23:45:51.844+00', '2026-09-27 12:40:00+00'),
  (2026, 4, 'q84-k',  '{"pat_made": 2.62, "fg_40_49": 0.59}', '{"xpm": 2.62, "fgm_40_49": 0.59, "pts_ppr": 9.63}', 'sleeper', null, '2026-09-27 12:40:00+00');

select is((select count(*)::int from player_weekly_projections where player_id like 'q84-%'), 2,
  'PREMISE: two planted lines (as postgres)');
select is((select week from nfl_weeks where season = 2026 and week = 4), 4,
  'PREMISE: 2026 week 4 is in the calendar (039''s seed)');
select is((select count(*)::int from nfl_weeks where season = 2026 and week = 19), 0,
  'PREMISE: 2026 week 19 is NOT in the calendar (§B5 depends on it)');

-- ---------------------------------------------------------------------------
-- B. The checks, each with its success twin
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into player_weekly_projections values (2026, 5, 'q84-qb', '{"pass_yards": "241.87"}', '{}', 'sleeper', null, now()) $$,
  '23514', null, 'B1 a NON-NUMBER stat value is refused (23514) — the canonical line holds numbers only');
select lives_ok(
  $$ insert into player_weekly_projections values (2026, 5, 'q84-qb', '{"pass_yards": 241.87, "rush_tds": 0}', '{}', 'sleeper', null, now()) $$,
  'B1b …its twin with numbers (a real 0 included) lives');
select throws_ok(
  $$ insert into player_weekly_projections values (2026, 6, 'q84-qb', '[1, 2]', '{}', 'sleeper', null, now()) $$,
  '23514', null, 'B2 stats must be an OBJECT (23514)');
select throws_ok(
  $$ insert into player_weekly_projections values (2026, 6, 'q84-qb', '{}', '"x"', 'sleeper', null, now()) $$,
  '23514', null, 'B3 raw_stats must be an OBJECT (23514)');
select throws_ok(
  $$ insert into player_weekly_projections values (2026, 6, 'q84-qb', '{}', '{}', '  ', null, now()) $$,
  '23514', null, 'B4 source must be non-blank (23514)');
select throws_ok(
  $$ insert into player_weekly_projections values (2026, 19, 'q84-qb', '{}', '{}', 'sleeper', null, now()) $$,
  '23503', null, 'B5 a week the calendar does not know is unstorable (23503 — the nfl_weeks FK)');
select throws_ok(
  $$ insert into player_weekly_projections (season, week, player_id, stats, raw_stats, source) values (2026, 6, 'q84-qb', '{}', '{}', 'sleeper') $$,
  '23502', null, 'B6 omitting fetched_at is refused (23502) — no default stamps the database clock');
select throws_ok(
  $$ insert into player_weekly_projections values (2026, 6, 'q84-nobody', '{}', '{}', 'sleeper', null, now()) $$,
  '23503', null, 'B7 an unknown player is unstorable (23503 — the players FK)');
delete from player_weekly_projections where player_id = 'q84-qb' and week = 5;

-- ---------------------------------------------------------------------------
-- C. The role walk — RETURNING counts (§4.2)
-- ---------------------------------------------------------------------------
create temp table q84_before as
  select season, week, player_id, stats, raw_stats, source, source_updated_at, fetched_at
    from player_weekly_projections where player_id like 'q84-%';
grant select on q84_before to anon, authenticated, service_role;

-- anon
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from player_weekly_projections where player_id like 'q84-%'), 0,
  'C1 ANON reads ZERO rows (no anon policy — RLS is the gate, D23)');
select throws_ok(
  $$ insert into player_weekly_projections values (2026, 4, 'q84-gone', '{}', '{}', 'sleeper', null, now()) $$,
  '42501', null, 'C2 ANON cannot INSERT (42501)');
select results_eq(
  $$ with u as (update player_weekly_projections set stats = '{}' where player_id like 'q84-%' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'C3 ANON UPDATE touches 0 rows');
select results_eq(
  $$ with d as (delete from player_weekly_projections where player_id like 'q84-%' returning 1) select count(*)::int from d $$,
  $$ values (0) $$, 'C4 ANON DELETE touches 0 rows');
reset role;

-- authenticated, NOT a member of any league (the outsider)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "98400000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(public.is_league_member('b8400000-0000-4000-8000-000000000001'), false,
  'C5 PREMISE: this caller is NOT a member of the league');
select is((select count(*)::int from player_weekly_projections where player_id like 'q84-%'), 2,
  'C6 an AUTHENTICATED non-member reads both lines (SELECT TO authenticated)');
select throws_ok(
  $$ insert into player_weekly_projections values (2026, 4, 'q84-gone', '{}', '{}', 'sleeper', null, now()) $$,
  '42501', null, 'C7 …cannot INSERT (42501)');
select results_eq(
  $$ with u as (update player_weekly_projections set stats = '{}' where player_id like 'q84-%' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'C8 …UPDATE touches 0 rows');
select results_eq(
  $$ with d as (delete from player_weekly_projections where player_id like 'q84-%' returning 1) select count(*)::int from d $$,
  $$ values (0) $$, 'C9 …DELETE touches 0 rows');

-- a LEAGUE MEMBER (the commissioner of an in_season league)
select set_config('request.jwt.claims', '{"sub": "98400000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(public.is_league_member('b8400000-0000-4000-8000-000000000001'), true,
  'C10 PREMISE: this caller IS a member (the commissioner) of an in_season league');
select is((select count(*)::int from player_weekly_projections where player_id like 'q84-%'), 2,
  'C11 a LEAGUE MEMBER reads both lines');
select throws_ok(
  $$ insert into player_weekly_projections values (2026, 4, 'q84-gone', '{}', '{}', 'sleeper', null, now()) $$,
  '42501', null, 'C12 …cannot INSERT (42501) — membership, even the commissioner''s, grants no write');
select results_eq(
  $$ with u as (update player_weekly_projections set stats = '{}' where player_id like 'q84-%' returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'C13 …UPDATE touches 0 rows');
select results_eq(
  $$ with d as (delete from player_weekly_projections where player_id like 'q84-%' returning 1) select count(*)::int from d $$,
  $$ values (0) $$, 'C14 …DELETE touches 0 rows');
reset role;
select set_config('request.jwt.claims', '', true);

select set_eq(
  $$ select season, week, player_id, stats, raw_stats, source, source_updated_at, fetched_at from player_weekly_projections where player_id like 'q84-%' $$,
  $$ select * from q84_before $$,
  'C15 the lines are BYTE-IDENTICAL after the three client walks');

-- service_role — the sync's writer (the positive half)
set local role service_role;
select results_eq(
  $$ with i as (insert into player_weekly_projections values (2026, 4, 'q84-gone', '{"receiving_yards": 50.5}', '{"rec_yd": 50.5}', 'sleeper', null, '2026-09-27 12:40:00+00') returning 1) select count(*)::int from i $$,
  $$ values (1) $$, 'C16 SERVICE_ROLE inserts (1 row)');
select results_eq(
  $$ with u as (update player_weekly_projections set stats = '{"pass_yards": 250}', fetched_at = '2026-09-27 13:40:00+00' where player_id = 'q84-qb' and week = 4 returning 1) select count(*)::int from u $$,
  $$ values (1) $$, 'C17 SERVICE_ROLE updates (1 row)');
select results_eq(
  $$ with d as (delete from player_weekly_projections where player_id = 'q84-k' and week = 4 returning 1) select count(*)::int from d $$,
  $$ values (1) $$, 'C18 SERVICE_ROLE deletes (1 row) — the sync''s stale-line removal');
select is((select count(*)::int from player_weekly_projections where player_id like 'q84-%'), 2,
  'C19 SERVICE_ROLE reads what it wrote (bypasses RLS): q84-qb + q84-gone');
reset role;

-- ---------------------------------------------------------------------------
-- D. TRUNCATE per role (081 §A's shape; D350 / D367)
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.player_weekly_projections', 'TRUNCATE'),
  'D1 anon holds NO TRUNCATE');
select ok(not has_table_privilege('authenticated', 'public.player_weekly_projections', 'TRUNCATE'),
  'D2 authenticated holds NO TRUNCATE');
select ok(has_table_privilege('service_role', 'public.player_weekly_projections', 'TRUNCATE'),
  'D3 service_role keeps TRUNCATE (untouched, 133''s posture)');
select ok(has_table_privilege('anon', 'public.player_weekly_projections', 'SELECT'),
  'D4 anon keeps the table''s default SELECT grant (037/D23) — C1''s zero rows are RLS''s answer, not a missing grant');

-- ---------------------------------------------------------------------------
-- E. The schedule — one pg_cron row, literal
-- ---------------------------------------------------------------------------
select is(
  (select schedule || ' | ' || command from cron.job where jobname = 'sync-weekly-projections-ping'),
  '40 * * * * | SELECT public.cron_ping_route(''/api/cron/sync-weekly-projections'')',
  'E1 hourly at :40, pinging the route through 124''s cron_ping_route');
select is((select count(*)::int from cron.job where jobname = 'sync-weekly-projections-ping'), 1,
  'E2 exactly ONE such job');
do $do$
begin
  if exists (select 1 from cron.job where jobname = 'sync-weekly-projections-ping') then
    perform cron.unschedule('sync-weekly-projections-ping');
  end if;
  perform cron.schedule('sync-weekly-projections-ping', '40 * * * *',
    'SELECT public.cron_ping_route(''/api/cron/sync-weekly-projections'')');
end;
$do$;
select is((select count(*)::int from cron.job where jobname = 'sync-weekly-projections-ping'), 1,
  'E3 the migration''s DO block is idempotent — re-run, still ONE job');
select is((select count(*)::int from cron.job where jobname in ('sync-live-ping', 'score-week-ping', 'scoring-stall-check', 'lineup-lock')), 4,
  'E4 the existing jobs are untouched (124''s three + 116''s lineup-lock still scheduled)');
select ok(
  (select prosrc from pg_proc where oid = 'public.cron_ping_route(text)'::regprocedure) like '%fieldscout_cron_secret%',
  'E5 the helper it calls is 124''s Vault-reading cron_ping_route (not redefined here)');

-- ---------------------------------------------------------------------------
-- F. ON DELETE CASCADE from players
-- ---------------------------------------------------------------------------
select is((select count(*)::int from player_weekly_projections where player_id = 'q84-gone'), 1,
  'F0 PREMISE: q84-gone has a line');
delete from players where id = 'q84-gone';
select is((select count(*)::int from player_weekly_projections where player_id = 'q84-gone'), 0,
  'F1 deleting the player removes his lines (CASCADE) — no orphan line survives him');
select is((select count(*)::int from player_weekly_projections where player_id = 'q84-qb'), 1,
  'F2 …and only his');

select * from finish();
rollback;
