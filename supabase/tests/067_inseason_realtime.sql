-- ============================================================================
-- In-season realtime + the scoring write door — pgTAP 067 (task L.D1.9;
-- migration 119; spec v2.16.27 §9.1 / §9.2 / §9.3 / §11.4 / §12.14 / §22.2 /
-- §23.4 / E61; PROGRESS D292 / D295 / D296 / D298 / D319; F9 / F42 /
-- F224(d) / F241(a) / F248(c) / F252(a) / F257(a)(a′); tasks-M4 §4 rules
-- 1–11 — rule 7 (Broadcast-from-DB, private topics, no Postgres Changes)
-- and rule 9 (a `final` matchup / an `is_overridden` cell is never
-- auto-recomputed; pins that guard RUN — every refusal beside its one-unit-
-- away success twin, D272(20)/D146).
--
-- Numbering: pgTAP head measured 066 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 067 (D161/D166; D319(1)).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * TRIGGER INVENTORY BOTH DIRECTIONS: the four D296 tables carry their
--     triggers with the pinned EVENTS, ORIENTATION (statement vs row) and
--     transition-table names (matchups × 3 single-event statement triggers;
--     team_week_results × 2; transactions row INSERT; league_weeks row
--     UPDATE OF exactly {status}); the re-waived F42 five + nfl_weeks (F9)
--     + team_lineups (F224(d)) + league_player_pool (F252(a) — the tick's
--     summary, no table trigger) carry NONE, each cell naming its reason.
--     The PR's probe 4 re-adds a waived table's trigger and the 024 pin +
--     the cell here go RED. The supabase_realtime publication carries none
--     of the four (D89).
--   * PAYLOAD COLUMN-SELECTION as stored-literal key sets per function +
--     NAMED negatives (no `scoring_rules_snapshot`, no per-player keys, no
--     `override_action_id` / `action_id` / raw `payload` / `faab` /
--     `reopened_by_action_id`) — asserted on the STORED realtime.messages
--     rows, not only on the functions.
--   * THE DOOR: every refusal (P0001 by name / 22023 shape / P0002 foreign /
--     42501 JWT) beside its success twin; the SKIP-BY-NAME rows (overridden /
--     final / row-less) beside the sibling that WROTE in the same batch;
--     THE DoD PIN — an `is_overridden` row's cells and result are byte-
--     identical after a batch that names both its teams (the PR's probe 1
--     lets the door write it and F7 goes RED); ONE `matchups` event per
--     league per batch by COUNT (probe 2 splits the door into per-cell
--     UPDATEs and F6c/F9c go RED); the identical re-send writes ZERO rows,
--     says `no_change`, moves no digest and emits NO event; E61 — `null`
--     writes NULL, never 0, and never turns a written score into 0; an
--     unbatched cell (109's `DEFAULT 0` on a bracket row) is never touched;
--     F257(a′) — a rebuilt bracket row (new id, same pairing) is found by
--     the pairing; `total_points` provisional rows (is_final FALSE), a NULL
--     writes no row (`pending_no_row`), a final row is never overwritten
--     (`result_final`); held-lock < 50 ms (rule 8).
--   * THE TICK'S POOL BROADCAST: at kickoff −1s no event; at +1s exactly
--     ONE `league_player_pool` event for the league naming the changed
--     count; the same instant again — none (idempotent, D3's twin); the
--     release instant — one more. 064 (140) ran unchanged and green
--     against the replaced body BEFORE this file existed (D314(2)).
--   * CHANNEL AUTH on the NEW events at the realtime.messages surface: the
--     member reads them, the non-member and anon read ZERO (the wire twin
--     is `inseason-realtime-db.test.ts`).
--   * All privileged work runs as postgres (auth.uid() NULL — the door's
--     own precondition); JWT cells set a claim and reset it (D49(7)).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';   -- the jsonb rendering of `at` in K2b is a stored literal

select plan(148);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   and not has_function_privilege('anon', p.oid, 'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('matchup_broadcast_payload', 'team_week_result_broadcast_payload',
                       'transaction_broadcast_payload', 'league_week_broadcast_payload')),
  'A1 the four payload functions are PLAIN (not SECURITY DEFINER), search_path='''' and REVOKEd from authenticated + anon (070''s form)');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('matchup_broadcast_payload', 'team_week_result_broadcast_payload',
                       'transaction_broadcast_payload', 'league_week_broadcast_payload')),
  4::bigint, 'A1b …all four exist');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
                   and not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('broadcast_matchups_statement', 'broadcast_team_week_results_statement',
                       'broadcast_transaction_insert', 'broadcast_league_week_status')),
  'A2 the four trigger functions are SECURITY DEFINER + search_path='''' + REVOKEd (§9.2 pattern)');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('broadcast_matchups_statement', 'broadcast_team_week_results_statement',
                       'broadcast_transaction_insert', 'broadcast_league_week_status')),
  4::bigint, 'A2b …all four exist');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p where p.proname = 'score_write_week_batch'),
  'A3 score_write_week_batch is SECURITY DEFINER with search_path=''''');
select ok(
  not has_function_privilege('authenticated', 'public.score_write_week_batch(uuid, integer, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.score_write_week_batch(uuid, integer, jsonb)', 'EXECUTE'),
  'A3b …REVOKEd from authenticated + anon (no manager path — the worker''s door)');
select ok(
  has_function_privilege('service_role', 'public.score_write_week_batch(uuid, integer, jsonb)', 'EXECUTE'),
  'A3c …and service_role CAN execute it (the positive half — a REVOKE that also took the worker''s grant would read as "secure")');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
   from pg_proc p where p.proname = 'lineup_lock_tick'),
  'A4 lineup_lock_tick keeps 116''s shape after the 119 CREATE OR REPLACE (SECURITY DEFINER, search_path='''', REVOKEd)');

-- JWT refusal (42501) — set + reset (D49(7)).
select set_config('request.jwt.claims', '{"sub": "97000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[]'::jsonb) $$,
  '42501', null,
  'A5 a signed-in caller is refused in-body (42501) BEFORE any validation — the door is the worker''s');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- B. Trigger inventory — both directions (§12.14; D296; F42 / F9 / F224(d) /
--    F252(a))
-- ---------------------------------------------------------------------------
select has_trigger('public', 'matchups', 'tr_broadcast_matchups_insert', 'B1 matchups carries its INSERT statement trigger');
select has_trigger('public', 'matchups', 'tr_broadcast_matchups_update', 'B1b matchups carries its UPDATE statement trigger (the scores_updated carrier)');
select has_trigger('public', 'matchups', 'tr_broadcast_matchups_delete', 'B1c matchups carries its DELETE statement trigger (Remix / bracket rebuild)');
select has_trigger('public', 'team_week_results', 'tr_broadcast_team_week_results_insert', 'B1d team_week_results carries its INSERT statement trigger');
select has_trigger('public', 'team_week_results', 'tr_broadcast_team_week_results_update', 'B1e team_week_results carries its UPDATE statement trigger');
select has_trigger('public', 'transactions', 'tr_broadcast_transactions', 'B1f transactions carries its row INSERT trigger (the activity feed''s carrier)');
select has_trigger('public', 'league_weeks', 'tr_broadcast_league_weeks', 'B1g league_weeks carries its row UPDATE OF status trigger (the "week is final" moment)');

