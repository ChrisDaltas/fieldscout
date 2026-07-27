-- ============================================================================
-- league_members + §12.0 helpers + §12.1 policy swap — migration 052
-- (spec §12.0–12.2, §17; plan §8.2; task L.A1.2; standing rules tasks-M1 §4).
--
-- Falsifiability notes (§4.3):
--   * Policy-swap pins run BOTH directions: a member with no teams row must
--     see the league (fails under 001's teams-based policy), and a teams-row
--     owner with no membership must NOT (passes under the old policy, fails
--     now). Re-pointing the SELECT policy at the old check breaks both.
--   * Helper truth table carries counter-pins against plausibly-wrong
--     implementations: a teams-based is_league_member (u3), a
--     'commissioner'-only is_league_commish (u5 co-commish), and a
--     league_id-ignoring membership check (u2 against L2).
--   * Writes RLS silently filters (UPDATE/DELETE) use the RETURNING-count
--     pattern preceded by a same-role SELECT-sees-N pin; INSERT expects
--     42501 (003_nfl_weeks precedent, standing rule §4.2).
--   * All privileged-context asserts run BEFORE any JWT claims are set —
--     set_config(..., true) persists to txn end (D49(7) lesson).
--   * anon leagues SELECT asserts an empty RESULT, not an error — falsifiable
--     against an over-eager REVOKE EXECUTE on the policy-predicate helpers
--     (052's documented §4.1 deviation). R42 correction: the load-bearing
--     grant is Postgres's default PUBLIC EXECUTE — a literal
--     `REVOKE ... FROM anon` is a behavioral no-op, so the helper ACL is
--     ALSO pinned directly (PUBLIC + explicit anon entries): either REVOKE
--     form now trips the suite.
--   * Post-054 (Q8 ruling): leagues has NO client write policy and
--     league_members has NO client UPDATE — the review's forged-snapshot
--     and reseat probes are reproduced as denial pins in 008; this file
--     pins the policy surface + the placeholder-seat-only write shape.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(77);

-- ---------------------------------------------------------------------------
-- A. Shape: §12.2 column-for-column.
-- ---------------------------------------------------------------------------
select has_table('public', 'league_members', 'league_members exists');
select columns_are('public', 'league_members',
  array['id', 'league_id', 'user_id', 'team_id', 'role', 'is_placeholder',
        'is_autodraft', 'faab_balance', 'joined_at'],
  'exact §12.2 column set');
select col_is_pk('public', 'league_members', 'id', 'PK id');
select col_type_is('public', 'league_members', 'id', 'uuid', 'id is UUID');
select col_type_is('public', 'league_members', 'league_id', 'uuid', 'league_id is UUID');
select col_type_is('public', 'league_members', 'user_id', 'uuid', 'user_id is UUID');
select col_type_is('public', 'league_members', 'team_id', 'uuid', 'team_id is UUID');
select col_type_is('public', 'league_members', 'role', 'text', 'role is TEXT');
select col_type_is('public', 'league_members', 'is_placeholder', 'boolean', 'is_placeholder is BOOLEAN');
select col_type_is('public', 'league_members', 'is_autodraft', 'boolean', 'is_autodraft is BOOLEAN');
select col_type_is('public', 'league_members', 'faab_balance', 'integer', 'faab_balance is INTEGER');
select col_type_is('public', 'league_members', 'joined_at', 'timestamp with time zone', 'joined_at is TIMESTAMPTZ');
select col_not_null('public', 'league_members', 'league_id', 'league_id NOT NULL');
select col_is_null('public', 'league_members', 'user_id', 'user_id nullable (placeholder seats)');
select col_is_null('public', 'league_members', 'team_id', 'team_id nullable');
select col_default_is('public', 'league_members', 'role', 'manager', $$role defaults to 'manager'$$);
select fk_ok('public', 'league_members', 'league_id', 'public', 'leagues', 'id', 'league_id → leagues');
select fk_ok('public', 'league_members', 'user_id', 'public', 'profiles', 'id', 'user_id → profiles');
select fk_ok('public', 'league_members', 'team_id', 'public', 'teams', 'id', 'team_id → teams');
select has_index('public', 'league_members', 'idx_league_members_league', 'league index exists');
select has_index('public', 'league_members', 'idx_league_members_user', 'user index exists');

-- ---------------------------------------------------------------------------
-- B. RLS surface: league_members policies + the post-swap leagues policy list.
-- ---------------------------------------------------------------------------
select ok(
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'league_members'),
  'RLS enabled on league_members');
-- Post-063 (L.A1.15/D74(3)): the two 054 placeholder carve-outs are GONE —
-- they required `team_id IS NULL`, a seat with no franchise, which contradicts
-- §7.2:170's placeholder shape and is invisible to every capacity check
-- (spec erratum v2.8.8). league_members is SELECT-only on the client; seats
-- are added by add_placeholder_seat and opened by remove_manager(vacate).
select policies_are('public', 'league_members',
  array['Members viewable by league members'],
  'exactly ONE policy: the member SELECT (§12.2 as amended by errata v2.8.2 + v2.8.8 — no client INSERT/UPDATE/DELETE at all)');
select policy_cmd_is('public', 'league_members', 'Members viewable by league members', 'SELECT',
  'the surviving policy is SELECT-only');
select policies_are('public', 'leagues',
  array['Leagues viewable by members'],
  'leagues carries ONLY the member/owner SELECT policy (054/Q8: league state is server-authoritative)');
select policy_cmd_is('public', 'leagues', 'Leagues viewable by members', 'SELECT',
  'swapped-in leagues policy is SELECT');

-- ---------------------------------------------------------------------------
-- C. Helper hardening (§12.0 v2.0 note; standing rule §4.1).
-- ---------------------------------------------------------------------------
select has_function('public', 'is_league_member', array['uuid'], 'is_league_member(uuid) exists');
select has_function('public', 'is_league_commish', array['uuid'], 'is_league_commish(uuid) exists');
select is_definer('public', 'is_league_member', array['uuid'], 'is_league_member is SECURITY DEFINER');
select is_definer('public', 'is_league_commish', array['uuid'], 'is_league_commish is SECURITY DEFINER');
select volatility_is('public', 'is_league_member', array['uuid'], 'stable', 'is_league_member STABLE');
select volatility_is('public', 'is_league_commish', array['uuid'], 'stable', 'is_league_commish STABLE');
select is(
  (select proconfig from pg_proc
   where oid = 'public.is_league_member(uuid)'::regprocedure),
  array['search_path=""'],
  'is_league_member pins search_path = '''' (the spec form, not public,pg_temp)');
select is(
  (select proconfig from pg_proc
   where oid = 'public.is_league_commish(uuid)'::regprocedure),
  array['search_path=""'],
  'is_league_commish pins search_path = ''''');

-- R42: the helpers' EXECUTE posture pinned at the ACL layer. The behavioral
-- empty-result pin below only trips on REVOKE FROM PUBLIC (anon inherits
-- EXECUTE via the default PUBLIC grant — the load-bearing one); these four
-- make the literal `REVOKE ... FROM anon` no-op trip the suite too.
select is(
  (select count(*) from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.oid = 'public.is_league_member(uuid)'::regprocedure
     and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  1::bigint,
  'is_league_member keeps the PUBLIC EXECUTE grant (the load-bearing grant for anon policy evaluation — R42)');
select is(
  (select count(*) from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.oid = 'public.is_league_member(uuid)'::regprocedure
     and a.privilege_type = 'EXECUTE' and a.grantee = 'anon'::regrole),
  1::bigint,
  'is_league_member keeps the explicit anon EXECUTE grant (a FROM-anon-only REVOKE is a behavioral no-op but signals intent drift — trips here, R42)');
select is(
  (select count(*) from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.oid = 'public.is_league_commish(uuid)'::regprocedure
     and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  1::bigint,
  'is_league_commish keeps the PUBLIC EXECUTE grant (R42)');
select is(
  (select count(*) from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.oid = 'public.is_league_commish(uuid)'::regprocedure
     and a.privilege_type = 'EXECUTE' and a.grantee = 'anon'::regrole),
  1::bigint,
  'is_league_commish keeps the explicit anon EXECUTE grant (R42)');

-- ---------------------------------------------------------------------------
-- D. Fixtures (postgres context — before any JWT claims).
--    u1 commish+owner L1 · u2 manager L1 (no teams row) · u3 teams-row owner
--    in L1, NOT a member · u4 outsider · u5 co-commish L1 · u6 commish L2.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-lm1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lm_commish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-lm2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lm_member"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-lm3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lm_teamowner"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'pgtap-lm4@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lm_outsider"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'pgtap-lm5@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lm_cocommish"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-4000-8000-000000000006',
   'authenticated', 'authenticated', 'pgtap-lm6@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lm_l2commish"}', now(), now());

insert into leagues (id, owner_id, name, season) values
  ('a0000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000001', 'pgtap-lm-1', 2026),
  ('a0000000-0000-4000-8000-00000000000b', '70000000-0000-4000-8000-000000000006', 'pgtap-lm-2', 2026);

-- u3's teams row in L1 (teams.list_id is still NOT NULL pre-L.A1.3).
insert into lists (id, owner_id, title, slug) values
  ('b0000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000003', 'pgtap-lm-list', 'pgtap-lm-list');
insert into teams (id, owner_id, list_id, name, league_id) values
  ('c0000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000003',
   'b0000000-0000-4000-8000-00000000000a', 'pgtap-lm-team', 'a0000000-0000-4000-8000-00000000000a');

insert into league_members (id, league_id, user_id, role, is_placeholder) values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   '70000000-0000-4000-8000-000000000001', 'commissioner', false),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a',
   '70000000-0000-4000-8000-000000000002', 'manager', false),
  ('d0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-00000000000a',
   '70000000-0000-4000-8000-000000000005', 'co_commissioner', false),
  ('d0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-00000000000a',
   null, 'manager', true),
  ('d0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-00000000000a',
   null, 'manager', true),
  ('d0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-00000000000b',
   '70000000-0000-4000-8000-000000000006', 'commissioner', false);

