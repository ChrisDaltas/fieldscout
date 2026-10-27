-- ============================================================================
-- 212 — leagues are ARCHIVED, never deleted; the commissioner restores them
--       (ledger F716; Chris 2026-10-27; spec §7.2 / §12.1 / §15.1 / §17
--       v2.16.109; PROGRESS D780–D788; FULL rigour — permissions, scheduled
--       jobs; amended in place for the PR #543 review, unpushed)
-- ============================================================================
--
-- THE RULING (Chris, 2026-10-27, relayed verbatim by the orchestrator):
--   "I don't really see the need to delete the league permanently" — asked,
--   he chose "Archive, commissioner can restore".
-- And on the review's questions (2026-10-27, verbatim): trades (R1728) —
--   "the trade goes away and has to be redone later"; mid-draft (R1726) —
--   "Block it until the draft ends".
-- So: "Delete league" becomes ARCHIVE LEAGUE. Only the commissioner archives
-- (co-commissioners and managers are refused). An archived league leaves
-- every member's league list and navigation but keeps all of its data and
-- history; the commissioner can RESTORE it at any time and it comes back
-- exactly as it was. While it is archived NOTHING in it changes: the
-- scheduled jobs skip it and no member can act in it.
--
-- THE STATE — `leagues.deleted_at` IS REPURPOSED AS "archived at" (D780).
--   It was already the one "this league is gone" flag every reader honours:
--   the league list and detail reads, every scheduled job's league claim
--   (waiver_tick, league_week_advance, finalize_matchups, lineup_lock_tick,
--   draft_tick), the TS scoring fan-out / reconcile / re-poll / player
--   values reads, the invite and join paths, and ~40 RPC bodies that treat
--   such a league as not found. Its only writer was `soft_delete_league`,
--   which nothing in the app calls (measured by L.F2.8; PROGRESS F716). A
--   new column would have needed every one of those readers re-cut — and the
--   TS ones would select a column production does not have until the push
--   (deploy before push). Repurposed, the code merged before the push keeps
--   working on the older schema, and every existing filter now means
--   "archived". The cost is the name; COMMENT ON COLUMN says what it means.
--   `archived_by` (new, nullable, profiles ON DELETE SET NULL) records who.
--   Any league already soft-deleted becomes an archived league its
--   commissioner can restore — which is the ruling ("no need to delete
--   permanently"). Production count to read before the push: PROGRESS D780.
--
-- WHAT THIS ADDS / CHANGES
--
--   1. `archive_league(league, reason?)` / `restore_league(league, reason?)`
--      — SECURITY DEFINER doors, search_path '', each handing now() to a
--      PLAIN REVOKEd `_internal(…, p_at)`. The gate, in-body: the caller is
--      THIS league's `commissioner` (league_members.role — exactly one per
--      league, 063's one_commissioner_per_league); a co-commissioner, a
--      manager, a non-member, anon and a missing league get ONE 42501.
--      Repeat-safe by state: archiving an archived league / restoring a live
--      one writes NOTHING and says why. A real change writes ONE
--      `commissioner_actions` receipt (archive_league / restore_league,
--      {archived} before → after) through 168's seam and ONE plain league
--      line ("<username> archived the league." / "… restored the league."),
--      the reason (optional, ≤ 500) as the conditional "— reason:" clause.
--      ORDER (forced by the backstop, D357(3)'s precedent): archive writes
--      its receipt and line BEFORE it stamps `deleted_at`; restore clears it
--      FIRST and then writes them — so the guard below never meets them.
--      ARCHIVE IS REFUSED WHILE A DRAFT IS IN PROGRESS (D781 — Chris ruled
--      it, R1726): the league is `drafting`, or its real draft is live or
--      paused — "finish or reset the draft first". Everything else (setup,
--      scheduled, in season, playoffs, complete) archives.
--      ARCHIVE CANCELS EVERY TRADE NOT FINISHED (D787 — Chris ruled it,
--      R1728): offered, in review or a league vote, accepted but waiting —
--      status `cancelled`, reason "Cancelled because the league was archived
--      — propose it again after it's restored.", both managers notified
--      (`league_trade_cancelled`), one league line listing them, the ids in
--      the receipt's metadata. Nothing is held, so nothing executes on
--      restore.
--      RESTORE CATCHES SCORING UP (D782): the scoring fan-out skipped the
--      league while it was archived, so restore re-queues `score_fanout`
--      for every rostered player with a stat line in each of the league's
--      not-final weeks (upcoming rows are HELD by the worker until the week
--      opens — §22.2's own rule), exactly as ingestion would have, stamped
--      `deferred_until = p_at` (R1731: fresh to the stall check). Nothing
--      else is replayed or shifted: waivers that came due run at the next
--      tick and weeks advance and finalize under their normal rules, as
--      after an operator pause (TD4 / 183) — BUILDER DEFAULTS pending Chris
--      (Q104), as is the draft exception below. The two doors share
--      `league_restore_apply_internal` (the unstamp + the re-queue).
--   1b. F851 — `op_restore_league(league, action_id, reason?)`: a platform
--      operator restores an archived league (its commissioner may be gone),
--      through `op_archived_league_prelude_internal` (184's prelude, but the
--      row lock is taken whatever the stamp and a missing league is named as
--      missing — R1733), the shared apply, one `platform_operator_actions`
--      receipt and a "FieldScout restored the league." line; no
--      commissioner_actions row (D671). op_set_commissioner can then seat a
--      commissioner. 184's own prelude now names an archived league as
--      archived ("restore it first") instead of "does not exist" (R1733).
--   1c. R1730 — `finalize_matchups` never finalizes a league-week while a
--      score for one of the league's rostered players is still in
--      `score_fanout` (skipped by name, `scores_queued`) — the general rule,
--      for every league; it is what makes the restore's catch-up safe.
--   1d. R1725 — an ARCHIVED league still counts as a user of its scoring
--      system: `scoring_system_league_use_internal` (170) and 104's rules
--      guard drop `deleted_at IS NULL`, so an archived league's custom
--      scoring stays behind the receipted editor and the validator.
--
--   2. THE FREEZE — `league_archived_guard_internal()`, a BEFORE INSERT /
--      UPDATE / DELETE ROW trigger on every table that holds a league's
--      state (D783): refuses the write when its row belongs to an archived
--      league — 55000, "This league is archived …". The league is found
--      through the row's own `league_id`, or its draft / team / trade
--      (TG_ARGV[0] names the column). A write made BY another trigger
--      (pg_trigger_depth() > 1: an FK action — a profile or a whole league
--      removed — or a guarded table's own trigger chain, which a checked
--      statement started) passes, so deleting an account is never blocked
--      by an archived league it belonged to. `leagues` itself gets
--      `league_row_archived_guard_internal()`: while archived, the ONLY
--      update allowed is the restore (deleted_at → NULL with nothing but
--      archived_by / updated_at moving). Default ENABLE (ORIGIN), not
--      ALWAYS, so a replica-mode data restore (PITR runbook) is not refused.
--      Exempt by design, named in pgTAP 162's census: `job_pauses` and
--      `platform_operator_actions` (operator state; every op_* verb's
--      prelude already refuses an archived league, 184).
--
--   3. THE JOBS (D784) — every scheduled job skips an archived league:
--        waiver_tick · league_week_advance · finalize_matchups ·
--        lineup_lock_tick · draft_tick (all three arms)  — already, through
--          their `deleted_at IS NULL` league claims (183 / 181 / 097);
--          pgTAP 162 proves each, against an identical un-archived control.
--        trade_tick — 2 hunks (199 FILE TEXT): it used to SWEEP a deleted
--          league's open trades to `invalid`; now an archived league is not
--          a candidate and is not claimed — its trades stay exactly as they
--          are.
--        mock_draft_expire — 1 hunk (095 FILE TEXT): an archived league's
--          practice drafts are not expired while it is archived.
--        draft_tick ARM 1 — 1 hunk (097 FILE TEXT): a draft time that passed
--          while the league was archived (at or before its latest restore
--          receipt) does not start the draft by itself — the league comes
--          back with its draft waiting; the commissioner starts it or sets a
--          new time (D785). Every other draft_tick arm is unchanged.
--        the scoring fan-out (TS, `score-week-worker.ts`) — already skips a
--          league with `deleted_at` set (roster map + league read); proven
--          over the real stack in `league-archive-scoring-db.test.ts`.
--
--   4. `soft_delete_league` is RETIRED (D786): its body is replaced whole by
--      a refusal BY NAME for every caller (0A000 — "leagues are archived,
--      not deleted"). It was the co-commissioner door F716 found; no screen
--      called it. `DELETE /api/leagues/[id]` answers 405 with the same words.
--
-- D137 — the three job bodies are CREATE OR REPLACE against their NEWEST
-- defining FILE TEXT (`grep -n "FUNCTION <name>(" supabase/migrations/*`),
-- derived by script: only lines marked `-- 212 / F716` are inserted, each
-- after an anchor asserted unique, and stripping those lines gives the file
-- text back byte for byte (pgTAP 162 A9 pins that through pg_temp.un212):
--   trade_tick                          199:7426-7592  2 hunks (+2 / -0)
--   mock_draft_expire                   095:1308-1402  1 hunk  (+1 / -0)
--   draft_tick                          097:55-1044    1 hunk  (+1 / -0)
--   finalize_matchups                   183:876-1149   1 hunk  (+6 / -0)   R1730
--   op_verb_prelude_internal            184:573-617    1 hunk  (+1 / -0)   R1733
--   scoring_system_league_use_internal  170:2480-2497  1 hunk  (+1 / -1)   R1725 — a REPLACED line, marked `-- F716 / 212`
--   scoring_systems_rules_guard         104:391-468    1 hunk  (+1 / -1)   R1725 — likewise (their md5 pins are re-cut)
--   soft_delete_league                  169:1929-1973  replaced whole (retired — not a hunk)
-- 210 (PR #541, unmerged when this was written) adds
-- scoring_system_label_lock_internal with the same `deleted_at IS NULL`
-- filter: WHOEVER MERGES SECOND drops it under D137 against 210 (F858).
--
-- MIGRATION CHECKLIST (tasks-M* §4.4):
--   * One column (nullable, FK ON DELETE SET NULL, a CHECK that it is set
--     only while archived); no new table, no policy change (`leagues` keeps
--     its one member SELECT — members still read an archived league's row,
--     which is how "Archived leagues" lists it).
--   * New functions all search_path ''. DEFINER only on the two doors (in-body
--     gate; REVOKE PUBLIC / anon; EXECUTE authenticated) and the two trigger
--     functions (not callable; REVOKE ALL from PUBLIC / anon / authenticated,
--     the house's trigger posture). Internals PLAIN, REVOKEd from PUBLIC /
--     anon / authenticated. Replaced bodies keep their DEFINER / search_path
--     and their REVOKEs are restated.
--   * Time only through p_at (the doors pass now()).
--   * Typegen: one column + the doors' and internals' signatures (additive; alias block
--     kept — hand-merged, F792).
--   * WAIVERS: R6 — no staging clone; rehearsal evidence = applied to the
--     shared local DB with psql over 001–210 (+ 211 if present) plus the
--     pgTAP run in the PR (no reset: the local DB is shared — the one-local-
--     db rule). D38 — no backfill: no stored row changes; a league already
--     soft-deleted reads as archived from now on (the ruling's intent).
--   * Deploy-before-push safe: the new routes answer 503 by name until this
--     is pushed (PGRST202); the archived-leagues read selects only columns
--     production already has; nothing else changes until the push.
--   * Rollback: DROP the two doors + internals + trigger functions (CASCADE
--     drops the triggers), restore the three bodies from their files and
--     soft_delete_league from 169, ALTER TABLE leagues DROP COLUMN archived_by.
-- pgTAP 162_league_archive.sql; stack vitest league-archive-scoring-db.test.ts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The state
-- ---------------------------------------------------------------------------
ALTER TABLE leagues
  ADD COLUMN archived_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE leagues
  ADD CONSTRAINT leagues_archived_by_only_while_archived
  CHECK (archived_by IS NULL OR deleted_at IS NOT NULL);

COMMENT ON COLUMN leagues.deleted_at IS
  'Migration 212 (F716, Chris 2026-10-27 — leagues are archived, never deleted): ARCHIVED AT. Set by archive_league (the commissioner), cleared by restore_league. While set the league is frozen: hidden from members'' league lists, skipped by every scheduled job, and every write to its rows is refused by league_archived_guard_internal. The name predates the ruling (renaming it would break the code deployed before the push).';
COMMENT ON COLUMN leagues.archived_by IS
  'Migration 212 (F716): the commissioner who archived the league; NULL while it is not archived (CHECK), or if that profile is gone.';

-- ---------------------------------------------------------------------------
-- 2. The freeze — the trigger functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_archived_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key    TEXT := TG_ARGV[0];   -- league_id | draft_id | team_id | trade_id
  v_new    UUID;
  v_old    UUID;
  v_ids    UUID[];
BEGIN
  -- A write made BY another trigger passes: an FK action (a profile or a
  -- whole league removed) or a guarded table's own trigger chain, which a
  -- statement this guard already checked started. Only a statement's own
  -- rows (depth 1) are judged.
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- The row's own key, from NEW (insert / update) and OLD (update / delete).
  -- PL/pgSQL compiles a trigger function per table, so only the branch for
  -- this table's key is ever evaluated against its row type.
  IF v_key = 'league_id' THEN
    IF TG_OP <> 'DELETE' THEN v_new := NEW.league_id; END IF;
    IF TG_OP <> 'INSERT' THEN v_old := OLD.league_id; END IF;
    v_ids := ARRAY[v_new, v_old];
  ELSIF v_key = 'draft_id' THEN
    IF TG_OP <> 'DELETE' THEN v_new := NEW.draft_id; END IF;
    IF TG_OP <> 'INSERT' THEN v_old := OLD.draft_id; END IF;
    v_ids := ARRAY(SELECT d.league_id FROM public.drafts d WHERE d.id IN (v_new, v_old));
  ELSIF v_key = 'team_id' THEN
    IF TG_OP <> 'DELETE' THEN v_new := NEW.team_id; END IF;
    IF TG_OP <> 'INSERT' THEN v_old := OLD.team_id; END IF;
    v_ids := ARRAY(SELECT t.league_id FROM public.teams t WHERE t.id IN (v_new, v_old));
  ELSIF v_key = 'trade_id' THEN
    IF TG_OP <> 'DELETE' THEN v_new := NEW.trade_id; END IF;
    IF TG_OP <> 'INSERT' THEN v_old := OLD.trade_id; END IF;
    v_ids := ARRAY(SELECT t.league_id FROM public.trades t WHERE t.id IN (v_new, v_old));
  ELSE
    RAISE EXCEPTION 'league_archived_guard_internal: unknown key column % on %', v_key, TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.leagues l
             WHERE l.id = ANY (v_ids) AND l.deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This league is archived, so nothing in it can change. Its commissioner can restore it from Leagues › Archived leagues.'
      USING ERRCODE = '55000',
            DETAIL = format('league_archived: %s on %s', TG_OP, TG_TABLE_NAME);
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION league_archived_guard_internal() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION league_archived_guard_internal() IS
  'Migration 212 (F716): the archive freeze. BEFORE INSERT / UPDATE / DELETE ROW on every table holding a league''s state; refuses (55000) a write whose row belongs to an archived league (leagues.deleted_at set), found through TG_ARGV[0] — league_id, or the row''s draft / team / trade. Writes made by another trigger (pg_trigger_depth() > 1 — FK actions, a checked statement''s own trigger chain) pass.';

CREATE OR REPLACE FUNCTION league_row_archived_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;   -- an FK action (ON DELETE SET NULL of a removed profile)
  END IF;
  IF OLD.deleted_at IS NULL THEN
    RETURN NEW;   -- not archived: every rule that applies already applies
  END IF;
  -- Archived: the one update allowed is the restore — deleted_at cleared,
  -- with nothing but archived_by / updated_at moving alongside it.
  IF NEW.deleted_at IS NULL
     AND (to_jsonb(NEW) - ARRAY['deleted_at', 'archived_by', 'updated_at'])
       = (to_jsonb(OLD) - ARRAY['deleted_at', 'archived_by', 'updated_at']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This league is archived, so nothing in it can change. Its commissioner can restore it from Leagues › Archived leagues.'
    USING ERRCODE = '55000',
          DETAIL = 'league_archived: UPDATE on leagues';
END;
$$;
REVOKE ALL ON FUNCTION league_row_archived_guard_internal() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION league_row_archived_guard_internal() IS
  'Migration 212 (F716): BEFORE UPDATE on leagues — while a league is archived the only update allowed is restore_league''s (deleted_at → NULL, archived_by / updated_at alongside, nothing else).';

-- The triggers. `tr_aa_` sorts first among each table's BEFORE triggers
-- (tr_ < trg_; aa < every other tr_ name), so a refused write runs no other
-- trigger's side effect first (the chat limiter, the pointer guards).
CREATE TRIGGER tr_aa_league_row_archived_guard
  BEFORE UPDATE ON leagues
  FOR EACH ROW EXECUTE FUNCTION league_row_archived_guard_internal();

-- One trigger per table that holds a league's state — written out, not
-- looped, so every table is named in plain SQL (pgTAP 162 A3 / A4 is the
-- census that no table is missing).
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON admin_rescore_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_autopilot_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_bracket_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_faab_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_lineup_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_matchup_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_roster_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_schedule_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_setting_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_team_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commish_trade_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON commissioner_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON draft_bids
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON draft_budget_adjustments
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON draft_picks
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON drafts
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_chat
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_invites
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_lists
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_members
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_player_pool
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_player_values
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_rosters
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_stat_corrections
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_week_player_points
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON league_weeks
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON lineup_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON matchups
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON schedule_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON team_managers
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON team_week_results
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON teams
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON trade_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON trades
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON waiver_claim_actions
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON waiver_claims
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON waiver_runs
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('league_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON draft_dnd_marks
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('draft_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON draft_liveness
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('draft_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON draft_queues
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('draft_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON team_autopilot
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('team_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON team_lineups
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('team_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON trade_drops
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('trade_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON trade_items
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('trade_id');
CREATE TRIGGER tr_aa_league_archived_guard BEFORE INSERT OR UPDATE OR DELETE ON trade_votes
  FOR EACH ROW EXECUTE FUNCTION league_archived_guard_internal('trade_id');

-- ---------------------------------------------------------------------------
-- 3. archive_league / restore_league
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION league_archive_who_internal(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT p.username FROM public.profiles p WHERE p.id = p_user), 'The commissioner');
$$;
REVOKE ALL ON FUNCTION league_archive_who_internal(UUID) FROM PUBLIC, anon, authenticated;

-- The trade reason (R1728 — Chris 2026-10-27: "the trade goes away and has
-- to be redone later"). One place, so the trade row, the notification and
-- the league line say the same words.
CREATE OR REPLACE FUNCTION league_archive_trade_reason_internal()
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 'Cancelled because the league was archived — propose it again after it''s restored.'::text;
$$;
REVOKE ALL ON FUNCTION league_archive_trade_reason_internal() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION archive_league_internal(
  p_league_id UUID,
  p_reason    TEXT,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actor     UUID := auth.uid();
  v_league    public.leagues;
  v_found     BOOLEAN;
  v_reason    TEXT;
  v_receipt   UUID;
  v_post      TEXT;
  v_cnt       INTEGER;
  v_t         RECORD;
  v_n         UUID;
  v_trade_ids UUID[] := '{}';
  v_summaries TEXT[] := '{}';
  v_notified  JSONB := '[]'::jsonb;
  v_trade_why TEXT := public.league_archive_trade_reason_internal();
  v_trade_post TEXT;
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'archive_league: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row first (the house lock order): two archives, or
  --     an archive and a restore, serialize; a job that holds the row (every
  --     job claims leagues FOR UPDATE SKIP LOCKED) finishes its run first,
  --     and no run claims the league afterwards.
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id FOR UPDATE;
  v_found := FOUND;

  -- (2) THE GATE — the league's commissioner only (F716 / the ruling). One
  --     no-leak 42501 for a co-commissioner, a manager, a non-member, a
  --     signed-out caller and a missing league.
  IF v_actor IS NULL OR NOT v_found OR NOT EXISTS (
       SELECT 1 FROM public.league_members m
       WHERE m.league_id = p_league_id AND m.user_id = v_actor AND m.role = 'commissioner') THEN
    RAISE EXCEPTION 'archive_league: only the league''s commissioner can archive it — a co-commissioner or a manager cannot'
      USING ERRCODE = '42501';
  END IF;

  -- (3) THE REASON — optional (Q66), ≤ 500.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'archive_league: the reason is % characters — keep it to 500 or fewer', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (4) REPEAT-SAFE: already archived — nothing written, and it says so.
  IF v_league.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'changed', FALSE, 'archived', TRUE,
      'archived_at', v_league.deleted_at,
      'why', 'already_archived — this league is already archived; nothing was written',
      'commissioner_action_id', NULL, 'trades_cancelled', 0, 'evaluated_at', p_at);
  END IF;

  -- (5) D781 — Chris ruled R1726 (2026-10-27, "Block it until the draft
  --     ends"): never mid-draft.
  IF v_league.status = 'drafting' OR EXISTS (
       SELECT 1 FROM public.drafts d
       WHERE d.league_id = p_league_id AND NOT d.is_mock AND d.status IN ('live', 'paused')) THEN
    RAISE EXCEPTION 'archive_league: the draft is in progress — finish or reset the draft before archiving the league'
      USING ERRCODE = '55000';
  END IF;

  -- (6) R1728 — Chris 2026-10-27: "the trade goes away and has to be redone
  --     later". Every trade not finished — offered, in review or a league
  --     vote, accepted but waiting (deferred) — is CANCELLED now, with the
  --     reason on the trade, both managers told, and one league line below.
  --     Nothing is held, so nothing can execute on restore. Before the
  --     stamp, so the freeze never meets these writes.
  FOR v_t IN
    UPDATE public.trades t
    SET status = 'cancelled', status_reason = v_trade_why, resolved_at = p_at, resolved_by = v_actor
    WHERE t.league_id = p_league_id AND t.status IN ('proposed', 'accepted', 'in_review')
    RETURNING t.id, t.proposer_team_id, t.recipient_team_id, t.created_at
  LOOP
    v_trade_ids := v_trade_ids || v_t.id;
    v_summaries := v_summaries || COALESCE(
      public.trade_summary_internal(v_t.id),
      (SELECT pt.name FROM public.teams pt WHERE pt.id = v_t.proposer_team_id) || ' ↔ '
        || (SELECT rt.name FROM public.teams rt WHERE rt.id = v_t.recipient_team_id));
    FOR v_n IN
      SELECT public.trade_notify_team_internal(
        p_league_id, side, 'league_trade_cancelled', 'A trade was cancelled',
        COALESCE(v_summaries[array_upper(v_summaries, 1)], 'A trade') || ' — ' || v_trade_why,
        jsonb_build_object('trade_id', v_t.id, 'status', 'cancelled', 'reason', 'league_archived'), FALSE)
      FROM unnest(ARRAY[v_t.proposer_team_id, v_t.recipient_team_id]) side
    LOOP
      IF v_n IS NOT NULL THEN v_notified := v_notified || to_jsonb(v_n); END IF;
    END LOOP;
  END LOOP;

  -- (7) THE RECEIPT AND THE LINES — BEFORE the stamp (the banner's ORDER).
  v_receipt := public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'archive_league', 'archive_league', 'league', p_league_id::text, v_reason,
    jsonb_build_object('archived', FALSE),
    jsonb_build_object('archived', TRUE),
    jsonb_build_object('status', v_league.status, 'season', v_league.season,
                       'cancelled_trade_ids', to_jsonb(v_trade_ids)));
  v_post := public.league_archive_who_internal(v_actor) || ' archived the league'
    || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END || '.';
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, NULL, v_post, 'league', TRUE);
  IF cardinality(v_trade_ids) > 0 THEN
    v_trade_post := 'Archiving the league cancelled ' || cardinality(v_trade_ids)
      || CASE WHEN cardinality(v_trade_ids) = 1 THEN ' trade that wasn''t finished — propose it' ELSE ' trades that weren''t finished — propose them' END
      || ' again after the league is restored: ' || array_to_string(v_summaries, '; ') || '.';
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, NULL, v_trade_post, 'league', TRUE);
  END IF;

  -- (8) THE STAMP — from here the league is frozen.
  UPDATE public.leagues
  SET deleted_at = p_at, archived_by = v_actor, updated_at = p_at
  WHERE id = p_league_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'archive_league: the archive touched % rows, expected exactly 1 (league %)', v_cnt, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'league_id', p_league_id, 'changed', TRUE, 'archived', TRUE,
    'archived_at', p_at, 'status', v_league.status,
    'commissioner_action_id', v_receipt, 'post', v_post,
    'trades_cancelled', cardinality(v_trade_ids), 'cancelled_trade_ids', to_jsonb(v_trade_ids),
    'trade_post', v_trade_post, 'notified_user_ids', v_notified,
    'reason', v_reason, 'evaluated_at', p_at);
END;
$$;
REVOKE ALL ON FUNCTION archive_league_internal(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION archive_league_internal(UUID, TEXT, TIMESTAMPTZ) IS
  'Migration 212 (F716): archive_league at an injected instant. PLAIN, REVOKEd — reached through the door and the tests only. Cancels every unfinished trade first (R1728).';

-- THE SHARED RESTORE (the commissioner's door and the operator's, F851): the
-- unstamp and the scoring catch-up. The caller has locked the row, checked
-- its gate and that the league IS archived; it writes its own receipt and
-- line after this returns. Returns the number of queue rows written.
CREATE OR REPLACE FUNCTION league_restore_apply_internal(p_league_id UUID, p_at TIMESTAMPTZ)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_season   INTEGER;
  v_cnt      INTEGER;
  v_requeued INTEGER := 0;
BEGIN
  IF p_league_id IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'league_restore_apply_internal: a league and an instant are required' USING ERRCODE = '22023';
  END IF;
  SELECT l.season INTO v_season FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'league_restore_apply_internal: league % is not archived', p_league_id USING ERRCODE = 'P0001';
  END IF;

  -- (1) THE UNSTAMP FIRST — the freeze lifts, then the caller's record is written.
  UPDATE public.leagues
  SET deleted_at = NULL, archived_by = NULL, updated_at = p_at
  WHERE id = p_league_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'league_restore_apply_internal: the restore touched % rows, expected exactly 1 (league %)', v_cnt, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- (2) D782 — SCORING CATCHES UP. Every rostered player with a stat line in
  --     one of the league's not-final weeks is queued exactly as ingestion
  --     queues him (the stamp = his line's own updated_at, so the worker
  --     reads him as landed); an existing row is left alone. An upcoming
  --     week's rows are held by the worker until the week opens. R1731:
  --     `deferred_until = p_at` marks the row as fresh at the restore, so
  --     the stall check (124) does not read an old stat stamp as a stalled
  --     drain; the row is claimable at once.
  INSERT INTO public.score_fanout (season, week, player_id, enqueued_at, deferred_until)
  SELECT ps.season, ps.week, ps.player_id, min(ps.updated_at), p_at
  FROM public.league_weeks lw
  JOIN public.league_rosters r ON r.league_id = lw.league_id
  JOIN public.player_stats ps ON ps.player_id = r.player_id AND ps.season = lw.season AND ps.week = lw.week
  WHERE lw.league_id = p_league_id
    AND lw.season = v_season
    AND lw.status IN ('upcoming', 'live', 'correction_window')
    AND ps.updated_at IS NOT NULL
  GROUP BY ps.season, ps.week, ps.player_id
  ON CONFLICT (season, week, player_id) DO NOTHING;
  GET DIAGNOSTICS v_requeued = ROW_COUNT;
  RETURN v_requeued;
END;
$$;
REVOKE ALL ON FUNCTION league_restore_apply_internal(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION league_restore_apply_internal(UUID, TIMESTAMPTZ) IS
  'Migration 212 (F716 / F851): the restore both doors share — clear the archived stamp, re-queue the league''s scoring for its not-final weeks (D782; deferred_until = p_at, R1731). PLAIN, REVOKEd; the caller gates and writes its own record.';

CREATE OR REPLACE FUNCTION restore_league_internal(
  p_league_id UUID,
  p_reason    TEXT,
  p_at        TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_league   public.leagues;
  v_found    BOOLEAN;
  v_reason   TEXT;
  v_receipt  UUID;
  v_post     TEXT;
  v_requeued INTEGER;
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'restore_league: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id FOR UPDATE;
  v_found := FOUND;

  IF v_actor IS NULL OR NOT v_found OR NOT EXISTS (
       SELECT 1 FROM public.league_members m
       WHERE m.league_id = p_league_id AND m.user_id = v_actor AND m.role = 'commissioner') THEN
    RAISE EXCEPTION 'restore_league: only the league''s commissioner can restore it — a co-commissioner or a manager cannot'
      USING ERRCODE = '42501';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'restore_league: the reason is % characters — keep it to 500 or fewer', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- REPEAT-SAFE: not archived — nothing written.
  IF v_league.deleted_at IS NULL THEN
    RETURN jsonb_build_object(
      'league_id', p_league_id, 'changed', FALSE, 'archived', FALSE,
      'why', 'not_archived — this league is not archived; nothing was written',
      'commissioner_action_id', NULL, 'scores_requeued', 0, 'evaluated_at', p_at);
  END IF;

  -- (1) THE UNSTAMP + THE SCORING CATCH-UP (shared with the operator's door).
  v_requeued := public.league_restore_apply_internal(p_league_id, p_at);

  -- (2) THE RECEIPT AND THE LINE.
  v_receipt := public.draft_commish_receipt_internal(
    p_league_id, FALSE, 'restore_league', 'restore_league', 'league', p_league_id::text, v_reason,
    jsonb_build_object('archived', TRUE),
    jsonb_build_object('archived', FALSE),
    jsonb_build_object('status', v_league.status, 'season', v_league.season,
                       'archived_at', v_league.deleted_at, 'archived_by', v_league.archived_by));
  v_post := public.league_archive_who_internal(v_actor) || ' restored the league'
    || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END || '.';
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, NULL, v_post, 'league', TRUE);

  RETURN jsonb_build_object(
    'league_id', p_league_id, 'changed', TRUE, 'archived', FALSE,
    'archived_at_was', v_league.deleted_at, 'status', v_league.status,
    'commissioner_action_id', v_receipt, 'post', v_post,
    'scores_requeued', v_requeued,
    'reason', v_reason, 'evaluated_at', p_at);
END;
$$;
REVOKE ALL ON FUNCTION restore_league_internal(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION restore_league_internal(UUID, TEXT, TIMESTAMPTZ) IS
  'Migration 212 (F716): restore_league at an injected instant. PLAIN, REVOKEd — reached through the door and the tests only.';

-- ---------------------------------------------------------------------------
-- F851 — THE OPERATOR'S RESTORE. A league whose commissioner is gone could
-- otherwise never come back (the commissioner restores; op_set_commissioner
-- refuses an archived league). The operator restores it — "FieldScout
-- restored the league." — and can then seat a commissioner with the existing
-- op_set_commissioner. No commissioner_actions row (D671: the admin is never
-- named to the league); one platform_operator_actions receipt.
-- ---------------------------------------------------------------------------
-- 184's prelude, the archived-league variant (R1733): the same gate, action
-- id rule, reason bound and replay; the row lock taken WHATEVER the stamp,
-- and a missing league named as missing.
CREATE OR REPLACE FUNCTION op_archived_league_prelude_internal(
  p_verb TEXT, p_league_id UUID, p_action_id UUID, p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rec public.platform_operator_actions;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION '%: only a platform operator can use the operator tools (M8 TD1)', p_verb
      USING ERRCODE = '42501';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION '%: p_action_id is required — it makes a retry safe (M8 TD3)', p_verb
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL AND (length(btrim(p_reason, E' \t\r\n')) = 0 OR length(p_reason) > 500) THEN
    RAISE EXCEPTION '%: a reason is optional, but when given it is non-blank and at most 500 characters', p_verb
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_rec FROM public.platform_operator_actions a WHERE a.action_id = p_action_id;
  IF FOUND THEN
    IF v_rec.verb <> p_verb OR v_rec.actor_id <> auth.uid() OR v_rec.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION '%: action id % was already used for a different operator action', p_verb, p_action_id
        USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE(v_rec.after, '{}'::jsonb) || jsonb_build_object('replayed', TRUE, 'receipt_id', v_rec.id);
  END IF;
  PERFORM 1 FROM public.leagues l WHERE l.id = p_league_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%: league % does not exist', p_verb, p_league_id USING ERRCODE = 'P0002';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION op_archived_league_prelude_internal(TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION op_restore_league_internal(
  p_league_id UUID, p_action_id UUID, p_reason TEXT, p_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_replay   JSONB;
  v_league   public.leagues;
  v_requeued INTEGER;
  v_after    JSONB;
BEGIN
  v_replay := public.op_archived_league_prelude_internal('restore_league', p_league_id, p_action_id, p_reason);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'restore_league: p_at is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = p_league_id;

  -- THE NO-OP (§24.4: writes nothing and says why).
  IF v_league.deleted_at IS NULL THEN
    RETURN jsonb_build_object('changed', FALSE, 'league_id', p_league_id,
      'why', 'not_archived — this league is not archived; nothing was written');
  END IF;

  v_requeued := public.league_restore_apply_internal(p_league_id, p_at);
  PERFORM public.op_league_line_internal(p_league_id, 'FieldScout restored the league.');
  v_after := jsonb_build_object('changed', TRUE, 'league_id', p_league_id, 'archived', FALSE,
    'archived_at_was', v_league.deleted_at, 'archived_by_was', v_league.archived_by,
    'scores_requeued', v_requeued, 'restored_at', p_at);
  PERFORM public.log_operator_action_internal(p_action_id, auth.uid(), 'restore_league',
    'league', p_league_id, NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), ''),
    jsonb_build_object('archived', TRUE, 'archived_at', v_league.deleted_at), v_after);
  RETURN v_after;
END;
$$;
REVOKE ALL ON FUNCTION op_restore_league_internal(UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION op_restore_league_internal(UUID, UUID, TEXT, TIMESTAMPTZ) IS
  'Migration 212 (F851): the body of op_restore_league at an injected instant. PLAIN, REVOKEd — reached through the door and the tests only.';

CREATE OR REPLACE FUNCTION op_restore_league(
  p_league_id UUID, p_action_id UUID DEFAULT NULL, p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION 'restore_league: only a platform operator can use the operator tools (M8 TD1)' USING ERRCODE = '42501';
  END IF;
  RETURN public.op_restore_league_internal(p_league_id, p_action_id, p_reason, now());
END;
$$;
REVOKE ALL ON FUNCTION op_restore_league(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION op_restore_league(UUID, UUID, TEXT) TO authenticated;
COMMENT ON FUNCTION op_restore_league(UUID, UUID, TEXT) IS
  'Migration 212 (F851): an operator restores an archived league (its commissioner may be gone). Operators only (in-body gate); idempotent on p_action_id; a league that is not archived = no-op, nothing written. Shares the commissioner''s restore (league_restore_apply_internal); one platform_operator_actions receipt + a "FieldScout restored the league." line; no commissioner_actions row (D671). Then op_set_commissioner can seat a commissioner.';

CREATE OR REPLACE FUNCTION archive_league(p_league_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The gate is the internal's first act after the row lock (the league's
  -- commissioner only); this door only supplies the database's clock.
  RETURN public.archive_league_internal(p_league_id, p_reason, now());
END;
$$;
REVOKE EXECUTE ON FUNCTION archive_league(UUID, TEXT) FROM PUBLIC, anon;
COMMENT ON FUNCTION archive_league(UUID, TEXT) IS
  'Migration 212 (F716, Chris 2026-10-27): archive a league — the league''s commissioner only (co-commissioners and managers refused 42501); refused while a draft is in progress; repeat-safe; one commissioner_actions receipt (archive_league) + one league line. The league is then frozen (league_archived_guard_internal) and skipped by every job until restore_league.';

CREATE OR REPLACE FUNCTION restore_league(p_league_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.restore_league_internal(p_league_id, p_reason, now());
END;
$$;
REVOKE EXECUTE ON FUNCTION restore_league(UUID, TEXT) FROM PUBLIC, anon;
COMMENT ON FUNCTION restore_league(UUID, TEXT) IS
  'Migration 212 (F716): restore an archived league exactly as it was — the league''s commissioner only; repeat-safe; one commissioner_actions receipt (restore_league) + one league line; re-queues the league''s scoring for its not-final weeks (D782).';

-- ---------------------------------------------------------------------------
-- 4. soft_delete_league — RETIRED (169:1929-1973 replaced whole, D786)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_league(p_league_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Migration 212, F716 (Chris 2026-10-27): leagues are archived, never deleted.
  -- Refused for every caller and every league, before any read.
  RAISE EXCEPTION 'soft_delete_league: leagues are archived, not deleted — the commissioner archives the league (archive_league) and can restore it'
    USING ERRCODE = '0A000';
END;
$$;
REVOKE EXECUTE ON FUNCTION soft_delete_league(UUID) FROM PUBLIC, anon;
COMMENT ON FUNCTION soft_delete_league(UUID) IS
  'Retired by migration 212 (F716, Chris 2026-10-27 — leagues are archived, never deleted): refuses every caller (0A000). Use archive_league / restore_league.';

-- ---------------------------------------------------------------------------
-- 5. The jobs (D137 — derived from each newest definer's FILE TEXT)
-- ---------------------------------------------------------------------------
-- trade_tick — 199_remove_retire_schema.sql:7426-7592 FILE TEXT (D137), 2 hunks (+2 / -0).
CREATE OR REPLACE FUNCTION trade_tick(p_now TIMESTAMPTZ DEFAULT now(), p_league_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_candidates INTEGER;
  v_lg         RECORD;
  v_league     public.leagues;
  v_deadline   JSONB;
  v_t          RECORD;
  v_reason     TEXT;
  v_res        JSONB;
  v_leagues    INTEGER := 0;
  v_expired    INTEGER := 0;
  v_swept      INTEGER := 0;
  v_executed   INTEGER := 0;
  v_deferred   INTEGER := 0;
  v_failed     INTEGER := 0;
  v_vetoed     INTEGER := 0;   -- 155 (L.D3.4): league-vote vetoes found by step (2b)
  v_actions    JSONB := '[]'::jsonb;
  v_failures   JSONB := '[]'::jsonb;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'trade_tick: p_now is required (the TimeProvider seam)' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT t.league_id)::int INTO v_candidates
  FROM public.trades t
  WHERE t.status IN ('proposed', 'accepted', 'in_review')
    AND NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = t.league_id AND l.deleted_at IS NOT NULL)   -- 212 / F716: an archived league is not a candidate
    AND (p_league_id IS NULL OR t.league_id = p_league_id);

  FOR v_lg IN
    SELECT l.id FROM public.leagues l
    WHERE (p_league_id IS NULL OR l.id = p_league_id)
      AND l.deleted_at IS NULL   -- 212 / F716: an archived league is frozen — skipped (its open trades were cancelled at the archive, R1728)
      AND EXISTS (SELECT 1 FROM public.trades t
                  WHERE t.league_id = l.id AND t.status IN ('proposed', 'accepted', 'in_review'))
    ORDER BY l.id
    FOR UPDATE OF l SKIP LOCKED
  LOOP
    v_leagues := v_leagues + 1;
    BEGIN
      SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;

      -- (1) Q76: every offer still pending at the deadline expires.
      v_deadline := public.trade_deadline_internal(v_league);
      IF (v_deadline ->> 'deadline_at')::timestamptz <= p_now THEN
        FOR v_t IN
          SELECT t.id FROM public.trades t
          WHERE t.league_id = v_league.id AND t.status = 'proposed'
          ORDER BY t.created_at, t.id
        LOOP
          v_res := public.trade_close_internal(
            v_t.id, 'expired',
            'the trade deadline passed — offers could be accepted until week ' || ((v_deadline ->> 'deadline_week')::int + 1)
              || ' began (' || (v_deadline ->> 'label') || ')',
            p_now, 'league_trade_expired', 'A trade offer expired at the deadline');
          v_expired := v_expired + 1;
          v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'expired'));
        END LOOP;
      END IF;

      -- (2) THE BACKSTOP SWEEP (TD12): what the triggers cannot see.
      FOR v_t IN
        SELECT t.* FROM public.trades t
        WHERE t.league_id = v_league.id AND t.status IN ('proposed', 'accepted', 'in_review')
        ORDER BY t.created_at, t.id
      LOOP
        v_reason := NULL;
        IF v_league.deleted_at IS NOT NULL OR v_league.status NOT IN ('in_season', 'playoffs') THEN
          v_reason := 'the league is ' || CASE WHEN v_league.deleted_at IS NOT NULL THEN 'deleted' WHEN v_league.status = 'complete' THEN 'over for the season' ELSE 'not in its season' END
                      || ' — trades only go through during the season and the playoffs';
        ELSE
          SELECT tm.name || ' can no longer give $' || i.faab_amount || ' of FAAB — its balance is '
                 || COALESCE('$' || m.faab_balance, 'not set')
          INTO v_reason
          FROM public.trade_items i
          JOIN public.teams tm ON tm.id = i.from_team_id
          LEFT JOIN public.league_members m ON m.league_id = v_league.id AND m.team_id = i.from_team_id
          WHERE i.trade_id = v_t.id AND i.faab_amount IS NOT NULL
            AND (m.faab_balance IS NULL OR m.faab_balance < i.faab_amount)
          ORDER BY tm.name LIMIT 1;
        END IF;
        IF v_reason IS NOT NULL THEN
          v_res := public.trade_close_internal(v_t.id, 'invalid', 'the trade can no longer go through: ' || v_reason, p_now,
                                               'league_trade_invalid', 'A trade can no longer go through');
          v_swept := v_swept + 1;
          v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'invalid', 'reason', v_reason));
        END IF;
      END LOOP;

      -- (2b) 155 (L.D3.4, F430 / F435): a LEAGUE-VOTE trade in review whose
      --      counted veto votes already reach the league's number is
      --      vetoed here, before (3) could run it. A vote that reaches the
      --      number vetoes at the vote (trade_vote); this catches the number
      --      falling with no vote cast — it is capped at the managers who
      --      can vote, and that falls when a seat empties. Only BEFORE the
      --      review period ends (R1227): at or after `review_deadline` the
      --      vote is over and the trade goes through in (3) — a seat that
      --      empties after the deadline (or a league the tick skipped as
      --      busy) never vetoes a trade Q77 has already let through.
      IF COALESCE(v_league.trade_review, 'commissioner') = 'league_vote' THEN
        FOR v_t IN
          SELECT t.id FROM public.trades t
          WHERE t.league_id = v_league.id AND t.status = 'in_review'
            AND t.review_deadline > p_now
          ORDER BY t.created_at, t.id
        LOOP
          v_res := public.trade_vote_veto_internal(v_t.id, v_league, p_now);
          IF v_res IS NOT NULL THEN
            v_vetoed := v_vetoed + 1;
            v_actions := v_actions || jsonb_build_array(jsonb_build_object('league_id', v_league.id, 'trade_id', v_t.id, 'action', 'vetoed', 'reason', v_res ->> 'status_reason'));
          END IF;
        END LOOP;
      END IF;

      -- (3) + (4) DUE EXECUTIONS: review period over; a deferred trade
      --     whose release has come (or is not yet recorded — re-read each
      --     minute; the executor re-parks it if still locked).
      FOR v_t IN
        SELECT t.id,
               CASE WHEN t.status = 'in_review' THEN 'review_elapsed' ELSE 'deferred_release' END AS via
        FROM public.trades t
        WHERE t.league_id = v_league.id
          AND ((t.status = 'in_review' AND t.review_deadline <= p_now)
            OR (t.status = 'accepted' AND (t.execute_after IS NULL OR t.execute_after <= p_now OR t.execute_after = 'infinity')))
        ORDER BY COALESCE(t.accepted_at, t.created_at), t.id
      LOOP
        v_res := public.trade_execute_internal(v_t.id, p_now, v_t.via);
        CASE v_res ->> 'outcome'
          WHEN 'complete' THEN v_executed := v_executed + 1;
          WHEN 'deferred' THEN v_deferred := v_deferred + 1;
          WHEN 'invalid'  THEN v_failed := v_failed + 1;
          ELSE NULL;
        END CASE;
        v_actions := v_actions || jsonb_build_array(jsonb_build_object(
          'league_id', v_league.id, 'trade_id', v_t.id, 'action', v_res ->> 'outcome', 'via', v_t.via,
          'execute_after', v_res -> 'execute_after', 'reason', v_res -> 'status_reason'));
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM));
      RAISE WARNING 'trade_tick failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'at',          p_now,
    'scope',       p_league_id,
    'candidates',  v_candidates,
    'leagues',     v_leagues,
    'skipped_locked', GREATEST(v_candidates - v_leagues, 0),
    'expired',     v_expired,
    'invalidated', v_swept,
    'executed',    v_executed,
    'deferred',    v_deferred,
    'failed_at_execution', v_failed,
    'vetoed',      v_vetoed,
    'actions',     v_actions,
    'failures',    v_failures,
    'reason', CASE
      WHEN v_candidates = 0 THEN 'no_trades_in_flight'
      WHEN v_leagues = 0 THEN 'every_league_busy'
      WHEN jsonb_array_length(v_actions) = 0 AND jsonb_array_length(v_failures) = 0 THEN 'nothing_due'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION trade_tick(TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;

-- mock_draft_expire — 095_standalone_mock.sql:1308-1402 FILE TEXT (D137), 1 hunk (+1 / -0).
CREATE OR REPLACE FUNCTION mock_draft_expire()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch    CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_row      RECORD;
  v_draft    public.drafts;
  v_idle     TIMESTAMPTZ;
  v_seen     UUID[] := '{}';
  v_pass     INTEGER;
  v_loops    INTEGER := 0;
  v_expired  INTEGER := 0;
  v_failures JSONB := '[]'::jsonb;
BEGIN
  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.is_mock
        AND d.status <> 'complete'          -- recaps kept until owner-deleted
        AND NOT (d.id = ANY(v_seen))
        AND NOT EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = d.league_id AND l.deleted_at IS NOT NULL)   -- 212 / F716: an archived league's practice drafts are frozen too
        -- Idle > 72h: neither engine activity nor a launcher heartbeat.
        AND GREATEST(
              d.updated_at,
              COALESCE((SELECT dl.last_seen_at
                        FROM public.draft_liveness dl
                        WHERE dl.draft_id = d.id
                          AND dl.user_id::text = d.config->'mock'->>'launched_by'),
                       '-infinity'::timestamptz)
            ) < now() - interval '72 hours'
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_row.id;
      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;
        -- Re-verify under the held lock (authoritative — the claim is a
        -- snapshot pre-filter, the R135 discipline).
        IF v_draft.status = 'complete' OR NOT v_draft.is_mock THEN
          CONTINUE;
        END IF;
        v_idle := GREATEST(
          v_draft.updated_at,
          COALESCE((SELECT dl.last_seen_at
                    FROM public.draft_liveness dl
                    WHERE dl.draft_id = v_draft.id
                      AND dl.user_id::text = v_draft.config->'mock'->>'launched_by'),
                   '-infinity'::timestamptz));
        IF v_idle >= now() - interval '72 hours' THEN
          CONTINUE;
        END IF;

        -- Same cleanup as delete_mock_draft (chat explicit, CASCADE for
        -- the rest).
        DELETE FROM public.league_chat
        WHERE league_id IS NOT DISTINCT FROM v_draft.league_id
          AND context = 'draft:' || v_draft.id::text;
        DELETE FROM public.drafts WHERE id = v_draft.id;
        -- 095/MP.3 — the seats, after the draft, with the same
        -- `league_id IS NULL` safety belt delete_mock_draft carries
        -- (D227(6)). A cron that leaves orphan seats behind is a cron that
        -- grows the teams table forever.
        IF v_draft.league_id IS NULL THEN
          DELETE FROM public.teams t
          WHERE t.league_id IS NULL
            AND t.owner_id::text = v_draft.config->'mock'->>'launched_by'
            AND (t.id::text = v_draft.config->'mock'->>'human_team_id'
                 OR (v_draft.config->'mock'->'cpu_seats') ? t.id::text);
        END IF;
        v_expired := v_expired + 1;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'mock_draft_expire failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'expired', v_expired,
    'failures', v_failures,
    'loops', v_loops);
END;
$$;
REVOKE EXECUTE ON FUNCTION mock_draft_expire() FROM PUBLIC, anon, authenticated;

-- draft_tick — 097_mock_pause_post_copy.sql:55-1044 FILE TEXT (D137), 1 hunk (+1 / -0).
CREATE OR REPLACE FUNCTION draft_tick()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_lg             RECORD;
  v_at             TIMESTAMPTZ;
  v_res            JSONB;
  v_scanned        INTEGER := 0;
  v_started        INTEGER := 0;
  v_start_failures JSONB := '[]'::jsonb;
  v_seen           UUID[] := '{}';
  v_pass           INTEGER;
  v_row            RECORD;
  v_draft          public.drafts;
  v_user           UUID;
  v_autodraft      BOOLEAN;
  v_grace          INTEGER;
  v_fresh          BOOLEAN;
  v_player         TEXT;
  v_claimed        INTEGER := 0;
  v_picked         INTEGER := 0;
  v_held           INTEGER := 0;
  v_pick_failures  JSONB := '[]'::jsonb;
  v_loops          INTEGER := 0;
  v_od             RECORD;
  v_ograce         INTEGER;
  v_established    BOOLEAN;
  v_supervised     BOOLEAN;
  v_outage_paused  INTEGER := 0;
  v_outage_failures JSONB := '[]'::jsonb;
  v_hb             RECORD;
  v_heartbeats     INTEGER := 0;
  v_heartbeat_failures JSONB := '[]'::jsonb;
  v_mk             RECORD;
  v_mock_paused    INTEGER := 0;
  v_mock_pause_failures JSONB := '[]'::jsonb;
  v_mock_seen      UUID[] := '{}';
  v_mock_picked    INTEGER := 0;
  v_mock_cpu_failures JSONB := '[]'::jsonb;
  v_mock_loops     INTEGER := 0;
  -- 086 (L.C1.4) — ARM 2.6, the auction clock:
  v_auc_seen       UUID[] := '{}';
  v_auc_loops      INTEGER := 0;
  v_auc_claimed    INTEGER := 0;
  v_auc_nominated  INTEGER := 0;
  v_auc_awarded    INTEGER := 0;
  v_auc_held       INTEGER := 0;
  v_auc_completed  INTEGER := 0;
  v_auc_failures   JSONB := '[]'::jsonb;
  -- 093/AP.2: the award's own locals moved into
  -- `draft_award_nomination_internal` with the arm that used them
  -- (v_reserve / v_remaining / v_open / v_max_bid / v_price / v_win_team /
  -- v_is_auto / v_order / v_n / v_idx / v_step / v_next_team). `v_win_player`
  -- STAYS — ARM 2.6(c)'s candidate scan reads it too.
  v_win_player     TEXT;
  -- 089 (L.C1.7) — ARM 2.6(c), the mock CPU sub-arm (D132):
  v_cpu_seen       UUID[] := '{}';
  v_cpu_loops      INTEGER := 0;
  v_cpu_claimed    INTEGER := 0;
  v_cpu_nominated  INTEGER := 0;
  v_cpu_raised     INTEGER := 0;
  v_cpu_folded     INTEGER := 0;
  v_cpu_failures   JSONB := '[]'::jsonb;
  v_bid_count      INTEGER;
  v_high_team      UUID;
  -- 091 (AP.3) — the value model's inputs, the candidate scan and the raise
  -- amount all moved into draft_mock_cpu_respond_internal, so this arm's
  -- own state is now one integer: the number of raises the responder wrote.
  v_cpu_step       INTEGER;
BEGIN
  -- -------------------------------------------------------------------------
  -- ARM 1 — D94 auto-start: scan scheduled LEAGUES (never the drafts
  -- table), create the drafts row if absent, start. Failures recorded +
  -- retried every tick, never a silent skip.
  -- -------------------------------------------------------------------------
  FOR v_lg IN
    SELECT l.id, l.settings->'draft'->>'draft_scheduled_at' AS at_txt
    FROM public.leagues l
    WHERE l.status = 'scheduled'
      AND l.deleted_at IS NULL
      AND COALESCE(l.settings->'draft'->>'draft_scheduled_at', '') <> ''
  LOOP
    v_scanned := v_scanned + 1;
    BEGIN
      -- Cast inside the per-league subtransaction: a malformed stored
      -- instant becomes THIS league's recorded failure, never a scan
      -- abort.
      v_at := v_lg.at_txt::timestamptz;
      IF v_at > now() THEN
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM public.commissioner_actions a WHERE a.league_id = v_lg.id AND a.action_type = 'restore_league' AND a.created_at >= v_at) THEN CONTINUE; END IF;   -- 212 / F716: a draft time that passed while the league was archived never starts the draft by itself

      -- Claim without waiting (§4.6: the tick never blocks — or waits
      -- behind — a user action; a held league row retries next tick).
      PERFORM 1 FROM public.leagues l
      WHERE l.id = v_lg.id AND l.status = 'scheduled' AND l.deleted_at IS NULL
      FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      -- The ONE start implementation (066): create-if-absent + capacity +
      -- snapshot-before-transition, commissioner gate skipped (cron has no
      -- JWT; this RPC's authority is its REVOKE narrowing).
      v_res := public.draft_start_internal(v_lg.id, FALSE);
      IF (v_res->>'started')::boolean THEN
        v_started := v_started + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_start_failures := v_start_failures || jsonb_build_object(
        'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
      RAISE WARNING 'draft_tick auto-start failed for league %: % (%)',
        v_lg.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 1.5 — §8.7 commissioner-outage auto-pause (D102/§8.7:478; landed
  -- with L.B1.4/069 — see the banner). Runs BEFORE the timeout arm so an
  -- expired deadline under an outage pauses instead of autopicking (pinned:
  -- pgTAP 023 §H's R136 case — a deadline past deadline+grace under an
  -- outage pauses with NEGATIVE remaining and ZERO picks). The candidacy
  -- test covers ALL live non-mock drafts (not just due ones — the pause
  -- must freeze a still-running clock through the outage), but the CLAIM
  -- locks ONLY outage candidates (R135, M2 batch 5): the pre-fix
  -- unfiltered claim FOR UPDATE'd every live non-mock draft each tick and
  -- held the locks for the rest of the tick transaction, serializing every
  -- pick on every live draft behind the batch every 5s — against the
  -- §22.3/§22.6 load posture. The WHERE below is the same
  -- established-then-lost supervision predicate the body re-verifies UNDER
  -- the lock (claim = pre-filter against a snapshot; body = authoritative);
  -- a filter bug that over-claims costs only lock scope (pgTAP 023 §H's
  -- lock-visibility pins catch it), one that under-claims would miss the
  -- pause (023 §H's 76s-threshold pins catch that direction). Batch-capped
  -- at c_batch for symmetry with ARM 2 — no loop (an outage pause is
  -- idempotent and not deadline-urgent the way a timeout is). CORRECTED,
  -- R141 (batch-5 addendum): "overflow candidates are claimed on the next
  -- 5s tick" is guaranteed only INSIDE the ≤25-draft M2 gate, where the
  -- candidate set can never exceed c_batch. This claim has no ORDER BY, no
  -- loop, and no v_seen, so beyond the gate nothing rotates the batch:
  -- ≥ c_batch candidates that never leave the set (e.g. rows the body
  -- persistently fails on — recorded outage_failures) could recur in every
  -- batch while real outage candidates starve, and a starved candidate
  -- whose deadline is due is autopicked by ARM 2 in the SAME tick. The one
  -- known PERMANENT class (soft-deleted league) is excluded from the claim
  -- below; the beyond-gate rotation hazard is F50's (M7/L.F1 §22.6 load
  -- gate — the ARM-2 loop+v_seen shape is the fix when scale demands it).
  -- Freshness AS-OF-NOW; the never-connected exemption; resume is a
  -- commissioner action (the tick never auto-resumes).
  -- -------------------------------------------------------------------------
  FOR v_od IN
    SELECT d.id
    FROM public.drafts d
    WHERE d.status = 'live' AND d.is_mock = FALSE
      -- Supervision was ESTABLISHED (some commissioner/co-commissioner has
      -- heartbeat this draft at least once)…
      AND EXISTS (
        SELECT 1
        FROM public.draft_liveness dl
        JOIN public.league_members m
          ON m.league_id = d.league_id AND m.user_id = dl.user_id
        WHERE dl.draft_id = d.id
          AND m.role IN ('commissioner', 'co_commissioner')
      )
      -- …and then LOST (no commissioner beat within freshness + grace).
      AND NOT EXISTS (
        SELECT 1
        FROM public.draft_liveness dl
        JOIN public.league_members m
          ON m.league_id = d.league_id AND m.user_id = dl.user_id
        WHERE dl.draft_id = d.id
          AND m.role IN ('commissioner', 'co_commissioner')
          AND dl.last_seen_at > now() - (public.draft_liveness_freshness()
                + make_interval(secs => COALESCE(
                    (d.config->>'disconnect_grace_seconds')::int, 30)))
      )
      -- …and the league is ALIVE (R141, batch-5 addendum — the body's
      -- deleted-league re-check mirrored into the claim): without this, a
      -- live draft under a soft-deleted league matched the claim WHERE
      -- FOREVER (claimed + locked every tick, body-skipped by the
      -- deleted-league CONTINUE, never paused, never leaving the candidate
      -- set) — the permanent-candidate class that falsified the no-loop
      -- rationale below. Reachable today: soft_delete_league (060) has no
      -- draft-status gate.
      AND public.draft_league_alive(d.league_id)
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_od.id;
      IF v_draft.status <> 'live' THEN
        CONTINUE;
      END IF;
      IF NOT public.draft_league_alive(v_draft.league_id) THEN
        CONTINUE;
      END IF;

      v_ograce := COALESCE(
        (v_draft.config->>'disconnect_grace_seconds')::int, 30);

      -- Supervision was ESTABLISHED: some commissioner/co-commissioner
      -- has heartbeat this draft at least once (else: D94's unattended
      -- autopilot — never paused; the banner's never-connected exemption).
      SELECT
        count(*) > 0,
        count(*) FILTER (
          WHERE dl.last_seen_at > now() - (public.draft_liveness_freshness()
                                           + make_interval(secs => v_ograce))
        ) > 0
      INTO v_established, v_supervised
      FROM public.draft_liveness dl
      JOIN public.league_members m
        ON m.league_id = v_draft.league_id AND m.user_id = dl.user_id
      WHERE dl.draft_id = v_draft.id
        AND m.role IN ('commissioner', 'co_commissioner');

      IF v_established AND NOT v_supervised THEN
        -- The ONE pause-bookkeeping path (069's draft_pause_internal);
        -- system post with NO acting user (the tick has no JWT).
        PERFORM public.draft_pause_internal(
          v_draft.id, NULL,
          'Draft auto-paused: no commissioner or co-commissioner is connected. '
          || 'A commissioner can resume from the draft room.');
        v_outage_paused := v_outage_paused + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_outage_failures := v_outage_failures || jsonb_build_object(
        'draft_id', v_od.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
      RAISE WARNING 'draft_tick outage arm failed for draft %: % (%)',
        v_od.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 1.6 — THE E59 MOCK STALE-PAUSE (L.B1.6/071 — amended in place,
  -- F12; D93/§8.8). A live MOCK auto-pauses when the LAUNCHER's heartbeat
  -- is stale past disconnect_grace_seconds + one tick (5s) — the D93
  -- threshold, keyed on config.mock.launched_by (never the on-clock
  -- seat's owner: the whole room is one human's practice, and without
  -- them watching there is no point burning CPU picks — E59). Runs
  -- BEFORE the timeout arm so the pause always preempts the grace-hold's
  -- deadline+grace autopick: a seat stale AS OF its deadline last beat at
  -- ≤ deadline − 45s, so the pause threshold (last beat + grace + 5s ≤
  -- deadline + grace − 40s) expires strictly before the hold does — the
  -- disconnected human never loses their pick to a timeout (pinned in
  -- 025). CLAIM SCOPE (the R135/R141 discipline — the task charge "mock
  -- arms must not widen any lock scope beyond due/claimable mocks"): the
  -- WHERE is the body's predicate — live + mock + alive league + stale
  -- launcher — so a healthy mock (fresh beat) is NEVER locked by this
  -- arm; COALESCE(beat, started_at, created_at) guards fixture mocks
  -- with no seeded beat (create_mock_draft always seeds one). Resume is
  -- the LAUNCHER's action (069's draft_resume mock arm) — the tick never
  -- auto-resumes (the ARM 1.5 symmetry: a deliberate pause must not be
  -- fought by the clock).
  -- -------------------------------------------------------------------------
  FOR v_mk IN
    SELECT d.id
    FROM public.drafts d
    WHERE d.status = 'live'
      AND d.is_mock
      AND public.draft_league_alive(d.league_id)
      AND COALESCE(
            (SELECT dl.last_seen_at
             FROM public.draft_liveness dl
             WHERE dl.draft_id = d.id
               AND dl.user_id::text = d.config->'mock'->>'launched_by'),
            d.started_at, d.created_at)
          < now() - (make_interval(secs => COALESCE(
                       (d.config->>'disconnect_grace_seconds')::int, 30))
                     + interval '5 seconds')
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_mk.id;
      -- Re-verify under the held lock (claim = snapshot pre-filter; body =
      -- authoritative — the R135 discipline).
      IF v_draft.status <> 'live' OR NOT v_draft.is_mock THEN
        CONTINUE;
      END IF;
      IF NOT public.draft_league_alive(v_draft.league_id) THEN
        CONTINUE;
      END IF;
      IF COALESCE(
           (SELECT dl.last_seen_at
            FROM public.draft_liveness dl
            WHERE dl.draft_id = v_draft.id
              AND dl.user_id::text = v_draft.config->'mock'->>'launched_by'),
           v_draft.started_at, v_draft.created_at)
         >= now() - (make_interval(secs => COALESCE(
                       (v_draft.config->>'disconnect_grace_seconds')::int, 30))
                     + interval '5 seconds') THEN
        CONTINUE;
      END IF;

      -- The ONE pause-bookkeeping path (069's draft_pause_internal —
      -- call-time-resolved, the ARM 1.5 forward-reference rationale: no
      -- live mock can exist in the 068→071 window since create_mock_draft
      -- is 071's); system post with NO acting user, scoped to the mock's
      -- own chat context (zero league side effects).
      -- 097/MP.6c (ledger F120): the SENTENCE depends on where the user
      -- resumes, and a standalone practice draft has no league page. The
      -- league arm's text is 068's, byte-for-byte.
      PERFORM public.draft_pause_internal(
        v_draft.id, NULL,
        CASE WHEN v_draft.league_id IS NULL
             THEN 'Mock draft auto-paused — you left the room. Resume your practice from Mock drafts.'
             ELSE 'Mock draft auto-paused — you left the room. Resume your practice from the league page.'
        END);
      v_mock_paused := v_mock_paused + 1;
    EXCEPTION WHEN OTHERS THEN
      v_mock_pause_failures := v_mock_pause_failures || jsonb_build_object(
        'draft_id', v_mk.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
      RAISE WARNING 'draft_tick mock stale-pause failed for draft %: % (%)',
        v_mk.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 2 — timeout → autopick per the D102 contract; batch-limited loop
  -- until no due rows (§22.3), FOR UPDATE SKIP LOCKED claims (§4.6).
  -- 086/L.C1.4: AUCTIONS ARE EXCLUDED, in the claim AND in the under-lock
  -- re-verify. This arm is the SNAKE/LINEAR pick clock — it resolves one
  -- player and writes it through draft_apply_pick_internal, which advances
  -- by draft_team_for_pick and prices nothing. 068 had no draft_type
  -- awareness at all, and once 084 made auctions startable that was a live
  -- defect, measured before this migration was written: an auction whose
  -- NOMINATION clock expired past deadline + grace had a player handed to
  -- the on-clock team for free — draft_picks(round=1, price=NULL,
  -- is_auto=t), current_pick_number advanced, ZERO draft_bids rows and
  -- current_nomination still NULL. ARM 2.6 below owns both auction clocks;
  -- 035 §C pins that a due auction is not snake-autopicked.
  -- -------------------------------------------------------------------------
  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.draft_type <> 'auction'          -- 086: ARM 2.6 owns auctions
        AND d.current_deadline IS NOT NULL
        AND d.current_deadline <= now()
        AND NOT (d.id = ANY(v_seen))
      ORDER BY d.current_deadline
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_claimed := v_claimed + 1;
      v_seen := v_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify under the held lock (the claim's snapshot may predate
        -- a concurrent pick that advanced the clock).
        IF v_draft.status <> 'live'
           OR v_draft.draft_type = 'auction'    -- 086: ARM 2.6 owns auctions
           OR v_draft.current_deadline IS NULL
           OR v_draft.current_deadline > now()
           OR v_draft.on_clock_team_id IS NULL THEN
          CONTINUE;
        END IF;
        -- Defensive: a live draft under a soft-deleted league is not ours
        -- to advance.
        IF NOT public.draft_league_alive(v_draft.league_id) THEN
          CONTINUE;
        END IF;

        -- Seat-user derivation. MOCK BRANCH (L.B1.6/071 — D93/D103): the
        -- HUMAN seat keys freshness/grace on the LAUNCHER (the seat's
        -- real owner and their is_autodraft are irrelevant inside a
        -- practice room — the launcher wants the clock pressure, §8.8);
        -- every CPU seat is a no-user seat here (immediate autopick —
        -- normally ARM 2.5 picks it BEFORE the deadline, so reaching this
        -- arm means the tick was down past the deadline, and the timeout
        -- semantics are identical).
        IF v_draft.is_mock THEN
          IF v_draft.config->'mock'->>'human_team_id'
             = v_draft.on_clock_team_id::text THEN
            v_user := (v_draft.config->'mock'->>'launched_by')::uuid;
          ELSE
            v_user := NULL;
          END IF;
          v_autodraft := FALSE;
        ELSE
          SELECT m.user_id, COALESCE(m.is_autodraft, FALSE)
            INTO v_user, v_autodraft
          FROM public.league_members m
          WHERE m.league_id = v_draft.league_id
            AND m.team_id = v_draft.on_clock_team_id;
        END IF;

        v_grace := COALESCE(
          (v_draft.config->>'disconnect_grace_seconds')::int, 30);

        -- D102: only a STALE HUMAN seat gets the grace hold. is_autodraft
        -- seats, no-user seats (placeholder/vacated — E48), and seats
        -- FRESH AS OF THE DEADLINE autopick AT the deadline (§8.5.4).
        IF v_user IS NOT NULL AND NOT COALESCE(v_autodraft, FALSE) THEN
          -- R132: the branch is decided from freshness AS OF THE DEADLINE
          -- INSTANT — a heartbeat in (deadline − freshness, deadline].
          -- Re-deriving it from now() each tick let a returning manager's
          -- own post-deadline heartbeat retroactively grant the
          -- fresh-at-expiry branch, and the next tick autopicked them
          -- INSIDE the grace window (§8.5.5/E3 defeated in exactly the
          -- scenario the hold exists for). The lower bound is STRICT so
          -- the pinned 45s constant keeps both behavioral sides against a
          -- 1s-past deadline (44s-old fresh / 46s-old stale — pgTAP 022);
          -- the upper bound is what makes a mid-hold reconnect unable to
          -- end the hold (it restores MANUAL control only —
          -- draft_make_pick never checks the deadline). Recorded
          -- residual: the PK upsert keeps ONE row per (draft, user), so a
          -- beat landing between the deadline and the tick OVERWRITES the
          -- pre-deadline evidence and that seat takes the hold — the
          -- error direction is the protective §8.5.5 hold, never an early
          -- autopick.
          v_fresh := EXISTS (
            SELECT 1 FROM public.draft_liveness dl
            WHERE dl.draft_id = v_draft.id
              AND dl.user_id = v_user
              AND dl.last_seen_at > v_draft.current_deadline
                                    - public.draft_liveness_freshness()
              AND dl.last_seen_at <= v_draft.current_deadline
          );
          IF NOT v_fresh
             AND now() < v_draft.current_deadline
                         + make_interval(secs => v_grace) THEN
            -- HELD OPEN: deadline stays past-due; a returning human may
            -- pick manually during the hold (§8.5.5/E3) — re-evaluated
            -- every tick until deadline + grace; a mid-hold heartbeat
            -- never ends the hold (R132).
            v_held := v_held + 1;
            CONTINUE;
          END IF;
        END IF;

        v_player := public.draft_autopick_resolve(
          v_draft.id, v_draft.on_clock_team_id);
        IF v_player IS NULL THEN
          RAISE EXCEPTION
            'draft_tick: no available player to autopick in draft % (pool exhausted)',
            v_draft.id;
        END IF;

        -- The SAME advance path as a manual pick (066 — reuse, never
        -- fork): §12.4 system-pick shape.
        PERFORM public.draft_apply_pick_internal(
          v_draft.id, v_player, TRUE, 'autopick', NULL, NULL);
        v_picked := v_picked + 1;
      EXCEPTION WHEN OTHERS THEN
        v_pick_failures := v_pick_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick timeout arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_loops >= c_max_loops;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 2.5 — MOCK CPU THINK-TIME PICKS (L.B1.6/071 — amended in place,
  -- F12; D93/§8.8, plan §4.2). Every non-human seat in a live mock picks
  -- when its think-time elapses: due = pick start + PRNG(draft_id,
  -- pick_number) → 20–70% of the clock (`realistic`) or ~2s (`fast`) —
  -- draft_mock_cpu_due, the ONE due computation for claim AND re-check.
  -- THE PICK ITSELF IS THE AUTOPICK STRATEGY FN (draft_autopick_resolve →
  -- draft_apply_pick_internal — the same brain and the same advance path
  -- as a live timeout; "one implementation, two consumers" — the DoD
  -- break-probe target: a forked raw-ADP CPU fails 025's need-fit board
  -- pins). The human seat is NEVER touched by this arm (its clock is
  -- always real — §8.8; ARM 2 owns its timeout at the deadline). CLAIM
  -- SCOPE (R135/R141 + the task charge): the WHERE is the body's
  -- predicate — live + mock + CPU on clock + due + alive league — so a
  -- mock whose CPU is still thinking is NEVER locked. One CPU pick per
  -- mock per pass (the think origin is the advance instant, so the next
  -- pick's due is always in the future at apply time): `fast` ≈ 2s
  -- think-time lands on the first tick after it elapses — effective
  -- cadence bounded by the 5s tick, the same granularity class D87
  -- records for timeout lag (recorded residual). Runs AFTER ARM 2 (a
  -- deadline-expired mock CPU seat is ARM 2's immediate autopick; the
  -- fresh deadline it writes puts the next due in the future) and BEFORE
  -- ARM 3 (a just-made CPU pick's fresh deadline beats in the same pass).
  -- 086/R362 — AUCTIONS ARE EXCLUDED HERE TOO, in the claim AND the
  -- under-lock re-verify, for the same reason ARM 2 is: this arm's pick
  -- path is draft_autopick_resolve → draft_apply_pick_internal, the SNAKE
  -- writer. The exclusion is not inferred from that intent — it was
  -- MEASURED on this branch before the two lines were added. A privileged
  -- fixture (a live is_mock=true, draft_type='auction' draft, a CPU seat
  -- on the clock, cpu_speed 'fast' so the think-time is due while the
  -- deadline is still 30s away, started_at fresh so ARM 1.6 cannot claim
  -- it) put through one draft_tick() returned "mock_cpu_picked": 1 and
  -- wrote draft_picks(pick_number=1, round=1, price=NULL, is_auto=t,
  -- made_via='autopick'), advanced current_pick_number to 2, recorded
  -- ZERO draft_bids and left current_nomination NULL — the EXACT shape
  -- this migration closes for ARM 2, reached through a second door.
  -- It is unreachable today (071's create_mock_draft refuses auction
  -- configs and a mock's draft_type is snapshotted at creation; 085's
  -- verbs refuse mocks — F61), so it was never a live defect; it is fixed
  -- rather than disclosed because an unfixed arm is a hand-off L.C1.7
  -- would have to remember (R51), and because the banner's seam statement
  -- is only true once BOTH snake arms decline auctions. 035 §J pins it.
  -- -------------------------------------------------------------------------
  LOOP
    v_mock_loops := v_mock_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.is_mock
        AND d.draft_type <> 'auction'          -- 086/R362: this arm is the SNAKE CPU clock
        AND d.on_clock_team_id IS NOT NULL
        AND d.config->'mock'->>'human_team_id'
            IS DISTINCT FROM d.on_clock_team_id::text
        AND NOT (d.id = ANY(v_mock_seen))
        AND public.draft_league_alive(d.league_id)
        AND now() >= public.draft_mock_cpu_due(
              d.id, d.config, d.current_deadline, d.updated_at,
              d.current_pick_number)
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_mock_seen := v_mock_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify under the held lock (claim = snapshot pre-filter).
        IF v_draft.status <> 'live'
           OR NOT v_draft.is_mock
           OR v_draft.draft_type = 'auction'    -- 086/R362: snake CPU clock only
           OR v_draft.on_clock_team_id IS NULL
           OR v_draft.config->'mock'->>'human_team_id'
              = v_draft.on_clock_team_id::text
           OR now() < public.draft_mock_cpu_due(
                v_draft.id, v_draft.config, v_draft.current_deadline,
                v_draft.updated_at, v_draft.current_pick_number) THEN
          CONTINUE;
        END IF;
        IF NOT public.draft_league_alive(v_draft.league_id) THEN
          CONTINUE;
        END IF;

        -- THE SHARED BRAIN (D93/plan §4.2 — never a fork): resolution +
        -- the ONE advance path, §12.4's system-pick shape.
        v_player := public.draft_autopick_resolve(
          v_draft.id, v_draft.on_clock_team_id);
        IF v_player IS NULL THEN
          RAISE EXCEPTION
            'draft_tick: no available player for the CPU pick in mock draft % (pool exhausted)',
            v_draft.id;
        END IF;
        PERFORM public.draft_apply_pick_internal(
          v_draft.id, v_player, TRUE, 'autopick', NULL, NULL);
        v_mock_picked := v_mock_picked + 1;
      EXCEPTION WHEN OTHERS THEN
        v_mock_cpu_failures := v_mock_cpu_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick mock CPU arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_mock_loops >= c_max_loops;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 2.6 — THE AUCTION CLOCK (086/L.C1.4; §8.6.2 nomination timeout,
  -- §8.6.4 bid close, §8.6.6 completion, §8.6.7(b)(c)(e), §8.6.8 solvency;
  -- D126/D129(2)(3)(4)/D130). TWO sub-arms on ONE claim, selected by D126's
  -- phase rule: `current_nomination` NULL ⇒ the NOMINATION clock expired;
  -- non-NULL ⇒ the BID clock expired. Runs AFTER ARM 2.5 and BEFORE ARM 3
  -- exactly as tasks-M3 §6 sequences it, so an award or a system nomination
  -- is reflected in the same pass's heartbeat.
  -- CLAIM SCOPE (R135/R141): the WHERE is the body's own predicate — live +
  -- auction + due + alive league — so an auction mid-clock is never locked
  -- by this arm, and every predicate is re-verified under the held lock
  -- below. The c_batch ceiling and its >25-candidate rotation behaviour are
  -- ARM 2's, inherited deliberately: tasks-M3 §10 routes that to F50 (M7)
  -- and says ARM 2.6 shares it with no new row.
  -- MOCKS ARE IN (089/L.C1.7 — D132/D138): 086 excluded them while they were
  -- unreachable (071 refused auction mocks; 085's verbs refused them —
  -- F61, now discharged) and D160(9) said this task opens the claim. A mock
  -- auction runs the SAME two sub-arms — its nomination timeouts (the human
  -- seat under the LAUNCHER's grace, a CPU seat immediately — ARM 2's mock
  -- branch, mirrored below), its awards, its rotation and its completion
  -- (the writer's §8.8 mock bypass: drafts.complete + recap, zero
  -- league_rosters, no league transition). What a mock ADDS is the CPU
  -- sub-arm, ARM 2.6(c) below: CPU nominations on their think-time and CPU
  -- raises on theirs, both through the extracted internals the human path
  -- uses (089 banner items 3–5).
  -- -------------------------------------------------------------------------

  -- -------------------------------------------------------------------------
  -- ARM 2.6(c) — THE MOCK CPU SUB-ARM (089/L.C1.7; §8.8 "auction bots bid
  -- value-based … and pass the same max-bid/solvency validator as humans";
  -- D132/D138; D128 — the clock rule is the same INSERT + UPDATE). Runs
  -- BEFORE the expiry loop and is DISJOINT from it by construction: this
  -- claim requires the clock to be RUNNING (`current_deadline > now()`), the
  -- expiry loop requires it to have run OUT (`<= now()`) — so no CPU ever
  -- nominates or raises after the buzzer (a think-time that lands past zero
  -- simply misses), and an award in the same pass is the expiry loop's.
  -- CLAIM SCOPE (R135/R141): the WHERE is the body's predicate — live + mock
  -- + auction + alive league + clock running + think-time DUE via the ONE
  -- due computation (`draft_mock_auction_cpu_due`, claim ≡ re-check) — so a
  -- HEALTHY mock (think-time not yet reached) is never locked by this arm.
  -- Recorded residual (089 banner): a bidding-phase mock past its raise
  -- think-time is re-claimed each pass until a raise lands or the clock
  -- expires, even when every CPU folds — the claim cannot see the value
  -- model; the lock is one short read per pass.
  -- Two phases (D126):
  --   NOMINATING, CPU seat on the clock, think-time due → the CPU nominates
  --     through draft_system_nominate_internal (its OWN resolve chain at
  --     the nomination floor — D129(2); a CPU seat resolves as a no-user seat: ADP +
  --     need, never its real owner's prep — D110(4)). Think-time = 20–70%
  --     of the NOMINATION clock (the D93 PRNG seeded (draft, sequence)
  --     exactly as a snake CPU pick is) or ~2s under `fast`.
  --   BIDDING, raise think-time due → THE RESPONDER, once
  --     (draft_mock_cpu_respond_internal — 091/AP.3, D200(2)). What used to
  --     live inline here (the candidate scan and a hard-coded `+ $1`) is now
  --     ONE function shared with the reactive path, and the raise amount is
  --     the seeded curve of draft_mock_cpu_raise_amount.
  --     **AFTER 091 THIS ARM IS THE NO-ACTOR SAFETY NET, NOT THE
  --     HEARTBEAT** (§8.8: "a CPU raise is provoked by the bid it answers,
  --     never by the sweep"; D200(1)). A ladder normally resolves inside the
  --     transaction that provoked it — the human's bid, another CPU's
  --     raise, or the nomination that opened the market — so a mock that
  --     still reaches this line is one where nothing has happened since the
  --     market opened, and the responder will usually FOLD here (no
  --     candidate can beat the standing price). It is kept because the
  --     no-actor case is real: a market opened by a path that predates 091,
  --     or a board whose budgets moved under a commissioner edit between
  --     the open and now.
  --     Raise think-time (unchanged) = 20–70% of the BID clock from the
  --     last bid / the open (drafts.updated_at), seeded (draft, seq × 1000
  --     + bid count), or ~2s under `fast`; it gates THIS arm only — a
  --     reactive response is not timed at all, which is the §8.8 ruling and
  --     the reason the `fast`/`realistic` toggle no longer has any raise
  --     think-time to shorten (it still governs the NOMINATION think and
  --     ARM 2.5's snake picks). E62 is structural and unchanged: the cap is
  --     the validator's own number and draft_place_bid_internal re-enforces
  --     it; a decision the validator would refuse is recorded LOUDLY in
  --     auction_cpu_failures and writes nothing.
  -- -------------------------------------------------------------------------
  LOOP
    v_cpu_loops := v_cpu_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.is_mock
        AND d.draft_type = 'auction'
        AND d.current_deadline IS NOT NULL
        AND d.current_deadline > now()
        AND NOT (d.id = ANY(v_cpu_seen))
        AND public.draft_league_alive(d.league_id)
        AND (
          (d.current_nomination IS NULL
           AND d.on_clock_team_id IS NOT NULL
           AND d.config->'mock'->>'human_team_id'
               IS DISTINCT FROM d.on_clock_team_id::text
           AND now() >= public.draft_mock_auction_cpu_due(
                 d.id, d.config, d.current_deadline, d.updated_at,
                 d.current_pick_number, FALSE, 0))
          OR
          (d.current_nomination IS NOT NULL
           AND now() >= public.draft_mock_auction_cpu_due(
                 d.id, d.config, d.current_deadline, d.updated_at,
                 d.current_pick_number, TRUE,
                 (SELECT count(*)::int FROM public.draft_bids b
                  WHERE b.draft_id = d.id
                    AND b.nomination_seq = d.current_pick_number
                    AND b.player_id = d.current_nomination->>'player_id'
                    AND b.voided_at IS NULL)))
        )
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_cpu_claimed := v_cpu_claimed + 1;
      v_cpu_seen := v_cpu_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify EVERY claim predicate under the held lock (claim =
        -- snapshot pre-filter; body = authoritative — the R135 discipline).
        IF v_draft.status <> 'live'
           OR NOT v_draft.is_mock
           OR v_draft.draft_type <> 'auction'
           OR v_draft.current_deadline IS NULL
           OR v_draft.current_deadline <= now() THEN
          CONTINUE;
        END IF;
        IF NOT public.draft_league_alive(v_draft.league_id) THEN
          CONTINUE;
        END IF;

        IF v_draft.current_nomination IS NULL THEN
          -- ===== (c1) CPU NOMINATION on its think-time (D132/D129(2)) =====
          IF v_draft.on_clock_team_id IS NULL
             OR v_draft.config->'mock'->>'human_team_id'
                = v_draft.on_clock_team_id::text
             OR now() < public.draft_mock_auction_cpu_due(
                  v_draft.id, v_draft.config, v_draft.current_deadline,
                  v_draft.updated_at, v_draft.current_pick_number, FALSE, 0) THEN
            CONTINUE;
          END IF;
          -- The ONE system nomination (089 banner item 4): the same row,
          -- the same state, the same function the timeout path uses.
          PERFORM public.draft_system_nominate_internal(v_draft.id);
          v_cpu_nominated := v_cpu_nominated + 1;
        ELSE
          -- ===== (c2) THE CPU RESPONSE on its think-time (D132; 091/AP.3
          -- — the no-actor safety net, one call into the ONE responder) ====
          v_win_player := v_draft.current_nomination->>'player_id';
          v_high_team  := (v_draft.current_nomination->>'high_bidder_team_id')::uuid;
          IF v_win_player IS NULL OR v_high_team IS NULL THEN
            RAISE EXCEPTION
              'draft_tick: mock auction % has a malformed current_nomination (%) — refusing to bid',
              v_draft.id, v_draft.current_nomination;
          END IF;

          -- 'pass' = the LIVE bid count on this nomination (D130/D162: the
          -- player-matched, un-voided rows — history-derived, so the
          -- decision is reproducible from the rows alone).
          SELECT count(*)::int INTO v_bid_count
          FROM public.draft_bids b
          WHERE b.draft_id = v_draft.id
            AND b.nomination_seq = v_draft.current_pick_number
            AND b.player_id = v_win_player
            AND b.voided_at IS NULL;

          IF now() < public.draft_mock_auction_cpu_due(
               v_draft.id, v_draft.config, v_draft.current_deadline,
               v_draft.updated_at, v_draft.current_pick_number, TRUE,
               v_bid_count) THEN
            CONTINUE;
          END IF;

          -- THE ONE RESPONDER (091 banner item 4): the candidate scan, the
          -- seeded raise amount and the write — the same function, the same
          -- decisions and the same validator the reactive path uses, so the
          -- swept path and the provoked path can never drift apart (the 089
          -- extraction rule: a second consumer appeared). It returns the
          -- number of raises it wrote; 0 means every CPU folded at this
          -- price, the clock runs on, and the human (or the buzzer) decides.
          v_cpu_step := public.draft_mock_cpu_respond_internal(v_draft.id);
          IF v_cpu_step = 0 THEN
            v_cpu_folded := v_cpu_folded + 1;
          ELSE
            v_cpu_raised := v_cpu_raised + v_cpu_step;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_cpu_failures := v_cpu_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick mock auction CPU arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_cpu_loops >= c_max_loops;
  END LOOP;

  -- ARM 2.6 (a)/(b) — the clocks that ran OUT (086's two sub-arms, mocks
  -- included since 089).
  LOOP
    v_auc_loops := v_auc_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.draft_type = 'auction'
        AND d.current_deadline IS NOT NULL
        AND d.current_deadline <= now()
        AND NOT (d.id = ANY(v_auc_seen))
        AND public.draft_league_alive(d.league_id)
      ORDER BY d.current_deadline
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_auc_claimed := v_auc_claimed + 1;
      v_auc_seen := v_auc_seen || v_row.id;

      BEGIN
        SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_row.id;

        -- Re-verify EVERY claim predicate under the held lock (claim =
        -- snapshot pre-filter; body = authoritative — the R135 discipline).
        IF v_draft.status <> 'live'
           OR v_draft.draft_type <> 'auction'
           OR v_draft.current_deadline IS NULL
           OR v_draft.current_deadline > now()
           OR v_draft.on_clock_team_id IS NULL THEN
          CONTINUE;
        END IF;
        IF NOT public.draft_league_alive(v_draft.league_id) THEN
          CONTINUE;
        END IF;

        IF v_draft.current_nomination IS NULL THEN
          -- ===== (a) NOMINATION EXPIRY — §8.6.2's timeout; D129(2)(3) ====
          -- Seat derivation — ARM 2's two branches, verbatim. MOCK BRANCH
          -- (089 — D93/D103, mirrored from ARM 2): the HUMAN seat keys
          -- freshness/grace on the LAUNCHER (the seat's real owner and
          -- their is_autodraft are irrelevant inside a practice room — the
          -- launcher wants the clock pressure, §8.8); every CPU seat is a
          -- no-user seat here (immediate system nomination — normally ARM
          -- 2.6(c) nominates it on its think-time BEFORE the deadline, so
          -- reaching this arm means the tick was down past the deadline,
          -- and the timeout semantics are identical).
          IF v_draft.is_mock THEN
            IF v_draft.config->'mock'->>'human_team_id'
               = v_draft.on_clock_team_id::text THEN
              v_user := (v_draft.config->'mock'->>'launched_by')::uuid;
            ELSE
              v_user := NULL;
            END IF;
            v_autodraft := FALSE;
          ELSE
            SELECT m.user_id, COALESCE(m.is_autodraft, FALSE)
              INTO v_user, v_autodraft
            FROM public.league_members m
            WHERE m.league_id = v_draft.league_id
              AND m.team_id = v_draft.on_clock_team_id;
          END IF;

          v_grace := COALESCE(
            (v_draft.config->>'disconnect_grace_seconds')::int, 30);

          -- D102's contract carried to the NOMINATION clock (D129(3)):
          -- is_autodraft seats, no-user seats (placeholder/vacated — E48)
          -- and seats FRESH AS OF THE DEADLINE nominate AT the deadline; a
          -- STALE human seat is held to deadline + grace. Freshness is
          -- measured against the DEADLINE INSTANT (R132 — re-deriving it
          -- from now() would let a returning manager's post-deadline beat
          -- retroactively grant the fresh branch), through the SAME
          -- draft_liveness_freshness() constant every other arm reads. The
          -- manager may still nominate MANUALLY during the hold:
          -- draft_nominate never reads the deadline (085) — the E3 posture
          -- draft_make_pick has.
          IF v_user IS NOT NULL AND NOT COALESCE(v_autodraft, FALSE) THEN
            v_fresh := EXISTS (
              SELECT 1 FROM public.draft_liveness dl
              WHERE dl.draft_id = v_draft.id
                AND dl.user_id = v_user
                AND dl.last_seen_at > v_draft.current_deadline
                                      - public.draft_liveness_freshness()
                AND dl.last_seen_at <= v_draft.current_deadline
            );
            IF NOT v_fresh
               AND now() < v_draft.current_deadline
                           + make_interval(secs => v_grace) THEN
              -- HELD OPEN: the deadline stays past-due and this is
              -- re-evaluated every tick until deadline + grace.
              v_auc_held := v_auc_held + 1;
              CONTINUE;
            END IF;
          END IF;

          -- THE ONE SYSTEM NOMINATION (089 banner item 4 —
          -- draft_system_nominate_internal, extracted from this arm because
          -- the mock CPU think-time nomination is the second consumer): the
          -- §8.6.8 loud guards through the ONE derivation family (rule 7),
          -- the on-clock team's OWN resolve chain at the nomination floor
          -- (D129(2)/C33 — §8.6.7(e) satisfied a fortiori, §8.6.7(b)'s
          -- no-raise award always legal), the F62 opening-bid row with
          -- action_id NULL, and the D126 phase flip with the bid clock —
          -- byte-for-byte what this arm wrote inline before the extraction.
          PERFORM public.draft_system_nominate_internal(v_draft.id);

          v_auc_nominated := v_auc_nominated + 1;
        ELSE
          -- ===== (b) BID EXPIRY → THE AWARD — §8.6.4/§8.6.7(b); D130 =====
          -- 093/AP.2: EXTRACTED, not reimplemented (D199(3); the 089
          -- precedent — `draft_system_nominate_internal` came out of ARM
          -- 2.6(a) the day a second consumer appeared, and §8.6.9's instant
          -- award is this arm's second consumer). The ~190 lines that stood
          -- here are `draft_award_nomination_internal`, moved with every
          -- byte of their substance intact — the D143/D162 attribution
          -- lookup, the §8.6.8 re-check under the held lock, the §12.4
          -- write, the §8.6.7(c) rotation scan and the §8.6.6 completion —
          -- and the ONLY line that changed is the completion COUNTER, which
          -- belongs to this sweep and not to the award (it returns whether
          -- it completed the draft, and this arm counts it).
          IF public.draft_award_nomination_internal(v_draft.id) THEN
            v_auc_completed := v_auc_completed + 1;
          END IF;
          v_auc_awarded := v_auc_awarded + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_auc_failures := v_auc_failures || jsonb_build_object(
          'draft_id', v_row.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'draft_tick auction arm failed for draft %: % (%)',
          v_row.id, SQLERRM, SQLSTATE;
      END;
    END LOOP;

    EXIT WHEN v_pass = 0 OR v_auc_loops >= c_max_loops;
  END LOOP;

  -- -------------------------------------------------------------------------
  -- ARM 3 — the §9.1 tick heartbeat (amended in by L.B1.5/070 — see the
  -- banner). ONE realtime.send() per live draft per pass (~5s), event
  -- 'tick' on the draft topic, payload = server-now + the authoritative
  -- deadline (§9.3's clock-drift correction). LOCK-FREE by design
  -- (R135/R141: a PLAIN read — the beat claims nothing, locks nothing;
  -- a healthy live draft stays untouched by the tick's lock scope).
  -- Runs AFTER the state-changing arms so the beat reflects post-arm
  -- state. Deleted-league drafts excluded (the R141 discipline); paused
  -- drafts excluded (frozen clock — nothing to correct); mock drafts
  -- included once 071 makes them reachable (same room, same clock).
  -- realtime.send() traps its own errors; this block is containment
  -- symmetry with the other arms.
  -- -------------------------------------------------------------------------
  BEGIN
    FOR v_hb IN
      SELECT d.id, d.current_deadline
      FROM public.drafts d
      WHERE d.status = 'live'
        AND public.draft_league_alive(d.league_id)
    LOOP
      PERFORM realtime.send(
        jsonb_build_object(
          -- clock_timestamp(), not now(): the drift-correction beat must
          -- carry STATEMENT time — transaction_timestamp() is frozen at
          -- tick-txn start, so it would bake the txn's own runtime into
          -- the very drift figure the beat exists to correct (R146).
          'server_now', clock_timestamp(),
          'current_deadline', v_hb.current_deadline),
        'tick',
        'draft:' || v_hb.id::text,
        true);
      v_heartbeats := v_heartbeats + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    v_heartbeat_failures := v_heartbeat_failures || jsonb_build_object(
      'sqlstate', SQLSTATE, 'error', SQLERRM);
    RAISE WARNING 'draft_tick heartbeat arm failed: % (%)', SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object(
    'scanned_scheduled_leagues', v_scanned,
    'auto_started', v_started,
    'start_failures', v_start_failures,
    'outage_paused', v_outage_paused,
    'outage_failures', v_outage_failures,
    'mock_paused', v_mock_paused,
    'mock_pause_failures', v_mock_pause_failures,
    'mock_cpu_picked', v_mock_picked,
    'mock_cpu_failures', v_mock_cpu_failures,
    'claimed_due', v_claimed,
    'autopicked', v_picked,
    'held_for_grace', v_held,
    'pick_failures', v_pick_failures,
    'heartbeats', v_heartbeats,
    'heartbeat_failures', v_heartbeat_failures,
    'auction_claimed_due', v_auc_claimed,
    'auction_nominated', v_auc_nominated,
    'auction_awarded', v_auc_awarded,
    'auction_held_for_grace', v_auc_held,
    'auction_completed', v_auc_completed,
    'auction_failures', v_auc_failures,
    'auction_loops', v_auc_loops,
    'auction_cpu_claimed', v_cpu_claimed,
    'auction_cpu_nominated', v_cpu_nominated,
    'auction_cpu_raised', v_cpu_raised,
    'auction_cpu_folded', v_cpu_folded,
    'auction_cpu_failures', v_cpu_failures,
    'auction_cpu_loops', v_cpu_loops,
    'loops', v_loops);
END;
$$;
REVOKE EXECUTE ON FUNCTION draft_tick() FROM PUBLIC, anon, authenticated;

-- finalize_matchups — 183_job_knobs.sql:876-1149 FILE TEXT (D137), 1 hunk (+6 / -0).
CREATE OR REPLACE FUNCTION finalize_matchups(
  p_now       TIMESTAMPTZ DEFAULT now(),
  p_league_id UUID        DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_batch     CONSTANT INTEGER := 25;
  c_max_loops CONSTANT INTEGER := 40;
  v_seen         UUID[] := '{}';
  v_loops        INTEGER := 0;
  v_pass         INTEGER;
  v_lg           RECORD;
  v_league       public.leagues;
  v_settings     JSONB;
  v_mode         TEXT;
  v_lw           RECORD;
  v_g            RECORD;
  v_m            RECORD;
  v_res          TEXT;
  v_cnt          INTEGER;
  v_twr          INTEGER;
  v_median       NUMERIC;
  v_matchups     INTEGER;
  v_pend         JSONB;
  v_w            RECORD;
  v_finalized    INTEGER := 0;
  v_lg_finalized INTEGER := 0;
  v_lg_report    JSONB := '[]'::jsonb;
  v_leagues      INTEGER := 0;
  v_report       JSONB := '[]'::jsonb;
  v_skipped      JSONB := '[]'::jsonb;
  v_failures     JSONB := '[]'::jsonb;
  v_live_past    JSONB := '[]'::jsonb;
  v_weeks        INTEGER[];
  v_bracket      JSONB;
  v_brackets     JSONB := '[]'::jsonb;
  v_bracket_failures JSONB := '[]'::jsonb;
  v_bracket_blocked  JSONB := '[]'::jsonb;
  v_bracket_waiting  JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'finalize_matchups: a job RPC is run by pg_cron or the service role, never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.job_pause_note_internal('week-finalize', p_league_id, p_now);   -- 183 / L.G1.3 (TD4)

  LOOP
    v_loops := v_loops + 1;
    v_pass := 0;

    -- Claim LEAGUES with a due week (rule 8: the league row first).
    FOR v_lg IN
      SELECT l.id
      FROM public.leagues l
      WHERE l.status IN ('in_season', 'playoffs')
        AND l.deleted_at IS NULL
        AND (p_league_id IS NULL OR l.id = p_league_id)
        AND NOT (l.id = ANY (v_seen))
        AND NOT public.job_paused_internal('week-finalize', l.id)   -- 183 / L.G1.3 (TD4)
        AND EXISTS (
          SELECT 1
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = l.id AND lw.season = l.season
            AND (   (lw.status = 'correction_window' AND w.correction_window_ends_at <= p_now)
                 OR (lw.status = 'live'              AND w.last_game_ends_at IS NULL
                                                    AND w.correction_window_ends_at <= p_now)))
      ORDER BY l.id
      LIMIT c_batch
      FOR UPDATE SKIP LOCKED
    LOOP
      v_pass := v_pass + 1;
      v_seen := v_seen || v_lg.id;
      v_leagues := v_leagues + 1;

      -- F244: the league's count/report accumulate in LOCALS and merge only
      -- after the subtransaction COMMITS (a later week's raise rolls the
      -- league's writes back; PL/pgSQL keeps variables — the report must not).
      v_lg_finalized := 0;
      v_lg_report := '[]'::jsonb;
      BEGIN
        SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_lg.id;
        v_settings  := COALESCE(v_league.settings, '{}'::jsonb);
        v_mode      := COALESCE(v_settings ->> 'schedule_mode', 'h2h');

        -- LOUD (F238, the other side): live weeks past their window are not
        -- finalizable — the advance job could not close them.
        SELECT array_agg(lw.week ORDER BY lw.week) INTO v_weeks
        FROM public.league_weeks lw
        JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
        WHERE lw.league_id = v_lg.id AND lw.season = v_league.season
          AND lw.status = 'live' AND w.last_game_ends_at IS NULL
          AND w.correction_window_ends_at <= p_now;
        IF v_weeks IS NOT NULL THEN
          v_live_past := v_live_past || jsonb_build_object('league_id', v_lg.id, 'weeks', to_jsonb(v_weeks));
        END IF;

        FOR v_lw IN
          SELECT lw.id, lw.week, w.correction_window_ends_at
          FROM public.league_weeks lw
          JOIN public.nfl_weeks w ON w.season = lw.season AND w.week = lw.week
          WHERE lw.league_id = v_lg.id
            AND lw.season = v_league.season
            AND lw.status = 'correction_window'
            AND w.correction_window_ends_at <= p_now
          ORDER BY lw.week
          FOR UPDATE OF lw
        LOOP
          -- (a) §23.2: every non-postponed game of the week final, at run time.
          SELECT * INTO v_g FROM public.week_games_state_internal(v_league.season, v_lw.week);
          IF NOT v_g.all_final THEN
            v_skipped := v_skipped || jsonb_build_object(
              'league_id', v_lg.id, 'week', v_lw.week, 'reason', 'games_not_final',
              'total', v_g.total_games, 'final', v_g.final_games,
              'postponed', v_g.postponed_games, 'open', v_g.open_games);
            RAISE NOTICE 'finalize_matchups: league % week % not finalized — % of % in-week games final (% postponed, % open); no league state advances on partial data (§23.2)',
              v_lg.id, v_lw.week, v_g.final_games, v_g.total_games - v_g.postponed_games, v_g.postponed_games, v_g.open_games;
            CONTINUE;
          END IF;
          SELECT count(*)::int INTO v_cnt FROM public.score_fanout f WHERE f.season = v_league.season AND f.week = v_lw.week AND EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = v_lg.id AND r.player_id = f.player_id);   -- 212 / F716 (R1730)
          IF v_cnt > 0 THEN   -- 212 / F716 (R1730): a score still queued for this league's players — the week waits for it
            v_skipped := v_skipped || jsonb_build_object('league_id', v_lg.id, 'week', v_lw.week, 'reason', 'scores_queued', 'queued', v_cnt);   -- 212 / F716 (R1730)
            RAISE NOTICE 'finalize_matchups: league % week % not finalized — % queued score(s) for its rostered players are not written yet; never finalized over a pending score (R1730)', v_lg.id, v_lw.week, v_cnt;   -- 212 / F716 (R1730)
            CONTINUE;   -- 212 / F716 (R1730)
          END IF;   -- 212 / F716 (R1730)

          v_matchups := 0;

          -- (b)/(c) THE PENDING SHAPES, BY NAME — 117's
          --     `week_results_pending_internal` (D137: ONE reading of
          --     "pending" for finalization AND the rebuild; called, never
          --     copied): h2h — a NULL score on ANY matchup, overridden or
          --     not (E61, R792); total_points — ANY seated team without a
          --     result row (R788). The week is SKIPPED BY NAME and stays
          --     `correction_window`; nothing is coerced to 0.00.
          v_pend := public.week_results_pending_internal(v_lg.id, v_league.season, v_lw.week);
          IF v_pend IS NOT NULL THEN
            v_skipped := v_skipped || (jsonb_build_object('league_id', v_lg.id, 'week', v_lw.week) || v_pend);
            RAISE NOTICE 'finalize_matchups: league % week % not finalized — % (pending; absence is not a score — E61/§23.2; never coerced to 0.00)',
              v_lg.id, v_lw.week, v_pend ->> 'reason';
            CONTINUE;
          END IF;

          IF v_mode = 'h2h' THEN
            -- Results per matchup (E38: two decimals, ties are ties — 117's
            -- `matchup_result_internal` is the ONE derivation, shared with
            -- the rebuild's drift check); an overridden cell is never
            -- touched (§22.2).
            FOR v_m IN
              SELECT m.* FROM public.matchups m
              WHERE m.league_id = v_lg.id AND m.season = v_league.season AND m.week = v_lw.week
              ORDER BY m.round_type, m.id
              FOR UPDATE
            LOOP
              v_res := public.matchup_result_internal(v_m.home_score, v_m.away_score, v_m.away_team_id);
              IF v_m.is_overridden THEN
                -- The cell stands: scores untouched, an overridden result
                -- untouched; a NULL result is read from the overridden scores.
                UPDATE public.matchups
                SET status = 'final', result = COALESCE(v_m.result, v_res), updated_at = p_now
                WHERE id = v_m.id;
              ELSE
                UPDATE public.matchups
                SET status = 'final', result = v_res, updated_at = p_now
                WHERE id = v_m.id;
              END IF;
              v_matchups := v_matchups + 1;
            END LOOP;
          END IF;

          -- (c)/(d) THE RESULTS MATH — 117's `week_results_write_internal`
          --     (D137: the ONE writer of `team_week_results` for a closed
          --     week; `rebuild_team_week_results` calls the same helper and
          --     pgTAP 065 pins the two byte-identical): the h2h rows from the
          --     now-final matchups (PF once; the primary + the `secondary`
          --     row; the shape guards), the total_points rows flipped
          --     `is_final`, the EXACT median (E39) compared and its cells
          --     written. `median` is NULL when median_game is off or the
          --     week is a playoff week.
          SELECT * INTO v_w FROM public.week_results_write_internal(v_lg.id, v_league.season, v_lw.week);
          v_twr := v_w.results;
          v_median := v_w.median;

          -- (e) the week → final (F4's last legal step).
          UPDATE public.league_weeks
          SET status = 'final', finalized_at = p_now, median_score = v_median
          WHERE id = v_lw.id;
          GET DIAGNOSTICS v_cnt = ROW_COUNT;
          IF v_cnt <> 1 THEN
            RAISE EXCEPTION 'finalize_matchups: finalizing week % of league % touched % rows, expected 1', v_lw.week, v_lg.id, v_cnt
              USING ERRCODE = 'P0001';
          END IF;

          -- E43: the system note when a postponed game was excluded.
          IF v_g.postponed_games > 0 THEN
            INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
            VALUES (v_lg.id, NULL,
              'Week ' || v_lw.week || ' is final without the postponed game' ||
              CASE WHEN v_g.postponed_games > 1 THEN 's ' ELSE ' ' END || v_g.postponed_list ||
              ' — players in a game moved out of the week score 0 for the week. The commissioner can change a result.',
              'league', TRUE);
          END IF;

          v_lg_finalized := v_lg_finalized + 1;
          v_lg_report := v_lg_report || jsonb_build_object(
            'league_id', v_lg.id, 'week', v_lw.week, 'schedule_mode', v_mode,
            'matchups_final', v_matchups, 'results', v_twr,
            'median_score', v_median,
            'postponed_excluded', v_g.postponed_games);
        END LOOP;

        -- 118 (Q39 (D)/(E), the CORRECTION CLOSE): the bracket / champion
        -- consequences after this league's weeks — every claim, idempotent:
        -- the round rebuilt from FINAL results when a correction moved a
        -- seed; the champion + `complete` at the last week's final (rank 1
        -- through the full chain when there is no bracket — (C)/(D)). Guarded
        -- so a bracket problem is LOUD (`bracket_failures` + WARNING) and
        -- RETRIED next run — never a rollback of the week's finalization.
        BEGIN
          v_bracket := public.playoff_bracket_sync_internal(v_lg.id, p_now);
          IF v_bracket ? 'action' THEN
            v_brackets := v_brackets || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
          -- R841: a bracket a HUMAN must unblock (a seedless playoff row; a
          -- played round the prior verdict moved under — R839) is named on
          -- the hourly payload + WARNING; one WAITING on pending scores
          -- (R840, §23.2/E61) likewise — retried next run. The calendar
          -- `waiting_*` states (the prior stage not yet rolled) are the
          -- every-hour normal and stay out of the payload.
          ELSIF v_bracket ->> 'reason' IN ('bracket_foreign_rows', 'rebuild_refused_round_played') THEN
            v_bracket_blocked := v_bracket_blocked || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'finalize_matchups: league % playoff bracket BLOCKED at round % — % (a commissioner must act — M6 §10; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket ->> 'reason';
          ELSIF v_bracket ->> 'reason' = 'bracket_waiting' THEN
            v_bracket_waiting := v_bracket_waiting || (jsonb_build_object('league_id', v_lg.id) || v_bracket);
            RAISE WARNING 'finalize_matchups: league % playoff bracket round % WAITING — the prior stage holds pending scores % (§23.2/E61: never seeded from an absent score; retried next run)', v_lg.id, v_bracket ->> 'round', v_bracket -> 'pending';
          END IF;
        EXCEPTION WHEN OTHERS THEN
          v_bracket_failures := v_bracket_failures || jsonb_build_object(
            'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
          RAISE WARNING 'finalize_matchups: playoff bracket sync failed for league %: % (%) — retried next run', v_lg.id, SQLERRM, SQLSTATE;
        END;
      EXCEPTION WHEN OTHERS THEN
        v_failures := v_failures || jsonb_build_object(
          'league_id', v_lg.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
        RAISE WARNING 'finalize_matchups failed for league %: % (%)', v_lg.id, SQLERRM, SQLSTATE;
        -- F244: everything this league reported ROLLED BACK with it.
        v_lg_finalized := 0;
        v_lg_report := '[]'::jsonb;
      END;
      -- F244: merge only what COMMITTED.
      v_finalized := v_finalized + v_lg_finalized;
      v_report := v_report || v_lg_report;
    END LOOP;

    EXIT WHEN v_pass < c_batch OR v_loops >= c_max_loops;
  END LOOP;

  RETURN jsonb_build_object(
    'at',               p_now,
    'scope',            p_league_id,
    'leagues',          v_leagues,
    'finalized',        v_finalized,
    'weeks',            v_report,
    'skipped',          v_skipped,
    'live_past_window', v_live_past,
    'brackets',         v_brackets,
    'bracket_failures', v_bracket_failures,
    'bracket_blocked',  v_bracket_blocked,
    'bracket_waiting',  v_bracket_waiting,
    'failures',         v_failures,
    'loops',            v_loops,
    'reason', CASE
      WHEN v_leagues = 0 THEN 'nothing_due'
      WHEN v_finalized = 0 AND jsonb_array_length(v_brackets) = 0 THEN 'nothing_finalized'
      ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION finalize_matchups(TIMESTAMPTZ, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Review fixes (PR #543): R1733 — the operator's prelude names an
--    archived league; R1725 — an archived league still uses its scoring
--    system (so its rules stay behind the receipted editor and the walls).
-- ---------------------------------------------------------------------------
-- op_verb_prelude_internal — 184_game_status.sql:573-617 FILE TEXT (D137), 1 hunk (+1 / -0).
CREATE OR REPLACE FUNCTION op_verb_prelude_internal(
  p_verb TEXT, p_league_id UUID, p_action_id UUID, p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rec public.platform_operator_actions;
BEGIN
  IF NOT public.is_platform_operator() THEN
    RAISE EXCEPTION '%: only a platform operator can use the operator tools (M8 TD1)', p_verb
      USING ERRCODE = '42501';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION '%: p_action_id is required — it makes a retry safe (M8 TD3)', p_verb
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL AND (length(btrim(p_reason, E' \t\r\n')) = 0 OR length(p_reason) > 500) THEN
    RAISE EXCEPTION '%: a reason is optional, but when given it is non-blank and at most 500 characters', p_verb
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rec FROM public.platform_operator_actions a WHERE a.action_id = p_action_id;
  IF FOUND THEN
    IF v_rec.verb <> p_verb OR v_rec.actor_id <> auth.uid()
       OR v_rec.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION '%: action id % was already used for a different operator action', p_verb, p_action_id
        USING ERRCODE = '22023';
    END IF;
    RETURN COALESCE(v_rec.after, '{}'::jsonb) || jsonb_build_object('replayed', TRUE, 'receipt_id', v_rec.id);
  END IF;

  IF p_league_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NOT NULL) THEN RAISE EXCEPTION '%: league % is archived — restore it first (the admin league page''s Restore)', p_verb, p_league_id USING ERRCODE = 'P0002'; END IF;   -- 212 / F716 (R1733)
    -- The row lock: waits out an in-flight job run of this league (each job
    -- claims the league FOR UPDATE SKIP LOCKED), and makes a concurrent
    -- scheduled run SKIP the league while this verb commits.
    PERFORM 1 FROM public.leagues l WHERE l.id = p_league_id AND l.deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: league % does not exist', p_verb, p_league_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION op_verb_prelude_internal(TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- scoring_system_league_use_internal — 170_commish_backstop.sql:2480-2497 FILE TEXT (D137), 1 hunk (+1 / -1).
CREATE OR REPLACE FUNCTION scoring_system_league_use_internal(p_scoring_system_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- The name of a live league that plays by this scoring system — asked
  -- ONLY about the caller's own row (the in-body gate: owner_id =
  -- auth.uid()); for anyone else's row the answer is NULL, so nothing about
  -- another user's system is ever told.
  SELECT l.name
  FROM public.scoring_systems s
  JOIN public.leagues l ON l.scoring_system_id = s.id   -- F716 / 212 (R1725): an ARCHIVED league still plays by it (was `AND l.deleted_at IS NULL`)
  WHERE s.id = p_scoring_system_id AND s.owner_id = (SELECT auth.uid())
  ORDER BY l.created_at, l.id
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION scoring_system_league_use_internal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION scoring_system_league_use_internal(UUID) TO authenticated;

-- scoring_systems_rules_guard — 104_scoring_write_walls.sql:391-468 FILE TEXT (D137), 1 hunk (+1 / -1).
CREATE OR REPLACE FUNCTION public.scoring_systems_rules_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_in_profile BOOLEAN;
BEGIN
  -- ── Is the NEW row in the league profile? (D175(2), the three arms) ─────
  v_new_in_profile :=
       COALESCE(NEW.is_template, FALSE)
    OR (NEW.rules ? 'format')
    OR EXISTS (
         SELECT 1 FROM public.leagues l
         WHERE l.scoring_system_id = NEW.id
           -- F716 / 212 (R1725): an ARCHIVED league still uses it (was `AND l.deleted_at IS NULL`)
       );

  -- Outside the profile: the D33 research world. Legacy column-name docs are
  -- valid under their OWN rules and the league validator has no jurisdiction.
  -- This is also the arm that leaves a mock-only reference
  -- (`drafts.config->>'scoring_system_id'`, D175(6)) writable — deliberately.
  IF NOT v_new_in_profile THEN
    RETURN NEW;
  END IF;

  -- Already in the profile, carrying the IDENTICAL document: it passed this
  -- wall on the write that put it there, and D175(4) says existing rows are
  -- never retroactively invalidated. Anything else — an INSERT, a changed
  -- `rules`, or a row ENTERING the profile (e.g. an `is_template` flip that
  -- never touches `rules`) — is validated.
  IF TG_OP = 'UPDATE'
     AND NEW.rules IS NOT DISTINCT FROM OLD.rules
     -- ── R615: THE SKIP MUST NOT APPLY TO A ROW *ENTERING* AN ARM ──────────
     -- Without these two conjuncts the short-circuit is a two-step escape,
     -- and it was measured over PostgREST: put a private invalid row into the
     -- profile via arm (c) (a `leagues` write, which fires nothing here), then
     -- `PATCH {is_template: true, owner_id: null}` — `rules` untouched, OLD
     -- already in profile, so the guard skipped it and returned 200. The row
     -- is then a world-readable template (058's "Templates viewable by
     -- everyone") that an ORDINARY commissioner attaches through
     -- `create_league` / `update_league_settings`. §E6 pinned only the
     -- ONE-step flip, which the guard did refuse. One conjunct per arm whose
     -- membership can change without `rules` changing: `is_template` is arm
     -- (a); `id` is the SUBJECT the other two arms are read against, so a
     -- fresh-id write re-enters the predicate under a different identity.
     -- (R630 corrects an earlier sentence here that called `id` "arm (c)'s
     -- subject": arm (c) can never be the subject of a PK change — all five
     -- inbound FKs are `condeferrable = f, confupdtype = 'a'`, so a referenced
     -- row's id cannot move. The conjunct earns its place on arm (a): forge an
     -- invalid template and a fresh-id change is refused P0001 with it and
     -- succeeds without it — measured by three reviewers.)
     AND NEW.is_template IS NOT DISTINCT FROM OLD.is_template
     AND NEW.id IS NOT DISTINCT FROM OLD.id
  THEN
    -- ── R629: THE OLD-SIDE PROFILE DISJUNCTION USED TO BE RE-EVALUATED HERE,
    -- AND IT WAS A TAUTOLOGY. Deleted rather than pinned, because a clause
    -- that cannot change an outcome cannot be given a killing cell and would
    -- have stood forever as three unfalsifiable lines. The proof is two
    -- sentences: control has already returned unless NEW is in the profile,
    -- and the three conjuncts above hold `rules`, `is_template` and `id`
    -- equal — which are exactly the three inputs the profile predicate reads.
    -- So OLD-in-profile ≡ NEW-in-profile ≡ TRUE here, always. Measured:
    -- deleting the whole block leaves 052 at 85/85 and that green is CORRECT,
    -- while deleting any single disjunct from it changed behaviour and red
    -- nothing — the signature of a clause whose arms are unreachable.
    RETURN NEW;
  END IF;

  -- No catch, no wrap, no re-word: P0001 + MESSAGE/DETAIL/HINT propagates
  -- exactly as 103 raised it, which is the contract SE.5/SE.6 turn into a
  -- field path.
  PERFORM public.scoring_rules_validate(NEW.rules);

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.scoring_systems_rules_guard()
  FROM PUBLIC, anon, authenticated, service_role;
