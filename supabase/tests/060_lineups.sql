-- ============================================================================
-- Lineups — pgTAP 060 (task L.D1.4; migration 112; §I RE-CUT by L.D1.5b /
-- migration 114 — the Q34(A) erratum, `per_player_kickoff` the ONLY lineup
-- lock (spec v2.16.20 §7.3.6/§11.2; PROGRESS D311); spec v2.16.15 §11.2 /
-- §12.13 / §7.3.6 / §7.3.2 IR slot rules / §11.1 bipartite / E16 / E42 /
-- §23.3; tasks-M4 §4 rules 1–11; D291 / D293 / D308; ledger F18 (the C12 half,
-- discharged here) / F35 (re-affirmed — pinned structurally in §A).
--
-- Numbering: pgTAP head measured 059 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 060, the tasks-M4 §7 reservation confirmed, not inherited
-- (D161/D166).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * THE F18 SWAP FROM BOTH DIRECTIONS (the 052/019 pattern). Direction 1:
--     a league member with NO teams row (u5) reads every lineup in the
--     league. Direction 2 — the C12 ghost (u3), who OWNS a teams row in the
--     league but is not a member — reads NOTHING (001's world-readable
--     SELECT granted it) and an INSERT as the teams-row owner raises 42501
--     (001's owner FOR ALL granted it); the manager who owns T2 gets UPDATE/
--     DELETE RETURNING 0 and INSERT 42501 — there is NO client write path for
--     anyone, preceded by same-role SELECT-sees-N pins (§4.2). THE LEGACY
--     ORPHAN: a standalone team's (league_id NULL) lineup row is read by its
--     owner as 0 rows while postgres sees 1 — the 112 §2 disposition, pinned.
--   * EVERY GOLDEN IS A STORED LITERAL: the canonical slot_map after the
--     two-flex trap (RB wanted at W/T beside a WR at W/R/T, both RB slots
--     full → RB re-seated to W/R/T and WR to W/T) is pinned as a jsonb
--     literal through the pure matcher AND through the RPC; the DoD break
--     probe (PR body) replaces the augmentation with greedy first-eligible
--     and these cells red (the RB becomes "unplaceable"). Its satisfiable
--     TWIN (the same players placed validly) returns the identity with
--     rearranged = false. The lone-WR pin (E16's own sentence), a superflex
--     config, an unfillable slot REFUSED BY NAME, and a FIXED (locked)
--     vertex the matcher may not route through.
--   * LOCK BOUNDARIES, THE ONE MODE, ONE UNIT EITHER SIDE (D146 / D272(20)) —
--     applied to the DATUM (now() is frozen inside this txn, D307(3)):
--     `nfl_games.kickoff_at = now() ± 1s` IS kickoff+1s / kickoff−1s, and
--     `= now()` is AT the kickoff (locked — closed on the kickoff side).
--     per_player_kickoff: a played player cannot enter a slot; a locked
--     slot's player never moves (replace / move / bench all refuse by name)
--     while an UNLOCKED slot of the same lineup still edits — and E42: the
--     same kickoff moved back to the future RE-OPENS the slot (the lock is
--     evaluated from the table at call time, never from `locked_at`).
--     114 / Q34(A): the week's FIRST game having kicked off locks NOTHING by
--     itself — §I sets, edits and benches a lineup of unstarted players
--     with KC already kicked off (the retired whole-week mode's refusal is
--     the PR's break probe); an identical submit under a player's lock is
--     `no_changes`, never a refusal. The
--     no-game-rows fallback (nfl_weeks.first_kickoff_at → starts_at) locks
--     EVERY player conservatively and names its arm.
--   * IR: placement requires the designation (Questionable refused by name;
--     `Out` → OUT through the vocabulary bridge accepted; `Sus` → Suspended
--     pinned on the bridge); restricted `ir_lock_until_week` = placed + 4 as
--     a literal; removal refused at current week = lock−1 (6) and ACCEPTED
--     at lock+0 (7) — the calendar moved inside the txn (the weeks'
--     `first_kickoff_at` arm kept ahead so tenure, not lock timing, is what
--     each cell measures); an IR'd player who turns Active is KEPT and
--     flagged `ir_ineligible`; an IR move on a played player refuses on
--     lock timing; IR + starter in one map refuses ("exactly one slot").
--   * allow_illegal_lineups BOTH settings: TRUE accepts bye/OUT starters
--     and flags them (literal flag arrays); FALSE refuses by name and the
--     same submit with the player benched succeeds.
--   * LOUD EMPTINESS (rule 10): `no_changes = true` BY NAME with the row's
--     set_at and the roster digest unchanged; a week off the calendar, a
--     past week, an empty roster, an unknown slot key, an unrostered
--     player, a duplicated player, a non-object map, a missing action_id, a
--     team of another league, a league not in season — every one refused by
--     name (never a 0-row UPDATE read as success).
--   * REPLAY BY action_id (099/E2): the same action_id with a DIFFERENT map
--     returns the stored result byte-identically (text equality), with the
--     ledger count and the lineup/roster digest unchanged.
--   * ROLES: outsider, the C12 ghost, a member of the league who does not
--     manage the team, another league's commissioner and anon are refused
--     with ONE no-leak 42501; the league's commissioner MAY set another
--     team's lineup (D293) and the row records `edited_by_commish = TRUE`;
--     the manager's own set records FALSE. The ledger has no client read or
--     write path for any role (SELECT sees 0 while postgres sees N; INSERT
--     42501; UPDATE/DELETE RETURNING 0).
--   * F35 pinned STRUCTURALLY: no function 112 defines names
--     `team_managers` in its body (prosrc) — access derives from
--     `league_members`.
--   * HELD LOCK: the min RTT over three set_lineup calls on a warm stack
--     < 50 ms (rule 8 — min, not mean, so a GC pause cannot red the cell).
--   * All privileged-context work (fixtures, calendar, kickoff moves) runs
--     as postgres BEFORE the role switches; set_config(..., true) persists
--     to txn end (D49(7)); every role switch is explicit. Calls at an
--     INJECTED instant go through `set_lineup_internal` (the rule-10 seam,
--     REVOKEd from every client role) as postgres with the JWT claim set —
--     the body's in-body auth still reads auth.uid().
--   * The 2026 calendar is re-asserted RELATIVE to now() inside this
--     rolled-back txn (the R724/R730 shape): week w starts (w − 3) weeks −
--     1 day from the transaction instant, so the CURRENT week is 3 by the
--     `nfl_weeks.starts_at` boundary, week 4 starts in 6 days, and no pin
--     can rot with the wall clock. All 2026 `nfl_games` rows are the
--     fixture's own.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(158);

-- ---------------------------------------------------------------------------
-- A. Form pins — §12.13 columns, the policy swap, the ledger, the functions,
--    grants (§4.1), F35 structurally
-- ---------------------------------------------------------------------------
select has_column('public', 'team_lineups', 'slot_map', 'team_lineups.slot_map exists (§12.13)');
select has_column('public', 'team_lineups', 'locked_at', 'team_lineups.locked_at exists (§12.13)');
select has_column('public', 'team_lineups', 'edited_by_commish', 'team_lineups.edited_by_commish exists (§12.13)');
select col_not_null('public', 'team_lineups', 'edited_by_commish',
  'edited_by_commish is NOT NULL (R43-class: a two-valued flag, the D302(2) shape)');
select col_default_is('public', 'team_lineups', 'edited_by_commish', 'false', 'edited_by_commish DEFAULT FALSE');
select policies_are('public', 'team_lineups', array['Lineups viewable by league members'],
  'team_lineups: exactly ONE policy — the member-truth SELECT; 001''s world-readable SELECT and owner-keyed FOR ALL are GONE (F18/C12)');
select policy_cmd_is('public', 'team_lineups', 'Lineups viewable by league members', 'SELECT',
  'the one policy is SELECT — no client write policy for any role (writes via set_lineup only)');

select has_table('public', 'lineup_actions', 'lineup_actions exists (the 111 ledger shape)');
select columns_are('public', 'lineup_actions',
  array['id', 'league_id', 'team_id', 'action_id', 'actor_id', 'result', 'created_at'],
  'lineup_actions: exactly the ledger columns (no reason, no before/after — commissioner_actions is M6''s)');
select ok(
  exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid
          where r.relname = 'lineup_actions' and c.contype = 'u'
            and (select array_agg(a.attname::text order by a.attnum)
                 from unnest(c.conkey) k join pg_attribute a on a.attrelid = r.oid and a.attnum = k)
                = array['league_id', 'action_id']),
  'UNIQUE (league_id, action_id) — the replay race backstop');
select is((select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'lineup_actions'), true,
  'RLS enabled on lineup_actions');
select policies_are('public', 'lineup_actions', array[]::text[],
  'lineup_actions: ZERO policies — the DEFINER RPC is its only reader and writer (the 109/111 shape)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('team_league_id', 'lineup_designation_internal', 'lineup_current_week_internal',
                       'lineup_kickoff_internal', 'lineup_fit_internal', 'set_lineup_internal', 'set_lineup')),
  7, 'the seven 112 functions exist');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup', 'set_lineup_internal')),
  2, 'R747: exactly ONE overload each of set_lineup / set_lineup_internal — the pre-fix-round shapes are DROPPED, not kept beside the new ones');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_lineup'),
  'set_lineup is SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('lineup_designation_internal', 'lineup_current_week_internal',
                       'lineup_kickoff_internal', 'lineup_fit_internal', 'set_lineup_internal')),
  'the five helpers are PLAIN with search_path='''' — reachable only through the DEFINER verb (or as postgres)');
select ok(
  not has_function_privilege('anon', 'public.set_lineup(uuid,uuid,integer,jsonb,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_lineup(uuid,uuid,integer,jsonb,uuid,text)', 'EXECUTE'),
  'set_lineup: anon holds no EXECUTE (REVOKE FROM PUBLIC, anon); authenticated may call — the manager check is IN-BODY');
select ok(
  not has_function_privilege('authenticated', 'public.set_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_fit_internal(jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_kickoff_internal(integer,integer,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_current_week_internal(uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.lineup_designation_internal(text)', 'EXECUTE'),
  'the five helpers are triple-REVOKEd — no client can supply the instant (rule 10: the seam is postgres-only)');
select ok(
  has_function_privilege('anon', 'public.team_league_id(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.team_league_id(uuid)', 'EXECUTE')
  and (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'team_league_id'),
  'team_league_id is a DEFINER policy predicate executable by the policy roles (the 052:27–29 documented deviation)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('team_league_id', 'lineup_current_week_internal', 'lineup_kickoff_internal',
                       'lineup_fit_internal', 'set_lineup_internal', 'set_lineup')
     and p.prosrc like '%team_managers%'),
  0, 'F35 re-affirmed: NO 112 function body names team_managers — access derives from league_members, never a stint');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — before any JWT claims)
--    u1 commish L1 (T1, empty roster) · u2 manager L1 (T2, the roster) ·
--    u3 GHOST: owns teams row T3 in L1 and a STANDALONE team T0, NOT a member
--    · u4 outsider · u5 member of L1 with NO teams row · u6 commish L2 (S1).
--    L1: per_player_kickoff, allow_illegal TRUE, two flexes + superflex + two
--    IR spots. L2: per_player_kickoff (the only mode since 114; it was the
--    `first_game_of_week` league), allow_illegal FALSE. L3: scheduled.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('93000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-lu' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'lu_user' || i)::jsonb, now(), now()
from generate_series(1, 6) i;

-- The calendar, RELATIVE to now(): current week 3 (starts_at ≤ now), week 4
-- in 6 days. first_kickoff_at NULL: the starts_at arm unless a game is placed.
update nfl_weeks w
set starts_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day',
    first_kickoff_at = null, last_game_ends_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, settings, roster_settings) values
 ('b3000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'pgtap-lu-L1', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"allow_illegal_lineups": true}',
  '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 2},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 2},
      {"key": "te", "label": "TE", "eligible": ["TE"], "count": 1},
      {"key": "flex1", "label": "W/R/T", "eligible": ["WR", "RB", "TE"], "count": 1},
      {"key": "flex2", "label": "W/T", "eligible": ["WR", "TE"], "count": 1},
      {"key": "superflex", "label": "SUPERFLEX", "eligible": ["QB", "WR", "RB", "TE"], "count": 1},
      {"key": "k", "label": "K", "eligible": ["K"], "count": 1},
      {"key": "dst", "label": "D/ST", "eligible": ["DST"], "count": 1}],
    "bench": 6,
    "ir_slots": [
      {"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]},
      {"key": "ir2", "type": "restricted", "eligible_designations": ["OUT", "IR", "Doubtful"], "min_weeks": 4}],
    "swap_spots": 0}'),
 ('b3000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000006', 'pgtap-lu-L2', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{"allow_illegal_lineups": false}',   -- 114: the only legal value (CHECK)
  '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1},
      {"key": "flex", "label": "W/R/T", "eligible": ["WR", "RB", "TE"], "count": 1}],
    "bench": 3, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}'),
 ('b3000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000001', 'pgtap-lu-L3', 2026, 'scheduled', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', '{}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id) values
 ('c3000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'LU T1', 'b3000000-0000-4000-8000-000000000001'),
 ('c3000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', 'LU T2', 'b3000000-0000-4000-8000-000000000001'),
 ('c3000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000003', 'LU T3 (ghost-owned)', 'b3000000-0000-4000-8000-000000000001'),
 ('c3000000-0000-4000-8000-000000000000', '93000000-0000-4000-8000-000000000003', 'LU T0 (standalone, legacy)', null),
 ('c3000000-0000-4000-8000-000000000011', '93000000-0000-4000-8000-000000000006', 'LU S1', 'b3000000-0000-4000-8000-000000000002'),
 ('c3000000-0000-4000-8000-000000000021', '93000000-0000-4000-8000-000000000001', 'LU X1', 'b3000000-0000-4000-8000-000000000003');
-- u3 (T3's / T0's owner) is deliberately NOT here — the C12 ghost.
insert into league_members (league_id, user_id, team_id, role) values
 ('b3000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 'commissioner'),
 ('b3000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000002', 'manager'),
 ('b3000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000005', null, 'manager'),
 ('b3000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000006', 'c3000000-0000-4000-8000-000000000011', 'commissioner'),
 ('b3000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000021', 'commissioner');
insert into league_weeks (league_id, season, week)
select 'b3000000-0000-4000-8000-000000000001', 2026, g from generate_series(1, 8) g;
insert into league_weeks (league_id, season, week)
select 'b3000000-0000-4000-8000-000000000002', 2026, g from generate_series(1, 8) g;

insert into players (id, full_name, position, team, status) values
 ('lu-qb1',  'LU QB1',  'QB',  'KC',  'Active'),
 ('lu-qb2',  'LU QB2',  'QB',  'DAL', 'Active'),
 ('lu-rb1',  'LU RB1',  'RB',  'DAL', 'Active'),
 ('lu-rb2',  'LU RB2',  'RB',  'PHI', 'Active'),
 ('lu-rb3',  'LU RB3',  'RB',  'KC',  'Active'),
 ('lu-rb4',  'LU RB4',  'RB',  'NYG', 'Active'),
 ('lu-wr1',  'LU WR1',  'WR',  'DAL', 'Active'),
 ('lu-wr2',  'LU WR2',  'WR',  'PHI', 'Active'),
 ('lu-wr3',  'LU WR3',  'WR',  'NYG', 'Active'),
 ('lu-wr4',  'LU WR4',  'WR',  'MIA', 'Active'),     -- MIA has no week-3 game: BYE
 ('lu-wr5',  'LU WR5',  'WR',  'KC',  'Active'),     -- KC bench: the F8 IR-lock fixture
 ('lu-te1',  'LU TE1',  'TE',  'DAL', 'Active'),
 ('lu-te2',  'LU TE2',  'TE',  'SF',  'Active'),
 ('lu-k1',   'LU K1',   'K',   'DAL', 'Active'),
 ('lu-dst1', 'LU DST1', 'DEF', 'PHI', 'Active'),     -- players.position DEF ⇒ roster DST
 ('lu-out1', 'LU OUT1', 'WR',  'DAL', 'Out'),        -- the feed's spelling → OUT
 ('lu-irp',  'LU IRP',  'RB',  'SF',  'IR'),
 ('lu-ques', 'LU QUES', 'WR',  'NYG', 'Questionable'),
 ('lu-s-qb', 'LU S QB', 'QB',  'DAL', 'Active'),
 ('lu-s-rb', 'LU S RB', 'RB',  'DAL', 'Active'),
 ('lu-s-wr', 'LU S WR', 'WR',  'PHI', 'Active'),
 ('lu-s-bye','LU S BYE','WR',  'MIA', 'Active'),
 ('lu-s-out','LU S OUT','RB',  'DAL', 'Out'),
 ('lu-s-te', 'LU S TE', 'TE',  'NYG', 'Active'),     -- kicks off in 3h: the unlocked flex candidate (§I2)
 ('lu-s-ir', 'LU S IR', 'RB',  'KC',  'IR');          -- KC: his OWN kickoff binds the R736 IR cells (114: a bye player is never locked)
insert into league_rosters (league_id, team_id, player_id)
select 'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', id
from players where id like 'lu-%' and id not like 'lu-s-%';
insert into league_rosters (league_id, team_id, player_id)
select 'b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', id
from players where id like 'lu-s-%';

-- Week 3 games: KC kicked off ONE SECOND AGO (kickoff+1s), DAL/PHI kick off
-- in one second (kickoff−1s), NYG/SF in three hours. MIA: bye.
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('lu-w3-a', 2026, 3, 'KC',  'BUF', now() - interval '1 second'),
 ('lu-w3-b', 2026, 3, 'DAL', 'PHI', now() + interval '1 second'),
 ('lu-w3-c', 2026, 3, 'NYG', 'SF',  now() + interval '3 hours');

-- Legacy/seed lineup rows (postgres): T1 wk1, T2 wk1 in L1; T0's standalone
-- legacy row (001's shape — no slot_map).
insert into team_lineups (team_id, season, week, starters, bench) values
 ('c3000000-0000-4000-8000-000000000001', 2026, 1, '[]', '[]'),
 ('c3000000-0000-4000-8000-000000000002', 2026, 1, '[]', '[]'),
 ('c3000000-0000-4000-8000-000000000000', 2025, 9, '["legacy-p1"]', '["legacy-p2"]');

select is(public.lineup_current_week_internal('b3000000-0000-4000-8000-000000000001', now()), 3,
  'the current week is 3 by the nfl_weeks.starts_at boundary (week 3 started yesterday, week 4 starts in 6 days)');
select is(public.lineup_current_week_internal('b3000000-0000-4000-8000-000000000001', now() - interval '8 weeks'), 1,
  '…and before the season it clamps to the league''s first week');

-- The slot_map CHECK (is-object), one unit either side.
select throws_ok(
  $$ update team_lineups set slot_map = '[]'::jsonb where team_id = 'c3000000-0000-4000-8000-000000000001' and week = 1 $$,
  '23514', null, 'slot_map CHECK: a JSON array is refused (23514)');
select lives_ok(
  $$ update team_lineups set slot_map = '{}'::jsonb where team_id = 'c3000000-0000-4000-8000-000000000001' and week = 1 $$,
  'slot_map CHECK: an object lives');

-- ---------------------------------------------------------------------------
-- C. THE F18 SWAP, both directions (+ the legacy orphan)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from team_lineups), 3, 'postgres sees the 3 seeded lineup rows (the SELECT-sees-N premise)');

-- Direction 1: a member with NO teams row reads every L1 lineup.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is((select count(*)::int from team_lineups), 2,
  'DIRECTION 1: a league member with NO teams row reads both L1 lineups (membership truth, not teams ownership)');
select is((select count(*)::int from lineup_actions), 0, 'the ledger is invisible to a member (RLS, zero policies)');

-- Direction 2: the C12 ghost — owns T3 (and T0) but is not a member.
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is((select count(*)::int from team_lineups), 0,
  'DIRECTION 2 (the C12 ghost): a teams-row owner with NO membership reads NO lineup — 001''s world-readable SELECT granted this');
select is((select count(*)::int from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000000'), 0,
  'THE LEGACY ORPHAN: the standalone team''s owner reads 0 of its own legacy lineup rows (postgres sees 1) — 112 §2''s disposition');
select throws_ok(
  $$ insert into team_lineups (team_id, season, week, starters, bench)
     values ('c3000000-0000-4000-8000-000000000003', 2026, 1, '[]', '[]') $$,
  '42501', null,
  'DIRECTION 2 (write): the teams-row owner cannot INSERT a lineup for the team he owns — 001''s owner FOR ALL granted this');
select results_eq(
  $$ with w as (update team_lineups set total_points = 1 where team_id = 'c3000000-0000-4000-8000-000000000000' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$,
  'the standalone owner''s UPDATE of the legacy row touches 0 rows (RETURNING count)');

-- The outsider and anon read nothing.
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is((select count(*)::int from team_lineups), 0, 'an outsider reads 0 lineups');
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from team_lineups), 0, 'anon reads 0 lineups');
reset role;

-- The manager who OWNS T2 (the 001 FOR ALL would have let him write): reads, never writes.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select count(*)::int from team_lineups), 2, 'the manager (T2''s owner) reads both L1 lineups (SELECT-sees-N before the write pins)');
select throws_ok(
  $$ insert into team_lineups (team_id, season, week, starters, bench)
     values ('c3000000-0000-4000-8000-000000000002', 2026, 2, '[]', '[]') $$,
  '42501', null, 'the manager cannot INSERT his own lineup row directly (writes via set_lineup only)');
select results_eq(
  $$ with w as (update team_lineups set total_points = 1 where team_id = 'c3000000-0000-4000-8000-000000000002' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$,
  'the manager''s direct UPDATE touches 0 rows');
select results_eq(
  $$ with w as (delete from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$,
  'the manager''s direct DELETE touches 0 rows');
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update team_lineups set total_points = 1 returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$,
  'the commissioner''s direct UPDATE touches 0 rows — no client write policy for ANY role');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from team_lineups where total_points = 1), 0, '…and postgres confirms nothing was written');

-- ---------------------------------------------------------------------------
-- D. E16 — the pure matcher (`lineup_fit_internal`), goldens as literals
-- ---------------------------------------------------------------------------
select is(
  public.lineup_fit_internal(
    '[{"key": "rb:0", "eligible": ["RB"]}, {"key": "rb:1", "eligible": ["RB"]},
      {"key": "flex1:0", "eligible": ["WR", "RB", "TE"]}, {"key": "flex2:0", "eligible": ["WR", "TE"]}]',
    '[{"player_id": "rb_a", "position": "RB", "wanted": "rb:0"}, {"player_id": "rb_b", "position": "RB", "wanted": "rb:1"},
      {"player_id": "wr_x", "position": "WR", "wanted": "flex1:0"}, {"player_id": "rb_c", "position": "RB", "wanted": "flex2:0"}]'),
  '{"assignment": {"rb:0": "rb_a", "rb:1": "rb_b", "flex1:0": "rb_c", "flex2:0": "wr_x"},
    "unplaced": [], "rearranged": true,
    "moved": [{"player_id": "wr_x", "from": "flex1:0", "to": "flex2:0"}, {"player_id": "rb_c", "from": "flex2:0", "to": "flex1:0"}]}'::jsonb,
  'E16 THE TWO-FLEX TRAP: an RB wanted at W/T beside a WR at W/R/T, both RB slots full — the augmenting path re-seats WR → W/T and RB → W/R/T (greedy first-eligible reports the RB unplaceable — the DoD break probe)');
select is(
  public.lineup_fit_internal(
    '[{"key": "rb:0", "eligible": ["RB"]}, {"key": "rb:1", "eligible": ["RB"]},
      {"key": "flex1:0", "eligible": ["WR", "RB", "TE"]}, {"key": "flex2:0", "eligible": ["WR", "TE"]}]',
    '[{"player_id": "rb_a", "position": "RB", "wanted": "rb:0"}, {"player_id": "rb_b", "position": "RB", "wanted": "rb:1"},
      {"player_id": "rb_c", "position": "RB", "wanted": "flex1:0"}, {"player_id": "wr_x", "position": "WR", "wanted": "flex2:0"}]'),
  '{"assignment": {"rb:0": "rb_a", "rb:1": "rb_b", "flex1:0": "rb_c", "flex2:0": "wr_x"},
    "unplaced": [], "rearranged": false, "moved": []}'::jsonb,
  '…its SATISFIABLE TWIN (the same four players placed validly) is the identity — a valid placement is honored verbatim');
select is(
  public.lineup_fit_internal(
    '[{"key": "flex1:0", "eligible": ["WR", "RB", "TE"]}, {"key": "flex2:0", "eligible": ["WR", "TE"]}]',
    '[{"player_id": "wr_only", "position": "WR", "wanted": "flex1:0"}]') -> 'assignment',
  '{"flex1:0": "wr_only"}'::jsonb,
  'E16''s own sentence: a lone WR fills exactly ONE of W/T and W/R/T — the other stays empty');
select is(
  public.lineup_fit_internal(
    '[{"key": "flex1:0", "eligible": ["WR", "RB", "TE"]}, {"key": "flex2:0", "eligible": ["WR", "TE"]}]',
    '[{"player_id": "wr_a", "position": "WR", "wanted": "flex1:0"}, {"player_id": "wr_b", "position": "WR", "wanted": "flex1:0"}]') -> 'assignment',
  '{"flex1:0": "wr_a", "flex2:0": "wr_b"}'::jsonb,
  '…two WRs both wanting W/R/T: the second is re-seated into W/T (no slot double-booked, no player in two slots)');
select is(
  public.lineup_fit_internal(
    '[{"key": "flex2:0", "eligible": ["WR", "TE"]}, {"key": "wr:0", "eligible": ["WR"]}]',
    '[{"player_id": "te_a", "position": "TE", "wanted": "flex2:0"}, {"player_id": "te_b", "position": "TE", "wanted": "wr:0"}]'),
  '{"assignment": {"flex2:0": "te_a"}, "unplaced": ["te_b"], "rearranged": false, "moved": []}'::jsonb,
  'UNFILLABLE: two TEs over W/T + WR — te_b is unplaced (no arrangement exists); the RPC names the slot');
select is(
  public.lineup_fit_internal(
    '[{"key": "qb:0", "eligible": ["QB"]}, {"key": "superflex:0", "eligible": ["QB", "WR", "RB", "TE"]}]',
    '[{"player_id": "qb_a", "position": "QB", "wanted": "qb:0"}, {"player_id": "qb_b", "position": "QB", "wanted": "qb:0"}]') -> 'assignment',
  '{"qb:0": "qb_a", "superflex:0": "qb_b"}'::jsonb,
  'SUPERFLEX config: two QBs both wanting QB — the second takes SUPERFLEX');
select is(
  public.lineup_fit_internal(
    '[{"key": "qb:0", "eligible": ["QB"]}, {"key": "superflex:0", "eligible": ["QB", "WR", "RB", "TE"]}]',
    '[{"player_id": "qb_locked", "position": "QB", "wanted": "superflex:0", "fixed": true},
      {"player_id": "rb_new", "position": "RB", "wanted": "qb:0"}]'),
  '{"assignment": {"superflex:0": "qb_locked"}, "unplaced": ["rb_new"], "rearranged": false, "moved": []}'::jsonb,
  'A FIXED (locked) vertex is never routed through: the RB cannot displace the locked QB from SUPERFLEX even though the QB could move to QB — rb_new is unplaced');
select is(
  public.lineup_fit_internal(
    '[{"key": "qb:0", "eligible": ["QB"]}, {"key": "superflex:0", "eligible": ["QB", "WR", "RB", "TE"]}]',
    '[{"player_id": "qb_free", "position": "QB", "wanted": "superflex:0"},
      {"player_id": "rb_new", "position": "RB", "wanted": "qb:0"}]') -> 'assignment',
  '{"qb:0": "qb_free", "superflex:0": "rb_new"}'::jsonb,
  '…and the same shape UNLOCKED re-seats the QB to QB and the RB into SUPERFLEX (the fixed flag is what changed)');
select is(
  public.lineup_fit_internal(
    '[{"key": "te:0", "eligible": ["TE"]}, {"key": "wr:1", "eligible": ["WR"]}]',
    '[{"player_id": "te_locked_relisted", "position": "WR", "wanted": "te:0", "fixed": true}]'),
  '{"assignment": {"te:0": "te_locked_relisted"}, "unplaced": [], "rearranged": false, "moved": []}'::jsonb,
  'R737: a FIXED (locked) player whose listed position no longer fits his slot (TE → WR mid-week) STAYS PUT — a locked placement is a fact, not a candidate; he is not re-seated into wr:1');

-- ---------------------------------------------------------------------------
-- E. set_lineup on L1 (per_player_kickoff, allow_illegal TRUE) — as u2 at
--    injected instants through the seam (postgres + JWT claim)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

create function pg_temp.lu_digest() returns text language sql as $$
  select md5(
    coalesce((select string_agg(t::text, ',' order by t.id) from public.team_lineups t), '') || '|' ||
    coalesce((select string_agg(r::text, ',' order by r.id) from public.league_rosters r), ''))
$$;

-- E1. The two-flex trap THROUGH THE RPC: rb1 (RB) wanted at flex2 (W/T), wr1
--     at flex1, both RB slots full (rb2, rb4) and SUPERFLEX held by te2 — the
--     only route is the augmenting path. Canonical map pinned.
select set_config('pgtap.lu_r1', public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-wr1", "flex2:0": "lu-rb1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000001', now())::text, true);
select is(
  (select slot_map from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3),
  '{"qb:0": "lu-qb2", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}'::jsonb,
  'E1 THE TRAP THROUGH THE RPC: the stored canonical slot_map re-seats RB1 → W/R/T and WR1 → W/T (stored literal; greedy would have refused RB1)');
select is((current_setting('pgtap.lu_r1')::jsonb ->> 'rearranged')::boolean, true, 'E1 the result says rearranged = true');
select is(current_setting('pgtap.lu_r1')::jsonb -> 'moved',
  '[{"player_id": "lu-wr1", "from": "flex1:0", "to": "flex2:0"}, {"player_id": "lu-rb1", "from": "flex2:0", "to": "flex1:0"}]'::jsonb,
  'E1 the two moves are named');
select is(current_setting('pgtap.lu_r1')::jsonb -> 'flags',
  '{"illegal": true, "bye": ["lu-wr4"], "out": [], "empty": [], "ir_ineligible": []}'::jsonb,
  'E1 flags: WR4 (MIA, no week-3 game) is BYE and the lineup is flagged illegal (allow_illegal TRUE accepts it); no empty slot');
select is(
  (select locked_at from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3),
  now() + interval '1 second',
  'E1 locked_at RECORDS the earliest starter kickoff (DAL/PHI at now+1s) — the record of the evaluation, not the decider');
select is(
  (select edited_by_commish from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3),
  false, 'E1 the manager''s own set records edited_by_commish = FALSE');
select results_eq(
  $$ select player_id, slot_key, ir_placed_week, ir_lock_until_week
     from league_rosters where team_id = 'c3000000-0000-4000-8000-000000000002' order by player_id $$,
  $$ values ('lu-dst1', 'dst:0', null::int, null::int), ('lu-irp', 'ir1:0', 3, null), ('lu-k1', 'k:0', null, null),
            ('lu-out1', 'bn', null, null), ('lu-qb1', 'bn', null, null), ('lu-qb2', 'qb:0', null, null),
            ('lu-ques', 'bn', null, null), ('lu-rb1', 'flex1:0', null, null), ('lu-rb2', 'rb:0', null, null),
            ('lu-rb3', 'bn', null, null), ('lu-rb4', 'rb:1', null, null), ('lu-te1', 'te:0', null, null),
            ('lu-te2', 'superflex:0', null, null), ('lu-wr1', 'flex2:0', null, null), ('lu-wr2', 'bn', null, null),
            ('lu-wr3', 'wr:0', null, null), ('lu-wr4', 'wr:1', null, null), ('lu-wr5', 'bn', null, null) $$,
  'E1 league_rosters.slot_key maintained for the CURRENT week: starters carry their instance key, the rest bn, IRP on ir1:0 with ir_placed_week 3 (unrestricted: no lock week)');
select is((select count(*)::int from lineup_actions where league_id = 'b3000000-0000-4000-8000-000000000001'), 1,
  'E1 one ledger row');
select is((select count(*)::int from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3), 1,
  'E1 the week-3 row was created on first touch (loud emptiness: created, then locked, then written)');

-- E2. REPLAY: same action_id, a DIFFERENT map → the stored result, byte-identical; nothing written.
select set_config('pgtap.lu_d1', pg_temp.lu_digest(), true);
select is(
  public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2"}',
       'a3000000-0000-4000-8000-000000000001', now())::text,
  current_setting('pgtap.lu_r1'),
  'E2 REPLAY (same action_id, different map) returns the stored result byte-identically (text equality)');
select is(pg_temp.lu_digest(), current_setting('pgtap.lu_d1'), 'E2 the replay wrote nothing (lineups + rosters digest unchanged)');
select is((select count(*)::int from lineup_actions), 1, 'E2 no second ledger row');

-- E3. NO-OP BY NAME: the same canonical map under a NEW action_id.
select set_config('pgtap.lu_r3', public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000003', now())::text, true);
select is((current_setting('pgtap.lu_r3')::jsonb ->> 'no_changes')::boolean, true,
  'E3 an identical submit is no_changes = true BY NAME (rule 10 — never a silent success)');
select is(pg_temp.lu_digest(), current_setting('pgtap.lu_d1'), 'E3 …and wrote nothing to lineups or rosters');
select is((select count(*)::int from lineup_actions), 2, 'E3 …but IS ledgered (its own retry replays)');

-- E4. A PLAYED player cannot enter a slot (QB1 — KC kicked off at now−1s)
--     replacing QB2 (DAL, one second ahead) at qb:0.
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000004', now()) $$,
  '%LU QB1''s game kicked off at % (nfl_games) — a player whose game has started cannot enter or move slots%',
  'E4 kickoff+1s: a played player cannot ENTER a slot — refused naming the player, the instant and the datum arm');
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000004', now() - interval '1 second') $$,
  '%LU QB1''s game kicked off at % (nfl_games) — a player whose game has started cannot enter or move slots%',
  'E4 AT the kickoff (evaluated at now−1s = the kickoff instant exactly): still locked — closed on the kickoff side');
select lives_ok(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000005', now() - interval '2 seconds') $$,
  'E4 kickoff−1s (evaluated at now−2s, one second before the kickoff): QB1 ENTERS qb:0 — the one-unit positive');
select is((select slot_map ->> 'qb:0' from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3),
  'lu-qb1', 'E4 …and is stored at qb:0');

-- E5. A LOCKED SLOT'S PLAYER NEVER MOVES — QB1 sits at qb:0 and his game has
--     kicked off (now−1s). Replace / move / bench all refuse; an UNLOCKED
--     slot of the same lineup still edits.
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000006', now()) $$,
  '%slot qb:0 is locked — LU QB1 kicked off at % and a locked slot''s player never moves%',
  'E5 REPLACE the locked slot''s player (QB2 back in) → refused naming the slot, the player and the kickoff');
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-qb1", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000006', now()) $$,
  '%slot qb:0 is locked — LU QB1 kicked off at %',
  'E5 MOVE the locked player to another slot (QB1 → SUPERFLEX, QB2 → QB) → refused');
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000006', now()) $$,
  '%slot qb:0 is locked — LU QB1 kicked off at %',
  'E5 BENCH the locked player (omit him from the map) → refused');
select lives_ok(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000007', now()) $$,
  'E5 an UNLOCKED slot of the same lineup still edits (wr:0 WR3 → WR2) while the locked slot stays');
select is((select (slot_map ->> 'wr:0') || '|' || (slot_map ->> 'qb:0') from team_lineups
           where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3),
  'lu-wr2|lu-qb1', 'E5 …stored: wr:0 = WR2, qb:0 = QB1 unchanged');
-- R737 through the RPC: QB1 (locked at qb:0) is relisted QB → WR; an
-- identical resubmit is no_changes and the stored map is byte-unchanged.
update players set position = 'WR' where id = 'lu-qb1';
select set_config('pgtap.lu_map_before', (select slot_map::text from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3), true);
select is((public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       current_setting('pgtap.lu_map_before')::jsonb,
       'a3000000-0000-4000-8000-000000000028', now()) ->> 'no_changes')::boolean, true,
  'R737 through the RPC: the locked QB1 relisted as WR — an identical resubmit is no_changes (he is not re-seated)');
select is((select slot_map::text from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3),
  current_setting('pgtap.lu_map_before'), 'R737 …and the stored map is byte-unchanged');
update players set position = 'QB' where id = 'lu-qb1';

-- E6. E42 — the kickoff MOVED BACK to the future re-opens the slot (the lock
--     is evaluated from nfl_games at call time, never from locked_at): with
--     KC flexed to now+1h, RB3 (also KC) ENTERS superflex (TE2 out).
update nfl_games set kickoff_at = now() + interval '1 hour' where id = 'lu-w3-a';
select lives_ok(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000009', now()) $$,
  'E6 E42: KC''s kickoff flexed to now+1h — RB3 (KC) enters SUPERFLEX though locked_at said the week had locked; QB1 (KC) stays');
select is((select slot_map ->> 'superflex:0' from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3),
  'lu-rb3', 'E6 …RB3 stored at superflex:0');
update nfl_games set kickoff_at = now() where id = 'lu-w3-a';
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-te2", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000010', now()) $$,
  '%slot superflex:0 is locked — LU RB3 kicked off at %',
  'E6 the kickoff moved to EXACTLY now (AT): the slot is locked again (TE2 cannot replace RB3)');
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'lu-w3-a';   -- restore kickoff+1s

-- E7. ILLEGAL under TRUE: OUT1 (feed status `Out`) started at flex2 → accepted, flagged.
select set_config('pgtap.lu_r7', public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-out1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000011', now())::text, true);
select is(current_setting('pgtap.lu_r7')::jsonb -> 'flags',
  '{"illegal": true, "bye": ["lu-wr4"], "out": ["lu-out1"], "empty": [], "ir_ineligible": []}'::jsonb,
  'E7 allow_illegal_lineups TRUE: an OUT starter (feed `Out` → OUT) and a bye starter are ACCEPTED and flagged (§7.3.6)');
select is(
  (select s -> 'flags' from team_lineups t, jsonb_array_elements(t.starters) s
   where t.team_id = 'c3000000-0000-4000-8000-000000000002' and t.week = 3 and s ->> 'slot' = 'flex2:0'),
  '["out"]'::jsonb, 'E7 …the flag is stored on starters[].flags');

-- E8. The unfillable slot, refused BY NAME through the RPC: TE2 wanted at
--     k:0 (K-only; K1 benched) while every TE-eligible slot is held by a
--     player with nowhere else to go (both RB slots and both WR slots full,
--     SUPERFLEX locked on RB3) — no augmenting path exists.
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-out1", "wr:0": "lu-wr2", "wr:1": "lu-wr3", "te:0": "lu-te1", "k:0": "lu-te2", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000012', now()) $$,
  '%LU TE2 (TE) cannot be placed — no legal arrangement of the started players fills the slots (E16): \"k:0\" accepts K%',
  'E8 E16 UNFILLABLE through the RPC: the refusal names the player, the slot he wanted and what it accepts');

-- ---------------------------------------------------------------------------
-- F. IR law (§11.2 / §7.3.2) on L1 — current week 3
-- ---------------------------------------------------------------------------
-- F1. Questionable is NOT a designation ir2 accepts.
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-out1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-irp", "ir2:0": "lu-ques"}',
       'a3000000-0000-4000-8000-000000000013', now()) $$,
  '%LU QUES holds designation none — IR spot ir2 accepts only OUT, IR, Doubtful%',
  'F1 the designation gate: Questionable (no §7.3.2 designation) cannot enter the DL-style spot — refused by name');
-- F2. IR + starter in one map: exactly one slot.
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-irp", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-out1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000013', now()) $$,
  '%LU IRP (lu-irp) appears at both \"%\" and \"%\" — each player fills exactly one slot (E16)%',
  'F2 an IR''d player cannot also start — \"each player fills exactly one slot\"');
-- F3. OUT1 (feed `Out`) into ir1 through the vocabulary bridge; IRP moved to
--     the RESTRICTED spot ir2: ir_lock_until_week = 3 + 4 = 7.
select set_config('pgtap.lu_rf3', public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-out1", "ir2:0": "lu-irp"}',
       'a3000000-0000-4000-8000-000000000014', now())::text, true);
select results_eq(
  $$ select player_id, slot_key, ir_placed_week, ir_lock_until_week from league_rosters
     where team_id = 'c3000000-0000-4000-8000-000000000002' and player_id in ('lu-out1', 'lu-irp') order by 1 $$,
  $$ values ('lu-irp', 'ir2:0', 3, 7), ('lu-out1', 'ir1:0', 3, null::int) $$,
  'F3 OUT1 (feed `Out` → OUT, the bridge) placed on unrestricted ir1 (no lock week); IRP moved to RESTRICTED ir2: ir_lock_until_week = 3 + min_weeks 4 = 7 (stored literal)');
select is(current_setting('pgtap.lu_rf3')::jsonb -> 'ir_moves',
  '{"placed": [{"player_id": "lu-out1", "spot": "ir1:0", "type": "unrestricted", "ir_placed_week": 3, "ir_lock_until_week": null},
               {"player_id": "lu-irp", "spot": "ir2:0", "type": "restricted", "ir_placed_week": 3, "ir_lock_until_week": 7}],
    "removed": []}'::jsonb,
  'F3 the result names both placements (the spot change is a placement on ir2 — the player never left IR, so no removal)');
select is(public.lineup_designation_internal('Sus'), 'Suspended', 'the bridge: the feed''s `Sus` is the catalog''s Suspended');
select is(public.lineup_designation_internal('Questionable'), null, 'the bridge: Questionable is no designation');
-- F4. Early removal from the restricted spot at current week 3 → refused by name.
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-out1"}',
       'a3000000-0000-4000-8000-000000000015', now()) $$,
  '%LU IRP entered restricted IR spot ir2:0 in week 3 and may not leave it before week 7 (min_weeks stint%the current week is 3%',
  'F4 restricted stint: removal at week 3 refused by name (placed 3, lock 7)');
-- F5. The tenure boundary: current week 6 (lock−1) refuses, 7 (lock+0) accepts.
--     Weeks 6/7 have no game rows: their first_kickoff_at arm is kept AHEAD
--     so lock timing is not what these cells measure — tenure is.
update nfl_weeks w set starts_at = now() + ((w.week - 6) * interval '7 days') - interval '1 day',
                      first_kickoff_at = case when w.week in (6, 7) then now() + interval '1 day' end
where w.season = 2026;
select is(public.lineup_current_week_internal('b3000000-0000-4000-8000-000000000001', now()), 6, 'F5 the calendar moved: current week 6');
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 6,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-out1"}',
       'a3000000-0000-4000-8000-000000000016', now()) $$,
  '%LU IRP entered restricted IR spot ir2:0 in week 3 and may not leave it before week 7%the current week is 6%',
  'F5 ir_lock_until_week − 1 (current week 6): removal still refused');
update nfl_weeks w set starts_at = now() + ((w.week - 7) * interval '7 days') - interval '1 day' where w.season = 2026;
select is(public.lineup_current_week_internal('b3000000-0000-4000-8000-000000000001', now()), 7, 'F5 the calendar moved: current week 7');
select lives_ok(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 7,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr2", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-out1"}',
       'a3000000-0000-4000-8000-000000000017', now()) $$,
  'F5 ir_lock_until_week + 0 (current week 7): the removal SUCCEEDS — the one-unit positive');
select results_eq(
  $$ select slot_key, ir_placed_week, ir_lock_until_week from league_rosters where player_id = 'lu-irp' $$,
  $$ values ('bn', null::int, null::int) $$,
  'F5 …IRP is back on the bench with the IR columns cleared');
update nfl_weeks w set starts_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day', first_kickoff_at = null
where w.season = 2026;   -- restore: current week 3
-- F6. An IR'd player who turns Active is KEPT and flagged ir_ineligible.
update players set status = 'Active' where id = 'lu-out1';
select set_config('pgtap.lu_rf6', public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-out1"}',
       'a3000000-0000-4000-8000-000000000018', now())::text, true);
select is(current_setting('pgtap.lu_rf6')::jsonb -> 'flags' -> 'ir_ineligible', '["lu-out1"]'::jsonb,
  'F6 an IR''d player who lost his designation is KEPT on IR and the roster is flagged ir_ineligible (§7.3.2 Enforcement)');
select is((current_setting('pgtap.lu_rf6')::jsonb -> 'flags' ->> 'illegal')::boolean, true, 'F6 …and illegal = true');
-- F7. Unrestricted removal is free before the player's lock (DAL at now+1s).
select lives_ok(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3"}',
       'a3000000-0000-4000-8000-000000000019', now()) $$,
  'F7 unrestricted IR: OUT1 comes off ir1 freely (his DAL game is one second ahead)');
-- F8. IR moves respect lock timing: WR5 (KC bench, kicked off) marked IR →
--     placing him refuses on the lock; one second before the kickoff it lands.
update players set status = 'IR' where id = 'lu-wr5';
select throws_like(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-wr5"}',
       'a3000000-0000-4000-8000-000000000020', now()) $$,
  '%LU WR5''s lock for week 3 has passed (kickoff %) — IR moves respect lineup-lock timing%',
  'F8 an IR placement of a player whose game kicked off refuses on lock timing (§7.3.2 \"All IR moves respect lineup-lock timing\")');
update nfl_games set kickoff_at = now() + interval '1 second' where id = 'lu-w3-a';
select lives_ok(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "ir1:0": "lu-wr5"}',
       'a3000000-0000-4000-8000-000000000020', now()) $$,
  'F8 …the same placement one second BEFORE his kickoff succeeds (the one-unit positive)');
select results_eq(
  $$ select slot_key, ir_placed_week from league_rosters where player_id = 'lu-wr5' $$,
  $$ values ('ir1:0', 3) $$, 'F8 …WR5 on ir1:0, placed week 3');
select lives_ok(
  $$ select public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr4", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3"}',
       'a3000000-0000-4000-8000-000000000027', now()) $$,
  'F8 …and comes off unrestricted ir1 again while his kickoff is still ahead (the fixture returns WR5 to the bench)');
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'lu-w3-a';   -- restore
update players set status = 'Active' where id = 'lu-wr5';

-- ---------------------------------------------------------------------------
-- G. Loud emptiness + validation, every refusal by name (rule 10)
-- ---------------------------------------------------------------------------
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 9,
       '{"qb:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000021', now()) $$,
  '%week 9 is not on league %''s calendar (season 2026; league_weeks holds weeks 1–8)%',
  'G a week off the league''s calendar refuses by name');
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 2,
       '{"qb:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000021', now()) $$,
  '%week 2 is in the past (the current week is 3) — a past week''s lineup changes only through the audited commissioner override%',
  'G a PAST week refuses by name (the audited override is M6''s)');
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:9": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000021', now()) $$,
  '%"qb:9" is not a slot of league %''s roster (§7.3.2 starting_slots: qb:0, rb:0, rb:1, wr:0, wr:1, te:0, flex1:0, flex2:0, superflex:0, k:0, dst:0; IR spots: ir1:0, ir2:0)%',
  'G an unknown slot key refuses naming every slot the roster has');
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-s-qb"}', 'a3000000-0000-4000-8000-000000000021', now()) $$,
  '%player lu-s-qb is not on team %''s roster in league %',
  'G an unrostered player (another league''s) refuses by name');
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2", "superflex:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000021', now()) $$,
  '%LU QB2 (lu-qb2) appears at both "qb:0" and "superflex:0" — each player fills exactly one slot (E16)%',
  'G a player in two slots refuses by name');
select throws_ok(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '["lu-qb2"]', 'a3000000-0000-4000-8000-000000000021', now()) $$,
  '22023', null, 'G a non-object map is 22023');
select throws_ok(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": 7}', 'a3000000-0000-4000-8000-000000000021', now()) $$,
  '22023', null, 'G a non-string value is 22023');
select throws_ok(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2"}', null, now()) $$,
  '22023', null, 'G a missing action_id is 22023 (idempotency key required)');
-- (u2 is not L1's commissioner, so the team-of-another-league arm is
--  reached as the commissioner in §H; as u2 it is the no-leak 42501:)
select throws_ok(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000011', 3,
       '{"qb:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000021', now()) $$,
  '42501', null, 'G …as u2 (manager of T2 only) a foreign team_id is the no-leak 42501');

-- ---------------------------------------------------------------------------
-- H. Roles through the PUBLIC verb (set_lineup — transaction now())
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000022') $$,
  '42501', 'set_lineup: not a manager of this team', 'H an OUTSIDER is refused with the one no-leak 42501');
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000003', 3,
       '{"qb:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000022') $$,
  '42501', 'set_lineup: not a manager of this team', 'H the C12 GHOST (owns T3''s teams row, no membership) is refused — teams.owner_id decides nothing');
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000022') $$,
  '42501', 'set_lineup: not a manager of this team', 'H a MEMBER who does not manage T2 (no cache team_id) is refused');
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000022') $$,
  '42501', 'set_lineup: not a manager of this team', 'H ANOTHER league''s commissioner is refused');
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000022') $$,
  '42501', null, 'H anon is refused (no EXECUTE)');
reset role;
-- The league's commissioner MAY set T2's lineup (D293): edited_by_commish = TRUE.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- RE-CUT BY MIGRATION 131 (L.E1.15 / F362, Q66 — spec v2.16.41 §10.3 / §15.4):
-- a commissioner setting another team's lineup IS a commissioner action, so
-- the reason is OPTIONAL on this arm too. R738's refusals become
-- normalisations; R746's 500 bound stays. Re-adding 114:317-321's gate reds
-- the first cell BY NAME.
select set_config('pgtap.lu_nr', public.set_lineup(
  'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
  '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr2", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3"}',
  'a3000000-0000-4000-8000-000000000023')::text, true);
select is((current_setting('pgtap.lu_nr')::jsonb ->> 'no_changes') || '|' || (current_setting('pgtap.lu_nr')::jsonb ->> 'edited_by_commish') || '|' || coalesce(current_setting('pgtap.lu_nr')::jsonb ->> 'reason', '<NULL>'),
  'false|true|<NULL>',
  'Q66 (131): the COMMISSIONER without a reason LANDS — a real change, edited_by_commish = TRUE, and the document echoes reason NULL (never '''')');