-- Uniqueness boundaries (§12.2): dup (league,user) and (league,team) reject;
-- multiple NULL-user placeholders per league are legal (seeded two above).
select throws_ok(
  $$ insert into league_members (league_id, user_id)
     values ('a0000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000002') $$,
  '23505', null, 'duplicate (league_id, user_id) rejected');
select throws_ok(
  $$ insert into league_members (league_id, user_id, team_id) values
     ('a0000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000004',
      'c0000000-0000-4000-8000-00000000000a'),
     ('a0000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000006',
      'c0000000-0000-4000-8000-00000000000a') $$,
  '23505', null,
  'two seats claiming the same team within one league rejected (UNIQUE(league_id, team_id))');
select is(
  (select count(*) from league_members
   where league_id = 'a0000000-0000-4000-8000-00000000000a' and user_id is null),
  2::bigint,
  'two NULL-user placeholder seats coexist in one league (UNIQUE(league_id, user_id) treats NULLs as distinct)');

-- ---------------------------------------------------------------------------
-- E. Helper truth table (JWT claims from here on — client contexts only).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(is_league_member('a0000000-0000-4000-8000-00000000000a'), true,  'commish IS a member');
select is(is_league_commish('a0000000-0000-4000-8000-00000000000a'), true, 'commish IS commish');

