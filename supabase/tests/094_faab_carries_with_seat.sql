-- ============================================================================
-- FAAB carries with the seat once the draft has started — pgTAP 094
-- (M5 task L.D2.6; migration 146; conflict C72; spec §12.2 v2.8.7 note +
-- its v2.16.55 clarification, §7.2.1(a)/(b)/(c), E49; tasks-M5 TD2).
--
-- Numbering: pgTAP head measured 093 at task time (ls supabase/tests |
-- tail -1) ⇒ 094. OWN FIXTURE: users 94…, leagues b4…, teams c4…, seats d4….
--
-- Falsifiability (tasks-M1 §4.3):
--   * THE STATUS BOUNDARY as stored literals (§C, §F): the same takeover
--     over a seat holding 40 of a 100 budget reads 100 in setup and
--     scheduled and 40 in drafting, in_season, playoffs and complete — the
--     scheduled / drafting pair is the boundary one status apart, and the
--     vacate / leave / seat-fill gates are pinned on the same pair.
--   * EVERY PATH (§D, the task acceptance): a team that spent 60 of 100
--     keeps 40 through takeover, vacate + re-seat (assign), leave + re-seat
--     (invite claim), and retire-and-succeed + seating the successor.
--   * PRE-DRAFT UNCHANGED (§E): each path re-seeds 100, and the seat fill
--     re-seeds a stale stored placeholder value (55) — never trusted.
--   * ZERO ROWS PROVEN (§G): a franchise with NO seat row refuses by name
--     after the draft has started and writes nothing; an OCCUPIED seat row
--     (the other zero-fill reason) still yields the E54 copy; before the
--     draft the no-row franchise is seated with the budget as always.
--   * WHOLE-LEAGUE MONEY LITERALS (§H): every seat balance in the in-season
--     and setup leagues after all paths ran, one string each.
--   * BREAK PROBES shown red in the PR, then reverted: ungate takeover (C4
--     red); widen the re-seed to drafting (C3 / F4 / F6 red); ungate the
--     seat fill (D2 / D5 / D7 / F5 red); drop the zero-row proof (G1 / G2
--     red).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(41);

-- ---------------------------------------------------------------------------
-- A. Shape: same signatures, same security posture, no unguarded re-seed.
-- ---------------------------------------------------------------------------
select ok(
  to_regprocedure('public.remove_manager(uuid,uuid,text,uuid,text,uuid)') is not null
  and to_regprocedure('public.leave_league(uuid)') is not null
  and to_regprocedure('public.seat_league_member_internal(uuid,uuid,integer,uuid)') is not null,
  'A1 the three replaced functions keep their signatures (no overload, no DROP)');
select ok(
  (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
                   and not has_function_privilege('anon', p.oid, 'EXECUTE')
                   and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
   from pg_proc p
   where p.oid in ('public.remove_manager(uuid,uuid,text,uuid,text,uuid)'::regprocedure,
                   'public.leave_league(uuid)'::regprocedure)),
  'A2 remove_manager and leave_league: SECURITY DEFINER, search_path empty, anon no EXECUTE, authenticated EXECUTE');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
   from pg_proc p where p.oid = 'public.seat_league_member_internal(uuid,uuid,integer,uuid)'::regprocedure),
  'A3 seat_league_member_internal stays PLAIN (invoker), search_path empty, REVOKEd from every client role');
select is(
  (select count(*)::int from pg_proc p
   where p.oid in ('public.remove_manager(uuid,uuid,text,uuid,text,uuid)'::regprocedure,
                   'public.leave_league(uuid)'::regprocedure,
                   'public.seat_league_member_internal(uuid,uuid,integer,uuid)'::regprocedure)
     and p.prosrc ~ 'faab_balance = (v_league\.faab_budget|p_faab_budget)\s*\n'),
  0,
  'A4 no unguarded FAAB re-seed is left in the three seat-fill bodies (C72)');
select is(
  (select count(*)::int from pg_proc p
   where p.oid in ('public.remove_manager(uuid,uuid,text,uuid,text,uuid)'::regprocedure,
                   'public.leave_league(uuid)'::regprocedure,
                   'public.seat_league_member_internal(uuid,uuid,integer,uuid)'::regprocedure)
     and p.prosrc ~ 'IN \(''setup'', ''scheduled''\)\s+THEN (v_league\.faab_budget|p_faab_budget) ELSE faab_balance END'),
  3,
  'A5 all three bodies carry the pre-draft gate (setup / scheduled re-seed, everything else carries)');
