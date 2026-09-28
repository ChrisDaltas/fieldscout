-- ============================================================================
-- commish_force_or_reverse_trade — pgTAP 104 (M5 task L.D3.5, FULL rigour —
-- roster exclusivity, FAAB, permissions; migration 156; spec §10.1 / §10.3 /
-- §13.3 / §15.4 / §12.12, E11; PROGRESS D336, D350, D352 / F340, F436,
-- D410, D415, D416, standing rules (a) / (b) / (i), Q66, F440).
--
-- Numbering: RESERVED by the orchestrator (156 / 104).
-- OWN FIXTURE: users 91040…, leagues b1040…, teams c1040…, action ids
-- a1040…, players cx-*. Every instant is passed explicitly (p_at / p_now —
-- the TimeProvider rule); the internals are called as postgres with the
-- actor's JWT claims set, so auth.uid() is the actor. The per-role cells
-- (§C) go through the DEFINER door as the real roles.
--
-- THE CALENDAR (2026, rewritten inside this transaction — 099's): weeks 1–6
-- over; week 7 starts Wed 2026-10-21 04:00Z, TXA kicks off Thu 10-23
-- 00:15Z, the week's last game ends Tue 10-27 03:30Z; week 8 starts Wed
-- 10-28 04:00Z (= the week-7 trade deadline), its last game not recorded.
-- Every fixture player is on TXC (no game — never locked) except Q A Three
-- (TXA).
--
-- THE LEAGUES (roster 1 QB + 2 bench = 3 spots; FAAB 100; FAAB tradable)
--   L1 commissioner review (24 h), trade_deadline_week 7: Q Alpha u2
--      (a1 a2 a3), Q Bravo u3 (b1 b2), Q Charlie u4 (c1 c2 c3), Q Delta u5
--      (d1 d2), Q Golf u6 (g1 g2), Q Hotel u7 (h1 h2 h3). u1 the
--      commissioner and u8 a co-commissioner, neither with a team.
--   L2 league vote (trade_veto_votes 3): V Mike u2, V November u3, V Oscar
--      u4, V Papa u5, V Quebec u6 — one player each; commissioner u1.
--   L3 no review (a trade goes through at acceptance): R India u2 (i1 i2
--      i3), R Juliet u3 (j1 j2 j3), R Kilo u4 (k1 k2), R Lima u5 (l1 l2);
--      commissioner u1.
--   u9 belongs to no league.
--
-- Falsifiability (tasks-M1 §4.3):
--   * PER ROLE (§C): anon (EXECUTE revoked), a non-member, a party's own
--     manager, another league's commissioner — refused with the ONE no-leak
--     42501; C7 proves nothing was written; §J proves the ledger has NO
--     policy for any role (RETURNING counts / the INSERT refused), taken
--     with thirteen rows present so a 0 is never an empty table.
--   * every refusal a stored literal; every roster and balance after each
--     act one string; exclusivity asserted after every force and reverse.
--   * boundary instants: force AFTER the game-day lock took hold (a3 kicked
--     off Thu 00:15Z) and AFTER the trade deadline (week 8's start).
--   * BREAK PROBES shown red in the PR, then restored (one site each; the
--     migration re-applied and 71/71 re-shown after each): (P1) the executor
--     hunk removed ⇒ A5 red and the file dies at F1 (the force defers);
--     (P2) auth widened to any member ⇒ C3 / C4 + 12 downstream; (P3) the
--     no-op guard removed ⇒ dies at D5; (P4) approve via the force path ⇒
--     A6 / D1 / D6 / D7; (P5) the reverse's exclusivity check ⇒ H1; (P6)
--     the FAAB return ⇒ G2; (P7) the reverse's week rule widened to every
--     week ⇒ G3; (P8) the replay's op / trade guard ⇒ G8; (P9) the forced
--     offer's room check ⇒ F5; (P10) the reverse's FAAB check ⇒ H5 (the
--     debit's own row-count backstop still refuses); (P11) the reverse's
--     roster-size check ⇒ H6. Fix round (PR #342): (P12) the force's
--     re-score call removed ⇒ F2b; (P13) the reverse's ⇒ G3b; (P14) the
--     queue stamped now() ⇒ F2b / G3b; (P15) edited_by_commish not written
--     ⇒ F2b / G3b; (P16) the reverse's league-status gate ⇒ H6b; (P17) a
--     leg already back refused instead of skipped ⇒ the file dies at V4;
--     (P18) the approve's lock wording reverted ⇒ F11.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(71);

-- ---------------------------------------------------------------------------
-- A. Posture
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s', column_name, data_type, is_nullable), ' ' order by ordinal_position)
   from information_schema.columns where table_schema = 'public' and table_name = 'commish_trade_actions'),
  'id:uuid:NO league_id:uuid:NO trade_id:uuid:NO op:text:NO action_id:uuid:NO actor_id:uuid:NO result:jsonb:NO created_at:timestamp with time zone:NO',
  'A1 commish_trade_actions: the replay ledger keeps the op and the trade (R732), the actor and the answer');
select is(
  (select format('%s|%s|%s|%s', c.relrowsecurity,
                 (select count(*) from pg_policies where schemaname = 'public' and tablename = 'commish_trade_actions'),
                 has_table_privilege('anon', 'public.commish_trade_actions', 'TRUNCATE'),
                 has_table_privilege('authenticated', 'public.commish_trade_actions', 'TRUNCATE'))
   from pg_class c where c.oid = 'public.commish_trade_actions'::regclass),
  't|0|f|f',
  'A2 RLS on, ZERO policies (the DEFINER verb is its only reader and writer — D350), TRUNCATE revoked from anon and authenticated');
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('commish_force_or_reverse_trade', 'commish_force_or_reverse_trade_internal',
                                                 'commish_trade_reverse_internal', 'commish_trade_closed_words_internal',
                                                 'commish_trade_rescore_internal')),
  'commish_force_or_reverse_trade:t:search_path="":f:t commish_force_or_reverse_trade_internal:f:search_path="":f:f commish_trade_closed_words_internal:f:search_path="":f:f commish_trade_rescore_internal:f:search_path="":f:f commish_trade_reverse_internal:f:search_path="":f:f',
  'A3 five new functions, one overload each, search_path empty: the DEFINER door (authenticated only — the in-body gate authorizes) and four PLAIN internals nobody else can call');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and p.proname in ('commish_force_or_reverse_trade', 'commish_force_or_reverse_trade_internal',
                                                  'commish_trade_reverse_internal', 'commish_trade_closed_words_internal',
                                                  'commish_trade_rescore_internal', 'trade_execute_internal')
      and a.privilege_type = 'EXECUTE' and a.grantee = 0)
  and not has_function_privilege('authenticated', 'public.trade_execute_internal(uuid, timestamptz, text)', 'EXECUTE'),
  'A4 PUBLIC holds EXECUTE on none of them; the replaced executor is still callable by nobody but its owner');
select is(
  md5(replace((select prosrc from pg_proc where oid = 'public.trade_execute_internal(uuid, timestamptz, text)'::regprocedure),
    E'  -- 156 / L.D3.5: the commissioner\'s FORCE stands outside the game-day lock\n  -- (a timing rule — tasks-M5 L.D3.5, standing rule (i)); it executes now.\n  -- Every validity check above still binds it.\n  IF (v_lock ->> \'locked\')::boolean AND p_via IS DISTINCT FROM \'commissioner_force\' THEN\n',
    E'  IF (v_lock ->> \'locked\')::boolean THEN\n')),
  '2be2500ab6e3ba21b02a087e29403e50',
  'A5 D137: the executor is 153''s body beneath exactly ONE 156 hunk — reversed, the prosrc md5 is 153''s (pgTAP 101 A13''s stored literal)');
select ok(
  strpos((select prosrc from pg_proc where proname = 'commish_force_or_reverse_trade_internal'),
         'public.trade_execute_internal(p_trade_id, p_at, ''commissioner_approve'')') > 0
  and (select prosrc from pg_proc where proname = 'commish_force_or_reverse_trade_internal')
      !~* '(update|insert\s+into|delete\s+from)\s+public\.(league_rosters|league_members|league_player_pool|team_lineups)'
  and (select prosrc from pg_proc where proname = 'commish_trade_reverse_internal')
      ~* 'update\s+public\.league_rosters',   -- the pattern's positive control: it DOES see the reversal's own roster write
  'A6 F436: the approve goes through the executor, and the verb itself never writes a roster or a balance (the reversal''s writes live in commish_trade_reverse_internal)');

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
select 'cx-dummy-' || w.week, 2026, w.week, 'KC', 'BUF', w.starts_at + interval '1 day' from nfl_weeks w where w.season = 2026 and w.week <= 12;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('cx-g7a', 2026, 7, 'TXA', 'TXZ', '2026-10-23 00:15:00+00'), ('cx-g8a', 2026, 8, 'TXA', 'TXZ', '2026-10-30 00:15:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91040000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-cx' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'cx_user' || i)::jsonb, now(), now()
from generate_series(1, 9) i;

