-- ============================================================================
-- 121_score_fanout_claim.sql — the `score_fanout` CLAIM + ACK pair: §22.3's
-- "concurrent invocations are safe by construction" made TRUE for the TS
-- worker (task L.D2.2, PR #267 fix round — PROGRESS R866; spec v2.16.31
-- §22.2 / §22.3 / §12.19-adjacent (109's queue) / §23.2; PROGRESS D292 /
-- D321(2)(10) / F218 / F263(d); tasks-M4 §4 rules 1–11 + §6 L.D2.2).
--
-- Numbering: migration head measured 120 at task time (ls supabase/migrations/
-- | tail -1) ⇒ 121; pgTAP head 068 ⇒ 069 (D161/D166). NOT the schema lane's
-- reopening: one queue table gains two nullable columns and two service-role
-- RPCs; no launch-surface object is touched (HELD paragraph below).
--
-- WHY (R866, the reviewer's interleaving, reproduced on the stack and now a
-- permanent cell): the L.D2.2 drain was read-then-ack — the worker READ
-- stamped rows, scored, wrote through the door, and DELETEd by stamp.
-- Nothing stopped a SECOND drain from reading the same player while the
-- first was still in flight. Drain A reads K at stamp S1 and the OLD line;
-- a poll re-stamps K to S2 and lands the NEW line; drain B reads K at S2,
-- scores the new line, writes, and deletes K@S2; A then writes its OLD
-- score over B's (the door is last-writer-wins by design — 119's
-- IS DISTINCT FROM is idempotence for identical re-sends, not ordering) and
-- its ack misses (0 of 1). The queue is EMPTY and `matchups` holds the
-- stale score; nothing re-enqueues it (the next poll's diff reads the stored
-- line as current, §23.2's reconciliation only alerts). The by-stamp ack
-- (D321(2)) closed the single-drain race; it never addressed two drains.
-- L.D2.3's 5–10 s cron plus one Vercel retry/overlap IS this condition.
--
-- WHAT THIS DOES
--   1. `score_fanout` gains a LEASE: `claimed_at TIMESTAMPTZ` +
--      `claim_token UUID`, both NULL or both set (CHECK). A leased row is
--      INVISIBLE to every other claim until its holder ACKs it or the lease
--      expires. Ingestion's re-enqueue (`ON CONFLICT DO UPDATE SET
--      enqueued_at`, D321(2)) touches only the stamp — PostgREST's upsert
--      SETs the payload's columns and nothing else — so a delta landing
--      mid-drain MOVES THE STAMP AND KEEPS THE LEASE: the in-flight drain
--      still owns the row, its by-stamp ack MISSES (the stamp moved), the
--      ack RELEASES the row, and the NEXT drain scores the newer line. No
--      second drain can consume the newer delta while the first is in
--      flight — the ordering hazard R866 showed is gone by construction,
--      not by luck. (069 pins the SQL twin of the upsert keeping the lease;
--      the stack suite pins it through PostgREST itself.)
--   2. `score_fanout_claim(p_batch, p_lease_seconds DEFAULT 120,
--      p_now DEFAULT now())` — THE claim (§22.3 / D292's named vehicle,
--      F263(d)'s trigger met): the oldest `p_batch` rows that are unleased
--      OR whose lease is older than `p_lease_seconds` (the visibility
--      timeout — §22.3's own words for pgmq, on a plain table),
--      `FOR UPDATE SKIP LOCKED` (two claims colliding at the same instant
--      never block each other, and the row lock + the UPDATE make their
--      sets disjoint), stamped with ONE fresh token per call and
--      `claimed_at = p_now`, returned as (season, week, player_id,
--      enqueued_at, claim_token, claimed_at). `p_now` is injected (D291):
--      the worker passes its TimeProvider's instant, so the lease decision
--      reads no clock the worker does not; the cron/default is `now()`.
--      Readiness (F218) is NOT evaluated here — the worker still holds a
--      claimed row whose stats have not landed and releases it (R872: a
--      held row therefore still costs a slot per drain; recorded on
--      F263(e), the not_ready-aware claim is the closer).
--   3. `score_fanout_ack(p_claim_token, p_consumed)` — THE ack, one call
--      per drain, one transaction: DELETEs every consumed row that STILL
--      carries this token AND the stamp the claim returned (the jsonb →
--      timestamptz cast is exact to the microsecond — R867: the old
--      PostgREST `.eq` on a millisecond-normalised string could never
--      match a `DEFAULT now()` stamp, so such a row was re-claimed forever),
--      classifies every consumed row it could NOT delete by what is
--      MEASURED (R869) — `restamped` (present, our token, a newer stamp:
--      a delta landed mid-drain), `lease_lost` (present, another token or
--      none: our lease expired and another drain re-claimed it — the ONE
--      window in which a stale write can land, bounded by the lease and
--      REPORTED, never silent), `gone` (absent: consumed by the drain that
--      took our lease) — and then RELEASES every row still under this
--      token (the re-stamped, the not-ready, the held, the out-of-scope:
--      `claimed_at`/`claim_token` back to NULL). Returns
--      {deleted, released, missed: [{season, week, player_id, reason}]}.
--      An empty `p_consumed` is a pure release (the worker's crash-path
--      `finally`; a drain that threw mid-way hands its rows straight back
--      instead of waiting out the lease).
--
-- THE TRADEOFF, STATED (§22.3's at-least-once vs. the lease): a drain that
-- outlives its lease — slower than `p_lease_seconds` end to end — can be
-- re-claimed while still in flight, and its late door write is then the
-- stale write R866 describes, for that one row. That is the crash-recovery
-- window every visibility-timeout queue has (pgmq's included); it is
-- measured by the ack (`lease_lost`) and the worker reports it as a
-- problem. PRECONDITION on L.D2.3 (F263(f)): the invoker's lease must be
-- ≥ its own hard timeout (Vercel's `maxDuration`) so a live drain is never
-- re-claimed; a crashed drain's rows return after the lease. Idempotence
-- (the door's `no_change`) still covers a re-drain after a crash between
-- the door write and the ack.
--
-- FORM (tasks-M1 §4.1, D18→D23; 116/119's shape): both functions SECURITY
-- DEFINER, `search_path = ''`, in-body JWT refusal (42501 — the queue is
-- the worker's, never a signed-in user's), REVOKEd from PUBLIC / anon /
-- authenticated; service_role keeps the platform default EXECUTE (069 pins
-- it positively). 109's RLS posture is unchanged: RLS on, ZERO policies —
-- service_role alone reads and writes the queue. No index added: the queue
-- holds the changed players of one poll window (hundreds), the claim's
-- ORDER BY over it is a trivial scan; §22.4 gets an index when M7's
-- measurements ask for one.
--
-- Staging rehearsal: R6 waiver — no staging clone; rehearsal evidence =
-- the fresh local `db reset` 001–121 + pgTAP 069 (+ 057 moved in place) +
-- the stack vitest `score-week-worker-db.test.ts` in the same PR (the
-- R866 interleaving cell red on the pre-fix worker, green here).
-- HELD-FROM-PRODUCTION: 082-120 → 082-121 (same PR).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The lease columns
-- ---------------------------------------------------------------------------
ALTER TABLE score_fanout
  ADD COLUMN claimed_at  TIMESTAMPTZ,
  ADD COLUMN claim_token UUID;

ALTER TABLE score_fanout
  ADD CONSTRAINT score_fanout_claim_pair
  CHECK ((claimed_at IS NULL) = (claim_token IS NULL));

COMMENT ON COLUMN score_fanout.claimed_at IS
  'The lease (121): set by score_fanout_claim to the claim''s p_now; a leased row is invisible to other claims until score_fanout_ack releases or deletes it, or the lease is older than the next claim''s p_lease_seconds. NULL = unclaimed. Ingestion''s re-stamp never touches it (D321(2)).';
COMMENT ON COLUMN score_fanout.claim_token IS
  'The claim that holds the lease (121): one gen_random_uuid() per score_fanout_claim call, stamped on every row it returned; score_fanout_ack deletes/releases only rows carrying the caller''s token. NULL = unclaimed.';

-- ---------------------------------------------------------------------------
-- 2. score_fanout_claim — the atomic claim (§22.3; D292; F263(d))
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
  -- older than the visibility timeout. SKIP LOCKED: a claim racing another
  -- at the same instant never blocks on it; the row lock + the UPDATE make
  -- the two result sets disjoint (069 pins the lease half in one session;
  -- the stack suite pins disjointness across two real PostgREST sessions).
  RETURN QUERY
    WITH picked AS (
      SELECT q.season, q.week, q.player_id
        FROM public.score_fanout q
       WHERE q.claimed_at IS NULL
          OR q.claimed_at < p_now - make_interval(secs => p_lease_seconds)
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
-- 3. score_fanout_ack — the by-(token, stamp) delete + the release
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION score_fanout_ack(
  p_claim_token UUID,
  p_consumed    JSONB   -- [{season, week, player_id, enqueued_at}] — the claim's OWN rows, the stamp verbatim
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

  -- (1) The batch's SHAPE (22023 — a malformed argument, never a state
  --     conflict): every element an object carrying the four keys, the
  --     stamp parseable as timestamptz.
  FOR v_e IN SELECT * FROM jsonb_array_elements(p_consumed) LOOP
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

  -- (3) RELEASE everything still under this token: the re-stamped survivors,
  --     the not-ready, the held, the out-of-scope. Rows another claim took
  --     (a different token) are untouched — they are that drain's now.
  UPDATE public.score_fanout
     SET claimed_at = NULL, claim_token = NULL
   WHERE claim_token = p_claim_token;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted',  v_deleted,
    'released', v_released,
    'missed',   v_missed
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION score_fanout_ack(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
