-- ============================================================================
-- `draft_queue_replace` — migration 082 (task L.B7.1; the F54 discharge;
-- spec §8.4/§12.6; D113(3) both faces; D123(5)(6) evidence). pgTAP file is
-- **031** (030 = list_players tier vocabulary; next free confirmed at task
-- time).
--
-- What is pinned here (the single-session half — true CONCURRENCY cannot be
-- exercised inside one rolled-back pgTAP txn; the concurrency face is pinned
-- at the wire in `draft-queue-api-db.test.ts` (parallel volleys, both faces)
-- and proven under load by the L.B6.1 sim's chaos persona, 92 → 0):
--   * Shape: SECURITY INVOKER — DELIBERATE and load-bearing (the ONE draft
--     RPC that is not DEFINER: `draft_queues` is the §12.6 client-writable
--     table and 065's policies are the auth law; running as invoker keeps
--     the RLS backstop live inside the function). prosecdef = false is a
--     GOLDEN pin — flipping the function to DEFINER without re-deriving the
--     policy law in-body would be a silent privilege widening.
--   * search_path pinned to '' (the 004 doctrine, invoker or not).
--   * ACL: anon has NO execute; authenticated + service_role do; PUBLIC
--     revoked (execute as a random OTHER role fails).
--   * Replace semantics: dense ranks 1..n in submitted order; the jsonb
--     return is the settled queue; an OVERLAPPING re-replace succeeds with
--     the old rows fully gone (sequentially this always worked — the pin
--     guards the RPC's own delete-before-insert composition against the
--     uniq(draft_id, team_id, player_id) trap the raw path fell into,
--     D123(6)); empty array clears and returns '[]'.
--   * Refusals: intra-array duplicate 22023 · unknown player 22023 (named
--     in the message) · > 500 players 22023 · NULL args 22023 · forged
--     seat (another member's team) 42501 · outsider 42501 (SAME error —
--     no-leak) · cross-league team 42501 (stricter than 065's policy text,
--     recorded in the migration banner) · mock draft: the human seat's
--     REAL owner is refused (the F51 exclusion mirrored in the guard)
--     while the LAUNCHER writes that seat (D103(3)).
--   * Refusal side-effect pin: a refused replace leaves the queue
--     UNTOUCHED (the 22023 arms fire before the destructive delete; the
--     42501 arm fires before the lock).
--
-- Falsifiability (§4.3): the deliberate-break probe for this surface is run
-- at the WIRE pin (draft-service.ts temporarily reverted to the raw
-- delete→insert → the concurrency test goes RED → reverted; evidence in
-- the PR). In-file, the dense-rank and overlap pins fail if the INSERT's
-- ordinality rank derivation drifts, and the prosecdef/proconfig golden
-- pins fail on any definer/search_path drift.
--
-- Fixture discipline: all privileged fixture work BEFORE any JWT claims
-- (D49(7)); mid-file privileged pins use `reset role` (013/014/018/019
-- pattern). Ids are file-local (rolled back).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

-- ---------------------------------------------------------------------------
-- A. Shape + ACL (golden pins)
-- ---------------------------------------------------------------------------
select has_function('public', 'draft_queue_replace',
  array['uuid', 'uuid', 'text[]'], 'draft_queue_replace(uuid, uuid, text[]) exists');

select is(
  (select p.prosecdef from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_queue_replace'),
  false,
  'SECURITY INVOKER — deliberate (the 065 policies stay the auth law; golden pin)');

select is(
  (select count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'draft_queue_replace'
     and p.proconfig @> array['search_path=""']),
  1::bigint,
  'search_path pinned to empty (the 004 doctrine)');

select is(
  has_function_privilege('anon', 'public.draft_queue_replace(uuid, uuid, text[])', 'EXECUTE'),
  false, 'anon cannot execute (REVOKEd)');
select is(
  has_function_privilege('authenticated', 'public.draft_queue_replace(uuid, uuid, text[])', 'EXECUTE'),
  true, 'authenticated can execute (the policies + in-body guard decide whose queue)');
select is(
  has_function_privilege('service_role', 'public.draft_queue_replace(uuid, uuid, text[])', 'EXECUTE'),
  true, 'service_role keeps execute (harness/ops; auth.uid() NULL = in-body refusal by design)');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — before any JWT claims; D49(7)).
--    u1 commish L1 (team t1, mock launcher) · u2 manager L1 (team t2 — the
--    mock's chosen human seat, D103's launcher ≠ owner shape) · u4 outsider
--    · u5 commish L2 (team t4). d1: L1 real live draft · dm: L1 live MOCK
--    launched by u1 practicing from t2.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-qr1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "qr_commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-qr2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "qr_member"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'pgtap-qr4@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "qr_outsider"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '85000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'pgtap-qr5@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "qr_l2commish"}', now(), now());

insert into leagues (id, owner_id, name, season) values
  ('a2000000-0000-4000-8000-00000000000a', '85000000-0000-4000-8000-000000000001', 'pgtap-qr-1', 2026),
  ('a2000000-0000-4000-8000-00000000000b', '85000000-0000-4000-8000-000000000005', 'pgtap-qr-2', 2026);

insert into teams (id, owner_id, name, league_id) values
  ('c2000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001',
   'pgtap-qr-t1', 'a2000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000002',
   'pgtap-qr-t2', 'a2000000-0000-4000-8000-00000000000a'),
  ('c2000000-0000-4000-8000-000000000004', '85000000-0000-4000-8000-000000000005',
   'pgtap-qr-t4', 'a2000000-0000-4000-8000-00000000000b');

insert into league_members (league_id, user_id, team_id, role) values
  ('a2000000-0000-4000-8000-00000000000a', '85000000-0000-4000-8000-000000000001',
   'c2000000-0000-4000-8000-000000000001', 'commissioner'),
  ('a2000000-0000-4000-8000-00000000000a', '85000000-0000-4000-8000-000000000002',
   'c2000000-0000-4000-8000-000000000002', 'manager'),
  ('a2000000-0000-4000-8000-00000000000b', '85000000-0000-4000-8000-000000000005',
   'c2000000-0000-4000-8000-000000000004', 'commissioner');

insert into players (id, full_name, position) values
  ('pgtap-qr-p1', 'PgTap QR QB', 'QB'),
  ('pgtap-qr-p2', 'PgTap QR RB', 'RB'),
  ('pgtap-qr-p3', 'PgTap QR WR', 'WR'),
  ('pgtap-qr-p4', 'PgTap QR TE', 'TE');

insert into drafts (id, league_id, draft_type, status, is_mock, config) values
  ('e1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-00000000000a',
   'snake', 'live', false, '{}'),
  ('e1000000-0000-4000-8000-00000000000e', 'a2000000-0000-4000-8000-00000000000a',
   'snake', 'live', true,
   '{"mock": {"launched_by": "85000000-0000-4000-8000-000000000001",
              "human_team_id": "c2000000-0000-4000-8000-000000000002",
              "cpu_speed": "realistic"}}');

