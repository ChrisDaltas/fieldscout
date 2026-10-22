-- ============================================================================
-- 209 — rate limits (M7 L.F2.6; spec §22.5; ledger F41; PROGRESS D700–D706;
--       FULL rigour — permissions)
-- ============================================================================
--
-- THE LAW (§22.5): "Route-layer per-user limits: 10 mutations/10s/league,
-- chat 5 msgs/10s, bids 5/s (server also serializes via the draft lock). 429
-- with retry-after; never silently drop." Mocks share every live-draft limit.
--
-- WHAT THIS ADDS
--
--   `rate_limit_hits` — one row per (user, bucket, scope): the instants of
--   that user's most recent ACCEPTED hits, at most the bucket's limit of
--   them. Server-owned: RLS on with NO policy (anon / authenticated read no
--   row and write none), TRUNCATE revoked. Nobody reads it but the limiter.
--
--   `rate_limit_rule_internal(bucket)` — the three numbers, in one place:
--       chat      5 per 10 000 ms   (per user, per league)
--       mutation 10 per 10 000 ms   (per user, per league or practice draft)
--       bid       5 per  1 000 ms   (per user, per league or practice draft)
--   An unknown bucket is NULL (the callers refuse it by name).
--
--   `rate_limit_take_internal(user, bucket, scope, p_now)` — PLAIN,
--   REVOKEd. A STRICT SLIDING WINDOW: a hit at instant t counts for
--   [t, t + window). Allowed iff fewer than `limit` accepted hits are live at
--   p_now; an allowed hit is recorded, a REFUSED hit writes nothing (so
--   hammering through a refusal never extends the wait). The row is locked
--   FOR UPDATE, so N concurrent takes at the limit admit exactly the free
--   slots. Refusal answers `retry_after_ms` = the instant the oldest live hit
--   leaves the window, minus p_now (≥ 1). Time only through p_now (the
--   TimeProvider seam).
--
--   `rate_limit_take(bucket, scope)` — the DOOR. SECURITY DEFINER,
--   search_path '', in-body gate: a signed-in caller (auth.uid()) — the
--   caller can only ever spend HIS OWN allowance; there is no user argument.
--   The scope must be an existing league or draft (a PK lookup), so a caller
--   cannot mint rows under made-up scopes. Hands now() to the internal.
--   REVOKE PUBLIC / anon, EXECUTE authenticated. The Next middleware calls it
--   with the member's own session for every league / practice-draft mutation
--   (src/middleware.ts + src/lib/rate-limit/route-limits.ts) and turns a
--   refusal into a 429 with Retry-After.
--
--   CHAT HAS NO ROUTE (§9.3 / D99 — the one sanctioned direct client INSERT),
--   so its limit lives on the insert path: `league_chat_rate_limit_guard_
--   internal()`, a BEFORE INSERT trigger on league_chat. It counts ONLY a
--   member's own post — `auth.uid() IS NOT NULL AND NEW.user_id = auth.uid()
--   AND NOT NEW.is_system` — so every system line an RPC writes (is_system
--   TRUE, ~150 call sites), and every service-role write (no auth.uid()), is
--   untouched. A refusal raises SQLSTATE 'PGRST' with PostgREST's JSON
--   envelope, so the client's insert gets HTTP 429 + Retry-After and the
--   message in plain words — never a silent drop. RLS WITH CHECK runs after
--   BEFORE triggers; a post that RLS then refuses rolls the slot back with
--   the statement, so a refused post never spends allowance.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * Additive only: one new table, three new functions, one trigger
--     function + trigger. No CREATE OR REPLACE of an existing function (grep
--     -l 'rate_limit' supabase/migrations → this file only). No policy on an
--     existing table changes; league_chat gains a trigger only.
--   * RLS on the new table in the same migration; no policy (server-owned —
--     RLS is the gate, D18 → D23); TRUNCATE revoked by name (133).
--   * PK (user_id, bucket, scope) leads with user_id → serves the profiles
--     FK; no extra index owed.
--   * One DEFINER door (in-body gate, search_path '', REVOKE PUBLIC / anon,
--     EXECUTE authenticated) over PLAIN internals (search_path '', REVOKEd
--     from PUBLIC / anon / authenticated). The trigger function is DEFINER
--     (it writes the server-owned table as the poster), search_path '',
--     REVOKEd from everyone (triggers need no EXECUTE to fire).
--   * Typegen: the door + the table (additive; alias block re-appended).
--   * WAIVERS: R6 — no staging clone; rehearsal evidence = applied to the
--     shared local DB with psql over 001–208 plus the targeted pgTAP run in
--     the PR (no reset: the local DB is shared — one-local-db rule). D38 —
--     nothing to backfill: no stored row changes meaning.
--   * DEPLOY-BEFORE-PUSH SAFE (tasks-M7 §7 "missing limiter = today's
--     behaviour"): the middleware FAILS OPEN on any limiter error, including
--     PGRST202 before this is pushed; chat has no limit until the trigger
--     exists. Nothing else calls these functions.
--   * Rollback: DROP TRIGGER tr_league_chat_rate_limit ON league_chat;
--     DROP FUNCTION league_chat_rate_limit_guard_internal();
--     DROP FUNCTION rate_limit_take(TEXT, UUID);
--     DROP FUNCTION rate_limit_take_internal(UUID, TEXT, UUID, TIMESTAMPTZ);
--     DROP FUNCTION rate_limit_rule_internal(TEXT);
--     DROP TABLE rate_limit_hits.
-- pgTAP 159_rate_limits.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The table — server-owned
-- ---------------------------------------------------------------------------
CREATE TABLE public.rate_limit_hits (
  user_id    UUID          NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bucket     TEXT          NOT NULL,
  scope      UUID          NOT NULL,   -- a league id or a draft id (never an FK: either table)
  hits       TIMESTAMPTZ[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_hits_pkey PRIMARY KEY (user_id, bucket, scope),
  CONSTRAINT rate_limit_hits_bucket_known CHECK (bucket IN ('chat', 'mutation', 'bid'))
);

COMMENT ON TABLE public.rate_limit_hits IS
  'L.F2.6 (migration 209, spec §22.5): per-user sliding-window rate-limit ledger — the instants of '
  'the most recent ACCEPTED hits per (user, bucket, scope), at most the bucket''s limit of them. '
  'Server-owned: written only by rate_limit_take_internal; no client reads or writes.';

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy: with RLS on, anon / authenticated see no row and
-- write none (the D18 → D23 doctrine — RLS is the gate; the seven API-role
-- table grants stay, pgTAP 081 C3). TRUNCATE is not gated by RLS, so it is
-- revoked by name (133 / 182 / 183). The definer paths below are the only
-- writers.
REVOKE TRUNCATE ON TABLE public.rate_limit_hits FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The numbers (§22.5) — one place
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rate_limit_rule_internal(p_bucket TEXT)
RETURNS TABLE (max_hits INTEGER, window_ms INTEGER)
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT r.max_hits, r.window_ms
  FROM (VALUES ('chat', 5, 10000), ('mutation', 10, 10000), ('bid', 5, 1000)) AS r(bucket, max_hits, window_ms)
  WHERE r.bucket = p_bucket
$$;

REVOKE ALL ON FUNCTION public.rate_limit_rule_internal(TEXT) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.rate_limit_rule_internal(TEXT) IS
  'L.F2.6 (migration 209, spec §22.5): the per-bucket limits — chat 5/10s, mutation 10/10s, bid 5/1s. '
  'PLAIN, REVOKEd.';

-- ---------------------------------------------------------------------------
-- 3. The limiter body — at an injected instant
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rate_limit_take_internal(
  p_user_id UUID,
  p_bucket  TEXT,
  p_scope   UUID,
  p_now     TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_max    INTEGER;
  v_window INTEGER;
  v_since  TIMESTAMPTZ;
  v_live   TIMESTAMPTZ[];
  v_retry  INTEGER;
BEGIN
  IF p_user_id IS NULL OR p_scope IS NULL THEN
    RAISE EXCEPTION 'rate_limit: a user and a scope are required' USING ERRCODE = '22023';
  END IF;
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'rate_limit: p_now is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  SELECT r.max_hits, r.window_ms INTO v_max, v_window
  FROM public.rate_limit_rule_internal(p_bucket) r;
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'rate_limit: unknown bucket %', COALESCE(p_bucket, '<null>') USING ERRCODE = '22023';
  END IF;

  -- Make sure the row exists, then lock it: concurrent takes for the same
  -- (user, bucket, scope) serialize here, so the count below is exact.
  INSERT INTO public.rate_limit_hits (user_id, bucket, scope)
  VALUES (p_user_id, p_bucket, p_scope)
  ON CONFLICT ON CONSTRAINT rate_limit_hits_pkey DO NOTHING;

  v_since := p_now - pg_catalog.make_interval(secs => v_window / 1000.0);

  SELECT ARRAY(
           SELECT h FROM pg_catalog.unnest(rl.hits) AS h
           WHERE h > v_since        -- a hit at t counts for [t, t + window)
           ORDER BY h)
  INTO v_live
  FROM public.rate_limit_hits rl
  WHERE rl.user_id = p_user_id AND rl.bucket = p_bucket AND rl.scope = p_scope
  FOR UPDATE;

  IF pg_catalog.cardinality(v_live) >= v_max THEN
    -- Refused: write NOTHING. The wait is until the oldest live hit leaves.
    v_retry := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_live[1] - v_since)) * 1000)::INTEGER);
    RETURN pg_catalog.jsonb_build_object(
      'allowed', FALSE, 'bucket', p_bucket, 'limit', v_max, 'window_ms', v_window,
      'remaining', 0, 'retry_after_ms', v_retry);
  END IF;

  UPDATE public.rate_limit_hits rl
     SET hits = v_live || p_now,
         updated_at = p_now
   WHERE rl.user_id = p_user_id AND rl.bucket = p_bucket AND rl.scope = p_scope;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', TRUE, 'bucket', p_bucket, 'limit', v_max, 'window_ms', v_window,
    'remaining', v_max - pg_catalog.cardinality(v_live) - 1, 'retry_after_ms', 0);
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_take_internal(UUID, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.rate_limit_take_internal(UUID, TEXT, UUID, TIMESTAMPTZ) IS
  'L.F2.6 (migration 209, spec §22.5): take one hit from (user, bucket, scope) at p_now — strict sliding '
  'window, a refusal writes nothing and answers retry_after_ms. PLAIN, REVOKEd — reached through '
  'rate_limit_take, the league_chat guard and the tests only.';

-- ---------------------------------------------------------------------------
-- 4. The door — the signed-in caller's own allowance
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.rate_limit_take(p_bucket TEXT, p_scope UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'rate_limit: sign in first' USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NULL
     OR NOT (EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = p_scope)
             OR EXISTS (SELECT 1 FROM public.drafts d WHERE d.id = p_scope)) THEN
    RAISE EXCEPTION 'rate_limit: unknown league or draft' USING ERRCODE = '22023';
  END IF;
  RETURN public.rate_limit_take_internal(v_uid, p_bucket, p_scope, now());
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_take(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_limit_take(TEXT, UUID) TO authenticated;
COMMENT ON FUNCTION public.rate_limit_take(TEXT, UUID) IS
  'L.F2.6 (migration 209, spec §22.5): take one hit from the CALLER''s own allowance for a bucket '
  '(mutation | bid | chat) in a league or draft. DEFINER, signed-in only; the Next middleware calls it '
  'per league mutation and answers a refusal with 429 + Retry-After.';

-- ---------------------------------------------------------------------------
-- 5. Chat — the limit on the insert path (chat has no route, D99)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.league_chat_rate_limit_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_take JSONB;
  v_secs INTEGER;
BEGIN
  -- Only a member's own post counts: system lines (is_system, written by
  -- RPCs) and service-role writes (no auth.uid()) are never limited.
  IF v_uid IS NULL OR NEW.is_system OR NEW.user_id IS DISTINCT FROM v_uid THEN
    RETURN NEW;
  END IF;

  v_take := public.rate_limit_take_internal(v_uid, 'chat', NEW.league_id, now());
  IF (v_take ->> 'allowed')::BOOLEAN THEN
    RETURN NEW;
  END IF;

  v_secs := GREATEST(1, CEIL((v_take ->> 'retry_after_ms')::NUMERIC / 1000)::INTEGER);
  -- PostgREST's raise-your-own-response envelope: HTTP 429 + Retry-After.
  RAISE SQLSTATE 'PGRST' USING
    MESSAGE = pg_catalog.json_build_object(
      'code', 'rate_limited',
      'message', 'You''re sending messages too fast. Wait ' || v_secs ||
                 CASE WHEN v_secs = 1 THEN ' second' ELSE ' seconds' END ||
                 ' and send it again — that message wasn''t posted.',
      'details', NULL,
      'hint', NULL)::TEXT,
    DETAIL = pg_catalog.json_build_object(
      'status', 429,
      'status_text', 'Too Many Requests',
      'headers', pg_catalog.json_build_object('Retry-After', v_secs::TEXT))::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.league_chat_rate_limit_guard_internal() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.league_chat_rate_limit_guard_internal() IS
  'L.F2.6 (migration 209, spec §22.5): BEFORE INSERT on league_chat — a member''s own post takes one '
  '"chat" hit (5 per 10s per league); over the limit the insert is refused with HTTP 429 + Retry-After '
  '(PostgREST PGRST envelope). System lines and service-role writes are never limited.';

CREATE TRIGGER tr_league_chat_rate_limit
  BEFORE INSERT ON public.league_chat
  FOR EACH ROW EXECUTE FUNCTION public.league_chat_rate_limit_guard_internal();
