-- ============================================================================
-- 197 — everyone starts with 7 cred (Chris 2026-10-18: "everyone should start
--       with 7 because 7 is lucky.")
-- ============================================================================
--
-- BEFORE: `profiles.cred_score` was `NUMERIC DEFAULT 0` (001) and nothing in
-- the schema or the app has ever written it, so every account — people and
-- the `fieldscout-ai` system account that owns the AI persona lists — read
-- 0 cred, and the Top scouts shelf read "0 cred" on every row.
--
-- WHAT 197 DOES
--   1. `profiles.cred_score` DEFAULT 0 → 7. Every new profile starts at 7,
--      whichever door creates it: handle_new_user (076, the head) inserts
--      (id, username, avatar_url) and never names cred_score, so the column
--      default is what a signup gets — its body is NOT replaced here.
--   2. A one-off backfill through `cred_start_backfill_internal()`: every
--      existing profile whose cred is 0 or NULL is raised to 7. That is
--      every profile today (nothing awards cred yet) — persona/system
--      profiles included, they are profiles rows like any other. A profile
--      ABOVE 0 is never touched, and neither is a negative one (none exist,
--      and nothing in this ruling says what one would mean).
--   3. Asserts the outcome: no profile is left at 0 or NULL. A backfill that
--      reports "0 rows" is not trusted to mean "nothing to do" (CLAUDE.md,
--      "Never let nothing happened mean it worked").
--
-- MEASURED, NOT CHANGED
--   - handle_new_user (076) — writes no cred (above).
--   - `cred_scores.total_cred` (001, DEFAULT 0) is a PER-SEASON aggregate of
--     cred EARNED that season; it is empty and nothing reads or writes it.
--     A season row starting at 7 would hand out 7 every season, which is not
--     the ruling — it stays 0. The start lives on the account
--     (`profiles.cred_score`) only.
--   - `consensus_rankings` (001) weights each list by
--     GREATEST(cred_score, 1): a new user now weighs 7, never 0. Every
--     account moves from weight 1 to weight 7 together, so the weighted
--     ranks are unchanged — no refresh is needed for correctness.
--   - The seed, the scripts and every app write path name no cred_score.
--
-- RE-RUNNABLE: SET DEFAULT is idempotent; the backfill only raises rows at
-- 0/NULL, so a second run finds none. Do NOT call the helper again once
-- anything can lower cred to 0 — it cannot tell an untouched account from
-- one that earned its way down.
--
-- Grants/RLS: none touched on profiles (an ALTER ... SET DEFAULT and an
-- UPDATE keep every policy, grant and trigger). The helper is REVOKEd from
-- every API role — it is a migration seam, not a door. Profiles' BEFORE
-- UPDATE guards (025, 026, 050) fire on the backfill and pass: they only
-- police client roles, and a migration runs as postgres.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The start
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ALTER COLUMN cred_score SET DEFAULT 7;

COMMENT ON COLUMN public.profiles.cred_score IS
  'Career cred. Every account starts at 7 (Chris 2026-10-18, migration 197); '
  'the app''s CRED_START (src/lib/cred-tiers.ts) is the same number.';

-- ----------------------------------------------------------------------------
-- 2. The backfill — raises 0/NULL to the start, returns how many it raised
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cred_start_backfill_internal()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
DECLARE
  v_raised integer;
BEGIN
  UPDATE public.profiles
     SET cred_score = 7
   WHERE cred_score IS NULL OR cred_score = 0;
  GET DIAGNOSTICS v_raised = ROW_COUNT;
  RETURN v_raised;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cred_start_backfill_internal()
  FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Run it, and prove the outcome rather than trusting the count
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_raised integer;
  v_left integer;
BEGIN
  v_raised := public.cred_start_backfill_internal();

  SELECT count(*) INTO v_left
    FROM public.profiles
   WHERE cred_score IS NULL OR cred_score = 0;

  IF v_left <> 0 THEN
    RAISE EXCEPTION '197: % profile(s) still at 0/NULL cred after the backfill', v_left;
  END IF;

  RAISE NOTICE '197: raised % profile(s) to the starting 7 cred', v_raised;
END;
$$;
