-- ============================================================================
-- 074: restore the handle_new_user USERNAME CONTRACT on top of 073's
-- search_path fix.
--
-- WHAT HAPPENED. 073 (`fix_handle_new_user_search_path`, PR #87, applied to
-- production 2026-08-05) correctly fixed a real outage: handle_new_user was
-- SECURITY DEFINER with an unqualified body, so GoTrue's minimal search_path
-- made every real Auth signup fail 'relation "profiles" does not exist' — the
-- EXCEPTION handler swallowed it and the user got no profile row. That fix
-- (SET search_path = '' + schema-qualify everything) is correct, is house
-- style (delivery plan §8.3 / spec §12.0), and is KEPT VERBATIM here.
--
-- THE REGRESSION. 073's body was rebuilt from a PRE-049 version of the
-- function, so CREATE OR REPLACE silently reverted three shipped guards:
--   * 049 (Q7.1 / spec v2.8.1, §7.2 AI-transparency namespace) — client
--     metadata may only claim a HUMAN-pattern handle. Without it an anonymous
--     signup posting user_metadata.username = 'evil-ai' MINTS A PERSONA-PATTERN
--     HANDLE. The 040 namespace guard cannot cover this path: the signup-trigger
--     context has auth.role() NULL, which is exactly why 049 put the check here.
--   * 050 (R32) — the reserved placeholder shape 'user_' || 8 hex may be
--     assigned ONLY by the id-derived fallback, never claimed by metadata.
--   * 051 (R31) — display_name must derive from effective_username, never the
--     raw metadata value, so a rejected username cannot be laundered into
--     another league-rendered field.
-- Caught by pgTAP 005 tests 44–47/68/79 on a fresh reset (main went RED after
-- PR #87 merged); 004 test 2 caught the pin form separately.
--
-- THE FIX. 051's validated body (the last good definition) re-applied with
-- 073's search_path = '' and full schema qualification. Net effect vs 073:
-- the two-clause guard returns and display_name's COALESCE middle argument
-- goes back to effective_username. Nothing else changes.
--
-- PRODUCTION NOTE (for the review of this migration): 073 is LIVE on
-- fieldscout.gg, so production is currently running WITHOUT these guards.
-- Any handle minted through a hostile-metadata signup since 073 shipped
-- persists in `profiles` — this migration closes the path but does not
-- retro-fix rows. A read-only audit query is in the PR body.
--
-- Prod-safe: CREATE OR REPLACE, same signature, trigger binding preserved,
-- SECURITY DEFINER retained, search_path stays pinned (pgTAP 004 test 4).
-- Grants: none (037 default-ACL model).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
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
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    new_user_id,
    effective_username,
    COALESCE(NEW.raw_user_meta_data->>'full_name', effective_username, 'New User'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Insert Big Board if the user doesn't already have one.
  INSERT INTO public.lists (
    owner_id, title, slug, hide_order, is_big_board, is_private, comments_enabled
  )
  SELECT new_user_id, 'My Big Board', 'big-board', FALSE, TRUE, FALSE, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.lists WHERE owner_id = new_user_id AND is_big_board = TRUE
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block account creation if profile setup hits a race or transient
  -- error. The application can recover by re-running this on next sign-in
  -- via the same function called by a backfill or a signup hook.
  RAISE WARNING 'handle_new_user failed for %: %', new_user_id, SQLERRM;
  RETURN NEW;
END;
$function$;
