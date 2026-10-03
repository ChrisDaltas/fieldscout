-- ============================================================================
-- 179 — commissioner_actions.reverts_action_id gets its guard (M6 follow-up
--       F520; spec §10.3, §10.4, §12.12; PROGRESS D451(5), D475; tasks-M6
--       TD10 (iii))
-- ============================================================================
--
-- THE GAP (F520, L.E1.31 / D451(5)). 170 guards the five columns OUTSIDE the
-- log that point at it (only the receipt the same verb just wrote). The log's
-- own self-pointer, reverts_action_id (123), was left unguarded: nothing
-- writes it (log_commissioner_action_internal never sets it; Undo — §10.4,
-- Q85 — is not built), 123's immutability trigger refuses every UPDATE, and
-- since 175 only a SECURITY DEFINER verb can INSERT a receipt at all. The FK
-- alone would still accept a receipt that "reverts" a receipt of ANOTHER
-- league, or itself.
--
-- THE CHANGE — one BEFORE INSERT trigger, the self-pointer's form of 170's
-- rule. A revert names an EARLIER receipt (it cannot be the receipt "the
-- same action wrote" — that is the row being inserted), so the guard is:
--   a non-NULL reverts_action_id must name an existing receipt of the SAME
--   league, and never the new receipt itself.
-- Anything else is refused P0001, by name. UPDATE needs no twin: 123's
-- commish_actions_immutable_internal already refuses every UPDATE (ENABLE
-- ALWAYS). Named trg_zz_reverts_action_id_league_check — deliberately NOT
-- matching 118 A6 / A7's 'trg\_zz\_%\_guard\_%' census of 170's ten
-- triggers, which stay as written (additive; pgTAP 127 pins this one).
--
-- NOTHING CHANGES TODAY: no code path sets the column, and production holds
-- no row with it set (measured read-only 2026-10-03 on 178). Whoever builds
-- Undo writes the pointer through a verb and this guard judges it.
--
-- CHECKLIST (tasks-M* §4.4): additive only (one function, one trigger); no
-- table / column / policy / grant change; the function is a trigger body
-- (no SECURITY DEFINER, search_path '', EXECUTE revoked from PUBLIC / anon /
-- authenticated); ENABLE ALWAYS (R616); no backfill (no existing row is
-- judged — a BEFORE INSERT trigger); deploy-before-push safe (the app never
-- writes the column). RESTORES: a data-only restore that copies receipts
-- with the pointer set must load the target first (FK order already
-- requires it) — the guard then passes. No R6 / D38 waiver needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION commish_action_reverts_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_target_league UUID;
BEGIN
  IF NEW.reverts_action_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.reverts_action_id = NEW.id THEN
    RAISE EXCEPTION
      'commissioner_actions.reverts_action_id on receipt % names the receipt itself: a revert points back at an EARLIER receipt of its own league (F520; §10.4, §12.12)',
      NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT ca.league_id INTO v_target_league
  FROM public.commissioner_actions ca
  WHERE ca.id = NEW.reverts_action_id;
  IF v_target_league IS DISTINCT FROM NEW.league_id THEN
    RAISE EXCEPTION
      'commissioner_actions.reverts_action_id on receipt % names % (league %), not a receipt of league %: a revert points back only at a receipt of its own league (F520; §10.4, §12.12)',
      NEW.id, NEW.reverts_action_id, COALESCE(v_target_league::text, 'none — no such receipt'), NEW.league_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_action_reverts_guard_internal() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_zz_reverts_action_id_league_check
  BEFORE INSERT ON commissioner_actions FOR EACH ROW
  WHEN (NEW.reverts_action_id IS NOT NULL)
  EXECUTE FUNCTION commish_action_reverts_guard_internal();
ALTER TABLE commissioner_actions ENABLE ALWAYS TRIGGER trg_zz_reverts_action_id_league_check;
