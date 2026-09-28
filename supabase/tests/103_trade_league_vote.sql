-- ============================================================================
-- League-vote trade review — pgTAP 103 (M5 task L.D3.4; migration 155; spec
-- §13.3, §7.3.5, §12.11; Q77 as ruled; PROGRESS F430 (the veto number capped
-- at the managers who can vote) and F435 (a vetoed trade is never run by the
-- tick)).
--
-- Numbering: RESERVED by the orchestrator (155 / 103).
-- OWN FIXTURE: leagues b1030…, teams c1030…, users 91030…, action ids
-- a1030…, players v-* / w-* / x-*. Every instant is passed explicitly (p_at /
-- p_now — the TimeProvider rule); the internals are called as postgres with
-- the actor's JWT claims set, so auth.uid() is the actor.
--
-- THE CALENDAR (2026, rewritten inside this transaction — 099's): week 7
-- starts Wed 2026-10-21 04:00Z. Every fixture player is on TXC, which has no
-- game in weeks 7–8 (never game-locked), so an execution is never deferred.
-- Every trade is accepted Wed 10-21 12:00Z ⇒ its review ends Thu 10-22 12:00Z
-- (trade_review_period_hours 24) = Thu 08:00 America/New_York.
--
-- THE LEAGUES
--   V1 (league_vote, trade_veto_votes 3, 8 seats): V Commish (u1, the
--      commissioner, manages a team), V Alpha u2, V Bravo u3, V Charlie u4,
--      V Delta u5, V Echo u6, V Foxtrot u7, V Retired (u10, a retired team),
--      and u8 a co-commissioner with NO team. On a trade between two of the
--      six active teams, 5 managers can vote.
--   V2 (league_vote, trade_veto_votes 6 — above the 4 who can vote on any
--      of its trades, F430): the commissioner u1 has NO team; W Golf u2,
--      W Hotel u3, W India u4, W Juliet u5, W Kilo u6, W Lima u7.
--   V3 (commissioner review): X Commish u1, X Mike u2, X November u3,
--      X Oscar u4.
--   u9 belongs to no league; u11 succeeds W Kilo's manager mid-review (§E).
--
-- Falsifiability (tasks-M1 §4.3): every refusal and every reason a stored
-- literal; boundary instants — the review deadline −1 s (a vote accepted) and
-- AT it (refused), the tick at deadline −1 s (nothing) and AT it (runs the
-- un-vetoed trade, not the vetoed one); the threshold at number − 1 (in
-- review) and at the number (vetoed), under and over the cap. BREAK PROBES
-- shown red in the PR, then reverted (one site each): the party refusal, the
-- cap, the deadline comparison, the vote's own veto call, the tick's step
-- (2b), the voter-still-manages join, the own-vote policy.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(63);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', column_name, data_type, is_nullable), ' ' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'trade_votes'),
  'id:uuid:NO trade_id:uuid:NO team_id:uuid:NO voter_id:uuid:NO vote:text:NO created_at:timestamp with time zone:NO updated_at:timestamp with time zone:NO',
  'A1 trade_votes: one vote per (trade, team), the voter, veto or approve, when');
select is(
  (select format('%s|%s', c.relrowsecurity,
                 (select string_agg(format('%s/%s/%s/%s', tablename, cmd, array_to_string(roles, ','), qual), ' ')
                  from pg_policies where schemaname = 'public' and tablename = 'trade_votes'))
   from pg_class c where c.oid = 'public.trade_votes'::regclass),
  't|trade_votes/SELECT/authenticated/(voter_id = ( SELECT auth.uid() AS uid))',
  'A2 RLS on; exactly ONE policy — SELECT of your OWN vote (Q77: the league sees the count, never who voted); no write policy for any role');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'trade_vote%'),
  'trade_vote:t:search_path="":f:t trade_vote_internal:f:search_path="":f:f trade_vote_tally:t:search_path="":f:t trade_vote_tally_internal:f:search_path="":f:f trade_vote_veto_internal:f:search_path="":f:f trade_vote_view_internal:f:search_path="":f:f',
  'A3 six new functions, one overload each, search_path empty: two DEFINER doors (authenticated only — the in-body gate authorizes), four PLAIN internals nobody else can call');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and (p.proname like 'trade_vote%' or p.proname = 'trade_tick')
      and a.privilege_type = 'EXECUTE' and a.grantee = 0)
  and not has_function_privilege('authenticated', 'public.trade_tick(timestamptz, uuid)', 'EXECUTE'),
  'A4 PUBLIC holds EXECUTE on none of them; the replaced tick is still callable by nobody but its owner');