insert into leagues (id, owner_id, name, season, status, team_count, regular_season_weeks, playoff_teams, playoff_start_week,
                     scoring_system_id, scoring_rules_snapshot, lineup_lock, waiver_type, faab_budget, trade_review, trade_deadline_week,
                     settings, roster_settings)
select l.id, '91040000-0000-4000-8000-000000000001', l.nm, 2026, 'in_season', 8, 14, 0, 15,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
       'per_player_kickoff', 'faab', 100, l.review, l.dl, l.st,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 2, "ir_slots": [], "swap_spots": 0}'::jsonb
from (values
 ('b1040000-0000-4000-8000-000000000001'::uuid, 'pgtap-cx-L1', 'commissioner', 7,    '{"allow_faab_in_trades": true, "waiver_run_days": ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], "waiver_run_time": "10:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}'::jsonb),
 ('b1040000-0000-4000-8000-000000000002'::uuid, 'pgtap-cx-L2', 'league_vote',  null, '{"trade_veto_votes": 3}'::jsonb),
 ('b1040000-0000-4000-8000-000000000003'::uuid, 'pgtap-cx-L3', 'none',         null, '{"allow_faab_in_trades": true, "waiver_run_days": ["sun", "mon", "tue", "wed", "thu", "fri", "sat"], "waiver_run_time": "10:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}'::jsonb)
) as l(id, nm, review, dl, st);

insert into teams (id, owner_id, name, league_id, status)
select ('c1040000-0000-4000-8000-' || lpad(t.n::text, 12, '0'))::uuid, ('91040000-0000-4000-8000-' || lpad(t.u::text, 12, '0'))::uuid,
       t.nm, ('b1040000-0000-4000-8000-00000000000' || t.lg)::uuid, 'active'
from (values
 (11, 2, 'Q Alpha', 1), (12, 3, 'Q Bravo', 1), (13, 4, 'Q Charlie', 1), (14, 5, 'Q Delta', 1), (15, 6, 'Q Golf', 1), (16, 7, 'Q Hotel', 1),
 (21, 2, 'V Mike', 2), (22, 3, 'V November', 2), (23, 4, 'V Oscar', 2), (24, 5, 'V Papa', 2), (25, 6, 'V Quebec', 2),
 (31, 2, 'R India', 3), (32, 3, 'R Juliet', 3), (33, 4, 'R Kilo', 3), (34, 5, 'R Lima', 3)
) as t(n, u, nm, lg);

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select t.league_id, t.owner_id, t.id, 'manager', false, 100
from teams t where t.id::text like 'c1040000-%';
insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance) values
 ('b1040000-0000-4000-8000-000000000001', '91040000-0000-4000-8000-000000000001', null, 'commissioner', false, null),
 ('b1040000-0000-4000-8000-000000000001', '91040000-0000-4000-8000-000000000008', null, 'co_commissioner', false, null),
 ('b1040000-0000-4000-8000-000000000002', '91040000-0000-4000-8000-000000000001', null, 'commissioner', false, null),
 ('b1040000-0000-4000-8000-000000000003', '91040000-0000-4000-8000-000000000001', null, 'commissioner', false, null);

insert into league_weeks (league_id, season, week)
select l.id, 2026, w from leagues l cross join generate_series(1, 12) w where l.id::text like 'b1040000-%';

insert into players (id, full_name, position, team, status)
select p.id, p.nm, 'QB', p.tm, 'Active'
from (values
 ('cx-a1', 'Q A One', 'TXC'), ('cx-a2', 'Q A Two', 'TXC'), ('cx-a3', 'Q A Three', 'TXA'),
 ('cx-b1', 'Q B One', 'TXC'), ('cx-b2', 'Q B Two', 'TXC'),
 ('cx-c1', 'Q C One', 'TXC'), ('cx-c2', 'Q C Two', 'TXC'), ('cx-c3', 'Q C Three', 'TXC'),
 ('cx-d1', 'Q D One', 'TXC'), ('cx-d2', 'Q D Two', 'TXC'),
 ('cx-g1', 'Q G One', 'TXC'), ('cx-g2', 'Q G Two', 'TXC'),
 ('cx-h1', 'Q H One', 'TXC'), ('cx-h2', 'Q H Two', 'TXC'), ('cx-h3', 'Q H Three', 'TXC'),
 ('cx-m1', 'V M One', 'TXC'), ('cx-n1', 'V N One', 'TXC'), ('cx-o1', 'V O One', 'TXC'), ('cx-p1', 'V P One', 'TXC'), ('cx-q1', 'V Q One', 'TXC'),
 ('cx-i1', 'R I One', 'TXC'), ('cx-i2', 'R I Two', 'TXC'), ('cx-i3', 'R I Three', 'TXC'),
 ('cx-j1', 'R J One', 'TXC'), ('cx-j2', 'R J Two', 'TXC'), ('cx-j3', 'R J Three', 'TXC'),
 ('cx-k1', 'R K One', 'TXC'), ('cx-k2', 'R K Two', 'TXC'), ('cx-k3', 'R K Three', 'TXC'), ('cx-l1', 'R L One', 'TXC'), ('cx-l2', 'R L Two', 'TXC')
) as p(id, nm, tm);

insert into league_rosters (league_id, team_id, player_id, slot_key)
select t.league_id, t.id, r.pid, 'bn'
from (values
 ('Q Alpha', 'cx-a1'), ('Q Alpha', 'cx-a2'), ('Q Alpha', 'cx-a3'), ('Q Bravo', 'cx-b1'), ('Q Bravo', 'cx-b2'),
 ('Q Charlie', 'cx-c1'), ('Q Charlie', 'cx-c2'), ('Q Charlie', 'cx-c3'), ('Q Delta', 'cx-d1'), ('Q Delta', 'cx-d2'),
 ('Q Golf', 'cx-g1'), ('Q Golf', 'cx-g2'), ('Q Hotel', 'cx-h1'), ('Q Hotel', 'cx-h2'), ('Q Hotel', 'cx-h3'),
 ('V Mike', 'cx-m1'), ('V November', 'cx-n1'), ('V Oscar', 'cx-o1'), ('V Papa', 'cx-p1'), ('V Quebec', 'cx-q1'),
 ('R India', 'cx-i1'), ('R India', 'cx-i2'), ('R India', 'cx-i3'), ('R Juliet', 'cx-j1'), ('R Juliet', 'cx-j2'), ('R Juliet', 'cx-j3'),
 ('R Kilo', 'cx-k1'), ('R Kilo', 'cx-k2'), ('R Lima', 'cx-l1'), ('R Lima', 'cx-l2')
) as r(team, pid)
join teams t on t.name = r.team and t.id::text like 'c1040000-%';
insert into league_player_pool (league_id, player_id, state, waivers_until, updated_at)
select r.league_id, r.player_id, 'rostered', null, '2026-10-01 00:00:00+00' from league_rosters r where r.player_id like 'cx-%';

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

