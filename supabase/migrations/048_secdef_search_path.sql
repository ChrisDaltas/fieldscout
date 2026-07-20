-- ============================================================================
-- Pin search_path on the seven pre-017 SECURITY DEFINER functions — C15
-- (tasks-M1-league-foundation.md §9), pulled forward from its M7 routing.
--
-- Numbering: migrations 040–047 are reserved on paper by the M1 task
-- breakdown (tasks-M1 §7, L.A1.1–L.A1.11) and not yet written; this migration
-- deliberately takes the next number AFTER that reservation so the M1 schema
-- lane keeps its assigned block.
--
-- Why: SECURITY DEFINER functions with no search_path resolve unqualified
-- names via the CALLER's search_path — under the 037 grant model (broad
-- grants, RLS as the gate) a caller who can create objects in a schema that
-- precedes public (pg_temp always does) could shadow a table or operator and
-- have the definer (postgres) execute it. Every post-017 SECURITY DEFINER
-- function already pins `SET search_path = public, pg_temp` (017, 018, 019,
-- 025, 026, 028, 038); these seven predate the convention.
--
-- Form: `SET search_path = public, pg_temp` — the repo's existing hardened
-- convention for legacy app functions, NOT the spec's `search_path = ''` form
-- (plan §8.3 / spec §12.0), which remains the standing rule for every NEW
-- league RPC. Rationale: these bodies reference public tables unqualified
-- throughout; the public,pg_temp pin closes the caller-controlled-resolution
-- vector with the function bodies byte-identical, so behavior preservation is
-- auditable by diff. (pg_catalog is always searched first implicitly; auth.uid()
-- is already schema-qualified.)
--
-- Behavior: NO logic changes. Bodies are copied verbatim from their latest
-- definitions — handle_new_user from 006 (the repair version), the four
-- counter triggers from 001, update_list_like_count from 003,
-- reorder_list_players from 004. CREATE OR REPLACE preserves existing
-- triggers and ACLs (004's REVOKE/GRANT on reorder_list_players intact).
--
-- Enforcement: pgTAP tests/004_secdef_search_path.sql pins that EVERY
-- SECURITY DEFINER function in public carries a search_path proconfig — a
-- future search_path-less definer fails the suite loudly.
--
-- §8.1 staging-rehearsal waiver (per the R6 go-forward rule, recorded per
-- migration): no staging clone exists (environments are local + prod only);
-- the fresh local `db reset` over the full 001–048 chain plus the pgTAP
-- suite is the rehearsal evidence. Typegen not re-run: no schema shape
-- change (same signatures), and regeneration would clobber the hand-written
-- alias block in src/types/database.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. handle_new_user — body verbatim from 006_repair_user_trigger.sql
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

-- ----------------------------------------------------------------------------
-- 2. update_follow_counts — body verbatim from 001_initial_schema.sql
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET follower_count = follower_count + 1 WHERE id = NEW.following_id;
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET follower_count = follower_count - 1 WHERE id = OLD.following_id;
    UPDATE profiles SET following_count = following_count - 1 WHERE id = OLD.follower_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. update_list_player_count — body verbatim from 001_initial_schema.sql
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_list_player_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE lists SET player_count = player_count + 1, updated_at = NOW() WHERE id = NEW.list_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE lists SET player_count = player_count - 1, updated_at = NOW() WHERE id = OLD.list_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. update_tag_use_count — body verbatim from 001_initial_schema.sql
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_tag_use_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tags SET use_count = use_count + 1 WHERE id = NEW.tag_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE tags SET use_count = use_count - 1 WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. update_expert_follower_count — body verbatim from 001_initial_schema.sql
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_expert_follower_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE expert_profiles SET follower_count = follower_count + 1 WHERE id = NEW.expert_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE expert_profiles SET follower_count = follower_count - 1 WHERE id = OLD.expert_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. update_list_like_count — body verbatim from 003_lists.sql
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_list_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE lists SET like_count = like_count + 1 WHERE id = NEW.list_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE lists SET like_count = like_count - 1 WHERE id = OLD.list_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. reorder_list_players — body verbatim from 004_lists_reorder_rpc.sql
--    (the 004 REVOKE/GRANT ACLs survive CREATE OR REPLACE untouched)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reorder_list_players(
  p_list_id UUID,
  p_positions JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id UUID := auth.uid();
  list_owner UUID;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT owner_id INTO list_owner
  FROM lists
  WHERE id = p_list_id AND deleted_at IS NULL;

  IF list_owner IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  IF list_owner != caller_id THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE list_players AS lp
  SET position = (entry->>'position')::INTEGER,
      overall_rank = (entry->>'position')::INTEGER,
      updated_at = NOW()
  FROM jsonb_array_elements(p_positions) AS entry
  WHERE lp.list_id = p_list_id
    AND lp.player_id = entry->>'player_id';
END;
$$;
