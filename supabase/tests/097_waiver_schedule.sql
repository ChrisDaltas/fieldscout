-- ============================================================================
-- The waiver schedule (Q70 as ruled) and the add / drop it changes — pgTAP 097
-- (M5 task L.D2.7; migration 149; spec §7.3.4 / §13.1 / §16.4 v2.16.59;
-- PROGRESS Q70 / Q73 / Q74 / Q78, F229 / F239 / F240, D388).
--
-- Numbering: reserved 149 / 097, heads measured 148 / 096.
-- OWN FIXTURE: users 997…, leagues b97…, teams c97…, action ids a97…,
-- players ws-*. The 2026 calendar is pinned INSIDE this transaction (weeks
-- 1–7 end on their Tuesday floors, week 7 at Tue 2026-10-27 00:00 PDT =
-- 07:00Z, week 8 at Tue 2026-11-03 00:00 PST = 08:00Z, week 9 at 2026-11-10
-- 08:00Z) and every add runs at an INJECTED instant, so no pin rots with the
-- wall clock. Week 8 straddles the 2026-11-01 fall-back.
--
-- Falsifiability (tasks-M1 §4.3):
--   * Every instant is a STORED LITERAL worked out by hand from the zone
--     rules — the SAME literals `waiver-schedule.test.ts` pins in TS (the
--     twin), incl. both DST edges (01:30 on the fall-back day = the LATER
--     instant; 02:30 on the spring-forward day = 03:30 on the new clock).
--   * BOUNDARY INSTANTS: an add refused one second before free agency opens
--     and allowed AT the instant — for a waiver run (league 2) and for a
--     weekday opening (league 1, the fall-back Sunday, 14:00Z not 13:00Z);
--     a dropped player refused at the run −1s and allowed AT it.
--   * Q74 ORDER: a kicked-off, claim-only player is refused as LOCKED; his
--     unlocked twin at the same instant is refused as claim-only.
--   * PERMISSIONS PER ROLE on the setting verb: anon (no EXECUTE), a
--     non-member and a plain manager (no-leak 42501), the commissioner
--     (lives, one receipt); every new internal closed to anon/authenticated.
--   * BREAK PROBES shown red in the PR, then reverted: (1) a run AT the reset
--     stops counting (`>=` → `>`) ⇒ E10a red; (2) the settled-run gate
--     removed from waiver_window_internal ⇒ E11 red; (3) EXECUTE on
--     waiver_window_internal granted to authenticated ⇒ I1 red. Fix round
--     (PR #334): (4) an opening AT the reset opens (`>` → `>=`) ⇒ E10c red;
--     (5) the posix/right refusal removed from the zone arm ⇒ H10b red.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(102);

-- ---------------------------------------------------------------------------
-- A. Form: the column, the CHECK, the index, the retired keys unstorable
-- ---------------------------------------------------------------------------
select is(
  (select format('%s:%s', data_type, is_nullable) from information_schema.columns
   where table_schema = 'public' and table_name = 'leagues' and column_name = 'waiver_next_run_at'),
  'timestamp with time zone:YES',
  'A1 leagues.waiver_next_run_at is a nullable timestamptz (NULL = the processor does not track the league yet)');
select is(
  (select count(*)::int from pg_constraint where conrelid = 'public.leagues'::regclass and conname = 'leagues_settings_no_retired_waiver_keys' and contype = 'c'),
  1, 'A2 the retired-keys CHECK exists');
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'leagues' and indexname = 'idx_leagues_waiver_next_run_at'),
  1, 'A3 the partial index for the tick exists');
select is(
  (select count(*)::int from leagues
   where settings ?| array['waiver_process_day', 'waiver_process_time', 'waiver_period_hours', 'free_agency', 'bench_lock']),
  0, 'A4 no stored league carries a retired key after the rewrite');