create temp table r104 (tag text primary key, r jsonb not null);
grant select, insert on r104 to authenticated, anon;
create function pg_temp.uid(p_n int) returns uuid language sql as $$ select ('91040000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(p_n int) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p_n), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.team(p_name text) returns uuid language sql as $$ select id from teams where name = p_name and id::text like 'c1040000-%' $$;
create function pg_temp.lg(p_n int) returns uuid language sql as $$ select ('b1040000-0000-4000-8000-00000000000' || p_n)::uuid $$;
create function pg_temp.act(p_n int) returns uuid language sql as $$ select ('a1040000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid $$;
create function pg_temp.leg(p_player text, p_team text) returns jsonb language sql as $$ select jsonb_build_object('player_id', p_player, 'from_team_id', pg_temp.team(p_team)) $$;
create function pg_temp.cash(p_amount int, p_team text) returns jsonb language sql as $$ select jsonb_build_object('faab_amount', p_amount, 'from_team_id', pg_temp.team(p_team)) $$;
create function pg_temp.prop(p_tag text, p_lg int, p_user int, p_from text, p_to text, p_items jsonb, p_at timestamptz, p_act int)
returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r104 select p_tag, public.trade_propose_internal(pg_temp.lg(p_lg), pg_temp.team(p_from), pg_temp.team(p_to), p_items, null, null, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select (r #>> '{trade,id}')::uuid from r104 where tag = p_tag);
end $$;
create function pg_temp.tid(p_tag text) returns uuid language sql as $$ select (r #>> '{trade,id}')::uuid from r104 where tag = p_tag $$;
create function pg_temp.accept(p_tag text, p_lg int, p_user int, p_trade text, p_drops text[], p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r104 select p_tag, public.trade_respond_internal(pg_temp.lg(p_lg), pg_temp.tid(p_trade), 'accept', p_drops, null, null, pg_temp.act(p_act), p_at, null);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r104 where tag = p_tag);
end $$;
-- cx(tag, league, actor, trade tag, op, reason, at, action) — the commissioner verb, result kept under tag.
create function pg_temp.cx(p_tag text, p_lg int, p_user int, p_trade text, p_op text, p_reason text, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  insert into r104 select p_tag, public.commish_force_or_reverse_trade_internal(pg_temp.lg(p_lg), pg_temp.tid(p_trade), p_op, pg_temp.act(p_act), p_at, p_reason);
  perform set_config('request.jwt.claims', '', true);
  return (select r from r104 where tag = p_tag);
end $$;
-- a call whose refusal is asserted (nothing is kept).
create function pg_temp.try_cx(p_lg int, p_user int, p_trade text, p_op text, p_at timestamptz, p_act int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p_user);
  return public.commish_force_or_reverse_trade_internal(pg_temp.lg(p_lg), pg_temp.tid(p_trade), p_op, pg_temp.act(p_act), p_at, null);
end $$;
create function pg_temp.st(p_tag text) returns text language sql as $$ select t.status || '|' || coalesce(t.status_reason, '-') from trades t where t.id = pg_temp.tid(p_tag) $$;
create function pg_temp.roster(p_team text) returns text language sql as $$
  select coalesce(string_agg(r.player_id, ',' order by r.player_id), '') from league_rosters r where r.team_id = pg_temp.team(p_team) $$;
create function pg_temp.bal(p_team text) returns text language sql as $$
  select coalesce(m.faab_balance::text, 'NULL') from league_members m where m.team_id = pg_temp.team(p_team) $$;
-- exclusivity: every fixture player of a league on AT MOST one roster, and the pool mirror agrees.
create function pg_temp.exclusive(p_lg int) returns boolean language sql as $$
  select (select count(*) = count(distinct player_id) from league_rosters where league_id = pg_temp.lg(p_lg))
     and not exists (select 1 from league_rosters r join league_player_pool pp on pp.league_id = r.league_id and pp.player_id = r.player_id
                     where r.league_id = pg_temp.lg(p_lg) and pp.state <> 'rostered') $$;
-- the receipt footprint of a league: audit rows | system posts | commissioner notifications | ledger rows.
create function pg_temp.counts(p_lg int) returns text language sql as $$
  select concat_ws('|',
    (select count(*) from commissioner_actions where league_id = pg_temp.lg(p_lg) and action_type like '%\_trade' and metadata ->> 'verb' = 'commish_force_or_reverse_trade'),
    (select count(*) from league_chat where league_id = pg_temp.lg(p_lg) and is_system and message like '%(commissioner)%'),
    (select count(*) from notifications where type = 'league_trade_commissioner' and data ->> 'league_id' = pg_temp.lg(p_lg)::text),
    (select count(*) from commish_trade_actions where league_id = pg_temp.lg(p_lg))) $$;

-- L1's trades. T1 Alpha a1 ↔ Bravo b1 and T3 Alpha a3 ↔ Delta d2 go into
-- review; T2 Alpha a3 ↔ Delta d1 too (two offers may name one player).
select pg_temp.prop('T1', 1, 2, 'Q Alpha', 'Q Bravo', jsonb_build_array(pg_temp.leg('cx-a1', 'Q Alpha'), pg_temp.leg('cx-b1', 'Q Bravo')), '2026-10-21 11:00:00+00', 1);
select pg_temp.accept('T1a', 1, 3, 'T1', null, '2026-10-21 12:00:00+00', 2);
select pg_temp.prop('T2', 1, 2, 'Q Alpha', 'Q Delta', jsonb_build_array(pg_temp.leg('cx-a3', 'Q Alpha'), pg_temp.leg('cx-d1', 'Q Delta')), '2026-10-22 11:00:00+00', 3);
select pg_temp.accept('T2a', 1, 5, 'T2', null, '2026-10-22 12:00:00+00', 4);
select pg_temp.prop('T3', 1, 2, 'Q Alpha', 'Q Delta', jsonb_build_array(pg_temp.leg('cx-a3', 'Q Alpha'), pg_temp.leg('cx-d2', 'Q Delta')), '2026-10-22 11:05:00+00', 5);
select pg_temp.accept('T3a', 1, 5, 'T3', null, '2026-10-22 12:05:00+00', 6);
select is(
  (select string_agg(format('%s:%s', x.tag, t.status), ' ' order by x.tag)
   from (values ('T1'), ('T2'), ('T3')) as x(tag) join trades t on t.id = pg_temp.tid(x.tag))
    || ' / ' || pg_temp.counts(1),
  'T1:in_review T2:in_review T3:in_review / 0|0|0|0',
  'B1 PREMISE: three L1 trades in review (commissioner review), no commissioner receipt anywhere');

-- ---------------------------------------------------------------------------
-- C. WHO MAY ACT — a commissioner of THIS league, nobody else (one no-leak
--    42501); the ledger is closed to every role.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  format('select public.commish_force_or_reverse_trade(%L, %L, %L, null, %L)', pg_temp.lg(1), pg_temp.tid('T1'), 'approve', pg_temp.act(100)),
  '42501', null, 'C1 ANON cannot even execute the door (EXECUTE revoked)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(9), 'role', 'authenticated')::text, true);
select throws_ok(
  format('select public.commish_force_or_reverse_trade(%L, %L, %L, null, %L)', pg_temp.lg(1), pg_temp.tid('T1'), 'approve', pg_temp.act(101)),
  '42501', 'commish_force_or_reverse_trade: not a commissioner of this league',
  'C2 a NON-member gets the one no-leak 42501');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(3), 'role', 'authenticated')::text, true);
select throws_ok(
  format('select public.commish_force_or_reverse_trade(%L, %L, %L, null, %L)', pg_temp.lg(1), pg_temp.tid('T1'), 'force', pg_temp.act(102)),
  '42501', 'commish_force_or_reverse_trade: not a commissioner of this league',
  'C3 the manager of a team IN the trade cannot force it — same 42501');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(4), 'role', 'authenticated')::text, true);
select throws_ok(
  format('select public.commish_force_or_reverse_trade(%L, %L, %L, null, %L)', pg_temp.lg(1), pg_temp.tid('T1'), 'veto', pg_temp.act(103)),
  '42501', 'commish_force_or_reverse_trade: not a commissioner of this league',
  'C4 another manager of the league cannot veto it — same 42501');
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(1), 'role', 'authenticated')::text, true);
select throws_ok(
  format('select public.commish_force_or_reverse_trade(%L, %L, %L, null, %L)', 'b1040000-0000-4000-8000-0000000000ff', pg_temp.tid('T1'), 'approve', pg_temp.act(104)),
  '42501', 'commish_force_or_reverse_trade: not a commissioner of this league',
  'C5 a league that does not exist answers the same 42501 (no existence leak)');
select throws_ok(
  format('select public.commish_force_or_reverse_trade(%L, %L, %L, null, %L)', pg_temp.lg(1), pg_temp.tid('T1'), 'undo', pg_temp.act(105)),
  '22023', 'commish_force_or_reverse_trade: op undo is not one of approve / veto / force / reverse (§10.1 / §13.3)',
  'C6 a malformed op is refused by name (22023), never a no-op');
reset role;
select is(
  (select string_agg(format('%s:%s', x.tag, t.status), ' ' order by x.tag)
   from (values ('T1'), ('T2'), ('T3')) as x(tag) join trades t on t.id = pg_temp.tid(x.tag))
    || ' / ' || pg_temp.counts(1) || ' / ' || pg_temp.roster('Q Alpha') || ' ' || pg_temp.roster('Q Bravo'),
  'T1:in_review T2:in_review T3:in_review / 0|0|0|0 / cx-a1,cx-a2,cx-a3 cx-b1,cx-b2',
  'C7 the refusals wrote NOTHING: every trade still in review, no receipt, post, notification or ledger row, rosters as they were');

