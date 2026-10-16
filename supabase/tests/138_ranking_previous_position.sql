-- ============================================================================
-- Migration 190 — ranking movement + a ranking's saved scoring (Chris,
-- 2026-10-15, mobile rulings #33 and #36).
--
-- `list_players.previous_position` is NULLABLE, no default (NULL = added by
-- the latest publish, or not updated since 190). `reorder_list_players` —
-- the one door every ranking publish goes through — records it on a RANKING
-- board only (season big board, weekly board, AI expert's board): the old
-- position of each row it is sent, NULL for an entry flagged is_new; rows it
-- isn't sent keep theirs; any other list is reordered exactly as before.
-- It stays SECURITY DEFINER with its `public, pg_temp` pin and its
-- Unauthorized / Forbidden refusals.
--
-- `lists.scoring_format` is NULLABLE and closed to ppr / half / quarter /
-- standard by a CHECK (23514 on anything else) — the contract Community
-- filters on.
--
-- Determinism: fixed UUIDs and literals; the reorders run as the fixture
-- owner (auth.uid() from request.jwt.claims).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

-- 1. The columns.
select has_column('public', 'list_players', 'previous_position', 'list_players has previous_position');
select col_type_is('public', 'list_players', 'previous_position', 'integer', 'previous_position is an integer');
select col_is_null('public', 'list_players', 'previous_position', 'previous_position is nullable (NULL = new / not updated since)');
select col_hasnt_default('public', 'list_players', 'previous_position', 'previous_position has no default, so existing rows stay NULL');
select has_column('public', 'lists', 'scoring_format', 'lists has scoring_format');
select col_type_is('public', 'lists', 'scoring_format', 'text', 'scoring_format is text');
select col_is_null('public', 'lists', 'scoring_format', 'scoring_format is nullable (NULL = not known)');

-- Fixtures: one owner, a second user, five players, and four lists — a
-- season big board, a weekly board, a plain list, and one for the CHECK.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '89000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'pgtap-prev1@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "prev_owner_one"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '89000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'pgtap-prev2@fieldscout.local', 'x', now(),
   '{"provider": "email", "providers": ["email"]}', '{"username": "prev_owner_two"}', now(), now());

insert into players (id, full_name, position) values
  ('pgtap-prev-a', 'PgTap Prev A', 'RB'),
  ('pgtap-prev-b', 'PgTap Prev B', 'RB'),
  ('pgtap-prev-c', 'PgTap Prev C', 'RB'),
  ('pgtap-prev-d', 'PgTap Prev D', 'RB'),
  ('pgtap-prev-w', 'PgTap Prev W', 'WR');

-- Signup gives every user a big board (handle_new_user); stand the fixture's
-- own in for it (one big board per user).
update lists set is_big_board = false
 where owner_id = '89000000-0000-4000-8000-000000000001' and is_big_board;

insert into lists (id, owner_id, title, slug, is_big_board) values
  ('99000000-0000-4000-8000-000000000001', '89000000-0000-4000-8000-000000000001', 'prev board', 'prev-board', true),
  ('99000000-0000-4000-8000-000000000002', '89000000-0000-4000-8000-000000000001', 'prev week 6', 'week-6-big-board-prev', false),
  ('99000000-0000-4000-8000-000000000003', '89000000-0000-4000-8000-000000000001', 'prev plain', 'prev-plain', false),
  ('99000000-0000-4000-8000-000000000004', '89000000-0000-4000-8000-000000000001', 'prev scoring', 'prev-scoring', false);

insert into big_board_weekly (user_id, week_number, season, list_id) values
  ('89000000-0000-4000-8000-000000000001', 6, 2026, '99000000-0000-4000-8000-000000000002');

