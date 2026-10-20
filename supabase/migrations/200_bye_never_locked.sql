-- ============================================================================
-- 200 — a player whose NFL team has no game this week is never locked
--       (live bug, SuperLeague v0.1 week 6, reported 2026-10-18; PROGRESS
--       D590; spec v2.16.102 §13.1 / §11.2; FULL rigour — locks)
-- ============================================================================
--
-- THE RULING (Chris, 2026-10-18, verbatim): "Players on a BYE are always
-- droppable."
--
-- THE DEFECT. A manager could not drop a player whose NFL team was on a bye:
-- the refusal said his game had started. The team check is right — a week
-- with game rows and none for his team is a bye, never locked (112 / 153 /
-- 184's lineup_kickoff_internal). But 157 (F447) added a second question to
-- every lock, "has HE played this week?", for players the NFL releases or
-- trades after playing, and it is asked whatever his team is:
--   (ii)  a saved lineup kickoff for him (`team_lineups.starters[].
--         kickoff_at`) that is a real, passed kickoff of the week — e.g. a
--         Thursday instant left on his row; the per-minute tick (181 arm (b))
--         KEEPS such a record once it has passed, so a stale one never heals;
--   (iii) any stat row for him for the week — one that names no game counts
--         from the week's FIRST kickoff (Thursday).
-- Either record made a bye player "played" ⇒ locked for drops, adds, waiver
-- claims (submit and the run's drop / add check), trades, and lineup moves
-- (set_lineup / autopilot / the commissioner editor's receipt datum).
--
-- THE FIX — two helpers, one inserted guard each; every caller unchanged.
--   1. lineup_played_internal (157:208-262, the only definer): its first
--      step — his NFL team is SET and has NO game this week ⇒ "not played",
--      whatever a record or stat row says. "No game" is lineup_kickoff_
--      internal's own bye arm (a week with game rows and none for his team,
--      a game marked out of the week / cancelled excluded — 184 TD7), so the
--      lock, the BYE label and the tick read one definition. A player with
--      NO team (released) keeps today's rule — lineup_kickoff_internal also
--      reads him as a bye, so the team-is-set condition is what keeps
--      F447's release case locked.
--   2. lineup_record_kicked_off_internal (157:170-197, the only definer): a
--      saved kickoff counts only when his current team, if he has one, has
--      a game this week. So the tick's arm (b) — which keeps a passed record
--      only through this helper — re-reads a bye player's stale record to
--      his team's datum (NULL, a bye) within a minute, and 164's kept-start
--      judgment never keeps a start on a stale bye record.
--   Every lock reader reaches these two and nothing else (measured on the
--   live bodies, head 199): roster_add_drop_internal (drop + add) /
--   waiver_claim_submit_internal / process_waivers_internal (the run's
--   locked set — add and drop) / trade_lock_internal → pool_game_lock_
--   player_internal → lineup_played_lock_internal → (1); set_lineup_
--   internal / lineup_autopilot_internal / commish_edit_lineup_internal /
--   lineup_carry_internal → lineup_player_kickoff_internal → (1); the
--   tick's arm (a) pool view → lineup_played_lock_internal → (1), arm (b)
--   → (2); lineup_kept_starter_internal → (2). None of those bodies is
--   edited. The app reads the pool view (`league_player_pool.locked_until`,
--   the tick's broadcast) and has no "already played" check of its own.
--
-- WHAT IS UNCHANGED, STATED. A player whose team plays this week and whose
-- game has kicked off is locked exactly as before; a released player (no
-- team) who played stays locked by his record or stat line (F447); a
-- player traded to a team that plays later this week stays locked by what
-- he played (F447 / F501); E42 / E43 (a flexed or postponed game moves /
-- releases the record); the lock's release (153); every message; scoring.
-- Accepted by the ruling (plan Q4): a player who played earlier this week
-- and then joins a team on its bye becomes droppable, and the drop clears
-- his start from the live week (roster_add_drop always clears, Q32).
--
-- D137 — both bodies are CREATE OR REPLACE against 157's FILE TEXT (grep -in
-- "function[^(]*<name>" over 001–199: 157 the only definer of each; the file
-- body md5 equals the live prosrc — 9c54a4f3… / aa79ff77…), derived by
-- derive_200.py: every inserted line ends `-- 200 / D590`, so removing those
-- lines (pg_temp.un200) gives back 157's text byte for byte; un200 is an
-- identity on every other body (pgTAP 150 A-cells).
--   lineup_record_kicked_off_internal  157:170-197  md5 9c54a4f3… → 1 hunk (+5 / -0)
--   lineup_played_internal             157:208-262  md5 aa79ff77… → 1 hunk (+10 / -0)
--
-- DEPLOY BEFORE PUSH. SQL only — no route, page, job or type changes shape
-- (both signatures and result shapes unchanged). Until Chris's `db push`
-- production keeps today's behaviour; from the first minute after it the
-- tick clears a bye player's stale lock and saved kickoff in every league.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): two PLAIN STABLE helpers replaced,
-- signatures, LANGUAGE, search_path '' and ACLs unchanged (REVOKEs and
-- COMMENTs restated). No table, column, policy, index, grant, trigger,
-- realtime or cron change. Time only through p_at (no clock read). No
-- backfill: the tick heals stale records and pool locks on its next pass.
-- Typegen: unchanged (no signature change). pgTAP 150_bye_never_locked.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lineup_record_kicked_off_internal — CREATE OR REPLACE against
--    157:170-197's FILE TEXT (D137), 1 hunk (+5 / -0): a saved kickoff is
--    never real for a player whose current team has no game this week.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_record_kicked_off_internal(
  p_season     INTEGER,
  p_week       INTEGER,
  p_player_id  TEXT,
  p_kickoff_at TIMESTAMPTZ,   -- the recorded instant
  p_at         TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_kickoff_at IS NOT NULL
     AND p_kickoff_at <= p_at
     -- a game of that week, not postponed, kicks off at that instant (a
     -- flexed or postponed game leaves none there — E42 / E43: the record
     -- is stale, not history)
     AND EXISTS (SELECT 1 FROM public.nfl_games g
                 WHERE g.season = p_season AND g.week = p_week
                   AND g.kickoff_at = p_kickoff_at
                   AND g.status IS DISTINCT FROM 'postponed')
     -- Chris 2026-10-18, "Players on a BYE are always droppable." — and his CURRENT   -- 200 / D590
     -- NFL team, when he has one, HAS a game this week — a bye player's record is never a kickoff he played   -- 200 / D590
     AND NOT EXISTS (SELECT 1 FROM public.players b   -- 200 / D590
                     CROSS JOIN LATERAL public.lineup_kickoff_internal(p_season, p_week, b.team, p_at) k   -- 200 / D590
                     WHERE b.id = p_player_id AND b.team IS NOT NULL AND k.on_bye)   -- 200 / D590
     -- and his CURRENT team's game of the week is not postponed (E43: a
     -- postponed game releases its players' records)
     AND NOT EXISTS (SELECT 1 FROM public.nfl_games g
                     JOIN public.players p ON p.id = p_player_id
                     WHERE g.season = p_season AND g.week = p_week
                       AND g.status = 'postponed'
                       AND p.team IS NOT NULL
                       AND p.team IN (g.home_team, g.away_team));
$$;
REVOKE EXECUTE ON FUNCTION lineup_record_kicked_off_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION lineup_record_kicked_off_internal(INTEGER, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) IS
  '§11.2 / §13.1 (migration 157, L.D2.16 — F447; migration 200, D590): TRUE when a recorded starters[].kickoff_at is a real, passed kickoff of the week (a non-postponed game of that week kicks off at that instant), the player''s current NFL team — when he has one — has a game this week (a bye player''s record never counts; Chris 2026-10-18: "Players on a BYE are always droppable."), and that team''s game of the week is not postponed. A flexed or postponed game leaves no game at the old instant, so its record still moves (E42 / E43).';

-- ---------------------------------------------------------------------------
-- 2. lineup_played_internal — CREATE OR REPLACE against 157:208-262's FILE
--    TEXT (D137), 1 hunk (+10 / -0): a player whose NFL team is set and has
--    no game this week has not played.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lineup_played_internal(
  p_league_id UUID,
  p_season    INTEGER,
  p_week      INTEGER,
  p_player_id TEXT,
  p_at        TIMESTAMPTZ
) RETURNS TABLE (
  played     BOOLEAN,
  kickoff_at TIMESTAMPTZ,   -- the kickoff he played in (≤ p_at) when played
  datum_arm  TEXT           -- 'lineup_record' | 'stat_line' when played
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_rec  TIMESTAMPTZ;
  v_stat TIMESTAMPTZ;
BEGIN
  -- Chris 2026-10-18, "Players on a BYE are always droppable." — his NFL team   -- 200 / D590
  -- is SET and has NO game this week ⇒ he has not played, whatever a stat row or a saved   -- 200 / D590
  -- kickoff says. A player with NO team (released) keeps (ii) / (iii) below, as before.   -- 200 / D590
  IF EXISTS (SELECT 1 FROM public.players b   -- 200 / D590
             CROSS JOIN LATERAL public.lineup_kickoff_internal(p_season, p_week, b.team, p_at) k   -- 200 / D590
             WHERE b.id = p_player_id AND b.team IS NOT NULL AND k.on_bye) THEN   -- 200 / D590
    played := FALSE; kickoff_at := NULL; datum_arm := NULL;   -- 200 / D590
    RETURN NEXT;   -- 200 / D590
    RETURN;   -- 200 / D590
  END IF;   -- 200 / D590
  -- (ii) a START this league recorded for him this week, for a game that has
  --      kicked off (§1) — any team's lineup of the league (he is on one
  --      roster; a start kept after he left is another's row).
  SELECT min((s ->> 'kickoff_at')::timestamptz) INTO v_rec
  FROM public.team_lineups tl
  JOIN public.teams t ON t.id = tl.team_id
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tl.starters) = 'array' THEN tl.starters ELSE '[]'::jsonb END) s
  WHERE t.league_id = p_league_id
    AND tl.season = p_season
    AND tl.week = p_week
    AND s ->> 'player_id' = p_player_id
    AND public.lineup_record_kicked_off_internal(p_season, p_week, p_player_id, (s ->> 'kickoff_at')::timestamptz, p_at);
  IF v_rec IS NOT NULL THEN
    played := TRUE; kickoff_at := v_rec; datum_arm := 'lineup_record';
    RETURN NEXT;
    RETURN;
  END IF;
  -- (iii) his STAT LINE for the week (F442) — he played, for whichever NFL
  --       team he was on then. Counted once the game it names has kicked off
  --       at p_at (or, naming none, the week's first game): a stat line is
  --       evidence of a game that has started, and p_at never precedes it.
  SELECT min(COALESCE(g.kickoff_at,
                      (SELECT min(w.kickoff_at) FROM public.nfl_games w
                       WHERE w.season = p_season AND w.week = p_week)))
    INTO v_stat
  FROM public.player_stats ps
  LEFT JOIN public.nfl_games g ON g.id = ps.game_id
  WHERE ps.player_id = p_player_id AND ps.season = p_season AND ps.week = p_week;
  IF v_stat IS NOT NULL AND v_stat <= p_at THEN
    played := TRUE; kickoff_at := v_stat; datum_arm := 'stat_line';
    RETURN NEXT;
    RETURN;
  END IF;
  played := FALSE; kickoff_at := NULL; datum_arm := NULL;
  RETURN NEXT;
END;
$$;
REVOKE EXECUTE ON FUNCTION lineup_played_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION lineup_played_internal(UUID, INTEGER, INTEGER, TEXT, TIMESTAMPTZ) IS
  '§11.2 / §13.1 (migration 157, L.D2.16 — F447; migration 200, D590): has the player played this league-week by a record other than his current NFL team''s kickoff — a start the league recorded for a real, passed kickoff (lineup_record_kicked_off_internal), or his stat line for the week once its game has kicked off? Returns the kickoff he played in and the arm. Since 200: a player whose NFL team is set and has NO game this week (lineup_kickoff_internal''s bye) has not played, whatever a record says (Chris 2026-10-18: "Players on a BYE are always droppable."); a player with no team keeps both arms.';