-- ---------------------------------------------------------------------------
-- D. APPROVE (F436) — the executor runs the trade; the verb moves nothing.
-- ---------------------------------------------------------------------------
select pg_temp.cx('D1', 1, 1, 'T1', 'approve', null, '2026-10-21 13:00:00+00', 10);
select is(
  (select concat_ws('|', r ->> 'op', r ->> 'outcome', r ->> 'status_before', r ->> 'status', r #>> '{execution,via}', r ->> 'bypassed',
                    r ->> 'no_changes', coalesce(r ->> 'reason', 'NULL'), (r ->> 'commissioner_action_id') is not null) from r104 where tag = 'D1'),
  'approve|approved|in_review|complete|commissioner_approve|[]|false|NULL|t',
  'D1 the commissioner approves a trade in review before its deadline: the executor runs it at once, via commissioner_approve; nothing bypassed; one receipt');
select is(
  pg_temp.roster('Q Alpha') || ' / ' || pg_temp.roster('Q Bravo') || ' / '
    || (select count(*) from transactions where type = 'trade' and payload ->> 'trade_id' = pg_temp.tid('T1')::text) || ' / '
    || pg_temp.exclusive(1),
  'cx-a2,cx-a3,cx-b1 / cx-a1,cx-b2 / 1 / true',
  'D2 …the executor moved the players (one trade transactions row), and exclusivity holds');
select is(
  (select format('%s|%s|%s|%s|%s|%s', ca.action_type, ca.target_type, ca.target_id = pg_temp.tid('T1')::text, ca.before, ca.after,
                 coalesce(ca.acting_as_team_id::text, 'NULL'))
   from commissioner_actions ca where ca.id = (select (r ->> 'commissioner_action_id')::uuid from r104 where tag = 'D1')),
  'approve_trade|trade|t|{"status": "in_review"}|{"status": "complete"}|NULL',
  'D3 ONE audit row: approve_trade on the trade, {status} before / after, not acting as any team');
select is(
  (select r ->> 'system_post' from r104 where tag = 'D1')
    || ' / ' || (select string_agg(n.user_id::text, ',' order by n.user_id) from notifications n
                 where n.type = 'league_trade_commissioner' and n.data ->> 'trade_id' = pg_temp.tid('T1')::text),
  'cx_user1 (commissioner) approved a trade: Q Alpha gives Q A One; Q Bravo gives Q B One / '
    || pg_temp.uid(2) || ',' || pg_temp.uid(3),
  'D4 the §10.3 post (no reason clause — none given) and BOTH managers told');
select pg_temp.cx('D5', 1, 1, 'T1', 'approve', 'again', '2026-10-21 13:05:00+00', 11);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'no_changes', coalesce(r ->> 'commissioner_action_id', 'NULL'), r ->> 'no_changes_why') from r104 where tag = 'D5')
    || ' / ' || pg_temp.counts(1),
  'no_change|true|NULL|already_complete — the trade already went through, so nothing was written and no receipt was issued (PROGRESS standing rule (b)) / 1|1|2|2',
  'D5 approving a completed trade is a NO-OP: no receipt, post or notification — the ledger row only');
-- T2: Q A Three (TXA) kicked off Thu 00:15Z — the approve waits for the lock (Q75).
select pg_temp.cx('D6', 1, 1, 'T2', 'approve', null, '2026-10-23 06:00:00+00', 12);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status', r #>> '{execution,outcome}', (r #>> '{trade,execute_after}')::timestamptz = '2026-10-27 03:30:00+00')
   from r104 where tag = 'D6')
    || ' / ' || pg_temp.roster('Q Alpha') || ' ' || pg_temp.roster('Q Delta')
    || ' / ' || (select after::text from commissioner_actions where id = (select (r ->> 'commissioner_action_id')::uuid from r104 where tag = 'D6')),
  'approved_deferred|accepted|deferred|t / cx-a2,cx-a3,cx-b1 cx-d1,cx-d2 / {"status": "accepted"}',
  'D6 an approve while a player is locked: the executor parks it until the week''s last game ends (Q75) — nothing moved; the receipt says accepted');
select pg_temp.cx('D7', 1, 8, 'T2', 'approve', null, '2026-10-23 06:30:00+00', 13);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'no_changes_why') from r104 where tag = 'D7') || ' / ' || pg_temp.counts(1),
  'no_change|already_approved — its review is over and it is waiting to go through right after the week''s last game ends (Q75 / E35); force puts it through now, so nothing was written and no receipt was issued (PROGRESS standing rule (b)) / 2|2|4|4',
  'D7 the CO-commissioner approving the waiting trade again is a no-op that says force is the way through now');

-- ---------------------------------------------------------------------------
-- E. VETO — in review, or waiting for the lock (F436); the no-op.
-- ---------------------------------------------------------------------------
select pg_temp.cx('E1', 1, 1, 'T2', 'veto', E'  collusion \t', '2026-10-23 07:00:00+00', 20);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status_before', r ->> 'status', r ->> 'reason') from r104 where tag = 'E1')
    || ' / ' || pg_temp.st('T2') || ' / ' || (select resolved_by = pg_temp.uid(1) from trades where id = pg_temp.tid('T2')),
  'vetoed|accepted|vetoed|collusion / vetoed|vetoed by the commissioner — collusion / true',
  'E1 F436: a trade WAITING for the lock (accepted, execute_after set) is vetoed with its reason (trimmed), resolved by the commissioner');
select is(
  (select r ->> 'system_post' from r104 where tag = 'E1')
    || ' / ' || (select format('%s|%s|%s', ca.action_type, ca.before, ca.after) from commissioner_actions ca
                 where ca.id = (select (r ->> 'commissioner_action_id')::uuid from r104 where tag = 'E1'))
    || ' / ' || pg_temp.roster('Q Alpha') || ' ' || pg_temp.roster('Q Delta'),
  'cx_user1 (commissioner) vetoed a trade: Q Alpha gives Q A Three; Q Delta gives Q D One — reason: collusion / veto_trade|{"status": "accepted"}|{"status": "vetoed"} / cx-a2,cx-a3,cx-b1 cx-d1,cx-d2',
  'E2 the post carries the reason; ONE veto_trade receipt; nobody moved');
select is(pg_temp.counts(1), '3|3|6|5', 'E3 premise for the no-op: 3 receipts, 3 posts, 6 notifications, 5 ledger rows');
select pg_temp.cx('E4', 1, 1, 'T2', 'veto', 'twice', '2026-10-23 07:05:00+00', 21);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'no_changes', coalesce(r ->> 'commissioner_action_id', 'NULL'), coalesce(r ->> 'system_post', 'NULL'))
   from r104 where tag = 'E4') || ' / ' || pg_temp.counts(1) || ' / ' || pg_temp.st('T2'),
  'no_change|true|NULL|NULL / 3|3|6|6 / vetoed|vetoed by the commissioner — collusion',
  'E4 THE NO-OP (task text): vetoing a vetoed trade writes NOTHING — no receipt, post or notification, the reason unchanged; only the ledger row');
select throws_ok($$ select pg_temp.try_cx(1, 1, 'T1', 'veto', '2026-10-23 07:10:00+00', 22) $$,
  'P0001', 'commish_force_or_reverse_trade: this trade already went through, so it cannot be vetoed — reverse it instead (op reverse)',
  'E5 a completed trade cannot be vetoed — the refusal points at reverse');

-- ---------------------------------------------------------------------------
-- F. FORCE — past the lock, past the deadline; validity still binds.
-- ---------------------------------------------------------------------------
-- T3: Q A Three kicked off Thu 00:15Z and the week is still being played;
-- he starts for Alpha in week 7.
update team_lineups set slot_map = '{"qb:0": "cx-a3"}', starters = '[{"slot": "qb:0", "player_id": "cx-a3"}]', bench = '["cx-a2", "cx-b1"]'
where team_id = pg_temp.team('Q Alpha') and week = 7;
insert into team_lineups (team_id, season, week, slot_map, starters, bench)
select pg_temp.team('Q Alpha'), 2026, 7, '{"qb:0": "cx-a3"}', '[{"slot": "qb:0", "player_id": "cx-a3"}]', '["cx-a2", "cx-b1"]'
where not exists (select 1 from team_lineups where team_id = pg_temp.team('Q Alpha') and week = 7);
insert into team_lineups (team_id, season, week, slot_map, starters, bench)
values (pg_temp.team('Q Delta'), 2026, 7, '{"qb:0": "cx-d1"}', '[{"slot": "qb:0", "player_id": "cx-d1"}]', '["cx-d2"]');
-- R1228: week 7 is being scored (live) and both players have stat lines,
-- each with its own ingestion stamp.
update league_weeks set status = 'live' where league_id = pg_temp.lg(1) and season = 2026 and week = 7;
insert into player_stats (player_id, season, week, stat_type, pass_yards, updated_at) values
 ('cx-a3', 2026, 7, 'weekly', 310, '2026-10-23 03:10:00+00'),
 ('cx-d1', 2026, 7, 'weekly', 0,   '2026-10-23 03:20:00+00');
