-- ============================================================================
-- The pg_cron + pg_net scheduler and the drain stall check — pgTAP 072
-- (migration 124; PROGRESS Q43 answered with its option (c); spec §14 /
-- §22.3 / §23.2 / §24.1; CLAUDE.md "never let 'nothing happened' mean 'it
-- worked'"; tasks-M4 §4 rules 1-11).
--
-- Numbering: pgTAP head measured 071 by `ls supabase/tests/ | tail -1` ⇒ 072.
--
-- Falsifiability notes (tasks-M1 §4.3, carried by tasks-M4 §4 rule 9):
--
--   * THE ABSENT-SECRET CONTRACT IS PROVEN, NOT ASSERTED IN PROSE (§C). The
--     failure this migration is defending against is SILENT: measured on
--     this stack, `'Bearer ' || NULL` is NULL (header JSON
--     `{"Authorization": null}`) and `format('Bearer %s', NULL)` is the
--     literal `'Bearer '` — NEITHER raises, and `net.http_get` accepts both,
--     so the route would 401 every minute forever with nothing to show.
--     C6/C7 pin those two expressions so the hazard is on the record; C9,
--     C11 and C12 then prove the helper RAISES `F0000` (config_file_error)
--     instead — for a MISSING secret and for an EMPTY one, on each of the
--     two secrets independently — and C10/C13 prove nothing was queued
--     across all three refusals. C1-C5 are the security posture, untouched
--     by any of that. THE BREAK PROBE for this arm deletes the `IF v_secret
--     IS NULL OR btrim(...)` arm: C11, C12 and C13 red BY NAME (C13 with 2
--     requests actually queued, headers `{"Authorization": null}`) while
--     everything else stays green.
--
--   * AND THE PRESENT-SECRET PATH IS PROVEN TOO, with no network (§D). The
--     whole suite runs inside one transaction that rolls back, so pg_net's
--     background worker (which reads COMMITTED rows) never sees the request:
--     `net.http_request_queue` still holds it for us to read. D2-D5 assert
--     the exact url, the exact `Authorization: Bearer <secret>` header,
--     `timeout_milliseconds = 55000` — NOT the 5000 default, which would
--     record `timed_out` on every score-week call (that route runs a ~50 s
--     budget under maxDuration = 60) — and that it is a GET. Nothing leaves
--     the database.
--
--   * THE STALL CHECK IS PINNED BOTH WAYS, and the negative cells are the
--     load-bearing ones (§E). A stall check that fires on healthy queues
--     gets muted, and a muted alarm is the bug this migration exists to
--     end. E7/E8 prove a row a drain is CURRENTLY holding — leased inside
--     its 120 s lease, or deferred to a moment still ahead — is NOT a stall
--     no matter how old, which is the invariant that lets the threshold be
--     10 minutes where reconcile's `stuck_queue` needs an hour. E9/E10 pin
--     the boundary both sides at one microsecond (D146). E11 reproduces the
--     measured 2026-09-10 incident exactly: 24 rows, 0 claimed, 0 deferred.
--
--   * AND THE AGED STAMPS ARE PINNED SEPARATELY (§F), because those
--     negatives pass VACUOUSLY against the bug they were meant to exclude:
--     E7's lease is 10 s old inside a 120 s lease and E8's `deferred_until`
--     is in the FUTURE — both FRESH — so a predicate reading the stamps as
--     mere PRESENCE (`claimed_at IS NULL AND deferred_until IS NULL`) is
--     green on all of them while being blind to every row a dead drain left
--     behind. Nothing clears either stamp: `claimed_at` only by an ack under
--     its own token or the next claim, `deferred_until` only by ingestion's
--     re-stamp, which never comes once the game is over. F1-F4 use AGED
--     stamps — a lease expired six hours ago, a defer window elapsed six
--     hours ago — and prove those rows COUNT, because `score_fanout_claim`'s
--     own predicate (F5, executed) says they are still owed. F6-F8 re-prove
--     the fresh cases from the other side, so F1-F4 cannot pass by counting
--     everything. THE BREAK PROBE for this arm reverts the predicate to
--     `claimed_at IS NULL AND deferred_until IS NULL`: F1, F2, F3 and F4 red
--     BY NAME, every other cell green.
--
--   * AND THE SHARED-FAILURE HOLE IS PINNED (§G). Both pings share one
--     helper, one pg_net worker, two Vault secrets and one origin, so the
--     dominant failure kills BOTH — and then nothing is ever enqueued, the
--     queue is EMPTY rather than backed up, and a queue-only check reports
--     `stalled: false` forever while the pipeline is completely dark. G2 is
--     that exact state: ZERO queue rows, `ingest_poll` frozen six hours, and
--     the flag RAISED on `ingest_stale` alone. G3/G4 pin the negative and
--     the boundary (a poll inside the window is not a stall), and G5 pins
--     the deliberate exemption — a database that has NEVER ingested is
--     un-provisioned, not stalled. THE BREAK PROBE for this arm forces
--     `v_ingest_stale := FALSE`: G2 reds BY NAME and nothing else does,
--     which is the measurement that the INGESTION arm — not the queue arm —
--     is what closes this hole.
--
--   * IDEMPOTENCE IS EXECUTED, NOT ASSUMED (§B). 124's DO block is run
--     TWICE inside this transaction and the job count re-asserted, so
--     "idempotent re-apply" is a measurement rather than a claim about the
--     068:1257-1268 shape.
--
--   * THE REVOKE POSTURE IS WALKED PER ROLE INCLUDING service_role (§C/§E).
--     Measured on this project: a new `public` function is EXECUTE-granted
--     to PUBLIC, anon, authenticated AND service_role by default, and a
--     PUBLIC-only REVOKE leaves `service_role=X` standing. C5 pins
--     service_role OFF for `cron_ping_route` (it would be a primitive for
--     making the database fire an authenticated `Bearer <CRON_SECRET>`
--     request on demand) and E3 pins it ON for `scoring_stall_check` (the
--     D291 harness door the three week workers have — 064:98-101). Those
--     two cells disagree on purpose. `scoring_stall_check` reads only
--     `public` tables partly for this reason: `has_schema_privilege(
--     'service_role', 'cron', 'USAGE')` is FALSE on this project (measured),
--     so a `cron.job_run_details` arm would have made the function ERROR for
--     the one role the D291 door exists for.
--
--   * All work runs as postgres, which is what `cron.job.username` defaults
--     to and what all five pre-existing jobs run as.
-- ============================================================================
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local time zone 'UTC';   -- the stamps below are stored literals

select plan(59);

-- ---------------------------------------------------------------------------
-- A. The transport
-- ---------------------------------------------------------------------------
select ok((select exists (select 1 from pg_extension where extname = 'pg_net')),
  'A1 pg_net is installed (124 §1) — the vehicle Q43(c) rules');
select ok((select exists (select 1 from pg_namespace where nspname = 'net')),
  'A2 …and its `net` schema is present');
select ok((select exists (select 1 from pg_extension where extname = 'pg_cron')),
  'A3 pg_cron is still installed (068/116''s scheduler, unchanged)');

-- ---------------------------------------------------------------------------
-- B. The three jobs — and the idempotent re-apply, executed
-- ---------------------------------------------------------------------------
select is((select schedule || ' | ' || command from cron.job where jobname = 'sync-live-ping'),
  '* * * * * | SELECT public.cron_ping_route(''/api/cron/sync-live'')',
  'B1 cron: sync-live-ping every minute, pinging the route by path');
select is((select schedule || ' | ' || command from cron.job where jobname = 'score-week-ping'),
  '* * * * * | SELECT public.cron_ping_route(''/api/cron/score-week'')',
  'B2 cron: score-week-ping every minute (the 5 s drains are produced INSIDE the invocation — D322(3))');
select is((select schedule || ' | ' || command from cron.job where jobname = 'scoring-stall-check'),
  '* * * * * | SELECT public.scoring_stall_check()',
  'B3 cron: scoring-stall-check every minute, its OWN job — an absent secret raises out of cron_ping_route, and that is exactly when the queue stalls');
select is((select count(*)::int from cron.job where jobname in ('sync-live-ping', 'score-week-ping', 'scoring-stall-check')),
  3, 'B4 exactly ONE cron row per job (§22.3 — never one per league)');
select is((select count(*)::int from cron.job where jobname in ('draft-tick', 'mock-expiry', 'lineup-lock', 'league-week-advance', 'finalize-matchups')),
  5, 'B5 …and 068/071/116''s five jobs are untouched');

-- 124 §4's DO block, verbatim, run TWICE.
do $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-live-ping') THEN
    PERFORM cron.unschedule('sync-live-ping');
  END IF;
  PERFORM cron.schedule('sync-live-ping', '* * * * *',
    'SELECT public.cron_ping_route(''/api/cron/sync-live'')');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'score-week-ping') THEN
    PERFORM cron.unschedule('score-week-ping');
  END IF;
  PERFORM cron.schedule('score-week-ping', '* * * * *',
    'SELECT public.cron_ping_route(''/api/cron/score-week'')');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scoring-stall-check') THEN
    PERFORM cron.unschedule('scoring-stall-check');
  END IF;
  PERFORM cron.schedule('scoring-stall-check', '* * * * *',
    'SELECT public.scoring_stall_check()');
