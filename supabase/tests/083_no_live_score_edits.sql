-- ============================================================================
-- Q61, AS RULED — no score / result override while a matchup's starters are
-- still playing. pgTAP 083 (migration 135; task L.E1.18 of M6A; tasks-M6A
-- §6's 2026-09-27 amendment; PROGRESS §3 Q61, F378, D372, R1092; spec
-- v2.16.42 §10.1 / §15.4 / §22.2; E42 / E43).
--
-- Numbering: pgTAP head measured 082 by `ls supabase/tests/ | tail -1` ⇒ 083.
--
-- Falsifiability notes (tasks-M1 §4.3; tasks-M4 §4 rules 9 + 14):
--   * THE PREMISE IS ASSERTED BY VALUE FIRST (§C, rule 14(c)): each side's
--     stored starters, each starter's game row and its measured status. A
--     refusal cell over a fixture whose "Monday game" silently read `final`
--     would pass against a deleted refusal; §C0-§C6 make that impossible.
--   * THE BOUNDARY IS AN ADJACENT PAIR (§A / §B): the SAME matchup is refused
--     while exactly ONE starter's game is unfinished and LANDS the instant
--     that one game row reads `final` — nothing else moves between the two.
--   * A REFUSAL WRITES NOTHING, asserted four ways (§A5-§A8): no
--     `commissioner_actions` row, no `league_chat` post, no ledger row, the
--     `matchups` row byte-unchanged (compared as a whole-row text image).
--   * THE RULE LIVES IN ONE HELPER and the verb and the panel's read call it
--     (§L): the door's answer is compared to the helper's for the same row,
--     and the verb's prosrc is pinned to call it — so a second copy of the
--     rule cannot drift unseen.
--   * BREAK PROBES (the task's five), each shown RED by name in the PR:
--     delete the refusal ⇒ A1/A2 red; count only the HOME side ⇒ D1/D2 red;
--     count the bench too ⇒ C8/C9 red; treat a bye starter as unfinished ⇒
--     E1/E2 red; move the refusal above the replay read ⇒ J2 reds. PR #313's
--     fix round (R1097) adds a sixth: delete the helper's `lineup_not_set`
--     arm (the pre-fix inner-join reading, where a MISSING lineup row read as
--     "no starters") ⇒ N2a, N4a/N4b, N5a/N5b red. L.E1.25 (migration 142,
--     Q67 as READ by R1140 in PR #321's fix round — a matchup has finished
--     when (A) every NFL game of its week is over, or (B) every STARTING
--     slot on both sides holds a player whose game is final) adds one probe
--     per branch, each a one-site break of 142's helper: (A) arm deleted ⇒
--     N8a-c, N8f; a left-the-week game counted open ⇒ N8a-c, N8f, S6; (A)
--     without "at least one in-week game" ⇒ N2a, N2, N3b; a `live` game
--     counted over ⇒ N8d, N8e; every postponed game counted as left ⇒ N8d;
--     (A) yielding to a missing row ⇒ N8f; empty slots dropped from (B) ⇒
--     E1, E3, N1, N2, N4a, N4c, N7a …; no-game starters dropped ⇒ E1, E1a,
--     G2, N4a, N4c; the IR filter dropped ⇒ C8-C10; (B) ignoring open
--     slots ⇒ E1, E1a, E3, G2 …; (B) ignoring unfinished starters ⇒ A1-A7,
--     D1, G1 … Every
--     LANDING cell is a `lives_ok` plus a row read, so a probe that makes a
--     landing raise reds that cell BY NAME instead of aborting the suite.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(108);

-- ---------------------------------------------------------------------------
-- F. FORM PINS — the helper, the read door, the verb's hunks (D137), and the
--    freeze chooser left byte-untouched.
-- ---------------------------------------------------------------------------
select has_function('public', 'commish_matchup_edit_lock_internal', array['uuid', 'uuid'],
  'F1 commish_matchup_edit_lock_internal(league, matchup) exists — Q61''s per-matchup rule in ONE place');
select has_function('public', 'commish_matchup_edit_lock', array['uuid', 'uuid'],
  'F2 commish_matchup_edit_lock(league, matchup) exists — the panel''s one server read');
select ok(
  not (select prosecdef from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure)
  and (select provolatile = 's' from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'public.commish_matchup_edit_lock(uuid,uuid)'::regprocedure),
  'F3 THE POSTURE PAIR: the helper is PLAIN and STABLE (reads tables, writes nothing, no clock); the read door is SECURITY DEFINER');
select ok(
  (select bool_and('search_path=""' = any(coalesce(proconfig, '{}')))
   from pg_proc
   where oid in ('public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure,
                 'public.commish_matchup_edit_lock(uuid,uuid)'::regprocedure,
                 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)'::regprocedure)),
  'F4 all three functions 135 writes pin search_path='''' (§4.1)');
select ok(
  not has_function_privilege('anon', 'public.commish_matchup_edit_lock_internal(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_matchup_edit_lock_internal(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)', 'EXECUTE'),
  'F5 the helper and the replaced internal are triple-REVOKEd — no client reaches either');
select ok(
  has_function_privilege('authenticated', 'public.commish_matchup_edit_lock(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.commish_matchup_edit_lock(uuid,uuid)', 'EXECUTE'),
  'F6 the read door: authenticated may call (the commissioner gate is IN-BODY), anon may not');
select ok(
  (select strpos(p.prosrc, 'FROM public.commish_matchup_actions a') > 0
      and strpos(p.prosrc, 'commish_matchup_edit_lock_internal(p_league_id, p_matchup_id)')
          > strpos(p.prosrc, 'FROM public.commish_matchup_actions a')
      and strpos(p.prosrc, 'commish_matchup_edit_lock_internal(p_league_id, p_matchup_id)')
          > strpos(p.prosrc, 'v_week_final := (v_lw.status = ''final'');')
      and strpos(p.prosrc, 'commish_matchup_edit_lock_internal(p_league_id, p_matchup_id)')
          < strpos(p.prosrc, 'log_commissioner_action_internal')
   from pg_proc p where p.oid = 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)'::regprocedure),
  'F7 D137 / the task''s ORDER: the verb calls the ONE helper AFTER the replay read and AFTER the week read, and BEFORE the audit write — so a refusal writes nothing and a replay is never re-judged');
select is(
  (select (length(p.prosrc) - length(replace(p.prosrc, 'v_set_over :=', ''))) / length('v_set_over :=')
   from pg_proc p where p.oid = 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)'::regprocedure),
  1, 'F8 `v_set_over` is assigned EXACTLY ONCE…');
select ok(
  (select p.prosrc like '%v_set_over := TRUE;%' and p.prosrc not like '%Q61 SWAP LINE ─%'
   from pg_proc p where p.oid = 'public.commish_matchup_override_internal(uuid,uuid,numeric,numeric,uuid,uuid,timestamptz,text,text)'::regprocedure),
  'F9 …to the literal TRUE, and the `Q61 SWAP LINE` block is retired as a ruled note — so the freeze chooser''s `not_frozen` arm is UNREACHABLE from the verb (the UI''s "will be overwritten" arm was removed on this pin)');
select is(
  (select md5(prosrc) from pg_proc where oid = 'public.commish_override_freeze_internal(boolean,boolean,boolean,boolean)'::regprocedure),
  '9b45a479c5a2b5718973778f2c297e68',
  'F10 the freeze chooser (126:544-583) is BYTE-UNTOUCHED — its pre-135 md5 as a stored literal; re-read arm by arm, every reachable arm''s copy is still true');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('commish_matchup_override_internal', 'commish_edit_score', 'commish_set_result',
                       'commish_matchup_edit_lock_internal', 'commish_matchup_edit_lock')),
  5, 'F11 ONE overload each — 135 replaced one body in place and added two functions; no sibling door');

-- ---------------------------------------------------------------------------
-- C. FIXTURES (postgres context). L: 12 teams, h2h, QB + WR starters, one IR
--    spot. u1 commissioner (T1) · u2 manager (T2) · u3 outsider · u4
--    co-commissioner (no team).
--    Calendar relative to now(): week N starts at now() + (N-8)·7d − 1d, so
--    week 4 starts now()−29d and week 5 now()−22d (E43's bound for week 4).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('96000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-lk' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'lk_user' || i)::jsonb, now(), now()
from generate_series(1, 4) i;

update nfl_weeks w
set starts_at                 = now() + ((w.week - 8) * interval '7 days') - interval '1 day',
    last_game_ends_at         = case when w.week <= 3 then now() + ((w.week - 8) * interval '7 days') + interval '5 days' end,
    correction_window_ends_at = now() + ((w.week - 8) * interval '7 days') + interval '6 days'
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at, status) values
 -- WEEK 4 (live). Sunday's games are final; the Monday game is still live.
 ('lk-w4-kcbuf',  2026, 4, 'KC',  'BUF', now() - interval '27 days', 'final'),
 ('lk-w4-phidal', 2026, 4, 'PHI', 'DAL', now() - interval '27 days', 'final'),
 ('lk-w4-nyjmia', 2026, 4, 'NYJ', 'MIA', now() - interval '26 days', 'live'),
 -- E42: moved WITHIN the week (Tuesday, before week 5 starts) and unplayed.
 ('lk-w4-seasf',  2026, 4, 'SEA', 'SF',  now() - interval '24 days', 'scheduled'),
 -- R791: marked postponed but its kickoff is still INSIDE the week — OPEN.
 ('lk-w4-larari', 2026, 4, 'LAR', 'ARI', now() - interval '23 days', 'postponed'),
 -- E43: postponed OUT — kickoff at/after week 5's start (now()−22d).
 ('lk-w4-denlv',  2026, 4, 'DEN', 'LV',  now() - interval '20 days', 'postponed'),
 -- WEEK 3 (final): a row that still READS unfinished — the precedence cell.
 ('lk-w3-kcbuf',  2026, 3, 'KC',  'BUF', now() - interval '34 days', 'live'),
 -- WEEK 5 (correction_window): every game final.
 ('lk-w5-kcbuf',  2026, 5, 'KC',  'BUF', now() - interval '20 days', 'final'),
 ('lk-w5-phidal', 2026, 5, 'PHI', 'DAL', now() - interval '20 days', 'final'),
 -- L.E1.25 (R1140): E43 in week 5 — postponed OUT (kickoff past week 6's
 -- start, now()−15d), so it does NOT hold (A) open (§N8).
 ('lk-w5-denlv',  2026, 5, 'DEN', 'LV',  now() - interval '12 days', 'postponed'),
 -- WEEK 6 (live): no game has started.
 ('lk-w6-kcbuf',  2026, 6, 'KC',  'BUF', now() - interval '13 days', 'scheduled'),
 ('lk-w6-phidal', 2026, 6, 'PHI', 'DAL', now() - interval '13 days', 'scheduled'),
 -- WEEK 8 (UPCOMING — R1097): one game, not yet played.
 ('lk-w8-kcbuf',  2026, 8, 'KC',  'BUF', now() + interval '8 days', 'scheduled');
 -- WEEK 7 (live): ZERO game rows.

insert into players (id, full_name, position, team, status) values
 ('lk-kc1',  'LK Kansas QB',     'QB', 'KC',  'Active'),
 ('lk-buf1', 'LK Buffalo WR',    'WR', 'BUF', 'Active'),
 ('lk-dal1', 'LK Dallas QB',     'QB', 'DAL', 'Active'),
 ('lk-phi1', 'LK Philly WR',     'WR', 'PHI', 'Active'),
 ('lk-nyj1', 'LK Monday Jet',    'WR', 'NYJ', 'Active'),
 ('lk-mia1', 'LK Monday Dolphin','WR', 'MIA', 'Active'),
 ('lk-mia2', 'LK Bench Dolphin', 'WR', 'MIA', 'Active'),
 ('lk-nyj2', 'LK Injured Jet',   'WR', 'NYJ', 'Out'),
 ('lk-gb1',  'LK Bye Packer',    'QB', 'GB',  'Active'),
 ('lk-sf1',  'LK Tuesday Niner', 'QB', 'SF',  'Active'),
 ('lk-ari1', 'LK Postponed Card','WR', 'ARI', 'Active'),
 ('lk-lv1',  'LK Moved-out Raider', 'QB', 'LV', 'Active');

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks,
                     playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, settings, roster_settings) values
 ('b6000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', 'pgtap-lk-L1', 2026,
  'in_season', 12, 10, 0, 11,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff',
  '{"schedule_mode": "h2h", "median_game": false, "second_opponent": false, "allow_illegal_lineups": true}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}, {"key": "wr", "label": "WR", "eligible": ["WR"], "count": 1}], "bench": 3, "ir_slots": [{"key": "ir1", "type": "unrestricted", "eligible_designations": ["OUT", "IR"]}], "swap_spots": 0}');

insert into teams (id, owner_id, name, league_id)
select ('c6000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
       '96000000-0000-4000-8000-000000000001', 'LK T' || i, 'b6000000-0000-4000-8000-000000000001'
from generate_series(1, 12) i;
insert into league_members (league_id, user_id, team_id, role) values
 ('b6000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000001', 'commissioner'),
 ('b6000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000002', 'manager'),
 ('b6000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000004', null, 'co_commissioner');

-- T3's roster: its two starters, an IR'd player and a BENCH player whose
-- games are unfinished (§C's bench / IR cell).
insert into league_rosters (league_id, team_id, player_id) values
 ('b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000003', 'lk-mia2'),
 ('b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000003', 'lk-nyj2');

insert into league_weeks (league_id, season, week)
select 'b6000000-0000-4000-8000-000000000001', 2026, g from generate_series(3, 10) g;
update league_weeks set status = 'live'              where league_id = 'b6000000-0000-4000-8000-000000000001' and week between 3 and 7;
update league_weeks set status = 'correction_window' where league_id = 'b6000000-0000-4000-8000-000000000001' and week in (3, 5);
update league_weeks set status = 'final'             where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 3;

-- The stored lineups (slot_map is the scoring worker's source). An absent
-- key is an EMPTY slot (T7's WR).
insert into team_lineups (team_id, season, week, starters, bench, slot_map) values
 ('c6000000-0000-4000-8000-000000000001', 2026, 4, '[]', '[]', '{"qb:0": "lk-kc1",  "wr:0": "lk-nyj1"}'),
 ('c6000000-0000-4000-8000-000000000002', 2026, 4, '[]', '[]', '{"qb:0": "lk-dal1", "wr:0": "lk-phi1"}'),
 ('c6000000-0000-4000-8000-000000000003', 2026, 4, '[]', '[]', '{"qb:0": "lk-kc1",  "wr:0": "lk-phi1", "ir1:0": "lk-nyj2"}'),
 ('c6000000-0000-4000-8000-000000000004', 2026, 4, '[]', '[]', '{"qb:0": "lk-dal1", "wr:0": "lk-buf1"}'),
 ('c6000000-0000-4000-8000-000000000005', 2026, 4, '[]', '[]', '{"qb:0": "lk-kc1",  "wr:0": "lk-buf1"}'),
 ('c6000000-0000-4000-8000-000000000006', 2026, 4, '[]', '[]', '{"qb:0": "lk-dal1", "wr:0": "lk-mia1"}'),
 ('c6000000-0000-4000-8000-000000000007', 2026, 4, '[]', '[]', '{"qb:0": "lk-gb1"}'),
 ('c6000000-0000-4000-8000-000000000008', 2026, 4, '[]', '[]', '{"qb:0": "lk-kc1",  "wr:0": "lk-phi1"}'),
 ('c6000000-0000-4000-8000-000000000009', 2026, 4, '[]', '[]', '{"qb:0": "lk-sf1",  "wr:0": "lk-ari1"}'),
 ('c6000000-0000-4000-8000-000000000010', 2026, 4, '[]', '[]', '{"qb:0": "lk-dal1", "wr:0": "lk-buf1"}'),
 ('c6000000-0000-4000-8000-000000000011', 2026, 4, '[]', '[]', '{"qb:0": "lk-lv1",  "wr:0": "lk-buf1"}'),
 ('c6000000-0000-4000-8000-000000000012', 2026, 4, '[]', '[]', '{"qb:0": "lk-dal1", "wr:0": "lk-phi1"}'),
 ('c6000000-0000-4000-8000-000000000001', 2026, 3, '[]', '[]', '{"qb:0": "lk-kc1"}'),
 ('c6000000-0000-4000-8000-000000000001', 2026, 5, '[]', '[]', '{"qb:0": "lk-kc1",  "wr:0": "lk-phi1"}'),
 ('c6000000-0000-4000-8000-000000000002', 2026, 5, '[]', '[]', '{"qb:0": "lk-dal1", "wr:0": "lk-buf1"}'),
 ('c6000000-0000-4000-8000-000000000001', 2026, 6, '[]', '[]', '{"qb:0": "lk-kc1"}'),
 ('c6000000-0000-4000-8000-000000000002', 2026, 6, '[]', '[]', '{"qb:0": "lk-dal1"}'),
 -- R1097: T3 has a week-6 lineup (GB's QB — a bye, no game); T4 has NONE.
 ('c6000000-0000-4000-8000-000000000003', 2026, 6, '[]', '[]', '{"qb:0": "lk-gb1"}'),
 ('c6000000-0000-4000-8000-000000000001', 2026, 7, '[]', '[]', '{"qb:0": "lk-kc1"}');
 -- (T2 has NO week-7 row until §N inserts one; NO team has a week-8 row, nor
 --  T3/T4 a week-3 row.)

insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id,
                      home_score, away_score, status, result) values
 ('d6000000-0000-4000-8000-000000000041', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular',
  'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 50.00, 40.00, 'live', null),
 ('d6000000-0000-4000-8000-000000000042', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular',
  'c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004', 30.00, 20.00, 'live', null),
 ('d6000000-0000-4000-8000-000000000043', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular',
  'c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000006', 61.00, 60.00, 'live', null),
 ('d6000000-0000-4000-8000-000000000044', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular',
  'c6000000-0000-4000-8000-000000000007', 'c6000000-0000-4000-8000-000000000008', 10.00, 70.00, 'live', null),
 ('d6000000-0000-4000-8000-000000000045', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular',
  'c6000000-0000-4000-8000-000000000009', 'c6000000-0000-4000-8000-000000000010', 44.00, 45.00, 'live', null),
 ('d6000000-0000-4000-8000-000000000046', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'regular',
  'c6000000-0000-4000-8000-000000000011', 'c6000000-0000-4000-8000-000000000012', 12.00, 80.00, 'live', null),
 -- BYE rows (away NULL) — `secondary` so the per-week home uniqueness holds.
 ('d6000000-0000-4000-8000-000000000047', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'secondary',
  'c6000000-0000-4000-8000-000000000002', null, 40.00, null, 'live', null),
 ('d6000000-0000-4000-8000-000000000048', 'b6000000-0000-4000-8000-000000000001', 2026, 4, 'secondary',
  'c6000000-0000-4000-8000-000000000006', null, 60.00, null, 'live', null),
 ('d6000000-0000-4000-8000-000000000031', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'regular',
  'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 90.00, 80.00, 'final', 'home'),
 ('d6000000-0000-4000-8000-000000000051', 'b6000000-0000-4000-8000-000000000001', 2026, 5, 'regular',
  'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 70.00, 71.00, 'live', null),
 ('d6000000-0000-4000-8000-000000000061', 'b6000000-0000-4000-8000-000000000001', 2026, 6, 'regular',
  'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 0, 0, 'live', null),
 ('d6000000-0000-4000-8000-000000000062', 'b6000000-0000-4000-8000-000000000001', 2026, 6, 'regular',
  'c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004', 0, 0, 'live', null),
 ('d6000000-0000-4000-8000-000000000071', 'b6000000-0000-4000-8000-000000000001', 2026, 7, 'regular',
  'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 0, 0, 'live', null),
 -- R1097: an UPCOMING week's matchup (no lineup rows yet) and a FINAL week's
 -- matchup with no lineup rows.
 ('d6000000-0000-4000-8000-000000000081', 'b6000000-0000-4000-8000-000000000001', 2026, 8, 'regular',
  'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 0, 0, 'scheduled', null),
 ('d6000000-0000-4000-8000-000000000032', 'b6000000-0000-4000-8000-000000000001', 2026, 3, 'regular',
  'c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004', 50.00, 40.00, 'final', 'home');

-- PREMISES, BY VALUE (rule 14(c)).
select is(
  (select string_agg(tl.team_id::text || '=' || tl.slot_map::text, ' ' order by tl.team_id)
   from team_lineups tl where tl.season = 2026 and tl.week = 4
     and tl.team_id in ('c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002')),
  'c6000000-0000-4000-8000-000000000001={"qb:0": "lk-kc1", "wr:0": "lk-nyj1"} c6000000-0000-4000-8000-000000000002={"qb:0": "lk-dal1", "wr:0": "lk-phi1"}',
  'C0 PREMISE: matchup …41''s two stored lineups — T1 starts KC''s QB and a NYJ receiver, T2 starts DAL''s QB and a PHI receiver');
select is(
  (select string_agg(g.id || ':' || g.status, ' ' order by g.id) from nfl_games g where g.season = 2026 and g.week = 4),
  'lk-w4-denlv:postponed lk-w4-kcbuf:final lk-w4-larari:postponed lk-w4-nyjmia:live lk-w4-phidal:final lk-w4-seasf:scheduled',
  'C1 PREMISE: week 4''s six game rows and their MEASURED status — KC/BUF and PHI/DAL final, the Monday NYJ/MIA game live, SEA/SF moved within the week, LAR/ARI postponed-in-week, DEN/LV postponed out');
select ok(
  (select g.kickoff_at >= (select w.starts_at from nfl_weeks w where w.season = 2026 and w.week = 5)
   from nfl_games g where g.id = 'lk-w4-denlv')
  and (select g.kickoff_at < (select w.starts_at from nfl_weeks w where w.season = 2026 and w.week = 5)
       from nfl_games g where g.id = 'lk-w4-larari')
  and (select g.kickoff_at < (select w.starts_at from nfl_weeks w where w.season = 2026 and w.week = 5)
       from nfl_games g where g.id = 'lk-w4-seasf'),
  'C2 PREMISE (E42 / E43): DEN/LV''s kickoff is at/after week 5''s start (it has LEFT the week); LAR/ARI and SEA/SF still kick off INSIDE week 4');
select is(
  (select count(*)::int from nfl_games g where g.season = 2026 and g.week = 4 and (g.home_team = 'GB' or g.away_team = 'GB')),
  0, 'C3 PREMISE: GB has NO week-4 game — the bye');
select is(
  (select count(*)::int from nfl_games g where g.season = 2026 and g.week = 7), 0,
  'C4 PREMISE: week 7 has ZERO game rows');
select is(
  (select string_agg(week || ':' || status, ' ' order by week) from league_weeks
   where league_id = 'b6000000-0000-4000-8000-000000000001' and week between 3 and 7),
  '3:final 4:live 5:correction_window 6:live 7:live',
  'C5 PREMISE: the weeks'' statuses — week 3 final, 4 live, 5 in its correction window, 6 and 7 live');
select is((select count(*)::int from commissioner_actions where league_id = 'b6000000-0000-4000-8000-000000000001'), 0,
  'C6 PREMISE: no receipt yet in this league');

-- ---------------------------------------------------------------------------
-- A. (a) ONE starter's game unfinished (the Monday game) ⇒ REFUSED by name,
--    BOTH verbs, and NOTHING is written.
-- ---------------------------------------------------------------------------
create temp table _a0 as
select (select m::text from matchups m where m.id = 'd6000000-0000-4000-8000-000000000041') as row_image,
       (select count(*)::int from commissioner_actions) as audits,
       (select count(*)::int from league_chat where league_id = 'b6000000-0000-4000-8000-000000000001') as posts,
       (select count(*)::int from commish_matchup_actions) as ledger;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041',
       60, 40, null, 'e6000000-0000-4000-8000-000000000001'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — not finished yet: LK Monday Jet (NYJ)',
  'A1 (a) THE SCORE ARM IS REFUSED BY NAME while ONE starter''s game (the Monday NYJ game) is unfinished — and the message NAMES him, in plain words');
select throws_ok(
  $$ select commish_set_result('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041',
       'c6000000-0000-4000-8000-000000000002'::uuid, null, 'e6000000-0000-4000-8000-000000000002'::uuid) $$,
  'P0001',
  'commish_set_result: This matchup can be corrected once every starter''s game has finished — not finished yet: LK Monday Jet (NYJ)',
  'A2 (a) …and THE RESULT ARM is refused the same way — both verbs share one rule');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from commissioner_actions), (select audits from _a0),
  'A3 (a) the refusals wrote NO commissioner_actions row');
select is((select count(*)::int from league_chat where league_id = 'b6000000-0000-4000-8000-000000000001'), (select posts from _a0),
  'A4 (a) …NO league_chat post');
select is((select count(*)::int from commish_matchup_actions), (select ledger from _a0),
  'A5 (a) …NO ledger row (a refusal consumes no action_id — a later submit with the same id is judged afresh)');
select is((select m::text from matchups m where m.id = 'd6000000-0000-4000-8000-000000000041'), (select row_image from _a0),
  'A6 (a) …and the matchups row is BYTE-UNCHANGED (its whole-row text image)');
select is(
  (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041')
     -> 'still_playing' -> 0 ->> 'game_status'),
  'live', 'A7 (a) the helper reports the unfinished starter''s game as `live` — the measured value, not a guess');

-- ---------------------------------------------------------------------------
-- C (cont.). (c) the unfinished player is on the BENCH / on IR, not a starter
--    ⇒ LANDS. Bench and IR never hold the matchup open.
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(lr.player_id || '@' || g.status, ' ' order by lr.player_id)
   from league_rosters lr join players p on p.id = lr.player_id
   join nfl_games g on g.season = 2026 and g.week = 4 and (g.home_team = p.team or g.away_team = p.team)
   where lr.team_id = 'c6000000-0000-4000-8000-000000000003'),
  'lk-mia2@live lk-nyj2@live',
  'C7 PREMISE (c): T3 rosters two players whose games are LIVE — one on the bench (not in slot_map), one in the IR spot `ir1:0`');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000042',
       31, 20, null, 'e6000000-0000-4000-8000-000000000003'::uuid) $$,
  'C8 (c) LANDS: T3''s bench and IR players are still playing, but only STARTERS hold a matchup open');
select is((select is_overridden from matchups where id = 'd6000000-0000-4000-8000-000000000042'), true,
  'C9 (c) …and the row carries the flag');
reset role;
select row_eq(
  $$ select h ->> 'why', (h ->> 'week_games_over')::boolean, jsonb_array_length(h -> 'open_slots')
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000042') as h) x $$,
  row('every_starter_finished'::text, false, 0)::record,
  'C10 (c, R1140) …released by (B) — `every_starter_finished`, week 4''s games NOT all over — and NO open slot: T3''s IR spot `ir1:0` (a live player in it) is not a starting slot, and neither is T4''s empty IR spot');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- ---------------------------------------------------------------------------
-- D. (d) an unfinished starter on the AWAY side only ⇒ refused (both teams
--    count).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000043',
       62, 60, null, 'e6000000-0000-4000-8000-000000000004'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — not finished yet: LK Monday Dolphin (MIA)',
  'D1 (d) the HOME side is finished and the AWAY side''s MIA receiver is not ⇒ REFUSED, naming him — both teams count');
reset role;
select is(
  (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000043')
     -> 'still_playing' -> 0 ->> 'side'),
  'away', 'D2 (d) …and the helper attributes him to the AWAY side');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- ---------------------------------------------------------------------------
-- E. (e) a starter on BYE and an EMPTY slot beside otherwise-finished starters.
--    RE-CUT TWICE BY L.E1.25 (migration 142). Q67 RULED 2026-09-27 — "you
--    cannot edit a score for a matchup that has not finished yet" — as READ by
--    R1140 (stated to Chris 2026-09-27): outside a final week a matchup has
--    finished when (A) every NFL game of the week is over, OR (B) every
--    STARTING slot on both sides holds a player whose game is final. Week 4
--    still has unplayed games (SEA/SF, LAR/ARI), so (A) cannot hold here and
--    (B) decides: an EMPTY starting slot and a starter on BYE each keep the
--    matchup OPEN (the manager could still start someone who plays later).
--    Until 142 both held nothing open and this section LANDED.
--    E1 (bye QB + empty WR) → E1a (the WR slot filled with a finished
--    receiver — the ONLY change — still refused: the bye QB alone holds it)
--    → E1b (the QB slot then holds KC's finished QB — the only change —
--    LANDS). E3: an EMPTY slot beside finished starters on the other side
--    holds it too.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000044',
       11, 70, null, 'e6000000-0000-4000-8000-000000000005'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — empty starting slot: LK T7 (WR); starter with no game this week: LK T7 (LK Bye Packer, GB)',
  'E1 (B) REFUSED: T7 starts GB''s QB (bye — no game) beside an EMPTY WR slot while week 4 still has games to play — both reasons named, by team, although T8''s starters are all final (a finished opponent does not unlock it)');
reset role;
update team_lineups set slot_map = '{"qb:0": "lk-gb1", "wr:0": "lk-phi1"}'
 where team_id = 'c6000000-0000-4000-8000-000000000007' and season = 2026 and week = 4;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000044',
       11, 70, null, 'e6000000-0000-4000-8000-000000000005'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — starter with no game this week: LK T7 (LK Bye Packer, GB)',
  'E1a (B, the BYE branch) THE ADJACENT PAIR: T7''s empty WR slot now holds PHI''s receiver (final) — the ONLY change — and the matchup is STILL refused: a starter on bye keeps it open (break probe: drop the no-game starters from the open slots ⇒ red)');
reset role;
update team_lineups set slot_map = '{"qb:0": "lk-kc1", "wr:0": "lk-phi1"}'
 where team_id = 'c6000000-0000-4000-8000-000000000007' and season = 2026 and week = 4;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000044',
       11, 70, null, 'e6000000-0000-4000-8000-000000000005'::uuid) $$,
  'E1b (B) LANDS the instant T7''s QB slot holds KC''s QB (final) instead of the bye QB — the ONLY change: every starting slot on both sides now holds a finished player (the refused E1 / E1a consumed no action_id, so the same one lands)');
reset role;
select is((select home_score from matchups where id = 'd6000000-0000-4000-8000-000000000044'), 11.00,
  'E1c (B) …and the row carries the commissioner''s 11.00');
select row_eq(
  $$ select (h ->> 'starters')::int, (h ->> 'finished')::int, h ->> 'why', (h ->> 'week_games_over')::boolean
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000044') as h) x $$,
  row(4, 4, 'every_starter_finished'::text, false)::record,
  'E2 (B) …and the helper counted FOUR starters, all FOUR finished, and says `every_starter_finished` — with `week_games_over` FALSE: (B), not (A), released it');
update team_lineups set slot_map = '{"qb:0": "lk-kc1"}'
 where team_id = 'c6000000-0000-4000-8000-000000000008' and season = 2026 and week = 4;
select row_eq(
  $$ select (h ->> 'editable')::boolean, h ->> 'why', h ->> 'message', h -> 'open_slots' -> 0 ->> 'side',
            h -> 'open_slots' -> 0 ->> 'reason', jsonb_array_length(h -> 'open_slots')
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000044') as h) x $$,
  row(false, 'no_starter_game'::text,
      'This matchup can be corrected once every starter''s game has finished — empty starting slot: LK T8 (WR)'::text,
      'away'::text, 'empty_slot'::text, 1)::record,
  'E3 (B, the EMPTY-SLOT branch) T8 empties its WR slot beside its finished QB — the only change — and the matchup is refused again, the ONE open slot named (away, `empty_slot`) (break probe: drop empty starting slots from the open slots ⇒ red)');

-- ---------------------------------------------------------------------------
-- G. (g) E42 / E43.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_set_result('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000045',
       'c6000000-0000-4000-8000-000000000009'::uuid, null, 'e6000000-0000-4000-8000-000000000006'::uuid) $$,
  'P0001',
  'commish_set_result: This matchup can be corrected once every starter''s game has finished — not finished yet: LK Tuesday Niner (SF), LK Postponed Card (ARI)',
  'G1 (g) E42: a starter whose game was RESCHEDULED WITHIN the week (SEA/SF, `scheduled`) and one whose game is `postponed` with an IN-WEEK kickoff (R791''s open game) are both unfinished ⇒ REFUSED, both named, in kickoff order');
-- RE-CUT BY L.E1.25 (migration 142, R1140): a starter whose game LEFT the
-- week has no game this week — like a bye, he keeps the matchup OPEN under
-- (B) while the week still has games to play (until 142 he held nothing open
-- and G2 landed). (A) treats the left-the-week game as over — §N8.
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000046',
       13, 80, null, 'e6000000-0000-4000-8000-000000000007'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — starter with no game this week: LK T11 (LK Moved-out Raider, LV)',
  'G2 (g) E43 under (B): a starter whose game was POSTPONED OUT of the week (DEN/LV, kickoff past week 5''s start) has NO game this week — beside a finished starter the matchup is REFUSED, the team and the player named');
reset role;
update team_lineups set slot_map = '{"qb:0": "lk-kc1", "wr:0": "lk-buf1"}'
 where team_id = 'c6000000-0000-4000-8000-000000000011' and season = 2026 and week = 4;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000046',
       13, 80, null, 'e6000000-0000-4000-8000-000000000007'::uuid) $$,
  'G2a (g) THE ADJACENT PAIR: T11''s QB slot holds KC''s QB (final) instead of the moved-out Raider — the ONLY change — and the SAME correction LANDS');
reset role;
select is((select is_overridden from matchups where id = 'd6000000-0000-4000-8000-000000000046'), true,
  'G2b (g) …and the row carries the flag');
select is(
  (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000045')
     -> 'still_playing' -> 0 ->> 'game_status'),
  'scheduled', 'G3 (g) …and the moved-within-the-week game is reported as `scheduled` (its measured value)');

-- ---------------------------------------------------------------------------
-- H. (h) a BYE ROW is judged on its ONE side.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000047',
       41, null, null, 'e6000000-0000-4000-8000-000000000008'::uuid) $$,
  'H1 (h) a BYE ROW whose one team''s starters are all final LANDS (the score arm, away NULL)');
select is((select home_score from matchups where id = 'd6000000-0000-4000-8000-000000000047'), 41.00,
  'H1b (h) …and the bye row carries the number');
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000048',
       61, null, null, 'e6000000-0000-4000-8000-000000000009'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — not finished yet: LK Monday Dolphin (MIA)',
  'H2 (h) …and a bye row whose one team still has a starter playing is REFUSED — there is no away side, and none is invented');

-- ---------------------------------------------------------------------------
-- I. (i) PRECEDENCE — a FINAL week is always editable; a correction_window
--    week with every starter finished lands.
-- ---------------------------------------------------------------------------
reset role;
select is(
  (select g.status from nfl_games g where g.id = 'lk-w3-kcbuf'), 'live',
  'I1 PREMISE (i): week 3''s KC game row still READS `live` although league week 3 is final');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_set_result('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000031',
       'c6000000-0000-4000-8000-000000000002'::uuid, null, 'e6000000-0000-4000-8000-00000000000a'::uuid) $$,
  'I2 (i) FINAL WINS: the final week''s result override LANDS although its starter''s game row reads unfinished (R1092)');
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000051',
       72, 71, null, 'e6000000-0000-4000-8000-00000000000b'::uuid) $$,
  'I3 (i) a CORRECTION_WINDOW week whose every starter has finished LANDS (the correction window, as ruled)');
reset role;
select is(
  (select result || '|' || home_score from matchups where id = 'd6000000-0000-4000-8000-000000000031')
    || ' ' || (select home_score::text from matchups where id = 'd6000000-0000-4000-8000-000000000051'),
  'away|90.00 72',
  'I2b/I3b (i) …and both rows carry the commissioner''s act: week 3''s result reversed to away, week 5''s score 72');
select is(
  (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000031') ->> 'why'),
  'week_final', 'I4 (i) …and the helper names why the final week passed: `week_final`, not a per-starter verdict');

-- ---------------------------------------------------------------------------
-- N. (f) NO GAME STARTED ⇒ refused; ZERO game rows ⇒ refused; a side with NO
--    LINEUP ROW ⇒ refused while the week still has games (R1097); an EMPTY
--    or no-game starting slot ⇒ refused while the week still has games (Q67
--    as read by R1140, migration 142 — an existing row with no starter who
--    has a game read "editable" until then); (A) every NFL game of the week
--    over ⇒ editable whatever the slots hold (§N8); a FINAL week is always
--    editable.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000061',
       1, 2, null, 'e6000000-0000-4000-8000-00000000000c'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — empty starting slot: LK T1 (WR), LK T2 (WR); not finished yet: LK Dallas QB (DAL), LK Kansas QB (KC)',
  'N1 (f) a week in which NO game has started is refused — every starter named ("before any starter has finished there is nothing scored anyway"), and (since 142) each side''s EMPTY WR slot named by team in the same sentence');
reset role;
select row_eq(
  $$ select (h ->> 'editable')::boolean, h ->> 'why', h ->> 'message'
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000071') as h) x $$,
  row(false, 'lineup_not_set'::text,
      'This matchup can be corrected once every starter''s game has finished — no lineup set yet: LK T2; empty starting slot: LK T1 (WR); not finished yet: LK Kansas QB (KC)'::text)::record,
  'N2a (R1097) T2 has NO week-7 lineup row: NOT editable, `lineup_not_set` — and when a side also has a starter not finished the ONE sentence names both, the missing lineup first');
-- T2 sets an EMPTY week-7 lineup — an existing row with no starters. RE-CUT
-- BY L.E1.25 (R1140): that empty row's two starting slots are OPEN (B), and
-- week 7 has ZERO game rows, so (A) cannot release it — zero rows is never
-- "every game over" (N3b); T1's KC QB is still named as NOT finished because
-- week 7 has zero game rows — N3 pins that status by value.
insert into team_lineups (team_id, season, week, starters, bench, slot_map) values
 ('c6000000-0000-4000-8000-000000000002', 2026, 7, '[]', '[]', '{}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000071',
       1, 2, null, 'e6000000-0000-4000-8000-00000000000d'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — empty starting slot: LK T1 (WR), LK T2 (QB, WR); not finished yet: LK Kansas QB (KC)',
  'N2 a week with ZERO nfl_games rows holds its starters open (112''s no-rows arm is not a bye; §23.2''s emptiest partial data) — refused, never "nothing to wait for" (and, since 142, every empty starting slot named by team)');
reset role;
select is(
  (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000071')
     -> 'still_playing' -> 0 ->> 'game_status'),
  'no_game_rows', 'N3 …and says WHY: `no_game_rows`');
select row_eq(
  $$ select (h ->> 'week_games_over')::boolean, h ->> 'why', (select count(*)::int from nfl_games where season = 2026 and week = 7)
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000071') as h) x $$,
  row(false, 'no_starter_game'::text, 0)::record,
  'N3b (A, R1140) …and with ZERO game rows `week_games_over` is FALSE — (A) needs at least one in-week game, so an empty week is never "all over" by vacuity (116''s `all_final`; break probe: drop that condition ⇒ N2 / N3b red)');

-- N4 (R1097 RE-CUT — formerly "NO stored lineup on either side is editable
-- AT ONCE", the reading the fix round removed). Matchup …62, LIVE week 6:
-- T3 has a lineup (GB's QB, a bye — no game), T4 has NO row.
select is(
  (select string_agg(tl.team_id::text || '=' || tl.slot_map::text, ' ' order by tl.team_id)
   from team_lineups tl where tl.season = 2026 and tl.week = 6
     and tl.team_id in ('c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004')),
  'c6000000-0000-4000-8000-000000000003={"qb:0": "lk-gb1"}',
  'N4 PREMISE (R1097): on LIVE week 6, matchup …62''s HOME side (T3) has a stored lineup whose one starter is on bye, and its AWAY side (T4) has NO lineup row at all');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000062',
       1, 2, null, 'e6000000-0000-4000-8000-000000000030'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — no lineup set yet: LK T4; empty starting slot: LK T3 (WR); starter with no game this week: LK T3 (LK Bye Packer, GB)',
  'N4a (R1097) a LIVE week where ONE side has no lineup row is REFUSED, naming that team — a missing row is NOT "no starters" (since 142 the sentence also names T3''s empty WR slot and its bye QB)');
reset role;
select row_eq(
  $$ select h ->> 'why', h -> 'no_lineup' -> 0 ->> 'side', h -> 'no_lineup' -> 0 ->> 'team_name', jsonb_array_length(h -> 'no_lineup')
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000062') as h) x $$,
  row('lineup_not_set'::text, 'away'::text, 'LK T4'::text, 1)::record,
  'N4b (R1097) …the helper says `lineup_not_set` and names the ONE side with no row (away, LK T4) — the scoring worker''s held-by-name posture (F241(b))');
-- THE ADJACENT PAIR: T4 now SETS an empty lineup — the ONLY change.
insert into team_lineups (team_id, season, week, starters, bench, slot_map) values
 ('c6000000-0000-4000-8000-000000000004', 2026, 6, '[]', '[]', '{}');
-- RE-CUT BY L.E1.25 (Q67 RULED 2026-09-27, read by R1140): this cell read
-- `editable = true` (`no_starter_game`) until migration 142. Chris: "you
-- cannot edit a score for a matchup that has not finished yet" — both
-- lineups are SET, every starting slot is empty or holds a bye starter, and
-- week 6's games are unplayed ⇒ REFUSED, both teams named.
select row_eq(
  $$ select (h ->> 'editable')::boolean, h ->> 'why', (h ->> 'starters')::int, h ->> 'message',
            jsonb_array_length(h -> 'no_lineup'), jsonb_array_length(h -> 'no_starter_game_sides')
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000062') as h) x $$,
  row(false, 'no_starter_game'::text, 1,
      'This matchup can be corrected once every starter''s game has finished — empty starting slot: LK T3 (WR), LK T4 (QB, WR); starter with no game this week: LK T3 (LK Bye Packer, GB)'::text, 0, 2)::record,
  'N4c (R1097 → Q67) …the instant T4''s row EXISTS (empty) the reason changes from `lineup_not_set` to `no_starter_game` — and it is STILL REFUSED: both lineups are set, no starting slot holds a player with a game (a bye QB; empty slots), week 6 is unplayed, so the matchup has not finished (break probe: restore the old empty-row ⇒ editable reading ⇒ red)');

-- N7 (Q67) THE CARRY'S OWN EMPTY ROW, both sides, in a LIVE week before any
-- game: the reviewer's case (R1100). Matchup …63, week 6: T5 and T6 never set
-- a week-6 lineup, so the REAL carry writes each an EMPTY row (their week-4
-- starters are rostered nowhere, so nothing carries — D293 names them).
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id,
                      home_score, away_score, status, result) values
 ('d6000000-0000-4000-8000-000000000063', 'b6000000-0000-4000-8000-000000000001', 2026, 6, 'regular',
  'c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000006', 0, 0, 'live', null);
select public.lineup_carry_internal('b6000000-0000-4000-8000-000000000001', t, 2026, 6, now() - interval '14 days')
from unnest(array['c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000006']::uuid[]) t;
select is(
  (select string_agg(right(tl.team_id::text, 2) || '=' || tl.slot_map::text, ' ' order by tl.team_id)
   from team_lineups tl where tl.season = 2026 and tl.week = 6
     and tl.team_id in ('c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000006'))
  || ' games:' || (select string_agg(g.status, ',' order by g.id) from nfl_games g where g.season = 2026 and g.week = 6),
  '05={} 06={} games:scheduled,scheduled',
  'N7 PREMISE (Q67): the REAL carry wrote T5 and T6 an EMPTY week-6 row each, and no week-6 game has started');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000063',
       99, 0, null, 'e6000000-0000-4000-8000-000000000033'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — empty starting slot: LK T5 (QB, WR), LK T6 (QB, WR)',
  'N7a (Q67) an EMPTY CARRIED ROW on both sides in a LIVE week is REFUSED, both teams named — the pre-game override that froze live scoring for the week (F384) cannot land');
reset role;
select row_eq(
  $$ select (h ->> 'editable')::boolean, h ->> 'why', m.is_overridden, m.home_score
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000063') as h) x
     cross join matchups m where m.id = 'd6000000-0000-4000-8000-000000000063' $$,
  row(false, 'no_starter_game'::text, false, 0::numeric)::record,
  'N7b (Q67) …the helper says `no_starter_game` with editable FALSE, and the row is untouched: not overridden, score 0');

-- N8 (R1140 — (A)) THE CORRECTION WINDOW: matchup …52, week 5. Every
-- in-week week-5 game is final and DEN/LV was postponed OUT of the week. T3
-- starts KC's QB (final) beside an EMPTY WR slot; T4 has only the carry's
-- EMPTY row. (B) does not hold (three open slots) — (A) does: every NFL game
-- of the week is over, so nobody's slots can score any more ⇒ EDITABLE.
-- RE-CUT from the first build of 142, where this cell (N8a) was REFUSED — the
-- league week not being FINAL. Then (A)'s two one-site pairs: DEN/LV's
-- kickoff moved back INSIDE the week (N8d), and a game NEITHER side starts a
-- player in turned `live` (N8e) — each refuses, each restored.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id,
                      home_score, away_score, status, result) values
 ('d6000000-0000-4000-8000-000000000052', 'b6000000-0000-4000-8000-000000000001', 2026, 5, 'regular',
  'c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004', 20.00, 10.00, 'live', null);
insert into team_lineups (team_id, season, week, starters, bench, slot_map) values
 ('c6000000-0000-4000-8000-000000000003', 2026, 5, '[]', '[]', '{"qb:0": "lk-kc1"}');
select public.lineup_carry_internal('b6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000004', 2026, 5, now() - interval '21 days');
select is(
  (select string_agg(right(tl.team_id::text, 2) || '=' || tl.slot_map::text, ' ' order by tl.team_id)
   from team_lineups tl where tl.season = 2026 and tl.week = 5
     and tl.team_id in ('c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004'))
  || ' week:' || (select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 5)
  || ' games:' || (select string_agg(g.id || ':' || g.status, ',' order by g.id) from nfl_games g where g.season = 2026 and g.week = 5)
  || ' denlv_left:' || (select (g.kickoff_at >= w.starts_at)::text from nfl_games g, nfl_weeks w
                        where g.id = 'lk-w5-denlv' and w.season = 2026 and w.week = 6),
  '03={"qb:0": "lk-kc1"} 04={} week:correction_window games:lk-w5-denlv:postponed,lk-w5-kcbuf:final,lk-w5-phidal:final denlv_left:true',
  'N8 PREMISE (A): week 5 is in its CORRECTION WINDOW; T3 starts only KC''s QB (final), T4 has only the carry''s EMPTY row; KC/BUF and PHI/DAL are final and DEN/LV was postponed OUT (kickoff at/after week 6''s start)');
select row_eq(
  $$ select (h ->> 'editable')::boolean, h ->> 'why', (h ->> 'week_games_over')::boolean, h ->> 'message',
            jsonb_array_length(h -> 'open_slots'), jsonb_array_length(h -> 'no_starter_game_sides')
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000052') as h) x $$,
  row(true, 'week_games_over'::text, true, null::text, 0, 0)::record,
  'N8a (A) EDITABLE — `week_games_over`: every NFL game of week 5 is over (the postponed-OUT game not counted), so T3''s empty WR slot and T4''s empty row no longer hold it; nothing is listed as holding it open (break probes: delete the (A) arm, or count a left-the-week game as open ⇒ red)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000052',
       21, 10, null, 'e6000000-0000-4000-8000-000000000034'::uuid) $$,
  'N8b (A) …and the correction LANDS in the correction window, with one side''s slots empty');
reset role;
select is((select home_score from matchups where id = 'd6000000-0000-4000-8000-000000000052'), 21.00,
  'N8c (A) …and the row carries 21.00');
-- (A)'s LEFT-THE-WEEK branch: DEN/LV's kickoff moved back INSIDE week 5 (still
-- `postponed`) — an in-week OPEN game (R791) — the ONLY change.
update nfl_games set kickoff_at = now() - interval '16 days' where id = 'lk-w5-denlv';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000052',
       22, 10, null, 'e6000000-0000-4000-8000-000000000036'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — empty starting slot: LK T3 (WR), LK T4 (QB, WR)',
  'N8d (A, the LEFT-THE-WEEK branch) the postponed DEN/LV game''s kickoff back INSIDE week 5 — the ONLY change — makes it an open in-week game: (A) no longer holds and (B)''s open slots are named by team (only a game that LEFT the week is over — 116''s `left_week`)');
reset role;
update nfl_games set kickoff_at = now() - interval '12 days' where id = 'lk-w5-denlv';
-- (A)'s EVERY-GAME branch: PHI/DAL — a game NEITHER side of …52 starts anyone
-- in — reads `live` again (a provider regression), the ONLY change.
update nfl_games set status = 'live' where id = 'lk-w5-phidal';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000052',
       22, 10, null, 'e6000000-0000-4000-8000-000000000037'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — empty starting slot: LK T3 (WR), LK T4 (QB, WR)',
  'N8e (A, the EVERY-GAME branch) PHI/DAL — no starter of this matchup plays in it — reads `live` again, the ONLY change: (A) is EVERY game of the week, not the starters'' games, so the open slots hold the matchup once more');
reset role;
update nfl_games set status = 'final' where id = 'lk-w5-phidal';
-- (A) OVER A MISSING ROW: matchup …53, week 5 — T5 and T6 have NO week-5
-- lineup row at all.
insert into matchups (id, league_id, season, week, round_type, home_team_id, away_team_id,
                      home_score, away_score, status, result) values
 ('d6000000-0000-4000-8000-000000000053', 'b6000000-0000-4000-8000-000000000001', 2026, 5, 'regular',
  'c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000006', 0, 0, 'live', null);
select row_eq(
  $$ select (select count(*)::int from team_lineups where season = 2026 and week = 5
               and team_id in ('c6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-000000000006')),
            (h ->> 'editable')::boolean, h ->> 'why', h -> 'no_lineup'
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000053') as h) x $$,
  row(0, true, 'week_games_over'::text, '[]'::jsonb)::record,
  'N8f (A) a side with NO lineup row is released by (A) too — neither T5 nor T6 has a week-5 row, and the matchup is EDITABLE because every NFL game of week 5 is over (the (A) arm sits ABOVE `lineup_not_set`; break probe: move it below ⇒ red)');

-- N5 (R1097) an UPCOMING week, no lineup rows yet — the reviewer's case.
select row_eq(
  $$ select (select status from league_weeks where league_id = 'b6000000-0000-4000-8000-000000000001' and week = 8),
            (select count(*)::int from team_lineups where season = 2026 and week = 8
               and team_id in ('c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002')),
            (select string_agg(g.id || ':' || g.status, ' ') from nfl_games g where g.season = 2026 and g.week = 8) $$,
  row('upcoming'::text, 0, 'lk-w8-kcbuf:scheduled'::text)::record,
  'N5 PREMISE (R1097): week 8 is UPCOMING, neither T1 nor T2 has a week-8 lineup row, and its one game is `scheduled`');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000081',
       99, 0, null, 'e6000000-0000-4000-8000-000000000031'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — no lineup set yet: LK T1, LK T2',
  'N5a (R1097) an UPCOMING week''s matchup, before any lineup row exists, is REFUSED naming both teams — the 99/0 pre-game override that froze live scoring for the week cannot land');
reset role;
select row_eq(
  $$ select (h ->> 'editable')::boolean, h ->> 'why', m.is_overridden, m.home_score
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000081') as h) x
     cross join matchups m where m.id = 'd6000000-0000-4000-8000-000000000081' $$,
  row(false, 'lineup_not_set'::text, false, 0::numeric)::record,
  'N5b (R1097) …the helper says `lineup_not_set`, and the row is untouched: not overridden, score 0');

-- N6 (R1097) a FINAL week with NO lineup rows is still editable — final wins.
select is(
  (select count(*)::int from team_lineups where season = 2026 and week = 3
     and team_id in ('c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004')),
  0, 'N6 PREMISE (R1097): neither T3 nor T4 has a week-3 lineup row');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000032',
       51, 40, null, 'e6000000-0000-4000-8000-000000000032'::uuid) $$,
  'N6a (R1097) a FINAL week''s matchup with no lineup row on either side LANDS — a final week is always editable (R1092''s precedence sits above the missing-row arm)');
reset role;
select row_eq(
  $$ select h ->> 'why', m.home_score
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000032') as h) x
     cross join matchups m where m.id = 'd6000000-0000-4000-8000-000000000032' $$,
  row('week_final'::text, 51.00::numeric)::record,
  'N6b (R1097) …the helper says `week_final`, and the row carries 51.00');
-- N6c/N6d (Q67) THE FINAL-WEEK HALF: the same final week 3, now with the
-- REAL carry's EMPTY row on both sides — still editable, because a FINAL week
-- always is (R1092's precedence sits above the Q67 arm too).
select public.lineup_carry_internal('b6000000-0000-4000-8000-000000000001', t, 2026, 3, now() - interval '35 days')
from unnest(array['c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004']::uuid[]) t;
select row_eq(
  $$ select (select string_agg(tl.slot_map::text, ' ' order by tl.team_id) from team_lineups tl
             where tl.season = 2026 and tl.week = 3
               and tl.team_id in ('c6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-000000000004')),
            (h ->> 'editable')::boolean, h ->> 'why', h -> 'no_starter_game_sides'
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000032') as h) x $$,
  row('{} {}'::text, true, 'week_final'::text, '[]'::jsonb)::record,
  'N6c (Q67) a FINAL week whose two sides hold the carry''s EMPTY rows is EDITABLE (`week_final`) — the Q67 lock is outside a final week only');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000032',
       52, 40, null, 'e6000000-0000-4000-8000-000000000035'::uuid) $$,
  'N6d (Q67) …and a correction there LANDS (52.00 over the 51.00 of N6a)');
reset role;

-- ---------------------------------------------------------------------------
-- B. (b) THE BOUNDARY'S OTHER SIDE: the SAME matchup as §A, after the ONE
--    unfinished game is marked final ⇒ LANDS with the flag set.
-- ---------------------------------------------------------------------------
update nfl_games set status = 'final' where id = 'lk-w4-nyjmia';
select is((select g.status from nfl_games g where g.id = 'lk-w4-nyjmia'), 'final',
  'B1 PREMISE (b): the Monday NYJ/MIA game — the ONLY thing that changes between §A and here — now reads `final`');
select row_eq(
  $$ select (h ->> 'editable')::boolean, h ->> 'why', (h ->> 'week_games_over')::boolean,
            (select count(*)::int from nfl_games g where g.season = 2026 and g.week = 4 and g.status <> 'final')
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000041') as h) x $$,
  row(true, 'every_starter_finished'::text, false, 3)::record,
  'B1b (B, Q61''s per-matchup window, R1140) …the matchup is EDITABLE by (B) — every starting slot on both sides holds a finished player — while week 4 still has THREE games not final (SEA/SF, LAR/ARI, DEN/LV): `week_games_over` FALSE, so (A) is not what released it');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _b as
select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041',
  60, 40, null, 'e6000000-0000-4000-8000-000000000010'::uuid) as r;
select is((select r ->> 'is_overridden' from _b), 'true',
  'B2 (b) the SAME matchup now LANDS with the flag set — the adjacent pair A1/B2 is the boundary');
select is((select r ->> 'live_scoring_frozen' from _b), 'true',
  'B3 (b) …and on this LIVE week the flag is LOAD-BEARING: the matchup is finished while the league-week is still being scored, so live scoring is frozen for it (the ruled note at the flag)');
reset role;
select row_eq(
  $$ select home_score, away_score, result, is_overridden from matchups where id = 'd6000000-0000-4000-8000-000000000041' $$,
  row(60.00::numeric, 40.00::numeric, 'home'::text, true)::record,
  'B4 (b) …and the row carries the commissioner''s numbers, the derived result and the flag');
select is((select count(*)::int from commissioner_actions where target_id = 'd6000000-0000-4000-8000-000000000041'), 1,
  'B5 (b) …with exactly ONE receipt');

-- ---------------------------------------------------------------------------
-- J. (j) A REPLAY of a landed action_id after the state turns back to
--    refusing ⇒ byte-identical.
-- ---------------------------------------------------------------------------
update nfl_games set status = 'live' where id = 'lk-w4-nyjmia';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041',
       61, 40, null, 'e6000000-0000-4000-8000-000000000011'::uuid) $$,
  'P0001', null,
  'J1 PREMISE (j): the Monday game is `live` again (a provider regression) and a NEW submit on the same matchup IS refused — the state really is refusing');
-- The replay is captured through an exception-catching block so that a probe
-- which re-judges it reds J2 BY NAME (with the refusal text as `have`) rather
-- than aborting the suite.
create temp table _j (got text);
do $$
begin
  insert into _j
  select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041',
    1, 2, null, 'e6000000-0000-4000-8000-000000000010'::uuid)::text;
exception when others then
  insert into _j values ('RAISED: ' || sqlerrm);
end;
$$;
reset role;
select is((select got from _j),
  (select result::text from commish_matchup_actions where action_id = 'e6000000-0000-4000-8000-000000000010'),
  'J2 (j) …yet the REPLAY of §B''s landed action_id returns its stored result BYTE-identically — the replay read runs BEFORE the rule, so a retry is never re-judged');

-- ---------------------------------------------------------------------------
-- L. THE PANEL'S READ — commissioner-gated, and the SAME answer as the verb.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _l as
select commish_matchup_edit_lock('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000043') as r;
select is((select r ->> 'editable' from _l), 'false', 'L1 the commissioner''s read says matchup …43 is NOT editable');
select is((select r ->> 'message' from _l),
  'This matchup can be corrected once every starter''s game has finished — not finished yet: LK Monday Dolphin (MIA)',
  'L2 …with the SAME sentence the verb raises (D1) — one helper, one evaluation');
select is((select r ->> 'matchup_id' from _l), 'd6000000-0000-4000-8000-000000000043',
  'L3 …and the document names the matchup and week it answered for');
select is((select (r ->> 'week')::int from _l), 4, 'L4 …week 4');
reset role;
select is(
  (select (r - 'league_id' - 'matchup_id' - 'season' - 'week') from _l),
  public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000043'),
  'L5 THE DOOR IS THE HELPER: minus its four identity keys the read is byte-equal to the helper the verb calls — the panel cannot disagree with the refusal');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (select commish_matchup_edit_lock('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041') ->> 'editable'),
  'false', 'L6 a CO-COMMISSIONER reads it too (is_league_commish) — and …41 is refusing again (the Monday game went back to live in §J)');
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_matchup_edit_lock('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041') $$,
  '42501', 'commish_matchup_edit_lock: not a commissioner of this league',
  'L7 a MANAGER of one of the two teams gets the no-leak 42501');
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_matchup_edit_lock('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041') $$,
  '42501', 'commish_matchup_edit_lock: not a commissioner of this league',
  'L8 an OUTSIDER gets the same 42501');
select throws_ok(
  $$ select commish_matchup_edit_lock('00000000-0000-4000-8000-0000000000cc'::uuid, 'd6000000-0000-4000-8000-000000000041') $$,
  '42501', 'commish_matchup_edit_lock: not a commissioner of this league',
  'L9 …and a league that does not exist is indistinguishable from one he does not run');
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_matchup_edit_lock('b6000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000dd'::uuid) $$,
  'P0002', null,
  'L10 a matchup that is not this league''s is P0002 (a read — 404), not a silent empty document');
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select commish_matchup_edit_lock('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000041') $$,
  '42501', null, 'L11 anon holds no EXECUTE on the read');
reset role;

-- ---------------------------------------------------------------------------
-- R. THE REST OF THE VERB IS UNCHANGED — auth still first, the no-op still a
--    no-op, and the refusal is not a `bypassed[]` line.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000043',
       1, 2, null, 'e6000000-0000-4000-8000-000000000020'::uuid) $$,
  '42501', 'commish_edit_score: not a commissioner of this league',
  'R1 AUTH STILL COMES FIRST: a manager on a refusing matchup gets the no-leak 42501, never the game-state message — a non-commissioner learns nothing about whose games are finished');
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000042',
     31, 20, null, 'e6000000-0000-4000-8000-000000000021'::uuid) ->> 'no_changes'),
  'true', 'R2 an identical re-submit on an editable matchup is still `no_changes` by value (126''s no-op detection unmoved)');
select is(
  (select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000042',
     32, 20, null, 'e6000000-0000-4000-8000-000000000022'::uuid) -> 'bypassed'),
  '["past_week"]'::jsonb,
  'R3 …and the receipt''s `bypassed[]` is unchanged in shape — the rule is a VALIDITY refusal, never a lifted-timing line');
reset role;
select is(
  (select count(*)::int from commissioner_actions where league_id = 'b6000000-0000-4000-8000-000000000001'),
  11, 'R4 ELEVEN receipts in the league: C8, E1b, G2a, H1, I2, I3, N6a, N6d, N8b, B2, R3 — every landing wrote one, every refusal (A1, A2, D1, E1, E1a, G1, G2, H2, N1, N2, N4a, N5a, N7a, N8d, N8e, J1) and the no-op (R2) none');
select is(
  (select count(*)::int from commish_matchup_actions m
   join matchups mm on mm.id = m.matchup_id where mm.league_id = 'b6000000-0000-4000-8000-000000000001'),
  12, 'R5 TWELVE ledger rows: the eleven landings and the no-op — the refusals consumed no action_id (E1 / E1a''s id later LANDED as E1b, G2''s as G2a)');

-- ---------------------------------------------------------------------------
-- S. SOURCE PINS on the helper — the break probes' targets, stated so the
--    probes cannot be satisfied by an unrelated edit.
-- ---------------------------------------------------------------------------
select ok(
  (select prosrc like '%m.away_team_id IS NOT NULL%' and prosrc like '%''home''::text%' and prosrc like '%''away''::text%'
   from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  'S1 the helper reads BOTH sides (the (d) probe''s target)');
select ok(
  (select prosrc like '%public.team_lineups tl%' and prosrc not like '%league_rosters%'
   from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  'S2 the helper reads STARTERS from the stored slot_map and never the roster (the (c) probe''s target)');
select ok(
  (select prosrc like '%WHEN v.lineups_missing > 0 THEN%'
          and strpos(prosrc, 'WHEN v.lineups_missing > 0 THEN') > strpos(prosrc, 'WHEN v.week_status = ''final'' THEN')
          and strpos(prosrc, 'WHEN v.lineups_missing > 0 THEN') < strpos(prosrc, 'WHEN v.not_finished > 0 THEN')
   from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  'S4 (R1097) the missing-lineup arm sits BELOW the final-week precedence and ABOVE the per-starter arms (the sixth probe''s target)');
select ok(
  (select strpos(prosrc, 'WHEN v.week_games_over THEN') > strpos(prosrc, 'WHEN v.week_status = ''final'' THEN')
          and strpos(prosrc, 'WHEN v.lineups_missing = 0 AND v.open_slots = 0 AND v.not_finished = 0 AND v.finished > 0 THEN')
              > strpos(prosrc, 'WHEN v.week_status = ''final'' THEN')
          and strpos(prosrc, 'WHEN v.week_games_over THEN') < strpos(prosrc, 'WHEN v.lineups_missing > 0 THEN')
          and strpos(prosrc, 'WHEN v.open_slots > 0 THEN') > strpos(prosrc, 'WHEN v.lineups_missing > 0 THEN')
          and strpos(prosrc, 'WHEN v.open_slots > 0 THEN') < strpos(prosrc, 'WHEN v.not_finished > 0 THEN')
          and prosrc not like '%''editable'', TRUE, ''why'', ''no_starter_game''%'
   from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  'S5 (R1140, migration 142) THE ORDER: final week > (B) every starting slot finished > (A) every game of the week over > `lineup_not_set` > open slots (`no_starter_game`) > `starters_not_finished` — and NO arm answers `no_starter_game` with editable TRUE (the probes'' targets)');
select ok(
  (select prosrc like '%wg.in_week > 0 AND wg.open = 0%'
          and prosrc like '%count(*) FILTER (WHERE NOT x.left_week AND x.status IS DISTINCT FROM ''final'')%'
          and prosrc like '%AND g.kickoff_at >= b.next_starts_at, FALSE) AS left_week%'
   from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  'S6 (A) is at least one in-week game AND none of them not `final`, a game that LEFT the week (116''s predicate) not counted — the N3b / N8a / N8d / N8e probes'' targets');
select ok(
  (select prosrc like '%l.roster_settings -> ''starting_slots''%'
          and prosrc like '%''empty_slot''::text AS reason%'
          and prosrc like '%WHERE j.week_rows > 0 AND j.games = 0%'
   from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  'S7 (B)''s open slots are the league''s STARTING slots (never IR) left empty, and the starters with no game in a week that has game rows — the E1a / E3 / G2 probes'' targets');
select ok(
  (select prosrc like '%g.status IS NOT DISTINCT FROM ''postponed''%' and prosrc like '%g.kickoff_at >= b.next_starts_at%'
   from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  'S3 E43 is 116:340''s `left_week` predicate (postponed AND kickoff at/after the next week''s start) — the same one finalization uses');

select * from finish();
rollback;