select pg_temp.cx('F1', 1, 1, 'T3', 'force', 'manager away', '2026-10-23 08:00:00+00', 30);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status_before', r ->> 'status', r #>> '{execution,via}', r ->> 'bypassed') from r104 where tag = 'F1')
    || ' / ' || pg_temp.roster('Q Alpha') || ' ' || pg_temp.roster('Q Delta') || ' / ' || pg_temp.exclusive(1),
  'forced|in_review|complete|commissioner_force|["review_period", "game_day_lock:cx-a3"] / cx-a2,cx-b1,cx-d2 cx-a3,cx-d1 / true',
  'F1 FORCE goes through NOW, past the review and past the game-day lock (Q A Three had kicked off), and names both; exclusivity holds');
select is(
  (select slot_map::text || ' ' || bench::text from team_lineups where team_id = pg_temp.team('Q Alpha') and week = 7)
    || ' / ' || (select slot_map::text || ' ' || bench::text from team_lineups where team_id = pg_temp.team('Q Delta') and week = 7)
    || ' / ' || (select payload ->> 'lineup_from_week' from transactions where type = 'trade' and payload ->> 'trade_id' = pg_temp.tid('T3')::text),
  '{} ["cx-a2", "cx-b1", "cx-d2"] / {"qb:0": "cx-d1"} ["cx-a3"] / 7',
  'F2 the week is still being played, so the move starts THIS week: Q A Three leaves Alpha''s week-7 starting slot (F440 — a deliberate move is not second-guessed) for Delta''s bench, Q D Two the other way');
select is(
  (select concat_ws('|', r ->> 'score_week', r ->> 'score_week_status', r ->> 'score_rescore', r ->> 'score_enqueued', r ->> 'score_reach_enqueued',
                    r ->> 'score_reachable', r ->> 'score_stale', r ->> 'edited_by_commish') from r104 where tag = 'F1')
    || ' / ' || (select enqueued_at::text from score_fanout where season = 2026 and week = 7 and player_id = 'cx-a3')
    || ' / ' || (select string_agg(tm.name || '=' || tl.edited_by_commish, ',' order by tm.name) from team_lineups tl join teams tm on tm.id = tl.team_id
                 where tl.team_id in (pg_temp.team('Q Alpha'), pg_temp.team('Q Delta')) and tl.week = 7)
    || ' / ' || (select ca.metadata ->> 'score_enqueued' from commissioner_actions ca where ca.id = (select (r ->> 'commissioner_action_id')::uuid from r104 where tag = 'F1')),
  '7|live|["cx-a3"]|["cx-a3"]|["cx-d1"]|true|false|true / 2026-10-23 03:10:00+00 / Q Alpha=true,Q Delta=true / ["cx-a3"]',
  'F2b R1228 THE SCORE FOLLOWS: the played starter who left a LIVE week is queued with HIS OWN stat stamp (never now()), the reach set too, both changed week-7 rows flagged edited_by_commish (the drain recomputes the teams), the score keys on the result and the receipt');
-- T5: Charlie c1 ↔ Bravo b2, offered before the deadline; the deadline
-- (week 8 starts Wed 10-28 04:00Z) expires it; the commissioner forces it.
select pg_temp.prop('T5', 1, 4, 'Q Charlie', 'Q Bravo', jsonb_build_array(pg_temp.leg('cx-c1', 'Q Charlie'), pg_temp.leg('cx-b2', 'Q Bravo')), '2026-10-27 12:00:00+00', 31);
select pg_temp.prop('T13', 1, 6, 'Q Golf', 'Q Charlie', jsonb_build_array(pg_temp.leg('cx-g2', 'Q Golf'), pg_temp.leg('cx-c3', 'Q Charlie')), '2026-10-27 12:05:00+00', 69);
insert into r104 select 'F3t', public.trade_tick('2026-10-28 04:00:00+00', pg_temp.lg(1));
select is(pg_temp.st('T5'),
  'expired|the trade deadline passed — offers could be accepted until week 8 began (Wed 2026-10-28 04:00 UTC; trade_deadline_week 7, §13.3 / Q76)',
  'F3 premise: the offer EXPIRED at the deadline');
select pg_temp.cx('F4', 1, 1, 'T5', 'force', null, '2026-10-28 05:00:00+00', 32);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status_before', r ->> 'status', r ->> 'bypassed', r ->> 'accepted_for_team_id' = pg_temp.team('Q Bravo')::text)
   from r104 where tag = 'F4')
    || ' / ' || (select format('%s|%s', accepted_by = pg_temp.uid(1), accepted_at = '2026-10-28 05:00:00+00') from trades where id = pg_temp.tid('T5'))
    || ' / ' || pg_temp.roster('Q Charlie') || ' ' || pg_temp.roster('Q Bravo') || ' / ' || pg_temp.exclusive(1),
  'forced|expired|complete|["trade_deadline"]|t / t|t / cx-b2,cx-c2,cx-c3 cx-a1,cx-c1 / true',
  'F4 an offer the DEADLINE expired is forced through: the commissioner accepts it for the receiving team and it executes; the deadline is named');
-- T6: Golf g1 + g2 → Hotel (full), Hotel h1 → Golf: offered, Hotel named no drops.
select pg_temp.prop('T6', 1, 6, 'Q Golf', 'Q Hotel', jsonb_build_array(pg_temp.leg('cx-g1', 'Q Golf'), pg_temp.leg('cx-g2', 'Q Golf'), pg_temp.leg('cx-h1', 'Q Hotel')), '2026-10-21 11:00:00+00', 33);
select throws_ok($$ select pg_temp.try_cx(1, 1, 'T6', 'force', '2026-10-21 12:00:00+00', 34) $$,
  'P0001', 'commish_force_or_reverse_trade: Q Hotel''s roster would hold 4 players after this trade — 1 more than its 3 spots (§7.3.2 roster_size) — and nobody has named its drops; nothing was changed: free room first with commish_force_add_drop, then force it again (a roster over its league''s size binds the commissioner too)',
  'F5 VALIDITY BINDS HIM (rule (i)): forcing an offer that overflows the receiving roster is refused BY NAME');
select is(
  pg_temp.st('T6') || ' / ' || pg_temp.roster('Q Golf') || ' ' || pg_temp.roster('Q Hotel') || ' / ' || pg_temp.counts(1),
  'proposed|- / cx-g1,cx-g2 cx-h1,cx-h2,cx-h3 / 5|5|10|8',
  'F6 …and nothing was written: still proposed, rosters as they were, no receipt');