-- R1187 (PR #334 fix round): the blob mapping pinned as STORED LITERALS — the SAME literals
-- split-merge.test.ts pins for the TS read-side twin (`waiverScheduleFromLegacy`), so the app reads a
-- pre-149 row exactly as 149 rewrites it.
select is(
  public.waiver_schedule_from_legacy_internal(
    '{"waiver_process_day": "tue", "waiver_process_time": "01:30", "waiver_period_hours": 24, "free_agency": "continuous", "bench_lock": false, "faab_min_bid": 1}'::jsonb),
  '{"faab_min_bid": 1, "waiver_run_days": ["tue"], "waiver_run_time": "01:30", "waiver_time_zone": "America/New_York", "free_agency_opens": "after_waiver_run", "free_agency_open_day": "sun", "free_agency_open_time": "06:00"}'::jsonb,
  'A4a a pre-149 Tuesday 01:30 league keeps its day and time, read in Eastern; the five retired keys are stripped');
select is(
  public.waiver_schedule_from_legacy_internal(
    '{"waiver_process_day": "thu", "waiver_process_time": "11:00", "bench_lock": true, "waiver_run_days": ["wed"], "waiver_run_time": "00:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "never", "free_agency_open_day": "mon", "free_agency_open_time": "07:15"}'::jsonb),
  '{"waiver_run_days": ["wed"], "waiver_run_time": "00:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "never", "free_agency_open_day": "mon", "free_agency_open_time": "07:15"}'::jsonb,
  'A4b a blob carrying BOTH vocabularies: every new key wins and the retired keys are stripped');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99700000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-ws' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'ws_user' || i)::jsonb, now(), now()
from generate_series(1, 4) i;

select throws_ok(
  $$ insert into leagues (owner_id, name, season, status, settings) values
       ('99700000-0000-4000-8000-000000000001', 'pgtap-ws-bad1', 2026, 'setup', '{"waiver_period_hours": 48}') $$,
  '23514', null, 'A5 waiver_period_hours is unstorable (23514)');
select throws_ok(
  $$ insert into leagues (owner_id, name, season, status, settings) values
       ('99700000-0000-4000-8000-000000000001', 'pgtap-ws-bad2', 2026, 'setup', '{"free_agency": "continuous"}') $$,
  '23514', null, 'A6 free_agency is unstorable (23514)');
select throws_ok(
  $$ insert into leagues (owner_id, name, season, status, settings) values
       ('99700000-0000-4000-8000-000000000001', 'pgtap-ws-bad3', 2026, 'setup', '{"waiver_process_day": "wed", "waiver_process_time": "03:00"}') $$,
  '23514', null, 'A7 waiver_process_day / waiver_process_time are unstorable (23514)');
select throws_ok(
  $$ insert into leagues (owner_id, name, season, status, settings) values
       ('99700000-0000-4000-8000-000000000001', 'pgtap-ws-bad4', 2026, 'setup', '{"bench_lock": true}') $$,
  '23514', null, 'A8 bench_lock is unstorable (23514) — Q73 retired it');
select lives_ok(
  $$ insert into leagues (owner_id, name, season, status, settings) values
       ('99700000-0000-4000-8000-000000000001', 'pgtap-ws-ok', 2026, 'setup', '{"waiver_run_days": ["wed"], "waiver_run_time": "03:00"}') $$,
  'A9 the new keys store (the key-free twin of A5–A8)');

-- ---------------------------------------------------------------------------
-- B. The legacy mapping (what 149 did to every stored blob)
-- ---------------------------------------------------------------------------
select is(
  public.waiver_schedule_from_legacy_internal('{"waiver_process_day": "tue", "waiver_process_time": "11:30", "waiver_period_hours": 24, "free_agency": "continuous", "bench_lock": false, "fa_hold_hours": 3}'),
  '{"fa_hold_hours": 3, "waiver_run_days": ["tue"], "waiver_run_time": "11:30", "waiver_time_zone": "America/New_York", "free_agency_opens": "after_waiver_run", "free_agency_open_day": "sun", "free_agency_open_time": "06:00"}'::jsonb,
  'B1 the old day and time are KEPT in America/New_York (D60''s ET), free agency after the run; the retired keys and bench_lock stripped; other keys untouched');
select is(
  public.waiver_schedule_from_legacy_internal('{}'),
  '{"waiver_run_days": ["wed"], "waiver_run_time": "03:00", "waiver_time_zone": "America/New_York", "free_agency_opens": "after_waiver_run", "free_agency_open_day": "sun", "free_agency_open_time": "06:00"}'::jsonb,
  'B2 an empty blob takes the catalog default (Wednesday 03:00 Eastern)');
select is(
  public.waiver_schedule_from_legacy_internal('{"waiver_process_day": "fri", "waiver_process_time": "3:00"}') -> 'waiver_run_days',
  '["wed"]'::jsonb, 'B3 an invalid old value falls back to the default, never to garbage');
select is(
  public.waiver_schedule_from_legacy_internal('{"waiver_process_day": "tue", "waiver_run_days": ["sat"]}') -> 'waiver_run_days',
  '["sat"]'::jsonb, 'B4 a key already in the new vocabulary wins over an old one');

-- ---------------------------------------------------------------------------
-- C. The schedule document, validated by name
-- ---------------------------------------------------------------------------
select is(
  public.waiver_schedule_internal('{"waiver_run_days": ["sat", "tue", "wed", "thu", "fri"], "waiver_run_time": "09:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "day_and_time", "free_agency_open_day": "sun", "free_agency_open_time": "06:00"}', 'faab'),
  '{"waivers": true, "run_days": ["tue", "wed", "thu", "fri", "sat"], "run_dows": [2, 3, 4, 5, 6], "run_time": "09:00", "time_zone": "America/Los_Angeles", "free_agency_opens": "day_and_time", "free_agency_open_day": "sun", "open_dow": 0, "free_agency_open_time": "06:00"}'::jsonb,
  'C1 Chris''s league 1 as a document: days Sunday-first, dows 0-based');
select is(
  (public.waiver_schedule_internal('{}', 'none_fcfs') ->> 'waivers')::boolean, false,
  'C2 none_fcfs is a league with no waivers');
select throws_like(
  $$ select public.waiver_schedule_internal('{"waiver_run_days": []}', 'faab') $$,
  '%waiver_run_days must be a non-empty list%', 'C3 an empty day list is refused by name');
select throws_like(
  $$ select public.waiver_schedule_internal('{"waiver_run_days": ["weds"]}', 'faab') $$,
  '%waiver_run_days must be a non-empty list%', 'C4 an unknown day is refused by name');
select throws_like(
  $$ select public.waiver_schedule_internal('{"waiver_run_time": "9:00"}', 'faab') $$,
  '%waiver_run_time must be HH:MM%', 'C5 a malformed time is refused by name');
select throws_like(
  $$ select public.waiver_schedule_internal('{"waiver_time_zone": "Mars/Olympus"}', 'faab') $$,
  '%waiver_time_zone Mars/Olympus is not a time zone the database knows%', 'C6 an unknown zone is refused by name (never read as UTC)');

-- ---------------------------------------------------------------------------
-- D. The wall-clock arithmetic — the SAME literals as waiver-schedule.test.ts
-- ---------------------------------------------------------------------------
create temp table ws_sched (name text primary key, doc jsonb) on commit drop;
insert into ws_sched values
  ('daily',  public.waiver_schedule_internal('{"waiver_run_days": ["tue", "wed", "thu", "fri", "sat"], "waiver_run_time": "09:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "day_and_time", "free_agency_open_day": "sun", "free_agency_open_time": "06:00"}', 'faab')),
  ('weekly', public.waiver_schedule_internal('{"waiver_run_days": ["wed"], "waiver_run_time": "00:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "after_waiver_run"}', 'faab')),
  ('default', public.waiver_schedule_internal('{}', 'faab')),
  ('sun0130la', public.waiver_schedule_internal('{"waiver_run_days": ["sun"], "waiver_run_time": "01:30", "waiver_time_zone": "America/Los_Angeles"}', 'faab')),
  ('sun0230la', public.waiver_schedule_internal('{"waiver_run_days": ["sun"], "waiver_run_time": "02:30", "waiver_time_zone": "America/Los_Angeles"}', 'faab')),
  ('sun0130ny', public.waiver_schedule_internal('{"waiver_run_days": ["sun"], "waiver_run_time": "01:30", "waiver_time_zone": "America/New_York"}', 'faab')),
  ('tokyo', public.waiver_schedule_internal('{"waiver_run_days": ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], "waiver_run_time": "00:00", "waiver_time_zone": "Asia/Tokyo"}', 'faab'));

select is(public.waiver_next_run_internal((select doc from ws_sched where name = 'daily'), '2026-10-31 15:59:59+00'),
  '2026-10-31 16:00:00+00'::timestamptz, 'D1 league 1, Saturday 08:59:59 PDT: the next run is Saturday 09:00 PDT (16:00Z)');
select is(public.waiver_next_run_internal((select doc from ws_sched where name = 'daily'), '2026-10-31 16:00:00+00'),
  '2026-11-03 17:00:00+00'::timestamptz, 'D2 league 1, AT the Saturday run: strictly after is Tuesday 09:00 PST (17:00Z) — across the fall-back');
select is(public.waiver_next_run_internal((select doc from ws_sched where name = 'weekly'), '2026-10-28 07:00:00+00'),
  '2026-11-04 08:00:00+00'::timestamptz, 'D3 league 2, AT the Oct 28 run: the next is Wednesday 00:00 PST (08:00Z) — 169 hours later');
select is(public.waiver_next_run_internal((select doc from ws_sched where name = 'default'), '2026-10-28 07:00:00+00'),
  '2026-11-04 08:00:00+00'::timestamptz, 'D4 the default (Wednesday 03:00 Eastern) across the fall-back: 08:00Z');
select is(public.waiver_next_run_internal((select doc from ws_sched where name = 'sun0130la'), '2026-10-25 08:30:00+00'),
  '2026-11-01 09:30:00+00'::timestamptz, 'D5 AMBIGUOUS 01:30 on the fall-back day (Pacific) is the LATER instant — 01:30 PST');
select is(public.waiver_next_run_internal((select doc from ws_sched where name = 'sun0230la'), '2027-03-08 00:00:00+00'),
  '2027-03-14 10:30:00+00'::timestamptz, 'D6 NONEXISTENT 02:30 on the spring-forward day (Pacific) reads with the offset before the jump — 03:30 PDT');
select is(public.waiver_next_run_internal((select doc from ws_sched where name = 'sun0130ny'), '2026-10-25 05:30:00+00'),
  '2026-11-01 06:30:00+00'::timestamptz, 'D7 AMBIGUOUS 01:30 on the fall-back day (Eastern) — 01:30 EST');
select is(public.waiver_next_run_internal((select doc from ws_sched where name = 'tokyo'), '2026-11-01 15:00:00+00'),
  '2026-11-02 15:00:00+00'::timestamptz, 'D8 a zone with no DST (Tokyo midnight, every day)');
select is(public.waiver_last_run_internal((select doc from ws_sched where name = 'daily'), '2026-11-02 20:00:00+00'),
  '2026-10-31 16:00:00+00'::timestamptz, 'D9 league 1 on Monday: the latest run is Saturday''s');
select is(public.waiver_last_open_internal((select doc from ws_sched where name = 'daily'), '2026-11-02 20:00:00+00'),
  '2026-11-01 14:00:00+00'::timestamptz, 'D10 league 1''s Sunday 06:00 opening on the fall-back day is 14:00Z (PST), not 13:00Z');
select is(public.waiver_last_open_internal((select doc from ws_sched where name = 'daily'), '2026-11-01 13:59:59+00'),
  '2026-10-25 13:00:00+00'::timestamptz, 'D11 one second before it, the latest opening is the previous Sunday (06:00 PDT = 13:00Z)');

-- ---------------------------------------------------------------------------
-- Fixtures (postgres context). u1 commissioner of L1 / L2 / L3 / L5 (teams
-- A1 / B1 / C1 / E1); u2 manager of B2 (L2); u3 manager of A2 (L1) and E2
-- (L5); u4 outsider.
--   L1 = Chris's league 1: waivers Tue–Sat 09:00 Pacific, free agency from
--        Sunday 06:00 Pacific until the week's last game ends.
--   L2 = Chris's league 2: waivers Wednesday 00:00 Pacific ("Tuesday at
--        midnight"), free agency from the run until the week ends.
--   L3 = no waivers (none_fcfs).     L4 = league 2's schedule, no free agency.
--   L5 = league 1's schedule, a draft completed Sat 2026-09-05 23:00 PDT.
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case
      when w.week <= 7 then w.starts_at + interval '6 days 3 hours'
      when w.week = 8 then '2026-11-03 08:00:00+00'::timestamptz
      when w.week = 9 then '2026-11-10 08:00:00+00'::timestamptz
    end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('ws-g8',  2026, 8,  'KC', 'BUF', '2026-10-30 00:15:00+00'),   -- Thursday night of week 8
 ('ws-g9',  2026, 9,  'KC', 'BUF', '2026-11-06 01:15:00+00'),
 ('ws-g10', 2026, 10, 'KC', 'BUF', '2026-11-13 01:15:00+00');

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, waiver_type, settings, roster_settings)
select v.id::uuid, '99700000-0000-4000-8000-000000000001', v.nm, 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', v.wt, v.s::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}'
from (values
  ('b9700000-0000-4000-8000-000000000001', 'pgtap-ws-L1', 'faab',
   '{"waiver_run_days": ["tue", "wed", "thu", "fri", "sat"], "waiver_run_time": "09:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "day_and_time", "free_agency_open_day": "sun", "free_agency_open_time": "06:00"}'),
  ('b9700000-0000-4000-8000-000000000002', 'pgtap-ws-L2', 'faab',
   '{"waiver_run_days": ["wed"], "waiver_run_time": "00:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "after_waiver_run", "free_agency_open_day": "sun", "free_agency_open_time": "06:00"}'),
  ('b9700000-0000-4000-8000-000000000003', 'pgtap-ws-L3', 'none_fcfs', '{}'),
  ('b9700000-0000-4000-8000-000000000004', 'pgtap-ws-L4', 'faab',
   '{"waiver_run_days": ["wed"], "waiver_run_time": "00:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "never"}'),
  ('b9700000-0000-4000-8000-000000000005', 'pgtap-ws-L5', 'faab',
   '{"waiver_run_days": ["tue", "wed", "thu", "fri", "sat"], "waiver_run_time": "09:00", "waiver_time_zone": "America/Los_Angeles", "free_agency_opens": "day_and_time", "free_agency_open_day": "sun", "free_agency_open_time": "06:00"}')
) v(id, nm, wt, s);