select is(
  (select array_agg(t.trigger_name::text || ':' || t.event_manipulation::text || ':' || t.action_orientation::text order by t.trigger_name::text)
   from information_schema.triggers t
   where t.trigger_schema = 'public' and t.event_object_table = 'matchups' and t.trigger_name like 'tr_broadcast_%'),
  array['tr_broadcast_matchups_delete:DELETE:STATEMENT', 'tr_broadcast_matchups_insert:INSERT:STATEMENT', 'tr_broadcast_matchups_update:UPDATE:STATEMENT'],
  'B2 matchups: exactly three SINGLE-EVENT STATEMENT triggers (PG refuses transition tables on a multi-event trigger) — one event per league per statement, §22.2');
select is(
  (select array_agg(t.trigger_name::text || ':' || t.event_manipulation::text || ':' || t.action_orientation::text order by t.trigger_name::text)
   from information_schema.triggers t
   where t.trigger_schema = 'public' and t.event_object_table = 'team_week_results' and t.trigger_name like 'tr_broadcast_%'),
  array['tr_broadcast_team_week_results_insert:INSERT:STATEMENT', 'tr_broadcast_team_week_results_update:UPDATE:STATEMENT'],
  'B2b team_week_results: INSERT + UPDATE STATEMENT triggers (finalization writes a week in one statement)');
select is(
  (select array_agg(t.event_manipulation::text || ':' || t.action_orientation::text order by 1)
   from information_schema.triggers t
   where t.trigger_schema = 'public' and t.trigger_name = 'tr_broadcast_transactions'),
  array['INSERT:ROW'], 'B2c transactions: row INSERT only (append-only — one move is one event)');
select is(
  (select array_agg(t.event_manipulation::text || ':' || t.action_orientation::text order by 1)
   from information_schema.triggers t
   where t.trigger_schema = 'public' and t.trigger_name = 'tr_broadcast_league_weeks'),
  array['UPDATE:ROW'], 'B2d league_weeks: row UPDATE only');
select is(
  (select array_agg(distinct event_object_column::text order by event_object_column::text)
   from information_schema.triggered_update_columns
   where trigger_schema = 'public' and trigger_name = 'tr_broadcast_league_weeks'),
  array['status'], 'B3 tr_broadcast_league_weeks is COLUMN-TRIGGERED on exactly {status}');
select is(
  (select array_agg(t.tgname::text || ':' || coalesce(t.tgoldtable::text, '-') || ':' || coalesce(t.tgnewtable::text, '-') order by t.tgname::text)
   from pg_trigger t
   where t.tgrelid in ('public.matchups'::regclass, 'public.team_week_results'::regclass) and t.tgname like 'tr_broadcast_%'),
  array['tr_broadcast_matchups_delete:changed_rows:-', 'tr_broadcast_matchups_insert:-:changed_rows',
        'tr_broadcast_matchups_update:-:changed_rows',
        'tr_broadcast_team_week_results_insert:-:changed_rows', 'tr_broadcast_team_week_results_update:-:changed_rows'],
  'B4 the transition tables: OLD on the DELETE trigger, NEW on the others — all named changed_rows (one function reads by TG_OP)');