-- T7: Golf g1 ↔ Hotel h2, then g1 leaves Golf (E37 would invalidate it — the
-- trigger is disabled for this one statement to reach the executor's own check).
select pg_temp.prop('T7', 1, 6, 'Q Golf', 'Q Hotel', jsonb_build_array(pg_temp.leg('cx-g1', 'Q Golf'), pg_temp.leg('cx-h2', 'Q Hotel')), '2026-10-21 11:10:00+00', 35);
select pg_temp.accept('T7a', 1, 7, 'T7', null, '2026-10-21 11:20:00+00', 36);
alter table league_rosters disable trigger trg_trade_invalidate_on_roster_move;
update league_rosters set team_id = pg_temp.team('Q Delta') where player_id = 'cx-g1';
alter table league_rosters enable always trigger trg_trade_invalidate_on_roster_move;
select throws_ok($$ select pg_temp.try_cx(1, 1, 'T7', 'force', '2026-10-21 12:00:00+00', 37) $$,
  'P0001', 'commish_force_or_reverse_trade: the trade cannot go through as it stands — Q G One (cx-g1) is on Q Delta''s roster, not Q Golf''s — a trade can only move a player from the team that has him (player exclusivity, §13.3 / CLAUDE.md rule 7) — nothing was changed; a trade must leave both rosters legal, which binds the commissioner too (standing rule (i)): make room with commish_force_add_drop or move players with commish_move_player',
  'F7 the executor''s re-validation binds the force: a player no longer on the giving team refuses it BY NAME');
select is(pg_temp.st('T7') || ' / ' || pg_temp.counts(1), 'in_review|- / 5|5|10|8',
  'F8 …the refusal rolled the executor''s invalidation back with everything else: the trade is still in review, no receipt');
update league_rosters set team_id = pg_temp.team('Q Golf') where player_id = 'cx-g1';
select throws_ok($$ select pg_temp.try_cx(1, 1, 'T2', 'force', '2026-10-23 09:00:00+00', 38) $$,
  'P0001', 'commish_force_or_reverse_trade: this trade cannot be forced — it was vetoed (vetoed by the commissioner — collusion); to move these players use commish_move_player',
  'F9 a vetoed trade is a decision, not a timing rule — force refuses it BY NAME');
select throws_ok($$ select pg_temp.try_cx(1, 1, 'T13', 'approve', '2026-10-28 06:00:00+00', 39) $$,
  'P0001', 'commish_force_or_reverse_trade: this offer expired at the trade deadline before it was accepted, so there is no review to approve — force puts it through (op force)',
  'F10 R1230: approving an offer the DEADLINE expired points at force (the deadline is a timing rule)');
-- T14: Delta a3 (kicked off, week 7 not over) ↔ Hotel h3, in review; the
-- league switches to failing locked trades.
select pg_temp.prop('T14', 1, 5, 'Q Delta', 'Q Hotel', jsonb_build_array(pg_temp.leg('cx-a3', 'Q Delta'), pg_temp.leg('cx-h3', 'Q Hotel')), '2026-10-23 09:00:00+00', 70);
select pg_temp.accept('T14a', 1, 7, 'T14', null, '2026-10-23 09:10:00+00', 71);
update leagues set settings = settings || '{"trade_lock_behavior": "reject"}'::jsonb where id = pg_temp.lg(1);
select throws_ok($$ select pg_temp.try_cx(1, 1, 'T14', 'approve', '2026-10-23 10:00:00+00', 72) $$,
  'P0001', 'commish_force_or_reverse_trade: Q A Three already kicked off this week, and this league fails a locked trade instead of waiting (trade_lock_behavior = reject) — nothing was changed; force puts it through now (op force)',
  'F11 R1230: an approve refused for a LOCKED player (trade_lock_behavior = reject) names the player and points at force — not at room or moves');
select is(pg_temp.st('T14') || ' / ' || pg_temp.roster('Q Delta') || ' ' || pg_temp.roster('Q Hotel'),
  'in_review|- / cx-a3,cx-d1 cx-h1,cx-h2,cx-h3',
  'F12 …and nothing was written: still in review, nobody moved');
update leagues set settings = settings - 'trade_lock_behavior' where id = pg_temp.lg(1);

-- ---------------------------------------------------------------------------
-- V. A LEAGUE-VOTE TRADE IN REVIEW (D415): the commissioner decides.
-- ---------------------------------------------------------------------------
select pg_temp.prop('W1', 2, 2, 'V Mike', 'V November', jsonb_build_array(pg_temp.leg('cx-m1', 'V Mike'), pg_temp.leg('cx-n1', 'V November')), '2026-10-21 11:00:00+00', 40);
select pg_temp.accept('W1a', 2, 3, 'W1', null, '2026-10-21 12:00:00+00', 41);
select pg_temp.prop('W2', 2, 4, 'V Oscar', 'V Papa', jsonb_build_array(pg_temp.leg('cx-o1', 'V Oscar'), pg_temp.leg('cx-p1', 'V Papa')), '2026-10-21 11:00:00+00', 42);
select pg_temp.accept('W2a', 2, 5, 'W2', null, '2026-10-21 12:00:00+00', 43);
select pg_temp.as_user(6);
select public.trade_vote_internal(pg_temp.lg(2), pg_temp.tid('W1'), 'veto', pg_temp.act(44), '2026-10-21 12:30:00+00');
select set_config('request.jwt.claims', '', true);
select pg_temp.cx('V1', 2, 1, 'W1', 'approve', null, '2026-10-21 13:00:00+00', 45);
select is(
  (select concat_ws('|', r ->> 'trade_review', r ->> 'outcome', r ->> 'status', r ->> 'bypassed') from r104 where tag = 'V1')
    || ' / ' || pg_temp.roster('V Mike') || ' ' || pg_temp.roster('V November'),
  'league_vote|approved|complete|["league_vote"] / cx-n1 cx-m1',
  'V1 a league-vote trade in review with a veto vote cast: the commissioner approves it and it goes through — the vote stopped counting, and that is named');
select pg_temp.cx('V2', 2, 1, 'W2', 'veto', null, '2026-10-21 13:00:00+00', 46);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'bypassed') from r104 where tag = 'V2') || ' / ' || pg_temp.st('W2')
    || ' / ' || pg_temp.roster('V Oscar') || ' ' || pg_temp.roster('V Papa'),
  'vetoed|["league_vote"] / vetoed|vetoed by the commissioner / cx-o1 cx-p1',
  'V2 …and vetoes another with no reason given: closed vetoed, the vote superseded, nobody moved');
insert into r104 select 'V3t', public.trade_tick('2026-10-22 12:00:00+00', pg_temp.lg(2));
select is(
  (select format('%s|%s', r ->> 'executed', r ->> 'reason') from r104 where tag = 'V3t') || ' / ' || pg_temp.roster('V Oscar'),
  '0|no_trades_in_flight / cx-o1',
  'V3 at the review deadline the tick runs NEITHER — both are settled (the vetoed one is never executed)');
-- R1232: M One goes back to Mike by another route; reversing W1 skips him.
update league_rosters set team_id = pg_temp.team('V Mike') where player_id = 'cx-m1' and league_id = pg_temp.lg(2);
select pg_temp.cx('V4', 2, 1, 'W1', 'reverse', null, '2026-10-22 13:00:00+00', 47);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status', r #>> '{reversal,players_already_back,0,player_id}', r #>> '{reversal,players,0,player_id}')
   from r104 where tag = 'V4') || ' / ' || pg_temp.roster('V Mike') || ' ' || pg_temp.roster('V November') || ' / ' || pg_temp.exclusive(2),
  'reversed|reversed|cx-m1|cx-n1 / cx-m1 cx-n1 / true',
  'V4 R1232: a player the trade moved who is ALREADY BACK on the team that gave him is skipped (like a drop already back); the rest is reversed');

-- ---------------------------------------------------------------------------
-- G. REVERSE — E11's happy path: rosters, the dropped player and the FAAB
--    legs restored atomically; past weeks untouched; one receipt.
-- ---------------------------------------------------------------------------
-- T9 (L3, no review — it executes at acceptance, Wed 10-21 12:00Z, week 7):
-- India gives i1 + i2 → Juliet; Juliet gives j1 + $15 → India; Juliet (full)
-- drops j3 to make room.
select pg_temp.prop('T9', 3, 2, 'R India', 'R Juliet',
  jsonb_build_array(pg_temp.leg('cx-i1', 'R India'), pg_temp.leg('cx-i2', 'R India'), pg_temp.leg('cx-j1', 'R Juliet'), pg_temp.cash(15, 'R Juliet')),
  '2026-10-21 11:00:00+00', 50);
select pg_temp.accept('T9a', 3, 3, 'T9', array['cx-j3'], '2026-10-21 12:00:00+00', 51);
-- Juliet started I One in week 7 (finished) and again in week 8.
insert into team_lineups (team_id, season, week, slot_map, starters, bench) values
 (pg_temp.team('R Juliet'), 2026, 7, '{"qb:0": "cx-i1"}', '[{"slot": "qb:0", "player_id": "cx-i1"}]', '["cx-i2", "cx-j2"]'),
 (pg_temp.team('R Juliet'), 2026, 8, '{"qb:0": "cx-i1"}', '[{"slot": "qb:0", "player_id": "cx-i1"}]', '["cx-i2", "cx-j2"]'),
 (pg_temp.team('R India'),  2026, 8, '{"qb:0": "cx-i3"}', '[{"slot": "qb:0", "player_id": "cx-i3"}]', '["cx-j1"]');
