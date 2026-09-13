-- ============================================================================
-- `commish_move_player` / `commish_force_add_drop` — pgTAP 075 (migration 127;
-- task L.E1.6 of M6A; spec §15.4:1694-1695, §13.1, E32, §12.7, §10.3;
-- CLAUDE.md business rule 7; tasks-M6A §3 D336/D346/D350/D353 and §4 rules
-- 1-15; PROGRESS §3 STANDING RULE clauses (b), (g), (i)).
--
-- Numbering: pgTAP head measured 074 by `ls supabase/tests/ | tail -1` ⇒ 075.
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rules 9 + 14):
--   * **THE PAIRED LOCK CONTRAST IS §C AND ITS TWO CELLS ARE ADJACENT (C2/C3)
--     SO NEITHER CAN DRIFT.** The MANAGER's verb refuses the drop of a
--     kicked-off starter BY MESSAGE, and the COMMISSIONER's verb lands the
--     SAME drop of the SAME player at the SAME instant — both through the
--     public doors, both on `now()`, one statement apart. Without the manager
--     cell the commissioner cell proves only that a function ran; without the
--     commissioner cell the manager cell is 061's, already green. **C4 then
--     asserts the receipt NAMES what it walked past** (`e32_drop_lock:cr-qb1`
--     in `bypassed[]`) — a rule bypassed in silence is not a receipt.
--   * **EXCLUSIVITY IS ASSERTED AS A REFUSAL, NOT AS A DISJUNCTION (§E).**
--     tasks-M6A §6 item 3 already decided the behaviour, so the cell asserts
--     it: a force-ADD of a player rostered on another team in this league is
--     REFUSED BY MESSAGE (E1) **and the roster is UNCHANGED afterwards** (E2)
--     — the "not silently moved" half, which a message-only cell cannot see.
--     A cell phrased "refused, or moved — say which" is satisfiable by
--     whichever branch the Builder wrote, and is a proof that cannot fail.
--   * **THE NO-OP IS ASSERTED FIVE WAYS (§G, Chris's one condition).** The
--     document says `no_changes = true` with a NAMED reason and a NULL
--     `commissioner_action_id`; the `commissioner_actions` count is UNCHANGED;
--     the `league_chat` count is UNCHANGED; the `transactions` count is
--     UNCHANGED; and the replay-ledger row IS written anyway. Each of the
--     three counts is captured as a literal BEFORE the call (G0), because a
--     count asserted only afterwards is satisfiable by a table that was
--     already empty.
--   * **THE STAMP CELL IS AN EQUALITY, NOT AN INEQUALITY (H2).** 071's
--     starvation cell asserts `enqueued_at <= min(updated_at)`, which a stamp
--     of `-infinity` would also satisfy just as well as the right one. H2
--     asserts the queue row carries the player's `player_stats.updated_at`
--     EXACTLY, which reds under a `now()` stamp and under any constant.
--     **WHAT IT DOES NOT PROVE, SAID PLAINLY: MIN vs MAX.** `player_stats`
--     carries `UNIQUE(player_id, season, week)` (`001:171` — measured, after a
--     first cut of this fixture tried to plant two rows and was refused by the
--     constraint), so there is exactly ONE row per player-week and MIN, MAX and
--     "the only row" are the same value. The `min(...)` in the migration is
--     therefore defence against a schema that would permit several — which is
--     what `123:236-238` assumes — and this suite pins the equality, not the
--     aggregate choice. No cell here claims otherwise.
--   * **THE SCORING ARMS ARE WALKED, NOT ASSUMED.** `score_enqueued` (§C),
--     `stats_unstamped` + `score_stale` (§D), `no_stat_row` + NOT stale (§H1),
--     and `week_final` on a closed week with NOTHING enqueued (§H6, on its own
--     league so no earlier cell's week has to be moved under it).
--   * **THE WIDENING IS PINNED WITH ITS PREMISE (§B9 + §J).** B9 asserts
--     `edited_by_commish` is FALSE on the row the MANAGER set, so §J's TRUE is
--     a transition and not a fixture default. The user-visible half is
--     `team-page.render.test.ts` at the same state (F344).
--   * **NEVER-WEAKEN PINS (§K), the `071:835-867` shape.** 115's
--     `roster_add_drop_internal` still carries its manager-only refusal and
--     BOTH E32 refusal strings in `prosrc`, still names `is_league_commish`
--     ZERO times, and both it and `roster_add_drop` are still ONE overload
--     each. The commissioner exemption is a property of the NEW verb; a PR
--     that "unified" them would red here and nowhere else.
--   * **THE LEGALITY GATES THAT BIND ARE ASSERTED AS REFUSALS (§N)** —
--     `roster_size`, a `retired` franchise (F352) and D294's broken mirror.
--     Standing rule (i): a TIMING refusal is a defect to fix; a VALIDITY
--     refusal binds the commissioner too. F324's legality half is RECORDED
--     here, not decided — if Chris rules the other way each of these is one
--     clause.
--   * ROLES (§L): the edited team's own manager, an outsider, a non-managing
--     member and anon all get the SAME no-leak 42501 — and so does a league
--     that does not exist, which is what makes it no-leak.
--   * The 2026 calendar is re-asserted RELATIVE to now() (061's R724/R730
--     shape): current week 3; KC kicked off ONE SECOND ago, DAL/PHI kick off
--     in one second, NYG/SF in three hours, MIA is a bye. No pin rots with the
--     wall clock.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(128);

-- ---------------------------------------------------------------------------
-- A. FORM PINS — the ledger (D350), the two doors, the two internals
--    (§4.1 grants doctrine; §4 rule 12).
-- ---------------------------------------------------------------------------
select has_table('public', 'commish_roster_actions',
  'A1 commish_roster_actions exists — this verb family''s OWN replay ledger (D350: no two verbs share a (league_id, action_id) namespace)');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'commish_roster_actions'),
  0, 'A2 …with ZERO policies: the DEFINER verbs are its only reader and writer, so no client can pre-plant a replay row (the attack commissioner_actions'' printed INSERT policy makes possible — 123:333-335)');
select ok(
  exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid
          where r.relname = 'commish_roster_actions' and c.contype = 'u'
            and pg_get_constraintdef(c.oid) = 'UNIQUE (league_id, action_id)'),
  'A3 …and UNIQUE (league_id, action_id) is the race backstop behind the select-then-insert');
-- D350 / F348's lesson: RLS does NOT cover TRUNCATE and a pg_policies cell
-- structurally cannot see the grant, so this is asserted PER ROLE.
select ok(
  not has_table_privilege('anon', 'public.commish_roster_actions', 'TRUNCATE'),
  'A4 REVOKE TRUNCATE — anon holds no TRUNCATE on the ledger (RLS does not cover TRUNCATE and the Supabase default grants it; F348 is the table that proved it)');
select ok(
  not has_table_privilege('authenticated', 'public.commish_roster_actions', 'TRUNCATE'),
  'A5 …and neither does authenticated (asserted per role with has_table_privilege — a pg_policies cell cannot see a TRUNCATE grant at all)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_move_player', 'commish_force_add_drop',
                       'commish_roster_override_internal', 'commish_roster_lineup_sync_internal')),
  4, 'A6 the four 127 functions exist, ONE overload each');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_move_player', 'commish_force_add_drop')),
  'A7 both client doors are SECURITY DEFINER with search_path='''' (rule 2)');
select ok(
  (select bool_and(not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_roster_override_internal', 'commish_roster_lineup_sync_internal')),
  'A8 both internals are PLAIN with search_path='''' — a seam, not a door (123:498-505''s posture)');
