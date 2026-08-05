-- 073: fix handle_new_user — pin search_path so real Auth signups work
--
-- handle_new_user (the on_auth_user_created trigger) was SECURITY DEFINER
-- with no pinned search_path and unqualified table references. Signups made
-- through Supabase Auth's own flow (GoTrue) execute with a minimal
-- search_path, so the function failed with 'relation "profiles" does not
-- exist' — its EXCEPTION handler swallowed the error, leaving auth users
-- with no profile row. Every downstream insert (e.g. lists.owner_id FK)
-- then failed for that user. Found on the first production signup on
-- fieldscout.gg (2026-08-05); applied to production the same day as hosted
-- migration fix_handle_new_user_search_path.
--
-- Fix: SET search_path = '' + schema-qualify every reference (house style,
-- delivery plan §8.3).

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
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    new_user_id,
    effective_username,
    COALESCE(NEW.raw_user_meta_data->>'full_name', new_username, 'New User'),
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
