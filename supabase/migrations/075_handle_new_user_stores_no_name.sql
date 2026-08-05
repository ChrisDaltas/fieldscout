-- ============================================================================
-- 075: FieldScout stores no name for a person.
--
-- Ruling (Chris, 2026-08-05, verbatim): "we don't need either a display name
-- or a full name. we just need the email, password and unique username."
--
-- Why: `handle_new_user` seeded `profiles.display_name` from the OAuth
-- `full_name` claim, so signing in with Google wrote a user's REAL NAME into
-- a row that `profiles`' "Profiles are viewable by everyone" policy exposes
-- to anon. Every identity surface then rendered `display_name ?? @username`.
-- The earlier attempt renamed the column to `full_name` and called it
-- private; the policy made that untrue. Storing nothing is what actually
-- fixes it.
--
-- What this migration does — two statements, no DDL:
--
--   1. `handle_new_user` stops writing a name. The profile INSERT drops the
--      `display_name` column entirely; nothing else in the body changes.
--   2. Existing rows are cleared: `UPDATE public.profiles SET display_name =
--      NULL`. Accounts created before today already carry OAuth real names,
--      and leaving them would keep the leak alive for exactly the users who
--      hit it. This is DML, not DDL.
--
-- What this migration deliberately does NOT do:
--
--   * It does NOT rename or drop `profiles.display_name`. The column is
--     NULLABLE with no default (verified against production), so it simply
--     sits inert once nothing writes it. That is what makes this file safe to
--     apply BEFORE or AFTER the accompanying app deploy: the old app reads
--     `display_name`, gets NULL, and falls back to `@username` — which is the
--     post-ruling render anyway. The new app never reads it. Neither order
--     breaks the live site. (Dropping the column is a separate, later change
--     once no deployed code references it.)
--   * It does NOT touch `ai_personas.display_name`. That column is NOT NULL
--     and holds PUBLIC brand copy ("Bathew Merry (AI)") — a fictional
--     persona's parody name, not a person's name. Nothing to leak.
--   * It does NOT re-point the other functions that read
--     `profiles.display_name` — `notify_list_followers` (019),
--     `create_league` / `seat_league_member_internal` / `get_join_preview`
--     (060/062) and `draft_actor_name` (069). Every one of them reads through
--     a COALESCE onto `username`, so with the column permanently NULL they
--     already resolve to the handle. Replacing them would be churn, and three
--     of them do not exist in production at all (see the ordering note).
--
-- BASELINE — read this before reviewing the body below.
--   The replacement body is production's LIVE `handle_new_user`, dumped with
--   `pg_get_functiondef` on 2026-08-05, with exactly one edit: the
--   `display_name` column and its value expression are removed from the
--   profile INSERT. It is byte-identical to 073 otherwise.
--
--   That live definition does NOT contain the username-contract guards from
--   repo migrations 049/050/051 (the `*-ai` namespace rejection, the reserved
--   `user_<8hex>` placeholder shape, the R31 fallback). Those three
--   migrations were NEVER APPLIED to production — its ledger is 001-036, 073,
--   074 — and 073's search_path hotfix was itself rebuilt from a pre-049
--   body, so a fresh local reset loses the guards at 073 too. Restoring them
--   is a real and separate bug (they protect the Q7.1 handle namespace), but
--   smuggling them into a privacy fix would ship an unrelated behaviour
--   change under cover. Flagged in the PR instead.
--
-- APPLY ORDER (production): 074 is the highest migration in the production
-- ledger and this file is 075, so plain numeric order is correct. This file
-- is also independent of 074 — it touches nothing 074 touched. Migrations
-- 037-072 remain unapplied in production and this file does not depend on any
-- of them: it only replaces a function that already exists there and updates
-- one column that already exists there.
--
-- RLS / grants: untouched. `CREATE OR REPLACE FUNCTION` preserves the
-- function's ACL, and the `UPDATE` runs as the migration role (RLS bypassed),
-- so no policy change is needed or made.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. handle_new_user: seed the handle and the Big Board, and no name.
--    Production's live body verbatim, minus the display_name write.
-- ---------------------------------------------------------------------------

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

  -- Insert profile (or skip if it already exists — e.g. from a backfill).
  -- No name column is written: FieldScout stores no name for a person
  -- (ruling 2026-08-05). The OAuth `full_name` claim is ignored on purpose.
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    new_user_id,
    effective_username,
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

COMMENT ON FUNCTION public.handle_new_user() IS
  'Signup trigger: mints the profile row (handle + avatar only) and the Big Board. Writes NO name — FieldScout stores no display name or full name for a person (ruling 2026-08-05).';

-- ---------------------------------------------------------------------------
-- 2. Clear the names already stored. Idempotent and re-runnable; the WHERE
--    keeps a re-run from touching rows it has already cleared.
-- ---------------------------------------------------------------------------

UPDATE public.profiles
SET display_name = NULL
WHERE display_name IS NOT NULL;

COMMENT ON COLUMN public.profiles.display_name IS
  'RETIRED (ruling 2026-08-05, migration 075). Never written and never read by the app; kept only so this migration is deploy-order-safe against the running site. Do not reintroduce a name field for a person — the username is the identity.';
