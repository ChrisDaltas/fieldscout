-- ============================================================================
-- 165 — reserved handles and where a profile picture may come from
--       (migration 215; Community launch plan C11; readiness S18, S19)
-- ============================================================================
-- What this file proves, in one rolled-back transaction:
--   §F  FORM — the two predicates and the avatar guard: INVOKER, search_path
--       '', their volatility and grants (PUBLIC none; the reserved predicate
--       anon + authenticated, the avatar predicate authenticated only, the
--       guard function neither); the avatar trigger golden (BEFORE UPDATE OF
--       avatar_url, WHEN the value changes); handle_new_user still DEFINER
--       with search_path ''; the namespace guard still on INSERT OR UPDATE.
--   §R  WHICH HANDLES — the brand anywhere (underscores out, look-alike digits),
--       the staff words alone (fs / the / official in front, team / hq / desk
--       / official behind, numbers on the end), "…_ai"; and ordinary handles
--       that merely contain a staff word, the placeholder shape, NULL and ''
--       are not reserved.
--   §S  SIGNUP — real auth.users inserts: a normal handle still gets its
--       profile and Big Board; a reserved handle in metadata (brand, staff,
--       "_ai") falls back to the id-derived placeholder and the profile is
--       still created; 076's "-ai" and placeholder fallbacks still hold; a
--       metadata picture from another site (or from storage, which has no
--       JWT at signup) is dropped, an /avatars/… one is kept.
--   §N  CLAIMING — a placeholder holder (the username screen's own write)
--       cannot pick a reserved handle (message golden) and still picks a
--       normal one; 050's two messages are unchanged; the anon branch.
--   §X  EXEMPT — the server (no role) and the service role can still set a
--       reserved handle and any picture, as before.
--   §H  HOLDERS — someone who already holds a reserved handle edits their bio
--       and picture and saves the whole row; only renaming TO another
--       reserved handle is refused.
--   §A  PICTURES — a client may set none, an /avatars/… picture, or one in
--       this project's own user-avatars storage (the JWT issuer's origin); a
--       picture from anywhere else — another host with the same path, another
--       bucket, "..", a query string, a userinfo trick, a JWT with no issuer
--       — is refused by name and the row is unchanged.
--   §U  UNCHANGED — a picture that is already outside the list (an older row)
--       never blocks a bio edit or a whole-row save; only changing it to
--       another outside picture is refused.
-- Break probes (shown in the PR, each in a rolled-back transaction): (1) the
-- guard's reserved block removed ⇒ N1–N4, N7–N9, H4, H5 red; (2)
-- handle_new_user's reserved condition removed ⇒ S2 red (and X1, H3, H5, as
-- s2 then holds @fieldscout); (3) the trigger's WHEN clause dropped ⇒ F4, U2,
-- U5 red; (3b) its OF avatar_url dropped too ⇒ also U1; (4) the storage
-- check loosened to "the path on any origin" ⇒ A5, A11 red; (5)
-- handle_new_user's picture check removed ⇒ S5 red; (6) the avatar guard's
-- client-only test removed ⇒ X2, X4, U2, U5 red.
-- World: s1–s9 sign up through auth.users; p1 is a placeholder holder who
-- picks a handle; h1 holds @fieldscout (set by the server); o1 has an older
-- picture from another site (set by the server).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(54);

create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.err(text) to anon, authenticated, service_role;

create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;
grant execute on function pg_temp.val(text) to anon, authenticated, service_role;

-- The issuer every client JWT in this file carries, and its storage prefix.
create function pg_temp.iss() returns text language sql immutable as $$ select 'http://pgtap-c11.local:54321/auth/v1' $$;
create function pg_temp.store() returns text language sql immutable as $$
  select 'http://pgtap-c11.local:54321/storage/v1/object/public/user-avatars/' $$;