-- ---------------------------------------------------------------------------
-- C. Replace semantics as u2 (manager, own seat t2, real draft d1)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "85000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select is(
  draft_queue_replace(
    'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
    array['pgtap-qr-p1', 'pgtap-qr-p2', 'pgtap-qr-p3']),
  '[{"player_id": "pgtap-qr-p1", "rank": 1},
    {"player_id": "pgtap-qr-p2", "rank": 2},
    {"player_id": "pgtap-qr-p3", "rank": 3}]'::jsonb,
  'replace returns THIS call''s settled queue — dense ranks 1..n in submitted order');

select is(
  (select count(*) from draft_queues
   where draft_id = 'e1000000-0000-4000-8000-000000000001'
     and team_id = 'c2000000-0000-4000-8000-000000000002'),
  3::bigint, 'three stored rows after the first replace');

-- The OVERLAPPING re-replace (the D123(6) trap the raw path fell into:
-- uniq(draft_id, team_id, player_id) versus a not-yet-deleted row): old
-- rows fully gone, new order in place, dense.
select is(
  draft_queue_replace(
    'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
    array['pgtap-qr-p3', 'pgtap-qr-p1']),
  '[{"player_id": "pgtap-qr-p3", "rank": 1},
    {"player_id": "pgtap-qr-p1", "rank": 2}]'::jsonb,
  'overlapping re-replace succeeds — delete-before-insert inside ONE txn');
select is(
  (select array_agg(player_id order by rank) from draft_queues
   where draft_id = 'e1000000-0000-4000-8000-000000000001'
     and team_id = 'c2000000-0000-4000-8000-000000000002'),
  array['pgtap-qr-p3', 'pgtap-qr-p1'],
  'stored rows agree — the old set is fully gone');

-- Empty array clears.
select is(
  draft_queue_replace(
    'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
    array[]::text[]),
  '[]'::jsonb, 'empty array clears and returns []');
select is(
  (select count(*) from draft_queues
   where draft_id = 'e1000000-0000-4000-8000-000000000001'
     and team_id = 'c2000000-0000-4000-8000-000000000002'),
  0::bigint, 'cleared — zero stored rows');

-- Re-seed a two-row queue for the refusal side-effect pins below.
select is(
  (select jsonb_array_length(draft_queue_replace(
    'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
    array['pgtap-qr-p1', 'pgtap-qr-p4']))),
  2, 're-seeded a two-row queue');

-- ---------------------------------------------------------------------------
-- D. Shape refusals (22023 — friendly, pre-destructive) as u2
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
       array['pgtap-qr-p1', 'pgtap-qr-p1']) $$,
  '22023', 'A player can appear in the queue only once.',
  'intra-array duplicate refused 22023');

select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
       array['pgtap-qr-p1', 'pgtap-qr-ghost']) $$,
  '22023', 'Unknown player id(s): pgtap-qr-ghost',
  'unknown player refused 22023, id named');

select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
       (select array_agg('pgtap-qr-x' || g::text) from generate_series(1, 501) g)) $$,
  '22023', 'A queue can hold at most 500 players.',
  '> 500 players refused 22023');

