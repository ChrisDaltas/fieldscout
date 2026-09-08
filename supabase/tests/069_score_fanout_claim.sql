-- ============================================================================
-- The `score_fanout` claim + ack pair — pgTAP 069 (task L.D2.2, PR #267 fix
-- round; migration 121; spec v2.16.31 §22.2 / §22.3 / §23.2; PROGRESS D292
-- / D321(2)(10) / F218 / F263(d)(f); R866 / R867 / R869 / R872; tasks-M4 §4
-- rules 1–11 — rule 10 (the worker is idempotent; loud emptiness) and rule
-- 9's D276 (no "by construction" without the pin beside it).
--
-- Numbering: pgTAP head measured 068 at task time (ls supabase/tests/ |
-- tail -1) ⇒ 069 (D161/D166).
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--   * THE LEASE IN ONE SESSION: five rows at literal stamps (one of them
--     `DEFAULT now()` — the R867 shape); claim(2) twice and claim(2) once
--     more return three DISJOINT sets whose union is the queue, under three
--     distinct tokens, `claimed_at` = the injected `p_now`; a fourth claim at
--     the same instant returns NOTHING (all leased). The two-session half —
--     two real PostgREST transactions claiming disjoint rows — is the stack
--     suite's (`score-week-worker-db.test.ts`, "THE LEASE"); the `FOR UPDATE
--     SKIP LOCKED` clause itself is pinned BY TEXT here (A4: a second
--     session cannot see this transaction's uncommitted fixture, so its
--     non-blocking behaviour is not measurable inside pgTAP — said, D267).
--   * THE RE-STAMP KEEPS THE LEASE (the R866 mechanism): the SQL twin of
--     ingestion's PostgREST upsert (`ON CONFLICT … DO UPDATE SET
--     enqueued_at` — the payload's columns and nothing else) moves a leased
--     row's stamp and leaves `claimed_at` / `claim_token` byte-identical; a
--     claim at the same instant still returns NOTHING.
--   * THE EXPIRY BOUNDARY (D146's one-unit rule): at `claimed_at + 120 s`
--     exactly the lease HOLDS (strict `<`); at +121 s every row is claimable
--     again under a NEW token. The −1 s side (+119 s) holds too.
--   * THE ACK BY (TOKEN, STAMP): a consumed row at its claimed stamp is
--     DELETED (the six-digit stamp round-trips through jsonb text exactly —
--     R867's twin: a `now()`-stamped row rendered by `to_jsonb` is acked);
--     the classification is what is MEASURED (R869) — `restamped` (present,
--     our token, a newer stamp), `lease_lost` (present, another token),
--     `gone` (absent) — as ONE stored jsonb literal; every row still under
--     the token is RELEASED (both lease columns NULL), a row under another
--     token is NOT touched; the same ack again deletes 0 and releases 0
--     (idempotent, rule 10); an unknown token releases nothing.
--   * SHAPE: every 22023 refusal (p_batch 0 / 1001 / NULL; p_lease_seconds
--     0; p_now NULL; a NULL token; a non-array; a non-object element; a
--     missing key; a string season; an unparseable stamp) beside the
--     success twin one unit away (p_batch 1 and 1000 succeed).
--   * FORM: both functions SECURITY DEFINER + search_path='' + REVOKEd from
--     authenticated / anon, and service_role CAN execute (the positive
--     half); the in-body JWT refusal (42501) for both, set + reset
--     (D49(7)); the two lease columns nullable with the pair CHECK (23514
--     one side set); held-lock < 50 ms for the claim (rule 8).
--   * All privileged work runs as postgres (auth.uid() NULL — the pair's
--     own precondition).
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';   -- the stamps below are stored literals

select plan(79);

-- ---------------------------------------------------------------------------
-- A. Form pins
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p where p.proname = 'score_fanout_claim'),
  'A1 score_fanout_claim is SECURITY DEFINER with search_path=''''');
select ok(
  not has_function_privilege('authenticated', 'public.score_fanout_claim(integer, integer, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.score_fanout_claim(integer, integer, timestamptz)', 'EXECUTE'),
  'A1b …REVOKEd from authenticated + anon (the worker''s queue, no user path)');
select ok(
  has_function_privilege('service_role', 'public.score_fanout_claim(integer, integer, timestamptz)', 'EXECUTE'),
  'A1c …and service_role CAN execute it (the positive half)');
select ok(
  (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p where p.proname = 'score_fanout_ack'),
  'A2 score_fanout_ack is SECURITY DEFINER with search_path=''''');
select ok(
  not has_function_privilege('authenticated', 'public.score_fanout_ack(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.score_fanout_ack(uuid, jsonb)', 'EXECUTE'),
  'A2b …REVOKEd from authenticated + anon');
select ok(
  has_function_privilege('service_role', 'public.score_fanout_ack(uuid, jsonb)', 'EXECUTE'),
  'A2c …and service_role CAN execute it');
select has_column('public', 'score_fanout', 'claimed_at', 'A3 score_fanout.claimed_at exists (121)');
select col_type_is('public', 'score_fanout', 'claimed_at', 'timestamp with time zone', 'A3b …timestamptz');
select col_is_null('public', 'score_fanout', 'claimed_at', 'A3c …nullable (NULL = unclaimed)');
select has_column('public', 'score_fanout', 'claim_token', 'A3d score_fanout.claim_token exists (121)');
select col_type_is('public', 'score_fanout', 'claim_token', 'uuid', 'A3e …uuid');
select col_is_null('public', 'score_fanout', 'claim_token', 'A3f …nullable');
select ok(
  (select pg_get_functiondef(p.oid) ilike '%FOR UPDATE SKIP LOCKED%'
   from pg_proc p where p.proname = 'score_fanout_claim'),
  'A4 the claim carries FOR UPDATE SKIP LOCKED (§22.3''s idiom — pinned by TEXT: a second session cannot see this transaction''s fixture, so non-blocking is the stack suite''s two-session cell)');
select policies_are('public', 'score_fanout', array[]::text[],
  'A5 score_fanout keeps ZERO policies after 121 — service_role alone reads and writes the queue (109)');

-- ---------------------------------------------------------------------------
-- B. Fixture: five players, five queue rows at literal stamps (p5 = DEFAULT now(),
--    the R867 shape).
-- ---------------------------------------------------------------------------
insert into players (id, full_name, position, adp) values
  ('q69-p1', 'Q69 WR 1', 'WR', 0.001),
  ('q69-p2', 'Q69 WR 2', 'WR', 0.002),
  ('q69-p3', 'Q69 WR 3', 'WR', 0.003),
  ('q69-p4', 'Q69 WR 4', 'WR', 0.004),
  ('q69-p5', 'Q69 WR 5', 'WR', 0.005),
  ('q69-p9', 'Q69 WR 9', 'WR', 0.009);

insert into score_fanout (season, week, player_id, enqueued_at) values
  (2026, 1, 'q69-p1', '2026-09-07 11:00:00.123456+00'),
  (2026, 1, 'q69-p2', '2026-09-07 11:01:00+00'),
  (2026, 1, 'q69-p3', '2026-09-07 11:02:00+00'),
  (2026, 1, 'q69-p4', '2026-09-07 11:03:00+00');
insert into score_fanout (season, week, player_id) values (2026, 1, 'q69-p5');   -- DEFAULT now(): six digits

select throws_ok(
  $$ update score_fanout set claimed_at = now() where player_id = 'q69-p1' $$,
  '23514', null,
  'B1 the pair CHECK: claimed_at without claim_token is refused (23514)');
select throws_ok(
  $$ update score_fanout set claim_token = gen_random_uuid() where player_id = 'q69-p1' $$,
  '23514', null,
  'B1b …and claim_token without claimed_at');
select is((select count(*) from score_fanout where player_id like 'q69-%' and claimed_at is null and claim_token is null),
  5::bigint, 'B2 five rows queued, none leased');

-- ---------------------------------------------------------------------------
-- C. Shape refusals (22023) beside the one-unit-away successes
-- ---------------------------------------------------------------------------
select throws_ok($$ select * from public.score_fanout_claim(0) $$, '22023', null, 'C1 p_batch 0 is refused');
select throws_ok($$ select * from public.score_fanout_claim(1001) $$, '22023', null, 'C1b p_batch 1001 is refused (the PostgREST cap bounds a claim)');
select throws_ok($$ select * from public.score_fanout_claim(null) $$, '22023', null, 'C1c p_batch NULL is refused');
select throws_ok($$ select * from public.score_fanout_claim(1, 0) $$, '22023', null, 'C2 p_lease_seconds 0 is refused');
select throws_ok($$ select * from public.score_fanout_claim(1, 120, null) $$, '22023', null, 'C3 p_now NULL is refused (the injected instant, D291)');
select throws_ok($$ select public.score_fanout_ack(null, '[]'::jsonb) $$, '22023', null, 'C4 ack: a NULL token is refused');
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '{}'::jsonb) $$, '22023', null, 'C5 ack: p_consumed must be an array');
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[1]'::jsonb) $$, '22023', null, 'C5b …of objects');
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[{"season": 2026, "week": 1, "player_id": "q69-p1"}]'::jsonb) $$, '22023', null, 'C5c …each carrying enqueued_at');
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[{"season": "2026", "week": 1, "player_id": "q69-p1", "enqueued_at": "2026-09-07T11:00:00+00:00"}]'::jsonb) $$, '22023', null, 'C5d …season/week as JSON numbers');
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[{"season": 2026, "week": 1, "player_id": "q69-p1", "enqueued_at": "nope"}]'::jsonb) $$, '22023', null, 'C5e …a parseable stamp');
select lives_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[]'::jsonb) $$, 'C6 ack: an empty array under an unknown token is a no-op release, not an error');

-- JWT refusal (42501) — set + reset (D49(7)).
select set_config('request.jwt.claims', '{"sub": "97000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select throws_ok($$ select * from public.score_fanout_claim(1) $$, '42501', null,
  'C7 a signed-in caller cannot claim (42501 in-body, before validation)');
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[]'::jsonb) $$, '42501', null,
  'C7b …nor ack');
select set_config('request.jwt.claims', '', true);
select is((select count(*) from score_fanout where player_id like 'q69-%' and claim_token is not null), 0::bigint,
  'C8 …and nothing was leased by the refusals');

-- ---------------------------------------------------------------------------
-- D. The claim: oldest first, one token per call, claimed_at = p_now,
--    disjoint across calls, nothing once everything is leased.
-- ---------------------------------------------------------------------------
create temp table q69_c1 as select * from public.score_fanout_claim(2, 120, '2026-09-07 12:00:00+00');
select is((select array_agg(player_id order by enqueued_at) from q69_c1), array['q69-p1', 'q69-p2'],
  'D1 claim(2) at T0 returns the two OLDEST rows (p1, p2)');
select is((select count(distinct claim_token) from q69_c1), 1::bigint, 'D1b …under ONE token');
select is((select bool_and(claimed_at = '2026-09-07 12:00:00+00') from q69_c1), true, 'D1c …claimed_at = the injected p_now (D291)');
select is((select enqueued_at from q69_c1 where player_id = 'q69-p1'), '2026-09-07 11:00:00.123456+00'::timestamptz,
  'D1d …the stamp comes back with all six digits (R867: the ack''s key is this value, verbatim)');
select is((select count(*) from score_fanout where player_id in ('q69-p1', 'q69-p2') and claim_token = (select (array_agg(distinct claim_token))[1] from q69_c1) and claimed_at = '2026-09-07 12:00:00+00'),
  2::bigint, 'D1e …and the rows carry the lease');

create temp table q69_c2 as select * from public.score_fanout_claim(2, 120, '2026-09-07 12:00:00+00');
select is((select array_agg(player_id order by enqueued_at) from q69_c2), array['q69-p3', 'q69-p4'],
  'D2 a second claim(2) at the SAME instant returns the next two (p3, p4) — the lease hides p1/p2');
select isnt((select (array_agg(distinct claim_token))[1] from q69_c2), (select (array_agg(distinct claim_token))[1] from q69_c1), 'D2b …under a DIFFERENT token');

create temp table q69_c3 as select * from public.score_fanout_claim(2, 120, '2026-09-07 12:00:00+00');
select is((select array_agg(player_id) from q69_c3), array['q69-p5'], 'D3 a third claim(2) returns the one row left (p5)');
select is((select count(*) from public.score_fanout_claim(2, 120, '2026-09-07 12:00:00+00')), 0::bigint,
  'D4 a fourth claim at T0 returns NOTHING — every row is leased (the worker names this `all_leased`)');
select is((select count(*) from score_fanout where player_id like 'q69-%' and claim_token is not null), 5::bigint,
  'D5 the three claims'' union is the whole queue');
select is((select count(distinct claim_token) from score_fanout where player_id like 'q69-%'), 3::bigint,
  'D5b …under three distinct tokens — pairwise disjoint (a row carries exactly one token)');
select is((select count(*) from public.score_fanout_claim(1000, 120, '2026-09-07 12:00:00+00')), 0::bigint,
  'D6 p_batch 1000 (the cap, one unit inside C1b) is accepted');
select lives_ok($$ select * from public.score_fanout_claim(1, 1, '2026-09-07 12:00:00+00') $$,
  'D6b p_lease_seconds 1 (one unit above C2) is accepted');

-- ---------------------------------------------------------------------------
-- E. The re-stamp KEEPS the lease (the R866 mechanism) — the SQL twin of
--    ingestion's PostgREST upsert: only the payload's columns are SET.
-- ---------------------------------------------------------------------------
insert into score_fanout (season, week, player_id, enqueued_at) values (2026, 1, 'q69-p2', '2026-09-07 11:30:00+00')
  on conflict (season, week, player_id) do update set enqueued_at = excluded.enqueued_at;
select is((select enqueued_at from score_fanout where player_id = 'q69-p2'), '2026-09-07 11:30:00+00'::timestamptz,
  'E1 the re-enqueue MOVED p2''s stamp (D321(2))');
select is((select (claim_token, claimed_at) from score_fanout where player_id = 'q69-p2'),
  (select (claim_token, claimed_at) from q69_c1 where player_id = 'q69-p2'),
  'E1b …and left the lease byte-identical (token + claimed_at)');
select is((select count(*) from public.score_fanout_claim(5, 120, '2026-09-07 12:00:00+00')), 0::bigint,
  'E2 a claim at T0 still returns NOTHING — the newer delta waits for the drain in flight, no second drain can consume it');

-- ---------------------------------------------------------------------------
-- F. The expiry boundary (D146): T0 + 119 s / + 120 s hold; + 121 s releases.
-- ---------------------------------------------------------------------------
select is((select count(*) from public.score_fanout_claim(5, 120, '2026-09-07 12:01:59+00')), 0::bigint,
  'F1 at claimed_at + 119 s nothing is claimable');
select is((select count(*) from public.score_fanout_claim(5, 120, '2026-09-07 12:02:00+00')), 0::bigint,
  'F1b at + 120 s EXACTLY the lease still holds (strict <)');
create temp table q69_cf as select * from public.score_fanout_claim(5, 120, '2026-09-07 12:02:01+00');
select is((select array_agg(player_id order by enqueued_at, player_id) from q69_cf), array['q69-p1', 'q69-p3', 'q69-p4', 'q69-p2', 'q69-p5'],
  'F2 at + 121 s every lease has expired: all five come back, oldest stamp first (p2''s moved stamp sorts it after p4)');
select is((select count(distinct claim_token) from q69_cf), 1::bigint, 'F2b …under one NEW token');
select isnt((select (array_agg(distinct claim_token))[1] from q69_cf), (select (array_agg(distinct claim_token))[1] from q69_c1), 'F2c …not the first claim''s');
select is((select bool_and(claimed_at = '2026-09-07 12:02:01+00') from q69_cf), true, 'F2d …claimed_at moved to the new p_now');
select is((select count(*) from public.score_fanout_claim(5, 120, '2026-09-07 12:02:01+00')), 0::bigint,
  'F3 …and the same instant again returns nothing (re-leased)');

-- Held-lock discipline (rule 8): min RTT of three claims < 50 ms (empty
-- claims — every row is leased — still walk the predicate and the lock).
create temp table q69_rtt (secs double precision);
do $$
declare v_t0 timestamptz; v_i int; begin
  for v_i in 1..3 loop
    v_t0 := clock_timestamp();
    perform * from public.score_fanout_claim(5, 120, '2026-09-07 12:02:01+00');
    insert into q69_rtt values (extract(epoch from clock_timestamp() - v_t0));
  end loop;
end $$;
select cmp_ok((select min(secs) from q69_rtt), '<', 0.05::double precision,
  'F4 held-lock discipline (rule 8): the min RTT of three claims is under 50 ms');

-- ---------------------------------------------------------------------------
-- G. The ack by (token, stamp): delete / restamped / lease_lost / gone /
--    release — one stored literal.
-- ---------------------------------------------------------------------------
-- p3 is re-claimed by "another drain" (our lease on it lost).
update score_fanout set claim_token = 'cc000000-0000-4000-8000-000000000001', claimed_at = '2026-09-07 12:05:00+00' where player_id = 'q69-p3';
-- The consumed list: p1 and p5 at the stamps the claim RETURNED (p5's is
-- now()'s six digits, rendered by to_jsonb — R867's twin), p2 at its
-- ORIGINAL stamp (the drain read it before the re-stamp), p3 at its stamp
-- (lease lost), and a phantom p9 that was never queued (gone). p4 is NOT
-- consumed (a held / not-ready row) — it must be RELEASED.
select set_config('pgtap.tok', (select (array_agg(distinct claim_token))[1]::text from q69_cf), true);
select set_config('pgtap.ack', public.score_fanout_ack(
  current_setting('pgtap.tok')::uuid,
  (select jsonb_agg(jsonb_build_object('season', season, 'week', week, 'player_id', player_id, 'enqueued_at', enqueued_at) order by player_id)
     from q69_cf where player_id in ('q69-p1', 'q69-p3', 'q69-p5'))
  || jsonb_build_array(
       jsonb_build_object('season', 2026, 'week', 1, 'player_id', 'q69-p2', 'enqueued_at', '2026-09-07T11:01:00+00:00'),
       jsonb_build_object('season', 2026, 'week', 1, 'player_id', 'q69-p9', 'enqueued_at', '2026-09-07T11:01:00+00:00'))
)::text, true);
select is((current_setting('pgtap.ack')::jsonb) - 'missed', '{"deleted": 2, "released": 2}'::jsonb,
  'G1 deleted 2 (p1 at its six-digit stamp, p5 at now()''s six digits through jsonb text — exact), released 2 (p2 re-stamped, p4 unconsumed)');
select is((current_setting('pgtap.ack')::jsonb) -> 'missed',
  '[{"week": 1, "reason": "restamped", "season": 2026, "player_id": "q69-p2"},
    {"week": 1, "reason": "lease_lost", "season": 2026, "player_id": "q69-p3"},
    {"week": 1, "reason": "gone", "season": 2026, "player_id": "q69-p9"}]'::jsonb,
  'G1b the misses are what the ack MEASURED (R869): restamped / lease_lost / gone — a stored literal');
select is((select array_agg(player_id order by player_id) from score_fanout where player_id like 'q69-%'), array['q69-p2', 'q69-p3', 'q69-p4'],
  'G2 p1 and p5 are gone; p2, p3, p4 remain');
select is((select count(*) from score_fanout where player_id in ('q69-p2', 'q69-p4') and claim_token is null and claimed_at is null), 2::bigint,
  'G2b p2 (re-stamped) and p4 (unconsumed) are RELEASED — both lease columns NULL');
select is((select (claim_token, claimed_at) from score_fanout where player_id = 'q69-p3'),
  ('cc000000-0000-4000-8000-000000000001'::uuid, '2026-09-07 12:05:00+00'::timestamptz),
  'G2c p3 stays under the OTHER drain''s lease — not deleted, not released (it is that drain''s now)');
select is((select array_agg(player_id order by player_id) from public.score_fanout_claim(5, 120, '2026-09-07 12:02:02+00')), array['q69-p2', 'q69-p4'],
  'G3 the next claim (one second on) takes exactly the released p2 and p4 — p3 is leased elsewhere');
-- Release those two again so the idempotence cell reads a clean state.
select set_config('pgtap.tok2', (select claim_token::text from score_fanout where player_id = 'q69-p2'), true);
select is(public.score_fanout_ack(current_setting('pgtap.tok2')::uuid, '[]'::jsonb), '{"missed": [], "deleted": 0, "released": 2}'::jsonb,
  'G4 an empty ack under a live token is a pure RELEASE (the worker''s crash-path `finally`): 0 deleted, 2 released');

-- Idempotence (rule 10): the same ack again under the original token.
select is(public.score_fanout_ack(
  current_setting('pgtap.tok')::uuid,
  (select jsonb_agg(jsonb_build_object('season', season, 'week', week, 'player_id', player_id, 'enqueued_at', enqueued_at) order by player_id)
     from q69_cf where player_id in ('q69-p1', 'q69-p5'))) - 'missed',
  '{"deleted": 0, "released": 0}'::jsonb,
  'G5 the SAME ack again: 0 deleted, 0 released (idempotent)');
select is((public.score_fanout_ack(
  current_setting('pgtap.tok')::uuid,
  (select jsonb_agg(jsonb_build_object('season', season, 'week', week, 'player_id', player_id, 'enqueued_at', enqueued_at) order by player_id)
     from q69_cf where player_id in ('q69-p1', 'q69-p5'))) -> 'missed'),
  '[{"week": 1, "reason": "gone", "season": 2026, "player_id": "q69-p1"}, {"week": 1, "reason": "gone", "season": 2026, "player_id": "q69-p5"}]'::jsonb,
  'G5b …and names both consumed rows `gone`');
select is(public.score_fanout_ack('dd000000-0000-4000-8000-000000000001', '[]'::jsonb), '{"missed": [], "deleted": 0, "released": 0}'::jsonb,
  'G6 an unknown token releases nothing (another drain''s rows are never touched)');
select is((select count(*) from score_fanout where player_id like 'q69-%'), 3::bigint, 'G7 …and the queue is unchanged by G5/G6');

-- A consumed row under our token but at the WRONG stamp is never deleted
-- (the by-stamp half of the key): claim p4 (at 12:06 — p3's foreign lease
-- of 12:05 is live, so the oldest CLAIMABLE row is p4 at 11:03), ack it at
-- a stamp one microsecond off → restamped, released, still queued.
create temp table q69_c4 as select * from public.score_fanout_claim(1, 120, '2026-09-07 12:06:00+00');
select is((select array_agg(player_id) from q69_c4), array['q69-p4'], 'G8 claim(1) at 12:06 takes p4 (the oldest CLAIMABLE row — p3''s foreign lease is live)');
select is(public.score_fanout_ack(
  (select claim_token from q69_c4),
  jsonb_build_array(jsonb_build_object('season', 2026, 'week', 1, 'player_id', 'q69-p4', 'enqueued_at', '2026-09-07T11:03:00.000001+00:00'))),
  '{"missed": [{"week": 1, "reason": "restamped", "season": 2026, "player_id": "q69-p4"}], "deleted": 0, "released": 1}'::jsonb,
  'G8b an ack ONE MICROSECOND off the stamp deletes nothing — `restamped`, released (the stamp is the key at full precision)');
select is((select (claim_token is null, claimed_at is null) from score_fanout where player_id = 'q69-p4'), (true, true),
  'G8c …and p4 is back in the queue, unleased');

-- ---------------------------------------------------------------------------
-- H. Roles (RETURNING counts, the §4.2 pattern): no client role can touch
--    the lease columns directly — the queue stays service-role-only.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "97000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
select is((select count(*) from score_fanout), 0::bigint, 'H1 AUTHENTICATED reads ZERO queue rows (109''s deny-all, unchanged)');
select results_eq(
  $$ with u as (update score_fanout set claimed_at = null, claim_token = null where player_id = 'q69-p3' returning 1) select count(*) from u $$,
  $$ values (0::bigint) $$,
  'H2 AUTHENTICATED cannot release a lease by UPDATE — RETURNING 0 rows (109''s deny-all filters every row)');
select results_eq(
  $$ with d as (delete from score_fanout where player_id = 'q69-p3' returning 1) select count(*) from d $$,
  $$ values (0::bigint) $$,
  'H3 AUTHENTICATED cannot ack by DELETE — RETURNING 0 rows');
select throws_ok($$ select * from public.score_fanout_claim(1) $$, '42501', null, 'H4 AUTHENTICATED cannot execute the claim (the REVOKE)');
select throws_ok($$ select public.score_fanout_ack(gen_random_uuid(), '[]'::jsonb) $$, '42501', null, 'H4b …nor the ack');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((select count(*) from score_fanout), 0::bigint, 'H5 ANON reads ZERO');
select throws_ok($$ select * from public.score_fanout_claim(1) $$, '42501', null, 'H5b ANON cannot execute the claim');
reset role;
select is((select count(*) from score_fanout where player_id like 'q69-%'), 3::bigint, 'H6 …the queue is untouched by the role cells');
select is((select (claim_token, claimed_at) from score_fanout where player_id = 'q69-p3'),
  ('cc000000-0000-4000-8000-000000000001'::uuid, '2026-09-07 12:05:00+00'::timestamptz),
  'H6b …and p3''s foreign lease is intact');

select * from finish();
rollback;
