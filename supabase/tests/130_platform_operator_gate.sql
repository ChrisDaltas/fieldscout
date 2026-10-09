-- ============================================================================
-- 130 — the platform operator gate + `platform_operator_actions`
--       (migration 182; M8 L.G1.1; tasks-M8 TD1 / TD2 / TD3; Q95 (a);
--       PROGRESS D511)
-- ============================================================================
-- What this file proves, in one rolled-back transaction, PER ROLE
-- (anon / authenticated non-admin / commissioner / operator / service_role /
-- the table owner):
--   §A  FORM — gate DEFINER + search_path '' + EXECUTE: authenticated and
--       service_role yes, anon no; helper and trigger bodies plain,
--       search_path '', no client EXECUTE; both triggers ENABLE ALWAYS; RLS on;
--       exactly one policy (SELECT); TRUNCATE held by no client role.
--   §G  THE GATE — false for anon, a plain user and a commissioner; true for
--       the operator; reads no league_members (the body names profiles only).
--   §R  READS — anon / user / commissioner see 0 rows; operator and
--       service_role see both.
--   §W  WRITES — INSERT refused for every client role (RLS, 42501); UPDATE /
--       DELETE through RLS touch 0 rows (RETURNING counts) for every client
--       role INCLUDING the operator; TRUNCATE refused (42501); service_role
--       and the table OWNER are refused UPDATE / DELETE / TRUNCATE by the
--       triggers (P0001).
--   §H  THE HELPER — a client cannot call it (42501); a non-operator actor is
--       refused by name; a duplicate action_id fails loudly (23505); the
--       scope / league and reason CHECKs hold.
--   §S  SELF-GRANT (026 re-proved) — a user cannot set their own is_admin
--       (23514 by name) nor insert a profile row (42501).
-- Break probe (§4.3): drop trg_op_actions_immutable ⇒ W9 / W10 red (shown in
-- the PR, reverted).
-- World: u1 plain user, u2 commissioner of league L, u3 operator.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(44);

-- ---------------------------------------------------------------------------
-- A. Form
-- ---------------------------------------------------------------------------
select is(
  (select format('%s:%s:%s:%s:%s', p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('anon', p.oid, 'EXECUTE'),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                 has_function_privilege('service_role', p.oid, 'EXECUTE'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_platform_operator'),
  't:search_path="":f:t:t',
  'A1 the gate is DEFINER, search_path '''', EXECUTE: anon no, authenticated / service_role yes');
select is(
  (select string_agg(format('%s=%s:%s:%s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                 has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('log_operator_action_internal', 'op_actions_immutable_internal', 'op_actions_no_truncate_internal')),
  'log_operator_action_internal=f:search_path="":f op_actions_immutable_internal=f:search_path="":f op_actions_no_truncate_internal=f:search_path="":f',
  'A2 helper + trigger bodies are plain, search_path '''', EXECUTE revoked from anon / authenticated');
select is(
  (select string_agg(format('%s:%s', t.tgname, t.tgenabled), ' ' order by t.tgname)
   from pg_trigger t where t.tgrelid = 'public.platform_operator_actions'::regclass and not t.tgisinternal),
  'trg_op_actions_immutable:A trg_op_actions_no_truncate:A',
  'A3 exactly the two immutability triggers, both ENABLE ALWAYS (R616)');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_operator_actions'::regclass),
  'A4 RLS enabled');
select is(
  (select string_agg(format('%s:%s:%s', policyname, cmd, roles::text), ' ') from pg_policies
   where schemaname = 'public' and tablename = 'platform_operator_actions'),
  'Operator audit readable by platform operators:SELECT:{authenticated}',
  'A5 exactly one policy, SELECT to authenticated — no INSERT / UPDATE / DELETE policy');
select ok(
  not has_table_privilege('anon', 'public.platform_operator_actions', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.platform_operator_actions', 'TRUNCATE'),
  'A6 TRUNCATE held by neither anon nor authenticated (133 / 081)');
select ok(
  (select pg_get_functiondef(p.oid) !~* 'league_members'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_platform_operator'),
  'A7 TD1: the gate body never reads league_members');

-- ---------------------------------------------------------------------------
-- B. The world
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000',
       ('99130000-0000-4000-8000-00000000000' || i)::uuid,
       'authenticated', 'authenticated', 'pgtap-x130-u' || i || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}',
       ('{"username": "x130_user_' || i || '"}')::jsonb, now(), now()
from generate_series(1, 3) i;

-- The operator. The test runs as the owner with no JWT, which is the
-- service-side path 026's guard allows.
update profiles set is_admin = true where id = '99130000-0000-4000-8000-000000000003';

insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings, scoring_rules_snapshot) values
  ('b1300000-0000-4000-8000-000000000001', '99130000-0000-4000-8000-000000000002', 'pgtap-x130-L', 2026, 'drafting', 8,
   (select id from scoring_systems where is_template and name = 'ESPN Standard'), '{}', '{}');
insert into league_members (league_id, user_id, team_id, role, is_placeholder) values
  ('b1300000-0000-4000-8000-000000000001', '99130000-0000-4000-8000-000000000002', null, 'commissioner', false);

select isnt(
  log_operator_action_internal('a1300000-0000-4000-8000-000000000001', '99130000-0000-4000-8000-000000000003',
    'x130_platform_verb', 'platform', null, null, null, '{"n": 1}', null),
  null, 'B1 the helper writes a platform-scoped row (reason omitted — optional)');
select isnt(
  log_operator_action_internal('a1300000-0000-4000-8000-000000000002', '99130000-0000-4000-8000-000000000003',
    'x130_league_verb', 'league', 'b1300000-0000-4000-8000-000000000001', 'x130 reason', '{"a": 0}', '{"a": 1}'),
  null, 'B2 the helper writes a league-scoped row');

create temp table r130 (tag text, n int);
grant all on r130 to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- G + R. The gate and the reads, per role
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select is_platform_operator() $$, '42501', null, 'G1 anon cannot even ask the gate');
select is((select count(*)::int from platform_operator_actions), 0, 'R1 anon reads 0 rows');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99130000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(is_platform_operator(), false, 'G2 a plain user is not an operator');
select is((select count(*)::int from platform_operator_actions), 0, 'R2 a plain user reads 0 rows');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99130000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select is(is_platform_operator(), false, 'G3 a commissioner is not an operator (TD1)');
select is((select count(*)::int from platform_operator_actions), 0, 'R3 a commissioner reads 0 rows — not even their own league''s row');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99130000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select is(is_platform_operator(), true, 'G4 the is_admin user is an operator (Q95 (a))');
select is((select count(*)::int from platform_operator_actions where verb like 'x130_%'), 2, 'R4 the operator reads both rows');
reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is((select count(*)::int from platform_operator_actions where verb like 'x130_%'), 2, 'R5 service_role reads both rows');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- W. Writes, per role
-- ---------------------------------------------------------------------------
-- anon
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ insert into platform_operator_actions (action_id, actor_id, verb, scope) values
     ('a1300000-0000-4000-8000-0000000000a1', '99130000-0000-4000-8000-000000000003', 'x130_forged', 'platform') $$,
  '42501', null, 'W1 anon INSERT refused');