select is((select string_agg(message, '|') from league_chat where league_id = 'b3000000-0000-4000-8000-000000000001' and is_system),
  'Week 3 lineup for LU T2 set by lu_user1 (commissioner)',
  'Q66 (131): the D97 in-txn system post carries the week, the team and the actor, and NO "— reason:" clause (conditional, never "reason: <NULL>")');
select is((select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr2", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3"}',
       'a3000000-0000-4000-8000-00000000002a', '   ') ->> 'reason'),
  null, 'Q66 (131): a blank reason is normalised to NULL, not refused (an identical map ⇒ no_changes, nothing posted)');
select is((select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr2", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3"}',
       'a3000000-0000-4000-8000-00000000002b', E' \t\n ') ->> 'reason'),
  null, 'R745 under Q66 (131): a tab/newline-only reason is blank too — the explicit class still decides "blank", and blank ⇒ NULL');
select throws_like(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr2", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3"}',
       'a3000000-0000-4000-8000-00000000002c', repeat('x', 501)) $$,
  '%the reason is 501 characters — at most 500%',
  'R746: a 501-character reason is STILL refused by name (the DEFINER post bypasses the 500-char client policy; the bound survives Q66)');
select is((select count(*)::int from league_chat where league_id = 'b3000000-0000-4000-8000-000000000001' and is_system), 1,
  'Q66 (131): exactly ONE post so far — the no-reason landing''s; the two no-ops and the refusal posted nothing');