END;
$do$;
do $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-live-ping') THEN
    PERFORM cron.unschedule('sync-live-ping');
  END IF;
  PERFORM cron.schedule('sync-live-ping', '* * * * *',
    'SELECT public.cron_ping_route(''/api/cron/sync-live'')');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'score-week-ping') THEN
    PERFORM cron.unschedule('score-week-ping');
  END IF;
  PERFORM cron.schedule('score-week-ping', '* * * * *',
    'SELECT public.cron_ping_route(''/api/cron/score-week'')');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scoring-stall-check') THEN
    PERFORM cron.unschedule('scoring-stall-check');
  END IF;
  PERFORM cron.schedule('scoring-stall-check', '* * * * *',
    'SELECT public.scoring_stall_check()');
END;
$do$;

select is((select count(*)::int from cron.job where jobname in ('sync-live-ping', 'score-week-ping', 'scoring-stall-check')),
  3, 'B6 the 068:1257-1268 unschedule-first shape re-applied TWICE leaves exactly one job per name');

-- ---------------------------------------------------------------------------
-- C. cron_ping_route — form, posture, and the ABSENT-SECRET contract
-- ---------------------------------------------------------------------------
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cron_ping_route'),
  'C1 cron_ping_route is SECURITY INVOKER with search_path='''' — INVOKER on purpose: the caller is pg_cron''s postgres, which already reads Vault, and INVOKER additionally fails closed for anon/authenticated (no USAGE on `vault`)');
-- A NULL proacl is the DEFAULT acl, which grants EXECUTE to PUBLIC. Counting
-- only explicit grantee-0 rows would pass on it — so NULL counts as a failure.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'cron_ping_route'
             and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  0, 'C2 PUBLIC holds no EXECUTE — neither an explicit grantee-0 entry nor the NULL (= default, = PUBLIC) acl');
select ok(not has_function_privilege('anon', 'public.cron_ping_route(text)', 'EXECUTE'),
  'C3 anon cannot execute it');
select ok(not has_function_privilege('authenticated', 'public.cron_ping_route(text)', 'EXECUTE'),
  'C4 authenticated cannot execute it');
select ok(not has_function_privilege('service_role', 'public.cron_ping_route(text)', 'EXECUTE'),
  'C5 service_role cannot either — named EXPLICITLY in the REVOKE because a PUBLIC-only revoke leaves service_role=X, and this helper is a make-the-database-send-our-cron-secret primitive with no harness use');

-- C0: the hazard on the record. Neither of these raises, and both would
-- produce a request the route 401s forever in silence.
select is((select jsonb_build_object('Authorization', 'Bearer ' || null::text)),
  '{"Authorization": null}'::jsonb,
  'C6 THE SILENT FAILURE, pinned: `''Bearer '' || NULL` is NULL and does not raise — this is why the explicit check exists');
select is((select format('Bearer %s', null::text)), 'Bearer ',
  'C7 …and `format(''Bearer %s'', NULL)` is the literal ''Bearer '' — also silent. IS NULL alone is not enough; btrim catches the empty string too');

-- Vault is empty at this point (a fresh `db reset` plants no secrets).
select is((select count(*)::int from vault.decrypted_secrets where name in ('fieldscout_site_origin', 'fieldscout_cron_secret')),
  0, 'C8 precondition: neither secret exists — the state a database has before Chris inserts them');
select throws_ok(
  $$ select public.cron_ping_route('/api/cron/sync-live') $$,
  'F0000', null,
  'C9 ABSENT ORIGIN ⇒ RAISE (config_file_error), and no request is queued');
select is((select count(*)::int from net.http_request_queue where url like '%/api/cron/%'), 0,
  'C10 …proven: nothing was queued — it failed loudly INSTEAD of firing a Bearer-null request');

do $$ begin perform vault.create_secret('https://fieldscout.gg', 'fieldscout_site_origin'); end $$;
select throws_ok(
  $$ select public.cron_ping_route('/api/cron/score-week') $$,
  'F0000', null,
  'C11 ORIGIN present, SECRET absent ⇒ still RAISEs — the second secret is checked independently');

do $$ begin perform vault.create_secret('   ', 'fieldscout_cron_secret'); end $$;
select throws_ok(
  $$ select public.cron_ping_route('/api/cron/score-week') $$,
  'F0000', null,
  'C12 A WHITESPACE-ONLY secret ⇒ RAISEs — `IS NULL` alone would have sailed past and sent `Bearer    `');
select is((select count(*)::int from net.http_request_queue where url like '%/api/cron/%'), 0,
  'C13 …and still nothing was queued across all three refusals');

-- ---------------------------------------------------------------------------
-- D. The present-secret path — the request as actually built, no network
-- ---------------------------------------------------------------------------
do $$ begin perform vault.update_secret((select id from vault.secrets where name = 'fieldscout_cron_secret'), 'q72-cron-secret'); end $$;
select ok((select public.cron_ping_route('/api/cron/sync-live')) > 0,
  'D1 both secrets present ⇒ a request id is returned (fire-and-forget)');
select is((select url from net.http_request_queue order by id desc limit 1),
  'https://fieldscout.gg/api/cron/sync-live',
  'D2 the url is <origin><path> — the route the scheduler must hit');
select is((select headers from net.http_request_queue order by id desc limit 1),
  '{"Authorization": "Bearer q72-cron-secret"}'::jsonb,
  'D3 THE HEADER IS REAL: `Bearer <secret>`, not null and not the bare word — this is the assertion C6/C7 exist to make meaningful');
select is((select timeout_milliseconds from net.http_request_queue order by id desc limit 1),
  55000, 'D4 timeout is 55 s, NOT pg_net''s 5000 default — score-week runs a ~50 s budget under maxDuration = 60, so the default would record timed_out on every call');
select is((select method::text from net.http_request_queue order by id desc limit 1),
  'GET', 'D5 …and it is a GET — both routes export GET and check the Bearer header on it (sync-live/route.ts:49-51, score-week/route.ts:47-49)');

-- ---------------------------------------------------------------------------
-- E. scoring_stall_check — the mechanism that NOTICES
-- ---------------------------------------------------------------------------
select ok(
  (select not p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'scoring_stall_check'),
  'E1 scoring_stall_check is SECURITY INVOKER with search_path='''' — it writes as postgres from cron, so 122''s "no client write policy for any role" is untouched');
