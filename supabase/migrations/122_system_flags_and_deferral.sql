-- ============================================================================
-- 122_system_flags_and_deferral.sql — production wiring's two persisted
-- surfaces (task L.D2.3; spec v2.16.32 §14 / §22.3 / §23.2 / §24.1;
-- PROGRESS D322; discharges F217 (the `stats_degraded` vehicle) and
-- F263(e)'s two halves (the last-poll surface the worker's orphan escape
-- reads, and R872's starvation closer — `deferred_until` on release);
-- tasks-M4 §4 rules 1–11 + §6 L.D2.3).
--
-- Numbering: migration head measured 121 at task time (ls supabase/migrations/
-- | tail -1) ⇒ 122; pgTAP head 069 ⇒ 070 (D161/D166). NOT the schema
-- lane's reopening: one small operational table, one nullable column on
-- 109's service-role-only queue, and the 121 pair re-authored against 121's
-- FILE TEXT (D137 — provenance: `121_score_fanout_claim.sql`, its only
-- definition; `score_fanout_ack` is DROPPED at the 2-argument signature and
-- re-created at 4 because a CREATE OR REPLACE cannot add arguments — the
-- 115 precedent; pgTAP 069's signature pins move in place).
--
-- WHY (each surface names its finding):
--
--   1. `system_flags` — F217. §23.2 raises `stats_degraded` "after 3 failed
--      polls" and §24.1 alerts on it; L.D2.1's flag is M0's process-memory
--      `DegradationTracker`, correct for one process (the harness) and
--      useless across Vercel invocations, which are each a fresh process:
--      the count could never reach 3, and L.D5.2's "Live stats delayed"
--      banner had nothing to read. One row per key, `value` JSONB:
--        * `stats_degraded` → {degraded, consecutive_failures,
--          last_failure_at, last_success_at, last_error, provider}
--        * `ingest_poll:<season>:<week>` → {completed_at, provider} — the
--          instant the last SUCCESSFUL ingestion poll for (season, week)
--          completed (= the poll's injected instant, the stamp every row it
--          wrote carries), F218/R714's orphan escape: a queued row whose
--          stat line is older than its stamp is normally held (the stats
--          have not landed); when a later poll completed after the stamp
--          and left the line untouched, the stored line IS the truth and
--          the row is ready. The worker's `lastPollCompletedAt` seam
--          (D321(1), F263(e)) reads this key — L.D2.3's route binds it.
--      RLS ON; SELECT for everyone (the banner is a public surface — a
--      flag and a timestamp, never a secret); NO write policy for any role
--      — the sync routes write it as service_role (070 walks the roles with
--      RETURNING counts). No RPC: the writer is server-side sync territory
--      (rule 9), exactly like `nfl_weeks` (039).
--
--   2. `score_fanout.deferred_until` + the pair re-authored — R872 (the
--      #267 review; F263(e)). 121's claim is `ORDER BY enqueued_at ASC
--      LIMIT p_batch` and does NOT evaluate readiness (it cannot — the F218
--      predicate needs the last-poll surface the SQL could not read until
--      this migration; and `week_not_open` is per LEAGUE, which the queue
--      row does not know). So a permanently held row — an orphan, a league
--      whose week has not opened — sat at the HEAD of every claim, cost a
--      slot per drain, and at ≥ `batchSize` of them the queue STARVED.
--      The closer R872 named: the ack takes the held rows back with a
--      `deferred_until` (the worker passes `time.now() + deferSeconds` —
--      D291: the deferral reads no clock the worker does not), and the
--      claim skips a row whose `deferred_until` is still ahead of `p_now`
--      (inclusive release: at `deferred_until` exactly the row is claimable
--      — D146's one-unit rule, pinned both sides). A held row therefore
--      costs a slot once per deferral, never once per drain. Ingestion's
--      re-stamp CLEARS the deferral (`deferred_until = NULL` joins the
--      enqueue payload — `ingest-week.ts`, this PR): a fresh delta is
--      claimable at once; the ack never defers a row whose stamp MOVED
--      under the lease (by-stamp, like the delete — a newer delta is ready
--      by definition). `deferred_until` is independent of the lease
--      columns: the ack RELEASES the lease and SETS the deferral in the
--      same statement, so a deferred row is unleased and skippable, never
--      leased-and-hidden.
--
-- `score_fanout_claim(p_batch, p_lease_seconds DEFAULT 120, p_now DEFAULT
-- now())` — 121's body verbatim plus ONE predicate in the pick:
--   AND (q.deferred_until IS NULL OR q.deferred_until <= p_now)
-- `score_fanout_ack(p_claim_token, p_consumed, p_deferred DEFAULT '[]',
-- p_defer_until DEFAULT NULL)` — 121's body verbatim plus: the same shape
-- validation over `p_deferred`; `p_defer_until` REQUIRED (22023) when
-- `p_deferred` is non-empty; between the delete and the release, an UPDATE
-- setting `deferred_until = p_defer_until` on every deferred row that STILL
-- carries this token at the stamp the claim returned; the return gains
-- `deferred` (the rows actually stamped). An empty `p_deferred` is 121's
-- ack exactly (the worker's crash-path `finally` passes nothing).
--
-- FORM (tasks-M1 §4.1, D18→D23; 121's shape): both functions SECURITY
-- DEFINER, `search_path = ''`, in-body JWT refusal (42501), REVOKEd from
-- PUBLIC / anon / authenticated; service_role keeps the platform default
-- EXECUTE (070 pins it positively at the NEW signature and pins the old
-- 2-argument ack GONE). 109's RLS posture on the queue is unchanged (RLS on,
-- zero policies). No index added (121's reasoning stands: the queue holds
-- one poll window's changed players).
--
-- Staging rehearsal: R6 waiver — no staging clone; rehearsal evidence =
-- the fresh local `db reset` 001–122 + pgTAP 070 (+ 057 / 069 moved in
-- place) + the stack vitest suites in the same PR (`ingest-flags-db`,
-- the deferral cells in `score-week-worker-db`, `reconcile-db`).
-- HELD-FROM-PRODUCTION: 082-121 → 082-122 (same PR). No launch-surface
-- table is touched: `system_flags` is new and references nothing; the
-- ALTER is on 109's queue; both functions read and write the queue alone.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. system_flags — F217's vehicle
-- ---------------------------------------------------------------------------
CREATE TABLE system_flags (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(value) = 'object')
);

COMMENT ON TABLE system_flags IS
  'Operational flags, one row per key (122, L.D2.3 — PROGRESS F217). `stats_degraded` = §23.2''s incident flag as persisted across serverless invocations (value: degraded, consecutive_failures, last_failure_at, last_success_at, last_error, provider); `ingest_poll:<season>:<week>` = the instant the last successful ingestion poll for that week completed (value: completed_at, provider) — the worker''s F218/R714 orphan escape reads it. World-SELECT (the "Live stats delayed" banner, §23.2/E45); written by the sync routes as service_role only — no client write policy.';

ALTER TABLE system_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_flags readable by everyone"
  ON system_flags FOR SELECT USING (true);
-- No write policy for any role: the sync routes write as service_role
-- (bypasses RLS). 070 pins the walk with RETURNING counts.

-- ---------------------------------------------------------------------------
-- 2. score_fanout.deferred_until — R872's closer
-- ---------------------------------------------------------------------------
ALTER TABLE score_fanout
  ADD COLUMN deferred_until TIMESTAMPTZ;

COMMENT ON COLUMN score_fanout.deferred_until IS
  'R872 / F263(e) (122): set by score_fanout_ack on a HELD row (not ready — its stats have not landed, F218; or its league week has not opened) to the worker''s injected instant + its defer window; score_fanout_claim skips the row while deferred_until > p_now (claimable AT deferred_until, inclusive). Ingestion''s re-stamp clears it (a fresh delta is claimable at once). NULL = not deferred. Independent of the lease pair.';

-- ---------------------------------------------------------------------------
-- 3. score_fanout_claim — 121's body verbatim + the deferral predicate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION score_fanout_claim(
  p_batch         INTEGER,
  p_lease_seconds INTEGER     DEFAULT 120,
  p_now           TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE (
  season      INTEGER,
  week        INTEGER,
  player_id   TEXT,
  enqueued_at TIMESTAMPTZ,
  claim_token UUID,
  claimed_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token UUID := gen_random_uuid();
BEGIN
  -- The worker's queue, never a user verb: a JWT-bearing caller is refused
  -- in-body (rule 2 — the REVOKE below narrows EXECUTE; this says why).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'score_fanout_claim: the scoring queue is the worker''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;

  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 1000 THEN
    RAISE EXCEPTION 'score_fanout_claim: p_batch must be 1..1000 (got %) — the PostgREST row cap bounds a claim so it can never be silently truncated', p_batch
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 THEN
    RAISE EXCEPTION 'score_fanout_claim: p_lease_seconds must be >= 1 (got %)', p_lease_seconds
      USING ERRCODE = '22023';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'score_fanout_claim: p_now is required (the injected instant, D291)'
      USING ERRCODE = '22023';
  END IF;

  -- Oldest first; a row is claimable when unleased or when its lease is
  -- older than the visibility timeout, AND (122) when it is not deferred —
  -- a held row handed back with a `deferred_until` still ahead of p_now is
  -- skipped so it cannot starve the claim (R872). SKIP LOCKED: a claim
  -- racing another at the same instant never blocks on it; the row lock +
  -- the UPDATE make the two result sets disjoint (069 pins the lease half
  -- in one session; the stack suite pins disjointness across two real
  -- PostgREST sessions; 070 pins the deferral boundary).
  RETURN QUERY
    WITH picked AS (
      SELECT q.season, q.week, q.player_id
        FROM public.score_fanout q
       WHERE (q.claimed_at IS NULL
              OR q.claimed_at < p_now - make_interval(secs => p_lease_seconds))
         AND (q.deferred_until IS NULL OR q.deferred_until <= p_now)
       ORDER BY q.enqueued_at, q.season, q.week, q.player_id
       LIMIT p_batch
         FOR UPDATE SKIP LOCKED
    ),
    stamped AS (
      UPDATE public.score_fanout q
         SET claimed_at = p_now, claim_token = v_token
        FROM picked
       WHERE q.season = picked.season AND q.week = picked.week AND q.player_id = picked.player_id
      RETURNING q.season, q.week, q.player_id, q.enqueued_at, q.claim_token, q.claimed_at
    )
    SELECT stamped.season, stamped.week, stamped.player_id, stamped.enqueued_at, stamped.claim_token, stamped.claimed_at
      FROM stamped
     ORDER BY stamped.enqueued_at, stamped.season, stamped.week, stamped.player_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION score_fanout_claim(INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. score_fanout_ack — DROPPED at 121's 2-argument signature, re-created
--    at 4 (a CREATE OR REPLACE cannot add arguments; the 115 precedent).
--    121's body verbatim + the deferral arm.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS score_fanout_ack(UUID, JSONB);

CREATE FUNCTION score_fanout_ack(
  p_claim_token UUID,
  p_consumed    JSONB,                          -- [{season, week, player_id, enqueued_at}] — the claim's OWN rows, the stamp verbatim
  p_deferred    JSONB       DEFAULT '[]'::jsonb, -- same shape: the HELD rows (not ready / week not open) — R872
  p_defer_until TIMESTAMPTZ DEFAULT NULL         -- REQUIRED when p_deferred is non-empty (the worker's injected instant + its window)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_e        JSONB;
  v_i        INTEGER := 0;
  v_stamp    TIMESTAMPTZ;
  v_deleted  INTEGER := 0;
  v_deferred INTEGER := 0;
  v_released INTEGER := 0;
  v_missed   JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'score_fanout_ack: the scoring queue is the worker''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;

  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'score_fanout_ack: p_claim_token is required — the token score_fanout_claim returned'
      USING ERRCODE = '22023';
  END IF;
  IF p_consumed IS NULL OR jsonb_typeof(p_consumed) <> 'array' THEN
    RAISE EXCEPTION 'score_fanout_ack: p_consumed must be a JSON array of {season, week, player_id, enqueued_at} (got %)',
      COALESCE(jsonb_typeof(p_consumed), 'null')
      USING ERRCODE = '22023';
  END IF;
  IF p_deferred IS NULL OR jsonb_typeof(p_deferred) <> 'array' THEN
    RAISE EXCEPTION 'score_fanout_ack: p_deferred must be a JSON array of {season, week, player_id, enqueued_at} (got %)',
      COALESCE(jsonb_typeof(p_deferred), 'null')
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_deferred) > 0 AND p_defer_until IS NULL THEN
    RAISE EXCEPTION 'score_fanout_ack: p_defer_until is required when p_deferred is non-empty (the injected instant + the defer window, D291)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) The batches' SHAPE (22023 — a malformed argument, never a state
  --     conflict): every element of BOTH arrays an object carrying the four
  --     keys, the stamp parseable as timestamptz.
  FOR v_e IN SELECT * FROM jsonb_array_elements(p_consumed || p_deferred) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'score_fanout_ack: element % is not an object', v_i USING ERRCODE = '22023';
    END IF;
    IF v_e ->> 'season' IS NULL OR v_e ->> 'week' IS NULL OR v_e ->> 'player_id' IS NULL OR v_e ->> 'enqueued_at' IS NULL THEN
      RAISE EXCEPTION 'score_fanout_ack: element % must carry season, week, player_id and enqueued_at', v_i USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_e -> 'season') <> 'number' OR jsonb_typeof(v_e -> 'week') <> 'number' THEN
      RAISE EXCEPTION 'score_fanout_ack: element % season/week must be JSON numbers', v_i USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_stamp := (v_e ->> 'enqueued_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'score_fanout_ack: element % enqueued_at % is not a timestamp — send the claim''s own rendering verbatim', v_i, v_e ->> 'enqueued_at'
        USING ERRCODE = '22023';
    END;
  END LOOP;

  -- (2) DELETE what this token still holds at the stamp it was claimed at;
  --     classify the rest by what is measured (R869). The classification
  --     reads the pre-statement snapshot (a data-modifying CTE's effects are
  --     invisible to sibling CTEs), which is exactly the state of every row
  --     the DELETE did not touch.
  WITH c AS (
    SELECT (e ->> 'season')::integer   AS season,
           (e ->> 'week')::integer     AS week,
           (e ->> 'player_id')         AS player_id,
           (e ->> 'enqueued_at')::timestamptz AS enqueued_at
      FROM jsonb_array_elements(p_consumed) e
  ),
  del AS (
    DELETE FROM public.score_fanout q
     USING c
     WHERE q.season = c.season AND q.week = c.week AND q.player_id = c.player_id
       AND q.claim_token = p_claim_token
       AND q.enqueued_at = c.enqueued_at
    RETURNING q.season, q.week, q.player_id
  ),
  miss AS (
    SELECT c.season, c.week, c.player_id,
           CASE WHEN q.player_id IS NULL                THEN 'gone'
                WHEN q.claim_token = p_claim_token      THEN 'restamped'
                ELSE                                         'lease_lost' END AS reason
      FROM c
      LEFT JOIN public.score_fanout q
        ON q.season = c.season AND q.week = c.week AND q.player_id = c.player_id
     WHERE NOT EXISTS (SELECT 1 FROM del WHERE del.season = c.season AND del.week = c.week AND del.player_id = c.player_id)
  )
  SELECT (SELECT count(*) FROM del),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('season', miss.season, 'week', miss.week, 'player_id', miss.player_id, 'reason', miss.reason)
                                    ORDER BY miss.season, miss.week, miss.player_id), '[]'::jsonb)
            FROM miss)
    INTO v_deleted, v_missed;

  -- (2b — 122) DEFER the held rows this token still holds AT THE STAMP the
  --      claim returned (by-stamp, like the delete: a row whose stamp moved
  --      under the lease carries a newer delta and is ready — it is simply
  --      released below). The deferral and the release are one statement
  --      per row: unleased AND deferred, never leased-and-hidden.
  IF jsonb_array_length(p_deferred) > 0 THEN
    WITH d AS (
      SELECT (e ->> 'season')::integer   AS season,
             (e ->> 'week')::integer     AS week,
             (e ->> 'player_id')         AS player_id,
             (e ->> 'enqueued_at')::timestamptz AS enqueued_at
        FROM jsonb_array_elements(p_deferred) e
    ),
    upd AS (
      UPDATE public.score_fanout q
         SET deferred_until = p_defer_until, claimed_at = NULL, claim_token = NULL
        FROM d
       WHERE q.season = d.season AND q.week = d.week AND q.player_id = d.player_id
         AND q.claim_token = p_claim_token
         AND q.enqueued_at = d.enqueued_at
      RETURNING 1
    )
    SELECT count(*) INTO v_deferred FROM upd;
  END IF;

  -- (3) RELEASE everything still under this token: the re-stamped survivors,
  --     the out-of-scope, and any held row the caller did not defer. Rows
  --     another claim took (a different token) are untouched — they are that
  --     drain's now.
  UPDATE public.score_fanout
     SET claimed_at = NULL, claim_token = NULL
   WHERE claim_token = p_claim_token;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted',  v_deleted,
    'deferred', v_deferred,
    'released', v_released + v_deferred,   -- every row handed back, deferred or not (121's meaning of `released`)
    'missed',   v_missed
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION score_fanout_ack(UUID, JSONB, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