insert into teams (id, owner_id, name, league_id) values
 ('c9700000-0000-4000-8000-000000000001', '99700000-0000-4000-8000-000000000001', 'WS A1', 'b9700000-0000-4000-8000-000000000001'),
 ('c9700000-0000-4000-8000-000000000002', '99700000-0000-4000-8000-000000000003', 'WS A2', 'b9700000-0000-4000-8000-000000000001'),
 ('c9700000-0000-4000-8000-000000000011', '99700000-0000-4000-8000-000000000001', 'WS B1', 'b9700000-0000-4000-8000-000000000002'),
 ('c9700000-0000-4000-8000-000000000012', '99700000-0000-4000-8000-000000000002', 'WS B2', 'b9700000-0000-4000-8000-000000000002'),
 ('c9700000-0000-4000-8000-000000000021', '99700000-0000-4000-8000-000000000001', 'WS C1', 'b9700000-0000-4000-8000-000000000003'),
 ('c9700000-0000-4000-8000-000000000041', '99700000-0000-4000-8000-000000000001', 'WS E1', 'b9700000-0000-4000-8000-000000000005'),
 ('c9700000-0000-4000-8000-000000000042', '99700000-0000-4000-8000-000000000003', 'WS E2', 'b9700000-0000-4000-8000-000000000005');
