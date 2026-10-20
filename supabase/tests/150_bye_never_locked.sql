-- ============================================================================
-- 150 — a player whose NFL team has no game this week is never locked
--       (migration 200; the live bug of 2026-10-18, SuperLeague v0.1 week 6;
--       PROGRESS D590; spec v2.16.102 §13.1 / §11.2)
-- ============================================================================
-- THE RULING (Chris, 2026-10-18, verbatim): "Players on a BYE are always
-- droppable."
--
-- OWN FIXTURE: users 9200…, leagues b200…, teams c200…, action ids a200…,
-- players by-*, NFL teams Y*. Every instant is passed explicitly (the
-- TimeProvider rule); internals are called as postgres with the actor's JWT
-- claims set. One rolled-back transaction.
--
-- THE CALENDAR (2026 seeds, stamps rewritten as pgTAP 105 does): WEEK 6 —
-- YA @ YZ Thu 10-16 00:15Z, YS @ YT Sun 10-18 17:00Z, YC on a BYE; the
-- week's last game recorded ending Tue 10-20 03:30Z. Every other week has a
-- dummy game. "Sunday 12:00 ET" = 10-18 16:00Z — after Thursday, before
-- Sunday.
--
-- THE THREE BYE PLAYERS (team YC), on every path:
--   *-b1  a week-6 STAT ROW that names NO game (157 counted it from the
--         week's first kickoff — Thursday — so he read "played");
--   *-b2  a SAVED Thursday kickoff on a league lineup (`starters[].
--         kickoff_at` — 157 read it as a start he played, and the tick kept
--         it once passed);
--   *-b3  clean (the positive control the bug never touched).
-- CONTROLS that must not move: a RELEASED player (no team) who played
-- Thursday stays locked; a Thursday player stays locked; a Sunday player
-- whose game is still ahead stays unlocked.
--
--   §A  FORM and D137: both helpers PLAIN, STABLE, search_path '', closed;
--       un200 gives back 157's FILE TEXT (the literals 112 A6 / 113 / 114
--       A6 pin); the live md5s are 200 as written; un200 is an identity on
--       every other body.
--   §B  the judgment itself (the helpers) — bye players not played, not
--       locked, a bye datum; the controls unchanged.
--   §C  drops (roster_add_drop), §L lineup moves (set_lineup both ways,
--       autopilot), §P adds (roster_add_drop), §F a trade (accept executes
--       at once — not deferred), §W waiver claims (submit's add lock and
--       the run's add AND drop checks), §T the per-minute tick (stale saved
--       kickoffs cleared, stale pool locks cleared, controls kept), §K the
--       controls end to end.
--
-- BREAK PROBES (measured 2026-10-20 on the local DB, 200 applied), each a
-- CREATE OR REPLACE of one helper from pg_temp.un200(prosrc) — 157's body —
-- injected right after the fixture inside this transaction:
--   (1) lineup_played_internal put back ⇒ B1 B2 B3 C1 C2 L1 L2 L3 P1 P2 F1
--       F2 W1 W2 W3 T2 K3 K4 red (K3 / K4: Hotel's stat-row bye starter in
--       qb:0 is "locked" again, so the refusal names him and the bench
--       fails);
--   (2) lineup_record_kicked_off_internal put back ⇒ B4 T1 red (the other
--       paths stay green — (1)'s guard already answers them; (2) is what
--       makes the tick heal a stale saved kickoff);
--   both ⇒ the union. The controls B5 T3 K1 K2 K5 are green under every
--   probe (F447's cases never depended on the change).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

-- pg_temp.un200 — migration 200's inserted lines removed (each ends
-- `-- 200 / D590`); an identity on every other body.
create function pg_temp.un200(p_src text) returns text language sql as $un200$
  select regexp_replace(p_src, E'\n[^\n]*   -- 200 / D590', '', 'g')
$un200$;

-- ---------------------------------------------------------------------------
-- A. Form pins, D137 in the database
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s:%s:%s', p.proname, l.lanname, p.provolatile, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and p.proname in ('lineup_record_kicked_off_internal', 'lineup_played_internal')),
  'lineup_played_internal:plpgsql:s:f:search_path="":f:f lineup_record_kicked_off_internal:sql:s:f:search_path="":f:f',
  'A1 the two helpers: one overload each, language unchanged, STABLE, PLAIN (not DEFINER), search_path empty, closed to anon and authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('lineup_record_kicked_off_internal', 'lineup_played_internal')),
  'A2 PUBLIC holds EXECUTE on neither (REVOKEs restated)');
