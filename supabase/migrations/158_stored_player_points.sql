-- ============================================================================
-- 158_stored_player_points.sql — STORED PER-PLAYER POINTS + THE STANDARD
-- STAT-CORRECTION WINDOW (task L.D3.11, FULL rigour — scoring and standings;
-- PROGRESS F405 as RULED by Chris 2026-09-28: "okay lets stay in line with
-- standard platforms"; F268's post-window part folds in here).
-- Spec §7.3.3 (the scoring snapshot + the stored precision — the per-player
-- points are what the team was scored on, under the WEEK's rules, 144),
-- §7.3.6 (`stat_correction_window` — now the next week's first kickoff),
-- §11.4 (finalization; "a final matchup is only changed via a commissioner
-- override"), §12.12 (audit-log immutability — untouched), §12.20
-- (`nfl_weeks` — one column added), §23.2 / §23.4 (the window; a correction
-- after it lands in player_stats and never in a locked week). PROGRESS D292
-- (the one write door), D295(b) (a final week changes no league cell),
-- D321(7) ("per-player points storage — the schema has none" — now it has),
-- D382 (per-week rules), D346 / D416 (the re-score clauses — unchanged: they
-- queue the worker, which now stores the rows too), Q61 / L.E1.18 (the
-- commissioner may still edit a final score — his audited override is the
-- one sanctioned change to a locked week; it never touches these rows).
--
-- Numbering: reserved by the orchestrator and measured at build time (D161)
-- — `ls supabase/migrations | tail -1` → 157_played_lock.sql, `ls
-- supabase/tests | tail -1` → 105_played_lock.sql; so 158 / pgTAP 106. NOT
-- held: reaches production by `npx supabase db push` only (push debt
-- 135–158; production is at 134).
--
-- THE RULING, IN THREE PARTS (F405):
--   (1) STORE EACH STARTER'S POINTS WHEN A WEEK IS SCORED, so a box score
--       always adds up to its team's score. Research reads `player_stats`,
--       which always carries corrections; the stored per-player points are
--       what the TEAM was scored on.
--   (2) THE STAT-CORRECTION WINDOW RUNS TO THE NEXT WEEK'S FIRST KICKOFF
--       (Yahoo's rule; ESPN runs to Saturday, Sleeper to Thursday). It
--       closed Thursday 06:00 ET.
--   (3) AFTER THAT THE WEEK LOCKS — later corrections update the players'
--       real stats, never a locked week's team scores, results or stored
--       per-player points.
--
-- WHAT THIS MIGRATION DOES
--   §1 `league_week_player_points` — one row per (league, season, week, team,
--      SLOT): the starter, his points at the stored precision (the worker's
--      `roundHalfUp` per player, §7.3.3), the rules keys he is PENDING on
--      (E61), why (`scored` / `no_stat_row` — Q42's 0 by name) and where the
--      row came from (`worker` / `backfill` / `backfill_unrecoverable`).
--      Keyed by SLOT, not player: the team's score is Σ over the starting
--      slots (`startersOf`), so the rows are exactly the terms of that sum.
--      FK (league, season, week) → `league_weeks` ON DELETE CASCADE, team →
--      `teams` ON DELETE CASCADE, player → `players`. RLS: member SELECT
--      (`is_league_member`, the 109 shape — a box score is a member read);
--      NO write policy for any role; writes only through the two DEFINER
--      doors below (service role, JWT refused in-body).
--   §2 THE LOCK — `league_week_player_points_lock()`, BEFORE INSERT / UPDATE
--      / DELETE, ENABLE ALWAYS: a FINAL week's rows never change — not by
--      the doors, not by the service role, not by a hand-typed statement.
--      Two exits, both named: the one-time backfill's INSERT (a
--      transaction-local flag only `score_backfill_player_points` sets, and
--      only for rows that do not exist — "recompute once"), and the cascade
--      when the week / team / league row itself is deleted. An `upcoming`
--      week holds no rows (nothing has been played). The audited reopen
--      (110's `final → correction_window` arm, M6) makes a week open again,
--      and the rows follow it.
--   §3 `player_points_rows_check_internal` — the ONE shape check both doors
--      run: slots unique, points a number at ≤ 2 decimals, `pending` a list
--      of keys, `reason` in the worker's vocabulary, `no_stat_row` scores 0,
--      and THE ROWS ARE THE SCORE — Σ = the team's points exactly, pending ⇔
--      the team is sent pending (NULL). A mismatch is refused (22023), never
--      stored, so a stored box can never disagree with the score it came
--      with.
--   §4 `score_write_week_batch` — REPLACED (D137, below): an element MAY
--      carry `players`; checked (§3), then, for every team whose score this
--      call may write, the team's row set is REPLACED in the SAME
--      transaction as its score. The report gains `player_points`. An
--      element without `players` is 119's behaviour (every pgTAP fixture
--      that sends `{team_id, points}` is unchanged) — except that a score it
--      writes takes that team's old rows with it, so no stale row outlives
--      the score it added up to.
--   §5 `score_backfill_player_points` — the one-time backfill door (the
--      task's (d)): the TS backfill (`npm run backfill:player-points`)
--      recomputes a scored week's per-player points from CURRENT stats
--      under the WEEK's rules and sends them here. The door never writes a
--      score; it compares Σ with what is STORED and decides:
--        open week (live / correction_window), Σ = stored ⇒ stored
--          (`backfill`); Σ ≠ stored ⇒ skipped by name (`open_week_mismatch`
--          — the worker re-scores an open week and its next write stores
--          the rows with the score);
--        final week, Σ = stored ⇒ stored (`backfill`) — RECOVERABLE: the
--          stats have not moved since the week was scored, so these ARE the
--          points it was scored on;
--        final week, Σ ≠ stored ⇒ stored, marked `backfill_unrecoverable` —
--          a correction landed after the week was scored and the old line
--          was overwritten in place (no history exists — F268), so the
--          points it was scored on are NOT recoverable; the rows are the
--          corrected recompute, named as such, and the box / reconcile say
--          so rather than pretend they add up;
--        a team that already has rows (`already_stored` — once), whose only
--          pairing row is overridden (`overridden` — the commissioner's
--          number), or with no stored score (`no_stored_score`) is skipped
--          by name. An upcoming week is refused.
--   §6 THE WINDOW — `nfl_weeks.correction_window_default_ends_at` (the
--      039 seed kept: Thursday 06:00 ET after the week) and two triggers
--      that keep `correction_window_ends_at` = the NEXT week's
--      `first_kickoff_at` when ingestion knows it, else the default:
--        `nfl_weeks_window_follow` (AFTER INSERT / UPDATE OF
--          first_kickoff_at): week N+1's kickoff moves week N's window (a
--          cleared kickoff restores the default — so a suite that stamps and
--          then clears kickoffs leaves the calendar exactly as it found it);
--        `nfl_weeks_window_row` (BEFORE INSERT / UPDATE OF the two window
--          columns): a new row keeps its given window as its default and
--          takes the next week's kickoff if known; a direct write of the
--          window is a new DEFAULT (the operator's / a fixture's instant),
--          still overridden by a known next-week kickoff — the rule wins.
--      Then the ONE-TIME re-derivation: every week whose next week's
--      kickoff is recorded moves to it (named in a NOTICE). The season's
--      last week (18 — no week 19 row) keeps its default.
--
-- WHERE THE WINDOW END IS COMPUTED — MEASURED (the task's "measure where").
-- Nowhere: it is a STORED instant. 039 seeded `nfl_weeks.
-- correction_window_ends_at` as day-math literals (Thursday 06:00 ET after the
-- week) and nothing has written it since (`grep -rn correction_window_ends_at
-- supabase/migrations src scripts` — every hit a READ). The readers, all
-- unchanged by this migration because the column now carries the new rule:
--   finalize_matchups (118:2003-2056 — the claim, the loop, F238's live-past)
--   league_week_advance (118:1861-1873 — F238's "past its window" warning)
--   playoff_bracket_state_internal / league_playoff_bracket (134:1317-1363 —
--     `corrections_close_at`, the bracket read's display instant)
--   reconcile.ts (`post_window_correction`, `game_not_final_late`'s R878
--     escalation, F263(g)'s R877 grace), weekly-projections.ts (season
--     complete), the sim's calendar (its own synthetic literals).
-- 116's `league_week_advance` flips `live → correction_window` at
-- `last_game_ends_at` (unchanged); `finalize_matchups` claims a
-- `correction_window` week once `correction_window_ends_at ≤ p_now` and
-- every game is final (unchanged) — so the window's end moves from Thursday
-- 06:00 ET to the next week's first kickoff with no function replaced. The
-- per-league `stat_correction_window` setting is still read by nothing
-- (116:142, F241) — its label is PROGRESS F475.
--
-- "AFTER THE WINDOW, LOCKED" — THE WHOLE CHAIN, STATED. (a) `finalize_
-- matchups` flips the week `final` at its first hourly run at or after the
-- window's end (at most one hour — the same granularity as the Thursday
-- 06:00 close had; unchanged). (b) The door refuses a final week
-- (`week_final`, 119 — unchanged) and the worker skips it by name
-- (`week_final`, D295(b)); a later correction lands in `player_stats`
-- (research stays right) and changes no league cell. (c) This migration adds
-- the ROWS to what is locked (§2). (d) The commissioner's audited override
-- (`commish_edit_score` / `commish_set_result`, Q61 / L.E1.18) stays the one
-- change to a final week's score; it never writes these rows (the box then
-- shows the stored lines beside the commissioner's number, as it shows his
-- number today).
--
-- D137 — `score_write_week_batch` is derived from its NEWEST (and only)
-- definer's FILE TEXT, 119:453-683 (119 file md5 c2e7d33062626dfdbe1c0caac8ab3c41;
-- prosrc md5 ebacf6a5485b1883781fab7bcd26a19c = the live one), by
-- derive_158.py (PR body — every anchor asserted to hit once, the reversal
-- asserted to reproduce 119 byte for byte): 4 hunks (DECLARE · the shape
-- loop · the per-player write · the report key). pgTAP 106 §A reverses them
-- on the LIVE prosrc and pins 119's md5; pgTAP 074 K1 (the count of `NOT
-- m.is_overridden`) reads the reversed body (pg_temp.un158 — additive, the
-- R992 shape) and 106 pins the new count, 3: the per-player arm's own
-- exclusion is the third.
--
-- DEPLOY BEFORE PUSH (production is at 134; merged code deploys at once).
-- The TS that changes with this migration works against a database WITHOUT
-- it, falling back to today's behaviour on the exact missing-object answer,
-- by name — never silently, never a 500 (PR body, per path):
--   the worker sends `players`; a pre-158 door ignores the key (119 reads
--     only team_id / points) and its report has no `player_points` — the
--     worker names `player_points: not_stored (pre-158 door)` and scores as
--     today;
--   the box score reads the stored rows; PGRST205 / 42P01 naming this table
--     ⇒ the live computation (today's), marked `points_source: 'live'`,
--     `stored_points: 'unavailable'`;
--   reconcile reads the stored rows; the same answer ⇒ one info finding
--     (`player_points_store_missing`) and today's checks;
--   the backfill CLI refuses by name (it has nothing to do before 158).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: one table (+ RLS, one SELECT policy, no write policy, PK, three
--   FKs, one index, four CHECKs), one column on `nfl_weeks` (nullable; the
--   seed copied into it), three trigger functions + three triggers (ENABLE
--   ALWAYS — R616; the lock's is DEFINER so it judges the week as it is for
--   any writer, the two window ones plain), one PLAIN helper (IMMUTABLE,
--   REVOKEd), one new DEFINER door (in-body JWT refusal, search_path '', REVOKEd from PUBLIC / anon /
--   authenticated); one DEFINER body replaced (signature unchanged — ACLs
--   kept; the REVOKE restated). Time: no clock is read for a decision
--   (`updated_at = now()` is a write stamp — 119's own matchups precedent);
--   the window is an instant on the calendar, compared by the jobs against
--   their `p_now`. Lock order: both doors take the LEAGUE row FOR UPDATE
--   before any write (rule 8). Typegen: the table, the column, the two new
--   `Functions` (additive; alias block re-appended). Realtime: none — the
--   box refetches on `scores_updated`, which the matchups write already
--   sends (D38: a trigger ships with its first subscriber). WAIVERS: R6 —
--   no staging clone; rehearsal evidence = the fresh local `db reset`
--   001–158 and the full pgTAP run in the PR. D38 backfill: §6's one-time
--   re-derivation here; the per-player backfill is the TS CLI (§5 — it
--   needs the scoring calculator, which lives in TS, §7.3.3's one
--   implementation).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. league_week_player_points — each starter's points, as stored with the score
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS league_week_player_points (
  league_id  UUID        NOT NULL,
  season     INTEGER     NOT NULL,
  week       INTEGER     NOT NULL,
  team_id    UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot       TEXT        NOT NULL,                 -- the slot_map key ("wr:1") — one term of the team's sum
  player_id  TEXT        NOT NULL REFERENCES players(id),
  points     NUMERIC(8,2) NOT NULL,                -- the worker's per-player roundHalfUp (§7.3.3); 0 for no_stat_row
  pending    TEXT[]      NOT NULL DEFAULT '{}',    -- E61: applicable rules keys not yet delivered (non-empty ⇒ the team is pending)
  reason     TEXT        NOT NULL,                 -- scored | no_stat_row (Q42: 0 by name)
  source     TEXT        NOT NULL,                 -- worker | backfill | backfill_unrecoverable
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season, week, team_id, slot),
  FOREIGN KEY (league_id, season, week) REFERENCES league_weeks(league_id, season, week) ON DELETE CASCADE,
  CONSTRAINT league_week_player_points_reason_check CHECK (reason IN ('scored', 'no_stat_row')),
  CONSTRAINT league_week_player_points_source_check CHECK (source IN ('worker', 'backfill', 'backfill_unrecoverable')),
  CONSTRAINT league_week_player_points_no_line_scores_zero CHECK (reason <> 'no_stat_row' OR (points = 0 AND cardinality(pending) = 0)),
  CONSTRAINT league_week_player_points_slot_nonempty CHECK (btrim(slot) <> '')
);

CREATE INDEX IF NOT EXISTS idx_lwpp_team ON league_week_player_points(team_id);

COMMENT ON TABLE league_week_player_points IS
  'Spec §7.3.3 / §11.4 (v2.16.68 — migration 158, L.D3.11; PROGRESS F405 RULED 2026-09-28): each STARTER''s points as stored WITH the team''s score, one row per starting slot — the terms of the team''s sum under the WEEK''s rules (144). A box score for a scored week (correction_window / final) reads these, so its lines always add up to the stored score. Written only by score_write_week_batch (in the same transaction as the score) and the one-time score_backfill_player_points; a FINAL week''s rows never change (the lock trigger) — later stat corrections update player_stats (research), never these.';
COMMENT ON COLUMN league_week_player_points.source IS
  'worker = written with the score by the scoring door; backfill = recomputed once by the 158 backfill and EQUAL to the stored score (recoverable: the stats had not moved); backfill_unrecoverable = a final week whose stats moved after it was scored (the old line was overwritten — F268), so the rows are the corrected recompute and do NOT add up to the stored score, named as such.';

ALTER TABLE league_week_player_points ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Player points viewable by league members" ON league_week_player_points;
CREATE POLICY "Player points viewable by league members"
  ON league_week_player_points FOR SELECT USING (is_league_member(league_id));
-- No INSERT / UPDATE / DELETE policy for any role: the two DEFINER doors
-- (service role) are the only writers (pgTAP 106 §B — RETURNING counts per role).

-- ---------------------------------------------------------------------------
-- 2. THE LOCK — a final week's stored per-player points never change
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_week_player_points_lock() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER   -- the lock reads the week as it IS, whoever writes (a trigger — never callable directly); RLS stays a client's gate
SET search_path = ''
AS $$
DECLARE
  v_row    public.league_week_player_points;
  v_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    -- The cascade: the league, its week row or the team is being deleted —
    -- the rows go with it (nothing to protect once their week is gone).
    IF NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = OLD.league_id)
       OR NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = OLD.team_id) THEN
      RETURN OLD;
    END IF;
  ELSE
    v_row := NEW;
    IF TG_OP = 'UPDATE'
       AND (NEW.league_id, NEW.season, NEW.week, NEW.team_id) IS DISTINCT FROM (OLD.league_id, OLD.season, OLD.week, OLD.team_id) THEN
      RAISE EXCEPTION 'league_week_player_points: a row never moves to another league, week or team — delete and write it through the door'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT lw.status INTO v_status
  FROM public.league_weeks lw
  WHERE lw.league_id = v_row.league_id AND lw.season = v_row.season AND lw.week = v_row.week;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;   -- the week row's own cascade
    END IF;
    RAISE EXCEPTION 'league_week_player_points: league % has no league_weeks row for season % week %', v_row.league_id, v_row.season, v_row.week
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status = 'upcoming' THEN
    RAISE EXCEPTION 'league_week_player_points: week_not_open — league % week % is upcoming; nothing has been scored', v_row.league_id, v_row.week
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status = 'final' THEN
    -- The one-time backfill (§5) — INSERT only (a row that did not exist:
    -- "recompute once"), only while its door holds the transaction-local flag.
    IF TG_OP = 'INSERT'
       AND NEW.source IN ('backfill', 'backfill_unrecoverable')
       AND current_setting('fieldscout.player_points_backfill', true) = 'on' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'league_week_player_points: week_locked — league % week % is final; its stored per-player points never change (F405: a later stat correction updates player_stats, never a locked week — the commissioner''s audited score override is the one change to a final week, §11.4)', v_row.league_id, v_row.week
      USING ERRCODE = 'P0001';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE EXECUTE ON FUNCTION league_week_player_points_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_league_week_player_points_lock ON league_week_player_points;
CREATE TRIGGER trg_league_week_player_points_lock
  BEFORE INSERT OR UPDATE OR DELETE ON league_week_player_points
  FOR EACH ROW EXECUTE FUNCTION league_week_player_points_lock();
ALTER TABLE league_week_player_points ENABLE ALWAYS TRIGGER trg_league_week_player_points_lock;

-- ---------------------------------------------------------------------------
-- 3. player_points_rows_check_internal — THE ROWS ARE THE SCORE (one check,
--    both doors)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION player_points_rows_check_internal(
  p_who     TEXT,      -- the calling door, for the message
  p_i       INTEGER,   -- the element's position in the batch
  p_team    UUID,
  p_points  JSONB,     -- the element's `points` (a number or null — already checked by the caller)
  p_players JSONB      -- the element's `players`
) RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_x       JSONB;
  v_j       INTEGER := 0;
  v_sum     NUMERIC := 0;
  v_pending BOOLEAN := FALSE;
  v_slots   TEXT[] := '{}';
BEGIN
  IF p_players IS NULL OR jsonb_typeof(p_players) <> 'array' THEN
    RAISE EXCEPTION '%: element % (team %) players must be a JSON array of {slot, player_id, points, pending, reason} (got %)', p_who, p_i, p_team, COALESCE(jsonb_typeof(p_players), 'nothing')
      USING ERRCODE = '22023';
  END IF;
  FOR v_x IN SELECT value FROM jsonb_array_elements(p_players) LOOP
    v_j := v_j + 1;
    IF jsonb_typeof(v_x) <> 'object' THEN
      RAISE EXCEPTION '%: element % (team %) player % is not an object', p_who, p_i, p_team, v_j
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_x -> 'slot') IS DISTINCT FROM 'string' OR btrim(v_x ->> 'slot') = '' THEN
      RAISE EXCEPTION '%: element % (team %) player % has no slot', p_who, p_i, p_team, v_j
        USING ERRCODE = '22023';
    END IF;
    IF (v_x ->> 'slot') = ANY (v_slots) THEN
      RAISE EXCEPTION '%: element % (team %) slot % appears twice', p_who, p_i, p_team, v_x ->> 'slot'
        USING ERRCODE = '22023';
    END IF;
    v_slots := v_slots || (v_x ->> 'slot');
    IF jsonb_typeof(v_x -> 'player_id') IS DISTINCT FROM 'string' OR btrim(v_x ->> 'player_id') = '' THEN
      RAISE EXCEPTION '%: element % (team %) slot % has no player_id', p_who, p_i, p_team, v_x ->> 'slot'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_x -> 'points') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION '%: element % (team %) slot % points must be a JSON number (a pending player carries his points so far and names the keys in pending)', p_who, p_i, p_team, v_x ->> 'slot'
        USING ERRCODE = '22023';
    END IF;
    IF scale((v_x ->> 'points')::numeric) > 2 THEN
      RAISE EXCEPTION '%: element % (team %) slot % points % has more than two decimals — the worker rounds each player (§7.3.3, F22); the door never does', p_who, p_i, p_team, v_x ->> 'slot', v_x ->> 'points'
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_x -> 'pending') IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_x -> 'pending') k WHERE jsonb_typeof(k) <> 'string') THEN
      RAISE EXCEPTION '%: element % (team %) slot % pending must be a JSON array of stat keys', p_who, p_i, p_team, v_x ->> 'slot'
        USING ERRCODE = '22023';
    END IF;
    IF (v_x ->> 'reason') IS NULL OR (v_x ->> 'reason') NOT IN ('scored', 'no_stat_row') THEN
      RAISE EXCEPTION '%: element % (team %) slot % reason must be scored or no_stat_row (got %)', p_who, p_i, p_team, v_x ->> 'slot', COALESCE(v_x ->> 'reason', 'nothing')
        USING ERRCODE = '22023';
    END IF;
    IF (v_x ->> 'reason') = 'no_stat_row'
       AND ((v_x ->> 'points')::numeric <> 0 OR jsonb_array_length(v_x -> 'pending') > 0) THEN
      RAISE EXCEPTION '%: element % (team %) slot % has no stat line, so it scores 0 and is never pending (Q42)', p_who, p_i, p_team, v_x ->> 'slot'
        USING ERRCODE = '22023';
    END IF;
    v_sum := v_sum + (v_x ->> 'points')::numeric;
    IF jsonb_array_length(v_x -> 'pending') > 0 THEN
      v_pending := TRUE;
    END IF;
  END LOOP;

  -- THE ROWS ARE THE SCORE (F405 / §7.3.3: per player rounded, then summed).
  IF jsonb_typeof(p_points) = 'null' AND NOT v_pending THEN
    RAISE EXCEPTION '%: element % (team %) is sent pending (points null) but no player is pending — the stored lines must BE the score (E61)', p_who, p_i, p_team
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_points) = 'number' AND v_pending THEN
    RAISE EXCEPTION '%: element % (team %) carries a number but a player is pending — a pending player makes the team pending (E61)', p_who, p_i, p_team
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_points) = 'number' AND v_sum <> (p_points #>> '{}')::numeric THEN
    RAISE EXCEPTION '%: element % (team %) players add up to % but points is % — the stored lines must add up to the stored score (F405, §7.3.3)', p_who, p_i, p_team, v_sum, p_points #>> '{}'
      USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION player_points_rows_check_internal(TEXT, INTEGER, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. score_write_week_batch — CREATE OR REPLACE against 119's FILE TEXT
--    (D137): derived by derive_158.py, 4 hunks (DECLARE · the optional
--    `players` check in the shape loop · the per-player write after the
--    score write · the report's `player_points` key). Every other byte 119's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION score_write_week_batch(
  p_league_id UUID,
  p_week      INTEGER,
  p_scores    JSONB     -- [{team_id: uuid, points: number|null}, …]; null = pending (E61)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_lw        public.league_weeks;
  v_mode      TEXT;
  v_e         JSONB;
  v_i         INTEGER := 0;
  v_n         INTEGER;
  v_tid       UUID;
  v_team_ids  UUID[] := '{}';
  v_m         RECORD;
  v_skipped   JSONB := '[]'::jsonb;
  v_written   INTEGER := 0;
  v_writable  INTEGER := 0;
  v_cnt       INTEGER;
  v_pp_teams  UUID[] := '{}';   -- 158 (F405): teams whose element carries `players`
  v_pp_write  UUID[] := '{}';   -- 158: …and whose score this call may write (the rows follow the score)
  v_pp_rows   INTEGER := 0;     -- 158: per-player rows inserted or changed
  v_pp_gone   INTEGER := 0;     -- 158: per-player rows removed (a slot no longer started)
BEGIN
  -- The worker's door, never a user verb: a JWT-bearing caller is refused
  -- in-body (rule 2 — the REVOKE below narrows EXECUTE; this says why).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'score_write_week_batch: the scoring write door is the worker''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;

  -- (1) The batch's SHAPE (22023 — a malformed argument, never a state
  --     conflict): an array of {team_id, points}; points a JSON number
  --     with at most two decimals (F22 — the worker rounds, the door
  --     never does) or null (E61 — pending); no duplicate team.
  IF p_league_id IS NULL OR p_week IS NULL OR p_scores IS NULL THEN
    RAISE EXCEPTION 'score_write_week_batch: p_league_id, p_week and p_scores are required'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_scores) <> 'array' THEN
    RAISE EXCEPTION 'score_write_week_batch: p_scores must be a JSON array of {team_id, points} (got %)', jsonb_typeof(p_scores)
      USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_scores);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'score_write_week_batch: p_scores is empty — a batch names at least one team'
      USING ERRCODE = '22023';
  END IF;
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_scores) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'score_write_week_batch: element % is not an object', v_i
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_tid := (v_e ->> 'team_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_tid := NULL;
    END;
    IF v_tid IS NULL THEN
      RAISE EXCEPTION 'score_write_week_batch: element % has no valid team_id', v_i
        USING ERRCODE = '22023';
    END IF;
    IF v_tid = ANY (v_team_ids) THEN
      RAISE EXCEPTION 'score_write_week_batch: team % appears twice in the batch', v_tid
        USING ERRCODE = '22023';
    END IF;
    v_team_ids := v_team_ids || v_tid;
    IF NOT (v_e ? 'points') THEN
      RAISE EXCEPTION 'score_write_week_batch: element % (team %) has no points key — send null for a pending score (E61), never omit it', v_i, v_tid
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_e -> 'points') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'score_write_week_batch: element % (team %) points must be a JSON number or null (got %)', v_i, v_tid, jsonb_typeof(v_e -> 'points')
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_e -> 'points') = 'number' AND scale((v_e ->> 'points')::numeric) > 2 THEN
      RAISE EXCEPTION 'score_write_week_batch: element % (team %) points % has more than two decimals — the worker rounds (F22); the door never does', v_i, v_tid, v_e ->> 'points'
        USING ERRCODE = '22023';
    END IF;
    -- 158 (F405): the OPTIONAL per-player arm — each starter's points,
    -- checked to BE the team's score (Σ = points; pending ⇔ null) before
    -- anything is written. An element without `players` writes no rows.
    IF v_e ? 'players' THEN
      PERFORM public.player_points_rows_check_internal('score_write_week_batch', v_i, v_tid, v_e -> 'points', v_e -> 'players');
      v_pp_teams := v_pp_teams || v_tid;
    END IF;
  END LOOP;

  -- (2) The league row FIRST (rule 8 lock order), in season.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'score_write_week_batch: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION 'score_write_week_batch: league_not_in_season — league % is %, the door writes only an in_season/playoffs league (D292)', p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) Every team is THIS league's (a mapping bug is loud, never a skip).
  SELECT count(*) INTO v_cnt
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.id = ANY (v_team_ids);
  IF v_cnt <> cardinality(v_team_ids) THEN
    RAISE EXCEPTION 'score_write_week_batch: the batch names % team(s) that are not league %''s', cardinality(v_team_ids) - v_cnt, p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- (4) The week: scheduled, not final (D295(b)), open (F241(a)).
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'score_write_week_batch: week_not_scheduled — league % has no league_weeks row for season % week %', p_league_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status = 'final' THEN
    RAISE EXCEPTION 'score_write_week_batch: week_final — league % week % is final; a post-window delta changes no league cell (D295, §23.4)', p_league_id, p_week
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status = 'upcoming' THEN
    RAISE EXCEPTION 'score_write_week_batch: week_not_open — league % week % is upcoming; the door writes only a live or correction_window week', p_league_id, p_week
      USING ERRCODE = 'P0001';
  END IF;

  v_mode := COALESCE(v_league.settings ->> 'schedule_mode', 'h2h');

  IF v_mode = 'total_points' THEN
    -- (5t) No matchups: PROVISIONAL team_week_results rows (is_final FALSE).
    --      NULL points ⇒ no row (absence is this mode's pending word —
    --      F241(b)); a final row is never overwritten (a reopened week —
    --      M6's audited path).
    FOR v_e IN SELECT value FROM jsonb_array_elements(p_scores) LOOP
      IF jsonb_typeof(v_e -> 'points') = 'null' THEN
        v_skipped := v_skipped || jsonb_build_object('team_id', v_e ->> 'team_id', 'reason', 'pending_no_row');
      ELSIF EXISTS (
        SELECT 1 FROM public.team_week_results r
        WHERE r.league_id = p_league_id AND r.team_id = (v_e ->> 'team_id')::uuid
          AND r.season = v_league.season AND r.week = p_week AND r.is_final) THEN
        v_skipped := v_skipped || jsonb_build_object('team_id', v_e ->> 'team_id', 'reason', 'result_final');
      ELSE
        v_writable := v_writable + 1;
      END IF;
    END LOOP;

    INSERT INTO public.team_week_results (league_id, team_id, season, week, points, is_final)
    SELECT p_league_id, (e ->> 'team_id')::uuid, v_league.season, p_week, (e ->> 'points')::numeric, FALSE
    FROM jsonb_array_elements(p_scores) e
    WHERE jsonb_typeof(e -> 'points') = 'number'
    ON CONFLICT (league_id, team_id, season, week) DO UPDATE
    SET points = EXCLUDED.points
    WHERE team_week_results.is_final = FALSE
      AND team_week_results.points IS DISTINCT FROM EXCLUDED.points;
    GET DIAGNOSTICS v_written = ROW_COUNT;
  ELSE
    -- (5h) h2h: the week's pairing rows (regular / secondary / playoff —
    --      every round_type; a team's total lands on each row it sits in).
    FOREACH v_tid IN ARRAY v_team_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.matchups m
        WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
          AND (m.home_team_id = v_tid OR m.away_team_id = v_tid)) THEN
        v_skipped := v_skipped || jsonb_build_object('team_id', v_tid, 'reason', 'no_matchup_row');
      END IF;
    END LOOP;

    -- Protected rows the batch touches: NAMED, never written (§22.2/D292).
    FOR v_m IN
      SELECT m.id, m.round_type, m.status, m.is_overridden
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
        AND (m.home_team_id = ANY (v_team_ids) OR m.away_team_id = ANY (v_team_ids))
        AND (m.status = 'final' OR m.is_overridden)
      ORDER BY m.round_type, m.id
    LOOP
      v_skipped := v_skipped || jsonb_build_object(
        'matchup_id', v_m.id, 'round_type', v_m.round_type,
        'reason', CASE WHEN v_m.is_overridden THEN 'overridden' ELSE 'matchup_final' END);
    END LOOP;

    SELECT count(*) INTO v_writable
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND (m.home_team_id = ANY (v_team_ids) OR m.away_team_id = ANY (v_team_ids))
      AND m.status <> 'final' AND NOT m.is_overridden;

    -- THE ONE WRITE: one UPDATE statement, each writable row touched ONCE
    -- with both cells coalesced; a row whose cells would not change is
    -- left out (numeric equality — scale-blind), so the statement trigger
    -- sees exactly what changed and an identical re-send sends nothing.
    -- Rows are resolved by (league, season, week, SIDE TEAM) inside this
    -- statement — never by an id read earlier (F257(a′)). A cell whose team
    -- is not in the batch keeps its value; a `null` writes NULL (E61).
    WITH b AS (
      SELECT (e ->> 'team_id')::uuid AS team_id, (e ->> 'points')::numeric AS points
      FROM jsonb_array_elements(p_scores) e
    ), s AS (
      SELECT m.id,
             bh.team_id IS NOT NULL AS has_home, bh.points AS home_points,
             ba.team_id IS NOT NULL AS has_away, ba.points AS away_points
      FROM public.matchups m
      LEFT JOIN b bh ON bh.team_id = m.home_team_id
      LEFT JOIN b ba ON ba.team_id = m.away_team_id
      WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
        AND m.status <> 'final' AND NOT m.is_overridden
        AND (bh.team_id IS NOT NULL OR ba.team_id IS NOT NULL)
        AND (   (bh.team_id IS NOT NULL AND bh.points IS DISTINCT FROM m.home_score)
             OR (ba.team_id IS NOT NULL AND ba.points IS DISTINCT FROM m.away_score))
    )
    UPDATE public.matchups m
    SET home_score = CASE WHEN s.has_home THEN s.home_points ELSE m.home_score END,
        away_score = CASE WHEN s.has_away THEN s.away_points ELSE m.away_score END,
        updated_at = now()
    FROM s
    WHERE m.id = s.id;
    GET DIAGNOSTICS v_written = ROW_COUNT;
  END IF;

  -- 158 (F405): THE PER-PLAYER ROWS FOLLOW THE SCORE. A team's rows are
  -- written only where its score is this door's to write — h2h: it sits
  -- in a pairing row that is not final and not overridden; total_points:
  -- a number is sent and its row is not final — so the stored lines are
  -- always the lines of the stored score. The team's set is REPLACED: a
  -- slot it no longer starts is removed, a changed slot rewritten, an
  -- identical one left alone. A score written WITHOUT `players` (a
  -- pre-158 caller) takes the team's old rows with it, so no stale row
  -- outlives the score it added up to. A final week never reaches here
  -- (above); the table's own trigger refuses it besides.
  IF v_mode = 'total_points' THEN
    SELECT COALESCE(array_agg(t.id), '{}') INTO v_pp_write
    FROM unnest(v_team_ids) t(id)
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(p_scores) e
                  WHERE (e ->> 'team_id')::uuid = t.id AND jsonb_typeof(e -> 'points') = 'number')
      AND NOT EXISTS (SELECT 1 FROM public.team_week_results r
                      WHERE r.league_id = p_league_id AND r.team_id = t.id
                        AND r.season = v_league.season AND r.week = p_week AND r.is_final);
  ELSE
    SELECT COALESCE(array_agg(t.id), '{}') INTO v_pp_write
    FROM unnest(v_team_ids) t(id)
    WHERE EXISTS (SELECT 1 FROM public.matchups m
                  WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
                    AND (m.home_team_id = t.id OR m.away_team_id = t.id)
                    AND m.status <> 'final' AND NOT m.is_overridden);
  END IF;

  DELETE FROM public.league_week_player_points p
  USING (SELECT (e ->> 'team_id')::uuid AS team_id,
                CASE WHEN e ? 'players'
                     THEN ARRAY(SELECT x ->> 'slot' FROM jsonb_array_elements(e -> 'players') x)
                     ELSE '{}'::text[] END AS slots
         FROM jsonb_array_elements(p_scores) e) b
  WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
    AND p.team_id = b.team_id AND b.team_id = ANY (v_pp_write)
    AND NOT (p.slot = ANY (b.slots));
  GET DIAGNOSTICS v_pp_gone = ROW_COUNT;
  SELECT COALESCE(array_agg(t.id), '{}') INTO v_pp_write
  FROM unnest(v_pp_write) t(id) WHERE t.id = ANY (v_pp_teams);

  IF cardinality(v_pp_write) > 0 THEN
    INSERT INTO public.league_week_player_points
      (league_id, season, week, team_id, slot, player_id, points, pending, reason, source)
    SELECT p_league_id, v_league.season, p_week, (e ->> 'team_id')::uuid, x ->> 'slot', x ->> 'player_id',
           (x ->> 'points')::numeric, ARRAY(SELECT jsonb_array_elements_text(x -> 'pending')), x ->> 'reason', 'worker'
    FROM jsonb_array_elements(p_scores) e, jsonb_array_elements(e -> 'players') x
    WHERE e ? 'players' AND (e ->> 'team_id')::uuid = ANY (v_pp_write)
    ON CONFLICT (league_id, season, week, team_id, slot) DO UPDATE
    SET player_id  = EXCLUDED.player_id,
        points     = EXCLUDED.points,
        pending    = EXCLUDED.pending,
        reason     = EXCLUDED.reason,
        source     = EXCLUDED.source,
        updated_at = now()
    WHERE (league_week_player_points.player_id, league_week_player_points.points, league_week_player_points.pending,
           league_week_player_points.reason, league_week_player_points.source)
          IS DISTINCT FROM (EXCLUDED.player_id, EXCLUDED.points, EXCLUDED.pending, EXCLUDED.reason, EXCLUDED.source);
    GET DIAGNOSTICS v_pp_rows = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'league_id', p_league_id,
    'season',    v_league.season,
    'week',      p_week,
    'mode',      v_mode,
    'received',  v_n,
    'writable',  v_writable,
    'written',   v_written,
    'unchanged', v_writable - v_written,
    'skipped',   v_skipped,
    -- 158 (F405): the per-player arm's own count. Its ABSENCE is how the
    -- worker knows it is talking to a pre-158 door (it names that).
    'player_points', jsonb_build_object(
      'teams_sent',    cardinality(v_pp_teams),
      'teams_written', cardinality(v_pp_write),
      'rows_written',  v_pp_rows,
      'rows_removed',  v_pp_gone),
    'reason', CASE
      WHEN v_writable = 0 THEN 'nothing_writable'   -- every touched row protected / every team pending or row-less
      WHEN v_written = 0  THEN 'no_change'          -- the identical re-send: zero writes, zero events
      ELSE NULL END);
END;
$$;

REVOKE EXECUTE ON FUNCTION score_write_week_batch(UUID, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. score_backfill_player_points — the ONE-TIME backfill door (task (d))
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION score_backfill_player_points(
  p_league_id UUID,
  p_week      INTEGER,
  p_teams     JSONB    -- [{team_id, points: number|null, players: [{slot, player_id, points, pending, reason}]}]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league   public.leagues;
  v_lw       public.league_weeks;
  v_mode     TEXT;
  v_e        JSONB;
  v_i        INTEGER := 0;
  v_n        INTEGER;
  v_tid      UUID;
  v_team_ids UUID[] := '{}';
  v_cnt      INTEGER;
  v_cells    INTEGER;
  v_over     INTEGER;
  v_match    BOOLEAN;
  v_stored   JSONB;
  v_source   TEXT;
  v_rows     INTEGER;
  v_total    INTEGER := 0;
  v_written  JSONB := '[]'::jsonb;
  v_skipped  JSONB := '[]'::jsonb;
BEGIN
  -- A backfill job's door, never a user verb (the scoring door's rule 2 shape).
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'score_backfill_player_points: the backfill door is the operator''s (service role), never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;

  -- (1) The batch's SHAPE (22023), before anything is read or locked.
  IF p_league_id IS NULL OR p_week IS NULL OR p_teams IS NULL THEN
    RAISE EXCEPTION 'score_backfill_player_points: p_league_id, p_week and p_teams are required'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_teams) <> 'array' OR jsonb_array_length(p_teams) = 0 THEN
    RAISE EXCEPTION 'score_backfill_player_points: p_teams must be a non-empty JSON array of {team_id, points, players}'
      USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_teams);
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_teams) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'score_backfill_player_points: element % is not an object', v_i
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_tid := (v_e ->> 'team_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_tid := NULL;
    END;
    IF v_tid IS NULL THEN
      RAISE EXCEPTION 'score_backfill_player_points: element % has no valid team_id', v_i
        USING ERRCODE = '22023';
    END IF;
    IF v_tid = ANY (v_team_ids) THEN
      RAISE EXCEPTION 'score_backfill_player_points: team % appears twice in the batch', v_tid
        USING ERRCODE = '22023';
    END IF;
    v_team_ids := v_team_ids || v_tid;
    IF NOT (v_e ? 'points') OR jsonb_typeof(v_e -> 'points') NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'score_backfill_player_points: element % (team %) points must be a JSON number or null (the recomputed team total)', v_i, v_tid
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_e -> 'points') = 'number' AND scale((v_e ->> 'points')::numeric) > 2 THEN
      RAISE EXCEPTION 'score_backfill_player_points: element % (team %) points % has more than two decimals', v_i, v_tid, v_e ->> 'points'
        USING ERRCODE = '22023';
    END IF;
    PERFORM public.player_points_rows_check_internal('score_backfill_player_points', v_i, v_tid, v_e -> 'points', v_e -> 'players');
  END LOOP;

  -- (2) The league row FIRST (rule 8 lock order). Any status: a complete
  --     league's weeks are final and are backfilled like any other.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'score_backfill_player_points: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- (3) Every team is THIS league's.
  SELECT count(*) INTO v_cnt
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.id = ANY (v_team_ids);
  IF v_cnt <> cardinality(v_team_ids) THEN
    RAISE EXCEPTION 'score_backfill_player_points: the batch names % team(s) that are not league %''s', cardinality(v_team_ids) - v_cnt, p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- (4) The week: scheduled and scored (never upcoming).
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'score_backfill_player_points: week_not_scheduled — league % has no league_weeks row for season % week %', p_league_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status = 'upcoming' THEN
    RAISE EXCEPTION 'score_backfill_player_points: week_not_open — league % week % is upcoming; nothing has been scored', p_league_id, p_week
      USING ERRCODE = 'P0001';
  END IF;

  v_mode := COALESCE(v_league.settings ->> 'schedule_mode', 'h2h');

  -- (5) Per team: never a second time; compare Σ with what is STORED; the
  --     door writes rows only — never a score, a result or a standing.
  PERFORM set_config('fieldscout.player_points_backfill', 'on', true);
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_teams) LOOP
    v_tid := (v_e ->> 'team_id')::uuid;

    IF EXISTS (SELECT 1 FROM public.league_week_player_points p
               WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week AND p.team_id = v_tid) THEN
      v_skipped := v_skipped || jsonb_build_object('team_id', v_tid, 'reason', 'already_stored');
      CONTINUE;
    END IF;

    IF v_mode = 'total_points' THEN
      SELECT count(*)::int, 0,
             COALESCE(bool_and(r.points IS NOT DISTINCT FROM (v_e ->> 'points')::numeric), FALSE),
             COALESCE(jsonb_agg(r.points), '[]'::jsonb)
        INTO v_cells, v_over, v_match, v_stored
      FROM public.team_week_results r
      WHERE r.league_id = p_league_id AND r.team_id = v_tid AND r.season = v_league.season AND r.week = p_week;
    ELSE
      SELECT count(*) FILTER (WHERE NOT m.is_overridden)::int,
             count(*) FILTER (WHERE m.is_overridden)::int,
             COALESCE(bool_and(CASE WHEN m.home_team_id = v_tid THEN m.home_score ELSE m.away_score END
                                 IS NOT DISTINCT FROM (v_e ->> 'points')::numeric) FILTER (WHERE NOT m.is_overridden), FALSE),
             COALESCE(jsonb_agg(CASE WHEN m.home_team_id = v_tid THEN m.home_score ELSE m.away_score END) FILTER (WHERE NOT m.is_overridden), '[]'::jsonb)
        INTO v_cells, v_over, v_match, v_stored
      FROM public.matchups m
      WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
        AND (m.home_team_id = v_tid OR m.away_team_id = v_tid);
    END IF;

    IF v_cells = 0 THEN
      v_skipped := v_skipped || jsonb_build_object('team_id', v_tid,
        'reason', CASE WHEN v_over > 0 THEN 'overridden' ELSE 'no_stored_score' END);
      CONTINUE;
    END IF;

    IF v_match THEN
      v_source := 'backfill';                 -- recoverable: these ARE the points it was scored on
    ELSIF v_lw.status = 'final' THEN
      v_source := 'backfill_unrecoverable';   -- the stats moved after it was scored (F268); named, stored once
    ELSE
      v_skipped := v_skipped || jsonb_build_object('team_id', v_tid, 'reason', 'open_week_mismatch',
        'stored', v_stored, 'recomputed', v_e -> 'points');
      CONTINUE;
    END IF;

    INSERT INTO public.league_week_player_points
      (league_id, season, week, team_id, slot, player_id, points, pending, reason, source)
    SELECT p_league_id, v_league.season, p_week, v_tid, x ->> 'slot', x ->> 'player_id',
           (x ->> 'points')::numeric, ARRAY(SELECT jsonb_array_elements_text(x -> 'pending')), x ->> 'reason', v_source
    FROM jsonb_array_elements(v_e -> 'players') x;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
    v_written := v_written || jsonb_build_object('team_id', v_tid, 'source', v_source, 'rows', v_rows,
      'stored', v_stored, 'recomputed', v_e -> 'points');
  END LOOP;
  PERFORM set_config('fieldscout.player_points_backfill', 'off', true);

  RETURN jsonb_build_object(
    'league_id', p_league_id,
    'season',    v_league.season,
    'week',      p_week,
    'status',    v_lw.status,
    'mode',      v_mode,
    'received',  v_n,
    'written',   v_written,
    'rows',      v_total,
    'skipped',   v_skipped,
    'reason',    CASE WHEN jsonb_array_length(v_written) = 0 THEN 'nothing_written' ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION score_backfill_player_points(UUID, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. THE WINDOW — correction_window_ends_at = the NEXT week's first kickoff
-- ---------------------------------------------------------------------------
ALTER TABLE nfl_weeks ADD COLUMN IF NOT EXISTS correction_window_default_ends_at TIMESTAMPTZ;
COMMENT ON COLUMN nfl_weeks.correction_window_default_ends_at IS
  'Spec §7.3.6 / §23.4 (v2.16.68 — migration 158, PROGRESS F405): the week''s stat-correction window end when the NEXT week''s first kickoff is not known (039''s seed — Thursday 06:00 ET after the week), and for the season''s last week. correction_window_ends_at = the next week''s first_kickoff_at when recorded, else this — kept so by two triggers.';
COMMENT ON COLUMN nfl_weeks.correction_window_ends_at IS
  'Spec §23.4 (v2.16.68 — migration 158, F405 RULED 2026-09-28): the end of the week''s stat-correction window = the NEXT week''s first kickoff (Yahoo''s rule) when ingestion has recorded it (first_kickoff_at of week + 1), else correction_window_default_ends_at. finalize_matchups locks the week at its first run at or after this instant.';

UPDATE nfl_weeks SET correction_window_default_ends_at = correction_window_ends_at
WHERE correction_window_default_ends_at IS NULL;

-- The ONE-TIME re-derivation (before the triggers exist): every week whose
-- next week's first kickoff is recorded takes it. Deterministic — no clock:
-- a week already final moves too, which changes nothing (a final week is
-- never re-claimed); named.
DO $$
DECLARE
  v_moved TEXT;
BEGIN
  WITH moved AS (
    UPDATE nfl_weeks w
    SET correction_window_ends_at = n.first_kickoff_at
    FROM nfl_weeks n
    WHERE n.season = w.season AND n.week = w.week + 1
      AND n.first_kickoff_at IS NOT NULL
      AND w.correction_window_ends_at IS DISTINCT FROM n.first_kickoff_at
    RETURNING w.season, w.week, w.correction_window_default_ends_at AS was, w.correction_window_ends_at AS now_ends)
  SELECT string_agg(season || ' wk ' || week || ': ' || was || ' -> ' || now_ends, '; ' ORDER BY season, week)
    INTO v_moved FROM moved;
  RAISE NOTICE '158 (F405): stat-correction windows moved to the next week''s first kickoff — %',
    COALESCE(v_moved, 'none (no next-week kickoff is recorded on this database; each week keeps its default until ingestion records one)');
END;
$$;

CREATE OR REPLACE FUNCTION nfl_weeks_window_row() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_next TIMESTAMPTZ;
BEGIN
  -- The follow trigger's own derived write (depth 2) is the rule already applied.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.correction_window_default_ends_at := COALESCE(NEW.correction_window_default_ends_at, NEW.correction_window_ends_at);
  ELSIF NEW.correction_window_default_ends_at IS NOT DISTINCT FROM OLD.correction_window_default_ends_at THEN
    -- A direct write of the window (an operator, a fixture's boundary
    -- instant) is the week's new DEFAULT; a known next-week kickoff still wins.
    NEW.correction_window_default_ends_at := NEW.correction_window_ends_at;
  END IF;
  SELECT n.first_kickoff_at INTO v_next
  FROM public.nfl_weeks n
  WHERE n.season = NEW.season AND n.week = NEW.week + 1;
  NEW.correction_window_ends_at := COALESCE(v_next, NEW.correction_window_default_ends_at);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION nfl_weeks_window_row() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION nfl_weeks_window_follow() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.first_kickoff_at IS NOT DISTINCT FROM OLD.first_kickoff_at THEN
    RETURN NULL;
  END IF;
  -- Week N+1's first kickoff is week N's window end; a cleared kickoff
  -- restores week N's default.
  UPDATE public.nfl_weeks p
  SET correction_window_ends_at = COALESCE(NEW.first_kickoff_at, p.correction_window_default_ends_at)
  WHERE p.season = NEW.season AND p.week = NEW.week - 1
    AND p.correction_window_ends_at IS DISTINCT FROM COALESCE(NEW.first_kickoff_at, p.correction_window_default_ends_at);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION nfl_weeks_window_follow() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_nfl_weeks_window_row ON nfl_weeks;
CREATE TRIGGER trg_nfl_weeks_window_row
  BEFORE INSERT OR UPDATE OF correction_window_ends_at, correction_window_default_ends_at ON nfl_weeks
  FOR EACH ROW EXECUTE FUNCTION nfl_weeks_window_row();
ALTER TABLE nfl_weeks ENABLE ALWAYS TRIGGER trg_nfl_weeks_window_row;

DROP TRIGGER IF EXISTS trg_nfl_weeks_window_follow ON nfl_weeks;
CREATE TRIGGER trg_nfl_weeks_window_follow
  AFTER INSERT OR UPDATE OF first_kickoff_at ON nfl_weeks
  FOR EACH ROW EXECUTE FUNCTION nfl_weeks_window_follow();
ALTER TABLE nfl_weeks ENABLE ALWAYS TRIGGER trg_nfl_weeks_window_follow;
