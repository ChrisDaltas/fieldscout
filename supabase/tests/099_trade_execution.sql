-- ============================================================================
-- Trade execution — review (none / commissioner), the deadline, the
-- game-lock wait, a manager leaving, the tick — pgTAP 099 (M5 task L.D3.3;
-- migration 151; spec §13.3, §7.3.5, §14, E8, E35, E36, E37, E47, CLAUDE.md
-- rule 7; tasks-M5 TD9–TD13 / TD16; PROGRESS F413 / F414, Q75 / Q76).
--
-- Numbering: RESERVED by the orchestrator (151 / 099).
-- OWN FIXTURE: leagues b99…, teams c99…, users 999…, action ids a99…,
-- players x-*. Every instant is passed explicitly (p_at / p_now — the
-- TimeProvider rule); the internals are called as postgres with the actor's
-- JWT claims set, so auth.uid() is the actor.
--
-- THE CALENDAR (2026, rewritten inside this transaction): weeks 1–6 over;
-- week 7 starts Wed 2026-10-21 04:00Z, TXA kicks off Thu 10-23 00:15Z, TXB
-- Sun 10-25 17:00Z, the week's last game ends Tue 10-27 03:30Z; week 8
-- starts Wed 10-28 04:00Z (= the week-7 trade deadline), TXA kicks off Thu
-- 10-30 00:15Z, its last game not yet recorded (NULL). TXC is on bye in
-- weeks 7 and 8 (never locked).
--
-- Falsifiability (tasks-M1 §4.3):
--   * boundary instants as stored literals: the review deadline ±1 s (D2/D3),
--     the defer release ±1 s (C12/C13), the trade deadline ±1 s for propose,
--     accept and expiry (G1–G8), the recorded-later release (H2–H4);
--   * every refusal / reason a stored literal (E35 reject, F413 (c) FAAB and
--     roster, E37 at execute, E47, the sweep, F414);
--   * BREAK PROBES shown red in the PR, then reverted: (1) drop the
--     executor's re-validation ⇒ F7 reds; (2) never set
--     app.executing_trade_id ⇒ F5 reds; (3) clear lineups from the current
--     week even when it is finished ⇒ C15 reds; (4) the deadline `<=` → `<`
--     ⇒ G2 reds.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(75);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('trade_close_internal', 'trade_deadline_internal', 'trade_execute_internal',
                                                 'trade_lock_internal', 'trade_rescind_on_stint_close', 'trade_tick')),
  'trade_close_internal:f:search_path="":f:f trade_deadline_internal:f:search_path="":f:f trade_execute_internal:f:search_path="":f:f trade_lock_internal:f:search_path="":f:f trade_rescind_on_stint_close:t:search_path="":f:f trade_tick:f:search_path="":f:f',
  'A1 six new functions, one overload each, search_path empty; only the trigger function is DEFINER; none executable by anon or authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname in ('trade_close_internal', 'trade_deadline_internal', 'trade_execute_internal',
                                                  'trade_lock_internal', 'trade_rescind_on_stint_close', 'trade_tick',
                                                  'trade_view_internal', 'trade_check_internal', 'trade_propose_internal', 'trade_respond_internal')
      and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  'A2 PUBLIC holds EXECUTE on none of the new or replaced functions (REVOKEs restated)');
select is(
  (select string_agg(format('%s:%s', t.tgname, t.tgenabled), ' ' order by t.tgname)
   from pg_trigger t where t.tgrelid = 'public.team_managers'::regclass and t.tgname like 'trg_trade%'),
  'trg_trade_rescind_on_stint_close:A',
  'A4 E47: one trigger on team_managers, ENABLE ALWAYS (R616)');
select is(
  (select schedule || ' | ' || command from cron.job where jobname = 'trade-tick'),
  '* * * * * | SELECT public.trade_tick()',
  'A5 the tick is scheduled every minute on pg_cron (one entry)');
select ok(
  (select prosrc from pg_proc where proname = 'trade_respond_internal') like '%public.trade_execute_internal(p_trade_id, p_at, ''accept'')%'
  and (select prosrc from pg_proc where proname = 'trade_respond_internal') like '%public.trade_deadline_internal(v_league)%'
  and (select prosrc from pg_proc where proname = 'trade_propose_internal') like '%public.trade_deadline_internal(v_league)%'
  and (select prosrc from pg_proc where proname = 'trade_execute_internal') like '%set_config(''app.executing_trade_id'', p_trade_id::text, true)%',
  'A6 D137: accept calls the executor, propose / accept read the deadline, the executor sets app.executing_trade_id (F413 (a))');
select ok(
  (select prosrc from pg_proc where proname = 'trade_respond') like '%trade_respond_internal(%now()%'
  and (select prosrc from pg_proc where proname = 'trade_propose') like '%trade_propose_internal(%now()%'
  and (select prosecdef from pg_proc where proname = 'trade_respond') and (select prosecdef from pg_proc where proname = 'trade_propose'),
  'A7 148''s two doors are untouched: DEFINER, passing now() as p_at');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context)
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case when w.week <= 6 then w.starts_at + interval '6 days'
                             when w.week = 7 then '2026-10-27 03:30:00+00'::timestamptz end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'x-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 12;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('x-g7a', 2026, 7, 'TXA', 'TXZ', '2026-10-23 00:15:00+00'), ('x-g7b', 2026, 7, 'TXB', 'TXY', '2026-10-25 17:00:00+00'),
 ('x-g8a', 2026, 8, 'TXA', 'TXZ', '2026-10-30 00:15:00+00'), ('x-g8b', 2026, 8, 'TXB', 'TXY', '2026-11-01 18:00:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('99900000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-tx' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'tx_user' || i)::jsonb, now(), now()
from generate_series(1, 8) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review, trade_deadline_week,
                     settings, roster_settings)
select l.id, '99900000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 12, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', 'faab', 100, l.review, l.deadline, l.st,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('b9900000-0000-4000-8000-000000000001'::uuid, 'pgtap-tx-L1', 'none',         7,    '{"allow_faab_in_trades": true}'::jsonb),
 ('b9900000-0000-4000-8000-000000000002'::uuid, 'pgtap-tx-L2', 'commissioner', 7,    '{"trade_lock_behavior": "reject"}'::jsonb),
 ('b9900000-0000-4000-8000-000000000003'::uuid, 'pgtap-tx-L3', 'none',         null, '{}'::jsonb),
 ('b9900000-0000-4000-8000-000000000004'::uuid, 'pgtap-tx-L4', 'commissioner', null, '{"allow_faab_in_trades": true}'::jsonb),
 ('b9900000-0000-4000-8000-000000000005'::uuid, 'pgtap-tx-L5', 'none',         null, '{"allow_faab_in_trades": true}'::jsonb)
) as l(id, nm, review, deadline, st);