select set_config('pgtap.lu_rh', public.set_lineup(
  'b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
  '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr2", "wr:0": "lu-wr3", "wr:1": "lu-wr1", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3"}',
  'a3000000-0000-4000-8000-00000000002d', 'manager on vacation')::text, true);
select is((select string_agg(message, '|' order by message) from league_chat where league_id = 'b3000000-0000-4000-8000-000000000001' and is_system),
  'Week 3 lineup for LU T2 set by lu_user1 (commissioner)|Week 3 lineup for LU T2 set by lu_user1 (commissioner) — reason: manager on vacation',
  'R738: WITH a reason (a real change — the two UNLOCKED receivers wr:1/flex2:0 swapped; KC is the only kicked-off team) the D97 in-txn system post carries the week, the team, the actor AND the reason (pinned by content)');
select is(current_setting('pgtap.lu_rh')::jsonb ->> 'reason', 'manager on vacation', 'R738: the result echoes the reason');
select lives_ok(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr2", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3"}',
       'a3000000-0000-4000-8000-000000000029', repeat('x', 500)) $$,
  'R746: exactly 500 characters is accepted (the one-unit positive; this restores the pre-swap map — a real change, so it posts a third system row)');
select is((current_setting('pgtap.lu_rh')::jsonb ->> 'edited_by_commish')::boolean, true,
  'H the COMMISSIONER sets another team''s lineup under the same lock law — edited_by_commish = TRUE in the result');
