-- ============================================================================
-- The rolling waiver order is STORED from the moment the draft ends — pgTAP
-- 111 (task L.D2.18; migration 163; PROGRESS F484 discharged, D427; spec
-- §13.2 Q72 "Priority before there are standings", §7.3.4 faab_tiebreaker;
-- F434 — an auction uses the reverse NOMINATION order). Chris 2026-09-29:
-- "in my leagues the waiver priority starts as soon as the draft is over and
-- never resets. it just keeps updating based on who used their waiver."
--
-- Numbering: reserved and measured (163 / 111). OWN FIXTURE: users 9111…,
-- leagues b111…, teams c111…, seats d111…, drafts e111…, claims f111…,
-- action ids a111…, players wo-*.
--
-- THE LEAGUES
--   Draft completion through the REAL writer (draft_complete_internal, the
--   058 LC shape — 8 teams, 1 round; K1's last pick goes through the real
--   draft_make_pick, R1291):
--     K1 snake,   FAAB, no faab_tiebreaker key (the default: rolling)
--     K2 auction, waiver type rolling_priority, nomination order
--        [t3, t1, t4, t2, t5, t6, t7, t8]
--     K3 snake,   waiver type reverse_standings
--     K4 snake,   FAAB storing faab_tiebreaker = reverse_standings
--   LE — FAAB, no key; A B C D drafted in that order (reverse: D C B A);
--        week 1 FINAL A beat D, C beat B ⇒ reverse standings B D C A; runs
--        daily 12:00 UTC: R1 Sun 2026-11-01, R2 Mon 11-02, R3 Tue 11-03.
--   LG1 / LG2 — twins already in season with no stored order (the hosted
--        shape before 163): LG1 is backfilled, LG2 is seeded by its first
--        run (the processor) — the parity cell. LG3 standings-based, LG4 a
--        draft order missing a team, LG5 no draft.
--
-- BREAK PROBES (the PR body; measured), each injected right after the plan
-- inside this transaction (the ROLLBACK ends it):
--   (1) the trigger disabled ⇒ A3 B2 C1 C2 E1 E2 G1 H1 red (E2: the run
--       then re-derives the order — source reverse_draft_order);
--   (2) the never-re-seed guard removed (condition (c)) ⇒ E5 E7 F2 F3 G1 G3
--       H1b red (the setting change resets the order to the draft);
--   (3) the order not reversed ⇒ B2 C1 C2 E1 E3 E4 E5 E7 F2 G2 G3 H1 red;
--   (4) the persists check removed ⇒ D1 D2 G1 G3 G4 red;
--   (5) the backfill loop emptied ⇒ G1 G2 G3 G5 red.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(35);

-- ---------------------------------------------------------------------------
-- A. Form pins — 163 replaces nothing
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('waiver_priority_seed_internal', 'waiver_priority_backfill_internal', 'leagues_waiver_priority_seed_trg')),
  'leagues_waiver_priority_seed_trg:t:search_path="":f:f waiver_priority_backfill_internal:f:search_path="":f:f waiver_priority_seed_internal:f:search_path="":f:f',
  'A1 the three new functions: one overload each; the helpers PLAIN, the trigger function DEFINER; search_path empty; closed to anon and authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('waiver_priority_seed_internal', 'waiver_priority_backfill_internal', 'leagues_waiver_priority_seed_trg')),
  'A2 PUBLIC holds EXECUTE on none of them (REVOKEs)');
select is(
  (select format('%s|%s', t.tgenabled, pg_get_triggerdef(t.oid))
   from pg_trigger t where t.tgrelid = 'public.leagues'::regclass and t.tgname = 'trg_leagues_waiver_priority_seed'),
  'A|CREATE TRIGGER trg_leagues_waiver_priority_seed AFTER UPDATE OF status, waiver_type, settings ON public.leagues FOR EACH ROW WHEN (((new.status = ANY (ARRAY[''in_season''::text, ''playoffs''::text])) AND (new.deleted_at IS NULL))) EXECUTE FUNCTION leagues_waiver_priority_seed_trg()',
  'A3 the trigger: AFTER UPDATE OF status, waiver_type, settings on leagues, in season or playoffs only, ENABLE ALWAYS');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'process_waivers_internal'),
  '18723b8cd3309b483b5765e6c841c786',
  'A4 the processor is untouched — prosrc md5 is 160 as written (the stored literal 108 A4 pins); it already continues from a stored order');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_complete_internal'),
  '0928fa4fd54541a9cfc3460270b317a0',
  'A5 the one draft completion writer is untouched — prosrc md5 is 110 as written (a stored literal); the trigger rides its status flip');
