-- ============================================================================
-- Migration 018: race-safe free-tier caps (1 private list, 1 team)
--
-- The API counts existing private lists / teams before inserting, but two
-- concurrent requests can both read "0" and both insert, slipping a free user
-- past the cap (TOCTOU). A partial unique index can't express this because the
-- cap is conditional on profiles.is_pro (Pro = unlimited), and an index
-- predicate can't reach another table.
--
-- This trigger enforces the caps at write time. It takes a per-owner
-- transaction advisory lock so concurrent inserts/updates for the same owner
-- serialize: the second waits for the first to commit, then sees its row in the
-- count and is rejected. The app-layer pre-check still handles the common case
-- with a friendly 403; this is the backstop that closes the race.
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_free_list_caps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_pro boolean;
  v_count integer;
BEGIN
  -- Only private lists and teams are capped; soft-deleted rows don't count.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.is_private, false) OR COALESCE(NEW.is_team, false)) THEN
    RETURN NEW;
  END IF;

  SELECT is_pro INTO v_is_pro FROM profiles WHERE id = NEW.owner_id;
  IF COALESCE(v_is_pro, false) THEN
    RETURN NEW;  -- Pro accounts are unlimited.
  END IF;

  -- Serialize concurrent writes for this owner so count-then-write can't race.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 0));

  IF COALESCE(NEW.is_private, false) THEN
    SELECT count(*) INTO v_count
    FROM lists
    WHERE owner_id = NEW.owner_id
      AND is_private = true
      AND deleted_at IS NULL
      AND id <> NEW.id;
    IF v_count >= 1 THEN
      RAISE EXCEPTION 'Free accounts can have one private list.'
        USING errcode = 'check_violation';
    END IF;
  END IF;

  IF COALESCE(NEW.is_team, false) THEN
    SELECT count(*) INTO v_count
    FROM lists
    WHERE owner_id = NEW.owner_id
      AND is_team = true
      AND deleted_at IS NULL
      AND id <> NEW.id;
    IF v_count >= 1 THEN
      RAISE EXCEPTION 'Free accounts can have one team.'
        USING errcode = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_free_list_caps ON lists;
CREATE TRIGGER trg_enforce_free_list_caps
  BEFORE INSERT OR UPDATE ON lists
  FOR EACH ROW
  EXECUTE FUNCTION enforce_free_list_caps();
