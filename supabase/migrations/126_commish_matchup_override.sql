-- ============================================================================
-- `commish_edit_score` / `commish_set_result` — the matchup override, F325's
-- `matchups` backstop, and the rebuild's GUC narrowing — migration 126
-- (task L.E1.5 of M6A; spec §15.4:1692-1693, §22.2, §12.12, §10.3, §11.2;
-- tasks-M6A §3 D341 / D342 / D343 / D344 / D350 / D353 and §4 rules 1-15;
-- PROGRESS §3 STANDING RULE clauses (b), (g), (i); D137).
--
-- WHAT THIS MIGRATION DOES
--   1. `commish_matchup_actions` — this verb family's OWN zero-policy replay
--      ledger (D350), `UNIQUE (league_id, action_id)` + `REVOKE TRUNCATE`.
--   2. `matchups_override_guard_internal` + `trg_matchups_override_guard` —
--      §12.12's `BEFORE UPDATE` backstop, `ENABLE ALWAYS`, with D343's
--      CORRECTED predicate. **F325 is discharged here.**
--   3. `rebuild_team_week_results` — `CREATE OR REPLACE` against 117's FILE
--      TEXT with its first guard NARROWED (D344), so `117:722-728`'s header
--      promise ("called ... in-body by M6's audited commissioner verbs") is
--      true for the first time.
--   4. `commish_matchup_override_internal` — ONE verb, TWO optional arms
--      (D341), writing `home_score` / `away_score` / `result` /
--      `is_overridden` / `override_action_id` in a SINGLE statement.
--   5. `commish_edit_score` (`spec:1692`) and `commish_set_result`
--      (`spec:1693`) — the two SECURITY DEFINER routes over that one family.
--
-- THE FIRST WRITER OF `matchups.is_overridden` AND `override_action_id`.
-- Measured before writing: `109:168-169` declares both (`is_overridden
-- BOOLEAN NOT NULL DEFAULT FALSE`, `override_action_id UUID` whose FK landed
-- at `123:459-460`), and nothing in 109-125 writes either. `123:163-177` said
-- so in advance and named this verb as the successor. Two consequences, and
-- both are deliberate:
--   * **123's deferral reason for the backstop EXPIRES HERE** (D343). It was
--     "pure hot-path risk on a table 111/116/117/119 UPDATE in loops" while
--     no verb wrote the flag. There is a writer now, so the trigger ships in
--     the SAME migration as its first writer rather than as a follow-up.
--   * The hot path is protected **in the trigger's WHEN clause**, not merely
--     in its body: `WHEN (NEW.is_overridden IS DISTINCT FROM OLD.is_overridden)`
--     means the scoring door's per-row UPDATEs never enter the trigger
--     function at all. The same predicate is re-stated in the body so a
--     prosrc pin can see it and so the guard survives a trigger recreated
--     without its WHEN clause.
--
-- THE BACKSTOP'S PREDICATE IS DELIBERATELY NOT §12.12'S PRINTED ONE (D343).
-- §12.12:1216-1218 prints `IF (NEW.is_overridden AND COALESCE(current_setting(
-- 'app.commish_action_id', true), '') = '')`. That form BREAKS
-- `finalize_matchups`: its overridden branch UPDATEs an already-overridden
-- row to flip only `status` (and to fill a NULL `result` from the overridden
-- scores) from a pg_cron job that sets no GUC — the newest defining body is
-- `118:2098-2100`, inside the `118:2083-2107` per-matchup loop. Under the
-- printed predicate that UPDATE raises and every overridden league-week
-- becomes unfinalizable for ever. The predicate shipped here is
-- `NEW.is_overridden IS DISTINCT FROM OLD.is_overridden`, which is
--   * NARROWER — a status-only flip on an already-overridden row passes; and
--   * WIDER — a TRUE→FALSE un-override is guarded too, which the printed
--     sketch misses entirely (it only ever looks at NEW).
-- pgTAP 074 §H proves both directions AND proves `finalize_matchups` still
-- flips an already-overridden row, and the mandated break probe reverts this
-- predicate to the printed form and watches that cell go red by name.
--
-- The trigger is `BEFORE UPDATE` and NOT `BEFORE INSERT`, exactly as §12.12
-- prints it. An INSERT carrying `is_overridden = TRUE` is unguarded by
-- design: the only INSERTers of `matchups` are the schedule engine (110),
-- Remix (111) and the playoff bracket (118), all of which take the column
-- default, and no client holds an INSERT policy on the table at all
-- (`109:193-194`: one SELECT policy, no write policy for any role). Guarding
-- INSERT would buy nothing and would cost every schedule generation a
-- per-row trigger call.
--
-- D137 PROVENANCE — `rebuild_team_week_results`. The replacement below is
-- authored against the CURRENT FILE TEXT of its newest defining migration,
-- `117_standings_rebuild.sql:758-891` — never against `pg_get_functiondef`
-- and never against whatever body is deployed (CLAUDE.md's migration
-- discipline; migration 073 once silently reverted three migrations' guards
-- exactly that way). 117 is merged and is NOT edited; its banner stays
-- historical. **THE BODY CARRIES EXACTLY ONE HUNK** — the first guard,
-- `117:779-782`. Everything else between `BEGIN` and the final `END` is 117's
-- text byte for byte: the lock order, the two P0002 lookups, the
-- `week_not_final` refusal, the pending helper, the `matchup_not_final` and
-- `result_drift` checks, both digests, the median write and its ROW_COUNT
-- assertion, and the returned document's fifteen keys. The CONTRACT DOCBLOCK
-- above the function is re-stated rather than copied, because its authority
-- bullet is the sentence this migration makes true; that is a comment, not
-- code, and it is called out here so the diff is not read as a second hunk.
--
-- THE NARROWING, AND WHY IT IS A NARROWING AND NOT A LIFT (D344). 117's
-- guard is `IF auth.uid() IS NOT NULL THEN RAISE ... 42501`. SECURITY DEFINER
-- does not clear `auth.uid()`, so the rebuild has never been callable in-body
-- by an audited commissioner verb — while `117:722-728`'s own header says it
-- is. The guard becomes
--     IF auth.uid() IS NOT NULL
--        AND coalesce(current_setting('app.commish_action_id', true), '') = ''
--     THEN RAISE ... 42501
-- and it costs nothing, because `log_commissioner_action_internal` already
-- sets that GUC transaction-locally as a side effect of writing the audit row
-- (`123:447`). The GUC cannot be forged from a client: `set_config` is
-- reachable, but a GUC alone opens no door — the rebuild still refuses every
-- caller who cannot also reach a `commissioner_actions` INSERT, and the
-- backstop above refuses every `is_overridden` write that has not been
-- through the helper. **The security claim is asserted FIRST in pgTAP 074
-- (§A): a signed-in caller with NO GUC is still refused with 42501**, and the
-- mandated break probe reverts this narrowing and watches the in-body
-- propagation cell red.
--
-- ONE VERB, TWO ARMS, ONE STATEMENT (D341). §15.4 prints two routes and both
-- ship, but they cannot be two independent verbs: `rebuild_team_week_results`
-- refuses a whole week, permanently, when a NON-overridden row's stored
-- `result` is not the E38 result of its own scores (`result_drift`, the
-- predicate at `117:829-835` and the refusal at `117:836-839`, whose text
-- already says "a score correction must write the row's result with it
-- (F245)"). Two verbs that can each write half the pair are a foot-gun with a
-- permanent consequence. So both routes call ONE internal, which writes all
-- five columns in a SINGLE UPDATE. **This discharges F245 in part** — the
-- override half; F245's L.E2 apply-path half stays open.
--
-- ROW GRANULARITY (D342, spec v2.16.39's §22.2 erratum). `is_overridden` is
-- one boolean on the ROW and all seven readers are row-scoped, so correcting
-- one team's number means restating the other's: the score arm takes BOTH
-- scores and refuses one alone by name. A BYE row (`away_team_id IS NULL`)
-- refuses the RESULT arm by name — `matchup_result_internal` returns NULL for
-- a bye (`117:211`) and every derive maps a NULL away side to `bye` before
-- consulting `result` at all, so setting a result there writes a column
-- nothing reads: a no-op wearing a success's clothes.
--
-- THE RESULT ARM CANNOT EXPRESS A TIE, AND SAYS SO IN ITS REFUSAL. `spec:1693`
-- prints `commish_set_result(matchup_id, winner, reason)` and a `winner` UUID
-- has no value meaning "neither". A tie is reachable — through the SCORE arm
-- with equal scores, where `matchup_result_internal` derives `'tie'` — so the
-- capability is not missing, only routed. The refusal for a winner who is not
-- a side of the matchup NAMES that route rather than leaving the commissioner
-- to discover it. **F351** records it for L.E1.12's copy.
--
-- THE ORDER OF THE RECEIPT AND THE WRITE IS §12.12'S, NOT 123'S, AND THAT IS
-- FORCED. D336 part (2) says the log call goes INSIDE the no-op guard and
-- AFTER the state write. Here the log call must come FIRST, for two
-- independent reasons, and §12.12 prints it in exactly that order
-- ("inside every override RPC, same transaction as the state change:
-- PERFORM set_config(...); trigger sketch on e.g. matchups"):
--   (i) the backstop above refuses an `is_overridden` write with no GUC, and
--       the GUC is set BY the logging helper — a verb that wrote first would
--       be refused by its own guard; and
--   (ii) `matchups.override_action_id` is an FK to `commissioner_actions(id)`
--       (`123:459-460`) and the single-statement rule (D341) requires that id
--       to be in hand before the UPDATE runs.
-- **The load-bearing half of D336(2) is untouched:** both the log call and
-- the write sit INSIDE `IF NOT v_no_changes THEN`, so Chris's one condition
-- holds — "no receipt if nothing is done. only when something is done." And
-- if the UPDATE then fails, the transaction aborts and takes the audit row
-- with it; a receipt can never outlive its change.
--
-- `before` / `after` MIRROR THE FOUR VALUE DIMENSIONS, AND `override_action_id`
-- IS IN `metadata` INSTEAD — because its "after" value IS the audit row's own
-- `id`. Printing a row's primary key inside its own `after` document is noise,
-- and the log helper mints the id, so the value cannot exist before the call
-- that consumes the document. `metadata.override_action_id_before` carries the
-- id being replaced (NULL the first time), and pgTAP 074 §E asserts
-- `matchups.override_action_id = commissioner_actions.id` directly.
--
-- Q61 IS OPEN AND IS CHRIS'S, AND THIS BUILDS TO ITS RECOMMENDATION WITH THE
-- DEFAULT ON ONE LINE. "On a live week, does `commish_edit_score` set
-- `is_overridden`?" Setting it FREEZES the cell out of `score_write_week_batch`
-- for the rest of the week (the exclusion is in both the writable count and
-- the one UPDATE — `119:634` and `119:654`); NOT setting it means the next
-- drain overwrites the commissioner within a minute. The recommendation on
-- file (tasks-M6A §11) is **set it** — the commissioner's number is the
-- league's answer, un-freezing is a second audited act — **and make the verb
-- REPORT the freeze** so it is a stated consequence rather than a discovered
-- one (§4 rule 15). That is what ships: `live_scoring_frozen` +
-- `live_scoring_frozen_why` in the result AND a clause in the `league_chat`
-- post. **THE SWAP IS ONE LINE** — grep `Q61 SWAP LINE` below; changing
-- `v_set_overridden := TRUE;` to `v_set_overridden := v_week_final;` ships the
-- other ruling with no other edit, because every downstream field already
-- reads that variable.
--
-- WHAT THIS MIGRATION DOES NOT DO, DELIBERATELY
--   * `score_write_week_batch` (119), `finalize_matchups` (118),
--     `week_results_write_internal` / `week_results_pending_internal` /
--     `matchup_result_internal` (117) and `league_standings` (117) are NOT
--     touched — not one byte (rule 13). The exclusion at `119:634`/`:654` is
--     the mechanism this verb RIDES; weakening it would un-freeze the
--     override it just wrote. pgTAP 074 §I asserts it still fires, on a REAL
--     matchup row (R972 — never a count over an empty table).
--   * No new column on `commissioner_actions` (D336: that would be a spec
--     question, not a migration). `action_type` is `edit_score` / `set_result`
--     — both already in §12.12's printed vocabulary — and `target_type` is
--     `matchup`, likewise printed.
--   * No `HELD-FROM-PRODUCTION.txt` entry. The hold was cleared 2026-09-09
--     (PR #282) and `npx supabase db push` is Chris's to run after merge; a
--     red `db-drift.yml` between merge and push is that check working.
--   * `reopen_week` (the un-freeze) is NOT built here — it is §12.12's own
--     vocabulary and Q64's subject, reserved to L.E1.8's seam.
--
-- MIGRATION CHECKLIST (tasks-M4 §4 rule 5): additive only — one new table,
-- one new trigger on an existing table, four new functions, one function
-- replaced (D137, one body hunk, provenance above). No column dropped, no
-- constraint weakened, no grant widened: every new function is REVOKEd from
-- PUBLIC/anon and the two client doors keep EXECUTE for `authenticated` only,
-- with the commissioner check in-body. No R6/D38 waiver is claimed. Numbers
-- confirmed with `ls supabase/migrations/ | tail -1` → `125_lineup_autopilot.sql`
-- and `ls supabase/tests/ | tail -1` → `073_lineup_autopilot.sql` at task time
-- (D161/D166 — never a number read from a planning document).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commish_matchup_actions — this verb family's OWN replay ledger (D350).
--    Never shared with commish_lineup_actions and never folded into
--    commissioner_actions: §12.12 ships a client INSERT policy
--    (`123:333-335`), so a commissioner could pre-plant a row carrying an
--    action_id his client is about to send and a fabricated `result`, and the
--    replay would return it having moved nothing. A separate ZERO-POLICY
--    table makes that impossible rather than merely refused.
--    BOTH routes share this namespace on purpose — they are ONE verb family
--    over one row, so a `commish_edit_score` retry and a `commish_set_result`
--    retry carrying the same action_id must return the same document, not two.
-- ---------------------------------------------------------------------------
CREATE TABLE commish_matchup_actions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  matchup_id UUID NOT NULL REFERENCES matchups(id) ON DELETE CASCADE,
  action_id  UUID NOT NULL,                       -- client-minted; dedupes retries (the E2/D68 replay key)
  actor_id   UUID NOT NULL REFERENCES profiles(id),
  result     JSONB NOT NULL,                      -- the verb's returned jsonb, replayed byte-identically
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, action_id)                   -- the race backstop behind the select-then-insert
);
CREATE INDEX idx_commish_matchup_actions_matchup ON commish_matchup_actions(matchup_id);

COMMENT ON TABLE commish_matchup_actions IS
  'Idempotency ledger for commish_edit_score / commish_set_result (migration 126, D350). ZERO policies: the DEFINER verbs are the only reader and writer. NOT the audit log — §12.26: "an action_id is an idempotency key, not an audit record" — so a row is written for a NO-OP too, while commissioner_actions is not.';

ALTER TABLE commish_matchup_actions ENABLE ROW LEVEL SECURITY;
-- ZERO policies (112:330's posture). RLS does NOT cover TRUNCATE and the
-- Supabase default grants it to anon and authenticated (R967, measured on
-- commish_lineup_actions), so a client could otherwise have emptied a ledger
-- it can read nothing in. Taken away here — §4 rule 12, and F349's deferred
-- app-wide sweep is deliberately NOT widened by this table.
REVOKE TRUNCATE ON TABLE commish_matchup_actions FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE §12.12 BACKSTOP ON `matchups` — F325, with D343's corrected
--    predicate. Read THE BACKSTOP'S PREDICATE in the banner before changing
--    one character of this.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION matchups_override_guard_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- D343's predicate, re-stated in the body so it is visible to a prosrc pin
  -- and so the guard survives a trigger recreated without its WHEN clause.
  -- It is `IS DISTINCT FROM`, NOT §12.12's printed `NEW.is_overridden`:
  -- the printed form refuses finalize_matchups' status-only flip on an
  -- already-overridden row (118:2098-2100, no GUC, pg_cron) and misses a
  -- TRUE→FALSE un-override entirely.
  IF NEW.is_overridden IS DISTINCT FROM OLD.is_overridden
     AND COALESCE(current_setting('app.commish_action_id', true), '') = '' THEN
    RAISE EXCEPTION
      'matchups.is_overridden changed on matchup % (% → %) with no audit entry — an override is written only by an audited commissioner verb, which sets app.commish_action_id in the same transaction as its commissioner_actions row (§12.12, §10.3)',
      NEW.id, OLD.is_overridden, NEW.is_overridden
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION matchups_override_guard_internal() FROM PUBLIC, anon, authenticated;

-- The WHEN clause is the hot-path mitigation 123 deferred this trigger for:
-- 111/116/117/119 UPDATE `matchups` in loops and none of them touch the flag,
-- so none of them enter the function at all.
CREATE TRIGGER trg_matchups_override_guard
  BEFORE UPDATE ON matchups
  FOR EACH ROW
  WHEN (NEW.is_overridden IS DISTINCT FROM OLD.is_overridden)
  EXECUTE FUNCTION matchups_override_guard_internal();
-- R616 (104:489-502, restated at 123:381-382): the default tgenabled='O' is
-- skipped ENTIRELY under session_replication_role='replica' — the mode
-- `supabase db push`, `pg_restore` and logical apply all run in. ALWAYS or it
-- is not a backstop.
ALTER TABLE matchups ENABLE ALWAYS TRIGGER trg_matchups_override_guard;

-- ---------------------------------------------------------------------------
-- 3. rebuild_team_week_results — CREATE OR REPLACE against 117:758's FILE
--    TEXT (D137). ONE body hunk: the first guard, narrowed per D344. See the
--    banner for the full provenance and for why this is a narrowing.
--
--    Contract (117's, with the authority bullet made true):
--      * SECURITY DEFINER + search_path='' + triple REVOKE, and a
--        JWT-bearing caller is refused in-body (42501): a rebuild is not a
--        user verb — it is called by the service role, the harness/sim, and
--        (in-body) by M6's audited commissioner verbs. **THE SECOND CLAUSE
--        IS NOW TRUE.** An audited verb reaches this function because
--        `log_commissioner_action_internal` has already written its
--        `commissioner_actions` row and set `app.commish_action_id`
--        transaction-locally (123:447). A signed-in caller WITHOUT that GUC
--        is refused exactly as before (pgTAP 074 §A asserts it first).
--      * Lock order (rule 8): the `leagues` row FOR UPDATE first, then the
--        `league_weeks` row.
--      * The week's `league_weeks` row must be `final` — otherwise REFUSED
--        BY NAME (`week_not_final`): results for an open week are not
--        results (§11.5 "computed from final matchups"; §23.2).
--      * The pending shapes REFUSE BY NAME through the shared helper
--        (`pending_scores` / `pending_results` — a total_points week with
--        a seated team lacking a row stays pending here too: R788, nothing
--        is zero-filled); a `final` week can only carry them if something
--        outside this chain wrote them, so the refusal is loud, not a skip.
--      * h2h: every matchup of the week must be `final`
--        (`matchup_not_final`) and every NON-overridden row's stored
--        `result` must agree with its scores under the E38 rule
--        (`result_drift`) — otherwise REFUSED BY NAME. The rebuild NEVER
--        writes `matchups` (rule 9: a final matchup is never recomputed
--        here; the source of truth is read, not repaired) — a correction
--        that changes a score must write the row's `result` with it, which
--        is exactly what `commish_matchup_override_internal` below does in a
--        SINGLE statement (D341; F245 discharged in part).
--      * An `is_overridden` row's stored `result` lands in `h2h_result`
--        exactly (never recomputed from its scores — §12.18's precedence /
--        §22.2); 065 pins it with a cell whose scores say the opposite.
--      * Writes: `team_week_results` (the helper's upsert — points,
--        opponent, h2h/second/median results, `is_final`) and
--        `league_weeks.median_score` (the rounded store of the EXACT
--        median, D313(7)(d)); `finalized_at` / `status` untouched.
--      * Idempotent + loud emptiness (rule 10): the week's rows are
--        digested before and after; `changed = false` comes with
--        `reason = 'already_consistent'`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rebuild_team_week_results(
  p_league_id UUID,
  p_week      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league   public.leagues;
  v_lw       public.league_weeks;
  v_mode     TEXT;
  v_pend     JSONB;
  v_open     INTEGER;
  v_drift    JSONB;
  v_before   TEXT;
  v_after    TEXT;
  v_w        RECORD;
  v_median_b NUMERIC;
  v_cnt      INTEGER;
BEGIN
  -- THE ONE HUNK against 117:779-782 (D344). Was:
  --   IF auth.uid() IS NOT NULL THEN
  -- SECURITY DEFINER does not clear auth.uid(), so 117:722-728's own header
  -- promise — "called ... in-body by M6's audited commissioner verbs" — was
  -- unreachable. The GUC is set by log_commissioner_action_internal (123:447)
  -- as a side effect of writing the audit row, so an audited verb (and ONLY
  -- an audited verb) passes. A signed-in caller with no GUC is refused
  -- exactly as before.
  IF auth.uid() IS NOT NULL
     AND coalesce(current_setting('app.commish_action_id', true), '') = '' THEN
    RAISE EXCEPTION 'rebuild_team_week_results: the rebuild is run by the service role, the harness, or an audited commissioner verb in-body — never by a signed-in user'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 8: the league row first.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rebuild_team_week_results: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  v_mode := COALESCE(COALESCE(v_league.settings, '{}'::jsonb) ->> 'schedule_mode', 'h2h');

  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rebuild_team_week_results: league % has no league_weeks row for season % week %', p_league_id, v_league.season, p_week
      USING ERRCODE = 'P0002';
  END IF;
  IF v_lw.status <> 'final' THEN
    RAISE EXCEPTION 'rebuild_team_week_results: week_not_final — league % week % is % (results are derived from FINAL weeks only; an open week belongs to the write door — §11.5/§23.2/D295)',
      p_league_id, p_week, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;

  -- The pending shapes, by name (the shared reading).
  v_pend := public.week_results_pending_internal(p_league_id, v_league.season, p_week);
  IF v_pend IS NOT NULL THEN
    RAISE EXCEPTION 'rebuild_team_week_results: % — league % week % is final but carries a pending shape (%): absence is not a score; nothing is rebuilt (E61/§23.2/R788)',
      v_pend ->> 'reason', p_league_id, p_week, v_pend
      USING ERRCODE = 'P0001';
  END IF;

  IF v_mode = 'h2h' THEN
    SELECT count(*) INTO v_open
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND m.status <> 'final';
    IF v_open > 0 THEN
      RAISE EXCEPTION 'rebuild_team_week_results: matchup_not_final — league % week % is final but % matchup(s) are not; the source of truth disagrees with the week and is not repaired here',
        p_league_id, p_week, v_open
        USING ERRCODE = 'P0001';
    END IF;
    -- A NON-overridden row's stored result must be its scores' E38 result;
    -- the rebuild reads the source of truth and never repairs it.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('matchup_id', m.id, 'stored', m.result,
                      'derived', public.matchup_result_internal(m.home_score, m.away_score, m.away_team_id))
                    ORDER BY m.id), '[]'::jsonb) INTO v_drift
    FROM public.matchups m
    WHERE m.league_id = p_league_id AND m.season = v_league.season AND m.week = p_week
      AND NOT m.is_overridden
      AND m.result IS DISTINCT FROM public.matchup_result_internal(m.home_score, m.away_score, m.away_team_id);
    IF jsonb_array_length(v_drift) > 0 THEN
      RAISE EXCEPTION 'rebuild_team_week_results: result_drift — league % week %: % non-overridden matchup(s) store a result that is not the E38 result of their own scores (%); a score correction must write the row''s result with it (F245) — nothing is rebuilt',
        p_league_id, p_week, jsonb_array_length(v_drift), v_drift
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Digest before (stable rendering; never the row id).
  SELECT md5(COALESCE(string_agg(
           r.team_id::text || '|' || r.points::text || '|' || COALESCE(r.opponent_team_id::text, '') || '|' ||
           COALESCE(r.h2h_result, '') || '|' || COALESCE(r.median_result, '') || '|' ||
           COALESCE(r.second_opponent_team_id::text, '') || '|' || COALESCE(r.second_result, '') || '|' || r.is_final::text,
           ';' ORDER BY r.team_id), ''))
  INTO v_before
  FROM public.team_week_results r
  WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;
  v_median_b := v_lw.median_score;

  -- THE results math — the same helper finalization calls (D137).
  SELECT * INTO v_w FROM public.week_results_write_internal(p_league_id, v_league.season, p_week);

  -- The rounded store of the exact median (same-status UPDATE; the F4
  -- guard lets a median write through — 110).
  UPDATE public.league_weeks
  SET median_score = v_w.median
  WHERE id = v_lw.id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'rebuild_team_week_results: the median write touched % rows for league % week % (expected exactly 1)', v_cnt, p_league_id, p_week
      USING ERRCODE = 'P0001';
  END IF;

  SELECT md5(COALESCE(string_agg(
           r.team_id::text || '|' || r.points::text || '|' || COALESCE(r.opponent_team_id::text, '') || '|' ||
           COALESCE(r.h2h_result, '') || '|' || COALESCE(r.median_result, '') || '|' ||
           COALESCE(r.second_opponent_team_id::text, '') || '|' || COALESCE(r.second_result, '') || '|' || r.is_final::text,
           ';' ORDER BY r.team_id), ''))
  INTO v_after
  FROM public.team_week_results r
  WHERE r.league_id = p_league_id AND r.season = v_league.season AND r.week = p_week;

  RETURN jsonb_build_object(
    'league_id',            p_league_id,
    'season',               v_league.season,
    'week',                 p_week,
    'schedule_mode',        v_mode,
    'results',              v_w.results,
    'teams',                v_w.teams,
    'median_score',         (SELECT lw.median_score FROM public.league_weeks lw WHERE lw.id = v_lw.id),
    'median_score_changed', v_median_b IS DISTINCT FROM (SELECT lw.median_score FROM public.league_weeks lw WHERE lw.id = v_lw.id),
    'changed',              v_before IS DISTINCT FROM v_after,
    'digest_before',        v_before,
    'digest_after',         v_after,
    'reason',               CASE WHEN v_before IS NOT DISTINCT FROM v_after THEN 'already_consistent' ELSE NULL END);
END;
$$;
REVOKE EXECUTE ON FUNCTION rebuild_team_week_results(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. commish_matchup_override_internal — ONE verb, TWO optional arms (D341).
--    PLAIN (not DEFINER), search_path='', triple-REVOKEd, taking the instant
--    as an argument (the TimeProvider seam pgTAP drives) — 123:498-505's
--    posture verbatim.
--
--    D336's seven parts, and where each one is:
--      (1) the ledger      → `commish_matchup_actions` above, zero policies
--      (2) ONE audit row   → `log_commissioner_action_internal`, inside the
--                            no-op guard, with `IF v_audit_id IS NULL RAISE`
--                            (the ORDER is §12.12's — see the banner)
--      (3) the no-op       → DETECTED by value across every dimension the
--                            verb can change, ledger row written anyway
--      (4) the chat post   → in-txn, non-disableable, inside the guard, and
--                            it NAMES the live-scoring freeze (Q61)
--      (5) the posture     → this PLAIN internal + two DEFINER wrappers
--      (6) the reason gate → the explicit E' \t\r\n' class, bounded at 500
--      (7) the result      → names every rule bypassed and every downstream
--                            that did or did not follow, by name
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
  v_rebuild      JSONB;
  v_rebuilt      BOOLEAN := FALSE;
  v_not_why      TEXT;
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

  -- (5) THE REASON, required unconditionally (§15.4:1690's header, "all
  --     require reason"). Blank = nothing but whitespace INCLUDING tabs and
  --     newlines (R745 — plain btrim strips SPACES only); bounded at 500, the
  --     league_chat bound and the commissioner_actions CHECK (123:295-296).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION
      '%: a reason is required — this verb writes an audited commissioner_actions row the whole league can read (§15.4, §10.3)', p_verb
      USING ERRCODE = '22023';
  END IF;
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

  -- ── Q61 SWAP LINE ─────────────────────────────────────────────────────────
  -- Q61 (tasks-M6A §11) is OPEN and is Chris's. It is a PRODUCT call about
  -- what an override MEANS mid-game, and it blocks this verb's COPY, not its
  -- structure. Built to the recommendation on file: SET the flag — the
  -- commissioner's number is the league's answer, and un-freezing is a second
  -- audited act. If he rules the other way, change THIS ONE LINE to
  --     v_set_over := v_week_final;
  -- (freeze a closed week, leave a live week to the next drain). Nothing else
  -- moves: the no-op comparison, the UPDATE, `live_scoring_frozen`, the chat
  -- post and the result document all read this variable.
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
  v_frozen := v_set_over AND NOT v_week_final AND v_row.status <> 'final';
  v_frozen_why := CASE
    WHEN v_frozen AND v_row.is_overridden THEN
      'already_frozen — this row was overridden before this edit; live scoring was already skipping it (119:634)'
    WHEN v_frozen THEN
      'frozen_by_this_override — score_write_week_batch will skip this matchup for the rest of the week (119:634/:654); un-freezing is a second audited act'
    WHEN v_row.status = 'final' THEN
      'matchup_already_final — the write door skips a final row regardless of the flag (119:634)'
    ELSE
      'week_final — live scoring for this week is over; the write door refuses a final week outright (119:566-568)'
  END;

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
      || CASE WHEN v_frozen
              THEN ' — live scoring has STOPPED for this matchup for the rest of the week'
              ELSE '' END
      || ' — reason: ' || v_reason;
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
REVOKE EXECUTE ON FUNCTION commish_matchup_override_internal(
  UUID, UUID, NUMERIC, NUMERIC, UUID, UUID, TIMESTAMPTZ, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The two client doors (§15.4:1692-1693). Transaction `now()`, never a
--    caller-supplied instant (D307(3)); SECURITY DEFINER; in-body auth is the
--    internal's step (2). Two routes, ONE verb family, ONE replay namespace.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_score(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_home       NUMERIC,
  p_away       NUMERIC,
  p_reason     TEXT DEFAULT NULL,  -- REQUIRED in-body (22023) — §15.4:1690, "all require reason"
  p_action_id  UUID DEFAULT NULL   -- REQUIRED in-body (22023); DEFAULT only to keep §15.4's argument order
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_matchup_override_internal(
    p_league_id, p_matchup_id, p_home, p_away, NULL, p_action_id, now(), p_reason,
    'commish_edit_score');
END;
$$;
-- The DEFINER wrapper is the client door: `authenticated` keeps EXECUTE, the
-- in-body commissioner gate is the authorization (112:1237's posture).
REVOKE EXECUTE ON FUNCTION commish_edit_score(UUID, UUID, NUMERIC, NUMERIC, TEXT, UUID)
  FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION commish_set_result(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_winner     UUID,
  p_reason     TEXT DEFAULT NULL,  -- REQUIRED in-body (22023)
  p_action_id  UUID DEFAULT NULL   -- REQUIRED in-body (22023)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.commish_matchup_override_internal(
    p_league_id, p_matchup_id, NULL, NULL, p_winner, p_action_id, now(), p_reason,
    'commish_set_result');
END;
$$;
REVOKE EXECUTE ON FUNCTION commish_set_result(UUID, UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon;