-- The other direction: re-waived / decided trigger-less, one cell per table with its reason.
select is((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.league_members'::regclass and p.proname like 'broadcast%'), 0::bigint,
  'B5 league_members: NO broadcast trigger — re-waived per table (F42/D296: no M4 subscriber; a trigger ships with its first subscriber)');
select is((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.team_managers'::regclass and p.proname like 'broadcast%'), 0::bigint,
  'B5b team_managers: NO broadcast trigger — re-waived (F42/D296)');
-- [amended 2026-09-07, L.D1.10's #266 fix round (migration 120 §4, R856):
-- teams LEFT the F42 set — the first in-season WRITER with a subscriber (a
-- retirement; the standings page + the league detail refetch on it). Shown
-- RED against 120 before this edit (1/148).]
select is((select string_agg(t.tgname::text, ',') from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.teams'::regclass and p.proname like 'broadcast%'),
  'tr_broadcast_teams',
  'B5c teams: ONE broadcast trigger — LEFT the F42 set at 120/L.D1.10 (R856): per-statement, diff-aware; the pins are 068 A11/C14');
select is((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.league_invites'::regclass and p.proname like 'broadcast%'), 0::bigint,
  'B5d league_invites: NO broadcast trigger — re-waived (F42/D296)');
select is((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.league_lists'::regclass and p.proname like 'broadcast%'), 0::bigint,
  'B5e league_lists: NO broadcast trigger — re-waived (F42/D106(8)/D296)');
select is((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.nfl_weeks'::regclass and p.proname like 'broadcast%'), 0::bigint,
  'B5f nfl_weeks: NO broadcast trigger — F9 DECIDED (D296): global reference data with zero subscribers; clients learn week state through league_weeks, locks are server-evaluated (D291)');
select is((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.team_lineups'::regclass and p.proname like 'broadcast%'), 0::bigint,
  'B5g team_lineups: NO broadcast trigger — F224(d)/F248(c) DECIDED: the editor renders its own submit; the only would-be subscriber (L.D5.2''s opponent view) is unbuilt — ships with it');
select is((select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.league_player_pool'::regclass and p.proname like 'broadcast%'), 0::bigint,
  'B5h league_player_pool: NO TABLE trigger — F252(a) DECIDED: the tick sends ONE coalesced summary per league per pass (section H), never a row storm');
select is(
  (select count(*) from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('matchups', 'team_week_results', 'transactions', 'league_weeks', 'league_player_pool')),
  0::bigint, 'B6 the supabase_realtime publication carries NONE of the in-season tables (D89 — Broadcast-from-DB needs no publication; Postgres Changes stays off)');

-- ---------------------------------------------------------------------------
-- C. Fixtures (postgres context — before any JWT claims; D49(7)).
--    Calendar (2026, stored literals — 064''s week 3): starts 2026-09-23
--    04:00Z, last game ends 09-29 04:00Z, window 10-01 10:00Z; one game
--    KC@BUF Thu 09-25 00:15Z. u01 owns everything and is L1''s member;
--    u99 is the outsider. L1 h2h in_season 8 teams (weeks 3 live / 4
--    correction_window / 5 final / 6 upcoming); L2 total_points in_season
--    4 teams (week 3 live); L3 COMPLETE (week 3 live — the refusal''s
--    fixture); L4 PLAYOFFS 4 teams (week 3 live regular, week 7 live
--    playoff with a seeded bracket row at 109''s DEFAULT 0 / 0).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('97000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-rt19-' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'rt19_user' || i)::jsonb, now(), now()
from unnest(array[1, 2, 3, 4, 5, 6, 7, 8, 99]) i;

update nfl_weeks set first_kickoff_at = null, last_game_ends_at = null where season = 2026;
update nfl_weeks set last_game_ends_at = starts_at + interval '6 days' where season = 2026 and week in (1, 2);
update nfl_weeks set starts_at = '2026-09-23 04:00:00+00', last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set starts_at = '2026-09-30 04:00:00+00' where season = 2026 and week = 4;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('rt19-w3-a', 2026, 3, 'BUF', 'KC', '2026-09-25 00:15:00+00', 'final');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings) values
 ('b7000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', 'pgtap-rt19-L1', 2026, 'in_season', 8, 4, 4, 7,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h", "second_opponent": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b7000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001', 'pgtap-rt19-L2', 2026, 'in_season', 8, 4, 0, 7,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "total_points"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b7000000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000001', 'pgtap-rt19-L3', 2026, 'complete', 8, 4, 4, 7,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b7000000-0000-4000-8000-000000000004', '97000000-0000-4000-8000-000000000001', 'pgtap-rt19-L4', 2026, 'playoffs', 8, 4, 4, 7,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, '97000000-0000-4000-8000-000000000001', 'RT T' || i, 'b7000000-0000-4000-8000-000000000001'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-0000000000' || (20 + i)::text)::uuid, '97000000-0000-4000-8000-000000000001', 'RT U' || i, 'b7000000-0000-4000-8000-000000000002'
from generate_series(1, 4) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-0000000000' || (30 + i)::text)::uuid, '97000000-0000-4000-8000-000000000001', 'RT V' || i, 'b7000000-0000-4000-8000-000000000003'
from generate_series(1, 2) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-0000000000' || (40 + i)::text)::uuid, '97000000-0000-4000-8000-000000000001', 'RT W' || i, 'b7000000-0000-4000-8000-000000000004'
from generate_series(1, 4) i;

insert into league_members (league_id, user_id, team_id, role) values
 ('b7000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'commissioner');
-- L.E1.3 (tasks-M6A §4 rule 14(d), D339): L1 (b7…0001) seats 8 teams
-- (c7…0002–0008) with T1 as the only member row above, leaving seven
-- unmanaged under D339's predicate. No cell in sections A–L reads
-- league_members or depends on any of T2–T8 being unmanaged — the J/K
-- sections below exercise matchups/team_week_results/league_player_pool
-- broadcasts and the lineup lock tick, none of which key off manager
-- status today — so every remaining L1 team gets a seated member row here,
-- matching the same rule applied in 064. L2/L3/L4 are untouched: this task
-- names only "067 seats 8 teams in league b7…0001" (L.E1.3 item 2) and no
-- cell elsewhere in this file turns on those leagues' membership either.
insert into league_members (league_id, user_id, team_id, role)
select 'b7000000-0000-4000-8000-000000000001',
       ('97000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c7000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       'manager'
from generate_series(2, 8) i;

insert into league_weeks (league_id, season, week, status) values
 ('b7000000-0000-4000-8000-000000000001', 2026, 3, 'live'),
 ('b7000000-0000-4000-8000-000000000001', 2026, 4, 'correction_window'),
 ('b7000000-0000-4000-8000-000000000001', 2026, 5, 'final'),
 ('b7000000-0000-4000-8000-000000000001', 2026, 6, 'upcoming'),
 ('b7000000-0000-4000-8000-000000000002', 2026, 3, 'live'),
 ('b7000000-0000-4000-8000-000000000003', 2026, 3, 'live'),
 ('b7000000-0000-4000-8000-000000000004', 2026, 3, 'live'),
 ('b7000000-0000-4000-8000-000000000004', 2026, 7, 'live');

-- L1 week 3: four primary rows (m32 OVERRIDDEN — 101 / 88.10, result
-- 'away'; m33 FINAL — 50 / 60, 'away') + two secondary rows; the untouched
-- rows hold 109's DEFAULT 0 / 0.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden) values
 ('d7000000-0000-4000-8000-000000000031', 'b7000000-0000-4000-8000-000000000001', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', default, default, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000032', 'b7000000-0000-4000-8000-000000000001', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000004', 101.00, 88.10, 'live', 'away', true),
 ('d7000000-0000-4000-8000-000000000033', 'b7000000-0000-4000-8000-000000000001', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000005', 'c7000000-0000-4000-8000-000000000006', 50.00, 60.00, 'final', 'away', false),
 ('d7000000-0000-4000-8000-000000000034', 'b7000000-0000-4000-8000-000000000001', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000007', 'c7000000-0000-4000-8000-000000000008', default, default, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000041', 'b7000000-0000-4000-8000-000000000001', 2026, 3, 'secondary', 'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000003', default, default, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000042', 'b7000000-0000-4000-8000-000000000001', 2026, 3, 'secondary', 'c7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000004', default, default, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000051', 'b7000000-0000-4000-8000-000000000001', 2026, 4, 'regular',   'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', 70.00, 65.00, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000061', 'b7000000-0000-4000-8000-000000000001', 2026, 5, 'regular',   'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', 10.00, 20.00, 'final', 'away', false),
 ('d7000000-0000-4000-8000-000000000071', 'b7000000-0000-4000-8000-000000000001', 2026, 6, 'regular',   'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', default, default, 'scheduled', null, false),
 ('d7000000-0000-4000-8000-000000000081', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000031', 'c7000000-0000-4000-8000-000000000032', default, default, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000091', 'b7000000-0000-4000-8000-000000000004', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000041', 'c7000000-0000-4000-8000-000000000042', default, default, 'live', null, false);
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_seed, away_seed, status) values
 ('d7000000-0000-4000-8000-000000000097', 'b7000000-0000-4000-8000-000000000004', 2026, 7, 'playoff', 'c7000000-0000-4000-8000-000000000041', 'c7000000-0000-4000-8000-000000000042', 1, 4, 'live');

-- The pool (section H): three KC players in L1 — a free agent, a rostered
-- one, and one on waivers; the game is KC@BUF Thu 09-25 00:15Z.
insert into players (id, full_name, position, team, status) values
 ('rt19-kc-qb', 'RT19 KC QB', 'QB', 'KC', 'Active'),
 ('rt19-kc-rb', 'RT19 KC RB', 'RB', 'KC', 'Active'),
 ('rt19-kc-wr', 'RT19 KC WR', 'WR', 'KC', 'Active'),
 ('rt19-fa-wr', 'RT19 FA WR', 'WR', 'DAL', 'Active');
insert into league_rosters (league_id, team_id, player_id, slot_key) values
 ('b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'rt19-kc-qb', 'qb:0');
insert into league_player_pool (league_id, player_id, state, waivers_until) values
 ('b7000000-0000-4000-8000-000000000001', 'rt19-kc-qb', 'rostered',   null),
 ('b7000000-0000-4000-8000-000000000001', 'rt19-kc-rb', 'free_agent', null),
 ('b7000000-0000-4000-8000-000000000001', 'rt19-kc-wr', 'on_waivers', '2026-09-26 00:00:00+00');

-- Post-reset race guard (024's): today's + tomorrow's realtime.messages
-- partitions exist (rolled back with everything else if created here).
do $part$
declare
  d date;
  part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'realtime' and c.relname = part_name
    ) then
      execute format(
        'create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
        part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;

-- The fixtures above inserted matchups (one INSERT statement per league
-- group) — those events are the fixtures', not the subject's: count from
-- a baseline, never from zero.
-- Ordering: every message this transaction writes shares ONE inserted_at
-- (transaction now()) and ids are random uuids, so "the last event" is
-- ordered by the transaction's COMMAND id (`cmin` — monotone per statement
-- inside one transaction; physical position is not, once vacuum has freed
-- earlier pages), ties within a statement by ctid. SCOPE: only THIS transaction's rows
-- (`inserted_at >= now()`) — realtime.messages is never cleaned, so a
-- committed message on these topics from an earlier run (the F199 species:
-- a hand repro, an aborted suite) must not move an absolute count here.
create temp view rt19_msgs as
  select m.cmin::text::bigint as cmd, m.ctid as tid, m.id, m.topic, m.event, m.payload, m.private, m.extension
  from realtime.messages m
  where m.topic like 'league:b7000000-0000-4000-8000-00000000000%'
    and m.inserted_at >= now();
select set_config('pgtap.m0', (select count(*) from rt19_msgs)::text, true);
create function pg_temp.rt19_events(p_league text, p_event text) returns bigint language sql as $$
  select count(*) from rt19_msgs where topic = 'league:' || p_league and event = p_event
$$;
create function pg_temp.rt19_last(p_league text, p_event text) returns jsonb language sql as $$
  select payload from rt19_msgs where topic = 'league:' || p_league and event = p_event order by cmd desc, tid desc limit 1
$$;
create function pg_temp.rt19_digest_m(p_league text) returns text language sql as $$
  select md5(string_agg(m.id::text || ':' || coalesce(m.home_score::text, 'null') || ':' || coalesce(m.away_score::text, 'null')
                        || ':' || m.status || ':' || coalesce(m.result, 'null') || ':' || m.is_overridden::text, '|' order by m.id))
  from matchups m where m.league_id = p_league::uuid
$$;

-- ---------------------------------------------------------------------------
-- D. Payload column-selection — exact key sets (stored literals) + NAMED
--    negatives, on the functions
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(k order by k) from matchups m, jsonb_object_keys(public.matchup_broadcast_payload(m)) k where m.id = 'd7000000-0000-4000-8000-000000000032'),
  array['away_score', 'away_seed', 'away_team_id', 'home_score', 'home_seed', 'home_team_id', 'id', 'is_overridden', 'result', 'round_type', 'season', 'status', 'updated_at', 'week'],
  'D1 matchup_broadcast_payload = exactly the 14 rendered columns (pairing, seeds, cells, status/result, override flag, updated_at)');
select ok(
  (select not (p ? 'override_action_id') and not (p ? 'league_id') and not (p ? 'created_at') and not (p ? 'players') and not (p ? 'lines') and not (p ? 'starters')
   from matchups m, lateral (select public.matchup_broadcast_payload(m) p) x where m.id = 'd7000000-0000-4000-8000-000000000032'),
  'D1b …named negatives: no override_action_id (audit), no league_id (the topic), no created_at, no per-player keys (§9.1: lines are REST)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.team_week_result_broadcast_payload(
     row('00000000-0000-4000-8000-000000000000', 'b7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 2026, 3, 12.5, null, null, null, null, null, false)::team_week_results)) k),
  array['h2h_result', 'is_final', 'median_result', 'opponent_team_id', 'points', 'season', 'second_opponent_team_id', 'second_result', 'team_id', 'week'],
  'D2 team_week_result_broadcast_payload = exactly the 10 §12.18 standings inputs (no id, no league_id)');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.transaction_broadcast_payload(
     row('00000000-0000-4000-8000-000000000000', 'b7000000-0000-4000-8000-000000000001', 'add_drop', 'complete',
         'c7000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001',
         '{"add_player_id": "rt19-fa-wr", "drop_player_id": "rt19-kc-rb", "faab": 17, "action_id": "afd00000-0000-4000-8000-000000000001"}'::jsonb,
         null, 3, '2026-09-24 00:00:00+00', 'afd00000-0000-4000-8000-000000000001')::transactions)) k),
  array['add_player_id', 'created_at', 'drop_player_id', 'id', 'initiator_team_id', 'status', 'type', 'week'],
  'D3 transaction_broadcast_payload = exactly the 8 feed columns (type, teams, players — never claim/bid amounts, D296)');
select ok(
  (select p::text not like '%faab%' and p::text not like '%afd00000-0000-4000-8000-000000000001%' and not (p ? 'payload') and not (p ? 'action_id') and not (p ? 'related_action_id') and not (p ? 'initiated_by')
   from (select public.transaction_broadcast_payload(
     row('00000000-0000-4000-8000-000000000000', 'b7000000-0000-4000-8000-000000000001', 'add_drop', 'complete',
         'c7000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001',
         '{"add_player_id": "rt19-fa-wr", "drop_player_id": "rt19-kc-rb", "faab": 17, "action_id": "afd00000-0000-4000-8000-000000000001"}'::jsonb,
         null, 3, '2026-09-24 00:00:00+00', 'afd00000-0000-4000-8000-000000000001')::transactions) p) x),
  'D3b …named negatives: the payload BLOB is never forwarded (a faab amount and an action_id planted in it do not appear), no action_id / related_action_id / initiated_by');
select is(
  (select array_agg(k order by k) from league_weeks w, jsonb_object_keys(public.league_week_broadcast_payload(w)) k
   where w.league_id = 'b7000000-0000-4000-8000-000000000001' and w.week = 3),
  array['finalized_at', 'median_score', 'season', 'status', 'week'],
  'D4 league_week_broadcast_payload = exactly {season, week, status, median_score, finalized_at}');
select ok(
  (select not (p ? 'reopened_by_action_id') and not (p ? 'waivers_processed_at') and not (p ? 'id') and not (p ? 'league_id')
   from league_weeks w, lateral (select public.league_week_broadcast_payload(w) p) x
   where w.league_id = 'b7000000-0000-4000-8000-000000000001' and w.week = 3),
  'D4b …named negatives: no reopened_by_action_id (audit), no waivers_processed_at, no ids');

-- ---------------------------------------------------------------------------
-- E. The door — refusals, each beside its one-unit-away success twin
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000003', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000031", "points": 1.5}]') $$,
  'P0001', 'score_write_week_batch: league_not_in_season — league b7000000-0000-4000-8000-000000000003 is complete, the door writes only an in_season/playoffs league (D292)',
  'E1 a COMPLETE league is refused by name (league_not_in_season)');
select is(
  (public.score_write_week_batch('b7000000-0000-4000-8000-000000000004', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000041", "points": 1.5}]') ->> 'written')::int, 1,
  'E1b TWIN: a PLAYOFFS league one status over writes (the same batch shape, written 1)');
select throws_ok(
  $$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 5, '[{"team_id": "c7000000-0000-4000-8000-000000000001", "points": 11}]') $$,
  'P0001', 'score_write_week_batch: week_final — league b7000000-0000-4000-8000-000000000001 week 5 is final; a post-window delta changes no league cell (D295, §23.4)',
  'E2 a FINAL week is refused by name (week_final — D295(b): the post-window delta lands in player_stats and changes no league cell)');
select is(
  (select home_score || ':' || away_score from matchups where id = 'd7000000-0000-4000-8000-000000000061'), '10.00:20.00',
  'E2b …and the final week''s cells are untouched');
select is(
  (public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 4, '[{"team_id": "c7000000-0000-4000-8000-000000000001", "points": 71}]') ->> 'written')::int, 1,
  'E2c TWIN: the CORRECTION_WINDOW week one step before final writes (D295(a): an in-window delta recomputes the non-final matchup)');
select is(
  (select home_score::text from matchups where id = 'd7000000-0000-4000-8000-000000000051'), '71',
  'E2d …70.00 → 71 landed on the correction-window row');
select throws_ok(
  $$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 6, '[{"team_id": "c7000000-0000-4000-8000-000000000001", "points": 1}]') $$,
  'P0001', 'score_write_week_batch: week_not_open — league b7000000-0000-4000-8000-000000000001 week 6 is upcoming; the door writes only a live or correction_window week',
  'E3 an UPCOMING week is refused by name (week_not_open — the week''s own status is the datum, §23.3; F241(a): the advance job opens it)');
select throws_ok(
  $$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 9, '[{"team_id": "c7000000-0000-4000-8000-000000000001", "points": 1}]') $$,
  'P0001', 'score_write_week_batch: week_not_scheduled — league b7000000-0000-4000-8000-000000000001 has no league_weeks row for season 2026 week 9',
  'E4 a week with no league_weeks row is refused by name (week_not_scheduled)');
select throws_ok(
  $$ select public.score_write_week_batch('b7000000-0000-4000-8000-0000000000ff', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000001", "points": 1}]') $$,
  'P0002', null, 'E5 an unknown league is P0002');
select throws_ok(
  $$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000021", "points": 1}]') $$,
  'P0002', 'score_write_week_batch: the batch names 1 team(s) that are not league b7000000-0000-4000-8000-000000000001''s',
  'E5b a team of ANOTHER league in the batch is P0002 (a mapping bug is loud, never a skip)');

-- Shape (22023).
select throws_ok($$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '{"team_id": "x"}') $$, '22023', null, 'E6 p_scores must be an array');
select throws_ok($$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[]') $$, '22023', null, 'E6b …and not empty');
select throws_ok($$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"points": 1}]') $$, '22023', null, 'E6c an element without team_id');
select throws_ok($$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"team_id": "not-a-uuid", "points": 1}]') $$, '22023', null, 'E6d …or with a non-uuid team_id');
select throws_ok($$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000001", "points": 1}, {"team_id": "c7000000-0000-4000-8000-000000000001", "points": 2}]') $$, '22023', null, 'E6e a team twice in one batch');
select throws_ok($$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000001"}]') $$, '22023', null, 'E6f a missing points key (send null for pending — never omit)');
select throws_ok($$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000001", "points": "12.5"}]') $$, '22023', null, 'E6g points as a STRING is refused (a number or null)');
select throws_ok(
  $$ select public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000001", "points": 12.345}]') $$,
  '22023', 'score_write_week_batch: element 1 (team c7000000-0000-4000-8000-000000000001) points 12.345 has more than two decimals — the worker rounds (F22); the door never does',
  'E7 THREE decimals are REFUSED by name — the DB never rounds a divergent value (F22)');
select is(
  (select home_score::text from matchups where id = 'd7000000-0000-4000-8000-000000000031'), '0',
  'E7b …and the refused batch wrote nothing (the cell holds 109''s DEFAULT 0)');
select is(
  (select count(*) from rt19_msgs where topic = 'league:b7000000-0000-4000-8000-000000000001' and event = 'matchups' and payload ->> 'operation' = 'UPDATE'),
  1::bigint, 'E7c …the only L1 matchups UPDATE event so far is E2c''s (every refusal emitted nothing)');

-- ---------------------------------------------------------------------------
-- F. The door — THE batch: skips by name beside siblings that wrote, ONE
--    event, the DoD override pin, idempotence, E61
-- ---------------------------------------------------------------------------
select set_config('pgtap.d0', pg_temp.rt19_digest_m('b7000000-0000-4000-8000-000000000001'), true);
select set_config('pgtap.e0', pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups')::text, true);
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[
  {"team_id": "c7000000-0000-4000-8000-000000000001", "points": 100.5},
  {"team_id": "c7000000-0000-4000-8000-000000000002", "points": 90},
  {"team_id": "c7000000-0000-4000-8000-000000000003", "points": 88.10},
  {"team_id": "c7000000-0000-4000-8000-000000000004", "points": 77},
  {"team_id": "c7000000-0000-4000-8000-000000000005", "points": 55},
  {"team_id": "c7000000-0000-4000-8000-000000000006", "points": 66},
  {"team_id": "c7000000-0000-4000-8000-000000000007", "points": null},
  {"team_id": "c7000000-0000-4000-8000-000000000008", "points": 40.25}]')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'written')::int, 4,
  'F1 the eight-team batch wrote FOUR rows: m31, m34 and the two secondary rows (the overridden m32 and the final m33 were not written)');
select is(current_setting('pgtap.r')::jsonb -> 'skipped',
  '[{"reason": "overridden", "matchup_id": "d7000000-0000-4000-8000-000000000032", "round_type": "regular"},
    {"reason": "matchup_final", "matchup_id": "d7000000-0000-4000-8000-000000000033", "round_type": "regular"}]'::jsonb,
  'F1b …the two protected rows are NAMED with their reasons (exact jsonb)');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', null, 'F1c …no reason: something was written');
select is((current_setting('pgtap.r')::jsonb ->> 'writable')::int, 4, 'F1d …writable 4, ');
select is((current_setting('pgtap.r')::jsonb ->> 'unchanged')::int, 0, 'F1e …unchanged 0');
select is(
  (select string_agg(m.id::text || '=' || coalesce(m.home_score::text, 'NULL') || '/' || coalesce(m.away_score::text, 'NULL'), ',' order by m.id)
   from matchups m where m.league_id = 'b7000000-0000-4000-8000-000000000001' and m.week = 3),
  'd7000000-0000-4000-8000-000000000031=100.5/90,d7000000-0000-4000-8000-000000000032=101.00/88.10,d7000000-0000-4000-8000-000000000033=50.00/60.00,d7000000-0000-4000-8000-000000000034=NULL/40.25,d7000000-0000-4000-8000-000000000041=100.5/88.10,d7000000-0000-4000-8000-000000000042=90/77',
  'F2 GOLDEN (stored literal): m31 100.5/90 · m32 UNTOUCHED 101.00/88.10 · m33 UNTOUCHED 50.00/60.00 · m34 NULL/40.25 (E61: null wrote NULL, never 0) · s41 100.5/88.10 (T3''s total lands on its writable secondary row though its primary is overridden) · s42 90/77');
select is(
  (select home_score::text || ':' || away_score::text || ':' || result || ':' || is_overridden::text from matchups where id = 'd7000000-0000-4000-8000-000000000032'),
  '101.00:88.10:away:true',
  'F3 THE DoD PIN — the OVERRIDDEN row''s cells AND result are byte-identical after a batch naming BOTH its teams (§22.2; probe 1 lets the door write it and this reds)');
select is(
  (select status || ':' || home_score::text || ':' || away_score::text || ':' || result from matchups where id = 'd7000000-0000-4000-8000-000000000033'),
  'final:50.00:60.00:away', 'F3b the FINAL row is untouched too (D292: never a final matchup)');
select is((select status from matchups where id = 'd7000000-0000-4000-8000-000000000031'), 'live',
  'F3c the door never writes status (F241(a): finalize''s and the advance job''s)');
select is((select result from matchups where id = 'd7000000-0000-4000-8000-000000000031'), null,
  'F3d …nor result (finalize''s E38 derivation)');

-- ONE event per league per batch, by COUNT.
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups') - current_setting('pgtap.e0')::bigint, 1::bigint,
  'F4 ONE `matchups` event for the whole four-row batch (§9.1/§22.2 — probe 2 splits the door into per-cell UPDATEs and this reds)');
select is(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') ->> 'operation', 'UPDATE', 'F4b …operation UPDATE');
select is(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') ->> 'table', 'matchups', 'F4c …table matchups (070''s envelope)');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') -> 'record' ->> 'week')::int, 3, 'F4d …record.week = 3 (the client''s week-scoped reducer reads it)');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') -> 'record' ->> 'count')::int, 4, 'F4e …record.count = 4');
select is(jsonb_array_length(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') -> 'record' -> 'matchups'), 4, 'F4f …record.matchups carries exactly the four CHANGED rows');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') -> 'record' -> 'matchups' -> 0) k),
  array['away_score', 'away_seed', 'away_team_id', 'home_score', 'home_seed', 'home_team_id', 'id', 'is_overridden', 'result', 'round_type', 'season', 'status', 'updated_at', 'week'],
  'F4g …each row column-selected (the D1 literal) on the STORED message');
select ok(
  (select p::text not like '%scoring_rules_snapshot%' and p::text not like '%player_id%' and p::text not like '%starters%' and p::text not like '%override_action_id%'
   from (select pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') p) x),
  'F4h …nothing blind on the wire: no scoring snapshot, no per-player keys, no audit id');
select ok(
  (select bool_and(private and extension = 'broadcast') from rt19_msgs where topic = 'league:b7000000-0000-4000-8000-000000000001' and event = 'matchups'),
  'F4i …every matchups message is PRIVATE and a broadcast (§9.1 — no Postgres Changes anywhere)');
select is(
  (select array_agg((r ->> 'id') order by (r ->> 'id')) from jsonb_array_elements(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') -> 'record' -> 'matchups') r),
  array['d7000000-0000-4000-8000-000000000031', 'd7000000-0000-4000-8000-000000000034', 'd7000000-0000-4000-8000-000000000041', 'd7000000-0000-4000-8000-000000000042'],
  'F4j …and they are exactly the four written rows (the protected two are not on the wire either)');

-- Idempotence (rule 10): the identical re-send.
select set_config('pgtap.d1', pg_temp.rt19_digest_m('b7000000-0000-4000-8000-000000000001'), true);
select set_config('pgtap.e1', pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups')::text, true);
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[
  {"team_id": "c7000000-0000-4000-8000-000000000001", "points": 100.50},
  {"team_id": "c7000000-0000-4000-8000-000000000002", "points": 90.0},
  {"team_id": "c7000000-0000-4000-8000-000000000003", "points": 88.1},
  {"team_id": "c7000000-0000-4000-8000-000000000004", "points": 77},
  {"team_id": "c7000000-0000-4000-8000-000000000005", "points": 55},
  {"team_id": "c7000000-0000-4000-8000-000000000006", "points": 66},
  {"team_id": "c7000000-0000-4000-8000-000000000007", "points": null},
  {"team_id": "c7000000-0000-4000-8000-000000000008", "points": 40.25}]')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'written')::int, 0, 'F5 the identical re-send (scale-varied renderings of the same values) writes ZERO rows');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'no_change', 'F5b …said out loud: no_change (rule 10 — loud emptiness)');
select is((current_setting('pgtap.r')::jsonb ->> 'unchanged')::int, 4, 'F5c …unchanged 4 (the writable rows, all equal)');
select is(pg_temp.rt19_digest_m('b7000000-0000-4000-8000-000000000001'), current_setting('pgtap.d1'), 'F5d …the matchups digest is unchanged');
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups') - current_setting('pgtap.e1')::bigint, 0::bigint,
  'F5e …and ZERO events (the statement trigger saw an empty transition table and sent nothing)');

-- A partial batch coalesces per row.
select set_config('pgtap.e1', pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups')::text, true);
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000002", "points": 91}]')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'written')::int, 2, 'F6 one team''s new total writes its TWO rows (m31 away, s42 home)');
select is((select home_score::text || '/' || away_score::text from matchups where id = 'd7000000-0000-4000-8000-000000000031'), '100.5/91',
  'F6b …m31: the away cell moved, the home cell (not in the batch) kept 100.5');
select is((select home_score::text from matchups where id = 'd7000000-0000-4000-8000-000000000042'), '91', 'F6c …s42 home 91');
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups') - current_setting('pgtap.e1')::bigint, 1::bigint,
  'F6d …ONE event for the two rows (count 2 on the record)');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') -> 'record' ->> 'count')::int, 2, 'F6e …record.count = 2');

-- E61 both ways: a written score → NULL (pending), never 0.
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000008", "points": null}]')::text, true);
select is((select coalesce(away_score::text, 'NULL') from matchups where id = 'd7000000-0000-4000-8000-000000000034'), 'NULL',
  'F7 E61: a team that goes PENDING writes NULL over its written 40.25 — never 0 (a written score is never turned into 0)');
select is((select coalesce(home_score::text, 'NULL') from matchups where id = 'd7000000-0000-4000-8000-000000000034'), 'NULL',
  'F7b …the other cell (pending since F1) stays NULL, untouched');

-- All-protected batch: nothing_writable, no event.
select set_config('pgtap.e1', pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups')::text, true);
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000005", "points": 1}, {"team_id": "c7000000-0000-4000-8000-000000000006", "points": 2}]')::text, true);
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'nothing_writable', 'F8 a batch whose every touched row is protected says nothing_writable');
select is((current_setting('pgtap.r')::jsonb ->> 'written')::int, 0, 'F8b …written 0');
select is(jsonb_array_length(current_setting('pgtap.r')::jsonb -> 'skipped'), 1, 'F8c …the one final row named ONCE though both its teams were in the batch');
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups') - current_setting('pgtap.e1')::bigint, 0::bigint, 'F8d …no event');

-- A team with no row this week: named, not an error.
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 4, '[{"team_id": "c7000000-0000-4000-8000-000000000003", "points": 10}]')::text, true);
select is(current_setting('pgtap.r')::jsonb -> 'skipped', '[{"reason": "no_matchup_row", "team_id": "c7000000-0000-4000-8000-000000000003"}]'::jsonb,
  'F9 a team with no pairing row this week (an eliminated seat / a bye-less week) is SKIPPED by name, never a refusal of the batch');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'nothing_writable', 'F9b …nothing_writable');

-- ---------------------------------------------------------------------------
-- G. The door — a bracket row (F257(a)/(a′)): an unbatched DEFAULT-0 cell is
--    never touched; a rebuilt row (new id, same pairing) is found by the
--    pairing
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000004', 7, '[{"team_id": "c7000000-0000-4000-8000-000000000041", "points": 77.7}]')::text, true);
select is((select home_score::text || '/' || away_score::text from matchups where id = 'd7000000-0000-4000-8000-000000000097'), '77.7/0',
  'G1 the bracket row: the batched home cell 77.7; the UNBATCHED away cell keeps 109''s DEFAULT 0 (the door never touches a cell whose team it was not sent — the sentinel''s READING is the sync''s, F257(a))');
-- A rebuild (118: DELETE + INSERT — new ids, same pairing, seeds frozen).
delete from matchups where id = 'd7000000-0000-4000-8000-000000000097';
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_seed, away_seed, status) values
 ('d7000000-0000-4000-8000-000000000098', 'b7000000-0000-4000-8000-000000000004', 2026, 7, 'playoff', 'c7000000-0000-4000-8000-000000000041', 'c7000000-0000-4000-8000-000000000042', 1, 4, 'live');
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000004', 7, '[{"team_id": "c7000000-0000-4000-8000-000000000041", "points": 78.8}, {"team_id": "c7000000-0000-4000-8000-000000000042", "points": 65}]')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'written')::int, 1, 'G2 after the rebuild the batch still writes ONE row —');
select is((select home_score::text || '/' || away_score::text from matchups where id = 'd7000000-0000-4000-8000-000000000098'), '78.8/65',
  'G2b …the NEW row (found by (league, season, week, side team) in the write statement — never a cached id, F257(a′))');
select is(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000004', 'matchups') ->> 'operation', 'UPDATE', 'G2c …and the last L4 matchups event is the door''s UPDATE');
select is(
  (select array_agg(payload ->> 'operation' order by cmd, tid) from rt19_msgs where topic = 'league:b7000000-0000-4000-8000-000000000004' and event = 'matchups'),
  array['INSERT', 'INSERT', 'UPDATE', 'UPDATE', 'DELETE', 'INSERT', 'UPDATE'],
  'G2d the L4 event history: two fixture INSERT statements, E1b''s + G1''s door UPDATEs, the rebuild''s DELETE + INSERT (one event each — a Remix/bracket reaches an open schedule page), G2''s UPDATE');

-- ---------------------------------------------------------------------------
-- H. The door — total_points: provisional team_week_results rows
-- ---------------------------------------------------------------------------
select set_config('pgtap.e1', pg_temp.rt19_events('b7000000-0000-4000-8000-000000000002', 'team_week_results')::text, true);
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000002', 3, '[
  {"team_id": "c7000000-0000-4000-8000-000000000021", "points": 10},
  {"team_id": "c7000000-0000-4000-8000-000000000022", "points": 20.5},
  {"team_id": "c7000000-0000-4000-8000-000000000023", "points": null}]')::text, true);
select is(current_setting('pgtap.r')::jsonb ->> 'mode', 'total_points', 'H1 the mode is read from the league''s settings');
select is((current_setting('pgtap.r')::jsonb ->> 'written')::int, 2, 'H1b two PROVISIONAL rows written');
select is(current_setting('pgtap.r')::jsonb -> 'skipped', '[{"reason": "pending_no_row", "team_id": "c7000000-0000-4000-8000-000000000023"}]'::jsonb,
  'H1c …the pending team writes NO row (absence is this mode''s pending word — F241(b)), named');
select is(
  (select string_agg(r.team_id::text || '=' || r.points::text || ':' || r.is_final::text, ',' order by r.team_id) from team_week_results r where r.league_id = 'b7000000-0000-4000-8000-000000000002'),
  'c7000000-0000-4000-8000-000000000021=10.00:false,c7000000-0000-4000-8000-000000000022=20.50:false',
  'H1d GOLDEN: U1 10.00 / U2 20.50, both is_final FALSE; no row for U3 or U4');
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000002', 'team_week_results') - current_setting('pgtap.e1')::bigint, 1::bigint,
  'H1e ONE team_week_results event for the two-row INSERT');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000002', 'team_week_results') -> 'record') - 'results',
  '{"week": 3, "count": 2, "season": 2026, "is_final": false}'::jsonb, 'H1f …record {season, week, count, is_final false} + the rows');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000002', 'team_week_results') -> 'record' -> 'results' -> 0) k),
  array['h2h_result', 'is_final', 'median_result', 'opponent_team_id', 'points', 'season', 'second_opponent_team_id', 'second_result', 'team_id', 'week'],
  'H1g …each result column-selected (the D2 literal) on the stored message');
-- Idempotent re-send.
select set_config('pgtap.e1', pg_temp.rt19_events('b7000000-0000-4000-8000-000000000002', 'team_week_results')::text, true);
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000002', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000021", "points": 10.0}, {"team_id": "c7000000-0000-4000-8000-000000000022", "points": 20.50}]')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'written')::int, 0, 'H2 the identical re-send writes zero rows');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'no_change', 'H2b …no_change');
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000002', 'team_week_results') - current_setting('pgtap.e1')::bigint, 0::bigint, 'H2c …no event');
-- A changed value: an UPDATE event.
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000002', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000021", "points": 11}]')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'written')::int, 1, 'H3 a moved total rewrites its row');
select is(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000002', 'team_week_results') ->> 'operation', 'UPDATE', 'H3b …as an UPDATE event');
select is((select points::text from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000002' and team_id = 'c7000000-0000-4000-8000-000000000021'), '11.00', 'H3c …11.00 stored');
-- A FINAL row is never overwritten (a reopened week — M6's path).
update team_week_results set is_final = true where league_id = 'b7000000-0000-4000-8000-000000000002' and team_id = 'c7000000-0000-4000-8000-000000000022';
select set_config('pgtap.r', public.score_write_week_batch('b7000000-0000-4000-8000-000000000002', 3, '[{"team_id": "c7000000-0000-4000-8000-000000000022", "points": 99}]')::text, true);
select is(current_setting('pgtap.r')::jsonb -> 'skipped', '[{"reason": "result_final", "team_id": "c7000000-0000-4000-8000-000000000022"}]'::jsonb,
  'H4 a FINAL result row is skipped by name (result_final)');
select is((select points::text from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000002' and team_id = 'c7000000-0000-4000-8000-000000000022'), '20.50', 'H4b …its points untouched');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'nothing_writable', 'H4c …nothing_writable');

-- Held-lock discipline (rule 8): min RTT of three door calls < 50 ms.
create temp table rt19_rtt (secs double precision);
do $$
declare v_t0 timestamptz; v_i int; begin
  for v_i in 1..3 loop
    v_t0 := clock_timestamp();
    perform public.score_write_week_batch('b7000000-0000-4000-8000-000000000001', 3,
      ('[{"team_id": "c7000000-0000-4000-8000-000000000001", "points": ' || (200 + v_i)::text || '}]')::jsonb);
    insert into rt19_rtt values (extract(epoch from clock_timestamp() - v_t0));
  end loop;
end $$;
select cmp_ok((select min(secs) from rt19_rtt), '<', 0.05::double precision,
  'I1 held-lock discipline (rule 8): the min RTT of three door calls is under 50 ms');

-- ---------------------------------------------------------------------------
-- J. The other three triggers behaviourally
-- ---------------------------------------------------------------------------
-- league_weeks: a status flip emits; a median_score-only write does not.
select set_config('pgtap.e1', pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'league_weeks')::text, true);
update league_weeks set status = 'correction_window' where league_id = 'b7000000-0000-4000-8000-000000000001' and week = 3;
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'league_weeks') - current_setting('pgtap.e1')::bigint, 1::bigint,
  'J1 a league_weeks STATUS flip (live → correction_window) broadcasts ONE league_weeks event');
select is(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'league_weeks') -> 'record',
  '{"week": 3, "season": 2026, "status": "correction_window", "median_score": null, "finalized_at": null}'::jsonb,
  'J1b …with exactly the D4 record (exact jsonb)');
update league_weeks set median_score = 95.02 where league_id = 'b7000000-0000-4000-8000-000000000001' and week = 3;
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'league_weeks') - current_setting('pgtap.e1')::bigint, 1::bigint,
  'J1c a median_score-only write emits NOTHING (column-triggered on status — the 070 discriminator)');

