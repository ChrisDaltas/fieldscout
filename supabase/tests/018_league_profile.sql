-- ============================================================================
-- League profile (rename + avatar) — migration 064 (out-of-band product
-- request, Chris 2026-08-03; server-authoritative per 054; house RPC form per
-- 038/061; storage per the 014 owner-check pattern with is_league_commish
-- standing in). pgTAP file is **018** (017 = league member management; next
-- free confirmed at task time).
--
-- Falsifiability notes (§4.3):
--   * RPC shape pins are the R70 form: SECURITY DEFINER, proconfig
--     search_path="" EXACT, anon stripped of EXECUTE while authenticated +
--     service_role keep it (in-body checks are the gate).
--   * The rename happy path pins TRIM (padded input → stored trimmed) and the
--     updated_at bump — now() is frozen inside the test transaction, so the
--     bump is proven by backdating updated_at a day (privileged, reset role)
--     and asserting the RPC pulls it back to now(). A rename is also pinned
--     to NOT touch avatar_url (counter-pin against a column-splatting write).
--   * Name bounds are golden-messaged: whitespace-only (trims to empty) and
--     101 chars both raise the EXACT field-named P0001 the route maps on,
--     with a no-write pin; the 100-char edge is pinned to SUCCEED (an
--     off-by-one gate fails the positive half).
--   * Avatar semantics: set (p_avatar_url) / keep (NULL — an unconditional
--     writer fails the counter-pin) / clear (p_clear_avatar) / precedence
--     (both passed → clear wins; from a NULL start the two outcomes diverge,
--     so a set-wins implementation fails).
--   * Authz: non-commissioner MEMBER and outsider both 42501 with the exact
--     message, no-write pinned; a nonexistent league yields the SAME 42501
--     (commish check runs first — no existence leak). Soft-deleted league →
--     P0001 not-found (membership survives the soft delete, so the commish
--     gate passes and the deleted_at probe is what refuses — 064's ordering).
--   * Storage: bucket pinned public; the four policies pinned to their
--     commands. Behavioral: anon reads (public read is real, not just a
--     policy row) but cannot INSERT (auth.uid() IS NULL); the commissioner
--     can INSERT/UPDATE/DELETE under a well-formed <league_id>/ path; a
--     malformed non-UUID first segment is refused 42501 for INSERT and for
--     UPDATE-rename (WITH CHECK inherits USING) — the shape guard fails the
--     POLICY, not the ::uuid cast (a guardless policy dies 22P02 here); a
--     non-commish member's INSERT is 42501 and their UPDATE/DELETE silently
--     match zero rows (is_empty + object-intact pin — RLS filters, it does
--     not error, on visible-but-unwritable rows).
--   * storage.protect_delete blocks ALL direct SQL deletes unless the
--     storage.allow_delete_query GUC is set; the fixture sets it txn-local so
--     the DELETE tests exercise the RLS policy, not the backstop trigger.
--   * All privileged fixture work runs BEFORE any JWT claims are set
--     (set_config persists to txn end — D49(7)); mid-test privileged
--     seeding/backdating uses `reset role` (013/014 pattern).
--   * §4.2 note: no new table (avatar_url is a column on leagues; the new
--     policies live on shared storage.objects, where policies_are cannot be
--     used without pinning other features' policies — per-policy
--     policy_cmd_is stands in).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(47);

-- ---------------------------------------------------------------------------
-- A. Shape: column, function, SECURITY DEFINER + exact search_path, ACLs.
-- ---------------------------------------------------------------------------
select has_column('public', 'leagues', 'avatar_url', 'leagues.avatar_url exists (064)');
select col_type_is('public', 'leagues', 'avatar_url', 'text', 'avatar_url is text (nullable — UI falls back to initials)');

select has_function('public', 'update_league_profile',
  array['uuid','text','text','boolean'],
  'update_league_profile(league_id, name, avatar_url, clear_avatar) exists');
select is_definer('public', 'update_league_profile',
  array['uuid','text','text','boolean'],
  'update_league_profile is SECURITY DEFINER');
select is(
  (select array_to_string(p.proconfig, ',') from pg_proc p
   where p.oid = 'public.update_league_profile(uuid,text,text,boolean)'::regprocedure),
  'search_path=""',
  'update_league_profile pins search_path='''' exactly (§12.0; R70 form)');
select ok(
  not has_function_privilege('anon',
    'public.update_league_profile(uuid,text,text,boolean)', 'EXECUTE'),
  'anon holds no EXECUTE on update_league_profile (064 REVOKE FROM PUBLIC, anon — §4.1)');
select ok(
  has_function_privilege('authenticated',
    'public.update_league_profile(uuid,text,text,boolean)', 'EXECUTE')
  and has_function_privilege('service_role',
    'public.update_league_profile(uuid,text,text,boolean)', 'EXECUTE'),
  'authenticated + service_role keep EXECUTE (in-body checks are the gate)');

-- ---------------------------------------------------------------------------
-- A2. Shape: bucket + the four storage policies (shared storage.objects —
--     per-policy pins, see header).
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select public from storage.buckets where id = 'league-avatars' $$,
  $$ values (true) $$,
  'league-avatars bucket exists and is PUBLIC (read side is anonymous-open by design)');
select policy_cmd_is('storage', 'objects', 'league-avatars public read', 'SELECT',
  'public read policy covers SELECT only');
select policy_cmd_is('storage', 'objects', 'league-avatars commish insert', 'INSERT',
  'commish insert policy covers INSERT only');
select policy_cmd_is('storage', 'objects', 'league-avatars commish update', 'UPDATE',
  'commish update policy covers UPDATE only');
select policy_cmd_is('storage', 'objects', 'league-avatars commish delete', 'DELETE',
  'commish delete policy covers DELETE only');

-- ---------------------------------------------------------------------------
-- B. Fixtures (postgres context — BEFORE any claims, D49(7)).
--    u1 = commissioner-to-be; u2 = non-commissioner MEMBER; u3 = outsider.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '99000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-lp1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lp_commish_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-lp2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lp_member_two"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'pgtap-lp3@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lp_outsider_three"}', now(), now());

-- storage.protect_delete backstop: allow direct SQL deletes for this txn so
-- the DELETE tests below hit the RLS policy, not the trigger (see header).
select set_config('storage.allow_delete_query', 'true', true);

-- ---------------------------------------------------------------------------
-- C. anon: EXECUTE revoked (behavioral half of the ACL pin).
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select throws_ok(
  $$ select update_league_profile('ea000000-0000-4000-8000-0000000000aa', 'x', null, false) $$,
  '42501', null,
  'anon cannot even EXECUTE update_league_profile (064 REVOKE)');

-- ---------------------------------------------------------------------------
-- D. u1 (authenticated commissioner): create the league, then profile writes.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

create temp table _cl as
select public.create_league(
  'pgtap-league-profile', 2026, 12,
  '{"divisions": 1, "median_game": false}'::jsonb,
  '{"starting_slots": [{"key": "qb", "label": "QB", "eligible": ["QB"], "count": 1}], "bench": 6, "ir_slots": [], "swap_spots": 0}'::jsonb,
  (select id from public.scoring_systems where is_template and name = 'ESPN Standard'),
  'Profile Crushers',
  'ad180000-0000-4000-8000-000000000001',
  'redraft', 14, 6, 15, 'faab', 100, 'commissioner', null, 'per_player_kickoff'
) as r;

-- Privileged: seat u2 as a plain manager (the non-commish member negative)
-- and backdate updated_at so the bump is provable inside one transaction.
reset role;
-- anon reads _cl in section F's fixtures — without this grant the anon
-- INSERT negative would "pass" on temp-table ACLs (42501 too), not the policy.
grant select on _cl to anon;
insert into league_members (league_id, user_id, role)
values ((select (r->>'league_id')::uuid from _cl),
        '99000000-0000-4000-8000-000000000002', 'manager');
update leagues set updated_at = now() - interval '1 day'
where id = (select (r->>'league_id')::uuid from _cl);
set local role authenticated;

-- 1. Rename happy path: padded input → trimmed store, updated_at bumped,
--    avatar untouched.
select lives_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), '  Crest & Banner League  ') $$,
  'the commissioner renames the league');
select is(
  (select name from leagues where id = (select (r->>'league_id')::uuid from _cl)),
  'Crest & Banner League',
  'name stored TRIMMED (btrim before the bounds check and the write)');
select ok(
  (select updated_at from leagues where id = (select (r->>'league_id')::uuid from _cl)) = now(),
  'updated_at bumped to now() (backdated a day pre-call — a no-bump writer fails)');
select ok(
  (select avatar_url from leagues where id = (select (r->>'league_id')::uuid from _cl)) is null,
  'a pure rename leaves avatar_url untouched (counter-pin)');

-- 2. Name bounds: golden field-named message both sides, no-write pin,
--    100-char edge succeeds.
select throws_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), '   ') $$,
  'P0001',
  'name: League name must be between 1 and 100 characters',
  'whitespace-only name trims to empty and is refused with the exact field-named message');
select throws_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), repeat('x', 101)) $$,
  'P0001',
  'name: League name must be between 1 and 100 characters',
  '101-char name refused with the same field-named message');
select is(
  (select name from leagues where id = (select (r->>'league_id')::uuid from _cl)),
  'Crest & Banner League',
  'NO write on either refused rename (name unchanged)');
select lives_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), repeat('y', 100)) $$,
  'a name of EXACTLY 100 characters is accepted (inclusive upper bound)');
select is(
  (select length(name) from leagues where id = (select (r->>'league_id')::uuid from _cl)),
  100,
  'the 100-char name landed');

-- 3. Avatar semantics: set / keep-on-NULL / clear / clear-wins precedence.
select lives_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), null,
       'https://cdn.fieldscout.local/league-avatars/pgtap-a.png', false) $$,
  'the commissioner sets the avatar (p_avatar_url)');
select is(
  (select avatar_url from leagues where id = (select (r->>'league_id')::uuid from _cl)),
  'https://cdn.fieldscout.local/league-avatars/pgtap-a.png',
  'avatar_url stored as passed');
select lives_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl)) $$,
  'an all-defaults call is a no-op, not an error');
select is(
  (select avatar_url from leagues where id = (select (r->>'league_id')::uuid from _cl)),
  'https://cdn.fieldscout.local/league-avatars/pgtap-a.png',
  'p_avatar_url NULL KEEPS the current avatar (counter-pin — an unconditional writer nulls it)');
select lives_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), null, null, true) $$,
  'the commissioner clears the avatar (p_clear_avatar)');
select ok(
  (select avatar_url from leagues where id = (select (r->>'league_id')::uuid from _cl)) is null,
  'avatar_url cleared to NULL');
select lives_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), null,
       'https://cdn.fieldscout.local/league-avatars/pgtap-b.png', true) $$,
  'both p_avatar_url and p_clear_avatar passed together');
select ok(
  (select avatar_url from leagues where id = (select (r->>'league_id')::uuid from _cl)) is null,
  'CLEAR wins over set when both are passed (starting from NULL, the outcomes diverge — a set-wins branch fails)');

-- ---------------------------------------------------------------------------
-- E. u2 (member, NOT commish) and u3 (outsider): 42501; no existence leak.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), 'Coup Attempt') $$,
  '42501',
  'update_league_profile: commissioner only',
  'a non-commissioner MEMBER cannot touch the profile (42501, exact message)');
select is(
  (select length(name) from leagues where id = (select (r->>'league_id')::uuid from _cl)),
  100,
  'NO write on the refused member rename (name unchanged)');

select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);

select throws_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), 'Outsider Rename') $$,
  '42501',
  'update_league_profile: commissioner only',
  'an outsider is refused identically');
select throws_ok(
  $$ select public.update_league_profile(
       'ea000000-0000-4000-8000-00000000dead', 'Ghost League') $$,
  '42501',
  'update_league_profile: commissioner only',
  'nonexistent league yields the SAME 42501 — commish check first, no existence leak');

-- ---------------------------------------------------------------------------
-- F. Storage behavioral: public read; commissioner-gated writes; UUID shape
--    guard; non-commish writes filtered/refused.
-- ---------------------------------------------------------------------------
reset role;
insert into storage.objects (bucket_id, name)
values ('league-avatars',
        (select (r->>'league_id') from _cl) || '/seed.png');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'league-avatars'
     and name = (select (r->>'league_id') from _cl) || '/seed.png'),
  1,
  'anon SELECT actually sees the seeded object (public read is behavioral, not just a policy row — R7 form; pinned by name so pre-existing dev objects don''t skew the count)');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('league-avatars',
             (select (r->>'league_id') from _cl) || '/anon.png') $$,
  '42501', null,
  'anon cannot INSERT (auth.uid() IS NULL leg of the policy)');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('league-avatars',
             (select (r->>'league_id') from _cl) || '/100.png') $$,
  'the commissioner INSERTs under a well-formed <league_id>/ path');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('league-avatars', 'not-a-uuid/x.png') $$,
  '42501', null,
  'a malformed non-UUID first segment fails the POLICY (42501), not the ::uuid cast (a guardless policy dies 22P02 here)');
select lives_ok(
  $$ update storage.objects
     set name = (select (r->>'league_id') from _cl) || '/200.png'
     where bucket_id = 'league-avatars'
       and name = (select (r->>'league_id') from _cl) || '/100.png' $$,
  'the commissioner UPDATEs (rename within the league''s folder)');
select throws_ok(
  $$ update storage.objects
     set name = 'evil/x.png'
     where bucket_id = 'league-avatars'
       and name = (select (r->>'league_id') from _cl) || '/seed.png' $$,
  '42501', null,
  'renaming OUT to a malformed path is refused — WITH CHECK inherits the USING shape guard');
select lives_ok(
  $$ delete from storage.objects
     where bucket_id = 'league-avatars'
       and name = (select (r->>'league_id') from _cl) || '/200.png' $$,
  'the commissioner DELETEs (RLS policy — the protect_delete backstop is GUC-disarmed, see header)');

select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('league-avatars',
             (select (r->>'league_id') from _cl) || '/u2.png') $$,
  '42501', null,
  'a non-commish MEMBER cannot INSERT even under a well-formed path');
select is_empty(
  $$ update storage.objects
     set name = (select (r->>'league_id') from _cl) || '/hijack.png'
     where bucket_id = 'league-avatars'
       and name = (select (r->>'league_id') from _cl) || '/seed.png'
     returning 1 $$,
  'a non-commish UPDATE matches ZERO rows (RLS filters visible-but-unwritable rows; it does not error)');
select is_empty(
  $$ delete from storage.objects
     where bucket_id = 'league-avatars'
       and name = (select (r->>'league_id') from _cl) || '/seed.png'
     returning 1 $$,
  'a non-commish DELETE matches ZERO rows');
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'league-avatars'
     and name = (select (r->>'league_id') from _cl) || '/seed.png'),
  1,
  'the seed object survived both non-commish write attempts (no-write pin)');

-- ---------------------------------------------------------------------------
-- G. Soft-deleted league: not found (P0001 — membership survives, the
--    deleted_at probe refuses; 064's check ordering).
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "99000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

select lives_ok(
  $$ select public.soft_delete_league((select (r->>'league_id')::uuid from _cl)) $$,
  'the commissioner soft-deletes the league');
select throws_ok(
  $$ select public.update_league_profile(
       (select (r->>'league_id')::uuid from _cl), 'Zombie Rename') $$,
  'P0001',
  'update_league_profile: league ' || (select (r->>'league_id') from _cl) || ' not found',
  'a soft-deleted league is NOT FOUND (P0001) — the commish gate still passes, the deleted_at probe is what refuses');

select * from finish();
rollback;
