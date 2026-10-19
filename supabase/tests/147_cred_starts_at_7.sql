-- ============================================================================
-- pgTAP 147 — migration 197: everyone starts with 7 cred (Chris 2026-10-18:
-- "everyone should start with 7 because 7 is lucky.")
--
--   §A  FORM — profiles.cred_score defaults to 7; the per-season
--       cred_scores.total_cred stays 0 (measured, not changed); the backfill
--       helper is PLAIN, search_path '', and REVOKEd from every API role;
--       handle_new_user names no cred, so the default is what a signup gets.
--   §B  A NEW PROFILE GETS 7 — through a signup (handle_new_user), and the
--       system/persona-owner shape (a placeholder profile the seed then
--       upserts to an "-ai" handle without naming cred).
--   §C  THE BACKFILL — no profile is at 0/NULL after 197; on pre-197 rows
--       (stored state: 0, NULL, 340, 0.5) it raises exactly the 0 and the
--       NULL to 7 and leaves both accounts above 0 untouched; a second run
--       raises nothing and changes nothing.
--   §D  A client role cannot call the helper.
--
-- Fixtures are real signups (auth.users → handle_new_user); the pre-197
-- creds are set the way pre-197 data exists — as stored state — because no
-- door can write a 0-cred profile any more.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

-- ---------------------------------------------------------------------------
-- A. FORM
-- ---------------------------------------------------------------------------
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'cred_score'),
  '7', 'A1 profiles.cred_score defaults to 7');
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'cred_scores' and column_name = 'total_cred'),
  '0', 'A2 cred_scores.total_cred (cred EARNED per season) still defaults to 0 — the start lives on the account only');
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cred_start_backfill_internal')
  and not has_function_privilege('anon', 'public.cred_start_backfill_internal()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.cred_start_backfill_internal()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.cred_start_backfill_internal()', 'EXECUTE'),
  'A3 cred_start_backfill_internal is PLAIN with search_path='''' and REVOKEd from anon, authenticated and service_role');
select ok(
  (select p.prosrc !~* 'cred'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_user'),
  'A4 handle_new_user (076) names no cred — a signup takes the column default');

-- ---------------------------------------------------------------------------
-- B. A NEW PROFILE GETS 7
-- ---------------------------------------------------------------------------
-- No profile is at 0/NULL before this file adds any (C0 reads this).
create temp table cred_premise as
  select count(*)::int as at_zero_or_null
  from public.profiles where cred_score is null or cred_score = 0;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  'pgtap-cred7-' || u.n || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}',
  u.meta, now(), now()
from (values
  (1, 'c7ed0000-0000-4000-8000-000000000001'::uuid, '{"username": "cred7_newbie"}'::jsonb),
  (2, 'c7ed0000-0000-4000-8000-000000000002'::uuid, '{}'::jsonb),
  (3, 'c7ed0000-0000-4000-8000-000000000003'::uuid, '{"username": "cred7_was_zero"}'::jsonb),
  (4, 'c7ed0000-0000-4000-8000-000000000004'::uuid, '{"username": "cred7_was_null"}'::jsonb),
  (5, 'c7ed0000-0000-4000-8000-000000000005'::uuid, '{"username": "cred7_earned_340"}'::jsonb),
  (6, 'c7ed0000-0000-4000-8000-000000000006'::uuid, '{"username": "cred7_half_point"}'::jsonb)
) as u(n, id, meta);

select results_eq(
  $$ select username, cred_score from public.profiles
     where id = 'c7ed0000-0000-4000-8000-000000000001' $$,
  $$ values ('cred7_newbie'::text, 7::numeric) $$,
  'B1 a signup (handle_new_user) starts at 7 cred');

-- The system/persona owner: a placeholder profile the seed upserts to an
-- "-ai" handle (scripts/seed-ai-personas.ts), naming no cred.
insert into public.profiles (id, username, is_pro, subscription_status)
values ('c7ed0000-0000-4000-8000-000000000002', 'pgtap-cred7-ai', true, 'active')
on conflict (id) do update set
  username = excluded.username,
  is_pro = excluded.is_pro,
  subscription_status = excluded.subscription_status;

select results_eq(
  $$ select username, cred_score from public.profiles
     where id = 'c7ed0000-0000-4000-8000-000000000002' $$,
  $$ values ('pgtap-cred7-ai'::text, 7::numeric) $$,
  'B2 a system/persona-owner profile starts at 7 cred too');

-- ---------------------------------------------------------------------------
-- C. THE BACKFILL
-- ---------------------------------------------------------------------------
select is(
  (select at_zero_or_null from cred_premise), 0,
  'C0 no profile was left at 0/NULL cred by 197 (read before this file added any)');

-- Pre-197 creds, as stored state.
update public.profiles p set cred_score = v.cred
from (values
  ('c7ed0000-0000-4000-8000-000000000003'::uuid, 0::numeric),
  ('c7ed0000-0000-4000-8000-000000000004'::uuid, null::numeric),
  ('c7ed0000-0000-4000-8000-000000000005'::uuid, 340::numeric),
  ('c7ed0000-0000-4000-8000-000000000006'::uuid, 0.5::numeric)
) as v(id, cred)
where p.id = v.id;

select is(
  public.cred_start_backfill_internal(), 2,
  'C1 the backfill raises exactly two profiles — the 0 and the NULL');
select results_eq(
  $$ select username, cred_score from public.profiles
     where id::text like 'c7ed0000-%' and id::text >= 'c7ed0000-0000-4000-8000-000000000003'
     order by id $$,
  $$ values ('cred7_was_zero'::text, 7::numeric), ('cred7_was_null', 7::numeric),
            ('cred7_earned_340', 340::numeric), ('cred7_half_point', 0.5::numeric) $$,
  'C2 0 → 7 and NULL → 7; an account above 0 (340, and even 0.5) is untouched');
select is(
  (select count(*)::int from public.profiles where cred_score is null or cred_score = 0), 0,
  'C3 after the backfill no profile anywhere is at 0 or NULL');
select is(
  public.cred_start_backfill_internal(), 0,
  'C4 a second run raises nothing (re-runnable)');
select results_eq(
  $$ select cred_score from public.profiles where id::text like 'c7ed0000-%' order by id $$,
  $$ values (7::numeric), (7::numeric), (7::numeric), (7::numeric), (340::numeric), (0.5::numeric) $$,
  'C5 ... and changes nothing');

-- ---------------------------------------------------------------------------
-- D. CLIENT ROLES
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "c7ed0000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.cred_start_backfill_internal() $$,
  '42501', null,
  'D1 a signed-in user cannot run the backfill helper');

reset role;

select * from finish();
rollback;