select is(
  pg_temp.st('T9') || ' / ' || pg_temp.roster('R India') || ' ' || pg_temp.roster('R Juliet') || ' / $' || pg_temp.bal('R India') || ' $' || pg_temp.bal('R Juliet')
    || ' / ' || (select state from league_player_pool where league_id = pg_temp.lg(3) and player_id = 'cx-j3'),
  'complete|- / cx-i3,cx-j1 cx-i1,cx-i2,cx-j2 / $115 $85 / on_waivers',
  'G1 PREMISE: the trade went through — India holds I Three and J One, Juliet I One, I Two and J Two; $15 moved; J Three dropped to waivers');
-- R1228: week 8 is being scored (live); I One has a stat line.
update league_weeks set status = 'live' where league_id = pg_temp.lg(3) and season = 2026 and week = 8;
insert into player_stats (player_id, season, week, stat_type, pass_yards, updated_at) values
 ('cx-i1', 2026, 8, 'weekly', 250, '2026-10-28 09:05:00+00');
select pg_temp.cx('G2', 3, 1, 'T9', 'reverse', 'made in error', '2026-10-28 10:00:00+00', 52);
select is(
  (select concat_ws('|', r ->> 'outcome', r ->> 'status_before', r ->> 'status', r ->> 'bypassed', r ->> 'reason') from r104 where tag = 'G2')
    || ' / ' || pg_temp.roster('R India') || ' ' || pg_temp.roster('R Juliet') || ' / $' || pg_temp.bal('R India') || ' $' || pg_temp.bal('R Juliet')
    || ' / ' || pg_temp.exclusive(3),
  'reversed|complete|reversed|[]|made in error / cx-i1,cx-i2,cx-i3 cx-j1,cx-j2,cx-j3 / $100 $100 / true',
  'G2 E11: both rosters restored — J Three, dropped for the trade, back on Juliet too — and the FAAB leg returned; exclusivity holds');
select is(
  (select slot_map::text from team_lineups where team_id = pg_temp.team('R Juliet') and week = 7)
    || ' / ' || (select slot_map::text || ' ' || bench::text from team_lineups where team_id = pg_temp.team('R Juliet') and week = 8)
    || ' / ' || (select slot_map::text || ' ' || bench::text from team_lineups where team_id = pg_temp.team('R India') and week = 8)
    || ' / ' || (select r #>> '{reversal,lineup_from_week}' from r104 where tag = 'G2'),
  '{"qb:0": "cx-i1"} / {} ["cx-j1", "cx-j2", "cx-j3"] / {"qb:0": "cx-i3"} ["cx-i1", "cx-i2"] / 8',
  'G3 PAST WEEKS UNTOUCHED: Juliet''s finished week-7 start stays; from week 8 on I One / I Two leave Juliet''s lineup and return to India''s bench, J One and J Three to Juliet''s');
select is(
  (select concat_ws('|', r ->> 'score_week', r ->> 'score_week_status', r ->> 'score_rescore', r ->> 'score_enqueued',
                    r ->> 'score_reachable', r ->> 'score_stale', r ->> 'edited_by_commish') from r104 where tag = 'G2')
    || ' / ' || (select enqueued_at::text from score_fanout where season = 2026 and week = 8 and player_id = 'cx-i1')
    || ' / ' || (select string_agg(tm.name || ':' || tl.week || '=' || coalesce(tl.edited_by_commish::text, 'null'), ',' order by tm.name, tl.week)
                 from team_lineups tl join teams tm on tm.id = tl.team_id
                 where tl.team_id in (pg_temp.team('R India'), pg_temp.team('R Juliet')))
    || ' / ' || (select ca.metadata ->> 'score_enqueued' from commissioner_actions ca where ca.id = (select (r ->> 'commissioner_action_id')::uuid from r104 where tag = 'G2')),
  '8|live|["cx-i1"]|["cx-i1"]|true|false|true / 2026-10-28 09:05:00+00 / R India:8=true,R Juliet:7=false,R Juliet:8=true / ["cx-i1"]',
  'G3b R1228 THE REVERSE''S SCORE FOLLOWS: I One left Juliet''s LIVE week-8 lineup — queued with his own stamp, the week-8 rows flagged; the finished week-7 row is NOT flagged (past weeks untouched); the score keys on the receipt');
select is(
  (select format('%s|%s|%s|%s', ca.action_type, ca.before, ca.after, ca.reason) from commissioner_actions ca
   where ca.id = (select (r ->> 'commissioner_action_id')::uuid from r104 where tag = 'G2'))
    || ' / ' || (select format('%s|%s|%s|%s', t.type, t.related_action_id::text = (select r ->> 'commissioner_action_id' from r104 where tag = 'G2'),
                               t.payload ? 'add_player_id', t.week)
                 from transactions t where t.id = (select (r ->> 'transaction_id')::uuid from r104 where tag = 'G2'))
    || ' / ' || (select string_agg(r.acquisition_type, ',' order by r.player_id) from league_rosters r where r.player_id in ('cx-i1', 'cx-i2', 'cx-j1', 'cx-j3')),
  'reverse_trade|{"status": "complete"}|{"status": "reversed"}|made in error / commissioner_move|t|f|8 / commissioner,commissioner,commissioner,commissioner',
  'G4 ONE reverse_trade receipt with the reason; ONE commissioner_move transactions row tied to it (no add_player_id — never an acquisition, TD9); returned players are commissioner acquisitions');
select is(
  (select r ->> 'system_post' from r104 where tag = 'G2') || ' / ' || pg_temp.counts(3)
    || ' / ' || (select state from league_player_pool where league_id = pg_temp.lg(3) and player_id = 'cx-j3'),
  'cx_user1 (commissioner) reversed a trade — every player and any FAAB are back with the team that had them before it: R India gives R I One, R I Two; R Juliet gives R J One, $15 FAAB — reason: made in error / 1|1|2|1 / rostered',
  'G5 the §10.3 post; one receipt, one post, both managers told, one ledger row; J Three''s pool mirror is rostered again');
select pg_temp.cx('G6', 3, 1, 'T9', 'reverse', null, '2026-10-28 10:05:00+00', 53);
select is(
  (select concat_ws('|', r ->> 'outcome', coalesce(r ->> 'commissioner_action_id', 'NULL')) from r104 where tag = 'G6') || ' / ' || pg_temp.counts(3)
    || ' / ' || pg_temp.roster('R India') || ' $' || pg_temp.bal('R India'),
  'no_change|NULL / 1|1|2|2 / cx-i1,cx-i2,cx-i3 $100',
  'G6 reversing a reversed trade is a NO-OP: nothing moves twice, no receipt — the ledger row only');
select pg_temp.cx('G7', 3, 1, 'T9', 'reverse', 'a different reason', '2026-10-29 10:00:00+00', 52);
select is(
  (select (select r::text from r104 where tag = 'G7') = (select r::text from r104 where tag = 'G2')) || ' / ' || pg_temp.counts(3),
  'true / 1|1|2|2',
  'G7 REPLAY of G2''s action id: byte-identical to the stored answer (even with another reason), nothing re-written');
select throws_ok($$ select pg_temp.try_cx(3, 1, 'T9', 'veto', '2026-10-29 10:00:00+00', 52) $$,
  'P0001', 'commish_force_or_reverse_trade: action_id a1040000-0000-4000-8000-000000000052 already names a reverse of another trade or another op in this league — an action_id identifies ONE submit (R732)',
  'G8 the same action id for ANOTHER op is refused (R732), never replayed as the reversal');

-- ---------------------------------------------------------------------------
-- H. REVERSE REFUSES BY NAME — exclusivity, money, room (validity binds him).
-- ---------------------------------------------------------------------------
-- T10 (L3): Kilo k1 ↔ Lima l1, then Lima's K One ends up on India.
select pg_temp.prop('T10', 3, 4, 'R Kilo', 'R Lima', jsonb_build_array(pg_temp.leg('cx-k1', 'R Kilo'), pg_temp.leg('cx-l1', 'R Lima')), '2026-10-21 11:00:00+00', 60);
select pg_temp.accept('T10a', 3, 5, 'T10', null, '2026-10-21 12:00:00+00', 61);
update league_rosters set team_id = pg_temp.team('R India') where player_id = 'cx-k1' and league_id = pg_temp.lg(3);
select throws_ok($$ select pg_temp.try_cx(3, 1, 'T10', 'reverse', '2026-10-28 10:00:00+00', 62) $$,
  'P0001', 'commish_force_or_reverse_trade: R K One is no longer on R Lima''s roster — he is on R India''s now — so the trade cannot be reversed as a whole (player exclusivity binds the commissioner too); move players one at a time with commish_move_player instead',
  'H1 THE REFUSAL (task text): a player the trade moved is on another roster now — refused BY NAME, pointing at commish_move_player');
delete from league_rosters where player_id = 'cx-k1' and league_id = pg_temp.lg(3);
select throws_ok($$ select pg_temp.try_cx(3, 1, 'T10', 'reverse', '2026-10-28 10:00:00+00', 63) $$,
  'P0001', 'commish_force_or_reverse_trade: R K One is no longer on R Lima''s roster — he is on no roster in this league now — so the trade cannot be reversed as a whole (player exclusivity binds the commissioner too); move players one at a time with commish_move_player instead',
  'H2 …and a player since dropped (on no roster) is named the same way');
select is(
  pg_temp.st('T10') || ' / ' || pg_temp.roster('R Kilo') || ' ' || pg_temp.roster('R Lima') || ' / ' || pg_temp.counts(3),
  'complete|- / cx-k2,cx-l1 cx-l2 / 1|1|2|2',
  'H3 the refusals wrote NOTHING: the trade still complete, rosters as they were, no receipt or ledger row');
-- T11 (L3): Kilo k2 + l1 + $30 → Lima, Lima l2 → Kilo.
select pg_temp.prop('T11', 3, 4, 'R Kilo', 'R Lima',
  jsonb_build_array(pg_temp.leg('cx-k2', 'R Kilo'), pg_temp.leg('cx-l1', 'R Kilo'), pg_temp.cash(30, 'R Kilo'), pg_temp.leg('cx-l2', 'R Lima')),
  '2026-10-21 13:00:00+00', 64);
select pg_temp.accept('T11a', 3, 5, 'T11', null, '2026-10-21 14:00:00+00', 65);
select is(
  pg_temp.st('T11') || ' / ' || pg_temp.roster('R Kilo') || ' ' || pg_temp.roster('R Lima') || ' / $' || pg_temp.bal('R Kilo') || ' $' || pg_temp.bal('R Lima'),
  'complete|- / cx-l2 cx-k2,cx-l1 / $70 $130',
  'H4 premise: the 2-for-1 went through with $30');
update league_members set faab_balance = 10 where team_id = pg_temp.team('R Lima');
select throws_ok($$ select pg_temp.try_cx(3, 1, 'T11', 'reverse', '2026-10-28 10:00:00+00', 66) $$,
  'P0001', 'commish_force_or_reverse_trade: R Lima received $30 of FAAB in this trade and holds $10 now, so it cannot give it back (a FAAB balance is never negative) — set the balances with commish_edit_faab first, or move players one at a time with commish_move_player',
  'H5 MONEY: the team that received the FAAB no longer holds it — refused BY NAME (a balance is never negative)');
update league_members set faab_balance = 130 where team_id = pg_temp.team('R Lima');
-- Kilo picks up two free agents since (K One, K Three): at 3 of 3 it has no room for two back.
insert into league_rosters (league_id, team_id, player_id, slot_key) values
 (pg_temp.lg(3), pg_temp.team('R Kilo'), 'cx-k1', 'bn'), (pg_temp.lg(3), pg_temp.team('R Kilo'), 'cx-k3', 'bn');
select throws_ok($$ select pg_temp.try_cx(3, 1, 'T11', 'reverse', '2026-10-28 10:00:00+00', 67) $$,
  'P0001', 'commish_force_or_reverse_trade: R Kilo''s roster would hold 4 players after the reversal — 1 more than its 3 spots (§7.3.2 roster_size); free room first with commish_force_add_drop (a roster over its league''s size binds the commissioner too)',
  'H6 ROOM: taking two players back for one would put Kilo over its roster size — refused BY NAME');
update leagues set status = 'complete' where id = pg_temp.lg(3);
select throws_ok($$ select pg_temp.try_cx(3, 1, 'T11', 'reverse', '2026-10-28 10:00:00+00', 73) $$,
  'P0001', 'commish_force_or_reverse_trade: league b1040000-0000-4000-8000-000000000003 is complete — rosters change only while in_season or in playoffs, so a trade can be reversed only then (§13.1)',
  'H6b R1229: a reverse only while the league is in season or in the playoffs (rosters change only then) — refused BY NAME');
update leagues set status = 'in_season' where id = pg_temp.lg(3);
select is(
  pg_temp.st('T11') || ' / ' || pg_temp.roster('R Kilo') || ' ' || pg_temp.roster('R Lima') || ' / $' || pg_temp.bal('R Kilo') || ' $' || pg_temp.bal('R Lima')
    || ' / ' || pg_temp.counts(3),
  'complete|- / cx-k1,cx-k3,cx-l2 cx-k2,cx-l1 / $70 $130 / 1|1|2|2',
  'H7 …nothing was written by either refusal: rosters, balances, no receipt');
select throws_ok($$ select pg_temp.try_cx(1, 1, 'T6', 'reverse', '2026-10-28 10:00:00+00', 68) $$,
  'P0001', 'commish_force_or_reverse_trade: this trade has not gone through yet, so there is nothing to reverse — the receiving team can reject it or the proposing team cancel it instead',
  'H8 an offer that never went through has nothing to reverse');

-- ---------------------------------------------------------------------------
-- I. ONE AUDIT ROW PER OP, across the whole file.
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s=%s', action_type, n), ' ' order by action_type)
   from (select action_type, count(*) n from commissioner_actions
         where league_id::text like 'b1040000-%' and metadata ->> 'verb' = 'commish_force_or_reverse_trade'
         group by action_type) x),
  'approve_trade=3 force_trade=2 reverse_trade=2 veto_trade=2',
  'I1 one receipt per landed op — approve D1 / D6 / V1, force F1 / F4, reverse G2 / V4, veto E1 / V2 — and none for the four no-ops or any refusal');
