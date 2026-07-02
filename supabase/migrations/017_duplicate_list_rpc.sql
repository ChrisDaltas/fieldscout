-- ============================================================================
-- Migration 017: atomic list duplication
--
-- The duplicate-list route previously created the new list, then copied its
-- players and tags in separate statements. A failure mid-way (or a concurrent
-- request) could leave a half-created list — e.g. a 201 response pointing at a
-- list with no players. This function performs the whole copy in a single
-- transaction so it either fully succeeds or makes no change at all.
--
-- Free-tier caps (private-list limit, one-team limit) and unique-slug
-- generation stay in the route; this function only does the atomic copy and
-- applies the caller-decided `p_force_public` override. It runs SECURITY
-- INVOKER so RLS still applies: a private list the caller can't see is simply
-- "not found", and the inserts are checked against the caller's own policies.
-- ============================================================================

CREATE OR REPLACE FUNCTION duplicate_list(
  p_source_id uuid,
  p_title text,
  p_slug text,
  p_force_public boolean DEFAULT false
)
RETURNS lists
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_source lists%ROWTYPE;
  v_new lists;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING errcode = '28000';
  END IF;

  -- RLS applies (SECURITY INVOKER): only a public or owned, non-deleted list
  -- is visible here. Anything else raises "not found" (mapped to 404).
  SELECT * INTO v_source
  FROM lists
  WHERE id = p_source_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'List not found' USING errcode = 'P0002';
  END IF;

  -- ranking_mode is the source of truth; keep the legacy boolean pair derived
  -- from it so the copied row stays internally consistent. A duplicate is
  -- never itself a Big Board, and never inherits the source's folder.
  INSERT INTO lists (
    owner_id, title, description, slug, position_filter,
    ranking_mode, hide_order, tiers_enabled,
    is_private, is_team, roster_settings, is_big_board, comments_enabled
  )
  VALUES (
    v_owner, p_title, v_source.description, p_slug, v_source.position_filter,
    v_source.ranking_mode,
    v_source.ranking_mode = 'unranked',
    v_source.ranking_mode = 'rank_and_tier',
    CASE WHEN p_force_public THEN false ELSE v_source.is_private END,
    COALESCE(v_source.is_team, false), v_source.roster_settings,
    false, v_source.comments_enabled
  )
  RETURNING * INTO v_new;

  -- Copy players, preserving order, tier, and roster-slot assignments.
  INSERT INTO list_players (
    list_id, player_id, position, tier, rank_in_tier, overall_rank, slot, notes
  )
  SELECT v_new.id, player_id, position, tier, rank_in_tier, overall_rank, slot, notes
  FROM list_players
  WHERE list_id = p_source_id;

  -- Copy tag associations.
  INSERT INTO list_tags (list_id, tag_id)
  SELECT v_new.id, tag_id
  FROM list_tags
  WHERE list_id = p_source_id;

  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION duplicate_list(uuid, text, text, boolean) TO authenticated;
