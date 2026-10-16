-- ============================================================================
-- Migration 188: a list's cover colour
--
-- Chris, 2026-10-15 (mobile ruling 9): the owner can pick one of six colours
-- for a list's player-collage cover — the design's swatches (lr-lists §2.2):
-- blue #0088FF, ink #1D1D1F, red #F75252, purple #9D70E9, indigo #5C7CE5,
-- green #07B85A. With no colour chosen the cover keeps today's rule and
-- follows the list's position group, so every existing list is unchanged.
--
-- Stored as stable KEYS, not hex: the app maps each key to its theme token
-- (accent, ink, pos-qb, pos-wr, pos-rb, confirm), so a palette tweak never
-- needs a data migration. NULL = follow the position colour. The CHECK closes
-- the vocabulary on every write path, including ones that never see the API's
-- Zod (duplicate_list below, seeds, a future route) — the same reason
-- `list_players.tier` keeps its own CHECK (081).
--
-- RLS: nothing to add. The lists policies are row-level (001) and already
-- govern every column of a row, this one included.
--
-- duplicate_list: redefined so a copy keeps the source's colour, as it already
-- keeps `position_filter` (the other half of what colours a cover). Authored
-- against the HEAD body — 017, the only definition in the chain — with one
-- change: `cover_color` added to the INSERT. Kept verbatim: the signature,
-- SECURITY INVOKER (RLS still applies to the caller), the search_path pin,
-- the error codes the route maps (28000, P0002), and the grant.
-- ============================================================================

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS cover_color text NULL;

ALTER TABLE lists
  DROP CONSTRAINT IF EXISTS lists_cover_color_check;
ALTER TABLE lists
  ADD CONSTRAINT lists_cover_color_check
  CHECK (cover_color IN ('blue', 'ink', 'red', 'purple', 'indigo', 'green'));

COMMENT ON COLUMN lists.cover_color IS
  'Collage cover colour key (blue, ink, red, purple, indigo, green). NULL = follow the list''s position group.';

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
  -- never itself a Big Board, and never inherits the source's folder. It
  -- keeps the source's cover colour (188), like its position group.
  INSERT INTO lists (
    owner_id, title, description, slug, position_filter, cover_color,
    ranking_mode, hide_order, tiers_enabled,
    is_private, is_team, roster_settings, is_big_board, comments_enabled
  )
  VALUES (
    v_owner, p_title, v_source.description, p_slug, v_source.position_filter,
    v_source.cover_color,
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
