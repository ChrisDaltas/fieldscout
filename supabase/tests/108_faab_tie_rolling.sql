-- ============================================================================
-- Equal FAAB bids are broken by the ROLLING waiver order by default — pgTAP
-- 108 (task L.D2.17; migration 160; PROGRESS F478 discharged, D424; spec
-- §7.3.4 row faab_tiebreaker, §13.2 FAAB tie rule + Q72 "Priority before
-- there are standings"). Chris 2026-09-29: "yes, use the rolling order" —
-- "the waiver priority starts as soon as the draft is over and never resets.
-- it just keeps updating based on who used their waiver."
--
-- Numbering: reserved and measured (160 / 108). OWN FIXTURE: users 9108…,
-- leagues b108…, teams c108…, claims d108…, action ids a108…, players ft-*.
-- The 2026 calendar is pinned INSIDE this transaction (098's shape) and
-- every run happens at an INJECTED instant (R1 = Sunday 2026-11-01 12:00Z,
-- R2 = Monday 2026-11-02 12:00Z — two scheduled runs of a daily 12:00 UTC
-- schedule; week 8 is current; the fixture players have no game, so nothing
-- is locked).
--
-- THE LEAGUES THAT DECIDE (identical except for the stored key):
--   L1 b108…01 FAAB, settings with NO faab_tiebreaker key (the default).
--   L2 b108…02 FAAB, settings storing faab_tiebreaker = reverse_standings.
--   Teams A B C D (A..D = c108…11..14 in L1, c108…21..24 in L2);
--   draft order [A, B, C, D] ⇒ reverse draft order [D, C, B, A].
--   Week 1 FINAL: A 100 beat D 90, C 80 beat B 70 ⇒ standings [A, C, D, B]
--   (win pct, then points for) ⇒ reverse standings [B, D, C, A].
--   So the three orders disagree at the top: rolling starts with D, the
--   standings with B — and after D wins at R1 the rolling order is
--   [C, B, A, D], so at R2 A beats D on a tie where the standings (and the
--   draft order) would pick D.
--
-- BREAK PROBES (the PR body; measured), each injected right after the un160
-- helper inside this transaction (the ROLLBACK ends it):
--   (1) the no-key fallback put back to reverse_standings (process_waivers_
--       internal re-created from un160 of its live body) ⇒ A4 A5 B2 B3 B4
--       B5 B6 D2 D3 D4 red;
--   (2) the stored key ignored (the fallback line made a constant
--       rolling_priority) ⇒ A3 A4 A5 C1 C2 C3 C4 D5 red;
--   (3) the rewrite without its audited-change exclusion ⇒ E1 E2 red;
--   (4) the rewrite without its won-claim exclusion ⇒ E1 E2 red.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

-- pg_temp.un160 reverses 160's one substitution (the same helper 101 / 105
-- apply innermost).
create function pg_temp.un160(p_src text) returns text language sql as $un160$
  select replace(p_src,
    '  v_tb := COALESCE(v_league.settings ->> ''faab_tiebreaker'', ''rolling_priority'');   -- 160 / L.D2.17: no stored key => the rolling order (Chris 2026-09-29)',
    '  v_tb := COALESCE(v_league.settings ->> ''faab_tiebreaker'', ''reverse_standings'');')
$un160$;

-- ---------------------------------------------------------------------------
-- A. Form pins, D137 in the database
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s:%s:%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('process_waivers_internal', 'faab_tiebreaker_old_default_rewrite_internal')),
  'faab_tiebreaker_old_default_rewrite_internal:f:search_path="":f:f process_waivers_internal:f:search_path="":f:f',
  'A1 the replaced processor and the new rewrite helper: one overload each, PLAIN, search_path empty, closed to anon and authenticated');
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname = 'public' and a.privilege_type = 'EXECUTE' and a.grantee = 0
      and p.proname in ('process_waivers_internal', 'faab_tiebreaker_old_default_rewrite_internal')),
  'A2 PUBLIC holds EXECUTE on neither (REVOKEs restated)');
