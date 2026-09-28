-- ============================================================================
-- 141_rescore_skips_final_weeks.sql — Q64 AS RULED: `rescore = true`
-- re-scores every OPEN week and SKIPS final weeks, naming them, instead of
-- refusing the whole call (M6A task L.E1.24, added by the PR #312 review,
-- R1090; PROGRESS F382 (discharged here), Q64, F359, D360, D371, D378; spec
-- §10.1 v2.16.42 "a scoring change applies to open and future weeks; a final
-- week is never re-scored" / §15.4 / §7.3.3; tasks-M6A §6's 2026-09-27
-- amendment, L.E1.24; tasks-M6A §4 rules 11-15).
--
-- Numbering (D161 — measured at task time, not trusted from any plan):
-- `ls supabase/migrations | tail -1` → 140_bracket_played_round_notice.sql
-- ⇒ 141; `ls supabase/tests | tail -1` → 088_bracket_played_round_notice.sql
-- ⇒ pgTAP 089. NOT held: reaches production by `npx supabase db push` like
-- any other migration. Production is at 134 — push debt becomes 135–141.
--
-- ---------------------------------------------------------------------------
-- THE RULING (Chris, 2026-09-27 — PROGRESS Q64)
-- ---------------------------------------------------------------------------
-- Option 1, going forward only. The option he chose read: "The new rule
-- applies to this week and later. Finished weeks keep their original scores
-- and results." `reopen_week` is NOT wanted (F359 closed) and is not built;
-- `league_weeks.reopened_by_action_id` keeps its FK and has no writer.
--
-- ---------------------------------------------------------------------------
-- THE DEFECT (F382) AND WHAT REPLACES IT
-- ---------------------------------------------------------------------------
-- 129 shipped Q64's RECOMMENDATION while Q64 was open: step (11b), the
-- `-- Q64 SEAM` block (129:831, carried verbatim into the newest definer at
-- 131:2741-2756), RAISEd P0001 and rolled back the WHOLE call whenever
-- `rescore = true` and the season had ANY `league_weeks.status = 'final'`
-- row — so from week 2 on the OPEN week could never be re-scored under a
-- scoring change. That block is REPLACED: with ≥ 1 final week the change
-- LANDS, every OPEN week is re-queued by the existing (12c) loop, and the
-- final weeks are returned BY NAME — `rescore_skipped_final_weeks: [1]` with
-- a plain-words `rescore_skipped_final_weeks_why` — at the top level of the
-- document, in `consequences`, in the receipt's metadata, and in the §10.3
-- chat post. Never a quiet partial.
--
-- "OPEN" IS 131's EXISTING `v_open_weeks` SET — `live` + `correction_window`
-- (the reading the task flags for the reviewer): the spec's own words are
-- "open and future weeks … a final week is never re-scored" (§10.1
-- v2.16.42), and `final` is the only `league_weeks.status` the ruling keeps.
-- A `correction_window` week IS re-scored (pgTAP 089 §E). Upcoming weeks are
-- not queued — nothing has been scored for them; each is scored under the
-- re-frozen snapshot when it opens — and the document SAYS so
-- (`consequences.rescore_upcoming_weeks_why`).
--
-- NEW ARM: rescore = true, ≥ 1 final week and NO open week (between weeks):
-- the change lands, nothing is queued, `rescore_performed = false` with
-- `rescore_not_performed_why = 'no_open_week — …'` naming the kept final
-- weeks. (Before 141 this state was refused; with no final week at all the
-- old `nothing_scored_yet` text is kept byte-for-byte.)
--
-- ---------------------------------------------------------------------------
-- MEASURED BEFORE BUILDING — who re-derives a FINAL week's score from the
-- league's CURRENT snapshot (the task's MEASURE-FIRST clause)
-- ---------------------------------------------------------------------------
-- The snapshot is ONE column (`leagues.scoring_rules_snapshot`), re-frozen on
-- every scoring change (129/131 step (12a)); nothing stores the rules a week
-- was scored under. Readers of it, measured with
-- `grep -rl scoring_rules_snapshot src supabase/migrations`:
--   * SQL — no function body SCORES from it (D33: scoring exists only in
--     TypeScript). 110 / 118 / 129 / 131 / 137 validate, freeze or copy it.
--     The correction-close rebuild (`finalize_matchups` →
--     `rebuild_team_week_results`) DERIVES results from the stored
--     `matchups` scores; it never recomputes a score.
--   * The scoring worker (`score-week-worker.ts`) — returns `week_final`
--     for a final week before it reads the snapshot (:911), and the door
--     refuses one (119:567). Never re-derives a final week.
--   * THE NIGHTLY RECONCILE (`reconcile.ts`) — YES. It recomputes every
--     `live | correction_window | final` league-week from raw `player_stats`
--     through `league.scoring_rules_snapshot` (:624-640, :790) and compares
--     it with the stored cell. After ANY scoring change — rescore or not,
--     and before 141 as well as after it (the re-freeze is 129's) — a final
--     week scored under the old rules reads as `drift` [alert], every night,
--     for the rest of the season. PINNED by `reconcile-db.test.ts`'s
--     L.E1.24 cell (stored 60.08 kept; recomputed 71.08 under Full PPR).
--   * THE BOX SCORE (`box-score-service.ts`) — YES, for display: a final
--     week's per-starter points and the box's own sum are computed through
--     the CURRENT snapshot (:239, :273-274, :354), so after a change they
--     disagree with the stored team score the page shows beside them.
--   * `player-values-job.ts` (autopilot's season-to-date key) — scores past
--     weeks under the current snapshot BY DESIGN (a ranking under the
--     league's scoring now); not a stored week score.
-- Neither reader writes; the stored final-week rows are kept (the ruling's
-- half this migration owns). Fixing the two readers needs per-week rules
-- provenance the schema does not have — filed as F397, not built here.
--
-- ---------------------------------------------------------------------------
-- D137 PROVENANCE
-- ---------------------------------------------------------------------------
-- `commish_change_setting_internal`: authored against
-- `supabase/migrations/131_reason_optional_sweep.sql` lines 2550-3010 (the
-- NEWEST defining migration — `grep -ln "commish_change_setting_internal"
-- supabase/migrations/*` → 129, 131; 132-140 never mention it). The text
-- below is the EXTRACTION (`sed -n 2550,3010p`), not a re-typing, with NINE
-- hunks applied (`diff -u` → 9 `@@`, 18 `-` / 37 `+` lines):
--   1. DECLARE — `v_skipped_final` / `v_skipped_why`.
--   2. (11)'s comment — "the refusal at (11b) rolls back nothing" was about
--      the block this migration removes.
--   3. (11b) — the `-- Q64 SEAM` RAISE → the skip-and-name assignment, under
--      a `-- Q64 AS RULED` comment.
--   4. (12c) — the "(11b) already guaranteed v_final_weeks = []" comment.
--   5. (12c) — the no-open-week arm: `no_open_week` when final weeks were
--      skipped; `nothing_scored_yet` byte-for-byte otherwise.
--   6. `consequences` — three keys.
--   7. the receipt's metadata — `rescore_skipped_final_weeks`.
--   8. the §10.3 post — the kept final weeks named.
--   9. the result document — two top-level keys.
-- Everything else — the lock, auth, replay, reason, policy, value, no-op,
-- the write, the FAAB arm, the (12c) enqueue loop itself, the audit call,
-- the ledger — is 131's text byte-for-byte.
-- Pre-141 `md5(prosrc)` on the local chain 001-140:
-- `497b5fbc33dd6c7fc0b9da41f9f212f2` (25185 chars); post-141:
-- `05d2c7e4ae83506c113f7168d262a8b3` (26651 chars) — both stored literals in pgTAP 089 §A.
-- The DEFINER door `commish_change_setting` (129) is NOT replaced; the
-- signature is unchanged ⇒ typegen 0-line. The REVOKE (129:1101-1102)
-- survives CREATE OR REPLACE and is re-stated.
--
-- MIGRATION CHECKLIST (tasks-M* §4.4): one `CREATE OR REPLACE` of an
-- existing PLAIN (not DEFINER) internal, `search_path = ''` kept, grants
-- re-stated (REVOKE from PUBLIC, anon, authenticated — only the DEFINER door
-- calls it, and it is still the one that supplies the instant). No table,
-- column, policy, trigger or signature changed.
-- WAIVERS: none. R6 / D38 not engaged (nothing backfilled, no CHECK
-- tightened, no realtime surface touched).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- commish_change_setting_internal — CREATE OR REPLACE against 131:2550-3010's
-- FILE TEXT, NINE HUNKS (see the banner's D137 PROVENANCE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_change_setting_internal(
  p_league_id UUID,
  p_key       TEXT,
  p_value     JSONB,
  p_rescore   BOOLEAN,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_found         BOOLEAN;
  v_reason        TEXT;
  v_key           TEXT;
  v_policy        JSONB;
  v_class         TEXT;
  v_storage       TEXT;
  v_rescore       BOOLEAN := COALESCE(p_rescore, FALSE);
  v_in_season     BOOLEAN;
  v_before        JSONB;
  v_canon         JSONB;
  v_no_changes    BOOLEAN;
  v_bypassed      JSONB;
  v_bypassed_why  TEXT;
  v_audit_id      UUID;
  v_message       TEXT;
  v_result        JSONB;
  v_cnt           INTEGER;
  -- scoring
  v_new_scoring   UUID;
  v_new_rules     JSONB;
  v_snapshot_refrozen BOOLEAN := FALSE;
  v_snapshot_why  TEXT;
  v_final_weeks   JSONB := '[]'::jsonb;
  v_open_weeks    JSONB := '[]'::jsonb;
  v_rescored      JSONB := '[]'::jsonb;
  v_rescore_done  BOOLEAN := FALSE;
  v_rescore_why   TEXT;
  v_skipped_final JSONB := '[]'::jsonb;   -- 141 / Q64 as ruled: the final weeks rescore left alone, NAMED
  v_skipped_why   TEXT;
  v_score_stale   BOOLEAN := FALSE;
  v_stale_why     TEXT;
  v_wk            RECORD;
  v_enq           INTEGER;
  v_not_enq       JSONB;
  v_ir_keys       TEXT[];
  -- faab
  v_faab_reseeded BOOLEAN := FALSE;
  v_faab_why      TEXT;
  v_faab_off      INTEGER := 0;
  -- roster
  v_not_refit     INTEGER := 0;
  v_consequences  JSONB;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and never answered with
  --     `no_changes: true` (126's rule; §4 rule 15).
  IF NULLIF(btrim(COALESCE(p_key, ''), E' \t\r\n'), '') IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: p_key is required — an override that names no setting is not an override'
      USING ERRCODE = '22023';
  END IF;
  v_key := btrim(p_key, E' \t\r\n');
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8). Every gate
  --     below reads THIS row, never a pre-lock read (R1036's lesson).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — commissioner only, in-body, ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5).
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_change_setting: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), AFTER auth and BEFORE every business gate
  --     (`123:602-609`), so a retry replays byte-identically even when the
  --     league has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_setting_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
  --     spec v2.16.41 §10.3 / §15.4): NORMALISED, never refused — absent or
  --     whitespace-only in the explicit class (R745) ⇒ NULL (130 §0 stores
  --     it); otherwise trimmed, bounded at 500 below (NULL-safe as written).
  --     F343 as amended by 131: the client may send nothing.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'commish_change_setting: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (5) THE KEY, against the policy table. An unknown key is refused BY NAME:
  --     this verb writes no key the catalog does not define.
  v_policy := public.commish_setting_policy(v_key);
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'commish_change_setting: % is not a league setting this verb knows — the catalog is leagueSettingsSchema (§7.3); no undefined key is ever written into leagues.settings', v_key
      USING ERRCODE = '22023';
  END IF;
  v_class   := v_policy ->> 'class';
  v_storage := v_policy ->> 'storage';
  v_in_season := v_league.status NOT IN ('setup', 'scheduled');

  -- (6) THE PER-KEY POLICY — refused-by-name classes (the banner's table).
  IF v_class = 'refused' THEN
    RAISE EXCEPTION 'commish_change_setting: % cannot be changed through this verb (league % is %). WHY: %',
      v_key, p_league_id, v_league.status, v_policy ->> 'refused_why'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_class = 'bracket' AND v_league.status IN ('playoffs', 'complete') THEN
    RAISE EXCEPTION 'commish_change_setting: % is REFUSED in-season once the bracket exists (league % is %). WHY: %',
      v_key, p_league_id, v_league.status, v_policy ->> 'refused_why'
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) `rescore` has exactly one subject. On any other key the flag is a
  --     malformed call, refused by name — never accepted and ignored.
  IF v_rescore AND v_key <> 'scoring_system_id' THEN
    RAISE EXCEPTION 'commish_change_setting: rescore applies only to scoring_system_id — % has no stored score to recompute; resubmit without rescore',
      v_key
      USING ERRCODE = '22023';
  END IF;

  -- (8) THE VALUE, canonicalised (item 4) and range-checked against the
  --     LOCKED row; the CURRENT value read from the same row in the same
  --     canonical form.
  v_canon := public.commish_setting_canon_internal(v_key, p_value, v_league);
  IF v_storage = 'column' THEN
    v_before := to_jsonb(v_league) -> v_key;          -- typed column; uuid renders as a string
  ELSE
    v_before := COALESCE(v_league.settings -> v_key, 'null'::jsonb);  -- absent blob key = null
  END IF;

  -- (8b) scoring_system_id: 118 step 5's attachable scope, in meaning — a
  --      TEMPLATE, or the league's own currently-referenced row (the no-op).
  --      104's wall 3 (`trg_leagues_scoring_reference_guard`) additionally
  --      validates the referenced rules at the UPDATE; it is ridden, not
  --      duplicated.
  IF v_key = 'scoring_system_id' THEN
    v_new_scoring := (v_canon #>> '{}')::uuid;
    IF v_new_scoring IS DISTINCT FROM v_league.scoring_system_id THEN
      SELECT s.rules INTO v_new_rules
      FROM public.scoring_systems s
      WHERE s.id = v_new_scoring AND s.is_template = TRUE AND s.owner_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'commish_change_setting: scoring_system_id % must reference one of the scoring templates, or the league''s own current custom scoring system — personal scoring systems and other leagues'' systems cannot be attached (§7.3.8 v2.11, §7.3.3.1; 118 step 5''s scope)',
          v_new_scoring
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- (9) THE NO-OP, DETECTED BY VALUE — jsonb equality over the canonical
  --     form of the ONE dimension this verb changes (D336 part 3; `123:1016`).
  --     `2` and `"2"` both canonicalise to `2`, so a re-send in a different
  --     JSON type is a no-op too.
  v_no_changes := (v_canon = v_before);

  -- (10) THE LIFTED GATE, NAMED. Past `scheduled`, 118 step 3 would have
  --      refused this write (`118:2489-2497`); that is the rule this verb
  --      walks past, and the receipt says so (standing rule (g)'s shape).
  IF v_in_season THEN
    v_bypassed     := jsonb_build_array('settings_status_gate');
    v_bypassed_why := 'update_league_settings refuses every status past scheduled (118:2489-2497, "settings are locked once the draft starts; post-draft changes are audited commissioner overrides (M6) (§7.3)"); this verb IS that override (§7.3 header: "commissioner-override-only … allowed but logged and warned")';
  ELSE
    v_bypassed     := '[]'::jsonb;
    v_bypassed_why := 'nothing to bypass — in setup/scheduled the document path (update_league_settings) admits this key too; this verb was used for its per-key receipt';
  END IF;

  -- (11) THE SCORING CONSEQUENCES are computed BEFORE the write so the
  --      report at (12c) describes the weeks as they were.
  IF v_key = 'scoring_system_id' AND NOT v_no_changes THEN
    SELECT COALESCE(jsonb_agg(lw.week ORDER BY lw.week), '[]'::jsonb) INTO v_final_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status = 'final';
    SELECT COALESCE(jsonb_agg(jsonb_build_object('week', lw.week, 'status', lw.status) ORDER BY lw.week), '[]'::jsonb) INTO v_open_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status IN ('live', 'correction_window');

    -- (11b) ── Q64 AS RULED ── (Chris, 2026-09-27, option 1, going forward
    --       only: "The new rule applies to this week and later. Finished
    --       weeks keep their original scores and results."; spec §10.1
    --       v2.16.42: "a scoring change applies to open and future weeks; a
    --       final week is never re-scored"). Migration 141 (L.E1.24, F382)
    --       REPLACED the whole-call refusal that stood here: a FINAL week is
    --       SKIPPED and NAMED, never refused, and the change lands. Nothing
    --       below writes a final week — (12c)'s loop reads live /
    --       correction_window only, and the scoring worker refuses a final
    --       week at its door (`score_write_week_batch` → week_final,
    --       119:566-568). `reopen_week` is NOT built (Q64: not wanted).
    IF v_rescore AND v_final_weeks <> '[]'::jsonb THEN
      v_skipped_final := v_final_weeks;
      v_skipped_why   := 'final_weeks_not_rescored — final week(s) ' || v_final_weeks::text
        || ' keep their original scores and results; the new scoring applies to '
        || CASE WHEN v_open_weeks <> '[]'::jsonb
             THEN 'open week(s) ' || (SELECT jsonb_agg(x -> 'week') FROM jsonb_array_elements(v_open_weeks) x)::text
                  || ' (queued for re-scoring now) and to every later week (scored under it when it opens)'
             ELSE 'every later week (scored under it when it opens) — no week is open right now' END;
    END IF;
  END IF;

  IF NOT v_no_changes THEN
    -- (12a) THE STATE WRITE — ONE key, read-modify-write (D347). Typed
    --       columns each by name; blob keys through `settings || {key: v}`
    --       so every OTHER key is byte-untouched. `updated_at = p_at`.
    CASE v_key
      WHEN 'waiver_type' THEN
        UPDATE public.leagues SET waiver_type = v_canon #>> '{}', updated_at = p_at WHERE id = p_league_id;
      WHEN 'faab_budget' THEN
        UPDATE public.leagues SET faab_budget = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'trade_review' THEN
        UPDATE public.leagues SET trade_review = v_canon #>> '{}', updated_at = p_at WHERE id = p_league_id;
      WHEN 'trade_deadline_week' THEN
        UPDATE public.leagues SET trade_deadline_week = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'roster_settings' THEN
        UPDATE public.leagues SET roster_settings = v_canon, updated_at = p_at WHERE id = p_league_id;
      WHEN 'playoff_teams' THEN
        UPDATE public.leagues SET playoff_teams = (v_canon #>> '{}')::int, updated_at = p_at WHERE id = p_league_id;
      WHEN 'scoring_system_id' THEN
        -- RE-DECISION 2: the reference and the re-frozen snapshot move in ONE
        -- statement (§7.3.3 — "on any commissioner scoring change"); a NULL
        -- snapshot stays NULL, exactly as 118:2586-2590 leaves it (draft_start
        -- is the freezer pre-draft). 104's two walls fire on this UPDATE.
        UPDATE public.leagues
        SET scoring_system_id      = v_new_scoring,
            scoring_rules_snapshot = CASE WHEN scoring_rules_snapshot IS NOT NULL THEN v_new_rules ELSE scoring_rules_snapshot END,
            updated_at             = p_at
        WHERE id = p_league_id;
        v_snapshot_refrozen := (v_league.scoring_rules_snapshot IS NOT NULL);
        v_snapshot_why := CASE WHEN v_snapshot_refrozen
          THEN 'scoring_rules_snapshot re-frozen from the new system''s rules in the same statement as the reference (§7.3.3, never-weaken; 118:2585-2590''s rule kept)'
          ELSE 'scoring_rules_snapshot is NULL (pre-draft) and stays NULL — draft_start freezes it (059/110), exactly as 118:2586 leaves it' END;
      ELSE
        UPDATE public.leagues
        SET settings   = settings || jsonb_build_object(v_key, v_canon),
            updated_at = p_at
        WHERE id = p_league_id;
    END CASE;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_change_setting: the write touched % rows, expected exactly 1 (league %)', v_cnt, p_league_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (12b) RE-DECISION 1 — THE FAAB RE-SEED, narrowed to the precondition
    --       118's own comment names: pre-draft ONLY. In-season every balance
    --       is byte-unchanged and the document says so with a MEASURED count.
    IF v_key = 'faab_budget' THEN
      IF NOT v_in_season THEN
        UPDATE public.league_members
        SET faab_balance = (v_canon #>> '{}')::int
        WHERE league_id = p_league_id;
        v_faab_reseeded := TRUE;
        v_faab_why := 'league is ' || v_league.status || ' (pre-draft): every seat re-seeded to the new budget so all balances match the create/join/claim seeding (§12.2 / D70 — 118:2617-2621''s rule, kept for the state it was written for)';
      ELSE
        SELECT count(*)::int INTO v_faab_off
        FROM public.league_members m
        WHERE m.league_id = p_league_id AND m.team_id IS NOT NULL
          AND m.faab_balance IS DISTINCT FROM (v_canon #>> '{}')::int;
        v_faab_why := 'league is ' || v_league.status || ' (in-season): faab_balance is the ledger of each team''s spend and is BYTE-UNCHANGED for every seat — re-seeding would wipe every team''s spend (118:2617-2621 was safe only behind the status gate this verb lifts). ' || v_faab_off || ' seat(s) now carry a balance that differs from the new budget; adjusting ONE team''s balance is commish_edit_faab (§15.4:1698 — M5, F340)';
      END IF;
    END IF;

    -- (12c) THE RESCORE — every OPEN week re-queued when asked; the stored
    --       scores of every week left alone when not, and NAMED either way.
    IF v_key = 'scoring_system_id' THEN
      IF v_rescore THEN
        -- A FINAL week is never in this loop: (11b) skipped it by name (141).
        SELECT COALESCE(array_agg(s ->> 'key'), ARRAY[]::text[]) INTO v_ir_keys
        FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) s;
        FOR v_wk IN
          SELECT lw.week, lw.status
          FROM public.league_weeks lw
          WHERE lw.league_id = p_league_id AND lw.season = v_league.season
            AND lw.status IN ('live', 'correction_window')
          ORDER BY lw.week
        LOOP
          -- Starters of every team-week, derived from slot_map the way the
          -- worker derives them (`startersOf`: every non-empty value whose
          -- slot key's base is not an IR key), stamped with the player's own
          -- MIN(player_stats.updated_at) — never now() (123's SCORING rule).
          INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
          SELECT v_league.season, v_wk.week, ps.player_id, min(ps.updated_at)
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
          JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
          JOIN public.player_stats ps
            ON ps.season = v_league.season AND ps.week = v_wk.week AND ps.player_id = sm.pid
           AND ps.updated_at IS NOT NULL
          WHERE tl.season = v_league.season AND tl.week = v_wk.week
            AND sm.pid IS NOT NULL AND sm.pid <> ''
            AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
          GROUP BY ps.player_id
          ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row
          -- "a claimable queue row EXISTS for him" (123:1088-1092's meaning),
          -- and the starters the INSERT could NOT queue, named (R968).
          SELECT count(DISTINCT sm.pid)::int INTO v_enq
          FROM public.team_lineups tl
          JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
          JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
          WHERE tl.season = v_league.season AND tl.week = v_wk.week
            AND sm.pid IS NOT NULL AND sm.pid <> ''
            AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
            AND EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = v_wk.week AND f.player_id = sm.pid);
          SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', x.pid, 'why',
                   CASE WHEN EXISTS (SELECT 1 FROM public.player_stats ps
                                     WHERE ps.season = v_league.season AND ps.week = v_wk.week AND ps.player_id = x.pid)
                        THEN 'stats_unstamped' ELSE 'no_stat_row' END) ORDER BY x.pid), '[]'::jsonb)
          INTO v_not_enq
          FROM (SELECT DISTINCT sm.pid
                FROM public.team_lineups tl
                JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
                JOIN LATERAL jsonb_each_text(COALESCE(tl.slot_map, '{}'::jsonb)) sm(slot, pid) ON TRUE
                WHERE tl.season = v_league.season AND tl.week = v_wk.week
                  AND sm.pid IS NOT NULL AND sm.pid <> ''
                  AND NOT (split_part(sm.slot, ':', 1) = ANY (v_ir_keys))
                  AND NOT EXISTS (SELECT 1 FROM public.score_fanout f
                                  WHERE f.season = v_league.season AND f.week = v_wk.week AND f.player_id = sm.pid)) x;
          v_rescored := v_rescored || jsonb_build_object(
            'week', v_wk.week, 'status', v_wk.status,
            'starters_enqueued', v_enq, 'score_not_enqueued', v_not_enq);
        END LOOP;
        IF jsonb_array_length(v_rescored) > 0 THEN
          v_rescore_done := TRUE;
          v_rescore_why  := NULL;
        ELSE
          v_rescore_done := FALSE;
          v_rescore_why  := CASE WHEN v_skipped_final <> '[]'::jsonb
            THEN 'no_open_week — no week is open right now, so there is no score to re-score: final week(s) ' || v_skipped_final::text
                 || ' keep their original scores and results, and every later week is scored under the new scoring when it opens'
            ELSE 'nothing_scored_yet — this season has no live or correction_window week and no final week, so there is no stored score to recompute; the re-frozen snapshot governs every week from here' END;
        END IF;
      ELSE
        v_rescore_done := FALSE;
        v_rescore_why  := 'not_requested — rescore was not asked for: '
          || jsonb_array_length(v_final_weeks) || ' final week(s) ' || v_final_weeks::text
          || ' keep their stored scores, and ' || jsonb_array_length(v_open_weeks) || ' open week(s) '
          || (SELECT COALESCE(jsonb_agg(x -> 'week'), '[]'::jsonb) FROM jsonb_array_elements(v_open_weeks) x)::text
          || ' keep the points already computed under the PREVIOUS snapshot';
        IF v_open_weeks <> '[]'::jsonb THEN
          -- An open week's stored points were computed under the previous
          -- snapshot; its next drain uses the new one. That is a MIXED week
          -- and the one thing this verb must never report as clean.
          v_score_stale := TRUE;
          v_stale_why   := 'snapshot_changed_without_rescore';
        END IF;
      END IF;
    END IF;

    -- (12d) ROSTER SHAPE: nothing re-fits a stored slot_map. Counted, so the
    --       §7.3 header's "warned" is a number.
    IF v_key = 'roster_settings' THEN
      SELECT count(*)::int INTO v_not_refit
      FROM public.team_lineups tl
      JOIN public.teams t ON t.id = tl.team_id AND t.league_id = p_league_id
      JOIN public.league_weeks lw ON lw.league_id = p_league_id AND lw.season = tl.season AND lw.week = tl.week
      WHERE tl.season = v_league.season AND lw.status IN ('upcoming', 'live');
    END IF;

    v_consequences := jsonb_build_object(
      'snapshot_refrozen',         v_snapshot_refrozen,
      'snapshot_why',              v_snapshot_why,
      'final_weeks',               v_final_weeks,
      'open_weeks',                v_open_weeks,
      'rescore_requested',         v_rescore,
      'rescore_performed',         v_rescore_done,
      'rescore_not_performed_why', v_rescore_why,
      'rescored_weeks',            v_rescored,
      'rescore_skipped_final_weeks',     v_skipped_final,   -- 141 / Q64 as ruled
      'rescore_skipped_final_weeks_why', v_skipped_why,
      'rescore_upcoming_weeks_why', CASE WHEN v_rescore THEN
                                     'upcoming weeks are not queued — nothing has been scored for them; each is scored under the new scoring when it opens' END,
      'score_stale',               v_score_stale,
      'score_stale_reason',        v_stale_why,
      'faab_reseeded',             v_faab_reseeded,
      'faab_reseed_why',           v_faab_why,
      'faab_seats_off_budget',     v_faab_off,
      'lineups_not_refit',         v_not_refit,
      'lineups_not_refit_why',     CASE WHEN v_key = 'roster_settings' THEN
                                     'no stored team_lineups.slot_map is re-fit by a roster change; the next set_lineup / autopilot pass fits against the new shape (§7.3 header: "allowed but logged and warned") — the count is the open/upcoming lineup rows of this season' END);

    -- (13) D336 part 2 — EXACTLY ONE audit row, through the ONE shared
    --      logging helper, INSIDE the no-op guard and AFTER the state write.
    --      §5's contractual shape: target_type 'setting', target_id = the
    --      key, before/after = {<key>: value} — THAT KEY ALONE.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'change_setting', 'setting', v_key, v_reason,
      jsonb_build_object(v_key, v_before),
      jsonb_build_object(v_key, v_canon),
      jsonb_build_object(
        'verb',                      'commish_change_setting',
        'season',                    v_league.season,
        'action_id',                 p_action_id,
        'league_status',             v_league.status,
        'storage',                   v_storage,
        'policy_class',              v_class,
        'bypassed',                  v_bypassed,
        -- §5's three contractual extras for this verb:
        'rescore_requested',         v_rescore,
        'rescore_performed',         v_rescore_done,
        'rescore_not_performed_why', v_rescore_why,
        'rescore_skipped_final_weeks', v_skipped_final,        -- 141 / Q64 as ruled
        'consequences',              v_consequences),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_change_setting: the audit row was not written — refusing to let the change stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (14) §10.3: override system messages auto-post to league chat and
    --      CANNOT be disabled. The consequence is in the post, not only in
    --      the document (R971's shape).
    v_message := 'Setting ' || v_key || ' changed from ' || v_before::text || ' to ' || v_canon::text
      || ' by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_rescore_done THEN ' — open weeks will be re-scored under the new rules'
              WHEN v_score_stale THEN ' — stored scores were NOT recomputed'
              WHEN v_key = 'faab_budget' AND NOT v_faab_reseeded THEN ' — team balances unchanged'
              ELSE '' END
      || CASE WHEN v_skipped_final <> '[]'::jsonb   -- 141 / Q64 as ruled: never a quiet partial
              THEN CASE WHEN v_rescore_done THEN '; ' ELSE ' — ' END
                   || 'final week(s) ' || v_skipped_final::text || ' keep their original scores and results'
              ELSE '' END
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_change_setting',
    'action_type',            'change_setting',
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'league_status',          v_league.status,
    'key',                    v_key,
    'storage',                v_storage,
    'policy_class',           v_class,
    'value',                  CASE WHEN v_no_changes THEN v_before ELSE v_canon END,
    'previous_value',         v_before,
    'requested_value',        v_canon,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'value_already_set — the league already stored this exact value for ' || v_key || ' (compared as canonical jsonb, so 2 and "2" are the same value), so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,            -- NULL on a no-op, and that is the point
    'bypassed',               v_bypassed,
    'bypassed_why',           v_bypassed_why,
    'rescore_requested',      v_rescore,
    'rescore_performed',      v_rescore_done,
    'rescore_not_performed_why', CASE WHEN v_no_changes AND v_rescore THEN
                                'no_changes — the scoring reference is already this system, so there is nothing to re-score'
                                ELSE v_rescore_why END,
    'rescore_skipped_final_weeks',     v_skipped_final,      -- 141 / Q64 as ruled: [] unless rescore skipped a final week
    'rescore_skipped_final_weeks_why', v_skipped_why,        -- NULL exactly when that list is []
    'consequences',           CASE WHEN v_no_changes THEN NULL ELSE v_consequences END,
    'reason',                 v_reason,
    'system_post',            v_message,             -- NULL on a no-op
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`):
  -- an action_id is consumed by its submit whether or not anything moved.
  INSERT INTO public.commish_setting_actions (league_id, setting_key, action_id, actor_id, result)
  VALUES (p_league_id, v_key, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION commish_change_setting_internal(UUID, TEXT, JSONB, BOOLEAN, UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
