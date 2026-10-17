-- ============================================================================
-- Migration 187: lift the free-tier list caps (one private list, one team)
--
-- Chris, 2026-10-15 (mobile gap list, decision 5): the Pro rules are
-- suspended for the free-only launch, so private lists are unlimited for
-- everyone. Chris, 2026-10-16: "remove the list caps for non-Pro, Pro logic
-- on hold" — the one-team cap goes too. The API dropped its pre-checks
-- (FREE_PRIVATE_LIST_LIMIT = FREE_TEAM_LIST_LIMIT = null); this switches off
-- the same caps in the database trigger, which otherwise still refuses a free
-- account's second private list or second team.
--
-- Authored against the HEAD body (028), not the deployed one. Both caps are
-- switched off behind constants rather than removed (CLAUDE.md: keep the
-- is_pro checks in place) — a Pro tier brings either back by putting a
-- number in. Kept verbatim: the trigger itself, the Favorites exemption, the
-- per-owner advisory lock, the refusal messages, and SECURITY DEFINER with
-- the search_path pin (supabase/tests/004 counts this function).
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_free_list_caps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Free accounts' caps. SUSPENDED (private 2026-10-15, team 2026-10-16):
  -- NULL = off. A Pro tier brings one back by putting a number here (each
  -- was 1).
  c_private_cap CONSTANT integer := NULL;
  c_team_cap CONSTANT integer := NULL;
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
  IF NOT ((c_private_cap IS NOT NULL AND COALESCE(NEW.is_private, false))
          OR (c_team_cap IS NOT NULL AND COALESCE(NEW.is_team, false))) THEN
    RETURN NEW;
  END IF;

  SELECT is_pro INTO v_is_pro FROM profiles WHERE id = NEW.owner_id;
  IF COALESCE(v_is_pro, false) THEN
    RETURN NEW;  -- Pro accounts are unlimited.
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 0));

  IF c_private_cap IS NOT NULL AND COALESCE(NEW.is_private, false) THEN
    SELECT count(*) INTO v_count
    FROM lists
    WHERE owner_id = NEW.owner_id
      AND is_private = true
      AND is_favorites = false
      AND deleted_at IS NULL
      AND id <> NEW.id;
    IF v_count >= c_private_cap THEN
      RAISE EXCEPTION 'Free accounts can have one private list.'
        USING errcode = 'check_violation';
    END IF;
  END IF;

  IF c_team_cap IS NOT NULL AND COALESCE(NEW.is_team, false) THEN
    SELECT count(*) INTO v_count
    FROM lists
    WHERE owner_id = NEW.owner_id
      AND is_team = true
      AND deleted_at IS NULL
      AND id <> NEW.id;
    IF v_count >= c_team_cap THEN
      RAISE EXCEPTION 'Free accounts can have one team.'
        USING errcode = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
