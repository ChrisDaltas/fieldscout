-- ============================================================================
-- THE REASON-OPTIONAL SWEEP — migration 131
-- (task L.E1.15 of M6A — tasks-M6A §6's approved amendment note "L.E1.15 —
-- THE REASON-OPTIONAL SWEEP" + PROGRESS F362 (its scope, R1052's route/hook
-- addition, L.E1.10's R1053/R1054 hand-off); §4 rules 1-15; PROGRESS §3
-- STANDING RULE clauses (a), (b), (f), (h) as amended by this task;
-- PROGRESS F341 / F343 / F361; spec v2.16.41 §10 / §10.3 / §11.7 / §15.4 /
-- E41 (Q66, ruled by Chris 2026-09-16).)
--
-- THE RULING (Q66, spec v2.16.41): *a reason is OPTIONAL on every commissioner
-- action; the audit row is ALWAYS written; every action is shown in League
-- Home's activity section.* Migration 130 §0 made `commissioner_actions.reason`
-- nullable ONCE (its CHECK is `reason IS NULL OR <explicit class + 500>`) and
-- put its own two verbs under the ruling. EVERY OTHER commissioner verb still
-- refused a blank reason in-body, by name (22023) — a recorded transitional
-- state (F362). This migration brings the CODE in line with the SPEC. The
-- spec does not change here.
--
-- ---------------------------------------------------------------------------
-- MECHANISM — ONE migration, `CREATE OR REPLACE` against FILE TEXT (D137)
-- ---------------------------------------------------------------------------
-- Decided by the orchestrator for the Architect (the amendment left it open):
-- 125-130 are merged but UNPUSHED (hosted tops out at 124) and 123 IS in
-- production, so the honest mechanism for all of them is the one 123 needs
-- anyway — a new migration that replaces each function against the FILE TEXT
-- of its NEWEST defining migration (CLAUDE.md "Migration discipline": never
-- against the deployed body — 073 silently reverted three migrations' guards
-- that way). Merged migrations stay frozen. Every body below is a programmatic
-- EXTRACTION (start line → the terminating `$$;`) with the named hunks applied
-- by exact-match replacement (each must match exactly once) — not a re-typing.
-- The per-function provenance and measured hunk count are in each section
-- header; the before/after diffs are in the PR.
--
-- NEWEST DEFINER, per function (measured with grep over supabase/migrations):
--   commish_edit_lineup_internal        123:498-1270   (only definer; IN PRODUCTION)
--   commish_matchup_override_internal   126:606-1020
--   commish_roster_override_internal    127:582-1555
--   commish_rename_team_internal        128:384-629    (128's manager arm, rename_own_team_internal, untouched)
--   commish_change_setting_internal     129:638-1100
--   schedule_edit_matchup               130:813-1227   (130 superseded 111:785; the newest definition is 130's)
--   schedule_remix_confirm              111:573-777    (only definer)
--   set_lineup_internal                 114:153-753    (114 superseded 112:589; the DEFINER wrapper set_lineup, 112:1221, untouched)
-- The DEFINER wrappers (commish_edit_lineup, commish_edit_score,
-- commish_set_result, commish_move_player, commish_force_add_drop,
-- commish_rename_team, commish_change_setting, set_lineup) are NOT replaced:
-- no signature changes, and their `-- REQUIRED in-body (22023)` parameter
-- comments are comments in bodies that stay byte-identical (typegen: zero
-- change, measured). Grants and REVOKEs survive CREATE OR REPLACE and are not
-- re-issued.
--
-- ---------------------------------------------------------------------------
-- THE HUNKS — the same three shapes in every verb, and nothing else
-- ---------------------------------------------------------------------------
-- (1) THE GATE → A NORMALISATION. §4 rule 12's *"the reason gate uses
--     `btrim(reason, E' \t\r\n')` at all three layers"* is re-read as
--     NORMALISES, not REFUSES: `v_reason := NULLIF(btrim(COALESCE(p_reason,
--     ''), E' \t\r\n'), '')` stays; the `IF v_reason IS NULL THEN RAISE 22023`
--     that followed it is deleted. Absent or whitespace-only ⇒ NULL (stored as
--     NULL, never ''); a non-empty reason is stored TRIMMED. The 500 bound
--     STAYS in every verb: `IF char_length(v_reason) > 500` is NULL-safe as
--     written (NULL > 500 is NULL; IF NULL does not fire) — no negation, so
--     D356(7c)'s COALESCE rule does not apply to it. 501 is still refused by
--     name at the verb, and by 130 §0's CHECK (23514) at the table.
-- (2) THE CHAT POST'S `— reason:` CLAUSE → CONDITIONAL. `CASE WHEN v_reason IS
--     NOT NULL THEN ' — reason: ' || v_reason ELSE '' END` — never
--     "reason: <NULL>" (which would have concatenated the whole post to NULL)
--     and never "reason: " with nothing after it. Each verb's pgTAP reads the
--     post back on a no-reason call and asserts the clause is absent.
-- (3) IN 111's TWO VERBS, the E41 post-kickoff gate goes the same way and its
--     plain-`btrim` normalisation becomes the explicit class (R1048: the post
--     and the receipt read ONE value now; F225's R745 remainder in
--     `schedule_remix_confirm` closed). The gate's own REPORT field,
--     `reason_required` (top level and `window`), is set to FALSE in both
--     documents — the field reported the gate that this migration removes,
--     and pgTAP 078 C12 recorded on 2026-09-16 that *"this cell flips when the
--     sweep lands"*. It is KEPT (not dropped) for the schedule panel (F361).
--     NOT touched: `schedule_window_internal` / `schedule_preview`'s
--     `window.reason_required` (111:508 — a READ function, not a commissioner
--     verb, outside this task's enumerated scope) still reports `NOT free`;
--     the remix modal still client-gates on it — recorded on F361 for the UI
--     task (L.E1.13) that owns the panel.
-- (4) `schedule_remix_confirm` ALSO GAINS ITS RECEIPT — F341's parked
--     "The reason lives here until commissioner_actions exists (D290)" at
--     111:738-740 is discharged: one `log_commissioner_action_internal` call
--     placed exactly where 130 placed `schedule_edit_matchup`'s (after the
--     in-txn post, with v_result built, before the `schedule_actions` ledger
--     row), `action_type = 'edit_schedule'`, `target_type = 'schedule'`,
--     `target_id = league_id` (a remix re-pairs the season, not one matchup),
--     before/after = the seed, metadata = the plan's numbers + every seated
--     franchise in `affected_team_ids` (D353). A remix that reaches the
--     receipt is a real change by construction (R731's no-op refusal fires
--     first), so standing rule (b) holds with no extra guard. pgTAP 078 L7
--     (zero log calls) and L8 (the pre-130 prosrc md5) RED BY DESIGN and are
--     re-derived in pgTAP 079 / 078 in this PR — the new md5 is MEASURED on
--     the 001-131 chain, not copied.
-- (5) `set_lineup`'s COMMISSIONER ARM (114's `set_lineup_internal`, F40's D290
--     posture "a reason is REQUIRED for an actor who is not the team's
--     manager") IS IN — decided by the orchestrator: a commissioner setting
--     another team's lineup is a commissioner action, so Q66 covers it. The
--     MANAGER arm is untouched and 071 §I's never-weaken pins on `set_lineup`
--     (both refusal strings in prosrc, `is_league_commish` named once, one
--     overload) stay green.
--
-- ---------------------------------------------------------------------------
-- WHAT DOES NOT MOVE (pinned, and asserted by the re-cut suites)
-- ---------------------------------------------------------------------------
-- No gate is REORDERED: every verb still LOCKS `leagues` first and reads its
-- state under the lock; only the reason refusal is removed. The status gates
-- (128's retired guard, 126's scored-cell guard, …) still refuse post-lock —
-- pgTAP 079 re-runs a two-session TOCTOU probe on 128's retired guard to show
-- it. Audit-log immutability (§12.12), lock semantics (§7.3.4/§11.2) and the
-- no-op detection (D336 part 3) are untouched. `commissioner_actions` still
-- has no UPDATE/DELETE policy. `rename_own_team` (128's manager arm) never
-- required a reason and is not in this file. The retire verb's own reason
-- gate (120 / pgTAP 068 C0d) is NOT in the amendment's enumerated scope and
-- is filed, not swept (PROGRESS F363).
--
-- ---------------------------------------------------------------------------
-- NUMBERING (D161 — MEASURED at task time, not reserved)
-- ---------------------------------------------------------------------------
-- `ls supabase/migrations | tail -1` ⇒ 130_commish_edit_schedule.sql ⇒ 131;
-- `ls supabase/tests | tail -1` ⇒ 078_commish_edit_schedule.sql ⇒ 079.
-- (131/079 were the M6A band's reserved seams, released unspent; the tail of
-- the band is this task's by measurement.) supabase/HELD-FROM-PRODUCTION.txt:
-- NO entry added (the hold is over, PR #282). 125-131 await Chris's
-- `npx supabase db push`; 123 is already in production.
--
-- Migration checklist (§4.4): no new table, no new policy, no new trigger, no
-- grant change; R6/D38 waivers not needed (no DDL beyond CREATE OR REPLACE).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. commish_edit_lineup_internal — CREATE OR REPLACE against 123:498-1270's FILE TEXT (D137)
--    2 hunk(s). 123's verb (IN PRODUCTION). Two hunks: the gate becomes a normalisation; the post's reason clause becomes conditional.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_edit_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;
  v_k           RECORD;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  -- NEW in 123 (the differences)
  v_audit_id    UUID;
  v_bypassed    JSONB := '[]'::jsonb;   -- every lock/stint gate this edit walked past, NAMED
  v_moved_lock  JSONB := '[]'::jsonb;   -- the players a manager could not have moved
  v_old_start   TEXT[] := ARRAY[]::text[];
  v_rescore     TEXT[] := ARRAY[]::text[];
  v_enqueued    JSONB := '[]'::jsonb;
  v_not_enq     JSONB := '[]'::jsonb;   -- rescore players with NO queue row, each with its reason
  v_unstamped   TEXT[] := ARRAY[]::text[];
  v_score_stale BOOLEAN;
  v_stale_why   TEXT;
  v_before      JSONB;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'commish_edit_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8). Every other
  --     row lock in this body comes after it — reversing them would invert the
  --     lock order against every other league RPC.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH — COMMISSIONER ONLY (difference (C)). A manager, including this
  --     team's own manager, uses `set_lineup`; this verb is the exception
  --     path and it is audited. One no-leak 42501 for "no such league" and
  --     "not a commissioner" alike.
  v_found := FOUND;
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_edit_lineup: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written. Placed BEFORE every
  -- business gate exactly as 114:250-257 places it, so a retry replays even
  -- when the league or the week has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % is % — a lineup has no meaning outside a season (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_edit_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'commish_edit_lineup: team % is retired — a sealed franchise has no lineup to set (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'commish_edit_lineup: league % has no league_weeks rows — no season calendar to set a lineup against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'commish_edit_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  -- DIFFERENCE (B): 114:293-305's past-week and closed-week refusals are NOT
  -- copied. Both of them say, in their own text, that the change goes
  -- "through the audited commissioner override (§11.2, M6)". This is it.
  -- §11.2:730: "Commissioner can edit any lineup, including retroactively and
  -- past lock (audited)."
  IF p_week < v_current THEN
    v_bypassed := v_bypassed || to_jsonb('past_week'::text);
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    v_bypassed := v_bypassed || to_jsonb(('closed_week:' || v_lw.status)::text);
  END IF;

  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- DIFFERENCE (D), RE-READ UNDER Q66 (migration 131 / L.E1.15, PROGRESS
  -- F362; spec v2.16.41 §10.3 / §15.4): the reason is OPTIONAL. It is
  -- NORMALISED here, never refused — absent or nothing but whitespace in the
  -- explicit E' \t\r\n' class (R745) ⇒ NULL, which 130 §0's column change
  -- stores; otherwise trimmed and bounded at 500 below (the league_chat
  -- bound, R746, and the table CHECK's). The 500 check is NULL-safe as
  -- written (char_length(NULL) > 500 is NULL, and IF NULL does not fire).
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_edit_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged). Verbatim 114:329-349 — the DST
  --     normalisation is what `lineup_fit_internal`'s eligibility test matches
  --     on, so a defense is unplaceable without it.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'commish_edit_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots (verbatim 114:350-370). The
  -- canonical order of v_slots IS the order starters[] is emitted in.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commish_edit_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);
  -- The `before` image the audit row carries — captured before anything moves.
  v_before := jsonb_build_object(
    'slot_map', v_stored, 'starters', COALESCE(v_row.starters, '[]'::jsonb),
    'bench', COALESCE(v_row.bench, '[]'::jsonb), 'locked_at', v_row.locked_at,
    'edited_by_commish', v_row.edited_by_commish, 'set_at', v_row.set_at);

  -- (5) VALIDATE THE SUBMITTED MAP (verbatim 114:388-422): keys are slot
  --     instances or IR spots, values are this team's rostered players, each
  --     player exactly once. These are SHAPE and OWNERSHIP gates, not timing
  --     gates — they bind the commissioner (see WHAT IS NOT LIFTED).
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'commish_edit_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'commish_edit_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'commish_edit_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'commish_edit_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — verbatim
  --     114:424-442. Still needed in full even though the lock is lifted:
  --     v_kick feeds locked_at, starters[].kickoff_at and the bye flag.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> 'nfl_team', p_at);
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;

  -- (7) THE LOCK — DIFFERENCE (A1)/(A2). 114:444-476's two arms are NOT here.
  --     A stored starter whose game kicked off MAY leave his key, and a
  --     player whose game has started MAY enter or move slots. That is the
  --     entire purpose of this verb (PROGRESS §3 clause (g), Chris: "an LM
  --     should be able to set the lineup even after the games have started").
  --     The arms stay byte-identical in `set_lineup_internal` for every
  --     caller, commissioner included — never weaken the rule, add the
  --     exception path.
  --     What replaces them is a RECORD, not a refusal: every player this edit
  --     moved whose game had already kicked off is named, and rides into the
  --     audit row's metadata so the league can see exactly what the override
  --     did that a manager could not have.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN NOT (v_by_pid ? v_pid);
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
       AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
      v_moved_lock := v_moved_lock || jsonb_build_object(
        'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        'from', v_key, 'to', v_seen ->> v_pid,
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_kick -> v_pid ->> 'datum_arm');
    END IF;
  END LOOP;
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    v_pid := v_val #>> '{}';
    CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
    IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
       AND (v_stored ->> v_key) IS DISTINCT FROM v_pid
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_moved_lock) m WHERE m ->> 'player_id' = v_pid) THEN
      v_moved_lock := v_moved_lock || jsonb_build_object(
        'player_id', v_pid, 'name', v_by_pid -> v_pid ->> 'name',
        -- His PRIOR slot, or NULL when he was on the bench. (R970: this was
        -- wrapped in `CASE WHEN v_stored ? v_pid THEN NULL ELSE …` — a
        -- key-existence test against a slot_map keyed by SLOT, so it asked
        -- whether a PLAYER ID was a slot key and was dead by construction.
        -- The subquery alone was always the whole computation; the guard only
        -- misled, in the permanent record of what the override did.)
        'from', (SELECT e.key FROM jsonb_each(v_stored) e WHERE e.value #>> '{}' = v_pid LIMIT 1),
        'to', v_key,
        'kickoff_at', v_kick -> v_pid ->> 'kickoff_at',
        'datum_arm', v_kick -> v_pid ->> 'datum_arm');
    END IF;
  END LOOP;
  IF jsonb_array_length(v_moved_lock) > 0 THEN
    v_bypassed := v_bypassed || to_jsonb('per_player_kickoff_lock'::text);
  END IF;

  -- (8) THE FIT (E16) — 114:479-496 with DIFFERENCE (A3): every player is
  --     passed `fixed = FALSE`. THIS IS LOAD-BEARING, not cosmetic. In
  --     `lineup_fit_internal` a fixed player is seeded at his `wanted` slot
  --     UNCONDITIONALLY (112:498-505) and a fixed-owned slot is never
  --     traversed by the BFS (112:518) — `fixed` IS the matcher's own copy of
  --     the lock. Carrying 114's computation here would silently re-pin every
  --     kicked-off player at his stored slot, and the verb would look like it
  --     worked while refusing to move the one player it exists to move.
  --     With FALSE throughout, `lineup_fit_internal` is reused BYTE-UNCHANGED
  --     and still enforces position eligibility.
  --     Input order is then just submitted-key ordinality — still deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     FALSE) ORDER BY x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  -- E16 is NOT lifted — see WHAT IS NOT LIFTED in the banner (season gate
  -- invariant 2 reds on any stored lineup the fit cannot seat, F324).
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'commish_edit_lineup: % (%) cannot be placed — no legal arrangement fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- (9) IR MOVES, against the CURRENT week — 114:514-579 with DIFFERENCE (A4):
  --     the two Restricted-IR STINT refusals and the two IR LOCK-TIMING
  --     refusals are NOT copied. §11.2:727 names the stint override in so many
  --     words ("Restricted stint still applies; commissioner can override");
  --     the timing gates are the IR analogue of the two lock arms. The
  --     DESIGNATION eligibility gate IS kept — it is a legality rule, and the
  --     already-placed-but-ineligible case stays a FLAG exactly as 114 has it.
  --     Every gate walked past is recorded in v_bypassed.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        v_bypassed := v_bypassed || to_jsonb(('ir_restricted_stint:' || v_pid)::text);
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'commish_edit_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
        v_bypassed := v_bypassed || to_jsonb(('ir_lock_timing:' || v_pid)::text);
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      v_bypassed := v_bypassed || to_jsonb(('ir_restricted_stint:' || v_pid)::text);
    END IF;
    IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
      v_bypassed := v_bypassed || to_jsonb(('ir_lock_timing:' || v_pid)::text);
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  --      Verbatim 114:581-631. The starters[] element shape
  --      {slot, slot_key, label, player_id, position, kickoff_at, flags} is a
  --      HARD cross-file contract: `lineup_lock_tick` walks each element,
  --      reads `player_id`, compares `kickoff_at` as an INSTANT and rewrites
  --      it in place (116:701-726). A different shape either crashes that
  --      league's arm of the hourly job — whose handler swallows it into a
  --      WARNING (116:734-738), so the failure would be SILENT — or churns the
  --      row every hour.
  --      `locked_at` is the LEAST over EVERY occupied starting slot whose
  --      player has a non-NULL kickoff — NOT only those already kicked off.
  --      The tick recomputes it the same way (116:718-720) and would overwrite
  --      any other value.
  v_locked_at := NULL;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE. KEPT (see WHAT IS NOT LIFTED).
      -- 114's R739 clause is dropped from the predicate rather than carried:
      -- it exempts "the stored player's own game has kicked off and he is the
      -- stored occupant", i.e. "not the manager's to change" — and for a verb
      -- with no lock there is no such thing, so carrying it would be a clause
      -- that means nothing. The gate is therefore the plain one.
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0 THEN
        RAISE EXCEPTION
          'commish_edit_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him, start someone who plays, or turn the setting on',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_now));

  -- (11) NO-OP BY NAME (rule 10, and Chris's one condition). DETECTED, never
  --      inferred from an empty write: the canonical map equals the stored map
  --      and no IR move. jsonb equality, so key order is irrelevant.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  -- Which starters changed — the enqueue set (see SCORING). Computed here so
  -- the result can report it whether or not the write happens.
  SELECT COALESCE(array_agg(e.value #>> '{}'), ARRAY[]::text[])
  INTO v_old_start
  FROM jsonb_each(v_stored) e
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key);
  v_rescore := ARRAY(
    SELECT x FROM unnest(v_old_start) x WHERE NOT (x = ANY (v_started))
    UNION
    SELECT x FROM unnest(v_started) x WHERE NOT (x = ANY (v_old_start)));

  v_score_stale := FALSE;
  v_stale_why   := NULL;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    --       DIFFERENCE (E): edited_by_commish is the literal TRUE.
    --       DIFFERENCE (G): set_at rides the seam.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = TRUE,
        set_at            = p_at
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_edit_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_edit_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'commish_edit_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- (12b) THE SCORE. A lineup edit enqueues nothing on its own and the
    --       worker only notices a team through a STARTER's stat delta, so
    --       without this a post-kickoff edit moves the lineup and never moves
    --       the score. Read SCORING in the banner before touching the stamp.
    IF v_lw.status IN ('live', 'correction_window') AND array_length(v_rescore, 1) > 0 THEN
      INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
      SELECT v_league.season, p_week, ps.player_id, min(ps.updated_at)
      FROM public.player_stats ps
      WHERE ps.season = v_league.season AND ps.week = p_week
        AND ps.player_id = ANY (v_rescore)
        AND ps.updated_at IS NOT NULL
      GROUP BY ps.player_id
      ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row
      -- WHAT THIS FIELD MEANS, because a receipt that over-claims is the bug
      -- this whole banner is about: "a claimable queue row EXISTS for him",
      -- not "this statement inserted one". An untouched healthy row left by
      -- ON CONFLICT drains just as well, so it counts — but a player the
      -- INSERT could not queue is NEVER folded into silence.
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_enqueued
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                    WHERE f.season = v_league.season AND f.week = p_week AND f.player_id = x);
      -- R968 — THE OMISSION, NAMED. `player_stats.updated_at` is NULLABLE
      -- (measured: information_schema.columns → is_nullable = YES), so a
      -- partial ingestion can leave a scoreable line the enqueue cannot stamp.
      -- That player is dropped from the queue silently unless we say so.
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_unstamped
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.season = v_league.season AND ps.week = p_week AND ps.player_id = x)
        AND NOT EXISTS (SELECT 1 FROM public.player_stats ps
                        WHERE ps.season = v_league.season AND ps.week = p_week AND ps.player_id = x
                          AND ps.updated_at IS NOT NULL);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'player_id', x,
               'why', CASE WHEN x = ANY (v_unstamped) THEN 'stats_unstamped' ELSE 'no_stat_row' END) ORDER BY x), '[]'::jsonb)
      INTO v_not_enq
      FROM unnest(v_rescore) x
      WHERE NOT EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = p_week AND f.player_id = x);
      IF array_length(v_unstamped, 1) > 0 THEN
        -- A line exists and may carry points; we could not give it a
        -- claimable stamp. That is a lineup that moved and a score that may
        -- not follow — the one thing this verb must never report as success.
        v_score_stale := TRUE;
        v_stale_why   := 'stats_unstamped';
      END IF;
      -- A rescore player with NO stat line at all is NOT stale: the worker
      -- scores an absent line as 0 (`no_stat_row`), so adding or removing him
      -- moves no points. He is still named in `score_not_enqueued` rather
      -- than inferred from an empty array.
    ELSIF v_lw.status = 'final' AND array_length(v_rescore, 1) > 0 THEN
      -- The write door raises `week_final` (119:566-568) and the worker
      -- consumes the queue row with no cell changed (:892-895) — an enqueue
      -- here would delete itself having done nothing. Say so instead.
      -- R969: gated on v_rescore like the other two arms. A pure slot
      -- rearrangement or an IR-only move on a final week changes NO starter
      -- set, so there is no score to chase and a `score_stale` there is a
      -- false alarm in the one field whose whole job is to be believed.
      v_score_stale := TRUE;
      v_stale_why   := 'week_final';
    ELSIF array_length(v_rescore, 1) > 0 THEN
      -- `upcoming`: nothing has been scored yet, so there is nothing stale.
      v_stale_why := NULL;
    END IF;

    -- (12c) THE RECEIPT (§10.3, §15.4:1689). Exactly one audit row, in THIS
    --       transaction, INSIDE the no-op guard — Chris's one condition:
    --       "no receipt if nothing is done. only when something is done."
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_lineup', 'team', p_team_id::text, v_reason,
      v_before,
      jsonb_build_object(
        'slot_map', v_canon, 'starters', v_starters, 'bench', v_bench,
        'locked_at', v_locked_at, 'edited_by_commish', TRUE, 'set_at', p_at),
      jsonb_build_object(
        'week',                p_week,
        'current_week',        v_current,
        'season',              v_league.season,
        'week_status',         v_lw.status,
        'team_name',           v_team.name,
        'action_id',           p_action_id,
        -- The whole point of the verb, made legible: every rule this edit
        -- walked past, and every kicked-off player it moved.
        'bypassed',            v_bypassed,
        'locked_players_moved', v_moved_lock,
        'ir_moves',            jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
        'flags',               jsonb_build_object('bye', v_flags_bye, 'out', v_flags_out,
                                                  'empty', v_flags_empty, 'ir_ineligible', v_flags_irin),
        'score_enqueued',      v_enqueued,
        'score_not_enqueued',  v_not_enq,
        'score_stale',         v_score_stale,
        'score_stale_reason',  v_stale_why),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_edit_lineup: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- §10.3: override system messages auto-post to league chat and CANNOT be
    -- disabled. D97/D290's in-txn post, reworded as the override post.
    v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' edited by '
      || public.draft_actor_name() || ' (commissioner override'
      || CASE WHEN jsonb_array_length(v_moved_lock) > 0
              THEN ', ' || jsonb_array_length(v_moved_lock) || ' player'
                   || CASE WHEN jsonb_array_length(v_moved_lock) = 1 THEN '' ELSE 's' END
                   || ' moved after kickoff'
              ELSE '' END
      || ')' || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week only, so a RETROACTIVE edit
      -- correctly leaves it alone — 114's guard is right as written.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0) THEN
        RAISE EXCEPTION 'commish_edit_lineup: wrote slot_key for % starters, expected %', v_expected, COALESCE(array_length(v_started, 1), 0)
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'commish_edit_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_league.lineup_lock,
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      TRUE,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free),
    -- 123's own keys. The receipt, what the override walked past, and whether
    -- the SCORE followed — said by name, never left to be inferred.
    'commissioner_action_id', v_audit_id,      -- NULL on a no-op, and that is the point
    'week_status',            v_lw.status,
    'bypassed',               v_bypassed,
    'locked_players_moved',   v_moved_lock,
    'score_enqueued',         v_enqueued,
    'score_not_enqueued',     v_not_enq,
    'score_stale',            v_score_stale,
    'score_stale_reason',     v_stale_why
  );

  -- The idempotency ledger row is written for a NO-OP TOO (114:748's posture):
  -- an action_id is consumed by its submit whether or not anything moved, so a
  -- retry replays instead of re-evaluating. This is the OPPOSITE rule from the
  -- audit row above, and deliberately so — §12.26: "an action_id is an
  -- idempotency key, not an audit record".
  INSERT INTO public.commish_lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. commish_matchup_override_internal — CREATE OR REPLACE against 126:606-1020's FILE TEXT (D137)
--    2 hunk(s). 126's shared internal (commish_edit_score / commish_set_result). Two hunks.
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

  -- ── Q61 SWAP LINE ─────────────────────────────────────────────────────────
  -- Q61 (tasks-M6A §11) is OPEN and is Chris's. It is a PRODUCT call about
  -- what an override MEANS mid-game, and it blocks this verb's COPY, not its
  -- structure. Built to the recommendation on file: SET the flag — the
  -- commissioner's number is the league's answer, and un-freezing is a second
  -- audited act. If he rules the other way, change THIS ONE LINE to
  --     v_set_over := v_week_final;
  -- (freeze a closed week, leave a live week to the next drain). Nothing else
  -- moves: the no-op comparison, the UPDATE, `live_scoring_frozen`, the chat
  -- post and the result document all read this variable — and the freeze COPY
  -- reads it as an ARGUMENT to §3b's pure chooser, which carries a `not_frozen`
  -- arm naming the overwrite. **That last part is what makes the swap one line
  -- in CORRECTNESS and not merely in plumbing (R1007):** before the chooser,
  -- flipping this literal made the verb report `week_final` on a LIVE week and
  -- made the chat post say nothing about the drain about to overwrite the
  -- commissioner. pgTAP 074 §L walks BOTH rulings' arms, so the branch this
  -- line does not take is proven rather than merely written.
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

-- ---------------------------------------------------------------------------
-- 3. commish_roster_override_internal — CREATE OR REPLACE against 127:582-1555's FILE TEXT (D137)
--    2 hunk(s). 127's shared internal (commish_move_player / commish_force_add_drop). Two hunks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_roster_override_internal(
  p_league_id    UUID,
  p_team_id      UUID,          -- force_add_drop's team (NULL for a move)
  p_add          TEXT,
  p_drop         TEXT,
  p_player_id    TEXT,          -- move's player (NULL for add/drop)
  p_from_team_id UUID,
  p_to_team_id   UUID,
  p_action_id    UUID,
  p_at           TIMESTAMPTZ,
  p_reason       TEXT,
  p_verb         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league        public.leagues;
  v_found         BOOLEAN;
  v_is_move       BOOLEAN;
  v_result        JSONB;
  v_reason        TEXT;
  v_current       INTEGER;
  v_lw            public.league_weeks;
  v_week_status   TEXT;
  v_roster_size   INTEGER;
  v_hold_hours    INTEGER;
  v_period_hours  INTEGER;
  v_waiver_type   TEXT;
  v_cap_week_txt  TEXT;
  v_cap_season_txt TEXT;
  v_cap_week      INTEGER;
  v_cap_season    INTEGER;
  v_used_week     INTEGER;
  v_used_season   INTEGER;
  -- the normalized plan: who loses a player, who gains one
  v_lose_team     UUID;
  v_gain_team     UUID;
  v_lose_player   TEXT;
  v_gain_player   TEXT;
  v_lose_row      public.league_rosters;
  v_lose_p        public.players;
  v_gain_p        public.players;
  v_owner_team    public.teams;
  v_team_a        public.teams;         -- the move's FROM team / the add-drop team
  v_team_b        public.teams;         -- the move's TO team
  v_pool          public.league_player_pool;
  v_pool_from     TEXT;
  v_drop_to_state TEXT;
  v_drop_until    TIMESTAMPTZ;
  v_hold_early    BOOLEAN := FALSE;
  v_lose_lock     JSONB;
  v_gain_lock     JSONB;
  v_no_changes    BOOLEAN;
  v_audit_id      UUID;
  v_action_type   TEXT;
  v_arm           TEXT;
  v_bypassed      JSONB := '[]'::jsonb;
  v_affected      JSONB := '[]'::jsonb;
  v_lineups       JSONB := '[]'::jsonb;
  v_sync          JSONB;
  v_vacated       TEXT := NULL;
  v_ir_keys       TEXT[] := ARRAY[]::text[];   -- R1018: the league's BARE ir_slots keys
  v_txn_type      TEXT;                        -- R1017: the verb that already owns this action_id
  v_cap_team      UUID;                        -- R1022: the team the acquisition counts are ABOUT
  v_before        JSONB;
  v_before_drop   JSONB;
  v_after         JSONB;
  v_rescore       TEXT[] := ARRAY[]::text[];
  v_enqueued      JSONB := '[]'::jsonb;
  v_not_enq       JSONB := '[]'::jsonb;
  v_reach         TEXT[] := ARRAY[]::text[];
  v_reach_enq     JSONB := '[]'::jsonb;
  v_reachable     BOOLEAN := FALSE;
  v_unstamped     TEXT[] := ARRAY[]::text[];
  v_score_stale   BOOLEAN := FALSE;
  v_stale_why     TEXT := NULL;
  v_txn_id        UUID := gen_random_uuid();
  v_message       TEXT;
  v_cnt           INTEGER;
  v_count_a       INTEGER;
  v_count_b       INTEGER;
  v_exp_a         INTEGER;
  v_exp_b         INTEGER;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and is never answered with
  --     `no_changes: true` — a success document for a request that never said
  --     what it wanted is 126's rule, and it is this family's too.
  IF p_verb IS NULL OR p_verb NOT IN ('commish_move_player', 'commish_force_add_drop') THEN
    RAISE EXCEPTION
      'commish_roster_override_internal: p_verb must be commish_move_player or commish_force_add_drop (got %) — the internal is not a client door', COALESCE(p_verb, 'null')
      USING ERRCODE = '22023';
  END IF;
  v_is_move := (p_verb = 'commish_move_player');

  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      '%: p_action_id is required (idempotency key — one UUID per submit, reused on retry)', p_verb
      USING ERRCODE = '22023';
  END IF;

  IF v_is_move THEN
    IF p_player_id IS NULL OR p_from_team_id IS NULL OR p_to_team_id IS NULL THEN
      RAISE EXCEPTION
        '%: p_player_id, p_from_team_id and p_to_team_id are all required (§15.4:1694 — commish_move_player(player_id, from, to, reason))', p_verb
        USING ERRCODE = '22023';
    END IF;
    IF p_from_team_id = p_to_team_id THEN
      RAISE EXCEPTION
        '%: from and to name the same franchise (%) — a move changes which roster holds the player (§13.1)', p_verb, p_from_team_id
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_team_id IS NULL THEN
      RAISE EXCEPTION '%: p_team_id is required', p_verb USING ERRCODE = '22023';
    END IF;
    IF p_add IS NULL AND p_drop IS NULL THEN
      RAISE EXCEPTION
        '%: nothing to do — give a player to add, a player to drop, or both (§13.1); an override that names no player is not an override', p_verb
        USING ERRCODE = '22023';
    END IF;
    IF p_add IS NOT NULL AND p_add = p_drop THEN
      RAISE EXCEPTION '%: add and drop name the same player (%) — a move changes the roster (§13.1)', p_verb, p_add
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8; D294's one
  --     serialization point — the same one the manager's verb takes).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — COMMISSIONER ONLY, in-body, as ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5). This
  --     REPLACES the manager-only check at `115:416-426`; 115 keeps its own.
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION '%: not a commissioner of this league', p_verb
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), placed AFTER auth but BEFORE every business gate
  --     (123:602-609's placement), so a retry replays byte-identically even
  --     when the league has since moved on.
  SELECT a.result INTO v_result
  FROM public.commish_roster_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (3b) THE SECOND REPLAY KEY, GUARDED BY NAME (R1017; 115's R732 check at
  --      `115:429-443` is the mirror of this one, and it guards only its own
  --      direction). `uniq_transactions_league_action` (`113:283-285`) is a
  --      SHARED `(league_id, action_id)` namespace across the manager's verb
  --      and this one, so an action_id already spent on a `roster_add_drop`
  --      submit would otherwise reach (17)'s INSERT and escape as a raw 23505
  --      — a 500 at the client, because `mapInSeasonRpcError` has no 23505
  --      arm. This family's OWN ledger (step 3) has already answered every
  --      retry of THIS verb, so reaching here means a DIFFERENT verb owns the
  --      key: refuse by name and say which.
  SELECT t.type INTO v_txn_type
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.action_id = p_action_id;
  IF FOUND THEN
    RAISE EXCEPTION
      '%: action_id % already names a "%" transaction in this league — an action_id identifies ONE submit of ONE verb (R732/R1017). Mint a new action_id for this override, or retry the verb that owns that one',
      p_verb, p_action_id, v_txn_type
      USING ERRCODE = 'P0001';
  END IF;

  -- (4) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
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

  -- (5) LEAGUE / TEAMS / CALENDAR. Rosters do not exist before draft
  --     completion, which is what flips the status (066:823 / 086:448 /
  --     110:882), so the manager verb's season gate (115:449-453) binds here
  --     too — it is not a timing constraint on WHO may act, it is the absence
  --     of a subject.
  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      '%: league % is % — rosters change only while in_season or in playoffs (§13.1)', p_verb, p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team_a FROM public.teams t
  WHERE t.id = CASE WHEN v_is_move THEN p_from_team_id ELSE p_team_id END;
  IF NOT FOUND OR v_team_a.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb,
      CASE WHEN v_is_move THEN p_from_team_id ELSE p_team_id END, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_is_move THEN
    SELECT t.* INTO v_team_b FROM public.teams t WHERE t.id = p_to_team_id;
    IF NOT FOUND OR v_team_b.league_id IS DISTINCT FROM p_league_id THEN
      RAISE EXCEPTION '%: team % is not a franchise of league %', p_verb, p_to_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- A `retired` franchise is SEALED (spec:183 — "name/record frozen";
  -- §7.2.1). Under standing rule (i) this is a LEGALITY gate, not a timing
  -- one: a sealed franchise is not a place a roster move can land. F352.
  --
  -- R1020 — THE MESSAGE NAMES A DOOR THAT EXISTS, OR IT SAYS THAT NONE DOES.
  -- The first cut said *"Un-retire the franchise first"*. Measured by
  -- exhausting every `UPDATE … teams` in migrations 001-127 (eleven of them,
  -- `grep -n 'UPDATE public\.teams'`): the column's CHECK is
  -- `('active','orphaned','retired')`; **four statements across two functions
  -- write `'active'` and all four are guarded by the same
  -- `CASE WHEN status = 'orphaned' THEN 'active' ELSE status END`** — `seat_league_member_internal` (`062:282-285`, newest
  -- body `077:442-445`) and `remove_manager`'s successor arm (`063:903-906`,
  -- newest body `120:454-457`). **NOT ONE SITE READS `'retired'` AND WRITES
  -- ANYTHING ELSE.** So an ORPHANED franchise can be re-activated by a new
  -- owner claiming the seat, and a RETIRED one cannot be un-retired by any
  -- verb that exists — the remedy the first message named was a route to
  -- nowhere, which is the F351 posture ("route it, don't leave it") failing in
  -- its worst direction. The message now says the capability is missing rather
  -- than implying it exists, and offers the route that DOES exist. **F354**
  -- owns the gap; building the verb is not this task's scope.
  IF v_team_a.status = 'retired'
     OR (v_is_move AND v_team_b.status = 'retired') THEN
    RAISE EXCEPTION
      '%: a retired franchise is sealed — its roster and record are frozen (§7.2.1, spec:183). This is a legality gate and it binds the commissioner too (PROGRESS standing rule (i), F352). The franchise would have to be un-retired first, and NO VERB DOES THAT TODAY — every site that writes teams.status = active is guarded "WHEN status = orphaned", so nothing un-retires a franchise (F354). Until one exists, move these players to another franchise instead', p_verb
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      '%: league % has no league_weeks rows — no season calendar to place the move on (§12.17)', p_verb, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = v_current;
  IF NOT FOUND THEN
    -- LOUD, never a silent skip (§4 rule 15). `lineup_current_week_internal`
    -- derives the week FROM `league_weeks`, so its absence one statement later
    -- means the calendar changed under us — and a NULL status would make the
    -- whole scoring arm below fall through both its IFs and report nothing.
    RAISE EXCEPTION
      '%: league % has no league_weeks row for season % week % — the calendar moved under this transaction (§12.17)', p_verb, p_league_id, v_league.season, v_current
      USING ERRCODE = 'P0001';
  END IF;
  v_week_status := v_lw.status;

  -- Settings read exactly as 115:472-485 reads them.
  v_waiver_type  := COALESCE(v_league.waiver_type, 'faab');
  v_period_hours := COALESCE((v_league.settings ->> 'waiver_period_hours')::int, 48);
  v_hold_hours   := COALESCE((v_league.settings ->> 'fa_hold_hours')::int, 0);
  v_cap_week_txt   := COALESCE(v_league.settings ->> 'acquisitions_per_week', 'unlimited');
  v_cap_season_txt := COALESCE(v_league.settings ->> 'acquisitions_per_season', 'unlimited');
  v_cap_week   := CASE WHEN v_cap_week_txt   = 'unlimited' THEN NULL ELSE v_cap_week_txt::int   END;
  v_cap_season := CASE WHEN v_cap_season_txt = 'unlimited' THEN NULL ELSE v_cap_season_txt::int END;
  SELECT COALESCE((SELECT sum((s ->> 'count')::int) FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') s), 0)
       + COALESCE((v_league.roster_settings ->> 'bench')::int, 0)
       + COALESCE(jsonb_array_length(v_league.roster_settings -> 'ir_slots'), 0)
  INTO v_roster_size;
  -- R1018: the league's BARE `ir_slots` keys, in the scoring worker's own
  -- shape (`irKeysOf`, `score-week-worker.ts:397-407`). Passed to the lineup
  -- sync so an IR spot can never be mistaken for a vacated starting slot.
  SELECT COALESCE(array_agg(s ->> 'key'), ARRAY[]::text[])
  INTO v_ir_keys
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) s
  WHERE COALESCE(s ->> 'key', '') <> '';

  -- The acquisition counts, hoisted here and assigned for EVERY call (R763 —
  -- 115:489-506 had to hoist them for exactly this reason: a branch that left
  -- them unassigned reported NULL to a capped league). They are read twice
  -- below — to decide whether a cap WOULD have refused (so `bypassed[]` names
  -- a real refusal and not a hypothetical one) and to report the league's own
  -- numbers back unchanged.
  --
  -- **THEY ARE COUNTED FOR THE TEAM THAT ACQUIRES, AND THE RECEIPT SAYS WHICH
  -- TEAM THAT IS (R1022).** An acquisition cap throttles the team a player
  -- ARRIVES on; the first cut counted `v_team_a`, which on a MOVE is the team
  -- the player LEAVES — so `caps.used_week_before` reported the wrong
  -- franchise's budget in a field the league is invited to read. On a move
  -- that is `v_team_b`; on an add/drop it is the one team named. `caps.team_id`
  -- is on the receipt so the number can never again be read against the wrong
  -- roster.
  v_cap_team := CASE WHEN v_is_move THEN v_team_b.id ELSE v_team_a.id END;
  SELECT count(*)::int INTO v_used_week
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = v_cap_team
    AND t.status = 'complete' AND t.week = v_current
    AND (t.payload ->> 'add_player_id') IS NOT NULL;
  SELECT count(*)::int INTO v_used_season
  FROM public.transactions t
  WHERE t.league_id = p_league_id AND t.initiator_team_id = v_cap_team
    AND t.status = 'complete'
    AND (t.payload ->> 'add_player_id') IS NOT NULL;

  -- (6) THE PLAN, NORMALIZED. Both verbs reduce to "this team loses a player"
  --     and/or "that team gains one"; the writes below are then uniform.
  IF v_is_move THEN
    SELECT p.* INTO v_lose_p FROM public.players p WHERE p.id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '%: no player with id %', p_verb, p_player_id USING ERRCODE = 'P0001';
    END IF;
    v_gain_p := v_lose_p;
    SELECT r.* INTO v_lose_row FROM public.league_rosters r
    WHERE r.league_id = p_league_id AND r.player_id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        '%: % (%) is on no roster in league % — a move needs a source roster; to bring a free agent in, use commish_force_add_drop (§15.4:1695)',
        p_verb, v_lose_p.full_name, p_player_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_lose_row.team_id = p_to_team_id THEN
      -- THE NO-OP (see the banner): the requested END STATE already holds.
      v_lose_team := NULL; v_gain_team := NULL;
      v_lose_player := NULL; v_gain_player := NULL;
    ELSIF v_lose_row.team_id <> p_from_team_id THEN
      SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
      RAISE EXCEPTION
        '%: % (%) is on %''s roster, not %''s — neither the source nor the destination you named. Re-read the roster and send the move again with the right `from`',
        p_verb, v_lose_p.full_name, p_player_id, v_owner_team.name, v_team_a.name
        USING ERRCODE = 'P0001';
    ELSE
      v_lose_team   := p_from_team_id;
      v_gain_team   := p_to_team_id;
      v_lose_player := p_player_id;
      v_gain_player := p_player_id;
    END IF;
  ELSE
    -- ── force add / drop ────────────────────────────────────────────────────
    IF p_drop IS NOT NULL THEN
      SELECT p.* INTO v_lose_p FROM public.players p WHERE p.id = p_drop;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (drop)', p_verb, p_drop USING ERRCODE = 'P0001';
      END IF;
      SELECT r.* INTO v_lose_row FROM public.league_rosters r
      WHERE r.league_id = p_league_id AND r.player_id = p_drop;
      IF FOUND THEN
        IF v_lose_row.team_id <> p_team_id THEN
          SELECT t.* INTO v_owner_team FROM public.teams t WHERE t.id = v_lose_row.team_id;
          RAISE EXCEPTION
            '%: % (%) is on %''s roster, not %''s — name the roster he is actually on, or move him with commish_move_player (§15.4:1694)',
            p_verb, v_lose_p.full_name, p_drop, v_owner_team.name, v_team_a.name
            USING ERRCODE = 'P0001';
        END IF;
        v_lose_team   := p_team_id;
        v_lose_player := p_drop;
      END IF;
      -- NOT FOUND ⇒ he is already on no roster in this league: the drop side's
      -- requested end state already holds (the banner's no-op rule).
    END IF;
    IF p_add IS NOT NULL THEN
      SELECT p.* INTO v_gain_p FROM public.players p WHERE p.id = p_add;
      IF NOT FOUND THEN
        RAISE EXCEPTION '%: no player with id % (add)', p_verb, p_add USING ERRCODE = 'P0001';
      END IF;
      -- EXCLUSIVITY (072:147's UNIQUE, CLAUDE.md business rule 7, §12.7) —
      -- A LEGALITY GATE, AND IT BINDS THE COMMISSIONER (standing rule (i)).
      -- Refused BY NAME and never silently converted into a move: the verb the
      -- commissioner wanted is the one the message names.
      SELECT t.* INTO v_owner_team
      FROM public.league_rosters r JOIN public.teams t ON t.id = r.team_id
      WHERE r.league_id = p_league_id AND r.player_id = p_add;
      IF FOUND AND v_owner_team.id <> p_team_id THEN
        RAISE EXCEPTION
          '%: % (%) is already on %''s roster in this league — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7), and that binds a commissioner too: it is the shape of the game, not its timing (PROGRESS standing rule (i)). To take him off % and put him on %, use commish_move_player (§15.4:1694)',
          p_verb, v_gain_p.full_name, p_add, v_owner_team.name, v_owner_team.name, v_team_a.name
          USING ERRCODE = 'P0001';
      END IF;
      IF NOT FOUND THEN
        v_gain_team   := p_team_id;
        v_gain_player := p_add;
      END IF;
      -- FOUND and already on THIS team ⇒ the add side's end state holds.
    END IF;
  END IF;

  -- (7) THE NO-OP, DETECTED BY VALUE across every dimension this verb can
  --     change — which roster row exists and which team it names (D336 part 3,
  --     §4 rule 15). Never inferred from an empty write.
  v_no_changes := (v_lose_player IS NULL AND v_gain_player IS NULL);

  v_affected := CASE
    WHEN v_is_move THEN jsonb_build_array(p_from_team_id, p_to_team_id)
    ELSE jsonb_build_array(p_team_id) END;                       -- D353
  -- R1019 — THE AUDIT ROW DESCRIBES THE PLAN THAT EXECUTED, NEVER THE
  -- PARAMETERS THAT WERE SENT. The first cut keyed both on `p_add IS NOT
  -- NULL`, so a call whose ADD arm was a no-op (he is already on this roster)
  -- and whose DROP arm executed was stamped `action_type = 'force_add'` with
  -- `added_player_id` NULL — and tasks-M6A §5 calls this shape contractual
  -- *"so the activity feed can render them without a special case"*, which
  -- means the feed would render a pure drop as an add. Keyed on the NORMALIZED
  -- plan (`v_gain_player` / `v_lose_player`) the stamp is what happened.
  --
  -- The one place the PARAMETERS are still the honest answer is a total no-op:
  -- nothing executed, no audit row is written at all, and the returned
  -- document's job there is to say what was ASKED and that it changed nothing
  -- (`no_changes` + `no_changes_why` carry the rest).
  v_action_type := CASE
    WHEN v_is_move                 THEN 'move_player'
    WHEN v_no_changes              THEN CASE WHEN p_add IS NOT NULL THEN 'force_add' ELSE 'force_drop' END
    WHEN v_gain_player IS NOT NULL THEN 'force_add'
    ELSE 'force_drop' END;
  v_arm := CASE
    WHEN v_is_move    THEN 'move'
    WHEN v_no_changes THEN CASE
                             WHEN p_add IS NOT NULL AND p_drop IS NOT NULL THEN 'add+drop'
                             WHEN p_add IS NOT NULL THEN 'add'
                             ELSE 'drop' END
    WHEN v_gain_player IS NOT NULL AND v_lose_player IS NOT NULL THEN 'add+drop'
    WHEN v_gain_player IS NOT NULL THEN 'add'
    ELSE 'drop' END;

  IF NOT v_no_changes THEN
    -- (8) WHAT THIS OVERRIDE WALKS PAST, made legible (D336 part 7). Standing
    --     rule (g): the timing rules do not bind a commissioner. None of these
    --     is a refusal here — each is a receipt line, and each one is
    --     EVALUATED (not assumed) so the receipt is true as measured.
    IF v_lose_player IS NOT NULL THEN
      v_lose_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_lose_p.team, p_at);
      IF (v_lose_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_drop_lock:' || v_lose_player)::text);
      END IF;
    END IF;
    IF v_gain_player IS NOT NULL AND NOT v_is_move THEN
      v_gain_lock := public.pool_game_lock_any_internal(v_league.season, v_current, v_gain_p.team, p_at);
      IF (v_gain_lock ->> 'locked')::boolean THEN
        v_bypassed := v_bypassed || to_jsonb(('e32_add_lock:' || v_gain_player)::text);
      END IF;
      -- The waiver period (115:576-582) — a `when`, not a `what`.
      SELECT pp.* INTO v_pool FROM public.league_player_pool pp
      WHERE pp.league_id = p_league_id AND pp.player_id = v_gain_player;
      IF NOT FOUND THEN
        v_pool_from := 'free_agent';
      ELSE
        v_pool_from := v_pool.state;
        IF v_pool.state = 'on_waivers' AND v_pool.waivers_until > p_at THEN
          v_bypassed := v_bypassed || to_jsonb(('waiver_period:' || v_gain_player)::text);
        END IF;
        IF v_pool.state = 'rostered' THEN
          -- D294's BROKEN-MIRROR REFUSAL (115:589-595), carried verbatim: no
          -- roster row (checked above) but a `rostered` pool row means the
          -- mirror is broken. Asserted, not trusted — and it binds the
          -- commissioner because it is an integrity claim about the data, not
          -- a rule about who may act.
          RAISE EXCEPTION
            '%: league_player_pool says % (%) is rostered in league % but league_rosters has no row — the pool mirror is broken; refusing until reconciliation (L.D2.3) repairs it (D294)',
            p_verb, v_gain_p.full_name, v_gain_player, p_league_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
      -- The acquisition caps (115:621-632) — a league throttle. The counts
      -- were taken above (R763); only an ADD could ever have been refused by
      -- them, so only this branch reads them.
      IF v_cap_week IS NOT NULL AND v_used_week >= v_cap_week THEN
        v_bypassed := v_bypassed || to_jsonb('acquisitions_per_week'::text);
      END IF;
      IF v_cap_season IS NOT NULL AND v_used_season >= v_cap_season THEN
        v_bypassed := v_bypassed || to_jsonb('acquisitions_per_season'::text);
      END IF;
    ELSIF v_is_move AND v_gain_player IS NOT NULL THEN
      v_pool_from := 'rostered';
    END IF;

    -- (9) CAPACITY (§7.3.2 roster_size) — A LEGALITY GATE, and it binds the
    --     commissioner. The refusal names the remedy.
    SELECT count(*)::int INTO v_count_a
    FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_a.id;
    v_exp_a := v_count_a
             - CASE WHEN v_lose_team = v_team_a.id THEN 1 ELSE 0 END
             + CASE WHEN v_gain_team = v_team_a.id THEN 1 ELSE 0 END;
    IF v_is_move THEN
      SELECT count(*)::int INTO v_count_b
      FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_b.id;
      v_exp_b := v_count_b
               - CASE WHEN v_lose_team = v_team_b.id THEN 1 ELSE 0 END
               + CASE WHEN v_gain_team = v_team_b.id THEN 1 ELSE 0 END;
      IF v_exp_b > v_roster_size THEN
        RAISE EXCEPTION
          '%: %''s roster is full (% of % — §7.3.2 roster_size) — free a spot with commish_force_add_drop first. A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
          p_verb, v_team_b.name, v_count_b, v_roster_size
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_exp_a > v_roster_size THEN
      RAISE EXCEPTION
        '%: %''s roster is full (% of % — §7.3.2 roster_size) — include a drop in the same move (§13.1). A roster over its own league''s size is a shape the rules do not have, so this gate binds the commissioner too (PROGRESS standing rule (i))',
        p_verb, v_team_a.name, v_count_a, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) THE BEFORE DOCUMENT, read before the writes (D353: `before`/`after`
    --      mirror each other key-for-key over THE ROW THAT CHANGED).
    --      `target_id` is the added or moved player when there is one, else
    --      the dropped one, and these two documents describe THAT player's
    --      `league_rosters` row. A combined add+drop's drop side is fully
    --      described in `metadata` (`drop_player_id`, `drop_before`,
    --      `drop_to_state`) rather than crammed into a shape that has room for
    --      one row — the audit row's headline is the row that arrived.
    v_before_drop := CASE WHEN v_lose_player IS NULL THEN NULL ELSE jsonb_build_object(
      'team_id',          v_lose_row.team_id,
      'slot_key',         v_lose_row.slot_key,
      'acquisition_type', v_lose_row.acquisition_type) END;
    v_before := CASE
      WHEN v_is_move                 THEN v_before_drop
      WHEN v_gain_player IS NOT NULL THEN jsonb_build_object('team_id', NULL, 'slot_key', NULL, 'acquisition_type', NULL)
      ELSE v_before_drop END;

    -- (11) THE WRITES.
    IF v_is_move THEN
      -- A MOVE is an UPDATE of the ONE roster row, so exclusivity is preserved
      -- BY CONSTRUCTION — there is never a second row to collide with
      -- (072:147). The IR stint is a property of the franchise the player is
      -- leaving, so it is cleared with him; acquisition_cost is 0 because a
      -- commissioner move is not a purchase (FAAB is M5's, F340).
      UPDATE public.league_rosters r
      SET team_id            = p_to_team_id,
          slot_key           = 'bn',
          acquisition_type   = 'commissioner',
          acquisition_cost   = 0,
          ir_placed_week     = NULL,
          ir_lock_until_week = NULL,
          acquired_at        = p_at
      WHERE r.league_id = p_league_id AND r.player_id = p_player_id;
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION '%: the move updated % roster rows for %, expected exactly 1', p_verb, v_cnt, p_player_id
          USING ERRCODE = 'P0001';
      END IF;
      -- The pool mirror stays `rostered` (he never left a roster); the stamp
      -- moves so the mirror's own freshness is not silently stale.
      INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
      VALUES (p_league_id, p_player_id, 'rostered', NULL, p_at)
      ON CONFLICT (league_id, player_id) DO UPDATE
        SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
    ELSE
      IF v_lose_player IS NOT NULL THEN
        -- fa_hold_hours (§7.3.4), 115:540-552 verbatim: an early drop of a
        -- free-agent add returns him to FA, not waivers. held >= hold ⇒
        -- waivers (the boundary is inclusive).
        v_hold_early := v_lose_row.acquisition_type = 'free_agent'
                        AND v_hold_hours > 0
                        AND v_lose_row.acquired_at IS NOT NULL
                        AND p_at < v_lose_row.acquired_at + make_interval(hours => v_hold_hours);
        IF v_hold_early OR v_waiver_type = 'none_fcfs' THEN
          v_drop_to_state := 'free_agent';
          v_drop_until := NULL;
        ELSE
          v_drop_to_state := 'on_waivers';
          v_drop_until := p_at + make_interval(hours => v_period_hours);
        END IF;
        DELETE FROM public.league_rosters r
        WHERE r.league_id = p_league_id AND r.team_id = v_lose_team AND r.player_id = v_lose_player;
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        IF v_cnt <> 1 THEN
          RAISE EXCEPTION '%: the drop of % deleted % roster rows, expected 1', p_verb, v_lose_player, v_cnt
            USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
        VALUES (p_league_id, v_lose_player, v_drop_to_state, v_drop_until, p_at)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET state = EXCLUDED.state, waivers_until = EXCLUDED.waivers_until, updated_at = EXCLUDED.updated_at;
      END IF;
      IF v_gain_player IS NOT NULL THEN
        BEGIN
          INSERT INTO public.league_rosters
            (league_id, team_id, player_id, slot_key, acquisition_type, acquisition_cost, acquired_at)
          VALUES (p_league_id, v_gain_team, v_gain_player, 'bn', 'commissioner', 0, p_at);
        EXCEPTION WHEN unique_violation THEN
          -- 072's UNIQUE, kept as an UNPINNABLE backstop (R757/D276, 115's
          -- posture): the league row lock in (1) serializes every racer behind
          -- the exclusivity pre-check, so this branch is unreachable in
          -- practice — it exists so a raw 23505 can never reach the wire if
          -- that lock is ever weakened.
          RAISE EXCEPTION
            '%: % (%) was rostered by another team in this league a moment ago — a player is on ONE roster per league (player exclusivity, §12.7 / CLAUDE.md rule 7)',
            p_verb, v_gain_p.full_name, v_gain_player
            USING ERRCODE = 'P0001';
        END;
        INSERT INTO public.league_player_pool (league_id, player_id, state, waivers_until, updated_at)
        VALUES (p_league_id, v_gain_player, 'rostered', NULL, p_at)
        ON CONFLICT (league_id, player_id) DO UPDATE
          SET state = 'rostered', waivers_until = NULL, updated_at = EXCLUDED.updated_at;
      END IF;
    END IF;

    -- (12) THE LINEUP CONSEQUENCE, and the eviction that carries the score
    --      signal with it (D346). Every week from the current one on, for both
    --      sides of a move.
    v_sync := public.commish_roster_lineup_sync_internal(
      p_league_id, v_team_a.id, v_league.season, v_current, v_current,
      CASE WHEN v_lose_team = v_team_a.id THEN v_lose_player END,
      CASE WHEN v_gain_team = v_team_a.id THEN v_gain_player END,
      v_ir_keys);
    v_lineups := v_lineups || jsonb_build_object('team_id', v_team_a.id, 'rows', v_sync -> 'rows');
    v_vacated := v_sync ->> 'vacated_current_slot';
    IF v_is_move THEN
      v_sync := public.commish_roster_lineup_sync_internal(
        p_league_id, v_team_b.id, v_league.season, v_current, v_current,
        CASE WHEN v_lose_team = v_team_b.id THEN v_lose_player END,
        CASE WHEN v_gain_team = v_team_b.id THEN v_gain_player END,
        v_ir_keys);
      v_lineups := v_lineups || jsonb_build_object('team_id', v_team_b.id, 'rows', v_sync -> 'rows');
      v_vacated := COALESCE(v_vacated, v_sync ->> 'vacated_current_slot');
    END IF;

    -- (13) POST-WRITE ASSERTIONS (R703-class; D294's mirror asserted —
    --      115:732-753's shape, extended to both sides of a move).
    IF v_gain_player IS NOT NULL THEN
      IF (SELECT count(*) FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = v_gain_player) <> 1
         OR NOT EXISTS (SELECT 1 FROM public.league_rosters r
                        WHERE r.league_id = p_league_id AND r.team_id = v_gain_team AND r.player_id = v_gain_player) THEN
        RAISE EXCEPTION '%: after the write, % is not exactly once on the destination roster in league % — refusing', p_verb, v_gain_player, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      IF (SELECT pp.state FROM public.league_player_pool pp
          WHERE pp.league_id = p_league_id AND pp.player_id = v_gain_player) IS DISTINCT FROM 'rostered' THEN
        RAISE EXCEPTION '%: the pool mirror for % is not rostered after the write (D294) — refusing', p_verb, v_gain_player
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_lose_player IS NOT NULL AND NOT v_is_move THEN
      IF EXISTS (SELECT 1 FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.player_id = v_lose_player) THEN
        RAISE EXCEPTION '%: after the drop, % is still rostered in league % — refusing', p_verb, v_lose_player, p_league_id
          USING ERRCODE = 'P0001';
      END IF;
      IF (SELECT pp.state FROM public.league_player_pool pp
          WHERE pp.league_id = p_league_id AND pp.player_id = v_lose_player) IS DISTINCT FROM v_drop_to_state THEN
        RAISE EXCEPTION '%: the pool mirror for % is not % after the drop (D294) — refusing', p_verb, v_lose_player, v_drop_to_state
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    SELECT count(*)::int INTO v_cnt
    FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_a.id;
    IF v_cnt <> v_exp_a OR v_cnt > v_roster_size THEN
      RAISE EXCEPTION '%: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
        p_verb, v_team_a.name, v_cnt, v_exp_a, v_roster_size
        USING ERRCODE = 'P0001';
    END IF;
    IF v_is_move THEN
      SELECT count(*)::int INTO v_cnt
      FROM public.league_rosters r WHERE r.league_id = p_league_id AND r.team_id = v_team_b.id;
      IF v_cnt <> v_exp_b OR v_cnt > v_roster_size THEN
        RAISE EXCEPTION '%: %''s roster holds % players after the move, expected % (roster_size %) — refusing',
          p_verb, v_team_b.name, v_cnt, v_exp_b, v_roster_size
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- (14) THE SCORE (D346). The starter set of the CURRENT week changed
    --      exactly when the losing side's player occupied a slot in it — which
    --      is MEASURED by the sync helper and returned, not assumed. An added
    --      player lands on the BENCH and so is never in the symmetric
    --      difference; the assertion that keeps that true is (12)'s own
    --      post-write check. Read SCORING in the banner before touching the
    --      stamp.
    IF v_vacated IS NOT NULL THEN
      v_rescore := ARRAY[v_lose_player];
    END IF;
    IF array_length(v_rescore, 1) > 0 AND v_week_status IN ('live', 'correction_window') THEN
      -- A CHANGED STARTER IS QUEUED ONLY IF THIS LEAGUE STILL ROSTERS HIM
      -- (F353). The worker maps a queued player to leagues through
      -- `league_rosters`, so a row for a player nobody rosters is consumed with
      -- `report.unmapped += 1` and deleted having done nothing — it is not a
      -- queue poison (measured: `toDelete.push(row)`), but it is a row that
      -- claims to chase a score it cannot reach, and `score_enqueued` would
      -- then mean less than it says. He is NAMED `unrostered` below instead.
      INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
      SELECT v_league.season, v_current, ps.player_id, min(ps.updated_at)
      FROM public.player_stats ps
      WHERE ps.season = v_league.season AND ps.week = v_current
        AND ps.player_id = ANY (v_rescore)
        AND ps.updated_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.league_rosters r
                    WHERE r.league_id = p_league_id AND r.player_id = ps.player_id)
      GROUP BY ps.player_id
      ON CONFLICT (season, week, player_id) DO NOTHING;   -- never re-stamp a healthy row

      -- (14b) THE REACH SET — AND THE REASON IT HAS TO EXIST IS A DIFFERENCE
      --       BETWEEN THIS VERB AND 123's, MEASURED RATHER THAN ASSUMED
      --       (F353). The worker maps a queued player to LEAGUES through the
      --       roster index — its own docblock, step 3: *"ready players →
      --       leagues through `idx_league_rosters_player` … The LEAGUE comes
      --       from the roster index"* — and the query behind it is
      --       `readRosterLeagues`, a read of `league_rosters` filtered to the
      --       season's `in_season|playoffs` leagues.
      --
      --       `commish_edit_lineup` never hits this, because the player it
      --       benches STAYS ON THE ROSTER: he maps to the league, the drain
      --       visits the league-week, and `edited_by_commish` then forces the
      --       team. **A force-DROP deletes the roster row**, so the very row
      --       this verb queues maps to NO league and the drain never arrives —
      --       the enqueue is consumed having reached nothing and the stored
      --       points keep the dropped player, for ever. That is 123's own
      --       failure one layer out, and D346 did not anticipate it because it
      --       was written from the lineup verb's case.
      --
      --       So the verb ALSO queues players the league STILL rosters, drawn
      --       from the affected teams' remaining rosters. They are not there to
      --       be re-scored for their own sake — the drain recomputes every
      --       starter of an affected team through `extraStats` anyway — they
      --       are there to make the drain VISIT this league-week at all. Each
      --       carries its OWN stamp and `ON CONFLICT DO NOTHING`, so a healthy
      --       existing row is never re-stamped and the set costs at most
      --       `roster_size` rows per touched team — plus the CROSS-LEAGUE
      --       fan-out named in the banner (R1023): the queue is keyed
      --       `(season, week, player_id)` with no league column, so these rows
      --       re-drain these players for every other in-season league that
      --       rosters them. Idempotent, and deliberately not narrowed here.
      SELECT COALESCE(array_agg(DISTINCT r.player_id), ARRAY[]::text[]) INTO v_reach
      FROM public.league_rosters r
      WHERE r.league_id = p_league_id
        AND r.team_id IN (v_team_a.id, COALESCE(v_team_b.id, v_team_a.id))
        AND NOT (r.player_id = ANY (v_rescore));
      IF array_length(v_reach, 1) > 0 THEN
        INSERT INTO public.score_fanout (season, week, player_id, enqueued_at)
        SELECT v_league.season, v_current, ps.player_id, min(ps.updated_at)
        FROM public.player_stats ps
        WHERE ps.season = v_league.season AND ps.week = v_current
          AND ps.player_id = ANY (v_reach)
          AND ps.updated_at IS NOT NULL
        GROUP BY ps.player_id
        ON CONFLICT (season, week, player_id) DO NOTHING;
        SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_reach_enq
        FROM unnest(v_reach) x
        WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                      WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      END IF;
      -- WHAT THIS FIELD MEANS (123:1088-1092): "a claimable queue row EXISTS
      -- for him", not "this statement inserted one". An untouched healthy row
      -- left by ON CONFLICT drains just as well — but a player the INSERT
      -- could not queue is NEVER folded into silence.
      SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x), '[]'::jsonb) INTO v_enqueued
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.score_fanout f
                    WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      -- R968 — `player_stats.updated_at` is NULLABLE, so a partial ingestion
      -- can leave a scoreable line the enqueue cannot stamp. Named, never
      -- dropped silently.
      SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_unstamped
      FROM unnest(v_rescore) x
      WHERE EXISTS (SELECT 1 FROM public.player_stats ps
                    WHERE ps.season = v_league.season AND ps.week = v_current AND ps.player_id = x)
        AND NOT EXISTS (SELECT 1 FROM public.player_stats ps
                        WHERE ps.season = v_league.season AND ps.week = v_current AND ps.player_id = x
                          AND ps.updated_at IS NOT NULL);
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'player_id', x,
               'why', CASE
                 WHEN NOT EXISTS (SELECT 1 FROM public.league_rosters r
                                  WHERE r.league_id = p_league_id AND r.player_id = x)
                   THEN 'unrostered'
                 WHEN x = ANY (v_unstamped) THEN 'stats_unstamped'
                 ELSE 'no_stat_row' END) ORDER BY x), '[]'::jsonb)
      INTO v_not_enq
      FROM unnest(v_rescore) x
      WHERE NOT EXISTS (SELECT 1 FROM public.score_fanout f
                        WHERE f.season = v_league.season AND f.week = v_current AND f.player_id = x);
      -- (14c) REACHABILITY, MEASURED AFTER THE WRITES AND NEVER INFERRED: is
      --       there a queued player for this season-week that THIS league
      --       still rosters? That is the exact predicate the worker's map
      --       evaluates, asked of the state this transaction is about to
      --       commit. If the answer is no, the lineup moved and the score
      --       CANNOT follow — the one thing this verb must never report as
      --       success (F353).
      SELECT EXISTS (
        SELECT 1 FROM public.score_fanout f
        JOIN public.league_rosters r
          ON r.player_id = f.player_id AND r.league_id = p_league_id
        WHERE f.season = v_league.season AND f.week = v_current)
      INTO v_reachable;

      -- An `unrostered` changed starter is NOT stale, and the reason is the
      -- mechanism rather than an opinion: the drop's score does not follow
      -- from HIS queue row at all — it follows from the team being recomputed
      -- (reachable + `edited_by_commish`) against the CURRENT lineup, which no
      -- longer contains him. What WOULD be stale is a league-week the drain
      -- cannot reach, and that is the arm below.
      IF NOT v_reachable THEN
        v_score_stale := TRUE;
        v_stale_why   := 'unreachable';
      ELSIF array_length(v_unstamped, 1) > 0 THEN
        v_score_stale := TRUE;
        v_stale_why   := 'stats_unstamped';
      END IF;
    ELSIF array_length(v_rescore, 1) > 0 AND v_week_status = 'final' THEN
      -- The write door raises `week_final` (119:566-568) and the worker
      -- consumes the queue row with no cell changed — an enqueue here would
      -- delete itself having done nothing. Say so instead.
      v_score_stale := TRUE;
      v_stale_why   := 'week_final';
    END IF;
    -- `upcoming`: nothing has been scored yet, so there is nothing stale. A
    -- move that vacated no CURRENT-week slot changes no starter set at all, so
    -- there is no score to chase and a `score_stale` there would be a false
    -- alarm in the one field whose whole job is to be believed (R969).

    -- (15) THE RECEIPT (§10.3, §15.4:1690). Exactly one audit row, in THIS
    --      transaction, INSIDE the no-op guard and AFTER the state write —
    --      D336 part (2) in its plain order, because nothing here forces
    --      126's inversion: no trigger guards these tables and the only FK to
    --      `commissioner_actions` is the `transactions` row written BELOW.
    v_after := CASE
      WHEN v_gain_player IS NOT NULL THEN jsonb_build_object(
        'team_id', v_gain_team, 'slot_key', 'bn', 'acquisition_type', 'commissioner')
      ELSE jsonb_build_object('team_id', NULL, 'slot_key', NULL, 'acquisition_type', NULL) END;
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), v_action_type, 'player',
      COALESCE(v_gain_player, v_lose_player), v_reason,
      v_before, v_after,
      jsonb_build_object(
        'verb',                p_verb,
        'arm',                 v_arm,
        'season',              v_league.season,
        'current_week',        v_current,
        'week_status',         v_week_status,
        'action_id',           p_action_id,
        'affected_team_ids',   v_affected,                 -- D353
        'from_team_id',        v_lose_team,
        'to_team_id',          v_gain_team,
        'from_team_name',      CASE WHEN v_lose_team = v_team_a.id THEN v_team_a.name
                                    WHEN v_is_move AND v_lose_team = v_team_b.id THEN v_team_b.name END,
        'to_team_name',        CASE WHEN v_gain_team = v_team_a.id THEN v_team_a.name
                                    WHEN v_is_move AND v_gain_team = v_team_b.id THEN v_team_b.name END,
        'add_player_id',       v_gain_player,
        'drop_player_id',      v_lose_player,
        'drop_before',         v_before_drop,
        'drop_to_state',       v_drop_to_state,
        'player_name',         COALESCE(v_gain_p.full_name, v_lose_p.full_name),
        'transaction_id',      v_txn_id,
        -- The whole point of the verb, made legible: every rule this override
        -- walked past, with the lock documents that prove each claim.
        'bypassed',            v_bypassed,
        'drop_game_lock',      v_lose_lock,
        'add_game_lock',       v_gain_lock,
        'lineups',             v_lineups,
        'score_enqueued',      v_enqueued,
        'score_not_enqueued',  v_not_enq,
        'score_reach_enqueued', v_reach_enq,
        'score_reachable',     v_reachable,
        'score_stale',         v_score_stale,
        'score_stale_reason',  v_stale_why),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION '%: the audit row was not written — refusing to let the roster move stand without its receipt (§10.3)', p_verb
        USING ERRCODE = 'P0001';
    END IF;

    -- (16) §10.3: override system messages auto-post to league chat and CANNOT
    --      be disabled. D97/D290's in-txn post, worded as the roster override.
    v_message := CASE WHEN v_is_move
      THEN v_lose_p.full_name || ' moved from ' || v_team_a.name || ' to ' || v_team_b.name
      ELSE v_team_a.name || ': '
           || CASE WHEN v_gain_player IS NOT NULL THEN 'added ' || v_gain_p.full_name ELSE '' END
           || CASE WHEN v_gain_player IS NOT NULL AND v_lose_player IS NOT NULL THEN ', ' ELSE '' END
           || CASE WHEN v_lose_player IS NOT NULL THEN 'dropped ' || v_lose_p.full_name ELSE '' END
      END
      || ' by ' || public.draft_actor_name() || ' (commissioner override'
      || CASE WHEN jsonb_array_length(v_bypassed) > 0
              THEN ', ' || jsonb_array_length(v_bypassed) || ' rule'
                   || CASE WHEN jsonb_array_length(v_bypassed) = 1 THEN '' ELSE 's' END || ' bypassed'
              ELSE '' END
      || ')'
      || CASE WHEN v_vacated IS NOT NULL
              THEN ' — a week-' || v_current || ' starting slot was emptied'
              ELSE '' END
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   p_verb,
    'action_type',            v_action_type,
    'arm',                    v_arm,
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'week',                   v_current,
    'week_status',            v_week_status,
    'team_id',                CASE WHEN v_is_move THEN p_to_team_id ELSE p_team_id END,
    'from_team_id',           CASE WHEN v_is_move THEN p_from_team_id ELSE NULL END,
    'to_team_id',             CASE WHEN v_is_move THEN p_to_team_id ELSE NULL END,
    'player_id',              p_player_id,
    'add_player_id',          CASE WHEN v_is_move THEN NULL ELSE p_add END,
    'drop_player_id',         CASE WHEN v_is_move THEN NULL ELSE p_drop END,
    'moved_player_id',        CASE WHEN v_is_move THEN v_gain_player ELSE NULL END,
    'added_player_id',        CASE WHEN v_is_move THEN NULL ELSE v_gain_player END,
    'dropped_player_id',      CASE WHEN v_is_move THEN NULL ELSE v_lose_player END,
    'drop_to_state',          v_drop_to_state,
    'drop_waivers_until',     v_drop_until,
    'pool_from_state',        v_pool_from,
    'acquisition_type',       CASE WHEN v_gain_player IS NULL THEN NULL ELSE 'commissioner' END,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                CASE WHEN v_is_move
                                  THEN 'already_on_destination — the requested end state already held, so nothing was written and no receipt was issued (PROGRESS standing rule (b))'
                                  ELSE 'end_state_already_held — the add is already on this roster and/or the drop is already on none, so nothing was written and no receipt was issued (PROGRESS standing rule (b))'
                                END END,
    'commissioner_action_id', v_audit_id,      -- NULL on a no-op, and that is the point
    'transaction_id',         CASE WHEN v_no_changes THEN NULL ELSE v_txn_id END,
    'affected_team_ids',      v_affected,      -- D353
    'bypassed',               v_bypassed,
    'drop_game_lock',         v_lose_lock,
    'add_game_lock',          v_gain_lock,
    'lineups',                v_lineups,
    'vacated_current_slot',   v_vacated,
    'roster', jsonb_build_object(
      'roster_size',   v_roster_size,
      'count_after_a', CASE WHEN v_no_changes THEN NULL ELSE v_exp_a END,
      'count_after_b', CASE WHEN v_no_changes OR NOT v_is_move THEN NULL ELSE v_exp_b END),
    'caps', jsonb_build_object(
      'acquisitions_per_week',   v_cap_week_txt,
      'acquisitions_per_season', v_cap_season_txt,
      -- STATED, NOT DISCOVERED (§4 rule 15): 115:497-506 counts a team's
      -- acquisitions by `initiator_team_id`, and D353's shape writes that
      -- column NULL — so a commissioner force-add neither obeys the cap nor
      -- consumes it. Said here so a league reading its own budget is not
      -- surprised by a number that did not move.
      'commissioner_move_not_counted', TRUE,
      -- R1022: WHOSE counts these are, said in the document. A cap throttles
      -- the ACQUIRING team, which on a move is the destination — not v_team_a.
      'team_id',            v_cap_team,
      'used_week_before',   v_used_week,
      'used_season_before', v_used_season),
    'score_enqueued',         v_enqueued,
    'score_not_enqueued',     v_not_enq,
    -- F353: the players queued ONLY so the drain REACHES this league-week,
    -- because the worker maps a queued player to leagues through
    -- `league_rosters` and a DROPPED player maps to none. `score_reachable` is
    -- the measured answer to that question, not an inference from the above.
    'score_reach_enqueued',   v_reach_enq,
    'score_reachable',        v_reachable,
    'score_stale',            v_score_stale,
    'score_stale_reason',     v_stale_why,
    'edited_by_commish',      NOT v_no_changes,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at);

  IF NOT v_no_changes THEN
    -- (17) THE TRANSACTIONS ROW — §12.9's unified in-season activity log, and
    --      the FIRST writer of `related_action_id` (109:239-250; the FK landed
    --      at 123:461-462). `initiator_team_id` is NULL because no TEAM
    --      initiated this, which is the column's documented meaning and is
    --      also what keeps the move out of the team's acquisition count.
    --      Written after the receipt because it REFERENCES it.
    INSERT INTO public.transactions
      (id, league_id, type, status, initiator_team_id, initiated_by, payload, week, action_id, related_action_id)
    VALUES (v_txn_id, p_league_id, 'commissioner_move', 'complete', NULL, auth.uid(), v_result, v_current, p_action_id, v_audit_id);
  END IF;

  -- The idempotency ledger row is written for a NO-OP TOO (123:1259-1266's
  -- posture): an action_id is consumed by its submit whether or not anything
  -- moved, so a retry replays instead of re-evaluating. This is the OPPOSITE
  -- rule from the audit row above, and deliberately so — §12.26: "an action_id
  -- is an idempotency key, not an audit record".
  INSERT INTO public.commish_roster_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, CASE WHEN v_is_move THEN p_to_team_id ELSE p_team_id END, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. commish_rename_team_internal — CREATE OR REPLACE against 128:384-629's FILE TEXT (D137)
--    2 hunk(s). 128's COMMISSIONER arm only — rename_own_team_internal (128's manager arm) never required a reason and is byte-untouched. Two hunks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commish_rename_team_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_name      TEXT,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league     public.leagues;
  v_found      BOOLEAN;
  v_team       public.teams;
  v_reason     TEXT;
  v_new_name   TEXT;
  v_old_name   TEXT;
  v_no_changes BOOLEAN;
  v_collides   JSONB;
  v_frozen     INTEGER;
  v_audit_id   UUID;
  v_message    TEXT;
  v_result     JSONB;
  v_cnt        INTEGER;
BEGIN
  -- (0) SHAPE. A malformed call is refused BY NAME and is never answered with
  --     `no_changes: true` — a success document for a request that never said
  --     what it wanted is 126's rule, and it is this verb's too.
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'commish_rename_team: p_team_id is required — an override that names no franchise is not an override'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'commish_rename_team: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8 — the same
  --     serialization point every in-season verb takes). A rename is a
  --     read-then-write over `teams.name`, so without it two concurrent
  --     renames could each observe a change and each write one, and the
  --     LOSER's audit row would claim a `before` that was never the row's
  --     value by the time it landed. The receipt has to be true.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  v_found := FOUND;

  -- (2) AUTH — COMMISSIONER ONLY, in-body, as ONE no-leak 42501 covering "no
  --     such league" and "not a commissioner" alike (D336 part 5). The
  --     manager's door is §4's `rename_own_team`, which this verb does not
  --     widen and does not replace.
  IF NOT v_found OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'commish_rename_team: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- (3) REPLAY (099/E2), placed AFTER auth but BEFORE every business gate
  --     (`123:602-609`'s placement), so a retry replays byte-identically even
  --     when the league has since moved on — including after the franchise
  --     has been renamed again by someone else.
  SELECT a.result INTO v_result
  FROM public.commish_team_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  -- (4) THE REASON, OPTIONAL under Q66 (migration 131 / L.E1.15, F362;
  --     spec v2.16.41 §10.3 / §15.4): NORMALISED, never refused. Absent or
  --     whitespace-only in the explicit E' \t\r\n' class (R745) ⇒ NULL
  --     (130 §0 stores it); otherwise trimmed, bounded at 500 below (the
  --     league_chat bound and the commissioner_actions CHECK). PROGRESS
  --     (h)/F343 as amended by 131: the client may send NOTHING; the label
  --     was a workaround for 123:295's NOT NULL, which 130 §0 removed.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'commish_rename_team: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (4b) THE NAME, through the shared gate (§2).
  v_new_name := public.team_rename_normalize_internal(p_name, 'commish_rename_team');

  -- (5) THE FRANCHISE. Locked in its own right so the before/after pair the
  --     receipt carries is the value this statement actually replaced.
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id FOR UPDATE;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'commish_rename_team: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  v_old_name := v_team.name;

  -- (6) THE ONE REFUSAL, AND IT IS THE SPEC'S OWN (`spec:183`, §7.2.1(b)):
  --     a retired franchise is SEALED and its "name/record frozen". A
  --     LEGALITY gate, not a timing one, so PROGRESS standing rule (i) binds
  --     the commissioner too — the sealed franchise IS the record History
  --     Mode shows under its last manager's name, and renaming it changes
  --     what the league's history says rather than fixing what went wrong.
  --     The message names F354 instead of a remedy nobody built (R1020's
  --     lesson from 127): NO verb un-retires a franchise today.
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION
      'commish_rename_team: franchise % is RETIRED — its name is FROZEN, because a sealed franchise is the record History Mode shows under its last manager (spec:183, §7.2.1(b)). This is a legality gate and it binds the commissioner too (PROGRESS standing rule (i)). NO VERB UN-RETIRES A FRANCHISE TODAY (F354), so there is no "un-retire first" to offer; rename the SUCCESSOR franchise (%) instead',
      p_team_id, COALESCE(v_team.successor_team_id::text, 'none recorded')
      USING ERRCODE = 'P0001';
  END IF;

  -- (7) THE COLLISION REPORT — measured, never a refusal. There is no UNIQUE
  --     index and no CHECK on `teams.name` anywhere in 001-127, and inventing
  --     one inside a verb that exists to REMOVE a restriction would be new
  --     product. So the other franchises already using this name are named
  --     and the caller decides (§4 rule 15: say what is true out loud).
  SELECT COALESCE(jsonb_agg(t.id ORDER BY t.name, t.id), '[]'::jsonb) INTO v_collides
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.id <> p_team_id
    AND lower(t.name) = lower(v_new_name);

  -- (8) THE NO-OP, DETECTED BY VALUE across every dimension this verb can
  --     change — which is exactly ONE, `name` (D336 part 3, §4 rule 15).
  --     Never inferred from an empty write: the UPDATE below sits INSIDE the
  --     guard, so `updated_at` does not move for a no-op either.
  v_no_changes := (v_old_name = v_new_name);

  IF NOT v_no_changes THEN
    -- (8b) THE STATE WRITE, with the loud ROW_COUNT assertion the house uses
    --      (`119:882-886`'s shape). The row is already locked by (5), so a
    --      count other than 1 means the row vanished under us, not a race we
    --      can paper over.
    UPDATE public.teams
    SET name = v_new_name,
        updated_at = p_at
    WHERE id = p_team_id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'commish_rename_team: the rename touched % rows, expected exactly 1 (franchise %)', v_cnt, p_team_id
        USING ERRCODE = 'P0001';
    END IF;

    -- (8c) THE FROZEN COPIES, COUNTED BEFORE THIS ACT'S OWN RECEIPT IS
    --      WRITTEN. Receipts already issued in this league that carry the OLD
    --      name keep carrying it — a receipt records what was true (§18,
    --      §12.12), and `123:339-410`'s ENABLE ALWAYS trigger refuses an
    --      UPDATE of one anyway. Counted, not asserted, so the number in the
    --      document is measured (§4 rule 15).
    --
    --      SCOPE, STATED so the number is readable: receipts already issued
    --      ABOUT THIS FRANCHISE (`target_type = 'team'`, `target_id` = this
    --      id) whose recorded `metadata.team_name` is not the name the
    --      franchise carries after this statement. Those are exactly the rows
    --      a reader might expect a propagation pass to have rewritten, and
    --      exactly the rows that must not be.
    SELECT count(*)::int INTO v_frozen
    FROM public.commissioner_actions c
    WHERE c.league_id = p_league_id
      AND c.target_type = 'team'
      AND c.target_id = p_team_id::text
      AND c.metadata ->> 'team_name' IS NOT NULL
      AND c.metadata ->> 'team_name' IS DISTINCT FROM v_new_name;

    -- (9) D336 part 2 — EXACTLY ONE audit row, through the ONE shared logging
    --     helper (`123:417-453`), INSIDE the no-op guard and AFTER the state
    --     write. tasks-M6A §5's contractual shape for this verb.
    v_audit_id := public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'reassign_team', 'team', p_team_id::text, v_reason,
      jsonb_build_object('name', v_old_name),
      jsonb_build_object('name', v_new_name),
      jsonb_build_object(
        'verb',                'commish_rename_team',
        'season',              v_league.season,
        'action_id',           p_action_id,
        -- §5's contractual extra: the OLD name, which is also the value this
        -- receipt freezes for ever.
        'team_name',           v_old_name,
        'new_team_name',       v_new_name,
        'team_status',         v_team.status,
        'name_collides_with',  v_collides,
        'bypassed',            '[]'::jsonb,
        'frozen_receipts_for_this_team', v_frozen),
      NULL);
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'commish_rename_team: the audit row was not written — refusing to let the rename stand without its receipt (§10.3)'
        USING ERRCODE = 'P0001';
    END IF;

    -- (10) §10.3: override system messages auto-post to league chat and CANNOT
    --      be disabled. D97/D290's in-txn post, worded as the rename.
    v_message := v_old_name || ' is now ' || v_new_name
      || ' — renamed by ' || public.draft_actor_name() || ' (commissioner override)'
      || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional, never 'reason: <NULL>'
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'verb',                   'commish_rename_team',
    'action_type',            'reassign_team',       -- tasks-M6A §5's contractual string; F355
    'action_id',              p_action_id,
    'season',                 v_league.season,
    'team_id',                p_team_id,
    'team_status',            v_team.status,
    'name',                   CASE WHEN v_no_changes THEN v_old_name ELSE v_new_name END,
    'previous_name',          v_old_name,
    'requested_name',         v_new_name,
    'name_collides_with',     v_collides,
    'no_changes',             v_no_changes,
    'no_changes_why',         CASE WHEN v_no_changes THEN
                                'name_already_set — the franchise already carried this exact name (compared after the same trim), so nothing was written and no receipt was issued (PROGRESS standing rule (b))' END,
    'commissioner_action_id', v_audit_id,            -- NULL on a no-op, and that is the point
    -- Standing rule (g) exempts the commissioner from the game-day lock for
    -- every verb in this slice — but a NAME touches no lock, no week gate and
    -- no scoring door, so there is nothing here to walk past. The empty array
    -- is EXPLAINED rather than left to be guessed at (§4 rule 15).
    'bypassed',               '[]'::jsonb,
    'bypassed_why',           'nothing to bypass — a franchise name is not gated by the per-player kickoff lock (114:449-476), the week status, or the scoring snapshot; the only gate on it is the sealed-franchise refusal above, which is a LEGALITY gate and binds the commissioner too (standing rule (i))',
    'propagation', jsonb_build_object(
      -- Item 4's finding, in the document as well as the banner.
      'live',                     TRUE,
      'live_why',                 'teams.name is read LIVE at every call site (123:1155 and 127:1413-1416 stamp it by joining teams at write time; standings and box scores join per read), so no propagation pass is written and none is needed',
      'frozen_receipts_for_this_team', CASE WHEN v_no_changes THEN 0 ELSE v_frozen END,
      'history_rewritten',        FALSE,
      'history_not_rewritten_why','already-written league_chat system posts and commissioner_actions.metadata.team_name KEEP THE OLD NAME on purpose — a receipt records what was true (§18, §12.12), and 123:339-410''s ENABLE ALWAYS trigger refuses an UPDATE of one in any case'),
    'reason',                 v_reason,
    'system_post',            v_message,             -- NULL on a no-op: no receipt if nothing is done
    'evaluated_at',           p_at);

  -- The idempotency ledger row is written for a NO-OP TOO (`123:1259-1266`'s
  -- posture): an action_id is consumed by its submit whether or not anything
  -- moved, so a retry replays instead of re-evaluating. This is the OPPOSITE
  -- rule from the audit row above, and deliberately so — §12.26: "an action_id
  -- is an idempotency key, not an audit record".
  INSERT INTO public.commish_team_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. commish_change_setting_internal — CREATE OR REPLACE against 129:638-1100's FILE TEXT (D137)
--    2 hunk(s). 129's verb. Two hunks.
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
  --      refusal at (11b) rolls back nothing and the report at (11c)/(11d)
  --      describes the weeks as they were.
  IF v_key = 'scoring_system_id' AND NOT v_no_changes THEN
    SELECT COALESCE(jsonb_agg(lw.week ORDER BY lw.week), '[]'::jsonb) INTO v_final_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status = 'final';
    SELECT COALESCE(jsonb_agg(jsonb_build_object('week', lw.week, 'status', lw.status) ORDER BY lw.week), '[]'::jsonb) INTO v_open_weeks
    FROM public.league_weeks lw
    WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.status IN ('live', 'correction_window');

    -- (11b) ── Q64 SEAM ── `rescore` cannot reach a FINAL week today:
    --       `score_write_week_batch` refuses `week_final` (119:566-568), the
    --       total-points arm guards `is_final = FALSE` (119:600-602), and
    --       `reopen_week` — the audited un-freeze §12.12 names and 110's
    --       transition guard (110:285-296) already expects — has no writer
    --       (`league_weeks.reopened_by_action_id`: FK since 123:463-464, zero
    --       writers). So the week is REFUSED BY NAME and the whole call rolls
    --       back. A future `reopen_week` task replaces THIS block with a
    --       per-week `PERFORM public.reopen_week_internal(p_league_id, week,
    --       p_at, v_reason)` and lets (11c) below enqueue the reopened weeks
    --       with the open ones. See the banner.
    IF v_rescore AND v_final_weeks <> '[]'::jsonb THEN
      RAISE EXCEPTION 'commish_change_setting: rescore = true cannot reach FINAL week(s) % of league % — a final week''s stored scores are immutable without an audited reopen_week, and NO VERB REOPENS A WEEK TODAY (Q64; league_weeks.reopened_by_action_id has zero writers). Nothing was changed. Either resubmit with rescore = false (scoring changes going FORWARD; every stored score stays as it is), or wait for reopen_week to be built',
        v_final_weeks::text, p_league_id
        USING ERRCODE = 'P0001';
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
        -- (11b) already guaranteed v_final_weeks = [] here.
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
          v_rescore_why  := 'nothing_scored_yet — this season has no live or correction_window week and no final week, so there is no stored score to recompute; the re-frozen snapshot governs every week from here';
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

-- ---------------------------------------------------------------------------
-- 6. schedule_edit_matchup — CREATE OR REPLACE against 130:813-1227's FILE TEXT (D137)
--    3 hunk(s). 111's verb as 130 last defined it (D137: newest definer = 130). Three hunks: the post-kickoff gate → normalisation (explicit class — R1048's other half), the post clause conditional, and the gate's own REPORT field `reason_required` → FALSE at both levels. 130's receipt hunk (its re-normalisation and 500 check, now redundant but harmless) is byte-untouched, INCLUDING its comment that still calls the gate F362's — read it with this banner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schedule_edit_matchup(
  p_league_id  UUID,
  p_matchup_id UUID,
  p_home       UUID,
  p_away       UUID,
  p_reason     TEXT,
  p_action_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league    public.leagues;
  v_m         public.matchups;
  v_week_status TEXT;
  v_first     INTEGER;
  v_window    RECORD;
  v_free      BOOLEAN;
  v_reason    TEXT;
  v_result    JSONB;
  v_old_home  UUID;
  v_old_away  UUID;
  v_new_ids   UUID[] := ARRAY[]::uuid[];   -- new teams not already in the matchup (home first)
  v_disp_ids  UUID[] := ARRAY[]::uuid[];   -- displaced teams (home first)
  v_sib       public.matchups;
  v_sibs      JSONB := '[]'::jsonb;
  v_i         INTEGER;
  v_t         UUID;
  v_d         UUID;
  v_side      TEXT;
  v_cnt       INTEGER;
  v_n         INTEGER;
  v_message   TEXT;
  v_names     JSONB;
  v_kind      TEXT;
  v_wk        RECORD;
BEGIN
  IF p_matchup_id IS NULL THEN
    RAISE EXCEPTION 'schedule_edit_matchup: matchup_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: p_action_id is required (idempotency key — one UUID per edit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_home IS NULL OR p_away IS NULL THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: both teams are required — v1 schedules even counts only, a matchup has no bye (§7.3.1/§11.7)'
      USING ERRCODE = '22023';
  END IF;
  IF p_home = p_away THEN
    RAISE EXCEPTION 'schedule_edit_matchup: a team cannot play itself (§11.7 "no self-matchups")'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST.
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) VALIDATE. One no-leak 42501.
  IF NOT FOUND OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'schedule_edit_matchup: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2).
  SELECT a.result, a.kind INTO v_result, v_kind
  FROM public.schedule_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_kind <> 'edit_matchup' THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: action_id % was used by a % on this league — an action_id belongs to one verb (R732)',
        p_action_id, v_kind
        USING ERRCODE = '22023';
    END IF;
    RETURN v_result;
  END IF;

  IF v_league.status <> 'in_season' THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: league % is % — regular-season matchups can be edited only while in_season (§11.7)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT m.* INTO v_m
  FROM public.matchups m
  WHERE m.id = p_matchup_id AND m.league_id = p_league_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schedule_edit_matchup: matchup % is not a matchup of league %', p_matchup_id, p_league_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_m.round_type NOT IN ('regular', 'secondary') THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % is a % row — only regular-season pairings (regular / secondary) are edited here; brackets are the playoffs engine''s (§11.5)',
      p_matchup_id, v_m.round_type
      USING ERRCODE = 'P0001';
  END IF;
  IF v_m.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % (week %) is % — only scheduled matchups may change; live/final never regenerate (§11.7/E41)',
      p_matchup_id, v_m.week, v_m.status
      USING ERRCODE = 'P0001';
  END IF;
  -- R733: an overridden or scored cell is never touched (rule 9).
  IF v_m.is_overridden OR v_m.result IS NOT NULL
     OR COALESCE(v_m.home_score, 0) <> 0 OR COALESCE(v_m.away_score, 0) <> 0 THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % (week %) carries a result or score (overridden: %) — a scored or overridden cell is never rewritten (§22.2/rule 9)',
      p_matchup_id, v_m.week, v_m.is_overridden
      USING ERRCODE = 'P0001';
  END IF;
  SELECT w.status INTO v_week_status
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_m.season AND w.week = v_m.week;
  IF v_week_status IS DISTINCT FROM 'upcoming' THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: week % of league % is % — only an upcoming week''s matchups may change (§11.7/§12.17)',
      v_m.week, p_league_id, COALESCE(v_week_status, 'missing')
      USING ERRCODE = 'P0001';
  END IF;
  -- R730: the week's OWN first kickoff, from nfl_games at call time — a
  -- week under way is not a future week whatever its status row says.
  SELECT * INTO v_wk FROM public.schedule_window_internal(v_m.season, v_m.week, now());
  IF NOT v_wk.free THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: week % of league % kicked off at % (%) — only future weeks may change (§11.7/E41/E42)',
      v_m.week, p_league_id, v_wk.first_kickoff_at, v_wk.datum_arm
      USING ERRCODE = 'P0001';
  END IF;
  IF v_m.away_team_id IS NULL THEN
    RAISE EXCEPTION 'schedule_edit_matchup: matchup % is a bye row — v1 schedules have none to edit', p_matchup_id
      USING ERRCODE = 'P0001';
  END IF;

  -- F222(a): a foreign or retired team is refused BY NAME (the writer's
  -- refusal in place of the composite FK).
  FOR v_t IN SELECT unnest(ARRAY[p_home, p_away]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.teams t
                   WHERE t.id = v_t AND t.league_id = p_league_id AND t.status <> 'retired') THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: team % is not a seated franchise of league % — a matchup may only pair this league''s own teams (§11.7/F222)',
        v_t, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  v_old_home := v_m.home_team_id;
  v_old_away := v_m.away_team_id;
  IF p_home = v_old_home AND p_away = v_old_away THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: matchup % already pairs % (home) vs % (away) — nothing to change',
      p_matchup_id, p_home, p_away
      USING ERRCODE = 'P0001';
  END IF;

  -- E41 / D290: the window, from the league's FIRST week's kickoff, now.
  SELECT min(w.week) INTO v_first
  FROM public.league_weeks w
  WHERE w.league_id = p_league_id AND w.season = v_league.season;
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, v_first, now());
  v_free := v_window.free;
  -- 131 / Q66 (L.E1.15, F362; spec v2.16.41 §11.7 / E41): the post-kickoff
  -- reason gate that stood here (111:952-957) is GONE — a reason is optional
  -- in every window. Normalised in the explicit E' \t\r\n' class (R1048:
  -- the post below and the receipt now read the SAME value); absent or
  -- whitespace-only ⇒ NULL. The window is still evaluated and REPORTED.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');

  -- The permutation: new teams not already in this matchup, and the teams
  -- they displace (home slot first on both sides). |new| = |displaced|.
  IF p_home <> v_old_home AND p_home <> v_old_away THEN v_new_ids := array_append(v_new_ids, p_home); END IF;
  IF p_away <> v_old_home AND p_away <> v_old_away THEN v_new_ids := array_append(v_new_ids, p_away); END IF;
  IF v_old_home <> p_home AND v_old_home <> p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_home); END IF;
  IF v_old_away <> p_home AND v_old_away <> p_away THEN v_disp_ids := array_append(v_disp_ids, v_old_away); END IF;

  -- (3) WRITE — a permutation over up to three rows under IMMEDIATE per-side
  -- unique indexes (109). MEASURED, not assumed (D276): single-row UPDATEs
  -- in EITHER order collide when a team swaps places with a team on the
  -- SAME side of another row (M = (T2, T5), N = (T4, T3), new (T2, T3):
  -- writing M.away = T3 duplicates N's away T3; writing N.away = T5 first
  -- duplicates M's away T5). So the sibling rows PARK first — they step out
  -- of the week's (round_type, side) uniqueness space onto a round_type
  -- that holds no row in this week (asserted, never assumed) — then the
  -- edited row is written, then each sibling returns to its game type with
  -- its displaced team seated, one UPDATE per row. Every intermediate state
  -- is legal to both indexes; the whole permutation is one transaction.
  --
  -- First resolve every sibling (the row the new team vacates) BEFORE any
  -- write, so every refusal fires against an untouched week.
  FOR v_i IN 1..COALESCE(array_length(v_new_ids, 1), 0) LOOP
    v_t := v_new_ids[v_i];
    SELECT s.* INTO v_sib
    FROM public.matchups s
    WHERE s.league_id = p_league_id AND s.season = v_m.season AND s.week = v_m.week
      AND s.round_type = v_m.round_type AND s.id <> p_matchup_id
      AND (s.home_team_id = v_t OR s.away_team_id = v_t);
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: team % has no other % matchup in week % of league % to vacate — the week''s rows are not the engine''s one-per-team shape (§11.7)',
        v_t, v_m.round_type, v_m.week, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_sib.status <> 'scheduled' THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: matchup % (week %, %''s current game) is % — the edit would have to re-seat a team into it; only scheduled matchups may change (§11.7/E41)',
        v_sib.id, v_sib.week, v_t, v_sib.status
        USING ERRCODE = 'P0001';
    END IF;
    IF v_sib.is_overridden OR v_sib.result IS NOT NULL
       OR COALESCE(v_sib.home_score, 0) <> 0 OR COALESCE(v_sib.away_score, 0) <> 0 THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: matchup % (week %, %''s current game) carries a result or score — a scored or overridden cell is never rewritten (§22.2/rule 9)',
        v_sib.id, v_sib.week, v_t
        USING ERRCODE = 'P0001';
    END IF;
    v_side := CASE WHEN v_sib.home_team_id = v_t THEN 'home' ELSE 'away' END;
    v_d := v_disp_ids[v_i];
    -- One entry PER SIBLING ROW: two new teams drawn from the same matchup
    -- (the pairing swap) merge into one entry with both slots re-seated.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_sibs) s WHERE (s ->> 'matchup_id')::uuid = v_sib.id) THEN
      SELECT jsonb_agg(
               CASE WHEN (s ->> 'matchup_id')::uuid = v_sib.id
                    THEN jsonb_set(
                           jsonb_set(s, ARRAY['after', v_side || '_team_id'], to_jsonb(v_d), TRUE),
                           ARRAY['vacated_sides'], (s -> 'vacated_sides') || to_jsonb(v_side), TRUE)
                    ELSE s END)
        INTO v_sibs
      FROM jsonb_array_elements(v_sibs) s;
    ELSE
      v_sibs := v_sibs || jsonb_build_object(
        'matchup_id', v_sib.id,
        'vacated_sides', jsonb_build_array(v_side),
        'before', jsonb_build_object('home_team_id', v_sib.home_team_id, 'away_team_id', v_sib.away_team_id),
        'after',  jsonb_build_object(
                    'home_team_id', CASE WHEN v_side = 'home' THEN v_d ELSE v_sib.home_team_id END,
                    'away_team_id', CASE WHEN v_side = 'away' THEN v_d ELSE v_sib.away_team_id END));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_sibs) > 0 THEN
    -- The parking type must be EMPTY in this week (a regular-season week
    -- holds regular/secondary rows only; playoff-family rows live in playoff
    -- weeks — 116's). Asserted: a row there would make parking collide.
    IF EXISTS (SELECT 1 FROM public.matchups m
               WHERE m.league_id = p_league_id AND m.season = v_m.season
                 AND m.week = v_m.week AND m.round_type = 'third_place') THEN
      RAISE EXCEPTION
        'schedule_edit_matchup: week % of league % holds third_place rows — the edit''s parking step cannot use that game type; refusing (§11.7/§11.5)',
        v_m.week, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.matchups
    SET round_type = 'third_place'
    WHERE id IN (SELECT (s ->> 'matchup_id')::uuid FROM jsonb_array_elements(v_sibs) s);
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> jsonb_array_length(v_sibs) THEN
      RAISE EXCEPTION 'schedule_edit_matchup: parked % sibling rows, expected %', v_cnt, jsonb_array_length(v_sibs)
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The edited row (one UPDATE — a side flip is one row; its new teams are
  -- parked or already its own).
  UPDATE public.matchups
  SET home_team_id = p_home, away_team_id = p_away, updated_at = now()
  WHERE id = p_matchup_id;

  -- Each sibling returns to its game type with the displaced team seated.
  FOR v_sib IN
    SELECT m.* FROM public.matchups m
    WHERE m.id IN (SELECT (s ->> 'matchup_id')::uuid FROM jsonb_array_elements(v_sibs) s)
  LOOP
    UPDATE public.matchups
    SET round_type   = v_m.round_type,
        home_team_id = (s -> 'after' ->> 'home_team_id')::uuid,
        away_team_id = (s -> 'after' ->> 'away_team_id')::uuid,
        updated_at   = now()
    FROM jsonb_array_elements(v_sibs) s
    WHERE public.matchups.id = v_sib.id AND (s ->> 'matchup_id')::uuid = v_sib.id;
  END LOOP;

  -- IN-BODY RE-VALIDATION (task item 3). (a) Every seated franchise exactly
  -- once across home ∪ away in this (week, game type) — the cross-side pin
  -- (R703); the two unique indexes remain the race backstop.
  SELECT count(*)::int INTO v_n FROM public.teams t WHERE t.league_id = p_league_id AND t.status <> 'retired';
  SELECT count(*)::int INTO v_cnt
  FROM (
    SELECT app.team_id
    FROM (SELECT m.home_team_id AS team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week AND m.round_type = v_m.round_type
          UNION ALL
          SELECT m.away_team_id FROM public.matchups m
          WHERE m.league_id = p_league_id AND m.season = v_m.season AND m.week = v_m.week AND m.round_type = v_m.round_type) app
    GROUP BY app.team_id HAVING count(*) = 1
  ) once;
  IF v_cnt <> v_n THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: after the edit, week % (%) of league % does not seat every team exactly once (% of % teams appear exactly once) — refusing (§11.7 uniqueness)',
      v_m.week, v_m.round_type, p_league_id, v_cnt, v_n
      USING ERRCODE = 'P0001';
  END IF;
  -- (b) E40: no pair may appear in both game types that week.
  IF EXISTS (
    SELECT 1
    FROM public.matchups a
    JOIN public.matchups b
      ON b.league_id = a.league_id AND b.season = a.season AND b.week = a.week
     AND a.round_type = 'regular' AND b.round_type = 'secondary'
     AND least(a.home_team_id, a.away_team_id) = least(b.home_team_id, b.away_team_id)
     AND greatest(a.home_team_id, a.away_team_id) = greatest(b.home_team_id, b.away_team_id)
    WHERE a.league_id = p_league_id AND a.season = v_m.season AND a.week = v_m.week
  ) THEN
    RAISE EXCEPTION
      'schedule_edit_matchup: after the edit, week % of league % would pair the same two teams in both game types — a second game is never the primary opponent (E40)',
      v_m.week, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D97: the in-txn system post, before/after in the text.
  SELECT jsonb_object_agg(t.id::text, t.name) INTO v_names
  FROM public.teams t WHERE t.league_id = p_league_id;
  v_message := 'Week ' || v_m.week || CASE WHEN v_m.round_type = 'secondary' THEN ' (second game)' ELSE '' END
    || ' matchup edited by ' || public.draft_actor_name() || ': '
    || (v_names ->> p_home::text) || ' vs ' || (v_names ->> p_away::text)
    || ' (was ' || (v_names ->> v_old_home::text) || ' vs ' || (v_names ->> v_old_away::text) || ')'
    || COALESCE((SELECT '; ' || string_agg(
                   (v_names ->> (s -> 'after' ->> 'home_team_id')) || ' vs ' || (v_names ->> (s -> 'after' ->> 'away_team_id'))
                   || ' (was ' || (v_names ->> (s -> 'before' ->> 'home_team_id')) || ' vs '
                   || (v_names ->> (s -> 'before' ->> 'away_team_id')) || ')', '; ')
                 FROM jsonb_array_elements(v_sibs) s), '')
    || CASE WHEN v_free THEN '.'
            ELSE ' — after Week 1 kickoff (commissioner override)'
                 || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END END;  -- 131 / Q66: conditional
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

  v_result := jsonb_build_object(
    'league_id',      p_league_id,
    'season',         v_m.season,
    'action_id',      p_action_id,
    'week',           v_m.week,
    'round_type',     v_m.round_type,
    'matchup', jsonb_build_object(
      'matchup_id', v_m.id,
      'before', jsonb_build_object('home_team_id', v_old_home, 'away_team_id', v_old_away),
      'after',  jsonb_build_object('home_team_id', p_home, 'away_team_id', p_away)),
    'siblings',       v_sibs,
    'rows_changed',   1 + jsonb_array_length(v_sibs),
    'reason_required', FALSE,   -- 131 / Q66: the gate this field reported is gone (pgTAP 078 C12 "flips when the sweep lands"); kept for the panel (F361)
    'window', jsonb_build_object(
      'evaluated_at',     now(),
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'free',             v_free,
      'reason_required',  FALSE),  -- 131 / Q66: same
    'system_post',    v_message
  );

  -- ── migration 130 / L.E1.9 (D348, F339, F225; Q66 fix round 2026-09-16):
  -- THE RECEIPT — the ONE new hunk in this body. Spec v2.16.41 §10.3 /
  -- §15.4: every override WRITES commissioner_actions; a reason is OPTIONAL.
  -- The reason stored is 111's `v_reason` re-normalised in the explicit
  -- `E' \t\r\n'` class (F225's R745 hole; 130 §0's CHECK is the same class):
  -- absent or whitespace-only ⇒ NULL (never refused, never ''), otherwise
  -- trimmed and bounded at 500 by name. NO refusal for a missing reason
  -- here. 111's own post-kickoff gate above (111:952-957) and its post text
  -- (111:1123) are ORIGINAL lines outside this hunk and are F362's (the
  -- sweep) — see the banner. The no-op above (…"nothing to change") fires
  -- before this point and stays a refusal. The receipt's id is folded into
  -- `v_result` (so the ledger row and the replay carry it); `reason_required`
  -- is left as 111 computed it (`NOT v_free`), which is true as measured
  -- until the sweep removes that gate. No DECLARE change.
  IF v_reason IS NOT NULL AND char_length(btrim(v_reason, E' \t\r\n')) > 500 THEN
    RAISE EXCEPTION 'schedule_edit_matchup: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(btrim(v_reason, E' \t\r\n'))
      USING ERRCODE = '22023';
  END IF;
  v_result := v_result || jsonb_build_object(
    'commissioner_action_id', public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_schedule', 'schedule', p_matchup_id::text,
      NULLIF(btrim(COALESCE(v_reason, ''), E' \t\r\n'), ''),
      v_result -> 'matchup' -> 'before',
      v_result -> 'matchup' -> 'after',
      jsonb_build_object(
        'verb',              'schedule_edit_matchup',
        'season',            v_m.season,
        'action_id',         p_action_id,
        'week',              v_m.week,
        'week_status',       v_week_status,
        'matchup_status',    v_m.status,
        'round_type',        v_m.round_type,
        'affected_team_ids', (SELECT COALESCE(jsonb_agg(DISTINCT x.t), '[]'::jsonb) FROM (
                               SELECT unnest(ARRAY[v_old_home, v_old_away, p_home, p_away]) AS t
                               UNION SELECT (s -> 'before' ->> 'home_team_id')::uuid FROM jsonb_array_elements(v_sibs) s
                               UNION SELECT (s -> 'before' ->> 'away_team_id')::uuid FROM jsonb_array_elements(v_sibs) s) x),
        'bypassed',          '[]'::jsonb,     -- 111's verb lifts nothing; the lifted sibling is commish_edit_schedule
        'siblings',          v_sibs,
        'rows_changed',      1 + jsonb_array_length(v_sibs),
        'window',            v_result -> 'window'),
      NULL));
  IF v_result ->> 'commissioner_action_id' IS NULL THEN
    RAISE EXCEPTION 'schedule_edit_matchup: the audit row was not written — refusing to let the edit stand without its receipt (§10.3)'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.schedule_actions (league_id, action_id, kind, actor_id, result)
  VALUES (p_league_id, p_action_id, 'edit_matchup', auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. schedule_remix_confirm — CREATE OR REPLACE against 111:573-777's FILE TEXT (D137)
--    4 hunk(s). 111's Remix verb (newest definer = 111; F341's BOTH halves). Four diff hunks: gate → normalisation (explicit class); the park comment + the post clause conditional (adjacent lines, one hunk); `reason_required` → FALSE; and THE RECEIPT (F341's parked commissioner_actions row, 130's placement). pgTAP 078 L7/L8 red by design and are re-derived in this PR.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION schedule_remix_confirm(
  p_league_id UUID,
  p_seed      BIGINT,
  p_reason    TEXT DEFAULT NULL,
  p_action_id UUID DEFAULT NULL   -- REQUIRED in-body (the sketch's order kept; Postgres forbids a default before a non-default)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league   public.leagues;
  v_plan     JSONB;
  v_regen    INTEGER[];
  v_free     BOOLEAN;
  v_reason   TEXT;
  v_expected INTEGER;
  v_deleted  INTEGER;
  v_inserted INTEGER;
  v_cnt      INTEGER;
  v_result   JSONB;
  v_kind     TEXT;
  v_settings JSONB;
  v_message  TEXT;
BEGIN
  IF p_seed IS NULL OR p_seed < 0 OR p_seed > 2147483647 THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: seed % is outside the schedule seed space [0, 2147483647] (§11.7 / SCHEDULE_SEED_MAX)',
      p_seed
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: p_action_id is required (idempotency key — one UUID per confirm, reused on retry)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, tasks-M4 §4 rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) VALIDATE. One no-leak 42501 (069's shape).
  IF NOT FOUND OR NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'schedule_remix_confirm: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — no second regeneration, no second post.
  SELECT a.result, a.kind INTO v_result, v_kind
  FROM public.schedule_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    IF v_kind <> 'remix' THEN
      RAISE EXCEPTION
        'schedule_remix_confirm: action_id % was used by a % on this league — an action_id belongs to one verb (R732)',
        p_action_id, v_kind
        USING ERRCODE = '22023';
    END IF;
    RETURN v_result;
  END IF;

  IF v_league.status <> 'in_season' THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: league % is % — the regular-season schedule can be remixed only while in_season (§11.7)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- The plan — the SAME function the preview served (D289: confirm regenerates
  -- from the previewed seed in-body; a client-supplied schedule is never read).
  v_plan := public.schedule_remix_plan_internal(p_league_id, p_seed, now());
  SELECT COALESCE(array_agg(x::int), ARRAY[]::int[]) INTO v_regen
  FROM jsonb_array_elements_text(v_plan -> 'weeks_regenerable') x;
  IF COALESCE(array_length(v_regen, 1), 0) = 0 THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: league % has no regenerable week — every regular-season week is live, final or holds a non-scheduled matchup (weeks frozen: %); nothing to remix (§11.7: live/final weeks never regenerate)',
      p_league_id, v_plan -> 'weeks_frozen'
      USING ERRCODE = 'P0001';
  END IF;

  -- R731 (rule 10): a confirm that would change nothing — the current seed
  -- with no hand edits since — is refused by name, never a silent churn of
  -- every row id plus a "0 pairings changed" post. (The same seed AFTER an
  -- edit has change_count > 0 and is a legitimate undo — it passes.)
  IF (v_plan ->> 'no_changes')::boolean THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: seed % reproduces league %''s current schedule exactly — no changes to confirm (§11.7 "regenerates with a fresh seed"; preview said no_changes)',
      p_seed, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- E41 / D290, RE-READ UNDER Q66 (migration 131 / L.E1.15, F362 / F341;
  -- spec v2.16.41 §11.7 / E41): free until the first kickoff of league Week
  -- 1; after that an override — the reason is OPTIONAL either way. It is
  -- NORMALISED in the explicit E' \t\r\n' class (F225's R745 remainder,
  -- which this function carried): absent or whitespace-only ⇒ NULL, else
  -- trimmed; bounded at 500 by name at the receipt below.
  v_free := (v_plan -> 'window' ->> 'free')::boolean;
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');

  -- (3) WRITE. Replace the regenerable weeks' rows — ONLY `scheduled` rows
  -- (the plan classified the weeks so; the status predicate here makes the
  -- DELETE itself unable to reach a live/final row), counts asserted against
  -- the engine's arithmetic (weeks × n/2 pairings × game types): the rows
  -- being replaced must have that shape, and the rows written must too.
  v_expected := array_length(v_regen, 1) * ((v_plan ->> 'team_count')::int / 2)
                * (CASE WHEN (v_plan ->> 'second_opponent')::boolean THEN 2 ELSE 1 END);
  IF (v_plan ->> 'matchups_regenerable')::int <> v_expected THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: league % holds % matchup rows across its % regenerable weeks, expected % (% pairings × % game types per week) — the weeks are not the engine''s shape; refusing to regenerate over them',
      p_league_id, (v_plan ->> 'matchups_regenerable')::int, array_length(v_regen, 1), v_expected,
      (v_plan ->> 'team_count')::int / 2,
      CASE WHEN (v_plan ->> 'second_opponent')::boolean THEN 2 ELSE 1 END
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.matchups m
  WHERE m.league_id = p_league_id AND m.season = v_league.season
    AND m.round_type IN ('regular', 'secondary')
    AND m.week = ANY (v_regen)
    AND m.status = 'scheduled'
    AND NOT m.is_overridden AND m.result IS NULL
    AND COALESCE(m.home_score, 0) = 0 AND COALESCE(m.away_score, 0) = 0;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> v_expected THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: deleted % scheduled matchup rows for league %, expected % (the plan''s regenerable rows)',
      v_deleted, p_league_id, v_expected
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.matchups
    (league_id, season, week, round_type, home_team_id, away_team_id, status)
  SELECT p_league_id, v_league.season,
         (p ->> 'week')::int, p ->> 'round_type',
         (p ->> 'home_team_id')::uuid, (p ->> 'away_team_id')::uuid, 'scheduled'
  FROM jsonb_array_elements(v_plan -> 'proposed') p
  WHERE (p ->> 'regenerated')::boolean;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_expected THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: inserted % matchup rows for league %, expected % (the plan''s regenerable rows)',
      v_inserted, p_league_id, v_expected
      USING ERRCODE = 'P0001';
  END IF;

  -- RE-MINT: the confirmed seed becomes the league's schedule_seed (§11.7 —
  -- the schedule stays reproducible from the stored seed). Exactly 1 row.
  v_settings := COALESCE(v_league.settings, '{}'::jsonb);
  UPDATE public.leagues
  SET settings   = jsonb_set(v_settings, ARRAY['schedule_seed'], to_jsonb(p_seed), TRUE),
      updated_at = now()
  WHERE id = p_league_id;
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION
      'schedule_remix_confirm: the schedule_seed write-back touched % rows for league % (expected exactly 1)',
      v_cnt, p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D97: the non-disableable in-txn system post, the numbers in the text
  -- (§11.7 "auto-posts a system message to league chat"). The reason ALSO
  -- lives in the commissioner_actions receipt below since 131 (F341's park
  -- discharged); the clause is conditional — never "reason: <NULL>".
  v_message := 'Schedule remixed by ' || public.draft_actor_name() || ': '
    || array_length(v_regen, 1) || ' of ' || v_league.regular_season_weeks
    || ' regular-season weeks regenerated (weeks '
    || (SELECT string_agg(x::text, ', ' ORDER BY x) FROM unnest(v_regen) x)
    || '), ' || (v_plan ->> 'change_count') || ' team-week pairings changed'
    || CASE WHEN v_free THEN '.'
            ELSE ' — after Week 1 kickoff (commissioner override)'
                 || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END END;  -- 131 / Q66: conditional
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);

  v_result := jsonb_build_object(
    'league_id',            p_league_id,
    'season',               v_league.season,
    'action_id',            p_action_id,
    'schedule_seed',        p_seed,
    'previous_seed',        (v_settings ->> 'schedule_seed')::bigint,
    'first_week',           v_plan -> 'first_week',
    'regular_season_weeks', v_league.regular_season_weeks,
    'window',               v_plan -> 'window',
    'reason_required',      FALSE,   -- 131 / Q66: the gate this field reported is gone; kept for the panel (F361)
    'weeks_regenerated',    v_plan -> 'weeks_regenerable',
    'weeks_frozen',         v_plan -> 'weeks_frozen',
    'matchups_replaced',    v_inserted,
    'change_count',         v_plan -> 'change_count',
    'no_changes',           v_plan -> 'no_changes',
    'diff',                 v_plan -> 'diff',
    'system_post',          v_message
  );

  -- ── migration 131 / L.E1.15 (F341's parked receipt, D336 part 2, §10.3,
  -- §15.4): THE RECEIPT. Placed exactly where 130 put schedule_edit_matchup's
  -- — after the in-txn post, with v_result built, before the schedule_actions
  -- ledger row (so the ledger and the replay carry the receipt's id). A remix
  -- is a real change by construction: the no-op plan was refused above
  -- (R731), so the receipt is written on every path that reaches here —
  -- standing rule (b) holds with no separate guard. `affected_team_ids` is
  -- every seated franchise (a remix re-pairs the whole regular season; D353's
  -- feed filter needs the list, not the word "all"). Reason NULL when none
  -- was given (130 §0); bounded at 500 by name (the league_chat bound).
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'schedule_remix_confirm: the reason is % characters — at most 500 (the league_chat bound; §12.13)', char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;
  v_result := v_result || jsonb_build_object(
    'commissioner_action_id', public.log_commissioner_action_internal(
      p_league_id, auth.uid(), 'edit_schedule', 'schedule', p_league_id::text,
      v_reason,
      jsonb_build_object('schedule_seed', (v_settings ->> 'schedule_seed')::bigint),
      jsonb_build_object('schedule_seed', p_seed),
      jsonb_build_object(
        'verb',                 'schedule_remix_confirm',
        'season',               v_league.season,
        'action_id',            p_action_id,
        'weeks_regenerated',    v_plan -> 'weeks_regenerable',
        'weeks_frozen',         v_plan -> 'weeks_frozen',
        'matchups_replaced',    v_inserted,
        'change_count',         v_plan -> 'change_count',
        'affected_team_ids',    (SELECT COALESCE(jsonb_agg(t.id ORDER BY t.id), '[]'::jsonb)
                                 FROM public.teams t
                                 WHERE t.league_id = p_league_id AND t.status <> 'retired'),
        'bypassed',             '[]'::jsonb,
        'window',               v_plan -> 'window'),
      NULL));
  IF v_result ->> 'commissioner_action_id' IS NULL THEN
    RAISE EXCEPTION 'schedule_remix_confirm: the audit row was not written — refusing to let the remix stand without its receipt (§10.3)'
      USING ERRCODE = 'P0001';
  END IF;

  -- The ledger row (the league lock serializes the normal path; the UNIQUE is
  -- the race backstop).
  INSERT INTO public.schedule_actions (league_id, action_id, kind, actor_id, result)
  VALUES (p_league_id, p_action_id, 'remix', auth.uid(), v_result);

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. set_lineup_internal — CREATE OR REPLACE against 114:153-753's FILE TEXT (D137)
--    2 hunk(s). set_lineup's commissioner arm as 114 last defined it (D137: newest definer = 114, not 112; the DEFINER wrapper set_lineup at 112:1221 is untouched). Two hunks. The manager arm is byte-untouched: 071 §I's never-weaken pins on set_lineup stay green.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_lineup_internal(
  p_league_id UUID,
  p_team_id   UUID,
  p_week      INTEGER,
  p_slot_map  JSONB,
  p_action_id UUID,
  p_at        TIMESTAMPTZ,
  p_reason    TEXT DEFAULT NULL   -- REQUIRED (non-blank) when the actor is not the team's manager (R738 / D290)
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league      public.leagues;
  v_team        public.teams;
  v_row         public.team_lineups;
  v_lw          public.league_weeks;
  v_found       BOOLEAN;
  v_is_manager  BOOLEAN;
  v_is_commish  BOOLEAN;
  v_result      JSONB;
  v_current     INTEGER;
  v_allow       BOOLEAN;
  v_roster      JSONB;
  v_slots       JSONB;
  v_ir_spots    JSONB;
  v_stored      JSONB;
  v_key         TEXT;
  v_val         JSONB;
  v_pid         TEXT;
  v_e           JSONB;
  v_p           JSONB;
  v_seen        JSONB := '{}'::jsonb;
  v_by_pid      JSONB := '{}'::jsonb;   -- player_id → roster element
  v_kick        JSONB := '{}'::jsonb;   -- player_id → {kickoff_at, datum_arm, on_bye} for p_week
  v_kick_cur    JSONB := '{}'::jsonb;   -- the same for the CURRENT week (IR moves)
  v_window      RECORD;
  v_window_cur  RECORD;   -- the CURRENT week's datum (IR moves are judged against it — R736)
  v_k           RECORD;
  v_reason      TEXT;
  v_message     TEXT;
  v_fit_players JSONB := '[]'::jsonb;
  v_fit         JSONB;
  v_canon       JSONB := '{}'::jsonb;
  v_starters    JSONB := '[]'::jsonb;
  v_bench       JSONB := '[]'::jsonb;
  v_ir_out      JSONB := '[]'::jsonb;
  v_flags_bye   JSONB := '[]'::jsonb;
  v_flags_out   JSONB := '[]'::jsonb;
  v_flags_empty JSONB := '[]'::jsonb;
  v_flags_irin  JSONB := '[]'::jsonb;
  v_ir_placed   JSONB := '[]'::jsonb;
  v_ir_removed  JSONB := '[]'::jsonb;
  v_pflags      JSONB;
  v_locked_at   TIMESTAMPTZ;
  v_no_changes  BOOLEAN;
  v_cnt         INTEGER;
  v_expected    INTEGER;
  v_spot        JSONB;
  v_started     TEXT[] := ARRAY[]::text[];
  v_ir_now      TEXT[] := ARRAY[]::text[];  -- player ids under an IR key in the submitted map
  v_stored_at   TEXT;
  v_locked      BOOLEAN;
  v_min_weeks   INTEGER;
  v_msg         TEXT;
BEGIN
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: p_action_id is required (idempotency key — one UUID per submit, reused on retry)'
      USING ERRCODE = '22023';
  END IF;
  IF p_slot_map IS NULL OR jsonb_typeof(p_slot_map) <> 'object' THEN
    RAISE EXCEPTION
      'set_lineup: p_slot_map must be a JSON object of "<slot_key>:<index>" → player_id (§12.13); got %',
      COALESCE(jsonb_typeof(p_slot_map), 'null')
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the league row FIRST (the house lock order, rule 8).
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;

  -- (2) AUTH, in-body (F35: league_members' cache column, never a stint).
  --     One no-leak 42501 for "no such league", "not a member", "not this
  --     team's manager and not a commissioner".
  v_found := FOUND;
  v_is_manager := v_found AND EXISTS (
    SELECT 1 FROM public.league_members m
    WHERE m.league_id = p_league_id AND m.user_id = auth.uid() AND m.team_id = p_team_id);
  v_is_commish := v_found AND public.is_league_commish(p_league_id);
  IF NOT v_found OR NOT (v_is_manager OR v_is_commish) THEN
    RAISE EXCEPTION 'set_lineup: not a manager of this team'
      USING ERRCODE = '42501';
  END IF;

  -- REPLAY (099/E2): the same action_id returns the stored result, byte-
  -- identically — nothing re-evaluated, nothing written.
  SELECT a.result INTO v_result
  FROM public.lineup_actions a
  WHERE a.league_id = p_league_id AND a.action_id = p_action_id;
  IF FOUND THEN
    RETURN v_result;
  END IF;

  IF v_league.status NOT IN ('in_season', 'playoffs') THEN
    RAISE EXCEPTION
      'set_lineup: league % is % — lineups are set only while in_season or in playoffs (§11.2)',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = p_team_id;
  IF NOT FOUND OR v_team.league_id IS DISTINCT FROM p_league_id THEN
    RAISE EXCEPTION 'set_lineup: team % is not a franchise of league %', p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_team.status = 'retired' THEN
    RAISE EXCEPTION 'set_lineup: team % is retired — a sealed franchise has no lineup to set (§7.2.1)', p_team_id
      USING ERRCODE = 'P0001';
  END IF;

  v_current := public.lineup_current_week_internal(p_league_id, p_at);
  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'set_lineup: league % has no league_weeks rows — no season calendar to set a lineup against (§12.17)',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  SELECT lw.* INTO v_lw
  FROM public.league_weeks lw
  WHERE lw.league_id = p_league_id AND lw.season = v_league.season AND lw.week = p_week;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'set_lineup: week % is not on league %''s calendar (season %; league_weeks holds weeks %–%)',
      p_week, p_league_id, v_league.season,
      (SELECT min(week) FROM public.league_weeks WHERE league_id = p_league_id),
      (SELECT max(week) FROM public.league_weeks WHERE league_id = p_league_id)
      USING ERRCODE = 'P0001';
  END IF;
  IF p_week < v_current THEN
    RAISE EXCEPTION
      'set_lineup: week % is in the past (the current week is %) — a past week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, v_current
      USING ERRCODE = 'P0001';
  END IF;
  IF v_lw.status IN ('correction_window', 'final') THEN
    RAISE EXCEPTION
      'set_lineup: week % of league % is % — a closed week''s lineup changes only through the audited commissioner override (§11.2, M6)',
      p_week, p_league_id, v_lw.status
      USING ERRCODE = 'P0001';
  END IF;

  v_allow := COALESCE((v_league.settings ->> 'allow_illegal_lineups')::boolean, TRUE);

  -- The COMMISSIONER ARM carries the D290 interim audit posture (R738 / F40):
  -- a real change by an actor who is not this team's manager posts the
  -- in-txn system message below. RE-READ UNDER Q66 (migration 131 / L.E1.15,
  -- F362; spec v2.16.41 §10.3 / §15.4 — a commissioner setting another
  -- team's lineup IS a commissioner action): the reason is OPTIONAL, so it is
  -- NORMALISED here and never refused. Blank = nothing but whitespace
  -- INCLUDING tabs/newlines (R745) ⇒ NULL; bounded at 500 characters below,
  -- the client chat policy's own bound, so the system post stays bounded
  -- (R746) — that check is NULL-safe as written.
  v_reason := NULLIF(btrim(COALESCE(p_reason, ''), E' \t\r\n'), '');
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION
      'set_lineup: the reason is % characters — at most 500 (the league_chat bound; §12.13)',
      char_length(v_reason)
      USING ERRCODE = '22023';
  END IF;

  -- (3) THE ROSTER (positions normalized to the roster vocabulary — DEF → DST,
  --     the 086 shape; designations bridged).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id',          r.player_id,
           'name',               p.full_name,
           'position',           CASE WHEN p.position = 'DEF' THEN 'DST' ELSE p.position END,
           'designation',        public.lineup_designation_internal(p.status),
           'nfl_team',           p.team,
           'ir_placed_week',     r.ir_placed_week,
           'ir_lock_until_week', r.ir_lock_until_week,
           'slot_key',           r.slot_key) ORDER BY r.player_id), '[]'::jsonb)
  INTO v_roster
  FROM public.league_rosters r
  JOIN public.players p ON p.id = r.player_id
  WHERE r.league_id = p_league_id AND r.team_id = p_team_id;
  IF jsonb_array_length(v_roster) = 0 THEN
    RAISE EXCEPTION
      'set_lineup: team % has no rostered players in league % — a lineup exists only over a roster (§11.1)',
      p_team_id, p_league_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    v_by_pid := v_by_pid || jsonb_build_object(v_e ->> 'player_id', v_e);
  END LOOP;

  -- Slot instances in canonical order + IR spots.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',      (s ->> 'key') || ':' || i,
           'slot',     s ->> 'key',
           'label',    s ->> 'label',
           'eligible', s -> 'eligible') ORDER BY ord, i), '[]'::jsonb)
  INTO v_slots
  FROM jsonb_array_elements(v_league.roster_settings -> 'starting_slots') WITH ORDINALITY AS t(s, ord),
       LATERAL generate_series(0, COALESCE((s ->> 'count')::int, 0) - 1) i;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key',          (s ->> 'key') || ':0',
           'spot',         s ->> 'key',
           'type',         s ->> 'type',
           'designations', s -> 'eligible_designations',
           'min_weeks',    (s ->> 'min_weeks')::int) ORDER BY ord), '[]'::jsonb)
  INTO v_ir_spots
  FROM jsonb_array_elements(COALESCE(v_league.roster_settings -> 'ir_slots', '[]'::jsonb)) WITH ORDINALITY AS t(s, ord);

  -- (4) THE LINEUP ROW — created on first touch, then locked (rule 8: after
  --     the league row). Loud emptiness: FOUND is asserted.
  INSERT INTO public.team_lineups (team_id, season, week, starters, bench)
  VALUES (p_team_id, v_league.season, p_week, '[]'::jsonb, '[]'::jsonb)
  ON CONFLICT (team_id, season, week) DO NOTHING;
  SELECT tl.* INTO v_row
  FROM public.team_lineups tl
  WHERE tl.team_id = p_team_id AND tl.season = v_league.season AND tl.week = p_week
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_lineup: no lineup row for team % season % week % after create — refusing to continue',
      p_team_id, v_league.season, p_week
      USING ERRCODE = 'P0001';
  END IF;
  v_stored := COALESCE(v_row.slot_map, '{}'::jsonb);

  -- (5) VALIDATE THE SUBMITTED MAP: keys are slot instances or IR spots,
  --     values are this team's rostered players, each player exactly once.
  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
    IF jsonb_typeof(v_val) <> 'string' THEN
      RAISE EXCEPTION 'set_lineup: slot % must map to a player_id string (§12.13); got %', v_key, jsonb_typeof(v_val)
        USING ERRCODE = '22023';
    END IF;
    v_pid := v_val #>> '{}';
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      RAISE EXCEPTION
        'set_lineup: "%" is not a slot of league %''s roster (§7.3.2 starting_slots: %; IR spots: %)',
        v_key, p_league_id,
        (SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_slots) s),
        COALESCE((SELECT string_agg(s ->> 'key', ', ') FROM jsonb_array_elements(v_ir_spots) s), 'none')
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_by_pid ? v_pid) THEN
      RAISE EXCEPTION 'set_lineup: player % is not on team %''s roster in league % (§11.1)', v_pid, p_team_id, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    IF v_seen ? v_pid THEN
      RAISE EXCEPTION
        'set_lineup: % (%) appears at both "%" and "%" — each player fills exactly one slot (E16)',
        v_by_pid -> v_pid ->> 'name', v_pid, v_seen ->> v_pid, v_key
        USING ERRCODE = 'P0001';
    END IF;
    v_seen := v_seen || jsonb_build_object(v_pid, v_key);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key) THEN
      v_ir_now := v_ir_now || v_pid;
      v_canon := v_canon || jsonb_build_object(v_key, v_pid);
    ELSE
      v_started := v_started || v_pid;
    END IF;
  END LOOP;

  -- (6) KICKOFF DATA, read NOW from nfl_games (E42/§23.3) — for p_week (the
  --     starters) and for the current week (IR moves) when they differ.
  SELECT * INTO v_window FROM public.schedule_window_internal(v_league.season, p_week, p_at);
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, p_week, v_e ->> 'nfl_team', p_at);
    v_kick := v_kick || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
      'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    IF v_current <> p_week THEN
      SELECT * INTO v_k FROM public.lineup_kickoff_internal(v_league.season, v_current, v_e ->> 'nfl_team', p_at);
      v_kick_cur := v_kick_cur || jsonb_build_object(v_e ->> 'player_id', jsonb_build_object(
        'kickoff_at', v_k.kickoff_at, 'datum_arm', v_k.datum_arm, 'on_bye', v_k.on_bye));
    END IF;
  END LOOP;
  IF v_current = p_week THEN
    v_kick_cur := v_kick;
    v_window_cur := v_window;
  ELSE
    SELECT * INTO v_window_cur FROM public.schedule_window_internal(v_league.season, v_current, p_at);
  END IF;

  -- (7) LOCKED PLAYERS NEVER MOVE (per_player_kickoff — the ONLY lineup lock,
  --     Q34(A)). Evaluated BEFORE the fit so a locked stored starter is a
  --     FIXED vertex, and a played player can neither enter nor change slots.
  --     114: the mode test that used to guard this block is gone — it is
  --     unconditional.
    -- (a) every stored starter whose game has kicked off must sit at the
    --     same key in the submitted map.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(v_stored) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN NOT (v_by_pid ? v_pid);                       -- dropped since (113) — nothing to lock
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (p_slot_map ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: slot % is locked — % kicked off at % (%) and a locked slot''s player never moves (§11.2, lineup_lock = per_player_kickoff); every other unlocked slot stays editable',
          v_key, v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm'
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    -- (b) a player whose game has kicked off never enters a slot he was not
    --     already stored at.
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_slot_map) LOOP
      v_pid := v_val #>> '{}';
      CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = v_key);
      v_locked := (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at;
      IF v_locked AND (v_stored ->> v_key) IS DISTINCT FROM v_pid THEN
        RAISE EXCEPTION
          'set_lineup: %''s game kicked off at % (%) — a player whose game has started cannot enter or move slots (§11.2, lineup_lock = per_player_kickoff); wanted "%"',
          v_by_pid -> v_pid ->> 'name', v_kick -> v_pid ->> 'kickoff_at', v_kick -> v_pid ->> 'datum_arm', v_key
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

  -- (8) THE FIT (E16). Input order: fixed (locked) players first, then the
  --     rest in submitted-key order — deterministic.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'player_id', v_by_pid -> x.pid ->> 'player_id',
           'position',  v_by_pid -> x.pid ->> 'position',
           'wanted',    x.key,
           'fixed',     x.fixed) ORDER BY x.fixed DESC, x.ord), '[]'::jsonb)
  INTO v_fit_players
  FROM (
    SELECT e.key, e.value #>> '{}' AS pid, e.ord,
           -- fixed = locked: the player's OWN kickoff has passed (R737 — a
           -- locked placement is a fact; 114: the whole-week arm is gone).
           ((v_kick -> (e.value #>> '{}') ->> 'kickoff_at') IS NOT NULL
            AND (v_kick -> (e.value #>> '{}') ->> 'kickoff_at')::timestamptz <= p_at) AS fixed
    FROM jsonb_each(p_slot_map) WITH ORDINALITY AS e(key, value, ord)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_spots) s WHERE s ->> 'key' = e.key)
  ) x;
  v_fit := public.lineup_fit_internal(v_slots, v_fit_players);
  IF jsonb_array_length(v_fit -> 'unplaced') > 0 THEN
    v_pid := v_fit -> 'unplaced' ->> 0;
    v_key := v_seen ->> v_pid;
    RAISE EXCEPTION
      'set_lineup: % (%) cannot be placed — no legal arrangement of the started players fills the slots (E16): "%" accepts % and every slot % could take is held by a player with nowhere else to go (unplaced: %)',
      v_by_pid -> v_pid ->> 'name', v_by_pid -> v_pid ->> 'position', v_key,
      (SELECT string_agg(x #>> '{}', '/') FROM jsonb_array_elements((SELECT s -> 'eligible' FROM jsonb_array_elements(v_slots) s WHERE s ->> 'key' = v_key)) x),
      v_by_pid -> v_pid ->> 'name',
      v_fit -> 'unplaced'
      USING ERRCODE = 'P0001';
  END IF;
  v_canon := v_canon || (v_fit -> 'assignment');

  -- 114 (Q34(A)): the whole-week refusal that stood here is RETIRED. After the
  -- week's first kickoff every UNLOCKED slot of the lineup stays editable;
  -- only a slot whose own player has kicked off is closed (step 7).

  -- (9) IR MOVES, against the CURRENT week (banner: IR LAW).
  --     Placements: under an IR key now, not on IR (or on a different spot) before.
  FOR v_spot IN SELECT * FROM jsonb_array_elements(v_ir_spots) LOOP
    v_pid := v_canon ->> (v_spot ->> 'key');
    CONTINUE WHEN v_pid IS NULL;
    v_e := v_by_pid -> v_pid;
    IF (v_e ->> 'ir_placed_week') IS NULL OR (v_e ->> 'slot_key') IS DISTINCT FROM (v_spot ->> 'key') THEN
      -- a NEW placement (or a spot change, which is removal + placement)
      IF (v_e ->> 'ir_placed_week') IS NOT NULL AND (v_e ->> 'ir_lock_until_week') IS NOT NULL
         AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
        RAISE EXCEPTION
          'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
          v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
        RAISE EXCEPTION
          'set_lineup: % holds designation % — IR spot % accepts only % (§7.3.2 IR slot rules)',
          v_e ->> 'name', COALESCE(v_e ->> 'designation', 'none'), v_spot ->> 'spot',
          (SELECT string_agg(x #>> '{}', ', ') FROM jsonb_array_elements(v_spot -> 'designations') x)
          USING ERRCODE = 'P0001';
      END IF;
      IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
         AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
        RAISE EXCEPTION
          'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
          v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
          USING ERRCODE = 'P0001';
      END IF;
      v_ir_placed := v_ir_placed || jsonb_build_object(
        'player_id', v_pid, 'spot', v_spot ->> 'key', 'type', v_spot ->> 'type',
        'ir_placed_week', v_current,
        'ir_lock_until_week', CASE WHEN v_spot ->> 'type' = 'restricted'
                                   THEN v_current + COALESCE((v_spot ->> 'min_weeks')::int, 4) END);
    ELSIF (v_e ->> 'designation') IS NULL OR NOT ((v_spot -> 'designations') ? (v_e ->> 'designation')) THEN
      v_flags_irin := v_flags_irin || to_jsonb(v_pid);
    END IF;
    v_ir_out := v_ir_out || jsonb_build_object(
      'slot', v_spot ->> 'key', 'player_id', v_pid, 'position', v_e ->> 'position',
      'designation', v_e ->> 'designation',
      'ir_placed_week', COALESCE((SELECT (x ->> 'ir_placed_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid), (v_e ->> 'ir_placed_week')::int),
      'ir_lock_until_week', CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 THEN (SELECT (x ->> 'ir_lock_until_week')::int FROM jsonb_array_elements(v_ir_placed) x WHERE x ->> 'player_id' = v_pid)
                                 ELSE (v_e ->> 'ir_lock_until_week')::int END,
      'flags', CASE WHEN v_flags_irin ? v_pid THEN '["ir_ineligible"]'::jsonb ELSE '[]'::jsonb END);
  END LOOP;
  --     Removals: on IR before, not under any IR key now.
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_roster) LOOP
    CONTINUE WHEN (v_e ->> 'ir_placed_week') IS NULL;
    v_pid := v_e ->> 'player_id';
    CONTINUE WHEN v_pid = ANY (v_ir_now);
    IF (v_e ->> 'ir_lock_until_week') IS NOT NULL AND v_current < (v_e ->> 'ir_lock_until_week')::int THEN
      RAISE EXCEPTION
        'set_lineup: % entered restricted IR spot % in week % and may not leave it before week % (min_weeks stint, §11.2/§7.3.2) — the current week is %; commissioner override is M6''s',
        v_e ->> 'name', v_e ->> 'slot_key', v_e ->> 'ir_placed_week', v_e ->> 'ir_lock_until_week', v_current
        USING ERRCODE = 'P0001';
    END IF;
    IF (v_kick_cur -> v_pid ->> 'kickoff_at') IS NOT NULL
       AND (v_kick_cur -> v_pid ->> 'kickoff_at')::timestamptz <= p_at THEN
      RAISE EXCEPTION
        'set_lineup: %''s lock for week % has passed (kickoff %) — IR moves respect lineup-lock timing (§7.3.2)',
        v_e ->> 'name', v_current, v_kick_cur -> v_pid ->> 'kickoff_at'
        USING ERRCODE = 'P0001';
    END IF;
    v_ir_removed := v_ir_removed || jsonb_build_object('player_id', v_pid, 'spot', v_e ->> 'slot_key');
  END LOOP;

  -- (10) STARTERS (derived render state) + flags; bench = roster − starters − IR.
  v_locked_at := NULL;   -- 114: the earliest STARTED player's kickoff (below), never a week datum
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_slots) LOOP
    v_key := v_e ->> 'key';
    v_pid := v_canon ->> v_key;
    v_pflags := '[]'::jsonb;
    IF v_pid IS NULL THEN
      v_pflags := v_pflags || '"empty"'::jsonb;
      v_flags_empty := v_flags_empty || to_jsonb(v_key);
    ELSE
      v_p := v_by_pid -> v_pid;
      IF (v_kick -> v_pid ->> 'on_bye')::boolean THEN
        v_pflags := v_pflags || '"bye"'::jsonb;
        v_flags_bye := v_flags_bye || to_jsonb(v_pid);
      END IF;
      IF (v_p ->> 'designation') IN ('OUT', 'IR', 'PUP', 'NFI', 'Suspended') THEN
        v_pflags := v_pflags || '"out"'::jsonb;
        v_flags_out := v_flags_out || to_jsonb(v_pid);
      END IF;
      IF (v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL THEN
        v_locked_at := LEAST(v_locked_at, (v_kick -> v_pid ->> 'kickoff_at')::timestamptz);
      END IF;
      -- §7.3.6 allow_illegal_lineups = FALSE: a bye/OUT starter in an
      -- UNLOCKED slot blocks the submit by name.
      -- (a locked slot's bye/OUT player is not the manager's to change:
      --  exempt when the stored player's own game has kicked off, R739.)
      IF NOT v_allow AND jsonb_array_length(v_pflags) > 0
         AND NOT ((v_kick -> v_pid ->> 'kickoff_at') IS NOT NULL
                  AND (v_kick -> v_pid ->> 'kickoff_at')::timestamptz <= p_at
                  AND (v_stored ->> v_key) = v_pid) THEN
        RAISE EXCEPTION
          'set_lineup: % is % for week % and allow_illegal_lineups is off — slot "%" is blocked at submit (§7.3.6); bench him or start someone who plays',
          v_p ->> 'name', CASE WHEN v_pflags ? 'bye' THEN 'on bye' ELSE 'OUT (' || (v_p ->> 'designation') || ')' END,
          p_week, v_key
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_starters := v_starters || jsonb_build_object(
      'slot', v_key, 'slot_key', v_e ->> 'slot', 'label', v_e ->> 'label',
      'player_id', v_pid,
      'position', CASE WHEN v_pid IS NULL THEN NULL ELSE v_by_pid -> v_pid ->> 'position' END,
      'kickoff_at', CASE WHEN v_pid IS NULL THEN NULL ELSE v_kick -> v_pid ->> 'kickoff_at' END,
      'flags', v_pflags);
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(e ->> 'player_id') ORDER BY e ->> 'player_id'), '[]'::jsonb)
  INTO v_bench
  FROM jsonb_array_elements(v_roster) e
  WHERE NOT ((e ->> 'player_id') = ANY (v_started))
    AND NOT ((e ->> 'player_id') = ANY (v_ir_now));

  -- (11) NO-OP BY NAME (rule 10): the canonical map equals the stored map
  --      and no IR move — nothing is written but the ledger row.
  v_no_changes := (v_canon = v_stored)
                  AND jsonb_array_length(v_ir_placed) = 0
                  AND jsonb_array_length(v_ir_removed) = 0;

  IF NOT v_no_changes THEN
    -- (12) WRITE — the lineup row, then the roster's slot_key/IR columns.
    UPDATE public.team_lineups
    SET slot_map          = v_canon,
        starters          = v_starters,
        bench             = v_bench,
        locked_at         = v_locked_at,
        edited_by_commish = NOT v_is_manager,
        set_at            = now()
    WHERE id = v_row.id;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'set_lineup: updated % lineup rows for team % week %, expected 1', v_cnt, p_team_id, p_week
        USING ERRCODE = 'P0001';
    END IF;

    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_placed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week     = (v_e ->> 'ir_placed_week')::int,
          ir_lock_until_week = (v_e ->> 'ir_lock_until_week')::int,
          slot_key           = v_e ->> 'spot'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR placement of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    FOR v_e IN SELECT * FROM jsonb_array_elements(v_ir_removed) LOOP
      UPDATE public.league_rosters r
      SET ir_placed_week = NULL, ir_lock_until_week = NULL, slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = v_e ->> 'player_id';
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> 1 THEN
        RAISE EXCEPTION 'set_lineup: IR removal of % touched % roster rows, expected 1', v_e ->> 'player_id', v_cnt
          USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- R738 / D290 / D97: a commissioner's change posts in-txn, reason in the
    -- text (the interim audit until commissioner_actions exists — F40).
    IF NOT v_is_manager THEN
      v_message := 'Week ' || p_week || ' lineup for ' || v_team.name || ' set by '
        || public.draft_actor_name() || ' (commissioner)'
        || CASE WHEN v_reason IS NOT NULL THEN ' — reason: ' || v_reason ELSE '' END;  -- 131 / Q66: conditional
      INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
      VALUES (p_league_id, auth.uid(), v_message, 'league', TRUE);
    END IF;

    IF p_week = v_current THEN
      -- slot_key describes the ACTIVE week: starters → instance key, the rest
      -- (not on IR) → 'bn'. Counts asserted against the roster.
      v_expected := 0;
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_fit -> 'assignment') LOOP
        UPDATE public.league_rosters r SET slot_key = v_key
        WHERE r.league_id = p_league_id AND r.team_id = p_team_id AND r.player_id = (v_val #>> '{}');
        GET DIAGNOSTICS v_cnt = ROW_COUNT;
        v_expected := v_expected + v_cnt;
      END LOOP;
      IF v_expected <> COALESCE(array_length(v_started, 1), 0) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key for % starters, expected %', v_expected, COALESCE(array_length(v_started, 1), 0)
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.league_rosters r SET slot_key = 'bn'
      WHERE r.league_id = p_league_id AND r.team_id = p_team_id
        AND r.player_id = ANY (SELECT x #>> '{}' FROM jsonb_array_elements(v_bench) x);
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      IF v_cnt <> jsonb_array_length(v_bench) THEN
        RAISE EXCEPTION 'set_lineup: wrote slot_key = bn for % players, expected %', v_cnt, jsonb_array_length(v_bench)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'league_id',              p_league_id,
    'team_id',                p_team_id,
    'season',                 v_league.season,
    'week',                   p_week,
    'current_week',           v_current,
    'action_id',              p_action_id,
    'lineup_lock',            v_league.lineup_lock,   -- 114: the CHECK-constrained column value (only 'per_player_kickoff' exists)
    'allow_illegal_lineups',  v_allow,
    'no_changes',             v_no_changes,
    'rearranged',             (v_fit ->> 'rearranged')::boolean,
    'moved',                  v_fit -> 'moved',
    'slot_map',               v_canon,
    'starters',               v_starters,
    'bench',                  v_bench,
    'ir',                     v_ir_out,
    'ir_moves',               jsonb_build_object('placed', v_ir_placed, 'removed', v_ir_removed),
    'flags', jsonb_build_object(
      'illegal',       jsonb_array_length(v_flags_bye) + jsonb_array_length(v_flags_out) + jsonb_array_length(v_flags_irin) > 0,
      'bye',           v_flags_bye,
      'out',           v_flags_out,
      'empty',         v_flags_empty,
      'ir_ineligible', v_flags_irin),
    'locked_at',              v_locked_at,
    'edited_by_commish',      NOT v_is_manager,
    'reason',                 v_reason,
    'system_post',            v_message,
    'evaluated_at',           p_at,
    'week_datum', jsonb_build_object(
      'first_kickoff_at', v_window.first_kickoff_at,
      'datum_arm',        v_window.datum_arm,
      'kicked_off',       NOT v_window.free),
    'current_week_datum', jsonb_build_object(
      'first_kickoff_at', v_window_cur.first_kickoff_at,
      'datum_arm',        v_window_cur.datum_arm,
      'kicked_off',       NOT v_window_cur.free)
  );

  INSERT INTO public.lineup_actions (league_id, team_id, action_id, actor_id, result)
  VALUES (p_league_id, p_team_id, p_action_id, auth.uid(), v_result);

  RETURN v_result;
END;
$$;