select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select is(is_league_commish('a0000000-0000-4000-8000-00000000000a'), true,
  'co_commissioner IS commish — a role-list implementation checking only ''commissioner'' fails here');

select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(is_league_member('a0000000-0000-4000-8000-00000000000a'), true,  'manager IS a member');
select is(is_league_commish('a0000000-0000-4000-8000-00000000000a'), false, 'manager is NOT commish');
select is(is_league_member('a0000000-0000-4000-8000-00000000000b'), false,
  'membership is league-scoped — an implementation ignoring league_id fails here');

select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(is_league_member('a0000000-0000-4000-8000-00000000000a'), false,
  'a teams-row owner with no league_members row is NOT a member — a teams-based implementation fails here');

select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(is_league_member('a0000000-0000-4000-8000-00000000000a'), false,  'outsider is not a member');
select is(is_league_commish('a0000000-0000-4000-8000-00000000000a'), false, 'outsider is not commish');

-- ---------------------------------------------------------------------------
-- F. §12.1 policy swap, both directions + owner branch.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*) from leagues where name = 'pgtap-lm-1'), 1::bigint,
  'NEW semantics: a member with NO teams row sees the league (the old teams-based policy denied this)');

select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(
  (select count(*) from leagues where name like 'pgtap-lm-%'), 0::bigint,
  'OLD semantics now fail: a teams-row owner with no membership sees NOTHING (the old policy granted this)');

select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(
  (select count(*) from leagues where name = 'pgtap-lm-1'), 1::bigint,
  'owner_id = auth.uid() branch still grants SELECT');

-- ---------------------------------------------------------------------------
-- G. league_members RLS per role (§4.2 pattern).
-- ---------------------------------------------------------------------------
-- member (manager) u2: read own league only; no writes.
select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(
  (select count(*) from league_members
   where league_id = 'a0000000-0000-4000-8000-00000000000a'),
  5::bigint,
  'member sees all 5 rows of own league (SELECT-sees-N pin for the counts below)');
select is(
  (select count(*) from league_members
   where league_id = 'a0000000-0000-4000-8000-00000000000b'),
  0::bigint,
  'member sees zero rows of a league they are not in');
