-- ============================================================================
-- handle_new_user: rejected metadata usernames must not reach display_name —
-- review finding R31 (M1 batch-1 review, 2026-07-20; Q7.1 / §7.2
-- AI-transparency namespace).
--
-- Why: the profile INSERT derived display_name from
-- COALESCE(full_name, new_username, 'New User') — new_username RAW, before
-- validation. A signup with user_metadata.username = 'evil-ai' and no
-- full_name got the placeholder username (049/050 fallback) but
-- display_name = 'evil-ai' — the trigger propagated input it had just
-- rejected into another league-rendered field (reproduced live in review).
-- Materiality caveat per R31: display_name is already freely user-editable,
-- so this closed no attacker capability — but the trigger must not launder
-- rejected input, and the 049 banner's "hostile metadata falls back" claim
-- should be fully true.
--
-- Fix: display_name uses effective_username — the same fallback chain minus
-- the rejected value. When the metadata username was honored,
-- effective_username = new_username (behavior unchanged); when it was
-- rejected, display_name falls back to the placeholder instead of the
-- rejected string. full_name still wins when present (it is not part of the
-- username contract; display-name spoofing generally is out of Q7 scope per
-- R31 — flagged for a future ruling, not handled here).
--
-- Ordering: MUST run after 050 — 050 is the last prior migration to replace
-- handle_new_user (048 search_path pin → 049 metadata contract → 050
-- placeholder reservation); this file supersedes 050's body (one changed
-- COALESCE argument, otherwise verbatim). Anything ordered before 050 would
-- be silently overwritten on fresh reset.
--
-- Grants: none (037 default-ACL model). §8.1 staging-rehearsal waiver per the
-- R6 rule: no staging clone; fresh local `db reset` + pgTAP 005 is the
-- rehearsal evidence. Prod-safe: CREATE OR REPLACE, same signature, trigger
-- binding preserved, SECURITY DEFINER + search_path pin kept (pgTAP 004).
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
  -- R32 (migration 050): the placeholder shape is likewise reserved —
  -- metadata cannot explicitly claim 'user_' || 8 hex; only the id-derived
  -- fallback below may assign it.
  IF effective_username !~ '^[a-z0-9_]{5,20}$'
     OR effective_username ~ '^user_[0-9a-f]{8}$' THEN
    effective_username := 'user_' || substr(new_user_id::text, 1, 8);
  END IF;

  -- Insert profile (or skip if it already exists — e.g. from a backfill).
  -- R31 (migration 051): display_name derives from effective_username, never
  -- the raw metadata value — a rejected username must not resurface here.
  INSERT INTO profiles (id, username, display_name, avatar_url)
  VALUES (
    new_user_id,
    effective_username,
    COALESCE(NEW.raw_user_meta_data->>'full_name', effective_username, 'New User'),
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