-- transactions: one row, one event, the blob never forwarded.
insert into transactions (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id) values
 ('f7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001', 'add_drop', 'complete',
  'c7000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001',
  '{"add_player_id": "rt19-fa-wr", "drop_player_id": "rt19-kc-rb", "faab": 17, "action_id": "afd00000-0000-4000-8000-000000000002"}',
  3, 'afd00000-0000-4000-8000-000000000002');
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'transactions'), 1::bigint, 'J2 a transactions INSERT broadcasts ONE transactions event on league:<id>');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'transactions') -> 'record') - 'created_at',
  '{"id": "f7000000-0000-4000-8000-000000000001", "type": "add_drop", "week": 3, "status": "complete", "add_player_id": "rt19-fa-wr", "drop_player_id": "rt19-kc-rb", "initiator_team_id": "c7000000-0000-4000-8000-000000000001"}'::jsonb,
  'J2b …with exactly the D3 record (exact jsonb, created_at aside)');
select ok(
  (select p::text not like '%faab%' and p::text not like '%afd00000-0000-4000-8000-000000000002%' and p::text not like '%97000000-0000-4000-8000-000000000001%'
   from (select pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'transactions') p) x),
  'J2c …the planted faab amount, the action_id and the initiating user are NOT on the wire');

-- team_week_results: a three-row statement is ONE event; a three-row UPDATE too.
select set_config('pgtap.e1', pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'team_week_results')::text, true);
insert into team_week_results (league_id, team_id, season, week, points, is_final)
select 'b7000000-0000-4000-8000-000000000001', ('c7000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, 2026, 5, i * 10.00, true
from generate_series(1, 3) i;
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'team_week_results') - current_setting('pgtap.e1')::bigint, 1::bigint,
  'J3 a three-row team_week_results INSERT (finalization''s shape) is ONE event');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'team_week_results') -> 'record' ->> 'count')::int, 3, 'J3b …count 3');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'team_week_results') -> 'record' ->> 'is_final')::boolean, true, 'J3c …is_final true (every row final)');
