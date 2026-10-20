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
-- One predicate, "a bye player with no real line", written the same in both:
--   his NFL team is SET, has NO game this week (lineup_kickoff_internal's
--   own bye arm — a week with game rows and none for his team, a game
--   marked out of the week / cancelled excluded, 184 TD7 — so the lock, the
--   BYE label and the tick read one definition), AND no stat line of his for
--   the week names a game of this week that has kicked off at p_at — named
--   by its game_id, or by 194's line team (`player_stats.team`) playing in
--   it; a postponed game or one marked out of the week / cancelled is not
--   such a game.
--   1. lineup_played_internal (157:208-262, the only definer): its first
--      step — that predicate ⇒ "not played", whatever a stray stat row (no
--      game, no team — the live bug) or a saved kickoff says.
--   2. lineup_record_kicked_off_internal (157:170-197, the only definer): a
--      saved kickoff never counts under that predicate. So the tick's arm
--      (b) — which keeps a passed record only through this helper —
--      re-reads such a player's stale record to his team's datum (NULL, a
--      bye) within a minute, and 164's kept-start judgment never keeps a
--      start on it.
--   WHAT STILL LOCKS A BYE-TEAM PLAYER (review R1, F447 kept): a REAL line.
--   (a) A stale stored team: the player sync runs Tuesdays 10:00 UTC, so a
--       deadline-day trade or a Wednesday–Saturday signing leaves
--       `players.team` on the old team (here on a bye) all week, while the
--       live ingest writes his line with the team he played for (194). That
--       line names a game of the week ⇒ (ii) / (iii) as in 157 — he cannot
--       be added, started or benched after his kickoff.
--   (b) A game played before joining a bye team (Thursday for YA, then
--       moved to YC): his line names the Thursday game ⇒ locked as in 157.
--   A player with NO team (released) never meets the predicate (team-is-set
--   — lineup_kickoff_internal also reads a NULL team as a bye), so F447's
--   release case is 157's rule untouched.
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
-- he played (F447 / F501); a bye-team player with a real line (above) is
-- 157's rule; E42 / E43 (a flexed or postponed game moves / releases the
-- record); the lock's release (153); every message; scoring.
-- WHAT CHANGES, STATED — and only this: a player whose stored team is on a
-- bye and who has no real line is "not played". So a stray stat row (no
-- game, no team) or a saved kickoff ALONE no longer locks him. A saved
-- kickoff with no line behind it is a start in a game he has no stats
-- from — a stale Thursday instant (the live bug), or a game whose line has
-- not been ingested yet. A stale-team player with no line yet reads as a
-- bye exactly as in 157 (his stored team has no game; nothing else says he
-- played).
--
-- D137 — both bodies are CREATE OR REPLACE against 157's FILE TEXT (grep -in
-- "function[^(]*<name>" over 001–199: 157 the only definer of each; the file
-- body md5 equals the live prosrc — 9c54a4f3… / aa79ff77…), derived by
-- derive_200b.py (review R1's narrowed guard): every inserted line ends `-- 200 / D590`, so removing those
-- lines (pg_temp.un200) gives back 157's text byte for byte; un200 is an
-- identity on every other body (pgTAP 150 A-cells).
--   lineup_record_kicked_off_internal  157:170-197  md5 9c54a4f3… → 1 hunk (+15 / -0)
--   lineup_played_internal             157:208-262  md5 aa79ff77… → 1 hunk (+21 / -0)
--
-- DEPLOY BEFORE PUSH. SQL only — no route, page, job or type changes shape
-- (both signatures and result shapes unchanged). Until Chris's `db push`
-- production keeps today's behaviour; from the first minute after it the
-- tick clears a bye player's stale lock and saved kickoff in every league.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): two PLAIN STABLE helpers replaced,
-- signatures, LANGUAGE, search_path '' and ACLs unchanged (REVOKEs and
-- COMMENTs restated). No table, column, policy, index, grant, trigger,
-- realtime or cron change. Time only through p_at (no clock read; a line
-- counts only once the game it names has kicked off at p_at). No
-- backfill: the tick heals stale records and pool locks on its next pass.
-- Typegen: unchanged (no signature change). pgTAP 150_bye_never_locked.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. lineup_record_kicked_off_internal — CREATE OR REPLACE against
--    157:170-197's FILE TEXT (D137), 1 hunk (+15 / -0): a saved kickoff is
--    never real for a bye-team player with no real line (the predicate above).
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
     -- Chris 2026-10-18, "Players on a BYE are always droppable." — and NOT a bye player   -- 200 / D590
     -- with no real line: his NFL team is SET, has NO game this week, and no stat line of his   -- 200 / D590
     -- for the week names a game of this week that has kicked off (lineup_played_internal's   -- 200 / D590
     -- guard, the same predicate). A saved kickoff alone never locks a bye player; a real line   -- 200 / D590
     -- (a stale team after a mid-week trade, a game played before joining a bye team) keeps it.   -- 200 / D590
     AND NOT (EXISTS (SELECT 1 FROM public.players b   -- 200 / D590
                      CROSS JOIN LATERAL public.lineup_kickoff_internal(p_season, p_week, b.team, p_at) k   -- 200 / D590
                      WHERE b.id = p_player_id AND b.team IS NOT NULL AND k.on_bye)   -- 200 / D590
              AND NOT EXISTS (SELECT 1 FROM public.player_stats ps   -- 200 / D590
                              JOIN public.nfl_games g ON g.season = p_season AND g.week = p_week   -- 200 / D590
                               AND (g.id = ps.game_id OR ps.team IN (g.home_team, g.away_team))   -- 200 / D590
                              WHERE ps.player_id = p_player_id AND ps.season = p_season AND ps.week = p_week   -- 200 / D590
                                AND g.kickoff_at <= p_at AND g.status IS DISTINCT FROM 'postponed'   -- 200 / D590
                                AND g.operator_hold IS DISTINCT FROM 'out_of_week'   -- 200 / D590
                                AND g.operator_hold IS DISTINCT FROM 'cancelled'))   -- 200 / D590
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
  '§11.2 / §13.1 (migration 157, L.D2.16 — F447; migration 200, D590): TRUE when a recorded starters[].kickoff_at is a real, passed kickoff of the week (a non-postponed game of that week kicks off at that instant), the player is not a bye-team player with no real line (his NFL team is set and has no game this week, and no stat line of his names a game of this week that has kicked off — then his record never counts; Chris 2026-10-18: "Players on a BYE are always droppable."), and that team''s game of the week is not postponed. A flexed or postponed game leaves no game at the old instant, so its record still moves (E42 / E43).';

-- ---------------------------------------------------------------------------
-- 2. lineup_played_internal — CREATE OR REPLACE against 157:208-262's FILE
--    TEXT (D137), 1 hunk (+21 / -0): a bye-team player with no real line
--    (the predicate above) has not played.
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
  -- Chris 2026-10-18, "Players on a BYE are always droppable." — his NFL team is SET and   -- 200 / D590
  -- has NO game this week, and NO stat line of his for the week names a game of this week   -- 200 / D590
  -- that has kicked off (its game id, or 194's line team, is such a game — not postponed,   -- 200 / D590
  -- not marked out of the week / cancelled) ⇒ he has not played, whatever a stray stat row   -- 200 / D590
  -- (no game, no team) or a saved kickoff says. A REAL line keeps (ii) / (iii) below — a   -- 200 / D590
  -- stored team left stale by a mid-week trade, or a game played before he joined a bye   -- 200 / D590
  -- team (F447) — and so does a player with NO team (released).   -- 200 / D590
  IF EXISTS (SELECT 1 FROM public.players b   -- 200 / D590
             CROSS JOIN LATERAL public.lineup_kickoff_internal(p_season, p_week, b.team, p_at) k   -- 200 / D590
             WHERE b.id = p_player_id AND b.team IS NOT NULL AND k.on_bye)   -- 200 / D590
     AND NOT EXISTS (SELECT 1 FROM public.player_stats ps   -- 200 / D590
                     JOIN public.nfl_games g ON g.season = p_season AND g.week = p_week   -- 200 / D590
                      AND (g.id = ps.game_id OR ps.team IN (g.home_team, g.away_team))   -- 200 / D590
                     WHERE ps.player_id = p_player_id AND ps.season = p_season AND ps.week = p_week   -- 200 / D590
                       AND g.kickoff_at <= p_at AND g.status IS DISTINCT FROM 'postponed'   -- 200 / D590
                       AND g.operator_hold IS DISTINCT FROM 'out_of_week'   -- 200 / D590
                       AND g.operator_hold IS DISTINCT FROM 'cancelled') THEN   -- 200 / D590
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
  '§11.2 / §13.1 (migration 157, L.D2.16 — F447; migration 200, D590): has the player played this league-week by a record other than his current NFL team''s kickoff — a start the league recorded for a real, passed kickoff (lineup_record_kicked_off_internal), or his stat line for the week once its game has kicked off? Returns the kickoff he played in and the arm. Since 200: a player whose NFL team is set and has NO game this week (lineup_kickoff_internal''s bye) and no stat line naming a game of this week that has kicked off (its game id, or 194''s line team) has not played, whatever a stray stat row or a saved kickoff says (Chris 2026-10-18: "Players on a BYE are always droppable."); a real line (a stale stored team, a game played before joining a bye team) keeps both arms, and so does a player with no team.';