grant execute on function pg_temp.iss() to anon, authenticated, service_role;
grant execute on function pg_temp.store() to anon, authenticated, service_role;

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'iss', pg_temp.iss())::text, true)
$$;
grant execute on function pg_temp.as_user(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- §F  Form
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(format('%s=%s:%s:%s', p.proname, p.prosecdef, p.provolatile, array_to_string(p.proconfig, ',')),
                     ' ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('username_is_reserved_internal', 'profile_avatar_url_allowed_internal',
                       'profiles_avatar_source_guard_internal')),
  'profile_avatar_url_allowed_internal=f:s:search_path="" profiles_avatar_source_guard_internal=f:v:search_path="" username_is_reserved_internal=f:i:search_path=""',
  'F1 the three new functions: INVOKER, search_path pinned to empty; the reserved predicate IMMUTABLE, the avatar predicate STABLE');

select is(
  (select string_agg(format('%s=%s/%s/%s', p.proname,
                            has_function_privilege('anon', p.oid, 'EXECUTE'),
                            has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                            has_function_privilege('service_role', p.oid, 'EXECUTE')), ' ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('username_is_reserved_internal', 'profile_avatar_url_allowed_internal',
                       'profiles_avatar_source_guard_internal')),
  'profile_avatar_url_allowed_internal=f/t/t profiles_avatar_source_guard_internal=f/f/t username_is_reserved_internal=t/t/t',
  'F2 EXECUTE (anon/authenticated/service_role): the reserved predicate anon + authenticated (the INVOKER guard runs as them); the avatar predicate authenticated; the guard function neither (service_role keeps the default grant, as 206''s guards do)');

select is(
  (select count(*)::int from pg_proc p, aclexplode(p.proacl) a
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('username_is_reserved_internal', 'profile_avatar_url_allowed_internal',
                       'profiles_avatar_source_guard_internal')
     and a.grantee = 0),
  0, 'F3 PUBLIC holds EXECUTE on none of them');

select is(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'trg_profiles_avatar_source_guard'),
  'CREATE TRIGGER trg_profiles_avatar_source_guard BEFORE UPDATE OF avatar_url ON public.profiles FOR EACH ROW WHEN ((old.avatar_url IS DISTINCT FROM new.avatar_url)) EXECUTE FUNCTION profiles_avatar_source_guard_internal()',
  'F4 the avatar trigger: BEFORE UPDATE OF avatar_url, only WHEN the picture changes (golden)');

select is(
  (select format('%s:%s', p.prosecdef, array_to_string(p.proconfig, ','))
   from pg_proc p where p.oid = 'public.handle_new_user()'::regprocedure),
  't:search_path=""', 'F5 handle_new_user is still SECURITY DEFINER with search_path pinned to empty (073 / 076)');

select is(
  (select pg_get_triggerdef(t.oid) from pg_trigger t
   where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'trg_guard_username_namespace'),
  'CREATE TRIGGER trg_guard_username_namespace BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_username_namespace()',
  'F6 the namespace guard still fires on every INSERT and UPDATE (050''s binding)');

-- ---------------------------------------------------------------------------
-- §R  Which handles are reserved
-- ---------------------------------------------------------------------------
select is(
  (select string_agg(u, ' ' order by u) from unnest(array[
     'fieldscout', 'field_scout', 'fieldsc0ut', 'fie1dscout', 'f1eldscout', 'fi3ldscout',
     'the_fieldscout', 'fieldscout_gg', 'fieldscout_support', 'myfieldscout']) u
   where not public.username_is_reserved_internal(u)),
  null, 'R1 the brand anywhere in the handle, underscores out and look-alike digits read as letters');

select is(
  (select string_agg(u, ' ' order by u) from unnest(array[
     'admin', 'admins', 'administrator', 'sysadmin', 'root1', 'system', 'support', 'help1', 'helpdesk',
     'moderator', 'moderators', 'mod12', 'mods1', 'staff', 'official', 'team1', 'security', 'abuse',
     'legal', 'privacy', 'billing', 'api12', 'www12', 'noreply', 'webmaster', 'postmaster']) u
   where not public.username_is_reserved_internal(u)),
  null, 'R2 every staff / system word on its own (the short ones with the number a 5-character handle needs)');

