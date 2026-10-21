-- ============================================================================
-- 207 — list_players rows stay on their list; a start/sit question's week,
--       season and scoring freeze once anyone has voted
--       (follow-up to 206 / PR #529 review R1655 + R1656; PROGRESS D666–D669;
--       spec §19.3)
-- ============================================================================
--
-- PART 1 — list_players.list_id (R1655). A list's player_count moves on
-- INSERT / DELETE only (`on_list_player_change AFTER INSERT OR DELETE`, 001).
-- Unlike 206's four link tables, list_players IS updated by the app (reorder,
-- tier, slot — `slot/route.ts`, `tier/route.ts`, `reorder_list_players`), so
-- the UPDATE grant stays. Instead one BEFORE UPDATE trigger refuses a change
-- of `list_id` from a client role; every other column stays editable.
-- WHO IS A CLIENT ROLE: `current_user` IN ('anon', 'authenticated'), exactly
-- as 206 (D662) — the guard is SECURITY INVOKER for that reason. Grep
-- 2026-10-21: no app path, script or migration changes a row's `list_id`
-- (the app updates rows only by `.eq('list_id', id)` filters).
--
-- PART 2 — start_sit_questions (R1656). 206's guard froze the two players
-- once any vote exists. Week, season and scoring change what every cast vote
-- meant in the same way, so they freeze too. `context_note` (and the other
-- columns) stay editable. Separate message so 206's player wording (pgTAP
-- 156 H24 / H25) is unchanged.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * D137: Part 2 is a CREATE OR REPLACE of
--     `start_sit_server_owned_guard_internal`, authored against its newest
--     definer's file text — 206_function_grants_and_server_owned_columns.sql
--     §2d (the only prior definition; `grep -l start_sit_server_owned_guard
--     supabase/migrations` → 206 only). 206's body verbatim plus the one
--     added branch, marked `-- 207`.
--   * New / replaced functions pin `search_path = ''` and are SECURITY
--     INVOKER; EXECUTE revoked from PUBLIC, anon, authenticated (trigger
--     functions, never called directly). Re-issued for the replaced one
--     (CREATE OR REPLACE keeps the ACL; the REVOKE is idempotent).
--   * The new function's name avoids 206's `%server_owned_guard_internal`
--     pattern, which pgTAP 156 B1 / B2 count (six).
--   * Grants / policies: none changed. Trigger added at the default enable
--     mode, like 206's.
--   * R6 / D38 waivers: none needed — no league table, no RPC, no realtime.
--   * Deploy-before-push safe: no signature or type change; nothing in the
--     app writes `list_id` on update or a frozen start/sit column.
--   * Rollback: DROP TRIGGER trg_list_players_list_id_guard + its function;
--     re-run 206 §2d's CREATE OR REPLACE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1 — list_players: a row cannot move to another list (R1655)
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.list_players_list_id_guard_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND NEW.list_id IS DISTINCT FROM OLD.list_id THEN
    RAISE EXCEPTION 'A player can''t be moved to another list. Remove and add instead.'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_list_players_list_id_guard
  BEFORE UPDATE ON public.list_players
  FOR EACH ROW
  EXECUTE FUNCTION public.list_players_list_id_guard_internal();

REVOKE EXECUTE ON FUNCTION public.list_players_list_id_guard_internal()
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- PART 2 — start_sit_questions: week, season and scoring freeze with the
--          players once anyone has voted (R1656). Body = 206 §2d + one branch.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_sit_server_owned_guard_internal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.vote_count_a, 0) <> 0
         OR COALESCE(NEW.vote_count_b, 0) <> 0
         OR NEW.correct_player IS NOT NULL
         OR NEW.resolved_at IS NOT NULL
         OR COALESCE(NEW.is_voided, false) THEN
        RAISE EXCEPTION 'Votes and results are managed by the system.'
          USING errcode = 'check_violation';
      END IF;
    ELSIF NEW.vote_count_a IS DISTINCT FROM OLD.vote_count_a
       OR NEW.vote_count_b IS DISTINCT FROM OLD.vote_count_b
       OR NEW.correct_player IS DISTINCT FROM OLD.correct_player
       OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
       OR NEW.is_voided IS DISTINCT FROM OLD.is_voided THEN
      RAISE EXCEPTION 'Votes and results are managed by the system.'
        USING errcode = 'check_violation';
    ELSIF (NEW.player_a_id IS DISTINCT FROM OLD.player_a_id
           OR NEW.player_b_id IS DISTINCT FROM OLD.player_b_id)
          AND public.start_sit_question_vote_exists(OLD.id) THEN
      RAISE EXCEPTION 'The players can''t change once people have voted.'
        USING errcode = 'check_violation';
    -- 207: the week, season and scoring freeze the same way (R1656)
    ELSIF (NEW.week IS DISTINCT FROM OLD.week
           OR NEW.season IS DISTINCT FROM OLD.season
           OR NEW.scoring_system_id IS DISTINCT FROM OLD.scoring_system_id)
          AND public.start_sit_question_vote_exists(OLD.id) THEN
      RAISE EXCEPTION 'The week and scoring can''t change once people have voted.'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_sit_server_owned_guard_internal()
  FROM PUBLIC, anon, authenticated;
