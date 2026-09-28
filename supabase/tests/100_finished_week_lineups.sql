-- ============================================================================
-- A move after a week's last game leaves the finished week's lineups alone
-- — pgTAP 100 (task L.D2.14; migration 152; PROGRESS F437 + F439, D411;
-- spec §13.1 / §13.2 / §15.4 / §7.3.3 v2.16.62; Q75; D410(5)).
--
-- Numbering: RESERVED by the orchestrator (152 / 100).
-- OWN FIXTURE: users 9437…, leagues b437…, teams c437…, claims d437…,
-- action ids a437…, players fw-*. Every instant is passed explicitly (the
-- TimeProvider rule); internals are called as postgres with the actor's JWT
-- claims set, so auth.uid() is the actor.
--
-- THE CALENDAR (2026, rewritten inside this transaction — 099's shape):
-- weeks 1–6 over; week 7 starts Wed 10-21 04:00Z; FA kicks off Thu 10-23
-- 00:15Z, FB Sun 10-25 17:00Z, FM (Monday night) Tue 10-27 00:15Z; the
-- week's LAST GAME ENDS Tue 10-27 03:30Z; week 8 starts Wed 10-28 04:00Z
-- (its games ahead, its end not recorded). FC is on bye both weeks. So
-- between Tue 03:30Z and Wed 04:00Z the current week is still 7 — finished.
--
-- THE THREE SITES, each with: the Tuesday move of a PLAYED week-7 starter
-- (the week-7 row unchanged, the week-8 row cleared), a move while week 7 is
-- still being played (week 7 cleared — unchanged behaviour), and — for
-- add/drop — the boundary pair (end − 1 s ⇒ week 7 touched; AT the end ⇒
-- not) and a league whose first week has not started (unchanged).
--   §B roster_add_drop_internal        §C commish_roster_override_internal
--   §D process_waivers_internal        §E F439: a waiver claim's drop vs a
--                                          trade naming that player (both orders)
--
-- Falsifiability (tasks-M1 §4.3): every lineup is a stored literal; the
-- boundary instants are 03:29:59Z / 03:30:00Z; BREAK PROBES (the PR body):
-- one site at a time reverted to the old `>= v_current` (inside the test's
-- own transaction, so the ROLLBACK ends it) ⇒ add/drop: A3 B6 B7 B8 red;
-- the commissioner: C3 C4 C5 C6 C8 C9 C10 red; the waiver run: A3 D6 D8 E3
-- E9 red; every other cell green each time; 42/42 with 152 as written.
--
-- FIX ROUND (PR #337's review — R1206 / R1207; 152 edited in place):
--   §D9 (R1207) the PRODUCTION shape of a mid-week run — the current week's
--       end NULL (week 8 on Wednesday): the run clears that week's slot.
--   §G  (R1206) a PLAYED starter who left the roster after the week's last
--       game stays in that week's lineup while it is still current:
--       set_lineup refuses to replace / move him by name (the reviewer's
--       exact probe is G3) and carries him through an editor-shaped submit;
--       autopilot never reads his slot as OPEN; a NOT-played (bye) dropped
--       player's slot still opens (G6–G8, unchanged); 151's trade path (G9–
--       G10). G0b/G0c pin the two bodies (D137 in the database).
--   BREAK PROBES (the PR body), each injected inside this transaction:
--   131's set_lineup_internal byte for byte ⇒ G3 G4 G5 G9 G10 red (G0c
--   too — G0b stays green: reversing 152's hunks over 131's text is a no-op); 142's lineup_autopilot_internal ⇒ G2 red (G0c too); the waiver
--   run's CASE rewritten to `COALESCE(v_week_end, '-infinity') <= p_at` ⇒
--   A3 D9 red. 56/56 with 152 as written.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(56);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('roster_add_drop_internal', 'commish_roster_override_internal', 'process_waivers_internal')),
  'commish_roster_override_internal:f:search_path="":f:f process_waivers_internal:f:search_path="":f:f roster_add_drop_internal:f:search_path="":f:f',
  'A1 the three replaced internals: one overload each, PLAIN, search_path empty, closed to anon and authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('roster_add_drop_internal', 'commish_roster_override_internal', 'process_waivers_internal')),
  'A2 PUBLIC holds EXECUTE on none of them (REVOKEs restated)');
select is(
  (select string_agg(p.proname, ' ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('roster_add_drop_internal', 'commish_roster_override_internal', 'process_waivers_internal', 'trade_execute_internal')
     and p.prosrc like '%v_from_week := CASE WHEN v_week_end IS NOT NULL AND v_week_end <= p_at THEN v_current + 1 ELSE v_current END;%'
     and p.prosrc not like '%tl.week >= v_current%'),
  'commish_roster_override_internal process_waivers_internal roster_add_drop_internal trade_execute_internal',
  'A3 all four roster writers (151''s executor + the three replaced here) carry the SAME first-unfinished-week CASE, and none keeps the old `tl.week >= v_current` predicate');

-- ---------------------------------------------------------------------------
-- Fixtures (postgres context)
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case when w.week <= 6 then w.starts_at + interval '6 days'
                             when w.week = 7 then '2026-10-27 03:30:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'fw-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 14;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('fw-g7a', 2026, 7, 'FA', 'FZ', '2026-10-23 00:15:00+00'), ('fw-g7b', 2026, 7, 'FB', 'FY', '2026-10-25 17:00:00+00'),
 ('fw-g7m', 2026, 7, 'FM', 'FX', '2026-10-27 00:15:00+00'),
 ('fw-g8a', 2026, 8, 'FA', 'FZ', '2026-10-30 00:15:00+00'), ('fw-g8b', 2026, 8, 'FB', 'FY', '2026-11-01 18:00:00+00'),
 ('fw-g8m', 2026, 8, 'FM', 'FX', '2026-11-03 01:15:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('94370000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-fw' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'fw_user' || i)::jsonb, now(), now()
from generate_series(1, 6) i;

-- L1 add/drop + the commissioner; L0 a mid-season entry (first week 8);
-- LW the waiver runs; LT1 / LT2 F439 (commissioner review / no review).
-- Every waiver league runs daily at 10:00 UTC.
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     settings, roster_settings, waiver_next_run_at)
select l.id, '94370000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 12, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', 'faab', 100, l.review,
       '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "10:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 2}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       l.nx
from (values
 ('b4370000-0000-4000-8000-000000000001'::uuid, 'pgtap-fw-L1',  'commissioner', null::timestamptz),
 ('b4370000-0000-4000-8000-000000000002'::uuid, 'pgtap-fw-L0',  'commissioner', null),
 ('b4370000-0000-4000-8000-000000000003'::uuid, 'pgtap-fw-LW',  'commissioner', '2026-10-25 10:00:00+00'),
 ('b4370000-0000-4000-8000-000000000004'::uuid, 'pgtap-fw-LT1', 'commissioner', '2026-10-27 10:00:00+00'),
 ('b4370000-0000-4000-8000-000000000005'::uuid, 'pgtap-fw-LT2', 'none',         '2026-10-27 10:00:00+00')
) as l(id, nm, review, nx);

insert into teams (id, owner_id, name, league_id, status)
select t.id::uuid, ('94370000-0000-4000-8000-00000000000' || t.u)::uuid, t.nm, ('b4370000-0000-4000-8000-00000000000' || t.lg)::uuid, 'active'
from (values
 ('c4370000-0000-4000-8000-000000000011', 1, 'FW Commish', 1), ('c4370000-0000-4000-8000-000000000012', 2, 'FW Alpha',   1),
 ('c4370000-0000-4000-8000-000000000013', 3, 'FW Bravo',   1), ('c4370000-0000-4000-8000-000000000014', 4, 'FW Charlie', 1),
 ('c4370000-0000-4000-8000-000000000015', 5, 'FW Delta',   1),
 ('c4370000-0000-4000-8000-000000000021', 1, 'FW Echo',    2),
 ('c4370000-0000-4000-8000-000000000031', 1, 'FW Foxtrot', 3), ('c4370000-0000-4000-8000-000000000032', 2, 'FW Golf',    3),
 ('c4370000-0000-4000-8000-000000000041', 1, 'FW T1 Commish', 4), ('c4370000-0000-4000-8000-000000000042', 2, 'FW Tango', 4),
 ('c4370000-0000-4000-8000-000000000043', 3, 'FW Uniform', 4),
 ('c4370000-0000-4000-8000-000000000051', 1, 'FW T2 Commish', 5), ('c4370000-0000-4000-8000-000000000052', 2, 'FW Victor', 5),
 ('c4370000-0000-4000-8000-000000000053', 3, 'FW Whiskey', 5)
) as t(id, u, nm, lg);

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '94370000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c4370000-%';

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 14) w
where l.id::text like 'b4370000-%' and l.name <> 'pgtap-fw-L0';
insert into league_weeks (league_id, season, week)
select 'b4370000-0000-4000-8000-000000000002', 2026, w from generate_series(8, 14) w;