select is(
  (select string_agg(u, ' ' order by u) from unnest(array[
     'fs_admin', 'fsadmin', 'the_admin', 'official_mods', 'support_team', 'admin_hq', 'help_desk',
     'staff_official', 'moderator_01', 'admin2026', 'adm1n', '5upport', 'm0ds1', 'ADMIN']) u
   where not public.username_is_reserved_internal(u)),
  null, 'R3 …with fs / the / official in front, team / hq / desk / official behind, numbers on the end, look-alike digits, any case');

select is(
  (select string_agg(u, ' ' order by u) from unnest(array['kina_mimes_ai', 'scout_ai', 'x_y_ai']) u
   where not public.username_is_reserved_internal(u)),
  null, 'R4 the AI-account shape written with underscores (…_ai)');

select is(
  (select string_agg(u, ' ' order by u) from unnest(array[
     'chris_d', 'joetheman', 'seed_owner', 'dev_user', 'devpro', 'adminbob', 'admin_bob', 'teamtacos',
     'team_tacos', 'helper', 'modern', 'apiary', 'rooted', 'systemic', 'legally', 'official_bob',
     'mods_r_us', 'scout_master', 'field_day', 'scouting', 'aimee', 'ai_fan', 'chai_lover', 'zz_ai_zz',
     'user_deadbeef', 'user_2c6f328e']) u
   where public.username_is_reserved_internal(u)),
  null, 'R5 ordinary handles are not reserved — a staff word inside a longer name, "ai" not at the end after "_", the placeholder shape');

select is(
  format('%s/%s', public.username_is_reserved_internal(null), public.username_is_reserved_internal('')),
  'f/f', 'R6 NULL and empty are not reserved (the CHECK refuses those on its own)');


-- ---------------------------------------------------------------------------
-- §S  Signup (real auth.users inserts drive handle_new_user)
-- ---------------------------------------------------------------------------
-- Each id starts with its own 8 hex digits, so each fallback placeholder
-- (user_<first 8>) is distinct.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', v.id::uuid, 'authenticated', 'authenticated',
       'pgtap-c11-' || v.n || '@fieldscout.local', 'x', now(),
       '{"provider": "email", "providers": ["email"]}', v.meta::jsonb, now(), now()
from (values
  ('s1', 'c1150001-0000-4000-8000-000000000000', '{"username": "c11_normal"}'),
  ('s2', 'c1150002-0000-4000-8000-000000000000', '{"username": "fieldscout"}'),
  ('s3', 'c1150003-0000-4000-8000-000000000000', '{"username": "support_team"}'),
  ('s4', 'c1150004-0000-4000-8000-000000000000', '{"username": "kina_mimes_ai"}'),
  ('s5', 'c1150005-0000-4000-8000-000000000000', '{"username": "evil-ai"}'),
  ('s6', 'c1150006-0000-4000-8000-000000000000', '{"username": "user_deadbeef"}'),
  ('s7', 'c1150007-0000-4000-8000-000000000000', '{"username": "c11_pic_evil", "avatar_url": "https://evil.example/me.png"}'),
  ('s8', 'c1150008-0000-4000-8000-000000000000', '{"username": "c11_pic_store", "avatar_url": "http://pgtap-c11.local:54321/storage/v1/object/public/user-avatars/c1150008-0000-4000-8000-000000000000/1.png"}'),
  ('s9', 'c1150009-0000-4000-8000-000000000000', '{"username": "c11_pic_ours", "avatar_url": "/avatars/personas/kina-mimes-ai.svg"}'),
  ('p1', 'c11500a1-0000-4000-8000-000000000000', '{}'),
  ('h1', 'c11500b1-0000-4000-8000-000000000000', '{"username": "c11_holder"}'),
  ('o1', 'c11500c1-0000-4000-8000-000000000000', '{"username": "c11_older"}')
) v(n, id, meta);

