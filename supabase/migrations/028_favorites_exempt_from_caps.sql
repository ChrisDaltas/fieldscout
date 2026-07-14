-- ============================================================================
-- Migration 028: exempt the Favorites list from the free-tier private-list cap
--
-- The Favorites list (is_favorites) is a per-user system "quick save" bucket,
-- like the big board. It's private (a personal stash), but it must NOT count
-- against the free-tier one-private-list cap, and creating it must never be
-- blocked by that cap. Update enforce_free_list_caps() to skip it entirely and
-- exclude it from the private-list count.
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
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- The Favorites list is a system quick-save bucket — never capped.
  IF COALESCE(NEW.is_favorites, false) THEN
    RETURN NEW;
  END IF;
  IF NOT (COALESCE(NEW.is_private, false) OR COALESCE(NEW.is_team, false)) THEN
    RETURN NEW;
  END IF;

  SELECT is_pro INTO v_is_pro FROM profiles WHERE id = NEW.owner_id;
  IF COALESCE(v_is_pro, false) THEN
    RETURN NEW;  -- Pro accounts are unlimited.
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 0));

  IF COALESCE(NEW.is_private, false) THEN
    SELECT count(*) INTO v_count
    FROM lists
    WHERE owner_id = NEW.owner_id
      AND is_private = true
      AND is_favorites = false
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
