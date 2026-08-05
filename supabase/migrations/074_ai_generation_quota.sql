-- ============================================================================
-- 074: AI generation daily quota (COST CONTROL)
-- ============================================================================
-- Caps how many "Generate with AI" calls a single user can make per UTC
-- calendar day, so the ANTHROPIC_API_KEY bill stays bounded on the free-only
-- 2026 soft launch (CLAUDE.md "2026 Go-Live").
--
-- This is a spend valve, NOT a tier gate: every signed-in user gets the same
-- allowance and there is no is_pro involvement anywhere in this migration.
-- The allowance itself lives in the app (env AI_LIST_GENERATION_DAILY_LIMIT,
-- default 3) and is passed in as p_limit — deliberately NOT hard-coded here,
-- so the number is tunable without a migration.
--
-- WHY A COUNTER TABLE AND NOT ai_call_log (024):
--   024 is an append-only telemetry log. Counting its rows (the old
--   countAiCallsToday path) is racy — two concurrent requests both COUNT the
--   same pre-call value, both pass the check, and both spend money. A single
--   counter row per (user, feature, day) lets the check and the increment be
--   ONE atomic statement (see claim_ai_generation below). 024 stays exactly
--   as it is and keeps doing telemetry/cost attribution; this table is the
--   quota ledger only.
--
-- RESERVE-THEN-REFUND: the route claims a slot BEFORE the Claude call, which
-- closes the race window. It refunds ONLY when Anthropic was never billed —
-- a failure before dispatch, or a connection error that got no response. A
-- truncated or unparseable response costs full price, so it keeps the slot;
-- refunding billed calls would uncap the bill, since the UI offers Retry on
-- every error. The counter therefore measures BILLED attempts, which is the
-- only reading under which this table controls spend.
--
-- Migration checklist (delivery plan §8.1): additive-only; RLS + policy in the
-- same migration as the table; the FK/policy lookup column is the leading
-- column of the primary key index (no redundant index owed — see below);
-- IF NOT EXISTS / OR REPLACE guards throughout so a re-run is a no-op.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ai_generation_usage (
  user_id    UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feature    TEXT    NOT NULL,   -- matches AiFeature in src/lib/claude/telemetry.ts
  usage_date DATE    NOT NULL,   -- UTC calendar day (see claim_ai_generation)
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One counter row per user per feature per UTC day. This is also the
  -- conflict target that makes the claim atomic.
  CONSTRAINT ai_generation_usage_pkey PRIMARY KEY (user_id, feature, usage_date),
  CONSTRAINT ai_generation_usage_used_nonneg CHECK (used >= 0)
);

COMMENT ON TABLE public.ai_generation_usage IS
  'Per-user, per-feature, per-UTC-day AI call counter. Cost control for the '
  'Anthropic bill — not a paid-tier gate. Written only by claim_ai_generation '
  '/ release_ai_generation (service role); users may read their own rows.';

-- FK/policy index: the (user_id, feature, usage_date) primary key index leads
-- with user_id, so it already serves both the profiles FK and the RLS policy's
-- `auth.uid() = user_id` predicate. A standalone idx_..._user would be a pure
-- duplicate prefix, so none is created.

-- ---------------------------------------------------------------------------
-- 2. RLS — users read their own usage; nobody writes from a client
-- ---------------------------------------------------------------------------

ALTER TABLE public.ai_generation_usage ENABLE ROW LEVEL SECURITY;

-- SELECT only. There is deliberately NO INSERT/UPDATE/DELETE policy: with RLS
-- enabled and no write policy, anon and authenticated are denied by default
-- and the service role (which bypasses RLS) is the only writer.
DROP POLICY IF EXISTS "Users read own AI usage" ON public.ai_generation_usage;
CREATE POLICY "Users read own AI usage"
  ON public.ai_generation_usage
  FOR SELECT
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. claim_ai_generation — atomic check-and-increment
-- ---------------------------------------------------------------------------
-- Returns is_allowed = TRUE and the post-increment count when a slot was
-- taken; is_allowed = FALSE (and no write) when the day's allowance is spent.
--
-- CONCURRENCY: the check and the increment are the SAME statement. The first
-- writer for a (user, feature, day) wins the INSERT; every concurrent writer
-- conflicts, blocks on that row's lock, and — under READ COMMITTED, ON
-- CONFLICT DO UPDATE re-reads the freshly committed row — evaluates
-- `used < p_limit` against the winner's value. So N simultaneous double
-- submits at the limit produce exactly one success, not N.
CREATE OR REPLACE FUNCTION public.claim_ai_generation(
  p_user_id UUID,
  p_feature TEXT,
  p_limit   INTEGER
)
RETURNS TABLE (is_allowed BOOLEAN, used_today INTEGER, daily_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The reset boundary the UI copy promises: midnight UTC, not local midnight.
  v_today DATE    := (pg_catalog.timezone('utc', pg_catalog.now()))::date;
  v_used  INTEGER;
BEGIN
  -- A zero/negative/absent limit means "AI generation is off" — never write.
  IF p_limit IS NULL OR p_limit < 1 THEN
    SELECT u.used INTO v_used
    FROM public.ai_generation_usage u
    WHERE u.user_id = p_user_id
      AND u.feature = p_feature
      AND u.usage_date = v_today;
    RETURN QUERY SELECT FALSE, COALESCE(v_used, 0), COALESCE(p_limit, 0);
    RETURN;
  END IF;

  INSERT INTO public.ai_generation_usage AS u (user_id, feature, usage_date, used)
  VALUES (p_user_id, p_feature, v_today, 1)
  ON CONFLICT ON CONSTRAINT ai_generation_usage_pkey DO UPDATE
    SET used = u.used + 1,
        updated_at = pg_catalog.now()
    WHERE u.used < p_limit
  RETURNING u.used INTO v_used;

  -- No row returned => the DO UPDATE's WHERE was false => already at the cap.
  IF v_used IS NULL THEN
    SELECT u2.used INTO v_used
    FROM public.ai_generation_usage u2
    WHERE u2.user_id = p_user_id
      AND u2.feature = p_feature
      AND u2.usage_date = v_today;
    RETURN QUERY SELECT FALSE, COALESCE(v_used, p_limit), p_limit;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_used, p_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. release_ai_generation — refund a claimed slot
-- ---------------------------------------------------------------------------
-- Called ONLY for failures that cost no money (see the header). Floors at 0
-- and no-ops when there is no row for today, so a duplicate refund can never
-- mint free quota.
CREATE OR REPLACE FUNCTION public.release_ai_generation(
  p_user_id UUID,
  p_feature TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_used INTEGER;
BEGIN
  UPDATE public.ai_generation_usage u
  SET used = GREATEST(u.used - 1, 0),
      updated_at = pg_catalog.now()
  WHERE u.user_id = p_user_id
    AND u.feature = p_feature
    AND u.usage_date = (pg_catalog.timezone('utc', pg_catalog.now()))::date
  RETURNING u.used INTO v_used;

  RETURN COALESCE(v_used, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants (delivery plan §4.1 — SECURITY DEFINER owes an explicit REVOKE)
-- ---------------------------------------------------------------------------
-- Both routines take p_user_id as a PARAMETER and do no in-body authorization,
-- so unlike the league RPCs they must also be revoked from `authenticated`:
-- otherwise any signed-in user could PostgREST-call release_ai_generation and
-- refund themselves unlimited generations, or claim against someone else's
-- counter. Server-side (service role) only.
REVOKE EXECUTE ON FUNCTION public.claim_ai_generation(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_ai_generation(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