select is(
  (select string_agg(p.proname || '=' || md5(pg_temp.un200(p.prosrc)), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('lineup_record_kicked_off_internal', 'lineup_played_internal')),
  'lineup_played_internal=aa79ff77ba714b19b6740c60202d8476 lineup_record_kicked_off_internal=9c54a4f3fb38bad956d6386d7748b777',
  'A3 D137: each live body with 200''s lines removed is 157''s FILE TEXT (157:208 / 157:170 — the stored literals 112 A6, 113 and 114 A6 pin)');
select is(
  (select string_agg(p.proname || '=' || md5(p.prosrc) || '/' || (length(p.prosrc) - length(replace(p.prosrc, '   -- 200 / D590', ''))) / length('   -- 200 / D590'), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('lineup_record_kicked_off_internal', 'lineup_played_internal')),
  'lineup_played_internal=e22f4ddc9907d0633e8fbcd7029b1055/10 lineup_record_kicked_off_internal=90c5abfa40345e9ad42e53d1cc6a1ab8/5',
  'A4 the two live prosrc md5s — 200 as written (stored literals) — and the inserted lines (10 / 5, one hunk each)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not in ('lineup_record_kicked_off_internal', 'lineup_played_internal')
     and pg_temp.un200(p.prosrc) <> p.prosrc),
  0,
  'A5 un200 is an identity on every other body in the schema — so the older suites that apply it innermost pin exactly what they pinned (additive, R992)');

-- ---------------------------------------------------------------------------
-- FIXTURE
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case when w.week <= 5 then w.starts_at + interval '6 days'
                             when w.week = 6 then '2026-10-20 03:30:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'by-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 14 and w.week <> 6;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('by-g6a', 2026, 6, 'YA', 'YZ', '2026-10-16 00:15:00+00'), ('by-g6b', 2026, 6, 'YS', 'YT', '2026-10-18 17:00:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('92000000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-by' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'by_user' || i)::jsonb, now(), now()
from generate_series(1, 8) i;

-- LB: instant pickups (none_fcfs), trades with no review — §C §L §P §F §T §K.
-- LW: FAAB, a run every day at 16:00 UTC, the next one Sunday 16:00Z — §W.
insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review,
                     settings, roster_settings, waiver_next_run_at)
select l.id, '92000000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 12, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', l.wt, 100, 'none', l.st::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 4}], "bench": 4, "ir_slots": [], "swap_spots": 0}'::jsonb,
       l.nx
from (values
 ('b2000000-0000-4000-8000-000000000001'::uuid, 'pgtap-by-LB', 'none_fcfs', '{}', null::timestamptz),
 ('b2000000-0000-4000-8000-000000000002'::uuid, 'pgtap-by-LW', 'faab',
  '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "16:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}',
  '2026-10-18 16:00:00+00')
) as l(id, nm, wt, st, nx);

insert into teams (id, owner_id, name, league_id, status)
select t.id::uuid, ('92000000-0000-4000-8000-00000000000' || t.u)::uuid, t.nm, ('b2000000-0000-4000-8000-00000000000' || t.lg)::uuid, 'active'
from (values
 ('c2000000-0000-4000-8000-000000000011', 1, 'BY Commish', 1), ('c2000000-0000-4000-8000-000000000012', 2, 'BY Alpha', 1),
 ('c2000000-0000-4000-8000-000000000013', 3, 'BY Bravo', 1),   ('c2000000-0000-4000-8000-000000000014', 4, 'BY Charlie', 1),
 ('c2000000-0000-4000-8000-000000000015', 5, 'BY Echo', 1),    ('c2000000-0000-4000-8000-000000000016', 6, 'BY Foxtrot', 1),
 ('c2000000-0000-4000-8000-000000000017', 7, 'BY Golf', 1),    ('c2000000-0000-4000-8000-000000000018', 8, 'BY Hotel', 1),
 ('c2000000-0000-4000-8000-000000000021', 1, 'BW Commish', 2), ('c2000000-0000-4000-8000-000000000022', 2, 'BW Whiskey', 2)
) as t(id, u, nm, lg);

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '92000000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c2000000-%';

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 14) w where l.id::text like 'b2000000-%';
update league_weeks set status = 'live'              where league_id::text like 'b2000000-%' and week <= 6;
update league_weeks set status = 'correction_window' where league_id::text like 'b2000000-%' and week <= 5;
update league_weeks set status = 'final'             where league_id::text like 'b2000000-%' and week <= 5;

insert into drafts (league_id, status, completed_at, draft_order)
select l.id, 'complete', '2026-09-06 06:00:00+00',
       (select jsonb_agg(t.id order by t.id) from teams t where t.league_id = l.id)
from leagues l where l.id::text like 'b2000000-%';