select is(
  (select format('%s:%s:%s', p.username, coalesce(p.avatar_url, '<null>'),
                 (select count(*) from lists l where l.owner_id = p.id and l.is_big_board))
   from profiles p where p.id = 'c1150001-0000-4000-8000-000000000000'),
  'c11_normal:<null>:1', 'S1 a normal handle in signup metadata: the profile is created with it, and the Big Board too');

select is(
  (select string_agg(p.username, ' ' order by p.id) from profiles p
   where p.id in ('c1150002-0000-4000-8000-000000000000', 'c1150003-0000-4000-8000-000000000000',
                  'c1150004-0000-4000-8000-000000000000')),
  'user_c1150002 user_c1150003 user_c1150004',
  'S2 reserved handles in signup metadata (brand "fieldscout", staff "support_team", "kina_mimes_ai") fall back to the id-derived placeholder');

select is(
  (select string_agg(p.username, ' ' order by p.id) from profiles p
   where p.id in ('c1150005-0000-4000-8000-000000000000', 'c1150006-0000-4000-8000-000000000000')),
  'user_c1150005 user_c1150006',
  'S3 076''s own fallbacks still hold: "evil-ai" and "user_deadbeef" in metadata get the placeholder too (no 076 guard lost)');

select is(
  (select count(*)::int from auth.users u
   where u.email like 'pgtap-c11-%@fieldscout.local'
     and exists (select 1 from profiles p where p.id = u.id)
     and exists (select 1 from lists l where l.owner_id = u.id and l.is_big_board)),
  12, 'S4 signup never fails over it: all twelve signups have a profile and a Big Board');

select is(
  (select string_agg(format('%s=%s', p.username, coalesce(p.avatar_url, '<null>')), ' ' order by p.id) from profiles p
   where p.id in ('c1150007-0000-4000-8000-000000000000', 'c1150008-0000-4000-8000-000000000000',
                  'c1150009-0000-4000-8000-000000000000')),
  'c11_pic_evil=<null> c11_pic_store=<null> c11_pic_ours=/avatars/personas/kina-mimes-ai.svg',
  'S5 a signup picture from another site is dropped; a storage one too (no JWT at signup, so no "own storage" to match); an /avatars/… one is kept');

select is(
  (select format('%s:%s', p.username, coalesce(p.avatar_url, '<null>')) from profiles p
   where p.id = 'c11500a1-0000-4000-8000-000000000000'),
  'user_c11500a1:<null>', 'S6 no metadata: the placeholder, no picture (unchanged)');

-- ---------------------------------------------------------------------------
-- The server sets up two older rows: h1 holds @fieldscout, o1 has a picture
-- from another site. (Running as postgres with no JWT — the exempt server.)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
select is(
  pg_temp.err($$update profiles set username = 'fieldscout' where id = 'c11500b1-0000-4000-8000-000000000000'$$),
  'no error', 'X1 the server (no role: migrations, psql, scripts) can still give a reserved handle');
select is(
  pg_temp.err($$update profiles set avatar_url = 'https://old.example/pic.png' where id = 'c11500c1-0000-4000-8000-000000000000'$$),
  'no error', 'X2 …and can still set any picture (an older row this file then edits as its owner)');

set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(
  pg_temp.err($$update profiles set username = 'support_desk' where id = 'c1150004-0000-4000-8000-000000000000'$$),
  'no error', 'X3 the service role is exempt as before: it can give a reserved handle (the expert-accounts script''s door)');