select ok(
  (select p.prosrc like '%IF v_r ->> ''status'' = ''unseedable'' THEN%RAISE WARNING ''waiver order not stored for league %: %'', NEW.id, v_r ->> ''why'';%'
          and p.prosrc not like '%RAISE EXCEPTION%'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'leagues_waiver_priority_seed_trg'),
  'A6 R1289: the trigger SAYS an unseedable league (a WARNING naming the league and the reason) and never raises; G5 and G6 pin the outcome and the write landing');

-- ---------------------------------------------------------------------------
-- Fixtures (postgres context)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91110000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-wo' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'wo_user' || i)::jsonb, now(), now()
from generate_series(1, 12) i;

insert into players (id, full_name, position, team, status, adp)
select 'wo-p' || lpad(i::text, 2, '0'), 'WO QB ' || i, 'QB', 'SEA', 'Active', i / 1000.0 from generate_series(1, 8) i;
insert into players (id, full_name, position, team, status) values
 ('wo-x', 'WO Ex',  'WR', 'SEA', 'Active'),
 ('wo-y', 'WO Why', 'WR', 'SEA', 'Active'),
 ('wo-z', 'WO Zed', 'WR', 'SEA', 'Active');

create or replace function pg_temp.lg(n text) returns uuid language sql as $$
  select ('b1110000-0000-4000-8000-' || lpad(n, 12, '0'))::uuid
$$;

-- K1..K4: drafting leagues whose live draft has every pick made
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     waiver_type, faab_budget, settings, roster_settings)
select pg_temp.lg(v.n::text), '91110000-0000-4000-8000-000000000001', 'pgtap-wo-K' || v.n, 2026, 'drafting', 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  v.wt, 100,
  ('{"draft": {"draft_type": "' || v.dt || '", "pick_timer_seconds": 90, "disconnect_grace_seconds": 30}' || v.tb || '}')::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 0, "ir_slots": [], "swap_spots": 0}'