select ok(
  (select p.prosrc ~ 'FROM public\.leagues l\s+WHERE l\.id = p_league_id\s+FOR UPDATE'
   from pg_proc p where p.oid = 'public.seat_league_member_internal(uuid,uuid,integer,uuid)'::regprocedure),
  'A6 the seat helper reads the league status under a row lock (TOCTOU-safe on its own; the callers already hold it)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context).
--    u1 commissioner everywhere · u2 the takeover target (every league) ·
--    u3 the takeover successor · u4 vacated · u5 assigned onto the vacated
--    seat · u6 leaves · u7 claims the left seat · u8 retired · u9 seated on
--    the successor · u10 assigned onto the no-seat-row franchise · u11
--    occupies a seat with no stint · u12 tries to be assigned there.
--    Every target seat holds 40 of a 100 budget (spent 60).
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('94000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
  'authenticated', 'authenticated', 'pgtap-fc' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  json_build_object('username', 'fc_user' || i)::jsonb, now(), now()
from generate_series(1, 12) i;

insert into leagues (id, owner_id, name, season, status, faab_budget, scoring_system_id, scoring_rules_snapshot)
select ('b4000000-0000-4000-8000-00000000000' || s.n)::uuid, '94000000-0000-4000-8000-000000000001',
       'pgtap-fc-L' || s.n, 2026, s.status, 100,
       (select id from scoring_systems where is_template and name = 'ESPN Standard'),
       (select rules from scoring_systems where is_template and name = 'ESPN Standard')
from (values (1, 'setup'), (2, 'scheduled'), (3, 'drafting'), (4, 'in_season'), (5, 'playoffs'), (6, 'complete')) s(n, status);

-- Franchises: seat k in league n is team c4…00nk / seat row d4…00nk.
-- k: 1 commissioner · 2 takeover · 3 vacate · 4 leave · 5 retire · 6 no
-- seat row · 7 occupied with no stint.
create temp table _fx (n int, k int, label text, uid int, bal int, seat boolean, stint boolean);
insert into _fx values
 (1,1,'Commish',1,100,true,true), (1,2,'Takeover',2,40,true,true), (1,3,'Vacate',4,40,true,true), (1,4,'Leave',6,40,true,true), (1,6,'Bare',null,null,false,false),
 (2,1,'Commish',1,100,true,true), (2,2,'Takeover',2,40,true,true), (2,3,'Vacate',4,40,true,true), (2,4,'Leave',6,40,true,true),
 (3,1,'Commish',1,100,true,true), (3,2,'Takeover',2,40,true,true), (3,3,'Vacate',4,40,true,true), (3,4,'Leave',6,40,true,true),
 (4,1,'Commish',1,100,true,true), (4,2,'Takeover',2,40,true,true), (4,3,'Vacate',4,40,true,true), (4,4,'Leave',6,40,true,true),
 (4,5,'Retire',8,40,true,true), (4,6,'Bare',null,null,false,false), (4,7,'Occupied',11,40,true,false),
 (5,1,'Commish',1,100,true,true), (5,2,'Takeover',2,40,true,true),
 (6,1,'Commish',1,100,true,true), (6,2,'Takeover',2,40,true,true);

insert into teams (id, owner_id, name, league_id)
select ('c4000000-0000-4000-8000-0000000000' || f.n || f.k)::uuid,
       '94000000-0000-4000-8000-000000000001',
       'FC' || f.n || ' ' || f.label,
       ('b4000000-0000-4000-8000-00000000000' || f.n)::uuid
from _fx f;
insert into league_members (id, league_id, user_id, team_id, role, faab_balance)
select ('d4000000-0000-4000-8000-0000000000' || f.n || f.k)::uuid,
       ('b4000000-0000-4000-8000-00000000000' || f.n)::uuid,
       ('94000000-0000-4000-8000-0000000000' || lpad(f.uid::text, 2, '0'))::uuid,
       ('c4000000-0000-4000-8000-0000000000' || f.n || f.k)::uuid,
       case when f.k = 1 then 'commissioner' else 'manager' end,
       f.bal
from _fx f where f.seat;
insert into team_managers (league_id, team_id, user_id, role, started_at)
select ('b4000000-0000-4000-8000-00000000000' || f.n)::uuid,
       ('c4000000-0000-4000-8000-0000000000' || f.n || f.k)::uuid,
       ('94000000-0000-4000-8000-0000000000' || lpad(f.uid::text, 2, '0'))::uuid,
       'manager', now() - interval '30 days'
from _fx f where f.stint;

-- Every call below is the commissioner's unless it says otherwise.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

-- ---------------------------------------------------------------------------
-- C. THE STATUS MATRIX — takeover of the seat holding 40 (budget 100).
-- ---------------------------------------------------------------------------
select public.remove_manager(('b4000000-0000-4000-8000-00000000000' || n)::uuid,
                             ('d4000000-0000-4000-8000-0000000000' || n || '2')::uuid,
                             'takeover', '94000000-0000-4000-8000-000000000003')
from generate_series(1, 6) n;

reset role;
select results_eq(
  $$ select lm.user_id, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000012' $$,
  $$ values ('94000000-0000-4000-8000-000000000003'::uuid, 100) $$,
  'C1 setup: the successor is seated and the balance RE-SEEDS to the budget (pre-draft balances carry no history, v2.8.7)');
select results_eq(
  $$ select lm.user_id, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000022' $$,
  $$ values ('94000000-0000-4000-8000-000000000003'::uuid, 100) $$,
  'C2 scheduled: still before the draft, the balance RE-SEEDS to 100');
select results_eq(
  $$ select lm.user_id, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000032' $$,
  $$ values ('94000000-0000-4000-8000-000000000003'::uuid, 40) $$,
  'C3 drafting: the draft has started, the successor INHERITS 40 (the boundary, one status after C2)');
select results_eq(
  $$ select lm.user_id, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000042' $$,
  $$ values ('94000000-0000-4000-8000-000000000003'::uuid, 40) $$,
  'C4 in_season: takeover inherits the franchise whole, FAAB included (7.2.1(a)) — 40, not a fresh 100 (C72)');
select results_eq(
  $$ select lm.user_id, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000052' $$,
  $$ values ('94000000-0000-4000-8000-000000000003'::uuid, 40) $$,
  'C5 playoffs: 40 carries');
select results_eq(
  $$ select lm.user_id, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000062' $$,
  $$ values ('94000000-0000-4000-8000-000000000003'::uuid, 40) $$,
  'C6 complete: 40 carries');

-- ---------------------------------------------------------------------------
-- D. THE IN-SEASON PATHS (league 4) — the task acceptance.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.remove_manager('b4000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-000000000043', 'vacate');
reset role;
select results_eq(
  $$ select lm.user_id is null, lm.is_placeholder, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000043' $$,
  $$ values (true, true, 40) $$,
  'D1 vacate: the seat opens (placeholder) and KEEPS 40 for the next manager');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.assign_manager('b4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000043', '94000000-0000-4000-8000-000000000005');
reset role;
select results_eq(
  $$ select lm.user_id, lm.is_placeholder, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000043' $$,
  $$ values ('94000000-0000-4000-8000-000000000005'::uuid, false, 40) $$,
  'D2 vacate + assign: the new manager fills the same seat row and inherits 40 (the seat fill no longer re-seeds after the draft)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select public.leave_league('b4000000-0000-4000-8000-000000000004');
reset role;
select results_eq(
  $$ select lm.user_id is null, lm.is_placeholder, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000044' $$,
  $$ values (true, true, 40) $$,
  'D3 leave: the seat opens and KEEPS 40');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _inv4 as
select public.create_league_invite('b4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000044') as r;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000007", "role": "authenticated"}', true);
create temp table _claim4 as
select public.claim_league_invite((select r ->> 'token' from _inv4)) as r;
reset role;
select is(
  (select (r ->> 'ok')::boolean from _claim4), true,
  'D4 the seat-targeted invite to the left seat is claimed in season');
select results_eq(
  $$ select lm.user_id, lm.is_placeholder, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000044' $$,
  $$ values ('94000000-0000-4000-8000-000000000007'::uuid, false, 40) $$,
  'D5 leave + claim: the claimer inherits 40 through the same seat row');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _ret4 as
select public.remove_manager('b4000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-000000000045',
                             'retire', null, 'pgtap retire', 'a4000000-0000-4000-8000-000000000045') as r;
reset role;
select results_eq(
  $$ select lm.user_id is null, lm.is_placeholder, lm.team_id = ((select r ->> 'successor_team_id' from _ret4))::uuid, lm.faab_balance
     from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000045' $$,
  $$ values (true, true, true, 40) $$,
  'D6 retire-and-succeed: the seat row fronts the successor franchise with 40 (E49 inherits FAAB; 120 untouched)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.assign_manager('b4000000-0000-4000-8000-000000000004',
                             ((select r ->> 'successor_team_id' from _ret4))::uuid,
                             '94000000-0000-4000-8000-000000000009');
reset role;
select results_eq(
  $$ select lm.user_id, lm.is_placeholder, lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000045' $$,
  $$ values ('94000000-0000-4000-8000-000000000009'::uuid, false, 40) $$,
  'D7 retire + seating the successor: the new manager inherits 40');
select is(
  (select r -> 'inherits' ->> 'faab' from _ret4), 'seat_balance_kept',
  'D8 the retire payload still names the FAAB inheritance (120 byte-identical)');

-- ---------------------------------------------------------------------------
-- E. PRE-DRAFT UNCHANGED (league 1, setup) — every path re-seeds.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.remove_manager('b4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000013', 'vacate');
reset role;
select is(
  (select lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000013'), 100,
  'E1 setup vacate: the open seat re-seeds to the budget');
-- A stale stored placeholder value — the fill must not trust it.
update league_members set faab_balance = 55 where id = 'd4000000-0000-4000-8000-000000000013';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.assign_manager('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000013', '94000000-0000-4000-8000-000000000005');
reset role;
select is(
  (select lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000013'), 100,
  'E2 setup assign: a stored placeholder 55 is re-seeded to 100 (never trusted before the draft)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select public.leave_league('b4000000-0000-4000-8000-000000000001');
reset role;
select is(
  (select lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000014'), 100,
  'E3 setup leave: the open seat re-seeds to the budget');
update league_members set faab_balance = 55 where id = 'd4000000-0000-4000-8000-000000000014';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
create temp table _inv1 as
select public.create_league_invite('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000014') as r;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000007", "role": "authenticated"}', true);
create temp table _claim1 as
select public.claim_league_invite((select r ->> 'token' from _inv1)) as r;
reset role;
select results_eq(
  $$ select (select (r ->> 'ok')::boolean from _claim1), lm.user_id, lm.faab_balance
     from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000014' $$,
  $$ values (true, '94000000-0000-4000-8000-000000000007'::uuid, 100) $$,
  'E4 setup claim: the claimer is seated and a stored placeholder 55 is re-seeded to 100');

-- ---------------------------------------------------------------------------
-- F. THE BOUNDARY on the vacate / seat-fill / leave gates: scheduled (2)
--    re-seeds, drafting (3) carries — one status apart.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.remove_manager(('b4000000-0000-4000-8000-00000000000' || n)::uuid,
                             ('d4000000-0000-4000-8000-0000000000' || n || '3')::uuid, 'vacate')
from generate_series(2, 3) n;
reset role;
select is(
  (select lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000023'), 100,
  'F1 scheduled vacate: re-seeds to 100');
select is(
  (select lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000033'), 40,
  'F2 drafting vacate: keeps 40');
update league_members set faab_balance = 55 where id = 'd4000000-0000-4000-8000-000000000023';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.assign_manager(('b4000000-0000-4000-8000-00000000000' || n)::uuid,
                             ('c4000000-0000-4000-8000-0000000000' || n || '3')::uuid,
                             '94000000-0000-4000-8000-000000000005')
from generate_series(2, 3) n;
reset role;
select is(
  (select lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000023'), 100,
  'F3 scheduled assign: a stored 55 re-seeds to 100');
select is(
  (select lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000033'), 40,
  'F4 drafting assign: the new manager inherits 40');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select public.leave_league(('b4000000-0000-4000-8000-00000000000' || n)::uuid) from generate_series(2, 3) n;
reset role;
select is(
  (select lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000024'), 100,
  'F5 scheduled leave: re-seeds to 100');
select is(
  (select lm.faab_balance from league_members lm where lm.id = 'd4000000-0000-4000-8000-000000000034'), 40,
  'F6 drafting leave: keeps 40');

-- ---------------------------------------------------------------------------
-- G. ZERO ROWS FILLED, PROVEN — never a fresh budget after the draft.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.assign_manager('b4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000046', '94000000-0000-4000-8000-000000000010') $$,
  'P0001',
  'seat_league_member_internal: franchise c4000000-0000-4000-8000-000000000046 has no seat row in league b4000000-0000-4000-8000-000000000004 — its FAAB balance cannot be carried, and a fresh budget is never minted once the draft has started (§12.2 / C72); repair the seat before seating a manager',
  'G1 in season, a franchise with NO seat row refuses BY NAME (no balance to carry; none minted)');
reset role;
select is(
  (select count(*)::text from league_members lm where lm.team_id = 'c4000000-0000-4000-8000-000000000046')
  || ':' ||
  (select count(*)::text from team_managers tm where tm.team_id = 'c4000000-0000-4000-8000-000000000046'),
  '0:0',
  'G2 the refusal wrote nothing: no seat row, no stint for that franchise');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.assign_manager('b4000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000047', '94000000-0000-4000-8000-000000000012') $$,
  'P0001',
  'assign_manager: that seat was just claimed by someone else — refresh and try again',
  'G3 the OTHER zero-fill reason (an occupied seat row) still reaches the E54 copy through the unique violation, not the new refusal');
reset role;
select results_eq(
  $$ select lm.user_id, lm.faab_balance from league_members lm where lm.team_id = 'c4000000-0000-4000-8000-000000000047' $$,
  $$ values ('94000000-0000-4000-8000-000000000011'::uuid, 40) $$,
  'G4 the occupied seat is untouched (occupant and 40 unchanged)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "94000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select public.assign_manager('b4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000016', '94000000-0000-4000-8000-000000000010');
reset role;
select results_eq(
  $$ select lm.user_id, lm.faab_balance from league_members lm where lm.team_id = 'c4000000-0000-4000-8000-000000000016' $$,
  $$ values ('94000000-0000-4000-8000-000000000010'::uuid, 100) $$,
  'G5 before the draft the no-seat-row franchise is seated with the budget, as it always was (one status class away from G1)');

-- ---------------------------------------------------------------------------
-- H. WHOLE-LEAGUE MONEY LITERALS after every path above.
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(t.name || '=' || lm.faab_balance, ' ' order by t.name collate "C")
   from league_members lm join teams t on t.id = lm.team_id
   where lm.league_id = 'b4000000-0000-4000-8000-000000000004'),
  'FC4 Commish=100 FC4 Leave=40 FC4 Occupied=40 FC4 Takeover=40 FC4 Vacate=40 Team 8=40',
  'H1 in season: every seat balance after takeover, vacate + assign, leave + claim, retire + seat and both refusals — no seat was handed a fresh budget');
select is(
  (select string_agg(t.name || '=' || lm.faab_balance, ' ' order by t.name collate "C")
   from league_members lm join teams t on t.id = lm.team_id
   where lm.league_id = 'b4000000-0000-4000-8000-000000000001'),
  'FC1 Bare=100 FC1 Commish=100 FC1 Leave=100 FC1 Takeover=100 FC1 Vacate=100',
  'H2 setup: every seat re-seeded to the budget, exactly the pre-146 behaviour');
select is(
  (select string_agg(t.name || '=' || lm.faab_balance, ' ' order by t.name collate "C")
   from league_members lm join teams t on t.id = lm.team_id
   where lm.league_id = 'b4000000-0000-4000-8000-000000000003'),
  'FC3 Commish=100 FC3 Leave=40 FC3 Takeover=40 FC3 Vacate=40',
  'H3 drafting: every moved seat kept 40');
select is(
  (select string_agg(t.name || '=' || lm.faab_balance, ' ' order by t.name collate "C")
   from league_members lm join teams t on t.id = lm.team_id
   where lm.league_id = 'b4000000-0000-4000-8000-000000000002'),
  'FC2 Commish=100 FC2 Leave=100 FC2 Takeover=100 FC2 Vacate=100',
  'H4 scheduled: every moved seat re-seeded to 100');
select is(
  (select count(*)::int from league_members lm
   where lm.league_id in ('b4000000-0000-4000-8000-000000000003', 'b4000000-0000-4000-8000-000000000004',
                          'b4000000-0000-4000-8000-000000000005', 'b4000000-0000-4000-8000-000000000006')
     and lm.faab_balance = 100 and lm.role <> 'commissioner'),
  0,
  'H5 after the draft started, no manager seat in any fixture league holds a fresh 100');
select is(
  (select count(*)::int from league_members lm
   where lm.league_id::text like 'b4000000-0000-4000-8000-00000000000%' and lm.faab_balance is null),
  0,
  'H6 no seat was left with a NULL balance');

select * from finish();
rollback;
