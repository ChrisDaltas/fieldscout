-- ============================================================================
-- Migration 187 — the free-tier list caps are lifted (Chris: one private
-- list 2026-10-15, one team 2026-10-16 — the Pro rules are on hold for the
-- free-only launch).
--
-- A FREE account (is_pro = false) can hold several private lists by every
-- path that makes a list private: insert, update to private, and restoring a
-- soft-deleted private list — and several teams by insert and by restore.
-- The trigger stays attached (switched off behind constants, not dropped),
-- and SECURITY DEFINER + the search_path pin are kept (004 counts this
-- function).
--
-- Determinism: fixed UUIDs and literals, privileged fixture work only.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '87000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-cap1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "cap_free_one"}', now(), now());

-- The fixture is a FREE account: the whole point.
update profiles set is_pro = false where id = '87000000-0000-4000-8000-000000000001';
select is((select is_pro from profiles where id = '87000000-0000-4000-8000-000000000001'), false,
  'fixture owner is a free account');

-- 1. Insert: a second and third private list.
insert into lists (id, owner_id, title, slug, is_private) values
  ('97000000-0000-4000-8000-000000000001', '87000000-0000-4000-8000-000000000001', 'cap p1', 'cap-p1', true);
select lives_ok(
  $$ insert into lists (id, owner_id, title, slug, is_private) values
     ('97000000-0000-4000-8000-000000000002', '87000000-0000-4000-8000-000000000001', 'cap p2', 'cap-p2', true) $$,
  'a free account can insert a second private list');
select lives_ok(
  $$ insert into lists (id, owner_id, title, slug, is_private) values
     ('97000000-0000-4000-8000-000000000003', '87000000-0000-4000-8000-000000000001', 'cap p3', 'cap-p3', true) $$,
  'and a third');

-- 2. Update: a public list made private while three private lists exist.
insert into lists (id, owner_id, title, slug, is_private) values
  ('97000000-0000-4000-8000-000000000004', '87000000-0000-4000-8000-000000000001', 'cap pub', 'cap-pub', false);
select lives_ok(
  $$ update lists set is_private = true where id = '97000000-0000-4000-8000-000000000004' $$,
  'a free account can make another list private');

-- 3. Restore: a soft-deleted private list comes back while others are live.
insert into lists (id, owner_id, title, slug, is_private, deleted_at) values
  ('97000000-0000-4000-8000-000000000005', '87000000-0000-4000-8000-000000000001', 'cap del', 'cap-del', true, now());
select lives_ok(
  $$ update lists set deleted_at = null where id = '97000000-0000-4000-8000-000000000005' $$,
  'a free account can restore a private list while others are live');
select is(
  (select count(*)::int from lists
    where owner_id = '87000000-0000-4000-8000-000000000001' and is_private and deleted_at is null),
  5, 'five live private lists on one free account');

-- 4. Teams: a second and third team, and a soft-deleted team restored.
insert into lists (id, owner_id, title, slug, is_team) values
  ('97000000-0000-4000-8000-000000000006', '87000000-0000-4000-8000-000000000001', 'cap t1', 'cap-t1', true);
select lives_ok(
  $$ insert into lists (id, owner_id, title, slug, is_team) values
     ('97000000-0000-4000-8000-000000000007', '87000000-0000-4000-8000-000000000001', 'cap t2', 'cap-t2', true) $$,
  'a free account can insert a second team');
select lives_ok(
  $$ insert into lists (id, owner_id, title, slug, is_team) values
     ('97000000-0000-4000-8000-000000000008', '87000000-0000-4000-8000-000000000001', 'cap t3', 'cap-t3', true) $$,
  'and a third');
insert into lists (id, owner_id, title, slug, is_team, deleted_at) values
  ('97000000-0000-4000-8000-000000000009', '87000000-0000-4000-8000-000000000001', 'cap tdel', 'cap-tdel', true, now());
select lives_ok(
  $$ update lists set deleted_at = null where id = '97000000-0000-4000-8000-000000000009' $$,
  'a free account can restore a team while others are live');
select is(
  (select count(*)::int from lists
    where owner_id = '87000000-0000-4000-8000-000000000001' and is_team and deleted_at is null),
  4, 'four live teams on one free account');

-- 5. The function keeps its SECURITY DEFINER + search_path pin (210, F719:
--    the stricter '' — its names are qualified now; was public, pg_temp).
select ok(
  (select p.prosecdef and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enforce_free_list_caps'),
  'enforce_free_list_caps stays SECURITY DEFINER with its search_path pin');

-- 6. Switched off, not dropped: the trigger is still attached to lists.
select trigger_is('lists', 'trg_enforce_free_list_caps', 'enforce_free_list_caps',
  'the caps trigger stays attached (switched off behind constants)');

select * from finish();
rollback;