insert into drafts (league_id, status, completed_at, draft_order)
select l.id, 'complete', '2026-09-06 06:00:00+00',
       (select jsonb_agg(t.id order by t.id) from teams t where t.league_id = l.id)
from leagues l where l.id::text like 'b4370000-%';

insert into players (id, full_name, position, team, status)
select p.id, p.nm, 'QB', p.nfl, 'Active'
from (values
 ('fw-a1', 'FW A One (Thu)', 'FA'), ('fw-a2', 'FW A Two (Mon)', 'FM'), ('fw-a3', 'FW A Three (bye)', 'FC'),
 ('fw-b1', 'FW B One (Thu)', 'FA'), ('fw-b2', 'FW B Two (Sun)', 'FB'), ('fw-b3', 'FW B Three (bye)', 'FC'),
 ('fw-c1', 'FW C One (Thu)', 'FA'), ('fw-c2', 'FW C Two (Sun)', 'FB'), ('fw-c3', 'FW C Three (bye)', 'FC'),
 ('fw-d1', 'FW D One (Thu)', 'FA'),
 ('fw-e1', 'FW E One (Thu)', 'FA'), ('fw-e2', 'FW E Two (bye)', 'FC'),
 ('fw-f1', 'FW F One (Thu)', 'FA'), ('fw-f2', 'FW F Two (Mon)', 'FM'), ('fw-f3', 'FW F Three (bye)', 'FC'),
 ('fw-g1', 'FW G One (bye)', 'FC'), ('fw-x1', 'FW X One (bye)', 'FC'), ('fw-x2', 'FW X Two (bye)', 'FC'),
 ('fw-t1', 'FW T One (Thu)', 'FA'), ('fw-t2', 'FW T Two (bye)', 'FC'), ('fw-u1', 'FW U One (bye)', 'FC'), ('fw-u2', 'FW U Two (bye)', 'FC'),
 ('fw-y1', 'FW Y One (bye)', 'FC'),
 ('fw-v1', 'FW V One (Thu)', 'FA'), ('fw-v2', 'FW V Two (bye)', 'FC'), ('fw-w1', 'FW W One (bye)', 'FC'), ('fw-w2', 'FW W Two (bye)', 'FC'),
 ('fw-z1', 'FW Z One (bye)', 'FC'), ('fw-x3', 'FW X Three (bye)', 'FC'),
 ('fw-h1', 'FW H One (Thu)', 'FA'), ('fw-h2', 'FW H Two (Sun)', 'FB'), ('fw-h3', 'FW H Three (bye)', 'FC'),
 ('fw-j1', 'FW J One (Thu)', 'FA'), ('fw-j2', 'FW J Two (bye)', 'FC'), ('fw-j3', 'FW J Three (bye)', 'FC')
) as p(id, nm, nfl);

insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('FW Alpha', 'fw-a1'), ('FW Alpha', 'fw-a2'), ('FW Alpha', 'fw-a3'),
 ('FW Bravo', 'fw-b1'), ('FW Bravo', 'fw-b2'), ('FW Bravo', 'fw-b3'),
 ('FW Charlie', 'fw-c1'), ('FW Charlie', 'fw-c2'), ('FW Charlie', 'fw-c3'),
 ('FW Delta', 'fw-d1'),
 ('FW Echo', 'fw-e1'), ('FW Echo', 'fw-e2'),
 ('FW Foxtrot', 'fw-f1'), ('FW Foxtrot', 'fw-f2'), ('FW Foxtrot', 'fw-f3'), ('FW Golf', 'fw-g1'),
 ('FW Tango', 'fw-t1'), ('FW Tango', 'fw-t2'), ('FW Uniform', 'fw-u1'), ('FW Uniform', 'fw-u2'),
 ('FW Victor', 'fw-v1'), ('FW Victor', 'fw-v2'), ('FW Whiskey', 'fw-w1'), ('FW Whiskey', 'fw-w2')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c4370000-%';

-- Lineups in 114's shape: week 7 (being played / finished) and week 8 (set ahead).
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c4370000-%' $$;
create function pg_temp.put(p_team text, p_week int, p_q0 text, p_q1 text, p_bench jsonb) returns void language sql as $$
  insert into team_lineups (team_id, season, week, slot_map, starters, bench)
  values (pg_temp.team(p_team), 2026, p_week,
          jsonb_strip_nulls(jsonb_build_object('qb:0', p_q0, 'qb:1', p_q1)),
          jsonb_build_array(
            jsonb_build_object('slot', 'qb:0', 'player_id', p_q0, 'flags', case when p_q0 is null then '["empty"]'::jsonb else '[]'::jsonb end),
            jsonb_build_object('slot', 'qb:1', 'player_id', p_q1, 'flags', case when p_q1 is null then '["empty"]'::jsonb else '[]'::jsonb end)),
          p_bench)
$$;
select pg_temp.put(t.team, w.week, t.q0, t.q1, t.bench::jsonb)
from (values
 ('FW Alpha',   'fw-a1', 'fw-a2', '["fw-a3"]'), ('FW Bravo', 'fw-b1', 'fw-b2', '["fw-b3"]'),
 ('FW Charlie', 'fw-c1', 'fw-c2', '["fw-c3"]'), ('FW Delta', 'fw-d1', null,    '[]'),
 ('FW Foxtrot', 'fw-f1', 'fw-f2', '["fw-f3"]'), ('FW Golf',  'fw-g1', null,    '[]'),
 ('FW Tango',   'fw-t1', null,    '["fw-t2"]'), ('FW Uniform', 'fw-u1', null,  '["fw-u2"]'),
 ('FW Victor',  'fw-v1', null,    '["fw-v2"]'), ('FW Whiskey', 'fw-w1', null,  '["fw-w2"]')
) as t(team, q0, q1, bench)
cross join (values (7), (8)) as w(week);
select pg_temp.put('FW Echo', 8, 'fw-e1', null, '["fw-e2"]'::jsonb);

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

