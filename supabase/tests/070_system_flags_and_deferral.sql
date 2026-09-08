-- ============================================================================
-- system_flags + the score_fanout deferral — pgTAP 070 (task L.D2.3;
-- migration 122; spec v2.16.32 §14 / §22.3 / §23.2 / §24.1; PROGRESS D322 /
-- F217 / F263(e) / R872; tasks-M4 §4 rules 1–11 — rule 10 (loud emptiness,
-- idempotence) and rule 9's D146 (one-unit boundaries) + D276 (no "by
-- construction" without the pin beside it).
--
-- Numbering: pgTAP head measured 069 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 070 (D161/D166).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * SYSTEM_FLAGS FORM + ROLES: the table, its PK, the is-object CHECK
--     (23514 on a non-object value), RLS on with exactly the one
--     world-SELECT policy; anon AND authenticated read the planted row,
--     cannot INSERT (42501 — no policy), and UPDATE / DELETE RETURNING 0
--     rows (the §4.2 pattern); the row is byte-identical after the walk.
--   * THE PAIR'S SIGNATURES: the 2-argument `score_fanout_ack(uuid, jsonb)`
--     is GONE (dropped, 115's precedent); the 4-argument one is SECURITY
--     DEFINER + search_path='' + REVOKEd from anon / authenticated, and
--     service_role CAN execute it (the positive half); the claim's
--     signature and privileges are unchanged.
--   * THE DEFERRAL BY STAMP: one ack consumes p1, defers p2 + p3 to
--     12:00:30 and releases p4 + p5 — ONE stored jsonb literal (deleted 1,
--     deferred 2, released 4, missed []); the deferred rows are UNLEASED
--     and stamped, the released rows unstamped.
--   * THE BOUNDARY (D146): a claim at 12:00:29.999999 returns exactly the
--     two undeferred rows; a claim at 12:00:30 exactly returns all four
--     (inclusive release, `<=`).
--   * THE RE-STAMP CLEARS IT: the SQL twin of ingestion's upsert (the
--     payload's columns — `enqueued_at` + `deferred_until = NULL`) makes a
--     deferred row claimable at once.
--   * A MOVED STAMP IS NEVER DEFERRED: a row re-stamped under the lease is
--     released, not deferred (deferred 0; the delta is newer than the hold).
--   * ANOTHER TOKEN'S ROW IS NEVER TOUCHED: deferring a row leased under a
--     different token stamps nothing and leaves the lease intact.
--   * SHAPE: p_deferred non-array / a missing key / a non-empty p_deferred
--     with NULL p_defer_until each refused (22023) beside the success twin;
--     the in-body JWT refusal (42501) at the new signature; idempotence
--     (the same ack again defers 0).
--   * All privileged work runs as postgres (auth.uid() NULL — the pair's
--     own precondition).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';   -- the stamps below are stored literals

select plan(62);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select has_table('public', 'system_flags', 'A1 system_flags exists (122, F217)');
select columns_are('public', 'system_flags', array['key', 'value', 'updated_at'],
  'A1b exact column set (key, value, updated_at)');
select col_is_pk('public', 'system_flags', 'key', 'A1c key is the PK — one row per flag');
select col_not_null('public', 'system_flags', 'value', 'A1d value NOT NULL');
select ok((select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'system_flags'),
  'A2 RLS is ON for system_flags');
select policies_are('public', 'system_flags', array['system_flags readable by everyone'],
  'A2b exactly ONE policy — the world SELECT; no write policy for any role');
select throws_ok(
  $$ insert into system_flags (key, value) values ('q70-bad', '[1]'::jsonb) $$,
  '23514', null,
  'A3 the is-object CHECK refuses a non-object value (23514)');

select has_column('public', 'score_fanout', 'deferred_until', 'A4 score_fanout.deferred_until exists (122, R872)');
select col_is_null('public', 'score_fanout', 'deferred_until', 'A4b …nullable (NULL = not deferred)');

select hasnt_function('public', 'score_fanout_ack', array['uuid', 'jsonb'],
  'A5 the 2-argument score_fanout_ack(uuid, jsonb) is GONE (dropped — 115''s precedent)');
select has_function('public', 'score_fanout_ack', array['uuid', 'jsonb', 'jsonb', 'timestamptz'],
  'A5b the 4-argument score_fanout_ack(uuid, jsonb, jsonb, timestamptz) exists');
select is((select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'score_fanout_ack'), true,
  'A5c …SECURITY DEFINER');
select ok((select 'search_path=""' = any(proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'score_fanout_ack'),
  'A5d …with search_path pinned empty');
select ok(
  not has_function_privilege('authenticated', 'public.score_fanout_ack(uuid, jsonb, jsonb, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.score_fanout_ack(uuid, jsonb, jsonb, timestamptz)', 'EXECUTE'),
  'A5e …REVOKEd from authenticated and anon');
select ok(
  has_function_privilege('service_role', 'public.score_fanout_ack(uuid, jsonb, jsonb, timestamptz)', 'EXECUTE'),
  'A5f …and service_role CAN execute it (the positive half)');
select has_function('public', 'score_fanout_claim', array['integer', 'integer', 'timestamptz'],
  'A6 the claim keeps 121''s signature');
select ok(
  not has_function_privilege('authenticated', 'public.score_fanout_claim(integer, integer, timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.score_fanout_claim(integer, integer, timestamptz)', 'EXECUTE'),
  'A6b …and its privileges (authenticated cannot, service_role can)');

-- ---------------------------------------------------------------------------
-- B. system_flags — the role walk (RETURNING counts, §4.2)
-- ---------------------------------------------------------------------------
insert into system_flags (key, value, updated_at) values
  ('q70-flag', '{"degraded": true, "consecutive_failures": 3}'::jsonb, '2026-09-07 11:00:00+00');

set local role anon;
select is((select count(*) from system_flags where key = 'q70-flag'), 1::bigint, 'B1 ANON reads the flag (world SELECT — the banner''s read)');
select throws_ok(
  $$ insert into system_flags (key, value) values ('q70-anon', '{}'::jsonb) $$,
  '42501', null,
  'B2 ANON cannot INSERT (no write policy — 42501)');
select results_eq(
  $$ with u as (update system_flags set value = '{}'::jsonb where key = 'q70-flag' returning 1) select count(*) from u $$,
  $$ values (0::bigint) $$,
  'B3 ANON cannot UPDATE — RETURNING 0 rows');
select results_eq(
  $$ with d as (delete from system_flags where key = 'q70-flag' returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'B4 ANON cannot DELETE — RETURNING 0 rows');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*) from system_flags where key = 'q70-flag'), 1::bigint, 'B5 AUTHENTICATED reads the flag');
select throws_ok(
  $$ insert into system_flags (key, value) values ('q70-auth', '{}'::jsonb) $$,
  '42501', null,
  'B5b AUTHENTICATED cannot INSERT (42501)');
select results_eq(
  $$ with u as (update system_flags set value = '{}'::jsonb where key = 'q70-flag' returning 1) select count(*) from u $$,
  $$ values (0::bigint) $$,
  'B5c AUTHENTICATED cannot UPDATE — RETURNING 0 rows');
select results_eq(
  $$ with d as (delete from system_flags where key = 'q70-flag' returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'B5d AUTHENTICATED cannot DELETE — RETURNING 0 rows');
reset role;
select set_config('request.jwt.claims', '', true);

select is((select (value, updated_at) from system_flags where key = 'q70-flag'),
  ('{"degraded": true, "consecutive_failures": 3}'::jsonb, '2026-09-07 11:00:00+00'::timestamptz),
  'B6 …the row is byte-identical after the walk');
select is((select count(*) from system_flags where key like 'q70-%'), 1::bigint, 'B6b …and no client row was inserted');

-- ---------------------------------------------------------------------------
-- C. Fixture + shape refusals at the new signature
-- ---------------------------------------------------------------------------
insert into players (id, full_name, position, adp) values
  ('q70-p1', 'Q70 WR 1', 'WR', 0.001),
  ('q70-p2', 'Q70 WR 2', 'WR', 0.002),
  ('q70-p3', 'Q70 WR 3', 'WR', 0.003),
  ('q70-p4', 'Q70 WR 4', 'WR', 0.004),
  ('q70-p5', 'Q70 WR 5', 'WR', 0.005);

insert into score_fanout (season, week, player_id, enqueued_at) values
  (2026, 1, 'q70-p1', '2026-09-07 11:00:00+00'),
  (2026, 1, 'q70-p2', '2026-09-07 11:01:00+00'),
  (2026, 1, 'q70-p3', '2026-09-07 11:02:00+00'),
  (2026, 1, 'q70-p4', '2026-09-07 11:03:00+00'),
  (2026, 1, 'q70-p5', '2026-09-07 11:04:00+00');

select is((select count(*) from score_fanout where player_id like 'q70-%' and deferred_until is null), 5::bigint,
  'C0 five rows queued, none deferred');

select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[]'::jsonb, '{}'::jsonb, '2026-09-07 12:00:30+00') $$, '22023', null,
  'C1 p_deferred must be an array');
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[]'::jsonb, '[{"season": 2026, "week": 1, "player_id": "q70-p2"}]'::jsonb, '2026-09-07 12:00:30+00') $$, '22023', null,
  'C1b …of objects carrying enqueued_at');
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[]'::jsonb, '[{"season": 2026, "week": 1, "player_id": "q70-p2", "enqueued_at": "2026-09-07T11:01:00+00:00"}]'::jsonb, null) $$, '22023', null,
  'C2 a non-empty p_deferred with a NULL p_defer_until is refused');