select is(
  (select md5(pg_temp.un160(p.prosrc)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'process_waivers_internal'),
  '440a595061f1bdd26715ee381b5d6afa',
  'A3 D137: the live processor with the one substitution reversed is 157:2610-3165 FILE TEXT (the stored literal 105 A5 pins)');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'process_waivers_internal'),
  '18723b8cd3309b483b5765e6c841c786',
  'A4 the live processor prosrc md5 — 160 as written (a stored literal)');
select is(
  (select string_agg(m[1], ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   cross join lateral regexp_matches(p.prosrc, $re$COALESCE\(v_league\.settings ->> 'faab_tiebreaker', '([a-z_]+)'\)$re$, 'g') m
   where n.nspname = 'public' and p.proname = 'process_waivers_internal'),
  'rolling_priority',
  'A5 exactly one fallback for a league with no stored tiebreaker, and it is rolling_priority');
select is(
  (select md5(p.prosrc) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'waiver_resolve_run_internal'),
  'cd846b33aa6c8fc779ee8aa202f73549',
  'A6 the SQL twin (150) is untouched (a stored literal) — it has no default of its own');
select throws_like(
  $$ select public.waiver_resolve_run_internal(jsonb_build_object(
       'settings', jsonb_build_object('waiverType', 'faab', 'rosterSize', 5, 'acquisitionsPerWeek', null, 'acquisitionsPerSeason', null),
       'teams', '[]'::jsonb, 'claims', '[]'::jsonb,
       'priority', jsonb_build_object('draftOrder', '[]'::jsonb, 'standings', null, 'rolling', null),
       'lockedPlayerIds', '[]'::jsonb)) $$,
  '%unknown faab_tiebreaker "undefined"%',
  'A7 the twin refuses an input with no tiebreaker BY NAME — the default is chosen only by the processor');

-- ---------------------------------------------------------------------------
-- Fixtures (postgres context)
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
 ('ft-g8', 2026, 8, 'KC', 'BUF', '2026-10-30 00:15:00+00');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('91080000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-ft' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'ft_user' || i)::jsonb, now(), now()
from generate_series(1, 4) i;

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, scoring_rules_snapshot,
                     lineup_lock, waiver_type, faab_budget, settings, roster_settings, waiver_next_run_at, deleted_at)
select v.id::uuid, '91080000-0000-4000-8000-000000000001', v.nm, 2026, v.st, 8,
  (select id from scoring_systems where is_template and name = 'ESPN Standard'),
  (select rules from scoring_systems where is_template and name = 'ESPN Standard'),
  'per_player_kickoff', 'faab', 100,
  ('{"waiver_run_days": ["sun","mon","tue","wed","thu","fri","sat"], "waiver_run_time": "12:00", "waiver_time_zone": "UTC", "free_agency_opens": "after_waiver_run"'
   || v.tb || '}')::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 4, "ir_slots": [], "swap_spots": 0}',
  v.nx::timestamptz, v.del::timestamptz
from (values
  ('b1080000-0000-4000-8000-000000000001', 'pgtap-ft-L1', 'in_season', '',                                        '2026-11-01 12:00:00+00', null),
  ('b1080000-0000-4000-8000-000000000002', 'pgtap-ft-L2', 'in_season', ', "faab_tiebreaker": "reverse_standings"', '2026-11-01 12:00:00+00', null),
  ('b1080000-0000-4000-8000-000000000003', 'pgtap-ft-L3', 'setup',     ', "faab_tiebreaker": "reverse_standings"', null, null),
  ('b1080000-0000-4000-8000-000000000004', 'pgtap-ft-L4', 'in_season', ', "faab_tiebreaker": "reverse_standings"', null, null),
  ('b1080000-0000-4000-8000-000000000005', 'pgtap-ft-L5', 'in_season', ', "faab_tiebreaker": "reverse_standings"', null, null),
  ('b1080000-0000-4000-8000-000000000006', 'pgtap-ft-L6', 'in_season', ', "faab_tiebreaker": "rolling_priority"',  null, null),
  ('b1080000-0000-4000-8000-000000000007', 'pgtap-ft-L7', 'in_season', '',                                        null, null),
  ('b1080000-0000-4000-8000-000000000008', 'pgtap-ft-L8', 'in_season', ', "faab_tiebreaker": "reverse_standings"', null, '2026-10-01 00:00:00+00')
) v(id, nm, st, tb, nx, del);