select throws_ok(
  $$ select draft_queue_replace(
       null, 'c2000000-0000-4000-8000-000000000002', array['pgtap-qr-p1']) $$,
  '22023', 'draft_id, team_id and players are required.',
  'NULL draft_id refused 22023');

select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
       null) $$,
  '22023', 'draft_id, team_id and players are required.',
  'NULL players refused 22023');

-- ---------------------------------------------------------------------------
-- E. Auth refusals (42501 — one error for every arm, no-leak)
-- ---------------------------------------------------------------------------

-- u2 forging the COMMISSIONER's seat on the real draft.
select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
       array['pgtap-qr-p1']) $$,
  '42501', 'You do not manage this queue.',
  'forged seat (another member''s team) refused 42501');

-- u2 is t2's REAL owner but did NOT launch the mock — the F51 exclusion
-- mirrored in the in-body guard.
select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-00000000000e', 'c2000000-0000-4000-8000-000000000002',
       array['pgtap-qr-p1']) $$,
  '42501', 'You do not manage this queue.',
  'mock draft: the human seat''s real owner is refused (F51 arm)');

-- A refused replace left the queue untouched (the 22023 arms fired before
-- the destructive delete; the 42501 arms before the lock).
select is(
  (select array_agg(player_id order by rank) from draft_queues
   where draft_id = 'e1000000-0000-4000-8000-000000000001'
     and team_id = 'c2000000-0000-4000-8000-000000000002'),
  array['pgtap-qr-p1', 'pgtap-qr-p4'],
  'every refusal above left the stored queue untouched');

-- u4: outsider — SAME error as the forged seat (no-leak).
select set_config('request.jwt.claims',
  '{"sub": "85000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
       array['pgtap-qr-p1']) $$,
  '42501', 'You do not manage this queue.',
  'outsider refused with the SAME 42501 (no-leak)');

-- u5: owns t4 — but t4 lives in L2 and d1 is L1's draft (the guard's
-- league-consistency arm, stricter than 065's policy text — recorded).
select set_config('request.jwt.claims',
  '{"sub": "85000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000004',
       array['pgtap-qr-p1']) $$,
  '42501', 'You do not manage this queue.',
  'own team + someone else''s draft (cross-league) refused 42501');

-- ---------------------------------------------------------------------------
-- F. The mock LAUNCHER arm (D103(3)): u1 writes the human seat's queue on
--    the mock — the seat is u2's franchise, launcher ≠ owner.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "85000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  draft_queue_replace(
    'e1000000-0000-4000-8000-00000000000e', 'c2000000-0000-4000-8000-000000000002',
    array['pgtap-qr-p2', 'pgtap-qr-p4']),
  '[{"player_id": "pgtap-qr-p2", "rank": 1},
    {"player_id": "pgtap-qr-p4", "rank": 2}]'::jsonb,
  'the mock launcher replaces the human seat''s queue (D103(3) arm)');

-- ...and u1 on the REAL draft may only write HIS OWN seat: t2 is refused.
select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
       array['pgtap-qr-p1']) $$,
  '42501', 'You do not manage this queue.',
  'the commissioner is NOT special here: another manager''s real-draft queue refused');

-- The real-draft owner arm still works for u1's own seat.
select is(
  (select jsonb_array_length(draft_queue_replace(
    'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
    array['pgtap-qr-p3']))),
  1, 'the commissioner''s OWN seat replace works (owner arm)');

-- ---------------------------------------------------------------------------
-- G. service_role: EXECUTE granted but auth.uid() is NULL → the in-body
--    guard refuses BY DESIGN (privileged fixture writes go straight to the
--    table, never through this RPC — loud, not a silent no-op).
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
-- Clear the JWT claims (set_config persists to txn end — D49(7)): a
-- service-role caller has NO jwt sub, and that NULL-uid path is what this
-- pin exercises.
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select draft_queue_replace(
       'e1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002',
       array['pgtap-qr-p1']) $$,
  '42501', 'You do not manage this queue.',
  'service_role (auth.uid() NULL) refused in-body — by design, recorded');
reset role;

-- ---------------------------------------------------------------------------
-- H. RLS-backstop coexistence pin: the queues the function wrote are the
--    SAME rows 065's policies govern — u2 (t2's owner, real draft) still
--    reads exactly his own seat's rows and nothing else.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "85000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select array_agg(player_id order by rank) from draft_queues
   where draft_id = 'e1000000-0000-4000-8000-000000000001'
     and team_id = 'c2000000-0000-4000-8000-000000000002'),
  array['pgtap-qr-p1', 'pgtap-qr-p4'],
  'u2 still reads his own real-draft queue (065 SELECT policy over the RPC''s rows)');
select is(
  (select count(*) from draft_queues
   where draft_id = 'e1000000-0000-4000-8000-000000000001'
     and team_id = 'c2000000-0000-4000-8000-000000000001'),
  0::bigint,
  'u2 reads NOTHING of the commissioner''s queue (065 own-queue scope holds)');
reset role;

select * from finish();
rollback;