select ok(not has_function_privilege('anon', 'public.scoring_stall_check(timestamptz)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.scoring_stall_check(timestamptz)', 'EXECUTE'),
  'E2 anon and authenticated cannot execute it');
select ok(has_function_privilege('service_role', 'public.scoring_stall_check(timestamptz)', 'EXECUTE'),
  'E3 service_role KEEPS it — the D291 harness/sim door the three week workers have (064:98-101). It carries no secret; cron_ping_route does, which is why C5 disagrees with this cell on purpose');

insert into players (id, full_name, position, adp) values
  ('q72-p1', 'Q72 WR 1', 'WR', 0.001),
  ('q72-p2', 'Q72 WR 2', 'WR', 0.002),
  ('q72-p3', 'Q72 WR 3', 'WR', 0.003);

-- An EMPTY queue is not a stall, and the flag is still written (the freshness tell).
select is((select public.scoring_stall_check('2026-09-10 15:00:00+00') -> 'stalled'), 'false'::jsonb,
  'E4 an empty queue is not stalled');
select is((select value from system_flags where key = 'scoring_stalled'),
  '{"rows": 0, "reasons": [], "stalled": false, "checked_at": "2026-09-10T15:00:00+00:00", "ingest_stale": false, "last_ingest_at": null, "oldest_enqueued_at": null, "threshold_minutes": 10, "ingest_threshold_minutes": 120}'::jsonb,
  'E5 …and the flag is written ANYWAY, with `checked_at` — a frozen checked_at is how a dead checker is told apart from a healthy queue; `reasons` is EMPTY, never absent, so a reader can tell "nothing raised it" from "this key predates the arm"');

