-- ============================================================================
-- notify_list_followers authorization — review finding R5 (migration 038).
--
-- The function is SECURITY DEFINER (RLS does not gate it), so the security
-- surface is exactly: anon has no EXECUTE, and the in-body check rejects any
-- p_actor that is not the authenticated caller. Both halves proven here —
-- grant-surface assertions plus behavioral denials under the API roles.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(6);

-- Grant surface (038's deliberate narrowing of the 037 model).
select ok(
  not has_function_privilege('anon', 'public.notify_list_followers(uuid, uuid)', 'EXECUTE'),
  'anon holds no EXECUTE on notify_list_followers (038 REVOKE)'
);
select ok(
  has_function_privilege('authenticated', 'public.notify_list_followers(uuid, uuid)', 'EXECUTE'),
  'authenticated keeps EXECUTE (in-body check is the gate)'
);

-- Behavioral: anon execution is denied outright.
set local role anon;
select throws_ok(
  $$ select public.notify_list_followers(
       '22222222-2222-2222-2222-222222222222'::uuid,
       '33333333-3333-3333-3333-333333333333'::uuid) $$,
  '42501',
  null,
  'anon cannot execute notify_list_followers'
);
reset role;

-- Behavioral: authenticated caller cannot attribute to another user.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}',
  true);

select throws_ok(
  $$ select public.notify_list_followers(
       '22222222-2222-2222-2222-222222222222'::uuid,
       '33333333-3333-3333-3333-333333333333'::uuid) $$,
  '42501',
  null,
  'spoofed p_actor (not auth.uid()) is denied in-body'
);
select throws_ok(
  $$ select public.notify_list_followers(
       '22222222-2222-2222-2222-222222222222'::uuid,
       null) $$,
  '42501',
  null,
  'null p_actor is denied in-body'
);

-- RE-CUT BY 210 (M7 L.F2.8, F714): caller-as-actor passes the actor check,
-- but the list must also be the caller's own — a list id that matches nothing
-- is refused with the ownership words (no silent no-op, no existence oracle).
-- pgTAP 160 §A proves the owner's call lands on a real list.
select throws_ok(
  $$ select public.notify_list_followers(
       '22222222-2222-2222-2222-222222222222'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid) $$,
  '42501',
  'notify_list_followers: only the list''s owner may notify its followers',
  'p_actor = auth.uid() passes the actor check, and a list he does not own is refused (210)'
);
reset role;

select * from finish();

rollback;