insert into teams (id, owner_id, name, league_id, status)
select ('c1080000-0000-4000-8000-0000000000' || l || t)::uuid,
       ('91080000-0000-4000-8000-00000000000' || (array[2, 3, 4, 1])[t])::uuid,
       'FT ' || (array['A', 'B', 'C', 'D'])[t] || l,
       ('b1080000-0000-4000-8000-00000000000' || l)::uuid, 'active'
from generate_series(1, 2) l, generate_series(1, 4) t;
insert into teams (id, owner_id, name, league_id, status) values
 ('c1080000-0000-4000-8000-000000000051', '91080000-0000-4000-8000-000000000002', 'FT L5', 'b1080000-0000-4000-8000-000000000005', 'active');

insert into league_members (league_id, user_id, team_id, role, is_placeholder, faab_balance)
select ('b1080000-0000-4000-8000-00000000000' || l)::uuid,
       ('91080000-0000-4000-8000-00000000000' || (array[2, 3, 4, 1])[t])::uuid,
       ('c1080000-0000-4000-8000-0000000000' || l || t)::uuid,
       case when t = 4 then 'commissioner' else 'manager' end, false, 100
from generate_series(1, 2) l, generate_series(1, 4) t;

insert into league_weeks (league_id, season, week)
select ('b1080000-0000-4000-8000-00000000000' || l)::uuid, 2026, g from generate_series(1, 2) l, generate_series(1, 14) g;

insert into drafts (league_id, status, completed_at, draft_order)
select ('b1080000-0000-4000-8000-00000000000' || l)::uuid, 'complete', '2026-09-06 06:00:00+00',
       jsonb_build_array('c1080000-0000-4000-8000-0000000000' || l || '1', 'c1080000-0000-4000-8000-0000000000' || l || '2',
                         'c1080000-0000-4000-8000-0000000000' || l || '3', 'c1080000-0000-4000-8000-0000000000' || l || '4')
from generate_series(1, 2) l;

-- week 1 FINAL: A 100 beat D 90, C 80 beat B 70
insert into team_week_results (league_id, team_id, season, week, points, opponent_team_id, h2h_result, is_final)
select ('b1080000-0000-4000-8000-00000000000' || l)::uuid, ('c1080000-0000-4000-8000-0000000000' || l || v.t)::uuid, 2026, 1, v.pts,
       ('c1080000-0000-4000-8000-0000000000' || l || v.o)::uuid, v.res, true
from generate_series(1, 2) l,
     (values (1, 100.00, 4, 'win'), (4, 90.00, 1, 'loss'), (3, 80.00, 2, 'win'), (2, 70.00, 3, 'loss')) v(t, pts, o, res);

insert into players (id, full_name, position, team, status) values
 ('ft-x', 'FT Ex',  'WR', 'SEA', 'Active'),
 ('ft-y', 'FT Why', 'WR', 'SEA', 'Active'),
 ('ft-w', 'FT Won', 'WR', 'SEA', 'Active');

-- R1's claims: B and D each bid $10 on X (in both leagues)
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by)
select ('d1080000-0000-4000-8000-0000000001' || l || t)::uuid, ('b1080000-0000-4000-8000-00000000000' || l)::uuid,
       ('c1080000-0000-4000-8000-0000000000' || l || t)::uuid, 'ft-x', null, 10, 1,
       ('a1080000-0000-4000-8000-0000000001' || l || t)::uuid,
       ('91080000-0000-4000-8000-00000000000' || (array[2, 3, 4, 1])[t])::uuid
