-- ============================================================================
-- handle_new_user: enforce the username contract on signup metadata — Q7.1
-- critical fix (M1 task L.A1.1 review; spec v2.8/v2.8.1).
--
-- Why: GoTrue's PUBLIC /auth/v1/signup accepts arbitrary user_metadata, and
-- handle_new_user copies raw_user_meta_data->>'username' into profiles. The
-- signup-trigger context has auth.role() = NULL, so 040's namespace guard
-- (which gates on authenticated/anon) does not fire, and 040's format CHECK
-- would accept 'evil-ai' via its persona branch — an anonymous attacker could
-- mint a '*-ai' handle, defeating the Q7.1 namespace separation. Reproduced
-- live in review before this fix.
--
-- Fix: the metadata username is honored ONLY when it matches the HUMAN
-- pattern '^[a-z0-9_]{5,20}$'; anything else (persona-pattern, too short,
-- too long, uppercase, hostile) falls back to 'user_' || 8 hex chars. This
-- also upgrades the old failure mode: contract-violating metadata previously
-- aborted the profile INSERT (WHEN OTHERS → profile skipped entirely); now
-- every signup gets a profile.
--
-- Persona/system accounts are unaffected: the only persona-pattern profiles
-- row ('fieldscout-ai') is set by scripts/seed-ai-personas.ts via a
-- service-role UPSERT AFTER user creation — service_role passes the 040
-- guard, and the trigger's fallback is simply overwritten. (The roster
-- personas live in ai_personas, not profiles.)
--
-- Why migration 049 and not part of 040: 048_secdef_search_path.sql
-- re-creates handle_new_user (byte-identical body + search_path pin) and
-- runs AFTER 040 — a fix inside 040 would be silently overwritten on every
-- fresh reset. This file post-dates 048 and preserves its SECURITY DEFINER +
-- search_path pin (pgTAP 004's universal pin stays satisfied).
--
-- Body: 048's verbatim body (which is 006's repair body) + the one
-- validation block, clearly marked. No other logic changes.
--
-- Grants: none (037 default-ACL model). §8.1 staging-rehearsal waiver per
-- the R6 rule: no staging clone; fresh local `db reset` + pgTAP is the
-- rehearsal evidence. Prod-safe: CREATE OR REPLACE, same signature,
-- trigger binding preserved.
-- ============================================================================

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
  IF effective_username !~ '^[a-z0-9_]{5,20}$' THEN
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
