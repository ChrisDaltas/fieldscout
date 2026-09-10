-- ============================================================================
-- 124_cron_ping_and_stall_check.sql — THE SCHEDULER (PROGRESS Q43 answered:
-- option (c), pg_cron + pg_net) + the drain's stall check (spec §14's
-- `score-league-week` / `live stats ingestion` rows; §22.3's D87 cron
-- vehicle; §23.2 / §24.1; CLAUDE.md "never let 'nothing happened' mean 'it
-- worked'").
--
-- Numbering: migration head measured 123 (`ls supabase/migrations/ | tail -1`)
-- ⇒ 124; pgTAP head 071 ⇒ 072 (D161/D166). NOT held: `supabase/
-- HELD-FROM-PRODUCTION.txt` has no live entries as of 2026-09-09 and gains no
-- `124` line — this reaches production the ordinary way, `npx supabase db
-- push`, and reds the drift check in between exactly as that file's rule 1
-- says it should.
--
-- ---------------------------------------------------------------------------
-- WHY — the measured failure this migration exists to end
-- ---------------------------------------------------------------------------
-- `/api/cron/sync-live` and `/api/cron/score-week` are BUILT AND UNSCHEDULED
-- (their own docblocks say so): both expect to be fired EVERY MINUTE, and
-- Vercel Hobby refuses any cron finer than daily AT DEPLOY TIME (R884), so
-- DAILY stopgap entries went into `vercel.json` — `sync-live` 08:15Z,
-- `score-week` 08:30Z.
--
-- MEASURED 2026-09-10 on the live 2026 test league: the week-1 opener (SEA @
-- NE) went final overnight; the stats landed and enqueued 24 `score_fanout`
-- rows at 08:50:35Z. `score-week` had already run at 08:30. Six hours later
-- the queue still held 24 rows, 0 claimed, 0 deferred, and
-- `team_week_results` for that league was 0. A 20-minute miss became a
-- full day of stale scores, and NOTHING said so.
--
-- ---------------------------------------------------------------------------
-- WHAT — three per-minute pg_cron jobs, and why pg_cron
-- ---------------------------------------------------------------------------
-- Q43's options were (a) Vercel Pro, (b) an external minute pinger, (c)
-- pg_cron + pg_net. (c) is built here: the scheduler this project ALREADY
-- runs in production (five jobs since 068/071/116, one of them `lineup-lock`
-- at `* * * * *` — 116:1332-1340), no third party holding `CRON_SECRET`, no
-- new monthly bill. Both routes are scheduler-agnostic by construction —
-- "any caller with `CRON_SECRET` once a minute is the production cadence"
-- (`sync-live/route.ts:12-14`, `score-week/route.ts:19-21`) — and both check
-- `request.headers.get('authorization') !== 'Bearer ' || CRON_SECRET` on a
-- **GET** (`sync-live/route.ts:49-51`, `score-week/route.ts:47-49`), which is
-- exactly what `net.http_get` issues.
--
-- TWO SCHEDULERS FOR NOW, DELIBERATELY — `vercel.json` IS NOT TOUCHED BY
-- THIS PR. All six entries stay, the daily `sync-live` (`15 8 * * *`) and
-- `score-week` (`30 8 * * *`) stopgaps included. Removing them here would
-- take the safety net away BEFORE the replacement exists: merging triggers
-- the production deploy, which syncs crons from `vercel.json` and deletes
-- those two within minutes, while the three pg_cron jobs below appear only
-- when Chris runs `npx supabase db push`, and send nothing until he runs the
-- two `vault.create_secret` calls. Between those moments scoring would run
-- ZERO times a day instead of once — strictly worse than the cadence being
-- replaced — and 124's own stall check would not yet exist in production to
-- report it.
--
-- RUNNING BOTH IS SAFE, read out of the code rather than assumed. The
-- overlap is at most ONE invocation per route per day:
--   * score-week: `score_fanout_claim` picks `FOR UPDATE SKIP LOCKED` and
--     stamps a 120 s lease (122 §3), and `SCORE_WEEK_LEASE_SECONDS` (120) >=
--     `maxDuration` (60) + the 30 s skew margin (F263(f)/R874), so two
--     concurrent drains claim DISJOINT sets — pinned against two REAL
--     PostgREST sessions in `score-week-worker-db.test.ts:1107`. A second
--     drain in the same minute claims what the first did not, or nothing.
--   * sync-live: `ingestWeek` enqueues a DIFF, not a poll — only stat rows
--     that actually changed are upserted into `score_fanout` by primary key
--     with ON CONFLICT DO UPDATE (`ingest-week.ts:752-784`), and every other
--     write in the path is a counted upsert. A redundant poll of the same
--     minute finds no delta and enqueues nothing; a racing one writes the
--     same row at the same stamp. The cost is one extra provider read a day.
--     (Correcting a plausible-sounding claim: `planLivePoll` does NOT
--     consult the last-poll instant — it plans from `nfl_games`/`nfl_weeks`
--     alone (`live-poll.ts:134-188`), and `runLivePollInvocation` never
--     reads `ingest_poll`. The idempotence above is the DIFF's, not a
--     dedupe's.)
--
-- REMOVING THE TWO ENTRIES IS A FOLLOW-UP, taken only once Chris confirms
-- from the hosted project that the pg_cron path is live; PROGRESS F331
-- carries the exact confirmation condition. The other four entries (persona
-- ingest / generate, weekly `sync-stats`, daily `reconcile`) are untouched
-- either way — daily-or-coarser, Hobby allows them, not part of this change.
--
-- ---------------------------------------------------------------------------
-- THE SECRET — read at call time from Vault, by NAME. NEVER IN THIS FILE.
-- ---------------------------------------------------------------------------
-- `public.cron_ping_route(p_path)` reads two Vault secrets by name at every
-- call: `fieldscout_site_origin` and `fieldscout_cron_secret`. Nothing about
-- either value is in this file or in git; rotation is a Vault write, not a
-- migration and not a redeploy. Chris inserts them ONCE, out of band:
--
--   select vault.create_secret('https://fieldscout.gg',  'fieldscout_site_origin');
--   select vault.create_secret('<the Vercel CRON_SECRET>', 'fieldscout_cron_secret');
--
-- ABSENT-SECRET CONTRACT — IT RAISES, LOUDLY, AND SENDS NOTHING. Measured on
-- the local stack: `'Bearer ' || NULL` evaluates to NULL, so the header JSON
-- becomes `{"Authorization": null}`; `format('Bearer %s', NULL)` yields the
-- literal `'Bearer '`. NEITHER raises, and `net.http_get` accepts both — the
-- route would then 401 every single minute, forever, in total silence. That
-- is the exact bug shape CLAUDE.md forbids, so both secrets are checked
-- `IS NULL OR btrim(…) = ''` (empty string, not just NULL) and a miss raises
-- `config_file_error` (SQLSTATE F0000) BEFORE any request is queued. A raise inside a
-- pg_cron job is recorded in `cron.job_run_details` as `status = 'failed'`
-- with the message — FORENSIC, ON DEMAND, where a silent 401 leaves nothing
-- at all. Deliberately not called "evidence": that table has no reader in
-- this repo (F329) and pg_cron ships no retention, so while Vault is unset
-- the three new jobs add ~4,320 rows a day beside `draft-tick`'s existing
-- ~17,280. It is where an operator LOOKS during an incident, never a channel
-- that reaches anyone. The channel with a measured reader is the
-- `system_flags` flag §3 writes, and §3's ingest-staleness arm is what makes
-- an unset secret reach it. A retention job for `cron.job_run_details` is
-- PROGRESS F332, not this migration's business.
-- (`net.http_get` happens to raise on a NULL *url* by itself, via a not-null
-- constraint; the secret half has no such accident. Both are checked here.)
--
-- SECURITY **INVOKER**, DELIBERATELY, AND THIS IS THE ONE PLACE IN THE REPO
-- THAT DEPARTS FROM CLAUDE.md's "SECURITY DEFINER on anything new":
--   * `cron.job.username` defaults to CURRENT_USER and all five existing jobs
--     run as `postgres`; `postgres` holds `r*` on `vault.decrypted_secrets`
--     and `U*` on the `vault` schema. So the caller can already read Vault —
--     DEFINER buys nothing.
--   * It would cost something. A new `public` function is EXECUTE-granted to
--     PUBLIC / anon / authenticated / service_role BY DEFAULT on this
--     project. A DEFINER helper minus a perfect REVOKE hands any anonymous
--     visitor a primitive that makes the database fire an authenticated
--     `Bearer <CRON_SECRET>` request at our own cron endpoints on demand.
--   * INVOKER fails CLOSED for those roles instead: anon/authenticated have
--     no USAGE on `vault` at all, so the body errors "permission denied for
--     schema vault" even if a grant were ever restored. INVOKER + REVOKE is
--     two independent locks; DEFINER + REVOKE is one.
-- The REVOKE below names `service_role` EXPLICITLY: a PUBLIC-only revoke
-- leaves `service_role=X` standing (measured). This helper gets NO harness
-- door — unlike 064's D291 door on the three week workers, there is no
-- harness reason to make the database issue a secret-bearing request.
-- (Honest scope, two parts, neither claimed to be closed here:
--   (1) this does NOT make the database unable to issue HTTP requests
--       generally — Supabase grants EXECUTE on `net.http_get` itself to
--       anon/authenticated/service_role by platform default;
--   (2) the REVOKE is NOT what keeps `service_role` away from the SECRET.
--       Measured on this stack: `has_schema_privilege('service_role',
--       'vault', 'USAGE')` and `has_table_privilege('service_role',
--       'vault.decrypted_secrets', 'SELECT')` are BOTH true, so anything
--       holding the service-role key can read the plaintext `CRON_SECRET`
--       out of the database directly, with no help from this function. That
--       is a genuinely NEW fact about the system: before 124 the secret
--       lived only in Vercel's env. CONSEQUENCE FOR ROTATION — a
--       service-role key leak now discloses `CRON_SECRET` too, so a key
--       rotation must rotate `CRON_SECRET` on BOTH sides (Vault and Vercel)
--       as well. anon/authenticated hold neither privilege (measured false),
--       which is the fail-closed the INVOKER argument above rests on.)
--
-- `timeout_milliseconds => 55000`, NOT the 5000 default: `/api/cron/
-- score-week` deliberately runs a ~50 s budget under `maxDuration = 60`
-- (`score-week/route.ts:41`), so the default would record `timed_out` on
-- every single call.
--
-- ---------------------------------------------------------------------------
-- THE STALL CHECK — `public.scoring_stall_check()`, and where it is READ
-- ---------------------------------------------------------------------------
-- pg_net is FIRE-AND-FORGET: it does not retry, and a failed call surfaces
-- nowhere pg_cron looks. A silently failing drain would look EXACTLY like the
-- bug above, so this migration owes a mechanism that NOTICES.
--
-- IT HAS TWO ARMS, BECAUSE THE QUEUE ALONE CANNOT SEE THE LIKELIEST FAILURE
-- OF THIS VERY DESIGN.
--
-- ARM 1 — THE QUEUE IS NOT BEING DRAINED. `score_fanout` rows that are
-- CLAIMABLE RIGHT NOW and that nothing has moved in ten minutes:
--
--     enqueued_at    <  p_now - 10 min
--     AND (claimed_at     IS NULL OR claimed_at     < p_now - 10 min)
--     AND (deferred_until IS NULL OR deferred_until < p_now - 10 min)
--
-- The stamps are read as INSTANTS, never as mere presence, and that is the
-- correction this arm exists to carry. Nothing ever clears either stamp on a
-- row a dead drain left behind: `claimed_at` is cleared only by
-- `score_fanout_ack` under its own token or overwritten by the next claim
-- (122 §4), and `deferred_until` only by ingestion's re-stamp
-- (`ingest-week.ts:757-765`) — which never comes once the game is over. So
-- `claimed_at IS NULL AND deferred_until IS NULL` would exempt, FOR THE REST
-- OF ITS LIFE, every row that one drain touched before it died — the exact
-- population a hard kill leaves (the invoker's own docblock says the
-- `finally` release is best-effort and "the lease expiry is the backstop",
-- `score-week-invoker.ts:1338-1345`, and Vercel hard-kills at `maxDuration`
-- = 60 while a 50 s drain holds up to 500 leased rows). The check would have
-- gone blind exactly when a drain dies mid-work, which is the case it exists
-- for. MEASURED before the fix: a row enqueued 08:50:35Z and claimed at
-- 08:50:40Z with a long-expired lease is matched by `score_fanout_claim`'s
-- own predicate at 14:50Z — genuinely undrained work — while the check
-- returned `{"rows": 0, "stalled": false}`. The repo's own worker already
-- drew the distinction correctly (`score-week-worker.ts:757` treats deferral
-- as `deferred_until > now`, not `IS NOT NULL`); this arm now agrees with it.
--
-- WHY TEN MINUTES ON ALL THREE STAMPS AND NOT THE 120 s LEASE. Ten minutes
-- is a STRICT SUBSET of what `score_fanout_claim` would take (122 §3:
-- `claimed_at IS NULL OR claimed_at < p_now - lease` with lease = 120 s, and
-- `deferred_until IS NULL OR deferred_until <= p_now`), because 10 min > 120 s
-- — so this arm can never count a row the claim would refuse. Using one
-- threshold for all three also buys the margin the deferral arm NEEDS: a
-- healthy drain re-defers a held row 30 s at a time (`deferSeconds = 30`), so
-- at any sampled instant a legitimately-held row may be sitting with a
-- deferral that elapsed up to a minute ago, waiting for the next per-minute
-- invocation. A bare `deferred_until <= p_now` would fire on that healthy
-- hold. A stall check that fires on healthy queues gets muted, and a muted
-- alarm is the bug this migration exists to end.
--
-- ARM 2 — INGESTION HAS STOPPED, so there is no queue to be backed up.
-- ARM 1 is downstream of the OTHER ping. Both jobs call the same
-- `cron_ping_route`, through the same pg_net worker, with the same two Vault
-- secrets, at the same origin — so they fail TOGETHER: a `CRON_SECRET`
-- rotated in Vercel and not in Vault, a push before `vault.create_secret`, a
-- typo'd origin, pg_net wedged, Vercel down. And when `sync-live` stops,
-- `ingest-week.ts:752-784` is the ONLY enqueue path, so no new rows arrive:
-- the queue drains to empty or holds whatever it had, and ARM 1 reports
-- HEALTHY while the entire pipeline is dark. Silence reading as health is
-- precisely CLAUDE.md's forbidden shape, one level up from the incident.
-- So the check also reads the surface ingestion ALREADY writes, per
-- successful poll, and has since 122 — `system_flags` key
-- `ingest_poll:<season>:<week>`:
--
--     max(updated_at) over key LIKE 'ingest_poll:%'  <  p_now - 2 hours
--
-- No new heartbeat, no new writer. `updated_at` on those rows IS the
-- `completed_at` inside the value — `persistPollOutcome` passes the same
-- `report.polledAt` to both (`ingest-flags.ts`, pinned in
-- `ingest-flags-db.test.ts`) — and it is read from the COLUMN so a malformed
-- value can never raise inside a cron job.
--
-- TWO HOURS, because the floor on a healthy cadence is HOURLY, not
-- per-minute: outside a game window `planLivePoll` is IDLE and makes no
-- provider call at all, sweeping exactly once an hour at minute 0
-- (`SWEEP_MINUTE = 0`, `live-poll.ts`). Two hours therefore tolerates
-- exactly ONE missed sweep and no more. A single provider blip must not
-- light a banner on its own — that is `stats_degraded`'s job, after three
-- failures.
--
-- AND WHY A MISSING ROW IS NOT A STALL. If no `ingest_poll:%` row exists at
-- all, this arm stays quiet. That is not "nothing happened means it worked":
-- the state this arm exists to catch is ingestion that WAS running and
-- STOPPED, and that always leaves a row behind — `system_flags` rows are
-- never deleted, and production has carried `ingest_poll:2026:1` since the
-- 08:50:35Z poll of the measured incident. A database with NO such row has
-- never ingested once: a fresh local stack, a preview branch, the dev seed.
-- Firing there would put a permanent banner on every developer's in-season
-- league, and a permanently-on banner is a muted one. pgTAP 072 §F pins both
-- directions, including that the exemption is narrow.
--
-- WHAT IS DELIBERATELY *NOT* USED: `cron.job_run_details`. It would catch
-- the absent-secret case within a minute, and it was measured before being
-- rejected — `has_schema_privilege('service_role', 'cron', 'USAGE')` is
-- FALSE on this project, so reading it from an INVOKER function would make
-- `scoring_stall_check` error for the one role that is deliberately granted
-- EXECUTE on it (the D291 harness door, 064:98-101). And it is the WEAKER
-- signal anyway: pg_cron records `succeeded` the moment pg_net accepts the
-- request, so a ping that lands and 401s, or never leaves the box, is
-- `succeeded` there (F329). ARM 2 catches that case and the absent-secret
-- case both, from a surface every role can already read.
--
-- WHERE IT IS READ — and this is the whole point. It upserts `system_flags`
-- key `scoring_stalled`, which the in-season scoring surfaces ALREADY poll
-- every 60 s while a week is `live`/`correction_window`
-- (`use-stats-degraded.ts`, mounted at `matchup-view.tsx` and
-- `league-home-season.tsx`) and already render a caution banner from
-- (`LiveStatsDelayedBanner`, `status-banners.tsx`). On a live Sunday
-- that page is the most-refreshed surface this app has. Every other
-- candidate surface has a MEASURED readership of zero: there is no Sentry,
-- Logtail, Datadog, PostHog or webhook anywhere in `package.json`, so a
-- `console.error` into Vercel logs is pull-only; `cron.job_run_details` has
-- no reader in this repo; and `net._http_response` is UNLOGGED with
-- `pg_net.ttl = '6 hours'` AND has no `url` column at all — it cannot even
-- say WHICH ping failed, and a connect failure there is `status_code = NULL`
-- rather than a non-2xx, so the obvious predicate misses the likeliest
-- failure. It is a debugging aid for a live incident, never the mitigation.
-- (It writes a RAISE WARNING beside the flag: free, and it is the forensic
-- half in the Postgres log.)
--
-- It also complements `reconcile`'s `stuck_queue` (`reconcile.ts:161,
-- 312-327`), which ages `enqueued_at` ALONE at an hourly threshold and names
-- every player: that one says "here is what was left behind", this one says
-- "the drain STOPPED". Both stay.
--
-- KNOWN RESIDUAL, stated rather than papered over: this checker lives inside
-- the thing it checks. If pg_cron itself dies, the flag freezes at its last
-- value and stale reads as healthy. `checked_at` moves on EVERY run so that
-- a frozen value is the tell — but NOTHING IN THE CLIENT READS THAT
-- FRESHNESS, deliberately: doing so needs a wall-clock sample in the hook
-- and in both callers, and `matchup-view.render.test.ts` /
-- `league-home-season.render.test.ts` pin "no clock (§23.3 / F226) in the
-- view, the ops or the hooks" over exactly those files — measured, adding it
-- reds both cells. The assertion belongs where a clock is sanctioned AND
-- where it still runs when the database's own scheduler is dead: the CI step
-- PROGRESS F330(a) names, correct the day after 124 reaches production.
-- Until then the daily `reconcile` `stuck_queue` alert is the only cover,
-- and F330 says out loud that its channel has no reader.
--
-- Staging rehearsal: R6 waiver — no staging clone; rehearsal evidence = the
-- fresh local `db reset` 001–124 + pgTAP 072 + `npm run test:db` in this PR.
-- No launch-surface table is touched: two new functions, three cron rows, one
-- amended COMMENT.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. pg_net — the transport
-- ---------------------------------------------------------------------------
-- NO VERSION PIN: local measures 0.20.3, production offers 0.20.0. `IF NOT
-- EXISTS` with no version resolves to each environment's own default; pinning
-- one would fail to install on the other.
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 2. cron_ping_route — one helper, path-parameterised, serving both routes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_ping_route(p_path TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER          -- deliberate; see the banner. The caller is `postgres`.
SET search_path = ''      -- house law; pg_catalog stays implicit (btrim/rtrim/jsonb_build_object)
AS $fn$
DECLARE
  c_origin_name CONSTANT TEXT := 'fieldscout_site_origin';
  c_secret_name CONSTANT TEXT := 'fieldscout_cron_secret';
  v_origin      TEXT;
  v_secret      TEXT;
  v_request_id  BIGINT;
BEGIN
  SELECT s.decrypted_secret INTO v_origin
    FROM vault.decrypted_secrets s WHERE s.name = c_origin_name;
  SELECT s.decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets s WHERE s.name = c_secret_name;

  -- LOUD, NOT SILENT. A missing/empty secret otherwise becomes
  -- {"Authorization": null} (via ||) or 'Bearer ' (via format) — a request
  -- the route 401s forever with nothing to show for it. btrim guards the
  -- empty-string case, which IS NULL alone would sail past.
  IF v_origin IS NULL OR btrim(v_origin) = '' THEN
    RAISE EXCEPTION 'cron_ping_route(%): vault secret "%" is missing or empty — NO request was sent', p_path, c_origin_name
      USING ERRCODE = 'config_file_error',
            HINT = 'select vault.create_secret(''https://fieldscout.gg'', ''fieldscout_site_origin'');';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE EXCEPTION 'cron_ping_route(%): vault secret "%" is missing or empty — NO request was sent', p_path, c_secret_name
      USING ERRCODE = 'config_file_error',
            HINT = 'select vault.create_secret(''<the Vercel CRON_SECRET>'', ''fieldscout_cron_secret'');';
  END IF;

  SELECT net.http_get(
           url     => rtrim(btrim(v_origin), '/') || p_path,
           headers => jsonb_build_object('Authorization', 'Bearer ' || v_secret),
           -- NOT the 5000 default: score-week runs a ~50 s budget under
           -- maxDuration = 60, so the default records timed_out every call.
           timeout_milliseconds => 55000
         ) INTO v_request_id;

  -- Fire-and-forget by design: the response lands in `net._http_response`
  -- (UNLOGGED, 6 h TTL, no url column). Section 3 is what NOTICES a failure.
  RETURN v_request_id;
END;
$fn$;

COMMENT ON FUNCTION public.cron_ping_route(TEXT) IS
  'Fires one authenticated GET at `<fieldscout_site_origin><p_path>` with `Authorization: Bearer <fieldscout_cron_secret>`, both read from Vault BY NAME at call time (never in git, rotated without a deploy). SECURITY INVOKER on purpose — the caller is pg_cron''s `postgres`, which already reads Vault, and INVOKER additionally fails closed for anon/authenticated (no USAGE on `vault`). A missing or empty secret RAISES config_file_error and sends NOTHING, rather than a `Bearer null` the route 401s forever in silence (124; PROGRESS Q43).';

-- Nobody but the scheduler. `service_role` is named EXPLICITLY: a PUBLIC-only
-- REVOKE leaves `service_role=X` standing. This helper gets no D291-style
-- harness door — there is no harness reason to make the database issue a
-- request carrying our cron secret.
REVOKE EXECUTE ON FUNCTION public.cron_ping_route(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. scoring_stall_check — the mechanism that NOTICES a dead drain
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scoring_stall_check(p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER          -- writes as `postgres` (rolbypassrls) from cron; 122's
                          -- "no client write policy for any role" is untouched.
SET search_path = ''
AS $fn$
DECLARE
  -- TEN minutes, applied to ALL THREE of the row's stamps. See the banner:
  -- this is a strict subset of what `score_fanout_claim` would take (its
  -- lease is 120 s and 10 min > 120 s), so the arm can never count a row the
  -- claim would refuse; and the margin is what keeps a healthy 30 s re-defer
  -- from lighting the banner between two per-minute invocations.
  c_stall_after  CONSTANT INTERVAL := INTERVAL '10 minutes';
  -- TWO hours: outside a game window the poll is IDLE and sweeps once an
  -- hour (`SWEEP_MINUTE = 0`), so this tolerates exactly one missed sweep.
  c_ingest_after CONSTANT INTERVAL := INTERVAL '2 hours';
  v_cutoff       TIMESTAMPTZ;
  v_rows         INTEGER;
  v_oldest       TIMESTAMPTZ;
  v_last_ingest  TIMESTAMPTZ;
  v_ingest_stale BOOLEAN;
  v_reasons      JSONB := '[]'::jsonb;
  v_value        JSONB;
BEGIN
  v_cutoff := p_now - c_stall_after;

  -- ARM 1 — the queue is not being drained. CLAIMABLE NOW (122 §3's own
  -- predicate) and untouched for the threshold. The stamps are read as
  -- INSTANTS: a row whose leasing drain was hard-killed keeps its
  -- `claimed_at` forever and a row whose defer window elapsed keeps its
  -- `deferred_until` forever, and both are work the claim would still take.
  SELECT count(*)::INTEGER, min(q.enqueued_at)
    INTO v_rows, v_oldest
    FROM public.score_fanout q
   WHERE q.enqueued_at < v_cutoff
     AND (q.claimed_at     IS NULL OR q.claimed_at     < v_cutoff)
     AND (q.deferred_until IS NULL OR q.deferred_until < v_cutoff);

  -- ARM 2 — INGESTION has stopped, so there is no queue to be backed up.
  -- Both pings share one helper, one pg_net worker, two Vault secrets and
  -- one origin, so they die together; with `sync-live` dead nothing is ever
  -- enqueued again and ARM 1 looks at an empty queue and reports healthy.
  -- `updated_at` on an `ingest_poll:<season>:<week>` row IS the
  -- `completed_at` in its value (`persistPollOutcome` passes one instant to
  -- both) — read from the COLUMN so a malformed value cannot raise here.
  SELECT max(f.updated_at)
    INTO v_last_ingest
    FROM public.system_flags f
   WHERE f.key LIKE 'ingest_poll:%';

  -- A MISSING row is NOT a stall: it means this database has never ingested
  -- once (a fresh stack, a preview branch, the dev seed), not that a running
  -- pipeline stopped. Ingestion that stops always leaves its row behind —
  -- `system_flags` rows are never deleted.
  v_ingest_stale := v_last_ingest IS NOT NULL AND v_last_ingest < p_now - c_ingest_after;

  IF v_rows > 0        THEN v_reasons := v_reasons || to_jsonb('queue_undrained'::TEXT); END IF;
  IF v_ingest_stale    THEN v_reasons := v_reasons || to_jsonb('ingest_stale'::TEXT);    END IF;

  v_value := jsonb_build_object(
    'stalled',                  (v_rows > 0 OR v_ingest_stale),
    'reasons',                  v_reasons,
    'rows',                     v_rows,
    'oldest_enqueued_at',       v_oldest,
    'threshold_minutes',        (EXTRACT(EPOCH FROM c_stall_after) / 60)::INTEGER,
    'ingest_stale',             v_ingest_stale,
    'last_ingest_at',           v_last_ingest,
    'ingest_threshold_minutes', (EXTRACT(EPOCH FROM c_ingest_after) / 60)::INTEGER,
    'checked_at',               p_now);

  -- `checked_at` moves every run whether or not anything is wrong: a FROZEN
  -- `checked_at` is itself the tell that this job stopped running. Nothing
  -- reads that freshness yet, and that is a ruling — the client surfaces
  -- that would are under a no-clock pin (§23.3 / F226); the assertion
  -- belongs in CI, PROGRESS F330(a).
  INSERT INTO public.system_flags (key, value, updated_at)
  VALUES ('scoring_stalled', v_value, p_now)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

  -- The forensic half (Postgres log). The half that gets READ is the flag
  -- above, which the in-season banner polls every 60 s.
  IF v_rows > 0 THEN
    RAISE WARNING 'scoring_stalled/queue_undrained: % score_fanout row(s) claimable and untouched since % (> %) — the score-week drain is not running (§23.2)',
      v_rows, v_oldest, c_stall_after;
  END IF;
  IF v_ingest_stale THEN
    RAISE WARNING 'scoring_stalled/ingest_stale: the last successful ingestion poll completed % (> % ago) — sync-live is not running, so nothing is being enqueued at all (§23.2; both pings share one helper and one pair of Vault secrets)',
      v_last_ingest, c_ingest_after;
  END IF;

  RETURN v_value;
END;
$fn$;

COMMENT ON FUNCTION public.scoring_stall_check(TIMESTAMPTZ) IS
  'Every minute (124), two arms, and upserts `system_flags.scoring_stalled` {stalled, reasons, rows, oldest_enqueued_at, threshold_minutes, ingest_stale, last_ingest_at, ingest_threshold_minutes, checked_at}. ARM 1 `queue_undrained`: `score_fanout` rows `score_fanout_claim` WOULD STILL TAKE (its own claimability predicate, 122 §3) that nothing has moved in 10 minutes — the stamps are read as INSTANTS, so a row whose leasing drain was hard-killed and a row whose defer window elapsed both COUNT, which `claimed_at IS NULL AND deferred_until IS NULL` exempted forever. ARM 2 `ingest_stale`: no `ingest_poll:<season>:<week>` row has been written in 2 hours — because both pings share one helper and one pair of Vault secrets, so when they die together nothing is enqueued and an empty queue would otherwise read as health. A MISSING ingest_poll row is not a stall (never ingested is not stopped). The in-season scoring surfaces poll this key every 60 s and raise the "Live stats delayed" banner from it — the one surface in this system with a measured human reader. Complements reconcile''s hourly-threshold `stuck_queue` (which ages enqueued_at alone and names each player). A frozen `checked_at` means this job itself stopped — nothing reads that freshness yet, by ruling — the client surfaces that would are under a no-clock pin (§23.3 / F226), so the assertion belongs in CI (F330(a)).';

REVOKE EXECUTE ON FUNCTION public.scoring_stall_check(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
-- `service_role` KEEPS the platform-default EXECUTE — the D291 harness/sim
-- door the three week workers have (064:98-101). Unlike `cron_ping_route`
-- this reads a queue and writes an operational flag; it carries no secret.

-- 122's table comment said "written by the sync routes as service_role only".
-- There is now a SECOND writer and a THIRD key; leaving the prose would make
-- this job read as a breach of a posture it does not touch (070's role walk
-- covers anon/authenticated, not postgres, and is unaffected).
COMMENT ON TABLE public.system_flags IS
  'Operational flags, one row per key (122, L.D2.3 — PROGRESS F217; extended by 124). `stats_degraded` = §23.2''s incident flag as persisted across serverless invocations (value: degraded, consecutive_failures, last_failure_at, last_success_at, last_error, provider); `ingest_poll:<season>:<week>` = the instant the last successful ingestion poll for that week completed (value: completed_at, provider) — the worker''s F218/R714 orphan escape reads it; `scoring_stalled` = 124''s drain stall check (value: stalled, reasons, rows, oldest_enqueued_at, threshold_minutes, ingest_stale, last_ingest_at, ingest_threshold_minutes, checked_at), written every minute by the `scoring-stall-check` pg_cron job as `postgres` — its second arm READS the `ingest_poll:` keys above, so a scheduler that stops feeding them is itself the alarm. World-SELECT (the "Live stats delayed" banner, §23.2/E45); the sync routes write as service_role and pg_cron writes as postgres — still NO client write policy for any role.';

-- ---------------------------------------------------------------------------
-- 4. pg_cron — one entry per job (§22.3), unschedule-first (068:1257-1268)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $do$
BEGIN
  -- Idempotent re-apply: unschedule-if-exists first (068:1263). Verified in
  -- pgTAP 072 §A by running this very block twice inside one transaction.
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

  -- Its own job, NOT appended to a ping body: the stall check must keep
  -- running in exactly the case the pings are failing — an absent secret
  -- raises out of `cron_ping_route` before anything after it could run, and
  -- an absent secret is precisely when the queue starts stalling. It reads
  -- no Vault and issues no request.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scoring-stall-check') THEN
    PERFORM cron.unschedule('scoring-stall-check');
  END IF;
  PERFORM cron.schedule('scoring-stall-check', '* * * * *',
    'SELECT public.scoring_stall_check()');
END;
$do$;