-- A fresh row (1 min old) is in flight, not stalled.
insert into score_fanout (season, week, player_id, enqueued_at) values
  (2026, 1, 'q72-p1', '2026-09-10 14:59:00+00');
select is((select public.scoring_stall_check('2026-09-10 15:00:00+00') -> 'stalled'), 'false'::jsonb,
  'E6 a one-minute-old row is in flight, not a stall');

-- The two states every legitimately-held row is in. NEITHER may fire.
update score_fanout set enqueued_at = '2026-09-10 14:00:00+00',
                        claimed_at = '2026-09-10 14:59:50+00', claim_token = gen_random_uuid()
  where player_id = 'q72-p1';
select is((select public.scoring_stall_check('2026-09-10 15:00:00+00') -> 'stalled'), 'false'::jsonb,
  'E7 an HOUR-old row currently CLAIMED is not a stall — a drain is holding it (121''s lease)');
update score_fanout set claimed_at = null, claim_token = null,
                        deferred_until = '2026-09-10 15:00:30+00'
  where player_id = 'q72-p1';
select is((select public.scoring_stall_check('2026-09-10 15:00:00+00') -> 'stalled'), 'false'::jsonb,
  'E8 an hour-old row currently DEFERRED is not a stall either — 122 §4''s ack re-defers a held row every 30 s, so a chronic hold can never light this. THIS is what buys the 10-minute threshold that reconcile''s enqueued_at-only stuck_queue cannot afford');