insert into league_members (league_id, user_id, team_id, role) values
 ('b9700000-0000-4000-8000-000000000001', '99700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000001', 'commissioner'),
 ('b9700000-0000-4000-8000-000000000001', '99700000-0000-4000-8000-000000000003', 'c9700000-0000-4000-8000-000000000002', 'manager'),
 ('b9700000-0000-4000-8000-000000000002', '99700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000011', 'commissioner'),
 ('b9700000-0000-4000-8000-000000000002', '99700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000012', 'manager'),
 ('b9700000-0000-4000-8000-000000000003', '99700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000021', 'commissioner'),
 ('b9700000-0000-4000-8000-000000000005', '99700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000041', 'commissioner'),
 ('b9700000-0000-4000-8000-000000000005', '99700000-0000-4000-8000-000000000003', 'c9700000-0000-4000-8000-000000000042', 'manager');
insert into league_weeks (league_id, season, week)
select l, 2026, g from (values ('b9700000-0000-4000-8000-000000000001'::uuid), ('b9700000-0000-4000-8000-000000000002'),
                               ('b9700000-0000-4000-8000-000000000003'), ('b9700000-0000-4000-8000-000000000005')) v(l),
     generate_series(1, 14) g;
insert into drafts (league_id, status, completed_at) values
 ('b9700000-0000-4000-8000-000000000005', 'complete', '2026-09-06 06:00:00+00');   -- Sat 2026-09-05 23:00 PDT

insert into players (id, full_name, position, team, status) values
 ('ws-fa1', 'WS FA1', 'WR', 'SEA', 'Active'),
 ('ws-fa2', 'WS FA2', 'WR', 'SEA', 'Active'),
 ('ws-fa3', 'WS FA3', 'WR', 'SEA', 'Active'),
 ('ws-fa4', 'WS FA4', 'WR', 'SEA', 'Active'),
 ('ws-fa5', 'WS FA5', 'WR', 'SEA', 'Active'),
 ('ws-kc1', 'WS KC1', 'WR', 'KC',  'Active'),   -- kicked off Thursday night of week 8
 ('ws-b2a', 'WS B2A', 'RB', 'DEN', 'Active'),   -- B2's, dropped in §F
 ('ws-b2b', 'WS B2B', 'RB', 'DEN', 'Active'),
 ('ws-a1x', 'WS A1X', 'RB', 'DEN', 'Active'),   -- A1's, force-dropped in §G
 ('ws-c1a', 'WS C1A', 'RB', 'DEN', 'Active');   -- C1's (no waivers)
insert into league_rosters (league_id, team_id, player_id) values
 ('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000012', 'ws-b2a'),
 ('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000012', 'ws-b2b'),
 ('b9700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000001', 'ws-a1x'),
 ('b9700000-0000-4000-8000-000000000003', 'c9700000-0000-4000-8000-000000000021', 'ws-c1a');

-- ---------------------------------------------------------------------------
-- E. The free-agency window over Chris's two leagues, week 8 (the DST week)
-- ---------------------------------------------------------------------------
create temp table ws_l (k text primary key, id uuid) on commit drop;
insert into ws_l values ('L1', 'b9700000-0000-4000-8000-000000000001'), ('L2', 'b9700000-0000-4000-8000-000000000002'),
                        ('L3', 'b9700000-0000-4000-8000-000000000003'), ('L4', 'b9700000-0000-4000-8000-000000000004'),
                        ('L5', 'b9700000-0000-4000-8000-000000000005');
create or replace function pg_temp.win(p_k text, p_at timestamptz) returns jsonb language sql as $$
  select public.waiver_window_internal(l, p_at) from public.leagues l where l.id = (select id from ws_l where k = p_k)
$$;

select is(
  (select jsonb_build_array(w ->> 'free_agency_open', w ->> 'why', w ->> 'reset_kind', (w ->> 'next_run_at')::timestamptz)
   from pg_temp.win('L1', '2026-10-27 08:00:00+00') w),
  jsonb_build_array('false', 'awaiting_run', 'week_end', '2026-10-27 16:00:00+00'::timestamptz),
  'E1 league 1, right after week 7 ends: claims only, no run since the week ended; the next run Tuesday 09:00 PDT');
select is(pg_temp.win('L1', '2026-10-27 16:00:00+00') ->> 'why', 'before_opening_time',
  'E2 league 1 after Tuesday''s run: still claims only until Sunday''s opening');
select is((pg_temp.win('L1', '2026-11-01 13:59:59+00') ->> 'free_agency_open')::boolean, false,
  'E3 league 1, Sunday 05:59:59 PST: one second before free agency opens');
select is((pg_temp.win('L1', '2026-11-01 14:00:00+00') ->> 'free_agency_open')::boolean, true,
  'E4 league 1, AT Sunday 06:00 PST (14:00Z on the fall-back morning): free agency is open');
select is((pg_temp.win('L1', '2026-11-03 07:59:59+00') ->> 'free_agency_open')::boolean, true,
  'E5 league 1, one second before week 8''s last game is recorded ending: still open');
select is(
  (select jsonb_build_array(w ->> 'free_agency_open', w ->> 'why', (w ->> 'next_run_at')::timestamptz)
   from pg_temp.win('L1', '2026-11-03 08:00:00+00') w),
  jsonb_build_array('false', 'awaiting_run', '2026-11-03 17:00:00+00'::timestamptz),
  'E6 league 1, AT the week''s end: claims only again until Tuesday 09:00 PST');
select is((pg_temp.win('L2', '2026-10-28 06:59:59+00') ->> 'free_agency_open')::boolean, false,
  'E7 league 2, one second before Tuesday-at-midnight''s run: claims only');