from (values
  (1, 'faab',              'snake',   ''),
  (2, 'rolling_priority',  'auction', ''),
  (3, 'reverse_standings', 'snake',   ''),
  (4, 'faab',              'snake',   ', "faab_tiebreaker": "reverse_standings"')
) v(n, wt, dt, tb);
insert into teams (id, owner_id, name, league_id)
select ('c1110000-0000-4000-8000-0000000000' || n || t)::uuid, ('91110000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid,
       'WO K' || n || ' t' || t, pg_temp.lg(n::text)
from generate_series(1, 4) n, generate_series(1, 8) t;
insert into league_members (league_id, user_id, team_id, role, faab_balance)
select pg_temp.lg(n::text), ('91110000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid,
       ('c1110000-0000-4000-8000-0000000000' || n || t)::uuid,
       case when t = 1 then 'commissioner' else 'manager' end, 100
from generate_series(1, 4) n, generate_series(1, 8) t;
insert into drafts (id, league_id, draft_type, status, is_mock, config, draft_order,
                    total_rounds, current_round, current_pick_number, on_clock_team_id, started_at)
select ('e1110000-0000-4000-8000-00000000000' || n)::uuid, pg_temp.lg(n::text),
       case when n = 2 then 'auction' else 'snake' end, 'live', false, '{"pick_timer_seconds": 90}',
       (select jsonb_agg(to_jsonb('c1110000-0000-4000-8000-0000000000' || n || o.t) order by o.k)
        from unnest(case when n = 2 then array[3, 1, 4, 2, 5, 6, 7, 8] else array[1, 2, 3, 4, 5, 6, 7, 8] end) with ordinality o(t, k)),
       1, 1, 8,
       case when n = 1 then 'c1110000-0000-4000-8000-000000000018'::uuid end,
       now()
from generate_series(1, 4) n;
update drafts set current_deadline = now() + interval '90 seconds' where id = 'e1110000-0000-4000-8000-000000000001';
insert into draft_picks (draft_id, league_id, pick_number, round, team_id, player_id, price, is_auto, made_via)
select ('e1110000-0000-4000-8000-00000000000' || n)::uuid, pg_temp.lg(n::text), t, 1,
       ('c1110000-0000-4000-8000-0000000000' || n || t)::uuid, 'wo-p' || lpad(t::text, 2, '0'),
       case when n = 2 then t else null end, false, 'manager'
from generate_series(1, 4) n, generate_series(1, 8) t
where not (n = 1 and t = 8);   -- K1: the last pick is made below through the REAL draft_make_pick

-- the stored order of a K league as team numbers by priority ("-" when none)
create or replace function pg_temp.korder(n int) returns text language sql as $$
  select coalesce(string_agg(right(t.name, 1), ',' order by m.waiver_priority) filter (where m.waiver_priority is not null), '-')
         || '|' || count(*) filter (where m.waiver_priority is null)
  from public.league_members m join public.teams t on t.id = m.team_id
  where m.league_id = pg_temp.lg(n::text)
$$;

-- ---------------------------------------------------------------------------
-- B. A SNAKE draft completes ⇒ the order is stored at that instant
-- ---------------------------------------------------------------------------
select is(
  format('%s %s %s %s', pg_temp.korder(1), pg_temp.korder(2), pg_temp.korder(3), pg_temp.korder(4)),
  '-|8 -|8 -|8 -|8',
  'B1 PREMISE (the boundary): while the drafts are live no seat stores a waiver priority');
-- K1: the on-clock manager (u8, t8) makes the LAST pick through the real door
select set_config('request.jwt.claims', '{"sub": "91110000-0000-4000-8000-000000000008", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.draft_make_pick('e1110000-0000-4000-8000-000000000001', 'wo-p08', gen_random_uuid()) $$,
  'B2a THE REAL ROUTE: K1 on-clock manager makes the last pick through draft_make_pick');
select set_config('request.jwt.claims', '', true);
select public.draft_complete_internal(('e1110000-0000-4000-8000-00000000000' || n)::uuid, '2026-11-05 12:00:00-05')
from generate_series(2, 4) n;
select is(
  (select format('%s|%s|%s', l.status, d.status, pg_temp.korder(1))
   from leagues l join drafts d on d.league_id = l.id where l.id = pg_temp.lg('1')),
  'in_season|complete|8,7,6,5,4,3,2,1|0',
  'B2 K1 (snake, FAAB, default tiebreaker) completed by that pick: in season, and the order is REVERSE DRAFT ORDER — the last pick of round 1 is #1');

-- ---------------------------------------------------------------------------
-- C. An AUCTION completes ⇒ reverse NOMINATION order (F434)
-- ---------------------------------------------------------------------------
select is(
  pg_temp.korder(2),
  '8,7,6,5,2,4,1,3|0',
  'C1 K2 (auction, rolling priority) at completion: the reverse of the nomination order [3,1,4,2,5,6,7,8]');
select is(
  (select string_agg(format('%s=%s', right(t.name, 1), m.waiver_priority), ' ' order by t.name)
   from league_members m join teams t on t.id = m.team_id where m.league_id = pg_temp.lg('2') and right(t.name, 1) in ('1', '3')),
  '1=7 3=8',
  'C2 K2: the first nominator (t3) is last and the second (t1) next to last — a stored literal');

-- ---------------------------------------------------------------------------
-- D. Standings-based leagues store nothing
-- ---------------------------------------------------------------------------
select is(
  format('%s %s', pg_temp.korder(3), pg_temp.korder(4)),
  '-|8 -|8',
  'D1 K3 (reverse standings type) and K4 (FAAB, ties by the standings) complete with NO stored order — the standings decide each run');
select is(
  format('%s|%s',
    public.waiver_priority_seed_internal(pg_temp.lg('3')) ->> 'status',
    public.waiver_priority_seed_internal(pg_temp.lg('4')) ->> 'status'),
  'not_rolling|not_rolling',
  'D2 the seed says why by name: not_rolling for both');

-- ---------------------------------------------------------------------------
-- E. LE — a run CONTINUES from the stored order; the FAAB tie goes by it
-- ---------------------------------------------------------------------------
update nfl_weeks w
set last_game_ends_at = case
      when w.week <= 7 then w.starts_at + interval '6 days 3 hours'
      when w.week = 8 then '2026-11-03 08:00:00+00'::timestamptz
      when w.week = 9 then '2026-11-10 08:00:00+00'::timestamptz
    end,
    first_kickoff_at = null
where w.season = 2026;
delete from nfl_games where season = 2026;
insert into nfl_games (id, season, week, home_team, away_team, kickoff_at) values
 ('wo-g8', 2026, 8, 'KC', 'BUF', '2026-10-30 00:15:00+00');

-- LE and LG1..LG5 (LE drafting until its flip; the LG leagues already in season)
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, waiver_type, faab_budget, settings, roster_settings, waiver_next_run_at)
select pg_temp.lg(v.n), '91110000-0000-4000-8000-000000000001', 'pgtap-wo-' || v.nm, 2026, v.st, 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', v.wt, 100,
  '{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "12:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"}',
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}',
  '2026-11-01 12:00:00+00'
