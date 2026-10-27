-- ============================================================================
-- pgTAP 160 — migration 210, the remaining L.F2.7 hardening (M7 L.F2.8;
-- PROGRESS D730–D739; ledger F714, F715, F718, F719, F720, F723, F724, F777,
-- F793). FULL rigour: per-role cells, RETURNING counts on every write, golden
-- literals.
--
--   §A  F714 — notify_list_followers: only the owner (or the server naming
--        the owner) notifies a list's followers
--   §B  F719 — the eleven legacy definers pin search_path = '' and still work
--   §C  F719 — the three member reads refuse a caller with no uid
--   §D  F720 — profiles: two columns out of public reads
--   §E  F715 — the four public buckets: 5 MiB, images only
--   §F  F723 — the webhook helper is not EXECUTE-able by the API roles
--   §G  F724 — active_game_window runs as its caller; the matview's filter
--   §H  F777 — expert_profiles' disclaimer and claim date
--   §I  F793 — a league scoring row's label follows the sitting commissioner
--   §J  F718 — THE HOUSE SWEEP: RLS on every public table, search_path = ''
--        on every public SECURITY DEFINER, the anon-EXECUTE allowlist, and
--        security_invoker on every public view
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
reset role;

select plan(82);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, 'x', now(), '{"provider": "email", "providers": ["email"]}',
       jsonb_build_object('username', u.username), now(), now()
from (values
  ('91600000-0000-4000-8000-000000000001'::uuid, 'x160-owner@fieldscout.local',      'x160_owner'),
  ('91600000-0000-4000-8000-000000000002'::uuid, 'x160-stranger@fieldscout.local',   'x160_stranger'),
  ('91600000-0000-4000-8000-000000000003'::uuid, 'x160-follower@fieldscout.local',   'x160_follower'),
  ('91600000-0000-4000-8000-000000000004'::uuid, 'x160-admin@fieldscout.local',      'x160_admin'),
  ('91600000-0000-4000-8000-000000000005'::uuid, 'x160-commish@fieldscout.local',    'x160_commish'),
  ('91600000-0000-4000-8000-000000000006'::uuid, 'x160-newcommish@fieldscout.local', 'x160_newcommish'),
  ('91600000-0000-4000-8000-000000000007'::uuid, 'x160-expert@fieldscout.local',     'x160_expert')
) as u(id, email, username);

update profiles set is_admin = true where id = '91600000-0000-4000-8000-000000000004';

insert into lists (id, owner_id, title, slug, is_private, deleted_at) values
  ('91601000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000001', 'X160 Board', 'x160-board', false, null),
  ('91601000-0000-4000-8000-000000000002', '91600000-0000-4000-8000-000000000001', 'X160 Gone',  'x160-gone',  false, now());
insert into list_favorites (user_id, list_id) values
  ('91600000-0000-4000-8000-000000000003', '91601000-0000-4000-8000-000000000001');

insert into players (id, full_name, position) values ('pgtap-x160-p1', 'X160 Player', 'WR');
insert into list_players (list_id, player_id, position) values
  ('91601000-0000-4000-8000-000000000001', 'pgtap-x160-p1', 1);

insert into expert_profiles (id, slug, display_name, is_claimed, claimed_by, claimed_at, is_ai_generated)
values ('91603000-0000-4000-8000-000000000001', 'x160-expert', 'X160 Expert', true,
        '91600000-0000-4000-8000-000000000007', '2026-10-01 12:00:00+00', true);

insert into scoring_systems (id, name, owner_id, is_template, rules) values
  ('91604000-0000-4000-8000-000000000001', 'x160 league scoring', '91600000-0000-4000-8000-000000000005', false,
   '{"pass_yards": 0.04, "receptions": 1}'::jsonb),
  ('91604000-0000-4000-8000-000000000002', 'x160 personal scoring', '91600000-0000-4000-8000-000000000005', false,
   '{"pass_yards": 0.04, "receptions": 1}'::jsonb);
insert into leagues (id, owner_id, name, season, status, team_count, scoring_system_id, settings) values
  ('91605000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000005', 'x160 League', 2026, 'setup', 8,
   '91604000-0000-4000-8000-000000000001', '{}'::jsonb);