select throws_ok(
  $$ insert into league_members (league_id, user_id)
     values ('a0000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'manager INSERT denied (WITH CHECK is commish-only)');
select results_eq(
  $$ with w as (update league_members set is_autodraft = true
                where league_id = 'a0000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'manager UPDATE affects 0 rows (RETURNING-count; sees 5, changes none)');
select results_eq(
  $$ with d as (delete from league_members
                where league_id = 'a0000000-0000-4000-8000-00000000000a' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'manager DELETE affects 0 rows (RETURNING-count)');

-- outsider u4: reads nothing, writes nothing.
select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select is(
  (select count(*) from league_members), 0::bigint,
  'non-member sees zero league_members rows anywhere');
select throws_ok(
  $$ insert into league_members (league_id, user_id)
     values ('a0000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'non-member cannot self-join by INSERT');
select results_eq(
  $$ with w as (update league_members set role = 'commissioner' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'non-member UPDATE affects 0 rows');
select results_eq(
  $$ with d as (delete from league_members returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'non-member DELETE affects 0 rows');

-- commissioner u1: placeholder-seat add/remove ONLY (054/R38 — no UPDATE,
-- nothing seated, nothing role-bearing, no real users, league-scoped).
select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into league_members (id, league_id, user_id, is_placeholder)
     values ('d0000000-0000-4000-8000-000000000009',
             'a0000000-0000-4000-8000-00000000000a', null, true) $$,
  '42501', null,
  'commish INSERT of a team-less placeholder seat is DENIED post-063 — the last client-shaped write is gone (D74(3)); seats are created by add_placeholder_seat, which attaches a real franchise and counts against capacity');
select results_eq(
  $$ with w as (update league_members set is_autodraft = true
                where id = 'd0000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'commish UPDATE affects 0 rows — NO client UPDATE policy (054/R38; sees the row, changes nothing)');
select throws_ok(
  $$ insert into league_members (league_id, user_id, is_placeholder)
     values ('a0000000-0000-4000-8000-00000000000a',
             '70000000-0000-4000-8000-000000000004', false) $$,
  '42501', null,
  'commish INSERT of a REAL user''s membership denied — joins/claims are RPC-only (no stint-less cache rows)');
select throws_ok(
  $$ insert into league_members (league_id, user_id, team_id, is_placeholder)
     values ('a0000000-0000-4000-8000-00000000000a', null,
             'c0000000-0000-4000-8000-00000000000a', true) $$,
  '42501', null,
  'commish INSERT of a SEATED row denied — NO client path writes team_id (the R38 reseat probe, INSERT direction)');
select throws_ok(
  $$ insert into league_members (league_id, user_id, role, is_placeholder)
     values ('a0000000-0000-4000-8000-00000000000a', null, 'co_commissioner', true) $$,
  '42501', null,
  'commish INSERT with an elevated role denied — role grants are L.A1.15 RPC work');
select results_eq(
  $$ with d as (delete from league_members
                where id = 'd0000000-0000-4000-8000-000000000002' returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'commish DELETE of a real member affects 0 rows — kicks go through remove_manager (stint closed in the same txn)');
select throws_ok(
  $$ insert into league_members (league_id, user_id, is_placeholder)
     values ('a0000000-0000-4000-8000-00000000000b', null, true) $$,
  '42501', null,
  'commish of L1 cannot add a seat to L2 (commish power is league-scoped)');

-- co-commissioner u5: the same denial (the dropped policies used
-- is_league_commish, so a co-commissioner had the identical surface).
select set_config('request.jwt.claims',
  '{"sub": "70000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into league_members (id, league_id, user_id, is_placeholder)
     values ('d0000000-0000-4000-8000-00000000000e',
             'a0000000-0000-4000-8000-00000000000a', null, true) $$,
  '42501', null,
  'co-commissioner INSERT of a placeholder seat is denied too (the carve-outs keyed on is_league_commish — dropping them closes both roles at once)');

-- anon: sees nothing, writes nothing, and leagues SELECT returns EMPTY, not
-- an error (falsifiable against a REVOKE on the policy-predicate helpers).
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*) from league_members), 0::bigint, 'anon sees zero league_members rows');
select is((select count(*) from leagues where name like 'pgtap-lm-%'), 0::bigint,
  'anon leagues SELECT is an empty result, NOT a 42501 — the helpers stay executable as policy predicates (052 §4.1 deviation)');
select throws_ok(
  $$ insert into league_members (league_id, user_id)
     values ('a0000000-0000-4000-8000-00000000000a', null) $$,
  '42501', null, 'anon INSERT denied');
select results_eq(
  $$ with w as (update league_members set role = 'commissioner' returning 1)
     select count(*) from w $$,
  $$ values (0::bigint) $$,
  'anon UPDATE affects 0 rows');
select results_eq(
  $$ with d as (delete from league_members returning 1)
     select count(*) from d $$,
  $$ values (0::bigint) $$,
  'anon DELETE affects 0 rows');
reset role;

-- anon helper truth (claims persist; run as postgres so EXECUTE isn't the
-- variable under test — auth.uid() is NULL either way).
select is(is_league_member('a0000000-0000-4000-8000-00000000000a'), false, 'anon context: is_league_member false');
select is(is_league_commish('a0000000-0000-4000-8000-00000000000a'), false, 'anon context: is_league_commish false');

select * from finish();
rollback;
