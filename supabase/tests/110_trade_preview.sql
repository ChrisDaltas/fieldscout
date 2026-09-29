-- ============================================================================
-- The trade screen's two read doors — pgTAP 110 (M5 task L.D3.12; migration
-- 162; spec §13.3 (Propose "validates both rosters would remain legal
-- post-trade", Deadline / Q76), §16.2 `trade-builder` "legality preview",
-- §12.11, E36; PROGRESS D426, F452, F462; Chris 2026-09-29 "there is no such
-- thing as trade that isn't legal").
--
-- Numbering: RESERVED by the orchestrator (162 / 110).
-- OWN FIXTURE: leagues b1100…, teams c1100…, users 91100…, action ids
-- a1100…, players pv-*. Every instant is passed explicitly to the internals
-- (the TimeProvider seam); they are called as postgres with the actor's JWT
-- claims set, so auth.uid() is the actor. The DOORS are called under the
-- authenticated / anon roles (grants + the in-body gate) and pinned only on
-- time-independent keys (their clock is the database's now()).
--
-- THE CALENDAR: the local seed's 2026 weeks (unchanged): week 8 starts
-- Wed 2026-10-28 04:00Z = Wed 00:00 America/New_York — the trade deadline of
-- a league whose trade_deadline_week is 7 (Q76).
--
-- THE LEAGUES (roster size 3 = 1 QB + 2 bench, no IR):
--   P1 (in season, deadline week 7, FAAB, allow_faab_in_trades, commissioner
--      review): P Alpha (u1, the commissioner) a1 a2 a3 — full, FAAB $50;
--      P Bravo (u2) b1 b2 b3 — full, $100; P Charlie (u3) c1 c2 — one open
--      spot; P Delta (u4) d1 — RETIRED. u5 is a co-commissioner with NO team.
--      P Golf (u7) g1 g2 g3 — full (§G's K = 2 bindings).
--   P2 (in season, no deadline, FAAB NOT allowed in trades, no future
--      considerations): Q Echo (u1) e1, Q Fox (u2) f1.
--   u6 belongs to no league.
--
-- Falsifiability (tasks-M1 §4.3): every refusal a stored literal; the
-- deadline at −1 s (open) and AT it (passed) — and the verbs refuse exactly
-- when the door says passed; the preview's must_drop is bound to the verbs:
-- must_drop − 1 drops refused by E36, must_drop drops accepted (both arms,
-- K = 1 in §C / §D and K = 2 in §G — R1284).
-- BREAK PROBES shown red in the PR, then reverted (commits on the branch):
-- (1) take the 162 substitution out of trade_check_internal ⇒ A4 / C1 / D1 /
-- D8 red (the preview raises instead of reporting); (2) the view's `<=` →
-- `<` ⇒ B2 / C13 / D5 red.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(62);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s:%s', p.proname, p.prosecdef, p.provolatile, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('trade_deadline', 'trade_deadline_read_internal', 'trade_deadline_view_internal',
                                                 'trade_preview', 'trade_preview_internal')),
  'trade_deadline:t:s:search_path="":f:t trade_deadline_read_internal:f:s:search_path="":f:f trade_deadline_view_internal:f:s:search_path="":f:f trade_preview:t:s:search_path="":f:t trade_preview_internal:f:s:search_path="":f:f',
  'A1 five new functions, one overload each, all STABLE, search_path empty: two DEFINER doors (authenticated only, the in-body gate authorizes) and three PLAIN internals nobody else can call');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname in ('trade_deadline', 'trade_deadline_read_internal', 'trade_deadline_view_internal',
                                                  'trade_preview', 'trade_preview_internal', 'trade_check_internal')
      and a.privilege_type = 'EXECUTE' and a.grantee = 0)
  and not has_function_privilege('authenticated', 'public.trade_check_internal(text, public.leagues, public.teams, public.teams, jsonb, text[], text[])', 'EXECUTE'),
  'A2 PUBLIC holds EXECUTE on none of them, and the replaced validator stays REVOKEd from authenticated');
select is(
  (select format('%s|%s', count(*), md5(replace(min(prosrc), ' AND p_verb IS DISTINCT FROM ''trade_preview''', '')))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trade_check_internal'),
  '1|38f0a361b09c76696283e4474b482175',
  'A3 D137: ONE overload of trade_check_internal, and with the 162 substitution taken back out its body is 151''s byte for byte (md5 of 151:214-424''s body)');
select is(
  (select (length(prosrc) - length(replace(prosrc, 'trade_preview', ''))) / length('trade_preview')
   from pg_proc where proname = 'trade_check_internal'),
  1,
  'A4 the substitution is the only mention of trade_preview in the validator (the E36 raise, nothing else)');

-- ---------------------------------------------------------------------------
-- Fixtures (postgres context)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91100000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-tp' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'tp_user' || i)::jsonb, now(), now()
from generate_series(1, 7) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review, trade_deadline_week,
                     settings, roster_settings)
