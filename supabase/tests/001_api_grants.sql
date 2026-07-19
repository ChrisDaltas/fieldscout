-- ============================================================================
-- API-role grant surface — L.A0.5c (migration 037; resolves D18).
--
-- Production's grant model (verified 2026-07-19): anon/authenticated/
-- service_role hold table privileges everywhere and postgres-owned default
-- ACLs extend that to future objects — RLS is the effective gate (spec §12).
-- Migration 037 versions that model; this test pins it so a CLI behavior
-- change (e.g. the 2026-10-30 always-revoke default) fails loudly here
-- instead of as confusing 42501s scattered through the policy tests.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

-- Catch-up grants on the existing surface (player_stats as the D18 witness).
select ok(has_table_privilege('anon', 'public.player_stats', 'SELECT'),
  'anon holds SELECT on player_stats (037 catch-up)');
select ok(has_table_privilege('anon', 'public.player_stats', 'INSERT'),
  'anon holds INSERT on player_stats — RLS, not grants, is what denies writes');
select ok(has_table_privilege('authenticated', 'public.player_stats', 'SELECT'),
  'authenticated holds SELECT on player_stats (037 catch-up)');
select ok(has_table_privilege('service_role', 'public.player_stats', 'SELECT'),
  'service_role holds SELECT on player_stats (037 catch-up)');

-- Default ACLs fire for objects created AFTER 037 (the D18 failure mode:
-- without them, every new leagues table would 42501 on missing grants).
create table public._grants_canary (id int primary key);
alter table public._grants_canary enable row level security;
create function public._grants_canary_fn() returns int
  language sql as 'select 1';

select ok(has_table_privilege('anon', 'public._grants_canary', 'SELECT'),
  'future table auto-grants SELECT to anon (037 default ACL)');
select ok(has_table_privilege('authenticated', 'public._grants_canary', 'INSERT'),
  'future table auto-grants INSERT to authenticated (037 default ACL)');
select ok(has_table_privilege('service_role', 'public._grants_canary', 'SELECT'),
  'future table auto-grants SELECT to service_role (037 default ACL)');
select ok(has_function_privilege('authenticated', 'public._grants_canary_fn()', 'EXECUTE'),
  'future function auto-grants EXECUTE to authenticated (037 default ACL)');

-- Grants are not access: RLS still gates the canary (no policies).
insert into public._grants_canary values (1);
set local role anon;

select is(
  (select count(*)::int from public._grants_canary), 0,
  'RLS with no policy hides rows from anon despite the grant'
);
select throws_ok(
  $$ insert into public._grants_canary values (2) $$,
  '42501',
  null,
  'RLS with no policy denies anon INSERT despite the grant'
);

reset role;

select * from finish();

rollback;
