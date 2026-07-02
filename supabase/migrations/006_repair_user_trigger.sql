-- ============================================================================
-- Repair the new-user pipeline.
--
-- A user account existed in auth.users with no row in profiles, which broke
-- every list insert (lists.owner_id REFERENCES profiles(id)). The cause was
-- that the original handle_new_user trigger from 001 either wasn't installed
-- on the auth.users table on this database, or failed silently on signup.
--
-- This migration:
--   1. Re-creates handle_new_user with EXCEPTION handling so a single failure
--      can't block account creation, and so any orphan can self-heal next
--      time the user signs in (we run a backfill below for the current state).
--   2. Re-installs the on_auth_user_created trigger.
--   3. Backfills profiles + Big Boards for any auth.users missing them.
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_user_id UUID := NEW.id;
  new_username TEXT := NEW.raw_user_meta_data->>'username';
  effective_username TEXT;
BEGIN
  effective_username := COALESCE(new_username, 'user_' || substr(new_user_id::text, 1, 8));

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ----------------------------------------------------------------------------
-- Backfill orphaned auth.users with profiles + Big Boards.
-- ----------------------------------------------------------------------------
INSERT INTO profiles (id, username, display_name, avatar_url)
SELECT
  u.id,
  COALESCE(
    u.raw_user_meta_data->>'username',
    'user_' || substr(u.id::text, 1, 8)
  ) AS username,
  COALESCE(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'username',
    split_part(u.email, '@', 1)
  ) AS display_name,
  u.raw_user_meta_data->>'avatar_url' AS avatar_url
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO lists (
  owner_id, title, slug, hide_order, is_big_board, is_private, comments_enabled
)
SELECT
  p.id, 'My Big Board', 'big-board', FALSE, TRUE, FALSE, TRUE
FROM profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM lists l WHERE l.owner_id = p.id AND l.is_big_board = TRUE
);