from generate_series(1, 2) l, unnest(array[2, 4]) t;

-- L4: the commissioner CHANGED the key (an audited change_setting row).
insert into commissioner_actions (league_id, actor_id, action_type, target_type, target_id, reason, before, after)
values ('b1080000-0000-4000-8000-000000000004', '91080000-0000-4000-8000-000000000001', 'change_setting', 'setting',
        'faab_tiebreaker', 'league vote', '"rolling_priority"', '"reverse_standings"');
-- L5: a waiver claim already WON (a history the rolling order never recorded).
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by,
                           status, processed_at)
values ('d1080000-0000-4000-8000-000000000501', 'b1080000-0000-4000-8000-000000000005', 'c1080000-0000-4000-8000-000000000051',
        'ft-w', null, 3, 1, 'a1080000-0000-4000-8000-000000000501', '91080000-0000-4000-8000-000000000002',
        'won', '2026-10-01 12:00:00+00');

create temp table r108 (tag text primary key, r jsonb not null);
create or replace function pg_temp.lg(n int) returns uuid language sql as $$
  select ('b1080000-0000-4000-8000-00000000000' || n)::uuid
$$;
-- claims of a league as "<team letter>:<player>:<status>[:<reason>]:$<spent>", in id order
create or replace function pg_temp.claims(p_league uuid, p_player text) returns text language sql as $$
  select string_agg(format('%s:%s%s', right(t.name, 2), c.status, coalesce(':' || c.result_reason, '')), ' ' order by c.id)
  from public.waiver_claims c join public.teams t on t.id = c.team_id
  where c.league_id = p_league and c.add_player_id = p_player
$$;
-- the stored order, "<team letter>=<priority>" by priority (null when none is stored)
create or replace function pg_temp.prio(p_league uuid) returns text language sql as $$
  select string_agg(format('%s=%s', left(right(t.name, 2), 1), coalesce(m.waiver_priority::text, 'null')), ' '
                    order by m.waiver_priority nulls last, t.name)
  from public.league_members m join public.teams t on t.id = m.team_id
  where m.league_id = p_league
$$;
create or replace function pg_temp.faab(p_league uuid) returns text language sql as $$
  select string_agg(format('%s=%s', left(right(t.name, 2), 1), m.faab_balance), ' ' order by t.name)
  from public.league_members m join public.teams t on t.id = m.team_id
  where m.league_id = p_league
$$;
-- team ids as letters in the given order ('null' when no list was given, so a
-- probe reds the cell instead of aborting the run)
create or replace function pg_temp.letters(p_league uuid, p_ids jsonb) returns text language sql as $$
  select case when jsonb_typeof(p_ids) = 'array' then
    (select string_agg(left(right(t.name, 2), 1), ',' order by e.o)
     from jsonb_array_elements_text(p_ids) with ordinality e(id, o) join public.teams t on t.id = e.id::uuid)
  else coalesce(p_ids::text, 'null') end
$$;

-- ---------------------------------------------------------------------------
-- B. L1 — NO stored key: the rolling order decides the tie, not the standings
-- ---------------------------------------------------------------------------
select is(
  format('%s|%s|%s|%s',
    (select settings ? 'faab_tiebreaker' from leagues where id = pg_temp.lg(1)),
    (select settings ->> 'faab_tiebreaker' from leagues where id = pg_temp.lg(2)),
    (select pg_temp.letters(pg_temp.lg(1), jsonb_path_query_array(public.league_standings_internal(pg_temp.lg(1), false), '$.standings[*].team_id'))),
    (select public.league_standings_internal(pg_temp.lg(1), false) ->> 'weeks_final')),
  'f|reverse_standings|A,C,D,B|1',
  'B1 PREMISE: L1 stores no tiebreaker, L2 stores reverse_standings; week 1 is final and the standings are A C D B, so reverse standings put B first while reverse draft order puts D first');

