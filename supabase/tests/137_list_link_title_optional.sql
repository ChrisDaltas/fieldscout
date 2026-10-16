-- ============================================================================
-- Migration 189 — a video link's title is YouTube's real one, or nothing
-- (Chris, 2026-10-15, mobile gap list #11, correcting the first build: "we
-- need the actual YouTube titles or nothing. Having a bunch of videos with
-- the same title is useless.").
--
-- Pinned here:
--   * `list_links.title` is NULLABLE — a video whose title YouTube would not
--     give us is stored with NULL, never under a placeholder.
--   * A title that IS present keeps 080's rule exactly: 1–200 non-blank
--     characters (blank and 201 chars are still 23514; 1 char lives).
--   * Only a VIDEO may go untitled — an article with no title is 23514
--     (189's `list_links_title_null_video_only_check`).
--   * The owner can store a NULL-title video through RLS (the path the API
--     takes), not only the privileged role.
--   * `duplicate_list` still works on a list carrying a NULL-title link. It
--     does not copy links at all (017, 188 — players and tags only), so a
--     NULL title cannot reach it; a pin says so out loud, so a future change
--     that starts copying links has to come back here.
--   * The placeholder cleanup is PROVABLE, not a whole-table count: 189's
--     UPDATE selects rows through `list_link_title_is_placeholder_internal`,
--     and that predicate is pinned on a placeholder video (cleared) against
--     the near misses it must leave alone — a real title that starts with
--     the words, another casing, an ARTICLE titled exactly that, an untitled
--     video — then run over seeded rows of this test's own list. A freshly
--     reset database has no placeholder rows for the migration to clear, so
--     "none left" would pass whether the UPDATE was right, wrong or missing;
--     this does not depend on what the shared local database holds. The
--     helper is internal: no client role may call it.
--
-- Determinism: fixed UUIDs and literals, privileged fixture work only; the
-- owner's writes run as `authenticated` with auth.uid() from
-- request.jwt.claims.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

-- 1. The column: nullable now; the CHECK on a present title is unchanged.
select col_is_null('public', 'list_links', 'title',
  'list_links.title is nullable — no real title means NULL, never a placeholder');
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.list_links'::regclass and conname = 'list_links_title_check'),
  'CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 200)))',
  '080''s title CHECK is unchanged — a PRESENT title is still 1–200 non-blank characters');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c1370000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-lnktitle1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "lnk_title_owner"}', now(), now());

insert into lists (id, owner_id, title, slug) values
  ('c1370000-0000-4000-8000-0000000000a1', 'c1370000-0000-4000-8000-000000000001',
   'lnk title list', 'lnk-title-list');

-- 2. A video with no title lives, and is stored as NULL.
select lives_ok(
  $$ insert into list_links (id, list_id, kind, url, title)
     values ('c1370000-0000-4000-8000-0000000000b1', 'c1370000-0000-4000-8000-0000000000a1',
             'video', 'https://www.youtube.com/watch?v=pgtapTitle1', null) $$,
  'a video link with a NULL title is accepted');
select is(
  (select count(*) from list_links
    where id = 'c1370000-0000-4000-8000-0000000000b1' and title is null),
  1::bigint,
  'and the row exists with title NULL — nothing stands in for the title');

-- 3. A present title keeps 080's bounds.
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('c1370000-0000-4000-8000-0000000000a1', 'video',
             'https://www.youtube.com/watch?v=pgtapTitle2', '  ') $$,
  '23514', null,
  'a blank title is still 23514 — NULL is "no title", whitespace is not');
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('c1370000-0000-4000-8000-0000000000a1', 'video',
             'https://www.youtube.com/watch?v=pgtapTitle3', repeat('a', 201)) $$,
  '23514', null,
  'a 201-character title is still 23514');
select lives_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('c1370000-0000-4000-8000-0000000000a1', 'video',
             'https://www.youtube.com/watch?v=pgtapTitle4', 'x') $$,
  'a 1-character title lives');

-- 4. Only a video may go untitled.
select throws_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('c1370000-0000-4000-8000-0000000000a1', 'article',
             'https://example.com/pgtap-untitled-article', null) $$,
  '23514', null,
  'an article with no title is 23514 — only a video may go untitled');
select lives_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('c1370000-0000-4000-8000-0000000000a1', 'article',
             'https://example.com/pgtap-titled-article', 'Positive control') $$,
  'positive control — a titled article is accepted, so the pin above is the NULL rule');