-- The boundary, both sides, at one microsecond (D146).
update score_fanout set deferred_until = null, enqueued_at = '2026-09-10 14:50:00+00'
  where player_id = 'q72-p1';
select is((select public.scoring_stall_check('2026-09-10 15:00:00+00') -> 'stalled'), 'false'::jsonb,
  'E9 EXACTLY ten minutes old is still in flight (strict `<`)');
select is((select public.scoring_stall_check('2026-09-10 15:00:00.000001+00') -> 'stalled'), 'true'::jsonb,
  'E10 …one microsecond more IS a stall (D146''s one-unit rule, pinned both sides)');

-- The measured incident, reproduced.
insert into score_fanout (season, week, player_id, enqueued_at)
select 2026, 1, 'q72-p' || g, '2026-09-10 08:50:35+00' from generate_series(2, 3) g;
update score_fanout set enqueued_at = '2026-09-10 08:50:35+00' where player_id = 'q72-p1';
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00')),
  '{"rows": 3, "reasons": ["queue_undrained"], "stalled": true, "checked_at": "2026-09-10T14:50:00+00:00", "ingest_stale": false, "last_ingest_at": null, "oldest_enqueued_at": "2026-09-10T08:50:35+00:00", "threshold_minutes": 10, "ingest_threshold_minutes": 120}'::jsonb,
  'E11 THE MEASURED 2026-09-10 INCIDENT: rows enqueued 08:50:35Z, 0 claimed, 0 deferred, six hours later ⇒ stalled on `queue_undrained`, with the row count and the oldest instant an operator needs');

-- ---------------------------------------------------------------------------
-- F. THE AGED STAMPS — the population a DEAD DRAIN leaves behind.
--
-- E7/E8 above are the negatives for a drain that is ALIVE and holding, and
-- they pass whether the predicate reads the stamps as instants or as mere
-- presence: E7's lease is 10 s into a 120 s lease and E8's `deferred_until`
-- is in the FUTURE. Every cell here uses an AGED stamp instead, and every
-- one of them is green ONLY because the check now asks "would
-- `score_fanout_claim` still take this row?" rather than "has anything ever
-- touched it?". Nothing clears either stamp for a row whose drain died —
-- `claimed_at` only by an ack under its own token or the next claim (122
-- §4), `deferred_until` only by ingestion's re-stamp (`ingest-week.ts`),
-- which never comes once the game is over — so under the old predicate
-- these rows were exempt FOR THE REST OF THEIR LIVES.
-- ---------------------------------------------------------------------------
delete from score_fanout;