select l.id, '91100000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 12, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', 'faab', 100, 'commissioner', l.deadline, l.st,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('b1100000-0000-4000-8000-000000000001'::uuid, 'pgtap-tp-P1', 7,    '{"allow_faab_in_trades": true}'::jsonb),
 ('b1100000-0000-4000-8000-000000000002'::uuid, 'pgtap-tp-P2', null, '{}'::jsonb)
) as l(id, nm, deadline, st);

insert into teams (id, owner_id, name, league_id, status)
select t.id::uuid, ('91100000-0000-4000-8000-00000000000' || t.u)::uuid, t.nm, ('b1100000-0000-4000-8000-00000000000' || t.lg)::uuid, t.st
from (values
 ('c1100000-0000-4000-8000-000000000011', 1, 'P Alpha',   1, 'active'), ('c1100000-0000-4000-8000-000000000012', 2, 'P Bravo', 1, 'active'),
 ('c1100000-0000-4000-8000-000000000013', 3, 'P Charlie', 1, 'active'), ('c1100000-0000-4000-8000-000000000014', 4, 'P Delta', 1, 'retired'),
 ('c1100000-0000-4000-8000-000000000015', 7, 'P Golf',    1, 'active'),
 ('c1100000-0000-4000-8000-000000000021', 1, 'Q Echo',    2, 'active'), ('c1100000-0000-4000-8000-000000000022', 2, 'Q Fox',   2, 'active')
) as t(id, u, nm, lg, st);

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id,
       case when t.owner_id = '91100000-0000-4000-8000-000000000001' then 'commissioner' else 'manager' end, false,
       case t.name when 'P Alpha' then 50 else 100 end
from teams t where t.id::text like 'c1100000-%';
insert into league_members (league_id, user_id, team_id, role, is_placeholder)
values ('b1100000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000005', null, 'co_commissioner', false);

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 12) w where l.id::text like 'b1100000-%';

insert into players (id, full_name, position, team, status)
select p.id, p.nm, 'QB', 'TXC', 'Active'
from (values
 ('pv-a1', 'P A One'), ('pv-a2', 'P A Two'), ('pv-a3', 'P A Three'),
 ('pv-b1', 'P B One'), ('pv-b2', 'P B Two'), ('pv-b3', 'P B Three'),
 ('pv-c1', 'P C One'), ('pv-c2', 'P C Two'), ('pv-c3', 'P C Three'), ('pv-d1', 'P D One'),
 ('pv-g1', 'P G One'), ('pv-g2', 'P G Two'), ('pv-g3', 'P G Three'),
 ('pv-e1', 'Q E One'), ('pv-f1', 'Q F One')
) as p(id, nm);

insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('P Alpha', 'pv-a1'), ('P Alpha', 'pv-a2'), ('P Alpha', 'pv-a3'),
 ('P Bravo', 'pv-b1'), ('P Bravo', 'pv-b2'), ('P Bravo', 'pv-b3'),
 ('P Charlie', 'pv-c1'), ('P Charlie', 'pv-c2'), ('P Delta', 'pv-d1'),
 ('P Golf', 'pv-g1'), ('P Golf', 'pv-g2'), ('P Golf', 'pv-g3'),
 ('Q Echo', 'pv-e1'), ('Q Fox', 'pv-f1')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c1100000-%';

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

