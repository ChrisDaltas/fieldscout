-- ============================================================================
-- A rostered player's game-day lock is judged by whether HE has played this
-- week — pgTAP 105 (task L.D2.16; migration 157; PROGRESS F447 — R1216's live
-- probe, R1234; D411 / D412 / D413 / D416; spec §11.2, §13.1, §13.2, §13.3).
--
-- Numbering: reserved and measured (157 / 105). OWN FIXTURE: users 9157…,
-- leagues b157…, teams c157…, action ids a157…, claims d157…, players pl-*,
-- NFL teams P*. Every instant is passed explicitly (the TimeProvider rule);
-- internals are called as postgres with the actor's JWT claims set.
--
-- THE SHAPE (R1216): a player plays Thursday; afterwards the NFL trades him
-- to a team that plays Sunday (`players.team` = 'PB') or releases him (NULL
-- — read as a bye). At Sunday 12:00 ET (10-18 16:00Z) every reader before
-- 157 judged him from his CURRENT team: unlocked.
--
-- BREAK PROBES (the PR body; measured), each injected right after
-- pg_temp.un157 inside this transaction (the ROLLBACK ends it); accepted
-- paths run through pg_temp.try so a probe reds cells instead of aborting
-- the run. A one-site break is one body put back to its pre-157 text with
-- pg_temp.un157, or one helper arm switched off:
--   (1) roster_add_drop_internal ⇒ A5 A7 C1 C2 C3 C4 C5 C7 C8 C9 T1 T2 T3
--       G2 red (R1216 re-appears: the drops and adds are accepted, and the
--       downstream cells see the moved players);
--   (2) set_lineup_internal ⇒ A5 A8 C6 C7 C8 C9 T1 red (the played bench
--       man starts; A One / D One benched);
--   (3) lineup_lock_tick ⇒ A5 T1 T2 red (records re-read to NULL / to the
--       Sunday kickoff; the played free agents shown free);
--   (4) lineup_autopilot_internal ⇒ A5 A8 E1 E2 red;
--   (5) trade_lock_internal ⇒ A5 A7 F1 F2 F3 red (the trade completes at
--       Sunday 12:00 and G One's played start leaves the live week);
--   (6) waiver_claim_submit_internal ⇒ A5 A7 D1 D2 red;
--       process_waivers_internal ⇒ A5 A7 D2 D3 red;
--   (7) lineup_played_internal's RECORD arm off ⇒ B3 B7 C1 C3 C7 C8 T1 red;
--       its STAT-LINE arm off ⇒ B3 B4 B5 C4 C5 C6 T2 T3 E1 E2 D1 D2 D3 G2
--       red; lineup_record_kicked_off_internal's real-kickoff test off ⇒ B1
--       red here and pgTAP 064 D7b D7c D7d (E42 — a flexed kickoff's
--       record must move) red; its postponed-team test off ⇒ B2 red.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(39);

-- L.D2.16 (migration 157 — additive, the R992 shape): pg_temp.un157 reverses
-- 157's substitutions in the seven bodies it replaced (an identity on every
-- other body), applied INNERMOST so the literals below still prove what
-- they proved; pgTAP 105 A6 / A7 pin 157's own.
create function pg_temp.un157(p_src text) returns text language sql as $un157$
  select replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(p_src,
    E'  -- 157 / F447: each ROSTERED player\'s kickoff is judged per PLAYER — his\n  -- current NFL team\'s game, or, when that is still ahead (or he has no\n  -- team), a start this league recorded for a game that kicked off or his\n  -- stat line for the week (lineup_player_kickoff_internal): a player the\n  -- NFL released or traded AFTER he played is still locked for the week.\n  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, p_week, v_e ->> \'player_id\', p_at);\n',
    E'  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> \'nfl_team\', p_at);\n'),
    E'      SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, v_league.season, v_current, v_e ->> \'player_id\', p_at);   -- 157 / F447\n',
    E'      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> \'nfl_team\', p_at);\n'),
    E'  -- 157 / F447: judged per PLAYER (set_lineup\'s step (6) helper) — a player\n  -- the NFL released or traded after he played is locked, never OPEN.\n  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_player_kickoff_internal(p_league_id, p_season, p_week, v_e ->> \'player_id\', p_at);\n',
    E'  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP\n    SELECT * INTO v_k FROM public.lineup_kickoff_internal(p_season, p_week, v_e ->> \'nfl_team\', p_at);\n'),
    E'    v_drop_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_drop, p_at);   -- 157 / F447: judged per player (played this week)\n',
    E'    v_drop_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_drop_p.team, p_at);\n'),
    E'    v_add_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_add, p_at);   -- 157 / F447: judged per player (played this week)\n',
    E'    v_add_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at);\n'),
    E'  )\n  -- 157 / F447: judged per PLAYER — a player the NFL released or traded\n  -- after he played this week is locked at the run (Q73 / Q74).\n  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.id COLLATE "C"), \'[]\'::jsonb) INTO v_locked\n  FROM public.players p JOIN claim_players cp ON cp.pid = p.id\n  WHERE (public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p.id, p_at) ->> \'locked\')::boolean;\n',
    E'  ), nfl AS (\n    SELECT DISTINCT p.team FROM public.players p JOIN claim_players cp ON cp.pid = p.id WHERE p.team IS NOT NULL\n  ), locked_nfl AS (\n    SELECT n.team FROM nfl n\n    WHERE (public.pool_game_lock_any_internal(v_league.season, v_current, n.team, p_at) ->> \'locked\')::boolean\n  )\n  SELECT COALESCE(jsonb_agg(p.id ORDER BY p.id COLLATE "C"), \'[]\'::jsonb) INTO v_locked\n  FROM public.players p JOIN claim_players cp ON cp.pid = p.id JOIN locked_nfl ln ON ln.team = p.team;\n'),
    E'  v_add_lock := public.pool_game_lock_player_internal(p_league_id, v_league.season, v_current, p_add, p_at);   -- 157 / F447: judged per player (played this week)\n',
    E'  v_add_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_add_p.team, p_at);\n'),
    E'    v_lock := public.pool_game_lock_player_internal(p_league.id, p_league.season, v_current, v_p.player_id, p_at);   -- 157 / F447: judged per player (played this week)\n',
    E'    v_lock := public.pool_game_lock_any_internal(p_league.season, v_current, v_p.nfl_team, p_at);\n'),
    E'          v_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_pool.nfl_team, p_now);\n          -- 157 / F447: the view agrees with the lock every writer enforces —\n          -- per PLAYER: unlocked by his current team, but he PLAYED this week\n          -- (a start recorded for a real kickoff, or his stat line) ⇒ locked.\n          IF NOT (v_lock ->> \'locked\')::boolean THEN\n            v_lock := COALESCE(public.lineup_played_lock_internal(v_lg.id, v_league.season, v_current, v_pool.player_id, p_now), v_lock);\n          END IF;\n',
    E'          v_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_pool.nfl_team, p_now);\n'),
    E'            SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_row.week, v_team, p_now);\n            -- 157 / F447: a PASSED kickoff this record holds STAYS when it is a\n            -- real kickoff of the week and his current team\'s game is not\n            -- postponed — he played, and the NFL has released or traded him\n            -- since: never re-read to NULL or to his new team\'s later game.\n            -- A flexed or postponed game still moves it (E42 / E43).\n            IF (v_e ->> \'kickoff_at\')::timestamptz IS DISTINCT FROM v_k.kickoff_at\n               AND public.lineup_record_kicked_off_internal(v_league.season, v_row.week, v_pid, (v_e ->> \'kickoff_at\')::timestamptz, p_now) THEN\n              v_k.kickoff_at := (v_e ->> \'kickoff_at\')::timestamptz;\n            END IF;\n',
    E'            SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_row.week, v_team, p_now);\n')
