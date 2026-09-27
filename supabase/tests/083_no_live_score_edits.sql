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
--     E1/E2 red; move the refusal above the replay read ⇒ J2 reds. Every
--     LANDING cell is a `lives_ok` plus a row read, so a probe that makes a
--     landing raise reds that cell BY NAME instead of aborting the suite.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(75);

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
 -- WEEK 6 (live): no game has started.
 ('lk-w6-kcbuf',  2026, 6, 'KC',  'BUF', now() - interval '13 days', 'scheduled'),
 ('lk-w6-phidal', 2026, 6, 'PHI', 'DAL', now() - interval '13 days', 'scheduled');
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
 ('c6000000-0000-4000-8000-000000000001', 2026, 7, '[]', '[]', '{"qb:0": "lk-kc1"}');

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
  'c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002', 0, 0, 'live', null);

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
-- E. (e) a starter on BYE and an EMPTY slot beside otherwise-finished starters
--    ⇒ LANDS.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000044',
       11, 70, null, 'e6000000-0000-4000-8000-000000000005'::uuid) $$,
  'E1 (e) LANDS: T7 starts GB''s QB (bye — no game) and leaves its WR slot EMPTY; T8''s starters are final. Neither a bye nor an empty slot holds the matchup open');
reset role;
select is((select home_score from matchups where id = 'd6000000-0000-4000-8000-000000000044'), 11.00,
  'E1b (e) …and the row carries the commissioner''s 11.00');
select row_eq(
  $$ select (h ->> 'starters')::int, (h ->> 'finished')::int, h ->> 'why'
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000044') as h) x $$,
  row(3, 2, 'every_starter_finished'::text)::record,
  'E2 (e) …and the helper counted THREE starters (the bye QB included, the empty slot not), TWO with a finished game, and says `every_starter_finished`');

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
select lives_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000046',
       13, 80, null, 'e6000000-0000-4000-8000-000000000007'::uuid) $$,
  'G2 (g) E43: a starter whose game was POSTPONED OUT of the week (DEN/LV, kickoff past week 5''s start) has NO game this week — beside a finished starter the matchup LANDS');
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
-- N. (f) NO GAME STARTED ⇒ refused; ZERO game rows ⇒ refused; no starter has
--    a game ⇒ editable, and says so.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "96000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000061',
       1, 2, null, 'e6000000-0000-4000-8000-00000000000c'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — not finished yet: LK Dallas QB (DAL), LK Kansas QB (KC)',
  'N1 (f) a week in which NO game has started is refused — every starter named ("before any starter has finished there is nothing scored anyway")');
select throws_ok(
  $$ select commish_edit_score('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000071',
       1, 2, null, 'e6000000-0000-4000-8000-00000000000d'::uuid) $$,
  'P0001',
  'commish_edit_score: This matchup can be corrected once every starter''s game has finished — not finished yet: LK Kansas QB (KC)',
  'N2 a week with ZERO nfl_games rows holds its starters open (112''s no-rows arm is not a bye; §23.2''s emptiest partial data) — refused, never "nothing to wait for"');
reset role;
select is(
  (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000071')
     -> 'still_playing' -> 0 ->> 'game_status'),
  'no_game_rows', 'N3 …and says WHY: `no_game_rows`');
select row_eq(
  $$ select (h ->> 'editable')::boolean, h ->> 'why', (h ->> 'starters')::int
     from (select public.commish_matchup_edit_lock_internal('b6000000-0000-4000-8000-000000000001',
                    'd6000000-0000-4000-8000-000000000062') as h) x $$,
  row(true, 'no_starter_game'::text, 0)::record,
  'N4 a matchup with NO stored lineup on either side is editable AT ONCE — and the helper says `no_starter_game`, so a vacuous yes is never read as "every game is final"');

-- ---------------------------------------------------------------------------
-- B. (b) THE BOUNDARY'S OTHER SIDE: the SAME matchup as §A, after the ONE
--    unfinished game is marked final ⇒ LANDS with the flag set.
-- ---------------------------------------------------------------------------
update nfl_games set status = 'final' where id = 'lk-w4-nyjmia';
select is((select g.status from nfl_games g where g.id = 'lk-w4-nyjmia'), 'final',
  'B1 PREMISE (b): the Monday NYJ/MIA game — the ONLY thing that changes between §A and here — now reads `final`');
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
  8, 'R4 EIGHT receipts in the league: C8, E1, G2, H1, I2, I3, B2, R3 — every landing wrote one, every refusal (A1, A2, D1, G1, H2, N1, N2, J1) and the no-op (R2) none');
select is(
  (select count(*)::int from commish_matchup_actions m
   join matchups mm on mm.id = m.matchup_id where mm.league_id = 'b6000000-0000-4000-8000-000000000001'),
  9, 'R5 NINE ledger rows: the eight landings and the no-op — the refusals consumed no action_id');

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
  (select prosrc like '%g.status IS NOT DISTINCT FROM ''postponed''%' and prosrc like '%g.kickoff_at >= b.next_starts_at%'
   from pg_proc where oid = 'public.commish_matchup_edit_lock_internal(uuid,uuid)'::regprocedure),
  'S3 E43 is 116:340''s `left_week` predicate (postponed AND kickoff at/after the next week''s start) — the same one finalization uses');

select * from finish();
rollback;
