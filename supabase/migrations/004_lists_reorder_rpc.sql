-- ============================================================================
-- Drop the unique index on (list_id, position) — it causes false collisions
-- during reorder operations. Application owns position uniqueness.
-- Add an RPC that atomically applies a new position map for a list.
-- ============================================================================

DROP INDEX IF EXISTS idx_list_players_list_position_unique;

-- positions JSONB shape: [{"player_id": "<text>", "position": <int>}, ...]
CREATE OR REPLACE FUNCTION reorder_list_players(
  p_list_id UUID,
  p_positions JSONB
) RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION reorder_list_players(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reorder_list_players(UUID, JSONB) TO authenticated;
