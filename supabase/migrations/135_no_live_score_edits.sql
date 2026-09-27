-- ============================================================================
-- Q61, AS RULED: no score / result override while a matchup's starters are
-- still playing — migration 135 (task L.E1.18 of M6A; tasks-M6A §6's
-- 2026-09-27 amendment; PROGRESS §3 Q61 (RULED 2026-09-27, both answers),
-- **F378**, D371(4), R1092, D372; spec v2.16.42 §10.1 *Matchups & results*,
-- §15.4's v2.16.42 ruling note, §22.2; E42 / E43; §23.2 / §23.3.)
--
-- THE RULING (Chris, 2026-09-27, in chat): *"commissioners should not be
-- editing scores live."* Second answer, same day, PER MATCHUP: *"once scores
-- are final they can be edited, but they cannot be edited with players who
-- have not finished yet."* So `commish_edit_score` / `commish_set_result`
-- refuse BY NAME until EVERY STARTER ON BOTH TEAMS has finished his NFL game.
-- A ruled VALIDITY rule — not a timing defect under PROGRESS §3's standing
-- rule (a)/(i), and not a `bypassed[]` receipt line.
--
-- ---------------------------------------------------------------------------
-- THE MEASUREMENT THIS IS BUILT ON (the task's first step — "measure first,
-- build on what is measured")
-- ---------------------------------------------------------------------------
-- `nfl_games.status` (001:92) is `TEXT DEFAULT 'scheduled'`, NO CHECK. What
-- is actually WRITTEN to it:
--   * THE PRODUCTION WRITER is `ingestWeek` (`src/lib/sync/ingest-week.ts`,
--     `toGameRow` → the `nfl_games` upsert), driven by the `sync-live` cron
--     (`src/app/api/cron/sync-live/route.ts`) and the nflverse back-fill
--     (`scripts/sync-nflverse.ts`). Its row type is `ProviderGame['status']`
--     (`src/lib/leagues/stats/stats-provider.ts`): exactly
--     `'scheduled' | 'live' | 'final' | 'postponed'`. Nothing else is ever
--     written by the app; the dev scripts (`scripts/dev-drive-inseason-
--     week.ts`) write only `scheduled` / `live` / `final`.
--   * WHERE `final` COMES FROM: Sleeper's `complete` / `completed` /
--     `post_game` (`mapSleeperGameStatus`; unknown strings map to
--     `scheduled`, the conservative reading — a SUSPENDED game can never read
--     finished), and nflverse's posted result (`mapNflverseGameStatus`: a
--     result or both scores ⇒ `final`, else `scheduled`). The production
--     composite merges them with `final` outranking `live` / `scheduled`
--     (`mergeGameStatus`), so a game once seen final stays final.
--   * `final` IS THE SIGNAL THE LEAGUE ALREADY TRUSTS: `nfl_weeks.
--     last_game_ends_at` is stamped only when every in-week game reads
--     `final` (`weekBounds`), and `finalize_matchups` advances a week only
--     when every non-postponed game is `final` (116's
--     `week_games_state_internal`, §23.2). A week whose games never all
--     reach it is ALERTED hourly by name (reconcile.ts, F238). This verb
--     reads the same value per game.
--   * POSTPONED (E43): ingestion writes `status = 'postponed'` and moves the
--     kickoff beyond the week, keeping the row at (season, week) (116:84-87;
--     season-runner.ts's measured F289 note). A game has LEFT the week only
--     when it is `postponed` AND its kickoff is at/after the next calendar
--     week's `nfl_weeks.starts_at` — 116:340's `left_week` predicate (R791),
--     re-used here in meaning so this verb and finalization can never
--     disagree about which games belong to a week. A left-the-week game is
--     NO game (like a bye — E43: "finalization proceeds without the
--     postponed game"). NOTE: 112's per-player kickoff map has NO status
--     filter (112:413-417), so it still RETURNS such a game (with its moved
--     kickoff) — the task text's "absent from 112's map" is not how the row
--     is stored; the E43 reading is applied through 116's predicate instead
--     (PROGRESS D372(2)).
--   * WITHIN-WEEK RESCHEDULE (E42): a moved kickoff inside the week is an
--     ordinary unfinished game (`scheduled`, or `postponed` with an in-week
--     kickoff — R791's "OPEN game"). It holds the matchup until `final`.
--   * CANCELLED / NO-CONTEST / SUSPENDED: **NO SUCH VALUE IS EVER WRITTEN**
--     (measured — the provider type has none; Sleeper's unknown strings
--     collapse to `scheduled`). A cancelled game therefore reads `scheduled`
--     and holds the matchup exactly as it holds the week — PROGRESS **Q37 /
--     F243**, open, inherited unchanged: its operator escape (write the row
--     `postponed` with a kickoff past the next week's start) makes this
--     helper read it as no game too, by the same predicate. Not a STOP: the
--     task's stop condition is a MEASURED cancelled value, and there is none.
--
-- ---------------------------------------------------------------------------
-- THE RULE AS BUILT (one helper, §1 — the verb's refusal and the panel's read
-- both call it, so they cannot disagree)
-- ---------------------------------------------------------------------------
--   * PRECEDENCE: a `final` league week is ALWAYS editable — final wins over
--     every per-starter reading (R1092). A `correction_window` week follows
--     the per-starter rule (normally every game is final by then).
--   * STARTERS: every non-empty string value of each side's stored
--     `team_lineups.slot_map` for (season, week) at the call instant whose
--     slot-key prefix is NOT an IR spot key (`roster_settings.ir_slots[].key`)
--     — the scoring worker's own reading (`startersOf` / `irKeysOf`,
--     score-week-worker.ts). Bench players are not in the map and never
--     count.
--   * A SIDE WITH NO LINEUP ROW (R1097, PR #313 fix round): outside a FINAL
--     week, a side with NO `team_lineups` row for (season, week) is NOT
--     finished — `why = 'lineup_not_set'`, refused, the team named. A week's
--     lineup rows are written when it opens (D293's auto-carry, 116's
--     `lineup_carry_internal`) — or earlier, when a manager pre-sets one
--     (corrected by L.E1.25 / R1101: this line said rows ONLY appear once a
--     week opens) — so reading a missing row as "no starters"
--     made every UPCOMING week's matchup editable before any game and let
--     the override freeze its live scoring for the week. This mirrors the
--     scoring worker's own posture — a team with no lineup row holds the
--     week BY NAME (`score-week-worker.ts`, F241(b)); it is never "nothing to
--     wait for". An EXISTING row whose slots are all empty is different: it
--     is a set lineup with no starters, and stays `no_starter_game` as ruled.
--     [CORRECTED by L.E1.25 / R1101 — comment only: such a row is usually the
--     CARRY's own empty row for a team that never set a lineup, not a lineup
--     anybody chose; and since migration 142 (Q67, ruled 2026-09-27) it is
--     NOT finished outside a final week — `no_starter_game` now REFUSES.]
--     A missing row takes precedence over unfinished starters in `why`; the
--     sentence names both when both hold.
--   * A STARTER'S GAME: the `nfl_games` rows of (season, week) whose home or
--     away club is his `players.team` (112's join), MINUS any that has left
--     the week (above). NO such row (a bye, a postponed-out game, a NULL
--     team) ⇒ no game ⇒ he does NOT hold the matchup open. EVERY such row
--     `final` ⇒ finished. Otherwise (`scheduled`, `live`, an in-week
--     `postponed`, a NULL status) ⇒ NOT finished.
--   * A WEEK WITH ZERO `nfl_games` ROWS: every starter is NOT finished. That
--     is 112's own reading (a week with no rows is not a bye — every player
--     falls back to the week datum, 112:396-405) and §23.2's (zero rows is
--     the emptiest partial data). Loud, never "nothing to wait for".
--   * A matchup whose starters ALL have no game (every one on bye / an empty
--     stored lineup) is EDITABLE AT ONCE — there is nothing to
--     finish (a MISSING lineup row is not this case — above). [SUPERSEDED by
--     migration 142 (L.E1.25, Q67 RULED): outside a final week a side whose
--     row holds no starter with a game is NOT finished — refused by name.] The document says which (`why = 'no_starter_game'`), so a
--     vacuous "editable" is never mistaken for "every game is final".
--   * A BYE ROW (`away_team_id IS NULL`) is judged on its one side.
--   * The refusal (P0001) names every unfinished starter, in plain words:
--     "This matchup can be corrected once every starter's game has finished
--     — not finished yet: <name> (<club>), …" — F368's lesson, no migration
--     line cites in copy that reaches a screen. Ordered by that game's
--     kickoff, then name, then player id. A side with no lineup row is named
--     by its team ("— no lineup set yet: <team>", home first), and when both
--     hold the two clauses are joined: "— no lineup set yet: <team>; not
--     finished yet: <name> (<club>)".
--
-- WHAT THIS MIGRATION DOES
--   1. `commish_matchup_edit_lock_internal(league, matchup)` — NEW. The
--      whole rule above, as ONE STABLE SQL function: PLAIN, search_path='',
--      triple-REVOKEd (126 §3b's chooser posture, reading tables instead of
--      arguments so the verb and the read share one evaluation). pgTAP drives
--      it directly.
--   2. `commish_matchup_edit_lock(league, matchup)` — NEW SECURITY DEFINER
--      READ door for the panel (task item (4): "one server read — never a
--      client-side re-derivation of the rule"). In-body commissioner gate,
--      the one no-leak 42501; a foreign matchup is P0002 (a read, so 404).
--      It takes NO lock: it is ADVISORY — the verb re-decides under the
--      league lock in the same transaction as its write, so a read that goes
--      stale between the panel and the submit is caught by the refusal.
--   3. `commish_matchup_override_internal` — `CREATE OR REPLACE` against the
--      NEWEST definer's FILE TEXT, **131:911-1322** (126 is superseded;
--      D137). **HUNK COUNT: 3** (`diff -u` → three `@@`): (i) one DECLARE
--      line (`v_edit_lock`); (ii) the NEW step (4b) refusal block, placed
--      AFTER the replay read (3) and AFTER the row/week reads (4) — 131's
--      order kept — and before anything is written; (iii) the `Q61 SWAP
--      LINE` comment block REWRITTEN as the ruled note (the assignment
--      `v_set_over := TRUE;` is byte-untouched). Pre-135 `md5(prosrc)` on
--      the local chain 001-134: `e3c2e1b0c73490f89e44507373fdd575` (20450
--      chars). Every other line is 131's, including step (10)'s freeze
--      comment, which still narrates the pre-ruling recommendation — the
--      ruled note at the flag supersedes it (left untouched to keep the hunk
--      count to the three the change needs).
--   `commish_override_freeze_internal` (126:544-583, the NEWEST and only
--   definer) is re-read ARM BY ARM against the states the ruling leaves
--   reachable and is **BYTE-UNTOUCHED** (pre-135 md5
--   `9b45a479c5a2b5718973778f2c297e68`): `frozen_by_this_override` /
--   `already_frozen` (a live or correction-window week whose starters have
--   all finished — the Sunday-night window — where "will skip this matchup
--   for the rest of the week" is TRUE), `matchup_already_final` and
--   `week_final` (unchanged) are all still true where reached; the
--   `not_frozen` arm was already unreachable from the verb (`v_set_over` is
--   the literal TRUE) and stays so — its copy is not false, only unreachable,
--   and pgTAP 083 pins the literal. The two DEFINER doors
--   (`commish_edit_score` / `commish_set_result`, 126:1030-1071) are
--   untouched: they delegate to the internal.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): additive — two new functions, one
-- `CREATE OR REPLACE` with a stated three-hunk diff. No table, no column, no
-- policy, no signature changed (typegen gains the read door's Functions
-- entry only; the alias block is re-appended byte-identical). SECURITY
-- DEFINER + search_path='' + in-body auth + REVOKE on the door (§4.1); the
-- internal is PLAIN + triple-REVOKEd. No `HELD-FROM-PRODUCTION.txt` entry
-- (the hold is over, PR #282). **PUSH DEBT after merge: 135** (production
-- is at 134, pushed 2026-09-23 — Chris's `npx supabase db push`). Until it
-- is pushed, production still ACCEPTS a live-week score edit (F378's state).
-- WAIVERS: none. R6 / D38 not engaged (nothing backfilled, no CHECK
-- tightened, no data rewritten).
--
-- EDITED IN PLACE (PR #313's fix round, R1097, 2026-09-27): 135 had NOT been
-- pushed to production when the review found the missing-lineup-row hole, so
-- the fix lands in this file rather than as a 136 — house precedent: 129 was
-- edited in place while unpushed. Only §1 (the helper) and this banner
-- changed; §2 (the read door) and §3 (the internal's three hunks against
-- 131:911-1322) are byte-identical to the reviewed text.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commish_matchup_edit_lock_internal — Q61's per-matchup rule, ONE place
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_matchup_edit_lock_internal(
  p_league_id  UUID,
  p_matchup_id UUID
) RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH m AS (
    SELECT mm.season, mm.week, mm.home_team_id, mm.away_team_id
    FROM public.matchups mm
    WHERE mm.id = p_matchup_id AND mm.league_id = p_league_id
  ),
  lw AS (
    SELECT lw.status
    FROM public.league_weeks lw
    JOIN m ON lw.league_id = p_league_id AND lw.season = m.season AND lw.week = m.week
  ),
  -- The IR spot keys (§7.3.2 `ir_slots[].key`) — a value under one is NOT a
  -- starter (score-week-worker.ts `irKeysOf` / `startersOf`).
  ir AS (
    SELECT s ->> 'key' AS key
    FROM public.leagues l
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.roster_settings -> 'ir_slots', '[]'::jsonb)) s
    WHERE l.id = p_league_id AND (s ->> 'key') IS NOT NULL
  ),
  sides AS (
    SELECT m.home_team_id AS team_id, 'home'::text AS side FROM m
    UNION ALL
    SELECT m.away_team_id, 'away'::text FROM m WHERE m.away_team_id IS NOT NULL
  ),
  -- R1097: a side with NO stored lineup row for the week. Outside a FINAL
  -- week it is NOT finished (`lineup_not_set`) — never "no starters".
  no_lineup AS (
    SELECT s.team_id, s.side, COALESCE(t.name, s.team_id::text) AS team_name
    FROM sides s
    CROSS JOIN m
    LEFT JOIN public.teams t ON t.id = s.team_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.team_lineups tl
      WHERE tl.team_id = s.team_id AND tl.season = m.season AND tl.week = m.week)
  ),
  starters AS (
    SELECT s.team_id, s.side, e.key AS slot, e.value #>> '{}' AS player_id
    FROM sides s
    CROSS JOIN m
    JOIN public.team_lineups tl
      ON tl.team_id = s.team_id AND tl.season = m.season AND tl.week = m.week
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(tl.slot_map) = 'object' THEN tl.slot_map ELSE '{}'::jsonb END) e
    WHERE jsonb_typeof(e.value) = 'string'
      AND (e.value #>> '{}') <> ''
      AND NOT EXISTS (SELECT 1 FROM ir WHERE ir.key = split_part(e.key, ':', 1))
  ),
  -- E43: a game has LEFT the week only when it is `postponed` AND its kickoff
  -- lies at/after the next calendar week's start — 116:340's predicate.
  bound AS (
    SELECT min(w.starts_at) AS next_starts_at
    FROM public.nfl_weeks w
    CROSS JOIN m
    WHERE w.season = m.season AND w.week > m.week
  ),
  week_rows AS (
    SELECT count(g.id)::int AS n
    FROM m
    LEFT JOIN public.nfl_games g ON g.season = m.season AND g.week = m.week
  ),
  judged AS (
    SELECT st.team_id, st.side, st.slot, st.player_id,
           COALESCE(p.full_name, st.player_id) AS name,
           p.team AS nfl_team,
           gm.games,
           gm.open_games,
           gm.open_kickoff,
           gm.open_status,
           wr.n AS week_rows
    FROM starters st
    CROSS JOIN m
    CROSS JOIN bound b
    CROSS JOIN week_rows wr
    LEFT JOIN public.players p ON p.id = st.player_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS games,
             count(*) FILTER (WHERE g.status IS DISTINCT FROM 'final')::int AS open_games,
             min(g.kickoff_at) FILTER (WHERE g.status IS DISTINCT FROM 'final') AS open_kickoff,
             (array_agg(COALESCE(g.status, 'null') ORDER BY g.kickoff_at, g.id)
                FILTER (WHERE g.status IS DISTINCT FROM 'final'))[1] AS open_status
      FROM public.nfl_games g
      WHERE g.season = m.season AND g.week = m.week
        AND p.team IS NOT NULL
        AND (g.home_team = p.team OR g.away_team = p.team)
        AND NOT (g.status IS NOT DISTINCT FROM 'postponed'
                 AND b.next_starts_at IS NOT NULL
                 AND g.kickoff_at >= b.next_starts_at)
    ) gm ON TRUE
  ),
  unfinished AS (
    SELECT j.*,
           CASE WHEN j.week_rows = 0 THEN 'no_game_rows' ELSE j.open_status END AS game_status
    FROM judged j
    WHERE j.week_rows = 0 OR j.open_games > 0
  ),
  verdict AS (
    SELECT
      (SELECT lw.status FROM lw) AS week_status,
      (SELECT count(*)::int FROM judged) AS starters,
      (SELECT count(*)::int FROM judged j WHERE j.week_rows > 0 AND j.games > 0 AND j.open_games = 0) AS finished,
      (SELECT count(*)::int FROM unfinished) AS not_finished,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'team_id',     u.team_id,
                'side',        u.side,
                'slot',        u.slot,
                'player_id',   u.player_id,
                'name',        u.name,
                'nfl_team',    u.nfl_team,
                'game_status', u.game_status,
                'kickoff_at',  u.open_kickoff)
              ORDER BY u.open_kickoff NULLS LAST, u.name, u.player_id), '[]'::jsonb)
         FROM unfinished u) AS still_playing,
      (SELECT string_agg(u.name || ' (' || COALESCE(u.nfl_team, 'no team') || ')', ', '
                ORDER BY u.open_kickoff NULLS LAST, u.name, u.player_id)
         FROM unfinished u) AS names,
      (SELECT count(*)::int FROM no_lineup) AS lineups_missing,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'team_id',   nl.team_id,
                'side',      nl.side,
                'team_name', nl.team_name)
              ORDER BY nl.side = 'away', nl.team_id), '[]'::jsonb)
         FROM no_lineup nl) AS no_lineup,
      (SELECT string_agg(nl.team_name, ', ' ORDER BY nl.side = 'away', nl.team_id)
         FROM no_lineup nl) AS no_lineup_names
  )
  SELECT CASE
    -- PRECEDENCE (R1092): a FINAL week is always editable.
    WHEN v.week_status = 'final' THEN jsonb_build_object(
      'editable', TRUE, 'why', 'week_final', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', 0,
      'still_playing', '[]'::jsonb, 'no_lineup', '[]'::jsonb, 'message', NULL)
    -- R1097: a side with NO lineup row is NOT finished (never "no starters").
    WHEN v.lineups_missing > 0 THEN jsonb_build_object(
      'editable', FALSE, 'why', 'lineup_not_set', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', v.not_finished,
      'still_playing', v.still_playing, 'no_lineup', v.no_lineup,
      'message', 'This matchup can be corrected once every starter''s game has finished — '
                 || concat_ws('; ', 'no lineup set yet: ' || v.no_lineup_names,
                                    'not finished yet: ' || v.names))
    WHEN v.not_finished > 0 THEN jsonb_build_object(
      'editable', FALSE, 'why', 'starters_not_finished', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', v.not_finished,
      'still_playing', v.still_playing, 'no_lineup', '[]'::jsonb,
      'message', 'This matchup can be corrected once every starter''s game has finished — not finished yet: ' || v.names)
    WHEN v.finished > 0 THEN jsonb_build_object(
      'editable', TRUE, 'why', 'every_starter_finished', 'week_status', v.week_status,
      'starters', v.starters, 'finished', v.finished, 'not_finished', 0,
      'still_playing', '[]'::jsonb, 'no_lineup', '[]'::jsonb, 'message', NULL)
    ELSE jsonb_build_object(
      'editable', TRUE, 'why', 'no_starter_game', 'week_status', v.week_status,
      'starters', v.starters, 'finished', 0, 'not_finished', 0,
      'still_playing', '[]'::jsonb, 'no_lineup', '[]'::jsonb, 'message', NULL)
  END
  FROM verdict v;