create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '91100000-0000-4000-8000-00000000000' || p_n, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c1100000-%' $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b1100000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a1100000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.leg(p_player text, p_team text) returns jsonb language sql as $$ select jsonb_build_object('player_id', p_player, 'from_team_id', pg_temp.team(p_team)) $$;
create function pg_temp.cash(p_amount int, p_team text) returns jsonb language sql as $$ select jsonb_build_object('faab_amount', p_amount, 'from_team_id', pg_temp.team(p_team)) $$;
-- offer preview (as user) at an instant
create function pg_temp.offer(p_user int, p_lg int, p_from text, p_to text, p_items jsonb, p_drops text[], p_at timestamptz)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return public.trade_preview_internal(pg_temp.lg(p_lg), null, pg_temp.team(p_from), pg_temp.team(p_to), p_items, p_drops, p_at);
end $$;
create function pg_temp.accept(p_user int, p_lg int, p_trade uuid, p_drops text[], p_at timestamptz)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return public.trade_preview_internal(pg_temp.lg(p_lg), p_trade, null, null, null, p_drops, p_at);
end $$;
-- one side's facts, compact
create function pg_temp.side(p_doc jsonb, p_role text) returns text language sql as $$
  select format('before %s out %s in %s drops %s after %s size %s must_drop %s enforced %s',
                p_doc #>> array['rosters', p_role, 'count_before'], p_doc #>> array['rosters', p_role, 'players_out'],
                p_doc #>> array['rosters', p_role, 'players_in'], p_doc #>> array['rosters', p_role, 'drops'],
                p_doc #>> array['rosters', p_role, 'count_after'], p_doc #>> array['rosters', p_role, 'roster_size'],
                p_doc #>> array['rosters', p_role, 'must_drop'], p_doc #>> array['rosters', p_role, 'enforced']) $$;

create temp table snap (tag text primary key, n text not null);
create function pg_temp.counts() returns text language sql as $$
  select format('trades %s items %s drops %s actions %s notifications %s commish %s rosters %s faab %s',
                (select count(*) from trades), (select count(*) from trade_items), (select count(*) from trade_drops),
                (select count(*) from trade_actions), (select count(*) from notifications), (select count(*) from commissioner_actions),
                (select count(*) from league_rosters), (select sum(faab_balance) from league_members)) $$;

-- ---------------------------------------------------------------------------
-- B. The deadline (F452) — the instant, "passed" at the verbs' boundary
-- ---------------------------------------------------------------------------
select pg_temp.as_user(2);
select is(
  (select jsonb_build_object('w', d -> 'deadline_week', 'at', d -> 'deadline_at', 'label', d -> 'label', 'why', d -> 'why', 'passed', d -> 'passed', 'ms', d -> 'ms_remaining')
   from (select public.trade_deadline_read_internal(pg_temp.lg(1), '2026-10-28 03:59:59+00') d) x),
  '{"w": 7, "at": "2026-10-28T04:00:00+00:00", "label": "Wed 2026-10-28 00:00 America/New_York", "why": "next_week_starts", "passed": false, "ms": 1000}'::jsonb,
  'B1 a member reads the deadline: week 7, the instant week 8 begins, labelled in the league zone — one second before it, not passed (1000 ms left)');
select is(
  (select jsonb_build_object('passed', d -> 'passed', 'ms', d -> 'ms_remaining', 'at', d -> 'evaluated_at')
   from (select public.trade_deadline_read_internal(pg_temp.lg(1), '2026-10-28 04:00:00+00') d) x),
  '{"passed": true, "ms": null, "at": "2026-10-28T04:00:00+00:00"}'::jsonb,
  'B2 AT the instant it has passed (the verbs refuse AT it, Q76)');
select throws_ok(
  $$ select pg_temp.as_user(1); select public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('P Alpha'), pg_temp.team('P Charlie'),
       jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-c1', 'P Charlie')), null, null, pg_temp.act(1), '2026-10-28 04:00:00+00', null) $$,
  'P0001',
  'trade_propose: the trade deadline has passed — trades could be proposed until week 8 began (Wed 2026-10-28 00:00 America/New_York; trade_deadline_week 7, §13.3 / Q76)',
  'B3 …and trade_propose refuses at exactly that instant (passed = the verb''s own refusal)');
select pg_temp.as_user(2);
select is(
  (select jsonb_build_object('w', d -> 'deadline_week', 'at', d -> 'deadline_at', 'why', d -> 'why', 'passed', d -> 'passed')
   from (select public.trade_deadline_read_internal(pg_temp.lg(2), '2027-01-01 00:00:00+00') d) x),
  '{"w": null, "at": null, "why": "no_deadline", "passed": false}'::jsonb,
  'B4 a league with no trade deadline: no instant, never passed');
select pg_temp.as_user(5);
select is(
  (public.trade_deadline_read_internal(pg_temp.lg(1), '2026-10-21 12:00:00+00') ->> 'deadline_week')::int, 7,
  'B5 a member with no team (a co-commissioner) reads it too');
select pg_temp.as_user(6);
select throws_ok(
  $$ select public.trade_deadline_read_internal(pg_temp.lg(1), '2026-10-21 12:00:00+00') $$,
  '42501', 'trade_deadline: not a member of this league',
  'B6 a non-member is refused — one no-leak 42501');
select throws_ok(
  $$ select pg_temp.as_user(2); select public.trade_deadline_read_internal('b1100000-0000-4000-8000-0000000000ff', '2026-10-21 12:00:00+00') $$,
  '42501', 'trade_deadline: not a member of this league',
  'B7 …and so is a league that does not exist (the same sentence — no leak)');

-- The DOOR, under the API roles.
select pg_temp.as_user(2);
set local role authenticated;
select is(
  (select jsonb_build_object('w', d -> 'deadline_week', 'at', d -> 'deadline_at')
   from (select public.trade_deadline('b1100000-0000-4000-8000-000000000001') d) x),
  '{"w": 7, "at": "2026-10-28T04:00:00+00:00"}'::jsonb,
  'B8 the door: an authenticated member reads it (DEFINER — the pinned keys are clock-free)');
select set_config('request.jwt.claims', '{"sub": "91100000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.trade_deadline('b1100000-0000-4000-8000-000000000001') $$,
  '42501', 'trade_deadline: not a member of this league',
  'B9 the door: an authenticated non-member is refused in-body');
reset role;
set local role anon;
select throws_ok(
  $$ select public.trade_deadline('b1100000-0000-4000-8000-000000000001') $$,
  '42501', 'permission denied for function trade_deadline',
  'B10 the door: anon holds no EXECUTE');
reset role;
update leagues set deleted_at = '2026-10-01 00:00:00+00' where id = pg_temp.lg(2);
select throws_ok(
  $$ select pg_temp.as_user(2); select public.trade_deadline_read_internal(pg_temp.lg(2), '2026-10-21 12:00:00+00') $$,
  '42501', 'trade_deadline: not a member of this league',
  'B11 a soft-deleted league answers its own members the same 42501');
update leagues set deleted_at = null where id = pg_temp.lg(2);

-- ---------------------------------------------------------------------------
-- C. The OFFER preview — trade_propose's check, before sending
-- ---------------------------------------------------------------------------
-- C1–C3: Alpha (full) asks for two of Bravo's players for one of his own.
select is(
  (select format('ok %s refusal %s | %s | %s', d ->> 'ok', coalesce(d ->> 'refusal', '-'), pg_temp.side(d, 'proposer'), pg_temp.side(d, 'recipient'))
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo',
                 jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-b1', 'P Bravo'), pg_temp.leg('pv-b2', 'P Bravo')),
                 null, '2026-10-21 12:00:00+00') d) x),
  'ok false refusal - | before 3 out 1 in 2 drops 0 after 4 size 3 must_drop 1 enforced true | before 3 out 2 in 1 drops 0 after 2 size 3 must_drop 0 enforced false',
  'C1 2-for-1 into a full roster: the offering team must name 1 drop — REPORTED (must_drop 1), not raised; not ok yet');