select is((pg_temp.win('L2', '2026-10-28 07:00:00+00') ->> 'free_agency_open')::boolean, true,
  'E8 league 2, AT the run: free agency is open (a run at or after the week''s end counts)');
select is(
  (select jsonb_build_array(w ->> 'free_agency_open', (w ->> 'next_run_at')::timestamptz)
   from pg_temp.win('L2', '2026-11-04 07:59:59+00') w),
  jsonb_build_array('false', '2026-11-04 08:00:00+00'::timestamptz),
  'E9 league 2 after week 8 ends: claims only until the next run — Wednesday 00:00 PST, 08:00Z');
select is((pg_temp.win('L2', '2026-11-04 08:00:00+00') ->> 'free_agency_open')::boolean, true,
  'E10 league 2, AT the post-fall-back run: open');
-- a run AT the reset instant counts (Q78: waivers run on schedule as the week closes); an opening AT it opens nothing
update nfl_weeks set last_game_ends_at = '2026-10-28 07:00:00+00' where season = 2026 and week = 7;
select is((pg_temp.win('L2', '2026-10-28 07:00:00+00') ->> 'free_agency_open')::boolean, true,
  'E10a the week''s end recorded EXACTLY at league 2''s run: the run counts and free agency opens (a run AT the reset counts — Q78)');
-- 153 re-cut (L.D2.10 — Q78 / F424): a week's end is capped at its ceiling, and week 7's is 2026-10-28
-- 07:00Z — an end "recorded" at Sunday 11-01 would read as that ceiling. The boundary moves to week 8
-- (ceiling 2026-11-04 08:00Z), which contains that Sunday; week 7 keeps E10a's end; week 8 restored below.
update nfl_weeks set last_game_ends_at = '2026-11-01 14:00:00+00' where season = 2026 and week = 8;
select is(pg_temp.win('L1', '2026-11-01 14:00:00+00') ->> 'why', 'awaiting_run',
  'E10b a week end recorded EXACTLY at league 1''s Sunday opening: that opening opens nothing (the week closed at that instant)');
update nfl_weeks set last_game_ends_at = '2026-11-03 08:00:00+00' where season = 2026 and week = 8;   -- 153: restore
-- R1189 (PR #334 fix round): the weekly opening's own rule (`v_last_open > v_reset`) at its boundary — a run
-- HAS happened since the week closed, so only the opening instant decides. Week 7 recorded ending exactly at
-- league 1's Sunday 06:00 PDT opening (13:00Z): by Tuesday's 09:00 PDT run that opening opens nothing; one
-- second earlier it does.
update nfl_weeks set last_game_ends_at = '2026-10-25 13:00:00+00' where season = 2026 and week = 7;
select is(
  (select jsonb_build_array(w ->> 'free_agency_open', w ->> 'why', (w ->> 'reset_at')::timestamptz, (w ->> 'last_open_at')::timestamptz, (w ->> 'last_run_at')::timestamptz)
   from pg_temp.win('L1', '2026-10-27 16:00:00+00') w),
  jsonb_build_array('false', 'before_opening_time', '2026-10-25 13:00:00+00'::timestamptz, '2026-10-25 13:00:00+00'::timestamptz, '2026-10-27 16:00:00+00'::timestamptz),
  'E10c the week ends EXACTLY at the Sunday opening and Tuesday''s run follows: that opening opens nothing, so free agency waits for next Sunday');
update nfl_weeks set last_game_ends_at = '2026-10-25 12:59:59+00' where season = 2026 and week = 7;
select is(pg_temp.win('L1', '2026-10-27 16:00:00+00') ->> 'why', 'open',
  'E10d the week ends ONE SECOND before the Sunday opening: that opening counts and Tuesday''s run opens free agency');
update nfl_weeks set last_game_ends_at = starts_at + interval '6 days 3 hours' where season = 2026 and week = 7;   -- restore
update leagues set waiver_next_run_at = '2026-10-28 07:00:00+00' where id = 'b9700000-0000-4000-8000-000000000002';
select is(
  (select jsonb_build_array(w ->> 'free_agency_open', w ->> 'why', (w ->> 'last_run_at')::timestamptz)
   from pg_temp.win('L2', '2026-10-28 07:00:30+00') w),
  jsonb_build_array('false', 'run_pending', '2026-10-21 07:00:00+00'::timestamptz),
  'E11 once TRACKED, a due run counts only after it is settled: 30 s past the run, still claims only (E8 — no instant add beats the claims)');
update leagues set waiver_next_run_at = '2026-11-04 08:00:00+00' where id = 'b9700000-0000-4000-8000-000000000002';
select is((pg_temp.win('L2', '2026-10-28 07:00:30+00') ->> 'free_agency_open')::boolean, true,
  'E12 settled (the pending run advanced to next week''s): open');
update leagues set waiver_next_run_at = null where id = 'b9700000-0000-4000-8000-000000000002';
select is(
  (select jsonb_build_array(w ->> 'free_agency_open', w ->> 'why', w ->> 'reset_kind')
   from pg_temp.win('L5', '2026-09-06 13:00:00+00') w),
  '["false", "awaiting_run", "draft"]'::jsonb,
  'E13 after a Saturday-night draft, Sunday''s opening passes before any run: every undrafted player is on waivers until the first run after the draft');
select is((pg_temp.win('L5', '2026-09-08 16:00:00+00') ->> 'free_agency_open')::boolean, true,
  'E14 AT the first run after the draft (Tuesday 09:00 PDT): free agency is open');
select is(pg_temp.win('L3', '2026-10-27 08:00:00+00') ->> 'why', 'no_waivers', 'E15 none_fcfs: always free agency');
select is(pg_temp.win('L4', '2026-11-02 20:00:00+00') ->> 'why', 'claims_only', 'E16 free agency never opens: claims only');

-- ---------------------------------------------------------------------------
-- F. roster_add_drop — the add path the schedule changes (injected instants)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "99700000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_like(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000012',
       'ws-fa1', null, 'a9700000-0000-4000-8000-000000000001', '2026-10-28 06:59:59+00') $$,
  '%WS FA1 (ws-fa1) is claim-only right now — no waiver run has happened since the week''s last game ended; put in a waiver claim instead: claims settle at the next waiver run, % (Wed 2026-10-28 00:00 America/Los_Angeles)%',
  'F1 league 2, one second before the run: a fresh free agent is claim-only, refused BY NAME naming the next run in the league''s zone');