select is(
  public.score_fanout_ack(gen_random_uuid(), '[]'::jsonb, '[{"season": 2026, "week": 1, "player_id": "q70-p2", "enqueued_at": "2026-09-07T11:01:00+00:00"}]'::jsonb, '2026-09-07 12:00:30+00'),
  '{"missed": [], "deleted": 0, "deferred": 0, "released": 0}'::jsonb,
  'C2b …the success twin: the same call with p_defer_until set lives (an unknown token defers nothing)');
select lives_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[]'::jsonb) $$,
  'C3 the 2-argument CALL still resolves through the DEFAULTs (121''s callers unchanged)');

select set_config('request.jwt.claims', '{"sub": "97000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[]'::jsonb, '[]'::jsonb, null) $$, '42501', null,
  'C4 a signed-in caller cannot ack at the new signature (42501 in-body)');
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- D. The deferral by stamp — one ack: consume p1, defer p2 + p3, release p4 + p5
-- ---------------------------------------------------------------------------
create temp table q70_c1 as select * from public.score_fanout_claim(5, 120, '2026-09-07 12:00:00+00');
select is((select count(*) from q70_c1), 5::bigint, 'D0 claim(5) at 12:00 leases all five');
select set_config('pgtap.tok', (select (array_agg(distinct claim_token))[1]::text from q70_c1), true);