select ok(
  not has_function_privilege('anon', 'public.commish_move_player(uuid,text,uuid,uuid,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commish_move_player(uuid,text,uuid,uuid,text,uuid)', 'EXECUTE'),
  'A9 commish_move_player: anon holds no EXECUTE (REVOKE FROM PUBLIC, anon); authenticated may call — the commissioner check is IN-BODY');
select ok(
  not has_function_privilege('anon', 'public.commish_force_add_drop(uuid,uuid,text,text,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commish_force_add_drop(uuid,uuid,text,text,text,uuid)', 'EXECUTE'),
  'A10 commish_force_add_drop: the same posture');
select ok(
  not has_function_privilege('authenticated', 'public.commish_roster_override_internal(uuid,uuid,text,text,text,uuid,uuid,uuid,timestamptz,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_roster_override_internal(uuid,uuid,text,text,text,uuid,uuid,uuid,timestamptz,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_roster_lineup_sync_internal(uuid,uuid,integer,integer,integer,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_roster_lineup_sync_internal(uuid,uuid,integer,integer,integer,text,text)', 'EXECUTE'),
  'A11 both internals are triple-REVOKEd — no client can supply the instant (rule 10: the seam is postgres-only)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_move_player', 'commish_force_add_drop',
                       'commish_roster_override_internal', 'commish_roster_lineup_sync_internal')
     and p.prosrc like '%team_managers%'),
  0, 'A12 F35 re-affirmed: NO 127 function body names team_managers — access derives from league_members, never a stint');

-- ---------------------------------------------------------------------------
-- B. FIXTURES (postgres context — before any JWT claims), and their PREMISES.
--    L1: in_season, per_player_kickoff, faab, 48h waivers, fa_hold 0,
--        roster_size 8 (qb+rb+wr starters, bench 4, one restricted IR spot).
--        T1 u1 commissioner · T2 u2 · T3 u3 · T4 u6 (a FULL roster).
--    L2: in_season — T5 u6 commissioner, T6 RETIRED (the §N2 fixture).
--    L3: in_season — T7 u1 commissioner; its week 3 is FINAL (the §H6 arm, on
--        its own league so no earlier cell's week is moved under it).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('9e000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-cr' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'cr_user' || i)::jsonb, now(), now()
from generate_series(1, 6) i;

-- The calendar, RELATIVE to now() (061's shape): current week 3; every week
-- up to the current one carries a last_game_ends_at six days after it starts.
update nfl_weeks w
set starts_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day',
    last_game_ends_at = case when w.week <= 3 then now() + ((w.week - 3) * interval '7 days') - interval '1 day' + interval '6 days' end,
    correction_window_ends_at = now() + ((w.week - 3) * interval '7 days') - interval '1 day' + interval '8 days',
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('cr-w3-a', 2026, 3, 'KC',  'BUF', now() - interval '1 second'),
 ('cr-w3-b', 2026, 3, 'DAL', 'PHI', now() + interval '1 second'),
 ('cr-w3-c', 2026, 3, 'NYG', 'SF',  now() + interval '3 hours');

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, waiver_type, settings, roster_settings) values
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'pgtap-cr-L1', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab',
  '{"waiver_period_hours": 48, "free_agency": "immediate_after_waivers", "fa_hold_hours": 0,
    "acquisitions_per_week": "unlimited", "acquisitions_per_season": "unlimited", "allow_illegal_lineups": true}',
  '{"starting_slots": [
      {"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1},
      {"key": "rb", "label": "RB", "eligible": ["RB"], "count": 1},
      {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1}],
    "bench": 4,
    "ir_slots": [{"key": "ir1", "type": "restricted", "eligible_designations": ["OUT", "IR"], "min_weeks": 4}],
    "swap_spots": 0}'),
 ('be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000006', 'pgtap-cr-L2', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab', '{"allow_illegal_lineups": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}'),
 ('be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000001', 'pgtap-cr-L3', 2026, 'in_season', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab', '{"allow_illegal_lineups": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id) values
 ('ce000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'CR T1', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000002', 'CR T2', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000003', 'CR T3', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000004', '9e000000-0000-4000-8000-000000000006', 'CR T4', 'be000000-0000-4000-8000-000000000001'),
 ('ce000000-0000-4000-8000-000000000005', '9e000000-0000-4000-8000-000000000006', 'CR T5', 'be000000-0000-4000-8000-000000000002'),
 ('ce000000-0000-4000-8000-000000000006', '9e000000-0000-4000-8000-000000000002', 'CR T6', 'be000000-0000-4000-8000-000000000002'),
 ('ce000000-0000-4000-8000-000000000007', '9e000000-0000-4000-8000-000000000001', 'CR T7', 'be000000-0000-4000-8000-000000000003');
insert into league_members (league_id, user_id, team_id, role) values
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'commissioner'),
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002', 'manager'),
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000003', 'manager'),
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000004', 'manager'),
 ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000005', null, 'manager'),
 ('be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000006', 'ce000000-0000-4000-8000-000000000005', 'commissioner'),
 ('be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000006', 'manager'),
 ('be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000007', 'commissioner');
insert into league_weeks (league_id, season, week)
select l, 2026, g from (values ('be000000-0000-4000-8000-000000000001'::uuid),
                               ('be000000-0000-4000-8000-000000000002'),
                               ('be000000-0000-4000-8000-000000000003')) v(l),
     generate_series(1, 8) g;
insert into players (id, full_name, position, team, status) values
 ('cr-qb1', 'CR QB1', 'QB', 'KC',  'Active'),   -- T2 starter qb:0 — KC KICKED OFF ONE SECOND AGO (§C)
 ('cr-rb1', 'CR RB1', 'RB', 'DAL', 'Active'),   -- T2 starter rb:0 — no stat line at all (§H1)
 ('cr-wr1', 'CR WR1', 'WR', 'PHI', 'Active'),   -- T2 starter wr:0 — a stat line with a NULL stamp (§D)
 ('cr-wr2', 'CR WR2', 'WR', 'MIA', 'Active'),   -- T2 bench (bye)
 ('cr-te1', 'CR TE1', 'TE', 'NYG', 'Active'),   -- T2 bench
 ('cr-t3a', 'CR T3A', 'RB', 'KC',  'Active'),   -- T3's player — the exclusivity subject (§E)
 ('cr-fa1', 'CR FA1', 'WR', 'KC',  'Active'),   -- free agent, KC: LOCKED for adds (§F)
 ('cr-fa2', 'CR FA2', 'RB', 'SF',  'Active'),   -- free agent, unlocked (§N1)
 ('cr-w1',  'CR W1',  'WR', 'MIA', 'Active'),   -- on_waivers, waivers_until AHEAD (§F)
 ('cr-mir', 'CR MIR', 'TE', 'MIA', 'Active'),   -- D294's broken-mirror subject (§N3)
 ('cr-l2a', 'CR L2A', 'QB', 'MIA', 'Active'),   -- L2's RETIRED team T6 (§N2)
 ('cr-l3a', 'CR L3A', 'QB', 'MIA', 'Active'),   -- L3's T7 starter — the week_final arm (§H6)
 ('cr-f1',  'CR F1',  'QB', 'MIA', 'Active'),   -- T4's eight (a FULL roster — §N1)
 ('cr-f2',  'CR F2',  'RB', 'MIA', 'Active'),
 ('cr-f3',  'CR F3',  'WR', 'MIA', 'Active'),
 ('cr-f4',  'CR F4',  'TE', 'MIA', 'Active'),
 ('cr-f5',  'CR F5',  'WR', 'MIA', 'Active'),
 ('cr-f6',  'CR F6',  'RB', 'MIA', 'Active'),
 ('cr-f7',  'CR F7',  'WR', 'MIA', 'Active'),
 ('cr-f8',  'CR F8',  'QB', 'MIA', 'Active');

insert into league_rosters (league_id, team_id, player_id) values
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'cr-qb1'),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'cr-rb1'),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'cr-wr1'),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'cr-wr2'),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'cr-te1'),
 ('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000003', 'cr-t3a'),
 ('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000006', 'cr-l2a'),
 ('be000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000007', 'cr-l3a');