select is(
  public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000012',
       'ws-fa1', null, 'a9700000-0000-4000-8000-000000000002', '2026-10-28 07:00:00+00') -> 'add' -> 'free_agency' ->> 'why',
  'open', 'F2 AT the run: the same add lives (instant pickup)');
select is(
  public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000012',
       null, 'ws-b2a', 'a9700000-0000-4000-8000-000000000003', '2026-10-29 12:00:00+00') -> 'drop' ->> 'waivers_until',
  '2026-11-04T08:00:00+00:00', 'F3 a Thursday drop is on waivers until the NEXT run — Wednesday 00:00 PST, across the fall-back (never a fixed 48 hours)');
select is((select state || ' ' || waivers_until::text from league_player_pool where league_id = 'b9700000-0000-4000-8000-000000000002' and player_id = 'ws-b2a'),
  'on_waivers 2026-11-04 08:00:00+00', 'F4 the pool mirror carries the hold');
select is(
  public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000012',
       null, 'ws-b2a', 'a9700000-0000-4000-8000-000000000003', '2026-10-29 12:00:00+00') -> 'settings' -> 'waiver_schedule' ->> 'time_zone',
  'America/Los_Angeles', 'F5 replay is byte-identical and the result carries the schedule (the payload of F3)');
select set_config('request.jwt.claims', '{"sub": "99700000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000011',
       'ws-b2a', null, 'a9700000-0000-4000-8000-000000000004', '2026-11-02 20:00:00+00') $$,
  '%WS B2A (ws-b2a) is on waivers until the waiver run at % (Wed 2026-11-04 00:00 America/Los_Angeles) — put in a waiver claim%',
  'F6 inside free agency, the dropped player is still on waivers until the next run — refused by name');
select throws_like(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000011',
       'ws-b2a', null, 'a9700000-0000-4000-8000-000000000005', '2026-11-04 07:59:59+00') $$,
  '%is on waivers until the waiver run at%', 'F7 the run −1s: still on waivers');
select is(
  public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000011',
       'ws-b2a', null, 'a9700000-0000-4000-8000-000000000006', '2026-11-04 08:00:00+00') -> 'add' ->> 'from_state',
  'on_waivers_lapsed', 'F8 AT the run (untracked league): he is an instant pickup');
-- tracked: a hold whose run is due but not settled still refuses
select set_config('request.jwt.claims', '{"sub": "99700000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000012',
       null, 'ws-b2b', 'a9700000-0000-4000-8000-000000000007', '2026-11-05 12:00:00+00') -> 'drop' ->> 'waivers_until',
  '2026-11-11T08:00:00+00:00', 'F9 fixture: B2B dropped, on waivers until the Nov 11 run');
update leagues set waiver_next_run_at = '2026-11-11 08:00:00+00' where id = 'b9700000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{"sub": "99700000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000011',
       'ws-b2b', null, 'a9700000-0000-4000-8000-000000000008', '2026-11-11 08:00:30+00') $$,
  '%WS B2B (ws-b2b) is on waivers until the waiver run at%', 'F10a TRACKED: 30 s past his run but the run is not settled — still on waivers (E8)');
-- R1190 (PR #334 fix round): the run-pending refusal names the unsettled run in the league''s zone, like the next run
select throws_like(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000011',
       'ws-fa4', null, 'a9700000-0000-4000-8000-000000000032', '2026-11-11 08:00:30+00') $$,
  '%WS FA4 (ws-fa4) is claim-only right now — the waiver run at Wed 2026-11-11 00:00 America/Los_Angeles is still being processed; put in a waiver claim instead%',
  'F10c TRACKED and unsettled: a fresh free agent is claim-only, naming the run being processed in the league''s zone (never raw UTC)');
update leagues set waiver_next_run_at = '2026-11-18 08:00:00+00' where id = 'b9700000-0000-4000-8000-000000000002';
select lives_ok(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000002', 'c9700000-0000-4000-8000-000000000011',
       'ws-b2b', null, 'a9700000-0000-4000-8000-000000000009', '2026-11-11 08:00:30+00') $$,
  'F10b settled: the same add lives');
update leagues set waiver_next_run_at = null where id = 'b9700000-0000-4000-8000-000000000002';
-- Q74: league 1, Sunday 05:00 PST — free agency not yet open
select set_config('request.jwt.claims', '{"sub": "99700000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_like(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000002',
       'ws-kc1', null, 'a9700000-0000-4000-8000-000000000010', '2026-11-01 13:00:00+00') $$,
  '%WS KC1 (ws-kc1) is locked for adds%', 'F10 Q74: a kicked-off player outside free agency is refused as LOCKED, never offered a claim');
select throws_like(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000002',
       'ws-fa2', null, 'a9700000-0000-4000-8000-000000000011', '2026-11-01 13:00:00+00') $$,
  '%WS FA2 (ws-fa2) is claim-only right now — free agency opens Sun 06:00 America/Los_Angeles; put in a waiver claim instead: claims settle at the next waiver run, % (Tue 2026-11-03 09:00 America/Los_Angeles)%',
  'F11 his unlocked twin at the same instant is claim-only, naming the opening and the next run');
select throws_like(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000002',
       'ws-fa2', null, 'a9700000-0000-4000-8000-000000000012', '2026-11-01 13:59:59+00') $$,
  '%is claim-only right now%', 'F12 one second before Sunday 06:00 PST: still claim-only');
select is(
  public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000002',
       'ws-fa2', null, 'a9700000-0000-4000-8000-000000000013', '2026-11-01 14:00:00+00') -> 'add' ->> 'player_id',
  'ws-fa2', 'F13 AT Sunday 06:00 PST (the fall-back morning): the instant pickup lives');
-- after the draft (league 5)
select throws_like(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000005', 'c9700000-0000-4000-8000-000000000042',
       'ws-fa3', null, 'a9700000-0000-4000-8000-000000000014', '2026-09-08 15:59:59+00') $$,
  '%WS FA3 (ws-fa3) is claim-only right now — no waiver run has happened since the draft;%',
  'F14 after the draft, an undrafted player waits for the first run after it — refused naming the draft');
select lives_ok(
  $$ select public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000005', 'c9700000-0000-4000-8000-000000000042',
       'ws-fa3', null, 'a9700000-0000-4000-8000-000000000015', '2026-09-08 16:00:00+00') $$,
  'F15 AT the first run after the draft: lives');
