-- ============================================================================
-- Migration 190: ranking movement and a ranking's saved scoring
--
-- Chris, 2026-10-15 (mobile rulings #33 and #36), and 2026-10-16 (a ranking
-- with no scoring chosen is Half PPR).
--
-- 1. list_players.previous_position — MOVEMENT ARROWS (#33). A ranking shows
--    how far each player moved between its CURRENT version and its PREVIOUS
--    update ("it doesn't need to save each, it just needs to know the
--    difference between current and last"). So each row keeps one number:
--    the position he had before the latest publish. NULL = he was added by
--    that publish (or the ranking hasn't been updated since this column
--    arrived). No history table.
--
--    It is set at PUBLISH time, and every way a ranking board is published or
--    updated goes through ONE door — `reorder_list_players` (the phone's
--    Publish, desktop's Big Board drag-save, Weekly ranks and the weekly
--    grid's Save, and `/api/big-board/save`). So the door records it:
--      * only on a RANKING board — a season big board (`is_big_board`), a
--        weekly board (`big_board_weekly`) or an AI expert's board
--        (`ai_persona_id`); every other list is reordered exactly as before;
--      * only for the rows the call sends (the phone publishes one position
--        at a time: the other positions keep their own last publish);
--      * previous_position := the row's position BEFORE this update (the SET
--        clause reads the old row), or NULL for an entry flagged
--        `"is_new": true` — a player this publish added. The caller flags
--        those because a publish adds players (bulk insert) before it orders
--        them, so by the time of the reorder the row exists with a temporary
--        slot that must not count as "where he was".
--    The old body ignores keys it doesn't read, so callers send `is_new`
--    before this migration is pushed with no effect and no error.
--    On a ranking board the door also fills a scoring that was never chosen
--    (2. below).
--
--    Authored against the HEAD body — 048 (the search_path pin; body
--    verbatim from 004). Kept verbatim: the signature, SECURITY DEFINER, the
--    `public, pg_temp` pin (pgTAP 004 checks every definer), the
--    Unauthorized / List not found / Forbidden messages the routes map to
--    401 / 404 / 403, the position + overall_rank + updated_at writes, and
--    004's REVOKE/GRANT (CREATE OR REPLACE keeps the ACL).
--
-- 2. lists.scoring_format — the SCORING a ranking was made for (#36), set on
--    publish from the scoring chosen in the phone's ranking editor. Community
--    filters rankings on it: this name and these four values are the
--    contract. A CHECK closes the vocabulary on every write path, the way
--    188 closes `cover_color`.
--
--    A ranking whose scoring was never chosen is HALF PPR (Chris,
--    2026-10-16: "if no scoring type is selected, default to half point
--    ppr"). A ranking is what Community lists as one: a season big board
--    (`is_big_board`), a weekly board (`big_board_weekly` points at it, and
--    Community also knows it by its `week-N-big-board` slug) or an AI
--    expert's board (`ai_persona_id`). An AI expert's board is made for its
--    persona's usual scoring (`style_profile.scoring_default`, which the
--    generators pass to the player packet) when that is PPR, Half-PPR or
--    Standard, else it is Half PPR too.
--
--    `fill_ranking_scoring_internal` is that one rule. It only ever fills a
--    NULL — a chosen scoring is never overwritten — and it runs:
--      * once here, over every existing ranking (the backfill);
--      * at every publish, inside the door below: a publish that picks no
--        scoring (desktop's Big Board and Weekly ranks saves) leaves the
--        ranking Half PPR, and a scoring the phone picked is saved after it.
--    Only rankings are tagged. A plain list has no scoring, so the column
--    has NO default: a new list stays NULL. (So does a big board or week
--    until its first publish; every reader takes NULL as Half PPR.)
--
-- RLS: nothing to add — both tables' policies are row-level and already
-- govern every column.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE list_players
  ADD COLUMN IF NOT EXISTS previous_position integer NULL;

COMMENT ON COLUMN list_players.previous_position IS
  'Position before the ranking''s latest publish (reorder_list_players on a ranking board). NULL = added by that publish, or not updated since migration 190.';

ALTER TABLE lists
  ADD COLUMN IF NOT EXISTS scoring_format text NULL;

ALTER TABLE lists
  DROP CONSTRAINT IF EXISTS lists_scoring_format_check;
ALTER TABLE lists
  ADD CONSTRAINT lists_scoring_format_check
  CHECK (scoring_format IN ('ppr', 'half', 'quarter', 'standard'));

COMMENT ON COLUMN lists.scoring_format IS
  'Scoring a ranking is for: ppr, half, quarter (0.25 PPR) or standard. A ranking with none chosen is half (fill_ranking_scoring_internal, migration 190). NULL on a plain list (it has no scoring), and on a ranking not yet published, which reads as half.';

-- ---------------------------------------------------------------------------
-- 2. A ranking with no scoring chosen: Half PPR — an AI expert's board, its
--    persona's usual scoring when we know it. Fills NULLs only, on one
--    ranking (the publish door, 3.) or, with no argument, on every one (the
--    backfill below). Returns how many it filled.
--
--    The one UPDATE fires the two lists row triggers, both inert here:
--    `guard_lists_ai_persona` acts only on a changed ai_persona_id, and
--    `enforce_free_list_caps` only on a team or a capped private list (the
--    private cap is off since 187; a ranking is never a team).
--
--    Internal: this migration and the door call it, never a client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fill_ranking_scoring_internal(p_list_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH filled AS (
    UPDATE lists AS l
    SET scoring_format = COALESCE(
      (SELECT CASE p.style_profile->>'scoring_default'
                WHEN 'PPR' THEN 'ppr'
                WHEN 'Half-PPR' THEN 'half'
                WHEN 'Half PPR' THEN 'half'
                WHEN 'Standard' THEN 'standard'
              END
         FROM ai_personas AS p
        WHERE p.id = l.ai_persona_id),
      'half')
    WHERE l.scoring_format IS NULL
      AND (p_list_id IS NULL OR l.id = p_list_id)
      AND (COALESCE(l.is_big_board, false)
           OR l.ai_persona_id IS NOT NULL
           OR EXISTS (SELECT 1 FROM big_board_weekly AS w WHERE w.list_id = l.id)
           OR l.slug ~ '^week-[0-9]+-big-board(-|$)')
    RETURNING 1
  )
  SELECT count(*)::integer FROM filled;
$$;

REVOKE EXECUTE ON FUNCTION fill_ranking_scoring_internal(UUID) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_filled integer;
BEGIN
  SELECT fill_ranking_scoring_internal() INTO v_filled;
  RAISE NOTICE '190: gave % ranking(s) their scoring', v_filled;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. reorder_list_players — HEAD body (048) + previous_position on rankings,
--    and a ranking's scoring filled when none was ever chosen (2.)
-- ---------------------------------------------------------------------------
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
  is_ranking BOOLEAN;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT owner_id, (COALESCE(is_big_board, false) OR ai_persona_id IS NOT NULL)
  INTO list_owner, is_ranking
  FROM lists
  WHERE id = p_list_id AND deleted_at IS NULL;

  IF list_owner IS NULL THEN
    RAISE EXCEPTION 'List not found';
  END IF;
  IF list_owner != caller_id THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- A weekly board is an ordinary list that big_board_weekly points at.
  is_ranking := is_ranking
    OR EXISTS (SELECT 1 FROM big_board_weekly AS w WHERE w.list_id = p_list_id);

  UPDATE list_players AS lp
  SET position = (entry->>'position')::INTEGER,
      overall_rank = (entry->>'position')::INTEGER,
      updated_at = NOW(),
      -- On a ranking: where he was before this update (the old row's
      -- position), or NULL for a player this publish added.
      previous_position = CASE
        WHEN NOT is_ranking THEN lp.previous_position
        WHEN entry->'is_new' = 'true'::jsonb THEN NULL
        ELSE lp.position
      END
  FROM jsonb_array_elements(p_positions) AS entry
  WHERE lp.list_id = p_list_id
    AND lp.player_id = entry->>'player_id';

  -- A ranking published with no scoring ever chosen is Half PPR. A scoring
  -- the caller picked is saved after this, over it (the publish routes).
  IF is_ranking THEN
    PERFORM fill_ranking_scoring_internal(p_list_id);
  END IF;
END;
$$;