select is(
  public.score_fanout_ack(
    current_setting('pgtap.tok')::uuid,
    (select jsonb_agg(jsonb_build_object('season', season, 'week', week, 'player_id', player_id, 'enqueued_at', enqueued_at)) from q70_c1 where player_id = 'q70-p1'),
    (select jsonb_agg(jsonb_build_object('season', season, 'week', week, 'player_id', player_id, 'enqueued_at', enqueued_at)) from q70_c1 where player_id in ('q70-p2', 'q70-p3')),
    '2026-09-07 12:00:30+00'),
  '{"missed": [], "deleted": 1, "deferred": 2, "released": 4}'::jsonb,
  'D1 the ack literal: p1 deleted, p2 + p3 deferred, four rows handed back (deferred + released), nothing missed');
select is((select count(*) from score_fanout where player_id = 'q70-p1'), 0::bigint, 'D1b p1 is gone (consumed)');
select is((select array_agg(player_id order by player_id) from score_fanout
            where player_id like 'q70-%' and deferred_until = '2026-09-07 12:00:30+00'::timestamptz),
  array['q70-p2', 'q70-p3'],
  'D2 p2 + p3 carry deferred_until = 12:00:30');
select is((select count(*) from score_fanout where player_id in ('q70-p2', 'q70-p3') and claim_token is null and claimed_at is null), 2::bigint,
  'D2b …and are UNLEASED (deferred, never leased-and-hidden)');