with u as (update platform_operator_actions set verb = 'x130_tamper' returning 1) insert into r130 select 'anon_u', count(*)::int from u;
with d as (delete from platform_operator_actions returning 1) insert into r130 select 'anon_d', count(*)::int from d;
select is((select sum(n)::int from r130 where tag in ('anon_u', 'anon_d')), 0, 'W2 anon UPDATE + DELETE touch 0 rows (RETURNING)');
reset role;

-- plain user, commissioner, operator — the same three writes each
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99130000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into platform_operator_actions (action_id, actor_id, verb, scope) values
     ('a1300000-0000-4000-8000-0000000000a2', '99130000-0000-4000-8000-000000000001', 'x130_forged', 'platform') $$,
  '42501', null, 'W3 a plain user INSERT refused');
with u as (update platform_operator_actions set verb = 'x130_tamper' returning 1) insert into r130 select 'u1_u', count(*)::int from u;
with d as (delete from platform_operator_actions returning 1) insert into r130 select 'u1_d', count(*)::int from d;
select is((select sum(n)::int from r130 where tag in ('u1_u', 'u1_d')), 0, 'W4 a plain user UPDATE + DELETE touch 0 rows');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99130000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into platform_operator_actions (action_id, actor_id, verb, scope, league_id) values
     ('a1300000-0000-4000-8000-0000000000a3', '99130000-0000-4000-8000-000000000002', 'x130_forged', 'league', 'b1300000-0000-4000-8000-000000000001') $$,
  '42501', null, 'W5 a commissioner INSERT refused, even for their own league');
with u as (update platform_operator_actions set verb = 'x130_tamper' returning 1) insert into r130 select 'u2_u', count(*)::int from u;
with d as (delete from platform_operator_actions returning 1) insert into r130 select 'u2_d', count(*)::int from d;
select is((select sum(n)::int from r130 where tag in ('u2_u', 'u2_d')), 0, 'W6 a commissioner UPDATE + DELETE touch 0 rows');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99130000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into platform_operator_actions (action_id, actor_id, verb, scope) values
     ('a1300000-0000-4000-8000-0000000000a4', '99130000-0000-4000-8000-000000000003', 'x130_direct', 'platform') $$,
  '42501', null, 'W7 the operator cannot INSERT directly either — only through a verb');
with u as (update platform_operator_actions set verb = 'x130_tamper' returning 1) insert into r130 select 'u3_u', count(*)::int from u;
with d as (delete from platform_operator_actions returning 1) insert into r130 select 'u3_d', count(*)::int from d;
select is((select sum(n)::int from r130 where tag in ('u3_u', 'u3_d')), 0, 'W8 the operator UPDATE + DELETE touch 0 rows (no UPDATE / DELETE policy)');
select throws_ok($$ truncate platform_operator_actions $$, '42501', null, 'W8b the operator cannot TRUNCATE (grant revoked)');
reset role;