insert into league_members (league_id, user_id, role) values
  ('91605000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000005', 'commissioner'),
  ('91605000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000006', 'manager');

-- ===========================================================================
-- §A  F714 — notify_list_followers
-- ===========================================================================
select ok(not has_function_privilege('anon', 'public.notify_list_followers(uuid, uuid)', 'EXECUTE'),
  'A1 anon holds no EXECUTE on notify_list_followers (038, kept by 210)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.notify_list_followers('91601000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000002') $$,
  '42501', 'notify_list_followers: only the list''s owner may notify its followers',
  'A2 a signed-in stranger cannot notify the followers of a list he does not own');
select throws_ok(
  $$ select public.notify_list_followers('91601000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000001') $$,
  '42501', 'notify_list_followers: p_actor must be the authenticated caller',
  'A3 …nor by naming the owner as the actor');
reset role;
select is((select count(*)::int from notifications where user_id = '91600000-0000-4000-8000-000000000003'), 0,
  'A4 the refused calls wrote no bell entry for the follower');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.notify_list_followers('91601000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000001') $$,
  'A5 the owner notifies his own list''s followers');
select throws_ok(
  $$ select public.notify_list_followers('91601000-0000-4000-8000-000000000002', '91600000-0000-4000-8000-000000000001') $$,
  '42501', 'notify_list_followers: only the list''s owner may notify its followers',
  'A6 a deleted list is refused with the same words');
select throws_ok(
  $$ select public.notify_list_followers('91601000-0000-4000-8000-0000000000ff', '91600000-0000-4000-8000-000000000001') $$,
  '42501', 'notify_list_followers: only the list''s owner may notify its followers',
  'A7 a list that does not exist is refused with the same words (no existence oracle)');
reset role;
select is(
  (select string_agg(title, ' | ') from notifications
    where user_id = '91600000-0000-4000-8000-000000000003' and type = 'list_updated'),
  '@x160_owner updated X160 Board',
  'A8 the follower holds exactly one bell entry, attributed to the owner (golden)');

set local role service_role;
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$ select public.notify_list_followers('91601000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000001') $$,
  'A9 the server may notify, naming the owner');
select throws_ok(
  $$ select public.notify_list_followers('91601000-0000-4000-8000-000000000001', '91600000-0000-4000-8000-000000000002') $$,
  '42501', 'notify_list_followers: only the list''s owner may notify its followers',
  'A10 …but even the server cannot attribute it to someone who does not own the list');
reset role;
select is((select count(*)::int from notifications where user_id = '91600000-0000-4000-8000-000000000003'), 1,
  'A11 the server''s call refreshed the one unread entry (still one)');

