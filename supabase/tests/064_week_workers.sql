-- ============================================================================
-- The week workers — pgTAP 064 (task L.D1.6; migration 116; spec v2.16.21
-- §14 / §11.2 / §11.4 / §11.7 / §12.17–§12.19 / §22.2 / §22.3 / §23.2 /
-- §23.3 / E38 / E39 / E42 / E43; PROGRESS D291 / D293 / D295 / D297 / D313;
-- F4 / F227(e) / F232 / F238; tasks-M4 §4 rules 1–11).
--
-- Numbering: pgTAP head measured 063 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 064 (D311(1)/D312(1) — the reservation shifted twice).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * EVERY INSTANT IS A STORED LITERAL on the 2026 calendar, injected as
--     `p_now` (D291) — no `now()` arithmetic anywhere; the four-cell
--     boundary crossings (D146) are −1s / AT on: `starts_at` (open),
--     `last_game_ends_at` (close), the kickoff (lock), the release, and
--     `correction_window_ends_at` (finalize) × all-games-final / one-open.
--   * THE AGREEMENT PIN (F227(e)/F232/F238): at every tick instant each
--     pool row's stamped `locked_until` is compared to what 115's
--     `pool_game_lock_any_internal` RETURNS for that player at that instant
--     (locked ⇒ COALESCE(window_ends_at, 'infinity'); else NULL) — the tick
--     must AGREE with enforcement, never decide. The PR's probe 2 makes the
--     tick compute its own release (the correction window) and these cells
--     red. A NULL `last_game_ends_at` stamps 'infinity' (F238 loud state).
--   * THE NO-PARTIAL-DATA PIN (§23.2): with one in-week game not final the
--     week is skipped BY NAME at the window instant and stays
--     `correction_window`; with zero game rows likewise; the PR's probe 1
--     removes the gate and these cells red. A `postponed` game is EXCLUDED
--     (E43) ONLY when its kickoff lies at or beyond the next calendar
--     week's `starts_at` — a postponed game still inside the week is OPEN
--     and holds the week, with −1s / AT twins on the bound (R791) — and
--     the system note is pinned (user_id NULL, is_system). A NULL score
--     under an OVERRIDE is pending too (`pending_scores`; R792). A
--     total_points week with ANY seated team lacking a result row is held
--     BY NAME (`pending_results`) — partial (7 of 8) and all-absent (0 of
--     8) — and finalizes only once the row exists; nothing is zero-filled
--     (R788; probe 4 reds the all-absent cells and the week flips final).
--   * GOLDENS AS STORED LITERALS (D62): a 10-team week with the exact-median
--     tie (E39 — the two middle scores are both 95.00), a two-decimal H2H
--     tie (E38), second-opponent attribution from the `secondary` rows, an
--     OVERRIDDEN cell preserved (result 'away' though the home side scored
--     more), PF counted ONCE (10 rows, Σ 949.85); a second week whose two
--     middle scores are 0.01 APART (95.01 / 95.02: the EXACT 95.015 is
--     compared, 95.02 is STORED, and the 95.02 team WINS though he equals
--     the stored value — R789; probe 5 compares `round(v_median, 2)` and
--     reds it); a total_points week held by name until its eighth row
--     arrives (R788); a playoff week with NO median (regular season only).
--   * AUTO-CARRY GOLDEN (D293): the first open writes an EXPLICIT empty row
--     per seated team; a hand-set week-3 lineup carries to week 4 with the
--     BYE starter flagged `bye`, the OUT starter flagged `out`, the
--     since-dropped starter's slot EMPTIED and NAMED in the report, the IR
--     key kept, `locked_at` = the earliest started kickoff; an unset lineup
--     carries as empty with `carried_from_week` recorded.
--   * IDEMPOTENCE (rule 10): each job re-run at the same instant ⇒ ZERO
--     writes, asserted by the report's counts AND by table digests; the PR's
--     probe 3 removes the pool `IS DISTINCT FROM` guard and these cells red.
--   * All privileged-context work runs as postgres (auth.uid() NULL — the
--     job's own precondition); the JWT-refusal cell sets a claim and resets
--     it (set_config(..., true) persists to txn end — D49(7)).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(141);

-- ---------------------------------------------------------------------------
-- A. Form pins — shape, REVOKE, cron rows, the column comment, the sweep
-- ---------------------------------------------------------------------------
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('lineup_lock_tick', 'league_week_advance', 'finalize_matchups')),
  'A1 the three job RPCs are SECURITY DEFINER with search_path='''' (rule 2)');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  'p_now timestamp with time zone DEFAULT now(), p_league_id uuid DEFAULT NULL::uuid',
  'A2 lineup_lock_tick(p_now DEFAULT now(), p_league_id DEFAULT NULL) — D291''s signature + the scope seam (D313)');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'league_week_advance'),
  'p_now timestamp with time zone DEFAULT now(), p_league_id uuid DEFAULT NULL::uuid',
  'A3 league_week_advance(p_now DEFAULT now(), p_league_id DEFAULT NULL)');
select is(
  (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'finalize_matchups'),
  'p_now timestamp with time zone DEFAULT now(), p_league_id uuid DEFAULT NULL::uuid',
  'A4 finalize_matchups(p_now DEFAULT now(), p_league_id DEFAULT NULL)');
select ok(
  not has_function_privilege('anon', 'public.lineup_lock_tick(timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_lock_tick(timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.league_week_advance(timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.league_week_advance(timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_matchups(timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_matchups(timestamptz,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_carry_internal(uuid,uuid,integer,integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.week_games_state_internal(integer,integer)', 'EXECUTE'),
  'A5 the three jobs and both helpers are REVOKEd from anon + authenticated (a fresh CREATE has PUBLIC EXECUTE by default — load-bearing)');
select ok(
  has_function_privilege('service_role', 'public.lineup_lock_tick(timestamptz,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.league_week_advance(timestamptz,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_matchups(timestamptz,uuid)', 'EXECUTE'),
  'A6 the service role keeps EXECUTE on the three jobs — the harness/sim door (D291)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('lineup_carry_internal', 'week_games_state_internal')),
  'A7 the two helpers are PLAIN with search_path='''' — reachable through the DEFINER jobs or as postgres');
select is((select schedule || ' | ' || command from cron.job where jobname = 'lineup-lock'),
  '* * * * * | SELECT public.lineup_lock_tick()',
  'A8 cron: lineup-lock every minute, no arguments (production passes nothing — D291)');
select is((select schedule || ' | ' || command from cron.job where jobname = 'league-week-advance'),
  '0 * * * * | SELECT public.league_week_advance()',
  'A9 cron: league-week-advance hourly at :00');
select is((select schedule || ' | ' || command from cron.job where jobname = 'finalize-matchups'),
  '5 * * * * | SELECT public.finalize_matchups()',
  'A10 cron: finalize-matchups hourly at :05 (after the advance)');
select is((select count(*)::int from cron.job where jobname in ('lineup-lock', 'league-week-advance', 'finalize-matchups')),
  3, 'A11 exactly ONE cron row per job (§22.3 — never one per league)');
select ok(
  (select col_description('public.league_player_pool'::regclass, a.attnum)
   from pg_attribute a where a.attrelid = 'public.league_player_pool'::regclass and a.attname = 'locked_until')
  like '%VIEW%NEVER read from this column%''infinity''%',
  'A12 F232 column half: the live comment on locked_until says VIEW, never read for enforcement, and names the infinity arm');