-- Bye players (YC) by path; Sunday players (YS); controls: h-t1 (Thursday,
-- YA), h-r1 (played Thursday for YA, since RELEASED — no team).
insert into players (id, full_name, position, team, status, adp)
select p.id, p.nm, 'QB', p.nfl, 'Active', p.adp
from (values
 ('by-a-b1', 'BY A One (bye, stat row)', 'YC', 100), ('by-a-b2', 'BY A Two (bye, saved Thu)', 'YC', 100), ('by-a-b3', 'BY A Three (bye)', 'YC', 100),
 ('by-a-s1', 'BY A Sun', 'YS', 100),
 ('by-b-b1', 'BY B One (bye, stat row)', 'YC', 100), ('by-b-b2', 'BY B Two (bye, saved Thu)', 'YC', 100), ('by-b-b3', 'BY B Three (bye)', 'YC', 100),
 ('by-b-s1', 'BY B Sun One', 'YS', 100), ('by-b-s2', 'BY B Sun Two', 'YS', 100), ('by-b-s3', 'BY B Sun Three', 'YS', 100),
 ('by-c-s1', 'BY C Sun', 'YS', 100),
 ('by-f-b1', 'BY FA One (bye, stat row)', 'YC', 100), ('by-f-b2', 'BY FA Two (bye, saved Thu)', 'YC', 100), ('by-f-b3', 'BY FA Three (bye)', 'YC', 100),
 ('by-e-b1', 'BY E One (bye, stat row)', 'YC', 100), ('by-e-b2', 'BY E Two (bye, saved Thu)', 'YC', 100), ('by-e-b3', 'BY E Three (bye)', 'YC', 100),
 ('by-x-s1', 'BY X Sun One', 'YS', 100), ('by-x-s2', 'BY X Sun Two', 'YS', 100), ('by-x-s3', 'BY X Sun Three', 'YS', 100),
 ('by-g-b1', 'BY G One (bye, stat row)', 'YC', 100), ('by-g-b2', 'BY G Two (bye, saved Thu)', 'YC', 100), ('by-g-b3', 'BY G Three (bye)', 'YC', 100),
 ('by-g-s1', 'BY G Sun One', 'YS', 100), ('by-g-s2', 'BY G Sun Two', 'YS', 100), ('by-g-s3', 'BY G Sun Three', 'YS', 100), ('by-g-s4', 'BY G Sun Four', 'YS', 100),
 ('by-h-b1', 'BY H One (bye, stat row)', 'YC', 100), ('by-h-b2', 'BY H Two (bye, saved Thu)', 'YC', 100), ('by-h-b3', 'BY H Three (bye)', 'YC', 100),
 ('by-h-t1', 'BY H Thu', 'YA', 100), ('by-h-r1', 'BY H Released', 'YA', 100), ('by-h-s1', 'BY H Sun', 'YS', 100),
 ('by-w-b1', 'BY W One (bye, stat row)', 'YC', 100), ('by-w-b2', 'BY W Two (bye, saved Thu)', 'YC', 100), ('by-w-b3', 'BY W Three (bye)', 'YC', 100),
 ('by-w-f1', 'BY WF One (bye, stat row)', 'YC', 100), ('by-w-f2', 'BY WF Two (bye, saved Thu)', 'YC', 100), ('by-w-f3', 'BY WF Three (bye)', 'YC', 100)
) as p(id, nm, nfl, adp);

insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('BY Alpha', 'by-a-b1'), ('BY Alpha', 'by-a-b2'), ('BY Alpha', 'by-a-b3'), ('BY Alpha', 'by-a-s1'),
 ('BY Bravo', 'by-b-b1'), ('BY Bravo', 'by-b-b2'), ('BY Bravo', 'by-b-b3'), ('BY Bravo', 'by-b-s1'), ('BY Bravo', 'by-b-s2'), ('BY Bravo', 'by-b-s3'),
 ('BY Charlie', 'by-c-s1'),
 ('BY Echo', 'by-e-b1'), ('BY Echo', 'by-e-b2'), ('BY Echo', 'by-e-b3'),
 ('BY Foxtrot', 'by-x-s1'), ('BY Foxtrot', 'by-x-s2'), ('BY Foxtrot', 'by-x-s3'),
 ('BY Golf', 'by-g-b1'), ('BY Golf', 'by-g-b2'), ('BY Golf', 'by-g-b3'), ('BY Golf', 'by-g-s1'), ('BY Golf', 'by-g-s2'), ('BY Golf', 'by-g-s3'), ('BY Golf', 'by-g-s4'),
 ('BY Hotel', 'by-h-b1'), ('BY Hotel', 'by-h-b2'), ('BY Hotel', 'by-h-b3'), ('BY Hotel', 'by-h-t1'), ('BY Hotel', 'by-h-r1'), ('BY Hotel', 'by-h-s1'),
 ('BW Whiskey', 'by-w-b1'), ('BW Whiskey', 'by-w-b2'), ('BW Whiskey', 'by-w-b3')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c2000000-%';
insert into league_player_pool (league_id, player_id, state)
select 'b2000000-0000-4000-8000-000000000001', p, 'free_agent' from unnest(array['by-f-b1', 'by-f-b2', 'by-f-b3']) p;
insert into league_player_pool (league_id, player_id, state)
select 'b2000000-0000-4000-8000-000000000001', r.player_id, 'rostered' from league_rosters r where r.league_id = 'b2000000-0000-4000-8000-000000000001';
-- The live screen's symptom: a STALE lock on the pool view of Hotel's bye
-- players (written by a tick that judged them "played").
update league_player_pool set locked_until = '2026-10-20 03:30:00+00'
where league_id = 'b2000000-0000-4000-8000-000000000001' and player_id in ('by-h-b1', 'by-h-b2', 'by-h-b3');

