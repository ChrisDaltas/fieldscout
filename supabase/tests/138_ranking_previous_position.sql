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
-- `lists.scoring_format` is NULLABLE with no default (a plain list has no
-- scoring) and closed to ppr / half / quarter / standard by a CHECK (23514
-- on anything else) — the contract Community filters on.
--
-- A ranking with no scoring chosen is Half PPR (Chris, 2026-10-16).
-- `fill_ranking_scoring_internal` is that rule: it fills a NULL scoring on
-- a ranking — season big board, weekly board (by big_board_weekly or by its
-- week-N-big-board slug) or AI expert's board — with Half PPR, or with the
-- expert's usual scoring when it is PPR / Half-PPR / Standard; it never
-- overwrites a chosen scoring and never touches a plain list. 190 runs it
-- over every ranking (the backfill, pinned here by calling it on fixtures)
-- and the reorder door runs it on each ranking it publishes. It is not a
-- client API (EXECUTE revoked from anon / authenticated).
--
-- Determinism: fixed UUIDs and literals; the reorders run as the fixture
-- owner (auth.uid() from request.jwt.claims).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

-- 1. The columns.
select has_column('public', 'list_players', 'previous_position', 'list_players has previous_position');
select col_type_is('public', 'list_players', 'previous_position', 'integer', 'previous_position is an integer');
select col_is_null('public', 'list_players', 'previous_position', 'previous_position is nullable (NULL = new / not updated since)');
select col_hasnt_default('public', 'list_players', 'previous_position', 'previous_position has no default, so existing rows stay NULL');
select has_column('public', 'lists', 'scoring_format', 'lists has scoring_format');
select col_type_is('public', 'lists', 'scoring_format', 'text', 'scoring_format is text');
select col_is_null('public', 'lists', 'scoring_format', 'scoring_format is nullable (a plain list has no scoring)');
select col_hasnt_default('public', 'lists', 'scoring_format', 'scoring_format has no default, so a new plain list is never tagged');

-- Fixtures: one owner, a second user, five players, and four lists — a
-- season big board, a weekly board, a plain list, and one for the CHECK —
-- plus, for the scoring rule (9.), three AI experts' boards and a weekly
-- board known only by its slug, all with no scoring.
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

-- AI experts: one whose usual scoring is PPR, one with none, one with a
-- scoring outside the vocabulary. Inserted before any request claims are
-- set, so guard_lists_ai_persona lets the boards in.
insert into ai_personas (id, username, display_name, bio, style_profile) values
  ('a9000000-0000-4000-8000-000000000001', 'pgtap-prev-ppr-ai', 'PgTap PPR (AI)', 'x', '{"scoring_default": "PPR"}'),
  ('a9000000-0000-4000-8000-000000000002', 'pgtap-prev-none-ai', 'PgTap None (AI)', 'x', '{}'),
  ('a9000000-0000-4000-8000-000000000003', 'pgtap-prev-odd-ai', 'PgTap Odd (AI)', 'x', '{"scoring_default": "Superflex"}');

insert into lists (id, owner_id, title, slug, ai_persona_id, scoring_format) values
  ('99000000-0000-4000-8000-000000000005', '89000000-0000-4000-8000-000000000001', 'ai ppr', 'prev-ai-ppr', 'a9000000-0000-4000-8000-000000000001', null),
  ('99000000-0000-4000-8000-000000000006', '89000000-0000-4000-8000-000000000001', 'ai none', 'prev-ai-none', 'a9000000-0000-4000-8000-000000000002', null),
  ('99000000-0000-4000-8000-000000000007', '89000000-0000-4000-8000-000000000001', 'ai odd', 'prev-ai-odd', 'a9000000-0000-4000-8000-000000000003', null),
  ('99000000-0000-4000-8000-000000000008', '89000000-0000-4000-8000-000000000001', 'Week 7 Big Board', 'week-7-big-board-1700000000000', null, null);

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
select is(
  (select scoring_format from lists where id = '99000000-0000-4000-8000-000000000001'),
  'half', 'a ranking published with no scoring chosen is Half PPR');

-- 4. The next publish measures from this one: an unmoved player has
--    previous = position (no movement), and is_new only means THIS publish.
--    The board's scoring is chosen first (the phone saves it after a
--    publish): a later publish that picks none must keep it.
update lists set scoring_format = 'standard' where id = '99000000-0000-4000-8000-000000000001';
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
select is(
  (select scoring_format from lists where id = '99000000-0000-4000-8000-000000000001'),
  'standard', 'a publish that picks no scoring keeps the one chosen — the fill never overwrites');

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
select results_eq(
  $$ select id::text, scoring_format from lists
      where id in ('99000000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000003') order by id $$,
  $$ values ('99000000-0000-4000-8000-000000000002'::text, 'half'::text),
            ('99000000-0000-4000-8000-000000000003'::text, null::text) $$,
  'the weekly board published with no scoring is Half PPR; the plain list gets no scoring');

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

-- 7. SECURITY DEFINER with its search_path pin (pgTAP 004 checks every
--    definer; 210, F719: the stricter '' — names qualified; was 048's public, pg_temp).
select ok(
  (select p.prosecdef and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
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
  'a plain list''s scoring can be cleared back to NULL');

-- 9. The rule 190 backfills with (and the door runs per publish): a ranking
--    with no scoring chosen is Half PPR — an AI expert's board, its usual
--    scoring when that is one we know. Called here over every ranking, as
--    the migration does.
select ok(
  fill_ranking_scoring_internal() >= 5,
  'the fill gives every ranking with no scoring one (at least the five fixtures below)');
select results_eq(
  $$ select id::text, scoring_format from lists
      where id in ('99000000-0000-4000-8000-000000000005', '99000000-0000-4000-8000-000000000006',
                   '99000000-0000-4000-8000-000000000007') order by id $$,
  $$ values ('99000000-0000-4000-8000-000000000005'::text, 'ppr'::text),
            ('99000000-0000-4000-8000-000000000006'::text, 'half'::text),
            ('99000000-0000-4000-8000-000000000007'::text, 'half'::text) $$,
  'an AI expert''s board takes its usual scoring; with none (or one we don''t know) it is Half PPR');
select results_eq(
  $$ select scoring_format from lists
      where id = '99000000-0000-4000-8000-000000000008'
         or (owner_id = '89000000-0000-4000-8000-000000000002' and is_big_board) $$,
  $$ values ('half'::text), ('half'::text) $$,
  'a ranking never published (the second user''s big board, a week known by its slug) is Half PPR');
select results_eq(
  $$ select id::text, scoring_format from lists
      where id in ('99000000-0000-4000-8000-000000000001', '99000000-0000-4000-8000-000000000003',
                   '99000000-0000-4000-8000-000000000004') order by id $$,
  $$ values ('99000000-0000-4000-8000-000000000001'::text, 'standard'::text),
            ('99000000-0000-4000-8000-000000000003'::text, null::text),
            ('99000000-0000-4000-8000-000000000004'::text, null::text) $$,
  'a chosen scoring is kept, and plain lists stay untagged');
select is(fill_ranking_scoring_internal(), 0, 'a second run fills nothing (every ranking has its scoring)');
select ok(
  not has_function_privilege('authenticated', 'public.fill_ranking_scoring_internal(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fill_ranking_scoring_internal(uuid)', 'EXECUTE'),
  'the fill is internal — no client can call it');

select * from finish();
rollback;
