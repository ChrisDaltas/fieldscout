-- ============================================================================
-- League member management — migration 063 (+ the placeholder-FILL amendment
-- to 062's seat_league_member_internal / claim_league_invite).
-- Spec §7.2 (roles, placeholder seats, capacity, the creator anti-coup rule),
-- §7.2.1 (stints; takeover/retire/vacate; leave), §12.2, §12.22, §15.1, §17;
-- task L.A1.15; PROGRESS D42/D47/D63/D74; standing rules tasks-M1 §4.
-- pgTAP file is **017** (016 = invite RPCs; next free confirmed at task time).
--
-- Falsifiability notes (§4.3) — per group, why each assertion can only fail
-- for the reason it claims. **The letters below are the letters in this file**
-- (re-derived against the shipped layout by the batch-15 remediation — R97
-- found the previous map mis-lettered, 8 of 10 bullets pointing at the wrong
-- section, which is how a note describing a real mechanism can still send a
-- reader to the wrong place):
--   * A (shape/ACL): the search_path pin uses the R70 exact-value form
--     (`search_path=""`), so a rebuild that pins `public` fails; the ACL pins
--     assert BOTH directions (anon has none, authenticated has all), so a
--     blanket REVOKE and a missing REVOKE both trip.
--   * B (integrity, R43 class — EXISTENCE half): the partial unique index is
--     pinned by name. Its behavioural half — a PRIVILEGED (postgres-context)
--     write that an API-only guard would sail through — lives at the END of I,
--     where the role fixtures it needs already exist (D69: a sanctioned writer
--     is not a backstop, PostgREST reaches every RPC directly).
--   * C: fixtures only, no assertions. Four leagues, ONE commissioner across
--     L1/L2/L3 — which is what makes every cross-league refusal falsifiable
--     (only the league argument can be doing the work).
--   * D (add_placeholder_seat shape): the §7.2:170 row shape, the faab
--     literal 777 (a hardcoded 100 fails — R79's amplification lesson), the
--     deterministic name, and the deliberate ABSENCE of a stint.
--   * E (RLS surface, §4.2 per role): writes RLS filters silently
--     (UPDATE/DELETE) use the RETURNING-count pattern preceded by a same-role
--     SELECT-sees-N pin, so "0 affected" can never mask "0 visible"; INSERT
--     expects 42501. The commissioner's placeholder INSERT — LEGAL before 063
--     and pinned as legal by 006 — is now asserted DENIED (the S2/D74(3)
--     policy removal): restoring either dropped policy fails this file AND
--     006 together.
--   * F: the S1 placeholder-claim regression is asserted on the OUTCOME (ok
--     true, seated row shape) AND on the invite staying live — the pre-fix
--     code returned seat_filled AND expired the invite, so both halves move.
--   * G (assign_manager + refusals): each refusal fixture satisfies EXACTLY
--     ONE guard, and the two that could not (R91/R92) were retargeted by the
--     batch-15 remediation: the "already has a team" case now aims at an
--     EMPTY seat (the occupied one also tripped the open-stint guard) and the
--     cross-league case at a STINT-FREE seat with a user seated in neither
--     league (the old fixture let the mutant raise a different P0001). Both
--     now assert the MESSAGE via throws_like — an SQLSTATE alone cannot tell
--     two P0001s apart, which is exactly how they were vacuous.
--   * H (capacity): the boundary pair is exact-edge + one-past, and the
--     one-past case asserts NO teams row and NO league_members row were
--     written, not merely that an error was raised (R24's lesson: an
--     off-by-one `>=`→`>` passes an error-only test). Cross-writer coherence
--     re-runs the F28 pair against the THIRD writer.
--   * I (role invariants): every actor fixture is a seated CO-COMMISSIONER,
--     never a plain manager — a manager is already refused by
--     is_league_commish, so the guard could be deleted and a manager-actor
--     test would still pass (the R11/R14/R26/R34/R52/R70 vacuous-fixture
--     class). The API refusal and the DB index are pinned SEPARATELY (the
--     privileged-write block at the end of the group). The transfer REPLAY
--     (R94) is pinned beside the transfer itself: without the idempotent arm
--     it raises, so the assert cannot pass for another reason.
--   * J (remove_manager, stint history, E51 analogue): the closed stint's
--     started_at is golden-pinned as a literal captured BEFORE the removal,
--     so a merge-in-place implementation (which would rewrite it) fails even
--     though the row count matches; started_at values are asserted DISTINCT
--     and the reopen path is pinned at 23505 (the index, R46's gap).
--   * K + L (access revocation, E50 analogue) run in BOTH fixture shapes —
--     plain manager (K) AND the departed CREATOR after a role transfer (L) —
--     because leagues' SELECT policy has an `owner_id = auth.uid()` branch
--     that a manager-only fixture hides entirely (F36). L also carries the
--     R90 pin: the departing member owns NO franchise in the league
--     afterwards, not merely their own seat.
--   * M is the documentation pin for the §7.2.1:188 wording: closing ONLY
--     the stint revokes NOTHING in M1 (asserted, not commented). If a future
--     milestone moves an RLS predicate onto team_managers, M flips and forces
--     the doc update (F35).
--   * N: is_league_commish ignores deleted_at, so the P0002 assertions
--     genuinely reach the deleted branch instead of short-circuiting on authz
--     — pinned explicitly by asserting is_league_commish is still TRUE there.
--   * O (authorization floor): outsider refusals on all five RPCs, plus the
--     R86 cross-league member addressing with a same-league CONTROL, so the
--     refusal cannot be a blanket denial.
--   * P: the solo-commissioner dead end asserts the MESSAGE (throws_like),
--     because the generic transfer-first refusal carries the same SQLSTATE.
--   * Q: the post-draft gate takes the SANCTIONED snapshot first (the D43
--     guard forbids drafting+ without one) rather than forcing an invalid row.
--   * R (authorization ordering, R93): the guard is a RACE guard, so it has
--     no single-session behavioural fixture — pinned STRUCTURALLY instead, by
--     asserting each RPC re-reads the actor's role AFTER its first `FOR
--     UPDATE`. Deleting a re-gate fails exactly one assert, naming its RPC.
--   * S (notification rows): the notifier swallows every error by design, so
--     an INSERT that stopped happening is invisible to every other assert in
--     this file — the takeover/vacate rows are pinned by recipient AND
--     outcome category. The LEAVE recipient is deliberately NOT pinned: spec
--     question **Q11** (§7.2.1:190 vs the shipped commissioner-only
--     notification) must be ruled first — ledger **F37**.
--   * All auth.users fixtures run BEFORE any claims are set (D49(7));
--     mid-test privileged forcing uses `reset role` (the 013/014 pattern).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(163);

-- ---------------------------------------------------------------------------
-- A. Shape: the five RPCs + the two internals, SECURITY DEFINER, exact
--    search_path, ACLs (§4.1 / grants doctrine D18→D23).
-- ---------------------------------------------------------------------------
select has_function('public', 'add_placeholder_seat', array['uuid','text'],
  'add_placeholder_seat exists');
select has_function('public', 'set_member_role', array['uuid','uuid','text'],
  'set_member_role exists');
select has_function('public', 'assign_manager', array['uuid','uuid','uuid'],
  'assign_manager exists');
select has_function('public', 'remove_manager', array['uuid','uuid','text','uuid','text'],
  'remove_manager exists (the full three-outcome §15.1 signature)');
select has_function('public', 'leave_league', array['uuid'],
  'leave_league exists (no p_user_id — it can only act on auth.uid())');
select has_function('public', 'notify_league_member_internal',
  array['uuid','text','text','text','jsonb'],
  'notify_league_member_internal exists (internal)');
select has_function('public', 'seat_league_member_internal',
  array['uuid','uuid','integer','uuid'],
  'seat_league_member_internal carries p_team_id (062 amended in place — the ONE seating implementation)');

select is_definer('public', 'add_placeholder_seat', array['uuid','text'],
  'add_placeholder_seat is SECURITY DEFINER');
select is_definer('public', 'set_member_role', array['uuid','uuid','text'],
  'set_member_role is SECURITY DEFINER');
select is_definer('public', 'assign_manager', array['uuid','uuid','uuid'],
  'assign_manager is SECURITY DEFINER');
select is_definer('public', 'remove_manager', array['uuid','uuid','text','uuid','text'],
  'remove_manager is SECURITY DEFINER');
select is_definer('public', 'leave_league', array['uuid'],
  'leave_league is SECURITY DEFINER');
select ok(
  not (select p.prosecdef from pg_proc p
       where p.oid = 'public.notify_league_member_internal(uuid,text,text,text,jsonb)'::regprocedure),
  'notify_league_member_internal is a PLAIN function (runs inside the definer RPC''s context)');

select ok(
  (select count(*) = 6 and coalesce(bool_and(array_to_string(p.proconfig, ',') = 'search_path=""'), false)
     from pg_proc p
     where p.oid = any (array[
       'public.add_placeholder_seat(uuid,text)'::regprocedure,
       'public.set_member_role(uuid,uuid,text)'::regprocedure,
       'public.assign_manager(uuid,uuid,uuid)'::regprocedure,
       'public.remove_manager(uuid,uuid,text,uuid,text)'::regprocedure,
       'public.leave_league(uuid)'::regprocedure,
       'public.notify_league_member_internal(uuid,text,text,text,jsonb)'::regprocedure])),
  'all six functions pin search_path='''' exactly (§12.0/D45; R70 exact-value form)');

select ok(
  not has_function_privilege('anon', 'public.add_placeholder_seat(uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_member_role(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.assign_manager(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.remove_manager(uuid,uuid,text,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.leave_league(uuid)', 'EXECUTE'),
  'anon holds NO EXECUTE on any member-management RPC (037''s default ACLs make the REVOKE load-bearing)');
select ok(
  has_function_privilege('authenticated', 'public.add_placeholder_seat(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_member_role(uuid,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.assign_manager(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.remove_manager(uuid,uuid,text,uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.leave_league(uuid)', 'EXECUTE'),
  'authenticated keeps EXECUTE on all five (the in-body checks are the gate, not the ACL)');
select ok(
  not has_function_privilege('anon', 'public.notify_league_member_internal(uuid,text,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.notify_league_member_internal(uuid,text,text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.seat_league_member_internal(uuid,uuid,integer,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.seat_league_member_internal(uuid,uuid,integer,uuid)', 'EXECUTE'),
  'both internal helpers: NO client role holds EXECUTE (reachable only through the definer RPCs)');

-- ---------------------------------------------------------------------------
-- B. Integrity constraints (R43 class) — pinned with PRIVILEGED writes, the
--    same context a SECURITY DEFINER RPC runs in (D69: the API is not a
--    backstop; PostgREST reaches every RPC directly).
-- ---------------------------------------------------------------------------
select has_index('public', 'league_members', 'one_commissioner_per_league',
  'partial unique index one_commissioner_per_league exists (§7.2 "Exactly one commissioner" — it had ZERO DB backing before 063)');

-- ---------------------------------------------------------------------------
-- C. Fixtures (postgres context — BEFORE any claims are set, D49(7)).
--    u1 commissioner of L1/L2/L3/L4 (the cross-league refusals are only
--    falsifiable because ONE user commissions both leagues); u2 co-commish;
--    u3 plain manager; u4 the assign/takeover target; u5 successor;
--    u6 outsider; u7 second joiner; u8 stint-doc member; u9 spare.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000',
  ('98000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  'pgtap-mm' || n || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('username', uname), now(), now()
from (values
  (1, 'mm_commish_one'), (2, 'mm_cocom_two'), (3, 'mm_mgr_three'),
  (4, 'mm_target_four'), (5, 'mm_succ_five'), (6, 'mm_out_six'),
  (7, 'mm_join_seven'), (8, 'mm_doc_eight'), (9, 'mm_spare_nine')
) as t(n, uname);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);

-- L1: the working league (faab_budget 777 — a literal a hardcoded 100 fails,
-- R79's amplification lesson).
create temp table _l1 as
select public.create_league(
  'pgtap-mm-league-1', 2026, 8,
  '{"divisions": 0}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Commish One', 'b3000000-0000-4000-8000-000000000001',
  'redraft', 14, 6, 15, 'faab', 777, 'commissioner', null, 'per_player_kickoff') as r;
-- L2: the cross-league control — SAME commissioner (falsifiability: the
-- refusal can only come from the league argument).
create temp table _l2 as
select public.create_league(
  'pgtap-mm-league-2', 2026, 8,
  '{"divisions": 0}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Commish Two', 'b3000000-0000-4000-8000-000000000002',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') as r;
-- L3: the capacity-boundary league (team_count 10 so the F28 shrink has room
-- to be refused — 8 is the floor of the allowed set).
create temp table _l3 as
select public.create_league(
  'pgtap-mm-league-3', 2026, 10,
  '{"divisions": 0}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Commish Three', 'b3000000-0000-4000-8000-000000000003',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') as r;
-- L4: soft-deleted (the P0002 arms).
create temp table _l4 as
select public.create_league(
  'pgtap-mm-league-4', 2026, 8,
  '{"divisions": 0}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Commish Four', 'b3000000-0000-4000-8000-000000000004',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') as r;

create temp table _ids as
select ((select r from _l1) ->> 'league_id')::uuid as l1,
       ((select r from _l2) ->> 'league_id')::uuid as l2,
       ((select r from _l3) ->> 'league_id')::uuid as l3,
       ((select r from _l4) ->> 'league_id')::uuid as l4,
       ((select r from _l1) ->> 'team_id')::uuid   as l1_commish_team;

-- Session GUC copy of L1's id: the anon block below cannot read a temp table
-- owned by `authenticated`, and a GUC is role-independent.
select set_config('pgtap.mm_l1', (select l1::text from _ids), true);

-- ---------------------------------------------------------------------------
-- D. add_placeholder_seat: the §7.2:170 shape, faab parity, naming contract.
-- ---------------------------------------------------------------------------
create temp table _seat1 as
select public.add_placeholder_seat((select l1 from _ids)) as r;

select is(
  (select (r ->> 'team_name') from _seat1), 'Team 2',
  'default franchise name is the deterministic "Team N" contract (N = non-retired count + 1 — §7.2:165''s own invite copy)');

reset role;
select results_eq(
  $$ select lm.user_id is null, lm.is_placeholder, lm.role, lm.faab_balance,
            lm.team_id = ((select r from _seat1) ->> 'team_id')::uuid
     from public.league_members lm
     where lm.id = ((select r from _seat1) ->> 'member_id')::uuid $$,
  $$ values (true, true, 'manager', 777, true) $$,
  'placeholder cache row: user_id NULL, is_placeholder TRUE (set EXPLICITLY — the column is nullable), role manager, faab seeded from the CURRENT budget, team_id SET (the seat IS a franchise — §7.2:170)');
select results_eq(
  $$ select t.status, t.owner_id, t.list_id is null, t.league_id = (select l1 from _ids)
     from public.teams t where t.id = ((select r from _seat1) ->> 'team_id')::uuid $$,
  $$ values ('active', '98000000-0000-4000-8000-000000000001'::uuid, true, true) $$,
  'placeholder franchise: owned by the commissioner, list_id NULL (D35a), status active, in this league');
select is(
  (select count(*)::int from public.team_managers tm
   where tm.team_id = ((select r from _seat1) ->> 'team_id')::uuid),
  0,
  'a placeholder seat has NO stint (team_managers.user_id is NOT NULL — which is exactly why a claim on it only ever tripped the league_members UNIQUE)');

-- ---------------------------------------------------------------------------
-- E. RLS surface after 063 (S2/D74(3)): league_members is SELECT-only on the
--    client. Per-role, §4.2 pattern.
-- ---------------------------------------------------------------------------
select policies_are('public', 'league_members',
  array['Members viewable by league members'],
  'league_members carries ONLY the member SELECT policy — 054''s two placeholder carve-outs are gone (Q8 applied consistently; D74(3))');
select policy_cmd_is('public', 'league_members', 'Members viewable by league members', 'SELECT',
  'the surviving policy is SELECT');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
-- SELECT-sees-N first, so "0 affected" below cannot mask "0 visible".
select is(
  (select count(*)::int from public.league_members lm where lm.league_id = (select l1 from _ids)),
  2,
  'commissioner SEES both L1 member rows (the same-role SELECT-sees-N pin the write assertions depend on)');
select throws_ok(
  $$ insert into league_members (league_id, user_id, is_placeholder, role)
     select (select l1 from _ids), null, true, 'manager' $$,
  '42501', null,
  'commissioner INSERT of a team-less placeholder seat is now DENIED — the 054 carve-out that made an uncapacitated seat expressible is gone (D74(3); 006''s old lives_ok moved with it)');
select results_eq(
  $$ with d as (delete from league_members
                where id = ((select r from _seat1) ->> 'member_id')::uuid returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commissioner DELETE of an RPC-created placeholder seat affects 0 rows (it was never client-deletable — the carve-out required team_id IS NULL)');
select results_eq(
  $$ with w as (update league_members set role = 'commissioner'
                where league_id = (select l1 from _ids) returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commissioner UPDATE of any member row affects 0 rows (no client UPDATE policy — roles move only through set_member_role)');

select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000006", "role": "authenticated", "email": "pgtap-mm6@fieldscout.local"}', true);
select is(
  (select count(*)::int from public.league_members lm where lm.league_id = (select l1 from _ids)),
  0,
  'outsider sees zero member rows anywhere (SELECT gate)');
select throws_ok(
  $$ insert into league_members (league_id, user_id, is_placeholder, role)
     select (select l1 from _ids), '98000000-0000-4000-8000-000000000006', false, 'manager' $$,
  '42501', null, 'outsider cannot self-join by INSERT');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  (select count(*)::int from public.league_members),
  0,
  'anon sees zero member rows');
select throws_ok(
  $$ insert into league_members (league_id, user_id, is_placeholder, role)
     values (current_setting('pgtap.mm_l1')::uuid, null, true, 'manager') $$,
  '42501', null, 'anon INSERT denied');
select results_eq(
  $$ with w as (update league_members set is_placeholder = false returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon UPDATE affects 0 rows');
select results_eq(
  $$ with d as (delete from league_members returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE affects 0 rows');
reset role;

-- ---------------------------------------------------------------------------
-- F. The S1 regression: a placeholder seat is CLAIMABLE (062's blind INSERT
--    made it unclaimable — live-proven 23505 swallowed as seat_filled, with
--    the good invite expired as collateral).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
create temp table _inv1 as
select public.create_league_invite(
  (select l1 from _ids), ((select r from _seat1) ->> 'team_id')::uuid,
  null, 'mm_cocom_two', 1) as r;

select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "pgtap-mm2@fieldscout.local"}', true);
create temp table _claim1 as
select public.claim_league_invite(((select r from _inv1) ->> 'token')) as r;

select is(
  (select (r ->> 'ok')::boolean from _claim1), true,
  'S1 REGRESSION: claiming a seat-targeted invite to a PLACEHOLDER seat succeeds (before the 062 fill amendment this returned seat_filled — D74(1))');
select is(
  (select (r ->> 'team_id') from _claim1),
  (select (r ->> 'team_id') from _seat1),
  'the claimer lands on the placeholder''s OWN franchise (no second teams row was minted)');

reset role;
select results_eq(
  $$ select lm.user_id, lm.is_placeholder, lm.role, lm.faab_balance
     from public.league_members lm
     where lm.id = ((select r from _seat1) ->> 'member_id')::uuid $$,
  $$ values ('98000000-0000-4000-8000-000000000002'::uuid, false, 'manager', 777) $$,
  'the placeholder row was FILLED in place: same row id, user set, is_placeholder cleared, faab re-seeded from the current budget (§12.2/v2.8.7)');
select is(
  (select count(*)::int from public.league_members lm
   where lm.league_id = (select l1 from _ids) and lm.team_id = ((select r from _seat1) ->> 'team_id')::uuid),
  1,
  'exactly ONE cache row for that seat (a DELETE+INSERT or a second INSERT would show two — UNIQUE(league_id, team_id) is why the old code raised)');
select results_eq(
  $$ select i.use_count, i.revoked_at is null, i.expires_at > now()
     from public.league_invites i
     where i.token = ((select r from _inv1) ->> 'token') $$,
  $$ values (1, true, true) $$,
  'the invite was CONSUMED normally and is still live-shaped — the pre-fix path expired it (expires_at = now()) as collateral damage');
select is(
  (select count(*)::int from public.team_managers tm
   where tm.team_id = ((select r from _seat1) ->> 'team_id')::uuid and tm.ended_at is null),
  1,
  'the claim opened exactly one stint on the franchise');

-- ---------------------------------------------------------------------------
-- G. assign_manager onto a placeholder + its refusals (I6).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
create temp table _seat2 as
select public.add_placeholder_seat((select l1 from _ids), 'Yardboats') as r;
select is(
  (select (r ->> 'team_name') from _seat2), 'Yardboats',
  'a caller-supplied seat name is honored (the naming contract''s explicit half)');

create temp table _assign1 as
select public.assign_manager((select l1 from _ids),
  ((select r from _seat2) ->> 'team_id')::uuid,
  '98000000-0000-4000-8000-000000000004') as r;
select is(
  (select (r ->> 'already_seated')::boolean from _assign1), false,
  'assign_manager seats a fresh manager on the placeholder franchise');
reset role;
select results_eq(
  $$ select lm.user_id, lm.is_placeholder, lm.faab_balance, lm.team_id = ((select r from _seat2) ->> 'team_id')::uuid
     from public.league_members lm
     where lm.id = ((select r from _assign1) ->> 'member_id')::uuid $$,
  $$ values ('98000000-0000-4000-8000-000000000004'::uuid, false, 777, true) $$,
  'assign FILLED the same placeholder row (faab re-seeded from the current budget — the placeholder''s stored value is never trusted)');
select results_eq(
  $$ select tm.user_id, tm.ended_at is null, tm.role
     from public.team_managers tm
     where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid $$,
  $$ values ('98000000-0000-4000-8000-000000000004'::uuid, true, 'manager') $$,
  'assign opened exactly one OPEN stint for the assignee (§12.22 — cache and history written in the same txn)');
select is(
  (select t.owner_id from public.teams t where t.id = ((select r from _seat2) ->> 'team_id')::uuid),
  '98000000-0000-4000-8000-000000000004'::uuid,
  'teams.owner_id follows the new manager (the 062 claim-path precedent)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select is(
  (select (public.assign_manager((select l1 from _ids),
     ((select r from _seat2) ->> 'team_id')::uuid,
     '98000000-0000-4000-8000-000000000004') ->> 'already_seated')::boolean),
  true,
  're-assigning the manager already on that franchise is an idempotent success (D63 retry doctrine)');
select throws_ok(
  $$ select public.assign_manager((select l1 from _ids),
       ((select r from _seat2) ->> 'team_id')::uuid,
       '98000000-0000-4000-8000-000000000007') $$,
  'P0001', null,
  'assigning over an OPEN stint is refused — silently closing an incumbent''s stint would be an unaudited kick');
-- The next two refusals need an EMPTY, STINT-FREE seat in the OTHER league:
-- aiming either of them at an occupied franchise let a second guard raise the
-- same P0001 and made the assert non-discriminating (R91/R92). L2's own
-- default seat is created first, and it doubles as the control proving the
-- cross-league refusal below is not a blanket denial.
select lives_ok(
  $$ select public.add_placeholder_seat((select l2 from _ids)) $$,
  'control: the same commissioner CAN act on L2 through L2 (so the cross-league refusal below is not a blanket denial) — and this is the empty, stint-free target the next two refusals need');
select throws_like(
  $$ select public.assign_manager((select l2 from _ids),
       (select t.id from public.teams t
        where t.league_id = (select l2 from _ids) and t.name = 'Team 2'),
       '98000000-0000-4000-8000-000000000001') $$,
  '%already has a team in this league%',
  'assigning a manager who already has a team in this league is refused with a friendly message (never an opaque 23505 from UNIQUE(league_id, user_id)) — aimed at an EMPTY seat so the open-stint guard cannot be what refuses, and pinned on the MESSAGE because deleting this guard leaves the unique_violation handler raising P0001 too (R92)');
select throws_ok(
  $$ select public.assign_manager((select l2 from _ids),
       (select t.id from public.teams t
        where t.league_id = (select l2 from _ids) and t.name = 'Team 2'),
       '98000000-0000-4000-8000-000000000001') $$,
  'P0001', null,
  'R102: and its SQLSTATE is pinned too (P0001 → 400) — kept BESIDE the message pin above, not traded for it, so both the guard identity and the status contract are covered');
select throws_like(
  $$ select public.assign_manager((select l1 from _ids),
       (select t.id from public.teams t
        where t.league_id = (select l2 from _ids) and t.name = 'Team 2'),
       '98000000-0000-4000-8000-000000000007') $$,
  '%not part of this league%',
  'CROSS-LEAGUE (R86 shape): the same commissioner cannot address L2''s franchise through L1 — the seat is STINT-FREE and u7 is seated in NEITHER league, so dropping the league scoping seats u7 in L1 on an L2 franchise instead of raising (R91); the message is pinned because the code alone cannot tell that mutant''s P0001 from this one');
select throws_ok(
  $$ select public.assign_manager((select l1 from _ids),
       (select t.id from public.teams t
        where t.league_id = (select l2 from _ids) and t.name = 'Team 2'),
       '98000000-0000-4000-8000-000000000007') $$,
  'P0001', null,
  'R102: the cross-league refusal''s SQLSTATE is pinned too (P0001 → 400) — beside the message pin, not instead of it');
select throws_ok(
  $$ select public.assign_manager((select l1 from _ids),
       ((select r from _seat2) ->> 'team_id')::uuid,
       '00000000-0000-4000-8000-0000000000ff') $$,
  'P0001', null,
  'assigning a nonexistent account is refused in-body (never an FK 23503 → 500)');

-- ---------------------------------------------------------------------------
-- H. Capacity: the boundary pair, evaluated under the league lock, with the
--    one-past case asserting NO WRITES (R24's lesson).
-- ---------------------------------------------------------------------------
-- L3 holds 1 franchise (the creator's); team_count is 8.
select lives_ok(
  $$ do $x$
     declare i int;
     begin
       for i in 1..9 loop
         perform public.add_placeholder_seat((select l3 from _ids));
       end loop;
     end $x$ $$,
  'seats fill to EXACTLY team_count (1 creator + 9 placeholders = 10)');
select is(
  (select count(*)::int from public.teams t
   where t.league_id = (select l3 from _ids) and t.status <> 'retired'),
  10,
  'the exact edge: 10 non-retired franchises in a 10-team league');
select throws_ok(
  $$ select public.add_placeholder_seat((select l3 from _ids)) $$,
  'P0001', null,
  'one past the edge: the 11th seat is refused with a friendly P0001 (D47)');
reset role;
select is(
  (select count(*)::int from public.teams t where t.league_id = (select l3 from _ids)),
  10,
  'the refused add wrote NO teams row (asserting the error alone would pass an off-by-one >= → >)');
select is(
  (select count(*)::int from public.league_members lm where lm.league_id = (select l3 from _ids)),
  10,
  'the refused add wrote NO league_members row either');

-- Cross-writer coherence (F28's guarantee at the THIRD writer). The code is
-- read in the postgres context — a non-member cannot see the league row.
select set_config('pgtap.mm_l3_code',
  (select l.invite_code from public.leagues l where l.id = (select l3 from _ids)), true);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000007", "role": "authenticated", "email": "pgtap-mm7@fieldscout.local"}', true);
select is(
  (select (public.join_league_by_code(current_setting('pgtap.mm_l3_code')) ->> 'reason')),
  'league_full',
  'cross-writer coherence: a league filled ENTIRELY by placeholder seats is full to join_league_by_code too (placeholder seats are real franchises — the 054 carve-out shape would have been invisible here)');
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select throws_ok(
  $$ select public.update_league_settings(
       (select l3 from _ids), 8,
       '{"divisions": 0}'::jsonb,
       '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
       null, 'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') $$,
  'P0001', null,
  'F28 floor still holds against placeholder-filled seats: shrinking team_count (10 → 8) below the seated count is refused — placeholder seats occupy capacity because they ARE franchises');

-- ---------------------------------------------------------------------------
-- I. Roles: the invariants, with a CO-COMMISSIONER actor (a plain manager is
--    already refused by is_league_commish — a manager fixture would be
--    vacuous).
-- ---------------------------------------------------------------------------
-- u2 (seated by the claim in F) becomes co-commissioner.
select is(
  (select (public.set_member_role((select l1 from _ids),
     (select lm.id from public.league_members lm
      where lm.league_id = (select l1 from _ids)
        and lm.user_id = '98000000-0000-4000-8000-000000000002'),
     'co_commissioner') ->> 'role')),
  'co_commissioner',
  'the commissioner promotes a manager to co_commissioner (§7.2)');
select is(
  (select (public.set_member_role((select l1 from _ids),
     (select lm.id from public.league_members lm
      where lm.league_id = (select l1 from _ids)
        and lm.user_id = '98000000-0000-4000-8000-000000000002'),
     'co_commissioner') ->> 'transferred')::boolean),
  false,
  're-setting the role a member already holds is an idempotent success (D63)');
select throws_ok(
  $$ select public.set_member_role((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000001'),
       'manager') $$,
  'P0001', null,
  'the sitting commissioner cannot be demoted (even by themselves) — the role moves only by transfer, so a league can never go headless');
select throws_ok(
  $$ select public.remove_manager((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000001'),
       'vacate') $$,
  'P0001', null,
  'nor can the sitting commissioner be REMOVED — transfer first (§7.2 "Exactly one commissioner"; run by the commissioner themselves so the creator-protection branch cannot be what refuses)');
select throws_ok(
  $$ select public.set_member_role((select l1 from _ids),
       ((select r from _seat1) ->> 'member_id')::uuid, 'banana') $$,
  '22023', null,
  'an unknown role is an argument-shape violation (22023 → 400)');

-- Now act AS the co-commissioner (u2).
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000002", "role": "authenticated", "email": "pgtap-mm2@fieldscout.local"}', true);
select throws_ok(
  $$ select public.set_member_role((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000002'),
       'commissioner') $$,
  '42501', null,
  'a CO-COMMISSIONER cannot promote themselves to commissioner (the coup path; only the sitting commissioner may transfer — D74(4))');
select throws_ok(
  $$ select public.set_member_role((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000004'),
       'commissioner') $$,
  '42501', null,
  'a co-commissioner cannot install anyone else as commissioner either');
select lives_ok(
  $$ select public.set_member_role((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000004'),
       'co_commissioner') $$,
  'control: a co-commissioner CAN change an ordinary member''s role (§7.2 "full powers") — so the refusals above are about the specific targets, not a blanket co-commish denial');
select lives_ok(
  $$ select public.set_member_role((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000004'),
       'manager') $$,
  'control: and demote them again');

-- The creator anti-coup rule, exercised where it BITES: the creator must not
-- be the commissioner, or is_league_commish/the commissioner-row guard would
-- refuse first and the branch would be vacuous. Transfer L2 to u4 first.
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select lives_ok(
  $$ select public.assign_manager((select l2 from _ids),
       (select t.id from public.teams t
        where t.league_id = (select l2 from _ids) and t.name = 'Team 2'),
       '98000000-0000-4000-8000-000000000004') $$,
  'L2 setup: u4 seated on L2''s placeholder seat');
select is(
  (select (public.set_member_role((select l2 from _ids),
     (select lm.id from public.league_members lm
      where lm.league_id = (select l2 from _ids)
        and lm.user_id = '98000000-0000-4000-8000-000000000004'),
     'commissioner') ->> 'transferred')::boolean),
  true,
  'ATOMIC TRANSFER: the sitting commissioner promotes another member to commissioner');
-- REPLAY of that exact call, by the SAME caller — who is a co_commissioner
-- now, which is what makes this the natural retry rather than a contrived
-- one (D63(5): "client retries must not error"). Before R94 the unconditional
-- headless-league guard refused it with copy asserting the target is not
-- commissioner, so this assert cannot pass without the idempotent arm.
select is(
  (select (public.set_member_role((select l2 from _ids),
     (select lm.id from public.league_members lm
      where lm.league_id = (select l2 from _ids)
        and lm.user_id = '98000000-0000-4000-8000-000000000004'),
     'commissioner') ->> 'transferred')::boolean),
  false,
  'REPLAYING a completed transfer is an idempotent success, not a P0001 (R94/D63) — and the retrier here is the transferor, now demoted to co_commissioner');
reset role;
select results_eq(
  $$ select lm.user_id, lm.role from public.league_members lm
     where lm.league_id = (select l2 from _ids) order by lm.user_id $$,
  $$ values ('98000000-0000-4000-8000-000000000001'::uuid, 'co_commissioner'),
            ('98000000-0000-4000-8000-000000000004'::uuid, 'commissioner') $$,
  'after the transfer AND its replay: exactly one commissioner and the incumbent demoted to co_commissioner — written in the same statement pair under the league lock, and the idempotent replay above moved nothing');

-- The creator (u1) is now a CO-COMMISSIONER of L2 while owner_id still names
-- them: the anti-coup guard must key on leagues.owner_id, not on role.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select lives_ok(
  $$ select public.add_placeholder_seat((select l2 from _ids), 'Coup Seat') $$,
  'L2 setup: the demoted creator (now co-commish) can still add a seat');
-- R90 fixture (leave arm): a seat the CREATOR mints and nobody ever claims,
-- so it is still owned by them when they leave L2 in §L. Without this the
-- fixture is blind — every other L2 franchise gets its owner_id moved by a
-- later assign/claim, which is exactly why the hole survived review.
create temp table _r90_leave as
select public.add_placeholder_seat((select l2 from _ids), 'Creator Seat') as r;
select lives_ok(
  $$ select public.assign_manager((select l2 from _ids),
       (select t.id from public.teams t
        where t.league_id = (select l2 from _ids) and t.name = 'Coup Seat'),
       '98000000-0000-4000-8000-000000000009') $$,
  'L2 setup: u9 seated');
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "pgtap-mm4@fieldscout.local"}', true);
select lives_ok(
  $$ select public.set_member_role((select l2 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l2 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000009'),
       'co_commissioner') $$,
  'L2 setup: u9 promoted to co-commissioner by the new commissioner');
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000009", "role": "authenticated", "email": "pgtap-mm9@fieldscout.local"}', true);
-- R90 fixture (remove arm): a seat u9 mints while holding co-commissioner
-- powers. u9 is removed at the end of this group; the seat must not stay
-- owned by them.
create temp table _r90_remove as
select public.add_placeholder_seat((select l2 from _ids), 'Ledger Seat') as r;
select throws_ok(
  $$ select public.set_member_role((select l2 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l2 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000001'),
       'manager') $$,
  '42501', null,
  'CREATOR PROTECTION (§7.2): a co-commissioner cannot demote the league CREATOR — who is, here, an ordinary co-commissioner by role, so the guard can only be keyed on leagues.owner_id');
select throws_ok(
  $$ select public.remove_manager((select l2 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l2 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000001'),
       'vacate') $$,
  '42501', null,
  'CREATOR PROTECTION: nor remove them (§7.2 "The original creator can never be removed by a co-commissioner")');
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "pgtap-mm4@fieldscout.local"}', true);
select lives_ok(
  $$ select public.set_member_role((select l2 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l2 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000001'),
       'manager') $$,
  'control: the SITTING COMMISSIONER can demote the creator (the rule is co-commissioner-scoped, exactly as §7.2 words it)');

-- R100: replaying a completed transfer whose TARGET is the league CREATOR is an
-- idempotent success, not a 42501 — the creator-target case R94 left open (its
-- NON-creator replay is pinned at the u4-target replay above). The idempotent
-- arm was HOISTED above the anti-coup guard: it neither writes nor changes
-- authz, so a no-op cannot "remove the creator". Without the hoist the
-- anti-coup guard (co-commissioner actor + creator target u1) fires 42501 here.
-- Self-contained round-trip: L2 is left as u4=commissioner, u1(creator)=manager,
-- exactly as it was. The acting JWT is still u4 (set for the demote control).
select is(
  (select (public.set_member_role((select l2 from _ids),
     (select lm.id from public.league_members lm
      where lm.league_id = (select l2 from _ids)
        and lm.user_id = '98000000-0000-4000-8000-000000000001'),
     'commissioner') ->> 'transferred')::boolean),
  true,
  'R100 setup: the sitting commissioner (u4) transfers the role TO the creator (u1) — u4 is now a co_commissioner');
select is(
  (select (public.set_member_role((select l2 from _ids),
     (select lm.id from public.league_members lm
      where lm.league_id = (select l2 from _ids)
        and lm.user_id = '98000000-0000-4000-8000-000000000001'),
     'commissioner') ->> 'transferred')::boolean),
  false,
  'R100: a co-commissioner (u4) REPLAYING the completed transfer to the CREATOR (u1) gets transferred:false, NOT the anti-coup 42501 — the creator-target replay the non-creator pin above cannot reach (idempotent arm hoisted ABOVE the anti-coup guard)');
-- Restore: hand the role back to u4, then demote the creator to manager again,
-- so §L (the departed creator leaves L2 as a plain manager) is unchanged.
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select is(
  (select (public.set_member_role((select l2 from _ids),
     (select lm.id from public.league_members lm
      where lm.league_id = (select l2 from _ids)
        and lm.user_id = '98000000-0000-4000-8000-000000000004'),
     'commissioner') ->> 'transferred')::boolean),
  true,
  'R100 teardown: the creator (u1), momentarily commissioner, transfers back to u4');
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "pgtap-mm4@fieldscout.local"}', true);
select lives_ok(
  $$ select public.set_member_role((select l2 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l2 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000001'),
       'manager') $$,
  'R100 teardown: u4 demotes the creator (u1) back to manager — L2 restored to its pre-R100 state');

-- The DB half: the API refusal is not the only thing standing between the
-- data and two commissioners (D69).
reset role;
select throws_ok(
  $$ update public.league_members set role = 'commissioner'
     where league_id = (select l2 from _ids)
       and user_id = '98000000-0000-4000-8000-000000000009' $$,
  '23505', null,
  'a PRIVILEGED (RPC-context) write forcing a second commissioner is refused by one_commissioner_per_league — the constraint, not the API, is the backstop');
select throws_ok(
  $$ insert into public.league_members (league_id, user_id, role)
     values ((select l1 from _ids), '98000000-0000-4000-8000-000000000006', 'overlord') $$,
  '23514', null,
  'a privileged INSERT with an unknown role is refused by league_members_role_valid (§12.2''s enum was a bare comment before 063)');
select throws_ok(
  $$ insert into public.team_managers (league_id, team_id, user_id, role, end_reason, ended_at)
     values ((select l1 from _ids), (select l1_commish_team from _ids),
             '98000000-0000-4000-8000-000000000006', 'manager', 'quit', now()) $$,
  '23514', null,
  'a privileged INSERT with an unknown end_reason is refused by team_managers_end_reason_valid (L.A1.15 is the FIRST writer of this column — a typo would otherwise be permanently invisible)');
select throws_ok(
  $$ insert into public.team_managers (league_id, team_id, user_id, role)
     values ((select l1 from _ids), (select l1_commish_team from _ids),
             '98000000-0000-4000-8000-000000000006', 'co_manager') $$,
  '23514', null,
  'team_managers.role is CHECKed to manager (§12.22: co_manager is reserved post-v1)');

-- R90: removing a member releases EVERY franchise they own in the league, not
-- just the seat they sat in. u9 minted 'Ledger Seat' above while holding
-- co-commissioner powers; vacating them must move it too. (Runs after the
-- privileged block above, which addresses u9's row by user_id.)
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000004", "role": "authenticated", "email": "pgtap-mm4@fieldscout.local"}', true);
select is(
  (select (public.remove_manager((select l2 from _ids),
     (select lm.id from public.league_members lm
      where lm.league_id = (select l2 from _ids)
        and lm.user_id = '98000000-0000-4000-8000-000000000009'),
     'vacate') ->> 'mode')),
  'vacate',
  'R90 fixture: the co-commissioner who minted a seat is vacated by the sitting commissioner');
reset role;
select is(
  (select count(*)::int from public.teams t
   where t.league_id = (select l2 from _ids)
     and t.owner_id = '98000000-0000-4000-8000-000000000009'),
  0,
  'R90: the removed member owns NO franchise in the league afterwards — teams.owner_id is ON DELETE CASCADE to profiles (001:495), so a franchise left owned by a proven non-member is destroyed outright by their account deletion, and league_members.team_id (ON DELETE SET NULL, 052:67) is left NULL: a seat with no franchise, invisible to every capacity count — the exact shape v2.8.8/D74(3) removed policies to make unrepresentable');
select results_eq(
  $$ select t.owner_id, t.status
     from public.teams t where t.id = ((select r from _r90_remove) ->> 'team_id')::uuid $$,
  $$ values ('98000000-0000-4000-8000-000000000004'::uuid, 'active') $$,
  'R90: the swept seat moved to the ACTING commissioner and is otherwise untouched — still active (only the vacated franchise is orphaned), still a live franchise occupying capacity');

-- ---------------------------------------------------------------------------
-- J. remove_manager: the three outcomes (D42 pre-draft semantics).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select throws_ok(
  $$ select public.remove_manager((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000004'),
       'retire') $$,
  'P0001', null,
  'retire is a friendly refusal before the draft (D42 — retire-and-succeed lands with the in-season milestone, F31)');
reset role;
select is(
  (select count(*)::int from public.team_managers tm
   where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid and tm.ended_at is null),
  1,
  'the refused retire wrote NOTHING — the stint is untouched');
select is(
  (select count(*)::int from public.teams t
   where t.league_id = (select l1 from _ids) and t.status = 'retired'),
  0,
  'and no franchise was retired (teams.status is never set to retired here — every capacity count is status <> retired)');

-- Golden pin: capture the open stint's started_at BEFORE the removal so a
-- merge-in-place implementation is falsifiable (§4.3(a)).
create temp table _pin as
select tm.started_at as first_started_at
from public.team_managers tm
where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid and tm.ended_at is null;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select throws_ok(
  $$ select public.remove_manager((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000004'),
       'takeover') $$,
  '22023', null,
  'takeover with no successor_user_id is an argument-shape violation (§15.1''s body: takeover reseats a NAMED user; the "invite a replacement" journey is vacate + a seat invite — D74(6))');
select throws_ok(
  $$ select public.remove_manager((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000004'),
       'takeover', '98000000-0000-4000-8000-000000000002') $$,
  'P0001', null,
  'a successor who already has a team in this league is refused (UNIQUE(league_id, user_id) never surfaces as a 23505)');
select throws_ok(
  $$ select public.remove_manager((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000004'),
       'sideways') $$,
  '22023', null,
  'an unknown mode is an argument-shape violation');

create temp table _takeover as
select public.remove_manager((select l1 from _ids),
  (select lm.id from public.league_members lm
   where lm.league_id = (select l1 from _ids)
     and lm.user_id = '98000000-0000-4000-8000-000000000004'),
  'takeover', '98000000-0000-4000-8000-000000000005', 'went quiet in July') as r;
select is(
  (select (r ->> 'mode') from _takeover), 'takeover',
  'takeover succeeds with a named successor');

reset role;
select results_eq(
  $$ select lm.user_id, lm.role, lm.is_placeholder, lm.faab_balance,
            lm.team_id = ((select r from _seat2) ->> 'team_id')::uuid
     from public.league_members lm
     where lm.id = ((select r from _assign1) ->> 'member_id')::uuid $$,
  $$ values ('98000000-0000-4000-8000-000000000005'::uuid, 'manager', false, 777, true) $$,
  'takeover UPDATES the cache row IN PLACE: same row, successor seated, team_id kept, faab re-seeded, role reset to manager (powers never inherit with a seat)');
select is(
  (select count(*)::int from public.league_members lm
   where lm.league_id = (select l1 from _ids)
     and lm.team_id = ((select r from _seat2) ->> 'team_id')::uuid),
  1,
  'still exactly ONE cache row for the franchise (never DELETE+INSERT, never two rows per seat)');
select results_eq(
  $$ select tm.user_id, tm.end_reason, tm.ended_by, tm.ended_week is null
     from public.team_managers tm
     where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid
       and tm.ended_at is not null $$,
  $$ values ('98000000-0000-4000-8000-000000000004'::uuid, 'replaced',
             '98000000-0000-4000-8000-000000000001'::uuid, true) $$,
  'the outgoing stint closed with end_reason=replaced, ended_by=the acting commissioner, ended_week NULL (preseason) — the §12.22 history contract');
select is(
  (select tm.started_at from public.team_managers tm
   where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid and tm.ended_at is not null),
  (select first_started_at from _pin),
  'GOLDEN PIN: the closed stint''s started_at is UNCHANGED from the literal captured before the removal — a merge-in-place implementation rewrites it and fails here even though the row count matches');
select is(
  (select count(*)::int from public.team_managers tm
   where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid and tm.ended_at is null),
  1,
  'exactly one OPEN stint after the takeover (close-before-open, same txn — F3)');
select ok(
  (select tm.started_at from public.team_managers tm
   where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid and tm.ended_at is null)
  > (select tm.ended_at from public.team_managers tm
     where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid and tm.ended_at is not null),
  'the successor''s stint opens AFTER the predecessor''s close (clock_timestamp advances within the txn — now() would tie, F3)');
select is(
  (select t.owner_id from public.teams t where t.id = ((select r from _seat2) ->> 'team_id')::uuid),
  '98000000-0000-4000-8000-000000000005'::uuid,
  'teams.owner_id follows the successor');
select is(
  (select t.status from public.teams t where t.id = ((select r from _seat2) ->> 'team_id')::uuid),
  'active',
  'the franchise stays active through a takeover (continuity — §7.2.1(a))');
select throws_ok(
  $$ update public.team_managers set ended_at = null
     where team_id = ((select r from _seat2) ->> 'team_id')::uuid and ended_at is not null $$,
  '23505', null,
  'reopening a CLOSED stint while another is open is refused by one_open_stint_per_team (the index R46 left unpinned)');

-- vacate.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
create temp table _vacate as
select public.remove_manager((select l1 from _ids),
  ((select r from _assign1) ->> 'member_id')::uuid, 'vacate', null, 'moved away') as r;
select is((select (r ->> 'mode') from _vacate), 'vacate', 'vacate succeeds');
reset role;
select results_eq(
  $$ select lm.user_id is null, lm.is_placeholder, lm.role, lm.faab_balance,
            lm.team_id = ((select r from _seat2) ->> 'team_id')::uuid
     from public.league_members lm
     where lm.id = ((select r from _assign1) ->> 'member_id')::uuid $$,
  $$ values (true, true, 'manager', 777, true) $$,
  'vacate reverts the seat to a placeholder and KEEPS team_id (the franchise stays attached — the 054 carve-out shape would have detached it)');
select results_eq(
  $$ select t.status, t.owner_id
     from public.teams t where t.id = ((select r from _seat2) ->> 'team_id')::uuid $$,
  $$ values ('orphaned', '98000000-0000-4000-8000-000000000001'::uuid) $$,
  'vacate sets teams.status = orphaned (§7.2.1(c), the literal §16.5.4''s badge reads) and moves owner_id to the acting commissioner (owner_id is NOT NULL; leaving it on the removed user would let their profile deletion CASCADE the franchise away)');
select results_eq(
  $$ select tm.end_reason, tm.ended_by
     from public.team_managers tm
     where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid
       and tm.user_id = '98000000-0000-4000-8000-000000000005' $$,
  $$ values ('kicked', '98000000-0000-4000-8000-000000000001'::uuid) $$,
  'the vacated stint closed with end_reason=kicked (the §12.22 mapping: kicked = removed with no successor, replaced = takeover, left = voluntary)');
select is(
  (select count(*)::int from public.team_managers tm
   where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid and tm.ended_at is null),
  0,
  'no open stint remains on the vacated franchise');
select is(
  (select count(*)::int from public.teams t
   where t.league_id = (select l1 from _ids) and t.status <> 'retired'),
  3,
  'vacate did not DELETE the franchise or free a seat — the capacity count is unchanged (hard-deleting a teams row would CASCADE every stint ever recorded on it, 053:81)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select is(
  (select (public.remove_manager((select l1 from _ids),
     ((select r from _assign1) ->> 'member_id')::uuid, 'vacate') ->> 'already_vacant')::boolean),
  true,
  'vacating an already-open seat is an idempotent success (D63 retry doctrine)');
select throws_ok(
  $$ select public.remove_manager((select l1 from _ids),
       ((select r from _assign1) ->> 'member_id')::uuid, 'takeover',
       '98000000-0000-4000-8000-000000000007') $$,
  'P0001', null,
  'takeover on an EMPTY seat is refused, pointing at assign-manager (there is no stint to replace)');

-- E51 analogue: the vacated seat is re-invitable and the re-claim is a NEW
-- stint row, never a merge.
create temp table _inv2 as
select public.create_league_invite(
  (select l1 from _ids), ((select r from _seat2) ->> 'team_id')::uuid,
  null, 'mm_succ_five', 1) as r;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "pgtap-mm5@fieldscout.local"}', true);
select is(
  (select (public.claim_league_invite(((select r from _inv2) ->> 'token')) ->> 'ok')::boolean),
  true,
  'E51 analogue: the SAME user re-claims their old franchise after being vacated (an orphaned seat stays invitable — create_league_invite only refuses retired ones)');
reset role;
select is(
  (select count(*)::int from public.team_managers tm
   where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid
     and tm.user_id = '98000000-0000-4000-8000-000000000005'),
  2,
  'TWO stint rows for (team, user) — no merge (§7.2.1: "a second stint on the same team is just another row")');
select is(
  (select count(distinct tm.started_at)::int from public.team_managers tm
   where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid
     and tm.user_id = '98000000-0000-4000-8000-000000000005'),
  2,
  'with DISTINCT started_at (a row count alone passes against a merge; a now()-based started_at would collide inside this txn — the exact F3 failure clock_timestamp() prevents)');
select is(
  (select count(*)::int from public.team_managers tm
   where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid and tm.ended_at is null),
  1,
  'exactly ONE open stint after the re-claim');
select is(
  (select t.status from public.teams t where t.id = ((select r from _seat2) ->> 'team_id')::uuid),
  'active',
  'the re-claim RESOLVED the orphaned status back to active (§7.2.1(c): "orphaned is a holding state that resolves into (a) or (b)")');

-- ---------------------------------------------------------------------------
-- K. Access revocation (E50 analogue) — shape 1: a plain manager.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000005", "role": "authenticated", "email": "pgtap-mm5@fieldscout.local"}', true);
select ok(
  (select count(*) from public.league_members lm where lm.league_id = (select l1 from _ids)) > 0
  and (select count(*) from public.team_managers tm where tm.league_id = (select l1 from _ids)) > 0
  and (select count(*) from public.leagues l where l.id = (select l1 from _ids)) = 1
  and public.is_league_member((select l1 from _ids)),
  'BEFORE: the about-to-leave manager SEES member rows, stint rows and the league (so "0 rows" after cannot be confused with "0 rows exist")');
select is(
  (select (public.leave_league((select l1 from _ids)) ->> 'ok')::boolean), true,
  'a plain manager leaves voluntarily (§7.2.1:192)');
select is(
  (select count(*)::int from public.league_members lm where lm.league_id = (select l1 from _ids)),
  0,
  'AFTER: the departed manager sees ZERO member rows');
select is(
  (select count(*)::int from public.team_managers tm where tm.league_id = (select l1 from _ids)),
  0,
  'AFTER: and zero stint rows (team_managers'' SELECT policy is itself gated on is_league_member)');
select is(
  (select count(*)::int from public.leagues l where l.id = (select l1 from _ids)),
  0,
  'AFTER: and the league itself is invisible (they are neither a member nor its owner)');
select ok(
  not public.is_league_member((select l1 from _ids))
  and not public.is_league_commish((select l1 from _ids)),
  'AFTER: both membership helpers return FALSE — what revoked access is the cache row losing its user_id, NOT the stint close (§7.2.1:188''s "derives from the open stint" is aspirational in M1 — F35)');
select throws_ok(
  $$ select public.leave_league((select l1 from _ids)) $$,
  '42501', null,
  'AFTER: a member-scoped RPC they could previously call now refuses');
reset role;
select results_eq(
  $$ select tm.end_reason, tm.ended_by, tm.ended_at is not null
     from public.team_managers tm
     where tm.team_id = ((select r from _seat2) ->> 'team_id')::uuid
       and tm.user_id = '98000000-0000-4000-8000-000000000005'
       and tm.end_reason = 'left' $$,
  $$ values ('left', '98000000-0000-4000-8000-000000000005'::uuid, true) $$,
  'HISTORY RETAINED: the closed stint still exists with end_reason=left and ended_by=self — access is gone, the record is not (§7.2.1 "retained under their identity")');

-- ---------------------------------------------------------------------------
-- L. Access revocation — shape 2: the departed CREATOR (S6/F36). A
--    manager-only fixture hides the leagues-policy owner branch entirely.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select is(
  (select (public.leave_league((select l2 from _ids)) ->> 'ok')::boolean), true,
  'the CREATOR of L2 — demoted to plain manager after the transfer — leaves');
select is(
  (select count(*)::int from public.league_members lm where lm.league_id = (select l2 from _ids)),
  0,
  'departed creator: ZERO member rows visible');
select ok(
  not public.is_league_member((select l2 from _ids))
  and not public.is_league_commish((select l2 from _ids)),
  'departed creator: both membership helpers FALSE — every league-surface write path (leagues, league_members, team_managers and all five RPCs key on these two) is gone');
reset role;
select results_eq(
  $$ select t.owner_id, t.status
     from public.teams t where t.id = ((select r from _r90_leave) ->> 'team_id')::uuid $$,
  $$ values ('98000000-0000-4000-8000-000000000004'::uuid, 'active') $$,
  'R90 (leave arm): the placeholder seat the DEPARTING member minted moves to the sitting commissioner too, not just the seat they sat in — otherwise it stays on an ON DELETE CASCADE owner FK held by a proven non-member');
select is(
  (select count(*)::int from public.teams t
   where t.league_id = (select l2 from _ids)
     and t.owner_id = '98000000-0000-4000-8000-000000000001'),
  0,
  'R90 (leave arm): NO franchise in the league is still owned by the departed creator — which is also what closes the one write path is_league_member does NOT cover, team_lineups'' unscoped owner-keyed FOR ALL policy (001:856-861; the surface itself is C12/F18, M4''s)');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select is(
  (select count(*)::int from public.leagues l where l.id = (select l2 from _ids)),
  1,
  'DOCUMENTED RESIDUAL (F36): the departed creator still SEES the league row — 052''s SELECT policy has an `owner_id = auth.uid()` branch and no RPC moves leagues.owner_id, because owner_id is the CREATOR record the §7.2 anti-coup rule keys on. Read-only, no membership, no write path; rotating the invite code is the remedy for the share link');
select throws_ok(
  $$ select public.add_placeholder_seat((select l2 from _ids)) $$,
  '42501', null,
  'departed creator: commish-gated RPCs refuse (the residual is visibility only)');

-- ---------------------------------------------------------------------------
-- M. The I10 documentation pin: closing ONLY the stint revokes NOTHING in
--    M1. If a future milestone moves an RLS predicate onto team_managers,
--    this flips and forces the doc update (F35).
-- ---------------------------------------------------------------------------
reset role;
create temp table _doc as
select public.seat_league_member_internal(
  (select l1 from _ids), '98000000-0000-4000-8000-000000000008', 777) as team_id;
update public.team_managers
set ended_at = now(), end_reason = 'left', ended_by = '98000000-0000-4000-8000-000000000008'
where team_id = (select team_id from _doc) and ended_at is null;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000008", "role": "authenticated", "email": "pgtap-mm8@fieldscout.local"}', true);
select ok(
  public.is_league_member((select l1 from _ids))
  and (select count(*) from public.league_members lm where lm.league_id = (select l1 from _ids)) > 0
  and (select count(*) from public.leagues l where l.id = (select l1 from _ids)) = 1,
  'with the stint CLOSED but the cache row intact, the user still sees everything — M1 access derives from league_members, not from the open stint (asserted, not asserted-in-prose)');
reset role;
update public.team_managers set ended_at = null, end_reason = null, ended_by = null
where team_id = (select team_id from _doc);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select lives_ok(
  $$ select public.remove_manager((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000008'),
       'vacate') $$,
  'the sanctioned RPC runs on the same member');
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000008", "role": "authenticated", "email": "pgtap-mm8@fieldscout.local"}', true);
select ok(
  not public.is_league_member((select l1 from _ids))
  and (select count(*) from public.league_members lm where lm.league_id = (select l1 from _ids)) = 0,
  'and NOW access is gone — because the RPC nulled the cache row in the same txn as the stint close');

-- ---------------------------------------------------------------------------
-- N. Soft-deleted league → P0002 on every new RPC (R87: a malformed league
--    id already 404s at the route; a deleted one must not 400).
--    is_league_commish ignores deleted_at, so authz cannot short-circuit.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select lives_ok(
  $$ select public.soft_delete_league((select l4 from _ids)) $$,
  'L4 soft-deleted (the §15.1 commish soft delete)');
select ok(
  public.is_league_commish((select l4 from _ids)),
  'is_league_commish STILL returns true for the soft-deleted league — which is why each RPC needs its own explicit P0002 arm (the assertions below genuinely reach the deleted branch)');
select throws_ok(
  $$ select public.add_placeholder_seat((select l4 from _ids)) $$,
  'P0002', null, 'add_placeholder_seat: soft-deleted league → P0002 (→ 404)');
select throws_ok(
  $$ select public.set_member_role((select l4 from _ids),
       (select lm.id from public.league_members lm where lm.league_id = (select l4 from _ids) limit 1),
       'co_commissioner') $$,
  'P0002', null, 'set_member_role: soft-deleted league → P0002');
select throws_ok(
  $$ select public.assign_manager((select l4 from _ids),
       (select t.id from public.teams t where t.league_id = (select l4 from _ids) limit 1),
       '98000000-0000-4000-8000-000000000007') $$,
  'P0002', null, 'assign_manager: soft-deleted league → P0002');
select throws_ok(
  $$ select public.remove_manager((select l4 from _ids),
       (select lm.id from public.league_members lm where lm.league_id = (select l4 from _ids) limit 1),
       'vacate') $$,
  'P0002', null, 'remove_manager: soft-deleted league → P0002');
select throws_ok(
  $$ select public.leave_league((select l4 from _ids)) $$,
  'P0002', null, 'leave_league: soft-deleted league → P0002');

-- ---------------------------------------------------------------------------
-- O. Authorization floor: a plain member and an outsider get nowhere.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000006", "role": "authenticated", "email": "pgtap-mm6@fieldscout.local"}', true);
select throws_ok(
  $$ select public.add_placeholder_seat((select l1 from _ids)) $$,
  '42501', null, 'outsider: add_placeholder_seat refuses');
select throws_ok(
  $$ select public.set_member_role((select l1 from _ids),
       (select lm.id from public.league_members lm where lm.league_id = (select l1 from _ids) limit 1),
       'co_commissioner') $$,
  '42501', null, 'outsider: set_member_role refuses');
select throws_ok(
  $$ select public.assign_manager((select l1 from _ids),
       ((select r from _seat2) ->> 'team_id')::uuid,
       '98000000-0000-4000-8000-000000000006') $$,
  '42501', null, 'outsider: assign_manager refuses (no self-seating)');
select throws_ok(
  $$ select public.remove_manager((select l1 from _ids),
       (select lm.id from public.league_members lm where lm.league_id = (select l1 from _ids) limit 1),
       'vacate') $$,
  '42501', null, 'outsider: remove_manager refuses');
select throws_ok(
  $$ select public.leave_league((select l1 from _ids)) $$,
  '42501', null, 'outsider: leave_league refuses (it acts on auth.uid(), so it can never be a kick path)');

-- Cross-league member addressing (R86 shape) on the member-keyed RPCs.
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
select throws_ok(
  $$ select public.set_member_role((select l3 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000002'),
       'manager') $$,
  '42501', null,
  'CROSS-LEAGUE (R86): an L1 member id addressed through L3 is refused — the same user commissions both, so only the league argument can be doing the work');
select throws_ok(
  $$ select public.remove_manager((select l3 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000002'),
       'vacate') $$,
  '42501', null,
  'CROSS-LEAGUE (R86): same for remove_manager');
select lives_ok(
  $$ select public.set_member_role((select l1 from _ids),
       (select lm.id from public.league_members lm
        where lm.league_id = (select l1 from _ids)
          and lm.user_id = '98000000-0000-4000-8000-000000000002'),
       'manager') $$,
  'control: addressed through its OWN league, the same call succeeds');

-- ---------------------------------------------------------------------------
-- P. The solo-commissioner dead end (reachable on day one of every league).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000007", "role": "authenticated", "email": "pgtap-mm7@fieldscout.local"}', true);
create temp table _l5 as
select public.create_league(
  'pgtap-mm-league-5', 2026, 8,
  '{"divisions": 0}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Solo', 'b3000000-0000-4000-8000-000000000005',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff') as r;
select throws_like(
  $$ select public.leave_league(((select r from _l5) ->> 'league_id')::uuid) $$,
  '%only manager%delete the league%',
  'the SOLE member of a league is by definition its commissioner with nobody to transfer to — the refusal points at deleting the league instead of stranding them');

-- ---------------------------------------------------------------------------
-- Q. Post-draft gate: seats are a pre-draft act (the D72 class).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "98000000-0000-4000-8000-000000000001", "role": "authenticated", "email": "pgtap-mm1@fieldscout.local"}', true);
-- The D43 guard forbids drafting+ without a snapshot, so take the sanctioned
-- one first (059, as the commissioner) rather than forcing an invalid row.
select public.snapshot_league_scoring((select l1 from _ids));
reset role;
update public.leagues set status = 'drafting' where id = (select l1 from _ids);
set local role authenticated;
select throws_ok(
  $$ select public.add_placeholder_seat((select l1 from _ids)) $$,
  'P0001', null,
  'add_placeholder_seat refuses once the draft has started (creating a franchise mid-draft would corrupt M2/M4 machinery — the 062 general-claim precedent)');

-- ---------------------------------------------------------------------------
-- R. Authorization is re-read UNDER the league lock (R93). A demotion that
--    COMMITS while a call is blocked on the league row must not be missed:
--    plpgsql takes a fresh snapshot per statement, so the pre-lock
--    is_league_commish answer can be stale by the time the write runs, and a
--    stale actor reading 'manager' is strictly MORE powerful than a
--    legitimate co-commissioner (every anti-coup guard keys on
--    'co_commissioner'). This is a RACE guard: no single-session fixture can
--    reach it, because both reads hit the same table in the same txn. It is
--    therefore pinned STRUCTURALLY — each RPC re-reads the actor's role AFTER
--    its first FOR UPDATE. Deleting or hoisting one re-gate fails exactly one
--    assert below, which names its RPC.
--    Falsifiability (R101 — the earlier pins were unbounded substring tests
--    that a mutant could satisfy with a re-gate sunk BELOW the writes or a
--    RAISE body neutered to NULL): each assert now pins the re-gate to the
--    window (first FOR UPDATE, first write) AND requires a '42501' inside the
--    re-gate branch (between `v_actor_role NOT IN` and its END IF). So it
--    catches BOTH mutant classes — (1) sink the re-gate below the first write
--    → the `< firstwrite` bound fails; (2) neuter the RAISE → no 42501 in the
--    branch window. Per-RPC first-write marker: add_placeholder_seat INSERT
--    INTO public.teams · set_member_role UPDATE public.league_members ·
--    assign_manager the seat_league_member_internal call · remove_manager
--    UPDATE public.team_managers.
-- ---------------------------------------------------------------------------
reset role;
select ok(
  (select strpos(p.prosrc, 'v_actor_role NOT IN') > strpos(p.prosrc, 'FOR UPDATE')
      and strpos(p.prosrc, 'v_actor_role NOT IN') < strpos(p.prosrc, 'INSERT INTO public.teams')
      and strpos(substr(p.prosrc, strpos(p.prosrc, 'v_actor_role NOT IN'),
                        strpos(substr(p.prosrc, strpos(p.prosrc, 'v_actor_role NOT IN')), 'END IF')),
                 '42501') > 0
     from pg_proc p where p.oid = 'public.add_placeholder_seat(uuid,text)'::regprocedure),
  'add_placeholder_seat re-gates on the actor''s CURRENT role AFTER the league-row FOR UPDATE and ABOVE its first write (INSERT INTO public.teams), and that branch RAISEs 42501 (R93/R101 — a mutant that sinks the re-gate below the write, or neuters its RAISE, fails this)');
select ok(
  (select strpos(p.prosrc, 'v_actor_role NOT IN') > strpos(p.prosrc, 'FOR UPDATE')
      and strpos(p.prosrc, 'v_actor_role NOT IN') < strpos(p.prosrc, 'UPDATE public.league_members')
      and strpos(substr(p.prosrc, strpos(p.prosrc, 'v_actor_role NOT IN'),
                        strpos(substr(p.prosrc, strpos(p.prosrc, 'v_actor_role NOT IN')), 'END IF')),
                 '42501') > 0
     from pg_proc p where p.oid = 'public.set_member_role(uuid,uuid,text)'::regprocedure),
  'set_member_role re-gates AFTER the lock and ABOVE its first write (UPDATE public.league_members) with a 42501 RAISE — and the same read supplies the exact actor role the creator anti-coup and transfer guards key on (R93/R101)');
select ok(
  (select strpos(p.prosrc, 'v_actor_role NOT IN') > strpos(p.prosrc, 'FOR UPDATE')
      and strpos(p.prosrc, 'v_actor_role NOT IN') < strpos(p.prosrc, 'seat_league_member_internal')
      and strpos(substr(p.prosrc, strpos(p.prosrc, 'v_actor_role NOT IN'),
                        strpos(substr(p.prosrc, strpos(p.prosrc, 'v_actor_role NOT IN')), 'END IF')),
                 '42501') > 0
     from pg_proc p where p.oid = 'public.assign_manager(uuid,uuid,uuid)'::regprocedure),
  'assign_manager re-gates AFTER the lock and ABOVE its first write (the seat_league_member_internal call) with a 42501 RAISE (R93/R101)');
select ok(
  (select strpos(p.prosrc, 'v_actor_role NOT IN') > strpos(p.prosrc, 'FOR UPDATE')
      and strpos(p.prosrc, 'v_actor_role NOT IN') < strpos(p.prosrc, 'UPDATE public.team_managers')
      and strpos(substr(p.prosrc, strpos(p.prosrc, 'v_actor_role NOT IN'),
                        strpos(substr(p.prosrc, strpos(p.prosrc, 'v_actor_role NOT IN')), 'END IF')),
                 '42501') > 0
     from pg_proc p where p.oid = 'public.remove_manager(uuid,uuid,text,uuid,text)'::regprocedure),
  'remove_manager re-gates AFTER the lock and ABOVE its first write (UPDATE public.team_managers) with a 42501 RAISE (R93/R101)');
select ok(
  (select strpos(substr(p.prosrc, strpos(p.prosrc, 'FOR UPDATE')), 'INTO v_self') > 0
     from pg_proc p where p.oid = 'public.leave_league(uuid)'::regprocedure),
  'leave_league reads the CALLER''s own role only AFTER the league-row FOR UPDATE — the ordering the other four were brought into line with (R93)');

-- ---------------------------------------------------------------------------
-- S. Notification ROWS (§7.2.1:190 "the removed user is notified with the
--    outcome category"). notify_league_member_internal swallows EVERY error
--    by design, so an INSERT that stopped happening is invisible to every
--    other assert in this file — §A pins only its signature, search_path and
--    ACLs. Sibling precedent: 016 pins its invite notification rows. These are
--    privileged (postgres) reads (`reset role` above), the 016 pattern.
--    LEAVE PATH: Q11 RULED (Chris, 2026-07-26) — notify BOTH the departing
--    user AND the sitting commissioner (§7.2.1:190 read (a) + the ruling's
--    explicit commissioner-too addition, spec erratum v2.8.9). Pinned below on
--    §K's L1 leave (u5 left; u1 is L1's sitting commissioner). F37 discharged.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select n.type, n.title, n.data ->> 'event'
     from public.notifications n
     where n.user_id = '98000000-0000-4000-8000-000000000004'
       and n.type = 'league_member'
       and (n.data ->> 'league_id')::uuid = (select l1 from _ids) $$,
  $$ values ('league_member', 'You were removed from pgtap-mm-league-1', 'replaced') $$,
  'TAKEOVER notifies the REMOVED user with the outcome category (§7.2.1:190) — pinned on the ROW, because the guarded notifier turns a failed insert into silence');
select results_eq(
  $$ select n.type, n.title, n.data ->> 'event'
     from public.notifications n
     where n.user_id = '98000000-0000-4000-8000-000000000005'
       and n.type = 'league_member'
       and (n.data ->> 'team_id')::uuid = ((select r from _seat2) ->> 'team_id')::uuid
       and n.data ->> 'event' = 'removed' $$,
  $$ values ('league_member', 'You were removed from pgtap-mm-league-1', 'removed') $$,
  'VACATE notifies the removed user with the `removed` category — a mutant writing the stint''s end_reason (`kicked`) instead returns zero rows here');
-- Q11: the voluntary LEAVE path notifies the DEPARTING user (u5 left L1). The
-- `event='left'` scope isolates this from u5''s earlier `removed` row above.
select results_eq(
  $$ select n.type, n.title, n.data ->> 'event'
     from public.notifications n
     where n.user_id = '98000000-0000-4000-8000-000000000005'
       and n.type = 'league_member'
       and (n.data ->> 'league_id')::uuid = (select l1 from _ids)
       and n.data ->> 'event' = 'left' $$,
  $$ values ('league_member', 'You left pgtap-mm-league-1', 'left') $$,
  'LEAVE notifies the DEPARTING user with the `left` category (Q11 ruling, §7.2.1:190) — the row R96 deliberately left unpinned pending the ruling; F37');
-- Q11: and it ALSO notifies the sitting commissioner (u1 for L1) — the party
-- who must act on the newly open seat. Both recipients, per the ruling.
select results_eq(
  $$ select n.type, n.title, n.data ->> 'event'
     from public.notifications n
     where n.user_id = '98000000-0000-4000-8000-000000000001'
       and n.type = 'league_member'
       and (n.data ->> 'league_id')::uuid = (select l1 from _ids)
       and n.data ->> 'event' = 'left' $$,
  $$ values ('league_member', 'A manager left pgtap-mm-league-1', 'left') $$,
  'LEAVE also notifies the sitting COMMISSIONER (u1) — the Q11 ruling is BOTH recipients, not one');

select * from finish();
rollback;