update team_week_results set median_result = 'win' where league_id = 'b7000000-0000-4000-8000-000000000001' and week = 5;
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'team_week_results') - current_setting('pgtap.e1')::bigint, 2::bigint,
  'J3d …the three-row median UPDATE is one more event (two statements, two events)');

-- matchups: a DELETE statement is one event; a zero-row UPDATE is none.
select set_config('pgtap.e1', pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups')::text, true);
delete from matchups where id = 'd7000000-0000-4000-8000-000000000071';
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups') - current_setting('pgtap.e1')::bigint, 1::bigint, 'J4 a matchups DELETE statement is ONE event');
select is(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') ->> 'operation', 'DELETE', 'J4b …operation DELETE');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') -> 'record' ->> 'week')::int, 6, 'J4c …naming its week');
update matchups set home_score = 1 where league_id = 'b7000000-0000-4000-8000-000000000001' and week = 42;
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'matchups') - current_setting('pgtap.e1')::bigint, 1::bigint,
  'J4d a zero-row UPDATE statement emits NOTHING (empty transition table)');
-- A statement spanning two weeks carries week NULL (the client refetches conservatively).
update matchups set updated_at = updated_at where league_id = 'b7000000-0000-4000-8000-000000000001' and week in (4, 5);
select is(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') -> 'record' -> 'week', 'null'::jsonb,
  'J4e a statement touching TWO weeks carries week null (the reducer''s no-week arm refetches — R773)');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'matchups') -> 'record' ->> 'count')::int, 2, 'J4f …count 2');