select is((select edited_by_commish from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 3), true,
  'H …and on the row');
select throws_like(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000011', 3,
       '{"qb:0": "lu-qb2"}', 'a3000000-0000-4000-8000-000000000024') $$,
  '%team % is not a franchise of league %',
  'H as the commissioner, a team of ANOTHER league refuses by name');
select throws_like(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001', 3,
       '{}', 'a3000000-0000-4000-8000-000000000024') $$,
  '%team % has no rostered players in league % — a lineup exists only over a roster (§11.1)%',
  'H an EMPTY roster (T1) refuses by name — never an empty lineup written as success');
select throws_like(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000003', 'c3000000-0000-4000-8000-000000000021', 3,
       '{}', 'a3000000-0000-4000-8000-000000000024') $$,
  '%league % is scheduled — lineups are set only while in_season or in playoffs (§11.2)%',
  'H a league not in season (L3, scheduled) refuses by name');
-- The manager's FUTURE-week set: the row is created, slot_key untouched.
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select count(*)::int from league_chat where league_id = 'b3000000-0000-4000-8000-000000000001' and is_system), 3,
  'R738: the manager''s own sets never post (three system rows in L1 — all the commissioner''s: the no-reason landing, the reasoned swap, the 500-character restore)');
select set_config('pgtap.lu_roster_before', (select string_agg(player_id || ':' || coalesce(slot_key, '-'), ',' order by player_id)
                                            from league_rosters where team_id = 'c3000000-0000-4000-8000-000000000002'), true);