insert into league_rosters (league_id, team_id, player_id)
select 'be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000004', 'cr-f' || i
from generate_series(1, 8) i;
insert into league_player_pool (league_id, player_id, state, waivers_until) values
 ('be000000-0000-4000-8000-000000000001', 'cr-w1', 'on_waivers', now() + interval '24 hours'),
 -- D294's BROKEN MIRROR: `rostered` in the pool, on NO roster (§N3).
 ('be000000-0000-4000-8000-000000000001', 'cr-mir', 'rostered', null);

-- cr-qb1's week-3 line, written 90 minutes ago. ONE row and not two:
-- player_stats carries UNIQUE(player_id, season, week) (001:171), so a
-- player-week has exactly one line and MIN(updated_at) IS that line's stamp.
insert into player_stats (player_id, season, week, stat_type, updated_at) values
 ('cr-qb1', 2026, 3, 'weekly', now() - interval '90 minutes'),
 -- cr-wr1's line EXISTS but carries a NULL stamp — the queue cannot stamp it
 -- (R968's `stats_unstamped` arm, §D).
 ('cr-wr1', 2026, 3, 'weekly', null),
 -- cr-te1 is a BENCH player of T2 with a healthy stamp: he is the REACH
 -- candidate that makes T2's league-week reachable after cr-qb1's roster row
 -- is deleted (F353). Nothing scores him differently — he is how the drain
 -- ARRIVES.
 ('cr-te1', 2026, 3, 'weekly', now() - interval '45 minutes'),
 ('cr-l3a', 2026, 3, 'weekly', now() - interval '90 minutes');
-- cr-rb1 deliberately has NO row at all (§H1's `no_stat_row` arm).
delete from score_fanout where season = 2026 and week = 3;

-- T3's and T7's week-3 rows, planted directly (postgres context): the two
-- verbs' lineup sync UPDATES rows that EXIST and never invents one — 115's own
-- semantics, and 116's banner is explicit that materializing a lineup row is
-- the carry's job and a second writer would be a bug. T2's row is set through
-- the REAL verb below (B9) because §C/§D assert its starters[] shape.
insert into team_lineups (team_id, season, week, slot_map, starters, bench) values
 ('ce000000-0000-4000-8000-000000000003', 2026, 3, '{"rb:0": "cr-t3a"}'::jsonb,
  '[{"slot": "rb:0", "slot_key": "rb", "label": "RB", "player_id": "cr-t3a", "position": "RB", "flags": []}]'::jsonb, '[]'::jsonb),
 ('ce000000-0000-4000-8000-000000000007', 2026, 3, '{"qb:0": "cr-l3a"}'::jsonb,
  '[{"slot": "qb:0", "slot_key": "qb", "label": "QB", "player_id": "cr-l3a", "position": "QB", "flags": []}]'::jsonb, '[]'::jsonb);

-- L1's current week is LIVE (the enqueue arm); L3's walks the §12.17/F4
-- transition IN ORDER to FINAL (the week_final arm). Done after the lineup
-- rows so nothing has to be written into a closed week.
update league_weeks set status = 'live'
where league_id = 'be000000-0000-4000-8000-000000000001' and week = 3;
update league_weeks set status = 'live'
where league_id = 'be000000-0000-4000-8000-000000000003' and week = 3;
update league_weeks set status = 'correction_window'
where league_id = 'be000000-0000-4000-8000-000000000003' and week = 3;
update league_weeks set status = 'final'
where league_id = 'be000000-0000-4000-8000-000000000003' and week = 3;

select is(public.lineup_current_week_internal('be000000-0000-4000-8000-000000000001', now()), 3,
  'B1 PREMISE: L1''s current week is 3 by the nfl_weeks.starts_at boundary');
select is((select status from league_weeks where league_id = 'be000000-0000-4000-8000-000000000001' and week = 3), 'live',
  'B2 PREMISE: L1''s week 3 is LIVE — the status the enqueue arm keys on (123:1079)');
select is((select status from league_weeks where league_id = 'be000000-0000-4000-8000-000000000003' and week = 3), 'final',
  'B3 PREMISE: L3''s week 3 walked upcoming → live → correction_window → final (§12.17/F4''s transition order) — the week_final arm has a real closed week to run on');
select ok(
  (select (public.pool_game_lock_any_internal(2026, 3, 'KC', now()) ->> 'locked')::boolean),
  'B4 PREMISE: KC IS LOCKED at this instant (it kicked off one second ago) — every "the commissioner walked past E32" cell below is about a lock that is actually closed');
select ok(
  not (select (public.pool_game_lock_any_internal(2026, 3, 'PHI', now()) ->> 'locked')::boolean),
  'B5 PREMISE: PHI is NOT locked (it kicks off in one second) — so §D''s move reports an EMPTY bypassed[], which is the control that proves bypassed[] names measured bypasses and not a constant');
select is((select count(*)::int from league_rosters where league_id = 'be000000-0000-4000-8000-000000000001' and team_id = 'ce000000-0000-4000-8000-000000000004'),
  8, 'B6 PREMISE: T4''s roster holds 8 of 8 — it is FULL, so §N1''s capacity refusal is about a real boundary');
select ok(
  (select count(*)::int from player_stats where player_id = 'cr-te1' and season = 2026 and week = 3) = 1
  and (select updated_at < now() - interval '40 minutes' from player_stats where player_id = 'cr-te1' and season = 2026 and week = 3),
  'B7 PREMISE: cr-te1 carries exactly ONE week-3 stat line and it is 45 minutes old — so §H2''s equality is against a value that is NOT now() and NOT a constant this file could have guessed. (ONE row, not two: player_stats carries UNIQUE(player_id, season, week) at 001:171, measured — so MIN and MAX coincide and no cell here claims to tell them apart)');
select is((select count(*)::int from score_fanout where season = 2026 and week = 3), 0,
  'B8 PREMISE: the week-3 queue starts EMPTY — every score_fanout count below is this verb''s work');

-- T2's week-3 lineup, set BY THE MANAGER through the real verb: qb cr-qb1 /
-- rb cr-rb1 / wr cr-wr1; bench cr-te1, cr-wr2. Set two seconds before KC's
-- kickoff so cr-qb1 can legally enter the slot.
-- Run as POSTGRES with the manager's JWT claim set, never `set local role
-- authenticated`: `set_lineup_internal` is the triple-REVOKEd instant seam
-- (rule 10), so a client role cannot reach it at all — while the body's
-- in-body auth still reads `auth.uid()` from the claim (061's pattern).
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.set_lineup_internal('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 3,
       '{"qb:0": "cr-qb1", "rb:0": "cr-rb1", "wr:0": "cr-wr1"}', 'af000000-0000-4000-8000-000000000001', now() - interval '2 seconds') $$,
  'B9 fixture: T2''s week-3 lineup set BY ITS OWN MANAGER');
select set_config('request.jwt.claims', '', true);
select is((select edited_by_commish from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3), false,
  'B10 PREMISE FOR F344: the manager''s own lineup carries edited_by_commish = FALSE — so §J''s TRUE is a TRANSITION this verb caused, not a fixture default');
select is((select slot_map from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3),
  '{"qb:0": "cr-qb1", "rb:0": "cr-rb1", "wr:0": "cr-wr1"}'::jsonb,
  'B11 PREMISE: the stored week-3 map is the submitted one');
-- Captured as a literal so §J2 compares against the MANAGER's value rather
-- than against "not null", which a verb that overwrote it would also satisfy.
select set_config('pgtap.cr_set_at', coalesce((select set_at::text from team_lineups
  where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3), ''), true);

-- ---------------------------------------------------------------------------
-- C. THE PAIRED LOCK CONTRAST — the manager's verb REFUSES, the commissioner's
--    verb LANDS, the SAME player at the SAME instant. C2 and C3 are adjacent
--    ON PURPOSE: separated, either one alone proves nothing about the other.
-- ---------------------------------------------------------------------------
select set_config('pgtap.cr_actions_before', (select count(*)::text from commissioner_actions), true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.roster_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       null, 'cr-qb1', 'af000000-0000-4000-8000-000000000002'::uuid) $$,
  'P0001', null,
  'C2 THE CONTRAST (1/2): the MANAGER''s verb REFUSES this exact drop at this exact instant — cr-qb1''s game kicked off one second ago (E32, 115:528-537, unconditional under Q34(B))');

select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       null, 'cr-qb1', 'a manager who never showed', 'af000000-0000-4000-8000-000000000003'::uuid) $$,
  'C3 THE CONTRAST (2/2): the COMMISSIONER''s verb LANDS the same drop of the same player at the same instant — standing rule (g): the game-day lock does not bind him');
reset role;
select set_config('request.jwt.claims', '', true);

select set_config('pgtap.cr_drop', (select result::text from commish_roster_actions
  where action_id = 'af000000-0000-4000-8000-000000000003'), true);
select is(current_setting('pgtap.cr_drop')::jsonb -> 'bypassed', '["e32_drop_lock:cr-qb1"]'::jsonb,
  'C4 …and the receipt NAMES WHAT IT WALKED PAST: bypassed[] carries e32_drop_lock:cr-qb1. A rule bypassed in silence is not a receipt (§4 rule 15)');
select is(current_setting('pgtap.cr_drop')::jsonb ->> 'action_type', 'force_drop',
  'C5 the action_type is force_drop (already in §12.12''s printed vocabulary — no new column, D336)');
select is(current_setting('pgtap.cr_drop')::jsonb ->> 'arm', 'drop', 'C6 …and the arm says which half ran');
select ok((current_setting('pgtap.cr_drop')::jsonb ->> 'drop_game_lock') is not null,
  'C7 …and the whole lock document rides the receipt, so the claim in bypassed[] is auditable rather than asserted');
select is((select count(*)::int from league_rosters
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-qb1'), 0,
  'C8 the roster row is GONE (115:638-645''s shape, with its loud ROW_COUNT assertion)');
select is((select state from league_player_pool
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-qb1'), 'on_waivers',
  'C9 THE POOL MIRROR is consistent after the drop: faab + fa_hold 0 ⇒ on_waivers (D294''s post-write assertion is what refuses if it is not)');
select ok((select waivers_until > now() from league_player_pool
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-qb1'),
  'C10 …and carries its clearing instant (the pool_waivers_until_iff_on_waivers CHECK would have refused otherwise — F222(a))');
select is((select slot_map from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3),
  '{"rb:0": "cr-rb1", "wr:0": "cr-wr1"}'::jsonb,
  'C11 THE EVICTION: the dropped player is GONE from the FROM team''s slot_map — the slot reads empty (Q32: the entry is ALWAYS cleared, there is no kept phantom)');
select is((select starters -> 0 ->> 'player_id' from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3), null,
  'C12 …and the starters[] entry for qb:0 is nulled with flags ["empty"] (115:696-701''s rewrite)');
select is((select starters -> 0 -> 'flags' from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3), '["empty"]'::jsonb,
  'C13 …by name');
select is(current_setting('pgtap.cr_drop')::jsonb ->> 'vacated_current_slot', 'qb:0',
  'C14 …and the receipt says WHICH current-week slot it emptied — measured by the sync helper and returned, never assumed by the caller');

-- THE TRANSACTIONS ROW: all three commissioner-shaped fields.
select is((select type from transactions where action_id = 'af000000-0000-4000-8000-000000000003'), 'commissioner_move',
  'C15 the transactions row is type = commissioner_move (109:239-241''s CHECK already held the value)');
select is((select initiator_team_id from transactions where action_id = 'af000000-0000-4000-8000-000000000003'), null,
  'C16 …with initiator_team_id NULL — 109:243''s documented meaning, and it is ALSO what keeps a commissioner add out of the team''s acquisition count (115:497-506 counts by that column)');
select ok(
  (select t.related_action_id = a.id
   from transactions t join commissioner_actions a on a.id = t.related_action_id
   where t.action_id = 'af000000-0000-4000-8000-000000000003'),
  'C17 …and related_action_id resolves to the audit row: this verb is the column''s FIRST writer (the FK landed at 123:461-462 with zero rows behind it)');

-- ONE audit row, with D353's affected_team_ids.
select is((select count(*)::int from commissioner_actions) - current_setting('pgtap.cr_actions_before')::int, 1,
  'C18 EXACTLY ONE audit row was written by that call (counted against a literal captured before it — a bare count over a table that starts empty asserts nothing)');
-- Every §C/§D audit-row cell picks its row BY ITS OWN action_id, never by
-- `order by created_at desc limit 1`: `created_at` DEFAULTs to now(), which is
-- CONSTANT for a whole transaction, so an ordered pick over the rows this
-- suite writes is nondeterministic (measured — it returned §C's row for §D's
-- cells on the first run).
select is((select action_type from commissioner_actions where metadata ->> 'action_id' = 'af000000-0000-4000-8000-000000000003'), 'force_drop',
  'C19 …action_type force_drop');
select is((select target_type || '/' || target_id from commissioner_actions where metadata ->> 'action_id' = 'af000000-0000-4000-8000-000000000003'), 'player/cr-qb1',
  'C20 …target_type player / target_id cr-qb1 — TEXT on purpose, because players.id is TEXT (123:288-289)');
select is((select metadata -> 'affected_team_ids' from commissioner_actions where metadata ->> 'action_id' = 'af000000-0000-4000-8000-000000000003'),
  '["ce000000-0000-4000-8000-000000000002"]'::jsonb,
  'C21 …and metadata.affected_team_ids names the one team a force-drop touches (D353)');
select is((select before from commissioner_actions where metadata ->> 'action_id' = 'af000000-0000-4000-8000-000000000003'),
  '{"team_id": "ce000000-0000-4000-8000-000000000002", "slot_key": "qb:0", "acquisition_type": "draft"}'::jsonb,
  'C22 …before mirrors the roster row that changed, key for key (D353) — `slot_key` is the FULL slot key `qb:0` that set_lineup wrote, measured, not the slot family');
select is((select after from commissioner_actions where metadata ->> 'action_id' = 'af000000-0000-4000-8000-000000000003'),
  '{"team_id": null, "slot_key": null, "acquisition_type": null}'::jsonb,
  'C23 …and after mirrors it key for key with the row gone — never a different shape on the two sides');
select is((select count(*)::int from league_chat
           where league_id = 'be000000-0000-4000-8000-000000000001' and is_system), 1,
  'C24 §10.3: the override auto-posts ONE system message to league chat, and it cannot be disabled');

-- THE SCORE, half (b): the enqueue and its stamp.
select is((select array_agg(player_id order by player_id) from score_fanout where season = 2026 and week = 3),
  array['cr-te1'],
  'C25 THE SCORE FOLLOWS (1/2): a roster move enqueues nothing on its own (score_fanout''s only other writer is stat ingestion), so without an enqueue the lineup moves and the score silently does not (123:196-250). What is queued here is a player THIS LEAGUE STILL ROSTERS — the DROPPED man is deliberately not queued, because his roster row is gone and the worker maps a queued player to leagues through `league_rosters` (F353)');
select is(current_setting('pgtap.cr_drop')::jsonb -> 'score_not_enqueued',
  '[{"why": "unrostered", "player_id": "cr-qb1"}]'::jsonb,
  'C26 …and the changed starter who could NOT be queued is NAMED with his reason — `unrostered` joins `no_stat_row` and `stats_unstamped`, never folded into an empty array (§4 rule 15)');
select is(current_setting('pgtap.cr_drop')::jsonb -> 'score_reach_enqueued', '["cr-te1"]'::jsonb,
  'C27 F353 — THE REACH SET, NAMED: the worker maps a queued player to LEAGUES through `league_rosters` (its own step-3 docblock: "The LEAGUE comes from the roster index"), and a force-DROP has just DELETED cr-qb1''s roster row — so his queue row maps to NOTHING and the drain would never visit this league-week at all. cr-te1 is still rostered and carries a stampable line, so he is queued to make the drain ARRIVE. `commish_edit_lineup` never needs this because the player it benches stays on the roster; that is why D346 did not anticipate it');
select is(current_setting('pgtap.cr_drop')::jsonb ->> 'score_reachable', 'true',
  'C28 …and REACHABILITY IS MEASURED, not inferred: the verb asks the worker''s own question of the state it is about to commit — does a queued row for this season-week name a player THIS league rosters?');
select is(current_setting('pgtap.cr_drop')::jsonb ->> 'score_stale', 'false',
  'C29 …so score_stale is FALSE, and the reason is the MECHANISM and not an opinion: a drop''s score does not follow from the dropped man''s queue row at all — it follows from the team being recomputed (reachable + edited_by_commish) against the CURRENT lineup, which no longer contains him. What WOULD be stale is a league-week the drain cannot reach');

-- ---------------------------------------------------------------------------
-- H2/H3 (kept here, beside their fixture): THE STARVATION TRAP, as an
--       EQUALITY. 071's cell asserts `enqueued_at <= min(updated_at)`, which
--       -infinity also satisfies. cr-qb1 has TWO week-3 lines an hour apart
--       (B7), so this tells MIN from MAX and from any constant.
-- ---------------------------------------------------------------------------
select is(
  (select f.enqueued_at from score_fanout f where f.season = 2026 and f.week = 3 and f.player_id = 'cr-te1'),
  (select min(ps.updated_at) from player_stats ps where ps.season = 2026 and ps.week = 3 and ps.player_id = 'cr-te1'),
  'H2 THE STARVATION TRAP: the queue row is stamped with the player''s OWN MIN player_stats.updated_at, EXACTLY. The worker''s readiness rule is `updated_at >= enqueued_at`, so a now() stamp is not_ready FOREVER — deferred every drain and never scored, which is worse than doing nothing');
select ok(
  (select f.enqueued_at < now() - interval '40 minutes' from score_fanout f
   where f.season = 2026 and f.week = 3 and f.player_id = 'cr-te1'),
  'H3 …and the stamp is 45 minutes in the PAST, which is what makes H2 falsifiable rather than tautological: a now() stamp reds both cells');

-- ---------------------------------------------------------------------------
-- J. THE WIDENING, PINNED (F344 / D346). B10 asserted the premise.
-- ---------------------------------------------------------------------------
select is((select edited_by_commish from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3), true,
  'J1 F344: after a commissioner force-drop out of a starting slot, the lineup row the MANAGER set now carries edited_by_commish = TRUE. This is the drain-side force (score-week-worker.ts step (5b)/R965) and it is ALSO the flag six UI readers show as "✸ commissioner-set" — the widening D346 accepted, asserted in the task that causes it');
select is(coalesce((select set_at::text from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3), ''),
  current_setting('pgtap.cr_set_at'),
  'J2 …and set_at is UNCHANGED from the value the MANAGER''s own submit left (captured as a literal at B11): nobody SET this lineup, a roster move changed it underneath — four columns, not five (the D356(5) posture)');

-- ---------------------------------------------------------------------------
-- D. commish_move_player — the happy path, both sides, and the third scoring
--    arm (a line that exists but cannot be stamped).
-- ---------------------------------------------------------------------------
select set_config('pgtap.cr_actions_before', (select count(*)::text from commissioner_actions), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-wr1',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003',
       'wrong team at the draft', 'af000000-0000-4000-8000-000000000004'::uuid) $$,
  'D1 commish_move_player moves a rostered player from one franchise to another');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('pgtap.cr_move', (select result::text from commish_roster_actions
  where action_id = 'af000000-0000-4000-8000-000000000004'), true);

select is((select team_id from league_rosters
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-wr1'),
  'ce000000-0000-4000-8000-000000000003'::uuid,
  'D2 the ONE roster row now names the destination franchise — a MOVE is an UPDATE of team_id, which is why exclusivity is preserved BY CONSTRUCTION (072:147)');
select is((select count(*)::int from league_rosters
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-wr1'), 1,
  'D3 EXCLUSIVITY HELD: exactly ONE roster row for him in this league (CLAUDE.md business rule 7 / §12.7)');
select is((select slot_key || '|' || acquisition_type || '|' || acquisition_cost::text from league_rosters
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-wr1'),
  'bn|commissioner|0',
  'D4 …landing on the bench as acquisition_type = commissioner at zero cost (072:142 already documented the value; FAAB is M5''s, F340)');
select ok((select ir_placed_week is null and ir_lock_until_week is null from league_rosters
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-wr1'),
  'D5 …with any IR stint cleared: a restricted-IR spot is a property of the franchise he left');
select is((select state from league_player_pool
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-wr1'), 'rostered',
  'D6 THE POOL MIRROR is consistent after the move: he never left a roster, so the mirror stays rostered (D294''s post-write assertion refuses if it is not)');
select is((select slot_map from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3),
  '{"rb:0": "cr-rb1"}'::jsonb,
  'D7 THE EVICTION: he is gone from the FROM team''s slot_map for the current week');
select ok((select not (bench ? 'cr-wr1') from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3),
  'D8 …and off its bench too — no ghost naming an unrostered player');
select is(current_setting('pgtap.cr_move')::jsonb -> 'affected_team_ids',
  '["ce000000-0000-4000-8000-000000000002", "ce000000-0000-4000-8000-000000000003"]'::jsonb,
  'D9 …and a TWO-team verb writes both ids, from-then-to (D353 — the activity feed filters by team, and deriving the pair from an untyped blob at read time is the shape that rots)');
select is(current_setting('pgtap.cr_move')::jsonb -> 'bypassed', '[]'::jsonb,
  'D10 THE CONTROL FOR C4: PHI is not locked (B5), so bypassed[] is EMPTY here. bypassed[] names measured bypasses, never a constant');
select is((select count(*)::int from commissioner_actions) - current_setting('pgtap.cr_actions_before')::int, 1,
  'D11 EXACTLY ONE audit row for the move');
select is((select action_type || '|' || target_type || '|' || target_id from commissioner_actions where metadata ->> 'action_id' = 'af000000-0000-4000-8000-000000000004'),
  'move_player|player|cr-wr1', 'D12 …action_type move_player, target player/cr-wr1');
select is((select metadata -> 'affected_team_ids' from commissioner_actions where metadata ->> 'action_id' = 'af000000-0000-4000-8000-000000000004'),
  '["ce000000-0000-4000-8000-000000000002", "ce000000-0000-4000-8000-000000000003"]'::jsonb,
  'D13 …and the audit row carries the pair too');
select is((select before || after from commissioner_actions where metadata ->> 'action_id' = 'af000000-0000-4000-8000-000000000004'),
  '{"team_id": "ce000000-0000-4000-8000-000000000003", "slot_key": "bn", "acquisition_type": "commissioner"}'::jsonb,
  'D14 …before and after mirror each other key for key over the row that moved (the || proves the KEY SETS are identical: a mismatch would leave the extra keys behind)');

-- THE THIRD SCORING ARM: a line that EXISTS but carries a NULL updated_at.
select is(current_setting('pgtap.cr_move')::jsonb ->> 'score_stale', 'true',
  'D15 R968 — cr-wr1''s week-3 line EXISTS but its updated_at is NULL, so the queue cannot give it a claimable stamp. That is a lineup that moved and a score that may not follow: score_stale is TRUE rather than the player being dropped from the queue in silence');
select is(current_setting('pgtap.cr_move')::jsonb ->> 'score_stale_reason', 'stats_unstamped',
  'D16 …named stats_unstamped, never folded into an empty array');
select is(current_setting('pgtap.cr_move')::jsonb -> 'score_not_enqueued',
  '[{"why": "stats_unstamped", "player_id": "cr-wr1"}]'::jsonb,
  'D17 …and the player the INSERT could not queue is NAMED with his reason');
select is((select count(*)::int from score_fanout where season = 2026 and week = 3 and player_id = 'cr-wr1'), 0,
  'D18 …and no row was queued for him — the field means "a claimable queue row EXISTS", not "this statement ran"');

-- ---------------------------------------------------------------------------
-- I. F350's SITE-LOCAL ANSWER: this verb never calls lineup_fit_internal, and
--    the map it writes is always the stored map MINUS one key — so it cannot
--    introduce a duplicate. Asserted on the destination row rather than
--    argued once in a banner, because a duplicate written here would
--    double-count in the worker's `startersOf`.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from team_lineups tl, jsonb_array_elements(tl.bench) x
           where tl.team_id = 'ce000000-0000-4000-8000-000000000003' and tl.season = 2026 and tl.week = 3
             and (x #>> '{}') = 'cr-wr1'), 1,
  'I1 F350: the moved player appears EXACTLY ONCE on the destination''s bench');
select is((select count(*)::int from team_lineups tl, jsonb_each_text(tl.slot_map) e
           where tl.team_id = 'ce000000-0000-4000-8000-000000000003' and tl.season = 2026 and tl.week = 3
             and e.value = 'cr-wr1'), 0,
  'I2 …and in NO slot_map value: an added player lands on the bench, never in a slot — which is also what keeps him out of the symmetric difference the enqueue is built from');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_roster_override_internal', 'commish_roster_lineup_sync_internal')
     and p.prosrc like '%lineup_fit_internal%'),
  0, 'I3 …and F350 is RE-ROUTED rather than discharged, for a MEASURED reason: neither 127 function calls lineup_fit_internal at all, so this task is not the "next caller that could pass a duplicate" its routing assumed. The matcher still has no guard and its three callers still rely on their own COALESCE discipline (D356(7c))');

-- ---------------------------------------------------------------------------
-- E. EXCLUSIVITY BINDS THE COMMISSIONER — REFUSED BY NAME, NOT SILENTLY
--    MOVED. tasks-M6A §6 item 3 decided the behaviour; the cell asserts it.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       'cr-t3a', null, 'grabbing him', 'af000000-0000-4000-8000-000000000005'::uuid) $$,
  '%is already on CR T3''s roster in this league%player exclusivity%use commish_move_player%',
  'E1 a force-ADD of a player rostered on ANOTHER team in this league is REFUSED BY NAME — exclusivity is the SHAPE of the game, not its timing, so standing rule (i) makes it bind the commissioner too. The message NAMES the lawful route (commish_move_player), the F351 posture');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select team_id from league_rosters
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-t3a'),
  'ce000000-0000-4000-8000-000000000003'::uuid,
  'E2 …AND HE WAS NOT SILENTLY MOVED: he is still on the team that rostered him. This is the half a message-only cell cannot see, and it is why the cell is phrased as one behaviour and not as "refused, or moved — say which"');
select is((select count(*)::int from commish_roster_actions where action_id = 'af000000-0000-4000-8000-000000000005'), 0,
  'E3 …and a refusal consumes no action_id: the whole transaction rolled back, ledger row included');

-- ---------------------------------------------------------------------------
-- F. commish_force_add_drop — the ADD side, lifting E32 and the waiver period.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       'cr-fa1', null, 'replacing the man I just took off', 'af000000-0000-4000-8000-000000000006'::uuid) $$,
  'F1 a force-ADD of a player whose game KICKED OFF lands — E32''s add arm (115:601-608) is a timing rule and it does not bind the commissioner (standing rule (g))');
select lives_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       'cr-w1', null, 'the waiver period is irrelevant to a fix', 'af000000-0000-4000-8000-000000000007'::uuid) $$,
  'F2 …and so does a force-ADD of a player still ON WAIVERS with the period ahead (115:576-582 — claims are M5''s; a period is a when, not a what)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select result -> 'bypassed' from commish_roster_actions where action_id = 'af000000-0000-4000-8000-000000000006'),
  '["e32_add_lock:cr-fa1"]'::jsonb,
  'F3 …and each lift is NAMED: e32_add_lock:cr-fa1');
select is((select result -> 'bypassed' from commish_roster_actions where action_id = 'af000000-0000-4000-8000-000000000007'),
  '["waiver_period:cr-w1"]'::jsonb,
  'F4 …and waiver_period:cr-w1');
select is((select result ->> 'pool_from_state' from commish_roster_actions where action_id = 'af000000-0000-4000-8000-000000000007'),
  'on_waivers', 'F5 …with the state he came FROM on the receipt, so the league can read what was overridden');
select is((select state || '|' || coalesce(waivers_until::text, 'null') from league_player_pool
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-w1'),
  'rostered|null',
  'F6 THE POOL MIRROR after the add: rostered with waivers_until cleared (D294; the pool_waivers_until_iff_on_waivers CHECK would refuse a stale instant — F222(a))');
select ok((select bench ? 'cr-fa1' and bench ? 'cr-w1' from team_lineups
           where team_id = 'ce000000-0000-4000-8000-000000000002' and season = 2026 and week = 3),
  'F7 …and both land on the bench of every week from the current one on (115:716-720''s shape), never in a slot');
select is((select result -> 'caps' ->> 'commissioner_move_not_counted' from commish_roster_actions
           where action_id = 'af000000-0000-4000-8000-000000000006'), 'true',
  'F8 STATED, NOT DISCOVERED (§4 rule 15): a commissioner force-add neither obeys the acquisition cap nor CONSUMES it — 115:497-506 counts by initiator_team_id and D353''s shape writes that column NULL. A league reading its own budget is not left to discover a number that did not move');
select is((select count(*)::int from transactions
           where league_id = 'be000000-0000-4000-8000-000000000001' and type = 'commissioner_move'), 4,
  'F9 …and every executed call wrote exactly one transactions row (the drop, the move, and the two adds)');

-- ---------------------------------------------------------------------------
-- G. THE NO-OP — Chris's one condition: "no receipt if nothing is done. only
--    when something is done." The three counts are captured as literals FIRST.
-- ---------------------------------------------------------------------------
select set_config('pgtap.cr_a', (select count(*)::text from commissioner_actions), true);
select set_config('pgtap.cr_c', (select count(*)::text from league_chat where league_id = 'be000000-0000-4000-8000-000000000001'), true);
select set_config('pgtap.cr_t', (select count(*)::text from transactions where league_id = 'be000000-0000-4000-8000-000000000001'), true);
select ok(current_setting('pgtap.cr_a')::int > 0 and current_setting('pgtap.cr_c')::int > 0 and current_setting('pgtap.cr_t')::int > 0,
  'G0 PREMISE: all three tables are NON-EMPTY before the no-op, so "UNCHANGED" below is a real comparison and not a count over nothing');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-wr1',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003',
       'a second look at the same fix', 'af000000-0000-4000-8000-000000000008'::uuid) $$,
  'G1 a move whose requested END STATE already holds returns 200 — it does not raise. A fallback verb that refused its own completed outcome would be non-idempotent in the one direction it most needs not to be');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('pgtap.cr_noop', (select result::text from commish_roster_actions
  where action_id = 'af000000-0000-4000-8000-000000000008'), true);
select is(current_setting('pgtap.cr_noop')::jsonb ->> 'no_changes', 'true',
  'G2 …and says so BY VALUE: no_changes = true, DETECTED across every dimension this verb can change (which roster row exists and which team it names), never inferred from an empty write');
select is(current_setting('pgtap.cr_noop')::jsonb ->> 'commissioner_action_id', null,
  'G3 …with commissioner_action_id NULL, and that is the point');
select ok(current_setting('pgtap.cr_noop')::jsonb ->> 'no_changes_why' like 'already_on_destination%',
  'G4 …and the reason is NAMED, so "nothing happened" can never be read as "it worked"');
select is((select count(*)::int from commissioner_actions), current_setting('pgtap.cr_a')::int,
  'G5 NO RECEIPT: the commissioner_actions count is UNCHANGED');
select is((select count(*)::int from league_chat where league_id = 'be000000-0000-4000-8000-000000000001'), current_setting('pgtap.cr_c')::int,
  'G6 …the league_chat count is UNCHANGED');
select is((select count(*)::int from transactions where league_id = 'be000000-0000-4000-8000-000000000001'), current_setting('pgtap.cr_t')::int,
  'G7 …and the transactions count is UNCHANGED');
select is((select count(*)::int from commish_roster_actions where action_id = 'af000000-0000-4000-8000-000000000008'), 1,
  'G8 …but the REPLAY LEDGER row IS written: an action_id is consumed by its submit whether or not anything moved (§12.26 — "an action_id is an idempotency key, not an audit record"), which is the OPPOSITE rule from the audit row and deliberately so');

-- REPLAY, byte-identical, on a real change (not only on the no-op).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-wr1',
     'ce000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000002',
     'a completely different reason', 'af000000-0000-4000-8000-000000000004'::uuid)::text),
  current_setting('pgtap.cr_move'),
  'G9 REPLAY (E2/D68): the same action_id returns the stored document BYTE-identically — with a different from/to and a different reason, and it moves nothing. The lookup sits AFTER auth but BEFORE every business gate (123:602-609), so a retry replays even when the league has moved on');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select team_id from league_rosters
           where league_id = 'be000000-0000-4000-8000-000000000001' and player_id = 'cr-wr1'),
  'ce000000-0000-4000-8000-000000000003'::uuid,
  'G10 …and the roster did NOT move on the replay: the returned document is a record, not an instruction');

-- ---------------------------------------------------------------------------
-- H. THE REMAINING SCORING ARMS. (H2/H3 sit beside their fixture, above.)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
-- A MOVE and not a drop, ON PURPOSE: a force-DROP's changed starter is
-- `unrostered` by construction (C26), so `no_stat_row` is unreachable through
-- that arm. A MOVE keeps him on a roster in this league, which is the only
-- shape where the arm can fire.
select lives_ok(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-rb1',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003',
       'he was drafted to the wrong team', 'af000000-0000-4000-8000-000000000009'::uuid) $$,
  'H1a a MOVE of a starter who has NO week-3 stat line at all');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select result ->> 'score_stale' from commish_roster_actions where action_id = 'af000000-0000-4000-8000-000000000009'),
  'false',
  'H1b …is NOT stale: the worker scores an absent line as 0, so adding or removing him moves no points. A score_stale here would be a false alarm in the one field whose whole job is to be believed (R969)');
select is((select result -> 'score_not_enqueued' from commish_roster_actions where action_id = 'af000000-0000-4000-8000-000000000009'),
  '[{"why": "no_stat_row", "player_id": "cr-rb1"}]'::jsonb,
  'H1c …and he is still NAMED with his reason rather than inferred from an empty array');

-- The FINAL-week arm, on L3 so no earlier cell's week is moved under it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000007',
       null, 'cr-l3a', 'the game was cancelled', 'af000000-0000-4000-8000-00000000000a'::uuid) $$,
  'H6a a force-drop on a league whose CURRENT week is FINAL lands');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select result ->> 'score_stale_reason' from commish_roster_actions where action_id = 'af000000-0000-4000-8000-00000000000a'),
  'week_final',
  'H6b …and the verb says WHY the score did not follow: the write door raises week_final (119:566-568) and the worker consumes a queue row with no cell changed, so an enqueue there would delete itself having done nothing');
select is((select count(*)::int from score_fanout where season = 2026 and week = 3 and player_id = 'cr-l3a'), 0,
  'H6c …and NOTHING was enqueued — an enqueue on a final week would be actively deceptive');

-- ---------------------------------------------------------------------------
-- N. THE LEGALITY GATES THAT BIND THE COMMISSIONER (standing rule (i); F324's
--    legality half is RECORDED here, not decided).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_like(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000004',
       'cr-fa2', null, 'squeeze him in', 'af000000-0000-4000-8000-00000000000b'::uuid) $$,
  '%CR T4''s roster is full (8 of 8%include a drop in the same move%binds the commissioner too%',
  'N1 ROSTER SIZE BINDS: a roster over its own league''s size is a shape the rules do not have, so the refusal binds the commissioner and NAMES the remedy (§7.3.2; standing rule (i))');
select throws_like(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-t3a',
       'ce000000-0000-4000-8000-000000000003', 'ce000000-0000-4000-8000-000000000004',
       'over there', 'af000000-0000-4000-8000-00000000000c'::uuid) $$,
  '%CR T4''s roster is full (8 of 8%free a spot with commish_force_add_drop first%',
  'N1b …and a MOVE onto a full roster is refused the same way, naming the verb that frees a spot');
select throws_like(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       'cr-mir', null, 'he should be here', 'af000000-0000-4000-8000-00000000000d'::uuid) $$,
  '%the pool mirror is broken; refusing until reconciliation%',
  'N3 D294''s BROKEN-MIRROR REFUSAL is carried verbatim from 115:589-595 — a `rostered` pool row with no roster row is an integrity claim about the data, not a rule about who may act, so it binds every caller');
reset role;
select set_config('request.jwt.claims', '', true);

-- A RETIRED franchise is sealed (spec:183; F352).
update teams set status = 'retired', retired_at_week = 2 where id = 'ce000000-0000-4000-8000-000000000006';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select throws_like(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000006',
       null, 'cr-l2a', 'clearing him out', 'af000000-0000-4000-8000-00000000000e'::uuid) $$,
  '%a retired franchise is sealed%F352%',
  'N2 A RETIRED FRANCHISE IS SEALED: its roster and record are frozen (spec:183, §7.2.1), so a roster move has nowhere to land. Recorded as F352 so the next reader finds a decision and not an oversight');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- L. ROLES — one no-leak 42501 for every caller who is not a commissioner of
--    THIS league, and the same one for a league that does not exist.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       null, 'cr-te1', 'my own team', 'af000000-0000-4000-8000-000000000010'::uuid) $$,
  '42501', 'commish_force_add_drop: not a commissioner of this league',
  'L1 the team''s OWN MANAGER is refused 42501 — this verb is the commissioner''s door, and his own is roster_add_drop (which 115 keeps, untouched)');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-te1',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003', 'x', 'af000000-0000-4000-8000-000000000011'::uuid) $$,
  '42501', 'commish_move_player: not a commissioner of this league', 'L2 an OUTSIDER is refused the same way');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-te1',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003', 'x', 'af000000-0000-4000-8000-000000000012'::uuid) $$,
  '42501', 'commish_move_player: not a commissioner of this league', 'L3 a MEMBER WITH NO TEAM is refused the same way');
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_move_player('00000000-0000-4000-8000-0000000000aa', 'cr-te1',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003', 'x', 'af000000-0000-4000-8000-000000000013'::uuid) $$,
  '42501', 'commish_move_player: not a commissioner of this league',
  'L4 NO LEAK: a league that does not exist gets the IDENTICAL message — "no such league" and "not a commissioner" are indistinguishable from outside (D336 part 5)');
select set_config('request.jwt.claims', '', true);
reset role;
set local role anon;
select throws_ok(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-te1',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003', 'x', 'af000000-0000-4000-8000-000000000014'::uuid) $$,
  '42501', null, 'L5 anon cannot reach the door at all (the REVOKE, not the body)');
reset role;

-- ---------------------------------------------------------------------------
-- M. THE REASON GATE AND THE SHAPE GATES — one unit either side.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "9e000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       null, 'cr-te1', E' \t\r\n ', 'af000000-0000-4000-8000-000000000020'::uuid) $$,
  '22023', null,
  'M1 a reason of nothing but whitespace INCLUDING TABS AND NEWLINES is refused — plain btrim strips SPACES ONLY, which is the exact hole R745 had to fix twice; the explicit E'' \t\r\n'' class is used at all three layers (123:295-296)');
select throws_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       null, 'cr-te1', repeat('x', 501), 'af000000-0000-4000-8000-000000000021'::uuid) $$,
  '22023', null, 'M2 501 characters is refused (the league_chat bound, §12.13)');
select lives_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       null, 'cr-te1', repeat('x', 500), 'af000000-0000-4000-8000-000000000022'::uuid) $$,
  'M3 …and 500 lives — the boundary, one unit either side');
select throws_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       null, 'cr-wr2', 'no key', null) $$,
  '22023', null, 'M4 a missing action_id is refused: the idempotency key is not optional (the DEFAULT NULL exists only to keep §15.4''s printed argument order)');
select throws_ok(
  $$ select public.commish_force_add_drop('be000000-0000-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002',
       null, null, 'nothing at all', 'af000000-0000-4000-8000-000000000023'::uuid) $$,
  '22023', null,
  'M5 LOUD EMPTINESS: neither arm supplied is a MALFORMED CALL and is refused BY NAME — never answered with no_changes: true, which would be a success document for a request that never said what it wanted (126''s rule, applied)');
select throws_ok(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-wr2',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002', 'same team', 'af000000-0000-4000-8000-000000000024'::uuid) $$,
  '22023', null, 'M6 …and a move whose from and to are the same franchise is refused the same way');
select throws_like(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-fa2',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000003', 'a free agent', 'af000000-0000-4000-8000-000000000025'::uuid) $$,
  '%is on no roster in league%use commish_force_add_drop%',
  'M7 a MOVE of a player on no roster is refused and NAMES the verb that brings a free agent in — a capability gap that is routed, not left (the F351 posture)');
select throws_like(
  $$ select public.commish_move_player('be000000-0000-4000-8000-000000000001', 'cr-t3a',
       'ce000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000001', 'wrong source', 'af000000-0000-4000-8000-000000000026'::uuid) $$,
  '%is on CR T3''s roster, not CR T2''s — neither the source nor the destination you named%',
  'M8 …and a move whose named SOURCE is wrong (and whose destination is not where he already is) is refused by name — a stale view is told exactly how it is stale');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- K. NEVER-WEAKEN PINS — the 071:835-867 shape. The commissioner exemption is
--    a property of the NEW verb, NEVER a relaxation of the manager's (§4 rule
--    13). 115 is not touched by this migration and these cells are what makes
--    that claim falsifiable.
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosrc like '%not the manager of this team%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'roster_add_drop_internal'),
  'K1 115''s roster_add_drop_internal STILL carries its manager-only refusal (115:423-425) — the manager''s verb did not grow a commissioner arm');
select ok(
  (select p.prosrc like '%locked for drops%' and p.prosrc like '%locked for adds%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'roster_add_drop_internal'),
  'K2 …and BOTH E32 refusal strings (115:528-537 drop, 115:601-608 add), still unconditional under Q34(B)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'roster_add_drop_internal'
     and p.prosrc like '%is_league_commish%'),
  0, 'K3 …and it names is_league_commish ZERO times: the commissioner never enters the manager''s function');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('roster_add_drop_internal', 'roster_add_drop')),
  2, 'K4 …and both are still ONE overload each — no second signature crept in beside them');
select ok(
  (select bool_and(p.prosrc like '%pool_game_lock_any_internal%')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_roster_override_internal'),
  'K5 …while the NEW verb still EVALUATES the lock it walks past: bypassed[] names a lock that was measured closed, not a constant string');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'commish_roster_override_internal'
     and p.prosrc like '%log_commissioner_action_internal%'),
  1, 'K6 …and it writes its receipt through the ONE shared logging helper (123:417-453), never a second INSERT into commissioner_actions');

select * from finish();
rollback;
