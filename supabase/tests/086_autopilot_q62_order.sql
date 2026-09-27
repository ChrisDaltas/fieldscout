-- ============================================================================
-- Autopilot's selection order (Q62, as RULED) and `Doubtful` sits — pgTAP 086
-- (task L.E1.21; migration 138; spec §7.2.1(c) (the v2.16.42 Q62/Q63 ruling
-- note), §12.28; PROGRESS Q62 / Q63 / Q68, F379 / F387 / F389, D356 / D375;
-- tasks-M6A §6 L.E1.21 and §4 rules 12-15).
--
-- Numbering: pgTAP head measured `085_league_player_values.sql` by
-- `ls supabase/tests/ | tail -1` at task time ⇒ 086.
--
-- THIS SUITE HAS ITS OWN FIXTURE LEAGUES (`b6…`). It calls the PURE chooser
-- (`lineup_autopilot_internal`, D356(1)) directly for every ordering and
-- Doubtful cell — one team per cell, one injected instant — and stores each
-- result; §H then runs the REAL tick at the SAME instant and proves every
-- written map equals the chooser's and passes invariant 2's oracle.
--
-- Falsifiability notes (tasks-M1 §4.3; tasks-M6A §4 rules 14-15):
--   * EVERY KEY CELL REVERSES THE NEXT KEY (rule 14(a)): the projection cell's
--     fixture has the OTHER man ahead on season points AND on ADP; the season
--     cell's has the other man ahead on preseason points AND ADP; the
--     preseason cell's has the other man ahead on ADP; the ADP cell's has the
--     other man ahead by player_id; the player_id cell inserts the loser
--     FIRST. Each premise is asserted BY VALUE before the cell (§B).
--   * EVERY VALUE IS A STORED LITERAL and every instant is injected — the
--     tick instant P = 2026-09-25 12:00Z, the values' computed_at P−1h. The
--     freshness bound is a PAIR at each of its two sites: exactly P−6h is
--     FRESH and P−6h−1s is STALE, for `computed_at` (§E1/§E2) and for
--     `projection_fetched_at` (§E3/§E4). Nothing reads a wall clock.
--   * THE FLEX CELL (§C6) HAS A RANK PREMISE: the RB is RB #1 of the
--     league-week's values and the WR is WR #3 (asserted by value), so a
--     rank-against-rank comparison seats the RB and only POINTS seat the WR.
--   * NO CELL INFERS EMPTINESS (rule 15): every "nothing moved" cell asserts
--     the chooser's REASON string or restored[] entry beside it.
--   * BREAK PROBES (rule 14), shown red by name in the PR then restored with
--     `diff -q`: drop the projection key (§C1 reds); restore 125's ADP-first
--     ORDER BY (§C1-§C3 red); remove 'Doubtful' from the classification (§D1
--     reds); add 'Doubtful' to the `out` flag (§D2c reds); hard-filter
--     Doubtful when the league forbids illegal lineups (§D4 reds); trust a
--     stale row (§E2 reds); trust a stale projection (§E4 reds); an INNER
--     JOIN to the values (§F2 reds).
--   * All work runs as postgres (`auth.uid()` NULL — the tick's own
--     precondition).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(70);