select lives_ok(
  $$ select public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 4,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb3", "rb:1": "lu-rb4", "wr:0": "lu-wr3", "wr:1": "lu-wr2", "te:0": "lu-te2",
         "k:0": "lu-k1", "dst:0": "lu-dst1"}', 'a3000000-0000-4000-8000-000000000025') $$,
  'H a FUTURE week (4) lineup: QB1/RB3 (KC — locked THIS week) start freely, no week-4 game has kicked off');
select is((select string_agg(player_id || ':' || coalesce(slot_key, '-'), ',' order by player_id)
           from league_rosters where team_id = 'c3000000-0000-4000-8000-000000000002'),
  current_setting('pgtap.lu_roster_before'),
  'H …league_rosters.slot_key describes the ACTIVE week and is untouched by a future-week set');
select is((select count(*)::int from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 4), 1,
  'H …the week-4 row exists');
-- Week 4 has NO game rows: the conservative fallback locks EVERY player at
-- the week datum once it passes (nfl_weeks.first_kickoff_at arm, named).
reset role;
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select locked_at from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000002' and week = 4),
  (select starts_at from nfl_weeks where season = 2026 and week = 4),
  'H week 4 (no game rows): locked_at records the starts_at arm — the conservative week datum for every player');
update nfl_weeks set first_kickoff_at = now() - interval '1 second' where season = 2026 and week = 4;
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 4,
       '{"qb:0": "lu-qb2", "rb:0": "lu-rb3", "rb:1": "lu-rb4", "wr:0": "lu-wr3", "wr:1": "lu-wr2", "te:0": "lu-te2",
         "k:0": "lu-k1", "dst:0": "lu-dst1"}', 'a3000000-0000-4000-8000-000000000026', now()) $$,
  '%slot qb:0 is locked — LU QB1 kicked off at % (nfl_weeks.first_kickoff_at)%',
  'H …once the week datum passes (first_kickoff_at = now−1s, no game rows) EVERY slot is locked and the arm is NAMED');
