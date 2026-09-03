-- ============================================================================
-- Pool writers + roster_add_drop + game-day locks — pgTAP 061 (task L.D1.5;
-- migration 113; spec v2.16.16 §13.1 / §7.3.4 / §12.19 / §12.9 / §12.7 /
-- §11.2 / E32 / E34 / E42 / §23.3 / §23.4; tasks-M4 §4 rules 1–11; D291 /
-- D294 / D309; ledger F222(a) (the CHECK, taken) / F224(i) (the slot_map /
-- slot_key duties) / F227 (deferrals).
--
-- Numbering: pgTAP head measured 060 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 061, the tasks-M4 §7 reservation confirmed, not inherited
-- (D161/D166).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * E32 BOTH SIDES, ONE UNIT EITHER SIDE OF BOTH EDGES (D146 / D272(20)),
--     applied to the DATUM inside the frozen txn (now() is constant —
--     D307(3)): `nfl_games.kickoff_at = now() ± 1s` IS kickoff∓1s and
--     `= now()` is AT the kickoff; `nfl_weeks.correction_window_ends_at =
--     now() ± 1s` is close∓1s and `= now()` is AT the close. The ADD of a
--     free agent and the DROP of a rostered player are each refused at
--     kickoff AT/+1s and at close−1s, and each LIVES at kickoff−1s, AT the
--     close and at close+1s — the two sides are guarded INDEPENDENTLY: the
--     DoD break probe removes the drop-side clause alone and §F reds while
--     §E stays green. The lax control (`player_game_lock = false`): both a
--     kicked-off add and a kicked-off drop live inside the window.
--   * E42: the same kickoff moved ahead re-opens the add. BYE (game rows,
--     none for the team): never locked. NO GAME ROWS: every player locked
--     from the week datum, the arm NAMED (the R740 posture inherited).
--   * R754 — TWO WINDOWS: a player who played in WEEK 2 and is a WEEK-3 bye
--     is still bound while week 2's correction window is open — add AND drop
--     refused naming week 2 at close−1s, both live AT the close and at +1s,
--     the result then reporting the current week's (bye) datum.
--   * EXCLUSIVITY from both sides (another team's player, your own) — the
--     friendly P0001 naming the team, never 23505 — and the same-league
--     re-add after a drop HONORING WAIVER STATE at `waivers_until` −1s
--     (refused) / AT (lapsed — lives) under `immediate_after_waivers`;
--     under `continuous` a lapsed player refuses by name while a fresh free
--     agent still adds; `none_fcfs` drops straight to FA.
--   * fa_hold_hours at hold−1s (FA, `early`) / +0 (waivers); a DRAFTED
--     player is never held (waivers regardless of the hold).
--   * CAPS from `transactions`: weekly cap 2 — the 2nd add (cap−1 → cap)
--     lives, the 3rd refuses by name; a drop-only never counts; season cap 3
--     across a moved calendar — the 3rd lives, the 4th refuses.
--   * THE TRANSACTIONS ROW AS A STORED LITERAL (the payload minus the random
--     id, built against now() so the instants are exact) + the row's
--     columns; REPLAY byte-identical with a four-table digest unchanged;
--     kind-scoped (a `trade` row with the same action_id refuses by name)
--     and team-scoped (another team's action_id refuses by name).
--   * THE LINEUP CONSEQUENCES (F224(i)): an UNLOCKED dropped starter leaves
--     the current-week `slot_map` (the slot reads empty, bench trimmed); a
--     LOCKED dropped starter is KEPT (`kept_in_locked_lineup`, E34 — under
--     the lax league AND under the strict league once the window has
--     closed); the add lands on the bench of every row from the current
--     week on with `slot_key = 'bn'`.
--   * The CHECK both directions (on_waivers without waivers_until 23514;
--     free_agent with one 23514; on_waivers with one lives).
--   * LOUD EMPTINESS (rule 10): both sides empty, add = drop, a missing
--     action_id, an unknown player, a player not on the roster, another
--     team's player, a league not in season, a retired team, a foreign team
--     — each refused by name / the no-leak 42501.
--   * ROLES through the public verb: outsider, a member without a team, the
--     COMMISSIONER on another team (M6's commissioner_move — F227(d)) and
--     anon are refused; the manager lives. The three tables have no client
--     write path for any role (SELECT-sees-N premise, INSERT 42501,
--     UPDATE/DELETE RETURNING 0).
--   * F35 pinned STRUCTURALLY (no 113 function body names `team_managers`).
--   * HELD LOCK: the min RTT over three roster_add_drop calls < 50 ms.
--   * All privileged-context work runs as postgres BEFORE the role switches;
--     calls at an INJECTED instant go through `roster_add_drop_internal`
--     (the rule-10 seam, REVOKEd from every client role) as postgres with
--     the JWT claim set — the body's in-body auth still reads auth.uid().
--   * The 2026 calendar is re-asserted RELATIVE to now() (the R724/R730
--     shape): week w starts (w − 3) weeks − 1 day from the transaction
--     instant (current week 3), and its correction window closes six days
--     after it starts (week 2's window is CLOSED, week 3's is OPEN) — so no
--     pin rots with the wall clock and no earlier week binds a player
--     through the no-game-rows fallback. All 2026 `nfl_games` rows are the
--     fixture's own.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(139);

-- ---------------------------------------------------------------------------
-- A. Form pins — the stamp, the CHECK, the functions, grants (§4.1), F35
-- ---------------------------------------------------------------------------
select has_column('public', 'transactions', 'action_id', 'transactions.action_id exists (113''s idempotency stamp)');
select has_index('public', 'transactions', 'uniq_transactions_league_action', 'uniq_transactions_league_action exists');
select ok(
  (select i.indisunique and pg_get_expr(i.indpred, i.indrelid) = '(action_id IS NOT NULL)'
   from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = 'uniq_transactions_league_action'),
  'the stamp index is UNIQUE and partial on action_id IS NOT NULL (other writers may leave it NULL)');
select ok(
  exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid
          where r.relname = 'league_player_pool' and c.conname = 'pool_waivers_until_iff_on_waivers' and c.contype = 'c'),
  'F222(a) TAKEN: the pool CHECK pool_waivers_until_iff_on_waivers exists');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal', 'roster_add_drop_internal', 'roster_add_drop')),
  4, 'the four 113 functions exist (one overload each)');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'roster_add_drop'),
  'roster_add_drop is SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal', 'roster_add_drop_internal')),
  'the three helpers are PLAIN with search_path='''' — reachable only through the DEFINER verb (or as postgres)');
select ok(
  not has_function_privilege('anon', 'public.roster_add_drop(uuid,uuid,text,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.roster_add_drop(uuid,uuid,text,text,uuid)', 'EXECUTE'),
  'roster_add_drop: anon holds no EXECUTE (REVOKE FROM PUBLIC, anon); authenticated may call — the manager check is IN-BODY');
select ok(
  not has_function_privilege('authenticated', 'public.roster_add_drop_internal(uuid,uuid,text,text,uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.roster_add_drop_internal(uuid,uuid,text,text,uuid,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.pool_game_lock_internal(integer,integer,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.pool_game_lock_any_internal(integer,integer,text,timestamptz)', 'EXECUTE'),
  'the three helpers are triple-REVOKEd — no client can supply the instant (rule 10: the seam is postgres-only)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal', 'roster_add_drop_internal', 'roster_add_drop')
     and p.prosrc like '%team_managers%'),
  0, 'F35 re-affirmed: NO 113 function body names team_managers — access derives from league_members, never a stint');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('pool_game_lock_internal', 'pool_game_lock_any_internal', 'roster_add_drop_internal')
     and p.prosrc like '%locked_until%'),
  0, 'rule 9: NO 113 lock path reads league_player_pool.locked_until — E32 is evaluated from nfl_games at call time (114 maintains that column for the pool view)');
select policies_are('public', 'league_player_pool', array['Pool viewable by members'],
  'league_player_pool still has exactly ONE policy — member SELECT; 113 adds no client write path');
select policies_are('public', 'transactions', array['Transactions viewable by league members'],
  'transactions still has exactly ONE policy — member SELECT');
select policies_are('public', 'league_rosters', array['Rosters viewable by league members'],
  'league_rosters still has exactly ONE policy — member SELECT');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — before any JWT claims)
--    u1 commish L1 (T1) · u2 manager L1 (T2) + manager L3 (C1) · u3 manager
--    L1 (T3) · u4 outsider · u5 member of L1 with NO team · u6 commish L2 (S1).
--    L1 STRICT: player_game_lock TRUE, per_player_kickoff, faab, 48h waivers,
--    immediate_after_waivers, fa_hold 24h, caps unlimited, roster_size 8.
--    L2 LAX: player_game_lock FALSE, first_game_of_week, none_fcfs,
--    continuous, fa_hold 0. L3 CAPS: 2/week, 3/season, everyone on bye.
--    L4: scheduled.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9d000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-pd' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'pd_user' || i)::jsonb, now(), now()
from generate_series(1, 6) i;

-- The calendar, RELATIVE to now(): current week 3; every week's correction
-- window closes 6 days after it starts (week 2 closed 2 days ago, week 3
-- closes in 5 days). first_kickoff_at NULL: the starts_at arm unless a game
-- is placed.
update nfl_weeks w
set starts_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day',
    correction_window_ends_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day' + interval '6 days',
    first_kickoff_at = null, last_game_ends_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, waiver_type, settings, roster_settings) values
 ('bd000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'pgtap-pd-L1', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab',
  '{"player_game_lock": true, "waiver_period_hours": 48, "free_agency": "immediate_after_waivers", "fa_hold_hours": 24,
    "acquisitions_per_week": "unlimited", "acquisitions_per_season": "unlimited", "allow_illegal_lineups": true}',
  '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1}],
    "bench": 4,
    "ir_slots": [{"key": "ir1", "type": "restricted", "eligible_designations": ["OUT", "IR"], "min_weeks": 4}],
    "swap_spots": 0}'),
 ('bd000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000006', 'pgtap-pd-L2', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'first_game_of_week', 'none_fcfs',
  '{"player_game_lock": false, "waiver_period_hours": 48, "free_agency": "continuous", "fa_hold_hours": 0,
    "acquisitions_per_week": "unlimited", "acquisitions_per_season": "unlimited", "allow_illegal_lineups": true}',
  '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1}],
    "bench": 4, "ir_slots": [], "swap_spots": 0}'),
 ('bd000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000001', 'pgtap-pd-L3', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab',
  '{"player_game_lock": false, "waiver_period_hours": 48, "free_agency": "immediate_after_waivers", "fa_hold_hours": 0,
    "acquisitions_per_week": 2, "acquisitions_per_season": 3, "allow_illegal_lineups": true}',   -- lax: the moved calendar (§J) leaves week 4 without game rows
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 9, "ir_slots": [], "swap_spots": 0}'),
 ('bd000000-0000-4000-8000-000000000004', '9d000000-0000-4000-8000-000000000001', 'pgtap-pd-L4', 2026, 'scheduled', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab', '{}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 3, "ir_slots": [], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id) values
 ('cd000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'PD T1', 'bd000000-0000-4000-8000-000000000001'),
 ('cd000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000002', 'PD T2', 'bd000000-0000-4000-8000-000000000001'),
 ('cd000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000003', 'PD T3', 'bd000000-0000-4000-8000-000000000001'),
 ('cd000000-0000-4000-8000-000000000011', '9d000000-0000-4000-8000-000000000006', 'PD S1', 'bd000000-0000-4000-8000-000000000002'),
 ('cd000000-0000-4000-8000-000000000021', '9d000000-0000-4000-8000-000000000002', 'PD C1', 'bd000000-0000-4000-8000-000000000003'),
 ('cd000000-0000-4000-8000-000000000031', '9d000000-0000-4000-8000-000000000001', 'PD X1', 'bd000000-0000-4000-8000-000000000004');
insert into league_members (league_id, user_id, team_id, role) values
 ('bd000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000001', 'commissioner'),
 ('bd000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000002', 'manager'),
 ('bd000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000003', 'manager'),
 ('bd000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000005', null, 'manager'),
 ('bd000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000006', 'cd000000-0000-4000-8000-000000000011', 'commissioner'),
 ('bd000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000021', 'manager'),
 ('bd000000-0000-4000-8000-000000000004', '9d000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000031', 'commissioner');
insert into league_weeks (league_id, season, week)
select l, 2026, g from (values ('bd000000-0000-4000-8000-000000000001'::uuid), ('bd000000-0000-4000-8000-000000000002'), ('bd000000-0000-4000-8000-000000000003')) v(l),
     generate_series(1, 8) g;

insert into players (id, full_name, position, team, status) values
 ('pd-qb1',   'PD QB1',   'QB', 'KC',  'Active'),   -- T2 starter; KC kicked off ONE SECOND AGO
 ('pd-rb1',   'PD RB1',   'RB', 'DAL', 'Active'),   -- T2 starter; DAL kicks off in one second
 ('pd-wr1',   'PD WR1',   'WR', 'PHI', 'Active'),   -- T2 starter; PHI in one second
 ('pd-wr2',   'PD WR2',   'WR', 'MIA', 'Active'),   -- T2 bench; MIA has no week-3 game: BYE
 ('pd-te1',   'PD TE1',   'TE', 'NYG', 'Active'),   -- T2 bench; NYG in three hours
 ('pd-t1a',   'PD T1A',   'RB', 'KC',  'Active'),   -- T1's player (exclusivity)
 ('pd-ne1',   'PD NE1',   'WR', 'NE',  'Active'),   -- free agent; NE played in WEEK 2, bye in week 3 (R754)
 ('pd-ne2',   'PD NE2',   'TE', 'NE',  'Active'),   -- T3's player; same (R754)
 ('pd-fa1',   'PD FA1',   'WR', 'KC',  'Active'),   -- free agent, KC: locked for adds now
 ('pd-fa2',   'PD FA2',   'WR', 'DAL', 'Active'),   -- free agent, DAL: one second ahead
 ('pd-fa3',   'PD FA3',   'RB', 'SF',  'Active'),   -- free agent, SF: three hours ahead
 ('pd-fa4',   'PD FA4',   'TE', 'MIA', 'Active'),   -- free agent, bye
 ('pd-fa5',   'PD FA5',   'QB', 'PHI', 'Active'),   -- free agent, PHI
 ('pd-s-qb',  'PD S QB',  'QB', 'KC',  'Active'),   -- S1 starter (lax league), kicked off
 ('pd-s-rb',  'PD S RB',  'RB', 'DAL', 'Active'),
 ('pd-s-wr',  'PD S WR',  'WR', 'PHI', 'Active'),
 ('pd-s-fa1', 'PD S FA1', 'WR', 'SF',  'Active'),   -- fresh free agent (lax league)
 ('pd-s-fa2', 'PD S FA2', 'WR', 'KC',  'Active'),   -- kicked-off free agent (lax league)
 ('pd-s-w',   'PD S W',   'WR', 'MIA', 'Active'),   -- on_waivers, LAPSED, under continuous
 ('pd-c-qb',  'PD C QB',  'QB', 'MIA', 'Active'),   -- C1's only player (caps league; everyone on bye)
 ('pd-c-f1',  'PD C F1',  'WR', 'MIA', 'Active'),
 ('pd-c-f2',  'PD C F2',  'WR', 'MIA', 'Active'),
 ('pd-c-f3',  'PD C F3',  'WR', 'MIA', 'Active'),
 ('pd-c-f4',  'PD C F4',  'WR', 'MIA', 'Active');
insert into league_rosters (league_id, team_id, player_id) values
 ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-qb1'),
 ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-rb1'),
 ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-wr1'),
 ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-wr2'),
 ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-te1'),
 ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000001', 'pd-t1a'),
 ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-ne2'),
 ('bd000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000011', 'pd-s-qb'),
 ('bd000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000011', 'pd-s-rb'),
 ('bd000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000011', 'pd-s-wr'),
 ('bd000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000021', 'pd-c-qb');
insert into league_player_pool (league_id, player_id, state, waivers_until) values
 ('bd000000-0000-4000-8000-000000000002', 'pd-s-w', 'on_waivers', now() - interval '1 second');

-- Week 3 games: KC kicked off ONE SECOND AGO (kickoff+1s), DAL/PHI kick off
-- in one second (kickoff−1s), NYG/SF in three hours. MIA: bye.
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('pd-w3-a', 2026, 3, 'KC',  'BUF', now() - interval '1 second'),
 ('pd-w3-b', 2026, 3, 'DAL', 'PHI', now() + interval '1 second'),
 ('pd-w3-c', 2026, 3, 'NYG', 'SF',  now() + interval '3 hours');

select is(public.lineup_current_week_internal('bd000000-0000-4000-8000-000000000001', now()), 3,
  'the current week is 3 by the nfl_weeks.starts_at boundary');
select is((select correction_window_ends_at from nfl_weeks where season = 2026 and week = 2) < now(), true,
  'week 2''s correction window is CLOSED (it cannot bind anyone through the no-game-rows fallback)');
select is((select correction_window_ends_at from nfl_weeks where season = 2026 and week = 3) > now(), true,
  'week 3''s correction window is OPEN');

-- T2's week-3 lineup through the real verb (as u2, two seconds before KC's
-- kickoff so QB1 can enter): qb QB1 / rb RB1 / wr WR1; bench WR2, TE1. And
-- a week-4 row (the future week the add must also land on).
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.set_lineup_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "pd-qb1", "rb:0": "pd-rb1", "wr:0": "pd-wr1"}', 'ab000000-0000-4000-8000-000000000001', now() - interval '2 seconds') $$,
  'fixture: T2''s week-3 lineup set (QB1 at qb:0 one second before his kickoff)');
select lives_ok(
  $$ select public.set_lineup_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 4,
       '{"qb:0": "pd-qb1", "rb:0": "pd-rb1", "wr:0": "pd-wr2"}', 'ab000000-0000-4000-8000-000000000002', now()) $$,
  'fixture: T2''s week-4 lineup set');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.set_lineup_internal('bd000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000011', 3,
       '{"qb:0": "pd-s-qb", "rb:0": "pd-s-rb", "wr:0": "pd-s-wr"}', 'ab000000-0000-4000-8000-000000000003', now() - interval '2 seconds') $$,
  'fixture: S1''s week-3 lineup set (the lax league; the week is now locked — KC kicked off)');
select set_config('request.jwt.claims', '', true);

-- The pristine T2 week-3 row, captured for the drop-side resets.
select set_config('pgtap.pd_map', (select slot_map::text from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 3), true);
select set_config('pgtap.pd_starters', (select starters::text from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 3), true);
select set_config('pgtap.pd_bench', (select bench::text from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 3), true);
select is(current_setting('pgtap.pd_map')::jsonb, '{"qb:0": "pd-qb1", "rb:0": "pd-rb1", "wr:0": "pd-wr1"}'::jsonb,
  'fixture: the stored week-3 map is the submitted one');
select is(current_setting('pgtap.pd_bench')::jsonb, '["pd-te1", "pd-wr2"]'::jsonb, 'fixture: the week-3 bench is TE1, WR2');
select set_config('pgtap.pd_map4', (select slot_map::text from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 4), true);
select set_config('pgtap.pd_starters4', (select starters::text from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 4), true);
select set_config('pgtap.pd_bench4', (select bench::text from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 4), true);

-- Fixture helpers (postgres): undo an add / a drop so every lock cell starts
-- from the same roster; the four-table digest.
create function pg_temp.pd_digest() returns text language sql as $$
  select md5(
    coalesce((select string_agg(r::text, ',' order by r.id) from public.league_rosters r), '') || '|' ||
    coalesce((select string_agg(p::text, ',' order by p.league_id, p.player_id) from public.league_player_pool p), '') || '|' ||
    coalesce((select string_agg(t::text, ',' order by t.id) from public.transactions t), '') || '|' ||
    coalesce((select string_agg(l::text, ',' order by l.id) from public.team_lineups l), ''))
$$;
create function pg_temp.pd_undo_add(p_player text, p_action uuid) returns void language plpgsql as $$
begin
  delete from public.league_rosters where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = p_player;
  delete from public.league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = p_player;
  delete from public.transactions where action_id = p_action;
  update public.team_lineups set bench = bench - p_player where team_id = 'cd000000-0000-4000-8000-000000000002';
end $$;
create function pg_temp.pd_undo_drop(p_player text, p_action uuid) returns void language plpgsql as $$
begin
  insert into public.league_rosters (league_id, team_id, player_id)
  values ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', p_player);
  delete from public.league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = p_player;
  delete from public.transactions where action_id = p_action;
  update public.team_lineups
  set slot_map = current_setting('pgtap.pd_map')::jsonb, starters = current_setting('pgtap.pd_starters')::jsonb,
      bench = current_setting('pgtap.pd_bench')::jsonb
  where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 3;
  update public.team_lineups
  set slot_map = current_setting('pgtap.pd_map4')::jsonb, starters = current_setting('pgtap.pd_starters4')::jsonb,
      bench = current_setting('pgtap.pd_bench4')::jsonb
  where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 4;
end $$;

-- ---------------------------------------------------------------------------
-- C. The CHECK, both directions (F222(a))
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into league_player_pool (league_id, player_id, state, waivers_until)
     values ('bd000000-0000-4000-8000-000000000001', 'pd-fa5', 'on_waivers', null) $$,
  '23514', null, 'CHECK: on_waivers WITHOUT waivers_until is refused (23514) — F222(a)');
select throws_ok(
  $$ insert into league_player_pool (league_id, player_id, state, waivers_until)
     values ('bd000000-0000-4000-8000-000000000001', 'pd-fa5', 'free_agent', now()) $$,
  '23514', null, 'CHECK: free_agent WITH a waivers_until is refused (23514) — §12.19 "NULL unless on_waivers"');
select lives_ok(
  $$ insert into league_player_pool (league_id, player_id, state, waivers_until)
     values ('bd000000-0000-4000-8000-000000000001', 'pd-fa5', 'on_waivers', now() + interval '1 hour') $$,
  'CHECK: on_waivers WITH a waivers_until lives');
delete from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-fa5';

-- ---------------------------------------------------------------------------
-- D. The add golden (as u2 through the seam at now()) + replay + scoping
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select set_config('pgtap.pd_r1', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa3', null,
  'ab000000-0000-4000-8000-000000000011', now())::text, true);
select is(
  current_setting('pgtap.pd_r1')::jsonb - 'transaction_id',
  jsonb_build_object(
    'action_id', 'ab000000-0000-4000-8000-000000000011', 'league_id', 'bd000000-0000-4000-8000-000000000001',
    'team_id', 'cd000000-0000-4000-8000-000000000002', 'season', 2026, 'week', 3, 'type', 'add_drop',
    'add_player_id', 'pd-fa3', 'drop_player_id', null,
    'add', jsonb_build_object('player_id', 'pd-fa3', 'name', 'PD FA3', 'position', 'RB', 'nfl_team', 'SF',
      'from_state', 'free_agent', 'to_state', 'rostered', 'acquisition_type', 'free_agent', 'slot_key', 'bn',
      'acquired_at', now(),
      'game_lock', jsonb_build_object('locked', false, 'week', 3, 'kickoff_at', now() + interval '3 hours',
        'window_ends_at', now() + interval '5 days', 'datum_arm', 'nfl_games', 'on_bye', false)),
    'drop', null,
    'roster', jsonb_build_object('count_after', 6, 'roster_size', 8),
    'caps', jsonb_build_object('acquisitions_per_week', 'unlimited', 'acquisitions_per_season', 'unlimited',
      'used_week_after', 1, 'used_season_after', 1),
    'settings', jsonb_build_object('player_game_lock', true, 'lineup_lock', 'per_player_kickoff', 'waiver_type', 'faab',
      'waiver_period_hours', 48, 'free_agency', 'immediate_after_waivers', 'fa_hold_hours', 24),
    'evaluated_at', now()),
  'D1 THE ADD GOLDEN: the whole result minus the random transaction id, as a literal built against now() (FA3 from free_agent to rostered, bn, the lock evaluated from nfl_games and NOT locked, roster 6 of 8, caps unlimited)');
select results_eq(
  $$ select slot_key, acquisition_type, acquisition_cost, acquired_at from league_rosters where player_id = 'pd-fa3' $$,
  $$ values ('bn', 'free_agent', 0, now()) $$,
  'D1 the roster row: slot_key bn (F224(i)), acquisition_type free_agent, acquired_at = the instant');
select results_eq(
  $$ select state, waivers_until from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-fa3' $$,
  $$ values ('rostered', null::timestamptz) $$,
  'D1 the pool row: rostered, no waivers_until (lazy row created on first transition — D294)');
select results_eq(
  $$ select type, status, initiator_team_id, initiated_by, week, action_id, (payload ->> 'transaction_id')::uuid = id
     from transactions where action_id = 'ab000000-0000-4000-8000-000000000011' $$,
  $$ values ('add_drop', 'complete', 'cd000000-0000-4000-8000-000000000002'::uuid, '9d000000-0000-4000-8000-000000000002'::uuid, 3,
             'ab000000-0000-4000-8000-000000000011'::uuid, true) $$,
  'D1 THE TRANSACTIONS ROW: type add_drop (§13.1''s letter), complete, T2 by u2, week 3, the stamp, payload.transaction_id = id');
select is((select payload from transactions where action_id = 'ab000000-0000-4000-8000-000000000011'),
  current_setting('pgtap.pd_r1')::jsonb, 'D1 payload IS the returned document');
select results_eq(
  $$ select week, bench from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000002' order by week $$,
  $$ values (3, '["pd-fa3", "pd-te1", "pd-wr2"]'::jsonb), (4, '["pd-fa3", "pd-te1", "pd-wr1"]'::jsonb) $$,
  'D1 F224(i): the add lands on the BENCH of the current AND the future week''s rows (sorted, the 112 shape)');

-- D2. REPLAY: same action_id, different arguments → the stored payload, byte-identically; nothing written.
select set_config('pgtap.pd_d1', pg_temp.pd_digest(), true);
select is(
  public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa5', 'pd-wr2',
    'ab000000-0000-4000-8000-000000000011', now())::text,
  current_setting('pgtap.pd_r1'),
  'D2 REPLAY (same action_id, different add/drop) returns the stored payload byte-identically (text equality)');
select is(pg_temp.pd_digest(), current_setting('pgtap.pd_d1'), 'D2 the replay wrote nothing (rosters + pool + transactions + lineups digest unchanged)');
-- D3. Kind-scoped (R732): a trade row with another action_id → refuse by name.
insert into transactions (league_id, type, initiator_team_id, initiated_by, payload, week, action_id) values
 ('bd000000-0000-4000-8000-000000000001', 'trade', 'cd000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000002',
  '{"m5": true}', 3, 'ab000000-0000-4000-8000-000000000012');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa5', null,
       'ab000000-0000-4000-8000-000000000012', now()) $$,
  '%action_id % already names a trade transaction in this league — an action_id identifies ONE submit of ONE verb (R732)%',
  'D3 KIND-SCOPED replay: an action_id stamped on a trade row refuses by name instead of replaying a foreign result');
-- D4. Team-scoped: u3 (T3) with T2's action_id → refuse by name.
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-fa5', null,
       'ab000000-0000-4000-8000-000000000011', now()) $$,
  '%action_id % belongs to another team''s move in this league%',
  'D4 TEAM-SCOPED replay: another team''s action_id refuses by name');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

-- ---------------------------------------------------------------------------
-- E. E32 — the ADD side (D146 one-unit pairs on the datum)
-- ---------------------------------------------------------------------------
-- E1. kickoff: FA1 (KC, kicked off at now−1s)
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000021', now()) $$,
  '%PD FA1 (pd-fa1) is locked for adds — kicked off at % (nfl_games) and week 3 clears at %',
  'E1 ADD at kickoff+1s: refused — named player, instant, datum arm, week, window close (E32)');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000021', now() - interval '1 second') $$,
  '%PD FA1 (pd-fa1) is locked for adds%',
  'E1 ADD at the kickoff instant (AT): refused — closed on the kickoff side');
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000021', now() - interval '2 seconds') $$,
  'E1 ADD at kickoff−1s: LIVES (the one-unit positive)');
select is((select count(*)::int from league_rosters where player_id = 'pd-fa1' and team_id = 'cd000000-0000-4000-8000-000000000002'), 1,
  'E1 …FA1 is on T2');
select pg_temp.pd_undo_add('pd-fa1', 'ab000000-0000-4000-8000-000000000021');
-- E2. window close: KC kicked off a day ago; week 3's window closes at now±1s / now.
update nfl_games set kickoff_at = now() - interval '1 day' where id = 'pd-w3-a';
update nfl_weeks set correction_window_ends_at = now() + interval '1 second' where season = 2026 and week = 3;
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000022', now()) $$,
  '%PD FA1 (pd-fa1) is locked for adds — kicked off at % (nfl_games) and week 3 clears at %',
  'E2 ADD at window-close−1s: still refused');
update nfl_weeks set correction_window_ends_at = now() where season = 2026 and week = 3;
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000022', now()) $$,
  'E2 ADD AT the window close: LIVES ("until the week clears" is strictly before — open at the close)');
select pg_temp.pd_undo_add('pd-fa1', 'ab000000-0000-4000-8000-000000000022');
update nfl_weeks set correction_window_ends_at = now() - interval '1 second' where season = 2026 and week = 3;
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000023', now()) $$,
  'E2 ADD at window-close+1s: LIVES');
select pg_temp.pd_undo_add('pd-fa1', 'ab000000-0000-4000-8000-000000000023');
update nfl_weeks set correction_window_ends_at = now() + interval '5 days' where season = 2026 and week = 3;   -- restore
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'pd-w3-a';                              -- restore kickoff+1s
-- E3. E42: KC flexed to now+1h → the add re-opens.
update nfl_games set kickoff_at = now() + interval '1 hour' where id = 'pd-w3-a';
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000024', now()) $$,
  'E3 E42: KC''s kickoff moved to now+1h — FA1 adds (the lock is evaluated from nfl_games at call time)');
select pg_temp.pd_undo_add('pd-fa1', 'ab000000-0000-4000-8000-000000000024');
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'pd-w3-a';
-- E4. BYE: FA4 (MIA, no week-3 game) adds while KC has kicked off.
select set_config('pgtap.pd_r_e4', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa4', null,
  'ab000000-0000-4000-8000-000000000025', now())::text, true);
select is(current_setting('pgtap.pd_r_e4')::jsonb -> 'add' -> 'game_lock',
  '{"locked": false, "week": 3, "kickoff_at": null, "window_ends_at": null, "datum_arm": "bye", "on_bye": true}'::jsonb
    || jsonb_build_object('window_ends_at', now() + interval '5 days'),
  'E4 BYE: a week WITH game rows and none for MIA never locks — the result names the bye arm');
select pg_temp.pd_undo_add('pd-fa4', 'ab000000-0000-4000-8000-000000000025');
-- E5. NO GAME ROWS: the week datum locks EVERY player from starts_at (R740).
delete from nfl_games where season = 2026 and week = 3;
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa5', null,
       'ab000000-0000-4000-8000-000000000026', now()) $$,
  '%PD FA5 (pd-fa5) is locked for adds — kicked off at % (nfl_weeks.starts_at) and week 3 clears at %',
  'E5 NO GAME ROWS: every player is locked from the week datum until the window clears — the arm is NAMED (the 112/R740 posture)');
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('pd-w3-a', 2026, 3, 'KC',  'BUF', now() - interval '1 second'),
 ('pd-w3-b', 2026, 3, 'DAL', 'PHI', now() + interval '1 second'),
 ('pd-w3-c', 2026, 3, 'NYG', 'SF',  now() + interval '3 hours');
-- E6. A NULL window end after the kickoff refuses loudly (never an unbounded lock read as free).
update nfl_weeks set correction_window_ends_at = null where season = 2026 and week = 3;
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000027', now()) $$,
  '%nfl_weeks.correction_window_ends_at is NULL — the E32 lock end is undefined until ingestion writes it%',
  'E6 a kicked-off player in a week whose window end is NULL refuses BY NAME (loud emptiness, rule 10)');
update nfl_weeks set correction_window_ends_at = now() + interval '5 days' where season = 2026 and week = 3;

-- ---------------------------------------------------------------------------
-- F. E32 — the DROP side (the DoD probe's target; each cell restored)
-- ---------------------------------------------------------------------------
-- F1. kickoff: QB1 (KC, kicked off at now−1s) — T2's own starter.
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-qb1',
       'ab000000-0000-4000-8000-000000000031', now()) $$,
  '%PD QB1 (pd-qb1) is locked for drops — kicked off at % (nfl_games) and week 3 clears at %',
  'F1 DROP at kickoff+1s: refused — no dropping a player mid-game (E32, the drop side)');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-qb1',
       'ab000000-0000-4000-8000-000000000031', now() - interval '1 second') $$,
  '%PD QB1 (pd-qb1) is locked for drops%',
  'F1 DROP at the kickoff instant (AT): refused');
select set_config('pgtap.pd_r_f1', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-qb1',
  'ab000000-0000-4000-8000-000000000031', now() - interval '2 seconds')::text, true);
select is((select count(*)::int from league_rosters where player_id = 'pd-qb1'), 0,
  'F1 DROP at kickoff−1s: LIVES — QB1 is off the roster (the one-unit positive)');
select results_eq(
  $$ select state, waivers_until from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-qb1' $$,
  $$ values ('on_waivers', now() - interval '2 seconds' + interval '48 hours') $$,
  'F1 …QB1 enters waivers: on_waivers with waivers_until = the instant + waiver_period_hours (48h) — a DRAFTED player is never fa_hold-early');
select is(current_setting('pgtap.pd_r_f1')::jsonb -> 'drop' -> 'lineups',
  '[{"week": 3, "slot": "qb:0", "kept_in_locked_lineup": false}, {"week": 4, "slot": "qb:0", "kept_in_locked_lineup": false}]'::jsonb,
  'F1 F224(i): the dropped starter LEAVES the current-week and the future-week slot_map (his kickoff was still ahead at the instant — the slot was unlocked)');
select is((select slot_map from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 3),
  '{"rb:0": "pd-rb1", "wr:0": "pd-wr1"}'::jsonb, 'F1 …the week-3 map no longer carries the ghost');
select is((select s -> 'flags' from team_lineups t, jsonb_array_elements(t.starters) s
           where t.team_id = 'cd000000-0000-4000-8000-000000000002' and t.week = 3 and s ->> 'slot' = 'qb:0'),
  '["empty"]'::jsonb, 'F1 …the qb:0 starters element reads empty');
select is(current_setting('pgtap.pd_r_f1')::jsonb -> 'drop' ->> 'from_slot_key', 'qb:0', 'F1 the result records the slot he left');
select pg_temp.pd_undo_drop('pd-qb1', 'ab000000-0000-4000-8000-000000000031');
-- F2. window close for the drop: KC kicked off a day ago.
update nfl_games set kickoff_at = now() - interval '1 day' where id = 'pd-w3-a';
update nfl_weeks set correction_window_ends_at = now() + interval '1 second' where season = 2026 and week = 3;
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-qb1',
       'ab000000-0000-4000-8000-000000000032', now()) $$,
  '%PD QB1 (pd-qb1) is locked for drops — kicked off at % (nfl_games) and week 3 clears at %',
  'F2 DROP at window-close−1s: still refused');
update nfl_weeks set correction_window_ends_at = now() where season = 2026 and week = 3;
select set_config('pgtap.pd_r_f2', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-qb1',
  'ab000000-0000-4000-8000-000000000032', now())::text, true);
select is((select count(*)::int from league_rosters where player_id = 'pd-qb1'), 0,
  'F2 DROP AT the window close: LIVES (open at the close)');
select is(current_setting('pgtap.pd_r_f2')::jsonb -> 'drop' -> 'lineups',
  '[{"week": 3, "slot": "qb:0", "kept_in_locked_lineup": true}, {"week": 4, "slot": "qb:0", "kept_in_locked_lineup": false}]'::jsonb,
  'F2 E34 in the STRICT league: his week-3 slot is LOCKED (kickoff passed) so the entry is KEPT — the locked slot is read-only and his stats count for the dropping team; the week-4 entry is cleared');
select is((select slot_map ->> 'qb:0' from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000002' and week = 3),
  'pd-qb1', 'F2 …the week-3 map still carries him');
select pg_temp.pd_undo_drop('pd-qb1', 'ab000000-0000-4000-8000-000000000032');
update nfl_weeks set correction_window_ends_at = now() - interval '1 second' where season = 2026 and week = 3;
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-qb1',
       'ab000000-0000-4000-8000-000000000033', now()) $$,
  'F2 DROP at window-close+1s: LIVES');
select pg_temp.pd_undo_drop('pd-qb1', 'ab000000-0000-4000-8000-000000000033');
update nfl_weeks set correction_window_ends_at = now() + interval '5 days' where season = 2026 and week = 3;
update nfl_games set kickoff_at = now() - interval '1 second' where id = 'pd-w3-a';
-- F3. The add side does not bind the drop side: RB1 (DAL, one second ahead) drops while KC's game is live.
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-rb1',
       'ab000000-0000-4000-8000-000000000034', now()) $$,
  'F3 a starter whose OWN kickoff is one second ahead drops freely while another game is live — the lock is per player');
select pg_temp.pd_undo_drop('pd-rb1', 'ab000000-0000-4000-8000-000000000034');
-- F4. A player on a RESTRICTED IR spot may be DROPPED (a release is not a move out of the spot).
update league_rosters set slot_key = 'ir1:0', ir_placed_week = 3, ir_lock_until_week = 7 where player_id = 'pd-te1';
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-te1',
       'ab000000-0000-4000-8000-000000000035', now()) $$,
  'F4 a restricted-IR player (lock week 7, current 3) is DROPPED: §7.3.2''s stint binds moving him OUT of the spot into the roster, not a release');
select pg_temp.pd_undo_drop('pd-te1', 'ab000000-0000-4000-8000-000000000035');

-- ---------------------------------------------------------------------------
-- F5/E7. R754 — THE PREVIOUS WEEK'S WINDOW STILL BINDS (two windows early in
--    a week): NE played in WEEK 2 (now−5d) and has NO week-3 game (a
--    current-week BYE); week 2's correction window is moved to close at
--    now+1s / AT now / now−1s. As u3 on T3 (NE2 rostered there; NE1 free).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('pd-w2-a', 2026, 2, 'NE', 'NYJ', now() - interval '5 days');
update nfl_weeks set correction_window_ends_at = now() + interval '1 second' where season = 2026 and week = 2;
select is(
  (select on_bye from public.pool_game_lock_internal(2026, 3, 'NE', now())), true,
  'R754 premise: NE is a current-week (3) BYE — game rows exist for week 3, none for NE');
select is(
  (public.pool_game_lock_any_internal(2026, 3, 'NE', now())) - 'kickoff_at' - 'window_ends_at',
  '{"locked": true, "week": 2, "datum_arm": "nfl_games", "on_bye": false}'::jsonb,
  'R754: the across-weeks lock finds WEEK 2 binding a current-week bye player (his week-2 game kicked off, week 2''s window still open)');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-ne1', null,
       'ab000000-0000-4000-8000-000000000036', now()) $$,
  '%PD NE1 (pd-ne1) is locked for adds — kicked off at % (nfl_games) and week 2 clears at %',
  'R754 ADD at week-2 close−1s: refused naming WEEK 2 — the previous week''s window binds the current-week bye player');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', null, 'pd-ne2',
       'ab000000-0000-4000-8000-000000000037', now()) $$,
  '%PD NE2 (pd-ne2) is locked for drops — kicked off at % (nfl_games) and week 2 clears at %',
  'R754 DROP at week-2 close−1s: refused naming WEEK 2');
update nfl_weeks set correction_window_ends_at = now() where season = 2026 and week = 2;
select set_config('pgtap.pd_r_ne', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-ne1', null,
  'ab000000-0000-4000-8000-000000000036', now())::text, true);
select is((current_setting('pgtap.pd_r_ne')::jsonb -> 'add' -> 'game_lock') - 'kickoff_at' - 'window_ends_at',
  '{"locked": false, "week": 3, "datum_arm": "bye", "on_bye": true}'::jsonb,
  'R754 ADD AT week-2''s close: LIVES and the result reports the CURRENT week''s datum (week 3, bye)');
select pg_temp.pd_undo_add('pd-ne1', 'ab000000-0000-4000-8000-000000000036');
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', null, 'pd-ne2',
       'ab000000-0000-4000-8000-000000000037', now()) $$,
  'R754 DROP AT week-2''s close: LIVES');
delete from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-ne2';
delete from transactions where action_id = 'ab000000-0000-4000-8000-000000000037';
insert into league_rosters (league_id, team_id, player_id) values ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-ne2');
update nfl_weeks set correction_window_ends_at = now() - interval '1 second' where season = 2026 and week = 2;
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-ne1', null,
       'ab000000-0000-4000-8000-000000000038', now()) $$,
  'R754 ADD at week-2 close+1s: LIVES');
select pg_temp.pd_undo_add('pd-ne1', 'ab000000-0000-4000-8000-000000000038');
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', null, 'pd-ne2',
       'ab000000-0000-4000-8000-000000000039', now()) $$,
  'R754 DROP at week-2 close+1s: LIVES');
delete from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-ne2';
delete from transactions where action_id = 'ab000000-0000-4000-8000-000000000039';
insert into league_rosters (league_id, team_id, player_id) values ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-ne2');
update nfl_weeks set correction_window_ends_at = now() - interval '2 days' where season = 2026 and week = 2;   -- restore: week 2 closed
delete from nfl_games where id = 'pd-w2-a';
-- R758: a BENCH-only drop reports its lineup row with slot NULL (never under-reports).
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select set_config('pgtap.pd_r_bn', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-te1',
  'ab000000-0000-4000-8000-000000000040', now())::text, true);
select is(current_setting('pgtap.pd_r_bn')::jsonb -> 'drop' -> 'lineups',
  '[{"week": 3, "slot": null, "kept_in_locked_lineup": false}, {"week": 4, "slot": null, "kept_in_locked_lineup": false}]'::jsonb,
  'R758: a bench-only drop (TE1 on both benches) reports one entry per touched row with slot NULL');
select pg_temp.pd_undo_drop('pd-te1', 'ab000000-0000-4000-8000-000000000040');

-- ---------------------------------------------------------------------------
-- G. Exclusivity + the same-league re-add honoring waiver state
-- ---------------------------------------------------------------------------
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-t1a', null,
       'ab000000-0000-4000-8000-000000000041', now()) $$,
  '%PD T1A (pd-t1a) is already on PD T1''s roster in this league — a player is on ONE roster per league (player exclusivity%',
  'G1 EXCLUSIVITY: a player on ANOTHER team refuses with the friendly P0001 naming the team (never a raw 23505)');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-wr2', null,
       'ab000000-0000-4000-8000-000000000041', now()) $$,
  '%PD WR2 (pd-wr2) is already on PD T2''s roster in this league%',
  'G1 …and your OWN player refuses the same way');
-- G2. T2 drops WR2 (MIA, bye — unlocked; drafted — no hold) → on_waivers 48h.
select set_config('pgtap.pd_r_g2', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-wr2',
  'ab000000-0000-4000-8000-000000000042', now())::text, true);
select results_eq(
  $$ select state, waivers_until from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-wr2' $$,
  $$ values ('on_waivers', now() + interval '48 hours') $$,
  'G2 the dropped bench player enters waivers for waiver_period_hours');
select is(current_setting('pgtap.pd_r_g2')::jsonb -> 'drop' -> 'fa_hold',
  jsonb_build_object('hours', 24, 'acquisition_type', 'draft', 'acquired_at', now(), 'early', false),
  'G2 fa_hold is NOT early for a drafted player (acquisition_type draft) even with a 24h hold');
-- G3. T3 (u3) adds WR2: refused while on waivers; −1s before the lapse refused; AT the lapse lives.
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-wr2', null,
       'ab000000-0000-4000-8000-000000000043', now()) $$,
  '%PD WR2 (pd-wr2) is on waivers until % — waiver claims are M5''s; he is FCFS-addable once the period lapses (free_agency = immediate_after_waivers%',
  'G3 the same-league re-add HONORS waiver state: refused by name while waivers_until is ahead');
update league_player_pool set waivers_until = now() + interval '1 second' where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-wr2';
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-wr2', null,
       'ab000000-0000-4000-8000-000000000043', now()) $$,
  '%PD WR2 (pd-wr2) is on waivers until %',
  'G3 waivers_until − 1s: still refused');
update league_player_pool set waivers_until = now() where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-wr2';
select set_config('pgtap.pd_r_g3', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-wr2', null,
  'ab000000-0000-4000-8000-000000000043', now())::text, true);
select is(current_setting('pgtap.pd_r_g3')::jsonb -> 'add' ->> 'from_state', 'on_waivers_lapsed',
  'G3 AT the lapse (waivers_until = now): T3 adds him FCFS — from_state on_waivers_lapsed (immediate_after_waivers; state evaluated at read, no sweeper)');
select results_eq(
  $$ select team_id, slot_key from league_rosters where player_id = 'pd-wr2' $$,
  $$ values ('cd000000-0000-4000-8000-000000000003'::uuid, 'bn') $$,
  'G3 …WR2 is on T3''s bench; exclusivity held through the drop → waivers → add cycle');
select results_eq(
  $$ select state, waivers_until from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-wr2' $$,
  $$ values ('rostered', null::timestamptz) $$,
  'G3 …the pool row flipped to rostered with waivers_until cleared (the mirror)');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

-- ---------------------------------------------------------------------------
-- H. The LAX league (L2, as u6): player_game_lock FALSE, first_game_of_week,
--    none_fcfs, continuous — E34 and the lax controls
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select set_config('pgtap.pd_r_h1', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000011', 'pd-s-fa2', 'pd-s-qb',
  'ab000000-0000-4000-8000-000000000051', now())::text, true);
select is(current_setting('pgtap.pd_r_h1')::jsonb -> 'add' -> 'game_lock' ->> 'locked', 'true',
  'H1 LAX CONTROL (player_game_lock = false): a KICKED-OFF free agent (S FA2, KC) is ADDED inside the window — the lock is evaluated (locked: true) but not enforced');
select is(current_setting('pgtap.pd_r_h1')::jsonb -> 'drop' -> 'game_lock' ->> 'locked', 'true',
  'H1 LAX CONTROL: the KICKED-OFF starter (S QB, KC) is DROPPED inside the window — evaluated, not enforced');
select results_eq(
  $$ select state, waivers_until from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000002' and player_id = 'pd-s-qb' $$,
  $$ values ('free_agent', null::timestamptz) $$,
  'H1 none_fcfs: the dropped player goes STRAIGHT to free agency (no waivers_until)');
select is(current_setting('pgtap.pd_r_h1')::jsonb -> 'drop' -> 'lineups',
  '[{"week": 3, "slot": "qb:0", "kept_in_locked_lineup": true}]'::jsonb,
  'H1 E34: the dropped starter''s slot is week-locked (first_game_of_week; KC kicked off) so the entry is KEPT — his stats still count for the dropping team; the player entered the pool');
select is((select slot_map from team_lineups where team_id = 'cd000000-0000-4000-8000-000000000011' and week = 3),
  '{"qb:0": "pd-s-qb", "rb:0": "pd-s-rb", "wr:0": "pd-s-wr"}'::jsonb,
  'H1 …the locked lineup is byte-unchanged (read-only, §11.2) while the roster row is gone');
select is((select count(*)::int from league_rosters where league_id = 'bd000000-0000-4000-8000-000000000002' and player_id = 'pd-s-qb'), 0,
  'H1 …S QB is off the roster');
-- H2. continuous: a LAPSED on_waivers player refuses by name; a fresh free agent still adds.
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000011', 'pd-s-w', null,
       'ab000000-0000-4000-8000-000000000052', now()) $$,
  '%PD S W (pd-s-w) cleared waivers at % but free_agency = continuous keeps unclaimed players on waivers until the processor clears them (M5%',
  'H2 free_agency = continuous: a LAPSED on_waivers player is NOT FCFS-addable — refused by name (the processor is M5''s)');
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000002', 'cd000000-0000-4000-8000-000000000011', 'pd-s-fa1', null,
       'ab000000-0000-4000-8000-000000000053', now()) $$,
  'H2 …while a FRESH free agent (no pool row) adds under continuous — §13.1''s "add an unowned player" is unconditional');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

-- ---------------------------------------------------------------------------
-- I. fa_hold_hours (L1, 24h): hold−1s → FA (early); hold+0 → waivers
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa4', null,
       'ab000000-0000-4000-8000-000000000061', now()) $$,
  'I fixture: FA4 (bye) added at now (acquired_at = now)');
select set_config('pgtap.pd_r_i1', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-fa4',
  'ab000000-0000-4000-8000-000000000062', now() + interval '24 hours' - interval '1 second')::text, true);
select results_eq(
  $$ select state, waivers_until from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-fa4' $$,
  $$ values ('free_agent', null::timestamptz) $$,
  'I1 dropped at hold−1s (23h59m59s held): returns to FREE AGENCY, not waivers (§7.3.4 fa_hold_hours)');
select is(current_setting('pgtap.pd_r_i1')::jsonb -> 'drop' -> 'fa_hold',
  jsonb_build_object('hours', 24, 'acquisition_type', 'free_agent', 'acquired_at', now(), 'early', true),
  'I1 …the result says early: true against the free_agent acquisition');
-- re-acquire at now (the fixture's own re-insert) and drop AT the hold.
delete from transactions where action_id = 'ab000000-0000-4000-8000-000000000062';
delete from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-fa4';
insert into league_rosters (league_id, team_id, player_id, slot_key, acquisition_type, acquired_at)
values ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa4', 'bn', 'free_agent', now());
select set_config('pgtap.pd_r_i2', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-fa4',
  'ab000000-0000-4000-8000-000000000063', now() + interval '24 hours')::text, true);
select results_eq(
  $$ select state, waivers_until from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-fa4' $$,
  $$ values ('on_waivers', now() + interval '24 hours' + interval '48 hours') $$,
  'I2 dropped AT the hold (24h held exactly): enters WAIVERS — the one-unit twin (held ≥ hold is inclusive)');
select is(current_setting('pgtap.pd_r_i1')::jsonb ->> 'week', '3', 'I the +24h instants are still week 3 (week 4 starts in 6 days) — tenure, not the calendar, is what these cells measure');
select pg_temp.pd_undo_add('pd-fa4', 'ab000000-0000-4000-8000-000000000061');
delete from transactions where action_id = 'ab000000-0000-4000-8000-000000000063';

-- ---------------------------------------------------------------------------
-- J. Caps (L3 as u2 on C1): 2/week, 3/season — counted from transactions
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000021', 'pd-c-f1', null,
       'ab000000-0000-4000-8000-000000000071', now()) $$,
  'J1 add #1 of the week lives (1 of 2)');
select set_config('pgtap.pd_r_j2', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000021', 'pd-c-f2', null,
  'ab000000-0000-4000-8000-000000000072', now())::text, true);
select is(current_setting('pgtap.pd_r_j2')::jsonb -> 'caps',
  '{"acquisitions_per_week": "2", "acquisitions_per_season": "3", "used_week_after": 2, "used_season_after": 2}'::jsonb,
  'J2 add #2 lives — cap−1 → cap (used 2 of 2 after; caps echoed as the stored literals)');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000021', 'pd-c-f3', null,
       'ab000000-0000-4000-8000-000000000073', now()) $$,
  '%PD C1 has used 2 of 2 acquisitions in week 3 (acquisitions_per_week%',
  'J3 add #3 AT the weekly cap refuses by name');
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000021', null, 'pd-c-f1',
       'ab000000-0000-4000-8000-000000000074', now()) $$,
  'J4 a DROP-ONLY move at the cap lives (a drop is not an acquisition)');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000021', 'pd-c-f3', 'pd-c-f2',
       'ab000000-0000-4000-8000-000000000075', now()) $$,
  '%PD C1 has used 2 of 2 acquisitions in week 3%',
  'J4 …and an add+drop at the cap still refuses (the drop side does not buy an acquisition)');
-- Move the calendar to week 4 → the weekly count resets, the season count carries.
update nfl_weeks w set starts_at = now() + ((w.week - 4) * interval '7 days') - interval '1 day',
  correction_window_ends_at = now() + ((w.week - 4) * interval '7 days') - interval '1 day' + interval '6 days'
where w.season = 2026;
select is(public.lineup_current_week_internal('bd000000-0000-4000-8000-000000000003', now()), 4, 'J5 the calendar moved: current week 4');
select set_config('pgtap.pd_r_j5', public.roster_add_drop_internal(
  'bd000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000021', 'pd-c-f3', null,
  'ab000000-0000-4000-8000-000000000076', now())::text, true);
select is(current_setting('pgtap.pd_r_j5')::jsonb -> 'caps',
  '{"acquisitions_per_week": "2", "acquisitions_per_season": "3", "used_week_after": 1, "used_season_after": 3}'::jsonb,
  'J5 week 4: the weekly count restarted (1 of 2) and the season count reached 3 of 3 — season cap−1 → cap lives');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000003', 'cd000000-0000-4000-8000-000000000021', 'pd-c-f4', null,
       'ab000000-0000-4000-8000-000000000077', now()) $$,
  '%PD C1 has used 3 of 3 acquisitions this season (acquisitions_per_season%',
  'J6 the 4th acquisition AT the season cap refuses by name');
update nfl_weeks w set starts_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day',
  correction_window_ends_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day' + interval '6 days'
where w.season = 2026;   -- restore: current week 3

-- ---------------------------------------------------------------------------
-- K. Capacity (L1 T2, roster_size 8)
-- ---------------------------------------------------------------------------
-- T2 holds QB1 RB1 WR1 TE1 FA3 = 5. Fill with FA2 (DAL, +1s) and FA5 (PHI, +1s) → 7, then FA1 needs a drop.
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa2', null,
       'ab000000-0000-4000-8000-000000000081', now()) $$, 'K fixture: FA2 added (6 of 8)');
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa5', null,
       'ab000000-0000-4000-8000-000000000082', now()) $$, 'K fixture: FA5 added (7 of 8)');
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa4', null,
       'ab000000-0000-4000-8000-000000000083', now()) $$, 'K fixture: FA4 added (8 of 8 — the last seat)');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-s-w', null,
       'ab000000-0000-4000-8000-000000000084', now()) $$,
  '%PD T2''s roster is full (8 of 8 — §7.3.2 roster_size) — include a drop in the same move%',
  'K1 an add onto a FULL roster refuses by name (roster_size = Σ starters + bench + IR = 3 + 4 + 1)');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', null, 'pd-wr2',
       'ab000000-0000-4000-8000-000000000085', now()) $$, 'K fixture: T3 drops WR2 (a free-agent add held < 24h — back to free agency, fa_hold)');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-wr2', 'pd-fa4',
       'ab000000-0000-4000-8000-000000000086', now()) $$,
  'K2 the same add WITH a drop in the same move lives on the full roster (8 → 8) — the one-unit positive');
select is((select count(*)::int from league_rosters where team_id = 'cd000000-0000-4000-8000-000000000002'), 8, 'K2 …T2 holds exactly 8');
select is((select count(*)::int from league_player_pool p where p.league_id = 'bd000000-0000-4000-8000-000000000001' and p.state = 'rostered'
             and not exists (select 1 from league_rosters r where r.league_id = p.league_id and r.player_id = p.player_id)), 0,
  'K2 the pool MIRROR holds league-wide after the cycle: no rostered pool row without a roster row (D294)');

-- ---------------------------------------------------------------------------
-- L. Loud emptiness + validation, every refusal by name (rule 10)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, null,
       'ab000000-0000-4000-8000-000000000091', now()) $$,
  '22023', null, 'L both sides empty is 22023');
select throws_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-wr2', 'pd-wr2',
       'ab000000-0000-4000-8000-000000000091', now()) $$,
  '22023', null, 'L add = drop is 22023');
select throws_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       null, now()) $$,
  '22023', null, 'L a missing action_id is 22023 (idempotency key required)');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-nobody', null,
       'ab000000-0000-4000-8000-000000000091', now()) $$,
  '%no player with id pd-nobody (add)%', 'L an unknown player (add) refuses by name');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-fa1',
       'ab000000-0000-4000-8000-000000000091', now()) $$,
  '%PD FA1 (pd-fa1) is not on PD T2''s roster — nobody in league % rosters him%', 'L dropping an unowned player refuses by name');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-t1a',
       'ab000000-0000-4000-8000-000000000091', now()) $$,
  '%PD T1A (pd-t1a) is on PD T1''s roster, not PD T2''s — a manager drops only his own players%', 'L dropping ANOTHER team''s player refuses by name');
select throws_ok(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000011', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000091', now()) $$,
  '42501', null, 'L a team of ANOTHER league is the no-leak 42501 (u2 does not manage S1)');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000004', 'cd000000-0000-4000-8000-000000000031', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000091', now()) $$,
  '%league % is scheduled — rosters change through add/drop only while in_season or in playoffs%', 'L a league not in season (L4) refuses by name');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
update teams set status = 'retired' where id = 'cd000000-0000-4000-8000-000000000003';
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000091', now()) $$,
  '%team % is retired — a sealed franchise makes no moves%', 'L a retired team refuses by name');
update teams set status = 'active' where id = 'cd000000-0000-4000-8000-000000000003';
-- A broken mirror refuses loudly (D294: asserted, never healed): a rostered pool row with no roster row.
insert into league_player_pool (league_id, player_id, state) values ('bd000000-0000-4000-8000-000000000001', 'pd-fa1', 'rostered');
select throws_like(
  $$ select public.roster_add_drop_internal('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000003', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000092', now()) $$,
  '%league_player_pool says PD FA1 (pd-fa1) is rostered in league % but league_rosters has no row — the pool mirror is broken%',
  'L a BROKEN MIRROR (rostered pool row, no roster row) refuses by name naming reconciliation — never silently healed (D294)');
delete from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' and player_id = 'pd-fa1';
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- M. Roles through the PUBLIC verb (roster_add_drop — transaction now()) +
--    the three tables' no-client-write pins (§4.2)
-- ---------------------------------------------------------------------------
select cmp_ok((select count(*)::int from transactions where league_id = 'bd000000-0000-4000-8000-000000000001'), '>=', 5,
  'postgres sees T2/T3''s transactions rows (the SELECT-sees-N premise)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.roster_add_drop('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000101') $$,
  '42501', 'roster_add_drop: not the manager of this team', 'M an OUTSIDER is refused with the one no-leak 42501');
select is((select count(*)::int from transactions), 0, 'M …and reads no transactions');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.roster_add_drop('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000101') $$,
  '42501', 'roster_add_drop: not the manager of this team', 'M a MEMBER who does not manage T2 (no cache team_id) is refused');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.roster_add_drop('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000101') $$,
  '42501', 'roster_add_drop: not the manager of this team', 'M the COMMISSIONER on another team is refused — a commissioner roster move is M6''s commissioner_move (F227(d))');
select cmp_ok((select count(*)::int from transactions where league_id = 'bd000000-0000-4000-8000-000000000001'), '>=', 5,
  'M the commissioner (a member) READS the league''s transactions (109''s member SELECT)');
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select public.roster_add_drop('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1', null,
       'ab000000-0000-4000-8000-000000000101') $$,
  '42501', null, 'M anon is refused (no EXECUTE)');
reset role;
-- The manager through the public verb (transaction now()): FA5 (PHI, +1s) for FA2 (DAL, +1s).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select set_config('pgtap.pd_r_m', public.roster_add_drop('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002',
  null, 'pd-fa2', 'ab000000-0000-4000-8000-000000000102')::text, true);
select is(current_setting('pgtap.pd_r_m')::jsonb -> 'drop' ->> 'to_state', 'free_agent',
  'M the MANAGER''s public call lands at transaction now(): FA2 (a free-agent add held < 24h) drops back to free agency');
select throws_like(
  $$ select public.roster_add_drop('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa3', null,
       'ab000000-0000-4000-8000-000000000103') $$,
  '%PD FA3 (pd-fa3) is already on PD T2''s roster%',
  'M …and the friendly exclusivity refusal reaches the wire as P0001 (FA3 is on T2 already)');
-- Direct writes: none for the manager (RETURNING counts), none for the commissioner.
select cmp_ok((select count(*)::int from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001'), '>=', 3,
  'the manager SELECTs the league''s pool rows (109''s member SELECT — the premise)');
select throws_ok(
  $$ insert into league_player_pool (league_id, player_id, state) values ('bd000000-0000-4000-8000-000000000001', 'pd-fa1', 'free_agent') $$,
  '42501', null, 'the manager cannot INSERT a pool row');
select results_eq(
  $$ with w as (update league_player_pool set state = 'free_agent' where league_id = 'bd000000-0000-4000-8000-000000000001' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'the manager''s pool UPDATE touches 0 rows');
select results_eq(
  $$ with w as (delete from league_player_pool where league_id = 'bd000000-0000-4000-8000-000000000001' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'the manager''s pool DELETE touches 0 rows');
select throws_ok(
  $$ insert into transactions (league_id, type, payload) values ('bd000000-0000-4000-8000-000000000001', 'add_drop', '{}') $$,
  '42501', null, 'the manager cannot INSERT a transactions row');
select results_eq(
  $$ with w as (update transactions set status = 'reversed' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'the manager''s transactions UPDATE touches 0 rows');
select results_eq(
  $$ with w as (delete from transactions returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'the manager''s transactions DELETE touches 0 rows');
select throws_ok(
  $$ insert into league_rosters (league_id, team_id, player_id) values ('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa1') $$,
  '42501', null, 'the manager cannot INSERT a roster row (exclusivity + caps live in the RPC — §12.7)');
select results_eq(
  $$ with w as (delete from league_rosters where team_id = 'cd000000-0000-4000-8000-000000000002' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'the manager''s roster DELETE touches 0 rows');
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select results_eq(
  $$ with w as (update league_player_pool set state = 'free_agent' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'the commissioner''s direct pool UPDATE touches 0 rows — no client write policy for ANY role');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from transactions where status = 'reversed'), 0, '…and postgres confirms nothing was written');

-- ---------------------------------------------------------------------------
-- N. Held lock — the min RTT over three roster_add_drop calls (as u2) < 50 ms
-- ---------------------------------------------------------------------------
create temp table pd_rtt (secs double precision) on commit drop;
grant select, insert on pd_rtt to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9d000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
do $$
declare v_t0 timestamptz; v_i int; begin
  for v_i in 1..3 loop
    v_t0 := clock_timestamp();
    -- alternate: drop FA5 / add FA5 back (PHI, one second ahead — never locked; a free-agent add held < 24h returns to FA, so the re-add is FCFS)
    if v_i % 2 = 1 then
      perform public.roster_add_drop('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', null, 'pd-fa5',
        ('ab000000-0000-4000-8000-0000000001' || (10 + v_i)::text)::uuid);
    else
      perform public.roster_add_drop('bd000000-0000-4000-8000-000000000001', 'cd000000-0000-4000-8000-000000000002', 'pd-fa5', null,
        ('ab000000-0000-4000-8000-0000000001' || (10 + v_i)::text)::uuid);
    end if;
    insert into pd_rtt values (extract(epoch from clock_timestamp() - v_t0));
  end loop;
end $$;
select cmp_ok((select min(secs) from pd_rtt), '<', 0.05::double precision,
  'held-lock discipline (rule 8): the min RTT of three roster_add_drop calls is under 50 ms');
reset role;

select * from finish();
rollback;