-- service_role (bypasses RLS) — the triggers are what refuse it
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select throws_ok(
  $$ update platform_operator_actions set verb = 'x130_tamper' where action_id = 'a1300000-0000-4000-8000-000000000001' $$,
  'P0001', 'platform_operator_actions is append-only: a UPDATE on the operator audit is refused (M8 TD2 — an operator undo is a NEW row, never an edit to an old one)',
  'W9 service_role UPDATE refused by the immutability trigger');
select throws_ok(
  $$ delete from platform_operator_actions where action_id = 'a1300000-0000-4000-8000-000000000001' $$,
  'P0001', 'platform_operator_actions is append-only: a DELETE on the operator audit is refused (M8 TD2 — an operator undo is a NEW row, never an edit to an old one)',
  'W10 service_role DELETE refused by the immutability trigger');
select throws_ok($$ truncate platform_operator_actions $$, 'P0001', null, 'W11 service_role TRUNCATE refused by the statement trigger');
reset role;
select set_config('request.jwt.claims', '', true);

-- the table OWNER (the role every DEFINER verb runs as)
select throws_ok(
  $$ update platform_operator_actions set reason = 'x130 rewrite' where action_id = 'a1300000-0000-4000-8000-000000000002' $$,
  'P0001', null, 'W12 the owner cannot UPDATE');
select throws_ok(
  $$ delete from platform_operator_actions where action_id = 'a1300000-0000-4000-8000-000000000002' $$,
  'P0001', null, 'W13 the owner cannot DELETE');
select throws_ok($$ truncate platform_operator_actions $$, 'P0001', null, 'W14 the owner cannot TRUNCATE');
select is((select count(*)::int from platform_operator_actions where verb like 'x130_%'), 2,
  'W15 after every attempt both rows stand, none forged');
select is((select verb from platform_operator_actions where action_id = 'a1300000-0000-4000-8000-000000000001'), 'x130_platform_verb',
  'W16 and their content is unchanged');

-- ---------------------------------------------------------------------------
-- H. The helper
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99130000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
select throws_ok(
  $$ select log_operator_action_internal('a1300000-0000-4000-8000-0000000000b1', '99130000-0000-4000-8000-000000000003',
       'x130_rpc', 'platform', null, null, null, null) $$,
  '42501', null, 'H1 even the operator cannot call the helper from a client');
reset role;
select set_config('request.jwt.claims', '', true);

select throws_ok(
  $$ select log_operator_action_internal('a1300000-0000-4000-8000-0000000000b2', '99130000-0000-4000-8000-000000000002',
       'x130_commish', 'league', 'b1300000-0000-4000-8000-000000000001', null, null, null) $$,
  '42501',
  'log_operator_action_internal: actor 99130000-0000-4000-8000-000000000002 is not a platform operator — only an operator''s change is written to the operator audit (M8 TD1 / TD2)',
  'H2 a non-operator actor (here a commissioner) is refused by name');
select throws_ok(
  $$ select log_operator_action_internal('a1300000-0000-4000-8000-000000000001', '99130000-0000-4000-8000-000000000003',
       'x130_replay', 'platform', null, null, null, null) $$,
  '23505', null, 'H3 a duplicate action_id fails loudly — never a second receipt');
select throws_ok(
  $$ select log_operator_action_internal('a1300000-0000-4000-8000-0000000000b3', '99130000-0000-4000-8000-000000000003',
       'x130_bad_scope', 'league', null, null, null, null) $$,
  '23514', null, 'H4 scope league without a league is refused');
select throws_ok(
  $$ select log_operator_action_internal('a1300000-0000-4000-8000-0000000000b4', '99130000-0000-4000-8000-000000000003',
       'x130_bad_scope', 'platform', 'b1300000-0000-4000-8000-000000000001', null, null, null) $$,
  '23514', null, 'H5 scope platform with a league is refused');
select throws_ok(
  $$ select log_operator_action_internal('a1300000-0000-4000-8000-0000000000b5', '99130000-0000-4000-8000-000000000003',
       'x130_blank', 'platform', null, E' \t\n', null, null) $$,
  '23514', null, 'H6 a supplied reason that is only whitespace is refused (reason stays optional)');

-- ---------------------------------------------------------------------------
-- S. Self-grant (026 re-proved)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99130000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ update profiles set is_admin = true where id = '99130000-0000-4000-8000-000000000001' $$,
  '23514', 'Admin status is managed by the system.',
  'S1 a user cannot set their own is_admin');
select throws_ok(
  $$ insert into profiles (id, username, is_admin) values ('99130000-0000-4000-8000-000000000009', 'x130_forged', true) $$,
  '42501', null, 'S2 a user cannot insert an is_admin profile row');
select is(is_platform_operator(), false, 'S3 and they are still not an operator');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
