-- ============================================================================
-- Reserve the pre-selection placeholder username shape — review finding R32
-- (M1 batch-1 review, 2026-07-20; spec v2.8.1 Q7.2 "permanent after explicit
-- selection").
--
-- Why: 'user_' || 8 hex is the placeholder handle_new_user assigns at signup,
-- and the app treats "username matches ^user_[0-9a-f]{8}$" as "pre-selection"
-- (the /username mount gate and its filtered selection UPDATE both key on it).
-- But the shape was also a *valid human username* (13 chars, [a-z0-9_]), so a
-- user who explicitly selected e.g. 'user_deadbeef' stayed "pre-selection"
-- forever — /username became an unlimited sanctioned rename surface for that
-- account, falsifying Q7.2's permanence contract. Fix: the placeholder shape
-- is RESERVED — it can only ever be assigned by the signup trigger, never
-- explicitly chosen.
--
-- Three layers (mirroring the Q7.1 namespace-guard architecture in 040/049):
--   a. CHECK profiles_username_format_check restructured to name the
--      placeholder shape as its own branch, carved out of the human branch:
--          human       ^[a-z0-9_]{5,20}$  AND NOT placeholder
--       OR placeholder ^user_[0-9a-f]{8}$          (trigger-assigned only)
--       OR persona     ^[a-z0-9]+(-[a-z0-9]+)*-ai$
--      The accepted string set is UNCHANGED (placeholder was a subset of
--      human) — the restructure makes the reservation explicit; enforcement
--      against client roles is layer (b).
--   b. guard_username_namespace extended: authenticated/anon can never
--      INSERT/UPDATE a placeholder-pattern username (alongside the existing
--      persona-pattern block). The signup trigger runs with auth.role() NULL
--      and still assigns placeholders; the /username selection UPDATE writes
--      the NEW (non-placeholder) name, so it passes untouched.
--   c. handle_new_user: metadata usernames matching the placeholder shape are
--      no longer honored — they fall back to the id-derived placeholder, so
--      signup metadata cannot explicitly claim a placeholder-shaped name
--      either (the metadata path is an explicit choice too, and 049's
--      human-pattern check alone would have honored it).
--
-- Ordering: MUST run after 049 — 049 is the last prior migration to replace
-- handle_new_user (048 re-created it for the search_path pin, 049 for the
-- metadata contract); this file supersedes 049's body (one added condition,
-- otherwise verbatim) and 040's guard_username_namespace + format CHECK.
-- Anything ordered before 049 would be silently overwritten on fresh reset.
--
-- Pre-checks: existing placeholder-shaped rows are legitimate (they ARE
-- pre-selection rows) — no data precondition beyond 040's, which already ran.
-- Dropping + re-adding the CHECK revalidates all rows; the accepted set only
-- narrows for personas (the R35 cap), pre-checked loudly below.
--
-- R35 (nit, taken here — the finding says "worth a cap whenever the
-- constraint is next touched", and this migration touches it): the persona
-- branch gains a 32-char length bound (longest live handle is 17;
-- privileged-writers-only surface).
--
-- Grants: none (037 default-ACL model). §8.1 staging-rehearsal waiver per the
-- R6 rule: no staging clone; fresh local `db reset` + pgTAP 005 is the
-- rehearsal evidence. Prod-safe: CREATE OR REPLACE on both functions, same
-- signatures, trigger bindings preserved; the CHECK swap is in-place.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. R35 pre-check: no live persona handle may exceed the new 32-char cap
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(quote_literal(username), ', ') INTO v_bad
  FROM profiles
  WHERE username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$'
    AND char_length(username) > 32;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '050: persona handle(s) exceed the 32-char cap: % — shorten before applying (R35)',
      v_bad;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. CHECK: placeholder shape carved out of the human branch (R32) +
--    persona length cap (R35)
-- ----------------------------------------------------------------------------
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_username_format_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_username_format_check
  CHECK (
    (username ~ '^[a-z0-9_]{5,20}$' AND username !~ '^user_[0-9a-f]{8}$')
    OR username ~ '^user_[0-9a-f]{8}$'
    OR (username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$' AND char_length(username) <= 32)
  );

-- ----------------------------------------------------------------------------
-- 2. Guard: client roles can never write a placeholder-pattern username
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_username_namespace()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- 025's defensive TG_OP form: PostgreSQL does not guarantee OR evaluation
  -- order, so OLD is never referenced in a branch that can run on INSERT.
  IF auth.role() IN ('authenticated', 'anon') THEN
    IF (TG_OP = 'INSERT' AND NEW.username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$')
       OR (TG_OP = 'UPDATE'
           AND NEW.username IS DISTINCT FROM OLD.username
           AND NEW.username ~ '^[a-z0-9]+(-[a-z0-9]+)*-ai$') THEN
      RAISE EXCEPTION '"-ai" usernames are reserved for FieldScout AI accounts.'
        USING errcode = 'check_violation';
    END IF;
    IF (TG_OP = 'INSERT' AND NEW.username ~ '^user_[0-9a-f]{8}$')
       OR (TG_OP = 'UPDATE'
           AND NEW.username IS DISTINCT FROM OLD.username
           AND NEW.username ~ '^user_[0-9a-f]{8}$') THEN
      RAISE EXCEPTION 'This username format is reserved.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger binding unchanged (040's trg_guard_username_namespace still fires
-- this function); re-assert it exists for fresh-reset clarity.
DROP TRIGGER IF EXISTS trg_guard_username_namespace ON profiles;
CREATE TRIGGER trg_guard_username_namespace
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_username_namespace();

-- ----------------------------------------------------------------------------
-- 3. handle_new_user: placeholder-shaped metadata is not honorable (R32).
--    Body is 049's verbatim except the one added regex condition.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_user_id UUID := NEW.id;
  new_username TEXT := NEW.raw_user_meta_data->>'username';
  effective_username TEXT;
BEGIN
  effective_username := COALESCE(new_username, 'user_' || substr(new_user_id::text, 1, 8));

  -- v2.8.1/Q7.1 (migration 049): client-supplied metadata may only claim a
  -- HUMAN-pattern handle. Persona-pattern ('*-ai') and contract-violating
  -- names fall back — the signup-trigger context has auth.role() NULL, so
  -- the 040 namespace guard cannot gate this path itself.
  -- R32 (migration 050): the placeholder shape is likewise reserved —
  -- metadata cannot explicitly claim 'user_' || 8 hex; only the id-derived
  -- fallback below may assign it.
  IF effective_username !~ '^[a-z0-9_]{5,20}$'
     OR effective_username ~ '^user_[0-9a-f]{8}$' THEN
    effective_username := 'user_' || substr(new_user_id::text, 1, 8);
  END IF;

  -- Insert profile (or skip if it already exists — e.g. from a backfill).
  INSERT INTO profiles (id, username, display_name, avatar_url)
  VALUES (
    new_user_id,
    effective_username,
    COALESCE(NEW.raw_user_meta_data->>'full_name', new_username, 'New User'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Insert Big Board if the user doesn't already have one.
  INSERT INTO lists (
    owner_id, title, slug, hide_order, is_big_board, is_private, comments_enabled
  )
  SELECT new_user_id, 'My Big Board', 'big-board', FALSE, TRUE, FALSE, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM lists WHERE owner_id = new_user_id AND is_big_board = TRUE
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block account creation if profile setup hits a race or transient
  -- error. The application can recover by re-running this on next sign-in
  -- via the same function called by a backfill or a signup hook.
  RAISE WARNING 'handle_new_user failed for %: %', new_user_id, SQLERRM;
  RETURN NEW;
END;
$$;