update nfl_weeks set first_kickoff_at = null where season = 2026 and week = 4;

-- ---------------------------------------------------------------------------
-- I. L2 — per_player_kickoff, THE ONLY lineup lock since 114 (Q34(A), Chris
--    2026-09-05) + allow_illegal_lineups FALSE (as u6, own team S1). L2 was
--    the `first_game_of_week` league until 114 retired the mode; it stays the
--    suite's only `allow_illegal_lineups = FALSE` league, so the three I4
--    cells and R739 keep their home here. THE ERRATUM'S PIN: the week's FIRST
--    game (KC, lu-w3-a) kicked off ONE SECOND AGO before every cell below and
--    no S1 starter is on KC — under the retired whole-week mode every write in
--    I1/I2 would have refused ("the whole lineup is locked"); re-introducing
--    that branch (the PR's break probe) reds them. State on entry: lu-w3-a
--    (KC) now−1s, lu-w3-b (DAL/PHI) now+1s, lu-w3-c (NYG/SF) now+3h.
--    Cells with a per-player twin in §E were DELETED, not re-cut (I2's
--    bench-refusal → E5 BENCH; I3's identical-submit → E3 / R737-RPC; R744's
--    RB relist + byte-unchanged twin → R737-RPC).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select set_config('pgtap.lu_i1', public.set_lineup_internal(
       'b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 3,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr"}', 'a3000000-0000-4000-8000-000000000031', now())::text, true);
select is((select slot_map from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000011' and week = 3),
  '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr"}'::jsonb,
  'I1 Q34(A)/114: the week''s FIRST game (KC) kicked off one second ago and the lineup is SET — no whole-week lock exists; a slot locks only at its own player''s kickoff');
select is((select locked_at from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000011' and week = 3),
  now() + interval '1 second',
  'I1 locked_at records the earliest STARTED player''s kickoff (DAL/PHI at now+1s) — NOT the week''s first kickoff (KC at now−1s), which decides nothing');
select is((current_setting('pgtap.lu_i1')::jsonb -> 'week_datum' ->> 'kicked_off')::boolean, true,
  'I1 …the result still reports the week datum as kicked off (informational: it is returned, it is not a lock)');
select is(current_setting('pgtap.lu_i1')::jsonb ->> 'lineup_lock', 'per_player_kickoff',
  'I1 …and echoes the only lineup lock');
-- I2. AT the starters' OWN kickoff (DAL/PHI moved to now): the three locked
--     slots stay and an UNLOCKED slot of the same lineup still edits — the TE
--     (NYG, kicks off in three hours) enters flex:0.
update nfl_games set kickoff_at = now() where id = 'lu-w3-b';
select lives_ok(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 3,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr", "flex:0": "lu-s-te"}', 'a3000000-0000-4000-8000-000000000032', now()) $$,
  'I2 AT the starters'' own kickoff: an edit of an UNLOCKED slot (the NYG TE into flex:0) SUCCEEDS while the three locked starters stay put — every unlocked slot stays editable (§11.2 v2.16.20)');
select is((select slot_map ->> 'flex:0' from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000011' and week = 3),
  'lu-s-te', 'I2 …stored at flex:0');
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'lu-w3-b';   -- kickoff+1s: qb/rb/wr locked
-- R739: a LOCKED starter ruled OUT after his own kickoff under
-- allow_illegal_lineups = FALSE — an identical resubmit is still no_changes
-- (not the manager's to change; 114 keeps only the per-player exemption).
update players set status = 'Out' where id = 'lu-s-rb';
select is((public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 3,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr", "flex:0": "lu-s-te"}', 'a3000000-0000-4000-8000-000000000036', now()) ->> 'no_changes')::boolean,
  true, 'R739: a locked starter ruled OUT after his own kickoff, allow_illegal FALSE — an identical resubmit is no_changes, never "blocked at submit" (the per-player exemption, 114 step 10)');
update players set status = 'Active' where id = 'lu-s-rb';
-- R744 (re-cut to the only mode): a LOCKED starter relisted to a position
-- with NO eligible slot anywhere (QB → K) is a fixed vertex the matcher may
-- not move — an identical resubmit is no_changes, never "cannot be placed".
-- (The QB → RB relist and the byte-unchanged pin live on L1 as R737-RPC.)
select set_config('pgtap.lu_s_map', (select slot_map::text from team_lineups where team_id = 'c3000000-0000-4000-8000-000000000011' and week = 3), true);
update players set position = 'K' where id = 'lu-s-qb';
select is((public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 3,
       current_setting('pgtap.lu_s_map')::jsonb, 'a3000000-0000-4000-8000-000000000040', now()) ->> 'no_changes')::boolean,
  true, 'R744 (the only mode): the locked QB relisted K (no eligible slot anywhere) — an identical resubmit is no_changes, never "cannot be placed" (a locked placement is a fact, R737)');
update players set position = 'QB' where id = 'lu-s-qb';
-- R736 (re-cut): IR moves are judged against the CURRENT week's PER-PLAYER
-- kickoff — the IR player (LU S IR) is on KC, so his OWN week-3 kickoff
-- (lu-w3-a) is what binds a FUTURE-week (4) submit; one second before it,
-- the placement and the removal both land. (Before 114 he sat on a bye team
-- so that only the week lock could bind him; under the only mode a bye
-- player is never locked, hence the move to KC.)
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 4,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr", "ir1:0": "lu-s-ir"}', 'a3000000-0000-4000-8000-000000000037', now()) $$,
  '%LU S IR''s lock for week 3 has passed (kickoff %) — IR moves respect lineup-lock timing%',
  'R736 (per-player): a WEEK-4 submit placing a player on IR after HIS OWN week-3 kickoff (KC, now−1s) is refused on the CURRENT week''s lock — kickoff+1s');
update nfl_games set kickoff_at = now() + interval '1 second' where id = 'lu-w3-a';
select lives_ok(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 4,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr", "ir1:0": "lu-s-ir"}', 'a3000000-0000-4000-8000-000000000037', now()) $$,
  'R736 …the same week-4 placement one second BEFORE his kickoff lands (the one-unit positive)');
select results_eq(
  $$ select slot_key, ir_placed_week from league_rosters where player_id = 'lu-s-ir' $$,
  $$ values ('ir1:0', 3) $$, 'R736 …placed in the CURRENT week (3), not the submitted week');
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'lu-w3-a';
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 4,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr"}', 'a3000000-0000-4000-8000-000000000038', now()) $$,
  '%LU S IR''s lock for week 3 has passed (kickoff %) — IR moves respect lineup-lock timing%',
  'R736: a week-4 submit REMOVING him from IR after his own kickoff is refused the same way (the IR-removal lock arm — this is the suite''s only cell that reaches it)');
update nfl_games set kickoff_at = now() + interval '1 second' where id = 'lu-w3-a';
select lives_ok(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 4,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr"}', 'a3000000-0000-4000-8000-000000000038', now()) $$,
  'R736 …and the removal one second before his kickoff lands');
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'lu-w3-a';   -- restore KC kicked off
-- allow_illegal_lineups FALSE: bye / OUT starters are blocked at submit by
-- name. DAL/PHI back to kickoff−1s so the OUT cell's rb → flex move is a
-- legality question, not a lock question.
update nfl_games set kickoff_at = now() + interval '1 second' where id = 'lu-w3-b';
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 3,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr", "flex:0": "lu-s-bye"}', 'a3000000-0000-4000-8000-000000000034', now()) $$,
  '%LU S BYE is on bye for week 3 and allow_illegal_lineups is off — slot "flex:0" is blocked at submit (§7.3.6)%',
  'I4 allow_illegal FALSE: a BYE starter is blocked at submit by name');
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 3,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-out", "wr:0": "lu-s-wr", "flex:0": "lu-s-rb"}', 'a3000000-0000-4000-8000-000000000034', now()) $$,
  '%LU S OUT is OUT (OUT) for week 3 and allow_illegal_lineups is off — slot "rb:0" is blocked at submit (§7.3.6)%',
  'I4 allow_illegal FALSE: an OUT starter is blocked at submit by name');
select lives_ok(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000002', 'c3000000-0000-4000-8000-000000000011', 3,
       '{"qb:0": "lu-s-qb", "rb:0": "lu-s-rb", "wr:0": "lu-s-wr"}', 'a3000000-0000-4000-8000-000000000035', now()) $$,
  'I4 …the same submit with both benched is accepted (the one-unit positive of the block)');