select is(
  (select count(*)::int from commish_trade_actions where league_id::text like 'b1040000-%'),
  13,
  'I2 the ledger holds one row per ANSWERED call — the nine landings and the four no-ops (a refusal and a replay consume nothing)');
select ok(pg_temp.exclusive(1) and pg_temp.exclusive(2),
  'I3 exclusivity holds in L1 and L2 after every force (L3 carries H6''s free-agent fixture rows)');

-- ---------------------------------------------------------------------------
-- J. NO WRITE POLICY ON THE LEDGER FOR ANY ROLE (tasks-M* §4.2 — RETURNING
--    counts, taken with thirteen rows present so a 0 is not an empty table).
-- ---------------------------------------------------------------------------
create temp table j104_before as select * from commish_trade_actions where league_id::text like 'b1040000-%';
grant select on j104_before to authenticated, anon;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from commish_trade_actions), 0, 'J1 ANON reads no ledger row');
select throws_ok($$ insert into commish_trade_actions (league_id, trade_id, op, action_id, actor_id, result) select league_id, trade_id, op, gen_random_uuid(), actor_id, result from j104_before limit 1 $$,
  '42501', null, 'J2 ANON cannot INSERT one');
reset role;
set local role authenticated;
select pg_temp.as_user(2);
select results_eq($$ with u as (update commish_trade_actions set op = 'veto' returning 1), d as (delete from commish_trade_actions returning 1)
                    select (select count(*)::int from u), (select count(*)::int from d) $$,
  $$ values (0, 0) $$, 'J3 a MANAGER whose trade is in it can neither UPDATE nor DELETE a row (0 rows each)');
select pg_temp.as_user(1);
select is((select count(*)::int from commish_trade_actions), 0, 'J4 the COMMISSIONER himself reads no ledger row (the verb is the only reader)');
select results_eq($$ with u as (update commish_trade_actions set op = 'veto' returning 1), d as (delete from commish_trade_actions returning 1)
                    select (select count(*)::int from u), (select count(*)::int from d) $$,
  $$ values (0, 0) $$, 'J5 …and cannot UPDATE or DELETE one (0 rows each)');
select throws_ok($$ insert into commish_trade_actions (league_id, trade_id, op, action_id, actor_id, result) select league_id, trade_id, op, gen_random_uuid(), actor_id, result from j104_before limit 1 $$,
  '42501', null, 'J6 …nor pre-plant a replay row (the D350 reason the ledger is its own)');
reset role;
select set_config('request.jwt.claims', '', true);
select set_eq($$ select * from commish_trade_actions where league_id::text like 'b1040000-%' $$, $$ select * from j104_before $$,
  'J7 the ledger is BYTE-IDENTICAL after every client walk (all thirteen rows)');

select * from finish();
rollback;