-- Board: A1 B2 C3 W4 (the WR is another position's slice).
insert into list_players (list_id, player_id, position) values
  ('99000000-0000-4000-8000-000000000001', 'pgtap-prev-a', 1),
  ('99000000-0000-4000-8000-000000000001', 'pgtap-prev-b', 2),
  ('99000000-0000-4000-8000-000000000001', 'pgtap-prev-c', 3),
  ('99000000-0000-4000-8000-000000000001', 'pgtap-prev-w', 4),
  ('99000000-0000-4000-8000-000000000002', 'pgtap-prev-a', 1),
  ('99000000-0000-4000-8000-000000000002', 'pgtap-prev-b', 2),
  ('99000000-0000-4000-8000-000000000003', 'pgtap-prev-a', 1),
  ('99000000-0000-4000-8000-000000000003', 'pgtap-prev-b', 2);

-- 2. Rows start with no previous position.
select is(
  (select count(*) from list_players where list_id = '99000000-0000-4000-8000-000000000001' and previous_position is not null),
  0::bigint, 'a new row has no previous position');

-- 3. A publish on the season board, as its owner: the RB slice becomes
--    C A B, with D added by this publish (bulk-inserted at slot 5 first).
insert into list_players (list_id, player_id, position) values
  ('99000000-0000-4000-8000-000000000001', 'pgtap-prev-d', 5);

select set_config('request.jwt.claims',
  '{"sub": "89000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ select reorder_list_players('99000000-0000-4000-8000-000000000001', '[
       {"player_id": "pgtap-prev-c", "position": 1},
       {"player_id": "pgtap-prev-a", "position": 2},
       {"player_id": "pgtap-prev-d", "position": 3, "is_new": true},
       {"player_id": "pgtap-prev-b", "position": 5}
     ]'::jsonb) $$,
  'the owner publishes the board');

reset role;

select results_eq(
  $$ select player_id, position, previous_position from list_players
      where list_id = '99000000-0000-4000-8000-000000000001' and player_id <> 'pgtap-prev-w'
      order by position $$,
  $$ values ('pgtap-prev-c'::text, 1, 3), ('pgtap-prev-a'::text, 2, 1),
            ('pgtap-prev-d'::text, 3, null::integer), ('pgtap-prev-b'::text, 5, 2) $$,
  'each sent row records where he was before the publish; the added player has none');
select is(
  (select overall_rank from list_players where list_id = '99000000-0000-4000-8000-000000000001' and player_id = 'pgtap-prev-c'),
  1, 'overall_rank still follows the position');
select is(
  (select previous_position from list_players where list_id = '99000000-0000-4000-8000-000000000001' and player_id = 'pgtap-prev-w'),
  null, 'a row the publish did not send (another position) keeps its own last publish');

-- 4. The next publish measures from this one: an unmoved player has
--    previous = position (no movement), and is_new only means THIS publish.
set local role authenticated;
select lives_ok(
  $$ select reorder_list_players('99000000-0000-4000-8000-000000000001', '[
       {"player_id": "pgtap-prev-a", "position": 1},
       {"player_id": "pgtap-prev-c", "position": 2},
       {"player_id": "pgtap-prev-d", "position": 3},
       {"player_id": "pgtap-prev-b", "position": 5}
     ]'::jsonb) $$,
  'a second publish');
reset role;
select results_eq(
  $$ select player_id, previous_position from list_players
      where list_id = '99000000-0000-4000-8000-000000000001' and player_id <> 'pgtap-prev-w'
      order by position $$,
  $$ values ('pgtap-prev-a'::text, 2), ('pgtap-prev-c'::text, 1), ('pgtap-prev-d'::text, 3), ('pgtap-prev-b'::text, 5) $$,
  'previous positions are the last publish only — no history');

-- 5. A weekly board records too; a plain list is reordered as before.
set local role authenticated;
select lives_ok(
  $$ select reorder_list_players('99000000-0000-4000-8000-000000000002',
       '[{"player_id": "pgtap-prev-b", "position": 1}, {"player_id": "pgtap-prev-a", "position": 2}]'::jsonb) $$,
  'the owner publishes a weekly board');
select lives_ok(
  $$ select reorder_list_players('99000000-0000-4000-8000-000000000003',
       '[{"player_id": "pgtap-prev-b", "position": 1}, {"player_id": "pgtap-prev-a", "position": 2}]'::jsonb) $$,
  'the owner reorders a plain list');
reset role;
select results_eq(
  $$ select player_id, previous_position from list_players
      where list_id = '99000000-0000-4000-8000-000000000002' order by position $$,
  $$ values ('pgtap-prev-b'::text, 2), ('pgtap-prev-a'::text, 1) $$,
  'a weekly board (big_board_weekly) records previous positions');
select results_eq(
  $$ select player_id, position, previous_position from list_players
      where list_id = '99000000-0000-4000-8000-000000000003' order by position $$,
  $$ values ('pgtap-prev-b'::text, 1, null::integer), ('pgtap-prev-a'::text, 2, null::integer) $$,
  'a list that is not a ranking is reordered, and records nothing');

-- 6. The door's refusals are unchanged.
select set_config('request.jwt.claims',
  '{"sub": "89000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$ select reorder_list_players('99000000-0000-4000-8000-000000000001',
       '[{"player_id": "pgtap-prev-a", "position": 9}]'::jsonb) $$,
  'P0001', 'Forbidden', 'another user still cannot reorder (or stamp) the board');
reset role;
select is(
  (select previous_position from list_players where list_id = '99000000-0000-4000-8000-000000000001' and player_id = 'pgtap-prev-a'),
  2, 'the refused call changed nothing');

-- 7. SECURITY DEFINER with the 048 pin (pgTAP 004 checks every definer).
select ok(
  (select p.prosecdef and coalesce(p.proconfig, array[]::text[]) @> array['search_path=public, pg_temp']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reorder_list_players'),
  'reorder_list_players stays SECURITY DEFINER with its search_path pin');

-- 8. scoring_format: the four values, nothing else, NULL allowed.
select lives_ok(
  $$ insert into lists (owner_id, title, slug, scoring_format)
     select '89000000-0000-4000-8000-000000000001', 'scoring ' || v, 'scoring-' || v, v
       from unnest(array['ppr', 'half', 'quarter', 'standard']) as v $$,
  'ppr / half / quarter / standard are accepted');
select throws_ok(
  $$ update lists set scoring_format = 'half_ppr' where id = '99000000-0000-4000-8000-000000000004' $$,
  '23514', null, 'any other spelling is refused (the contract is exact)');
update lists set scoring_format = 'quarter' where id = '99000000-0000-4000-8000-000000000004';
select lives_ok(
  $$ update lists set scoring_format = null where id = '99000000-0000-4000-8000-000000000004' $$,
  'a saved scoring can be cleared back to NULL');

select * from finish();
rollback;