create temp table r100 (tag text primary key, r jsonb not null);
create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '94370000-0000-4000-8000-00000000000' || p_n, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b4370000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a4370000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
-- the week's row as "slot_map | starter ids | bench"
create function pg_temp.lu(p_team text, p_week int) returns text language sql as $$
  select format('%s | %s | %s', tl.slot_map::text,
                (select string_agg(coalesce(s ->> 'player_id', '-'), ',' order by o) from jsonb_array_elements(tl.starters) with ordinality x(s, o)),
                tl.bench::text)
  from team_lineups tl where tl.team_id = pg_temp.team(p_team) and tl.season = 2026 and tl.week = p_week $$;
create function pg_temp.drop(p_tag text, p_lg int, p_user int, p_team text, p_drop text, p_at timestamptz, p_act int) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r100 select p_tag, public.roster_add_drop_internal(pg_temp.lg(p_lg), pg_temp.team(p_team), null, p_drop, pg_temp.act(p_act), p_at);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r100 where tag = p_tag);
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp.roster_of(p_pid text) returns text language sql as $$
  select coalesce(string_agg(t.name, ',' order by t.name), '(none)') from league_rosters r join teams t on t.id = r.team_id where r.player_id = p_pid $$;

select is(
  format('%s|%s|%s|%s',
         public.lineup_current_week_internal(pg_temp.lg(1), '2026-10-27 10:00:00+00'),
         (select last_game_ends_at from nfl_weeks where season = 2026 and week = 7),
         (select starts_at from nfl_weeks where season = 2026 and week = 8),
         public.lineup_current_week_internal(pg_temp.lg(2), '2026-10-27 10:00:00+00')),
  '7|2026-10-27 03:30:00+00|2026-10-28 04:00:00+00|8',
  'A4 PREMISE: on Tuesday 10:00Z the current week is STILL 7 (week 8 starts Wednesday) although week 7''s last game ended at 03:30Z — the gap F437 lives in; L0''s first week (8) has not started, so its current week is 8');