-- ---------------------------------------------------------------------------
-- J. The ledger — no client path for any role (§4.2 RETURNING counts)
-- ---------------------------------------------------------------------------
select cmp_ok((select count(*)::int from lineup_actions), '>=', 15, 'postgres sees the ledger rows (the SELECT-sees-N premise)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is((select count(*)::int from lineup_actions), 0, 'the manager SELECTs 0 ledger rows');
select throws_ok(
  $$ insert into lineup_actions (league_id, team_id, action_id, actor_id, result)
     values ('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002',
             'a3000000-0000-4000-8000-0000000000ff', '93000000-0000-4000-8000-000000000002', '{}') $$,
  '42501', null, 'the manager cannot INSERT a ledger row');
select results_eq(
  $$ with w as (update lineup_actions set result = '{}' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$,
  'the manager''s UPDATE touches 0 rows');
select results_eq(
  $$ with w as (delete from lineup_actions returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$,
  'the manager''s DELETE touches 0 rows');
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*)::int from lineup_actions), 0, 'the commissioner SELECTs 0 ledger rows');
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from lineup_actions), 0, 'anon SELECTs 0 ledger rows');
reset role;

-- ---------------------------------------------------------------------------
-- K. Held lock — the min RTT over three set_lineup calls (as u2) < 50 ms
-- ---------------------------------------------------------------------------
create temp table lu_rtt (secs double precision) on commit drop;
grant select, insert on lu_rtt to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
do $$
declare v_t0 timestamptz; v_i int; begin
  for v_i in 1..3 loop
    v_t0 := clock_timestamp();
    perform public.set_lineup('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
      ('{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3", "wr:1": "'
       || (case v_i when 1 then 'lu-wr2' when 2 then 'lu-wr4' else 'lu-ques' end) || '"}')::jsonb,
      ('a3000000-0000-4000-8000-0000000000' || (40 + v_i)::text)::uuid);
    insert into lu_rtt values (extract(epoch from clock_timestamp() - v_t0));
  end loop;