select is(
  (select format('ok %s refusal %s | %s', d ->> 'ok', coalesce(d ->> 'refusal', '-'), pg_temp.side(d, 'proposer'))
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo',
                 jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-b1', 'P Bravo'), pg_temp.leg('pv-b2', 'P Bravo')),
                 array['pv-a2'], '2026-10-21 12:00:00+00') d) x),
  'ok true refusal - | before 3 out 1 in 2 drops 1 after 3 size 3 must_drop 0 enforced true',
  'C2 …with one drop named it fits: ok');
select throws_ok(
  $$ select pg_temp.as_user(1); select public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('P Alpha'), pg_temp.team('P Bravo'),
       jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-b1', 'P Bravo'), pg_temp.leg('pv-b2', 'P Bravo')), null, null, pg_temp.act(2), '2026-10-21 12:00:00+00', null) $$,
  'P0001',
  'trade_propose: P Alpha''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)',
  'C3 the binding: what the preview called must_drop 1 is exactly the drop the verb demands (0 drops refused)…');
select lives_ok(
  $$ select pg_temp.as_user(1); select public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('P Alpha'), pg_temp.team('P Bravo'),
       jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-b1', 'P Bravo'), pg_temp.leg('pv-b2', 'P Bravo')), array['pv-a2'], null, pg_temp.act(3), '2026-10-21 12:00:00+00', null) $$,
  'C4 …and with the one drop the verb takes the offer (ok = the verb says yes)');
select is(
  (select format('ok %s | %s', d ->> 'ok', pg_temp.side(d, 'recipient'))
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo',
                 jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-a2', 'P Alpha'), pg_temp.leg('pv-b3', 'P Bravo')),
                 null, '2026-10-21 12:00:00+00') d) x),
  'ok true | before 3 out 1 in 2 drops 0 after 4 size 3 must_drop 1 enforced false',
  'C5 the receiving team''s overflow is SAID (must_drop 1) but not enforced — it names its drop when it accepts (E36): the offer is ok');

-- FAAB legs (§13.3 / §7.3.5).
select is(
  (select format('ok %s rosters %s refusal %s', d ->> 'ok', coalesce(d ->> 'rosters', 'null'), d ->> 'refusal')
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo',
                 jsonb_build_array(pg_temp.cash(60, 'P Alpha'), pg_temp.leg('pv-b3', 'P Bravo')),
                 array['pv-a3'], '2026-10-21 12:00:00+00') d) x),
  'ok false rosters null refusal trade_preview: P Alpha cannot give $60 of FAAB — its balance is $50 (§13.3)',
  'C6 a FAAB leg above the giver''s balance: the validator''s own sentence, not ok');
select is(
  (select format('ok %s refusal %s', d ->> 'ok', coalesce(d ->> 'refusal', '-'))
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo',
                 jsonb_build_array(pg_temp.cash(50, 'P Alpha'), pg_temp.leg('pv-b3', 'P Bravo')),
                 array['pv-a3'], '2026-10-21 12:00:00+00') d) x),
  'ok true refusal -',
  'C7 …exactly the balance is fine');
select is(
  (select pg_temp.offer(1, 2, 'Q Echo', 'Q Fox', jsonb_build_array(pg_temp.cash(5, 'Q Echo'), pg_temp.leg('pv-f1', 'Q Fox')), null, '2026-10-21 12:00:00+00') ->> 'refusal'),
  'trade_preview: FAAB cannot be traded in this league (allow_faab_in_trades is off, §7.3.5)',
  'C8 a FAAB leg where the league does not trade FAAB');
select is(
  (select pg_temp.offer(1, 2, 'Q Echo', 'Q Fox', jsonb_build_array(pg_temp.leg('pv-f1', 'Q Fox')), array['pv-e1'], '2026-10-21 12:00:00+00') ->> 'refusal'),
  'trade_preview: Q Echo gives nothing in this trade — this league does not allow future considerations (allow_future_considerations is off, §7.3.5), so each team gives at least one player or FAAB',
  'C9 a one-sided offer where the league allows no future considerations');