from (values
  ('e',  'LE',  'drafting',  'faab'),
  ('51', 'LG1', 'in_season', 'faab'),
  ('52', 'LG2', 'in_season', 'faab'),
  ('53', 'LG3', 'in_season', 'reverse_standings'),
  ('54', 'LG4', 'in_season', 'faab'),
  ('55', 'LG5', 'in_season', 'faab')
) v(n, nm, st, wt);
insert into teams (id, owner_id, name, league_id, status)
select ('c1110000-0000-4000-8000-' || lpad(g || t, 12, '0'))::uuid,
       ('91110000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid,
       'WO ' || g || ' ' || (array['A', 'B', 'C', 'D'])[t], pg_temp.lg(g), 'active'
from unnest(array['e', '51', '52', '53', '54', '55']) g, generate_series(1, 4) t;
insert into league_members (id, league_id, user_id, team_id, role, is_placeholder, faab_balance)
select ('d1110000-0000-4000-8000-' || lpad(g || t, 12, '0'))::uuid, pg_temp.lg(g),
       ('91110000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid,
       ('c1110000-0000-4000-8000-' || lpad(g || t, 12, '0'))::uuid,
       case when t = 1 then 'commissioner' else 'manager' end, false, 100
from unnest(array['e', '51', '52', '53', '54', '55']) g, generate_series(1, 4) t;
insert into team_managers (league_id, team_id, user_id, role, started_at)
select pg_temp.lg('e'), ('c1110000-0000-4000-8000-' || lpad('e' || t, 12, '0'))::uuid,
       ('91110000-0000-4000-8000-0000000000' || lpad(t::text, 2, '0'))::uuid, 'manager', now() - interval '30 days'
from generate_series(1, 4) t;
insert into league_weeks (league_id, season, week)
select pg_temp.lg(g), 2026, w from unnest(array['e', '51', '52', '53', '54', '55']) g, generate_series(1, 14) w;
-- drafted A, B, C, D (LG4 lists only A, B, C; LG5 has no draft)
insert into drafts (league_id, status, completed_at, draft_order)
select pg_temp.lg(g), 'complete', '2026-09-06 06:00:00+00',
       (select jsonb_agg(to_jsonb('c1110000-0000-4000-8000-' || lpad(g || t, 12, '0')) order by t)
        from generate_series(1, case when g = '54' then 3 else 4 end) t)
from unnest(array['e', '51', '52', '53', '54']) g;
-- LE week 1 FINAL: A 100 beat D 90, C 80 beat B 70
insert into team_week_results (league_id, team_id, season, week, points, opponent_team_id, h2h_result, is_final)
select pg_temp.lg('e'), ('c1110000-0000-4000-8000-' || lpad('e' || v.t, 12, '0'))::uuid, 2026, 1, v.pts,
       ('c1110000-0000-4000-8000-' || lpad('e' || v.o, 12, '0'))::uuid, v.res, true
from (values (1, 100.00, 4, 'win'), (4, 90.00, 1, 'loss'), (3, 80.00, 2, 'win'), (2, 70.00, 3, 'loss')) v(t, pts, o, res);

create temp table r111 (tag text primary key, r jsonb not null);
-- the stored order of a league, "<seat letter>=<priority>" by priority (seat = the league_members row, which a franchise change keeps)
create or replace function pg_temp.prio(p_league uuid) returns text language sql as $$
  select string_agg(format('%s=%s', (array['A', 'B', 'C', 'D'])[right(m.id::text, 1)::int], coalesce(m.waiver_priority::text, 'null')), ' '
                    order by m.waiver_priority nulls last, m.id)
  from public.league_members m
  where m.league_id = p_league
$$;
create or replace function pg_temp.claims(p_league uuid, p_player text) returns text language sql as $$
  select string_agg(format('%s:%s%s', (array['A', 'B', 'C', 'D'])[right(m.id::text, 1)::int], c.status, coalesce(':' || c.result_reason, '')), ' ' order by c.id)
  from public.waiver_claims c join public.league_members m on m.team_id = c.team_id and m.league_id = c.league_id
  where c.league_id = p_league and c.add_player_id = p_player
$$;
create or replace function pg_temp.claim(p_id text, p_seat int, p_player text, p_bid int) returns void language sql as $$
  insert into public.waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by)
  select ('f1110000-0000-4000-8000-' || lpad(p_id, 12, '0'))::uuid, m.league_id, m.team_id, p_player, null, p_bid, 1,
         ('a1110000-0000-4000-8000-' || lpad(p_id, 12, '0'))::uuid, coalesce(m.user_id, '91110000-0000-4000-8000-000000000001')
  from public.league_members m where m.id = ('d1110000-0000-4000-8000-' || lpad('e' || p_seat, 12, '0'))::uuid
$$;

-- LE's draft ends: the league flips to in season (the completion's own write)
update leagues set status = 'in_season' where id = pg_temp.lg('e');
select is(
  pg_temp.prio(pg_temp.lg('e')),
  'D=1 C=2 B=3 A=4',
  'E1 LE in season: the order is stored at once — reverse draft order, before any waiver run');