-- Lineups in 105's shape; k* = each slot's SAVED kickoff. A *-b2 player
-- carries the Thursday instant (the stale record); the controls carry the
-- Thursday kickoff they really played in; Sunday players the Sunday one.
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c2000000-%' $$;
create function pg_temp.put(p_team text, p_q jsonb, p_k jsonb, p_bench jsonb)
returns void language sql as $$
  insert into team_lineups (team_id, season, week, slot_map, starters, bench)
  values (pg_temp.team(p_team), 2026, 6,
          (select coalesce(jsonb_object_agg('qb:' || (o - 1), q #>> '{}'), '{}'::jsonb) from jsonb_array_elements(p_q) with ordinality x(q, o) where jsonb_typeof(q) = 'string'),
          (select jsonb_agg(jsonb_build_object('slot', 'qb:' || (o - 1), 'player_id', q #>> '{}', 'kickoff_at', p_k ->> (o - 1)::int,
                                               'flags', case when jsonb_typeof(q) = 'string' then '[]'::jsonb else '["empty"]'::jsonb end) order by o)
           from jsonb_array_elements(p_q) with ordinality x(q, o)),
          p_bench)
$$;
select pg_temp.put(t.team, t.q::jsonb, t.k::jsonb, t.bench::jsonb)
from (values
 ('BY Commish',  '["by-f-b2", null, null, null]',                      '["2026-10-16T00:15:00+00:00", null, null, null]', '[]'),
 ('BY Alpha',    '["by-a-b1", "by-a-b2", "by-a-b3", null]',            '[null, "2026-10-16T00:15:00+00:00", null, null]', '["by-a-s1"]'),
 ('BY Bravo',    '["by-b-b1", "by-b-b2", "by-b-b3", null]',            '[null, "2026-10-16T00:15:00+00:00", null, null]', '["by-b-s1", "by-b-s2", "by-b-s3"]'),
 ('BY Charlie',  '[null, null, null, null]',                           '[null, null, null, null]',                        '["by-c-s1"]'),
 ('BY Echo',     '["by-e-b1", "by-e-b2", "by-e-b3", null]',            '[null, "2026-10-16T00:15:00+00:00", null, null]', '[]'),
 ('BY Foxtrot',  '["by-x-s1", "by-x-s2", "by-x-s3", null]',            '["2026-10-18T17:00:00+00:00", "2026-10-18T17:00:00+00:00", "2026-10-18T17:00:00+00:00", null]', '[]'),
 ('BY Golf',     '["by-g-b1", "by-g-b2", "by-g-b3", null]',            '[null, "2026-10-16T00:15:00+00:00", null, null]', '["by-g-s1", "by-g-s2", "by-g-s3", "by-g-s4"]'),
 ('BY Hotel',    '["by-h-b1", "by-h-b2", "by-h-t1", "by-h-r1"]',       '[null, "2026-10-16T00:15:00+00:00", "2026-10-16T00:15:00+00:00", "2026-10-16T00:15:00+00:00"]', '["by-h-b3", "by-h-s1"]'),
 ('BW Commish',  '["by-w-f2", null, null, null]',                      '["2026-10-16T00:15:00+00:00", null, null, null]', '[]'),
 ('BW Whiskey',  '["by-w-b1", "by-w-b2", "by-w-b3", null]',            '[null, "2026-10-16T00:15:00+00:00", null, null]', '[]')
) as t(team, q, k, bench);

-- STAT ROWS for week 6: every *-b1 / *-f1 bye player has one that names NO
-- game (157 counted it from the week's first kickoff — Thursday); the two
-- controls have the Thursday game's line.
insert into player_stats (player_id, season, week, stat_type, game_id, updated_at)
select p, 2026, 6, 'weekly', case when p in ('by-h-t1', 'by-h-r1') then 'by-g6a' end, '2026-10-16 03:30:00+00'
from unnest(array['by-a-b1', 'by-b-b1', 'by-f-b1', 'by-e-b1', 'by-g-b1', 'by-h-b1', 'by-w-b1', 'by-w-f1', 'by-h-t1', 'by-h-r1']) p;

-- THE NFL RELEASES h-r1 after the Thursday game (no team — F447's case).
update players set team = null where id = 'by-h-r1';

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

create temp table r150 (tag text primary key, r jsonb not null);
create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '92000000-0000-4000-8000-00000000000' || p_n, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b2000000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a2000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.lu(p_team text) returns text language sql as $$
  select format('%s | %s', tl.slot_map::text, tl.bench::text)
  from team_lineups tl where tl.team_id = pg_temp.team(p_team) and tl.season = 2026 and tl.week = 6 $$;
create function pg_temp.rec(p_team text, p_pid text) returns text language sql as $$
  select coalesce((select s ->> 'kickoff_at' from team_lineups tl, jsonb_array_elements(tl.starters) s
                   where tl.team_id = pg_temp.team(p_team) and tl.week = 6 and s ->> 'player_id' = p_pid), 'null') $$;
create function pg_temp.roster_of(p_pid text) returns text language sql as $$
  select coalesce((select t.name from league_rosters r join teams t on t.id = r.team_id where r.player_id = p_pid and r.league_id::text like 'b2000000-%'), '(none)') $$;
-- An ACCEPTED path is called through pg_temp.ok: 'ok' or the refusal text,
-- so a break probe reds the cell instead of aborting the run.
create function pg_temp.ok(p_tag text, p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception when others then
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp.ad(p_tag text, p_user int, p_team text, p_add text, p_drop text, p_at timestamptz, p_act int) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r150 select p_tag, public.roster_add_drop_internal(pg_temp.lg(1), pg_temp.team(p_team), p_add, p_drop, pg_temp.act(p_act), p_at);
end $$;
create function pg_temp.sl(p_tag text, p_user int, p_team text, p_map jsonb, p_at timestamptz, p_act int) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r150 select p_tag, public.set_lineup_internal(pg_temp.lg(1), pg_temp.team(p_team), 6, p_map, pg_temp.act(p_act), p_at, null);
end $$;
create function pg_temp.claim(p_tag text, p_user int, p_team text, p_add text, p_drop text, p_bid int, p_at timestamptz, p_act int) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r150 select p_tag, public.waiver_claim_submit_internal(pg_temp.lg(2), pg_temp.team(p_team), p_add, p_drop, p_bid, pg_temp.act(p_act), p_at, null);
end $$;
create function pg_temp.locks(p_pids text[], p_at timestamptz) returns text language sql as $$
  select string_agg(x.p || '=' || coalesce(d ->> 'locked', '?') || '/' || coalesce(d ->> 'datum_arm', '-'), ' ' order by x.p)
  from unnest(p_pids) x(p)
  cross join lateral (select public.pool_game_lock_player_internal(pg_temp.lg(1), 2026, 6, x.p, p_at) d) y $$;

-- ---------------------------------------------------------------------------
-- B. The judgment itself — the helpers at Sunday 12:00 ET (10-18 16:00Z)
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s=%s/%s', x.p, y.played, coalesce(y.datum_arm, '-')), ' ' order by x.p)
   from unnest(array['by-h-b1', 'by-h-b2', 'by-h-b3', 'by-f-b1', 'by-f-b2']) x(p)
   cross join lateral public.lineup_played_internal(pg_temp.lg(1), 2026, 6, x.p, '2026-10-18 16:00:00+00') y),
  'by-f-b1=f/- by-f-b2=f/- by-h-b1=f/- by-h-b2=f/- by-h-b3=f/-',
  'B1 THE RULING: a player whose NFL team is set and has NO game this week has NOT played — whatever a stat row naming no game (b1 / f-b1) or a saved Thursday kickoff (b2 on his own lineup, f-b2 a kept start on another team''s) says');
select is(
  pg_temp.locks(array['by-h-b1', 'by-h-b2', 'by-h-b3', 'by-f-b1', 'by-f-b2', 'by-f-b3'], '2026-10-18 16:00:00+00'),
  'by-f-b1=false/bye by-f-b2=false/bye by-f-b3=false/bye by-h-b1=false/bye by-h-b2=false/bye by-h-b3=false/bye',
  'B2 …so the per-player lock every add / drop / claim / trade reads is OPEN for all six bye players (the team check''s own bye answer stands)');
select is(
  (select string_agg(format('%s=%s/%s/%s', x.p, coalesce(k.kickoff_at::text, 'null'), k.datum_arm, k.on_bye), ' ' order by x.p)
   from unnest(array['by-h-b1', 'by-h-b2', 'by-h-b3']) x(p)
   cross join lateral public.lineup_player_kickoff_internal(pg_temp.lg(1), 2026, 6, x.p, '2026-10-18 16:00:00+00') k),
  'by-h-b1=null/bye/t by-h-b2=null/bye/t by-h-b3=null/bye/t',
  'B3 …and the lineup datum set_lineup / autopilot / the commissioner editor / the carry read is the BYE (no kickoff, flagged bye) — never a Thursday kickoff he did not play');
select is(
  format('%s|%s|%s|%s',
         public.lineup_record_kicked_off_internal(2026, 6, 'by-h-b2', '2026-10-16 00:15:00+00', '2026-10-18 16:00:00+00'),
         public.lineup_record_kicked_off_internal(2026, 6, 'by-h-t1', '2026-10-16 00:15:00+00', '2026-10-18 16:00:00+00'),
         public.lineup_record_kicked_off_internal(2026, 6, 'by-h-r1', '2026-10-16 00:15:00+00', '2026-10-18 16:00:00+00'),
         public.lineup_record_kicked_off_internal(2026, 6, 'by-h-t1', '2026-10-16 00:15:00+00', '2026-10-16 00:14:59+00')),
  'f|t|t|f',
  'B4 a saved Thursday kickoff is NOT real for a bye player (h-b2); it still is for a Thursday player (h-t1) and for a RELEASED player who played (h-r1 — no team: today''s rule), and never before the kickoff (00:14:59)');
select is(
  (select string_agg(format('%s=%s/%s', x.p, y.played, coalesce(y.datum_arm, '-')), ' ' order by x.p)
   from unnest(array['by-h-t1', 'by-h-r1', 'by-h-s1']) x(p)
   cross join lateral public.lineup_played_internal(pg_temp.lg(1), 2026, 6, x.p, '2026-10-18 16:00:00+00') y)
  || ' || ' || pg_temp.locks(array['by-h-t1', 'by-h-r1', 'by-h-s1'], '2026-10-18 16:00:00+00'),
  'by-h-r1=t/lineup_record by-h-s1=f/- by-h-t1=t/lineup_record || by-h-r1=true/lineup_record by-h-s1=false/nfl_games by-h-t1=true/nfl_games',
  'B5 CONTROLS: the released player who played Thursday (F447) and the Thursday player are played and LOCKED; the Sunday player (game still ahead) is not');

-- ---------------------------------------------------------------------------
-- C. DROPS (roster_add_drop) at Sunday 12:00 ET — Alpha's three bye starters
-- ---------------------------------------------------------------------------
select is(
  format('%s | %s | %s',
         pg_temp.ok('C1a', $$ select pg_temp.ad('C1a', 2, 'BY Alpha', null, 'by-a-b1', '2026-10-18 16:00:00+00', 1) $$),
         pg_temp.ok('C1b', $$ select pg_temp.ad('C1b', 2, 'BY Alpha', null, 'by-a-b2', '2026-10-18 16:00:01+00', 2) $$),
         pg_temp.ok('C1c', $$ select pg_temp.ad('C1c', 2, 'BY Alpha', null, 'by-a-b3', '2026-10-18 16:00:02+00', 3) $$)),
  'ok | ok | ok',
  'C1 THE LIVE BUG: his manager DROPS each bye starter at Sunday 12:00 ET — the stat-row one and the saved-Thursday-kickoff one too (before 200 both were refused "locked for drops — kicked off at Thursday")');
select is(
  format('%s/%s/%s || %s', pg_temp.roster_of('by-a-b1'), pg_temp.roster_of('by-a-b2'), pg_temp.roster_of('by-a-b3'), pg_temp.lu('BY Alpha')),
  '(none)/(none)/(none) || {} | ["by-a-s1"]',
  'C2 …all three leave the roster and their starting slots (a drop always clears his slot — Q32)');

-- ---------------------------------------------------------------------------
-- L. LINEUP MOVES — bench them, start them again (set_lineup), autopilot
-- ---------------------------------------------------------------------------
select is(
  pg_temp.ok('L1', $$ select pg_temp.sl('L1', 3, 'BY Bravo', '{"qb:0": "by-b-s1", "qb:1": "by-b-s2", "qb:2": "by-b-s3"}', '2026-10-18 16:01:00+00', 11) $$)
  || ' || ' || pg_temp.lu('BY Bravo'),
  'ok || {"qb:0": "by-b-s1", "qb:1": "by-b-s2", "qb:2": "by-b-s3"} | ["by-b-b1", "by-b-b2", "by-b-b3"]',
  'L1 BENCH: Bravo benches its three bye starters for Sunday players at Sunday 12:00 ET (before 200: "slot qb:0 is locked — kicked off at Thursday", the stat-row and saved-kickoff starters stuck)');
select is(
  pg_temp.ok('L2', $$ select pg_temp.sl('L2', 3, 'BY Bravo', '{"qb:0": "by-b-b1", "qb:1": "by-b-b2", "qb:2": "by-b-b3", "qb:3": "by-b-s1"}', '2026-10-18 16:02:00+00', 12) $$)
  || ' || ' || pg_temp.lu('BY Bravo') || ' || ' || pg_temp.rec('BY Bravo', 'by-b-b1') || '/' || pg_temp.rec('BY Bravo', 'by-b-b2'),
  'ok || {"qb:0": "by-b-b1", "qb:1": "by-b-b2", "qb:2": "by-b-b3", "qb:3": "by-b-s1"} | ["by-b-s2", "by-b-s3"]'
  || ' || null/null',
  'L2 START: …and starts them again from the bench (before 200 the stat-row man "kicked off Thursday" and could never enter a slot); their saved kickoff is the bye''s (null), not Thursday');
insert into r150 select 'L3', public.lineup_autopilot_internal(pg_temp.lg(1), pg_temp.team('BY Golf'), 2026, 6, '2026-10-18 16:00:00+00');
select is(
  (select format('%s|%s|%s', r ->> 'changed',
                 (select string_agg(v, ',' order by v) from jsonb_each_text(r -> 'slot_map') e(k, v)),
                 coalesce((select string_agg(e ->> 'player_id', ',') from jsonb_array_elements(r -> 'skipped_locked') e), '-'))
   from r150 where tag = 'L3'),
  'true|by-g-s1,by-g-s2,by-g-s3,by-g-s4|-',
  'L3 AUTOPILOT: Golf''s bye starters (stat row, saved Thursday kickoff, clean) are benched for its four Sunday players — none is held as "locked" (before 200 g-b1 / g-b2 stayed seated)');

-- ---------------------------------------------------------------------------
-- P. ADDS (roster_add_drop) — three bye free agents
-- ---------------------------------------------------------------------------
select is(
  format('%s | %s | %s',
         pg_temp.ok('P1a', $$ select pg_temp.ad('P1a', 4, 'BY Charlie', 'by-f-b1', null, '2026-10-18 16:03:00+00', 21) $$),
         pg_temp.ok('P1b', $$ select pg_temp.ad('P1b', 4, 'BY Charlie', 'by-f-b2', null, '2026-10-18 16:03:01+00', 22) $$),
         pg_temp.ok('P1c', $$ select pg_temp.ad('P1c', 4, 'BY Charlie', 'by-f-b3', null, '2026-10-18 16:03:02+00', 23) $$)),
  'ok | ok | ok',
  'P1 ADD: Charlie picks up each bye free agent at Sunday 12:03 — the stat-row one and the one with a saved Thursday kickoff on another team''s lineup too (before 200: "locked for adds")');
select is(
  format('%s/%s/%s', pg_temp.roster_of('by-f-b1'), pg_temp.roster_of('by-f-b2'), pg_temp.roster_of('by-f-b3')),
  'BY Charlie/BY Charlie/BY Charlie',
  'P2 …all three land on Charlie');

-- ---------------------------------------------------------------------------
-- F. A TRADE — accepted at Sunday 12:00 ET, it goes through at once
-- ---------------------------------------------------------------------------
select pg_temp.as_user(5);
insert into r150 select 'F0', public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('BY Echo'), pg_temp.team('BY Foxtrot'),
  jsonb_build_array(jsonb_build_object('player_id', 'by-e-b1', 'from_team_id', pg_temp.team('BY Echo')),
                    jsonb_build_object('player_id', 'by-e-b2', 'from_team_id', pg_temp.team('BY Echo')),
                    jsonb_build_object('player_id', 'by-e-b3', 'from_team_id', pg_temp.team('BY Echo')),
                    jsonb_build_object('player_id', 'by-x-s1', 'from_team_id', pg_temp.team('BY Foxtrot')),
                    jsonb_build_object('player_id', 'by-x-s2', 'from_team_id', pg_temp.team('BY Foxtrot')),
                    jsonb_build_object('player_id', 'by-x-s3', 'from_team_id', pg_temp.team('BY Foxtrot'))),
  null, null, pg_temp.act(31), '2026-10-18 15:00:00+00', null);
select set_config('request.jwt.claims', '', true);
select pg_temp.as_user(6);
insert into r150 select 'F1x', to_jsonb(pg_temp.ok('F1', $$ insert into r150 select 'F1', public.trade_respond_internal(pg_temp.lg(1), (select (r #>> '{trade,id}')::uuid from r150 where tag = 'F0'),
  'accept', null, null, null, pg_temp.act(32), '2026-10-18 16:00:00+00', null) $$));
select is(
  coalesce((select format('%s|%s', r #>> '{execution,outcome}',
                          (select t.status from trades t where t.id = (select (x.r #>> '{trade,id}')::uuid from r150 x where x.tag = 'F0')))
            from r150 where tag = 'F1'),
           (select r #>> '{}' from r150 where tag = 'F1x')),
  'complete|complete',
  'F1 TRADE: Foxtrot accepts at Sunday 12:00 a trade naming Echo''s three bye players — it goes through AT ONCE (before 200 the executor deferred it to the week''s end: "already played this week")');
select is(
  format('%s/%s/%s || %s/%s/%s', pg_temp.roster_of('by-e-b1'), pg_temp.roster_of('by-e-b2'), pg_temp.roster_of('by-e-b3'),
         pg_temp.roster_of('by-x-s1'), pg_temp.roster_of('by-x-s2'), pg_temp.roster_of('by-x-s3')),
  'BY Foxtrot/BY Foxtrot/BY Foxtrot || BY Echo/BY Echo/BY Echo',
  'F2 …every player moves now');

-- ---------------------------------------------------------------------------
-- W. WAIVER CLAIMS (LW) — the submit's add lock, the run's add AND drop
-- ---------------------------------------------------------------------------
select is(
  format('%s | %s | %s',
         pg_temp.ok('W1a', $$ select pg_temp.claim('W1a', 2, 'BW Whiskey', 'by-w-f1', 'by-w-b1', 5, '2026-10-18 15:00:00+00', 41) $$),
         pg_temp.ok('W1b', $$ select pg_temp.claim('W1b', 2, 'BW Whiskey', 'by-w-f2', 'by-w-b2', 4, '2026-10-18 15:00:01+00', 42) $$),
         pg_temp.ok('W1c', $$ select pg_temp.claim('W1c', 2, 'BW Whiskey', 'by-w-f3', 'by-w-b3', 3, '2026-10-18 15:00:02+00', 43) $$)),
  'ok | ok | ok',
  'W1 SUBMIT: Whiskey''s three claims on bye free agents are accepted after Thursday''s game (before 200 the stat-row and saved-kickoff ones were refused "locked for adds" — Q74)');
insert into r150 select 'W2', public.process_waivers_internal(pg_temp.lg(2), '2026-10-18 16:00:00+00');
select is(
  (select string_agg(c.add_player_id || '>' || c.drop_player_id || '=' || c.status || ':' || coalesce(c.result_reason, '-'), ' ' order by c.add_player_id)
   from waiver_claims c where c.league_id = pg_temp.lg(2)),
  'by-w-f1>by-w-b1=won:- by-w-f2>by-w-b2=won:- by-w-f3>by-w-b3=won:-',
  'W2 THE RUN at Sunday 12:00 ET: all three claims WIN — no add_locked for the bye pickups, no drop_locked for the bye drops ("the player you''d drop had already played this week" — the live refusal), the stat-row and saved-kickoff ones included');
select is(
  format('%s/%s/%s || %s/%s/%s', pg_temp.roster_of('by-w-f1'), pg_temp.roster_of('by-w-f2'), pg_temp.roster_of('by-w-f3'),
         pg_temp.roster_of('by-w-b1'), pg_temp.roster_of('by-w-b2'), pg_temp.roster_of('by-w-b3')),
  'BW Whiskey/BW Whiskey/BW Whiskey || (none)/(none)/(none)',
  'W3 …the pickups join Whiskey and the dropped bye players leave it');

-- ---------------------------------------------------------------------------
-- T. THE PER-MINUTE TICK — stale saved kickoffs and stale pool locks heal
-- ---------------------------------------------------------------------------
select set_config('pgtap.t1', public.lineup_lock_tick('2026-10-18 16:05:00+00', pg_temp.lg(1))::text, true);
select is(
  format('%s|%s || %s|%s|%s', pg_temp.rec('BY Hotel', 'by-h-b2'), pg_temp.rec('BY Commish', 'by-f-b2'),
         pg_temp.rec('BY Hotel', 'by-h-t1'), pg_temp.rec('BY Hotel', 'by-h-r1'), pg_temp.rec('BY Foxtrot', 'by-e-b1')),
  'null|null || 2026-10-16T00:15:00+00:00|2026-10-16T00:15:00+00:00|null',
  'T1 the tick CLEARS a bye player''s stale saved Thursday kickoff (Hotel''s h-b2, the kept start f-b2) to his bye datum — before 200 it kept it forever; the controls'' real Thursday kickoffs stay (F447)');
select is(
  (select string_agg(pp.player_id || '=' || pp.state || ':' || coalesce(pp.locked_until::text, 'null'), ' ' order by pp.player_id)
   from league_player_pool pp where pp.league_id = pg_temp.lg(1) and pp.player_id in ('by-h-b1', 'by-h-b2', 'by-h-b3', 'by-g-b1', 'by-g-b2', 'by-f-b1')),
  'by-f-b1=rostered:null by-g-b1=rostered:null by-g-b2=rostered:null by-h-b1=rostered:null by-h-b2=rostered:null by-h-b3=rostered:null',
  'T2 the POOL VIEW (what My Team''s lock reads) is EMPTY for every bye player — the stale locks planted on Hotel''s are cleared, and none is written for the stat-row or saved-kickoff ones');
select is(
  (select string_agg(pp.player_id || '=' || pp.state || ':' || coalesce(pp.locked_until::text, 'null'), ' ' order by pp.player_id)
   from league_player_pool pp where pp.league_id = pg_temp.lg(1) and pp.player_id in ('by-h-t1', 'by-h-r1', 'by-h-s1')),
  'by-h-r1=rostered:2026-10-20 03:30:00+00 by-h-s1=rostered:null by-h-t1=rostered:2026-10-20 03:30:00+00',
  'T3 CONTROLS on the view: the Thursday player and the released one are locked until week 6''s end; the Sunday player is open');

-- ---------------------------------------------------------------------------
-- K. CONTROLS end to end — the lock still binds where it should
-- ---------------------------------------------------------------------------
select is(
  pg_temp.ok('K1', $$ select pg_temp.ad('K1', 8, 'BY Hotel', null, 'by-h-r1', '2026-10-18 16:10:00+00', 51) $$),
  'P0001: roster_add_drop: BY H Released (by-h-r1) is locked for drops — kicked off at 2026-10-16T00:15:00+00:00 (lineup_record); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
  'K1 a RELEASED player (no team) who played Thursday stays LOCKED for drops (F447 — the team-is-set condition keeps him)');
select is(
  pg_temp.ok('K2', $$ select pg_temp.ad('K2', 8, 'BY Hotel', null, 'by-h-t1', '2026-10-18 16:10:01+00', 52) $$),
  'P0001: roster_add_drop: BY H Thu (by-h-t1) is locked for drops — kicked off at 2026-10-16T00:15:00+00:00 (nfl_games); week 6 clears at 2026-10-20T03:30:00+00:00 (when its last game ends — §13.1/E32, Q34(B): the lock binds regardless of settings): no dropping a player mid-game',
  'K2 a Thursday player stays LOCKED for drops');
select is(
  pg_temp.ok('K3', $$ select pg_temp.sl('K3', 8, 'BY Hotel', '{"qb:0": "by-h-b3", "qb:1": "by-h-s1", "qb:2": "by-h-b1", "qb:3": "by-h-r1"}', '2026-10-18 16:10:02+00', 53) $$),
  'P0001: set_lineup: slot qb:2 is locked — BY H Thu kicked off at 2026-10-16T00:15:00+00:00 (nfl_games) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
  'K3 a Thursday starter still cannot be benched (§11.2)');
select is(
  pg_temp.ok('K4', $$ select pg_temp.sl('K4', 8, 'BY Hotel', '{"qb:0": "by-h-b3", "qb:1": "by-h-s1", "qb:2": "by-h-t1", "qb:3": "by-h-r1"}', '2026-10-18 16:10:03+00', 54) $$)
  || ' || ' || pg_temp.lu('BY Hotel'),
  'ok || {"qb:0": "by-h-b3", "qb:1": "by-h-s1", "qb:2": "by-h-t1", "qb:3": "by-h-r1"} | ["by-h-b1", "by-h-b2"]',
  'K4 …while the same lineup''s bye starters (h-b1 stat row, h-b2 once-saved Thursday kickoff) are benched for a bye and a Sunday player around the two held slots');
select is(
  pg_temp.ok('K5', $$ select pg_temp.ad('K5', 8, 'BY Hotel', null, 'by-h-s1', '2026-10-18 16:10:04+00', 55) $$)
  || ' | ' || pg_temp.roster_of('by-h-s1'),
  'ok | (none)',
  'K5 a Sunday player whose game is still ahead is droppable at Sunday 12:10 (positive control)');

select * from finish();
rollback;