-- ---------------------------------------------------------------------------
-- K. The tick's ONE coalesced league_player_pool broadcast (F252(a))
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:14:59+00', 'b7000000-0000-4000-8000-000000000001')::text, true);
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'league_player_pool'), 0::bigint,
  'K1 kickoff −1s: no pool row changed, NO league_player_pool event');
select is((current_setting('pgtap.r')::jsonb ->> 'pool_events')::int, 0, 'K1b …the report says pool_events 0');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'b7000000-0000-4000-8000-000000000001')::text, true);
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'league_player_pool'), 1::bigint,
  'K2 kickoff +1s: THREE pool rows locked (rostered / free_agent / on_waivers) — exactly ONE league_player_pool event (coalesced per league per pass, never per row)');
select is(pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'league_player_pool') - 'id',
  '{"table": "league_player_pool", "record": {"at": "2026-09-25T00:15:01+00:00", "week": 3, "season": 2026, "changed": 3}, "schema": "public", "operation": "UPDATE"}'::jsonb,
  'K2b …the summary envelope: operation UPDATE, record {season, week, changed 3, at} — no per-player lines (the client refetches the rosters route)');
select is((current_setting('pgtap.r')::jsonb ->> 'pool_events')::int, 1, 'K2c …the report says pool_events 1');
select is((current_setting('pgtap.r')::jsonb ->> 'pool_updates')::int, 3, 'K2d …pool_updates 3 (116''s counter, unchanged)');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00', 'b7000000-0000-4000-8000-000000000001')::text, true);
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'league_player_pool'), 1::bigint,
  'K3 the same instant again: nothing changed, NO new event (idempotent — 064 D3''s twin)');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'no_changes', 'K3b …no_changes');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-29 04:00:00+00', 'b7000000-0000-4000-8000-000000000001')::text, true);