select is(
  (select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo', jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-c1', 'P Bravo')), null, '2026-10-21 12:00:00+00') ->> 'refusal'),
  'trade_preview: P C One (pv-c1) is on P Charlie''s roster, not P Bravo''s — a trade can only move a player from the team that has him (player exclusivity, §13.3 / CLAUDE.md rule 7)',
  'C10 a player who is not on the team the leg names (exclusivity, rule 7)');
select is(
  (select pg_temp.offer(1, 1, 'P Alpha', 'P Delta', jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-d1', 'P Delta')), null, '2026-10-21 12:00:00+00') ->> 'refusal'),
  'trade_preview: P Delta is retired — a sealed franchise makes no trades (§7.2.1)',
  'C11 a retired team makes no trades');

-- The gates: the deadline and the season.
select is(
  (select format('ok %s passed %s refusal %s must_drop %s', d ->> 'ok', d #>> '{deadline,passed}', coalesce(d ->> 'refusal', '-'), d #>> '{rosters,proposer,must_drop}')
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Charlie', jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-c1', 'P Charlie')), null, '2026-10-28 03:59:59+00') d) x),
  'ok true passed false refusal - must_drop 0',
  'C12 a fitting offer one second before the deadline: ok');
select is(
  (select format('ok %s passed %s refusal %s must_drop %s', d ->> 'ok', d #>> '{deadline,passed}', coalesce(d ->> 'refusal', '-'), d #>> '{rosters,proposer,must_drop}')
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Charlie', jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-c1', 'P Charlie')), null, '2026-10-28 04:00:00+00') d) x),
  'ok false passed true refusal - must_drop 0',
  'C13 …AT the deadline the same offer is not ok: the deadline has passed (the rosters still said)');
update leagues set status = 'complete' where id = pg_temp.lg(1);
select is(
  (select format('ok %s in_season %s status %s', d ->> 'ok', d ->> 'in_season', d ->> 'league_status')
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Charlie', jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-c1', 'P Charlie')), null, '2026-10-21 12:00:00+00') d) x),
  'ok false in_season false status complete',
  'C14 a league out of season: not ok (trades are made in season or the playoffs only)');
update leagues set status = 'in_season' where id = pg_temp.lg(1);

-- Shape and auth.
select throws_ok(
  $$ select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo', '[{"player_id": "pv-a1"}]'::jsonb, null, '2026-10-21 12:00:00+00') $$,
  '22023', null,
  'C15 a malformed leg (no from_team_id) is a 400-class error, never a refusal');
select throws_ok(
  $$ select pg_temp.as_user(1); select public.trade_preview_internal(pg_temp.lg(1), null, pg_temp.team('P Alpha'), pg_temp.team('Q Fox'), '[]'::jsonb, null, '2026-10-21 12:00:00+00') $$,
  'P0001', null,
  'C16 a team of another league is refused loudly');