-- THE HARD-KILLED DRAIN. Vercel kills the route at `maxDuration = 60`, which
-- skips the worker's JS `finally` release (`score-week-invoker.ts`: the
-- release is best-effort, "the lease expiry is the backstop"), so
-- `claimed_at` sticks at the instant of the claim — here 08:50:40Z, a lease
-- that expired at 08:52:40Z and has been expired for six hours.
insert into score_fanout (season, week, player_id, enqueued_at, claimed_at, claim_token) values
  (2026, 1, 'q72-p1', '2026-09-10 08:50:35+00', '2026-09-10 08:50:40+00', gen_random_uuid());
select is((select (public.scoring_stall_check('2026-09-10 14:50:00+00') ->> 'rows')::int), 1,
  'F1 A ROW WHOSE LEASING DRAIN DIED IS COUNTED: enqueued 08:50:35Z, claimed 08:50:40Z, lease expired 08:52:40Z, still leased six hours later. `claimed_at IS NULL` exempted it forever; `claimed_at < p_now - 10 min` counts it, because that is work the claim would still take');

-- THE RELEASED-AND-DEFERRED ROW. 122 §4's ack sets `deferred_until` and
-- CLEARS the lease pair, so a held row carries an elapsed deferral and no
-- lease. The last drain before a game ends defers the not-ready rows and
-- dies; no further delta ever re-stamps them, because the game is over.
delete from score_fanout;
insert into score_fanout (season, week, player_id, enqueued_at, deferred_until) values
  (2026, 1, 'q72-p2', '2026-09-10 08:50:35+00', '2026-09-10 08:51:05+00');
select is((select (public.scoring_stall_check('2026-09-10 14:50:00+00') ->> 'rows')::int), 1,
  'F2 A ROW RELEASED WITH AN ELAPSED `deferred_until` IS COUNTED: a 30 s hold from `deferSeconds` that elapsed at 08:51:05Z and was never re-claimed. `deferred_until IS NULL` exempted it forever; the worker itself draws this line correctly (`score-week-worker.ts`: deferral is `deferred_until > now`, not `IS NOT NULL`)');

-- Both at once — the ordinary shape of a stall after a game goes final.
insert into score_fanout (season, week, player_id, enqueued_at, claimed_at, claim_token) values
  (2026, 1, 'q72-p1', '2026-09-10 08:50:35+00', '2026-09-10 08:50:40+00', gen_random_uuid());
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00')),
  '{"rows": 2, "reasons": ["queue_undrained"], "stalled": true, "checked_at": "2026-09-10T14:50:00+00:00", "ingest_stale": false, "last_ingest_at": null, "oldest_enqueued_at": "2026-09-10T08:50:35+00:00", "threshold_minutes": 10, "ingest_threshold_minutes": 120}'::jsonb,
  'F3 THE BLOCKER, REPRODUCED AND CLOSED: one aged lease + one elapsed deferral, six hours undrained ⇒ stalled with rows 2. Measured against the shipped predicate this returned {"rows": 0, "stalled": false} — the check went blind exactly when a drain dies mid-work, the case it exists for');
select ok((select (public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'stalled')::boolean),
  'F4 …and the BANNER''s own boolean is raised on it, not merely the row count');

-- EXECUTED CROSS-CHECK, not an argument: the claim ITSELF takes both rows at
-- that instant, so the check is counting exactly the work still owed.
create temp table q72_claim as select * from public.score_fanout_claim(10, 120, '2026-09-10 14:50:00+00');
select is((select array_agg(player_id order by player_id) from q72_claim), array['q72-p1', 'q72-p2'],
  'F5 `score_fanout_claim`''s OWN predicate takes both rows at the same instant — 122 §3''s `(claimed_at IS NULL OR claimed_at < p_now - lease) AND (deferred_until IS NULL OR deferred_until <= p_now)`. The check and the claim now agree about what is owed');

-- The other side: the SAME rows with FRESH stamps are not stalls. Without
-- these, F1-F4 could pass by counting everything.
update score_fanout set claimed_at = '2026-09-10 14:49:55+00', claim_token = gen_random_uuid(), deferred_until = null
  where player_id = 'q72-p1';
