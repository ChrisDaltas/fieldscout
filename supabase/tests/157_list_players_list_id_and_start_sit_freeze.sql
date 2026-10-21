-- ============================================================================
-- 157 — migration 207: a list_players row cannot move to another list; a
--       start/sit question's week / season / scoring freeze once anyone has
--       voted (PR #529 review R1655 + R1656; PROGRESS D666–D669; spec §19.3)
-- ============================================================================
-- §A  Posture: the new guard and the replaced start/sit guard are SECURITY
--     INVOKER, search_path '', not EXECUTE-able by an API role; the trigger is
--     installed BEFORE UPDATE on list_players; 206's six guards still counted.
-- §B  list_players, per role: moving a row to another list is refused (plain
--     UPDATE and an upsert), the counts stay exact (golden literals); a slot
--     edit, a tier edit, a direct position edit, reorder_list_players and a
--     whole-row save with list_id unchanged all land (RETURNING counts); anon
--     touches nothing; service_role and postgres may still move a row.
-- §C  start_sit_questions: before any vote the week / season / scoring may
--     change; after a vote each is refused, the players stay frozen (206),
--     context_note and voting_closes_at stay editable (the latter is F780),
--     writing a frozen column back unchanged lands, the server may still
--     change them.
--
-- OWN FIXTURE: users 92070000-…-01 (A) and -02 (B); lists 92071…; scoring
-- systems 92072…; questions 92074…; players pgtap-ff-p1/p2/p3. One rolled-back
-- transaction.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(40);

-- ---------------------------------------------------------------------------
-- Fixture (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('92070000-0000-4000-8000-00000000000' || i)::uuid,
  'authenticated', 'authenticated', 'pgtap-ff-' || i || '@fieldscout.local', 'x', now(),
  '{"provider": "email", "providers": ["email"]}', json_build_object('username', 'ffseven_u' || i)::jsonb, now(), now()
from generate_series(1, 2) i;

insert into players (id, full_name, position) values
  ('pgtap-ff-p1', 'PgTap FF RB', 'RB'),
  ('pgtap-ff-p2', 'PgTap FF WR', 'WR'),
  ('pgtap-ff-p3', 'PgTap FF TE', 'TE');

-- A owns L1 and L2; B owns L3.
insert into lists (id, owner_id, title, slug) values
  ('92071000-0000-4000-8000-000000000001', '92070000-0000-4000-8000-000000000001', 'ff one', 'ff-one'),
  ('92071000-0000-4000-8000-000000000002', '92070000-0000-4000-8000-000000000001', 'ff two', 'ff-two'),
  ('92071000-0000-4000-8000-000000000003', '92070000-0000-4000-8000-000000000002', 'ff three', 'ff-three');

insert into scoring_systems (id, name, rules) values
  ('92072000-0000-4000-8000-000000000001', 'ff scoring one', '{}'::jsonb),
  ('92072000-0000-4000-8000-000000000002', 'ff scoring two', '{}'::jsonb);

-- ===========================================================================
-- §A  posture
-- ===========================================================================
select is(
  (select count(*)::int from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('list_players_list_id_guard_internal', 'start_sit_server_owned_guard_internal')
       and not p.prosecdef
       and p.proconfig = array['search_path=""']),
  2, 'A1 both guards are SECURITY INVOKER with search_path pinned to empty');
select is(
  (select count(*)::int from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('list_players_list_id_guard_internal', 'start_sit_server_owned_guard_internal')
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'A2 neither guard is EXECUTE-able by anon or authenticated');
select is(
  (select array_agg(tgname::text || ':' || (tgtype & 2 = 2)::text || ':' || (tgtype & 16 = 16)::text
                    order by tgname)
     from pg_trigger
    where tgrelid = 'public.list_players'::regclass and not tgisinternal),
  array['on_list_player_change:false:false',
        'trg_list_players_list_id_guard:true:true'],
  'A3 list_players carries the counter trigger and the new guard (BEFORE, UPDATE)');
select is(
  (select count(*)::int from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname like '%server_owned_guard_internal'),
  6, 'A4 206''s six server-owned guards are still the six (207 added none to that set)');

-- ===========================================================================
-- §B  list_players
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92070000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
insert into list_players (list_id, player_id, position) values
  ('92071000-0000-4000-8000-000000000001', 'pgtap-ff-p1', 1),
  ('92071000-0000-4000-8000-000000000001', 'pgtap-ff-p2', 2);
reset role;
select is(
  (select array[(select player_count from lists where id = '92071000-0000-4000-8000-000000000001'),
                (select player_count from lists where id = '92071000-0000-4000-8000-000000000002')]),
  array[2, 0], 'B1 two adds to L1: counts [L1, L2] = [2, 0]');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92070000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ update list_players set list_id = '92071000-0000-4000-8000-000000000002'
      where list_id = '92071000-0000-4000-8000-000000000001' and player_id = 'pgtap-ff-p1' $$,
  '23514', 'A player can''t be moved to another list. Remove and add instead.',
  'B2 the owner moving a row to their other list is refused');
select throws_ok(
  $$ update list_players set list_id = '92071000-0000-4000-8000-000000000002', tier = 'A'
      where list_id = '92071000-0000-4000-8000-000000000001' $$,
  '23514', 'A player can''t be moved to another list. Remove and add instead.',
  'B3 a move bundled with a tier edit is refused whole');
select throws_ok(
  $$ insert into list_players (list_id, player_id, position)
       values ('92071000-0000-4000-8000-000000000001', 'pgtap-ff-p1', 9)
     on conflict (list_id, player_id)
       do update set list_id = '92071000-0000-4000-8000-000000000002' $$,
  '23514', 'A player can''t be moved to another list. Remove and add instead.',
  'B4 an upsert that moves the row is refused');
select throws_ok(
  $$ update list_players set list_id = '92071000-0000-4000-8000-000000000003'
      where list_id = '92071000-0000-4000-8000-000000000001' $$,
  '23514', 'A player can''t be moved to another list. Remove and add instead.',
  'B5 moving a row into another user''s list is refused');
reset role;
select is(
  (select array[(select player_count from lists where id = '92071000-0000-4000-8000-000000000001'),
                (select player_count from lists where id = '92071000-0000-4000-8000-000000000002'),
                (select count(*)::int from list_players where list_id = '92071000-0000-4000-8000-000000000001'),
                (select count(*)::int from list_players where list_id = '92071000-0000-4000-8000-000000000002')]),
  array[2, 0, 2, 0], 'B6 golden after the refused moves: counts [2, 0], rows [2, 0] — still exact');

-- The edits the app makes still land (slot/route.ts, tier/route.ts shapes).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92070000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
with u as (update list_players set slot = 'RB', updated_at = now()
            where list_id = '92071000-0000-4000-8000-000000000001' and player_id = 'pgtap-ff-p1'
            returning player_id)
select is(count(*)::int, 1, 'B7 a slot edit (slot/route.ts shape) lands — RETURNING count 1') from u;
with u as (update list_players set tier = 'S', updated_at = now()
            where list_id = '92071000-0000-4000-8000-000000000001' and player_id = 'pgtap-ff-p1'
            returning player_id)
select is(count(*)::int, 1, 'B8 a tier edit (tier/route.ts shape) lands — RETURNING count 1') from u;
with u as (update list_players set position = 5, notes = 'ff note'
            where list_id = '92071000-0000-4000-8000-000000000001' and player_id = 'pgtap-ff-p2'
            returning 1)
select is(count(*)::int, 1, 'B9 a direct position / notes edit lands') from u;
with u as (update list_players set list_id = list_id, tier = 'A'
            where list_id = '92071000-0000-4000-8000-000000000001' and player_id = 'pgtap-ff-p2'
            returning 1)
select is(count(*)::int, 1, 'B10 writing list_id back UNCHANGED (a whole-row save) still lands') from u;
select lives_ok(
  $$ select reorder_list_players('92071000-0000-4000-8000-000000000001',
       '[{"player_id": "pgtap-ff-p1", "position": 2}, {"player_id": "pgtap-ff-p2", "position": 1}]'::jsonb) $$,
  'B11 reorder_list_players still works for the owner');
reset role;
select is(
  (select array_agg(player_id || ':' || position || ':' || coalesce(slot, '-') || ':' || coalesce(tier, '-')
                    order by player_id)
     from list_players where list_id = '92071000-0000-4000-8000-000000000001'),
  array['pgtap-ff-p1:2:RB:S', 'pgtap-ff-p2:1:-:A'],
  'B12 golden: every allowed edit landed on L1 (position from the reorder, slot, tier)');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
with u as (update list_players set list_id = '92071000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 0, 'B13 anon updates no list_players row (RETURNING count 0)') from u;
reset role;

-- The server path is not a client role.
set local role service_role;
with u as (update list_players set list_id = '92071000-0000-4000-8000-000000000002'
            where list_id = '92071000-0000-4000-8000-000000000001' and player_id = 'pgtap-ff-p2'
            returning 1)
select is(count(*)::int, 1, 'B14 service_role may move a row') from u;
reset role;
with u as (update list_players set list_id = '92071000-0000-4000-8000-000000000001'
            where list_id = '92071000-0000-4000-8000-000000000002' and player_id = 'pgtap-ff-p2'
            returning 1)
select is(count(*)::int, 1, 'B15 postgres may move it back') from u;

-- Remove → counts back down.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92070000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
delete from list_players where list_id = '92071000-0000-4000-8000-000000000001';
reset role;
select is(
  (select array[(select player_count from lists where id = '92071000-0000-4000-8000-000000000001'),
                (select player_count from lists where id = '92071000-0000-4000-8000-000000000002')]),
  array[0, 0], 'B16 removing both brings the counts to [0, 0]');

-- ===========================================================================
-- §C  start_sit_questions — week / season / scoring freeze after a vote
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92070000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
insert into start_sit_questions (id, poster_id, player_a_id, player_b_id, season, week, voting_closes_at)
  values ('92074000-0000-4000-8000-000000000001', '92070000-0000-4000-8000-000000000001',
          'pgtap-ff-p1', 'pgtap-ff-p2', 2026, 7, now() + interval '2 days');
with u as (update start_sit_questions set week = 8
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C1 before any vote, the poster may change the week') from u;
with u as (update start_sit_questions set season = 2025
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C2 before any vote, the poster may change the season') from u;
with u as (update start_sit_questions set scoring_system_id = '92072000-0000-4000-8000-000000000001'
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C3 before any vote, the poster may set the scoring') from u;
with u as (update start_sit_questions set season = 2026
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C4 …and change the season back') from u;

-- B votes.
select set_config('request.jwt.claims', '{"sub": "92070000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
insert into start_sit_votes (question_id, voter_id, voted_for)
  values ('92074000-0000-4000-8000-000000000001', '92070000-0000-4000-8000-000000000002', 'a');

-- A: frozen now.
select set_config('request.jwt.claims', '{"sub": "92070000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok(
  $$ update start_sit_questions set week = 9 where id = '92074000-0000-4000-8000-000000000001' $$,
  '23514', 'The week and scoring can''t change once people have voted.', 'C5 after a vote, changing the week is refused');
select throws_ok(
  $$ update start_sit_questions set season = 2025 where id = '92074000-0000-4000-8000-000000000001' $$,
  '23514', 'The week and scoring can''t change once people have voted.', 'C6 after a vote, changing the season is refused');
select throws_ok(
  $$ update start_sit_questions set scoring_system_id = '92072000-0000-4000-8000-000000000002'
      where id = '92074000-0000-4000-8000-000000000001' $$,
  '23514', 'The week and scoring can''t change once people have voted.', 'C7 after a vote, switching the scoring is refused');
select throws_ok(
  $$ update start_sit_questions set scoring_system_id = null where id = '92074000-0000-4000-8000-000000000001' $$,
  '23514', 'The week and scoring can''t change once people have voted.', 'C8 after a vote, clearing the scoring is refused');
select throws_ok(
  $$ update start_sit_questions set week = 9, context_note = 'ff sneak'
      where id = '92074000-0000-4000-8000-000000000001' $$,
  '23514', 'The week and scoring can''t change once people have voted.', 'C9 a week change bundled with a note edit is refused whole');
select throws_ok(
  $$ update start_sit_questions set player_a_id = 'pgtap-ff-p3', week = 9
      where id = '92074000-0000-4000-8000-000000000001' $$,
  '23514', 'The players can''t change once people have voted.', 'C10 206''s player freeze still holds (and reports first)');
with u as (update start_sit_questions set context_note = 'ff still editable'
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C11 after a vote, context_note stays editable') from u;
with u as (update start_sit_questions set week = 8, season = 2026,
                  scoring_system_id = '92072000-0000-4000-8000-000000000001'
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C12 writing the frozen columns back UNCHANGED (a whole-row save) lands') from u;
with u as (update start_sit_questions set voting_closes_at = now() + interval '3 days'
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C13 after a vote, voting_closes_at is still editable (today''s behaviour; F780)') from u;
reset role;
select is(
  (select week || ':' || season || ':' || coalesce(scoring_system_id::text, '-') || ':' || coalesce(context_note, '-')
     from start_sit_questions where id = '92074000-0000-4000-8000-000000000001'),
  '8:2026:92072000-0000-4000-8000-000000000001:ff still editable',
  'C14 golden: week 8, season 2026, scoring one, the note edit — no refused change landed');

-- A second question with no votes stays fully editable (the freeze is per question).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "92070000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
insert into start_sit_questions (id, poster_id, player_a_id, player_b_id, season, week, voting_closes_at)
  values ('92074000-0000-4000-8000-000000000002', '92070000-0000-4000-8000-000000000001',
          'pgtap-ff-p1', 'pgtap-ff-p3', 2026, 7, now() + interval '2 days');
with u as (update start_sit_questions set week = 10, season = 2027,
                  scoring_system_id = '92072000-0000-4000-8000-000000000002'
            where id = '92074000-0000-4000-8000-000000000002' returning 1)
select is(count(*)::int, 1, 'C15 a question nobody voted on keeps week / season / scoring editable') from u;
-- B cannot reach A's question at all.
select set_config('request.jwt.claims', '{"sub": "92070000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
with u as (update start_sit_questions set week = 11
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 0, 'C16 another user updates no question (RETURNING count 0)') from u;
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
with u as (update start_sit_questions set week = 11 returning 1)
select is(count(*)::int, 0, 'C17 anon updates no question (RETURNING count 0)') from u;
reset role;

-- The server path is not a client role.
set local role service_role;
with u as (update start_sit_questions set week = 9
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C18 service_role may change the week after votes') from u;
reset role;
with u as (update start_sit_questions set scoring_system_id = null
            where id = '92074000-0000-4000-8000-000000000001' returning 1)
select is(count(*)::int, 1, 'C19 postgres may change the scoring after votes') from u;
select is(
  (select week || ':' || coalesce(scoring_system_id::text, '-')
     from start_sit_questions where id = '92074000-0000-4000-8000-000000000001'),
  '9:-', 'C20 golden: only the server writes moved the frozen columns');

select * from finish();
rollback;