select is((select array_agg(player_id order by player_id) from score_fanout
            where player_id like 'q70-%' and deferred_until is null),
  array['q70-p4', 'q70-p5'],
  'D3 p4 + p5 are released with NO deferral');
select is((select count(*) from score_fanout where player_id like 'q70-%' and claim_token is not null), 0::bigint,
  'D3b …every q70 row is unleased after the ack');

-- The boundary (D146): one microsecond before the deferral lifts, only the
-- undeferred rows are claimable; AT the instant, all four.
create temp table q70_c2 as select * from public.score_fanout_claim(5, 120, '2026-09-07 12:00:29.999999+00');
select is((select array_agg(player_id order by player_id) from q70_c2), array['q70-p4', 'q70-p5'],
  'D4 a claim ONE MICROSECOND before deferred_until returns only p4 + p5 (the deferred rows are skipped)');
select lives_ok(
  $$ select public.score_fanout_ack((select (array_agg(distinct claim_token))[1] from q70_c2), '[]'::jsonb) $$,
  'D4b …released again (an empty ack)');

create temp table q70_c3 as select * from public.score_fanout_claim(5, 120, '2026-09-07 12:00:30+00');
select is((select array_agg(player_id order by player_id) from q70_c3), array['q70-p2', 'q70-p3', 'q70-p4', 'q70-p5'],
  'D5 a claim AT deferred_until exactly returns all four (inclusive release, <=)');
select is((select count(distinct claim_token) from q70_c3), 1::bigint, 'D5b …under ONE token');
select lives_ok(
  $$ select public.score_fanout_ack((select (array_agg(distinct claim_token))[1] from q70_c3), '[]'::jsonb) $$,
  'D5c …released again');
select is((select count(*) from score_fanout where player_id in ('q70-p2', 'q70-p3') and deferred_until = '2026-09-07 12:00:30+00'::timestamptz), 2::bigint,
  'D5d …a plain release leaves a past deferral in place (harmless: <= p_now); only a re-stamp or a new deferral moves it');

-- Idempotence (rule 10): the same ack again — the token no longer holds anything.
select is(
  public.score_fanout_ack(
    current_setting('pgtap.tok')::uuid,
    '[]'::jsonb,
    (select jsonb_agg(jsonb_build_object('season', season, 'week', week, 'player_id', player_id, 'enqueued_at', enqueued_at)) from q70_c1 where player_id in ('q70-p2', 'q70-p3')),
    '2026-09-07 12:09:00+00'),
  '{"missed": [], "deleted": 0, "deferred": 0, "released": 0}'::jsonb,
  'D6 the same ack again defers 0 / releases 0 (the token holds nothing — idempotent)');
select is((select count(*) from score_fanout where player_id in ('q70-p2', 'q70-p3') and deferred_until = '2026-09-07 12:00:30+00'::timestamptz), 2::bigint,
  'D6b …and the old deferral is untouched');

-- ---------------------------------------------------------------------------
-- E. The re-stamp CLEARS a deferral (ingestion's payload: enqueued_at +
--    deferred_until = NULL — the SQL twin of the PostgREST upsert)
-- ---------------------------------------------------------------------------
create temp table q70_c4 as select * from public.score_fanout_claim(1, 120, '2026-09-07 12:10:00+00');
select is((select array_agg(player_id) from q70_c4), array['q70-p2'], 'E0 claim(1) at 12:10 takes the oldest, p2');
select is(
  public.score_fanout_ack(
    (select (array_agg(distinct claim_token))[1] from q70_c4),
    '[]'::jsonb,
    (select jsonb_agg(jsonb_build_object('season', season, 'week', week, 'player_id', player_id, 'enqueued_at', enqueued_at)) from q70_c4),
    '2026-09-07 12:20:00+00'),
  '{"missed": [], "deleted": 0, "deferred": 1, "released": 1}'::jsonb,
  'E0b …deferred to 12:20');
select is((select array_agg(player_id) from public.score_fanout_claim(5, 120, '2026-09-07 12:11:00+00') where player_id = 'q70-p2'), null,
  'E1 at 12:11 p2 is NOT claimable (deferred to 12:20)');