update score_fanout set claimed_at = null, claim_token = null, deferred_until = '2026-09-10 14:55:00+00'
  where player_id = 'q72-p2';
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'stalled'), 'false'::jsonb,
  'F6 the same two rows with FRESH stamps — a lease 5 s old and a deferral still ahead — are NOT a stall. The check counts instants, in BOTH directions');

-- THE MARGIN THAT KEEPS A HEALTHY HOLD QUIET. A drain re-defers a held row
-- 30 s at a time (`deferSeconds = 30`) and the invoker runs once a minute,
-- so at any sampled instant a legitimately-held row may be sitting on a
-- deferral that elapsed up to a minute ago, waiting for the next drain. A
-- bare `deferred_until <= p_now` (the claim''s own boundary) would fire on
-- that. This is why all three stamps get the SAME ten-minute patience.
update score_fanout set deferred_until = '2026-09-10 14:49:00+00' where player_id = 'q72-p2';
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'stalled'), 'false'::jsonb,
  'F7 a deferral that elapsed ONE MINUTE ago is NOT a stall — the healthy 30 s re-defer between two per-minute invocations must never light the banner. A stall check that fires on healthy queues gets muted');
update score_fanout set deferred_until = '2026-09-10 14:40:00+00' where player_id = 'q72-p2';
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'stalled'), 'false'::jsonb,
  'F8 …and the deferral boundary is pinned at EXACTLY ten minutes elapsed — still in flight (strict `<`, D146)');
update score_fanout set deferred_until = '2026-09-10 14:39:59.999999+00' where player_id = 'q72-p2';
select is((select (public.scoring_stall_check('2026-09-10 14:50:00+00') ->> 'rows')::int), 1,
  'F9 …and one microsecond older counts. The threshold is 10 min > the 120 s lease, so every row this arm counts is a strict subset of what the claim would take — it can never name a row the claim would refuse');

-- ---------------------------------------------------------------------------
-- G. THE SHARED-FAILURE HOLE — when BOTH pings die, the queue goes EMPTY.
--
-- §F closes the queue arm. It cannot close this: `sync-live-ping` and
-- `score-week-ping` call the SAME `cron_ping_route`, through the same pg_net
-- worker, with the same two Vault secrets, at the same origin — so a
-- one-sided `CRON_SECRET` rotation, a push before `vault.create_secret`, a
-- typo''d origin or a wedged pg_net kills BOTH. `ingest-week.ts` is the only
-- enqueue path, so with `sync-live` dead nothing new ever arrives: the queue
-- drains to empty, and a queue-only check reports `stalled: false` forever
-- while the entire pipeline is dark. Silence reading as health is the
-- CLAUDE.md shape this whole change exists to end, one level up.
-- ---------------------------------------------------------------------------
delete from score_fanout;
select is((select count(*)::int from score_fanout), 0,
  'G1 precondition: the queue is EMPTY — with ingestion dead there is nothing left to age, so §F''s arm CANNOT fire here. This is the state that read as healthy');

insert into system_flags (key, value, updated_at) values
  ('ingest_poll:2026:1', '{"completed_at": "2026-09-10T08:50:35+00:00", "provider": "sleeper+nflverse"}'::jsonb, '2026-09-10 08:50:35+00');
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00')),
  '{"rows": 0, "reasons": ["ingest_stale"], "stalled": true, "checked_at": "2026-09-10T14:50:00+00:00", "ingest_stale": true, "last_ingest_at": "2026-09-10T08:50:35+00:00", "oldest_enqueued_at": null, "threshold_minutes": 10, "ingest_threshold_minutes": 120}'::jsonb,
  'G2 BOTH PINGS DEAD IS DETECTED: zero queue rows, the last successful ingestion six hours old ⇒ RAISED, on `ingest_stale` alone. F329 claimed a dead ping was caught by its consequence — it is not, when the ping that dies is the one that FEEDS the queue');

update system_flags set updated_at = '2026-09-10 14:20:00+00',
                        value = '{"completed_at": "2026-09-10T14:20:00+00:00", "provider": "sleeper+nflverse"}'::jsonb
  where key = 'ingest_poll:2026:1';
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'stalled'), 'false'::jsonb,
  'G3 a poll 30 minutes ago is NOT a stall — outside a game window the plan is IDLE and sweeps once an HOUR (`SWEEP_MINUTE = 0`), so a per-minute threshold here would be a permanent banner');
