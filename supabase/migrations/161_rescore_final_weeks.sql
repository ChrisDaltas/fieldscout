-- ============================================================================
-- 161_rescore_final_weeks.sql — A ONE-TIME, RULED, AUDITED RE-SCORE OF FINAL
-- LEAGUE-WEEKS (task M5 L.D3.13, FULL rigour — scoring, results, standings,
-- production data). PROGRESS D425, F487–F489; spec v2.16.70 (§11.4, §23.4
-- notes; fold-back of the ruling below).
--
-- THE RULING (Chris, 2026-09-29, in chat, verbatim — asked to choose between
-- keeping weeks 1–2 as scored or re-scoring them once with the actual yards,
-- both results named): "re-score weeks 1 and 2 with the actual yards".
-- It supersedes Q69 for those two weeks. F405's lock (158) is about the
-- PROVIDER's late stat corrections; this is our own ingestion defect: D/ST
-- `def_yards_allowed` was NULL when weeks 1–2 were scored and the pre-143
-- scoring read NULL as 0 yards — the top yards-allowed tier (D380, F390).
-- `sync:reingest --weeks 1-3` (production, 2026-09-29, after 135–159 were
-- pushed) filled it 32/32 per week; the dry `backfill:player-points` then
-- recomputed every week-1/2 team 2–8 points LOWER than its stored score and
-- two results flip.
--
-- Spec: §7.3.3 (the scoring snapshot — the re-score reads the WEEK's rules,
-- 144, through the worker's own calculator; the stored precision), §7.3.6 /
-- §23.4 (the window and the lock — unchanged for every ordinary path),
-- §11.4 ("a `final` matchup is only changed via a commissioner override" —
-- v2.16.70 adds the second sanctioned change, THIS door, on a recorded
-- product ruling), §11.5 (standings from final results — rebuilt, never
-- patched), §12.12 (audit-log immutability — untouched: one NEW row per
-- league-week, never an edit), §10.3 (the league post).
--
-- Numbering: RESERVED by the orchestrator (161 / pgTAP 109; L.D2.17 holds
-- 160) and measured at build time (D161): `ls supabase/migrations | tail -1`
-- → 159_faab_budget_range.sql on main @ b74dfca. NOT held: reaches
-- production by `npx supabase db push` only.
--
-- WHAT THIS MIGRATION DOES
--   §1 `admin_rescore_actions` — the door's OWN zero-policy replay ledger
--      (the D350 / 126 shape: never folded into commissioner_actions, which
--      carries a client INSERT policy — 123:333-335).
--   §2 `league_week_player_points.source` gains `rescore` (the CHECK is
--      widened — every 158 value stays legal).
--   §3 THE LOCK — `league_week_player_points_lock()` REPLACED against 158's
--      FILE TEXT (D137, below): ONE hunk, the ruled re-score exit.
--   §4 `admin_rescore_final_week` — THE DOOR (service role only; JWT refused
--      in-body; REVOKEd). The ONLY sanctioned path past 141's "final weeks
--      are skipped" and 158's lock; neither is weakened for anyone else:
--        * the score worker still refuses a final week (119's `week_final`,
--          D295(b)) — this migration does not touch `score_write_week_batch`;
--        * 141/144's `commish_change_setting` re-score still skips final
--          weeks — untouched;
--        * the lock still refuses every write to a final week's rows except
--          158's backfill INSERT and this door's rows, and the new exit
--          demands this door's audit row for THAT league-week.
--
-- THE DOOR, STEP BY STEP (each refusal BY NAME; nothing written before the
-- plan is complete):
--   (1) SHAPE (22023): p_teams = [{team_id, points, players}] — the worker's
--       pipeline, from CURRENT player_stats under the WEEK's rules (TS:
--       computeTeamWeek / playerPointsRows / weekScoringRules — §7.3.3's one
--       implementation; SQL scores nothing, D33). points is a NUMBER — a
--       final week is never re-scored to pending (E61); the rows ARE the
--       score (158's `player_points_rows_check_internal`, called). The
--       reason (the ruling — the audit row's) and the member note (plain
--       words, for the post and the notifications) are required; the actor
--       is the profile whose ruling it is.
--   (2) The LEAGUE row FOR UPDATE first (rule 8). (3) REPLAY (F65(b)'s
--       shape): an action_id already consumed returns its document byte for
--       byte — for the SAME week; the same id for another week is refused.
--   (4) The league is `in_season` and NO playoff-type row exists for the
--       season (a bracket is seeded from standings — re-scoring under a
--       seeded bracket would move seeds after the fact: `bracket_built`).
--       The week is `final` (`week_not_final` — an open week is the worker's:
--       it re-scores on every correction).
--   (5) COVERAGE: the batch names EXACTLY the teams on the week's matchups
--       (h2h) / results rows (total_points) — a partial re-score of a week is
--       refused (`batch_incomplete` / `team_not_in_week`). LINEUP: each
--       team's rows are exactly its stored lineup's starting slots
--       (`team_lineups.slot_map`, IR keys excluded — the worker's
--       `starterSlotsOf`), else `lineup_mismatch`.
--   (6) THE PLAN, BY VALUE: each NON-overridden matchup row's new scores and
--       the E38 result THAT GOES WITH THEM (117's `matchup_result_internal`
--       — F245: the result is written in the same statement as the scores,
--       so the rebuild's `result_drift` check holds by construction); an
--       OVERRIDDEN row is the commissioner's number — never written, named
--       in the result and the post; total_points: each final results row's
--       points. The per-player rows of every team whose score this door may
--       write (≥ 1 non-overridden cell — 158's own rule), diffed against
--       what is stored (a `backfill_unrecoverable` row is always rewritten:
--       after the re-score its lines DO add up to the score).
--       NO CHANGE IN ANY DIMENSION ⇒ `no_changes`, detected by value, never
--       inferred from an empty write: no audit row, no post, no
--       notification; the action_id is still consumed (§12.26).
--   (7) THE WRITE, in this order: the AUDIT ROW (one per league-week,
--       `rescore_final_week`, reason = the ruling; it arms the GUCs); the
--       matchups cells (one UPDATE, count asserted) / the total_points
--       results rows; the per-player rows (`rescore`; the lock's new exit);
--       then `rebuild_team_week_results` — THE results math finalization
--       itself calls (`week_results_write_internal`, D137 / 126): W/L/T,
--       second-opponent and median results, `league_weeks.median_score`.
--       Standings (`league_standings[_projected]`, the waiver order under
--       reverse standings, the FAAB tiebreak under reverse standings, the
--       projected bracket) are READS over those rows — they follow; nothing
--       is patched (PROGRESS D425(5) lists every reader).
--   (8) THE LEAGUE HEARS IT: one system post per league-week (`user_id`
--       NULL — the "system" chip, R895), in plain words — the note, every
--       result that flipped, any commissioner-set score kept; a notification
--       to each seated manager whose result (h2h, second-opponent or median)
--       changed.
--   (9) DRY RUN (p_dry_run, DEFAULT TRUE): steps (6)–(8) run EXACTLY as for
--       an apply inside a sub-block that is then rolled back — the returned
--       document is the apply's own, and nothing persists (no audit row, no
--       post, no notification, no ledger row, no broadcast).
--
-- WHY NOT THE AUDITED REOPEN (110's final → correction_window): the worker
-- door skips a `final` matchup ROW (119: `m.status <> 'final'`) whatever the
-- week says, no delta is queued for weeks 1–2 (sync:reingest's were consumed
-- as `week_final`), and finalize would re-claim the week within the hour
-- under its own rules. A reopen would need three more writers to agree; the
-- door is one transaction that says exactly what it did.
--
-- D137 — `league_week_player_points_lock()` is derived from its NEWEST (and
-- only) definer's FILE TEXT, 158:245-303 (158 file md5
-- eb9526816f20d57e0137d55292289eb3; prosrc md5
-- 3b032dac03f1ba65174684c57cfae3fe), by derive_161.py (PR body — the block
-- found once, the anchor — 158's `week_locked` RAISE — hit once, the
-- reversal asserted to reproduce 158 byte for byte): ONE hunk, inserted
-- before that RAISE (hunk md5 7f23c417e3e15cb0b2c02eb745346307; 161 prosrc
-- md5 bc1ac0492d7b05c75aa212d7e9e0d990). pgTAP 109 §A reverses it on the
-- LIVE prosrc and pins 158's md5.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4)
--   New: one table (RLS on, ZERO policies, UNIQUE (league_id, action_id),
--   TRUNCATE revoked), one CHECK widened, one trigger function body replaced
--   (DEFINER as in 158, search_path '', signature unchanged — trigger kept,
--   ENABLE ALWAYS unchanged; REVOKE restated), one new DEFINER door (in-body
--   JWT refusal, search_path '', REVOKEd from PUBLIC / anon / authenticated;
--   the service role keeps EXECUTE). Time: no clock is read for a decision
--   (`now()` only as a write stamp — 119's / 158's precedent). Lock order:
--   the league row FOR UPDATE before any write (rule 8); the rebuild takes
--   the league and the week row after it (126's order). Typegen: the table
--   and the function (additive; alias block re-appended). Realtime: none
--   new — the matchups / team_week_results UPDATEs fire 119's existing
--   broadcasts, so open boxes and standings refetch. WAIVERS: R6 — no
--   staging clone; rehearsal = the fresh local `db reset` over 001–161, the
--   full pgTAP run, and the stack suite that replays the production story
--   end to end (PR body). D38: no data backfill in the migration — the
--   re-score is the operator's CLI (`npm run rescore:final-weeks`), because
--   the recompute needs the scoring calculator, which lives in TS (§7.3.3).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. admin_rescore_actions — the door's OWN replay ledger (zero policies)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_rescore_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  season     INTEGER NOT NULL,
  week       INTEGER NOT NULL,
  action_id  UUID NOT NULL,                     -- the operator's per-call key (the CLI mints one per league-week per run)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                    -- the door's returned document, replayed byte for byte
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                 -- the race backstop behind the select-then-insert
);
COMMENT ON TABLE admin_rescore_actions IS
  'Idempotency ledger for admin_rescore_final_week (migration 161, M5 L.D3.13; PROGRESS D425). ZERO policies: the DEFINER door is its only reader and writer. NOT the audit log (§12.26 — an action_id is an idempotency key): a row is written for a no-change call too, while commissioner_actions gets one row per league-week that actually changed.';
ALTER TABLE admin_rescore_actions ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON TABLE admin_rescore_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. league_week_player_points.source gains `rescore`
-- ---------------------------------------------------------------------------
ALTER TABLE league_week_player_points DROP CONSTRAINT league_week_player_points_source_check;
ALTER TABLE league_week_player_points ADD CONSTRAINT league_week_player_points_source_check
  CHECK (source IN ('worker', 'backfill', 'backfill_unrecoverable', 'rescore'));
COMMENT ON COLUMN league_week_player_points.source IS
  'worker = written with the score by the scoring door; backfill = recomputed once by the 158 backfill and EQUAL to the stored score (recoverable: the stats had not moved); backfill_unrecoverable = a final week whose stats moved after it was scored (the old line was overwritten — F268), so the rows are the corrected recompute and do NOT add up to the stored score, named as such; rescore = written WITH the re-scored score by admin_rescore_final_week (migration 161, a recorded product ruling — PROGRESS D425), so they add up to it.';

-- ---------------------------------------------------------------------------
-- 3. THE LOCK — CREATE OR REPLACE against 158's FILE TEXT (D137): one hunk,
--    the ruled re-score exit. Every other byte 158's.
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
    -- "recompute once"), only while its door holds the transaction-local
    -- setting. A convention for the ordinary paths, not a boundary (R1262):
    -- the service role could set it; it can never open an UPDATE or DELETE.
    IF TG_OP = 'INSERT'
       AND NEW.source IN ('backfill', 'backfill_unrecoverable')
       AND current_setting('fieldscout.player_points_backfill', true) = 'on' THEN
      RETURN NEW;
    END IF;
    -- 161 (M5 L.D3.13 — Chris 2026-09-29: "re-score weeks 1 and 2 with the
    -- actual yards"): THE RULED RE-SCORE EXIT. Open only while
    -- admin_rescore_final_week holds the transaction-local setting naming ITS
    -- audit row — a `rescore_final_week` commissioner_actions row of THIS
    -- league, season and week, written earlier in the same transaction — and
    -- only for a row it writes as `rescore` (INSERT / UPDATE) or a row it
    -- removes (DELETE: a slot the team no longer starts). Like 158's backfill
    -- exit it is a convention for the ordinary paths, not a boundary against
    -- the service role (R1262's reading, unchanged); what it adds is that the
    -- audit row must exist, so no locked week changes without its receipt.
    IF current_setting('fieldscout.final_week_rescore', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND (TG_OP = 'DELETE' OR v_row.source = 'rescore')
       AND EXISTS (
         SELECT 1 FROM public.commissioner_actions a
         WHERE a.id = current_setting('fieldscout.final_week_rescore', true)::uuid
           AND a.league_id = v_row.league_id
           AND a.action_type = 'rescore_final_week'
           AND a.metadata ->> 'season' = v_row.season::text
           AND a.metadata ->> 'week' = v_row.week::text) THEN
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;
    RAISE EXCEPTION 'league_week_player_points: week_locked — league % week % is final; its stored per-player points never change (F405: a later stat correction updates player_stats, never a locked week — the commissioner''s audited score override is the one change to a final week, §11.4)', v_row.league_id, v_row.week
      USING ERRCODE = 'P0001';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE EXECUTE ON FUNCTION league_week_player_points_lock() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin_rescore_final_week — THE DOOR
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_rescore_final_week(
  p_league_id   UUID,
  p_week        INTEGER,
  p_teams       JSONB,     -- [{team_id, points: number, players: [{slot, player_id, points, pending, reason}]}] — every team of the week
  p_reason      TEXT,      -- the ruling — the audit row's reason (required, ≤ 500)
  p_member_note TEXT,      -- plain words for the league: WHY ("defense yards allowed were missing when it was first scored"), ≤ 300
  p_actor_id    UUID,      -- the profile whose ruling this is (commissioner_actions.actor_id)
  p_action_id   UUID,      -- idempotency key — required for an apply, ignored by a dry run
  p_dry_run     BOOLEAN DEFAULT TRUE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_lw           public.league_weeks;
  v_mode         TEXT;
  v_reason       TEXT;
  v_note         TEXT;
  v_e            JSONB;
  v_i            INTEGER := 0;
  v_tid          UUID;
  v_team_ids     UUID[] := '{}';
  v_week_teams   UUID[];
  v_missing      UUID[];
  v_extra        UUID[];
  v_cnt          INTEGER;
  v_ir           TEXT[];
  v_map          JSONB;
  v_want_s       TEXT;
  v_got_s        TEXT;
  v_result       JSONB;
  v_stored_week  INTEGER;
  v_plan         JSONB := '[]'::jsonb;   -- h2h: every NON-overridden row, before → after; total_points: every results row
  v_overridden   JSONB := '[]'::jsonb;   -- the commissioner's numbers, kept and named
  v_cells        INTEGER := 0;           -- cells (rows) the plan changes
  v_pp_write     UUID[] := '{}';         -- teams whose per-player rows this door writes
  v_want         JSONB := '[]'::jsonb;   -- the desired per-player rows of those teams
  v_pp_upsert    INTEGER := 0;
  v_pp_delete    INTEGER := 0;
  v_pp_teams     JSONB := '[]'::jsonb;   -- teams whose row set changes
  v_team_lines   JSONB := '[]'::jsonb;   -- per team: stored cells → recomputed
  v_scores_moved INTEGER := 0;
  v_no_changes   BOOLEAN;
  v_twr_before   JSONB;
  v_twr_after    JSONB;
  v_median_b     NUMERIC;
  v_median_a     NUMERIC;
  v_audit_id     UUID;
  v_rebuild      JSONB;
  v_changes      JSONB := '[]'::jsonb;   -- per team whose result changed
  v_flips        JSONB := '[]'::jsonb;   -- per matchup whose result changed
  v_post         TEXT;
  v_notified     JSONB := '[]'::jsonb;
  v_not_notified JSONB := '[]'::jsonb;
  v_prior        JSONB;
  v_x            RECORD;
  v_y            RECORD;
  v_user         UUID;
  v_body         TEXT;
  v_sentence     TEXT;
BEGIN
  -- A JWT-bearing caller is refused in-body (rule 2); the REVOKE below narrows
  -- EXECUTE to the service role — this says why.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'admin_rescore_final_week: the re-score door is the operator''s (service role) on a recorded ruling, never a signed-in user''s'
      USING ERRCODE = '42501';
  END IF;

  -- (1) SHAPE (22023), before anything is read or locked.
  IF p_league_id IS NULL OR p_week IS NULL OR p_teams IS NULL OR p_dry_run IS NULL OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'admin_rescore_final_week: p_league_id, p_week, p_teams, p_actor_id and p_dry_run are required'
      USING ERRCODE = '22023';
  END IF;
  IF NOT p_dry_run AND p_action_id IS NULL THEN
    RAISE EXCEPTION 'admin_rescore_final_week: p_action_id is required to apply (the idempotency key — one per league-week per run, reused on a retry)'
      USING ERRCODE = '22023';
  END IF;
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'admin_rescore_final_week: the reason (the ruling, quoted — it is the audit row''s reason) is required and at most 500 characters (got %)', COALESCE(char_length(v_reason), 0)
      USING ERRCODE = '22023';
  END IF;
  v_note := rtrim(NULLIF(btrim(COALESCE(p_member_note, ''), E' \t\r\n'), ''), '.');
  IF v_note IS NULL OR v_note = '' OR char_length(v_note) > 300 THEN
    RAISE EXCEPTION 'admin_rescore_final_week: the member note (plain words for the league — why the week was re-scored) is required and at most 300 characters'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_actor_id) THEN
    RAISE EXCEPTION 'admin_rescore_final_week: actor % is not a profile — the audit row names the person whose ruling this is', p_actor_id
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_teams) <> 'array' OR jsonb_array_length(p_teams) = 0 THEN
    RAISE EXCEPTION 'admin_rescore_final_week: p_teams must be a non-empty JSON array of {team_id, points, players}'
      USING ERRCODE = '22023';
  END IF;
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_teams) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_e) <> 'object' THEN
      RAISE EXCEPTION 'admin_rescore_final_week: element % is not an object', v_i
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_tid := (v_e ->> 'team_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_tid := NULL;
    END;
    IF v_tid IS NULL THEN
      RAISE EXCEPTION 'admin_rescore_final_week: element % has no valid team_id', v_i
        USING ERRCODE = '22023';
    END IF;
    IF v_tid = ANY (v_team_ids) THEN
      RAISE EXCEPTION 'admin_rescore_final_week: team % appears twice in the batch', v_tid
        USING ERRCODE = '22023';
    END IF;
    v_team_ids := v_team_ids || v_tid;
    IF jsonb_typeof(v_e -> 'points') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'admin_rescore_final_week: element % (team %) points must be a JSON number — a final week is re-scored to a number; a recompute with a starter still pending (E61) cannot be written to a locked week', v_i, v_tid
        USING ERRCODE = '22023';
    END IF;
    IF scale((v_e ->> 'points')::numeric) > 2 THEN
      RAISE EXCEPTION 'admin_rescore_final_week: element % (team %) points % has more than two decimals — the worker rounds (F22); the door never does', v_i, v_tid, v_e ->> 'points'
        USING ERRCODE = '22023';
    END IF;
    PERFORM public.player_points_rows_check_internal('admin_rescore_final_week', v_i, v_tid, v_e -> 'points', v_e -> 'players');
  END LOOP;

  -- (2) The LEAGUE row FIRST (rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_rescore_final_week: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- (3) REPLAY — after the league lock, before every business gate, so a
  --     retry replays byte for byte whatever has moved since. F65(b): the
  --     same id for ANOTHER week is a different request, refused by name.
  IF NOT p_dry_run THEN
    SELECT a.result, a.week INTO v_result, v_stored_week
    FROM public.admin_rescore_actions a
    WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
    IF FOUND THEN
      IF v_stored_week IS DISTINCT FROM p_week THEN
        RAISE EXCEPTION 'admin_rescore_final_week: action_id % was already used for league % week % — mint a new one for week %', p_action_id, p_league_id, v_stored_week, p_week
          USING ERRCODE = '22023';
      END IF;
      RETURN v_result;
    END IF;
  END IF;

  -- (4) The league, the bracket, the week.
  IF v_league.status <> 'in_season' THEN
    RAISE EXCEPTION 'admin_rescore_final_week: league_not_in_season — league % is % (a bracket or a champion already reads these results; this door re-scores an in-season league only)', p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.matchups m
             WHERE m.league_id = p_league_id AND m.season = v_league.season
               AND m.round_type IN ('playoff', 'consolation', 'third_place')) THEN
    RAISE EXCEPTION 'admin_rescore_final_week: bracket_built — league % already has playoff rows for season %; they were seeded from the standings this would change', p_league_id, v_league.season
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_cnt FROM public.teams t WHERE t.league_id = p_league_id AND t.id = ANY (v_team_ids);
  IF v_cnt <> cardinality(v_team_ids) THEN
    RAISE EXCEPTION 'admin_rescore_final_week: the batch names % team(s) that are not league %''s', cardinality(v_team_ids) - v_cnt, p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_rescore_final_week: week_not_scheduled — league % has no league_weeks row for season % week %', p_league_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status <> 'final' THEN
    RAISE EXCEPTION 'admin_rescore_final_week: week_not_final — league % week % is %; an open week is the score worker''s (it re-scores on every correction) — this door re-scores a FINAL week only', p_league_id, p_week, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;
  v_mode := COALESCE(COALESCE(v_league.settings, '{}'::jsonb) ->> 'schedule_mode', 'h2h');

  -- (5) COVERAGE — exactly the week's teams.
  IF v_mode = 'total_points' THEN
    SELECT COALESCE(array_agg(DISTINCT r.team_id), '{}') INTO v_week_teams
    FROM public.team_week_results r
    WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT x.team_id), '{}') INTO v_week_teams
    FROM (SELECT m.home_team_id AS team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
          UNION
          SELECT m.away_team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week AND m.away_team_id IS NOT NULL) x;
  END IF;
  SELECT COALESCE(array_agg(t ORDER BY t), '{}') INTO v_missing FROM unnest(v_week_teams) t WHERE NOT (t = ANY (v_team_ids));
  SELECT COALESCE(array_agg(t ORDER BY t), '{}') INTO v_extra FROM unnest(v_team_ids) t WHERE NOT (t = ANY (v_week_teams));
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'admin_rescore_final_week: batch_incomplete — league % week % has % team(s) the batch does not name (%); a week is re-scored whole or not at all', p_league_id, p_week, cardinality(v_missing), v_missing
      USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(v_extra) > 0 THEN
    RAISE EXCEPTION 'admin_rescore_final_week: team_not_in_week — team(s) % have no stored score in league % week %', v_extra, p_league_id, p_week
      USING ERRCODE = 'P0001';
  END IF;

  -- LINEUP — each team's rows are exactly its stored lineup's starting slots
  -- (the worker's starterSlotsOf: a non-empty string value under a slot key
  -- whose prefix is not an IR key).
  SELECT COALESCE(array_agg(s ->> 'key'), '{}') INTO v_ir
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_league.roster_settings -> 'ir_slots') = 'array'
                                 THEN v_league.roster_settings -> 'ir_slots' ELSE '[]'::jsonb END) s
  WHERE jsonb_typeof(s -> 'key') = 'string' AND (s ->> 'key') <> '';
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_teams) LOOP
    v_tid := (v_e ->> 'team_id')::uuid;
    SELECT tl.slot_map INTO v_map
    FROM public.team_lineups tl
    WHERE tl.team_id = v_tid AND tl.season = v_league.season AND tl.week = p_week;
    IF NOT FOUND OR v_map IS NULL OR jsonb_typeof(v_map) <> 'object' THEN
      RAISE EXCEPTION 'admin_rescore_final_week: lineup_mismatch — team % has no stored lineup (slot_map) for season % week %; there is nothing to re-score it from', v_tid, v_league.season, p_week
        USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(string_agg(e.key || '=' || (e.value #>> '{}'), ',' ORDER BY e.key), '') INTO v_want_s
    FROM jsonb_each(v_map) e
    WHERE jsonb_typeof(e.value) = 'string' AND (e.value #>> '{}') <> '' AND NOT (split_part(e.key, ':', 1) = ANY (v_ir));
    SELECT COALESCE(string_agg((x ->> 'slot') || '=' || (x ->> 'player_id'), ',' ORDER BY x ->> 'slot'), '') INTO v_got_s
    FROM jsonb_array_elements(v_e -> 'players') x;
    IF v_want_s IS DISTINCT FROM v_got_s THEN
      RAISE EXCEPTION 'admin_rescore_final_week: lineup_mismatch — team % week %: the stored lineup starts [%] but the batch scores [%]', v_tid, p_week, v_want_s, v_got_s
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- (6) THE PLAN, BY VALUE.
  IF v_mode = 'total_points' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'team_id', r.team_id, 'before', r.points, 'after', (b.e ->> 'points')::numeric,
             'changed', r.points IS DISTINCT FROM (b.e ->> 'points')::numeric) ORDER BY r.team_id), '[]'::jsonb)
      INTO v_plan
    FROM public.team_week_results r
    JOIN jsonb_array_elements(p_teams) b(e) ON (b.e ->> 'team_id')::uuid = r.team_id
    WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
    SELECT count(*) INTO v_cells FROM jsonb_array_elements(v_plan) p WHERE (p ->> 'changed')::boolean;
    v_pp_write := v_team_ids;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'matchup_id', m.id, 'round_type', m.round_type,
             'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id,
             'home_team_name', th.name, 'away_team_name', ta.name,
             'before', jsonb_build_object('home_score', m.home_score, 'away_score', m.away_score, 'result', m.result),
             'after',  jsonb_build_object('home_score', n.home, 'away_score', n.away,
                                          'result', public.matchup_result_internal(n.home, n.away, m.away_team_id)),
             'changed', (n.home IS DISTINCT FROM m.home_score OR n.away IS DISTINCT FROM m.away_score
                         OR public.matchup_result_internal(n.home, n.away, m.away_team_id) IS DISTINCT FROM m.result),
             'result_changed', public.matchup_result_internal(n.home, n.away, m.away_team_id) IS DISTINCT FROM m.result)
             ORDER BY m.round_type, m.id), '[]'::jsonb)
      INTO v_plan
    FROM public.matchups m
    JOIN public.teams th ON th.id = m.home_team_id
    LEFT JOIN public.teams ta ON ta.id = m.away_team_id
    CROSS JOIN LATERAL (
      SELECT (SELECT (b ->> 'points')::numeric FROM jsonb_array_elements(p_teams) b WHERE (b ->> 'team_id')::uuid = m.home_team_id) AS home,
             CASE WHEN m.away_team_id IS NULL THEN m.away_score
                  ELSE (SELECT (b ->> 'points')::numeric FROM jsonb_array_elements(p_teams) b WHERE (b ->> 'team_id')::uuid = m.away_team_id) END AS away
    ) n
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND NOT m.is_overridden;
    SELECT count(*) INTO v_cells FROM jsonb_array_elements(v_plan) p WHERE (p ->> 'changed')::boolean;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'matchup_id', m.id, 'round_type', m.round_type,
             'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id,
             'home_team_name', th.name, 'away_team_name', ta.name,
             'home_score', m.home_score, 'away_score', m.away_score, 'result', m.result,
             'override_action_id', m.override_action_id,
             'why', 'overridden — the commissioner''s number stands; never written by a re-score (§22.2)')
             ORDER BY m.round_type, m.id), '[]'::jsonb)
      INTO v_overridden
    FROM public.matchups m
    JOIN public.teams th ON th.id = m.home_team_id
    LEFT JOIN public.teams ta ON ta.id = m.away_team_id
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND m.is_overridden;

    -- 158's rule: a team's rows follow a score this door may write (≥ 1 non-overridden cell).
    SELECT COALESCE(array_agg(t.id), '{}') INTO v_pp_write
    FROM unnest(v_team_ids) t(id)
    WHERE EXISTS (SELECT 1 FROM public.matchups m
                  WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
                    AND (m.home_team_id = t.id OR m.away_team_id = t.id) AND NOT m.is_overridden);
  END IF;

  -- Per team: its stored (non-overridden) cells → the recompute.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_id', tt.id, 'team_name', tt.name,
           'stored', cells.stored, 'recomputed', (b ->> 'points')::numeric,
           'score_changed', cells.moved) ORDER BY tt.name, tt.id), '[]'::jsonb),
         count(*) FILTER (WHERE cells.moved)
    INTO v_team_lines, v_scores_moved
  FROM jsonb_array_elements(p_teams) b
  JOIN public.teams tt ON tt.id = (b ->> 'team_id')::uuid
  CROSS JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(c.cell), '[]'::jsonb) AS stored,
           COALESCE(bool_or(c.cell IS DISTINCT FROM (b ->> 'points')::numeric), FALSE) AS moved
    FROM (
      SELECT r.points AS cell FROM public.team_week_results r
      WHERE v_mode = 'total_points' AND r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week AND r.team_id = tt.id
      UNION ALL
      SELECT CASE WHEN m.home_team_id = tt.id THEN m.home_score ELSE m.away_score END FROM public.matchups m
      WHERE v_mode <> 'total_points' AND m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
        AND (m.home_team_id = tt.id OR m.away_team_id = tt.id) AND NOT m.is_overridden
    ) c
  ) cells;

  -- The desired per-player rows, and what changes against what is stored.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'team_id', b ->> 'team_id', 'slot', x ->> 'slot', 'player_id', x ->> 'player_id',
           'points', (x ->> 'points')::numeric, 'pending', x -> 'pending', 'reason', x ->> 'reason')), '[]'::jsonb)
    INTO v_want
  FROM jsonb_array_elements(p_teams) b, jsonb_array_elements(b -> 'players') x
  WHERE (b ->> 'team_id')::uuid = ANY (v_pp_write);

  SELECT count(*) INTO v_pp_upsert
  FROM jsonb_to_recordset(v_want) w(team_id uuid, slot text, player_id text, points numeric, pending jsonb, reason text)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.league_week_player_points p
    WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
      AND p.team_id = w.team_id AND p.slot = w.slot
      AND p.player_id = w.player_id AND p.points = w.points AND p.reason = w.reason
      AND p.pending = ARRAY(SELECT jsonb_array_elements_text(w.pending))
      AND p.source <> 'backfill_unrecoverable');
  SELECT count(*) INTO v_pp_delete
  FROM public.league_week_player_points p
  WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
    AND p.team_id = ANY (v_pp_write)
    AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_want) w(team_id uuid, slot text)
                    WHERE w.team_id = p.team_id AND w.slot = p.slot);
  SELECT COALESCE(jsonb_agg(DISTINCT t.team_id), '[]'::jsonb) INTO v_pp_teams
  FROM (
    SELECT w.team_id
    FROM jsonb_to_recordset(v_want) w(team_id uuid, slot text, player_id text, points numeric, pending jsonb, reason text)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.league_week_player_points p
      WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
        AND p.team_id = w.team_id AND p.slot = w.slot
        AND p.player_id = w.player_id AND p.points = w.points AND p.reason = w.reason
        AND p.pending = ARRAY(SELECT jsonb_array_elements_text(w.pending))
        AND p.source <> 'backfill_unrecoverable')
    UNION
    SELECT p.team_id FROM public.league_week_player_points p
    WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
      AND p.team_id = ANY (v_pp_write)
      AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_want) w(team_id uuid, slot text)
                      WHERE w.team_id = p.team_id AND w.slot = p.slot)
  ) t;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'created_at', a.created_at, 'reason', a.reason) ORDER BY a.created_at, a.id), '[]'::jsonb)
    INTO v_prior
  FROM public.commissioner_actions a
  WHERE a.league_id = p_league_id AND a.action_type = 'rescore_final_week'
    AND a.metadata ->> 'season' = v_league.season::text AND a.metadata ->> 'week' = p_week::text;

  -- NO CHANGE IN ANY DIMENSION — detected by value, never inferred from an
  -- empty write (CLAUDE.md "never let nothing happened mean it worked").
  v_no_changes := (v_cells = 0 AND v_pp_upsert = 0 AND v_pp_delete = 0);

  SELECT COALESCE(jsonb_object_agg(r.team_id::text, jsonb_build_object(
           'points', r.points, 'opponent_team_id', r.opponent_team_id, 'h2h_result', r.h2h_result,
           'median_result', r.median_result, 'second_opponent_team_id', r.second_opponent_team_id,
           'second_result', r.second_result, 'is_final', r.is_final)), '{}'::jsonb)
    INTO v_twr_before
  FROM public.team_week_results r
  WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
  v_median_b := v_lw.median_score;

  IF v_no_changes THEN
    v_result := jsonb_build_object(
      'league_id', p_league_id, 'season', v_league.season, 'week', p_week, 'schedule_mode', v_mode,
      'dry_run', p_dry_run, 'action_id', p_action_id, 'commissioner_action_id', NULL,
      'no_changes', TRUE,
      'reason', 'no_changes — every score, result and stored player line of the week already equals the recompute; nothing was written (no audit row, no post, no notification)',
      'team_scores', v_team_lines, 'scores_changed', 0, 'matchups', v_plan, 'overridden', v_overridden,
      'results_changed', '[]'::jsonb, 'flips', '[]'::jsonb,
      'median_score_before', v_median_b, 'median_score_after', v_median_b,
      'player_points', jsonb_build_object('teams_written', 0, 'rows_written', 0, 'rows_removed', 0),
      'standings_rebuilt', FALSE, 'rebuild', NULL, 'system_post', NULL,
      'notified', '[]'::jsonb, 'not_notified', '[]'::jsonb,
      'prior_rescores', v_prior, 'ruling', v_reason, 'member_note', v_note);
  ELSE
    -- (7)–(9): the apply — run in a sub-block so a DRY RUN is the apply itself, rolled back.
    BEGIN
      -- THE AUDIT ROW FIRST (§12.12's order): one per league-week that changes.
      v_audit_id := public.log_commissioner_action_internal(
        p_league_id, p_actor_id, 'rescore_final_week', 'week', v_league.season || ':' || p_week, v_reason,
        jsonb_build_object('week_scores', (SELECT COALESCE(jsonb_agg(CASE WHEN v_mode = 'total_points' THEN jsonb_build_object('team_id', p -> 'team_id', 'points', p -> 'before') ELSE jsonb_build_object('matchup_id', p -> 'matchup_id') || (p -> 'before') END), '[]'::jsonb) FROM jsonb_array_elements(v_plan) p WHERE (p ->> 'changed')::boolean)),
        jsonb_build_object('week_scores', (SELECT COALESCE(jsonb_agg(CASE WHEN v_mode = 'total_points' THEN jsonb_build_object('team_id', p -> 'team_id', 'points', p -> 'after') ELSE jsonb_build_object('matchup_id', p -> 'matchup_id') || (p -> 'after') END), '[]'::jsonb) FROM jsonb_array_elements(v_plan) p WHERE (p ->> 'changed')::boolean)),
        jsonb_build_object(
          'verb',            'admin_rescore_final_week',
          'season',          v_league.season,
          'week',            p_week,
          'schedule_mode',   v_mode,
          'action_id',       p_action_id,
          'member_note',     v_note,
          'cells_changed',   v_cells,
          'scores_changed',  v_scores_moved,
          'overridden_kept', v_overridden,
          'affected_team_ids', to_jsonb(v_team_ids),
          'performed_by',    'operator (service role) on a recorded product ruling — not a commissioner verb'),
        NULL);
      IF v_audit_id IS NULL THEN
        RAISE EXCEPTION 'admin_rescore_final_week: the audit row was not written — refusing to re-score without its receipt (§10.3)'
          USING ERRCODE = 'P0001';
      END IF;
      PERFORM set_config('fieldscout.final_week_rescore', v_audit_id::text, true);

      -- The cells: the scores and the result that goes with them, one statement (F245).
      IF v_mode = 'total_points' THEN
        UPDATE public.team_week_results r
        SET points = p.after
        FROM jsonb_to_recordset(v_plan) AS p(team_id uuid, after numeric, changed boolean)
        WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week
          AND r.team_id = p.team_id AND p.changed;
      ELSE
        UPDATE public.matchups m
        SET home_score = (p.after ->> 'home_score')::numeric,
            away_score = (p.after ->> 'away_score')::numeric,
            result     = p.after ->> 'result',
            updated_at = now()
        FROM jsonb_to_recordset(v_plan) AS p(matchup_id uuid, after jsonb, changed boolean)
        WHERE m.id = p.matchup_id AND p.changed
          AND m.league_id = p_league_id AND NOT m.is_overridden;
      END IF;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> v_cells THEN
        RAISE EXCEPTION 'admin_rescore_final_week: the plan changes % cell(s) but the write touched % — refusing', v_cells, v_cnt
          USING ERRCODE = 'P0001';
      END IF;

      -- The per-player rows follow the score (source `rescore`; the lock's 161 exit).
      DELETE FROM public.league_week_player_points p
      WHERE p.league_id = p_league_id AND p.season = v_league.season AND p.week = p_week
        AND p.team_id = ANY (v_pp_write)
        AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_want) w(team_id uuid, slot text)
                        WHERE w.team_id = p.team_id AND w.slot = p.slot);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> v_pp_delete THEN
        RAISE EXCEPTION 'admin_rescore_final_week: the plan removes % per-player row(s) but the delete touched % — refusing', v_pp_delete, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.league_week_player_points
        (league_id, season, week, team_id, slot, player_id, points, pending, reason, source)
      SELECT p_league_id, v_league.season, p_week, w.team_id, w.slot, w.player_id, w.points,
             ARRAY(SELECT jsonb_array_elements_text(w.pending)), w.reason, 'rescore'
      FROM jsonb_to_recordset(v_want) w(team_id uuid, slot text, player_id text, points numeric, pending jsonb, reason text)
      ON CONFLICT (league_id, season, week, team_id, slot) DO UPDATE
      SET player_id  = EXCLUDED.player_id,
          points     = EXCLUDED.points,
          pending    = EXCLUDED.pending,
          reason     = EXCLUDED.reason,
          source     = EXCLUDED.source,
          updated_at = now()
      WHERE (league_week_player_points.player_id, league_week_player_points.points,
             league_week_player_points.pending, league_week_player_points.reason)
            IS DISTINCT FROM (EXCLUDED.player_id, EXCLUDED.points, EXCLUDED.pending, EXCLUDED.reason)
         OR league_week_player_points.source = 'backfill_unrecoverable';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> v_pp_upsert THEN
        RAISE EXCEPTION 'admin_rescore_final_week: the plan writes % per-player row(s) but the upsert touched % — refusing', v_pp_upsert, v_cnt
          USING ERRCODE = 'P0001';
      END IF;
      PERFORM set_config('fieldscout.final_week_rescore', '', true);

      -- THE RESULTS MATH finalization calls (126 → week_results_write_internal).
      v_rebuild := public.rebuild_team_week_results(p_league_id, p_week);

      SELECT COALESCE(jsonb_object_agg(r.team_id::text, jsonb_build_object(
               'points', r.points, 'opponent_team_id', r.opponent_team_id, 'h2h_result', r.h2h_result,
               'median_result', r.median_result, 'second_opponent_team_id', r.second_opponent_team_id,
               'second_result', r.second_result, 'is_final', r.is_final)), '{}'::jsonb)
        INTO v_twr_after
      FROM public.team_week_results r
      WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
      SELECT lw.median_score INTO v_median_a FROM public.league_weeks lw WHERE lw.id = v_lw.id;

      -- Every team whose RESULT changed (h2h, second-opponent, median).
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'team_id', t.id, 'team_name', t.name,
               'before', v_twr_before -> (t.id::text), 'after', v_twr_after -> (t.id::text)) ORDER BY t.name, t.id), '[]'::jsonb)
        INTO v_changes
      FROM public.teams t
      WHERE t.league_id = p_league_id
        AND (v_twr_before ? (t.id::text) OR v_twr_after ? (t.id::text))
        AND ((v_twr_before -> (t.id::text) ->> 'h2h_result')    IS DISTINCT FROM (v_twr_after -> (t.id::text) ->> 'h2h_result')
          OR (v_twr_before -> (t.id::text) ->> 'median_result') IS DISTINCT FROM (v_twr_after -> (t.id::text) ->> 'median_result')
          OR (v_twr_before -> (t.id::text) ->> 'second_result') IS DISTINCT FROM (v_twr_after -> (t.id::text) ->> 'second_result'));
      SELECT COALESCE(jsonb_agg(p ORDER BY p ->> 'round_type', p ->> 'matchup_id'), '[]'::jsonb) INTO v_flips
      FROM jsonb_array_elements(v_plan) p
      WHERE (p ->> 'result_changed')::boolean;

      -- (8) THE LEAGUE POST — plain words.
      v_post := 'Week ' || p_week || ' was re-scored: ' || v_note || '.';
      IF jsonb_array_length(v_flips) > 0 THEN
        SELECT ' Result changed: ' || string_agg(
                 CASE WHEN f #>> '{after,result}' = 'tie'
                      THEN (f ->> 'home_team_name') || ' and ' || (f ->> 'away_team_name') || ' tied '
                           || to_char((f #>> '{after,home_score}')::numeric, 'FM999999990.00') || '–' || to_char((f #>> '{after,away_score}')::numeric, 'FM999999990.00')
                      ELSE (CASE WHEN f #>> '{after,result}' = 'home' THEN f ->> 'home_team_name' ELSE f ->> 'away_team_name' END)
                           || ' beat '
                           || (CASE WHEN f #>> '{after,result}' = 'home' THEN f ->> 'away_team_name' ELSE f ->> 'home_team_name' END)
                           || ' ' || to_char(greatest((f #>> '{after,home_score}')::numeric, (f #>> '{after,away_score}')::numeric), 'FM999999990.00')
                           || '–' || to_char(least((f #>> '{after,home_score}')::numeric, (f #>> '{after,away_score}')::numeric), 'FM999999990.00')
                 END
                 || ' (first scored '
                 || CASE WHEN f #>> '{before,result}' = 'tie'
                         THEN 'a ' || to_char((f #>> '{before,home_score}')::numeric, 'FM999999990.00') || '–' || to_char((f #>> '{before,away_score}')::numeric, 'FM999999990.00') || ' tie'
                         WHEN f #>> '{before,result}' IN ('home', 'away')
                         THEN (CASE WHEN f #>> '{before,result}' = 'home' THEN f ->> 'home_team_name' ELSE f ->> 'away_team_name' END)
                              || ' ' || to_char(greatest((f #>> '{before,home_score}')::numeric, (f #>> '{before,away_score}')::numeric), 'FM999999990.00')
                              || '–' || to_char(least((f #>> '{before,home_score}')::numeric, (f #>> '{before,away_score}')::numeric), 'FM999999990.00')
                         ELSE 'with no result' END
                 || ')', '; ' ORDER BY f ->> 'round_type', f ->> 'matchup_id') || '.'
          INTO v_sentence
        FROM jsonb_array_elements(v_flips) f;
        v_post := v_post || v_sentence;
      ELSE
        v_post := v_post || ' No matchup result changed.';
      END IF;
      SELECT string_agg((c ->> 'team_name') || ' now ' || CASE c #>> '{after,median_result}' WHEN 'win' THEN 'a win' WHEN 'loss' THEN 'a loss' WHEN 'tie' THEN 'a tie' ELSE 'no result' END
                        || ' (was ' || CASE c #>> '{before,median_result}' WHEN 'win' THEN 'a win' WHEN 'loss' THEN 'a loss' WHEN 'tie' THEN 'a tie' ELSE 'no result' END || ')', '; '
                        ORDER BY c ->> 'team_name')
        INTO v_sentence
      FROM jsonb_array_elements(v_changes) c
      WHERE (c #>> '{before,median_result}') IS DISTINCT FROM (c #>> '{after,median_result}');
      IF v_sentence IS NOT NULL THEN
        v_post := v_post || ' Median game: ' || v_sentence || '.';
      END IF;
      IF jsonb_array_length(v_overridden) > 0 THEN
        SELECT string_agg((o ->> 'home_team_name') || COALESCE(' vs ' || (o ->> 'away_team_name'), ''), '; ' ORDER BY o ->> 'matchup_id')
          INTO v_sentence
        FROM jsonb_array_elements(v_overridden) o;
        v_post := v_post || ' The commissioner-set score was kept for ' || v_sentence || '.';
      END IF;
      v_post := v_post || ' ' || v_scores_moved || CASE WHEN v_scores_moved = 1 THEN ' team score changed' ELSE ' team scores changed' END
        || '; standings are updated.';
      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
      VALUES (p_league_id, NULL, v_post, 'league', TRUE);

      -- (8) THE MANAGERS WHOSE RESULT CHANGED — each seated manager, once.
      FOR v_x IN SELECT c FROM jsonb_array_elements(v_changes) c LOOP
        v_tid := (v_x.c ->> 'team_id')::uuid;
        SELECT m.user_id INTO v_user
        FROM public.league_members m
        WHERE m.league_id = p_league_id AND m.team_id = v_tid AND m.user_id IS NOT NULL;   -- UNIQUE (league_id, team_id) — 052
        IF v_user IS NULL THEN
          v_not_notified := v_not_notified || jsonb_build_object('team_id', v_tid, 'why', 'no_seated_manager');
          CONTINUE;
        END IF;
        v_body := 'Week ' || p_week || ' was re-scored: ' || v_note || '. Your score: '
          || COALESCE(to_char((v_x.c #>> '{before,points}')::numeric, 'FM999999990.00'), '—') || ' → '
          || COALESCE(to_char((v_x.c #>> '{after,points}')::numeric, 'FM999999990.00'), '—') || '.';
        IF (v_x.c #>> '{before,h2h_result}') IS DISTINCT FROM (v_x.c #>> '{after,h2h_result}') THEN
          SELECT t.name INTO v_sentence FROM public.teams t WHERE t.id = (v_x.c #>> '{after,opponent_team_id}')::uuid;
          v_body := v_body || ' Your matchup' || COALESCE(' vs ' || v_sentence, '') || ' is now '
            || CASE v_x.c #>> '{after,h2h_result}' WHEN 'win' THEN 'a win' WHEN 'loss' THEN 'a loss' WHEN 'tie' THEN 'a tie' ELSE 'without a result' END
            || ' (it was ' || CASE v_x.c #>> '{before,h2h_result}' WHEN 'win' THEN 'a win' WHEN 'loss' THEN 'a loss' WHEN 'tie' THEN 'a tie' ELSE 'without a result' END || ').';
        END IF;
        IF (v_x.c #>> '{before,second_result}') IS DISTINCT FROM (v_x.c #>> '{after,second_result}') THEN
          v_body := v_body || ' Your second matchup is now '
            || CASE v_x.c #>> '{after,second_result}' WHEN 'win' THEN 'a win' WHEN 'loss' THEN 'a loss' WHEN 'tie' THEN 'a tie' ELSE 'without a result' END
            || ' (it was ' || CASE v_x.c #>> '{before,second_result}' WHEN 'win' THEN 'a win' WHEN 'loss' THEN 'a loss' WHEN 'tie' THEN 'a tie' ELSE 'without a result' END || ').';
        END IF;
        IF (v_x.c #>> '{before,median_result}') IS DISTINCT FROM (v_x.c #>> '{after,median_result}') THEN
          v_body := v_body || ' Your median game is now '
            || CASE v_x.c #>> '{after,median_result}' WHEN 'win' THEN 'a win' WHEN 'loss' THEN 'a loss' WHEN 'tie' THEN 'a tie' ELSE 'without a result' END
            || ' (it was ' || CASE v_x.c #>> '{before,median_result}' WHEN 'win' THEN 'a win' WHEN 'loss' THEN 'a loss' WHEN 'tie' THEN 'a tie' ELSE 'without a result' END || ').';
        END IF;
        v_body := v_body || ' Standings are updated.';
        INSERT INTO public.notifications (user_id, type, title, body, data)
        VALUES (v_user, 'league_week_rescored', 'Week ' || p_week || ' was re-scored — your result changed', v_body,
                jsonb_build_object('league_id', p_league_id, 'team_id', v_tid, 'season', v_league.season, 'week', p_week,
                                   'commissioner_action_id', v_audit_id));
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION 'admin_rescore_final_week: the notification for team % wrote % rows, expected 1', v_tid, v_cnt
            USING ERRCODE = 'P0001';
        END IF;
        v_notified := v_notified || jsonb_build_object('team_id', v_tid, 'user_id', v_user, 'body', v_body);
      END LOOP;

      v_result := jsonb_build_object(
        'league_id', p_league_id, 'season', v_league.season, 'week', p_week, 'schedule_mode', v_mode,
        'dry_run', p_dry_run, 'action_id', p_action_id,
        'commissioner_action_id', CASE WHEN p_dry_run THEN NULL ELSE v_audit_id END,
        'no_changes', FALSE, 'reason', NULL,
        'team_scores', v_team_lines, 'scores_changed', v_scores_moved,
        'matchups', v_plan, 'overridden', v_overridden,
        'results_changed', v_changes, 'flips', v_flips,
        'median_score_before', v_median_b, 'median_score_after', v_median_a,
        'player_points', jsonb_build_object('teams_written', jsonb_array_length(v_pp_teams), 'rows_written', v_pp_upsert, 'rows_removed', v_pp_delete),
        'standings_rebuilt', TRUE, 'rebuild', v_rebuild,
        'system_post', v_post, 'notified', v_notified, 'not_notified', v_not_notified,
        'prior_rescores', v_prior, 'ruling', v_reason, 'member_note', v_note);

      IF p_dry_run THEN
        RAISE EXCEPTION 'admin_rescore_final_week: dry run — rolled back' USING ERRCODE = 'FSDRY';
      END IF;
    EXCEPTION WHEN SQLSTATE 'FSDRY' THEN
      -- The DRY RUN: every write above is rolled back with this sub-block
      -- (the audit row, the cells, the rows, the rebuild, the post, the
      -- notifications, their broadcasts and the transaction-local settings);
      -- the document is kept. Any OTHER error is not caught here and
      -- propagates — a dry run that would fail as an apply fails the same way.
      NULL;
    END;
  END IF;

  IF NOT p_dry_run THEN
    INSERT INTO public.admin_rescore_actions (league_id, season, week, action_id, actor_id, result)
    VALUES (p_league_id, v_league.season, p_week, p_action_id, p_actor_id, v_result);
  END IF;

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION admin_rescore_final_week(UUID, INTEGER, JSONB, TEXT, TEXT, UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION admin_rescore_final_week(UUID, INTEGER, JSONB, TEXT, TEXT, UUID, UUID, BOOLEAN) IS
  'Migration 161 (M5 L.D3.13; PROGRESS D425; spec §11.4 v2.16.70): the ONE sanctioned re-score of a FINAL league-week, on a recorded product ruling (Chris 2026-09-29: "re-score weeks 1 and 2 with the actual yards"). Service role only. Re-writes the week''s non-overridden scores + the E38 result with them, the per-player rows (source rescore), then the results math finalization calls (rebuild_team_week_results); one audit row, one league post, a notification per manager whose result changed. Dry run (the default) = the apply rolled back. Replay by action_id; no change ⇒ no_changes, nothing written. Driven by npm run rescore:final-weeks.';