select is(
  pg_temp.err($$update profiles set avatar_url = 'https://cdn.example/expert.png' where id = 'c1150004-0000-4000-8000-000000000000'$$),
  'no error', 'X4 …and set any picture');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- §N  Claiming a handle (the username screen's own write, as p1)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('c11500a1-0000-4000-8000-000000000000');

select is(
  pg_temp.err($$update profiles set username = 'fieldscout'
               where id = 'c11500a1-0000-4000-8000-000000000000' and username ~ '^user_[0-9a-f]{8}$'$$),
  '23514: This username is reserved.', 'N1 a placeholder holder cannot pick @fieldscout (message golden — the username screen shows it as is)');
select is(
  pg_temp.err($$update profiles set username = 'fs_admin2'
               where id = 'c11500a1-0000-4000-8000-000000000000' and username ~ '^user_[0-9a-f]{8}$'$$),
  '23514: This username is reserved.', 'N2 …nor fs_admin2');
select is(
  pg_temp.err($$update profiles set username = 'the_moderators'
               where id = 'c11500a1-0000-4000-8000-000000000000' and username ~ '^user_[0-9a-f]{8}$'$$),
  '23514: This username is reserved.', 'N3 …nor the_moderators');
select is(
  pg_temp.err($$update profiles set username = 'scout_ai'
               where id = 'c11500a1-0000-4000-8000-000000000000' and username ~ '^user_[0-9a-f]{8}$'$$),
  '23514: This username is reserved.', 'N4 …nor scout_ai');
select is(
  pg_temp.err($$update profiles set username = 'evil-ai' where id = 'c11500a1-0000-4000-8000-000000000000'$$),
  '23514: "-ai" usernames are reserved for FieldScout AI accounts.', 'N5 050''s "-ai" block and message are unchanged');
select is(
  pg_temp.err($$update profiles set username = 'user_deadbeef' where id = 'c11500a1-0000-4000-8000-000000000000'$$),
  '23514: This username format is reserved.', 'N6 050''s placeholder block and message are unchanged');
select is(
  (select username from profiles where id = 'c11500a1-0000-4000-8000-000000000000'),
  'user_c11500a1', 'N7 every refused pick left the placeholder in place');
select is(
  pg_temp.val($$with w as (update profiles set username = 'c11_chosen'
                           where id = 'c11500a1-0000-4000-8000-000000000000' and username ~ '^user_[0-9a-f]{8}$'
                           returning 1) select count(*) from w$$),
  '1', 'N8 …and a normal handle still lands (onboarding works)');
reset role;

-- The guard's anon branch: postgres with anon claims (a plain `set role anon`
-- write is RLS-filtered before the trigger runs — 005 R34).
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  pg_temp.err($$update profiles set username = 'admin_team' where id = 'c1150001-0000-4000-8000-000000000000'$$),
  '23514: This username is reserved.', 'N9 the anon branch refuses a reserved handle too');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- §H  Someone who already holds a reserved handle (h1 = @fieldscout)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user('c11500b1-0000-4000-8000-000000000000');

select is(
  pg_temp.val($$with w as (update profiles set bio = 'Still me.' where id = 'c11500b1-0000-4000-8000-000000000000' returning 1)
               select count(*) from w$$),
  '1', 'H1 the holder edits their bio');
select is(
  pg_temp.val(format($$with w as (update profiles set avatar_url = %L where id = 'c11500b1-0000-4000-8000-000000000000' returning 1)
                      select count(*) from w$$, pg_temp.store() || 'c11500b1-0000-4000-8000-000000000000/1730000000000.png')),
  '1', 'H2 …and their picture (own storage)');
select is(
  pg_temp.val($$with w as (update profiles set username = 'fieldscout', bio = 'Whole-row save.', avatar_url = avatar_url
                           where id = 'c11500b1-0000-4000-8000-000000000000' returning 1)
               select count(*) from w$$),
  '1', 'H3 …and saves the whole row (handle written back unchanged)');
select is(
  pg_temp.err($$update profiles set username = 'fieldscout_hq' where id = 'c11500b1-0000-4000-8000-000000000000'$$),
  '23514: This username is reserved.', 'H4 only renaming TO another reserved handle is refused');