select throws_ok(
  $$ select pg_temp.offer(6, 1, 'P Alpha', 'P Bravo', jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-b1', 'P Bravo')), null, '2026-10-21 12:00:00+00') $$,
  '42501', 'trade_preview: not a member of this league',
  'C17 a non-member is refused — one no-leak 42501');
select is(
  (pg_temp.offer(5, 1, 'P Alpha', 'P Charlie', jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-c1', 'P Charlie')), null, '2026-10-21 12:00:00+00') ->> 'ok'),
  'true',
  'C18 any member may preview (a co-commissioner with no team) — nothing it reads is hidden from members (§12.11)');

-- ---------------------------------------------------------------------------
-- D. The ACCEPT preview — trade_respond('accept')'s check, before answering
-- ---------------------------------------------------------------------------
-- Charlie (one open spot) offers c1 + c2 for b1: Bravo (full) would hold 4.
create temp table t110 (tag text primary key, id uuid not null);
select pg_temp.as_user(3);
insert into t110 select 'cb', (public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('P Charlie'), pg_temp.team('P Bravo'),
  jsonb_build_array(pg_temp.leg('pv-c1', 'P Charlie'), pg_temp.leg('pv-c2', 'P Charlie'), pg_temp.leg('pv-b1', 'P Bravo')), null, null, pg_temp.act(10), '2026-10-21 12:00:00+00', null) #>> '{trade,id}')::uuid;
-- F414 (D8 / D9): Charlie also offers c2 for b2 + b3 — it fits when sent —
-- and THEN adds a player, so that offer no longer fits HIS roster; the
-- receiving manager cannot fix it.
select pg_temp.as_user(3);
insert into t110 select 'cb2', (public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('P Charlie'), pg_temp.team('P Bravo'),
  jsonb_build_array(pg_temp.leg('pv-c2', 'P Charlie'), pg_temp.leg('pv-b2', 'P Bravo'), pg_temp.leg('pv-b3', 'P Bravo')), null, null, pg_temp.act(12), '2026-10-21 12:00:00+00', null) #>> '{trade,id}')::uuid;
insert into league_rosters (league_id, team_id, player_id, slot_key) values (pg_temp.lg(1), pg_temp.team('P Charlie'), 'pv-c3', 'bn');
insert into snap values ('before_d', pg_temp.counts());

select is(
  (select format('mode %s ok %s refusal %s | %s | %s', d ->> 'mode', d ->> 'ok', coalesce(d ->> 'refusal', '-'), pg_temp.side(d, 'proposer'), pg_temp.side(d, 'recipient'))
   from (select pg_temp.accept(2, 1, (select id from t110 where tag = 'cb'), null, '2026-10-21 13:00:00+00') d) x),
  'mode accept ok false refusal - | before 3 out 2 in 1 drops 0 after 2 size 3 must_drop 0 enforced true | before 3 out 1 in 2 drops 0 after 4 size 3 must_drop 1 enforced true',
  'D1 accepting into a full roster: the receiving team must pick 1 drop — reported (must_drop 1), both sides enforced; not ok yet');
select is(
  (select format('ok %s | %s', d ->> 'ok', pg_temp.side(d, 'recipient'))
   from (select pg_temp.accept(2, 1, (select id from t110 where tag = 'cb'), array['pv-b2'], '2026-10-21 13:00:00+00') d) x),
  'ok true | before 3 out 1 in 2 drops 1 after 3 size 3 must_drop 0 enforced true',
  'D2 …with the one drop picked: ok');
select throws_ok(
  $$ select pg_temp.as_user(2); select public.trade_respond_internal(pg_temp.lg(1), (select id from t110 where tag = 'cb'), 'accept', null, null, null, pg_temp.act(11), '2026-10-21 13:00:00+00', null) $$,
  'P0001',
  'trade_respond: P Bravo''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)',
  'D3 the binding: accepting with no drop is exactly the verb''s E36 refusal…');
select is(
  (select pg_temp.accept(2, 1, (select id from t110 where tag = 'cb'), array['pv-b1'], '2026-10-21 13:00:00+00') ->> 'refusal'),
  'trade_preview: P B One (pv-b1) is already leaving P Bravo in this trade — he cannot also be one of its drops',
  'D4 a drop that is already leaving in the trade: the validator''s sentence');
select is(
  (select format('ok %s passed %s', d ->> 'ok', d #>> '{deadline,passed}')
   from (select pg_temp.accept(2, 1, (select id from t110 where tag = 'cb'), array['pv-b2'], '2026-10-28 04:00:00+00') d) x),
  'ok false passed true',
  'D5 accepting AT the deadline: not ok (the verb refuses accept from week 8''s start, Q76)');
select is(
  (select pg_temp.accept(2, 1, (select id from t110 where tag = 'cb'), array['pv-a3'], '2026-10-21 13:00:00+00') ->> 'refusal'),
  'trade_preview: P A Three (pv-a3) is not on P Bravo''s roster — a team can only drop its own players to make room (E36)',
  'D6 a drop that is not the receiving team''s own player');
select throws_ok(
  $$ select pg_temp.as_user(2); select public.trade_preview_internal(pg_temp.lg(1), (select id from t110 where tag = 'cb'), pg_temp.team('P Bravo'), null, null, null, '2026-10-21 13:00:00+00') $$,
  '22023', 'trade_preview: an accept preview names the trade only — its teams and legs are the offer''s',
  'D7 an accept preview takes the trade id only');

select is(
  (select format('ok %s | %s', d ->> 'ok', pg_temp.side(d, 'proposer'))
   from (select pg_temp.accept(2, 1, (select id from t110 where tag = 'cb2'), null, '2026-10-21 13:00:00+00') d) x),
  'ok false | before 3 out 1 in 2 drops 0 after 4 size 3 must_drop 1 enforced true',
  'D8 F414: the offering team added a player since offering — its side is over by 1, so the offer cannot be accepted as it stands');
select throws_ok(
  $$ select pg_temp.as_user(2); select public.trade_respond_internal(pg_temp.lg(1), (select id from t110 where tag = 'cb2'), 'accept', null, null, null, pg_temp.act(13), '2026-10-21 13:00:00+00', null) $$,
  'P0001',
  'trade_respond: P Charlie''s roster no longer fits this offer — it would hold 4 players after the trade, 1 more than its 3 spots (§7.3.2 roster_size), because it has added players since proposing; only P Charlie can fix that, so ask them to cancel and re-propose with drops (E36)',
  'D9 …and the verb refuses that accept by name (the preview said so first)');
-- No write: every preview so far moved nothing.
select is(
  pg_temp.counts(), (select n from snap where tag = 'before_d'),
  'E1 NO WRITE: the accept previews left trades, legs, drops, the replay ledger, notifications, the audit log, rosters and FAAB exactly as they were');

delete from league_rosters where player_id = 'pv-c3';


-- The accept itself, with the drop the preview named.
select lives_ok(
  $$ select pg_temp.as_user(2); select public.trade_respond_internal(pg_temp.lg(1), (select id from t110 where tag = 'cb'), 'accept', array['pv-b2'], null, null, pg_temp.act(14), '2026-10-21 13:00:00+00', null) $$,
  'D10 the binding: accepting with the one drop the preview asked for goes in');
select is(
  (select pg_temp.accept(2, 1, (select id from t110 where tag = 'cb'), null, '2026-10-21 14:00:00+00') ->> 'refusal'),
  'trade_preview: this trade is already in_review — only an offer still waiting for an answer can be accepted',
  'D11 an answered offer: the preview says it cannot be accepted again');
select throws_ok(
  $$ select pg_temp.accept(6, 1, (select id from t110 where tag = 'cb'), null, '2026-10-21 14:00:00+00') $$,
  '42501', 'trade_preview: not a member of this league',
  'D12 a non-member cannot preview an accept either');
select throws_ok(
  $$ select pg_temp.as_user(2); select public.trade_preview_internal(pg_temp.lg(2), (select id from t110 where tag = 'cb'), null, null, null, null, '2026-10-21 14:00:00+00') $$,
  'P0001', null,
  'D13 a trade of another league is not found in this one (loud)');

-- ---------------------------------------------------------------------------
-- E. No write, through the offer arm too; the DOOR under the API roles
-- ---------------------------------------------------------------------------
insert into snap values ('before_e', pg_temp.counts());
select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo', jsonb_build_array(pg_temp.leg('pv-a2', 'P Alpha'), pg_temp.leg('pv-b3', 'P Bravo')), array['pv-a3'], '2026-10-21 15:00:00+00');
select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo', jsonb_build_array(pg_temp.cash(99, 'P Alpha'), pg_temp.leg('pv-b3', 'P Bravo')), null, '2026-10-21 15:00:00+00');
select is(
  pg_temp.counts(), (select n from snap where tag = 'before_e'),
  'E2 NO WRITE: offer previews (a fitting one and a refused one) wrote nothing anywhere');

select pg_temp.as_user(2);
set local role authenticated;
select is(
  (select format('%s|%s|%s', d ->> 'mode', d #>> '{rosters,proposer,must_drop}', d #>> '{rosters,recipient,must_drop}')
   from (select public.trade_preview('b1100000-0000-4000-8000-000000000001', null, 'c1100000-0000-4000-8000-000000000012',
                                     'c1100000-0000-4000-8000-000000000013',
                                     '[{"player_id": "pv-b3", "from_team_id": "c1100000-0000-4000-8000-000000000012"}, {"player_id": "pv-c1", "from_team_id": "c1100000-0000-4000-8000-000000000013"}]'::jsonb) d) x),
  'offer|0|0',
  'E3 the door: an authenticated member previews an offer (DEFINER — the roster facts are clock-free)');
select set_config('request.jwt.claims', '{"sub": "91100000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.trade_preview('b1100000-0000-4000-8000-000000000001', null, 'c1100000-0000-4000-8000-000000000012', 'c1100000-0000-4000-8000-000000000013',
       '[{"player_id": "pv-b3", "from_team_id": "c1100000-0000-4000-8000-000000000012"}]'::jsonb) $$,
  '42501', 'trade_preview: not a member of this league',
  'E4 the door: an authenticated non-member is refused in-body');
reset role;
set local role anon;
select throws_ok(
  $$ select public.trade_preview('b1100000-0000-4000-8000-000000000001', null, null, null, null, null) $$,
  '42501', 'permission denied for function trade_preview',
  'E5 the door: anon holds no EXECUTE');
reset role;

-- ---------------------------------------------------------------------------
-- F. Every existing caller keeps its refusal (the substitution is scoped)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select pg_temp.as_user(2); select public.trade_check_internal('trade_respond', (select l from leagues l where l.id = pg_temp.lg(1)),
       (select t from teams t where t.id = pg_temp.team('P Alpha')), (select t from teams t where t.id = pg_temp.team('P Bravo')),
       jsonb_build_array(jsonb_build_object('player_id', 'pv-a2', 'faab_amount', null, 'from_team_id', pg_temp.team('P Alpha'), 'to_team_id', pg_temp.team('P Bravo')),
                         jsonb_build_object('player_id', 'pv-b3', 'faab_amount', null, 'from_team_id', pg_temp.team('P Bravo'), 'to_team_id', pg_temp.team('P Alpha')),
                         jsonb_build_object('player_id', 'pv-a1', 'faab_amount', null, 'from_team_id', pg_temp.team('P Alpha'), 'to_team_id', pg_temp.team('P Bravo'))),
       array[]::text[], array[]::text[]) $$,
  'P0001',
  'trade_respond: P Bravo''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)',
  'F1 any other verb still RAISES the overflow (trade_respond)');
select throws_ok(
  $$ select public.trade_check_internal(null, (select l from leagues l where l.id = pg_temp.lg(1)),
       (select t from teams t where t.id = pg_temp.team('P Alpha')), (select t from teams t where t.id = pg_temp.team('P Bravo')),
       jsonb_build_array(jsonb_build_object('player_id', 'pv-b2', 'faab_amount', null, 'from_team_id', pg_temp.team('P Bravo'), 'to_team_id', pg_temp.team('P Alpha')),
                         jsonb_build_object('player_id', 'pv-b3', 'faab_amount', null, 'from_team_id', pg_temp.team('P Bravo'), 'to_team_id', pg_temp.team('P Alpha')),
                         jsonb_build_object('player_id', 'pv-a1', 'faab_amount', null, 'from_team_id', pg_temp.team('P Alpha'), 'to_team_id', pg_temp.team('P Bravo'))),
       array[]::text[], null) $$,
  'P0001', null,
  'F2 …and a NULL verb can never skip it (IS DISTINCT FROM)');
select is(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%trade_check_internal(''trade_preview''%'),
  'trade_preview_internal',
  'F3 exactly ONE function calls the validator under the preview verb — trade_preview_internal (no verb borrows the reporting mode)');

-- ---------------------------------------------------------------------------
-- G. K = 2 (R1284): a 3-for-1 into a full roster needs TWO drops — one is
--    refused by E36, two are taken — on both arms
-- ---------------------------------------------------------------------------
select is(
  (select format('ok %s | %s', d ->> 'ok', pg_temp.side(d, 'proposer'))
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo',
                 jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-b1', 'P Bravo'), pg_temp.leg('pv-b2', 'P Bravo'), pg_temp.leg('pv-b3', 'P Bravo')),
                 null, '2026-10-21 16:00:00+00') d) x),
  'ok false | before 3 out 1 in 3 drops 0 after 5 size 3 must_drop 2 enforced true',
  'G1 offer: 3-for-1 into a full roster — must_drop 2');
select is(
  (select format('ok %s | %s', d ->> 'ok', pg_temp.side(d, 'proposer'))
   from (select pg_temp.offer(1, 1, 'P Alpha', 'P Bravo',
                 jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-b1', 'P Bravo'), pg_temp.leg('pv-b2', 'P Bravo'), pg_temp.leg('pv-b3', 'P Bravo')),
                 array['pv-a2'], '2026-10-21 16:00:00+00') d) x),
  'ok false | before 3 out 1 in 3 drops 1 after 4 size 3 must_drop 1 enforced true',
  'G2 …one drop named: still 1 more');
select throws_ok(
  $$ select pg_temp.as_user(1); select public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('P Alpha'), pg_temp.team('P Bravo'),
       jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-b1', 'P Bravo'), pg_temp.leg('pv-b2', 'P Bravo'), pg_temp.leg('pv-b3', 'P Bravo')),
       array['pv-a2'], null, pg_temp.act(20), '2026-10-21 16:00:00+00', null) $$,
  'P0001',
  'trade_propose: P Alpha''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)',
  'G3 the binding: the verb refuses the offer with one drop…');
select lives_ok(
  $$ select pg_temp.as_user(1); select public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('P Alpha'), pg_temp.team('P Bravo'),
       jsonb_build_array(pg_temp.leg('pv-a1', 'P Alpha'), pg_temp.leg('pv-b1', 'P Bravo'), pg_temp.leg('pv-b2', 'P Bravo'), pg_temp.leg('pv-b3', 'P Bravo')),
       array['pv-a2', 'pv-a3'], null, pg_temp.act(21), '2026-10-21 16:00:00+00', null) $$,
  'G4 …and takes it with the two drops the preview asked for');

