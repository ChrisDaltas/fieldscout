-- ============================================================================
-- Migration 195 — player info batch C (F578; PROGRESS D539 / D540).
--
-- Pinned here:
--   1. players.forty_time exists as NUMERIC(3,2), nullable, and its CHECK
--      refuses a physically impossible time (23514) at both edges while
--      admitting the boundary-adjacent real ones (3.51, 6.99).
--   2. Clients still cannot write it: anon and authenticated UPDATE / INSERT
--      touch 0 rows (RETURNING counts — players has a SELECT-only policy);
--      the only policy on players is still the one SELECT policy.
--   3. scoring_rules_validate refuses each F578 usage key as a CONTEXT key
--      (the TS validator's words), and still accepts a scorable key; it keeps
--      IMMUTABLE + search_path '' and its EXECUTE REVOKE from anon.
--   4. stat_key_label_internal words the five keys (stored literals) and
--      still words an old key; it keeps search_path '' and stays REVOKEd
--      from anon / authenticated.
--
-- Determinism: fixed ids and literals; privileged fixture work only.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(23);

-- ---------------------------------------------------------------------------
-- 1. The column and its CHECK
-- ---------------------------------------------------------------------------
select has_column('public', 'players', 'forty_time', 'players.forty_time exists');
select col_type_is('public', 'players', 'forty_time', 'numeric(3,2)', 'forty_time is NUMERIC(3,2)');
select col_is_null('public', 'players', 'forty_time', 'forty_time is nullable (NULL = no recorded time)');

insert into players (id, full_name, position, team) values ('pit143-a', 'PIT143 A', 'WR', 'AAA');

select lives_ok($$ update players set forty_time = 4.38 where id = 'pit143-a' $$, 'a real 40 time is stored');
select is((select forty_time from players where id = 'pit143-a'), 4.38::numeric, 'stored exactly (4.38)');
select lives_ok($$ update players set forty_time = 3.51 where id = 'pit143-a' $$, '3.51 is admitted (just above the floor)');
select lives_ok($$ update players set forty_time = 6.99 where id = 'pit143-a' $$, '6.99 is admitted (just below the ceiling)');
select throws_ok($$ update players set forty_time = 3.50 where id = 'pit143-a' $$, '23514', null, '3.50 is refused (the floor is exclusive)');
select throws_ok($$ update players set forty_time = 7.00 where id = 'pit143-a' $$, '23514', null, '7.00 is refused (the ceiling is exclusive)');
select lives_ok($$ update players set forty_time = null where id = 'pit143-a' $$, 'NULL is admitted');

-- ---------------------------------------------------------------------------
-- 2. No client write (RETURNING counts per role)
-- ---------------------------------------------------------------------------
set local role anon;
select results_eq($$ with w as (update players set forty_time = 4.5 where id = 'pit143-a' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'anon UPDATE of forty_time touches 0 rows');
reset role;
set local role authenticated;
select results_eq($$ with w as (update players set forty_time = 4.5 where id = 'pit143-a' returning 1) select count(*) from w $$,
  $$ values (0::bigint) $$, 'authenticated UPDATE of forty_time touches 0 rows');
select throws_ok($$ insert into players (id, full_name, position, forty_time) values ('pit143-b', 'X', 'WR', 4.4) $$,
  '42501', null, 'authenticated INSERT into players is refused');
reset role;
select is((select forty_time from players where id = 'pit143-a'), null::numeric, 'the row is unchanged after both attempts');
select is((select count(*)::int from pg_policy where polrelid = 'public.players'::regclass), 1, 'players still carries exactly one policy');
select is((select polcmd::text from pg_policy where polrelid = 'public.players'::regclass), 'r', '… and it is SELECT');

-- ---------------------------------------------------------------------------
-- 3. The validator: the usage keys are CONTEXT keys
-- ---------------------------------------------------------------------------
select throws_like($$ select scoring_rules_validate('{"off_snaps": 1}'::jsonb) $$, '%it is a context key%', 'off_snaps is refused as a context key');
create temp table usage_verdicts (k text, msg text);
do $$
declare k text;
begin
  foreach k in array array['pass_rz_att', 'rush_rz_att', 'rec_rz_tgt', 'fg_long'] loop
    begin
      perform public.scoring_rules_validate(jsonb_build_object(k, 1));
      insert into usage_verdicts values (k, 'ACCEPTED');
    exception when others then
      insert into usage_verdicts values (k, sqlerrm);
    end;
  end loop;
end $$;
select is((select count(*)::int from usage_verdicts where msg like '%it is a context key%'), 4, 'pass_rz_att / rush_rz_att / rec_rz_tgt / fg_long are each refused as context keys');
select lives_ok($$ select scoring_rules_validate('{"receptions": 1}'::jsonb) $$, 'a scorable key is still accepted');
select ok(
  (select provolatile = 'i' and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.scoring_rules_validate(jsonb)'::regprocedure),
  'scoring_rules_validate stays IMMUTABLE with search_path pinned empty');
select ok(not has_function_privilege('anon', 'public.scoring_rules_validate(jsonb)', 'execute'), 'anon still cannot EXECUTE scoring_rules_validate');

-- ---------------------------------------------------------------------------
-- 4. The correction words
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select array_agg(stat_key_label_internal(k) order by o) from unnest(array['off_snaps', 'pass_rz_att', 'rush_rz_att', 'rec_rz_tgt', 'fg_long', 'receiving_yards']) with ordinality u(k, o) $$,
  $$ values (array['offensive snaps', 'red-zone pass attempts', 'red-zone rush attempts', 'red-zone targets', 'longest FG made', 'receiving yards']) $$,
  'stat_key_label_internal words the five usage keys (and still an old one)');
select ok(
  (select proconfig @> array['search_path=""'] and not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute')
     from pg_proc where oid = 'public.stat_key_label_internal(text)'::regprocedure),
  'stat_key_label_internal keeps search_path empty and stays REVOKEd from anon / authenticated');

select * from finish();
rollback;