end $$;
select cmp_ok((select min(secs) from lu_rtt), '<', 0.05::double precision,
  'held-lock discipline (rule 8): the min RTT of three set_lineup calls (17-player roster, 11 slots) is under 50 ms');
reset role;

-- ---------------------------------------------------------------------------
-- L. R740 — no game rows AND no first_kickoff_at: the CURRENT week locks
--    from its starts_at (conservative, said out loud)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "93000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
delete from nfl_games where season = 2026 and week = 3;
select throws_like(
  $$ select public.set_lineup_internal('b3000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "lu-qb1", "rb:0": "lu-rb2", "rb:1": "lu-rb4", "flex1:0": "lu-rb1", "flex2:0": "lu-wr1", "wr:0": "lu-wr3", "wr:1": "lu-wr2", "te:0": "lu-te1", "k:0": "lu-k1", "dst:0": "lu-dst1", "superflex:0": "lu-rb3"}',
       'a3000000-0000-4000-8000-000000000050', now()) $$,
  '%is locked — % kicked off at % (nfl_weeks.starts_at) and a locked slot''s player never moves%',
  'R740: with NO game rows and NULL first_kickoff_at the CURRENT week is locked for every player from its starts_at — a stack with no ingested games cannot set a current-week lineup (conservative; L.D6.x seeds games)');

select * from finish();
rollback;
