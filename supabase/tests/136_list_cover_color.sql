-- ============================================================================
-- Migration 188 — a list's cover colour (Chris, 2026-10-15, mobile ruling 9).
--
-- `lists.cover_color` is NULLABLE (NULL = the cover follows the list's
-- position group, so every existing list keeps its colour) and closed to six
-- stable keys by a CHECK — the swatches the design draws: blue, ink, red,
-- purple, indigo, green. Any other string is refused with 23514 on every
-- path, including ones that never pass through the API's Zod.
--
-- `duplicate_list` (017, redefined by 188) copies the colour, the way it
-- already copies `position_filter` — the other half of what colours a cover —
-- and keeps SECURITY INVOKER + its search_path pin.
--
-- Determinism: fixed UUIDs and literals, privileged fixture work only; the
-- duplicate runs as the fixture owner (auth.uid() from request.jwt.claims).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

-- 1. The column: text, nullable, no default.
select has_column('public', 'lists', 'cover_color', 'lists has a cover_color column');
select col_type_is('public', 'lists', 'cover_color', 'text', 'cover_color is text');
select col_is_null('public', 'lists', 'cover_color', 'cover_color is nullable (NULL = follow the position colour)');
select col_hasnt_default('public', 'lists', 'cover_color', 'cover_color has no default, so existing lists stay NULL');

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '88000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-cover1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "cover_owner_one"}', now(), now());

-- 2. A list made without a colour follows its position group (NULL).
insert into lists (id, owner_id, title, slug, position_filter) values
  ('98000000-0000-4000-8000-000000000001', '88000000-0000-4000-8000-000000000001', 'cover plain', 'cover-plain', 'WR');
select is((select cover_color from lists where id = '98000000-0000-4000-8000-000000000001'), null,
  'a list created without a colour has cover_color NULL');

-- 3. Every one of the six keys lives.
select lives_ok(
  $$ insert into lists (owner_id, title, slug, cover_color)
     select '88000000-0000-4000-8000-000000000001', 'cover ' || k, 'cover-' || k, k
       from unnest(array['blue', 'ink', 'red', 'purple', 'indigo', 'green']) as k $$,
  'all six cover keys are accepted');

-- 4. Anything else is refused by the CHECK (23514) — a hex, a casing slip, ''.
select throws_ok(
  $$ update lists set cover_color = '#0088FF' where id = '98000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'a hex value is refused — the column stores keys, not colours');
select throws_ok(
  $$ update lists set cover_color = 'Blue' where id = '98000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'keys are exact (case-sensitive)');
select throws_ok(
  $$ update lists set cover_color = '' where id = '98000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'an empty string is not "no colour" — NULL is');

-- 5. Choosing a colour and clearing it again.
update lists set cover_color = 'purple' where id = '98000000-0000-4000-8000-000000000001';
select lives_ok(
  $$ update lists set cover_color = null where id = '98000000-0000-4000-8000-000000000001' $$,
  'a chosen colour can be cleared back to NULL');

-- 6. Duplicate carries the colour (and a NULL stays NULL).
update lists set cover_color = 'green' where id = '98000000-0000-4000-8000-000000000001';
insert into lists (id, owner_id, title, slug) values
  ('98000000-0000-4000-8000-000000000002', '88000000-0000-4000-8000-000000000001', 'cover none', 'cover-none');

select set_config('request.jwt.claims',
  '{"sub": "88000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (select cover_color from duplicate_list('98000000-0000-4000-8000-000000000001', 'cover plain (Copy)', 'cover-plain-copy')),
  'green', 'duplicate_list copies the cover colour');
select is(
  (select cover_color from duplicate_list('98000000-0000-4000-8000-000000000002', 'cover none (Copy)', 'cover-none-copy')),
  null, 'duplicating a list with no colour leaves the copy following its position group');

reset role;

-- 7. duplicate_list keeps SECURITY INVOKER and its search_path pin.
select ok(
  (select not p.prosecdef and coalesce(p.proconfig, array[]::text[]) @> array['search_path=public, pg_temp']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'duplicate_list'),
  'duplicate_list stays SECURITY INVOKER with its search_path pin');

select * from finish();
rollback;