-- no waivers (league 3): drops are free agents, adds any time
select set_config('request.jwt.claims', '{"sub": "99700000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000003', 'c9700000-0000-4000-8000-000000000021',
       'ws-fa4', 'ws-c1a', 'a9700000-0000-4000-8000-000000000016', '2026-10-27 08:00:00+00') -> 'drop' ->> 'to_state',
  'free_agent', 'F16 none_fcfs: the drop goes straight to free agency and the add lives right after the week ends');
select is(
  public.roster_add_drop_internal('b9700000-0000-4000-8000-000000000003', 'c9700000-0000-4000-8000-000000000021',
       'ws-c1a', 'ws-fa4', 'a9700000-0000-4000-8000-000000000017', '2026-10-27 08:00:01+00') -> 'add' -> 'free_agency' ->> 'why',
  'no_waivers', 'F17 none_fcfs: the player just dropped is picked straight back up');

-- ---------------------------------------------------------------------------
-- G. The commissioner walks past the schedule (TD5) — and it is NAMED
-- ---------------------------------------------------------------------------
select is(
  (select jsonb_build_array(r -> 'bypassed' @> '["waiver_period:ws-fa5"]'::jsonb, (r ->> 'drop_waivers_until')::timestamptz)
   from public.commish_roster_override_internal('b9700000-0000-4000-8000-000000000001', 'c9700000-0000-4000-8000-000000000001',
          'ws-fa5', 'ws-a1x', null, null, null, 'a9700000-0000-4000-8000-000000000018', '2026-11-01 13:30:00+00', null,
          'commish_force_add_drop') r),
  jsonb_build_array(true, '2026-11-03 17:00:00+00'::timestamptz),
  'G1 a force add outside free agency lives with waiver_period:<player> in bypassed, and the force drop waits for the next run (Tuesday 09:00 PST) — not the retired key''s 48 hours');
select is((select state from league_player_pool where league_id = 'b9700000-0000-4000-8000-000000000001' and player_id = 'ws-a1x'),
  'on_waivers', 'G2 the force-dropped player is on waivers');

-- ---------------------------------------------------------------------------
-- H. The setting verb — the six keys, the five retired, per role
-- ---------------------------------------------------------------------------
select is(public.commish_setting_policy('waiver_run_days') ->> 'class', 'free', 'H1 waiver_run_days is a FREE blob key');
select is(
  (select string_agg(k || '=' || (public.commish_setting_policy(k) ->> 'class'), ' ' order by k)
   from unnest(array['free_agency_open_day', 'free_agency_open_time', 'free_agency_opens', 'waiver_run_time', 'waiver_time_zone']) k),
  'free_agency_open_day=free free_agency_open_time=free free_agency_opens=free waiver_run_time=free waiver_time_zone=free',
  'H2 the other five schedule keys are FREE');
select is(
  (select string_agg(k || '=' || (public.commish_setting_policy(k) ->> 'class'), ' ' order by k)
   from unnest(array['bench_lock', 'free_agency', 'waiver_period_hours', 'waiver_process_day', 'waiver_process_time']) k),
  'bench_lock=refused free_agency=refused waiver_period_hours=refused waiver_process_day=refused waiver_process_time=refused',
  'H3 the five retired keys are REFUSED by name');
select ok(not has_function_privilege('anon', 'public.commish_change_setting(uuid,text,jsonb,boolean,text,uuid)', 'EXECUTE'),
  'H4 anon cannot call the setting verb');
select set_config('request.jwt.claims', '{"sub": "99700000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'waiver_run_days', '["tue"]', false,
       'a9700000-0000-4000-8000-000000000020', '2026-11-02 12:00:00+00', null) $$,
  '42501', 'commish_change_setting: not a commissioner of this league', 'H5 a non-member is refused (no-leak 42501)');
select set_config('request.jwt.claims', '{"sub": "99700000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'waiver_run_days', '["tue"]', false,
       'a9700000-0000-4000-8000-000000000021', '2026-11-02 12:00:00+00', null) $$,
  '42501', 'commish_change_setting: not a commissioner of this league', 'H6 a manager of the league is refused (no-leak 42501)');
select set_config('request.jwt.claims', '{"sub": "99700000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select jsonb_build_array(r -> 'value', r ->> 'no_changes', r ->> 'commissioner_action_id' is not null, r -> 'consequences' ->> 'waiver_next_run_why')
   from public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'waiver_run_days', '["sat", "tue"]', false,
          'a9700000-0000-4000-8000-000000000022', '2026-11-02 12:00:00+00', null) r),
  jsonb_build_array('["tue", "sat"]'::jsonb, 'false', true, 'untracked — no waiver run is pending for this league yet (the processor starts tracking it at its first run), so there was nothing to move; the add path reads the new schedule from now on'),
  'H7 the commissioner sets the run days: stored Sunday-first, one receipt; an UNTRACKED league stays untracked, said in words');
select is((select settings -> 'waiver_run_days' from leagues where id = 'b9700000-0000-4000-8000-000000000002'),
  '["tue", "sat"]'::jsonb, 'H8 the blob holds the canonical value');
select is((select count(*)::int from commissioner_actions where league_id = 'b9700000-0000-4000-8000-000000000002' and target_id = 'waiver_run_days'),
  1, 'H9 exactly one audit row');
select throws_like(
  $$ select public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'waiver_time_zone', '"Mars/Olympus"', false,
       'a9700000-0000-4000-8000-000000000023', '2026-11-02 12:00:00+00', null) $$,
  '%waiver_time_zone must be an IANA time zone name%', 'H10 an unknown zone is refused by name');
-- R1188 (PR #334 fix round): pg knows the posix/ tree, the app reader (Intl) does not — refused by name
select ok(exists (select 1 from pg_catalog.pg_timezone_names where name = 'posix/America/New_York'),
  'H10a fixture: the database knows posix/America/New_York (so H10b is not vacuous)');
select throws_like(
  $$ select public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'waiver_time_zone', '"posix/America/New_York"', false,
       'a9700000-0000-4000-8000-000000000033', '2026-11-02 12:00:00+00', null) $$,
  '%waiver_time_zone must be an IANA time zone name%', 'H10b a posix/ zone (one the app cannot read) is refused by name');
select throws_like(
  $$ select public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'waiver_run_days', '[]', false,
       'a9700000-0000-4000-8000-000000000024', '2026-11-02 12:00:00+00', null) $$,
  '%needs at least one day%', 'H11 no run day is refused by name (a no-waivers league is none_fcfs)');