select is(
  (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.trade_actions'::regclass and c.conname = 'trade_actions_verb_check'),
  'CHECK ((verb = ANY (ARRAY[''trade_propose''::text, ''trade_respond''::text, ''trade_vote''::text])))',
  'A5 the shared replay ledger admits trade_vote (one action_id namespace per league — R732)');
select ok(
  (select count(*) from pg_proc where proname = 'trade_tick') = 1
  and strpos((select prosrc from pg_proc where proname = 'trade_tick'), 'public.trade_vote_veto_internal(v_t.id, v_league, p_now)') > 0
  and strpos((select prosrc from pg_proc where proname = 'trade_tick'), 'public.trade_vote_veto_internal(v_t.id, v_league, p_now)')
      < strpos((select prosrc from pg_proc where proname = 'trade_tick'), 'public.trade_execute_internal(v_t.id, p_now, v_t.via)')
  and strpos((select prosrc from pg_proc where proname = 'trade_vote_internal'), 'public.trade_vote_veto_internal(p_trade_id, v_league, p_at)') > 0,
  'A6 D137: the tick vetoes (2b) BEFORE it executes (3); the vote calls the same veto (F435)');
select is(
  md5((select prosrc from pg_proc where proname = 'trade_tick')),
  '6a09bd5f7634d77e16eca75bc881eaeb',
  'A7 D137 golden: trade_tick is 151''s body plus exactly the three 155 substitutions (md5 of prosrc, a stored literal)');
select ok(
  not has_table_privilege('anon', 'public.trade_votes', 'TRUNCATE') and not has_table_privilege('authenticated', 'public.trade_votes', 'TRUNCATE'),
  'A8 trade_votes is born WITHOUT TRUNCATE for anon + authenticated (133)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context)
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case when w.week <= 6 then w.starts_at + interval '6 days' end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at)
select 'v-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 12;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91030000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-vote' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'vote_user' || i)::jsonb, now(), now()
from generate_series(1, 11) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review, trade_deadline_week,
                     settings, roster_settings)
select l.id, '91030000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 8, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', 'faab', 100, l.review, null, l.st,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('b1030000-0000-4000-8000-000000000001'::uuid, 'pgtap-vote-V1', 'league_vote',  '{"trade_veto_votes": 3}'::jsonb),
 ('b1030000-0000-4000-8000-000000000002'::uuid, 'pgtap-vote-V2', 'league_vote',  '{"trade_veto_votes": 6}'::jsonb),
 ('b1030000-0000-4000-8000-000000000003'::uuid, 'pgtap-vote-V3', 'commissioner', '{}'::jsonb)
) as l(id, nm, review, st);

insert into teams (id, owner_id, name, league_id, status)
select ('c1030000-0000-4000-8000-' || lpad(t.n::text, 12, '0'))::uuid, ('91030000-0000-4000-8000-' || lpad(t.u::text, 12, '0'))::uuid,
       t.nm, ('b1030000-0000-4000-8000-00000000000' || t.lg)::uuid, t.st
from (values
 (11, 1, 'V Commish', 1, 'active'), (12, 2, 'V Alpha', 1, 'active'), (13, 3, 'V Bravo', 1, 'active'), (14, 4, 'V Charlie', 1, 'active'),
 (15, 5, 'V Delta', 1, 'active'), (16, 6, 'V Echo', 1, 'active'), (17, 7, 'V Foxtrot', 1, 'active'), (18, 10, 'V Retired', 1, 'retired'),
 (22, 2, 'W Golf', 2, 'active'), (23, 3, 'W Hotel', 2, 'active'), (24, 4, 'W India', 2, 'active'), (25, 5, 'W Juliet', 2, 'active'),
 (26, 6, 'W Kilo', 2, 'active'), (27, 7, 'W Lima', 2, 'active'),
 (31, 1, 'X Commish', 3, 'active'), (32, 2, 'X Mike', 3, 'active'), (33, 3, 'X November', 3, 'active'), (34, 4, 'X Oscar', 3, 'active')
) as t(n, u, nm, lg, st);

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '91030000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false, 100
from teams t where t.id::text like 'c1030000-%';
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b1030000-0000-4000-8000-000000000001', '91030000-0000-4000-8000-000000000008', null, 'co_commissioner', false, null),
 ('b1030000-0000-4000-8000-000000000002', '91030000-0000-4000-8000-000000000001', null, 'commissioner', false, null);

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 12) w where l.id::text like 'b1030000-%';

insert into players (id, full_name, position, team, status)
select p.id, p.nm, 'QB', 'TXC', 'Active'
from (values
 ('v-k1', 'VT K One'), ('v-a1', 'VT A One'), ('v-b1', 'VT B One'), ('v-c1', 'VT C One'), ('v-d1', 'VT D One'),
 ('v-e1', 'VT E One'), ('v-f1', 'VT F One'),
 ('w-g1', 'WT G One'), ('w-h1', 'WT H One'), ('w-i1', 'WT I One'), ('w-j1', 'WT J One'),
 ('x-m1', 'XT M One'), ('x-n1', 'XT N One')
) as p(id, nm);

insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('V Commish', 'v-k1'), ('V Alpha', 'v-a1'), ('V Bravo', 'v-b1'), ('V Charlie', 'v-c1'), ('V Delta', 'v-d1'),
 ('V Echo', 'v-e1'), ('V Foxtrot', 'v-f1'),
 ('W Golf', 'w-g1'), ('W Hotel', 'w-h1'), ('W India', 'w-i1'), ('W Juliet', 'w-j1'),
 ('X Mike', 'x-m1'), ('X November', 'x-n1')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c1030000-%';

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

create temp table r103 (tag text primary key, r jsonb not null);
grant select on r103 to authenticated;
create function pg_temp.uid(p_n int) returns uuid language sql as $$ select ('91030000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p_n), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c1030000-%' $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b1030000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a1030000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.leg(p_player text, p_team text) returns jsonb language sql as $$ select jsonb_build_object('player_id', p_player, 'from_team_id', pg_temp.team(p_team)) $$;
create function pg_temp.prop(p_tag text, p_lg int, p_user int, p_from text, p_to text, p_items jsonb, p_at timestamptz, p_act int)
returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r103 select p_tag, public.trade_propose_internal(pg_temp.lg(p_lg), pg_temp.team(p_from), pg_temp.team(p_to), p_items, null, null, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select (r #>> '{trade,id}')::uuid from r103 where tag = p_tag);
end $$;
create function pg_temp.accept(p_tag text, p_lg int, p_user int, p_trade uuid, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r103 select p_tag, public.trade_respond_internal(pg_temp.lg(p_lg), p_trade, 'accept', null, null, null, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r103 where tag = p_tag);
end $$;
create function pg_temp.tid(p_tag text) returns uuid language sql as $$ select (r #>> '{trade,id}')::uuid from r103 where tag = p_tag $$;
-- vote(tag, league, voter, trade tag, vote, at, action) — the result is kept under tag.
create function pg_temp.vote(p_tag text, p_lg int, p_user int, p_trade text, p_vote text, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r103 select p_tag, public.trade_vote_internal(pg_temp.lg(p_lg), pg_temp.tid(p_trade), p_vote, pg_temp.act(p_act), p_at);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r103 where tag = p_tag);
end $$;
-- a vote whose refusal is asserted (nothing is kept).
create function pg_temp.try_vote(p_lg int, p_user int, p_trade text, p_vote text, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return public.trade_vote_internal(pg_temp.lg(p_lg), pg_temp.tid(p_trade), p_vote, pg_temp.act(p_act), p_at);
end $$;
create function pg_temp.st(p_tag text) returns text language sql as $$ select t.status || '|' || coalesce(t.status_reason, '-') from trades t where t.id = pg_temp.tid(p_tag) $$;
create function pg_temp.tally(p_tag text) returns text language sql as $$
  select format('%s/%s number %s', r #>> '{tally,veto_votes}', r #>> '{tally,eligible_voters}', r #>> '{tally,veto_number}') from r103 where tag = p_tag $$;
create function pg_temp.roster(p_team text) returns text language sql as $$
  select coalesce(string_agg(r.player_id, ',' order by r.player_id), '') from league_rosters r where r.team_id = pg_temp.team(p_team) $$;

-- THE TRADES (each accepted Wed 10-21 12:00Z ⇒ in review until Thu 10-22 12:00Z).
select pg_temp.prop('T1', 1, 2, 'V Alpha', 'V Bravo', jsonb_build_array(pg_temp.leg('v-a1', 'V Alpha'), pg_temp.leg('v-b1', 'V Bravo')), '2026-10-21 11:00:00+00', 1);
select pg_temp.accept('T1a', 1, 3, pg_temp.tid('T1'), '2026-10-21 12:00:00+00', 2);
select pg_temp.prop('T2', 1, 6, 'V Echo', 'V Foxtrot', jsonb_build_array(pg_temp.leg('v-e1', 'V Echo'), pg_temp.leg('v-f1', 'V Foxtrot')), '2026-10-21 11:00:00+00', 3);
select pg_temp.accept('T2a', 1, 7, pg_temp.tid('T2'), '2026-10-21 12:00:00+00', 4);
select pg_temp.prop('T7', 1, 4, 'V Charlie', 'V Delta', jsonb_build_array(pg_temp.leg('v-c1', 'V Charlie'), pg_temp.leg('v-d1', 'V Delta')), '2026-10-21 11:00:00+00', 5);
select pg_temp.prop('T3', 2, 2, 'W Golf', 'W Hotel', jsonb_build_array(pg_temp.leg('w-g1', 'W Golf'), pg_temp.leg('w-h1', 'W Hotel')), '2026-10-21 11:00:00+00', 6);
select pg_temp.accept('T3a', 2, 3, pg_temp.tid('T3'), '2026-10-21 12:00:00+00', 7);
select pg_temp.prop('T4', 2, 4, 'W India', 'W Juliet', jsonb_build_array(pg_temp.leg('w-i1', 'W India'), pg_temp.leg('w-j1', 'W Juliet')), '2026-10-21 11:00:00+00', 8);
select pg_temp.accept('T4a', 2, 5, pg_temp.tid('T4'), '2026-10-21 12:00:00+00', 9);
select pg_temp.prop('T6', 3, 2, 'X Mike', 'X November', jsonb_build_array(pg_temp.leg('x-m1', 'X Mike'), pg_temp.leg('x-n1', 'X November')), '2026-10-21 11:00:00+00', 10);
select pg_temp.accept('T6a', 3, 3, pg_temp.tid('T6'), '2026-10-21 12:00:00+00', 11);

select is(
  (select string_agg(format('%s:%s:%s', x.tag, t.status, coalesce(t.review_deadline = '2026-10-22 12:00:00+00', false)), ' ' order by x.tag)
   from (values ('T1'), ('T2'), ('T3'), ('T4'), ('T6'), ('T7')) as x(tag) join trades t on t.id = pg_temp.tid(x.tag)),
  'T1:in_review:t T2:in_review:t T3:in_review:t T4:in_review:t T6:in_review:t T7:proposed:f',
  'B1 PREMISE: five trades in review until Thu 10-22 12:00Z (acceptance + 24 h, 151), T7 only proposed');

-- ---------------------------------------------------------------------------
-- C. WHO VOTES (Q77): every manager except the two teams in the trade.
-- ---------------------------------------------------------------------------
select throws_ok($$ select pg_temp.try_vote(1, 2, 'T1', 'veto', '2026-10-21 13:00:00+00', 100) $$,
  'P0001', 'trade_vote: your team is in this trade — the two teams in a trade do not vote on it; every other manager may (§13.3 / Q77)',
  'C1 the PROPOSING team cannot vote on its own trade');
select throws_ok($$ select pg_temp.try_vote(1, 3, 'T1', 'approve', '2026-10-21 13:00:00+00', 101) $$,
  'P0001', 'trade_vote: your team is in this trade — the two teams in a trade do not vote on it; every other manager may (§13.3 / Q77)',
  'C2 …nor the RECEIVING team (veto or approve)');
select throws_ok($$ select pg_temp.try_vote(1, 9, 'T1', 'veto', '2026-10-21 13:00:00+00', 102) $$,
  '42501', 'trade_vote: not a member of this league',
  'C3 a NON-member learns nothing (42501)');
select throws_ok($$ select pg_temp.try_vote(1, 8, 'T1', 'veto', '2026-10-21 13:00:00+00', 103) $$,
  'P0001', 'trade_vote: only a team''s manager votes on a trade, and you do not manage a team in this league (§13.3 / Q77) — the commissioner''s own approve / veto is a separate commissioner tool, not a vote',
  'C4 a co-commissioner with NO team does not vote, and is pointed at the commissioner tool');
select throws_ok($$ select pg_temp.try_vote(1, 10, 'T1', 'veto', '2026-10-21 13:00:00+00', 104) $$,
  'P0001', 'trade_vote: V Retired is retired — a sealed franchise does not vote (§7.2.1)',
  'C5 a RETIRED team does not vote');
select throws_ok($$ select pg_temp.try_vote(1, 4, 'T1', 'maybe', '2026-10-21 13:00:00+00', 105) $$,
  '22023', 'trade_vote: vote maybe is not veto / approve — a manager votes to veto a trade or to let it through (§13.3 / Q77)',
  'C6 a vote is veto or approve');
select pg_temp.vote('C7', 1, 1, 'T1', 'approve', '2026-10-21 13:00:00+00', 106);
select is(
  (select format('%s|%s|%s|%s', r ->> 'outcome', r ->> 'vote', coalesce(r ->> 'previous_vote', '-'), pg_temp.tally('C7')) from r103 where tag = 'C7'),
  'recorded|approve|-|0/5 number 3',
  'C7 the COMMISSIONER who manages a team NOT in the trade votes as that team''s manager — five can vote on T1 (the retired team and the teamless co-commissioner are not counted)');
select pg_temp.vote('C8', 1, 4, 'T1', 'veto', '2026-10-21 13:00:00+00', 107);
select is(
  (select format('%s|%s|%s|%s', r ->> 'outcome', r ->> 'vote', r #>> '{trade,status}', pg_temp.tally('C8')) from r103 where tag = 'C8'),
  'recorded|veto|in_review|1/5 number 3',
  'C8 a manager of a team not in the trade votes to veto: recorded, the trade stays in review');

-- ---------------------------------------------------------------------------
-- D. THE THRESHOLD ±1, A CHANGED VOTE, THE DEADLINE, F435 (V1, number 3).
-- ---------------------------------------------------------------------------
select pg_temp.vote('D1', 1, 5, 'T1', 'veto', '2026-10-21 14:00:00+00', 108);
select is(
  (select format('%s|%s', r ->> 'outcome', pg_temp.tally('D1')) from r103 where tag = 'D1') || '|' || pg_temp.st('T1'),
  'recorded|2/5 number 3|in_review|-',
  'D1 two veto votes — ONE SHORT of the number (3): still in review');
select pg_temp.as_user(7);
select is(
  (select format('%s|%s|%s|%s|%s|%s', r ->> 'veto_votes', r ->> 'veto_number', r ->> 'voting_open', r ->> 'can_vote', coalesce(r ->> 'my_vote', '-'),
                 (r ->> 'closes_at')::timestamptz = '2026-10-22 12:00:00+00')
   from (select public.trade_vote_view_internal(pg_temp.tid('T1'), '2026-10-21 14:30:00+00') as r) x),
  '2|3|true|true|-|t',
  'D2 the league''s read mid-review: the count (2 of 3 needed), open until the deadline, the caller may vote and has not');
select set_config('request.jwt.claims', '', true);
select pg_temp.vote('D3', 1, 5, 'T1', 'approve', '2026-10-21 15:00:00+00', 109);
select is(
  (select format('%s|%s|%s', r ->> 'previous_vote', r ->> 'vote', pg_temp.tally('D3')) from r103 where tag = 'D3')
    || '|' || (select count(*) from trade_votes where trade_id = pg_temp.tid('T1') and team_id = pg_temp.team('V Delta')),
  'veto|approve|1/5 number 3|1',
  'D3 a manager CHANGES his vote before the deadline: veto → approve, the count falls to 1, still ONE row for his team');
select pg_temp.vote('D4', 1, 5, 'T1', 'veto', '2026-10-21 16:00:00+00', 110);
select is(
  (select format('%s|%s|%s', r ->> 'previous_vote', r ->> 'outcome', pg_temp.tally('D4')) from r103 where tag = 'D4'),
  'approve|recorded|2/5 number 3',
  'D4 …and back to veto: 2 again, still in review');
select is(
  (select public.trade_vote_internal(pg_temp.lg(1), pg_temp.tid('T1'), 'veto', pg_temp.act(110), '2026-10-21 16:05:00+00')
   from (select pg_temp.as_user(5)) s)::text,
  (select r::text from r103 where tag = 'D4'),
  'D5 REPLAY of the same submit is byte-identical');
select throws_ok($$ select pg_temp.try_vote(1, 5, 'T1', 'approve', '2026-10-21 16:06:00+00', 110) $$,
  'P0001', 'trade_vote: action_id a1030000-0000-4000-8000-000000000110 already names a trade_vote for another request in this league — an action_id identifies ONE submit of ONE verb (R732)',
  'D6 …and the same action_id with a DIFFERENT vote is refused (R732)');
select pg_temp.vote('D7', 1, 6, 'T1', 'veto', '2026-10-22 11:59:59+00', 111);
select is(
  (select format('%s|%s', r ->> 'outcome', pg_temp.tally('D7')) from r103 where tag = 'D7') || '|' || pg_temp.st('T1'),
  'vetoed|3/5 number 3|vetoed|vetoed by league vote — 3 of the 5 managers who can vote voted to veto, and the league''s number is 3 (§13.3 / Q77)',
  'D7 the vote at deadline − 1 s that brings the count TO the number vetoes the trade AT ONCE, with the count and the number');
select is(
  (select format('%s|%s', t.resolved_at = '2026-10-22 11:59:59+00', coalesce(t.resolved_by::text, 'NULL')) from trades t where t.id = pg_temp.tid('T1')),
  't|NULL',
  'D8 resolved at the deciding vote, resolved_by NULL — naming the deciding voter would say who voted (Q77)');
select is(
  (select count(*)::int from league_chat where league_id = pg_temp.lg(1) and is_system and user_id is null
     and message = 'Trade vetoed by league vote: V Alpha gives VT A One; V Bravo gives VT B One'),
  1,
  'D9 the system post (§10.3), naming no voter');
select is(
  (select string_agg(n.user_id::text, ',' order by n.user_id) from notifications n
   where n.type = 'league_trade_vetoed' and (n.data ->> 'trade_id')::uuid = pg_temp.tid('T1')),
  '91030000-0000-4000-8000-000000000002,91030000-0000-4000-8000-000000000003',
  'D10 BOTH managers in the trade are told, nobody else');
select throws_ok($$ select pg_temp.try_vote(1, 7, 'T1', 'veto', '2026-10-22 11:59:59+00', 112) $$,
  'P0001', 'trade_vote: this trade is not up for a vote — it was already vetoed (§13.3)',
  'D11 no vote after the veto');
-- T2 (Echo ↔ Foxtrot): two vetoes — one short.
select pg_temp.vote('D12a', 1, 2, 'T2', 'veto', '2026-10-21 13:00:00+00', 113);
select pg_temp.vote('D12', 1, 3, 'T2', 'veto', '2026-10-21 13:00:00+00', 114);
select is(pg_temp.tally('D12') || '|' || pg_temp.st('T2'), '2/5 number 3|in_review|-',
  'D12 T2: two of the five who can vote (the Alpha and Bravo managers — not parties here) veto; one short');
select throws_ok($$ select pg_temp.try_vote(1, 4, 'T2', 'veto', '2026-10-22 12:00:00+00', 115) $$,
  'P0001', 'trade_vote: voting on this trade closed at Thu 2026-10-22 08:00 America/New_York — the review period is over (§13.3 / Q77)',
  'D13 a vote AT the deadline is too late (the tick approves at that instant), said in the league''s zone');
insert into r103 select 'D14', public.trade_tick('2026-10-22 11:59:59+00', pg_temp.lg(1));
select is(
  (select format('%s|%s|%s', r ->> 'executed', r ->> 'vetoed', r ->> 'reason') from r103 where tag = 'D14') || '|' || pg_temp.st('T2'),
  '0|0|nothing_due|in_review|-',
  'D14 the tick at deadline − 1 s runs nothing');
insert into r103 select 'D15', public.trade_tick('2026-10-22 12:00:00+00', pg_temp.lg(1));
select is(
  (select format('%s|%s', r ->> 'executed', r ->> 'vetoed') from r103 where tag = 'D15')
    || '|' || pg_temp.st('T2') || '|' || pg_temp.roster('V Echo') || '/' || pg_temp.roster('V Foxtrot'),
  '1|0|complete|-|v-f1/v-e1',
  'D15 CONTROL — at the deadline the tick runs T2, whose vetoes never reached the number ("otherwise it goes through when the review period ends")');
select is(
  pg_temp.st('T1') || '|' || pg_temp.roster('V Alpha') || '/' || pg_temp.roster('V Bravo')
    || '|' || (select count(*) from transactions x where x.league_id = pg_temp.lg(1) and x.type = 'trade' and (x.payload ->> 'trade_id')::uuid = pg_temp.tid('T1')),
  'vetoed|vetoed by league vote — 3 of the 5 managers who can vote voted to veto, and the league''s number is 3 (§13.3 / Q77)|v-a1/v-b1|0',
  'D16 F435 — the SAME tick never runs the vetoed T1: still vetoed, both rosters unchanged, no transactions row');
select is(
  (select count(*)::int from league_rosters r where r.league_id = pg_temp.lg(1)) || '|'
    || (select count(*)::int from (select player_id from league_rosters where league_id = pg_temp.lg(1) group by player_id having count(*) > 1) d),
  '7|0',
  'D17 exclusivity after the tick: seven players, each on exactly one roster (rule 7)');

-- ---------------------------------------------------------------------------
-- E. F430 — the number is CAPPED at the managers who can vote (V2: setting 6,
--    four can vote on any trade).
-- ---------------------------------------------------------------------------
select pg_temp.as_user(2);
select is(
  (select format('%s|%s|%s|%s', r ->> 'setting', r ->> 'eligible_voters', r ->> 'veto_number', r ->> 'capped')
   from (select public.trade_vote_view_internal(pg_temp.tid('T3'), '2026-10-21 12:30:00+00') as r) x),
  '6|4|4|true',
  'E1 the setting is 6 but only four managers can vote on T3 (a teamless commissioner and the two parties cannot) — the number is 4');
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select pg_temp.try_vote(2, 1, 'T3', 'veto', '2026-10-21 13:00:00+00', 120) $$,
  'P0001', 'trade_vote: only a team''s manager votes on a trade, and you do not manage a team in this league (§13.3 / Q77) — the commissioner''s own approve / veto is a separate commissioner tool, not a vote',
  'E2 the teamless COMMISSIONER does not vote (his own veto is L.D3.5''s tool)');
select pg_temp.vote('E3a', 2, 4, 'T3', 'veto', '2026-10-21 13:00:00+00', 121);
select pg_temp.vote('E3b', 2, 5, 'T3', 'veto', '2026-10-21 13:00:00+00', 122);
select pg_temp.vote('E3', 2, 6, 'T3', 'veto', '2026-10-21 13:00:00+00', 123);
select is(pg_temp.tally('E3') || '|' || pg_temp.st('T3'), '3/4 number 4|in_review|-',
  'E3 three vetoes — one short of the capped number');
select pg_temp.vote('E4', 2, 7, 'T3', 'veto', '2026-10-21 13:00:00+00', 124);
select is(
  (select r ->> 'outcome' from r103 where tag = 'E4') || '|' || pg_temp.st('T3'),
  'vetoed|vetoed|vetoed by league vote — 4 of the 4 managers who can vote voted to veto, and the league''s number is 4 (its setting of 6 is more than the managers who can vote) (§13.3 / Q77)',
  'E4 F430 — every manager who can vote vetoed: VETOED, though the setting (6) is more than can vote; the reason says so');
-- T4 (India ↔ Juliet): Golf, Hotel and Kilo veto — 3 of 4, one short.
select pg_temp.vote('E5a', 2, 2, 'T4', 'veto', '2026-10-21 13:00:00+00', 125);
select pg_temp.vote('E5b', 2, 3, 'T4', 'veto', '2026-10-21 13:00:00+00', 126);
select pg_temp.vote('E5', 2, 6, 'T4', 'veto', '2026-10-21 13:00:00+00', 127);
select is(pg_temp.tally('E5') || '|' || pg_temp.st('T4'), '3/4 number 4|in_review|-', 'E5 T4: three vetoes of four, one short');
-- Kilo's seat changes hands (u11 succeeds the manager who vetoed) and Lima's
-- manager (no vote) leaves: three can vote, number 3 — and the predecessor's
-- veto is NOT his successor's.
update league_members set user_id = pg_temp.uid(11) where team_id = pg_temp.team('W Kilo');
delete from league_members where team_id = pg_temp.team('W Lima');
insert into r103 select 'E6', public.trade_tick('2026-10-21 15:00:00+00', pg_temp.lg(2));
select is(
  (select r ->> 'vetoed' from r103 where tag = 'E6') || '|' || pg_temp.st('T4') || '|'
    || (select format('%s/%s number %s', r ->> 'veto_votes', r ->> 'eligible_voters', r ->> 'veto_number')
        from (select public.trade_vote_tally_internal(t, l) as r from trades t, leagues l where t.id = pg_temp.tid('T4') and l.id = pg_temp.lg(2)) x),
  '0|in_review|-|2/3 number 3',
  'E6 a vote counts only while its voter manages the team: the successor did not vote, so 2 of the 3 who can vote — the tick vetoes nothing');
-- Kilo's new manager leaves too: the number falls to the two who can vote, and both vetoed.
delete from league_members where team_id = pg_temp.team('W Kilo');
insert into r103 select 'E7', public.trade_tick('2026-10-21 15:01:00+00', pg_temp.lg(2));
select is(
  (select format('%s|%s', r ->> 'vetoed', r #>> '{actions,0,action}') from r103 where tag = 'E7') || '|' || pg_temp.st('T4'),
  '1|vetoed|vetoed|vetoed by league vote — 2 of the 2 managers who can vote voted to veto, and the league''s number is 2 (its setting of 6 is more than the managers who can vote) (§13.3 / Q77)',
  'E7 F430 / F435 — the number fell with no vote cast (an empty seat): the TICK vetoes T4 before it could ever run it (step 2b)');
select is(
  pg_temp.roster('W India') || '/' || pg_temp.roster('W Juliet') || '|'
    || (select count(*) from transactions x where x.league_id = pg_temp.lg(2) and x.type = 'trade'),
  'w-i1/w-j1|0',
  'E8 …nothing moved in V2');

-- ---------------------------------------------------------------------------
-- F. The review mode and the trade's state
-- ---------------------------------------------------------------------------
select throws_ok($$ select pg_temp.try_vote(3, 4, 'T6', 'veto', '2026-10-21 13:00:00+00', 130) $$,
  'P0001', 'trade_vote: this league''s trades are reviewed by the commissioner, not by a league vote (trade_review commissioner, §7.3.5)',
  'F1 a league whose commissioner reviews trades takes no votes');
select throws_ok($$ select pg_temp.try_vote(1, 6, 'T7', 'veto', '2026-10-21 13:00:00+00', 131) $$,
  'P0001', 'trade_vote: this trade is not up for a vote — it has not been accepted yet; voting opens when it is (§13.3)',
  'F2 an offer not yet accepted takes no votes');
insert into r103 select 'F3', public.trade_tick('2026-10-22 12:00:00+00', pg_temp.lg(3));
select is(
  (select format('%s|%s', r ->> 'executed', r ->> 'vetoed') from r103 where tag = 'F3') || '|' || pg_temp.st('T6'),
  '1|0|complete|-',
  'F3 commissioner review is unchanged: the tick auto-approves T6 at the deadline and vetoes nothing');
-- The §7.3.5 default: ⌈team_count / 2⌉ when the league never set it (8 seats ⇒ 4).
update leagues set settings = settings - 'trade_veto_votes' where id = pg_temp.lg(1);
select pg_temp.as_user(1);
select is(
  (select format('%s|%s|%s', r ->> 'setting', r ->> 'veto_number', r ->> 'eligible_voters')
   from (select public.trade_vote_view_internal(pg_temp.tid('T2'), '2026-10-22 13:00:00+00') as r) x),
  '4|4|5',
  'F4 no trade_veto_votes stored ⇒ the §7.3.5 default, half the league rounded up (4 of 8)');
select set_config('request.jwt.claims', '', true);
update leagues set settings = settings || '{"trade_veto_votes": 3}' where id = pg_temp.lg(1);

-- ---------------------------------------------------------------------------
-- G. VISIBILITY (Q77): the league sees the COUNT, never who voted.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from trade_votes where trade_id in (pg_temp.tid('T1'), pg_temp.tid('T2'), pg_temp.tid('T3'), pg_temp.tid('T4'))), 13,
  'G0 PREMISE: thirteen votes exist across four trades');
set local role authenticated;
select pg_temp.as_user(4);
select is(
  (select format('%s|%s', count(*), bool_and(voter_id = pg_temp.uid(4))) from trade_votes),
  '2|t',
  'G1 a voter reads ONLY his own votes (T1 as Charlie, T3 as India) — none of the other eleven');
select pg_temp.as_user(2);
select is(
  (select format('%s|%s|%s', count(*), bool_and(voter_id = pg_temp.uid(2)), count(*) filter (where trade_id = pg_temp.tid('T1'))) from trade_votes),
  '2|t|0',
  'G2 a PARTY reads no vote on his own trade (T1) — only the two he cast elsewhere');
select pg_temp.as_user(1);
select is((select count(*)::int from trade_votes), 1, 'G3 the COMMISSIONER reads only his own vote — not who else voted');
select pg_temp.as_user(9);
select is((select count(*)::int from trade_votes), 0, 'G4 a non-member reads none');
select pg_temp.as_user(8);
select is(
  (select format('%s|%s|%s|%s|%s', string_agg(k, ',' order by k), max(r ->> 'veto_votes'), max(r ->> 'eligible_voters'),
                 coalesce(max(r ->> 'my_vote'), '-'), max(r ->> 'cannot_vote_because'))
   from (select public.trade_vote_tally(pg_temp.tid('T1')) as r) x cross join lateral jsonb_object_keys(x.r) k),
  'can_vote,cannot_vote_because,capped,closes_at,eligible_voters,evaluated_at,my_vote,review,setting,status,trade_id,veto_number,veto_votes,voting_open|3|5|-|voting_closed',
  'G5 the DOOR, for any member: the count (3 of 5) and nothing that names a voter — the keys are the whole answer');
select throws_ok($$ select public.trade_vote_tally((select (r #>> '{trade,id}')::uuid from r103 where tag = 'T1')) $$,
  '42501', 'trade_vote_tally: not a member of this league', 'G6 …a stranger learns nothing (42501)')
  from (select pg_temp.as_user(9)) s;
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- H. NO WRITE POLICY FOR ANY ROLE (tasks-M* §4.2 — RETURNING counts)
-- ---------------------------------------------------------------------------
create temp table v103_before as select * from trade_votes;
grant select on v103_before to authenticated;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from trade_votes), 0, 'H1 ANON reads no votes');
select throws_ok($$ insert into trade_votes (trade_id, team_id, voter_id, vote, created_at, updated_at) select trade_id, team_id, voter_id, 'veto', now(), now() from v103_before limit 1 $$,
  '42501', null, 'H1b ANON cannot INSERT a vote');
reset role;
set local role authenticated;
select pg_temp.as_user(9);
select throws_ok($$ insert into trade_votes (trade_id, team_id, voter_id, vote, created_at, updated_at) values ((select trade_id from v103_before limit 1), (select id from teams where name = 'W Golf'), '91030000-0000-4000-8000-000000000009', 'veto', now(), now()) $$,
  '42501', null, 'H2 a NON-member cannot INSERT a vote');
select pg_temp.as_user(4);
select results_eq($$ with u as (update trade_votes set vote = 'approve' returning 1) select count(*)::int from u $$, $$ values (0) $$,
  'H3 a VOTER cannot UPDATE even his own vote directly (0 rows — the verb is the only door)');
select results_eq($$ with d as (delete from trade_votes returning 1) select count(*)::int from d $$, $$ values (0) $$, 'H3b …nor DELETE it (0 rows)');
select throws_ok($$ insert into trade_votes (trade_id, team_id, voter_id, vote, created_at, updated_at) values ((select (r #>> '{trade,id}')::uuid from r103 where tag = 'T2'), (select team_id from league_members where user_id = '91030000-0000-4000-8000-000000000004' and league_id = 'b1030000-0000-4000-8000-000000000001'), '91030000-0000-4000-8000-000000000004', 'veto', now(), now()) $$,
  '42501', null, 'H3c …nor INSERT a vote around the verb (the deadline and the veto would be skipped)');
select pg_temp.as_user(2);
select results_eq($$ with u as (update trade_votes set vote = 'approve' where trade_id = (select (r #>> '{trade,id}')::uuid from r103 where tag = 'T1') returning 1) select count(*)::int from u $$, $$ values (0) $$,
  'H4 a PARTY cannot touch the votes on his trade (0 rows)');
select pg_temp.as_user(1);
select results_eq($$ with d as (delete from trade_votes returning 1) select count(*)::int from d $$, $$ values (0) $$, 'H5 the COMMISSIONER cannot DELETE votes (0 rows)');
select results_eq($$ with u as (update trade_votes set vote = 'veto' returning 1) select count(*)::int from u $$, $$ values (0) $$, 'H5b …nor UPDATE them (0 rows)');
reset role;
select set_config('request.jwt.claims', '', true);
select set_eq($$ select * from trade_votes $$, $$ select * from v103_before $$, 'H6 the votes are BYTE-IDENTICAL after every client walk');

select * from finish();
rollback;