insert into r108 select 'R1L1', public.process_waivers_internal(pg_temp.lg(1), '2026-11-01 12:00:00+00');
select is(
  (select format('%s|%s|%s|%s', r ->> 'status', r #>> '{priority,source}', r #>> '{priority,persists}', r ->> 'next_run_at') from r108 where tag = 'R1L1'),
  'settled|reverse_draft_order|true|2026-11-02T12:00:00+00:00',
  'B2 L1 at R1: settled; the order PERSISTS (rolling) and, never seeded, starts from reverse draft order (Q72) — not from the standings');
select is(
  pg_temp.claims(pg_temp.lg(1), 'ft-x'),
  'B1:lost:lost_on_priority D1:won',
  'B3 L1 at R1: the equal $10 bids on X go to D (first in the rolling order); B loses on priority');
select is(
  pg_temp.prio(pg_temp.lg(1)),
  'C=1 B=2 A=3 D=4',
  'B4 L1 after R1: the rolled order is stored — D, the winner, went to the back');
select is(
  pg_temp.faab(pg_temp.lg(1)),
  'A=100 B=100 C=100 D=90',
  'B5 L1 after R1: only the winner paid ($10)');
select is(
  (select format('%s|%s', w.input #>> '{settings,faabTiebreaker}', w.input #> '{priority,standings}')
   from waiver_runs w where w.league_id = pg_temp.lg(1) and w.run_at = '2026-11-01 12:00:00+00'),
  'rolling_priority|null',
  'B6 L1 R1 run log: the processor chose rolling_priority for the missing key, and the standings were never read');

-- ---------------------------------------------------------------------------
-- C. L2 — STORED reverse_standings: the standings still decide
-- ---------------------------------------------------------------------------
insert into r108 select 'R1L2', public.process_waivers_internal(pg_temp.lg(2), '2026-11-01 12:00:00+00');
select is(
  (select format('%s|%s|%s', r ->> 'status', r #>> '{priority,source}', r #>> '{priority,persists}') from r108 where tag = 'R1L2'),
  'settled|reverse_standings|false',
  'C1 L2 at R1: settled from reverse standings; the order does not persist');
select is(
  pg_temp.claims(pg_temp.lg(2), 'ft-x'),
  'B2:won D2:lost:lost_on_priority',
  'C2 L2 at R1: the same equal bids go to B (last place) — a stored choice is honoured');
select is(
  pg_temp.prio(pg_temp.lg(2)),
  'A=null B=null C=null D=null',
  'C3 L2 after R1: no order is stored (it resets from the standings every run)');
select is(
  (select format('%s|%s', w.input #>> '{settings,faabTiebreaker}', pg_temp.letters(pg_temp.lg(2), w.input #> '{priority,standings}'))
   from waiver_runs w where w.league_id = pg_temp.lg(2) and w.run_at = '2026-11-01 12:00:00+00'),
  'reverse_standings|A,C,D,B',
  'C4 L2 R1 run log: the stored reverse_standings was read and the standings were the input');

-- ---------------------------------------------------------------------------
-- D. R2 — the rolling order never resets (not to the standings, not to the
--    draft); the standings league keeps using the standings
-- ---------------------------------------------------------------------------
insert into waiver_claims (id, league_id, team_id, add_player_id, drop_player_id, faab_bid, claim_order, action_id, created_by)
select ('d1080000-0000-4000-8000-0000000002' || l || t)::uuid, pg_temp.lg(l),
       ('c1080000-0000-4000-8000-0000000000' || l || t)::uuid, 'ft-y', null, 5, 1,
       ('a1080000-0000-4000-8000-0000000002' || l || t)::uuid,
       ('91080000-0000-4000-8000-00000000000' || (array[2, 3, 4, 1])[t])::uuid
from generate_series(1, 2) l, unnest(array[1, 4]) t;

select is(
  (public.process_waivers_internal(pg_temp.lg(1), '2026-11-02 11:59:59+00') ->> 'status'),
  'not_due',
  'D1 boundary: one second before R2 the run is not due');
insert into r108 select 'R2L1', public.process_waivers_internal(pg_temp.lg(1), '2026-11-02 12:00:00+00');
select is(
  format('%s|%s', (select r #>> '{priority,source}' from r108 where tag = 'R2L1'), pg_temp.claims(pg_temp.lg(1), 'ft-y')),
  'rolling|A1:won D1:lost:lost_on_priority',
  'D2 L1 at R2: the STORED rolling order decides — A beats D on the tie (the standings and the draft order would both pick D)');
select is(
  pg_temp.prio(pg_temp.lg(1)),
  'C=1 B=2 D=3 A=4',
  'D3 L1 after R2: A, the winner, went to the back; nobody else moved');
select is(
  pg_temp.faab(pg_temp.lg(1)),
  'A=95 B=100 C=100 D=90',
  'D4 L1 after R2: A paid its $5');
insert into r108 select 'R2L2', public.process_waivers_internal(pg_temp.lg(2), '2026-11-02 12:00:00+00');
select is(
  format('%s|%s', (select r #>> '{priority,source}' from r108 where tag = 'R2L2'), pg_temp.claims(pg_temp.lg(2), 'ft-y')),
  'reverse_standings|A2:lost:lost_on_priority D2:won',
  'D5 L2 at R2: reverse standings again — D beats A on the same tie');

-- ---------------------------------------------------------------------------
-- E. The one-time rewrite (160 §2), over every kind of stored value
-- ---------------------------------------------------------------------------
insert into r108 select 'before', jsonb_object_agg(l.id::text, l.settings) from leagues l where l.name like 'pgtap-ft-%';
insert into r108 select 'rw1', public.faab_tiebreaker_old_default_rewrite_internal();
select is(
  (select format('rewritten=%s kept_commissioner_choice=%s kept_waiver_history=%s',
                 (select string_agg(right(x, 1), ',' order by x) from jsonb_array_elements_text(r -> 'rewritten') x),
                 (select string_agg(right(x, 1), ',' order by x) from jsonb_array_elements_text(r -> 'kept_commissioner_choice') x),
                 (select string_agg(right(x, 1), ',' order by x) from jsonb_array_elements_text(r -> 'kept_waiver_history') x))
   from r108 where tag = 'rw1'),
  'rewritten=3 kept_commissioner_choice=4 kept_waiver_history=2,5',
  'E1 the rewrite (fixture leagues): L3 (the old default, no history) rewritten; L4 kept (the commissioner changed it); L2 and L5 kept (they have won waiver claims)');
select is(
  (select string_agg(format('%s:%s', right(l.name, 2), coalesce(l.settings ->> 'faab_tiebreaker', '-')), ' ' order by l.name)
   from leagues l where l.name like 'pgtap-ft-%'),
  'L1:- L2:reverse_standings L3:rolling_priority L4:reverse_standings L5:reverse_standings L6:rolling_priority L7:- L8:reverse_standings',
  'E2 the stored values after: only L3 moved; a missing key stays missing (it follows the fallback), rolling stays rolling, a deleted league is untouched');
select is(
  (select (l.settings - 'faab_tiebreaker') = ((select r from r108 where tag = 'before') -> l.id::text) - 'faab_tiebreaker'
   from leagues l where l.id = pg_temp.lg(3)),
  true,
  'E3 the rewrite touched only the tiebreaker key of L3');
select is(
  (public.faab_tiebreaker_old_default_rewrite_internal() -> 'rewritten'),
  '[]'::jsonb,
  'E4 run again it rewrites nothing (idempotent)');

select * from finish();
rollback;