select throws_like(
  $$ select public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'waiver_run_days', '["wed", "wed"]', false,
       'a9700000-0000-4000-8000-000000000025', '2026-11-02 12:00:00+00', null) $$,
  '%lists a day more than once%', 'H12 a repeated day is refused by name');
select throws_like(
  $$ select public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'waiver_period_hours', '72', false,
       'a9700000-0000-4000-8000-000000000026', '2026-11-02 12:00:00+00', null) $$,
  '%waiver_period_hours cannot be changed through this verb%WHY: This setting has been replaced: pick the days and time waivers run, and when free agency opens, instead.%', 'H13 the retired period is refused by name, naming its replacement');
select throws_like(
  $$ select public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'bench_lock', 'false', false,
       'a9700000-0000-4000-8000-000000000027', '2026-11-02 12:00:00+00', null) $$,
  '%bench_lock cannot be changed through this verb%WHY: This setting has been retired: a waiver claim always fails if the player you''d drop has already played this week%', 'H14 bench_lock is refused by name');
select is(
  (select jsonb_build_array(r ->> 'no_changes', r ->> 'commissioner_action_id')
   from public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000002', 'waiver_time_zone', '"America/Los_Angeles"', false,
          'a9700000-0000-4000-8000-000000000028', '2026-11-02 12:00:00+00', null) r),
  '["true", null]'::jsonb, 'H15 re-sending the stored zone is a no-op: no receipt');
-- TRACKED league 1: moving WHEN waivers run moves the pending run
update leagues set waiver_next_run_at = '2026-11-03 17:00:00+00' where id = 'b9700000-0000-4000-8000-000000000001';
select is(
  (select jsonb_build_array((r -> 'consequences' ->> 'waiver_next_run_at_before')::timestamptz, (r -> 'consequences' ->> 'waiver_next_run_at')::timestamptz,
                            r -> 'consequences' ->> 'waiver_next_run_why')
   from public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000001', 'waiver_run_time', '"10:00"', false,
          'a9700000-0000-4000-8000-000000000029', '2026-11-02 12:00:00+00', null) r),
  jsonb_build_array('2026-11-03 17:00:00+00'::timestamptz, '2026-11-03 18:00:00+00'::timestamptz,
                    'moved — the pending waiver run is now the new schedule''s next run after this change'),
  'H16 TRACKED: 09:00 → 10:00 moves the pending run to Tuesday 10:00 PST (18:00Z), before and after in the receipt');
select is((select waiver_next_run_at from leagues where id = 'b9700000-0000-4000-8000-000000000001'),
  '2026-11-03 18:00:00+00'::timestamptz, 'H17 the column moved');
select is(
  (select r -> 'consequences' ->> 'waiver_next_run_why'
   from public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000001', 'waiver_type', '"none_fcfs"', false,
          'a9700000-0000-4000-8000-000000000030', '2026-11-02 12:00:01+00', null) r),
  'no_waivers — the league now has no waivers, so no run is pending; claims still pending are the processor''s to settle',
  'H18 switching to no waivers clears the pending run');
select is((select waiver_next_run_at from leagues where id = 'b9700000-0000-4000-8000-000000000001'), null::timestamptz,
  'H19 the column is NULL under none_fcfs');
select is(
  (select r -> 'consequences' ? 'waiver_next_run_why'
   from public.commish_change_setting_internal('b9700000-0000-4000-8000-000000000001', 'faab_min_bid', '2', false,
          'a9700000-0000-4000-8000-000000000031', '2026-11-02 12:00:02+00', null) r),
  false, 'H20 any other key''s consequences document carries no schedule keys (byte-identical to 144''s shape)');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- I. Grants and the structural pins
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
   from unnest(array['public.waiver_schedule_from_legacy_internal(jsonb)', 'public.waiver_schedule_internal(jsonb,text)',
                     'public.waiver_next_run_internal(jsonb,timestamptz)', 'public.waiver_last_run_internal(jsonb,timestamptz)',
                     'public.waiver_last_open_internal(jsonb,timestamptz)', 'public.waiver_window_internal(public.leagues,timestamptz)',
                     'public.roster_add_drop_internal(uuid,uuid,text,text,uuid,timestamptz)',
                     'public.commish_roster_override_internal(uuid,uuid,text,text,text,uuid,uuid,uuid,timestamptz,text,text)',
                     'public.commish_setting_canon_internal(text,jsonb,public.leagues)',
                     'public.commish_change_setting_internal(uuid,text,jsonb,boolean,uuid,timestamptz,text)']) f,
        unnest(array['anon', 'authenticated']) r
   where has_function_privilege(r, f, 'EXECUTE')),
  0, 'I1 every new and every replaced internal is closed to anon and authenticated (20 pairs)');
select ok(has_function_privilege('authenticated', 'public.commish_setting_policy(text)', 'EXECUTE'),
  'I2 the policy table stays readable by authenticated (129''s grant — the panel renders refusal copy from it)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 'waiver_schedule_from_legacy_internal'   -- the one-off mapper reads them by design
     and (p.prosrc like '%->> ''waiver_period_hours''%' or p.prosrc like '%->> ''free_agency''%'
          or p.prosrc like '%->> ''bench_lock''%' or p.prosrc like '%->> ''waiver_process_day''%')),
  0, 'I3 no public function body except the one-off legacy mapper reads a retired key from a settings blob any more');
select ok(
  (select prosrc like '%public.waiver_window_internal(v_league, p_at)%' and prosrc like '%public.waiver_next_run_internal(v_sched, p_at)%'
   from pg_proc where proname = 'roster_add_drop_internal'),
  'I4 the add path reads the window and the drop reads the next run');
select ok(
  (select position('public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at)' in prosrc)
        < position('public.waiver_window_internal(v_league, p_at)' in prosrc)
   from pg_proc where proname = 'roster_add_drop_internal'),
  'I5 Q74: the add-side game lock is evaluated BEFORE the waiver state');
select is(
  (select count(*)::int from pg_proc where proname = 'roster_add_drop_internal'
     and prosrc like '%until ingestion has recorded every game of the week final%'
     and prosrc not like '%is NULL until every game of the week is final%'),
  1, 'I6 F240: both lock refusals say the stamp waits for ingestion to RECORD the week final');

select * from finish();
rollback;