-- ===========================================================================
-- §B  F719 — the eleven legacy definers
-- ===========================================================================
select is(
  (select string_agg(p.proname || '=' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ','), ' | ' order by p.proname)
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('enforce_free_list_caps', 'guard_lists_ai_persona', 'guard_profile_admin_column',
                        'guard_profile_billing_columns', 'notify_list_followers', 'reorder_list_players',
                        'update_expert_follower_count', 'update_follow_counts', 'update_list_like_count',
                        'update_list_player_count', 'update_tag_use_count')),
  'enforce_free_list_caps=true:search_path="" | guard_lists_ai_persona=true:search_path="" | guard_profile_admin_column=true:search_path="" | guard_profile_billing_columns=true:search_path="" | notify_list_followers=true:search_path="" | reorder_list_players=true:search_path="" | update_expert_follower_count=true:search_path="" | update_follow_counts=true:search_path="" | update_list_like_count=true:search_path="" | update_list_player_count=true:search_path="" | update_tag_use_count=true:search_path=""',
  'B1 all eleven stay SECURITY DEFINER and now pin search_path = '''' (golden)');
select is(
  (select array_agg(p.proacl::text order by p.proname) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('notify_list_followers', 'reorder_list_players')),
  array['{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}',
        '{postgres=X/postgres,authenticated=X/postgres,anon=X/postgres,service_role=X/postgres}'],
  'B2 CREATE OR REPLACE kept both ACLs (golden literal)');

-- The counters still move from a user's own request (DEFINER, owned by postgres).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
with u as (insert into follows (follower_id, following_id)
           values ('91600000-0000-4000-8000-000000000002', '91600000-0000-4000-8000-000000000001') returning 1)
select is(count(*)::int, 1, 'B3 a user''s follow lands (RETURNING 1)') from u;
with u as (insert into list_likes (user_id, list_id)
           values ('91600000-0000-4000-8000-000000000002', '91601000-0000-4000-8000-000000000001') returning 1)
select is(count(*)::int, 1, 'B4 a user''s like lands (RETURNING 1)') from u;
reset role;
select is(
  (select format('%s/%s/%s', (select follower_count from profiles where id = '91600000-0000-4000-8000-000000000001'),
                             (select following_count from profiles where id = '91600000-0000-4000-8000-000000000002'),
                             (select like_count from lists where id = '91601000-0000-4000-8000-000000000001'))),
  '1/1/1', 'B5 the counter triggers moved follower, following and like counts');
select is((select player_count from lists where id = '91601000-0000-4000-8000-000000000001'), 1,
  'B6 the player-count trigger counted the fixture''s one player');

-- reorder still owner-checks and still writes.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.reorder_list_players('91601000-0000-4000-8000-000000000001', '[{"player_id": "pgtap-x160-p1", "position": 3}]'::jsonb) $$,
  'P0001', 'Forbidden', 'B7 reorder refuses a non-owner');
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.reorder_list_players('91601000-0000-4000-8000-000000000001', '[{"player_id": "pgtap-x160-p1", "position": 3}]'::jsonb) $$,
  'B8 reorder lets the owner write');
reset role;
select is((select position from list_players where list_id = '91601000-0000-4000-8000-000000000001' and player_id = 'pgtap-x160-p1'), 3,
  'B9 …and the position moved');

-- The three guards still refuse a client's write.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ update profiles set is_admin = true where id = '91600000-0000-4000-8000-000000000001' $$,
  '23514', 'Admin status is managed by the system.', 'B10 the admin guard still refuses a self-grant');
select throws_ok($$ update profiles set is_pro = true where id = '91600000-0000-4000-8000-000000000001' $$,
  '23514', 'Subscription fields are managed by the system.', 'B11 the billing guard still refuses');
select throws_ok($$ update lists set ai_persona_id = gen_random_uuid() where id = '91601000-0000-4000-8000-000000000001' $$,
  '23514', 'ai_persona_id is managed by the system.', 'B12 the persona guard still refuses');
-- The caps trigger runs on every list insert (caps are off — 187): it lands.
with u as (insert into lists (owner_id, title, slug, is_private)
           values ('91600000-0000-4000-8000-000000000001', 'X160 Private', 'x160-private', true) returning 1)
select is(count(*)::int, 1, 'B13 a private list insert runs the caps trigger and lands (caps off since 187)') from u;
reset role;

-- ===========================================================================
-- §C  F719 — the member reads fail closed
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$ select public.league_standings('91605000-0000-4000-8000-000000000001') $$,
  '42501', 'league_standings: only a member of the league may read its standings',
  'C1 an authenticated call with no uid is refused (was skipped before 210)');
select throws_ok($$ select public.league_standings_projected('91605000-0000-4000-8000-000000000001') $$,
  '42501', 'league_standings_projected: only a member of the league may read its standings',
  'C2 …the projected read too');
select throws_ok($$ select public.league_playoff_bracket('91605000-0000-4000-8000-000000000001') $$,
  '42501', 'league_playoff_bracket: only a member of the league may read its bracket',
  'C3 …and the bracket');
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
select throws_ok($$ select public.league_standings('91605000-0000-4000-8000-000000000001') $$,
  '42501', 'league_standings: only a member of the league may read its standings',
  'C4 a signed-in non-member is refused (unchanged)');
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
select lives_ok($$ select public.league_standings('91605000-0000-4000-8000-000000000001') $$,
  'C5 a member reads the standings');
select lives_ok($$ select public.league_standings_projected('91605000-0000-4000-8000-000000000001') $$,
  'C6 …and the projected standings');
select throws_ok($$ select public.league_playoff_bracket('91605000-0000-4000-8000-000000000001') $$,
  'P0001', null,
  'C7 …and passes the bracket''s gate (the setup league has no plan yet, so the read itself refuses — P0001, not 42501)');
reset role;
set local role service_role;
select set_config('request.jwt.claims', '', true);
select lives_ok($$ select public.league_standings('91605000-0000-4000-8000-000000000001') $$,
  'C8 the server (service_role, no uid) still reads the standings');
select throws_ok($$ select public.league_standings('91605000-0000-4000-8000-0000000000ff') $$,
  'P0002', null, 'C9 …and passes the gate for any league (a missing one reaches the read''s own P0002)');
reset role;
select lives_ok($$ select public.league_standings_projected('91605000-0000-4000-8000-000000000001') $$,
  'C10 a postgres session (pg_cron, migrations) still reads');
select ok(not has_function_privilege('anon', 'public.league_standings(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.league_standings_projected(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.league_playoff_bracket(uuid)', 'EXECUTE'),
  'C11 anon still holds no EXECUTE on the three');
select ok(not has_function_privilege('anon', 'public.caller_is_server_internal()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.caller_is_server_internal()', 'EXECUTE'),
  'C12 the server test is not callable by the API roles');

-- ===========================================================================
-- §D  F720 — profiles
-- ===========================================================================
select is(
  (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
    where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('anon', 'public.profiles', a.attname, 'SELECT')),
  'id,username,avatar_url,bio,cred_score,cred_rank,is_pro,subscription_status,follower_count,following_count,created_at,updated_at',
  'D1 anon reads exactly these profile columns (golden — a new column must be granted on purpose)');
select is(
  (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
    where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.profiles', a.attname, 'SELECT')),
  'id,username,avatar_url,bio,cred_score,cred_rank,is_pro,subscription_status,follower_count,following_count,created_at,updated_at',
  'D2 authenticated reads exactly the same set');
select ok(has_column_privilege('service_role', 'public.profiles', 'is_admin', 'SELECT')
      and has_column_privilege('service_role', 'public.profiles', 'stripe_customer_id', 'SELECT'),
  'D3 service_role still reads both');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select is_admin from profiles limit 1 $$, '42501', null, 'D4 anon cannot read is_admin');
select throws_ok($$ select stripe_customer_id from profiles limit 1 $$, '42501', null, 'D5 anon cannot read stripe_customer_id');
select throws_ok($$ select * from profiles limit 1 $$, '42501', null, 'D6 anon cannot select * (why the app names its columns)');
select is((select username from profiles where id = '91600000-0000-4000-8000-000000000001'), 'x160_owner',
  'D7 anon still reads a public profile by its named columns');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
select throws_ok($$ select is_admin from profiles where id = '91600000-0000-4000-8000-000000000004' $$, '42501', null,
  'D8 even the admin cannot read is_admin off his own row');
select is(public.is_platform_operator(), true, 'D9 …he asks is_platform_operator() instead: true');
with u as (update profiles set bio = 'x160 bio' where id = '91600000-0000-4000-8000-000000000004' returning id)
select is(count(*)::int, 1, 'D10 his own profile edit still lands (RETURNING id)') from u;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is(public.is_platform_operator(), false, 'D11 a plain user: false');
select throws_ok($$ select stripe_customer_id from profiles where id = '91600000-0000-4000-8000-000000000001' $$, '42501', null,
  'D12 a user cannot read his own stripe_customer_id through the API role');
reset role;

-- ===========================================================================
-- §E  F715 — storage buckets
-- ===========================================================================
select is(
  (select string_agg(b.id || ':' || b.public::text || ':' || b.file_size_limit::text || ':' || array_to_string(b.allowed_mime_types, ','),
                     ' | ' order by b.id)
     from storage.buckets b
    where b.id in ('user-avatars', 'list-thumbnails', 'folder-thumbnails', 'league-avatars')),
  'folder-thumbnails:true:5242880:image/png,image/jpeg,image/jpg,image/webp,image/gif | league-avatars:true:5242880:image/png,image/jpeg,image/jpg,image/webp,image/gif | list-thumbnails:true:5242880:image/png,image/jpeg,image/jpg,image/webp,image/gif | user-avatars:true:5242880:image/png,image/jpeg,image/jpg,image/webp,image/gif',
  'E1 the four public buckets: still public, 5 MiB, the routes'' five image types (golden)');
select is_empty(
  $$ select id from storage.buckets where public and (file_size_limit is null or allowed_mime_types is null) $$,
  'E2 no public bucket is left without a size limit or a type list');

-- ===========================================================================
-- §F  F723 — the webhook helper
-- ===========================================================================
select ok(not has_function_privilege('anon', 'supabase_functions.http_request()', 'EXECUTE'),
  'F1 anon cannot EXECUTE supabase_functions.http_request');
select ok(not has_function_privilege('authenticated', 'supabase_functions.http_request()', 'EXECUTE'),
  'F2 authenticated cannot either');
select ok(has_function_privilege('service_role', 'supabase_functions.http_request()', 'EXECUTE'),
  'F3 service_role keeps it');

-- ===========================================================================
-- §G  F724 — views
-- ===========================================================================
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid = 'public.active_game_window'::regclass),
  'G1 active_game_window runs as its caller');
set local role anon;
select is((select count(*)::int from active_game_window), 1, 'G2 …and still answers anon (nfl_games is public)');
reset role;
select ok(
  (select d like '%l.hide_order = false%' and d like '%l.is_private = false%' and d like '%l.deleted_at IS NULL%'
     from (select pg_get_viewdef('public.consensus_rankings'::regclass) as d) v),
  'G3 consensus_rankings (a materialized view — no security_invoker in Postgres) reads only public, order-visible, live lists');

-- ===========================================================================
-- §H  F777 — expert_profiles
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000007", "role": "authenticated"}', true);
with u as (update expert_profiles set bio = 'x160 expert bio' where id = '91603000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'H1 a claimed expert''s profile edit still lands') from u;
select throws_ok(
  $$ update expert_profiles set ai_generated_disclaimer = 'none' where id = '91603000-0000-4000-8000-000000000001' $$,
  '23514', 'The AI disclaimer and the claim date are managed by the system.', 'H2 the expert cannot rewrite the AI disclaimer');
select throws_ok(
  $$ update expert_profiles set ai_generated_disclaimer = null where id = '91603000-0000-4000-8000-000000000001' $$,
  '23514', 'The AI disclaimer and the claim date are managed by the system.', 'H3 …or clear it');
select throws_ok(
  $$ update expert_profiles set claimed_at = '2020-01-01' where id = '91603000-0000-4000-8000-000000000001' $$,
  '23514', 'The AI disclaimer and the claim date are managed by the system.', 'H4 …or move the claim date');
select throws_ok(
  $$ update expert_profiles set follower_count = 9000 where id = '91603000-0000-4000-8000-000000000001' $$,
  '23514', 'Follower counts and the AI label are managed by the system.', 'H5 206''s branch and words are unchanged');
select throws_ok(
  $$ update expert_profiles set claimed_by = '91600000-0000-4000-8000-000000000002'
      where id = '91603000-0000-4000-8000-000000000001' $$,
  '42501', null, 'H6 the claim itself cannot be handed on — the UPDATE policy''s check holds the new row');
reset role;
set local role service_role;
with u as (update expert_profiles set ai_generated_disclaimer = 'x160 server text', claimed_at = now()
           where id = '91603000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'H7 the server may still write both') from u;
reset role;

-- ===========================================================================
-- §I  F793 — a league scoring row's label
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
with u as (update scoring_systems set name = 'x160 league scoring v2'
           where id = '91604000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'I1 the sitting commissioner who owns the row may rename it') from u;
reset role;

-- He hands the league on: the old commissioner becomes a co-commissioner and
-- keeps owning the row (the F793 shape).
update league_members set role = 'co_commissioner'
 where league_id = '91605000-0000-4000-8000-000000000001' and user_id = '91600000-0000-4000-8000-000000000005';
update league_members set role = 'commissioner'
 where league_id = '91605000-0000-4000-8000-000000000001' and user_id = '91600000-0000-4000-8000-000000000006';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
select throws_ok(
  $$ update scoring_systems set name = 'x160 hijacked' where id = '91604000-0000-4000-8000-000000000001' $$,
  '42501', 'This scoring system belongs to the league "x160 League". Only its commissioner can change its name or description.',
  'I2 the replaced commissioner can no longer rename the league''s scoring');
select throws_ok(
  $$ update scoring_systems set description = 'x160 hijacked' where id = '91604000-0000-4000-8000-000000000001' $$,
  '42501', 'This scoring system belongs to the league "x160 League". Only its commissioner can change its name or description.',
  'I3 …or rewrite its description');
with u as (update scoring_systems set updated_at = now() where id = '91604000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'I4 a write that leaves the label alone is not this guard''s business (RETURNING 1)') from u;
with u as (update scoring_systems set name = 'x160 personal v2' where id = '91604000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 1, 'I5 his own personal scoring (no league) renames as before') from u;
select is(public.scoring_system_label_lock_internal('91604000-0000-4000-8000-000000000001'), 'x160 League',
  'I6 the helper names the league that holds the label');
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
with u as (update scoring_systems set name = 'x160 new commish' where id = '91604000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 0, 'I7 the new commissioner does not own the row — the owner policy matches 0 rows') from u;
select is(public.scoring_system_label_lock_internal('91604000-0000-4000-8000-000000000001'), null,
  'I8 the helper answers nothing about a row the caller does not own');
reset role;
select is((select name from scoring_systems where id = '91604000-0000-4000-8000-000000000001'), 'x160 league scoring v2',
  'I9 the label is still the one the sitting commissioner set');
set local role service_role;
with u as (update scoring_systems set name = 'x160 server rename' where id = '91604000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'I10 the server may rename it') from u;
reset role;
update leagues set deleted_at = now() where id = '91605000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "91600000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
with u as (update scoring_systems set name = 'x160 after delete' where id = '91604000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'I11 once the league is deleted the owner''s row is his own again') from u;
reset role;
select ok(not has_function_privilege('anon', 'public.scoring_system_label_lock_internal(uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.scoring_systems_league_label_guard_internal()', 'EXECUTE'),
  'I12 anon cannot ask the helper; nobody calls the trigger function directly');
select is(
  (select tgenabled::text from pg_trigger where tgrelid = 'public.scoring_systems'::regclass
      and tgname = 'trg_zz_scoring_systems_league_label'),
  'A', 'I13 the label guard is ENABLE ALWAYS, like 170''s rules guard');

-- ===========================================================================
-- §J  F718 — the house sweep (every future migration meets it)
-- ===========================================================================
select is_empty(
  $$ select c.oid::regclass::text from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'J1 RLS is on for every table in public (partitioned tables included)');
select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prosecdef
        and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']) $$,
  'J2 every SECURITY DEFINER function in public pins search_path = '''' (210 moved the last eleven)');
select cmp_ok(
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef),
  '>=', 140::bigint, 'J3 (non-vacuity) public holds at least 140 SECURITY DEFINER functions');
-- Trigger functions are left out: Postgres refuses to call one directly.
select is(
  (select string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text)
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'get_join_preview(text) | is_league_commish(uuid) | is_league_member(uuid) | is_standalone_mock_launcher(uuid) | reorder_list_players(uuid,jsonb) | team_is_mock_seat(uuid) | team_league_id(uuid)',
  'J4 THE anon-EXECUTE ALLOWLIST (golden): the join preview, the five RLS helpers the public policies evaluate, and reorder (refuses a caller with no uid in-body). A new SECURITY DEFINER that forgets its REVOKE is named here');
select is_empty(
  $$ select c.oid::regclass::text from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
        and not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'J5 every view in public runs as its caller (materialized views cannot — G3 pins the one there is)');
select is(
  (select string_agg(c.relname, ',' order by c.relname) from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'm'),
  'consensus_rankings',
  'J6 the only materialized view in public is consensus_rankings (a new one is reviewed here)');

select * from finish();
rollback;