select ok(
  (select p.prosrc like '%pool_game_lock_any_internal%' and p.prosrc not like '%correction\_window\_ends\_at%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  'A13 the tick''s body reads the lock through 115''s helper and never names the correction-window column (the agreement law — probe 2 reds this)');

-- The JWT refusal (in-body auth, rule 2): a signed-in caller is refused.
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.lineup_lock_tick('2026-09-23 04:00:00+00') $$, '42501', null,
  'A14 lineup_lock_tick refuses a JWT-bearing caller in-body (42501) — a job, not a user verb');
select throws_ok($$ select public.league_week_advance('2026-09-23 04:00:00+00') $$, '42501', null,
  'A15 league_week_advance refuses a JWT-bearing caller (42501)');
select throws_ok($$ select public.finalize_matchups('2026-09-23 04:00:00+00') $$, '42501', null,
  'A16 finalize_matchups refuses a JWT-bearing caller (42501)');
select set_config('request.jwt.claims', '', true);
select ok(auth.uid() is null, 'A17 the claim is reset — the rest of the suite runs as the job (auth.uid() NULL)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context)
--    Calendar (2026, stored literals): week 3 starts 2026-09-23 04:00Z, last
--    game ends 2026-09-29 04:00Z, correction window 2026-10-01 10:00Z; week 4
--    starts 09-30, ends 10-06, window 10-08; week 5 starts 10-07, ends NULL
--    (the F238 state), window 10-15; week 6 starts 10-14, ends 10-20, window
--    10-22, NO game rows; week 7 (playoff) starts 10-21, ends 10-27, window
--    10-29. Games: week 3 KC@BUF Thu 09-25 00:15Z, DAL@PHI Sun 09-27 17:00Z,
--    NYG@SF Mon 09-29 00:15Z; week 4 the same three teams + a POSTPONED
--    MIA@NYJ (kickoff moved to 10-13, status postponed); week 7 one game.
--    L1: 10 teams, h2h, median + second on, weeks 3–8 (regular 3–6, playoff
--    7–8). L2: 8 teams, total_points, weeks 3–6. L3: 8 teams, `scheduled`
--    (never touched).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('96000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-ww' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'ww_user' || i)::jsonb, now(), now()
from generate_series(1, 10) i;

-- Weeks 1–2 are OVER and STAMPED (ingestion recorded their last game end —
-- an unstamped past week with no game rows binds every player through the
-- R740 fallback, 115's documented F238(ii) shape, which is not this suite's
-- subject); weeks ≥ 9 stay NULL and ahead.
update nfl_weeks set first_kickoff_at = null, last_game_ends_at = null where season = 2026;
update nfl_weeks set last_game_ends_at = starts_at + interval '6 days' where season = 2026 and week in (1, 2);
update nfl_weeks set starts_at = '2026-09-23 04:00:00+00', last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set starts_at = '2026-09-30 04:00:00+00', last_game_ends_at = '2026-10-06 04:00:00+00', correction_window_ends_at = '2026-10-08 10:00:00+00' where season = 2026 and week = 4;
update nfl_weeks set starts_at = '2026-10-07 04:00:00+00', last_game_ends_at = null,                     correction_window_ends_at = '2026-10-15 10:00:00+00' where season = 2026 and week = 5;
update nfl_weeks set starts_at = '2026-10-14 04:00:00+00', last_game_ends_at = '2026-10-20 04:00:00+00', correction_window_ends_at = '2026-10-22 10:00:00+00' where season = 2026 and week = 6;
update nfl_weeks set starts_at = '2026-10-21 04:00:00+00', last_game_ends_at = '2026-10-27 04:00:00+00', correction_window_ends_at = '2026-10-29 10:00:00+00' where season = 2026 and week = 7;
update nfl_weeks set starts_at = '2026-10-28 04:00:00+00', last_game_ends_at = null,                     correction_window_ends_at = '2026-11-05 11:00:00+00' where season = 2026 and week = 8;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('ww-w3-a', 2026, 3, 'BUF', 'KC',  '2026-09-25 00:15:00+00', 'final'),
 ('ww-w3-b', 2026, 3, 'PHI', 'DAL', '2026-09-27 17:00:00+00', 'final'),
 ('ww-w3-c', 2026, 3, 'SF',  'NYG', '2026-09-29 00:15:00+00', 'final'),
 ('ww-w4-a', 2026, 4, 'BUF', 'KC',  '2026-10-02 00:15:00+00', 'final'),
 ('ww-w4-b', 2026, 4, 'PHI', 'DAL', '2026-10-04 17:00:00+00', 'final'),
 ('ww-w4-c', 2026, 4, 'SF',  'NYG', '2026-10-06 00:15:00+00', 'final'),
 ('ww-w4-p', 2026, 4, 'NYJ', 'MIA', '2026-10-13 00:15:00+00', 'postponed'),
 ('ww-w7-a', 2026, 7, 'BUF', 'KC',  '2026-10-23 00:15:00+00', 'final');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings) values
 ('b6000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', 'pgtap-ww-L1', 2026, 'in_season', 10, 4, 4, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h", "median_game": true, "second_opponent": true, "allow_illegal_lineups": true}',
  '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1},
      {"key": "flex", "label": "W/R/T", "eligible": ["WR", "RB", "TE"], "count": 1}],
    "bench": 3,
    "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}],
    "swap_spots": 0}'),
 ('b6000000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000001', 'pgtap-ww-L2', 2026, 'in_season', 8, 4, 0, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "total_points", "median_game": false, "second_opponent": false}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}'),
 ('b6000000-0000-4000-8000-000000000003', '96000000-0000-4000-8000-000000000002', 'pgtap-ww-L3', 2026, 'scheduled', 8, 4, 4, 5,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"schedule_mode": "h2h"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '96000000-0000-4000-8000-000000000001', 'WW T' || i, 'b6000000-0000-4000-8000-000000000001'
from generate_series(1, 10) i;
insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-0000000000' || (20 + i)::text)::uuid,
       '96000000-0000-4000-8000-000000000001', 'WW U' || i, 'b6000000-0000-4000-8000-000000000002'
from generate_series(1, 8) i;
insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-0000000000' || (30 + i)::text)::uuid,
       '96000000-0000-4000-8000-000000000002', 'WW V' || i, 'b6000000-0000-4000-8000-000000000003'
from generate_series(1, 8) i;

insert into league_weeks (league_id, season, week)
select 'b6000000-0000-4000-8000-000000000001', 2026, g from generate_series(3, 8) g;
insert into league_weeks (league_id, season, week)
select 'b6000000-0000-4000-8000-000000000002', 2026, g from generate_series(3, 6) g;
insert into league_weeks (league_id, season, week)
select 'b6000000-0000-4000-8000-000000000003', 2026, g from generate_series(3, 8) g;

insert into players (id, full_name, position, team, status) values
 ('ww-qb',        'WW QB',        'QB', 'KC',  'Active'),
 ('ww-rb-bye',    'WW RB Bye',    'RB', 'LAC', 'Active'),     -- LAC never has a game row: BYE every week
 ('ww-wr-out',    'WW WR Out',    'WR', 'DAL', 'Out'),
 ('ww-flex-gone', 'WW TE Gone',   'TE', 'PHI', 'Active'),     -- dropped between week 3 and week 4
 ('ww-rb2',       'WW RB2',       'RB', 'DAL', 'Active'),
 ('ww-ir',        'WW IR',        'RB', 'SF',  'IR'),
 ('ww-fa-kc',     'WW FA KC',     'QB', 'KC',  'Active'),     -- pool: free agent
 ('ww-wv-dal',    'WW WV DAL',    'WR', 'DAL', 'Active');     -- pool: on waivers
insert into league_rosters (league_id, team_id, player_id, slot_key, ir_placed_week)
values
 ('b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'ww-qb',        'qb:0',   null),
 ('b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'ww-rb-bye',    'rb:0',   null),
 ('b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'ww-wr-out',    'wr:0',   null),
 ('b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'ww-flex-gone', 'flex:0', null),
 ('b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'ww-rb2',       'bn',     null),
 ('b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'ww-ir',        'ir1',    3);
insert into league_player_pool (league_id, player_id, state, waivers_until) values
 ('b6000000-0000-4000-8000-000000000001', 'ww-fa-kc',  'free_agent', null),
 ('b6000000-0000-4000-8000-000000000001', 'ww-wv-dal', 'on_waivers', '2026-09-26 00:00:00+00'),
 ('b6000000-0000-4000-8000-000000000001', 'ww-qb',     'rostered',   null);

-- L.E1.3 (tasks-M6A §4 rule 14(d), D339): this suite had ZERO league_members
-- rows, so under D339's autopilot predicate every team here read as
-- "unmanaged" and a predicate proof could not distinguish that from
-- "autopilot seats everyone" — it would pass with the predicate deleted.
-- None of this file's goldens (C/D/E) depend on any L1 or L2 team being
-- UNMANAGED, so every one of them gets a seated member row here. This is
-- the coverage L.E1.3 COMPLETES in 067 as well (R988): 067's seating is at
-- 067:268-289 (its premise cell C1 at 067:291-307), and before this task it
-- held ONE member row for eight L1 teams — the very defect rule 14(d)
-- names, not a rule 067 had already applied.
--
-- SEAT 1 OF EACH LEAGUE IS THE COMMISSIONER, not a manager (R989). Both
-- in_season leagues here carry owner_id 96…0001, and create_league ALWAYS
-- seats its creator 'commissioner' (118:2418 — the newest definition),
-- while 063:327's partial unique one_commissioner_per_league caps it at one
-- PER LEAGUE (so one each is legal). An all-'manager' fixture is a state
-- §7.2 forbids and no sanctioned path can produce, and it would make
-- is_league_commish (052:96) FALSE for every user here — so every future
-- commissioner-verb refusal cell added to this suite would pass because
-- NOBODY is commissioner, which is rule 14's exact species.
--
-- L3 is DELIBERATELY left with NO member rows: it is 'scheduled' and
-- untouched by every worker in this file (C2j/C2k assert exactly that — no
-- lineup row is even written for it), so asserting "managed" over it would
-- assert nothing. B1 below is scoped to the two in_season leagues for that
-- reason.
insert into league_members (league_id, user_id, team_id, role)
select 'b6000000-0000-4000-8000-000000000001',
       ('96000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c6000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 10) i;
insert into league_members (league_id, user_id, team_id, role)
select 'b6000000-0000-4000-8000-000000000002',
       ('96000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       ('c6000000-0000-4000-8000-0000000000' || (20 + i)::text)::uuid,
       case when i = 1 then 'commissioner' else 'manager' end
from generate_series(1, 8) i;

-- THE SEATING PREMISE, ASSERTED RATHER THAN ASSUMED (§4 rule 14(c), the
-- 071:258-266 shape — R987). Without this cell the seating above is
-- unfalsifiable: under-seating by one team (generate_series(1, 9)) leaves
-- m31's away side unmanaged and the suite still reports 140/140, so the one
-- premise this task exists to establish could silently rot.
-- ONE golden string rather than three cells, because each clause closes a
-- hole the others leave open: a bare "unmanaged = 0" is also true of an
-- EMPTY teams set, and a bare "18 managed" survives a nineteenth team
-- arriving unseated. The LEFT JOIN is D339's predicate
-- (`NOT EXISTS … m.team_id = t.id AND m.user_id IS NOT NULL`) read from the
-- other side, and it additionally pins the invariant D339 says must be
-- asserted and never inferred — ONE league_members row per seat (§12.2,
-- 120:558): a second row for one team would make `teams` count 19.
select is(
  (select format('teams=%s managed=%s commissioners=%s',
                 count(*),
                 count(*) filter (where m.user_id is not null),
                 count(*) filter (where m.role = 'commissioner'))
   from teams t
   join leagues l on l.id = t.league_id
   left join league_members m on m.team_id = t.id
   where l.status = 'in_season' and l.id::text like 'b6%'),
  'teams=18 managed=18 commissioners=2',
  'B1 SEATING PREMISE: every seat in both in_season leagues (L1''s 10 + L2''s 8) is MANAGED under D339''s predicate, one row each, seat 1 of each the commissioner — the premise L.E1.4''s arm (c) no-op and L.E1.3''s own "the goldens did not move" observation both depend on');

-- Week 3 matchups (L1): five primary rows + five secondary (derangement)
-- rows, scores as the door would have left them at the window close.
-- m33 is OVERRIDDEN: the home side scored more, the commissioner set 'away'.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status, result, is_overridden) values
 ('d6000000-0000-4000-8000-000000000031', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'regular',   'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000010', 120.00, 70.00, 'scheduled', null, false),
 ('d6000000-0000-4000-8000-000000000032', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'regular',   'c6000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000009', 110.00, 80.50, 'scheduled', null, false),
 ('d6000000-0000-4000-8000-000000000033', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'regular',   'c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000008', 101.00, 88.10, 'scheduled', 'away', true),
 ('d6000000-0000-4000-8000-000000000034', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'regular',   'c6000000-0000-4000-8000-000000000004', 'c6000000-0000-4000-8000-000000000007', 100.25, 90.00, 'scheduled', null, false),
 ('d6000000-0000-4000-8000-000000000035', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'regular',   'c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000006',  95.00, 95.00, 'scheduled', null, false),
 ('d6000000-0000-4000-8000-000000000041', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'secondary', 'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 120.00, 110.00, 'scheduled', null, false),
 ('d6000000-0000-4000-8000-000000000042', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'secondary', 'c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004', 101.00, 100.25, 'scheduled', null, false),
 ('d6000000-0000-4000-8000-000000000043', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'secondary', 'c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000007',  95.00, 90.00, 'scheduled', null, false),
 ('d6000000-0000-4000-8000-000000000044', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'secondary', 'c6000000-0000-4000-8000-000000000006', 'c6000000-0000-4000-8000-000000000008',  95.00, 88.10, 'scheduled', null, false),
 ('d6000000-0000-4000-8000-000000000045', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'secondary', 'c6000000-0000-4000-8000-000000000009', 'c6000000-0000-4000-8000-000000000010',  80.50, 70.00, 'scheduled', null, false);
-- Week 4 (L1): primary rows only; the two middle scores are 0.01 apart —
-- median = (95.01 + 95.02) / 2 = 95.015 EXACT, stored 95.02 (R789).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status) values
 ('d6000000-0000-4000-8000-000000000051', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002',  50.00,  60.00, 'scheduled'),
 ('d6000000-0000-4000-8000-000000000052', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004',  95.01,  95.02, 'scheduled'),
 ('d6000000-0000-4000-8000-000000000053', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000006', 130.00, 120.00, 'scheduled'),
 ('d6000000-0000-4000-8000-000000000054', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c6000000-0000-4000-8000-000000000007', 'c6000000-0000-4000-8000-000000000008', 110.00, 100.00, 'scheduled'),
 ('d6000000-0000-4000-8000-000000000055', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular', 'c6000000-0000-4000-8000-000000000009', 'c6000000-0000-4000-8000-000000000010',  65.00,  70.00, 'scheduled');
-- Week 7 (L1, playoff): one row.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id, home_score, away_score, status) values
 ('d6000000-0000-4000-8000-000000000071', 'b6000000-0000-4000-8000-000000000001', 2026, 7, 'playoff', 'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 88.00, 77.00, 'scheduled');
-- L2 (total_points) week 3: provisional rows for U1..U7 (10.00 … 70.00); U8 has NONE.
insert into team_week_results (league_id, team_id, season, week, points, is_final)
select 'b6000000-0000-4000-8000-000000000002', ('c6000000-0000-4000-8000-0000000000' || (20 + i)::text)::uuid, 2026, 3, i * 10.00, false
from generate_series(1, 7) i;

-- Digest helpers (stable renderings — no session-timezone text).
create temp view ww_lw as
  select league_id, week, status, median_score, finalized_at from league_weeks
  where league_id in ('b6000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000003');

-- ---------------------------------------------------------------------------
-- C. league_week_advance — opens on starts_at, closes on last_game_ends_at,
--    auto-carry materialized, L3 untouched, idempotent
-- ---------------------------------------------------------------------------
select set_config('pgtap.r', public.league_week_advance('2026-09-23 03:59:59+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'opened')::int, 0, 'C1 starts_at −1s: nothing opens');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'nothing_due', 'C1b …and the report SAYS nothing was due (rule 10)');
select is((select count(*)::int from team_lineups tl join teams t on t.id = tl.team_id where t.league_id = 'b6000000-0000-4000-8000-000000000001'),
  0, 'C1c …no lineup row exists yet');

select set_config('pgtap.r', public.league_week_advance('2026-09-23 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'opened')::int, 2, 'C2 starts_at AT: week 3 opens for L1 and L2 (L3 is scheduled — untouched)');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3), 'live', 'C2b L1 week 3 is live');
select is((select count(*)::int from matchups where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3 and status = 'live'), 10,
  'C2c the week''s 10 matchup rows (5 primary + 5 secondary) flipped scheduled → live');
select is((current_setting('pgtap.r')::jsonb ->> 'carried')::int, 18, 'C2d auto-carry wrote 10 + 8 explicit rows (every seated franchise)');
select is((select count(*)::int from team_lineups tl join teams t on t.id = tl.team_id where t.league_id = 'b6000000-0000-4000-8000-000000000001' and tl.week = 3 and tl.slot_map = '{}'::jsonb),
  9, 'C2e the first open has no earlier row: nine L1 rows are EXPLICIT empty lineups (slot_map {})');
select is((select slot_map from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 3), '{"ir1:0": "ww-ir"}'::jsonb,
  'C2e2 …and T1''s (the only roster) seats its IR player from the ROSTER''s IR columns with every starting slot empty (D308)');
select is((select jsonb_agg(s -> 'flags' order by s ->> 'slot') from team_lineups tl, jsonb_array_elements(tl.starters) s
           where tl.team_id = 'c6000000-0000-4000-8000-000000000001' and tl.week = 3),
  '[["empty"], ["empty"], ["empty"], ["empty"]]'::jsonb, 'C2f T1''s four starting slots are all flagged empty (114''s shape)');
select is((select bench from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 3),
  '["ww-flex-gone", "ww-qb", "ww-rb-bye", "ww-rb2", "ww-wr-out"]'::jsonb, 'C2g T1''s bench is the whole roster minus the IR player (IR occupancy read from the ROSTER — D308), sorted');
select is((select locked_at from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 3), null,
  'C2h an empty lineup has no locked_at (bye-only/empty ⇒ NULL — §11.2)');
select ok((select bool_and(x -> 'carried_from_week' = 'null'::jsonb) from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'carries') x),
  'C2i the report records carried_from_week NULL for every first-open row');
select is((select count(*)::int from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000003' and status <> 'upcoming'), 0,
  'C2j L3 (scheduled) is untouched — every week still upcoming');
select is((select count(*)::int from team_lineups tl join teams t on t.id = tl.team_id where t.league_id = 'b6000000-0000-4000-8000-000000000003'), 0,
  'C2k …and no lineup row was written for L3');

-- Idempotence: the same instant again ⇒ zero writes.
select set_config('pgtap.d1', (select md5(string_agg(t::text, '|' order by league_id, week)) from ww_lw t), true);
select set_config('pgtap.d2', (select md5(string_agg(tl.id::text || tl.week || coalesce(tl.slot_map::text, '') || tl.starters::text, '|' order by tl.id)) from team_lineups tl), true);
select set_config('pgtap.r', public.league_week_advance('2026-09-23 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'opened')::int + (current_setting('pgtap.r')::jsonb ->> 'carried')::int + (current_setting('pgtap.r')::jsonb ->> 'closed')::int, 0,
  'C3 re-run at the same instant: zero opens, zero carries, zero closes');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'nothing_due', 'C3b …said out loud');
select is((select md5(string_agg(t::text, '|' order by league_id, week)) from ww_lw t), current_setting('pgtap.d1'), 'C3c league_weeks digest unchanged');
select is((select md5(string_agg(tl.id::text || tl.week || coalesce(tl.slot_map::text, '') || tl.starters::text, '|' order by tl.id)) from team_lineups tl), current_setting('pgtap.d2'),
  'C3d team_lineups digest unchanged');

-- The manager "sets" T1's week-3 lineup (postgres, 114's shape with the
-- kickoff records left NULL — the tick stamps them in §D): QB (KC), the
-- LAC bye RB, the OUT DAL WR, the PHI TE in the flex, the IR player on ir1.
update team_lineups
set slot_map = '{"qb:0": "ww-qb", "rb:0": "ww-rb-bye", "wr:0": "ww-wr-out", "flex:0": "ww-flex-gone", "ir1:0": "ww-ir"}'::jsonb,
    starters = '[{"slot": "qb:0", "slot_key": "qb", "label": "QB", "player_id": "ww-qb", "position": "QB", "kickoff_at": null, "flags": []},
                 {"slot": "rb:0", "slot_key": "rb", "label": "RB", "player_id": "ww-rb-bye", "position": "RB", "kickoff_at": null, "flags": ["bye"]},
                 {"slot": "wr:0", "slot_key": "wr", "label": "WR", "player_id": "ww-wr-out", "position": "WR", "kickoff_at": null, "flags": ["out"]},
                 {"slot": "flex:0", "slot_key": "flex", "label": "W/R/T", "player_id": "ww-flex-gone", "position": "TE", "kickoff_at": null, "flags": []}]'::jsonb,
    bench = '["ww-rb2"]'::jsonb,
    locked_at = null
where team_id = 'c6000000-0000-4000-8000-000000000001' and season = 2026 and week = 3;

-- Close boundary: last_game_ends_at −1s / AT.
select set_config('pgtap.r', public.league_week_advance('2026-09-29 03:59:59+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'closed')::int, 0, 'C4 last_game_ends_at −1s: week 3 stays live');
select set_config('pgtap.r', public.league_week_advance('2026-09-29 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'closed')::int, 2, 'C5 last_game_ends_at AT: week 3 → correction_window for L1 and L2 (the games-over event, the datum 115 releases on)');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3), 'correction_window', 'C5b L1 week 3 is correction_window');

-- Between weeks: T1 drops the flex TE (113's verb would clear him from the
-- current week on; the past week-3 row keeps him — his stats counted).
delete from league_rosters where league_id = 'b6000000-0000-4000-8000-000000000001' and player_id = 'ww-flex-gone';

-- Week 4 open: starts_at −1s / AT + the carry golden.
select set_config('pgtap.r', public.league_week_advance('2026-09-30 03:59:59+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'opened')::int, 0, 'C6 week 4 starts_at −1s: nothing opens');
select set_config('pgtap.r', public.league_week_advance('2026-09-30 04:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'opened')::int, 2, 'C7 week 4 starts_at AT: opens for L1 and L2');
select is((current_setting('pgtap.r')::jsonb ->> 'carried')::int, 18, 'C7b …18 carried rows');
select is((select slot_map from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 4),
  '{"qb:0": "ww-qb", "rb:0": "ww-rb-bye", "wr:0": "ww-wr-out", "ir1:0": "ww-ir"}'::jsonb,
  'C7c THE CARRY GOLDEN: T1''s week-4 map = week 3''s minus the dropped flex player; the bye RB, the OUT WR and the IR key are KEPT');
select is((select x -> 'dropped' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'carries') x
           where x ->> 'team_id' = 'c6000000-0000-4000-8000-000000000001'),
  '[{"slot": "flex:0", "reason": "not_rostered", "player_id": "ww-flex-gone"}]'::jsonb,
  'C7d …the emptied slot and the unrostered player are NAMED in the report (never silently dropped — D293)');
select is((select x ->> 'carried_from_week' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'carries') x
           where x ->> 'team_id' = 'c6000000-0000-4000-8000-000000000001'), '3',
  'C7e …carried from week 3');
select is((select jsonb_agg(s -> 'flags' order by s ->> 'slot') from team_lineups tl, jsonb_array_elements(tl.starters) s
           where tl.team_id = 'c6000000-0000-4000-8000-000000000001' and tl.week = 4),
  '[["empty"], [], ["bye"], ["out"]]'::jsonb,
  'C7f flags by slot (flex, qb, rb, wr): the emptied flex, the QB clean, the bye RB FLAGGED bye, the OUT WR FLAGGED out');
select is((select bench from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 4), '["ww-rb2"]'::jsonb,
  'C7g bench = roster − starters − IR = the one bench RB');
select is((select locked_at from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 4), '2026-10-02 00:15:00+00'::timestamptz,
  'C7h locked_at = the earliest STARTED kickoff (the KC QB, Thursday) — evaluated from nfl_games at the open instant');
select is((select (s ->> 'kickoff_at')::timestamptz from team_lineups tl, jsonb_array_elements(tl.starters) s
           where tl.team_id = 'c6000000-0000-4000-8000-000000000001' and tl.week = 4 and s ->> 'slot' = 'wr:0'),
  '2026-10-04 17:00:00+00'::timestamptz, 'C7i the OUT WR''s slot records his Sunday kickoff (the per-slot lock state)');
select is((select x ->> 'carried_from_week' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'carries') x
           where x ->> 'team_id' = 'c6000000-0000-4000-8000-000000000002'), '3',
  'C7j an UNSET lineup carries too: T2''s empty week-3 row carries to week 4 (carried_from_week 3)');
select is((select slot_map from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000002' and week = 4), '{}'::jsonb,
  'C7k …as an explicit empty map');
select is((select edited_by_commish from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 4), false,
  'C7l a carried row is not a commissioner edit');
select is((select set_at from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 4), '2026-09-30 04:00:00+00'::timestamptz,
  'C7m set_at = the open instant (p_now), never wall-clock');

-- Close week 4; open 5 and 6; week 5 has NO recorded last game end (F238).
select set_config('pgtap.r', public.league_week_advance('2026-10-15 10:00:00+00')::text, true);
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 4), 'correction_window', 'C8 week 4 closed at its stamp');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 5), 'live',
  'C8b week 5 opened and STAYS live: its last_game_ends_at is NULL — never inferred from the correction window');
select is((select x -> 'weeks' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'unstamped_weeks') x
           where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000001'), '[5]'::jsonb,
  'C8c …and the report NAMES it: L1 week 5 is past its window with no recorded last game end (F238''s loud state)');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 6), 'live', 'C8d week 6 opened (starts 10-14)');

-- ---------------------------------------------------------------------------
-- D. lineup_lock_tick — the pool VIEW agrees with 115's helper at every
--    instant; the lineup RECORD is stamped, moves with a kickoff (E42), and
--    releases on a postponement (E43) — and at the FLEXED kickoff +1s the
--    lock is back (a flex moves the lock, it never releases it — R790);
--    on_waivers/rostered keep their state
-- ---------------------------------------------------------------------------
-- The agreement function: TRUE iff every L1 pool row's stamped locked_until
-- equals what the helper says at the instant (locked ⇒ COALESCE(window,
-- 'infinity'); else NULL).
create function pg_temp.ww_agrees(p_at timestamptz) returns boolean language sql as $$
  select bool_and(
    pp.locked_until is not distinct from (
      case when (d ->> 'locked')::boolean then coalesce((d ->> 'window_ends_at')::timestamptz, 'infinity'::timestamptz) end))
  from league_player_pool pp
  join players p on p.id = pp.player_id
  cross join lateral public.pool_game_lock_any_internal(2026, public.lineup_current_week_internal(pp.league_id, p_at), p.team, p_at) d
  where pp.league_id = 'b6000000-0000-4000-8000-000000000001';
$$;

-- Kickoff −1s (KC@BUF, Thu 2026-09-25 00:15Z).
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:14:59+00')::text, true);
select is((select state || ':' || coalesce(locked_until::text, 'null') from league_player_pool where player_id = 'ww-fa-kc'), 'free_agent:null',
  'D1 kickoff −1s: the KC free agent is unlocked (NULL, free_agent)');
select ok(pg_temp.ww_agrees('2026-09-25 00:14:59+00'), 'D1b AGREEMENT: every pool row''s locked_until equals the helper''s reading at kickoff −1s');
select is((select locked_at from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 3), '2026-09-25 00:15:00+00'::timestamptz,
  'D1c the lineup RECORD is stamped: locked_at = the earliest started kickoff (the KC QB), from nfl_games at run time');
select is((select (s ->> 'kickoff_at')::timestamptz from team_lineups tl, jsonb_array_elements(tl.starters) s
           where tl.team_id = 'c6000000-0000-4000-8000-000000000001' and tl.week = 3 and s ->> 'slot' = 'qb:0'),
  '2026-09-25 00:15:00+00'::timestamptz, 'D1d …and the QB''s per-slot kickoff record is filled');
select is((select s -> 'kickoff_at' from team_lineups tl, jsonb_array_elements(tl.starters) s
           where tl.team_id = 'c6000000-0000-4000-8000-000000000001' and tl.week = 3 and s ->> 'slot' = 'rb:0'),
  'null'::jsonb, 'D1e …the bye RB''s stays NULL (no game)');
select is((current_setting('pgtap.r')::jsonb ->> 'lineups')::int, 18, 'D1f the tick scanned the 18 current-week (3) rows (10 L1 + 8 L2) — week-4 rows, ahead of the current week, are not scanned');

-- Kickoff +1s.
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00')::text, true);
select is((select state || ':' || locked_until::text from league_player_pool where player_id = 'ww-fa-kc'), 'locked_in_game:2026-09-29 04:00:00+00',
  'D2 kickoff +1s: the free agent is locked_in_game until the week''s recorded last game end');
select is((select state || ':' || coalesce(locked_until::text, 'null') || ':' || waivers_until::text from league_player_pool where player_id = 'ww-wv-dal'),
  'on_waivers:null:2026-09-26 00:00:00+00', 'D2b the DAL waiver player (Sunday kickoff) is still unlocked; his waiver state untouched');
select is((select state || ':' || locked_until::text from league_player_pool where player_id = 'ww-qb'), 'rostered:2026-09-29 04:00:00+00',
  'D2c the ROSTERED KC QB''s row carries the view (locked until the last game end) and KEEPS state rostered (the D294 mirror)');
select ok(pg_temp.ww_agrees('2026-09-25 00:15:01+00'), 'D2d AGREEMENT at kickoff +1s');
-- Idempotence.
select set_config('pgtap.d3', (select md5(string_agg(pp.player_id || pp.state || coalesce(pp.locked_until::text, ''), '|' order by pp.player_id)) from league_player_pool pp), true);
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'pool_updates')::int + (current_setting('pgtap.r')::jsonb ->> 'lineup_updates')::int, 0,
  'D3 re-run at the same instant: ZERO pool writes and ZERO lineup writes (probe 3 reds this)');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'no_changes', 'D3b …said out loud');
select is((select md5(string_agg(pp.player_id || pp.state || coalesce(pp.locked_until::text, ''), '|' order by pp.player_id)) from league_player_pool pp), current_setting('pgtap.d3'),
  'D3c pool digest unchanged');

-- Release −1s / AT (last_game_ends_at 2026-09-29 04:00Z).
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-29 03:59:59+00')::text, true);
select is((select state || ':' || locked_until::text from league_player_pool where player_id = 'ww-wv-dal'), 'on_waivers:2026-09-29 04:00:00+00',
  'D4 release −1s: the waiver player (kicked off Sunday) is locked AND keeps state on_waivers (the F222(a) CHECK holds — waivers_until stays)');
select is((select state from league_player_pool where player_id = 'ww-fa-kc'), 'locked_in_game', 'D4b …the free agent still locked_in_game');
select ok(pg_temp.ww_agrees('2026-09-29 03:59:59+00'), 'D4c AGREEMENT at release −1s');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-29 04:00:00+00')::text, true);
select is((select string_agg(state || ':' || coalesce(locked_until::text, 'null'), ',' order by player_id) from league_player_pool where league_id = 'b6000000-0000-4000-8000-000000000001'),
  'free_agent:null,rostered:null,on_waivers:null', 'D5 release AT: every row unlocked; locked_in_game → free_agent; rostered/on_waivers unchanged');
select ok(pg_temp.ww_agrees('2026-09-29 04:00:00+00'), 'D5b AGREEMENT at the release instant');

-- The NULL-stamp arm (F238): the week''s last game end NOT recorded ⇒ 'infinity'.
update nfl_weeks set last_game_ends_at = null where season = 2026 and week = 3;
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00')::text, true);
select is((select state || ':' || locked_until::text from league_player_pool where player_id = 'ww-fa-kc'), 'locked_in_game:infinity',
  'D6 last_game_ends_at NULL: the view says locked until INFINITY — an instant not yet recorded, never a NULL that reads as unlocked');
select ok(pg_temp.ww_agrees('2026-09-25 00:15:01+00'), 'D6b AGREEMENT under the NULL stamp (the helper says locked with window_ends_at NULL)');
update nfl_weeks set last_game_ends_at = '2026-09-29 04:00:00+00' where season = 2026 and week = 3;

-- E42: the KC game flexes +2h — the lock moves with it, nothing stale.
update nfl_games set kickoff_at = '2026-09-25 02:15:00+00' where id = 'ww-w3-a';
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 00:15:01+00')::text, true);
select is((select state || ':' || coalesce(locked_until::text, 'null') from league_player_pool where player_id = 'ww-fa-kc'), 'free_agent:null',
  'D7 E42: after the flex the same instant is BEFORE the kickoff — the free agent is released (evaluated from nfl_games, no stored instant to go stale)');
select is((select locked_at from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 3), '2026-09-25 02:15:00+00'::timestamptz,
  'D7b …and the lineup record MOVED to the flexed kickoff');
select is((select (s ->> 'kickoff_at')::timestamptz from team_lineups tl, jsonb_array_elements(tl.starters) s
           where tl.team_id = 'c6000000-0000-4000-8000-000000000001' and tl.week = 3 and s ->> 'slot' = 'qb:0'),
  '2026-09-25 02:15:00+00'::timestamptz, 'D7c …the QB''s per-slot record too');
select ok(pg_temp.ww_agrees('2026-09-25 00:15:01+00'), 'D7d AGREEMENT after the flex');
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-25 02:15:01+00')::text, true);
select is((select state || ':' || locked_until::text from league_player_pool where player_id = 'ww-fa-kc'), 'locked_in_game:2026-09-29 04:00:00+00',
  'D7e E42 at the FLEXED kickoff +1s: the free agent is locked AGAIN until the week''s last game end — a flex MOVES the lock, it does not release it as if the game had left the week (R790)');
select ok(pg_temp.ww_agrees('2026-09-25 02:15:01+00'), 'D7f AGREEMENT at the flexed kickoff +1s');
update nfl_games set kickoff_at = '2026-09-25 00:15:00+00' where id = 'ww-w3-a';

-- E43: the KC game is postponed out of the week (status + kickoff moved).
update nfl_games set status = 'postponed', kickoff_at = '2026-10-13 00:15:00+00' where id = 'ww-w3-a';
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-27 17:00:01+00')::text, true);
select is((select state || ':' || coalesce(locked_until::text, 'null') from league_player_pool where player_id = 'ww-fa-kc'), 'free_agent:null',
  'D8 E43 (lock half): Sunday +1s, the KC free agent is RELEASED — his week-3 kickoff now lies beyond the week');
select is((select state || ':' || locked_until::text from league_player_pool where player_id = 'ww-wv-dal'), 'on_waivers:2026-09-29 04:00:00+00',
  'D8b …while the DAL player, who kicked off Sunday, is locked (the two are independent — per player, Q34(A))');
select is((select locked_at from team_lineups where team_id = 'c6000000-0000-4000-8000-000000000001' and week = 3), '2026-09-27 17:00:00+00'::timestamptz,
  'D8c the lineup record moved to the earliest REMAINING started kickoff (the DAL WR, Sunday)');
select ok(pg_temp.ww_agrees('2026-09-27 17:00:01+00'), 'D8d AGREEMENT under the postponement');
update nfl_games set status = 'final', kickoff_at = '2026-09-25 00:15:00+00' where id = 'ww-w3-a';
select set_config('pgtap.r', public.lineup_lock_tick('2026-09-29 04:00:00+00')::text, true);
select is((select count(*)::int from league_player_pool where league_id = 'b6000000-0000-4000-8000-000000000001' and locked_until is not null), 0,
  'D9 restored calendar, week 3 over: every pool row released again');

-- ---------------------------------------------------------------------------
-- E. finalize_matchups — the four cells, the goldens, the override, E43,
--    pending, total_points, the playoff week, idempotence
-- ---------------------------------------------------------------------------
-- The four cells (D146) on week 3's window (2026-10-01 10:00Z).
select set_config('pgtap.r', public.finalize_matchups('2026-10-01 09:59:59+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 0, 'E1 window −1s, all games final: nothing finalizes');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'nothing_due', 'E1b …nothing was due');
update nfl_games set status = 'live' where id = 'ww-w3-c';
select set_config('pgtap.r', public.finalize_matchups('2026-10-01 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 0, 'E2 window AT, ONE game not final: nothing finalizes (§23.2 — no league state advances on partial data; probe 1 reds this)');
select is((select x - 'league_id' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
           where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000001' and (x ->> 'week')::int = 3),
  '{"open": 1, "week": 3, "final": 2, "total": 3, "reason": "games_not_final", "postponed": 0}'::jsonb,
  'E2b …the skip is NAMED with the counts');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3), 'correction_window', 'E2c …the week stays correction_window');
select is((select count(*)::int from matchups where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3 and status = 'final'), 0, 'E2d …and no matchup flipped');
select set_config('pgtap.r', public.finalize_matchups('2026-10-01 09:59:59+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int + (current_setting('pgtap.r')::jsonb ->> 'leagues')::int, 0,
  'E3 window −1s, one game open: nothing claimed, nothing finalized (the fourth cell)');
update nfl_games set status = 'final' where id = 'ww-w3-c';

-- R792: a NULL score under an OVERRIDE is pending too — an override is not a
-- score. m33 is the overridden cell; blank its home side.
update matchups set home_score = null where id = 'd6000000-0000-4000-8000-000000000033';
select set_config('pgtap.r', public.finalize_matchups('2026-10-01 10:00:00+00')::text, true);
select is((select x ->> 'reason' || ':' || (x ->> 'pending') from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
           where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000001' and (x ->> 'week')::int = 3),
  'pending_scores:1', 'E3b a NULL score on an OVERRIDDEN matchup holds the week BY NAME too (an override is not a score — R792), never a raw 23502 from the results INSERT');
select is((select status || ':' || (select count(*)::text from matchups where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3 and status = 'final')
           from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3),
  'correction_window:0', 'E3c …the week stays correction_window and no matchup flipped');
select is(current_setting('pgtap.r')::jsonb -> 'failures', '[]'::jsonb, 'E3d …and the run recorded NO failure row (the skip is named, not caught)');
update matchups set home_score = 101.00 where id = 'd6000000-0000-4000-8000-000000000033';

select set_config('pgtap.r', public.finalize_matchups('2026-10-01 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 1, 'E4 window AT, all final: week 3 finalizes for L1 (h2h); L2 (total_points) is HELD — a seated team has no result row (E8, R788)');

-- L1 week 3 goldens.
select is((select status || ':' || coalesce(median_score::text, 'null') || ':' || finalized_at::text from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3),
  'final:95.00:2026-10-01 10:00:00+00', 'E5 L1 week 3 → final, median_score 95.00 (the two middle scores are both 95.00), finalized_at = p_now');
select is((select string_agg(right(id::text, 2) || '=' || coalesce(result, 'null'), ',' order by id) from matchups where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3),
  '31=home,32=home,33=away,34=home,35=tie,41=home,42=home,43=home,44=home,45=home',
  'E6 results: primaries home/home/AWAY(override kept)/home/TIE (E38: 95.00 v 95.00), every secondary home');
select is((select count(*)::int from matchups where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3 and status = 'final'), 10, 'E6b all 10 rows final');
select is((select home_score::text || '/' || away_score::text || '/' || result || '/' || is_overridden::text from matchups where id = 'd6000000-0000-4000-8000-000000000033'),
  '101.00/88.10/away/true', 'E6c the OVERRIDDEN cell is untouched: scores and the commissioner''s ''away'' stand though the home side scored more (§22.2)');
select is((select string_agg('T' || ltrim(right(team_id::text, 2), '0') || ':' || points::text || ':' || h2h_result || ':' || second_result || ':' || median_result, ',' order by team_id)
           from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3),
  'T1:120.00:win:win:win,T2:110.00:win:loss:win,T3:101.00:loss:win:win,T4:100.25:win:loss:win,T5:95.00:tie:win:tie,T6:95.00:tie:win:tie,T7:90.00:loss:loss:loss,T8:88.10:win:loss:loss,T9:80.50:loss:win:loss,T10:70.00:loss:loss:loss',
  'E7 THE 10-TEAM GOLDEN (points : h2h : second : median): the exact-median tie for T5/T6 (E39), the override''s loss/win for T3/T8, second results from the derangement rows');
select is((select string_agg('T' || ltrim(right(team_id::text, 2), '0') || '>' || 'T' || ltrim(right(opponent_team_id::text, 2), '0') || '/' || 'T' || ltrim(right(second_opponent_team_id::text, 2), '0'), ',' order by team_id)
           from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3),
  'T1>T10/T2,T2>T9/T1,T3>T8/T4,T4>T7/T3,T5>T6/T7,T6>T5/T8,T7>T4/T5,T8>T3/T6,T9>T2/T10,T10>T1/T9',
  'E7b opponent / second-opponent attribution for all ten');
select is((select count(*)::text || ':' || sum(points)::text || ':' || bool_and(is_final)::text from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3),
  '10:949.85:true', 'E7c PF counted ONCE: one row per team, Σ 949.85 (not doubled by the secondary/median games), all final');
-- L2 (total_points) week 3 — R788: U8 has NO provisional row. Absence is
-- not a score: the week is held BY NAME and nothing is written for U8.
select is((select x - 'league_id' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
           where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000002' and (x ->> 'week')::int = 3),
  '{"week": 3, "reason": "pending_results", "pending": 1, "missing": ["c6000000-0000-4000-8000-000000000028"]}'::jsonb,
  'E8 total_points, PARTIAL absence (7 of 8 rows): the week is skipped BY NAME (pending_results) and the seated team with no row is LISTED (R788)');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000002' and week = 3), 'correction_window',
  'E8b …L2 week 3 stays correction_window (the outage the h2h side names pending_scores — no league state advances on partial data, §23.2)');
select is((select count(*)::text || ':' || (count(*) filter (where is_final))::text || ':' || sum(points)::text from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000002' and week = 3),
  '7:0:280.00', 'E8c …the seven provisional rows are untouched and NO 0.00 row was written for the eighth (absence is not a score)');
-- The worker's row for U8 arrives (a real observation, not a zero); the next
-- run finalizes.
insert into team_week_results (league_id, team_id, season, week, points, is_final)
values ('b6000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000028', 2026, 3, 5.50, false);
select set_config('pgtap.r', public.finalize_matchups('2026-10-01 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 1, 'E8d with every seated team''s row present the next run finalizes L2 week 3 (and only it — L1 is final)');
select is((select string_agg(points::text, ',' order by team_id) || ':' || bool_and(is_final)::text from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000002' and week = 3),
  '10.00,20.00,30.00,40.00,50.00,60.00,70.00,5.50:true', 'E8e …the eight provisional rows go final with THEIR points (the late row at 5.50, not 0.00)');
select is((select status || ':' || coalesce(median_score::text, 'null') from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000002' and week = 3), 'final:null',
  'E8f L2 week 3 final, no median (median_game off)');
select is((select count(*)::int from matchups where league_id = 'b6000000-0000-4000-8000-000000000002'), 0, 'E8g …and total_points wrote no matchup rows');

-- Idempotence.
select set_config('pgtap.d4', (select md5(string_agg(r::text, '|' order by r.league_id, r.week, r.team_id)) from team_week_results r), true);
select set_config('pgtap.d5', (select md5(string_agg(m::text, '|' order by m.id)) from matchups m), true);
select set_config('pgtap.r', public.finalize_matchups('2026-10-01 10:00:00+00')::text, true);
select is((current_setting('pgtap.r')::jsonb ->> 'finalized')::int, 0, 'E9 re-run at the window: nothing finalizes (a final week is never re-claimed)');
select is(current_setting('pgtap.r')::jsonb ->> 'reason', 'nothing_due', 'E9b …nothing due');
select is((select md5(string_agg(r::text, '|' order by r.league_id, r.week, r.team_id)) from team_week_results r), current_setting('pgtap.d4'), 'E9c team_week_results digest unchanged');
select is((select md5(string_agg(m::text, '|' order by m.id)) from matchups m), current_setting('pgtap.d5'), 'E9d matchups digest unchanged');

-- Week 4: pending scores refuse; L2's ALL-absent week held; the in-week
-- postponed game holds; E43's exclusion + system note; the 0.01-apart
-- median; no secondary rows.
update matchups set home_score = null where id = 'd6000000-0000-4000-8000-000000000051';
select set_config('pgtap.r', public.finalize_matchups('2026-10-08 10:00:00+00')::text, true);
select is((select x ->> 'reason' || ':' || (x ->> 'pending') from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
           where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000001' and (x ->> 'week')::int = 4),
  'pending_scores:1', 'E10 a NULL score (the door''s "pending", E61) blocks the week BY NAME — never coerced to 0.00');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 4), 'correction_window', 'E10b …L1 week 4 stays correction_window');
-- R788, ALL-absent: L2 week 4 has NO team_week_results row at all (the
-- worker never ran). The same run holds it by name; the first cut
-- zero-filled all eight and flipped the week final in passing.
select is((select x ->> 'reason' || ':' || (x ->> 'pending') || ':' || jsonb_array_length(x -> 'missing')::text from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
           where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000002' and (x ->> 'week')::int = 4),
  'pending_results:8:8', 'E10c total_points, ALL-absent (0 of 8 rows): skipped BY NAME with all eight seated teams listed (R788 — a worker that never ran is an outage, not eight zeros)');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000002' and week = 4), 'correction_window',
  'E10d …L2 week 4 stays correction_window (probe 4 reds this: the week flips final)');
select is((select count(*)::int from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000002' and week = 4), 0,
  'E10e …and not one result row was written (no zero-fill)');
update matchups set home_score = 50.00 where id = 'd6000000-0000-4000-8000-000000000051';

-- R791: a game marked `postponed` whose kickoff is STILL INSIDE the week
-- (before week 5's starts_at, 2026-10-07 04:00Z) has not left it — it is an
-- OPEN game and holds the week; only a kickoff at or beyond the next
-- calendar week's start is E43's "postponed out of the week".
update nfl_games set kickoff_at = '2026-10-05 00:15:00+00' where id = 'ww-w4-p';
select set_config('pgtap.r', public.finalize_matchups('2026-10-08 10:00:00+00')::text, true);
select is((select x - 'league_id' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
           where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000001' and (x ->> 'week')::int = 4),
  '{"open": 1, "week": 4, "final": 3, "total": 4, "reason": "games_not_final", "postponed": 0}'::jsonb,
  'E10f a postponed game whose kickoff is still inside the week is OPEN, not excluded: the week is held by name (postponed 0, open 1 — R791)');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 4), 'correction_window', 'E10g …L1 week 4 stays correction_window');
-- The bound −1s / AT (D146): a kickoff one second before week 5 starts is
-- still inside week 4; AT week 5's start it has left.
update nfl_games set kickoff_at = '2026-10-07 03:59:59+00' where id = 'ww-w4-p';
select is((select open_games || ':' || postponed_games || ':' || all_final::text from public.week_games_state_internal(2026, 4)), '1:0:false',
  'E10h the bound −1s (kickoff 2026-10-07 03:59:59Z; week 5 starts 04:00Z): still in the week — open, not finalizable');
update nfl_games set kickoff_at = '2026-10-07 04:00:00+00' where id = 'ww-w4-p';
select is((select open_games || ':' || postponed_games || ':' || all_final::text from public.week_games_state_internal(2026, 4)), '0:1:true',
  'E10i the bound AT: the postponed game has LEFT the week — excluded, the three in-week games final');
update nfl_games set kickoff_at = '2026-10-13 00:15:00+00' where id = 'ww-w4-p';
select set_config('pgtap.r', public.finalize_matchups('2026-10-08 10:00:00+00')::text, true);
select is((select x ->> 'postponed_excluded' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'weeks') x
           where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000001' and (x ->> 'week')::int = 4), '1',
  'E11 E43: week 4 finalizes WITHOUT the postponed MIA@NYJ game (excluded from the all-final gate)');
select is((select count(*)::text || ':' || bool_and(is_system)::text || ':' || bool_and(user_id is null)::text || ':' || bool_and(context = 'league')::text
           from league_chat where league_id = 'b6000000-0000-4000-8000-000000000001'),
  '1:true:true:true', 'E11b …and posts ONE system note (is_system, user_id NULL — the 069 tick-actor shape, league context)');
select alike((select message from league_chat where league_id = 'b6000000-0000-4000-8000-000000000001'),
  'Week 4 was finalized without the postponed game MIA @ NYJ — players in a game postponed out of the week score 0 for the week (§23.3/E43)%',
  'E11c …naming the game');
select is((select median_score from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 4), 95.02,
  'E12 the 0.01-apart median: (95.01 + 95.02) / 2 = 95.015 EXACT, STORED rounded half away from zero as 95.02 (D57(2))');
select is((select string_agg('T' || ltrim(right(team_id::text, 2), '0') || ':' || median_result, ',' order by team_id) from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 4),
  'T1:loss,T2:loss,T3:loss,T4:win,T5:win,T6:win,T7:win,T8:win,T9:loss,T10:loss', 'E12b …T3 (95.01) loses to it, T4 (95.02) beats it; nobody ties');
select is((select points::text || ':' || median_result || ':' || (points = (select median_score from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 4))::text
           from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 4 and team_id = 'c6000000-0000-4000-8000-000000000004'),
  '95.02:win:true', 'E12d THE COMPARE-EXACT / STORE-ROUNDED PIN (R789): T4''s 95.02 EQUALS the stored median_score yet his result is WIN — the comparison was against the exact 95.015, never the stored value (a round(v_median, 2) comparison makes this a tie — probe 5)');
select is((select count(*)::int from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 4 and second_opponent_team_id is null and second_result is null), 10,
  'E12c no secondary rows this week ⇒ second_* NULL for all ten');

-- The F238 side of finalize: week 5 is live past its window (stamp NULL).
select set_config('pgtap.r', public.finalize_matchups('2026-10-15 10:00:00+00')::text, true);
select is((select x -> 'weeks' from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'live_past_window') x where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000001'),
  '[5]'::jsonb, 'E13 a live week past its window with NO recorded last game end is NAMED (live_past_window) and NOT finalized');
select is((select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 5), 'live', 'E13b …week 5 stays live');

-- Week 6: zero game rows is the emptiest partial data — not finalizable.
select set_config('pgtap.r', public.league_week_advance('2026-10-22 10:00:00+00')::text, true);
select set_config('pgtap.r', public.finalize_matchups('2026-10-22 10:00:00+00')::text, true);
select is((select x ->> 'reason' || ':' || (x ->> 'total') from jsonb_array_elements(current_setting('pgtap.r')::jsonb -> 'skipped') x
           where x ->> 'league_id' = 'b6000000-0000-4000-8000-000000000001' and (x ->> 'week')::int = 6),
  'games_not_final:0', 'E14 a week with ZERO game rows is skipped by name (total 0) — §23.2');

-- Week 7 (playoff): results written, NO median (regular season only).
select set_config('pgtap.r', public.league_week_advance('2026-10-27 04:00:00+00')::text, true);
select set_config('pgtap.r', public.finalize_matchups('2026-10-29 10:00:00+00')::text, true);
select is((select status || ':' || coalesce(median_score::text, 'null') from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 7), 'final:null',
  'E15 the playoff week finalizes with NO median score (§11.7: extra games are regular season only)');
select is((select string_agg('T' || ltrim(right(team_id::text, 2), '0') || ':' || points::text || ':' || h2h_result || ':' || coalesce(median_result, 'null'), ',' order by team_id)
           from team_week_results where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 7),
  'T1:88.00:win:null,T2:77.00:loss:null', 'E15b …the playoff rows carry h2h results and NULL median results');
select is((select result || ':' || status from matchups where id = 'd6000000-0000-4000-8000-000000000071'), 'home:final', 'E15c the playoff matchup row is final with its result');

-- The scope seam: a scoped call touches only the named league.
select is((public.finalize_matchups('2026-10-29 10:00:00+00', 'b6000000-0000-4000-8000-000000000003') ->> 'leagues')::int, 0,
  'E16 scoped to L3 (scheduled): nothing claimed — the seam narrows, never widens');

select * from finish();
rollback;