-- ---------------------------------------------------------------------------
-- A. Form pins — 138 replaces ONE function and nothing else
-- ---------------------------------------------------------------------------
select is(
  (select pg_get_function_arguments(p.oid) || ' → ' || pg_get_function_result(p.oid)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  'p_league_id uuid, p_team_id uuid, p_season integer, p_week integer, p_at timestamp with time zone → jsonb',
  'A1 lineup_autopilot_internal keeps 125''s signature and return type byte-for-byte (typegen 0-line; the tick''s call site unchanged)');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  'A2 still PLAIN (never DEFINER) with search_path='''' — 125''s posture verbatim');
select ok(
  not has_function_privilege('anon', 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)', 'EXECUTE')
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'
      and a.privilege_type = 'EXECUTE' and a.grantee = 0)
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal') = 1,
  'A3 the TRIPLE REVOKE survives (anon, authenticated, PUBLIC) and there is exactly ONE overload');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'ORDER BY k.projected_points DESC NULLS LAST, k.season_points DESC NULLS LAST,', ''))) / length('ORDER BY k.projected_points DESC NULLS LAST, k.season_points DESC NULLS LAST,')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  1,
  'A4 THE SORT IS ONE CLAUSE (D340; Q62): the four-key lexicographic ORDER BY appears exactly once in the chooser''s body');
select ok(
  (select p.prosrc like '%LEFT JOIN public.league_player_values v%'
      and p.prosrc like '%c_max_age     CONSTANT INTERVAL := interval ''6 hours''%'
      and p.prosrc not like '%ORDER BY p.adp ASC NULLS LAST, r.player_id ASC)%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  'A5 F389 in the body: a LEFT JOIN to league_player_values (never inner), the 6-hour read bound (F387''s read half), and 125''s adp-first sort GONE');
select ok(
  (select p.prosrc like '%IF (v_p ->> ''designation'') IN (''OUT'', ''IR'', ''PUP'', ''NFI'', ''Suspended'') THEN%'
      and p.prosrc like '%(v_by_pid -> v_pid ->> ''designation'') IN (''OUT'', ''IR'', ''PUP'', ''NFI'', ''Suspended'', ''Doubtful'')%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_autopilot_internal'),
  'A6 Doubtful joins the CLASSIFICATION test and the `out` starter flag is still 125''s five (a Doubtful start is legal, 114:596) — the behaviour is §D2c''s');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_lock_tick'),
  'b657c8ba654257d74701f8561998267f',
  'A7 lineup_lock_tick is BYTE-UNTOUCHED by 138 (prosrc md5, a stored literal — ZERO D137 hunks on the tick)');
select ok(
  (select md5(p.prosrc) = 'b291362e2263f2b987b413f3cb6b9580' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_fit_internal')
  and (select md5(p.prosrc) = 'e38a18c80dde298b3ca69af93b77dac9' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'lineup_carry_internal'),
  'A8 …and so are the matcher (D340 — placement is not this task''s) and the carry (D337) — stored-literal md5s');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context)
--    Calendar (2026, stored literals): week 1 starts 09-09 04:00Z, week 3
--    09-23 04:00Z (so at P = 09-25 12:00Z the current week is 3). Games:
--    week 1 PHI–DAL 09-13 17:00Z, SF–NYG 09-14 00:15Z; week 3 PHI–DAL
--    09-27 17:00Z, SF–NYG 09-28 00:15Z. Every player is on one of those four
--    teams, so NOBODY is on bye and nobody is locked at P (or at P1).
--
--    AL1 `b6…01` — allow_illegal_lineups TRUE; the ordering cells (§C, §E,
--                  §F1/F2), one UNMANAGED team per cell.
--    AL4 `b6…04` — allow_illegal_lineups TRUE; the Doubtful / Questionable
--                  cells (§D) — split from AL1 only because a league seats
--                  at most 16 teams (`leagues_team_count_check`).
--    AL2 `b6…02` — allow_illegal_lineups FALSE; D20 (Doubtful-only, §D4).
--    AL3 `b6…03` — NO values rows at all (§F3 — the "week with no values").
--    Slots everywhere: qb ×1, flex ×1 [RB, WR, TE].
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '9b000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'pgtap-q62@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', '{"username": "q62_user1"}'::jsonb, now(), now());

update nfl_weeks set first_kickoff_at = null where season = 2026;
update nfl_weeks set starts_at = '2026-09-09 04:00:00+00' where season = 2026 and week = 1;
update nfl_weeks set starts_at = '2026-09-23 04:00:00+00', last_game_ends_at = '2026-09-29 04:00:00+00', correction_window_ends_at = '2026-10-01 10:00:00+00' where season = 2026 and week = 3;
update nfl_weeks set starts_at = '2026-09-30 04:00:00+00' where season = 2026 and week = 4;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 ('q62-w1-sun', 2026, 1, 'PHI', 'DAL', '2026-09-13 17:00:00+00', 'scheduled'),
 ('q62-w1-mon', 2026, 1, 'SF',  'NYG', '2026-09-14 00:15:00+00', 'scheduled'),
 ('q62-w3-sun', 2026, 3, 'PHI', 'DAL', '2026-09-27 17:00:00+00', 'scheduled'),
 ('q62-w3-mon', 2026, 3, 'SF',  'NYG', '2026-09-28 00:15:00+00', 'scheduled');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings)
select l.id, '9b000000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 16, 6, 0, 7,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.st,
       '{"starting_slots": [
           {"key": "qb",   "label": "QB",    "eligible": ["QB"],             "count": 1},
           {"key": "flex", "label": "W/R/T", "eligible": ["RB", "WR", "TE"], "count": 1}],
         "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('b6000000-0000-4000-8000-000000000001'::uuid, 'pgtap-q62-L1', '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb),
 ('b6000000-0000-4000-8000-000000000002'::uuid, 'pgtap-q62-L2', '{"schedule_mode": "h2h", "allow_illegal_lineups": false}'::jsonb),
 ('b6000000-0000-4000-8000-000000000003'::uuid, 'pgtap-q62-L3', '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb),
 ('b6000000-0000-4000-8000-000000000004'::uuid, 'pgtap-q62-L4', '{"schedule_mode": "h2h", "allow_illegal_lineups": true}'::jsonb)
) as l(id, nm, st);

insert into league_weeks (league_id, season, week, status)
select l, 2026, g, case when g < 3 then 'final' when g = 3 then 'live' else 'upcoming' end
from (values ('b6000000-0000-4000-8000-000000000001'::uuid),
             ('b6000000-0000-4000-8000-000000000002'::uuid),
             ('b6000000-0000-4000-8000-000000000003'::uuid),
             ('b6000000-0000-4000-8000-000000000004'::uuid)) v(l),
     generate_series(1, 6) g;

-- One team per cell. `tag` is the cell's name; the uuid's last two digits
-- are its number. Every team is an UNMANAGED placeholder seat (063:459-465's
-- shape) so §H's real tick evaluates all of them.
create temp table q62_team (tag text primary key, id uuid not null, league_id uuid not null);
insert into q62_team (tag, id, league_id) values
 ('K1',  'c6000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-000000000001'),
 ('K2',  'c6000000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-000000000001'),
 ('K3',  'c6000000-0000-4000-8000-000000000003', 'b6000000-0000-4000-8000-000000000001'),
 ('K4',  'c6000000-0000-4000-8000-000000000004', 'b6000000-0000-4000-8000-000000000001'),
 ('K4B', 'c6000000-0000-4000-8000-000000000005', 'b6000000-0000-4000-8000-000000000001'),
 ('FX',  'c6000000-0000-4000-8000-000000000006', 'b6000000-0000-4000-8000-000000000001'),
 ('FXR', 'c6000000-0000-4000-8000-000000000007', 'b6000000-0000-4000-8000-000000000001'),
 ('D6',  'c6000000-0000-4000-8000-000000000008', 'b6000000-0000-4000-8000-000000000004'),
 ('D7',  'c6000000-0000-4000-8000-000000000009', 'b6000000-0000-4000-8000-000000000004'),
 ('D8',  'c6000000-0000-4000-8000-000000000010', 'b6000000-0000-4000-8000-000000000004'),
 ('Q9',  'c6000000-0000-4000-8000-000000000011', 'b6000000-0000-4000-8000-000000000004'),
 ('Q9B', 'c6000000-0000-4000-8000-000000000012', 'b6000000-0000-4000-8000-000000000004'),
 ('X10', 'c6000000-0000-4000-8000-000000000013', 'b6000000-0000-4000-8000-000000000004'),
 ('O11', 'c6000000-0000-4000-8000-000000000014', 'b6000000-0000-4000-8000-000000000004'),
 ('ST',  'c6000000-0000-4000-8000-000000000015', 'b6000000-0000-4000-8000-000000000001'),
 ('ST2', 'c6000000-0000-4000-8000-000000000016', 'b6000000-0000-4000-8000-000000000001'),
 ('SP',  'c6000000-0000-4000-8000-000000000017', 'b6000000-0000-4000-8000-000000000001'),
 ('SP2', 'c6000000-0000-4000-8000-000000000018', 'b6000000-0000-4000-8000-000000000001'),
 ('NV',  'c6000000-0000-4000-8000-000000000019', 'b6000000-0000-4000-8000-000000000001'),
 ('NV2', 'c6000000-0000-4000-8000-000000000020', 'b6000000-0000-4000-8000-000000000001'),
 ('SA',  'c6000000-0000-4000-8000-000000000021', 'b6000000-0000-4000-8000-000000000001'),
 ('D20', 'c6000000-0000-4000-8000-000000000030', 'b6000000-0000-4000-8000-000000000002'),
 ('N30', 'c6000000-0000-4000-8000-000000000040', 'b6000000-0000-4000-8000-000000000003');
insert into teams (id, owner_id, name, league_id)
select id, '9b000000-0000-4000-8000-000000000001', 'Q62 ' || tag, league_id from q62_team;
insert into league_members (league_id, user_id, team_id, role, is_placeholder)
select league_id, null, id, 'manager', true from q62_team;

-- THE PLAYERS. `adp` is POPULATED on every row (rule 14(a)). Each cell's
-- WINNER is the one a pure-ADP sort (125) would NOT seat, except where ADP is
-- the key under test. Within a pair the LOSER is inserted first.
insert into players (id, full_name, position, team, status, adp) values
 ('q62-k1-b',   'Q62 K1 B',   'QB', 'DAL', 'Active',    1.0),
 ('q62-k1-a',   'Q62 K1 A',   'QB', 'DAL', 'Active',   50.0),
 ('q62-k2-b',   'Q62 K2 B',   'QB', 'DAL', 'Active',    2.0),
 ('q62-k2-a',   'Q62 K2 A',   'QB', 'DAL', 'Active',   40.0),
 ('q62-k3-b',   'Q62 K3 B',   'QB', 'DAL', 'Active',    5.0),
 ('q62-k3-a',   'Q62 K3 A',   'QB', 'DAL', 'Active',   80.0),
 ('q62-k4-a',   'Q62 K4 A',   'QB', 'DAL', 'Active',    9.0),
 ('q62-k4-z',   'Q62 K4 Z',   'QB', 'DAL', 'Active',    3.0),
 ('q62-k4b-b',  'Q62 K4B B',  'QB', 'DAL', 'Active',   null),
 ('q62-k4b-a',  'Q62 K4B A',  'QB', 'DAL', 'Active',   null),
 ('q62-fx-rb',  'Q62 FX RB',  'RB', 'SF',  'Active',    4.0),
 ('q62-fx-wr',  'Q62 FX WR',  'WR', 'NYG', 'Active',   30.0),
 ('q62-fxr-w1', 'Q62 FXR W1', 'WR', 'DAL', 'Active',   60.0),
 ('q62-fxr-w2', 'Q62 FXR W2', 'WR', 'DAL', 'Active',   61.0),
 ('q62-fxr-r1', 'Q62 FXR R1', 'RB', 'PHI', 'Active',   62.0),
 ('q62-d6-qb',  'Q62 D6 QB',  'QB', 'DAL', 'Active',   10.0),
 ('q62-d6-dbt', 'Q62 D6 Dbt', 'RB', 'SF',  'Doubtful',  1.0),
 ('q62-d6-ok',  'Q62 D6 Ok',  'WR', 'NYG', 'Active',   90.0),
 ('q62-d7-qb',  'Q62 D7 QB',  'QB', 'DAL', 'Active',   10.0),
 ('q62-d7-dbt', 'Q62 D7 Dbt', 'RB', 'SF',  'doubtful',  1.0),   -- lower-case: the bridge is case-insensitive (112:337)
 ('q62-d7-out', 'Q62 D7 Out', 'WR', 'NYG', 'Out',       2.0),
 ('q62-d8-qb',  'Q62 D8 QB',  'QB', 'DAL', 'Active',   10.0),
 ('q62-d8-dbt', 'Q62 D8 Dbt', 'WR', 'NYG', 'Doubtful',  1.0),
 ('q62-q9-qb',  'Q62 Q9 QB',  'QB', 'DAL', 'Active',   10.0),
 ('q62-q9-q',   'Q62 Q9 Q',   'WR', 'NYG', 'Questionable', 50.0),
 ('q62-q9-h',   'Q62 Q9 H',   'WR', 'NYG', 'Active',    1.0),
 ('q62-q9b-qb', 'Q62 Q9B QB', 'QB', 'DAL', 'Active',   10.0),
 ('q62-q9b-d',  'Q62 Q9B D',  'WR', 'NYG', 'Doubtful',  1.0),
 ('q62-q9b-q',  'Q62 Q9B Q',  'WR', 'NYG', 'Questionable', 50.0),
 ('q62-x10-qb', 'Q62 X10 QB', 'QB', 'DAL', 'Active',   10.0),
 ('q62-x10-out','Q62 X10 Out','RB', 'SF',  'Out',       1.0),
 ('q62-x10-dbt','Q62 X10 Dbt','WR', 'NYG', 'Doubtful',  2.0),
 ('q62-o11-qb', 'Q62 O11 QB', 'QB', 'DAL', 'Active',   10.0),
 ('q62-o11-out','Q62 O11 Out','WR', 'NYG', 'Out',       1.0),
 ('q62-o11-dbt','Q62 O11 Dbt','WR', 'NYG', 'Doubtful', 50.0),
 ('q62-st-a',   'Q62 ST A',   'QB', 'DAL', 'Active',    1.0),
 ('q62-st-b',   'Q62 ST B',   'QB', 'DAL', 'Active',   50.0),
 ('q62-st2-b',  'Q62 ST2 B',  'QB', 'DAL', 'Active',    1.0),
 ('q62-st2-a',  'Q62 ST2 A',  'QB', 'DAL', 'Active',   50.0),
 ('q62-sp-a',   'Q62 SP A',   'QB', 'DAL', 'Active',    1.0),
 ('q62-sp-b',   'Q62 SP B',   'QB', 'DAL', 'Active',   50.0),
 ('q62-sp2-b',  'Q62 SP2 B',  'QB', 'DAL', 'Active',    1.0),
 ('q62-sp2-a',  'Q62 SP2 A',  'QB', 'DAL', 'Active',   50.0),
 ('q62-nv-a',   'Q62 NV A',   'QB', 'DAL', 'Active',    1.0),
 ('q62-nv-b',   'Q62 NV B',   'QB', 'DAL', 'Active',   99.0),
 ('q62-nv2-a',  'Q62 NV2 A',  'QB', 'DAL', 'Active',    1.0),
 ('q62-sa-a',   'Q62 SA A',   'QB', 'DAL', 'Active',   50.0),
 ('q62-sa-b',   'Q62 SA B',   'QB', 'DAL', 'Active',    2.0),
 ('q62-d20-qb', 'Q62 D20 QB', 'QB', 'DAL', 'Active',   10.0),
 ('q62-d20-dbt','Q62 D20 Dbt','WR', 'NYG', 'Doubtful',  1.0),
 ('q62-n30-a',  'Q62 N30 A',  'QB', 'DAL', 'Active',    7.0),
 ('q62-n30-b',  'Q62 N30 B',  'QB', 'DAL', 'Active',    2.0);

insert into league_rosters (league_id, team_id, player_id, slot_key, ir_placed_week)
select t.league_id, t.id, r.pid, 'bn', null
from (values
 ('K1', 'q62-k1-b'), ('K1', 'q62-k1-a'), ('K2', 'q62-k2-b'), ('K2', 'q62-k2-a'),
 ('K3', 'q62-k3-b'), ('K3', 'q62-k3-a'), ('K4', 'q62-k4-a'), ('K4', 'q62-k4-z'),
 ('K4B', 'q62-k4b-b'), ('K4B', 'q62-k4b-a'),
 ('FX', 'q62-fx-rb'), ('FX', 'q62-fx-wr'),
 ('FXR', 'q62-fxr-w1'), ('FXR', 'q62-fxr-w2'), ('FXR', 'q62-fxr-r1'),
 ('D6', 'q62-d6-qb'), ('D6', 'q62-d6-dbt'), ('D6', 'q62-d6-ok'),
 ('D7', 'q62-d7-qb'), ('D7', 'q62-d7-dbt'), ('D7', 'q62-d7-out'),
 ('D8', 'q62-d8-qb'), ('D8', 'q62-d8-dbt'),
 ('Q9', 'q62-q9-qb'), ('Q9', 'q62-q9-q'), ('Q9', 'q62-q9-h'),
 ('Q9B', 'q62-q9b-qb'), ('Q9B', 'q62-q9b-d'), ('Q9B', 'q62-q9b-q'),
 ('X10', 'q62-x10-qb'), ('X10', 'q62-x10-out'), ('X10', 'q62-x10-dbt'),
 ('O11', 'q62-o11-qb'), ('O11', 'q62-o11-out'), ('O11', 'q62-o11-dbt'),
 ('ST', 'q62-st-a'), ('ST', 'q62-st-b'), ('ST2', 'q62-st2-b'), ('ST2', 'q62-st2-a'),
 ('SP', 'q62-sp-a'), ('SP', 'q62-sp-b'), ('SP2', 'q62-sp2-b'), ('SP2', 'q62-sp2-a'),
 ('NV', 'q62-nv-a'), ('NV', 'q62-nv-b'), ('NV2', 'q62-nv2-a'),
 ('SA', 'q62-sa-a'), ('SA', 'q62-sa-b'),
 ('D20', 'q62-d20-qb'), ('D20', 'q62-d20-dbt'),
 ('N30', 'q62-n30-a'), ('N30', 'q62-n30-b')
) as r(tag, pid)
join q62_team t on t.tag = r.tag;

-- THE VALUES (137's table, written here as the job would write them — every
-- CHECK honoured: a NULL names why, season NULL ⇔ 0 games). `pg_temp.v`
-- derives the bookkeeping columns from the three points values so each row
-- below reads as the numbers that matter.
create function pg_temp.v(p_league uuid, p_week int, p_pid text, p_proj numeric, p_season numeric, p_pre numeric,
                          p_computed timestamptz, p_fetched timestamptz default null) returns void
language sql as $$
  insert into public.league_player_values
    (league_id, season, week, player_id, projected_points, projected_missing, projected_unscored, projection_fetched_at,
     season_points, season_games, preseason_points, preseason_missing, preseason_unscored, computed_at)
  values (p_league, 2026, p_week, p_pid,
          p_proj, case when p_proj is null then 'no_line' end, case when p_proj is not null then '{}'::text[] end,
          case when p_proj is not null then coalesce(p_fetched, p_computed - interval '10 minutes') end,
          p_season, case when p_season is null then 0 else p_week - 1 end,
          p_pre, case when p_pre is null then 'no_line' end, case when p_pre is not null then '{}'::text[] end,
          p_computed);
$$;
-- P = 2026-09-25 12:00Z; C = P − 1h (fresh). Columns: proj, season, preseason.
select pg_temp.v(r.league_id, w, pid, pr, se, pre, c, f)
from (values
 -- K1: projection a > b; season b > a; preseason b > a; adp b < a.
 (3, 'q62-k1-a',  22.00,  40.00, 100.00, '2026-09-25 11:00:00+00'::timestamptz, null::timestamptz),
 (3, 'q62-k1-b',  18.00,  90.00, 300.00, '2026-09-25 11:00:00+00', null),
 -- K2: no projection; season a > b; preseason b > a; adp b < a.
 (3, 'q62-k2-a',   null,  50.00, 100.00, '2026-09-25 11:00:00+00', null),
 (3, 'q62-k2-b',   null,  40.00, 250.00, '2026-09-25 11:00:00+00', null),
 -- K3 (WEEK 1, no games yet): preseason a > b; adp b < a.
 (1, 'q62-k3-a',   null,   null, 300.00, '2026-09-11 11:00:00+00', null),
 (1, 'q62-k3-b',   null,   null, 200.00, '2026-09-11 11:00:00+00', null),
 -- K4 / K4B: rows exist, every points key NULL.
 (3, 'q62-k4-a',   null,   null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-k4-z',   null,   null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-k4b-a',  null,   null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-k4b-b',  null,   null,   null, '2026-09-25 11:00:00+00', null),
 -- FX: season points only. The RB leads the league-week's RBs; the WR is
 -- third among WRs (FXR's two WRs out-score him) — and 75 > 60.
 (3, 'q62-fx-rb',  null,  60.00,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-fx-wr',  null,  75.00,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-fxr-w1', null, 200.00,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-fxr-w2', null, 150.00,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-fxr-r1', null,  20.00,   null, '2026-09-25 11:00:00+00', null),
 -- Doubtful / Questionable cells: projections (season NULL everywhere here).
 (3, 'q62-d6-qb',  15.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-d6-dbt', 25.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-d6-ok',   5.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-d7-qb',  15.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-d7-dbt', 25.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-d7-out', 30.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-d8-qb',  15.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-d8-dbt', 12.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-q9-qb',  15.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-q9-q',    3.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-q9-h',   30.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-q9b-qb', 15.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-q9b-d',  40.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-q9b-q',   5.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-x10-qb', 15.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-x10-out', 0.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-x10-dbt',20.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-o11-qb', 15.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-o11-out',30.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-o11-dbt', 2.00,  null,   null, '2026-09-25 11:00:00+00', null),
 -- ST: a's ROW is 6h+1s old at P (stale); ST2: a's row is EXACTLY 6h old
 -- (fresh). SEASON points, not projections, so the ROW bound is the only
 -- thing under test (a projection's line is fetched before its row is
 -- computed, so a stale row would drag a stale LINE along with it).
 (3, 'q62-st-a',    null,  30.00,  null, '2026-09-25 05:59:59+00', null),
 (3, 'q62-st-b',    null,  10.00,  null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-st2-a',   null,  30.00,  null, '2026-09-25 06:00:00+00', null),
 (3, 'q62-st2-b',   null,  10.00,  null, '2026-09-25 11:00:00+00', null),
 -- SP: a's PROJECTION LINE is 6h+1s old at P (row fresh); SP2: exactly 6h.
 (3, 'q62-sp-a',   30.00,  10.00,  null, '2026-09-25 11:00:00+00', '2026-09-25 05:59:59+00'),
 (3, 'q62-sp-b',    null,  50.00,  null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-sp2-a',  30.00,  10.00,  null, '2026-09-25 11:00:00+00', '2026-09-25 06:00:00+00'),
 (3, 'q62-sp2-b',   null,  50.00,  null, '2026-09-25 11:00:00+00', null),
 -- NV: only b has a row (a is rostered with NONE); NV2's only QB has none.
 (3, 'q62-nv-b',    null,   5.00,  null, '2026-09-25 11:00:00+00', null),
 -- SA: EVERY row of the team stale.
 (3, 'q62-sa-a',   40.00,  null,   null, '2026-09-24 12:00:00+00', null),
 (3, 'q62-sa-b',   10.00,  null,   null, '2026-09-24 12:00:00+00', null),
 -- D20 (AL2, allow_illegal_lineups = FALSE)
 (3, 'q62-d20-qb', 15.00,  null,   null, '2026-09-25 11:00:00+00', null),
 (3, 'q62-d20-dbt',12.00,  null,   null, '2026-09-25 11:00:00+00', null)
) as x(w, pid, pr, se, pre, c, f)
-- each row lands in the league that ROSTERS the player (AL1, AL2 or AL4).
join league_rosters r on r.player_id = x.pid;

-- THE LINEUP ROWS, written by the REAL carry (so every "empty" row is what
-- `league_week_advance` produces), then the cells that need a STORED map get
-- it planted over `slot_map` (073 §J's method). K3 also gets its WEEK-1 row.
select public.lineup_carry_internal(t.league_id, t.id, 2026, 3, '2026-09-23 04:00:00+00') from q62_team t;
select public.lineup_carry_internal(t.league_id, t.id, 2026, 1, '2026-09-09 04:00:00+00') from q62_team t where t.tag = 'K3';
update team_lineups tl set slot_map = m.map
from (values
 ('D6',  '{"qb:0": "q62-d6-qb",  "flex:0": "q62-d6-dbt"}'::jsonb),
 ('D7',  '{"qb:0": "q62-d7-qb",  "flex:0": "q62-d7-dbt"}'::jsonb),
 ('D8',  '{"qb:0": "q62-d8-qb"}'::jsonb),
 ('Q9',  '{"qb:0": "q62-q9-qb",  "flex:0": "q62-q9-q"}'::jsonb),
 ('Q9B', '{"qb:0": "q62-q9b-qb"}'::jsonb),
 ('X10', '{"qb:0": "q62-x10-qb", "flex:0": "q62-x10-out"}'::jsonb),
 ('O11', '{"qb:0": "q62-o11-qb"}'::jsonb),
 ('D20', '{"qb:0": "q62-d20-qb"}'::jsonb)
) as m(tag, map)
join q62_team t on t.tag = m.tag
where tl.team_id = t.id and tl.season = 2026 and tl.week = 3;

-- THE PREMISE BLOCK (rule 14(c)) — every reversal asserted BY VALUE.
select is(
  (select string_agg(format('%s:%s/%s/%s/%s', v.player_id, v.projected_points, v.season_points, v.preseason_points, p.adp), ' ' order by v.player_id)
   from league_player_values v join players p on p.id = v.player_id
   where v.player_id in ('q62-k1-a', 'q62-k1-b')),
  'q62-k1-a:22.00/40.00/100.00/50.0 q62-k1-b:18.00/90.00/300.00/1.0',
  'B1 K1 PREMISE: a leads on PROJECTION only; b leads on season points, preseason points AND adp — so any key but the projection seats b');
select is(
  (select string_agg(format('%s:%s/%s/%s/%s', v.player_id, coalesce(v.projected_missing, 'x'), v.season_points, v.preseason_points, p.adp), ' ' order by v.player_id)
   from league_player_values v join players p on p.id = v.player_id
   where v.player_id in ('q62-k2-a', 'q62-k2-b')),
  'q62-k2-a:no_line/50.00/100.00/40.0 q62-k2-b:no_line/40.00/250.00/2.0',
  'B2 K2 PREMISE: neither is projected; a leads on SEASON points only; b leads on preseason AND adp');
select is(
  (select string_agg(format('%s:w%s/%s/%s/%s/%s', v.player_id, v.week, coalesce(v.projected_missing, 'x'), v.season_games, v.preseason_points, p.adp), ' ' order by v.player_id)
   from league_player_values v join players p on p.id = v.player_id
   where v.player_id in ('q62-k3-a', 'q62-k3-b')),
  'q62-k3-a:w1/no_line/0/300.00/80.0 q62-k3-b:w1/no_line/0/200.00/5.0',
  'B3 K3 PREMISE: WEEK 1 — nobody projected, ZERO games played (season_points NULL by 137''s CHECK); a leads on PRESEASON only, b on adp');
select is(
  (select string_agg(format('%s:%s/%s/%s/%s', v.player_id, coalesce(v.projected_points::text, '-'), coalesce(v.season_points::text, '-'),
                            coalesce(v.preseason_points::text, '-'), coalesce(p.adp::text, '-')), ' ' order by v.player_id)
   from league_player_values v join players p on p.id = v.player_id
   where v.player_id like 'q62-k4%'),
  'q62-k4-a:-/-/-/9.0 q62-k4-z:-/-/-/3.0 q62-k4b-a:-/-/-/- q62-k4b-b:-/-/-/-',
  'B4 K4 / K4B PREMISE: fresh rows with EVERY points key NULL; K4''s adp order (z before a) REVERSES id order; K4B has no adp at all');
select is(
  (select format('rb_rank=%s wr_rank=%s rb_pts=%s wr_pts=%s',
          (select r from (select player_id, rank() over (order by season_points desc) r from league_player_values v join players p on p.id = v.player_id
                          where v.league_id = 'b6000000-0000-4000-8000-000000000001' and v.week = 3 and p.position = 'RB' and v.season_points is not null) s where player_id = 'q62-fx-rb'),
          (select r from (select player_id, rank() over (order by season_points desc) r from league_player_values v join players p on p.id = v.player_id
                          where v.league_id = 'b6000000-0000-4000-8000-000000000001' and v.week = 3 and p.position = 'WR' and v.season_points is not null) s where player_id = 'q62-fx-wr'),
          (select season_points from league_player_values where player_id = 'q62-fx-rb'),
          (select season_points from league_player_values where player_id = 'q62-fx-wr'))),
  'rb_rank=1 wr_rank=3 rb_pts=60.00 wr_pts=75.00',
  'B5 FLEX PREMISE: the RB is RB #1 of the league-week and the WR only WR #3 — a smaller positional rank NUMBER for the RB — while the WR has MORE season points (75 > 60); neither is projected, and the RB''s adp (4) beats the WR''s (30)');
select is(
  (select string_agg(format('%s=%s', p.id, coalesce(public.lineup_designation_internal(p.status), 'healthy')), ' ' order by p.id)
   from players p where p.id in ('q62-d6-dbt', 'q62-d7-dbt', 'q62-q9-q', 'q62-q9b-q', 'q62-x10-out')),
  'q62-d6-dbt=Doubtful q62-d7-dbt=Doubtful q62-q9-q=healthy q62-q9b-q=healthy q62-x10-out=OUT',
  'B6 DESIGNATION PREMISE: the bridge (112:337) reads Doubtful — any case — as Doubtful and Questionable as HEALTHY (NULL)');
select is(
  (select count(*)::int from league_player_values where league_id = 'b6000000-0000-4000-8000-000000000003'),
  0, 'B7 AL3 PREMISE: the league has NO values rows at all — the "week with no values" (§F3)');
select is(
  (select string_agg(format('%s:%s', player_id, computed_at), ' ' order by player_id) from league_player_values
   where player_id in ('q62-st-a', 'q62-st2-a')),
  'q62-st-a:2026-09-25 05:59:59+00 q62-st2-a:2026-09-25 06:00:00+00',
  'B8 FRESHNESS PREMISE (rows): at P = 12:00:00Z the ST row is 6h+1s old and the ST2 row EXACTLY 6h — the boundary pair (season points 30 vs 10; nobody projected)');
select is(
  (select string_agg(format('%s:%s', player_id, projection_fetched_at), ' ' order by player_id) from league_player_values
   where player_id in ('q62-sp-a', 'q62-sp2-a')),
  'q62-sp-a:2026-09-25 05:59:59+00 q62-sp2-a:2026-09-25 06:00:00+00',
  'B9 FRESHNESS PREMISE (projections): the SP line is 6h+1s old and the SP2 line EXACTLY 6h, both rows computed an hour before P');
select is(
  (select count(*)::int from league_player_values where player_id in ('q62-nv-a', 'q62-nv2-a')),
  0, 'B10 F389(a) PREMISE: NV''s a and NV2''s only QB are ROSTERED with NO values row');

-- Run the chooser for every team at P (K3 also at P1, week 1) and keep each
-- result: §C-§F read them, §H compares them with what the REAL tick writes.
create temp table q62_r (tag text primary key, week int not null, r jsonb not null);
insert into q62_r (tag, week, r)
select t.tag, 3, public.lineup_autopilot_internal(t.league_id, t.id, 2026, 3, '2026-09-25 12:00:00+00') from q62_team t;
insert into q62_r (tag, week, r)
select 'K3@W1', 1, public.lineup_autopilot_internal(t.league_id, t.id, 2026, 1, '2026-09-11 12:00:00+00') from q62_team t where t.tag = 'K3';
create function pg_temp.r(p_tag text) returns jsonb language sql as $$ select r from q62_r where tag = p_tag $$;
create function pg_temp.fill(p_tag text, p_slot text) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.r(p_tag) -> 'filled') x where x ->> 'slot' = p_slot $$;

-- ---------------------------------------------------------------------------
-- C. THE FOUR KEYS, each reversing the next (Q62 RULED)
-- ---------------------------------------------------------------------------
select is(pg_temp.r('K1') -> 'slot_map' -> 'qb:0', '"q62-k1-a"'::jsonb,
  'C1 KEY 1 — THIS WEEK''S PROJECTION WINS: qb:0 is a (22.00 projected) over b (18.00), although b leads on season points, preseason points and adp (break probes: drop the projection key, or restore 125''s adp-first sort ⇒ red)');
select is(pg_temp.fill('K1', 'qb:0') -> 'order' ->> 'ordered_by', 'projected_points',
  'C1b …and the fill SAYS which key ordered it (rule 15)');
select is(pg_temp.r('K2') -> 'slot_map' -> 'qb:0', '"q62-k2-a"'::jsonb,
  'C2 KEY 2 — NO PROJECTION ⇒ SEASON-TO-DATE POINTS: a (50.00) over b (40.00), although b leads on preseason points and adp');
select is(pg_temp.fill('K2', 'qb:0') -> 'order', jsonb_build_object(
    'ordered_by', 'season_points', 'projected_points', null, 'season_points', 50.00, 'preseason_points', 100.00,
    'adp', 40.0, 'value_row', 'fresh', 'projected_why', 'no_line'),
  'C2b …ordered_by season_points, with every key AS READ and why the projection was absent (137''s own `no_line`)');
select is(pg_temp.r('K3@W1') -> 'slot_map' -> 'qb:0', '"q62-k3-a"'::jsonb,
  'C3 KEY 3 — WEEK 1, NO GAMES YET ⇒ PRESEASON: a (300.00 preseason) over b (200.00), although b''s adp (5) is far better than a''s (80)');
select is(pg_temp.fill('K3@W1', 'qb:0') -> 'order' ->> 'ordered_by', 'preseason_points',
  'C3b …ordered_by preseason_points');
select is(pg_temp.r('K4') -> 'slot_map' -> 'qb:0', '"q62-k4-z"'::jsonb,
  'C4 KEY 4 — NOTHING ⇒ ADP: z (adp 3) over a (adp 9), although a sorts first by player_id');
select is(pg_temp.fill('K4', 'qb:0') -> 'order' ->> 'ordered_by', 'adp',
  'C4b …ordered_by adp');
select is(pg_temp.r('K4B') -> 'slot_map' -> 'qb:0', '"q62-k4b-a"'::jsonb,
  'C5 DETERMINISM — no key and no adp ⇒ player_id: a over b (b was inserted first into players AND the roster)');
select is(pg_temp.fill('K4B', 'qb:0') -> 'order' ->> 'ordered_by', 'player_id',
  'C5b …ordered_by player_id');
select is(pg_temp.r('FX') -> 'slot_map' -> 'flex:0', '"q62-fx-wr"'::jsonb,
  'C6 FLEX — TOTAL SCORED POINTS, NOT RANK (RULED): the WR with 75.00 season points starts at FLEX over the RB with 60.00, although the RB is RB #1 and the WR only WR #3 (and the RB''s adp is better)');
select is(pg_temp.r('FX') -> 'bench', '["q62-fx-rb"]'::jsonb,
  'C6b …and the RB is benched, not lost');

-- ---------------------------------------------------------------------------
-- D. DOUBTFUL SITS — "yes start the doubtful" when nothing healthy exists
-- ---------------------------------------------------------------------------
select is(pg_temp.r('D6') -> 'slot_map', '{"qb:0": "q62-d6-qb", "flex:0": "q62-d6-ok"}'::jsonb,
  'D1 A DOUBTFUL STARTER WITH A HEALTHY REPLACEMENT IS SUBSTITUTED: flex:0 goes to the healthy WR (5.00 projected) although the Doubtful RB projects 25.00 — Doubtful SITS (break probe: remove Doubtful from the classification ⇒ red)');
select is(
  (select jsonb_build_object('slot', x ->> 'slot', 'out', x ->> 'out', 'in', x ->> 'in', 'reason', x ->> 'reason', 'ordered_by', x -> 'order' ->> 'ordered_by')
   from jsonb_array_elements(pg_temp.r('D6') -> 'substituted') x),
  '{"slot": "flex:0", "out": "q62-d6-dbt", "in": "q62-d6-ok", "reason": "designated Doubtful", "ordered_by": "projected_points"}'::jsonb,
  'D1b …NAMED in substituted[] with the reason "designated Doubtful" and the incoming man''s ordering key');
select is(pg_temp.r('D7') -> 'slot_map', '{"qb:0": "q62-d7-qb", "flex:0": "q62-d7-dbt"}'::jsonb,
  'D2 A DOUBTFUL STARTER WITH NO HEALTHY REPLACEMENT STARTS ("yes start the doubtful"): the only other flex-eligible man is OUT, so the Doubtful RB is RESTORED where he sat — never an empty slot');
select is(
  (select jsonb_agg(x ->> 'player_id') from jsonb_array_elements(pg_temp.r('D7') -> 'restored') x),
  '["q62-d7-dbt"]'::jsonb,
  'D2b …and restored[] NAMES him (Q63''s restore clause), with changed = false and the reason no_change');
select is(
  (select s -> 'flags' from jsonb_array_elements(pg_temp.r('D7') -> 'starters') s where s ->> 'slot' = 'flex:0'),
  '[]'::jsonb,
  'D2c LEGALITY: the started Doubtful man carries NO `out` flag — a Doubtful start is legal (114:596), so 138 kept him out of the flag (break probe: add Doubtful to the flag ⇒ red)');
select is(format('%s/%s', pg_temp.r('D7') ->> 'changed', pg_temp.r('D7') ->> 'reason'), 'false/no_change',
  'D2d …the pass evaluated, changed nothing, and SAYS so (rule 15)');
select is(pg_temp.r('D8') -> 'slot_map', '{"qb:0": "q62-d8-qb", "flex:0": "q62-d8-dbt"}'::jsonb,
  'D3 A DOUBTFUL-ONLY CANDIDATE FOR AN EMPTY SLOT IS SEATED (allow_illegal_lineups = TRUE)');
select is(pg_temp.r('D20') -> 'slot_map', '{"qb:0": "q62-d20-qb", "flex:0": "q62-d20-dbt"}'::jsonb,
  'D4 …AND UNDER allow_illegal_lineups = FALSE: Doubtful is a PREFERENCE, never the hard filter (break probe: route him into the filtered set ⇒ red)');
select is(format('allow=%s unfillable=%s', pg_temp.r('D20') ->> 'allow_illegal_lineups', pg_temp.r('D20') -> 'unfillable'),
  'allow=false unfillable=[]',
  'D4b …in the league that forbids illegal lineups, with NOTHING named unfillable — no "league forbids illegal lineups" slot on a Doubtful man''s account');
select is(format('%s/%s', pg_temp.r('Q9') -> 'slot_map', pg_temp.r('Q9') ->> 'reason'),
  '{"qb:0": "q62-q9-qb", "flex:0": "q62-q9-q"}/no_empty_slot_and_no_unhealthy_unlocked_starter',
  'D5 QUESTIONABLE IS HEALTHY: a seated Questionable starter (3.00 projected) stays although a healthy 30.00 sits on the bench — never replaced on value (Q63) — and the short-circuit says why');
select is(pg_temp.r('Q9B') -> 'slot_map' -> 'flex:0', '"q62-q9b-q"'::jsonb,
  'D6 …and a Questionable CANDIDATE (5.00) takes an empty slot ahead of a Doubtful one (40.00): healthy first, whatever the points');
select is(pg_temp.r('X10') -> 'slot_map', '{"qb:0": "q62-x10-qb", "flex:0": "q62-x10-out"}'::jsonb,
  'D7 Q68 — BUILT AS THE RULING READS, RECORDED NOT DECIDED: an OUT starter whose only bench replacement is Doubtful is NOT substituted — Q63 swaps only for a HEALTHY replacement, and Doubtful now sits');
select is(
  (select jsonb_agg(x ->> 'player_id') from jsonb_array_elements(pg_temp.r('X10') -> 'restored') x),
  '["q62-x10-out"]'::jsonb,
  'D7b …and restored[] names the OUT man, so the choice is visible in the tick''s report, not silent');
select is(pg_temp.r('O11') -> 'slot_map' -> 'flex:0', '"q62-o11-dbt"'::jsonb,
  'D8 THE TAIL ORDER (D375(4)): for an empty slot with no healthy candidate, the Doubtful man (2.00) is seated ahead of the OUT man (30.00) — where Doubtful stood relative to a blocked man before 138');

-- ---------------------------------------------------------------------------
-- E. F387's READ HALF — a stale value is ABSENT ⇒ the next key (boundary pairs)
-- ---------------------------------------------------------------------------
select is(pg_temp.r('ST2') -> 'slot_map' -> 'qb:0', '"q62-st2-a"'::jsonb,
  'E1 a values row EXACTLY 6h old at P is FRESH: a''s 30.00 season points order him first (b''s adp is better)');
select is(pg_temp.r('ST') -> 'slot_map' -> 'qb:0', '"q62-st-b"'::jsonb,
  'E2 …ONE SECOND older and the row is STALE ⇒ absent: b (10.00, fresh) starts over a''s 30.00 — the values job had stopped landing (break probe: trust the stale row ⇒ red)');
select is(pg_temp.r('ST') -> 'order_basis' -> 'stale_value_row', '["q62-st-a"]'::jsonb,
  'E2b …and order_basis NAMES the stale row''s player (rule 15)');
select is(pg_temp.fill('SP2', 'qb:0') -> 'order' ->> 'ordered_by', 'projected_points',
  'E3 a projection line EXACTLY 6h old at P is FRESH: SP2''s a is ordered by his projection');
select is(pg_temp.r('SP2') -> 'slot_map' -> 'qb:0', '"q62-sp2-a"'::jsonb,
  'E3b …and starts (30.00 projected beats b''s unprojected 50.00 season — key 1 outranks key 2, the per-player reading)');
select is(pg_temp.r('SP') -> 'slot_map' -> 'qb:0', '"q62-sp-b"'::jsonb,
  'E4 …ONE SECOND older and the projection is ABSENT: a falls to his season points (10.00) and b (50.00) starts — the projections sync had stopped landing (break probe: trust the stale line ⇒ red)');
select is(pg_temp.fill('SP', 'qb:0') -> 'order' ->> 'ordered_by', 'season_points',
  'E4b …b ordered_by season_points');
select is(pg_temp.r('SA') -> 'order_basis' ->> 'fallback_why' like 'all_value_rows_stale:%', true,
  'E5 EVERY row of a team stale ⇒ the pass says it FELL BACK TO ADP because the rows were stale — never a quiet adp order');
select is(pg_temp.r('SA') -> 'slot_map' -> 'qb:0', '"q62-sa-b"'::jsonb,
  'E5b …and orders by adp (b, 2.0) over a''s stale 40.00 projection');

-- ---------------------------------------------------------------------------
-- F. F389's JOIN CONTRACT (a) — a missing values row never drops a player
-- ---------------------------------------------------------------------------
select is(pg_temp.r('NV') -> 'slot_map' -> 'qb:0', '"q62-nv-b"'::jsonb,
  'F1 a valued man (5.00 season) outranks a rostered man with NO values row, although the unvalued man''s adp is 1.0 — any key outranks none');
select is(format('bench=%s no_value_row=%s', pg_temp.r('NV') -> 'bench', pg_temp.r('NV') -> 'order_basis' -> 'no_value_row'),
  'bench=["q62-nv-a"] no_value_row=["q62-nv-a"]',
  'F1b …the unvalued man stays in the pool (benched, not lost) and is NAMED in order_basis.no_value_row');
select is(pg_temp.r('NV2') -> 'slot_map' -> 'qb:0', '"q62-nv2-a"'::jsonb,
  'F2 LEFT JOIN, NEVER INNER: the team''s ONLY QB has no values row and is STILL seated (break probe: an inner join ⇒ qb:0 unfillable ⇒ red)');
select is(
  format('%s/%s/%s', pg_temp.fill('NV2', 'qb:0') -> 'order' ->> 'value_row', pg_temp.r('NV2') -> 'order_basis' ->> 'fell_back_to_adp',
         split_part(pg_temp.r('NV2') -> 'order_basis' ->> 'fallback_why', ':', 1)),
  'no_value_row/true/no_value_rows',
  'F2b …his fill says value_row = no_value_row, and the pass says it FELL BACK TO ADP because no row existed');
select is(pg_temp.r('N30') -> 'slot_map' -> 'qb:0', '"q62-n30-b"'::jsonb,
  'F3 A WEEK WITH NO VALUES AT ALL (AL3): autopilot still seats — by adp (b, 2.0 over a, 7.0)');
select is(
  (select jsonb_build_object('fell_back_to_adp', b -> 'fell_back_to_adp', 'why', split_part(b ->> 'fallback_why', ':', 1),
                             'by_key', b -> 'by_key', 'no_value_row', b -> 'no_value_row')
   from (select pg_temp.r('N30') -> 'order_basis' as b) s),
  '{"fell_back_to_adp": true, "why": "no_value_rows", "by_key": {"adp": 2, "player_id": 0, "season_points": 0, "preseason_points": 0, "projected_points": 0}, "no_value_row": ["q62-n30-a", "q62-n30-b"]}'::jsonb,
  'F3b …and REPORTS that it fell back to ADP and why, naming every unvalued player (tasks-M6A L.E1.21: "a week with NO values reports that it fell back to ADP and why")');
select is(pg_temp.r('K1') -> 'order_basis' -> 'fell_back_to_adp', 'false'::jsonb,
  'F4 the positive control: a team whose players carry projections does NOT report a fallback');
select is(pg_temp.r('K1') -> 'order_basis' -> 'by_key', '{"adp": 0, "player_id": 0, "season_points": 0, "preseason_points": 0, "projected_points": 2}'::jsonb,
  'F4b …and counts both of its men as ordered by projection');

-- ---------------------------------------------------------------------------
-- G. The candidate set is untouched by the sort — only its ORDER moved
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from q62_r q
   where (q.r ->> 'changed')::boolean
     and exists (select 1 from jsonb_each_text(q.r -> 'slot_map') a, jsonb_each_text(q.r -> 'slot_map') b
                 where a.key < b.key and a.value = b.value)),
  0, 'G1 no written map seats one player in two slots (D356(7c)''s defect class, re-checked over every changed result)');
select is(
  (select count(*)::int from q62_r where (r ->> 'changed')::boolean),
  21, 'G2 PREMISE for §H: 21 of the 24 chooser results change their map — all but D7 and X10 (the two restores) and Q9 (the short-circuit)');

-- ---------------------------------------------------------------------------
-- H. THE REAL TICK at the SAME instant writes exactly what the chooser chose,
--    and every written map passes invariant 2's oracle
-- ---------------------------------------------------------------------------
create function pg_temp.fit_of(p_team uuid) returns jsonb language sql as $$
  select public.lineup_fit_internal(
    (select coalesce(jsonb_agg(jsonb_build_object('key', (s ->> 'key') || ':' || i, 'eligible', s -> 'eligible') order by ord, i), '[]'::jsonb)
     from leagues l
       cross join lateral jsonb_array_elements(l.roster_settings -> 'starting_slots') with ordinality as t(s, ord)
       cross join lateral generate_series(0, coalesce((s ->> 'count')::int, 0) - 1) i
     where l.id = (select league_id from teams where id = p_team)),
    (select coalesce(jsonb_agg(jsonb_build_object(
              'player_id', e.value #>> '{}',
              'position', case when p.position = 'DEF' then 'DST' else p.position end,
              'wanted', e.key, 'fixed', false) order by e.key), '[]'::jsonb)
     from team_lineups tl
       cross join lateral jsonb_each(tl.slot_map) e
       join players p on p.id = e.value #>> '{}'
     where tl.team_id = p_team and tl.season = 2026 and tl.week = 3));
$$;
select set_config('pgtap.t1', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'b6000000-0000-4000-8000-000000000001')::text, true);
select set_config('pgtap.t2', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'b6000000-0000-4000-8000-000000000002')::text, true);
select set_config('pgtap.t4', public.lineup_lock_tick('2026-09-25 12:00:00+00', 'b6000000-0000-4000-8000-000000000004')::text, true);
select is(
  (select count(*)::int from q62_r q join q62_team t on t.tag = q.tag
     join team_lineups tl on tl.team_id = t.id and tl.season = 2026 and tl.week = 3
   where q.week = 3 and t.league_id <> 'b6000000-0000-4000-8000-000000000003'
     and tl.slot_map = q.r -> 'slot_map'),
  22, 'H1 the REAL tick (arm (c)) at P wrote, for all 22 AL1/AL2/AL4 teams, EXACTLY the map the pure chooser returned — the chooser is the tick''s selection, not a model of it');
select is(
  (select jsonb_array_length(current_setting('pgtap.t1')::jsonb -> 'autopiloted') + jsonb_array_length(current_setting('pgtap.t2')::jsonb -> 'autopiloted')
          + jsonb_array_length(current_setting('pgtap.t4')::jsonb -> 'autopiloted')),
  19, 'H2 …and 19 teams written — the 21 changed results less K3@W1 (week 1, not the tick''s week) and N30 (AL3, not ticked); D7 / Q9 / X10 evaluated and left as they were');
select is(
  (select count(*)::int
   from jsonb_array_elements((current_setting('pgtap.t1')::jsonb -> 'autopiloted') || (current_setting('pgtap.t2')::jsonb -> 'autopiloted') || (current_setting('pgtap.t4')::jsonb -> 'autopiloted')) a
   where pg_temp.fit_of((a ->> 'team_id')::uuid) -> 'unplaced' <> '[]'::jsonb
      or pg_temp.fit_of((a ->> 'team_id')::uuid) -> 'rearranged' <> 'false'::jsonb),
  0, 'H3 INVARIANT 2''s ORACLE over EVERY written map: lineup_fit_internal places everyone and rearranges nobody (checkLineupLegality''s own test)');
select is(
  (select f -> 'order' ->> 'ordered_by'
   from jsonb_array_elements(current_setting('pgtap.t1')::jsonb -> 'autopiloted') a,
        jsonb_array_elements(a -> 'filled') f
   where a ->> 'team_id' = 'c6000000-0000-4000-8000-000000000001' and f ->> 'slot' = 'qb:0'),
  'projected_points',
  'H4 the per-pick `order` reaches the TICK''s report through arm (c)''s unchanged autopiloted[].filled — with ZERO tick hunks');
select is(
  (select s -> 'flags' from team_lineups tl, jsonb_array_elements(tl.starters) s
   where tl.team_id = 'c6000000-0000-4000-8000-000000000010' and tl.week = 3 and s ->> 'slot' = 'flex:0'),
  '[]'::jsonb,
  'H5 the WRITTEN starters element of a seated Doubtful man (D8) carries no `out` flag either');
select is(
  (select s -> 'flags' from team_lineups tl, jsonb_array_elements(tl.starters) s
   where tl.team_id = 'c6000000-0000-4000-8000-000000000014' and tl.week = 3 and s ->> 'slot' = 'flex:0'),
  '[]'::jsonb,
  'H5b …nor does O11''s written Doubtful fill (seated ahead of the OUT man, §D8)');
select is(format('%s %s %s', current_setting('pgtap.t1')::jsonb -> 'failures', current_setting('pgtap.t2')::jsonb -> 'failures',
              current_setting('pgtap.t4')::jsonb -> 'failures'),
  '[] [] []',
  'H6 every tick''s failures[] is EMPTY — no league raised under the new sort');

select * from finish();
rollback;