-- 5. The owner can attach an untitled video through RLS (the API's path).
select set_config('request.jwt.claims',
  '{"sub": "c1370000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into list_links (list_id, kind, url, title)
     values ('c1370000-0000-4000-8000-0000000000a1', 'video',
             'https://www.youtube.com/watch?v=pgtapTitle5', null) $$,
  'the list owner can store a NULL-title video under RLS');

-- 6. duplicate_list on a list carrying a NULL-title link.
select lives_ok(
  $$ select duplicate_list('c1370000-0000-4000-8000-0000000000a1', 'lnk title list (Copy)', 'lnk-title-list-copy') $$,
  'duplicate_list still works on a list carrying a NULL-title video');

reset role;

select is(
  (select count(*) from list_links l join lists c on c.id = l.list_id
    where c.slug = 'lnk-title-list-copy' and c.owner_id = 'c1370000-0000-4000-8000-000000000001'),
  0::bigint,
  'duplicate_list copies no links (players and tags only, 017/188) — if it ever starts, it must carry a NULL title through');

-- 7. The placeholder cleanup, proven on rows that carry it. 189's UPDATE
-- picks its rows with this predicate; pinned here against the placeholder
-- and every near miss it must leave alone.
select is(list_link_title_is_placeholder_internal('video', 'YouTube video'), true,
  'the cleanup matches a video stored under the exact old placeholder');
select is(list_link_title_is_placeholder_internal('video', 'YouTube videos and more'), false,
  'a real title that merely starts with the words is left alone');
select is(list_link_title_is_placeholder_internal('video', 'youtube video'), false,
  'exact match only — another casing was typed by a person, the service never wrote it');
select is(list_link_title_is_placeholder_internal('article', 'YouTube video'), false,
  'an ARTICLE titled exactly that is someone''s own title — never cleared');
select is(list_link_title_is_placeholder_internal('video', null), false,
  'an untitled video is not a placeholder (a plain false, not NULL)');

select is(
  (select array[has_function_privilege('anon', p.oid, 'EXECUTE'),
                has_function_privilege('authenticated', p.oid, 'EXECUTE')]
     from pg_proc p
    where p.oid = 'public.list_link_title_is_placeholder_internal(text, text)'::regprocedure),
  array[false, false],
  'the cleanup predicate is internal — anon and authenticated cannot call it');

-- The rows a reset database never has: one placeholder video and the near
-- misses beside it, on this test's own list. 189's UPDATE, scoped to it.
insert into list_links (list_id, kind, url, title) values
  ('c1370000-0000-4000-8000-0000000000a1', 'video',   'https://www.youtube.com/watch?v=pgtapPlace1', 'YouTube video'),
  ('c1370000-0000-4000-8000-0000000000a1', 'video',   'https://www.youtube.com/watch?v=pgtapPlace2', 'YouTube videos and more'),
  ('c1370000-0000-4000-8000-0000000000a1', 'video',   'https://www.youtube.com/watch?v=pgtapPlace3', 'youtube video'),
  ('c1370000-0000-4000-8000-0000000000a1', 'article', 'https://example.com/pgtap-placeholder-article', 'YouTube video');

with cleared as (
  update list_links
     set title = null
   where list_id = 'c1370000-0000-4000-8000-0000000000a1'
     and list_link_title_is_placeholder_internal(kind, title)
  returning url
)
select is(
  (select array_agg(url) from cleared),
  array['https://www.youtube.com/watch?v=pgtapPlace1'],
  '189''s UPDATE clears exactly the placeholder video — one row of the four seeded');

select results_eq(
  $$ select url, title from list_links
      where list_id = 'c1370000-0000-4000-8000-0000000000a1'
        and url in ('https://www.youtube.com/watch?v=pgtapPlace1', 'https://www.youtube.com/watch?v=pgtapPlace2',
                    'https://www.youtube.com/watch?v=pgtapPlace3', 'https://example.com/pgtap-placeholder-article')
      order by url $$,
  $$ values ('https://example.com/pgtap-placeholder-article', 'YouTube video'),
            ('https://www.youtube.com/watch?v=pgtapPlace1', null),
            ('https://www.youtube.com/watch?v=pgtapPlace2', 'YouTube videos and more'),
            ('https://www.youtube.com/watch?v=pgtapPlace3', 'youtube video') $$,
  'after it: the placeholder video is untitled; the near misses keep their titles');

select * from finish();
rollback;