$un157$;

-- L.D2.17 (migration 160 — additive, the R992 shape): pg_temp.un160 reverses
-- 160's ONE substitution in process_waivers_internal (the no-key tiebreaker
-- fallback; an identity on every other body), applied INNERMOST so the
-- literals below still prove what they proved; pgTAP 108 A pins 160's own.
create function pg_temp.un160(p_src text) returns text language sql as $un160$
  select replace(p_src,
    '  v_tb := COALESCE(v_league.settings ->> ''faab_tiebreaker'', ''rolling_priority'');   -- 160 / L.D2.17: no stored key => the rolling order (Chris 2026-09-29)',
    '  v_tb := COALESCE(v_league.settings ->> ''faab_tiebreaker'', ''reverse_standings'');')
$un160$;

-- ---------------------------------------------------------------------------
-- A. Form pins, D137 in the database, the neighbours untouched
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('lineup_record_kicked_off_internal', 'lineup_played_internal', 'lineup_player_kickoff_internal',
                                                 'lineup_played_lock_internal', 'pool_game_lock_player_internal')),
  'lineup_played_internal:f:search_path="":f:f lineup_played_lock_internal:f:search_path="":f:f lineup_player_kickoff_internal:f:search_path="":f:f lineup_record_kicked_off_internal:f:search_path="":f:f pool_game_lock_player_internal:f:search_path="":f:f',
  'A1 the five new helpers: one overload each, PLAIN, search_path empty, closed to anon and authenticated');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal', 'roster_add_drop_internal',
                                                 'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal', 'lineup_lock_tick')),
  'lineup_autopilot_internal:f:search_path="":f:f lineup_lock_tick:t:search_path="":f:f process_waivers_internal:f:search_path="":f:f roster_add_drop_internal:f:search_path="":f:f set_lineup_internal:f:search_path="":f:f trade_lock_internal:f:search_path="":f:f waiver_claim_submit_internal:f:search_path="":f:f',
  'A2 the seven replaced bodies: one overload each (signatures unchanged), the tick still the only DEFINER, search_path empty, closed to anon and authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('lineup_record_kicked_off_internal', 'lineup_played_internal', 'lineup_player_kickoff_internal',
                        'lineup_played_lock_internal', 'pool_game_lock_player_internal',
                        'set_lineup_internal', 'lineup_autopilot_internal', 'roster_add_drop_internal',
                        'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal', 'lineup_lock_tick')),
  'A3 PUBLIC holds EXECUTE on none of the twelve (REVOKEs restated)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un157(pg_temp.un160(p.prosrc))), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal', 'roster_add_drop_internal',
                                                 'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal', 'lineup_lock_tick')),
  'lineup_autopilot_internal=0eb0586b35c3a22559e2323ba25b58a5 lineup_lock_tick=540946257b7f6b2f2739e4d27f5cf584 process_waivers_internal=7b3dad5e6e9483ed0edc82bd8f055ada roster_add_drop_internal=f4879cd129747a28d52bab277108265e set_lineup_internal=991dfe0a36e1e9d3f823e81999bf3190 trade_lock_internal=0e8a591bdac064d7c3d06eb0e4a414f4 waiver_claim_submit_internal=33aaaaa0bf94e620c3f03f836aa888f7',
  'A4 D137: each live body with 157''s substitutions reversed is its NEWEST definer''s FILE TEXT (154:372 / 154:1899 / 153:422 / 150:1397 / 153:1981 / 151:689 / 139:1045 — the stored md5 literals 102 A8, 101 A13 and 087 A7 pin)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un160(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal', 'roster_add_drop_internal',
                                                 'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal', 'lineup_lock_tick')),
  'lineup_autopilot_internal=544d32c67abd3f3243ff1bfa568360ad lineup_lock_tick=bcc10f9a40e99f7a1cf83e1c94f813f0 process_waivers_internal=440a595061f1bdd26715ee381b5d6afa roster_add_drop_internal=d0e6afde7fdd872cb0d9576de91bcf7e set_lineup_internal=ca3307414057469da7ed5c0af0b29fe6 trade_lock_internal=cfdbf2451a0287cc6bf6bb1ee166b553 waiver_claim_submit_internal=5822e363acddfb8f781dc3ea6fb7e448',
  'A5 the seven live prosrc md5s — 157 as written (stored literals)');
