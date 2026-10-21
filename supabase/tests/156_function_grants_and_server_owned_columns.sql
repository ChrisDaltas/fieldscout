-- ============================================================================
-- 156 — migration 206: two function grants re-issued; server-owned columns
--       guarded (M7 L.F2.8 G1 + G3; PROGRESS D660–D662; spec §19.3)
-- ============================================================================
-- §A  G1 — the AI quota pair: EXECUTE for service_role only (per role), and a
--     client call refused.
-- §B  The guard functions' posture: SECURITY INVOKER, search_path '', not
--     EXECUTE-able by an API role, triggers installed.
-- §C  profiles, per role: an own-profile edit lands (RETURNING count 1); a
--     change to each server-owned column is refused; anon touches nothing;
--     the follow counter (a DEFINER trigger fired by a user's follow) still
--     moves the counts; service_role and postgres may set cred.
-- §D  lists: a plain insert / edit lands; a counter on insert or edit is
--     refused; a like, a player add and duplicate_list still work.
-- §E  tags: a tag insert lands; a made-up use count is refused; tagging a
--     list still moves the count.
-- §F  start_sit_questions: post + edit land; vote totals / result refused on
--     insert and edit; service_role may resolve.
-- §G  expert_profiles: a claimed expert's edit lands; follower count and the
--     AI label refused; an expert follow still moves the count.
--
-- OWN FIXTURE: users 92060000-…-01 (A) and -02 (B); lists 92061…; tag
-- 92062…; expert 92063…; question 92064…; players pgtap-g3-p1/p2. One
-- rolled-back transaction.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(57);

-- ---------------------------------------------------------------------------
-- Fixture (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('92060000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-g3-' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'gthree_u' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

insert into players (id, full_name, position) values
  ('pgtap-g3-p1', 'PgTap G3 RB', 'RB'),
  ('pgtap-g3-p2', 'PgTap G3 WR', 'WR');

insert into lists (id, owner_id, title, slug) values
  ('92061000-0000-4000-8000-000000000001', '92060000-0000-4000-8000-000000000001', 'g3 list', 'g3-list');

insert into expert_profiles (id, slug, display_name, is_claimed, claimed_by) values
  ('92063000-0000-4000-8000-000000000001', 'g3-expert', 'G3 Expert', true, '92060000-0000-4000-8000-000000000001');

-- ===========================================================================
-- §A  G1 — function grants
-- ===========================================================================
select ok(not has_function_privilege('anon', 'public.claim_ai_generation(uuid,text,integer)', 'EXECUTE'),
  'A1 anon cannot EXECUTE claim_ai_generation');
select ok(not has_function_privilege('authenticated', 'public.claim_ai_generation(uuid,text,integer)', 'EXECUTE'),
  'A2 authenticated cannot EXECUTE claim_ai_generation');
select ok(has_function_privilege('service_role', 'public.claim_ai_generation(uuid,text,integer)', 'EXECUTE'),
  'A3 service_role can EXECUTE claim_ai_generation');
select ok(not has_function_privilege('anon', 'public.release_ai_generation(uuid,text)', 'EXECUTE'),
  'A4 anon cannot EXECUTE release_ai_generation');
select ok(not has_function_privilege('authenticated', 'public.release_ai_generation(uuid,text)', 'EXECUTE'),
  'A5 authenticated cannot EXECUTE release_ai_generation');
select ok(has_function_privilege('service_role', 'public.release_ai_generation(uuid,text)', 'EXECUTE'),
  'A6 service_role can EXECUTE release_ai_generation');
-- The literal ACL, so a PUBLIC (=X) entry cannot hide behind a role check.
select is(
  (select array_agg(p.proacl::text order by p.proname) from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('claim_ai_generation', 'release_ai_generation')),
  array['{postgres=X/postgres,service_role=X/postgres}',
        '{postgres=X/postgres,service_role=X/postgres}'],
  'A7 golden ACL literal on both: postgres + service_role only, no PUBLIC entry');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92060000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ select * from public.claim_ai_generation('92060000-0000-4000-8000-000000000002', 'list_generation', 3) $$,
  '42501', null, 'A8 a signed-in client call to claim_ai_generation is refused (permission denied)');
select throws_ok(
  $$ select public.release_ai_generation('92060000-0000-4000-8000-000000000001', 'list_generation') $$,
  '42501', null, 'A9 a signed-in client call to release_ai_generation is refused (permission denied)');
reset role;

set local role service_role;
select is(
  (select is_allowed from public.claim_ai_generation('92060000-0000-4000-8000-000000000001', 'list_generation', 3)),
  true, 'A10 the server path still claims a slot');
select is(
  public.release_ai_generation('92060000-0000-4000-8000-000000000001', 'list_generation'),
  0, 'A11 the server path still releases it');
reset role;

-- ===========================================================================
-- §B  guard posture
-- ===========================================================================
select is(
  (select count(*)::int from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname like '%server_owned_guard_internal'
       and not p.prosecdef
       and p.proconfig = array['search_path=""']),
  5, 'B1 five guard functions, all SECURITY INVOKER with search_path pinned to empty');
select is(
  (select count(*)::int from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname like '%server_owned_guard_internal'
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'B2 no guard function is EXECUTE-able by anon or authenticated');
select is(
  (select array_agg(tgrelid::regclass::text || ':' || tgname order by tgrelid::regclass::text)
     from pg_trigger where tgname like 'trg_%server_owned_guard' and not tgisinternal),
  array['expert_profiles:trg_expert_profiles_server_owned_guard',
        'lists:trg_lists_server_owned_guard',
        'profiles:trg_profiles_server_owned_guard',
        'start_sit_questions:trg_start_sit_server_owned_guard',
        'tags:trg_tags_server_owned_guard'],
  'B3 the five guard triggers are installed on their tables');

-- ===========================================================================
-- §C  profiles
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92060000-0000-4000-8000-000000000001", "role": "authenticated"}', true);

with u as (update profiles set bio = 'g3 bio', avatar_url = 'https://example.com/a.png'
                where id = '92060000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C1 an own-profile edit (bio, avatar) lands — RETURNING count 1') from u;
with u as (update profiles set bio = 'g3 bio 2', cred_score = cred_score, follower_count = follower_count
                where id = '92060000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C2 writing a server-owned column back UNCHANGED (a whole-row save) still lands') from u;
select throws_ok(
  $$ update profiles set cred_score = 999 where id = '92060000-0000-4000-8000-000000000001' $$,
  '23514', 'Cred and follower counts are managed by the system.', 'C3 own cred_score change refused');
select throws_ok(
  $$ update profiles set cred_rank = 1 where id = '92060000-0000-4000-8000-000000000001' $$,
  '23514', 'Cred and follower counts are managed by the system.', 'C4 own cred_rank change refused');
select throws_ok(
  $$ update profiles set follower_count = 5000 where id = '92060000-0000-4000-8000-000000000001' $$,
  '23514', 'Cred and follower counts are managed by the system.', 'C5 own follower_count change refused');
select throws_ok(
  $$ update profiles set following_count = 5000 where id = '92060000-0000-4000-8000-000000000001' $$,
  '23514', 'Cred and follower counts are managed by the system.', 'C6 own following_count change refused');
with u as (update profiles set cred_score = 999 where id = '92060000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 0, 'C7 another user''s row is untouched (RLS: 0 rows)') from u;
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
with u as (update profiles set cred_score = 999 returning 1)
select is(count(*)::int, 0, 'C8 anon updates no profile (RETURNING count 0)') from u;
reset role;

-- The server path: B follows A from a signed-in session; the DEFINER counter
-- trigger writes both counts.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92060000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
insert into follows (follower_id, following_id)
  values ('92060000-0000-4000-8000-000000000002', '92060000-0000-4000-8000-000000000001');
reset role;
select is(
  (select follower_count from profiles where id = '92060000-0000-4000-8000-000000000001'),
  1, 'C9 a user''s follow still raises the followed user''s follower_count (server path)');
select is(
  (select following_count from profiles where id = '92060000-0000-4000-8000-000000000002'),
  1, 'C10 …and the follower''s following_count');

set local role service_role;
with u as (update profiles set cred_score = 42, cred_rank = 3
                where id = '92060000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C11 service_role may set cred') from u;
reset role;
with u as (update profiles set cred_score = 43 where id = '92060000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C12 postgres (migrations, jobs) may set cred') from u;
select is(
  (select cred_score from profiles where id = '92060000-0000-4000-8000-000000000001'),
  43::numeric, 'C13 golden: cred is 43 — only the server writes landed');

-- ===========================================================================
-- §D  lists
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92060000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
with i as (insert into lists (id, owner_id, title, slug)
                values ('92061000-0000-4000-8000-000000000002', '92060000-0000-4000-8000-000000000001', 'g3 two', 'g3-two')
                returning 1)
select is(count(*)::int, 1, 'D1 a plain list insert lands') from i;
select throws_ok(
  $$ insert into lists (owner_id, title, slug, like_count)
       values ('92060000-0000-4000-8000-000000000001', 'g3 x', 'g3-x', 500) $$,
  '23514', 'List counts are managed by the system.', 'D2 a list inserted with a like_count is refused');
select throws_ok(
  $$ insert into lists (owner_id, title, slug, view_count)
       values ('92060000-0000-4000-8000-000000000001', 'g3 y', 'g3-y', 500) $$,
  '23514', 'List counts are managed by the system.', 'D3 a list inserted with a view_count is refused');
with u as (update lists set title = 'g3 list renamed'
                where id = '92061000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'D4 an own-list edit lands') from u;
select throws_ok(
  $$ update lists set like_count = 500 where id = '92061000-0000-4000-8000-000000000001' $$,
  '23514', 'List counts are managed by the system.', 'D5 own like_count change refused');
select throws_ok(
  $$ update lists set view_count = 500 where id = '92061000-0000-4000-8000-000000000001' $$,
  '23514', 'List counts are managed by the system.', 'D6 own view_count change refused');
select throws_ok(
  $$ update lists set player_count = 500 where id = '92061000-0000-4000-8000-000000000001' $$,
  '23514', 'List counts are managed by the system.', 'D7 own player_count change refused');
-- Server paths: the owner adds a player (DEFINER counter), duplicates the list
-- (INVOKER RPC, inserts with default counts).
insert into list_players (list_id, player_id, position)
  values ('92061000-0000-4000-8000-000000000001', 'pgtap-g3-p1', 1);
select is(
  (select player_count from lists where id = '92061000-0000-4000-8000-000000000001'),
  1, 'D8 adding a player still raises player_count (server path)');
select is(
  (select count(*)::int from duplicate_list('92061000-0000-4000-8000-000000000001', 'g3 copy', 'g3-copy')),
  1, 'D9 duplicate_list still works for the owner');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92060000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
insert into list_likes (user_id, list_id)
  values ('92060000-0000-4000-8000-000000000002', '92061000-0000-4000-8000-000000000001');
reset role;
select is(
  (select like_count from lists where id = '92061000-0000-4000-8000-000000000001'),
  1, 'D10 a user''s like still raises like_count (server path)');

set local role service_role;
with u as (update lists set view_count = 7 where id = '92061000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'D11 service_role may set a list count') from u;
reset role;

-- ===========================================================================
-- §E  tags
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92060000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
with i as (insert into tags (id, name, slug, is_system_tag, created_by)
                values ('92062000-0000-4000-8000-000000000001', 'g3tag', 'g3tag', false, '92060000-0000-4000-8000-000000000001')
                returning 1)
select is(count(*)::int, 1, 'E1 a custom tag insert lands') from i;
select throws_ok(
  $$ insert into tags (name, slug, is_system_tag, created_by, use_count)
       values ('g3tag2', 'g3tag2', false, '92060000-0000-4000-8000-000000000001', 9000) $$,
  '23514', 'Tag counts are managed by the system.', 'E2 a tag inserted with a use_count is refused');
insert into list_tags (list_id, tag_id)
  values ('92061000-0000-4000-8000-000000000001', '92062000-0000-4000-8000-000000000001');
reset role;
select is(
  (select use_count from tags where id = '92062000-0000-4000-8000-000000000001'),
  1, 'E3 tagging a list still raises use_count (server path)');
with u as (update tags set use_count = 2 where id = '92062000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'E4 postgres may set use_count') from u;

-- ===========================================================================
-- §F  start_sit_questions
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92060000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
with i as (insert into start_sit_questions (id, poster_id, player_a_id, player_b_id, season, week, voting_closes_at)
                values ('92064000-0000-4000-8000-000000000001', '92060000-0000-4000-8000-000000000001',
                        'pgtap-g3-p1', 'pgtap-g3-p2', 2026, 7, now() + interval '2 days')
                returning 1)
select is(count(*)::int, 1, 'F1 posting a question lands') from i;
select throws_ok(
  $$ insert into start_sit_questions (poster_id, player_a_id, player_b_id, season, week, voting_closes_at, vote_count_a)
       values ('92060000-0000-4000-8000-000000000001', 'pgtap-g3-p1', 'pgtap-g3-p2', 2026, 7, now() + interval '2 days', 50) $$,
  '23514', 'Votes and results are managed by the system.', 'F2 a question posted with votes is refused');
select throws_ok(
  $$ insert into start_sit_questions (poster_id, player_a_id, player_b_id, season, week, voting_closes_at, resolved_at, correct_player)
       values ('92060000-0000-4000-8000-000000000001', 'pgtap-g3-p1', 'pgtap-g3-p2', 2026, 7, now() + interval '2 days', now(), 'pgtap-g3-p1') $$,
  '23514', 'Votes and results are managed by the system.', 'F3 a question posted already resolved is refused');
with u as (update start_sit_questions set context_note = 'g3 note'
                where id = '92064000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'F4 the poster''s edit before voting closes lands') from u;
select throws_ok(
  $$ update start_sit_questions set vote_count_a = 50 where id = '92064000-0000-4000-8000-000000000001' $$,
  '23514', 'Votes and results are managed by the system.', 'F5 poster changing vote_count_a refused');
select throws_ok(
  $$ update start_sit_questions set vote_count_b = 50 where id = '92064000-0000-4000-8000-000000000001' $$,
  '23514', 'Votes and results are managed by the system.', 'F6 poster changing vote_count_b refused');
select throws_ok(
  $$ update start_sit_questions set correct_player = 'pgtap-g3-p1' where id = '92064000-0000-4000-8000-000000000001' $$,
  '23514', 'Votes and results are managed by the system.', 'F7 poster setting correct_player refused');
select throws_ok(
  $$ update start_sit_questions set resolved_at = now() where id = '92064000-0000-4000-8000-000000000001' $$,
  '23514', 'Votes and results are managed by the system.', 'F8 poster setting resolved_at refused');
select throws_ok(
  $$ update start_sit_questions set is_voided = true where id = '92064000-0000-4000-8000-000000000001' $$,
  '23514', 'Votes and results are managed by the system.', 'F9 poster setting is_voided refused');
reset role;

set local role service_role;
with u as (update start_sit_questions set resolved_at = now(), correct_player = 'pgtap-g3-p1'
                where id = '92064000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'F10 service_role may resolve a question') from u;
reset role;

-- ===========================================================================
-- §G  expert_profiles
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92060000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
with u as (update expert_profiles set bio = 'g3 expert bio'
                where id = '92063000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'G1 a claimed expert''s profile edit lands') from u;
select throws_ok(
  $$ update expert_profiles set follower_count = 9000 where id = '92063000-0000-4000-8000-000000000001' $$,
  '23514', 'Follower counts and the AI label are managed by the system.', 'G2 claimed expert changing follower_count refused');
select throws_ok(
  $$ update expert_profiles set is_ai_generated = false where id = '92063000-0000-4000-8000-000000000001' $$,
  '23514', 'Follower counts and the AI label are managed by the system.', 'G3 claimed expert clearing the AI label refused');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92060000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
insert into expert_follows (user_id, expert_id)
  values ('92060000-0000-4000-8000-000000000002', '92063000-0000-4000-8000-000000000001');
reset role;
select is(
  (select follower_count from expert_profiles where id = '92063000-0000-4000-8000-000000000001'),
  1, 'G4 a user''s expert follow still raises follower_count (server path)');

set local role service_role;
with u as (update expert_profiles set is_ai_generated = false
                where id = '92063000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'G5 service_role may change the AI label') from u;
reset role;

select * from finish();
rollback;