$$;
REVOKE EXECUTE ON FUNCTION commish_matchup_edit_lock_internal(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commish_matchup_edit_lock — the panel's ONE server read (advisory; the
--    verb re-decides under the league lock). SECURITY DEFINER because the
--    rule reads other teams' lineups and the internal is REVOKEd.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_matchup_edit_lock(
  p_league_id  UUID,
  p_matchup_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_found  BOOLEAN;
  v_season INTEGER;
  v_week   INTEGER;
BEGIN
  PERFORM 1 FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL;
  v_found := FOUND;
  -- The verb family's ONE no-leak 42501 ("no such league" and "not a
  -- commissioner" alike — D336 part 5), co-commissioners included.
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_matchup_edit_lock: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  SELECT m.season, m.week INTO v_season, v_week
  FROM public.matchups m
  WHERE m.id = p_matchup_id AND m.league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commish_matchup_edit_lock: matchup % is not a matchup of league %', p_matchup_id, p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
           'league_id',  p_league_id,
           'matchup_id', p_matchup_id,
           'season',     v_season,
           'week',       v_week)
         || public.commish_matchup_edit_lock_internal(p_league_id, p_matchup_id);
END;
$$;
-- The DEFINER read is a client door: `authenticated` keeps EXECUTE, the
-- in-body commissioner gate is the authorization (126:1048-1051's posture).
REVOKE EXECUTE ON FUNCTION commish_matchup_edit_lock(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION commish_matchup_edit_lock(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. commish_matchup_override_internal — CREATE OR REPLACE against
--    131:911-1322's FILE TEXT (D137). THREE hunks: the DECLARE line, step
--    (4b)'s refusal, and the ruled note that replaces the `Q61 SWAP LINE`
--    comment. Everything else is 131's, byte for byte.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_matchup_override_internal(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_home       NUMERIC,
  p_away       NUMERIC,
  p_winner     UUID,
  p_action_id  UUID,
  p_at         TIMESTAMPTZ,
  p_reason     TEXT,
  p_verb       TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_found        BOOLEAN;
  v_row          public.matchups;
  v_lw           public.league_weeks;
  v_result       JSONB;
  v_reason       TEXT;
  v_score_arm    BOOLEAN;
  v_result_arm   BOOLEAN;
  v_action_type  TEXT;
  v_new_home     NUMERIC;
  v_new_away     NUMERIC;
  v_new_result   TEXT;
  v_set_over     BOOLEAN;
  v_no_changes   BOOLEAN;
  v_audit_id     UUID;
  v_before       JSONB;
  v_after        JSONB;
  v_bypassed     JSONB := '[]'::jsonb;
  v_affected     JSONB := '[]'::jsonb;
  v_current      INTEGER;
  v_week_final   BOOLEAN;
  v_edit_lock    JSONB;          -- 135 / L.E1.18: Q61's per-matchup rule, from ONE helper
  v_rebuild      JSONB;
  v_rebuilt      BOOLEAN := FALSE;
  v_not_why      TEXT;
  v_freeze       JSONB;
  v_frozen       BOOLEAN;
  v_frozen_why   TEXT;
  v_message      TEXT;
  v_home_name    TEXT;
  v_away_name    TEXT;
  v_cnt          INTEGER;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      '%: p_action_id is required (idempotency key — one UUID per submit, reused on retry)', p_verb
      USING ERRCODE = '22023';
  END IF;
  IF p_verb IS NULL OR p_verb NOT IN ('commish_edit_score', 'commish_set_result') THEN
    RAISE EXCEPTION
      'commish_matchup_override_internal: p_verb must be commish_edit_score or commish_set_result (got %) — the internal is not a client door', COALESCE(p_verb, 'null')
      USING ERRCODE = '22023';
  END IF;
  v_action_type := CASE p_verb WHEN 'commish_edit_score' THEN 'edit_score' ELSE 'set_result' END;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — COMMISSIONER ONLY, in-body, as ONE no-leak 42501 covering
  --     "no such league" and "not a commissioner" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION '%: not a commissioner of this league', p_verb
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), placed AFTER auth but BEFORE every business gate
  --     (123:602-609's placement), so a retry replays byte-identically even
  --     when the league or the week has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_matchup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      '%: league % is % — a matchup score has no meaning outside a season (§11.2)', p_verb, p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- (4) THE ROW. Locked after the league (rule 8), read as the source of
  --     truth for every dimension this verb can change.
  SELECT m.* INTO v_row
  FROM public.matchups m
  WHERE m.id = p_matchup_id
  FOR UPDATE;
  IF NOT FOUND OR v_row.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION '%: matchup % is not a matchup of league %', p_verb, p_matchup_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_row.season AND lw.week = v_row.week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      '%: matchup % is season % week %, which is not on league %''s calendar (§12.17)', p_verb, p_matchup_id, v_row.season, v_row.week, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_week_final := (v_lw.status = 'final');

  -- (4b) Q61, RULED (Chris 2026-09-27; spec v2.16.42 §10.1 / §15.4 / §22.2;
  --      migration 135 / L.E1.18, F378): "commissioners should not be
  --      editing scores live." A matchup's score or result may be corrected
  --      only once EVERY STARTER ON BOTH TEAMS HAS FINISHED HIS NFL GAME; a
  --      FINAL week is always editable. The whole rule lives in ONE helper
  --      (`commish_matchup_edit_lock_internal`, 135 §1) so this refusal and
  --      the panel's read (`commish_matchup_edit_lock`, 135 §2) cannot
  --      disagree. A ruled VALIDITY rule, not a timing gate — standing rule
  --      (a)/(i) does not lift it and it is NOT a `bypassed[]` line.
  --      PLACED after the replay read (3) — a retry of an action that landed
  --      replays byte-identically whatever the games have done since — and
  --      after the row and week reads (4), before anything is written: a
  --      refusal leaves no receipt, no post, no ledger row.
  v_edit_lock := public.commish_matchup_edit_lock_internal(p_league_id, p_matchup_id);
  IF NOT (v_edit_lock ->> 'editable')::boolean THEN
    RAISE EXCEPTION '%: %', p_verb, v_edit_lock ->> 'message'
      USING ERRCODE = 'P0001';
  END IF;

  -- (5) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
  --     spec v2.16.41 §10.3 / §15.4): NORMALISED, never refused. Absent or
  --     whitespace-only in the explicit E' \t\r\n' class (R745) ⇒ NULL
  --     (130 §0 stores it); otherwise trimmed, bounded at 500 below (the
  --     league_chat bound and the commissioner_actions CHECK). The 500
  --     check is NULL-safe as written.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      '%: the reason is % characters — at most 500 (the league_chat bound; §12.13)', p_verb, char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (6) THE ARMS (D341). Neither supplied is refused BY NAME — a submit that
  --     names nothing to change is a malformed call, not a no-op, and
  --     returning `no_changes: true` for it would be a success document for a
  --     request that never said what it wanted.
  v_score_arm  := (p_home IS NOT NULL OR p_away IS NOT NULL);
  v_result_arm := (p_winner IS NOT NULL);
  IF NOT v_score_arm AND NOT v_result_arm THEN
    RAISE EXCEPTION
      '%: neither arm supplied — give the SCORE arm (p_home AND p_away, §15.4:1692) or the RESULT arm (p_winner, §15.4:1693); an override that names no new value is not an override',
      p_verb
      USING ERRCODE = '22023';
  END IF;

  IF v_row.away_team_id IS NULL THEN
    -- A BYE ROW (D341). `matchup_result_internal` returns NULL for a bye
    -- (117:211) and every derive maps a NULL away side to `bye` before
    -- consulting `result` at all — so a result here writes a column nothing
    -- reads: a no-op wearing a success's clothes. Refused BY NAME.
    IF v_result_arm THEN
      RAISE EXCEPTION
        '%: matchup % is a BYE (no away team) — a bye has no winner and `result` is not read for it (§11.7; matchup_result_internal returns NULL for a NULL away side). Correct the team''s points with the score arm instead',
        p_verb, p_matchup_id
        USING ERRCODE = 'P0001';
    END IF;
    IF p_away IS NOT NULL THEN
      RAISE EXCEPTION
        '%: matchup % is a BYE — there is no away side to score; send p_away as null', p_verb, p_matchup_id
        USING ERRCODE = '22023';
    END IF;
  ELSE
    -- ROW GRANULARITY (D342 / §22.2's v2.16.39 erratum): `is_overridden` is
    -- one boolean on the ROW and all seven readers are row-scoped, so
    -- correcting one team's number means restating the other's. One score
    -- alone is refused BY NAME rather than silently carrying the stale half.
    IF v_score_arm AND (p_home IS NULL OR p_away IS NULL) THEN
      RAISE EXCEPTION
        '%: the score arm takes BOTH scores — `is_overridden` is one flag on the whole ROW (§22.2, D342), so half a correction would freeze the other team''s stale number in place. Send p_home and p_away together',
        p_verb
        USING ERRCODE = '22023';
    END IF;
    IF v_result_arm AND p_winner IS DISTINCT FROM v_row.home_team_id
                    AND p_winner IS DISTINCT FROM v_row.away_team_id THEN
      RAISE EXCEPTION
        '%: team % is not a side of matchup % (home %, away %). To record a TIE, use the score arm (commish_edit_score) with equal scores — a winner id cannot express one (§15.4:1693; F351)',
        p_verb, p_winner, p_matchup_id, v_row.home_team_id, v_row.away_team_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- (7) THE NEW VALUES. The score arm derives `result` through the SAME
  --     helper the rebuild's drift check uses (117:201) — which is what makes
  --     the single statement below satisfy `result_drift` by construction
  --     rather than by luck (F245). The result arm leaves the scores alone,
  --     which is the whole point of a result override: the number stands and
  --     the outcome is restated.
  v_new_home := CASE WHEN v_score_arm THEN p_home ELSE v_row.home_score END;
  v_new_away := CASE WHEN v_score_arm AND v_row.away_team_id IS NOT NULL THEN p_away
                     ELSE v_row.away_score END;
  v_new_result := CASE
    WHEN v_result_arm THEN CASE WHEN p_winner = v_row.home_team_id THEN 'home' ELSE 'away' END
    ELSE public.matchup_result_internal(v_new_home, v_new_away, v_row.away_team_id)
  END;

  -- ── Q61, RULED — THE FLAG (formerly the `Q61 SWAP LINE`) ─────────────────
  -- RETIRED AS A SWAP by Chris's ruling (2026-09-27; migration 135 /
  -- L.E1.18): the question this block carried — freeze a LIVE matchup, or
  -- let the next drain overwrite the commissioner — is MOOT, because step
  -- (4b) refuses every edit while any starter on either side has not
  -- finished. The flag is still set on every landed edit, and it is
  -- LOAD-BEARING in exactly one live-week window: a matchup whose starters
  -- all finished on Sunday while Monday's game is still being scored stays
  -- in `score_write_week_batch`'s reach (it is keyed by the league-week, not
  -- the matchup), and the flag is what keeps that drain — and later, stat
  -- corrections (§22.2) — from overwriting the commissioner's number. There
  -- is no other ruling to swap to; `v_week_final` here would re-open exactly
  -- that overwrite. The chooser's `not_frozen` arm (§3b, 126) is therefore
  -- UNREACHABLE from this verb; pgTAP 083 pins this literal as the only
  -- assignment.
  v_set_over := TRUE;
  -- ──────────────────────────────────────────────────────────────────────────

  -- (8) THE NO-OP, DETECTED BY VALUE across EVERY dimension this verb can
  --     change (D336 part 3, §4 rule 15) — never inferred from an empty
  --     write. Scalar `IS NOT DISTINCT FROM` is the scalar analogue of
  --     123:1013-1018's jsonb equality, and on NUMERIC it is scale-blind
  --     exactly as the write door's own comparison is (119:653-654): 100.00
  --     over a stored 100 changes nothing a member can see, so it is a no-op.
  --     `is_overridden` is IN the comparison and must stay in it — on a
  --     not-yet-overridden row, setting the flag alone is a real change (it
  --     freezes the cell out of live scoring), and a comparison over the
  --     scores alone would report that as `no_changes` and write no receipt
  --     for it. `override_action_id` is deliberately NOT a dimension: it is
  --     the RECEIPT of a change, so it moves only when something else does.
  v_no_changes := v_new_home   IS NOT DISTINCT FROM v_row.home_score
              AND v_new_away   IS NOT DISTINCT FROM v_row.away_score
              AND v_new_result IS NOT DISTINCT FROM v_row.result
              AND v_set_over   IS NOT DISTINCT FROM v_row.is_overridden;

  -- (9) WHAT THIS OVERRIDE WALKS PAST, made legible (D336 part 7). Standing
  --     rule (g): the timing rules do not bind a commissioner. None of these
  --     is a refusal — each is a receipt line.
  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NOT NULL AND v_row.week < v_current THEN
    v_bypassed := v_bypassed || to_jsonb('past_week'::text);
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    v_bypassed := v_bypassed || to_jsonb(('closed_week:' || v_lw.status)::text);
  END IF;
  IF v_row.status = 'final' THEN
    v_bypassed := v_bypassed || to_jsonb('final_matchup'::text);
  END IF;

  -- (10) THE FREEZE, NAMED (Q61's recommendation, §4 rule 15). The write door
  --      excludes `m.status <> 'final' AND NOT m.is_overridden` from BOTH its
  --      writable count and its one UPDATE (119:634, 119:654) and names every
  --      row it skipped. So once this row is overridden, live scoring has
  --      STOPPED for it for the rest of the week — a stated consequence here
  --      and in the chat post, never a discovered one.
  --      The copy comes from the PURE chooser at §3b, which takes the Q61
  --      decision as an ARGUMENT. That is what makes the swap line one line in
  --      CORRECTNESS and not only in plumbing: under the other ruling this
  --      call returns the `not_frozen` arm — "the next drain will overwrite
  --      this number" — instead of falling through to a `week_final` that
  --      would be a lie on a live week (R1007). pgTAP 074 §L walks both.
  v_freeze     := public.commish_override_freeze_internal(
                    v_set_over, v_week_final, v_row.status = 'final', v_row.is_overridden);
  v_frozen     := (v_freeze ->> 'frozen')::boolean;
  v_frozen_why := v_freeze ->> 'why';

  v_affected := CASE WHEN v_row.away_team_id IS NULL
    THEN jsonb_build_array(v_row.home_team_id)
    ELSE jsonb_build_array(v_row.home_team_id, v_row.away_team_id) END;

  SELECT t.name INTO v_home_name FROM public.teams t WHERE t.id = v_row.home_team_id;
  IF v_row.away_team_id IS NOT NULL THEN
    SELECT t.name INTO v_away_name FROM public.teams t WHERE t.id = v_row.away_team_id;
  END IF;

  IF NOT v_no_changes THEN
    v_before := jsonb_build_object(
      'home_score',    v_row.home_score,
      'away_score',    v_row.away_score,
      'result',        v_row.result,
      'is_overridden', v_row.is_overridden);
    v_after := jsonb_build_object(
      'home_score',    v_new_home,
      'away_score',    v_new_away,
      'result',        v_new_result,
      'is_overridden', v_set_over);

    -- (11) THE RECEIPT, FIRST — §12.12's own printed order, and forced twice
    --      over (see THE ORDER OF THE RECEIPT AND THE WRITE in the banner):
    --      the backstop below refuses a flag write with no GUC, and the GUC
    --      is a side effect of THIS call; and `override_action_id` is an FK
    --      to the row this call mints, which D341's single statement needs in
    --      hand. It is INSIDE the no-op guard, which is the half of D336(2)
    --      that carries Chris's one condition.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), v_action_type, 'matchup', p_matchup_id::text, v_reason,
      v_before, v_after,
      jsonb_build_object(
        'week',                      v_row.week,
        'season',                    v_row.season,
        'current_week',              v_current,
        'week_status',               v_lw.status,
        'matchup_status',            v_row.status,
        'round_type',                v_row.round_type,
        'verb',                      p_verb,
        'arm',                       CASE WHEN v_score_arm AND v_result_arm THEN 'score+result'
                                          WHEN v_score_arm THEN 'score' ELSE 'result' END,
        'action_id',                 p_action_id,
        'affected_team_ids',         v_affected,             -- D353
        'home_team_name',            v_home_name,
        'away_team_name',            v_away_name,
        'bypassed',                  v_bypassed,
        'override_action_id_before', v_row.override_action_id,
        'live_scoring_frozen',       v_frozen,
        'live_scoring_frozen_why',   v_frozen_why),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION '%: the audit row was not written — refusing to let the override stand without its receipt (§10.3)', p_verb
        USING ERRCODE = 'P0001';
    END IF;

    -- (12) THE ONE STATEMENT (D341). All five columns together: the scores,
    --      the result THAT GOES WITH THEM (F245 — a score correction that
    --      left `result` behind would make `rebuild_team_week_results` refuse
    --      the whole week for ever, 117:836-839), the flag, and the receipt.
    --      This UPDATE is what the backstop above guards, and it passes only
    --      because the log call two statements up set app.commish_action_id.
    UPDATE public.matchups m
    SET home_score         = v_new_home,
        away_score         = v_new_away,
        result             = v_new_result,
        is_overridden      = v_set_over,
        override_action_id = v_audit_id,
        updated_at         = p_at
    WHERE m.id = p_matchup_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '%: the override wrote % matchup rows for %, expected exactly 1', p_verb, v_cnt, p_matchup_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (13) §10.3: override system messages auto-post to league chat and
    --      CANNOT be disabled. The freeze rides the post (Q61) so the league
    --      reads the consequence where it reads the act.
    v_message := 'Week ' || v_row.week || ' — '
      || COALESCE(v_home_name, 'home') || ' vs ' || COALESCE(v_away_name, 'BYE')
      || ': ' || CASE WHEN v_score_arm THEN 'score set to ' || v_new_home
                        || CASE WHEN v_row.away_team_id IS NULL THEN '' ELSE '–' || v_new_away END
                 ELSE 'result set to ' || COALESCE(v_new_result, 'none') END
      || ' by ' || public.draft_actor_name() || ' (commissioner override)'
      -- The clause comes from the SAME chooser evaluation as
      -- `live_scoring_frozen_why`, so the post and the receipt can never
      -- disagree — and under Q61's other ruling the post NAMES the overwrite
      -- instead of falling silent about it, which was the half of R1007 that
      -- the league, not the commissioner, would have paid for.
      || (v_freeze ->> 'chat_clause')
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

    -- (14) PROPAGATION, AND THE RESULT SAYS WHICH ONE HAPPENED (§4 rule 15).
    --      A FINAL week's standings are derived rows: `league_standings` takes
    --      W/L/T from `team_week_results` (117:1065) and never reads
    --      `matchups`, so without this call the override changes nothing a
    --      member can see. An OPEN week has no derived rows yet —
    --      finalization carries the override forward when it closes
    --      (118:2098-2100's overridden branch), so there is nothing to
    --      rebuild and saying "rebuilt" would be a lie.
    IF v_week_final THEN
      v_rebuild := public.rebuild_team_week_results(p_league_id, v_row.week);
      v_rebuilt := TRUE;
    ELSE
      v_not_why := 'week_' || v_lw.status
        || ' — the standings are derived at finalization, which carries this override forward (118:2098-2100); there are no final rows to rebuild yet';
    END IF;
  ELSE
    v_not_why := 'no_changes — nothing was written, so nothing downstream follows';
  END IF;

  v_result := jsonb_build_object(
    'league_id',                  p_league_id,
    'matchup_id',                 p_matchup_id,
    'season',                     v_row.season,
    'week',                       v_row.week,
    'current_week',               v_current,
    'round_type',                 v_row.round_type,
    'verb',                       p_verb,
    'action_type',                v_action_type,
    'action_id',                  p_action_id,
    'arm',                        CASE WHEN v_score_arm AND v_result_arm THEN 'score+result'
                                       WHEN v_score_arm THEN 'score' ELSE 'result' END,
    'home_team_id',               v_row.home_team_id,
    'away_team_id',               v_row.away_team_id,
    'home_score',                 v_new_home,
    'away_score',                 v_new_away,
    'result',                     v_new_result,
    'is_overridden',              CASE WHEN v_no_changes THEN v_row.is_overridden ELSE v_set_over END,
    'override_action_id',         COALESCE(v_audit_id, v_row.override_action_id),
    'no_changes',                 v_no_changes,
    'commissioner_action_id',     v_audit_id,          -- NULL on a no-op, and that is the point
    'week_status',                v_lw.status,
    'matchup_status',             v_row.status,
    'bypassed',                   v_bypassed,
    'affected_team_ids',          v_affected,          -- D353
    'standings_rebuilt',          v_rebuilt,
    'standings_not_rebuilt_why',  v_not_why,
    'standings_rebuild',          v_rebuild,
    'live_scoring_frozen',        v_frozen,
    'live_scoring_frozen_why',    v_frozen_why,
    'reason',                     v_reason,
    'system_post',                v_message,
    'evaluated_at',               p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (123:1259-1266's
  -- posture): an action_id is consumed by its submit whether or not anything
  -- moved, so a retry replays instead of re-evaluating. This is the OPPOSITE
  -- rule from the audit row above, and deliberately so — §12.26: "an
  -- action_id is an idempotency key, not an audit record".
  INSERT INTO public.commish_matchup_actions (league_id, matchup_id, action_id, actor_id, result)
  VALUES (p_league_id, p_matchup_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- 131 carried no REVOKE for this body (CREATE OR REPLACE keeps 126:1021-1023's
-- ACL); re-stated anyway, harmless.
REVOKE EXECUTE ON FUNCTION commish_matchup_override_internal(
  UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