select is(pg_temp.rt19_events('b7000000-0000-4000-8000-000000000001', 'league_player_pool'), 2::bigint,
  'K4 the release instant: one more event (three rows released in one pass)');
select is((pg_temp.rt19_last('b7000000-0000-4000-8000-000000000001', 'league_player_pool') -> 'record' ->> 'changed')::int, 3, 'K4b …changed 3');

-- ---------------------------------------------------------------------------
-- L. Channel auth on the NEW events (the 024 §H shape; the wire twin is the
--    vitest)
-- ---------------------------------------------------------------------------
select set_config('pgtap.n', (select count(*) from rt19_msgs where topic = 'league:b7000000-0000-4000-8000-000000000001'
                              and event in ('matchups', 'team_week_results', 'transactions', 'league_weeks', 'league_player_pool'))::text, true);
select cmp_ok(current_setting('pgtap.n')::bigint, '>', 5::bigint, 'L0 the L1 topic holds events of all five kinds (the positive control is not a dead room)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select set_config('realtime.topic', 'league:b7000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from realtime.messages where topic = 'league:b7000000-0000-4000-8000-000000000001'
     and event in ('matchups', 'team_week_results', 'transactions', 'league_weeks', 'league_player_pool')
     and inserted_at >= now()),
  current_setting('pgtap.n')::bigint, 'L1 the MEMBER reads every in-season event on their league topic (070''s policy covers the family)');
select set_config('request.jwt.claims', '{"sub": "97000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
select is(
  (select count(*) from realtime.messages where topic = 'league:b7000000-0000-4000-8000-000000000001'
     and event in ('matchups', 'team_week_results', 'transactions', 'league_weeks', 'league_player_pool')
     and inserted_at >= now()),
  0::bigint, 'L2 the NON-MEMBER reads ZERO (probe 3 — a public topic — reds this and the vitest''s non-member cell)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select set_config('realtime.topic', 'league:b7000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from realtime.messages where topic = 'league:b7000000-0000-4000-8000-000000000001'
     and event in ('matchups', 'team_week_results', 'transactions', 'league_weeks', 'league_player_pool')
     and inserted_at >= now()),
  0::bigint, 'L3 ANON reads ZERO');
reset role;

select * from finish();
rollback;