-- ---------------------------------------------------------------------------
-- B. roster_add_drop_internal (L1)
-- ---------------------------------------------------------------------------
-- B1–B3: SUNDAY, week 7 being played — unchanged: the Monday-night starter
-- is dropped from week 7 AND week 8.
select pg_temp.drop('B1', 1, 2, 'FW Alpha', 'fw-a2', '2026-10-25 20:00:00+00', 1);
select is((select r #>> '{drop,lineups}' from r100 where tag = 'B1'),
  '[{"slot": "qb:1", "week": 7}, {"slot": "qb:1", "week": 8}]',
  'B1 mid-week (week 7 unfinished): the drop reports BOTH weeks'' qb:1 cleared — the current week is touched, as before');
select is(pg_temp.lu('FW Alpha', 7), '{"qb:0": "fw-a1"} | fw-a1,- | ["fw-a3"]',
  'B2 week 7 (being played): FW A Two is out of qb:1 — he has not played, nothing to keep (Q32, unchanged)');
select is(pg_temp.lu('FW Alpha', 8), '{"qb:0": "fw-a1"} | fw-a1,- | ["fw-a3"]', 'B3 week 8 likewise');
-- B4–B5: the boundary — one second before the week's last game ends.
select is(
  pg_temp.err($$ select pg_temp.drop('B4x', 1, 2, 'FW Alpha', 'fw-a1', '2026-10-27 03:29:59+00', 2) $$),
  'P0001: roster_add_drop: FW A One (Thu) (fw-a1) is locked for drops — kicked off at 2026-10-23T00:15:00+00:00 (nfl_games); week 7 clears at 2026-10-27T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
  'B4 PREMISE at end − 1 s: the Thursday starter is still LOCKED — the lock is what protected his finished-week start until the week ended');
select pg_temp.drop('B5', 1, 2, 'FW Alpha', 'fw-a3', '2026-10-27 03:29:59+00', 3);
select is(
  format('%s || %s || %s', (select r #>> '{drop,lineups}' from r100 where tag = 'B5'), pg_temp.lu('FW Alpha', 7), pg_temp.lu('FW Alpha', 8)),
  '[{"slot": null, "week": 7}, {"slot": null, "week": 8}] || {"qb:0": "fw-a1"} | fw-a1,- | [] || {"qb:0": "fw-a1"} | fw-a1,- | []',
  'B5 BOUNDARY end − 1 s (03:29:59Z): week 7 is not finished — the bye bench player leaves week 7''s bench too (unchanged)');
-- B6: AT the end (03:30:00Z) — week 7 is finished.
select pg_temp.drop('B6', 1, 3, 'FW Bravo', 'fw-b3', '2026-10-27 03:30:00+00', 4);
select is(
  format('%s || %s || %s', (select r #>> '{drop,lineups}' from r100 where tag = 'B6'), pg_temp.lu('FW Bravo', 7), pg_temp.lu('FW Bravo', 8)),
  '[{"slot": null, "week": 8}] || {"qb:0": "fw-b1", "qb:1": "fw-b2"} | fw-b1,fw-b2 | ["fw-b3"] || {"qb:0": "fw-b1", "qb:1": "fw-b2"} | fw-b1,fw-b2 | []',
  'B6 BOUNDARY AT the end (03:30:00Z): week 7 is FINISHED — its bench keeps FW B Three; only week 8 changes');
-- B7–B9: THE F437 CASE — Tuesday 10:00Z, the Thursday starter who PLAYED.
select pg_temp.drop('B7', 1, 3, 'FW Bravo', 'fw-b1', '2026-10-27 10:00:00+00', 5);
select is(
  format('%s|%s|%s', (select r ->> 'week' from r100 where tag = 'B7'), (select r #>> '{drop,lineups}' from r100 where tag = 'B7'), pg_temp.roster_of('fw-b1')),
  '7|[{"slot": "qb:0", "week": 8}]|(none)',
  'B7 F437: the Tuesday drop goes through (week 7''s lock released), is recorded in week 7, and reports ONLY week 8''s slot cleared');
select is(pg_temp.lu('FW Bravo', 7), '{"qb:0": "fw-b1", "qb:1": "fw-b2"} | fw-b1,fw-b2 | ["fw-b3"]',
  'B8 F437: the FINISHED week-7 lineup still starts FW B One at qb:0 — the slot map the score worker re-scores the week from keeps his points with FW Bravo');
select is(pg_temp.lu('FW Bravo', 8), '{"qb:1": "fw-b2"} | -,fw-b2 | []',
  'B9 the UNFINISHED week 8 is cleared: qb:0 reads empty');
-- B10: a league whose first week has not started — unchanged.
select pg_temp.drop('B10', 2, 1, 'FW Echo', 'fw-e1', '2026-10-27 10:00:00+00', 6);
select is(
  format('%s|%s|%s', (select r ->> 'week' from r100 where tag = 'B10'), (select r #>> '{drop,lineups}' from r100 where tag = 'B10'), pg_temp.lu('FW Echo', 8)),
  '8|[{"slot": "qb:0", "week": 8}]|{} | -,- | ["fw-e2"]',
  'B10 BEFORE A LEAGUE''S FIRST WEEK STARTS (L0, weeks 8–14): the current week is 8, not finished — it is cleared, as before');

-- ---------------------------------------------------------------------------
-- C. commish_roster_override_internal (L1; the commissioner is user 1)
-- ---------------------------------------------------------------------------
update league_weeks set status = 'live' where league_id = pg_temp.lg(1) and week = 7;
create function pg_temp.commish(p_tag text, p_verb text, p_team text, p_drop text, p_player text, p_from text, p_to text, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(1);
  insert into r100 select p_tag, public.commish_roster_override_internal(
    pg_temp.lg(1), pg_temp.team(p_team), null, p_drop, p_player, pg_temp.team(p_from), pg_temp.team(p_to),
    pg_temp.act(p_act), p_at, 'pgtap 100', p_verb);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r100 where tag = p_tag);
end $$;
-- C1–C2: Sunday, week 7 LIVE — unchanged: the commissioner walks past E32
-- and the player leaves week 7 too (D346's live-week arm; F440).
select pg_temp.commish('C1', 'commish_force_add_drop', 'FW Charlie', 'fw-c2', null, null, null, '2026-10-25 20:00:00+00', 11);
select is(
  format('%s|%s|%s', (select r ->> 'vacated_current_slot' from r100 where tag = 'C1'), (select r -> 'bypassed' from r100 where tag = 'C1'),
         (select string_agg(format('%s:%s', x ->> 'week', x ->> 'slot'), ',' order by (x ->> 'week')::int)
          from r100, jsonb_array_elements(r -> 'lineups') l, jsonb_array_elements(l -> 'rows') x where tag = 'C1')),
  'qb:1|["e32_drop_lock:fw-c2"]|7:qb:1,8:qb:1',
  'C1 mid-week (week 7 LIVE, FW C Two kicked off Sunday): the override clears week 7''s qb:1 AND week 8''s — unchanged (F440 records the live-week question for Chris)');
select is(pg_temp.lu('FW Charlie', 7), '{"qb:0": "fw-c1"} | fw-c1,- | ["fw-c3"]', 'C2 week 7 (LIVE) lost FW C Two — unchanged behaviour');
-- C3–C7: Tuesday 10:00Z, week 7 in its correction window — FINISHED.
update league_weeks set status = 'correction_window' where league_id = pg_temp.lg(1) and week = 7;
-- C1 set D346's flag on both of FW Charlie's rows; cleared so C5 measures C3's own write.
update team_lineups set edited_by_commish = false where team_id = pg_temp.team('FW Charlie') and week in (7, 8);
-- Week-7 stat lines for FW Charlie's players (planted after C1, so any queue
-- row below is C3's / C7's own): the old code's D346 arm would queue a
-- re-score of the finished week through them (C6 is its falsifier).
insert into player_stats (player_id, season, week, stat_type, updated_at, pass_yards)
values ('fw-c1', 2026, 7, 'weekly', '2026-10-26 12:00:00+00', 250), ('fw-c3', 2026, 7, 'weekly', '2026-10-26 12:00:00+00', 100),
       ('fw-d1', 2026, 7, 'weekly', '2026-10-26 12:00:00+00', 300);
select pg_temp.commish('C3', 'commish_force_add_drop', 'FW Charlie', 'fw-c1', null, null, null, '2026-10-27 10:00:00+00', 12);
select is(
  format('%s|%s|%s|%s', coalesce((select r ->> 'vacated_current_slot' from r100 where tag = 'C3'), 'null'),
         (select r -> 'bypassed' from r100 where tag = 'C3'),
         (select string_agg(format('%s:%s', x ->> 'week', x ->> 'slot'), ',' order by (x ->> 'week')::int)
          from r100, jsonb_array_elements(r -> 'lineups') l, jsonb_array_elements(l -> 'rows') x where tag = 'C3'),
         pg_temp.roster_of('fw-c1')),
  'null|[]|8:qb:0|(none)',
  'C3 F437: the Tuesday force-drop of the played Thursday starter touches ONLY week 8 — no current-week slot is vacated (so nothing re-scores the finished week)');
select is(pg_temp.lu('FW Charlie', 7), '{"qb:0": "fw-c1"} | fw-c1,- | ["fw-c3"]',
  'C4 F437: the FINISHED week-7 lineup still starts FW C One — his points stay with FW Charlie');
select is(
  (select format('%s|%s', (select edited_by_commish from team_lineups where team_id = pg_temp.team('FW Charlie') and week = 7),
                 (select edited_by_commish from team_lineups where team_id = pg_temp.team('FW Charlie') and week = 8))),
  'f|t',
  'C5 D346''s flag lands on the week the override changed (8), not on the finished week (7) it left alone');
select is(
  (select format('%s|%s', r -> 'score_enqueued', (select count(*) from score_fanout f where f.season = 2026 and f.week = 7 and f.player_id like 'fw-%'))
   from r100 where tag = 'C3'),
  '[]|0',
  'C6 nothing is queued to re-score the finished week (its players have week-7 lines — the old arm queued them)');
-- C7–C10: the commissioner MOVES a played week-7 starter on Tuesday.
select pg_temp.commish('C7', 'commish_move_player', null, null, 'fw-d1', 'FW Delta', 'FW Charlie', '2026-10-27 10:05:00+00', 13);
select is(pg_temp.roster_of('fw-d1'), 'FW Charlie', 'C7 the move went through: FW D One is FW Charlie''s');
select is(pg_temp.lu('FW Delta', 7), '{"qb:0": "fw-d1"} | fw-d1,- | []',
  'C8 F437: FW Delta''s FINISHED week 7 still starts FW D One — the team that played him keeps the week');
select is(
  format('%s || %s', pg_temp.lu('FW Charlie', 7), pg_temp.lu('FW Delta', 8)),
  '{"qb:0": "fw-c1"} | fw-c1,- | ["fw-c3"] || {} | -,- | []',
  'C9 FW Charlie''s finished week 7 does NOT gain him (never on two lineups for one week); FW Delta''s week 8 is cleared');
select is(
  format('%s|%s', pg_temp.lu('FW Charlie', 8),
         (select count(*) from team_lineups tl join teams t on t.id = tl.team_id
          where t.league_id = pg_temp.lg(1) and tl.week = 7 and (tl.slot_map ?| array['qb:0', 'qb:1']) and tl.slot_map::text like '%fw-d1%')),
  '{} | -,- | ["fw-c3", "fw-d1"]|1',
  'C10 FW Charlie gets him from week 8 (on the bench); exactly ONE week-7 lineup names him');

-- ---------------------------------------------------------------------------
-- D. process_waivers_internal (LW; runs daily at 10:00 UTC)
-- ---------------------------------------------------------------------------
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d4370000-0000-4000-8000-000000000001', pg_temp.lg(3), pg_temp.team('FW Foxtrot'), 'fw-x1', 'fw-f2', 5, 1, pg_temp.act(21), '94370000-0000-4000-8000-000000000001');
-- D1–D3: SUNDAY's run, week 7 being played — unchanged.
insert into r100 select 'D1', public.process_waivers_internal(pg_temp.lg(3), '2026-10-25 10:00:00+00');
select is(
  (select format('%s:%s', c.status, coalesce(c.result_reason, '-')) from waiver_claims c where c.id = 'd4370000-0000-4000-8000-000000000001'),
  'won:-', 'D1 Sunday''s run: FW Foxtrot''s claim (add FW X One, drop the Monday-night starter FW F Two) is won');
select is(pg_temp.lu('FW Foxtrot', 7), '{"qb:0": "fw-f1"} | fw-f1,- | ["fw-f3", "fw-x1"]',
  'D2 mid-week (week 7 unfinished): FW F Two leaves week 7''s qb:1 and FW X One joins week 7''s bench — unchanged');
select is(pg_temp.lu('FW Foxtrot', 8), '{"qb:0": "fw-f1"} | fw-f1,- | ["fw-f3", "fw-x1"]', 'D3 week 8 likewise');
-- D4: Monday's run (no claims) advances the schedule to Tuesday 10:00Z.
insert into r100 select 'D4', public.process_waivers_internal(pg_temp.lg(3), '2026-10-26 10:00:00+00');
select is((select waiver_next_run_at from leagues where id = pg_temp.lg(3)), '2026-10-27 10:00:00+00'::timestamptz,
  'D4 PREMISE: the next run is Tuesday 10:00Z — inside the gap between week 7''s last game and week 8''s start');
-- D5–D8: THE TUESDAY RUN — the claim drops the PLAYED Thursday starter.
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d4370000-0000-4000-8000-000000000002', pg_temp.lg(3), pg_temp.team('FW Foxtrot'), 'fw-x2', 'fw-f1', 3, 1, pg_temp.act(22), '94370000-0000-4000-8000-000000000001');
insert into r100 select 'D5', public.process_waivers_internal(pg_temp.lg(3), '2026-10-27 10:00:00+00');
select is(
  format('%s|%s|%s', (select format('%s:%s', c.status, coalesce(c.result_reason, '-')) from waiver_claims c where c.id = 'd4370000-0000-4000-8000-000000000002'),
         pg_temp.roster_of('fw-f1'), pg_temp.roster_of('fw-x2')),
  'won:-|(none)|FW Foxtrot',
  'D5 the Tuesday claim is won: FW F One (played Thursday) dropped, FW X Two added');
select is(pg_temp.lu('FW Foxtrot', 7), '{"qb:0": "fw-f1"} | fw-f1,- | ["fw-f3", "fw-x1"]',
  'D6 F437: the FINISHED week-7 lineup still starts FW F One — his points stay with FW Foxtrot');
select is(pg_temp.lu('FW Foxtrot', 8), '{} | -,- | ["fw-f3", "fw-x1", "fw-x2"]',
  'D7 week 8 (unfinished): FW F One''s slot cleared, FW X Two on the bench');
select is(
  (select x.payload #>> '{drop,lineups}' from transactions x where x.league_id = pg_temp.lg(3) and x.type = 'waiver_claim' and x.payload ->> 'add_player_id' = 'fw-x2'),
  '[{"slot": "qb:0", "week": 8}]',
  'D8 the claim''s transactions row reports only week 8''s slot — the league-visible record says what changed');
-- D9 (R1207): THE PRODUCTION SHAPE of every mid-week run — the current week's
-- last_game_ends_at is NULL (ingestion records it only once every game of the
-- week is final). Wednesday 10:00Z: week 8 is current (it started 04:00Z) and
-- its end is not recorded; FW Golf's claim drops its week-8 starter.
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d4370000-0000-4000-8000-000000000005', pg_temp.lg(3), pg_temp.team('FW Golf'), 'fw-x3', 'fw-g1', 1, 1, pg_temp.act(23), '94370000-0000-4000-8000-000000000002');
insert into r100 select 'D9', public.process_waivers_internal(pg_temp.lg(3), '2026-10-28 10:00:00+00');
select is(
  format('%s|%s|%s || %s || %s',
         (select coalesce(last_game_ends_at::text, 'NULL') from nfl_weeks where season = 2026 and week = 8),
         public.lineup_current_week_internal(pg_temp.lg(3), '2026-10-28 10:00:00+00'),
         (select format('%s:%s', c.status, coalesce(c.result_reason, '-')) from waiver_claims c where c.id = 'd4370000-0000-4000-8000-000000000005'),
         pg_temp.lu('FW Golf', 8),
         (select x.payload #>> '{drop,lineups}' from transactions x where x.league_id = pg_temp.lg(3) and x.type = 'waiver_claim' and x.payload ->> 'add_player_id' = 'fw-x3')),
  'NULL|8|won:- || {} | -,- | ["fw-x3"] || [{"slot": "qb:0", "week": 8}]',
  'D9 R1207 an UNRECORDED end (NULL) is "not over": the Wednesday run clears the CURRENT week''s slot on the old team and FW X Three lands on that week''s bench (a COALESCE-to-past rewrite of the CASE reds here)');

-- ---------------------------------------------------------------------------
-- E. F439 — a waiver claim's drop against a trade naming that player
-- ---------------------------------------------------------------------------
create function pg_temp.leg(p_player text, p_team text) returns jsonb language sql as $$ select jsonb_build_object('player_id', p_player, 'from_team_id', pg_temp.team(p_team)) $$;
-- E1–E5 (LT1, commissioner review): the trade is IN REVIEW when the Tuesday
-- run's claim drops its player — the claim wins, E37 calls the trade off.
select pg_temp.as_user(2);
insert into r100 select 'X1', public.trade_propose_internal(pg_temp.lg(4), pg_temp.team('FW Tango'), pg_temp.team('FW Uniform'),
  jsonb_build_array(pg_temp.leg('fw-t1', 'FW Tango'), pg_temp.leg('fw-u2', 'FW Uniform')), null, null, pg_temp.act(31), '2026-10-27 04:00:00+00', null);
select pg_temp.as_user(3);
insert into r100 select 'X1a', public.trade_respond_internal(pg_temp.lg(4), (select (r #>> '{trade,id}')::uuid from r100 where tag = 'X1'),
  'accept', null, null, null, pg_temp.act(32), '2026-10-27 05:00:00+00', null);
select set_config('request.jwt.claims', '', true);
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d4370000-0000-4000-8000-000000000003', pg_temp.lg(4), pg_temp.team('FW Tango'), 'fw-y1', 'fw-t1', 1, 1, pg_temp.act(33), '94370000-0000-4000-8000-000000000002');
select is((select status from trades where id = (select (r #>> '{trade,id}')::uuid from r100 where tag = 'X1')), 'in_review',
  'E1 PREMISE: the trade (FW T One for FW U Two) is accepted and in commissioner review when the Tuesday run comes');
insert into r100 select 'E2', public.process_waivers_internal(pg_temp.lg(4), '2026-10-27 10:00:00+00');
select is(
  format('%s|%s|%s|%s',
         (select format('%s:%s', c.status, coalesce(c.result_reason, '-')) from waiver_claims c where c.id = 'd4370000-0000-4000-8000-000000000003'),
         (select t.status || ':' || coalesce(t.status_reason, '-') from trades t where t.id = (select (r #>> '{trade,id}')::uuid from r100 where tag = 'X1')),
         pg_temp.roster_of('fw-t1'), pg_temp.roster_of('fw-y1')),
  'won:-|invalid:FW T One (Thu) (fw-t1) is no longer on FW Tango''s roster — he was dropped (E37)|(none)|FW Tango',
  'E2 F439: the claim wins (FW T One dropped, FW Y One added) and E37 turns the trade invalid by name — the player has ONE fate, never two owners');
select is(
  format('%s || %s', pg_temp.lu('FW Tango', 7), pg_temp.lu('FW Uniform', 7)),
  '{"qb:0": "fw-t1"} | fw-t1,- | ["fw-t2"] || {"qb:0": "fw-u1"} | fw-u1,- | ["fw-u2"]',
  'E3 F439 / F437: FW Tango''s FINISHED week 7 still starts FW T One (no points lost); FW Uniform''s week 7 never names him');
insert into r100 select 'E4', public.trade_tick('2026-10-28 05:00:00+00', pg_temp.lg(4));
select is(
  format('%s|%s|%s', pg_temp.roster_of('fw-t1'), pg_temp.roster_of('fw-u2'),
         (select count(*) from transactions x where x.league_id = pg_temp.lg(4) and x.type = 'trade')),
  '(none)|FW Uniform|0',
  'E4 the review deadline passes and the tick executes NOTHING: FW U Two stays with FW Uniform, no trade row');
-- E5–E8 (LT2, no review): the trade was deferred on Sunday (FW V One played
-- Thursday), goes through at the week's end, THEN the Tuesday run's claim
-- tries to drop the player its team no longer has.
select pg_temp.as_user(2);
insert into r100 select 'X2', public.trade_propose_internal(pg_temp.lg(5), pg_temp.team('FW Victor'), pg_temp.team('FW Whiskey'),
  jsonb_build_array(pg_temp.leg('fw-v1', 'FW Victor'), pg_temp.leg('fw-w2', 'FW Whiskey')), null, null, pg_temp.act(41), '2026-10-25 20:00:00+00', null);
select pg_temp.as_user(3);
insert into r100 select 'X2a', public.trade_respond_internal(pg_temp.lg(5), (select (r #>> '{trade,id}')::uuid from r100 where tag = 'X2'),
  'accept', null, null, null, pg_temp.act(42), '2026-10-25 21:00:00+00', null);
select set_config('request.jwt.claims', '', true);
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by) values
 ('d4370000-0000-4000-8000-000000000004', pg_temp.lg(5), pg_temp.team('FW Victor'), 'fw-z1', 'fw-v1', 1, 1, pg_temp.act(43), '94370000-0000-4000-8000-000000000002');
select is(
  (select format('%s|%s', t.status, t.execute_after) from trades t where t.id = (select (r #>> '{trade,id}')::uuid from r100 where tag = 'X2')),
  'accepted|2026-10-27 03:30:00+00',
  'E5 PREMISE: the trade waits for the week''s last game (Q75 defer) — FW V One played Thursday');
insert into r100 select 'E6', public.trade_tick('2026-10-27 03:30:00+00', pg_temp.lg(5));
insert into r100 select 'E7', public.process_waivers_internal(pg_temp.lg(5), '2026-10-27 10:00:00+00');
select is(
  format('%s|%s|%s|%s',
         (select t.status from trades t where t.id = (select (r #>> '{trade,id}')::uuid from r100 where tag = 'X2')),
         (select format('%s:%s', c.status, coalesce(c.result_reason, '-')) from waiver_claims c where c.id = 'd4370000-0000-4000-8000-000000000004'),
         pg_temp.roster_of('fw-v1'), pg_temp.roster_of('fw-z1')),
  'complete|invalid:drop_gone|FW Whiskey|(none)',
  'E7 F439 (the other order): the trade went through at 03:30Z, so the 10:00Z claim fails drop_gone — FW V One on exactly ONE roster, FW Z One not added');
select is(
  format('%s || %s || %s', pg_temp.lu('FW Victor', 7), pg_temp.lu('FW Whiskey', 7), pg_temp.lu('FW Whiskey', 8)),
  '{"qb:0": "fw-v1"} | fw-v1,- | ["fw-v2"] || {"qb:0": "fw-w1"} | fw-w1,- | ["fw-w2"] || {"qb:0": "fw-w1"} | fw-w1,- | ["fw-v1"]',
  'E8 F439: FW Victor''s finished week 7 keeps FW V One''s start (no points lost); FW Whiskey''s finished week 7 is untouched too (FW W Two stays on its bench) — FW Whiskey has FW V One from week 8 only');
select is(
  (select count(*)::int from team_lineups tl join teams t on t.id = tl.team_id
   where t.league_id in (pg_temp.lg(4), pg_temp.lg(5)) and tl.week = 7
     and exists (select 1 from jsonb_each_text(tl.slot_map) e where e.value in ('fw-t1', 'fw-v1'))),
  2,
  'E9 across both leagues each contested player starts in exactly ONE week-7 lineup — his old team''s');

-- ---------------------------------------------------------------------------
-- G. R1206 — a PLAYED starter who has left the roster stays in the finished
--    week's lineup while that week is still current: set_lineup (4b) and
--    autopilot (152 §§4–5). LS: three QB slots, week 7 LIVE (the hourly
--    advance has not flipped it), every instant inside the gap.
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_lineup_internal', 'lineup_autopilot_internal')),
  'lineup_autopilot_internal:f:search_path="":f:f set_lineup_internal:f:search_path="":f:f',
  'G0 the two internals 152 §§4–5 replace: one overload each, PLAIN, search_path empty, closed to anon and authenticated');
select is(
  (select md5(replace(replace(replace(replace(replace(p.prosrc,
  E'  v_msg         TEXT;\n  -- 152 / R1206: stored starters who PLAYED and have left this roster since\n  -- (player_id → {kickoff_at, datum_arm, on_bye}) — fixed for the week.\n  v_gone_kick   JSONB := \'{}\'::jsonb;\nBEGIN\n',
  E'  v_msg         TEXT;\nBEGIN\n'),
  E'  v_stored := COALESCE(v_row.slot_map, \'{}\'::jsonb);\n\n  -- (4b) 152 / R1206 (Q32\'s amendment, verbatim: "if they are in the lineup\n  --      they are stuck in the lineup"; D411): A PLAYED STARTER STAYS EVEN\n  --      AFTER HE LEAVES THE ROSTER. Once a week\'s last game has ended the\n  --      lock releases (E32 / 115) and a starter who played can be dropped,\n  --      claimed away or traded, while the week is still current (live)\n  --      until the next week starts; 152 keeps his finished-week start (the\n  --      week is scored and re-scored from this slot_map). A stored STARTING\n  --      slot whose player is not on this roster and whose OWN game for\n  --      p_week has kicked off is therefore FIXED: carried through unchanged\n  --      (the editor never holds an unrostered player — placementFromStored\n  --      — so an omitted key is carried, not read as "empty it"), and a\n  --      submit that puts anyone else there, or moves him, is refused by\n  --      name. He joins v_by_pid (never v_roster: no bench, no roster write)\n  --      so steps 7–10 treat him as the locked starter he is. A stored\n  --      unrostered player whose game has NOT kicked off (a bye) did not\n  --      play: his slot opens, as before.\n  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP\n    v_pid := v_val #>> \'{}\';\n    CONTINUE WHEN v_by_pid ? v_pid;\n    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> \'key\' = v_key);\n    SELECT jsonb_build_object(\n             \'player_id\',          p.id,\n             \'name\',               p.full_name,\n             \'position\',           CASE WHEN p.position = \'DEF\' THEN \'DST\' ELSE p.position END,\n             \'designation\',        public.lineup_designation_internal(p.status),\n             \'nfl_team\',           p.team,\n             \'ir_placed_week\',     NULL,\n             \'ir_lock_until_week\', NULL,\n             \'slot_key\',           NULL,\n             \'off_roster\',         TRUE)\n    INTO v_e\n    FROM public.players p WHERE p.id = v_pid;\n    CONTINUE WHEN v_e IS NULL;\n    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> \'nfl_team\', p_at);\n    CONTINUE WHEN v_k.kickoff_at IS NULL OR v_k.kickoff_at > p_at;   -- has not played: the slot opens\n    IF ((p_slot_map ? v_key) AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid)\n       OR EXISTS (SELECT 1 FROM jsonb_each(p_slot_map) x WHERE x.key <> v_key AND (x.value #>> \'{}\') = v_pid) THEN\n      RAISE EXCEPTION\n        \'set_lineup: % already played this week — his start stays (slot "%": his game kicked off at % (%); he has left %\'\'s roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3)\',\n        v_e ->> \'name\', v_key, v_k.kickoff_at, v_k.datum_arm, v_team.name\n        USING ERRCODE = \'P0001\';\n    END IF;\n    v_by_pid := v_by_pid || jsonb_build_object(v_pid, v_e);\n    v_gone_kick := v_gone_kick || jsonb_build_object(v_pid, jsonb_build_object(\n      \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n    p_slot_map := p_slot_map || jsonb_build_object(v_key, v_pid);   -- carried\n  END LOOP;\n\n  -- (5) VALIDATE THE SUBMITTED MAP',
  E'  v_stored := COALESCE(v_row.slot_map, \'{}\'::jsonb);\n\n  -- (5) VALIDATE THE SUBMITTED MAP'),
  E'      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n        \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n    END IF;\n  END LOOP;\n  v_kick := v_kick || v_gone_kick;   -- 152 / R1206: (4b)\'s played, since-unrostered starters\n',
  E'      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> \'player_id\', jsonb_build_object(\n        \'kickoff_at\', v_k.kickoff_at, \'datum_arm\', v_k.datum_arm, \'on_bye\', v_k.on_bye));\n    END IF;\n  END LOOP;\n'),
  E'      CONTINUE WHEN NOT (v_by_pid ? v_pid);                       -- off the roster and NOT played (a played one is in v_by_pid since (4b) — 152 / R1206)\n',
  E'      CONTINUE WHEN NOT (v_by_pid ? v_pid);                       -- dropped since (113) — nothing to lock\n'),
  E'      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> \'assignment\') LOOP\n        CONTINUE WHEN v_gone_kick ? (v_val #>> \'{}\');   -- 152 / R1206: off this roster — no roster row of his to write\n        UPDATE public.league_rosters r SET slot_key = v_key\n        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> \'{}\');\n        GET DIAGNOSTICS v_cnt = ROW_COUNT;\n        v_expected := v_expected + v_cnt;\n      END LOOP;\n      IF v_expected <> COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick)) THEN\n        RAISE EXCEPTION \'set_lineup: wrote slot_key for % starters, expected %\', v_expected,\n          COALESCE(array_length(v_started, 1), 0) - (SELECT count(*)::int FROM jsonb_object_keys(v_gone_kick))\n          USING ERRCODE = \'P0001\';\n      END IF;\n',
  E'      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> \'assignment\') LOOP\n        UPDATE public.league_rosters r SET slot_key = v_key\n        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> \'{}\');\n        GET DIAGNOSTICS v_cnt = ROW_COUNT;\n        v_expected := v_expected + v_cnt;\n      END LOOP;\n      IF v_expected <> COALESCE(array_length(v_started, 1), 0) THEN\n        RAISE EXCEPTION \'set_lineup: wrote slot_key for % starters, expected %\', v_expected, COALESCE(array_length(v_started, 1), 0)\n          USING ERRCODE = \'P0001\';\n      END IF;\n')) from pg_proc p where p.oid = 'public.set_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)'::regprocedure),
  'ca81a2a42dfdbd2003cea6853d3e11f7',
  'G0b D137: set_lineup_internal is 131''s FILE TEXT beneath 152''s FIVE hunks — each reversed, the prosrc md5 is 131''s (a stored literal)');
select is(
  (select format('%s|%s', md5(s.prosrc), md5(a.prosrc))
   from pg_proc s, pg_proc a
   where s.oid = 'public.set_lineup_internal(uuid,uuid,integer,jsonb,uuid,timestamptz,text)'::regprocedure
     and a.oid = 'public.lineup_autopilot_internal(uuid,uuid,integer,integer,timestamptz)'::regprocedure),
  '8a2601f9a904f7fd6c00c8d4f7758f15|cb96ab439aa9dcb6d218d7da79125fe6',
  'G0c the live prosrc md5 of both (152 §§4–5 as written — stored literals); pgTAP 090 A4/A5 and 087 A8/A8b prove 142''s text beneath the autopilot''s two hunks');
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     settings, roster_settings, waiver_next_run_at)
select 'b4370000-0000-4000-8000-000000000006', '94370000-0000-4000-8000-000000000001', 'pgtap-fw-LS', 2026, 'in_season', 12, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', 'faab', 100, 'commissioner',
       '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "10:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 3}], "bench": 3, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null;
insert into teams (id, owner_id, name, league_id, status) values
 ('c4370000-0000-4000-8000-000000000061', '94370000-0000-4000-8000-000000000002', 'FW Hotel',  pg_temp.lg(6), 'active'),
 ('c4370000-0000-4000-8000-000000000062', '94370000-0000-4000-8000-000000000003', 'FW Juliet', pg_temp.lg(6), 'active');
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id, 'manager', false, 100 from teams t where t.league_id = pg_temp.lg(6);
insert into league_weeks (league_id, season, week, status)
select pg_temp.lg(6), 2026, w, case when w = 7 then 'live' when w < 7 then 'final' else 'upcoming' end from generate_series(1, 14) w;
insert into drafts (league_id, status, completed_at, draft_order)
select pg_temp.lg(6), 'complete', '2026-09-06 06:00:00+00', (select jsonb_agg(t.id order by t.id) from teams t where t.league_id = pg_temp.lg(6));
insert into league_rosters (league_id, team_id, player_id, slot_key)
select pg_temp.lg(6), pg_temp.team(r.team), r.pid, 'bn'
from (values ('FW Hotel', 'fw-h1'), ('FW Hotel', 'fw-h2'), ('FW Hotel', 'fw-h3'),
             ('FW Juliet', 'fw-j1'), ('FW Juliet', 'fw-j2'), ('FW Juliet', 'fw-j3')) as r(team, pid);
select pg_temp.put(t.team, w.week, t.q0, t.q1, t.bench::jsonb)
from (values ('FW Hotel', 'fw-h1', 'fw-h2', '["fw-h3"]'), ('FW Juliet', 'fw-j1', 'fw-j2', '["fw-j3"]')) as t(team, q0, q1, bench)
cross join (values (7), (8)) as w(week);
create function pg_temp.sl(p_tag text, p_lg int, p_user int, p_team text, p_week int, p_map jsonb, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r100 select p_tag, public.set_lineup_internal(pg_temp.lg(p_lg), pg_temp.team(p_team), p_week, p_map, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r100 where tag = p_tag);
end $$;
-- G1: Tuesday 03:35Z — five minutes after week 7's last game — FW Hotel drops
-- FW H One, who PLAYED Thursday (the lock released at 03:30Z).
select pg_temp.drop('G1', 6, 2, 'FW Hotel', 'fw-h1', '2026-10-27 03:35:00+00', 61);
select is(
  format('%s|%s|%s|%s || %s', public.lineup_current_week_internal(pg_temp.lg(6), '2026-10-27 03:35:00+00'),
         (select r #>> '{drop,lineups}' from r100 where tag = 'G1'), pg_temp.roster_of('fw-h1'),
         (select status from league_weeks where league_id = pg_temp.lg(6) and week = 7), pg_temp.lu('FW Hotel', 7)),
  '7|[{"slot": "qb:0", "week": 8}]|(none)|live || {"qb:0": "fw-h1", "qb:1": "fw-h2"} | fw-h1,fw-h2 | ["fw-h3"]',
  'G1 PREMISE: week 7 is still current and LIVE; the drop went through and (152) left the finished week-7 lineup starting FW H One');
-- G2: autopilot over that row, at 03:40Z (the pass is pure; nothing written).
insert into r100 select 'G2', public.lineup_autopilot_internal(pg_temp.lg(6), pg_temp.team('FW Hotel'), 2026, 7, '2026-10-27 03:40:00+00');
select is(
  (select format('%s|%s|%s', r ->> 'changed', r -> 'slot_map',
                 (select string_agg(format('%s:%s', x ->> 'slot', x ->> 'player_id'), ',') from jsonb_array_elements(r -> 'filled') x))
   from r100 where tag = 'G2'),
  'true|{"qb:0": "fw-h1", "qb:1": "fw-h2", "qb:2": "fw-h3"}|qb:2:fw-h3',
  'G2 R1206 autopilot leaves the played starter''s slot ALONE (never OPEN): FW H One stays at qb:0 and only the truly empty qb:2 is filled');
-- G3: THE REVIEWER'S PROBE — a manager replaces the played starter at 03:40Z.
select is(
  pg_temp.err($$ select pg_temp.sl('G3x', 6, 2, 'FW Hotel', 7, '{"qb:0": "fw-h3", "qb:1": "fw-h2"}', '2026-10-27 03:40:00+00', 62) $$),
  'P0001: set_lineup: FW H One (Thu) already played this week — his start stays (slot "qb:0": his game kicked off at 2026-10-23 00:15:00+00 (nfl_games); he has left FW Hotel''s roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3)',
  'G3 R1206 THE REVIEWER''S PROBE: putting FW H Three in the played starter''s slot is REFUSED BY NAME');
select is(
  format('%s || %s',
         pg_temp.err($$ select pg_temp.sl('G4x', 6, 2, 'FW Hotel', 7, '{"qb:1": "fw-h2", "qb:2": "fw-h1"}', '2026-10-27 03:41:00+00', 63) $$),
         pg_temp.lu('FW Hotel', 7)),
  'P0001: set_lineup: FW H One (Thu) already played this week — his start stays (slot "qb:0": his game kicked off at 2026-10-23 00:15:00+00 (nfl_games); he has left FW Hotel''s roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3) || {"qb:0": "fw-h1", "qb:1": "fw-h2"} | fw-h1,fw-h2 | ["fw-h3"]',
  'G4 moving him to another slot is refused the same way, and after both refusals the week-7 row is UNCHANGED');
-- G5: the EDITOR's submit — it never holds an unrostered player
-- (placementFromStored), so it omits him: he is CARRIED, the rest applies.
select pg_temp.sl('G5', 6, 2, 'FW Hotel', 7, '{"qb:1": "fw-h2", "qb:2": "fw-h3"}', '2026-10-27 03:45:00+00', 64);
select is(
  format('%s|%s || %s || %s', (select r ->> 'no_changes' from r100 where tag = 'G5'), (select r -> 'slot_map' from r100 where tag = 'G5'),
         pg_temp.lu('FW Hotel', 7),
         (select string_agg(format('%s:%s', r.player_id, r.slot_key), ',' order by r.player_id) from league_rosters r where r.team_id = pg_temp.team('FW Hotel'))),
  'false|{"qb:0": "fw-h1", "qb:1": "fw-h2", "qb:2": "fw-h3"} || {"qb:0": "fw-h1", "qb:1": "fw-h2", "qb:2": "fw-h3"} | fw-h1,fw-h2,fw-h3 | [] || fw-h2:qb:1,fw-h3:qb:2',
  'G5 R1206 the editor-shaped submit (FW H One omitted) is ACCEPTED with him carried at qb:0 — the change lands, his start stays, and only his rostered teammates'' slot_key rows are written');
-- G6–G8: a dropped starter who has NOT played (a bye) — his slot opens, unchanged.
select pg_temp.drop('G6', 6, 3, 'FW Juliet', 'fw-j2', '2026-10-27 03:35:00+00', 65);
select is(pg_temp.lu('FW Juliet', 7), '{"qb:0": "fw-j1", "qb:1": "fw-j2"} | fw-j1,fw-j2 | ["fw-j3"]',
  'G6 PREMISE: FW J Two (bye — no game this week) was dropped at 03:35Z; 152 left the finished week-7 row naming him');
insert into r100 select 'G7', public.lineup_autopilot_internal(pg_temp.lg(6), pg_temp.team('FW Juliet'), 2026, 7, '2026-10-27 03:40:00+00');
select is(
  (select format('%s|%s', r ->> 'changed', r -> 'slot_map') from r100 where tag = 'G7'),
  'true|{"qb:0": "fw-j1", "qb:1": "fw-j3"}',
  'G7 autopilot: the not-played dropped player''s slot is OPEN and filled, as before');
select pg_temp.sl('G8', 6, 3, 'FW Juliet', 7, '{"qb:0": "fw-j1", "qb:1": "fw-j3"}', '2026-10-27 03:45:00+00', 66);
select is(pg_temp.lu('FW Juliet', 7), '{"qb:0": "fw-j1", "qb:1": "fw-j3"} | fw-j1,fw-j3,- | []',
  'G8 set_lineup: a manager may put FW J Three in the not-played dropped player''s slot, as before');
-- G9–G10: 151's trade path (LT2, §E): the deferred trade executed at 03:30Z,
-- sending FW V One (played Thursday) to FW Whiskey; FW Victor then sets a
-- lineup while week 7 is still current.
select is(
  pg_temp.err($$ select pg_temp.sl('G9x', 5, 2, 'FW Victor', 7, '{"qb:0": "fw-v2"}', '2026-10-27 10:30:00+00', 67) $$),
  'P0001: set_lineup: FW V One (Thu) already played this week — his start stays (slot "qb:0": his game kicked off at 2026-10-23 00:15:00+00 (nfl_games); he has left FW Victor''s roster since, and a played starter is stuck in the lineup for the week — §11.2, Q32; the week is scored from this lineup, §7.3.3)',
  'G9 R1206 after the deferred trade executed, FW Victor cannot put FW V Two in the traded-away player''s finished-week slot');
select pg_temp.sl('G10', 5, 2, 'FW Victor', 7, '{}', '2026-10-27 10:31:00+00', 68);
select is(
  format('%s || %s || %s', (select r ->> 'no_changes' from r100 where tag = 'G10'), pg_temp.lu('FW Victor', 7), pg_temp.roster_of('fw-v1')),
  'true || {"qb:0": "fw-v1"} | fw-v1,- | ["fw-v2"] || FW Whiskey',
  'G10 R1206 …and the editor-shaped submit keeps FW V One''s start with FW Victor (a no-op) while he is on FW Whiskey''s roster');


-- ---------------------------------------------------------------------------
-- F. The rule is the calendar's, not a status: an unrecorded end is "not over"
-- ---------------------------------------------------------------------------
update nfl_weeks set last_game_ends_at = null where season = 2026 and week = 7;
select is(
  pg_temp.err($$ select pg_temp.drop('F1x', 1, 2, 'FW Alpha', 'fw-a1', '2026-10-27 10:10:00+00', 7) $$),
  'P0001: roster_add_drop: FW A One (Thu) (fw-a1) is locked for drops — kicked off at 2026-10-23T00:15:00+00:00 (nfl_games); week 7 clears at an instant not yet recorded — nfl_weeks.last_game_ends_at stays NULL until ingestion has recorded every game of the week final, so he stays locked (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
  'F1 week 7''s end NOT RECORDED (last_game_ends_at NULL): the week is not over, so the played starter is still locked for his manager (115)');
select pg_temp.commish('F2', 'commish_force_add_drop', 'FW Alpha', 'fw-a1', null, null, null, '2026-10-27 10:10:00+00', 14);
select is(
  format('%s|%s', (select r ->> 'vacated_current_slot' from r100 where tag = 'F2'),
         (select string_agg(format('%s:%s', x ->> 'week', x ->> 'slot'), ',' order by (x ->> 'week')::int)
          from r100, jsonb_array_elements(r -> 'lineups') l, jsonb_array_elements(l -> 'rows') x where tag = 'F2')),
  'qb:0|7:qb:0,8:qb:0',
  'F2 …and the CASE''s NULL arm is "not finished": the commissioner''s override (E32 walked past) still changes week 7 — an unrecorded end is never read as over (a COALESCE-to-past rewrite reds here)');

select * from finish();
rollback;