select is(
  (select format('%s|%s|%s', username, bio, avatar_url) from profiles where id = 'c11500b1-0000-4000-8000-000000000000'),
  'fieldscout|Whole-row save.|' || pg_temp.store() || 'c11500b1-0000-4000-8000-000000000000/1730000000000.png',
  'H5 the holder keeps @fieldscout, with the edits that landed');

-- ---------------------------------------------------------------------------
-- §A  Setting a picture (s1, a client)
-- ---------------------------------------------------------------------------
select pg_temp.as_user('c1150001-0000-4000-8000-000000000000');

select is(
  pg_temp.err($$update profiles set avatar_url = 'https://evil.example/me.png' where id = 'c1150001-0000-4000-8000-000000000000'$$),
  '23514: Profile pictures have to be uploaded to FieldScout.', 'A1 a picture from another site is refused (message golden)');
select is(
  pg_temp.val(format($$with w as (update profiles set avatar_url = %L where id = 'c1150001-0000-4000-8000-000000000000' returning avatar_url)
                      select avatar_url from w$$, pg_temp.store() || 'c1150001-0000-4000-8000-000000000000/1730000000001.jpg')),
  pg_temp.store() || 'c1150001-0000-4000-8000-000000000000/1730000000001.jpg',
  'A2 a picture in this project''s own user-avatars storage lands (what /api/profile/avatar stores)');
select is(
  pg_temp.val($$with w as (update profiles set avatar_url = '/avatars/personas/kina-mimes-ai.svg' where id = 'c1150001-0000-4000-8000-000000000000' returning avatar_url)
               select avatar_url from w$$),
  '/avatars/personas/kina-mimes-ai.svg', 'A3 one of the app''s own /avatars/… pictures lands');
select is(
  pg_temp.val($$with w as (update profiles set avatar_url = null where id = 'c1150001-0000-4000-8000-000000000000' returning coalesce(avatar_url, '<none>'))
               select * from w$$),
  '<none>', 'A4 removing the picture (NULL) lands');
select is(
  pg_temp.val($$with w as (update profiles set avatar_url = '' where id = 'c1150001-0000-4000-8000-000000000000' returning 1)
               select count(*) from w$$),
  '1', 'A4b an empty picture lands too');

select is(
  (select string_agg(r, ' | ' order by r) from (
     select pg_temp.err(format($$update profiles set avatar_url = %L where id = 'c1150001-0000-4000-8000-000000000000'$$, u)) r
     from unnest(array[
       'https://evil.example/storage/v1/object/public/user-avatars/c1150001-0000-4000-8000-000000000000/1.png',
       'http://pgtap-c11.local:54321@evil.example/storage/v1/object/public/user-avatars/c1/1.png',
       'http://pgtap-c11.local:543219/storage/v1/object/public/user-avatars/c1/1.png',
       'https://pgtap-c11.local:54321/storage/v1/object/public/user-avatars/c1/1.png']) u) x),
  '23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout.',
  'A5 the storage path on any other origin is refused — another host, a userinfo trick, another port, another scheme');
select is(
  (select string_agg(r, ' | ' order by r) from (
     select pg_temp.err(format($$update profiles set avatar_url = %L where id = 'c1150001-0000-4000-8000-000000000000'$$, pg_temp.store() || u)) r
     from unnest(array['c1/../../x.png', 'c1/1.png?x=1', 'c1/1.png#x', 'c1%2F..%2F1.png', 'c1/1.svg', 'c1/1', '']) u) x),
  '23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout.',
  'A6 inside our storage: "..", a query string, a fragment, percent-escapes, a non-image file, no extension, no file — all refused');
select is(
  pg_temp.err($$update profiles set avatar_url = 'http://pgtap-c11.local:54321/storage/v1/object/public/list-thumbnails/c1/1.png'
               where id = 'c1150001-0000-4000-8000-000000000000'$$),
  '23514: Profile pictures have to be uploaded to FieldScout.', 'A7 another bucket of ours is refused (pictures live in user-avatars)');