select is(
  (select string_agg(p.proname || '=' || md5(p.prosrc), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('trade_execute_internal', 'commish_roster_override_internal', 'commish_edit_lineup_internal',
                                                 'lineup_kept_starter_internal', 'lineup_kickoff_internal', 'pool_game_lock_any_internal')),
  'commish_edit_lineup_internal=60662cff534f641b2674201b999681c8 commish_roster_override_internal=32972a1a5183c748be5a90c8ffdad7f1 lineup_kept_starter_internal=3266056c8506911d20ef8f96fd76cbb3 lineup_kickoff_internal=80b9c63efa3cb5bbef7b79863e9801a7 pool_game_lock_any_internal=c04027b390f46cf19247fab2ff2e1990 trade_execute_internal=044fd0a7668adb67c2c81b0e452b8341',
  'A6 UNTOUCHED (stored literals): the executor (156 — R1234 needs no hunk), the two commissioner verbs (they stand outside the lock), 154''s kept-starter judgment, 112''s team datum and 153''s team lock');
select is(
  (select string_agg(p.proname || ':' || (length(p.prosrc) - length(replace(p.prosrc, 'public.pool_game_lock_any_internal(', ''))) / length('public.pool_game_lock_any_internal(')
                     || '/' || (length(p.prosrc) - length(replace(p.prosrc, 'public.pool_game_lock_player_internal(', ''))) / length('public.pool_game_lock_player_internal('),
                     ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('roster_add_drop_internal', 'waiver_claim_submit_internal', 'process_waivers_internal', 'trade_lock_internal')),
  'process_waivers_internal:0/1 roster_add_drop_internal:0/2 trade_lock_internal:0/1 waiver_claim_submit_internal:0/1',
  'A7 every lock a manager, a claim, a run or a trade meets is judged PER PLAYER: no enforcing body reads 153''s team lock directly any more (team-lock calls / per-player calls)');
select is(
  (select string_agg(p.proname || ':' || (length(p.prosrc) - length(replace(p.prosrc, 'public.lineup_kickoff_internal(', ''))) / length('public.lineup_kickoff_internal(')
                     || '/' || (length(p.prosrc) - length(replace(p.prosrc, 'public.lineup_player_kickoff_internal(', ''))) / length('public.lineup_player_kickoff_internal('),
                     ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal')),
  'lineup_autopilot_internal:0/1 set_lineup_internal:0/2',
  'A8 set_lineup and autopilot read every ROSTERED player''s datum per player (team-datum calls / per-player calls)');

-- ---------------------------------------------------------------------------
-- FIXTURE
-- ---------------------------------------------------------------------------
-- THE CALENDAR (2026 seeds; only the stamps are rewritten): weeks 1–5 over;
-- WEEK 6 — PA @ PZ Thu 10-16 00:15Z, PB @ PY Sun 10-18 17:00Z, PC on bye,
-- its last game recorded ending Tue 10-20 03:30Z. Every OTHER week carries a
-- dummy game so no week falls to the no-game-rows datum chain (which locks
-- everyone). "Sunday 12:00" (R1216's probe) = 10-18 16:00Z: after the
-- Thursday game, before the Sunday one.
update nfl_weeks w
set last_game_ends_at = case when w.week <= 5 then w.starts_at + interval '6 days'
                             when w.week = 6 then '2026-10-20 03:30:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'pl-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 14 and w.week <> 6;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('pl-g6a', 2026, 6, 'PA', 'PZ', '2026-10-16 00:15:00+00'), ('pl-g6b', 2026, 6, 'PB', 'PY', '2026-10-18 17:00:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91570000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-pl' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'pl_user' || i)::jsonb, now(), now()
from generate_series(1, 8) i;

-- LP: instant pickups (none_fcfs), trades with no review — §B §C §E §F §G.
-- LW: FAAB, a run every day at 16:00 UTC, the next one Sunday 16:00Z — §D.
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     settings, roster_settings, waiver_next_run_at)
select l.id, '91570000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 12, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.wt, 100, 'none', l.st::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 2}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       l.nx
from (values
 ('b1570000-0000-4000-8000-000000000001'::uuid, 'pgtap-pl-LP', 'none_fcfs', '{}', null::timestamptz),
 ('b1570000-0000-4000-8000-000000000002'::uuid, 'pgtap-pl-LW', 'faab',
  '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "16:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}',
  '2026-10-18 16:00:00+00')
) as l(id, nm, wt, st, nx);

insert into teams (id, owner_id, name, league_id, status)
select t.id::uuid, ('91570000-0000-4000-8000-00000000000' || t.u)::uuid, t.nm, ('b1570000-0000-4000-8000-00000000000' || t.lg)::uuid, 'active'
from (values
 ('c1570000-0000-4000-8000-000000000011', 1, 'PL Commish', 1), ('c1570000-0000-4000-8000-000000000012', 2, 'PL Alpha', 1),
 ('c1570000-0000-4000-8000-000000000013', 3, 'PL Delta', 1),   ('c1570000-0000-4000-8000-000000000014', 4, 'PL Echo', 1),
 ('c1570000-0000-4000-8000-000000000015', 5, 'PL Foxtrot', 1), ('c1570000-0000-4000-8000-000000000016', 6, 'PL Golf', 1),
 ('c1570000-0000-4000-8000-000000000017', 7, 'PL Hotel', 1),
 ('c1570000-0000-4000-8000-000000000021', 1, 'PW Commish', 2), ('c1570000-0000-4000-8000-000000000022', 2, 'PW Whiskey', 2),
 ('c1570000-0000-4000-8000-000000000023', 3, 'PW Yankee', 2)
) as t(id, u, nm, lg);

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '91570000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c1570000-%';

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 14) w where l.id::text like 'b1570000-%';
-- (F4's transition guard: upcoming → live → correction_window → final, one step at a time.)
update league_weeks set status = 'live'              where league_id::text like 'b1570000-%' and week <= 6;
update league_weeks set status = 'correction_window' where league_id::text like 'b1570000-%' and week <= 5;
update league_weeks set status = 'final'             where league_id::text like 'b1570000-%' and week <= 5;

insert into drafts (league_id, status, completed_at, draft_order)
select l.id, 'complete', '2026-09-06 06:00:00+00',
       (select jsonb_agg(t.id order by t.id) from teams t where t.league_id = l.id)
from leagues l where l.id::text like 'b1570000-%';

-- Every player is on the team his name says at the Thursday kickoff; the
-- NFL's moves (a trade to PB, a release to no team) are applied below, after
-- the week's Thursday game — the F447 shape.
insert into players (id, full_name, position, team, status, adp)
select p.id, p.nm, 'QB', p.nfl, 'Active', p.adp
from (values
 ('pl-a1', 'PL A One (Thu)', 'PA', 100), ('pl-a2', 'PL A Two (Sun)', 'PB', 100), ('pl-a3', 'PL A Three (bye)', 'PC', 100),
 ('pl-d1', 'PL D One (Thu)', 'PA', 100), ('pl-d2', 'PL D Two (Sun)', 'PB', 100), ('pl-d3', 'PL D Three (bye)', 'PC', 100),
 ('pl-e1', 'PL E One (Sun)', 'PB', 100), ('pl-e2', 'PL E Two (bye)', 'PC', 100), ('pl-e3', 'PL E Three (Thu)', 'PA', 100),
 ('pl-f1', 'PL F One (Thu)', 'PA', 100), ('pl-f2', 'PL F Two (Sun)', 'PB', 50),  ('pl-f3', 'PL F Three (Thu)', 'PA', 10),
 ('pl-g1', 'PL G One (Thu)', 'PA', 100), ('pl-g2', 'PL G Two (bye)', 'PC', 100),
 ('pl-h1', 'PL H One (bye)', 'PC', 100), ('pl-h2', 'PL H Two (bye)', 'PC', 100),
 ('pl-x1', 'PL X One (Thu)', 'PA', 100), ('pl-x2', 'PL X Two (Thu)', 'PA', 100), ('pl-x3', 'PL X Three (Sun)', 'PB', 100),
 ('pl-w1', 'PL W One (Thu)', 'PA', 100), ('pl-w2', 'PL W Two (bye)', 'PC', 100),
 ('pl-wx', 'PL WX (Thu)', 'PA', 100), ('pl-wz', 'PL WZ (Thu)', 'PA', 100), ('pl-wy', 'PL WY (Sun)', 'PB', 100),
 ('pl-y1', 'PL Y One (bye)', 'PC', 100), ('pl-y2', 'PL Y Two (bye)', 'PC', 100)
) as p(id, nm, nfl, adp);

insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('PL Alpha', 'pl-a1'), ('PL Alpha', 'pl-a2'), ('PL Alpha', 'pl-a3'),
 ('PL Delta', 'pl-d1'), ('PL Delta', 'pl-d2'), ('PL Delta', 'pl-d3'),
 ('PL Echo', 'pl-e1'), ('PL Echo', 'pl-e2'), ('PL Echo', 'pl-e3'),
 ('PL Foxtrot', 'pl-f1'), ('PL Foxtrot', 'pl-f2'), ('PL Foxtrot', 'pl-f3'),
 ('PL Golf', 'pl-g1'), ('PL Golf', 'pl-g2'), ('PL Hotel', 'pl-h1'), ('PL Hotel', 'pl-h2'),
 ('PW Whiskey', 'pl-w1'), ('PW Whiskey', 'pl-w2'), ('PW Yankee', 'pl-y1'), ('PW Yankee', 'pl-y2')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c1570000-%';
insert into league_player_pool (league_id, player_id, state)
select 'b1570000-0000-4000-8000-000000000001', p, 'free_agent' from unnest(array['pl-x1', 'pl-x2', 'pl-x3']) p;
insert into league_player_pool (league_id, player_id, state)
select 'b1570000-0000-4000-8000-000000000001', r.player_id, 'rostered' from league_rosters r where r.league_id = 'b1570000-0000-4000-8000-000000000001';

-- Lineups in 114's shape; p_k0 / p_k1 = each slot's RECORDED kickoff (the
-- starters[] record the writer that seated him left — here the Thursday
-- kickoff for every Thursday starter).
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c1570000-%' $$;
create function pg_temp.put(p_team text, p_week int, p_q0 text, p_q1 text, p_bench jsonb, p_k0 timestamptz default null, p_k1 timestamptz default null)
returns void language sql as $$
  insert into team_lineups (team_id, season, week, slot_map, starters, bench)
  values (pg_temp.team(p_team), 2026, p_week,
          jsonb_strip_nulls(jsonb_build_object('qb:0', p_q0, 'qb:1', p_q1)),
          jsonb_build_array(
            jsonb_build_object('slot', 'qb:0', 'player_id', p_q0, 'kickoff_at', p_k0, 'flags', case when p_q0 is null then '["empty"]'::jsonb else '[]'::jsonb end),
            jsonb_build_object('slot', 'qb:1', 'player_id', p_q1, 'kickoff_at', p_k1, 'flags', case when p_q1 is null then '["empty"]'::jsonb else '[]'::jsonb end)),
          p_bench)
$$;
select pg_temp.put(t.team, 6, t.q0, t.q1, t.bench::jsonb, t.k0::timestamptz, t.k1::timestamptz)
from (values
 ('PL Alpha',   'pl-a1', 'pl-a2', '["pl-a3"]',          '2026-10-16 00:15:00+00', '2026-10-18 17:00:00+00'),
 ('PL Delta',   'pl-d1', 'pl-d2', '["pl-d3"]',          '2026-10-16 00:15:00+00', '2026-10-18 17:00:00+00'),
 ('PL Echo',    'pl-e1', null,    '["pl-e2", "pl-e3"]', '2026-10-18 17:00:00+00', null),
 ('PL Foxtrot', 'pl-f1', null,    '["pl-f2", "pl-f3"]', '2026-10-16 00:15:00+00', null),
 ('PL Golf',    'pl-g1', null,    '["pl-g2"]',          '2026-10-16 00:15:00+00', null),
 ('PL Hotel',   'pl-h1', null,    '["pl-h2"]',          null, null),
 ('PW Whiskey', 'pl-w1', null,    '["pl-w2"]',          '2026-10-16 00:15:00+00', null),
 ('PW Yankee',  'pl-y1', null,    '["pl-y2"]',          null, null)
) as t(team, q0, q1, bench, k0, k1);
select pg_temp.put(t.team, 7, t.q0, null, t.bench::jsonb)
from (values ('PL Golf', 'pl-g1', '["pl-g2"]'), ('PL Hotel', 'pl-h1', '["pl-h2"]')) as t(team, q0, bench);

-- THE THURSDAY GAME'S STAT LINES (he played): the starters D One, F One, G
-- One, W One; the BENCH men E Three and F Three; the free agents X One, X Two,
-- WX, WZ. A One has NONE — his lineup record alone says he played. X Two's
-- line names no game (the week's first kickoff stands in).
insert into player_stats (player_id, season, week, stat_type, game_id, updated_at)
select p, 2026, 6, 'weekly', case when p = 'pl-x2' then null else 'pl-g6a' end, '2026-10-16 03:30:00+00'
from unnest(array['pl-d1', 'pl-f1', 'pl-g1', 'pl-w1', 'pl-e3', 'pl-f3', 'pl-x1', 'pl-x2', 'pl-wx', 'pl-wz']) p;

-- THE NFL MOVES, after the Thursday game: traded to PB (plays Sunday
-- 17:00Z) or released (no team — read as a bye).
update players set team = 'PB' where id in ('pl-d1', 'pl-e3', 'pl-f3', 'pl-g1', 'pl-x1', 'pl-w1', 'pl-wx');
update players set team = null where id in ('pl-a1', 'pl-f1', 'pl-x2', 'pl-wz');

-- Post-reset race guard (067's): today's + tomorrow's realtime.messages partitions.
do $part$
declare
  d date;
  part_name text;
begin
  foreach d in array array[current_date, current_date + 1] loop
    part_name := 'messages_' || to_char(d, 'YYYY_MM_DD');
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'realtime' and c.relname = part_name) then
      execute format('create table realtime.%I partition of realtime.messages for values from (%L) to (%L)',
                     part_name, d::timestamp, (d + 1)::timestamp);
    end if;
  end loop;
end
$part$;

create temp table r105 (tag text primary key, r jsonb not null);
create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '91570000-0000-4000-8000-00000000000' || p_n, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b1570000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a1570000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.lu(p_team text, p_week int) returns text language sql as $$
  select format('%s | %s | %s', tl.slot_map::text,
                (select string_agg(coalesce(s ->> 'player_id', '-'), ',' order by o) from jsonb_array_elements(tl.starters) with ordinality x(s, o)),
                tl.bench::text)
  from team_lineups tl where tl.team_id = pg_temp.team(p_team) and tl.season = 2026 and tl.week = p_week $$;
create function pg_temp.rec(p_team text, p_pid text) returns text language sql as $$
  select coalesce((select s ->> 'kickoff_at' from team_lineups tl, jsonb_array_elements(tl.starters) s
                   where tl.team_id = pg_temp.team(p_team) and tl.week = 6 and s ->> 'player_id' = p_pid), 'null') $$;
create function pg_temp.roster_of(p_pid text) returns text language sql as $$
  select coalesce((select t.name from league_rosters r join teams t on t.id = r.team_id where r.player_id = p_pid and r.league_id::text like 'b1570000-%'), '(none)') $$;
create function pg_temp.ad(p_tag text, p_user int, p_team text, p_add text, p_drop text, p_at timestamptz, p_act int) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r105 select p_tag, public.roster_add_drop_internal(pg_temp.lg(1), pg_temp.team(p_team), p_add, p_drop, pg_temp.act(p_act), p_at);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r105 where tag = p_tag);
end $$;
create function pg_temp.sl(p_tag text, p_user int, p_team text, p_map jsonb, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r105 select p_tag, public.set_lineup_internal(pg_temp.lg(1), pg_temp.team(p_team), 6, p_map, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r105 where tag = p_tag);
end $$;
create function pg_temp.claim(p_tag text, p_user int, p_team text, p_add text, p_drop text, p_bid int, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r105 select p_tag, public.waiver_claim_submit_internal(pg_temp.lg(2), pg_temp.team(p_team), p_add, p_drop, p_bid, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r105 where tag = p_tag);
end $$;
-- An ACCEPTED path is called through pg_temp.try: a refusal is recorded as
-- {"error": …} under its tag instead of aborting the transaction, so a break
-- probe reds the cell (and every later cell still runs).
create function pg_temp.try(p_tag text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
exception when others then
  perform set_config('request.jwt.claims', '', true);
  insert into r105 values (p_tag, jsonb_build_object('error', sqlstate || ': ' || sqlerrm)) on conflict (tag) do nothing;
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  return 'ACCEPTED';
exception when others then
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ': ' || sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- B. The judgment itself — the three records, the boundary instants
-- ---------------------------------------------------------------------------
select is(
  format('%s|%s|%s|%s|%s',
         public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', '2026-10-16 00:15:00+00', '2026-10-16 00:15:00+00'),
         public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', '2026-10-16 00:15:00+00', '2026-10-16 00:14:59+00'),
         public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', '2026-10-16 02:15:00+00', '2026-10-18 16:00:00+00'),
         public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', null, '2026-10-18 16:00:00+00'),
         public.lineup_record_kicked_off_internal(2026, 7, 'pl-d1', '2026-10-16 00:15:00+00', '2026-10-18 16:00:00+00')),
  't|f|f|f|f',
  'B1 a recorded kickoff is REAL AND PASSED only AT/after a kickoff a game of THAT week has (Thu 00:15Z at 00:15:00 yes, at 00:14:59 no); an instant no game of the week has (a stale, flexed record), NULL, or another week''s game never counts');
update nfl_games set status = 'postponed' where id = 'pl-g6b';
select is(
  format('%s|%s', public.lineup_record_kicked_off_internal(2026, 6, 'pl-d1', '2026-10-16 00:15:00+00', '2026-10-18 16:00:00+00'),
                  public.lineup_record_kicked_off_internal(2026, 6, 'pl-a1', '2026-10-16 00:15:00+00', '2026-10-18 16:00:00+00')),
  'f|t',
  'B2 E43: while his CURRENT team''s game (PB) is postponed his record does not count (D One, now PB); a released player (A One, no team) is unaffected');
update nfl_games set status = 'scheduled' where id = 'pl-g6b';
select is(
  (select string_agg(format('%s=%s/%s/%s', x.p, y.played, coalesce(to_char(y.kickoff_at at time zone 'UTC', 'MM-DD HH24:MI'), '-'), coalesce(y.datum_arm, '-')), ' ' order by x.p)
   from unnest(array['pl-a1', 'pl-d1', 'pl-e3', 'pl-x2', 'pl-e1', 'pl-x3']) x(p)
   cross join lateral public.lineup_played_internal(pg_temp.lg(1), 2026, 6, x.p, '2026-10-18 16:00:00+00') y),
  'pl-a1=t/10-16 00:15/lineup_record pl-d1=t/10-16 00:15/lineup_record pl-e1=f/-/- pl-e3=t/10-16 00:15/stat_line pl-x2=t/10-16 00:15/stat_line pl-x3=f/-/-',
  'B3 played, by the records: A One by his start''s record alone; D One by his record (first); E Three (a bench man) and X Two (a free agent whose line names no game — the week''s first kickoff stands in) by their stat lines; E One and X Three (Sunday, still to play) not');
select is(
  format('%s|%s',
         (select played from public.lineup_played_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-16 00:14:59+00')),
         (select played from public.lineup_played_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-16 00:15:00+00'))),
  'f|t',
  'B4 BOUNDARY: a stat line counts from its game''s kickoff — 00:14:59 no, 00:15:00 yes (the evaluation instant never precedes the game it records)');
select is(
  format('%s || %s',
         (select format('%s/%s/%s', (d ->> 'locked'), d ->> 'kickoff_at', d ->> 'datum_arm') from public.pool_game_lock_any_internal(2026, 6, 'PB', '2026-10-18 16:00:00+00') d),
         (select format('%s/%s/%s/%s/%s', (d ->> 'locked'), d ->> 'week', d ->> 'kickoff_at', d ->> 'window_ends_at', d ->> 'datum_arm')
          from public.pool_game_lock_player_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-18 16:00:00+00') d)),
  'false/2026-10-18T17:00:00+00:00/nfl_games || true/6/2026-10-16T00:15:00+00:00/2026-10-20T03:30:00+00:00/stat_line',
  'B5 PREMISE + FIX: at Sunday 12:00 ET his CURRENT team (PB) reads UNLOCKED (153''s team lock — every reader before 157); the per-player lock reads him LOCKED — he played Thursday — until week 6''s recorded end');
select is(
  format('%s|%s|%s',
         (select d ->> 'locked' from public.pool_game_lock_player_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-20 03:29:59+00') d),
         (select d ->> 'locked' from public.pool_game_lock_player_internal(pg_temp.lg(1), 2026, 6, 'pl-x1', '2026-10-20 03:30:00+00') d),
         (select d ->> 'locked' from public.pool_game_lock_player_internal(pg_temp.lg(1), 2026, 6, 'pl-x3', '2026-10-18 16:00:00+00') d)),
  'true|false|false',
  'B6 BOUNDARY: the lock still RELEASES at the week''s lock release (153) — locked at 03:29:59, open at 03:30:00; a Sunday player who has not played is open at Sunday 12:00 (positive control)');
select is(
  (select format('%s/%s/%s', k.kickoff_at at time zone 'UTC', k.datum_arm, k.on_bye)
   from public.lineup_player_kickoff_internal(pg_temp.lg(1), 2026, 6, 'pl-a1', '2026-10-18 16:00:00+00') k)
  || ' || ' ||
  (select format('%s/%s/%s', k.kickoff_at at time zone 'UTC', k.datum_arm, k.on_bye)
   from public.lineup_player_kickoff_internal(pg_temp.lg(1), 2026, 6, 'pl-e1', '2026-10-18 16:00:00+00') k),
  '2026-10-16 00:15:00/lineup_record/f || 2026-10-18 17:00:00/nfl_games/f',
  'B7 the lineup datum per player: A One (released — his team reads as a BYE) carries the Thursday kickoff he played in, never a bye; E One (Sunday) is his team''s kickoff, unchanged');

-- ---------------------------------------------------------------------------
-- C. R1216's live probe, as cells — the drop, the add, the start (Sunday)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.err($$ select pg_temp.ad('C1', 3, 'PL Delta', null, 'pl-d1', '2026-10-18 16:00:00+00', 1) $$),
  'P0001: roster_add_drop: PL D One (Thu) (pl-d1) is locked for drops — kicked off at 2026-10-16T00:15:00+00:00 (lineup_record); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
  'C1 R1216: at Sunday 12:00 his manager''s DROP of D One (played Thursday, since traded to a Sunday team) is REFUSED by name — before 157 it was accepted and his week-6 start was cleared');
select is(pg_temp.roster_of('pl-d1') || ' | ' || pg_temp.lu('PL Delta', 6),
  'PL Delta | {"qb:0": "pl-d1", "qb:1": "pl-d2"} | pl-d1,pl-d2 | ["pl-d3"]',
  'C2 …so he stays on PL Delta and in its week-6 start — nothing moved');
select is(
  pg_temp.err($$ select pg_temp.ad('C3', 2, 'PL Alpha', null, 'pl-a1', '2026-10-18 16:00:00+00', 2) $$),
  'P0001: roster_add_drop: PL A One (Thu) (pl-a1) is locked for drops — kicked off at 2026-10-16T00:15:00+00:00 (lineup_record); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
  'C3 the RELEASE variant: A One (no NFL team now — read as a bye before 157; no stat line) is refused too, by his start''s record');
select is(
  pg_temp.err($$ select pg_temp.ad('C4', 4, 'PL Echo', 'pl-x1', null, '2026-10-18 16:01:00+00', 3) $$),
  'P0001: roster_add_drop: PL X One (Thu) (pl-x1) is locked for adds — kicked off at 2026-10-16T00:15:00+00:00 (stat_line); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'C4 R1216''s other half: another team''s ADD of X One (a free agent who played Thursday, since traded to a Sunday team) is REFUSED — his Thursday points cannot join a second team this week');
select is(
  pg_temp.err($$ select pg_temp.ad('C5', 4, 'PL Echo', 'pl-x2', null, '2026-10-18 16:01:00+00', 4) $$),
  'P0001: roster_add_drop: PL X Two (Thu) (pl-x2) is locked for adds — kicked off at 2026-10-16T00:15:00+00:00 (stat_line); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'C5 the RELEASE variant of the add: X Two (no NFL team, a stat line naming no game) is refused the same way');
select is(
  pg_temp.err($$ select pg_temp.sl('C6', 4, 'PL Echo', '{"qb:0": "pl-e1", "qb:1": "pl-e3"}', '2026-10-18 16:02:00+00', 5) $$),
  'P0001: set_lineup: PL E Three (Thu)''s game kicked off at 2026-10-16T00:15:00+00:00 (stat_line) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted "qb:1"',
  'C6 the START: E Three sat on PL Echo''s bench Thursday and played, then was traded to a Sunday team — his manager cannot move him into a starting slot at Sunday 12:00 (his Thursday points would join the start)');
select is(
  pg_temp.err($$ select pg_temp.sl('C7', 2, 'PL Alpha', '{"qb:0": "pl-a3", "qb:1": "pl-a2"}', '2026-10-18 16:02:00+00', 6) $$),
  'P0001: set_lineup: slot qb:0 is locked — PL A One (Thu) kicked off at 2026-10-16T00:15:00+00:00 (lineup_record) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
  'C7 BENCH-AFTER-RELEASE: A One''s manager cannot bench him at Sunday 12:00 in the week he already played (released — before 157 he read as a bye, unlocked)');
select is(
  pg_temp.err($$ select pg_temp.sl('C8', 3, 'PL Delta', '{"qb:0": "pl-d3", "qb:1": "pl-d2"}', '2026-10-18 16:02:00+00', 7) $$),
  'P0001: set_lineup: slot qb:0 is locked — PL D One (Thu) kicked off at 2026-10-16T00:15:00+00:00 (lineup_record) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
  'C8 …and the TRADE variant: D One (now on a Sunday team) cannot be benched either');
select pg_temp.try('C9', $$ select pg_temp.sl('C9', 3, 'PL Delta', '{"qb:0": "pl-d1", "qb:1": "pl-d3"}', '2026-10-18 16:03:00+00', 8) $$);
select is(
  format('%s || %s', coalesce((select r ->> 'error' from r105 where tag = 'C9'), (select r ->> 'slot_map' from r105 where tag = 'C9')), pg_temp.rec('PL Delta', 'pl-d1')),
  '{"qb:0": "pl-d1", "qb:1": "pl-d3"} || 2026-10-16T00:15:00+00:00',
  'C9 POSITIVE CONTROL: a submit that KEEPS him goes through — the unlocked slot (D Two, Sunday) is changed freely, and his record keeps the Thursday kickoff he played in');
select pg_temp.try('C10', $$ select pg_temp.ad('C10', 4, 'PL Echo', 'pl-x3', 'pl-e2', '2026-10-18 16:04:00+00', 9) $$);
select is(
  format('%s|%s|%s', coalesce((select r ->> 'error' from r105 where tag = 'C10'), 'ok'), pg_temp.roster_of('pl-x3'), pg_temp.roster_of('pl-e2')),
  'ok|PL Echo|(none)',
  'C10 POSITIVE CONTROL: players who have NOT played this week move exactly as before — PL Echo adds X Three (Sunday) and drops E Two (bye) at Sunday 12:04');

-- ---------------------------------------------------------------------------
-- T. lineup_lock_tick — the record is kept; the pool view agrees
-- ---------------------------------------------------------------------------
select set_config('pgtap.t1', public.lineup_lock_tick('2026-10-18 16:05:00+00', pg_temp.lg(1))::text, true);
select is(
  format('%s|%s|%s|%s', pg_temp.rec('PL Alpha', 'pl-a1'), pg_temp.rec('PL Delta', 'pl-d1'), pg_temp.rec('PL Foxtrot', 'pl-f1'), pg_temp.rec('PL Alpha', 'pl-a2')),
  '2026-10-16T00:15:00+00:00|2026-10-16T00:15:00+00:00|2026-10-16T00:15:00+00:00|2026-10-18T17:00:00+00:00',
  'T1 F447: the tick KEEPS each passed Thursday record — A One and F One (released: before 157 re-read to NULL), D One (traded: before 157 re-read to his new team''s Sunday kickoff); A Two''s Sunday record is untouched');
select is(
  (select string_agg(pp.player_id || '=' || pp.state || ':' || coalesce(pp.locked_until::text, 'null'), ' ' order by pp.player_id)
   from league_player_pool pp where pp.league_id = pg_temp.lg(1) and pp.player_id in ('pl-x1', 'pl-x2', 'pl-d1', 'pl-e1')),
  'pl-d1=rostered:2026-10-20 03:30:00+00 pl-e1=rostered:null pl-x1=locked_in_game:2026-10-20 03:30:00+00 pl-x2=locked_in_game:2026-10-20 03:30:00+00',
  'T2 the pool VIEW agrees with the lock every writer enforces: the played free agents X One / X Two are locked_in_game until week 6''s end, the rostered D One carries it too; E One (Sunday) is open');
select set_config('pgtap.t3', public.lineup_lock_tick('2026-10-20 03:30:00+00', pg_temp.lg(1))::text, true);
select is(
  (select string_agg(pp.player_id || '=' || pp.state || ':' || coalesce(pp.locked_until::text, 'null'), ' ' order by pp.player_id)
   from league_player_pool pp where pp.league_id = pg_temp.lg(1) and pp.player_id in ('pl-x1', 'pl-x2')),
  'pl-x1=free_agent:null pl-x2=free_agent:null',
  'T3 …and releases at the week''s recorded end, as every lock does (153 unchanged)');

-- ---------------------------------------------------------------------------
-- E. Autopilot — a played starter is locked; a played bench man never seated
-- ---------------------------------------------------------------------------
insert into r105 select 'E1', public.lineup_autopilot_internal(pg_temp.lg(1), pg_temp.team('PL Foxtrot'), 2026, 6, '2026-10-18 16:00:00+00');
select is(
  (select format('%s|%s', r ->> 'changed', r -> 'slot_map') from r105 where tag = 'E1'),
  'true|{"qb:0": "pl-f1", "qb:1": "pl-f2"}',
  'E1 autopilot at Sunday 12:00: F One (played Thursday, released) is LOCKED at qb:0 — never read as a bye and benched; the open qb:1 goes to F Two (Sunday), not to F Three');
select is(
  (select string_agg(e ->> 'player_id', ',' order by e ->> 'player_id') from r105, jsonb_array_elements(r -> 'skipped_locked') e where tag = 'E1'),
  'pl-f3',
  'E2 …F Three (a bench man who played Thursday, since traded to a Sunday team) is NAMED in skipped_locked — his Thursday points never enter the start');

-- ---------------------------------------------------------------------------
-- F. The trade executor (R1234) — a manager accept DEFERS, the release runs it
-- ---------------------------------------------------------------------------
select pg_temp.as_user(6);
insert into r105 select 'F0', public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('PL Golf'), pg_temp.team('PL Hotel'),
  jsonb_build_array(jsonb_build_object('player_id', 'pl-g1', 'from_team_id', pg_temp.team('PL Golf')),
                    jsonb_build_object('player_id', 'pl-h1', 'from_team_id', pg_temp.team('PL Hotel'))),
  null, null, pg_temp.act(31), '2026-10-18 15:00:00+00', null);
select pg_temp.as_user(7);
select pg_temp.try('F1', $$ insert into r105 select 'F1', public.trade_respond_internal(pg_temp.lg(1), (select (r #>> '{trade,id}')::uuid from r105 where tag = 'F0'),
  'accept', null, null, null, pg_temp.act(32), '2026-10-18 16:00:00+00', null) $$);
select set_config('request.jwt.claims', '', true);
create function pg_temp.f_trade() returns uuid language sql as $$ select (r #>> '{trade,id}')::uuid from r105 where tag = 'F0' $$;
select is(
  (select format('%s|%s|%s || %s / %s', coalesce(r ->> 'error', r #>> '{execution,outcome}'), r #>> '{execution,execute_after}',
                 (select t.status || ':' || coalesce(t.execute_after::text, 'null') from trades t where t.id = pg_temp.f_trade()),
                 pg_temp.roster_of('pl-g1'), pg_temp.roster_of('pl-h1'))
   from r105 where tag = 'F1'),
  'deferred|2026-10-20T03:30:00+00:00|accepted:2026-10-20 03:30:00+00 || PL Golf / PL Hotel',
  'F1 R1234: PL Hotel accepts at Sunday 12:00 a trade naming G One (played Thursday, since traded to a Sunday team) — the executor DEFERS it to week 6''s end; nothing moves (before 157 it completed at once and his played start left the live week, with no re-score)');
insert into r105 select 'F2', public.trade_tick('2026-10-20 03:29:59+00', pg_temp.lg(1));
insert into r105 select 'F3', public.trade_tick('2026-10-20 03:30:00+00', pg_temp.lg(1));
select is(
  format('%s|%s || %s / %s', (select r ->> 'executed' from r105 where tag = 'F2'), (select r ->> 'executed' from r105 where tag = 'F3'),
         pg_temp.roster_of('pl-g1'), pg_temp.roster_of('pl-h1')),
  '0|1 || PL Hotel / PL Golf',
  'F2 BOUNDARY: the tick at week 6''s end − 1 s leaves it parked; AT the end it goes through — both players move together');
select is(
  format('%s || %s || %s', pg_temp.lu('PL Golf', 6), pg_temp.lu('PL Golf', 7), pg_temp.lu('PL Hotel', 7)),
  '{"qb:0": "pl-g1"} | pl-g1,- | ["pl-g2"] || {} | -,- | ["pl-g2", "pl-h1"] || {} | -,- | ["pl-g1", "pl-h2"]',
  'F3 the played start STAYS in PL Golf''s week 6 (the week closed to moves at its end — the first-unfinished-week rule); the move starts at week 7, each man on his new team''s bench');
select is(
  (select count(*)::int from score_fanout f where f.season = 2026 and f.week = 6 and f.player_id like 'pl-%'),
  0,
  'F4 …so nothing needs re-scoring: the executor queued no re-score and none is owed (only the commissioner''s force can move a played starter out of a live week, and it queues one — 156, D416)');

-- ---------------------------------------------------------------------------
-- D. Waivers (LW) — Q74 at submit, Q73 / Q74 at the run
-- ---------------------------------------------------------------------------
select is(
  pg_temp.err($$ select pg_temp.claim('D1', 2, 'PW Whiskey', 'pl-wx', null, 5, '2026-10-18 16:00:00+00', 41) $$),
  'P0001: waiver_claim_submit: PL WX (Thu) (pl-wx) is locked for adds — kicked off at 2026-10-16T00:15:00+00:00 (stat_line); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'D1 Q74 per player: a NEW claim on WX (played Thursday, since traded to a Sunday team) is refused at submit, the same words as the pickup lock');
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d1570000-0000-4000-8000-000000000001', pg_temp.lg(2), pg_temp.team('PW Whiskey'), 'pl-wz', null,     4,  1, pg_temp.act(42), '91570000-0000-4000-8000-000000000002'),
 ('d1570000-0000-4000-8000-000000000002', pg_temp.lg(2), pg_temp.team('PW Whiskey'), 'pl-wy', 'pl-w1', 10, 2, pg_temp.act(43), '91570000-0000-4000-8000-000000000002'),
 ('d1570000-0000-4000-8000-000000000003', pg_temp.lg(2), pg_temp.team('PW Yankee'),  'pl-wy', null,     3,  1, pg_temp.act(44), '91570000-0000-4000-8000-000000000003');
insert into r105 select 'D2', public.process_waivers_internal(pg_temp.lg(2), '2026-10-18 16:00:00+00');
select is(
  (select string_agg(right(c.id::text, 1) || '=' || c.status || ':' || coalesce(c.result_reason, '-'), ' ' order by c.id)
   from waiver_claims c where c.league_id = pg_temp.lg(2)),
  '1=invalid:add_locked 2=invalid:drop_locked 3=won:-',
  'D2 the Sunday-12:00 run: the claim for WZ (played, RELEASED — the old run judged teams and skipped a player with none) fails add_locked; the claim dropping W One (played, traded) fails drop_locked; the $3 claim for WY (Sunday, not played) wins');
select is(
  format('%s|%s || %s', pg_temp.roster_of('pl-w1'), pg_temp.roster_of('pl-wz'), pg_temp.lu('PW Whiskey', 6)),
  'PW Whiskey|(none) || {"qb:0": "pl-w1"} | pl-w1,- | ["pl-w2"]',
  'D3 …so W One stays on PW Whiskey and in its week-6 start, WZ joins nobody');

-- ---------------------------------------------------------------------------
-- G. The commissioner stands outside the lock (timing) — and the lock stays
-- ---------------------------------------------------------------------------
select pg_temp.as_user(1);
select pg_temp.try('G1', $$ insert into r105 select 'G1', public.commish_roster_override_internal(pg_temp.lg(1), pg_temp.team('PL Delta'), null, 'pl-d1', null, null, null,
  pg_temp.act(51), '2026-10-18 16:10:00+00', 'pgtap 105', 'commish_force_add_drop') $$);
select set_config('request.jwt.claims', '', true);
select is(
  format('%s|%s', coalesce((select r ->> 'error' from r105 where tag = 'G1'), 'ok'), pg_temp.roster_of('pl-d1')),
  'ok|(none)',
  'G1 NOT BOUND: the commissioner''s force-drop of D One goes through at Sunday 12:10 — the timing rules never bind him (§10; F440 as ruled clears the start and re-scores)');
select is(
  pg_temp.err($$ select pg_temp.ad('G2', 4, 'PL Echo', 'pl-d1', 'pl-e1', '2026-10-18 16:11:00+00', 10) $$),
  'P0001: roster_add_drop: PL D One (Thu) (pl-d1) is locked for adds — kicked off at 2026-10-16T00:15:00+00:00 (stat_line); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no in-game pickups',
  'G2 …and the lock does not leave with his start: another manager still cannot add him this week (his stat line says he played)');

select * from finish();
rollback;