select pg_temp.claim('e11', 2, 'wo-x', 10);   -- B $10 on X
select pg_temp.claim('e14', 4, 'wo-x', 10);   -- D $10 on X
insert into r111 select 'R1', public.process_waivers_internal(pg_temp.lg('e'), '2026-11-01 12:00:00+00');
select is(
  (select format('%s|%s|%s', r ->> 'status', r #>> '{priority,source}', r #>> '{priority,persists}') from r111 where tag = 'R1'),
  'settled|rolling|true',
  'E2 R1 settles FROM THE STORED ORDER (source rolling, not reverse_draft_order — the processor did not re-derive it)');
select is(
  pg_temp.claims(pg_temp.lg('e'), 'wo-x'),
  'B:lost:lost_on_priority D:won',
  'E3 the equal $10 FAAB bids go to D, first in the stored order (the standings would give B)');
select is(
  pg_temp.prio(pg_temp.lg('e')),
  'C=1 B=2 A=3 D=4',
  'E4 after R1: D, the winner, went to the back; everyone else moved up one');

-- a later setting change fires the trigger again: the order is KEPT
update leagues set settings = settings || '{"trade_review": "none"}' where id = pg_temp.lg('e');
select is(
  format('%s|%s', pg_temp.prio(pg_temp.lg('e')), public.waiver_priority_seed_internal(pg_temp.lg('e')) ->> 'status'),
  'C=1 B=2 A=3 D=4|kept',
  'E5 a setting change after R1 re-seeds nothing — the order never resets (the seed answers kept)');

select pg_temp.claim('e21', 1, 'wo-y', 5);    -- A $5 on Y
select pg_temp.claim('e24', 4, 'wo-y', 5);    -- D $5 on Y
select is(
  (public.process_waivers_internal(pg_temp.lg('e'), '2026-11-02 11:59:59+00') ->> 'status'),
  'not_due',
  'E6 boundary: one second before R2 the run is not due');
insert into r111 select 'R2', public.process_waivers_internal(pg_temp.lg('e'), '2026-11-02 12:00:00+00');
select is(
  format('%s|%s|%s', (select r #>> '{priority,source}' from r111 where tag = 'R2'),
         pg_temp.claims(pg_temp.lg('e'), 'wo-y'), pg_temp.prio(pg_temp.lg('e'))),
  'rolling|A:won D:lost:lost_on_priority|C=1 B=2 D=3 A=4',
  'E7 R2: A beats D on the tie (the draft order and the standings would both pick D); A goes to the back');

-- ---------------------------------------------------------------------------
-- F. A seat change keeps the team place — takeover, vacate + assign, and
--    retire-and-succeed, through the real verbs
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91110000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.remove_manager(pg_temp.lg('e'), 'd1110000-0000-4000-8000-0000000000e2', 'takeover', '91110000-0000-4000-8000-000000000005');
select public.remove_manager(pg_temp.lg('e'), 'd1110000-0000-4000-8000-0000000000e3', 'vacate');
select public.assign_manager(pg_temp.lg('e'), 'c1110000-0000-4000-8000-0000000000e3', '91110000-0000-4000-8000-000000000006');
create temp table _ret as
select public.remove_manager(pg_temp.lg('e'), 'd1110000-0000-4000-8000-0000000000e4',
                             'retire', null, 'pgtap retire', 'a1110000-0000-4000-8000-0000000000f4') as r;
select public.assign_manager(pg_temp.lg('e'), ((select r ->> 'successor_team_id' from _ret))::uuid, '91110000-0000-4000-8000-000000000007');
reset role;
select is(
  (select format('%s|%s|%s|%s',
     (select user_id from league_members where id = 'd1110000-0000-4000-8000-0000000000e2'),
     (select user_id from league_members where id = 'd1110000-0000-4000-8000-0000000000e3'),
     (select team_id = ((select r ->> 'successor_team_id' from _ret))::uuid from league_members where id = 'd1110000-0000-4000-8000-0000000000e4'),
     (select status from teams where id = 'c1110000-0000-4000-8000-0000000000e4'))),
  '91110000-0000-4000-8000-000000000005|91110000-0000-4000-8000-000000000006|t|retired',
  'F1 PREMISE: B taken over, C vacated and re-assigned, D retired with its seat fronting the successor');
select is(
  pg_temp.prio(pg_temp.lg('e')),
  'C=1 B=2 D=3 A=4',
  'F2 every team keeps its place through the seat changes — the successor holds D place');

select pg_temp.claim('e31', 1, 'wo-z', 1);    -- A $1 on Z
select pg_temp.claim('e34', 4, 'wo-z', 1);    -- the successor $1 on Z
insert into r111 select 'R3', public.process_waivers_internal(pg_temp.lg('e'), '2026-11-03 12:00:00+00');
select is(
  format('%s|%s|%s|%s', (select r ->> 'status' from r111 where tag = 'R3'), (select r #>> '{priority,source}' from r111 where tag = 'R3'),
         pg_temp.claims(pg_temp.lg('e'), 'wo-z'), pg_temp.prio(pg_temp.lg('e'))),
  'settled|rolling|A:lost:lost_on_priority D:won|C=1 B=2 A=3 D=4',
  'F3 R3 runs on the carried order: the successor (#3) beats A (#4) on the tie and goes to the back');

-- ---------------------------------------------------------------------------
-- G. The backfill — leagues already in season with no stored order
-- ---------------------------------------------------------------------------
select is(
  format('%s|%s|%s', pg_temp.prio(pg_temp.lg('51')), pg_temp.prio(pg_temp.lg('52')), pg_temp.prio(pg_temp.lg('54'))),
  'A=null B=null C=null D=null|A=null B=null C=null D=null|A=null B=null C=null D=null',
  'G0 PREMISE: LG1, LG2 and LG4 were inserted in season (no trigger) — no stored order, the hosted shape before 163');
-- LG2: seeded by its FIRST RUN, as before 163 (no claims ⇒ nobody moves)
insert into r111 select 'LG2', public.process_waivers_internal(pg_temp.lg('52'), '2026-11-01 12:00:00+00');
insert into r111 select 'bf1', public.waiver_priority_backfill_internal();
create or replace function pg_temp.bf(p_tag text, p_key text) returns text language sql as $$
  select coalesce(string_agg(right(x, 2), ',' order by x), '-')
  from r111 r, jsonb_array_elements_text(r.r -> p_key) x
  where r.tag = p_tag and x like 'b1110000-%'
$$;
select is(
  format('seeded=%s kept=%s not_rolling=%s unseedable=%s no_draft=%s',
         pg_temp.bf('bf1', 'seeded'), pg_temp.bf('bf1', 'kept'), pg_temp.bf('bf1', 'not_rolling'),
         pg_temp.bf('bf1', 'unseedable'), pg_temp.bf('bf1', 'no_draft')),
  'seeded=51 kept=01,02,0e,52 not_rolling=03,04,53 unseedable=54 no_draft=55',
  'G1 the backfill (fixture leagues): LG1 seeded; K1 K2 LE and LG2 kept; the standings leagues not_rolling; LG4 unseedable; LG5 no_draft');
select is(
  format('%s|%s|%s', pg_temp.prio(pg_temp.lg('51')), pg_temp.prio(pg_temp.lg('52')),
         (select format('%s/%s', r #>> '{priority,source}', r #>> '{priority,persists}') from r111 where tag = 'LG2')),
  'D=1 C=2 B=3 A=4|D=1 C=2 B=3 A=4|reverse_draft_order/true',
  'G2 PARITY: the backfilled order of LG1 is exactly the order the processor seeded for its twin LG2 at its first run');
insert into r111 select 'bf2', public.waiver_priority_backfill_internal();
select is(
  format('%s|%s|%s', pg_temp.bf('bf2', 'seeded'), pg_temp.bf('bf2', 'kept'), pg_temp.prio(pg_temp.lg('51'))),
  '-|01,02,0e,51,52|D=1 C=2 B=3 A=4',
  'G3 run again the backfill seeds nothing and LG1 order is unchanged (idempotent)');
select is(
  format('%s|%s', pg_temp.prio(pg_temp.lg('53')), pg_temp.prio(pg_temp.lg('55'))),
  'A=null B=null C=null D=null|A=null B=null C=null D=null',
  'G4 the standings league and the league with no draft store nothing');
select is(
  (select r #>> '{unseedable_why,b1110000-0000-4000-8000-000000000054}' from r111 where tag = 'bf1'),
  'unseedable — the draft order (3 entries) does not list exactly the league''s 4 active franchises; nothing stored, the first waiver run judges it',
  'G5 LG4 is refused BY NAME (a stored literal) and stores nothing');
update leagues set settings = settings || '{"trade_review": "none"}' where id = pg_temp.lg('54');
select is(
  format('%s|%s', (select settings ->> 'trade_review' from leagues where id = pg_temp.lg('54')), pg_temp.prio(pg_temp.lg('54'))),
  'none|A=null B=null C=null D=null',
  'G6 the trigger never fails a write: a setting change on the unseedable league lands and stores nothing');

-- ---------------------------------------------------------------------------
-- H. The switch to a rolling order mid-season stores it at once
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "91110000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  format('%s|%s',
    (select r ->> 'no_changes' from public.commish_change_setting_internal(pg_temp.lg('53'), 'waiver_type', '"rolling_priority"', false,
            'a1110000-0000-4000-8000-000000000531', '2026-11-03 13:00:00+00', null) r),
    pg_temp.prio(pg_temp.lg('53'))),
  'false|D=1 C=2 B=3 A=4',
  'H1 LG3 switched by the commissioner (commish_change_setting) from reverse standings to rolling priority: its order is stored from reverse draft order at the switch');
-- R1288 (as built; F495 asks Chris): LE rolling -> standings tiebreak -> rolling keeps the order it rolled to
select is(
  format('%s|%s',
    (select r ->> 'no_changes' from public.commish_change_setting_internal(pg_temp.lg('e'), 'faab_tiebreaker', '"reverse_standings"', false,
            'a1110000-0000-4000-8000-0000000000e1', '2026-11-03 13:00:00+00', null) r),
    (select r ->> 'no_changes' from public.commish_change_setting_internal(pg_temp.lg('e'), 'faab_tiebreaker', '"rolling_priority"', false,
            'a1110000-0000-4000-8000-0000000000e2', '2026-11-03 13:01:00+00', null) r)),
  'false|false',
  'H1a PREMISE: the commissioner moved LE to the standings tiebreak and back to the rolling order');
select is(
  format('%s|%s', pg_temp.prio(pg_temp.lg('e')), public.waiver_priority_seed_internal(pg_temp.lg('e')) ->> 'status'),
  'C=1 B=2 A=3 D=4|kept',
  'H1b AS BUILT (F495): back on the rolling order LE resumes where it left off — not reverse draft order (D C B A); the seed answers kept');
select set_config('request.jwt.claims', '', true);
update leagues set waiver_type = 'reverse_standings' where id = pg_temp.lg('53');
update leagues set status = 'complete' where id = pg_temp.lg('55');
select is(
  format('%s|%s', public.waiver_priority_seed_internal(pg_temp.lg('55')) ->> 'status',
         public.waiver_priority_seed_internal('00000000-0000-4000-8000-000000000000') ->> 'status'),
  'not_in_season|skipped',
  'H2 a finished league and an unknown id are answered by name');
select throws_ok(
  $$ select public.waiver_priority_seed_internal(null) $$,
  '22023', 'waiver_priority_seed: p_league_id is required',
  'H3 a NULL league id is refused');

select * from finish();
rollback;