select is(
  (select string_agg(r, ' | ' order by r) from (
     select pg_temp.err(format($$update profiles set avatar_url = %L where id = 'c1150001-0000-4000-8000-000000000000'$$, u)) r
     from unnest(array['/avatars/../secret.png', '//evil.example/avatars/a.png', '/avatars//evil.example/a.png',
                       '/avatars/a.png?x=1', '/other/a.png', 'avatars/a.png']) u) x),
  '23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout. | 23514: Profile pictures have to be uploaded to FieldScout.',
  'A8 the /avatars/… branch: "..", protocol-relative, a double slash, a query string, another folder, no leading slash — all refused');

select set_config('request.jwt.claims',
  '{"sub": "c1150001-0000-4000-8000-000000000000", "role": "authenticated"}', true);
select is(
  pg_temp.err(format($$update profiles set avatar_url = %L where id = 'c1150001-0000-4000-8000-000000000000'$$,
                     pg_temp.store() || 'c1150001-0000-4000-8000-000000000000/2.png')),
  '23514: Profile pictures have to be uploaded to FieldScout.', 'A9 a JWT with no issuer allows no storage picture (fails closed)');
select set_config('request.jwt.claims',
  '{"sub": "c1150001-0000-4000-8000-000000000000", "role": "authenticated", "iss": "https://evil.example/x/auth/v1"}', true);
select is(
  pg_temp.err($$update profiles set avatar_url = 'https://evil.example/x/storage/v1/object/public/user-avatars/c1/1.png'
               where id = 'c1150001-0000-4000-8000-000000000000'$$),
  '23514: Profile pictures have to be uploaded to FieldScout.', 'A10 an issuer that is not a plain <origin>/auth/v1 allows nothing');

select pg_temp.as_user('c1150001-0000-4000-8000-000000000000');
select is(
  (select coalesce(avatar_url, '<null>') from profiles where id = 'c1150001-0000-4000-8000-000000000000'),
  '', 'A11 every refused change left the row as it was (the empty picture from A4b)');

-- ---------------------------------------------------------------------------
-- §U  An older picture from another site (o1) never blocks other edits
-- ---------------------------------------------------------------------------
select pg_temp.as_user('c11500c1-0000-4000-8000-000000000000');

select is(
  pg_temp.val($$with w as (update profiles set bio = 'Older picture, new bio.' where id = 'c11500c1-0000-4000-8000-000000000000' returning 1)
               select count(*) from w$$),
  '1', 'U1 a bio edit lands although the picture is from another site');
select is(
  pg_temp.val($$with w as (update profiles set bio = 'Whole row.', avatar_url = 'https://old.example/pic.png', username = username
                           where id = 'c11500c1-0000-4000-8000-000000000000' returning 1)
               select count(*) from w$$),
  '1', 'U2 a whole-row save writing the same older picture back lands (unchanged = never checked)');
select is(
  pg_temp.err($$update profiles set avatar_url = 'https://old.example/other.png' where id = 'c11500c1-0000-4000-8000-000000000000'$$),
  '23514: Profile pictures have to be uploaded to FieldScout.', 'U3 changing it to another outside picture is refused');
select is(
  pg_temp.val($$with w as (update profiles set avatar_url = null where id = 'c11500c1-0000-4000-8000-000000000000' returning 1)
               select count(*) from w$$),
  '1', 'U4 removing the older picture lands');
select is(
  (select format('%s|%s', bio, coalesce(avatar_url, '<null>')) from profiles where id = 'c11500c1-0000-4000-8000-000000000000'),
  'Whole row.|<null>', 'U5 the row holds exactly the edits that landed');

-- Someone else's row is still RLS-filtered before any guard runs.
select is(
  pg_temp.val($$with w as (update profiles set avatar_url = '/avatars/a.png' where id = 'c1150001-0000-4000-8000-000000000000' returning 1)
               select count(*) from w$$),
  '0', 'U6 another person''s picture still can''t be changed at all (RLS, 001)');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
