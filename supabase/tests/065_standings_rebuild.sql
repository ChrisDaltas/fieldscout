-- ============================================================================
-- Standings + the derived-results rebuild — pgTAP 065 (task L.D1.7;
-- migration 117; spec v2.16.23 §7.3.7 / §11.5 / §11.7 / §12.17 / §12.18 /
-- §22.2 / §23.2 / E38 / E39 / E63 / E64; PROGRESS D137 / D288 / D295 /
-- D297 / D313 / D314; F241 / F244; tasks-M4 §4 rules 1–11).
--
-- Numbering: pgTAP head measured 064 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 065.
--
-- AMENDED IN PLACE 2026-09-07 (L.D1.9 / migration 119 — tests are tests,
-- the D137 note): A11b's "…and in no other function" NARROWS. §12.18's own
-- text names TWO writers of team_week_results — `score-league-week` (live,
-- PROVISIONAL) and finalization (FINAL) — and 119 landed the first: the
-- write door's `total_points` arm INSERTs provisional rows (`is_final`
-- FALSE, points only; F241(b)). The FINAL results INSERT still exists
-- exactly once (A11, unchanged); A11b now asserts the door is the ONLY other
-- function carrying the INSERT text. Shown RED against 119 before the edit:
-- exactly 1 of 108 (cell 13).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * GOLDENS AS STORED LITERALS (D62), hand-built on paper: L1 is a
--     6-team season over four regular-season weeks (3–6) whose records,
--     PF and PA are written out in §B below — A/B/C at 3-1 with PF 400
--     each and a CYCLE (A beat B, B beat C, C beat A: E63's "records can
--     cycle"), separated by PA 375 > 355 > 345 with the skip NAMED; D/E at
--     1-3 with PF 340 each, D beat E (the clean two-team tie) while E's PA
--     385 > D's 370 — so the SAME pair orders D,E under the default chain
--     and E,D when the chain puts Points Against before head-to-head (the
--     direction pin: higher PA FIRST, §7.3.7); F at 1-3 / PF 335 last by
--     Points For; a playoff-week row (week 7) that must NOT count. The
--     PR's probe 1 lets head-to-head attempt the 3-way group (`gsize = 2`
--     → `gsize >= 2`) and the E63 cells red.
--   * L3 is 064's 10-team week (median + second + the OVERRIDDEN cell +
--     the two-decimal tie) so the COMBINED record (§11.7) is pinned as a
--     literal — incl. the 1-0-2 pair whose tie carries them through PF,
--     head-to-head (they met and tied), PA and the inert division entry to
--     the coin flip.
--   * L2 is a `total_points` league whose two tied teams carry h2h rows
--     that WOULD separate them if the entry ran (U7 beat U8) — E64 is
--     pinned by ORDER (PA puts U8 first), not by the absence of data: the
--     skip is by `schedule_mode`, by NAME (CLAUDE.md: never let "nothing
--     was there" stand in for "the rule fired").
--   * THE EQUIVALENCE PIN (D137/D297): `finalize_matchups` (116's body,
--     117's helpers) writes L3's rows; their digest and the standings
--     payload are captured; the rows are then CORRUPTED (every cell
--     rewritten) and `rebuild_team_week_results` re-derives them —
--     digest ≡, standings ≡, `changed = true`; a second rebuild `changed
--     = false` with `reason = already_consistent`. The PR's probe 3
--     perturbs the rebuild by one rounding step and these cells red.
--   * THE OVERRIDE PIN (§12.18 / §22.2): after the rebuild the overridden
--     cell reads 'loss' for the home side that scored MORE — and the E38
--     derivation on the same scores is pinned to say 'home', so the cell
--     can only pass if the stored result was honoured. The PR's probe 2
--     recomputes the cell from its scores and this reds.
--   * EVERY REFUSAL BY NAME WITH ITS ONE-UNIT-AWAY TWIN (D146): week 3
--     (final) rebuilds / week 4 (not final) refuses `week_not_final`; a
--     NULL score refuses `pending_scores` and rebuilds again once
--     restored; a drifted non-overridden result refuses `result_drift`
--     and rebuilds again once restored; a not-final matchup refuses
--     `matchup_not_final`; a deleted total_points row refuses
--     `pending_results` (NOTHING zero-filled — R788 holds in the rebuild)
--     and rebuilds once the row exists.
--   * THE COIN FLIP is seeded on L1's stored `schedule_seed` (424242): the
--     literal order is pinned and the same call twice is pinned equal;
--     the payload names the seed and its source.
--   * F244 (DISCHARGED): L4's week 4 carries a schedule defect (a team in
--     two primary matchups) — the league's week 3 finalizes and ROLLS BACK
--     with it; the report must say `finalized 0` for L4 while `failures`
--     carries the P0001, and week 3 must still be `correction_window` with
--     zero rows.
--   * All privileged-context work runs as postgres (auth.uid() NULL); the
--     member / non-member / JWT cells set a claim and reset it
--     (set_config(..., true) persists to txn end — D49(7)).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(108);

-- ---------------------------------------------------------------------------
-- A. Form pins — shape, REVOKE, the one-implementation prosrc pins, E38
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('league_standings', 'rebuild_team_week_results', 'finalize_matchups')),
  'A1 league_standings, rebuild_team_week_results (and the replaced finalize_matchups) are SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('matchup_result_internal', 'week_results_pending_internal', 'week_results_write_internal')),
  'A2 the three helpers are PLAIN with search_path='''' — reachable through the DEFINER callers or as postgres');
select is(
  (select p.provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'matchup_result_internal'),
  'i', 'A2b matchup_result_internal is IMMUTABLE (a pure E38 derivation)');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_standings'),
  'p_league_id uuid', 'A3 league_standings(p_league_id) — the tasks-M4 §5 sketch');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rebuild_team_week_results'),
  'p_league_id uuid, p_week integer', 'A4 rebuild_team_week_results(p_league_id, p_week) — the §12.18 signature');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'finalize_matchups'),
  'p_now timestamp with time zone DEFAULT now(), p_league_id uuid DEFAULT NULL::uuid',
  'A5 the replaced finalize_matchups keeps 116''s signature (the cron rows in 064 still bind)');
select ok(
  not has_function_privilege('anon', 'public.league_standings(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.league_standings(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.league_standings(uuid)', 'EXECUTE'),
  'A6 league_standings: REVOKEd from anon, kept for authenticated (a member READ — in-body auth decides) and the service role');
select ok(
  not has_function_privilege('anon', 'public.rebuild_team_week_results(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.rebuild_team_week_results(uuid,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.rebuild_team_week_results(uuid,integer)', 'EXECUTE'),
  'A7 rebuild_team_week_results: triple-REVOKEd; the service role keeps EXECUTE (the harness / M6''s verbs in-body)');
select ok(
  not has_function_privilege('authenticated', 'public.matchup_result_internal(numeric,numeric,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.week_results_pending_internal(uuid,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.week_results_write_internal(uuid,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.week_results_write_internal(uuid,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_matchups(timestamptz,uuid)', 'EXECUTE'),
  'A8 the helpers are REVOKEd from anon + authenticated, and the replaced finalize keeps its REVOKE (load-bearing on a fresh CREATE)');
select ok(
  (select p.prosrc like '%public.week_results_pending_internal(%'
      and p.prosrc like '%public.week_results_write_internal(%'
      and p.prosrc like '%public.matchup_result_internal(%'
      and p.prosrc not like '%INSERT INTO public.team_week_results%'
      and p.prosrc not like '%array_agg(r.points%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'finalize_matchups'),
  'A9 finalize_matchups calls the three helpers BY NAME and no longer carries the results INSERT or the median math (D137 — one implementation)');
select ok(
  (select p.prosrc like '%public.week_results_pending_internal(%'
      and p.prosrc like '%public.week_results_write_internal(%'
      and p.prosrc not like '%UPDATE public.matchups%'
      and p.prosrc not like '%INSERT INTO public.matchups%'
      and p.prosrc not like '%INSERT INTO public.team_week_results%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rebuild_team_week_results'),
  'A10 the rebuild calls the same helpers and NEVER writes matchups (the source of truth is read, not repaired — §12.18)');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'INSERT INTO public.team_week_results', ''))) / length('INSERT INTO public.team_week_results')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'week_results_write_internal'),
  1, 'A11 the results INSERT exists exactly ONCE on the whole chain — in week_results_write_internal');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname <> 'week_results_write_internal' and p.prosrc like '%INSERT INTO public.team_week_results%'),
  array['score_write_week_batch'],
  'A11b …and the ONLY other function carrying it is the write door''s PROVISIONAL arm (119, L.D1.9 — §12.18''s live writer; is_final FALSE, never a final row)');
-- E38 on the lifted derivation.
select is(public.matchup_result_internal(98.24, 98.24, '00000000-0000-4000-8000-000000000001'), 'tie',
  'A12 E38: a two-decimal tie (98.24 vs 98.24) is a tie');
select is(public.matchup_result_internal(98.244, 98.235, '00000000-0000-4000-8000-000000000001'), 'tie',
  'A12b …and hidden precision is NOT consulted: 98.244 vs 98.235 both round to 98.24 — tie');
select is(public.matchup_result_internal(98.245, 98.244, '00000000-0000-4000-8000-000000000001'), 'home',
  'A12c …98.245 rounds half away to 98.25 > 98.24 — home (D57(2))');
select is(public.matchup_result_internal(70.00, 120.00, '00000000-0000-4000-8000-000000000001'), 'away',
  'A12d …the away side scoring more is away');
select is(public.matchup_result_internal(100.00, 0.00, null), null,
  'A12e …a bye (no away team) has no result');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context) — every instant a stored literal on the
--    2026 calendar (the 064 shape): weeks 3–7 closed and stamped, windows
--    passed by 2026-10-29 10:00Z; one final game per week.
--
--    L1 (h2h, 6 teams A–F = T1–T6, no median, no second; regular 3–6,
--    playoff 7–8; schedule_seed 424242, the default chain):
--      W3: A–B 100/95 · C–D 100/80 · E–F 95/85
--      W4: B–C 105/100 · A–E 110/70 · D–F 85/90
--      W5: C–A 95/90 · B–F 100/80 · D–E 90/80
--      W6: A–D 100/85 · B–E 100/95 · C–F 105/80
--      W7 (playoff): A–B 88/77 — must NOT count.
--      Records / PF / PA (hand-summed):
--        A 3-1 / 400 / 345 (95+70+95+85)     B 3-1 / 400 / 375 (100+100+80+95)
--        C 3-1 / 400 / 355 (80+105+90+80)    D 1-3 / 340 / 370 (100+90+80+100)
--        E 1-3 / 340 / 385 (85+110+90+100)   F 1-3 / 335 / 385 (95+85+100+105)
--      A beat B, B beat C, C beat A (the cycle); D beat E (W5).
--    L2 (total_points, 8 teams U1–U8, no median; weeks 3–4 rows written
--      directly as the worker would — U7/U8 carry h2h rows, see §D):
--        U1 10 / 50(opp U7, win)   U2 20 / 55(opp U8, loss)
--        U3 15 / 15   U4 20 / 20   U5 25 / 25   U6 30 / 30
--        U7 40(opp U8, win) / 35(opp U1, loss)   U8 30(opp U7, loss) / 45(opp U2, win)
--      ⇒ U1 1-0 PF 60; U7 1-1 PF 75 PA 80; U8 1-1 PF 75 PA 95; U2 0-1 PF 75.
--    L3 (h2h, 10 teams T1–T10, median + second on): 064's week 3 verbatim
--      (m33 OVERRIDDEN 'away' though home scored more; m35 a 95/95 tie;
--      the median is exactly 95.00).
--    L4 (h2h, 4 teams V1–V4): week 3 clean; week 4 puts V1 in TWO primary
--      matchups (the F244 raise).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('97000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-sr' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'sr_user' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

update nfl_weeks set first_kickoff_at = null, last_game_ends_at = null where season = 2026;
update nfl_weeks set last_game_ends_at = starts_at + interval '6 days' where season = 2026 and week in (1, 2);
update nfl_weeks set starts_at = '2026-09-23 04:00:00+00', last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set starts_at = '2026-09-30 04:00:00+00', last_game_ends_at = '2026-10-06 04:00:00+00', correction_window_ends_at = '2026-10-08 10:00:00+00' where season = 2026 and week = 4;
update nfl_weeks set starts_at = '2026-10-07 04:00:00+00', last_game_ends_at = '2026-10-13 04:00:00+00', correction_window_ends_at = '2026-10-15 10:00:00+00' where season = 2026 and week = 5;
update nfl_weeks set starts_at = '2026-10-14 04:00:00+00', last_game_ends_at = '2026-10-20 04:00:00+00', correction_window_ends_at = '2026-10-22 10:00:00+00' where season = 2026 and week = 6;
update nfl_weeks set starts_at = '2026-10-21 04:00:00+00', last_game_ends_at = '2026-10-27 04:00:00+00', correction_window_ends_at = '2026-10-29 10:00:00+00' where season = 2026 and week = 7;
update nfl_weeks set starts_at = '2026-10-28 04:00:00+00', last_game_ends_at = null,                     correction_window_ends_at = '2026-11-05 11:00:00+00' where season = 2026 and week = 8;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('sr-w3', 2026, 3, 'BUF', 'KC',  '2026-09-25 00:15:00+00', 'final'),
 ('sr-w4', 2026, 4, 'BUF', 'KC',  '2026-10-02 00:15:00+00', 'final'),
 ('sr-w5', 2026, 5, 'BUF', 'KC',  '2026-10-09 00:15:00+00', 'final'),
 ('sr-w6', 2026, 6, 'BUF', 'KC',  '2026-10-16 00:15:00+00', 'final'),
 ('sr-w7', 2026, 7, 'BUF', 'KC',  '2026-10-23 00:15:00+00', 'final');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings) values
 ('b7000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', 'pgtap-sr-L1', 2026, 'in_season', 8, 4, 4, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "schedule_seed": 424242,
    "tiebreakers": ["win_pct", "points_for", "head_to_head", "points_against", "division_record", "coin_flip"]}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b7000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000001', 'pgtap-sr-L2', 2026, 'in_season', 8, 4, 0, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "total_points", "median_game": false, "second_opponent": false, "schedule_seed": 7}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b7000000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000001', 'pgtap-sr-L3', 2026, 'in_season', 10, 4, 4, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h", "median_game": true, "second_opponent": true, "schedule_seed": 99}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b7000000-0000-4000-8000-000000000004', '97000000-0000-4000-8000-000000000001', 'pgtap-sr-L4', 2026, 'in_season', 8, 4, 4, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, '97000000-0000-4000-8000-000000000001', 'SR ' || chr(64 + i), 'b7000000-0000-4000-8000-000000000001'
from generate_series(1, 6) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-0000000000' || (20 + i)::text)::uuid, '97000000-0000-4000-8000-000000000001', 'SR U' || i, 'b7000000-0000-4000-8000-000000000002'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-0000000000' || (30 + i)::text)::uuid, '97000000-0000-4000-8000-000000000001', 'SR T' || i, 'b7000000-0000-4000-8000-000000000003'
from generate_series(1, 10) i;
insert into teams (id, owner_id, name, league_id)
select ('c7000000-0000-4000-8000-0000000000' || (40 + i)::text)::uuid, '97000000-0000-4000-8000-000000000001', 'SR V' || i, 'b7000000-0000-4000-8000-000000000004'
from generate_series(1, 4) i;

-- user1 is a member of L1 (the member read); user2 is a member of nothing.
insert into league_members (league_id, user_id, team_id, role) values
 ('b7000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'commissioner');

insert into league_weeks (league_id, season, week)
select 'b7000000-0000-4000-8000-000000000001', 2026, g from generate_series(3, 8) g;
insert into league_weeks (league_id, season, week)
select 'b7000000-0000-4000-8000-000000000002', 2026, g from generate_series(3, 6) g;
insert into league_weeks (league_id, season, week)
select 'b7000000-0000-4000-8000-000000000003', 2026, g from generate_series(3, 8) g;
insert into league_weeks (league_id, season, week)
select 'b7000000-0000-4000-8000-000000000004', 2026, g from generate_series(3, 8) g;
-- The closed weeks walk the F4 chain one legal step at a time (110's guard).
update league_weeks set status = 'live'              where league_id = 'b7000000-0000-4000-8000-000000000001' and week between 3 and 7;
update league_weeks set status = 'correction_window' where league_id = 'b7000000-0000-4000-8000-000000000001' and week between 3 and 7;
update league_weeks set status = 'live'              where league_id = 'b7000000-0000-4000-8000-000000000002' and week between 3 and 4;
update league_weeks set status = 'correction_window' where league_id = 'b7000000-0000-4000-8000-000000000002' and week between 3 and 4;
update league_weeks set status = 'live'              where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3;
update league_weeks set status = 'correction_window' where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3;
update league_weeks set status = 'live'              where league_id = 'b7000000-0000-4000-8000-000000000004' and week between 3 and 4;
update league_weeks set status = 'correction_window' where league_id = 'b7000000-0000-4000-8000-000000000004' and week between 3 and 4;

-- L1 matchups (A=01 … F=06).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status) values
 ('d7000000-0000-4000-8000-000000000131', 'b7000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', 100.00,  95.00, 'live'),
 ('d7000000-0000-4000-8000-000000000132', 'b7000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'c7000000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000004', 100.00,  80.00, 'live'),
 ('d7000000-0000-4000-8000-000000000133', 'b7000000-0000-4000-8000-000000000001', 2026, 3, 'regular', 'c7000000-0000-4000-8000-000000000005', 'c7000000-0000-4000-8000-000000000006',  95.00,  85.00, 'live'),
 ('d7000000-0000-4000-8000-000000000141', 'b7000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000003', 105.00, 100.00, 'live'),
 ('d7000000-0000-4000-8000-000000000142', 'b7000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000005', 110.00,  70.00, 'live'),
 ('d7000000-0000-4000-8000-000000000143', 'b7000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c7000000-0000-4000-8000-000000000004', 'c7000000-0000-4000-8000-000000000006',  85.00,  90.00, 'live'),
 ('d7000000-0000-4000-8000-000000000151', 'b7000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'c7000000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000001',  95.00,  90.00, 'live'),
 ('d7000000-0000-4000-8000-000000000152', 'b7000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'c7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000006', 100.00,  80.00, 'live'),
 ('d7000000-0000-4000-8000-000000000153', 'b7000000-0000-4000-8000-000000000001', 2026, 5, 'regular', 'c7000000-0000-4000-8000-000000000004', 'c7000000-0000-4000-8000-000000000005',  90.00,  80.00, 'live'),
 ('d7000000-0000-4000-8000-000000000161', 'b7000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', 100.00,  85.00, 'live'),
 ('d7000000-0000-4000-8000-000000000162', 'b7000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'c7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000005', 100.00,  95.00, 'live'),
 ('d7000000-0000-4000-8000-000000000163', 'b7000000-0000-4000-8000-000000000001', 2026, 6, 'regular', 'c7000000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000006', 105.00,  80.00, 'live'),
 ('d7000000-0000-4000-8000-000000000171', 'b7000000-0000-4000-8000-000000000001', 2026, 7, 'playoff', 'c7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002',  88.00,  77.00, 'live');

-- L2 rows (the worker's shape; h2h columns on U7/U8/U1/U2 are the E64 probe
-- rows — a total_points league never has them in production; they exist to
-- prove the skip is by schedule_mode, not by the absence of data).
insert into team_week_results (league_id, team_id, season, week, points, opponent_team_id, h2h_result, is_final) values
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000021', 2026, 3, 10.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000021', 2026, 4, 50.00, 'c7000000-0000-4000-8000-000000000027', 'win', false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000022', 2026, 3, 20.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000022', 2026, 4, 55.00, 'c7000000-0000-4000-8000-000000000028', 'loss', false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000023', 2026, 3, 15.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000023', 2026, 4, 15.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000024', 2026, 3, 20.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000024', 2026, 4, 20.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000025', 2026, 3, 25.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000025', 2026, 4, 25.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000026', 2026, 3, 30.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000026', 2026, 4, 30.00, null, null, false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000027', 2026, 3, 40.00, 'c7000000-0000-4000-8000-000000000028', 'win', false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000027', 2026, 4, 35.00, 'c7000000-0000-4000-8000-000000000021', 'loss', false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000028', 2026, 3, 30.00, 'c7000000-0000-4000-8000-000000000027', 'loss', false),
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000028', 2026, 4, 45.00, 'c7000000-0000-4000-8000-000000000022', 'win', false);

-- L3 week 3 (064's rows, T1=31 … T10=40): five primary + five secondary.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden) values
 ('d7000000-0000-4000-8000-000000000331', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000031', 'c7000000-0000-4000-8000-000000000040', 120.00, 70.00, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000332', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000032', 'c7000000-0000-4000-8000-000000000039', 110.00, 80.50, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000333', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000033', 'c7000000-0000-4000-8000-000000000038', 101.00, 88.10, 'live', 'away', true),
 ('d7000000-0000-4000-8000-000000000334', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000034', 'c7000000-0000-4000-8000-000000000037', 100.25, 90.00, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000335', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'regular',   'c7000000-0000-4000-8000-000000000035', 'c7000000-0000-4000-8000-000000000036',  95.00, 95.00, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000341', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'secondary', 'c7000000-0000-4000-8000-000000000031', 'c7000000-0000-4000-8000-000000000032', 120.00, 110.00, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000342', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'secondary', 'c7000000-0000-4000-8000-000000000033', 'c7000000-0000-4000-8000-000000000034', 101.00, 100.25, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000343', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'secondary', 'c7000000-0000-4000-8000-000000000035', 'c7000000-0000-4000-8000-000000000037',  95.00, 90.00, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000344', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'secondary', 'c7000000-0000-4000-8000-000000000036', 'c7000000-0000-4000-8000-000000000038',  95.00, 88.10, 'live', null, false),
 ('d7000000-0000-4000-8000-000000000345', 'b7000000-0000-4000-8000-000000000003', 2026, 3, 'secondary', 'c7000000-0000-4000-8000-000000000039', 'c7000000-0000-4000-8000-000000000040',  80.50, 70.00, 'live', null, false);

-- L4: week 3 clean; week 4 puts V1 (41) in two primary matchups (home in
-- one, away in the other — the unique pair allows it; the shape guard
-- refuses it).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status) values
 ('d7000000-0000-4000-8000-000000000431', 'b7000000-0000-4000-8000-000000000004', 2026, 3, 'regular', 'c7000000-0000-4000-8000-000000000041', 'c7000000-0000-4000-8000-000000000042', 100.00, 90.00, 'live'),
 ('d7000000-0000-4000-8000-000000000432', 'b7000000-0000-4000-8000-000000000004', 2026, 3, 'regular', 'c7000000-0000-4000-8000-000000000043', 'c7000000-0000-4000-8000-000000000044',  80.00, 70.00, 'live'),
 ('d7000000-0000-4000-8000-000000000441', 'b7000000-0000-4000-8000-000000000004', 2026, 4, 'regular', 'c7000000-0000-4000-8000-000000000041', 'c7000000-0000-4000-8000-000000000042', 100.00, 90.00, 'live'),
 ('d7000000-0000-4000-8000-000000000442', 'b7000000-0000-4000-8000-000000000004', 2026, 4, 'regular', 'c7000000-0000-4000-8000-000000000043', 'c7000000-0000-4000-8000-000000000041',  80.00, 70.00, 'live');

-- Digest helper: the rebuild's own rendering (never the row id).
create or replace function pg_temp.sr_digest(p_league uuid, p_week int) returns text language sql as $$
  select md5(coalesce(string_agg(
           r.team_id::text || '|' || r.points::text || '|' || coalesce(r.opponent_team_id::text, '') || '|' ||
           coalesce(r.h2h_result, '') || '|' || coalesce(r.median_result, '') || '|' ||
           coalesce(r.second_opponent_team_id::text, '') || '|' || coalesce(r.second_result, '') || '|' || r.is_final::text,
           ';' order by r.team_id), ''))
  from team_week_results r where r.league_id = p_league and r.season = 2026 and r.week = p_week
$$;
-- Standings rendering: rank:team:W-L-T:PF:PA:separated_by.
create or replace function pg_temp.sr_order(p_league uuid) returns text language sql as $$
  select string_agg(
           right(x ->> 'team_id', 2) || ':' || (x ->> 'wins') || '-' || (x ->> 'losses') || '-' || (x ->> 'ties') || ':' ||
           (x ->> 'points_for') || ':' || (x ->> 'points_against') || ':' || coalesce(x ->> 'separated_by', '-'),
           ',' order by (x ->> 'rank')::int)
  from jsonb_array_elements(public.league_standings(p_league) -> 'standings') x
$$;

-- ---------------------------------------------------------------------------
-- C. Finalization through the replaced body (116's job, 117's helpers) — and
--    the F244 report
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.finalize_matchups('2026-10-29 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 8,
  'C1 one run at week 7''s window: L1 weeks 3–7 (5) + L2 weeks 3–4 (2) + L3 week 3 (1) finalize = 8; L4 contributes NOTHING (F244)');
select is((select count(*)::int from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'weeks') x where x ->> 'league_id' = 'b7000000-0000-4000-8000-000000000004'),
  0, 'C1b F244: the report carries NO week for L4 — its week 3 rolled back with week 4''s raise and is not claimed as finalized');
select is((select x ->> 'sqlstate' || ':' || (x ->> 'error' like '%more than one primary matchup%')::text
           from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'failures') x where x ->> 'league_id' = 'b7000000-0000-4000-8000-000000000004'),
  'P0001:true', 'C1c …and `failures` carries the cause (the week-4 shape defect, P0001, from the shared helper)');
select is((select status || ':' || (select count(*)::text from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000004')
           from league_weeks where league_id = 'b7000000-0000-4000-8000-000000000004' and week = 3),
  'correction_window:0', 'C1d …L4 week 3 is still correction_window with ZERO rows (all-or-nothing per league — the report now agrees with the database)');
select is((select string_agg(week || '=' || status, ',' order by week) from league_weeks where league_id = 'b7000000-0000-4000-8000-000000000001'),
  '3=final,4=final,5=final,6=final,7=final,8=upcoming', 'C2 L1 weeks 3–7 final');
select is((select count(*)::int from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000001' and is_final), 26,
  'C2b …26 L1 rows (6 × 4 regular weeks + 2 playoff)');
select is((select string_agg(week || '=' || status, ',' order by week) from league_weeks where league_id = 'b7000000-0000-4000-8000-000000000002'),
  '3=final,4=final,5=upcoming,6=upcoming', 'C3 L2 weeks 3–4 final (total_points: all 16 provisional rows present)');
select is((select status || ':' || median_score::text from league_weeks where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3),
  'final:95.00', 'C4 L3 week 3 final, median 95.00 (064''s golden — the exact-median tie)');
select is((select string_agg(right(team_id::text, 2) || ':' || points || ':' || coalesce(h2h_result, '-') || ':' || coalesce(second_result, '-') || ':' || coalesce(median_result, '-'), ',' order by team_id)
           from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3),
  '31:120.00:win:win:win,32:110.00:win:loss:win,33:101.00:loss:win:win,34:100.25:win:loss:win,35:95.00:tie:win:tie,36:95.00:tie:win:tie,37:90.00:loss:loss:loss,38:88.10:win:loss:loss,39:80.50:loss:win:loss,40:70.00:loss:loss:loss',
  'C4b THE 10-TEAM GOLDEN through the factored helper: 064 E7 verbatim (points : h2h : second : median) — the override''s loss/win for T3/T8, the exact-median tie');
select set_config('pgtap.d3', pg_temp.sr_digest('b7000000-0000-4000-8000-000000000003', 3), true);
select set_config('pgtap.s3', public.league_standings('b7000000-0000-4000-8000-000000000003')::text, true);

-- ---------------------------------------------------------------------------
-- D. league_standings — authority, the L1 goldens (E63, the clean tie, the
--    PA direction, the coin flip, the chain), the L3 combined record, the
--    L2 E64 pair
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "97000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok($$ select public.league_standings('b7000000-0000-4000-8000-000000000001') $$,
  'D1 a MEMBER reads the standings (in-body is_league_member)');
select set_config('request.jwt.claims', '{"sub": "97000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok($$ select public.league_standings('b7000000-0000-4000-8000-000000000001') $$, '42501', null,
  'D1b a signed-in NON-member is refused by name (42501) — never handed an empty table');
select throws_ok($$ select public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) $$, '42501', null,
  'D1c the rebuild refuses a JWT-bearing caller (42501) — not a user verb');
select set_config('request.jwt.claims', '', true);
select ok(auth.uid() is null, 'D1d the claim is reset — the rest of the suite runs as the service (auth.uid() NULL)');
select throws_ok($$ select public.league_standings('b7000000-0000-4000-8000-0000000000ff') $$, 'P0002', null,
  'D1e an unknown league is P0002 (auth NULL — the service sees existence)');

-- The L1 default chain golden (hand-built in §B).
select is(pg_temp.sr_order('b7000000-0000-4000-8000-000000000001'),
  '02:3-1-0:400.00:375.00:-,03:3-1-0:400.00:355.00:points_against,01:3-1-0:400.00:345.00:points_against,04:1-3-0:340.00:370.00:win_pct,05:1-3-0:340.00:385.00:head_to_head,06:1-3-0:335.00:385.00:points_for',
  'D2 THE L1 GOLDEN (rank order — team:W-L-T:PF:PA:separated_by): the 3-way cycle A/B/C SKIPS head-to-head and falls to PA (B 375 > C 355 > A 345 — E63); D over E by the clean two-team head-to-head; F last by PF; the playoff week does not count (A stays 3-1 / 400)');
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'skipped'),
  '[{"entry": "head_to_head", "reason": "group_of_3_or_more", "teams": ["c7000000-0000-4000-8000-000000000001", "c7000000-0000-4000-8000-000000000002", "c7000000-0000-4000-8000-000000000003"]}]'::jsonb,
  'D2b …the E63 skip is NAMED with the group (A, B, C) — probe 1 reds D2 and this');
select is((select jsonb_agg(x ->> 'status' order by (x ->> 'entry')) from jsonb_array_elements(public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'chain') x),
  '["applied", "inert", "applied", "applied", "applied", "applied"]'::jsonb,
  'D2c the chain payload: division_record is INERT (Q30 (d)); every other entry applied');
select is((select x -> 'h2h_record' from jsonb_array_elements(public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'standings') x where right(x ->> 'team_id', 2) = '01'),
  '{"ties": 0, "wins": 3, "losses": 1}'::jsonb, 'D2d A''s h2h record 3-1-0 (the playoff win excluded)');
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') ->> 'weeks_final'), '4',
  'D2e four final REGULAR-season weeks count (week 7 is a playoff week — §7.3.7 "at end of regular season")');
select is((select x ->> 'win_pct' from jsonb_array_elements(public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'standings') x where right(x ->> 'team_id', 2) = '02'),
  '0.7500', 'D2f Win % rendered to 4 places (3-1 = 0.7500)');
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') ->> 'coin_flip_seed') || ':' || (select public.league_standings('b7000000-0000-4000-8000-000000000001') ->> 'coin_flip_seed_source'),
  '424242:schedule_seed', 'D2g the coin-flip seed is the league''s stored schedule_seed, named');
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'pa_gaps'), '[]'::jsonb,
  'D2h every opponent row present — no PA gap');

-- Points Against BEFORE head-to-head: the SAME pair flips (E's PA 385 > D's
-- 370 — higher PA FIRST, §7.3.7's deliberate direction).
update leagues set settings = jsonb_set(settings, '{tiebreakers}', '["win_pct", "points_for", "points_against", "head_to_head", "division_record", "coin_flip"]')
where id = 'b7000000-0000-4000-8000-000000000001';
select is(pg_temp.sr_order('b7000000-0000-4000-8000-000000000001'),
  '02:3-1-0:400.00:375.00:-,03:3-1-0:400.00:355.00:points_against,01:3-1-0:400.00:345.00:points_against,05:1-3-0:340.00:385.00:win_pct,04:1-3-0:340.00:370.00:points_against,06:1-3-0:335.00:385.00:points_for',
  'D3 PA-before-H2H: E (PA 385) now ranks ABOVE D (PA 370) though D beat E — the stored order is the chain, and HIGHER Points Against wins (deliberate, §7.3.7)');
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'skipped'), '[]'::jsonb,
  'D3b …and no 3-way group reaches head-to-head any more (PA separated A/B/C first) — nothing skipped');

-- The coin flip: [win_pct, coin_flip] stored; the rest appended; deterministic.
update leagues set settings = jsonb_set(settings, '{tiebreakers}', '["win_pct", "coin_flip"]')
where id = 'b7000000-0000-4000-8000-000000000001';
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'chain_appended'),
  '["points_for", "head_to_head", "points_against", "division_record"]'::jsonb,
  'D4 a trimmed stored chain is COMPLETED with the catalog''s remainder in default order (the chain is always total) — and the completion is named');
select is((select jsonb_agg(x ->> 'entry' order by (x ->> 'entry')) from jsonb_array_elements(public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'chain') x),
  '["coin_flip", "division_record", "head_to_head", "points_against", "points_for", "win_pct"]'::jsonb,
  'D4b …six entries in the effective chain');
select set_config('pgtap.flip1', pg_temp.sr_order('b7000000-0000-4000-8000-000000000001'), true);
select is(current_setting('pgtap.flip1'),
  '03:3-1-0:400.00:355.00:-,01:3-1-0:400.00:345.00:coin_flip,02:3-1-0:400.00:375.00:coin_flip,05:1-3-0:340.00:385.00:win_pct,06:1-3-0:335.00:385.00:coin_flip,04:1-3-0:340.00:370.00:coin_flip',
  'D4c THE COIN-FLIP LITERAL (seed 424242, md5 → 60 bits): C, A, B then E, F, D — every tie separated_by coin_flip (a stored literal from the first run; D4d is the determinism pin)');
select is(pg_temp.sr_order('b7000000-0000-4000-8000-000000000001'), current_setting('pgtap.flip1'),
  'D4d …the same seed a second time gives the same order (deterministic, never random())');
update leagues set settings = jsonb_set(settings, '{schedule_seed}', '424243') where id = 'b7000000-0000-4000-8000-000000000001';
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') ->> 'coin_flip_seed'), '424243',
  'D4e a re-minted seed is the new seed (a Remix re-flips an exact tie — F246)');
update leagues set settings = settings - 'schedule_seed' where id = 'b7000000-0000-4000-8000-000000000001';
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') ->> 'coin_flip_seed_source'), 'league_id',
  'D4f a league that never minted a seed flips on its own id — and SAYS so');
update leagues set settings = jsonb_set(settings, '{schedule_seed}', '424242') where id = 'b7000000-0000-4000-8000-000000000001';

-- A bad chain refuses by name.
update leagues set settings = jsonb_set(settings, '{tiebreakers}', '["win_pct", "strength_of_victory"]') where id = 'b7000000-0000-4000-8000-000000000001';
select throws_ok($$ select public.league_standings('b7000000-0000-4000-8000-000000000001') $$, 'P0001', null,
  'D5 an unknown tiebreaker entry refuses (P0001) — never silently skipped');
update leagues set settings = jsonb_set(settings, '{tiebreakers}', '["win_pct", "win_pct"]') where id = 'b7000000-0000-4000-8000-000000000001';
select throws_ok($$ select public.league_standings('b7000000-0000-4000-8000-000000000001') $$, 'P0001', null,
  'D5b a duplicated entry refuses (P0001)');
update leagues set settings = settings - 'tiebreakers' where id = 'b7000000-0000-4000-8000-000000000001';
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'chain_appended'),
  '["win_pct", "points_for", "head_to_head", "points_against", "division_record", "coin_flip"]'::jsonb,
  'D5c no stored chain ⇒ the catalog default, whole (§7.3.7 v1 default)');
select is(pg_temp.sr_order('b7000000-0000-4000-8000-000000000001'),
  '02:3-1-0:400.00:375.00:-,03:3-1-0:400.00:355.00:points_against,01:3-1-0:400.00:345.00:points_against,04:1-3-0:340.00:370.00:win_pct,05:1-3-0:340.00:385.00:head_to_head,06:1-3-0:335.00:385.00:points_for',
  'D5d …and orders exactly as D2');

-- Provisional rows never count; a missing opponent row is COUNTED, never a
-- silent 0: un-finalize B''s week-3 row.
update team_week_results set is_final = false where league_id = 'b7000000-0000-4000-8000-000000000001' and team_id = 'c7000000-0000-4000-8000-000000000002' and week = 3;
select is((select x ->> 'wins' || '-' || (x ->> 'losses') || ':' || (x ->> 'points_for') || ':' || (x ->> 'weeks') from jsonb_array_elements(public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'standings') x where right(x ->> 'team_id', 2) = '02'),
  '3-0:305.00:3', 'D6 a provisional (is_final = false) row does not count: B (whose week-3 row is its LOSS to A) reads 3-0 / 305 over 3 weeks (§11.5 — computed from FINAL matchups)');
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'pa_gaps'),
  '[{"team_id": "c7000000-0000-4000-8000-000000000001", "weeks_without_opponent_row": 1}]'::jsonb,
  'D6b …and A''s missing opponent row is NAMED in pa_gaps (its PA is short by 95, and the payload says so)');
update team_week_results set is_final = true where league_id = 'b7000000-0000-4000-8000-000000000001' and team_id = 'c7000000-0000-4000-8000-000000000002' and week = 3;
select is((select public.league_standings('b7000000-0000-4000-8000-000000000001') -> 'pa_gaps'), '[]'::jsonb, 'D6c …restored');

-- L3: the combined record (h2h + second + median), the tie through PA to the flip.
select is(pg_temp.sr_order('b7000000-0000-4000-8000-000000000003'),
  '31:3-0-0:120.00:70.00:-,32:2-1-0:110.00:80.50:win_pct,33:2-1-0:101.00:88.10:points_for,34:2-1-0:100.25:90.00:points_for,36:1-0-2:95.00:95.00:points_for,35:1-0-2:95.00:95.00:coin_flip,38:1-2-0:88.10:101.00:win_pct,39:1-2-0:80.50:110.00:points_for,37:0-3-0:90.00:100.25:win_pct,40:0-3-0:70.00:120.00:points_for',
  'D7 THE L3 GOLDEN: combined W-L-T (h2h + second + median — §11.7), the 1-0-2 pair at .667 among the 2-1-0s (a tie is half — (2W+T)/2G), T5/T6 equal on PF, head-to-head (they tied), PA and the inert division entry ⇒ coin flip; T3 (the overridden loss) 2-1-0');
select is((select public.league_standings('b7000000-0000-4000-8000-000000000003') -> 'skipped'), '[]'::jsonb,
  'D7b the T5/T6 pair is a CLEAN two-team tie — head-to-head ran (and could not separate them); nothing skipped');
select is((select x -> 'median_record' from jsonb_array_elements(public.league_standings('b7000000-0000-4000-8000-000000000003') -> 'standings') x where right(x ->> 'team_id', 2) = '35'),
  '{"ties": 1, "wins": 0, "losses": 0}'::jsonb, 'D7c T5''s median record is the E39 tie');

-- L2 (total_points): E64 — head-to-head skipped by schedule_mode.
select is(pg_temp.sr_order('b7000000-0000-4000-8000-000000000002'),
  '21:1-0-0:60.00:35.00:-,28:1-1-0:75.00:95.00:win_pct,27:1-1-0:75.00:80.00:points_against,22:0-1-0:75.00:45.00:win_pct,26:0-0-0:60.00:0:points_for,25:0-0-0:50.00:0:points_for,24:0-0-0:40.00:0:points_for,23:0-0-0:30.00:0:points_for',
  'D8 THE L2 GOLDEN (E64): U8 ranks ABOVE U7 by PA (95 > 80) though U7 BEAT U8 in the rows they carry — head-to-head is skipped for a total_points league by schedule_mode, not by the absence of data');
select is((select public.league_standings('b7000000-0000-4000-8000-000000000002') -> 'skipped'),
  '[{"entry": "head_to_head", "reason": "total_points", "teams": ["c7000000-0000-4000-8000-000000000027", "c7000000-0000-4000-8000-000000000028"]}]'::jsonb,
  'D8b …the E64 skip is NAMED with the pair');
select is((select x ->> 'status' || ':' || (x ->> 'reason') from jsonb_array_elements(public.league_standings('b7000000-0000-4000-8000-000000000002') -> 'chain') x where x ->> 'entry' = 'head_to_head'),
  'skipped:total_points', 'D8c …and the chain payload says the entry is skipped for this league');
select is((select public.league_standings('b7000000-0000-4000-8000-000000000002') ->> 'coin_flip_seed'), '7',
  'D8d L2 flips on its own stored seed');

-- Loud emptiness: a league with no final week.
select is((select public.league_standings('b7000000-0000-4000-8000-000000000004') ->> 'reason') || ':' || (select public.league_standings('b7000000-0000-4000-8000-000000000004') ->> 'weeks_final'),
  'no_final_weeks:0', 'D9 L4 has no final week: every team 0-0-0 and the payload SAYS why (rule 10)');
select is((select count(*)::int from jsonb_array_elements(public.league_standings('b7000000-0000-4000-8000-000000000004') -> 'standings') x where x ->> 'games' = '0'),
  4, 'D9b …four seated teams at 0 games');

-- ---------------------------------------------------------------------------
-- E. rebuild_team_week_results — the equivalence, the override, idempotence,
--    every refusal by name with its twin
-- ---------------------------------------------------------------------------
-- Corrupt every cell of L3 week 3 (and the stored median).
update team_week_results set points = 0, h2h_result = 'win', median_result = null, second_result = null, second_opponent_team_id = null, opponent_team_id = null
where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3;
update league_weeks set median_score = null where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3;
select isnt(pg_temp.sr_digest('b7000000-0000-4000-8000-000000000003', 3), current_setting('pgtap.d3'),
  'E1 the corruption changed the digest (the equivalence cells below can fail)');
select isnt(public.league_standings('b7000000-0000-4000-8000-000000000003')::text, current_setting('pgtap.s3'),
  'E1b …and the standings (every team 1-0 at 0 PF)');

select set_config('pgtap.r', public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3)::text, true);
select is(pg_temp.sr_digest('b7000000-0000-4000-8000-000000000003', 3), current_setting('pgtap.d3'),
  'E2 THE EQUIVALENCE PIN: the rebuilt rows are BYTE-IDENTICAL to what finalize_matchups wrote (digest ≡) — one helper, called by both (D137/D297)');
select is(public.league_standings('b7000000-0000-4000-8000-000000000003')::text, current_setting('pgtap.s3'),
  'E2b …and standings ≡ rebuild-from-scratch (the whole payload)');
select is((current_setting('pgtap.r')::jsonb ->> 'changed') || ':' || (current_setting('pgtap.r')::jsonb ->> 'results') || ':' || (current_setting('pgtap.r')::jsonb ->> 'median_score') || ':' || (current_setting('pgtap.r')::jsonb ->> 'median_score_changed'),
  'true:10:95.00:true', 'E2c the report: changed, 10 rows, median 95.00 restored to league_weeks (median_score_changed)');
select is((current_setting('pgtap.r')::jsonb ->> 'digest_after'), current_setting('pgtap.d3'),
  'E2d …the report''s digest_after is the finalized digest');
select is((select median_score::text from league_weeks where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3), '95.00',
  'E2e league_weeks.median_score rewritten (the rounded store)');
select is((select status || ':' || (finalized_at is not null)::text from league_weeks where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3), 'final:true',
  'E2f …status and finalized_at untouched');
-- The override (§12.18 precedence / §22.2): stored 'away' though home scored more.
select is((select h2h_result from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3 and team_id = 'c7000000-0000-4000-8000-000000000033'), 'loss',
  'E3 THE OVERRIDE PIN: after the rebuild T3 (home, 101.00) reads LOSS — the overridden result is honoured, never recomputed (probe 2 reds this)');
select is((select h2h_result from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3 and team_id = 'c7000000-0000-4000-8000-000000000038'), 'win',
  'E3b …and T8 (away, 88.10) reads WIN');
select is(public.matchup_result_internal(101.00, 88.10, 'c7000000-0000-4000-8000-000000000038'), 'home',
  'E3c …while the E38 derivation on the same scores says HOME — the cell can only pass by reading the override');
select is((select result || ':' || is_overridden::text || ':' || home_score || ':' || away_score from matchups where id = 'd7000000-0000-4000-8000-000000000333'), 'away:true:101.00:88.10',
  'E3d …and the matchup row itself is untouched by the rebuild');
-- Idempotence (rule 10).
select set_config('pgtap.r', public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3)::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'changed') || ':' || (current_setting('pgtap.r')::jsonb ->> 'reason'), 'false:already_consistent',
  'E4 a second rebuild changes nothing and SAYS why (already_consistent)');
select is(pg_temp.sr_digest('b7000000-0000-4000-8000-000000000003', 3), current_setting('pgtap.d3'), 'E4b …digest unchanged');

-- Refusals by name, each with its one-unit-away twin.
select throws_ok($$ select public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 4) $$, 'P0001', null,
  'E5 week 4 (upcoming) refuses — week_not_final (an open week is the door''s — D295); week 3 (final) rebuilt in E2');
select throws_like($$ select public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 4) $$, '%week_not_final%',
  'E5b …by NAME');
select throws_ok($$ select public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 99) $$, 'P0002', null,
  'E5c a week with no league_weeks row is P0002');
select throws_ok($$ select public.rebuild_team_week_results('b7000000-0000-4000-8000-0000000000ff', 3) $$, 'P0002', null,
  'E5d an unknown league is P0002');

update matchups set home_score = null where id = 'd7000000-0000-4000-8000-000000000331';
select throws_like($$ select public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) $$, '%pending_scores%',
  'E6 a NULL score on a final week refuses by name (pending_scores) — never coerced to 0.00 (E61)');
select is(pg_temp.sr_digest('b7000000-0000-4000-8000-000000000003', 3), current_setting('pgtap.d3'), 'E6b …and nothing was written');
update matchups set home_score = 120.00 where id = 'd7000000-0000-4000-8000-000000000331';
select is((public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) ->> 'changed'), 'false',
  'E6c …restored: the rebuild runs again (and changes nothing)');

update matchups set result = 'away' where id = 'd7000000-0000-4000-8000-000000000331';
select throws_like($$ select public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) $$, '%result_drift%',
  'E7 a NON-overridden final matchup whose stored result is not its scores'' E38 result refuses by name (result_drift) — the source of truth is read, never repaired (F245)');
select is((select result from matchups where id = 'd7000000-0000-4000-8000-000000000331'), 'away',
  'E7b …and the matchup row was NOT rewritten');
update matchups set result = 'home' where id = 'd7000000-0000-4000-8000-000000000331';
select is((public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) ->> 'changed'), 'false',
  'E7c …restored: rebuilds again');
-- The override arm of the drift check: an overridden row may disagree with
-- its scores (that IS the override) — no drift.
update matchups set result = 'tie' where id = 'd7000000-0000-4000-8000-000000000333';
select is((public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) ->> 'changed'), 'true',
  'E7d an OVERRIDDEN row changed to ''tie'' is not drift — it is the override, and the rebuild carries it');
select is((select h2h_result from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3 and team_id = 'c7000000-0000-4000-8000-000000000033'), 'tie',
  'E7e …T3 now reads tie');
update matchups set result = 'away' where id = 'd7000000-0000-4000-8000-000000000333';
select is((public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) ->> 'digest_after'), current_setting('pgtap.d3'),
  'E7f …restored to the finalized digest');

update matchups set status = 'live' where id = 'd7000000-0000-4000-8000-000000000341';
select throws_like($$ select public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) $$, '%matchup_not_final%',
  'E8 a matchup of a final week that is not final refuses by name (matchup_not_final)');
update matchups set status = 'final' where id = 'd7000000-0000-4000-8000-000000000341';
select is((public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) ->> 'changed'), 'false', 'E8b …restored');

-- A score CORRECTION on a final week (the M6 path, simulated: score + result
-- written together): T10 70.00 → 130.00 beats T1; the rebuild re-derives.
update matchups set away_score = 130.00, result = 'away' where id = 'd7000000-0000-4000-8000-000000000331';
select set_config('pgtap.r', public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3)::text, true);
select is((select points || ':' || h2h_result || ':' || median_result from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3 and team_id = 'c7000000-0000-4000-8000-000000000040'),
  '130.00:win:win', 'E9 the correction lands: T10 130.00, h2h win, median win');
select is((select h2h_result || ':' || median_result from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3 and team_id = 'c7000000-0000-4000-8000-000000000031'),
  'loss:win', 'E9b …T1 now a loss (median still a win at 120.00)');
select is((current_setting('pgtap.r')::jsonb ->> 'median_score'), '97.63',
  'E9c …the median moved: sorted 80.5, 88.1, 90, 95, 95, 100.25, 101, 110, 120, 130 ⇒ (95 + 100.25) / 2 = 97.625 EXACT, stored 97.63 (D57(2))');
select is((select median_result from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000003' and week = 3 and team_id = 'c7000000-0000-4000-8000-000000000035'), 'loss',
  'E9d …T5 (95.00) is now BELOW the exact median 97.625 — loss');
select is((select x ->> 'wins' || '-' || (x ->> 'losses') || '-' || (x ->> 'ties') from jsonb_array_elements(public.league_standings('b7000000-0000-4000-8000-000000000003') -> 'standings') x where right(x ->> 'team_id', 2) = '40'),
  '2-1-0', 'E9e …and the standings read the rebuilt rows: T10 2-1-0');
update matchups set away_score = 70.00, result = 'home' where id = 'd7000000-0000-4000-8000-000000000331';
select is((public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000003', 3) ->> 'digest_after'), current_setting('pgtap.d3'),
  'E9f …reverted: the rebuild returns to the finalized digest exactly');

-- total_points: R788 holds in the rebuild — a missing seated row refuses by
-- name; nothing is zero-filled.
delete from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000002' and week = 4 and team_id = 'c7000000-0000-4000-8000-000000000023';
select throws_like($$ select public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000002', 4) $$, '%pending_results%',
  'E10 a total_points week with a seated team lacking a row refuses by name (pending_results) — absence is not a score (R788)');
select is((select count(*)::int from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000002' and week = 4), 7,
  'E10b …seven rows stay seven: nothing zero-filled');
insert into team_week_results (league_id, team_id, season, week, points, is_final) values
 ('b7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000023', 2026, 4, 15.00, false);
select set_config('pgtap.r', public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000002', 4)::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'changed') || ':' || (current_setting('pgtap.r')::jsonb ->> 'results') || ':' || (current_setting('pgtap.r')::jsonb ->> 'schedule_mode'),
  'true:8:total_points', 'E10c …the row restored: the rebuild flips it final (8 rows, total_points)');
select is((select is_final::text || ':' || points from team_week_results where league_id = 'b7000000-0000-4000-8000-000000000002' and week = 4 and team_id = 'c7000000-0000-4000-8000-000000000023'), 'true:15.00',
  'E10d …the worker''s points untouched');
select is(pg_temp.sr_order('b7000000-0000-4000-8000-000000000002'),
  '21:1-0-0:60.00:35.00:-,28:1-1-0:75.00:95.00:win_pct,27:1-1-0:75.00:80.00:points_against,22:0-1-0:75.00:45.00:win_pct,26:0-0-0:60.00:0:points_for,25:0-0-0:50.00:0:points_for,24:0-0-0:40.00:0:points_for,23:0-0-0:30.00:0:points_for',
  'E10e …and the L2 standings are D8 again');
select is((public.rebuild_team_week_results('b7000000-0000-4000-8000-000000000002', 4) ->> 'reason'), 'already_consistent',
  'E10f a second total_points rebuild is a named no-op');

-- The finalize job stays idempotent through the factoring (064 E9 shape).
select set_config('pgtap.r', public.finalize_matchups('2026-10-29 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 0, 'E11 a re-run finalizes nothing (final weeks are never re-claimed)');
select is(pg_temp.sr_digest('b7000000-0000-4000-8000-000000000003', 3), current_setting('pgtap.d3'), 'E11b …L3''s rows untouched');
select is((select count(*)::int from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'failures') x where x ->> 'league_id' = 'b7000000-0000-4000-8000-000000000004'),
  1, 'E11c …L4 fails again, by name, every run (F50''s inherited ceiling; never silent)');

select * from finish();
rollback;