update system_flags set updated_at = '2026-09-10 12:50:00+00' where key = 'ingest_poll:2026:1';
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'stalled'), 'false'::jsonb,
  'G4 EXACTLY two hours is still healthy (strict `<`) — the window tolerates exactly ONE missed hourly sweep, and a single provider blip must not light a banner on its own (that is `stats_degraded`''s job, after three failures)');
update system_flags set updated_at = '2026-09-10 12:49:59.999999+00' where key = 'ingest_poll:2026:1';
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'ingest_stale'), 'true'::jsonb,
  'G5 …one microsecond more IS (D146''s one-unit rule, pinned both sides)');

-- The NEWEST poll of ANY week clears it — the arm asks "is ingestion
-- running", not "is week N up to date".
insert into system_flags (key, value, updated_at) values
  ('ingest_poll:2026:2', '{"completed_at": "2026-09-10T14:49:00+00:00", "provider": "sleeper+nflverse"}'::jsonb, '2026-09-10 14:49:00+00');
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'stalled'), 'false'::jsonb,
  'G6 a fresh poll of ANOTHER week clears it — `max(updated_at)` over every `ingest_poll:%` key, because the question is whether INGESTION is running at all');

-- A failing poll must NOT look like ingestion. `persistPollOutcome` writes
-- `stats_degraded` on EVERY attempt including failures, and writes an
-- `ingest_poll` key only on success — so the prefix is load-bearing.
delete from system_flags where key like 'ingest_poll:%';
insert into system_flags (key, value, updated_at) values
  ('stats_degraded', '{"degraded": true, "consecutive_failures": 9, "last_failure_at": "2026-09-10T14:49:00+00:00", "last_success_at": null, "last_error": "timeout", "provider": "sleeper+nflverse"}'::jsonb, '2026-09-10 14:49:00+00')
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
insert into system_flags (key, value, updated_at) values
  ('ingest_poll:2026:1', '{"completed_at": "2026-09-10T08:50:35+00:00", "provider": "sleeper+nflverse"}'::jsonb, '2026-09-10 08:50:35+00');
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'ingest_stale'), 'true'::jsonb,
  'G7 a FRESH `stats_degraded` row does not clear it: that key is written on every poll ATTEMPT, failures included, while `ingest_poll:` is written only on a SUCCESS. Only data actually ingested counts as ingestion');

-- The deliberate exemption, and how narrow it is.
delete from system_flags where key like 'ingest_poll:%';
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'stalled'), 'false'::jsonb,
  'G8 NO `ingest_poll` row at all is NOT a stall — that means this database has never ingested once (a fresh stack, a preview branch, the dev seed), not that a running pipeline stopped. A permanent banner on every developer''s league is a muted banner');
insert into system_flags (key, value, updated_at) values
  ('ingest_poll:2026:1', '{"completed_at": "2026-09-10T08:50:35+00:00", "provider": "sleeper+nflverse"}'::jsonb, '2026-09-10 08:50:35+00');
select is((select public.scoring_stall_check('2026-09-10 14:50:00+00') -> 'stalled'), 'true'::jsonb,
  'G9 …and the exemption is THAT narrow: the same instant with one stamped row RAISES. `system_flags` rows are never deleted, so a pipeline that stops always leaves its row behind — production has carried `ingest_poll:2026:1` since the 08:50:35Z poll of the measured incident');

-- The read that makes it worth writing.
set local role anon;
select is((select (value ->> 'stalled')::boolean from system_flags where key = 'scoring_stalled'), true,
  'E12 ANON reads it — the banner''s read (122''s world-SELECT policy, unchanged): this is why the stall is surfaced HERE and not into a log with no reader');
select is((select (value ->> 'ingest_stale')::boolean from system_flags where key = 'scoring_stalled'), true,
  'E14 …and the arm that raised it reaches the client too: with the queue EMPTY the banner is up on `ingest_stale`, which is the whole point of §G');
reset role;

select ok(
  (select obj_description('public.system_flags'::regclass) like '%scoring_stalled%pg_cron%postgres%'),
  'E13 122''s table comment now names the SECOND writer and the THIRD key — the prose does not silently go stale on a posture claim');

select * from finish();
rollback;