-- (release that claim's other rows)
select lives_ok(
  $$ select public.score_fanout_ack((select claim_token from score_fanout where player_id = 'q70-p3'), '[]'::jsonb) $$,
  'E1b …the rest released');

insert into score_fanout (season, week, player_id, enqueued_at, deferred_until)
  values (2026, 1, 'q70-p2', '2026-09-07 12:12:00+00', null)
  on conflict (season, week, player_id)
  do update set enqueued_at = excluded.enqueued_at, deferred_until = excluded.deferred_until;
select is((select (enqueued_at, deferred_until) from score_fanout where player_id = 'q70-p2'),
  ('2026-09-07 12:12:00+00'::timestamptz, null::timestamptz),
  'E2 the re-stamp moved the stamp and CLEARED deferred_until');
create temp table q70_c5 as select * from public.score_fanout_claim(5, 120, '2026-09-07 12:12:00+00');
select ok((select 'q70-p2' = any(array_agg(player_id)) from q70_c5),
  'E3 …and p2 is claimable at once (a fresh delta never waits out a hold)');
select lives_ok(
  $$ select public.score_fanout_ack((select (array_agg(distinct claim_token))[1] from q70_c5), '[]'::jsonb) $$,
  'E3b …released');

-- ---------------------------------------------------------------------------
-- F. A row whose stamp MOVED under the lease is released, never deferred
-- ---------------------------------------------------------------------------
create temp table q70_c6 as select * from public.score_fanout_claim(5, 120, '2026-09-07 12:30:00+00');
select set_config('pgtap.tok6', (select (array_agg(distinct claim_token))[1]::text from q70_c6), true);
-- ingestion's re-stamp while p3 is leased (the lease survives — 069 E1b's twin)
insert into score_fanout (season, week, player_id, enqueued_at, deferred_until)
  values (2026, 1, 'q70-p3', '2026-09-07 12:31:00+00', null)
  on conflict (season, week, player_id)
  do update set enqueued_at = excluded.enqueued_at, deferred_until = excluded.deferred_until;
select is((select claim_token::text from score_fanout where player_id = 'q70-p3'), current_setting('pgtap.tok6'),
  'F0 the re-stamp kept the lease (121''s mechanism)');
select is(
  public.score_fanout_ack(
    current_setting('pgtap.tok6')::uuid,
    '[]'::jsonb,
    (select jsonb_agg(jsonb_build_object('season', season, 'week', week, 'player_id', player_id, 'enqueued_at', enqueued_at)) from q70_c6 where player_id = 'q70-p3'),
    '2026-09-07 12:35:00+00'),
  '{"missed": [], "deleted": 0, "deferred": 0, "released": 4}'::jsonb,
  'F1 deferring p3 at its OLD stamp stamps nothing (by-stamp — the newer delta is ready); every leased row is released');
select is((select (deferred_until, claim_token) from score_fanout where player_id = 'q70-p3'), (null::timestamptz, null::uuid),
  'F1b …p3 is unleased and NOT deferred');

-- ---------------------------------------------------------------------------
-- G. Another token's row is never touched by a deferral
-- ---------------------------------------------------------------------------
create temp table q70_c7 as select * from public.score_fanout_claim(1, 120, '2026-09-07 12:40:00+00');
select is((select array_agg(player_id) from q70_c7), array['q70-p4'], 'G0 claim(1) at 12:40 takes p4 (the oldest stamp now)');
select is(
  public.score_fanout_ack(
    'dd000000-0000-4000-8000-000000000001'::uuid,
    '[]'::jsonb,
    (select jsonb_agg(jsonb_build_object('season', season, 'week', week, 'player_id', player_id, 'enqueued_at', enqueued_at)) from q70_c7),
    '2026-09-07 12:45:00+00'),
  '{"missed": [], "deleted": 0, "deferred": 0, "released": 0}'::jsonb,
  'G1 a foreign token deferring p4 stamps nothing');
select is((select (claim_token, deferred_until) from score_fanout where player_id = 'q70-p4'),
  ((select (array_agg(distinct claim_token))[1] from q70_c7), null::timestamptz),
  'G1b …p4''s lease is intact and it is not deferred');

select * from finish();
rollback;