insert into teams (id, owner_id, name, league_id, status)
select t.id::uuid, ('99900000-0000-4000-8000-00000000000' || t.u)::uuid, t.nm, ('b9900000-0000-4000-8000-00000000000' || t.lg)::uuid, 'active'
from (values
 ('c9900000-0000-4000-8000-000000000011', 1, 'TX Commish',   1), ('c9900000-0000-4000-8000-000000000012', 2, 'TX Alpha',   1),
 ('c9900000-0000-4000-8000-000000000013', 3, 'TX Bravo',     1), ('c9900000-0000-4000-8000-000000000014', 4, 'TX Delta',   1),
 ('c9900000-0000-4000-8000-000000000021', 1, 'TX2 Commish',  2), ('c9900000-0000-4000-8000-000000000022', 2, 'TX Papa',    2),
 ('c9900000-0000-4000-8000-000000000023', 3, 'TX Quebec',    2),
 ('c9900000-0000-4000-8000-000000000031', 1, 'TX3 Commish',  3), ('c9900000-0000-4000-8000-000000000032', 2, 'TX Golf',    3),
 ('c9900000-0000-4000-8000-000000000033', 3, 'TX Hotel',     3),
 ('c9900000-0000-4000-8000-000000000041', 1, 'TX4 Commish',  4), ('c9900000-0000-4000-8000-000000000042', 2, 'TX Romeo',   4),
 ('c9900000-0000-4000-8000-000000000043', 3, 'TX Sierra',    4), ('c9900000-0000-4000-8000-000000000044', 4, 'TX Tango',   4),
 ('c9900000-0000-4000-8000-000000000045', 5, 'TX Uniform',   4), ('c9900000-0000-4000-8000-000000000046', 7, 'TX Victor',  4),
 ('c9900000-0000-4000-8000-000000000047', 8, 'TX Whiskey',   4),
 ('c9900000-0000-4000-8000-000000000051', 1, 'TX5 Commish',  5), ('c9900000-0000-4000-8000-000000000052', 2, 'TX5 Victor', 5),
 ('c9900000-0000-4000-8000-000000000053', 3, 'TX5 Whiskey',  5), ('c9900000-0000-4000-8000-000000000054', 4, 'TX Yankee',  5),
 ('c9900000-0000-4000-8000-000000000055', 5, 'TX Zulu',      5)
) as t(id, u, nm, lg);

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '99900000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false,
       case t.name when 'TX Alpha' then 50 when 'TX Romeo' then 30 when 'TX5 Victor' then 20 else 100 end
from teams t where t.id::text like 'c9900000-%';

insert into team_managers (league_id, team_id, user_id, started_at)
select t.league_id, t.id, t.owner_id, '2026-09-01 00:00:00+00' from teams t where t.league_id = 'b9900000-0000-4000-8000-000000000005' and t.name <> 'TX5 Commish';

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 12) w where l.id::text like 'b9900000-%';

insert into players (id, full_name, position, team, status)
select p.id, p.nm, 'QB', p.nfl, 'Active'
from (values
 ('x-c1', 'TX C One', 'TXC'), ('x-a1', 'TX A One', 'TXA'), ('x-a2', 'TX A Two', 'TXC'), ('x-a3', 'TX A Three', 'TXC'),
 ('x-b1', 'TX B One', 'TXB'), ('x-b2', 'TX B Two', 'TXC'), ('x-b3', 'TX B Three', 'TXC'), ('x-d1', 'TX D One', 'TXC'), ('x-d2', 'TX D Two', 'TXC'),
 ('x-p1', 'TX P One', 'TXC'), ('x-p2', 'TX P Two', 'TXA'), ('x-p3', 'TX P Three', 'TXC'),
 ('x-q1', 'TX Q One', 'TXC'), ('x-q2', 'TX Q Two', 'TXC'), ('x-q3', 'TX Q Three', 'TXC'),
 ('x-g1', 'TX G One', 'TXA'), ('x-h1', 'TX H One', 'TXC'),
 ('x-c4a', 'TX C4 A', 'TXC'), ('x-c4b', 'TX C4 B', 'TXC'), ('x-r1', 'TX R One', 'TXC'), ('x-r2', 'TX R Two', 'TXC'),
 ('x-s1', 'TX S One', 'TXC'), ('x-s2', 'TX S Two', 'TXC'), ('x-s3', 'TX S Three', 'TXC'),
 ('x-t1', 'TX T One', 'TXC'), ('x-t2', 'TX T Two', 'TXC'), ('x-t3', 'TX T Three', 'TXC'), ('x-t4', 'TX T Four', 'TXC'),
 ('x-u1', 'TX U One', 'TXC'), ('x-u2', 'TX U Two', 'TXC'),
 ('x-v1', 'TX V One', 'TXC'), ('x-v2', 'TX V Two', 'TXC'), ('x-v3', 'TX V Three', 'TXC'),
 ('x-w1', 'TX W One', 'TXC'), ('x-w2', 'TX W Two', 'TXC'), ('x-w3', 'TX W Three', 'TXC'),
 ('x-v5a', 'TX V5 A', 'TXC'), ('x-w5a', 'TX W5 A', 'TXC'), ('x-y5a', 'TX Y5 A', 'TXC'), ('x-z5a', 'TX Z5 A', 'TXC')
) as p(id, nm, nfl);

insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('TX Commish', 'x-c1'), ('TX Alpha', 'x-a1'), ('TX Alpha', 'x-a2'), ('TX Alpha', 'x-a3'),
 ('TX Bravo', 'x-b1'), ('TX Bravo', 'x-b2'), ('TX Bravo', 'x-b3'), ('TX Delta', 'x-d1'), ('TX Delta', 'x-d2'),
 ('TX Papa', 'x-p1'), ('TX Papa', 'x-p2'), ('TX Papa', 'x-p3'), ('TX Quebec', 'x-q1'), ('TX Quebec', 'x-q2'), ('TX Quebec', 'x-q3'),
 ('TX Golf', 'x-g1'), ('TX Hotel', 'x-h1'),
 ('TX4 Commish', 'x-c4a'), ('TX4 Commish', 'x-c4b'), ('TX Romeo', 'x-r1'), ('TX Romeo', 'x-r2'),
 ('TX Sierra', 'x-s1'), ('TX Sierra', 'x-s2'), ('TX Sierra', 'x-s3'), ('TX Tango', 'x-t1'), ('TX Tango', 'x-t2'),
 ('TX Uniform', 'x-u1'), ('TX Uniform', 'x-u2'), ('TX Victor', 'x-v1'), ('TX Victor', 'x-v2'), ('TX Victor', 'x-v3'),
 ('TX Whiskey', 'x-w1'), ('TX Whiskey', 'x-w2'), ('TX Whiskey', 'x-w3'),
 ('TX5 Victor', 'x-v5a'), ('TX5 Whiskey', 'x-w5a'), ('TX Yankee', 'x-y5a'), ('TX Zulu', 'x-z5a')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c9900000-%';

-- Lineups (TD10): TX Alpha weeks 6 + 7, TX Bravo week 7.
insert into team_lineups (team_id, season, week, slot_map, starters, bench) values
 ('c9900000-0000-4000-8000-000000000012', 2026, 6, '{"qb:0": "x-a2"}', '[{"slot": "qb:0", "player_id": "x-a2"}]', '["x-a1", "x-a3"]'),
 ('c9900000-0000-4000-8000-000000000012', 2026, 7, '{"qb:0": "x-a2"}', '[{"slot": "qb:0", "player_id": "x-a2"}]', '["x-a1", "x-a3"]'),
 ('c9900000-0000-4000-8000-000000000013', 2026, 7, '{"qb:0": "x-b1"}', '[{"slot": "qb:0", "player_id": "x-b1"}]', '["x-b2", "x-b3"]');

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