select pg_temp.as_user(7);
insert into t110 select 'gb', (public.trade_propose_internal(pg_temp.lg(1), pg_temp.team('P Golf'), pg_temp.team('P Bravo'),
  jsonb_build_array(pg_temp.leg('pv-g1', 'P Golf'), pg_temp.leg('pv-g2', 'P Golf'), pg_temp.leg('pv-g3', 'P Golf'), pg_temp.leg('pv-b3', 'P Bravo')), null, null, pg_temp.act(22), '2026-10-21 16:00:00+00', null) #>> '{trade,id}')::uuid;
select is(
  (select format('ok %s | %s', d ->> 'ok', pg_temp.side(d, 'recipient'))
   from (select pg_temp.accept(2, 1, (select id from t110 where tag = 'gb'), null, '2026-10-21 17:00:00+00') d) x),
  'ok false | before 3 out 1 in 3 drops 0 after 5 size 3 must_drop 2 enforced true',
  'G5 accept: three players in for one into a full roster — the receiving team must pick 2');
select is(
  (select format('ok %s | %s', d ->> 'ok', pg_temp.side(d, 'recipient'))
   from (select pg_temp.accept(2, 1, (select id from t110 where tag = 'gb'), array['pv-b1'], '2026-10-21 17:00:00+00') d) x),
  'ok false | before 3 out 1 in 3 drops 1 after 4 size 3 must_drop 1 enforced true',
  'G6 …one picked: still 1 more');
select throws_ok(
  $$ select pg_temp.as_user(2); select public.trade_respond_internal(pg_temp.lg(1), (select id from t110 where tag = 'gb'), 'accept', array['pv-b1'], null, null, pg_temp.act(23), '2026-10-21 17:00:00+00', null) $$,
  'P0001',
  'trade_respond: P Bravo''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size): name 1 more drop(s) as part of the trade (E36)',
  'G7 the binding: the verb refuses the accept with one drop…');
select lives_ok(
  $$ select pg_temp.as_user(2); select public.trade_respond_internal(pg_temp.lg(1), (select id from t110 where tag = 'gb'), 'accept', array['pv-b1', 'pv-b2'], null, null, pg_temp.act(24), '2026-10-21 17:00:00+00', null) $$,
  'G8 …and takes it with the two drops');

select * from finish();
rollback;