create temp table r99 (tag text primary key, r jsonb not null);
create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '99900000-0000-4000-8000-00000000000' || p_n, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c9900000-%' $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b9900000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a9900000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.leg(p_player text, p_team text) returns jsonb language sql as $$ select jsonb_build_object('player_id', p_player, 'from_team_id', pg_temp.team(p_team)) $$;
create function pg_temp.cash(p_amount int, p_team text) returns jsonb language sql as $$ select jsonb_build_object('faab_amount', p_amount, 'from_team_id', pg_temp.team(p_team)) $$;
-- propose(tag, league, actor, from, to, legs, drops, at)
create function pg_temp.prop(p_tag text, p_lg int, p_user int, p_from text, p_to text, p_items jsonb, p_drops text[], p_at timestamptz, p_act int)
returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r99 select p_tag, public.trade_propose_internal(pg_temp.lg(p_lg), pg_temp.team(p_from), pg_temp.team(p_to), p_items, p_drops, null, pg_temp.act(p_act), p_at, null);
  return (select (r #>> '{trade,id}')::uuid from r99 where tag = p_tag);
end $$;
create function pg_temp.resp(p_tag text, p_lg int, p_user int, p_trade uuid, p_op text, p_drops text[], p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r99 select p_tag, public.trade_respond_internal(pg_temp.lg(p_lg), p_trade, p_op, p_drops, null, null, pg_temp.act(p_act), p_at, null);
  return (select r from r99 where tag = p_tag);
end $$;
create function pg_temp.tid(p_tag text) returns uuid language sql as $$ select (r #>> '{trade,id}')::uuid from r99 where tag = p_tag $$;
create function pg_temp.st(p_tag text) returns text language sql as $$ select t.status || '|' || coalesce(t.status_reason, '-') from trades t where t.id = pg_temp.tid(p_tag) $$;
create function pg_temp.roster(p_team text) returns text language sql as $$
  select coalesce(string_agg(r.player_id, ',' order by r.player_id), '') from league_rosters r where r.team_id = pg_temp.team(p_team) $$;
create function pg_temp.faab(p_team text) returns int language sql as $$ select faab_balance from league_members where team_id = pg_temp.team(p_team) $$;

-- A3, re-cut now that the helpers exist: each replaced function keeps ONE overload.
select is(
  (select string_agg(format('%s:%s', x.proname, x.n), ' ' order by x.proname)
   from (select p.proname, count(*) as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('trade_view_internal', 'trade_check_internal', 'trade_propose_internal',
                                                       'trade_respond_internal', 'trade_propose', 'trade_respond')
         group by p.proname) x),
  'trade_check_internal:1 trade_propose:1 trade_propose_internal:1 trade_respond:1 trade_respond_internal:1 trade_view_internal:1',
  'A3b the four replaced functions and the two doors each have exactly ONE overload');

-- ---------------------------------------------------------------------------
-- C. trade_review = none (L1): accept EXECUTES at once; the defer (Q75)
-- ---------------------------------------------------------------------------
-- T1: TX Alpha gives A Two + $10; TX Bravo gives B Two. Accepted Wed 10-21 12:00Z (week 7, nothing kicked off).
select pg_temp.prop('T1', 1, 2, 'TX Alpha', 'TX Bravo',
  jsonb_build_array(pg_temp.leg('x-a2', 'TX Alpha'), pg_temp.cash(10, 'TX Alpha'), pg_temp.leg('x-b2', 'TX Bravo')), null, '2026-10-21 11:00:00+00', 1);
select pg_temp.resp('C1', 1, 3, pg_temp.tid('T1'), 'accept', null, '2026-10-21 12:00:00+00', 2);
select set_config('request.jwt.claims', '', true);

select is(
  (select format('%s|%s|%s|%s', r #>> '{execution,outcome}', r #>> '{trade,status}', r ->> 'settled_by', r #>> '{review,mode}') from r99 where tag = 'C1'),
  'complete|complete|the trade went through (trade_review none — §13.3)|none',
  'C1 review NONE: the accept executes the trade in the same call — outcome complete, said so');
select is(
  format('%s / %s', pg_temp.roster('TX Alpha'), pg_temp.roster('TX Bravo')),
  'x-a1,x-a3,x-b2 / x-a2,x-b1,x-b3',
  'C2 the swap: A Two is TX Bravo''s, B Two is TX Alpha''s');
select is(
  (select string_agg(format('%s:%s:%s:%s', r.player_id, r.acquisition_type, r.slot_key, r.acquired_at = '2026-10-21 12:00:00+00'), ' ' order by r.player_id)
   from league_rosters r where r.player_id in ('x-a2', 'x-b2')),
  'x-a2:trade:bn:true x-b2:trade:bn:true',
  'C3 each moved row: acquisition trade, on the bench (TD10), acquired at the execution instant');
select is(format('%s|%s', pg_temp.faab('TX Alpha'), pg_temp.faab('TX Bravo')), '40|110', 'C4 the FAAB leg moved: TX Alpha 50 → 40, TX Bravo 100 → 110');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s', x.status, x.initiator_team_id = pg_temp.team('TX Alpha'), x.initiated_by, x.week,
                 x.payload ? 'add_player_id', x.payload #>> '{faab,0,from_before}' || '>' || (x.payload #>> '{faab,0,from_after}'),
                 x.payload #>> '{faab,0,to_before}' || '>' || (x.payload #>> '{faab,0,to_after}'))
   from transactions x where x.league_id = pg_temp.lg(1) and x.type = 'trade'),
  'complete|true|99900000-0000-4000-8000-000000000002|7|false|50>40|100>110',
  'C5 ONE transactions row: type trade, complete, initiated by the proposer, week 7, NO add_player_id (TD9 — no acquisition cap), FAAB before/after for both');
select is(
  (select format('%s|%s|%s', tl.slot_map::text, (tl.starters -> 0 ->> 'player_id') is null and (tl.starters -> 0 -> 'flags') = '["empty"]', tl.bench::text)
   from team_lineups tl where tl.team_id = pg_temp.team('TX Alpha') and tl.week = 7),
  '{}|true|["x-a1", "x-a3", "x-b2"]',
  'C6 TD10 (current week, not finished): A Two leaves TX Alpha''s week-7 slot (it reads empty); B Two lands on the bench');
select is(
  (select format('%s / %s', (select slot_map::text from team_lineups where team_id = pg_temp.team('TX Alpha') and week = 6),
                 (select slot_map::text || ' ' || bench::text from team_lineups where team_id = pg_temp.team('TX Bravo') and week = 7))),
  '{"qb:0": "x-a2"} / {"qb:0": "x-b1"} ["x-a2", "x-b3"]',
  'C7 an EARLIER week is untouched; TX Bravo''s week 7: B Two off the bench, A Two on it');
select is(
  (select string_agg(pp.player_id || ':' || pp.state, ' ' order by pp.player_id) from league_player_pool pp
   where pp.league_id = pg_temp.lg(1) and pp.player_id in ('x-a2', 'x-b2')),
  'x-a2:rostered x-b2:rostered',
  'C8 the pool mirror says rostered for both (D294)');
select is(
  (select count(*)::int from league_chat where league_id = pg_temp.lg(1) and is_system and user_id is null
     and message = 'Trade completed: TX Alpha gives TX A Two, $10 FAAB; TX Bravo gives TX B Two'),
  1,
  'C9 the non-disableable system post (§10.3 / TD16)');
select is(
  (select string_agg(n.user_id::text, ',' order by n.user_id) from notifications n
   where n.type = 'league_trade_executed' and (n.data ->> 'trade_id')::uuid = pg_temp.tid('T1')),
  '99900000-0000-4000-8000-000000000002,99900000-0000-4000-8000-000000000003',
  'C10 BOTH managers are told it went through');
select pg_temp.resp('C11', 1, 3, pg_temp.tid('T1'), 'accept', null, '2026-10-21 12:05:00+00', 2);
select set_config('request.jwt.claims', '', true);
select is(
  (select (select r from r99 where tag = 'C11')::text = (select r from r99 where tag = 'C1')::text
          and (select count(*) from transactions where league_id = pg_temp.lg(1) and type = 'trade') = 1),
  true,
  'C11 REPLAY of the accept is byte-identical and executes NOTHING twice (one transactions row)');

-- T2 — THE DEFER (Q75 / E35): TX Alpha's A One (TXA) kicked off Thu 00:15Z.
-- A One starts for TX Alpha in week 7; week 8 rows exist for both teams.
update team_lineups set slot_map = '{"qb:0": "x-a1"}', starters = '[{"slot": "qb:0", "player_id": "x-a1"}]', bench = '["x-a3", "x-b2"]'
where team_id = pg_temp.team('TX Alpha') and week = 7;
insert into team_lineups (team_id, season, week, slot_map, starters, bench) values
 (pg_temp.team('TX Alpha'), 2026, 8, '{"qb:0": "x-a1"}', '[{"slot": "qb:0", "player_id": "x-a1"}]', '["x-a3", "x-b2"]'),
 (pg_temp.team('TX Bravo'), 2026, 8, '{"qb:0": "x-b1"}', '[{"slot": "qb:0", "player_id": "x-b1"}]', '["x-a2", "x-b3"]');
select pg_temp.prop('T2', 1, 2, 'TX Alpha', 'TX Bravo',
  jsonb_build_array(pg_temp.leg('x-a1', 'TX Alpha'), pg_temp.leg('x-b3', 'TX Bravo')), null, '2026-10-23 11:00:00+00', 3);
select pg_temp.resp('C12a', 1, 3, pg_temp.tid('T2'), 'accept', null, '2026-10-23 12:00:00+00', 4);
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s|%s|%s', r #>> '{execution,outcome}', (r #>> '{execution,execute_after}')::timestamptz = '2026-10-27 03:30:00+00',
                 r #>> '{execution,lock,locked_players,0,player_id}', r ->> 'settled_by') from r99 where tag = 'C12a'),
  'deferred|true|x-a1|accepted; a player in it already played this week, so the whole trade goes through right after the week''s last game ends (Q75 / E35)',
  'C12 E35 DEFER: accepted while A One is locked — the whole trade waits until the week''s last game ends (Tue 03:30Z), said so');
select is(
  (select format('%s|%s', t.status, t.execute_after = '2026-10-27 03:30:00+00') from trades t where t.id = pg_temp.tid('T2'))
    || ' ' || pg_temp.roster('TX Alpha') || ' / ' || pg_temp.roster('TX Bravo'),
  'accepted|true x-a1,x-a3,x-b2 / x-a2,x-b1,x-b3',
  'C12b …parked accepted with execute_after = the release; NOTHING moved (the players stay with their teams)');
select is(
  (select count(*)::int from notifications where type = 'league_trade_deferred' and (data ->> 'trade_id')::uuid = pg_temp.tid('T2')),
  2,
  'C12c both managers are told it waits');
insert into r99 select 'C13a', public.trade_tick('2026-10-27 03:29:59+00', pg_temp.lg(1));
select is(
  (select format('%s|%s|%s', r ->> 'executed', r ->> 'reason', (select status from trades where id = pg_temp.tid('T2'))) from r99 where tag = 'C13a'),
  '0|nothing_due|accepted',
  'C13 RELEASE − 1 s: the tick runs nothing and says why (nothing_due)');
insert into r99 select 'C14a', public.trade_tick('2026-10-27 03:30:00+00', pg_temp.lg(1));
select is(
  (select format('%s|%s|%s', r ->> 'executed', r #>> '{actions,0,via}', (select status from trades where id = pg_temp.tid('T2'))) from r99 where tag = 'C14a')
    || ' ' || pg_temp.roster('TX Alpha') || ' / ' || pg_temp.roster('TX Bravo'),
  '1|deferred_release|complete x-a3,x-b2,x-b3 / x-a1,x-a2,x-b1',
  'C14 AT the release: the tick executes the whole trade (all players together)');
select is(
  (select format('%s / %s / %s / %s',
     (select slot_map::text || ' ' || bench::text from team_lineups where team_id = pg_temp.team('TX Alpha') and week = 7),
     (select slot_map::text || ' ' || bench::text from team_lineups where team_id = pg_temp.team('TX Alpha') and week = 8),
     (select bench::text from team_lineups where team_id = pg_temp.team('TX Bravo') and week = 8),
     (select payload ->> 'lineup_from_week' from transactions where type = 'trade' and payload ->> 'trade_id' = pg_temp.tid('T2')::text))),
  '{"qb:0": "x-a1"} ["x-a3", "x-b2"] / {} ["x-a3", "x-b2", "x-b3"] / ["x-a1", "x-a2"] / 8',
  'C15 THE WEEK NOTE: week 7 is finished, so A One KEEPS his week-7 start for TX Alpha (his points stay); the move starts at week 8');
select is(
  (select count(*)::int from notifications where type = 'league_trade_deferred' and (data ->> 'trade_id')::uuid = pg_temp.tid('T2')),
  2,
  'C16 no repeat "it waits" notification');

-- ---------------------------------------------------------------------------
-- D. trade_review = commissioner (L2): in review; auto-approve AT the
--    deadline; `reject` fails a locked trade by name; the trade deadline
--    does not stop an accepted trade.
-- ---------------------------------------------------------------------------
select pg_temp.prop('T6', 2, 2, 'TX Papa', 'TX Quebec',
  jsonb_build_array(pg_temp.leg('x-p1', 'TX Papa'), pg_temp.leg('x-q1', 'TX Quebec')), null, '2026-10-21 11:00:00+00', 10);
select pg_temp.resp('D1', 2, 3, pg_temp.tid('T6'), 'accept', null, '2026-10-21 12:00:00+00', 11);
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s|%s|%s|%s', r #>> '{trade,status}', r #>> '{review,mode}', r #>> '{review,period_hours}',
                 (r #>> '{review,review_deadline}')::timestamptz = '2026-10-22 12:00:00+00', coalesce(r ->> 'execution', 'null'))
   from r99 where tag = 'D1'),
  'in_review|commissioner|24|true|null',
  'D1 review COMMISSIONER: the accept puts the trade in review until accepted_at + 24 h; nothing executes');
select is(
  (select r ->> 'settled_by' from r99 where tag = 'D1'),
  'in review (commissioner) until review_deadline, when it goes through unless it is vetoed first (§13.3); nothing moves until then, and it goes invalid if a player in it leaves his roster first (E37)',
  'D1b …and says what happens next');
insert into r99 select 'D2', public.trade_tick('2026-10-22 11:59:59+00', pg_temp.lg(2));
select is(
  (select format('%s|%s', r ->> 'executed', (select status from trades where id = pg_temp.tid('T6'))) from r99 where tag = 'D2'),
  '0|in_review',
  'D2 REVIEW DEADLINE − 1 s: still in review');
insert into r99 select 'D3', public.trade_tick('2026-10-22 12:00:00+00', pg_temp.lg(2));
select is(
  (select format('%s|%s|%s|%s', r ->> 'executed', r #>> '{actions,0,via}', t.status, t.resolved_by is null) from r99, trades t
   where tag = 'D3' and t.id = pg_temp.tid('T6'))
    || ' ' || pg_temp.roster('TX Papa') || ' / ' || pg_temp.roster('TX Quebec'),
  '1|review_elapsed|complete|true x-p2,x-p3,x-q1 / x-p1,x-q2,x-q3',
  'D3 AT the review deadline the tick auto-approves and executes (§13.3 "elapses → auto-approve"); resolved by the system');
-- T7: P Two (TXA) — the review ends while he is locked; L2 rejects (trade_lock_behavior = reject).
select pg_temp.prop('T7', 2, 2, 'TX Papa', 'TX Quebec',
  jsonb_build_array(pg_temp.leg('x-p2', 'TX Papa'), pg_temp.leg('x-q2', 'TX Quebec')), null, '2026-10-22 12:30:00+00', 12);
select pg_temp.resp('D4a', 2, 3, pg_temp.tid('T7'), 'accept', null, '2026-10-22 13:00:00+00', 13);
select set_config('request.jwt.claims', '', true);
insert into r99 select 'D4', public.trade_tick('2026-10-23 13:00:00+00', pg_temp.lg(2));
select is(
  (select format('%s|%s', r ->> 'failed_at_execution', pg_temp.st('T7')) from r99 where tag = 'D4'),
  '1|invalid|the trade could not go through: TX P Two already kicked off this week and cannot change teams until the week''s last game ends — this league fails such a trade instead of waiting (trade_lock_behavior = reject, E35)',
  'D4 E35 REJECT: a locked trade fails BY NAME, naming the player and the setting');
select is(
  format('%s / %s', pg_temp.roster('TX Papa'), pg_temp.roster('TX Quebec'))
    || ' ' || (select string_agg(n.user_id::text, ',' order by n.user_id) from notifications n
               where n.type = 'league_trade_invalid' and (n.data ->> 'trade_id')::uuid = pg_temp.tid('T7')),
  'x-p2,x-p3,x-q1 / x-p1,x-q2,x-q3 99900000-0000-4000-8000-000000000002,99900000-0000-4000-8000-000000000003',
  'D5 …nothing moved, and both managers are told');
-- T8: accepted BEFORE L2's week-7 deadline, its review ends AFTER it — it still goes through (Q76).
select pg_temp.prop('T8', 2, 2, 'TX Papa', 'TX Quebec',
  jsonb_build_array(pg_temp.leg('x-p3', 'TX Papa'), pg_temp.leg('x-q3', 'TX Quebec')), null, '2026-10-27 11:00:00+00', 14);
select pg_temp.resp('D6a', 2, 3, pg_temp.tid('T8'), 'accept', null, '2026-10-27 12:00:00+00', 15);
select set_config('request.jwt.claims', '', true);
insert into r99 select 'D6', public.trade_tick('2026-10-28 04:00:00+00', pg_temp.lg(2));
select is(
  (select format('%s|%s', r ->> 'expired', (select status from trades where id = pg_temp.tid('T8'))) from r99 where tag = 'D6'),
  '0|in_review',
  'D6 Q76: AT the deadline an accepted (in-review) trade is NOT expired');
insert into r99 select 'D7', public.trade_tick('2026-10-28 12:00:00+00', pg_temp.lg(2));
select is(
  (select format('%s|%s', r ->> 'executed', (select status from trades where id = pg_temp.tid('T8'))) from r99 where tag = 'D7'),
  '1|complete',
  'D7 …and it goes through when its review ends, after the deadline');

-- ---------------------------------------------------------------------------
-- E. E8 — a trade and a drop on the same player (L1, after T2; before the
--    deadline). Sequential here; concurrent in trade-execution-db.test.ts.
-- ---------------------------------------------------------------------------
-- E8(a): the DROP lands first — the offer naming him is dead (E37), the accept refused by name.
select pg_temp.prop('T9', 1, 2, 'TX Alpha', 'TX Bravo',
  jsonb_build_array(pg_temp.leg('x-a3', 'TX Alpha'), pg_temp.leg('x-a2', 'TX Bravo')), null, '2026-10-27 09:00:00+00', 20);
select pg_temp.as_user(2);
select lives_ok(
  $$ select public.roster_add_drop_internal(pg_temp.lg(1), pg_temp.team('TX Alpha'), null, 'x-a3', pg_temp.act(21), '2026-10-27 10:00:00+00') $$,
  'E1 PREMISE: TX Alpha drops A Three through the real add/drop verb');
select pg_temp.as_user(3);
select throws_ok(
  format($$ select public.trade_respond_internal('%s', '%s', 'accept', null, null, null, '%s', '2026-10-27 10:01:00+00', null) $$,
         pg_temp.lg(1), pg_temp.tid('T9'), pg_temp.act(22)),
  'P0001',
  'trade_respond: this trade is already invalid (TX A Three (x-a3) is no longer on TX Alpha''s roster — he was dropped (E37)) — only a proposed trade can be accepted',
  'E2 E8 (drop first): the trade can no longer be accepted — refused by name with the E37 reason');
-- E8(b): the TRADE lands first — the old owner can no longer drop him.
select pg_temp.prop('T10', 1, 2, 'TX Alpha', 'TX Bravo',
  jsonb_build_array(pg_temp.leg('x-b2', 'TX Alpha'), pg_temp.leg('x-a1', 'TX Bravo')), null, '2026-10-27 10:05:00+00', 23);
select pg_temp.resp('E3', 1, 3, pg_temp.tid('T10'), 'accept', null, '2026-10-27 10:10:00+00', 24);
select pg_temp.as_user(2);
select throws_ok(
  format($$ select public.roster_add_drop_internal('%s', '%s', null, 'x-b2', '%s', '2026-10-27 10:11:00+00') $$,
         pg_temp.lg(1), pg_temp.team('TX Alpha'), pg_temp.act(25)),
  'P0001',
  'roster_add_drop: TX B Two (x-b2) is on TX Bravo''s roster, not TX Alpha''s — a manager drops only his own players (§13.1)',
  'E3 E8 (trade first): the trade executed; TX Alpha''s drop of the player it traded away is refused by name');
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s|%s', (select r #>> '{execution,outcome}' from r99 where tag = 'E3'),
     (select count(*) from league_rosters where league_id = pg_temp.lg(1) and player_id = 'x-a3'),
     (select string_agg(team_id::text, ',') from league_rosters where league_id = pg_temp.lg(1) and player_id = 'x-b2') = pg_temp.team('TX Bravo')::text)),
  'complete|0|true',
  'E4 EXCLUSIVITY either way: the dropped player is on no roster; the traded one on exactly one — his new team''s');

-- ---------------------------------------------------------------------------
-- G. THE DEADLINE (Q76; L1: trade_deadline_week 7 ⇒ week 8 begins Wed
--    2026-10-28 04:00Z = 00:00 New York).
-- ---------------------------------------------------------------------------
select pg_temp.prop('T3', 1, 4, 'TX Delta', 'TX Bravo',
  jsonb_build_array(pg_temp.leg('x-d1', 'TX Delta'), pg_temp.leg('x-b1', 'TX Bravo')), null, '2026-10-28 03:59:59+00', 30);
select is(pg_temp.st('T3'), 'proposed|-', 'G1 DEADLINE − 1 s: an offer can still be made');
select pg_temp.as_user(4);
select throws_ok(
  format($$ select public.trade_propose_internal('%s', '%s', '%s', '%s', null, null, '%s', '2026-10-28 04:00:00+00', null) $$,
         pg_temp.lg(1), pg_temp.team('TX Delta'), pg_temp.team('TX Bravo'),
         jsonb_build_array(pg_temp.leg('x-d2', 'TX Delta'), pg_temp.leg('x-b1', 'TX Bravo')), pg_temp.act(31)),
  'P0001',
  'trade_propose: the trade deadline has passed — trades could be proposed until week 8 began (Wed 2026-10-28 00:00 America/New_York; trade_deadline_week 7, §13.3 / Q76)',
  'G2 AT the deadline a new offer is refused BY NAME, naming the instant in the league''s zone');
select set_config('request.jwt.claims', '', true);
select pg_temp.prop('T4', 1, 4, 'TX Delta', 'TX Alpha',
  jsonb_build_array(pg_temp.leg('x-d2', 'TX Delta'), pg_temp.leg('x-b3', 'TX Alpha')), null, '2026-10-28 03:00:01+00', 32);
select pg_temp.prop('T5', 1, 1, 'TX Commish', 'TX Bravo',
  jsonb_build_array(pg_temp.leg('x-c1', 'TX Commish'), pg_temp.leg('x-a2', 'TX Bravo')), null, '2026-10-28 03:00:02+00', 33);
select pg_temp.resp('G3', 1, 3, pg_temp.tid('T3'), 'accept', null, '2026-10-28 03:59:59+00', 34);
select set_config('request.jwt.claims', '', true);
select is(
  (select r #>> '{execution,outcome}' from r99 where tag = 'G3') || ' ' || pg_temp.roster('TX Delta'),
  'complete x-b1,x-d2',
  'G3 DEADLINE − 1 s: an offer can still be accepted (and goes through)');
select pg_temp.as_user(2);
select throws_ok(
  format($$ select public.trade_respond_internal('%s', '%s', 'accept', null, null, null, '%s', '2026-10-28 04:00:00+00', null) $$,
         pg_temp.lg(1), pg_temp.tid('T4'), pg_temp.act(35)),
  'P0001',
  'trade_respond: the trade deadline has passed — trades could be accepted until week 8 began (Wed 2026-10-28 00:00 America/New_York; trade_deadline_week 7, §13.3 / Q76); this offer can no longer be accepted',
  'G4 AT the deadline an offer can no longer be accepted — refused by name');
select throws_ok(
  format($$ select public.trade_respond_internal('%s', '%s', 'counter', null, '%s', null, '%s', '2026-10-28 04:00:00+00', null) $$,
         pg_temp.lg(1), pg_temp.tid('T4'),
         jsonb_build_array(pg_temp.leg('x-b3', 'TX Alpha'), pg_temp.leg('x-d2', 'TX Delta')), pg_temp.act(36)),
  'P0001',
  'trade_respond: the trade deadline has passed — trades could be accepted until week 8 began (Wed 2026-10-28 00:00 America/New_York; trade_deadline_week 7, §13.3 / Q76); this offer can no longer be countered',
  'G5 …nor countered (a counter is a new offer)');
select set_config('request.jwt.claims', '', true);
insert into r99 select 'G6', public.trade_tick('2026-10-28 03:59:59+00', pg_temp.lg(1));
select is(
  (select format('%s|%s|%s', r ->> 'expired', (select status from trades where id = pg_temp.tid('T4')), (select status from trades where id = pg_temp.tid('T5'))) from r99 where tag = 'G6'),
  '0|proposed|proposed',
  'G6 the tick at DEADLINE − 1 s expires nothing');
insert into r99 select 'G7', public.trade_tick('2026-10-28 04:00:00+00', pg_temp.lg(1));
select is(
  (select format('%s|%s', r ->> 'expired', pg_temp.st('T4')) from r99 where tag = 'G7'),
  '2|expired|the trade deadline passed — offers could be accepted until week 8 began (Wed 2026-10-28 00:00 America/New_York; trade_deadline_week 7, §13.3 / Q76)',
  'G7 AT the deadline the tick EXPIRES every offer still pending, with the reason (F413 (f))');
select is(
  (select format('%s|%s', t.status, t.resolved_at = '2026-10-28 04:00:00+00') from trades t where t.id = pg_temp.tid('T5'))
    || ' ' || (select count(*)::int from notifications where type = 'league_trade_expired'
               and (data ->> 'trade_id')::uuid in (pg_temp.tid('T4'), pg_temp.tid('T5'))),
  'expired|true 4',
  'G8 …both pending offers, resolved at the deadline instant; both managers of each told (4 notifications)');

-- ---------------------------------------------------------------------------
-- F. The executor's checklist (F413) in a commissioner-review league (L4):
--    trades accepted against TODAY's rosters, executed later.
-- ---------------------------------------------------------------------------
-- F413 (c) FAAB: X1 costs TX Romeo $20, X2 $15 — each ≤ $30, together > $30.
-- F413 (c) ROSTER: X3 and X4 each bring TX Uniform to 3 of 3 — together 4.
select pg_temp.prop('X1', 4, 2, 'TX Romeo', 'TX Sierra', jsonb_build_array(pg_temp.cash(20, 'TX Romeo'), pg_temp.leg('x-s1', 'TX Sierra')), null, '2026-10-21 13:00:00+00', 40);
select pg_temp.prop('X2', 4, 2, 'TX Romeo', 'TX Sierra', jsonb_build_array(pg_temp.cash(15, 'TX Romeo'), pg_temp.leg('x-s2', 'TX Sierra')), null, '2026-10-21 13:00:01+00', 41);
select pg_temp.prop('X3', 4, 5, 'TX Uniform', 'TX Tango', jsonb_build_array(pg_temp.cash(1, 'TX Uniform'), pg_temp.leg('x-t1', 'TX Tango')), null, '2026-10-21 13:00:02+00', 42);
select pg_temp.prop('X4', 4, 5, 'TX Uniform', 'TX Tango', jsonb_build_array(pg_temp.cash(2, 'TX Uniform'), pg_temp.leg('x-t2', 'TX Tango')), null, '2026-10-21 13:00:03+00', 43);
select pg_temp.resp('X1a', 4, 3, pg_temp.tid('X1'), 'accept', null, '2026-10-21 14:00:00+00', 44);
select pg_temp.resp('X2a', 4, 3, pg_temp.tid('X2'), 'accept', null, '2026-10-21 14:00:01+00', 45);
select pg_temp.resp('X3a', 4, 4, pg_temp.tid('X3'), 'accept', null, '2026-10-21 14:00:02+00', 46);
select pg_temp.resp('X4a', 4, 4, pg_temp.tid('X4'), 'accept', null, '2026-10-21 14:00:03+00', 47);
select set_config('request.jwt.claims', '', true);
insert into r99 select 'F1', public.trade_tick('2026-10-22 14:00:03+00', pg_temp.lg(4));
select is(
  (select format('%s|%s|%s', r ->> 'executed', r ->> 'failed_at_execution', r ->> 'invalidated') from r99 where tag = 'F1'),
  '2|2|0',
  'F1 one tick: two trades execute, two fail AT EXECUTION (both passed every check when accepted)');
select is(
  pg_temp.st('X2') || ' $' || pg_temp.faab('TX Romeo'),
  'invalid|the trade could not go through: TX Romeo cannot give $15 of FAAB — its balance is $10 (§13.3) $10',
  'F2 F413 (c): the second FAAB leg is re-checked against the balance the first one left — refused, never overdrawn');
select is(
  pg_temp.st('X4') || ' ' || pg_temp.roster('TX Uniform'),
  'invalid|the trade could not go through: TX Uniform''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size): it has added players since the trade was agreed, so the trade cannot go through as agreed (E36) x-t1,x-u1,x-u2',
  'F3 F413 (c): the second trade would overflow the roster the first one filled — refused with words that fit execution (F414)');
select is(
  format('%s|%s|%s|%s', pg_temp.faab('TX Sierra'), pg_temp.faab('TX Uniform'), pg_temp.faab('TX Tango'),
         (select count(*) from league_members where league_id = pg_temp.lg(4) and faab_balance < 0)),
  '120|99|101|0',
  'F4 balances: every move accounted for, none negative');
-- F413 (a) + (b): the same player in two accepted trades — X5 executes, X6 dies through E37.
select pg_temp.prop('X5', 4, 3, 'TX Sierra', 'TX Tango', jsonb_build_array(pg_temp.leg('x-s3', 'TX Sierra'), pg_temp.leg('x-t2', 'TX Tango')), null, '2026-10-22 15:00:00+00', 48);
select pg_temp.prop('X6', 4, 3, 'TX Sierra', 'TX Uniform', jsonb_build_array(pg_temp.leg('x-s3', 'TX Sierra'), pg_temp.leg('x-u1', 'TX Uniform')), null, '2026-10-22 15:00:01+00', 49);
select pg_temp.resp('X5a', 4, 4, pg_temp.tid('X5'), 'accept', null, '2026-10-22 15:10:00+00', 50);
select pg_temp.resp('X6a', 4, 5, pg_temp.tid('X6'), 'accept', null, '2026-10-22 15:11:00+00', 51);
select set_config('request.jwt.claims', '', true);
insert into r99 select 'F5', public.trade_tick('2026-10-23 15:11:00+00', pg_temp.lg(4));
select is(
  pg_temp.st('X5') || ' ' || pg_temp.st('X6') || ' ' || (select r #>> '{actions,1,action}' from r99 where tag = 'F5'),
  'complete|- invalid|TX S Three (x-s3) is no longer on TX Sierra''s roster — he moved to TX Tango (E37) not_in_flight',
  'F5 F413 (a)/(b): the executed trade is exempt from its own E37 moves and ends COMPLETE; the other accepted trade naming S Three goes INVALID in the same transaction, and the executor re-reads it and moves nothing');
select is(
  current_setting('app.executing_trade_id', true) || '|' || (select count(*) from league_rosters where league_id = pg_temp.lg(4) and player_id = 'x-s3')::text
    || '|' || pg_temp.roster('TX Tango'),
  '|1|x-s3',
  'F6 the exemption is cleared after the execution; S Three is on exactly one roster');
-- E37 AT EXECUTE, the executor's own re-validation: the trigger is switched
-- off so only the executor stands between a vanished player and the swap.
select pg_temp.prop('X8', 4, 8, 'TX Whiskey', 'TX4 Commish', jsonb_build_array(pg_temp.leg('x-w3', 'TX Whiskey'), pg_temp.leg('x-c4a', 'TX4 Commish')), null, '2026-10-24 17:00:00+00', 52);
select pg_temp.resp('X8a', 4, 1, pg_temp.tid('X8'), 'accept', null, '2026-10-24 17:10:00+00', 53);
select set_config('request.jwt.claims', '', true);
alter table league_rosters disable trigger trg_trade_invalidate_on_roster_delete;
delete from league_rosters where league_id = pg_temp.lg(4) and player_id = 'x-w3';
alter table league_rosters enable always trigger trg_trade_invalidate_on_roster_delete;
insert into r99 select 'F7', public.trade_tick('2026-10-25 17:10:00+00', pg_temp.lg(4));
select is(
  pg_temp.st('X8') || ' ' || pg_temp.roster('TX4 Commish'),
  'invalid|the trade could not go through: TX W Three (x-w3) is not on any roster in this league — only a rostered player can be traded (§13.3) x-c4a,x-c4b',
  'F7 E37 AT EXECUTE: a player gone from the roster is caught by the executor''s re-validation — invalid WITH the reason, nothing moved, never a silent failure');
select is(
  (select string_agg(n.user_id::text, ',' order by n.user_id) from notifications n
   where n.type = 'league_trade_invalid' and (n.data ->> 'trade_id')::uuid = pg_temp.tid('X8')),
  '99900000-0000-4000-8000-000000000001,99900000-0000-4000-8000-000000000008',
  'F8 …and both managers are told');
-- E36 AT EXECUTION: TX Victor takes two for one and drops V Two as part of the trade.
select pg_temp.prop('X7', 4, 8, 'TX Whiskey', 'TX Victor',
  jsonb_build_array(pg_temp.leg('x-w1', 'TX Whiskey'), pg_temp.leg('x-w2', 'TX Whiskey'), pg_temp.leg('x-v1', 'TX Victor')), null, '2026-10-26 09:00:00+00', 54);
select pg_temp.as_user(7);
select throws_ok(
  format($$ select public.trade_respond_internal('%s', '%s', 'accept', null, null, null, '%s', '2026-10-26 09:05:00+00', null) $$,
         pg_temp.lg(4), pg_temp.tid('X7'), pg_temp.act(55)),
  'P0001',
  'trade_respond: TX Victor''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)',
  'F9 E36: the receiving team''s own overflow keeps its words — name a drop');
select pg_temp.resp('X7a', 4, 7, pg_temp.tid('X7'), 'accept', array['x-v2'], '2026-10-26 09:10:00+00', 56);
select set_config('request.jwt.claims', '', true);
insert into r99 select 'F10', public.trade_tick('2026-10-27 09:10:00+00', pg_temp.lg(4));
select is(
  pg_temp.st('X7') || ' ' || pg_temp.roster('TX Victor') || ' / ' || pg_temp.roster('TX Whiskey'),
  'complete|- x-v3,x-w1,x-w2 / x-v1',
  'F10 E36: the 2-for-1 executes WITH its drop in the same transaction — TX Victor ends at 3 of 3');
select is(
  (select format('%s|%s', pp.state, pp.waivers_until = '2026-10-28 07:00:00+00') from league_player_pool pp
   where pp.league_id = pg_temp.lg(4) and pp.player_id = 'x-v2')
    || ' ' || (select x.payload #>> '{drops,0,to_state}' from transactions x where x.type = 'trade' and x.payload ->> 'trade_id' = pg_temp.tid('X7')::text),
  'on_waivers|true on_waivers',
  'F11 TD13: the dropped player goes on waivers until the next scheduled run (Wed 03:00 New York = 07:00Z), exactly as an add/drop drop');
-- F413 (e): a RETIRED party at execution (the executor called directly).
select pg_temp.prop('X9', 4, 1, 'TX4 Commish', 'TX Sierra', jsonb_build_array(pg_temp.leg('x-c4b', 'TX4 Commish'), pg_temp.cash(5, 'TX Sierra')), null, '2026-10-27 10:00:00+00', 57);
select pg_temp.resp('X9a', 4, 3, pg_temp.tid('X9'), 'accept', null, '2026-10-27 10:10:00+00', 58);
select set_config('request.jwt.claims', '', true);
update teams set status = 'retired' where id = pg_temp.team('TX Sierra');
insert into r99 select 'F12', public.trade_execute_internal(pg_temp.tid('X9'), '2026-10-27 12:00:00+00', 'pgtap');
update teams set status = 'active' where id = pg_temp.team('TX Sierra');
select is(
  (select r ->> 'outcome' from r99 where tag = 'F12') || ' ' || pg_temp.st('X9'),
  'invalid invalid|the trade could not go through: TX Sierra is retired — a sealed franchise makes no trades (§7.2.1)',
  'F12 F413 (e): a party that retired before execution — the trade is invalid by name (its FAAB-only side has no player for E37 to see)');
select is(
  (select r ->> 'outcome' from (select public.trade_execute_internal(pg_temp.tid('X9'), '2026-10-27 12:01:00+00', 'pgtap') as r) q),
  'not_in_flight',
  'F13 F413 (b): executing a trade that is no longer in flight moves nothing and says so');
-- F414: the PROPOSER grows after proposing — the receiving manager is told whose problem it is.
select pg_temp.prop('X10', 4, 4, 'TX Tango', 'TX Victor',
  jsonb_build_array(pg_temp.leg('x-s3', 'TX Tango'), pg_temp.leg('x-w1', 'TX Victor'), pg_temp.leg('x-w2', 'TX Victor')), null, '2026-10-27 13:00:00+00', 59);
insert into league_rosters (league_id, team_id, player_id, slot_key) values
 (pg_temp.lg(4), pg_temp.team('TX Tango'), 'x-t3', 'bn'), (pg_temp.lg(4), pg_temp.team('TX Tango'), 'x-t4', 'bn');
select pg_temp.as_user(7);
select throws_ok(
  format($$ select public.trade_respond_internal('%s', '%s', 'accept', null, null, null, '%s', '2026-10-27 13:10:00+00', null) $$,
         pg_temp.lg(4), pg_temp.tid('X10'), pg_temp.act(60)),
  'P0001',
  'trade_respond: TX Tango''s roster no longer fits this offer — it would hold 4 players after the trade, 1 more than its 3 spots (§7.3.2 roster_size), because it has added players since proposing; only TX Tango can fix that, so ask them to cancel and re-propose with drops (E36)',
  'F14 F414: the proposer''s own roster growth is refused in words that name the proposer as the one to fix it');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- H. The release not yet recorded (L3): `infinity`, re-read every minute.
-- ---------------------------------------------------------------------------
select pg_temp.prop('T11', 3, 2, 'TX Golf', 'TX Hotel', jsonb_build_array(pg_temp.leg('x-g1', 'TX Golf'), pg_temp.leg('x-h1', 'TX Hotel')), null, '2026-10-30 11:00:00+00', 70);
select pg_temp.resp('H1', 3, 3, pg_temp.tid('T11'), 'accept', null, '2026-10-30 12:00:00+00', 71);
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s', r #>> '{execution,outcome}', (select execute_after = 'infinity' from trades where id = pg_temp.tid('T11'))) from r99 where tag = 'H1'),
  'deferred|true',
  'H1 G One kicked off and week 8''s last game is NOT recorded: deferred with execute_after = infinity (never read as free)');
insert into r99 select 'H2', public.trade_tick('2026-10-30 12:01:00+00', pg_temp.lg(3));
select is(
  (select format('%s|%s', r ->> 'deferred', (select count(*) from notifications where type = 'league_trade_deferred' and (data ->> 'trade_id')::uuid = pg_temp.tid('T11'))) from r99 where tag = 'H2'),
  '1|2',
  'H2 the tick re-reads it each minute, still locked, and re-parks it without telling anyone twice');
update nfl_weeks set last_game_ends_at = '2026-11-03 04:00:00+00' where season = 2026 and week = 8;
insert into r99 select 'H3', public.trade_tick('2026-11-03 03:59:59+00', pg_temp.lg(3));
select is(
  (select format('%s|%s', r ->> 'deferred', (select execute_after = '2026-11-03 04:00:00+00' from trades where id = pg_temp.tid('T11'))) from r99 where tag = 'H3'),
  '1|true',
  'H3 once ingestion records the week''s end, the next tick parks it at that instant');
insert into r99 select 'H4', public.trade_tick('2026-11-03 04:00:00+00', pg_temp.lg(3));
select is(
  (select format('%s|%s', r ->> 'executed', (select status from trades where id = pg_temp.tid('T11'))) from r99 where tag = 'H4')
    || ' ' || pg_temp.roster('TX Golf') || ' / ' || pg_temp.roster('TX Hotel'),
  '1|complete x-h1 / x-g1',
  'H4 AT that instant it goes through');

-- ---------------------------------------------------------------------------
-- I. E47 — a manager leaving calls off his team's trades (L5); the sweep.
-- ---------------------------------------------------------------------------
select pg_temp.prop('Y1', 5, 2, 'TX5 Victor', 'TX5 Whiskey', jsonb_build_array(pg_temp.cash(5, 'TX5 Victor'), pg_temp.leg('x-w5a', 'TX5 Whiskey')), null, '2026-10-21 12:00:00+00', 80);
select pg_temp.prop('Y2', 5, 4, 'TX Yankee', 'TX5 Victor', jsonb_build_array(pg_temp.leg('x-y5a', 'TX Yankee'), pg_temp.leg('x-v5a', 'TX5 Victor')), null, '2026-10-21 12:01:00+00', 81);
select pg_temp.prop('Y3', 5, 5, 'TX Zulu', 'TX5 Whiskey', jsonb_build_array(pg_temp.cash(1, 'TX Zulu'), pg_temp.leg('x-w5a', 'TX5 Whiskey')), null, '2026-10-21 12:02:00+00', 82);
select pg_temp.prop('Y4', 5, 5, 'TX Zulu', 'TX5 Whiskey', jsonb_build_array(pg_temp.cash(80, 'TX Zulu'), pg_temp.leg('x-w5a', 'TX5 Whiskey')), null, '2026-10-21 12:03:00+00', 83);
select set_config('request.jwt.claims', '', true);
update team_managers set started_week = 3 where team_id = pg_temp.team('TX Zulu') and ended_at is null;
select is(pg_temp.st('Y3'), 'proposed|-', 'I1 a stint UPDATE that does not close it calls off nothing');
update team_managers set ended_at = now(), end_reason = 'kicked' where team_id = pg_temp.team('TX5 Victor') and ended_at is null;
select is(
  pg_temp.st('Y1') || ' // ' || pg_temp.st('Y2'),
  'invalid|TX5 Victor''s manager is no longer managing it (kicked) — a trade offered or agreed by the previous manager is called off (E47); the commissioner can re-propose it acting for the team // invalid|TX5 Victor''s manager is no longer managing it (kicked) — a trade offered or agreed by the previous manager is called off (E47); the commissioner can re-propose it acting for the team',
  'I2 E47: the stint closing calls off the team''s offer (a FAAB-only side — E37 could never see it, F413 (e)) AND the offer it received');
select is(
  pg_temp.st('Y3') || ' ' || (select count(*)::int from notifications where type = 'league_trade_invalid' and (data ->> 'trade_id')::uuid = pg_temp.tid('Y1')),
  'proposed|- 2',
  'I3 …other teams'' trades untouched; both parties'' managers told');
update league_members set faab_balance = 50 where team_id = pg_temp.team('TX Zulu');
insert into r99 select 'I4', public.trade_tick('2026-10-22 12:00:00+00', pg_temp.lg(5));
select is(
  (select format('%s|%s', r ->> 'invalidated', pg_temp.st('Y4')) from r99 where tag = 'I4') || ' ' || pg_temp.st('Y3'),
  '1|invalid|the trade can no longer go through: TX Zulu can no longer give $80 of FAAB — its balance is $50 (§13.3) proposed|-',
  'I4 THE SWEEP (TD12): an offer whose FAAB leg its giver can no longer afford is invalidated by the tick, with the reason; an affordable one stays');
update leagues set status = 'complete' where id = pg_temp.lg(5);
insert into r99 select 'I5', public.trade_tick('2026-10-22 12:01:00+00', pg_temp.lg(5));
select is(
  pg_temp.st('Y3'),
  'invalid|the trade can no longer go through: the league is complete — a trade goes through only while the league is in season or in the playoffs (§7.1 / §13.3)',
  'I5 the sweep closes what the season''s end left in flight');
insert into r99 select 'I6', public.trade_tick('2026-10-22 12:02:00+00', pg_temp.lg(5));
select is(
  (select format('%s|%s|%s', r ->> 'candidates', r ->> 'leagues', r ->> 'reason') from r99 where tag = 'I6'),
  '0|0|no_trades_in_flight',
  'I6 a tick with nothing in flight says so');

-- ---------------------------------------------------------------------------
-- J. Who can run it — nobody but the job.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99900000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.trade_tick() $$, '42501', null, 'J1 a signed-in user (even the commissioner) cannot run the tick');
select throws_ok($$ select public.trade_execute_internal('00000000-0000-0000-0000-000000000000', now(), 'x') $$, '42501', null,
  'J2 …nor the executor');
reset role;
set local role anon;
select throws_ok($$ select public.trade_tick() $$, '42501', null, 'J3 anon cannot run the tick');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select format('%s|%s', (v ->> 'review_deadline')::timestamptz = '2026-10-22 12:00:00+00', v ? 'execute_after')
   from (select public.trade_view_internal(pg_temp.tid('T6')) as v) q),
  'true|true',
  'J4 trade_view_internal reports review_deadline and execute_after');
select is(
  (select count(*)::int from (select r.player_id from league_rosters r where r.league_id::text like 'b9900000-%' group by r.league_id, r.player_id having count(*) > 1) d),
  0,
  'J5 EXCLUSIVITY across every league of this suite after everything above: no player on two rosters');
select is(
  (select count(*)::int from league_members where league_id::text like 'b9900000-%' and faab_balance < 0),
  0,
  'J6 …and no negative balance');

select * from finish();
rollback;
