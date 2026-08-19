-- ============================================================================
-- Snake pause-first alignment — migration 090 (task L.C1.8)
--
-- Spec: §8.7 (v2.12.5 — the F57 ALIGN erratum folded in this PR: pause-first
-- applies to EVERY draft type; the snake extend-current clause retired), §17.
-- Ruling: **F57 RULED 2026-08-18 (Chris, in-session): ALIGN — pause-first
-- everywhere.** His framing (PROGRESS §6 F57, verbatim there): one mental
-- model — the command bar's Pause button is the universal door to
-- commissioner edits for both draft types; with the DR.2 bar, pause and
-- resume are each one click, so the interruption cost is small, and aligning
-- closes the live-edit race class in snake for free.
-- Decisions: D141 (the ONE in-body gate — its scope now type-neutral),
-- D137 (CREATE OR REPLACE authored against the chain HEAD), D146
-- (one-unit-false pins — the paused-side twins in 036 §C), D97 (system
-- posts unchanged), and the new D177 (PROGRESS §4, this PR's mechanics).
-- Flips the 036 §C snake-side divergence pins and re-stages pgTAP 023/026
-- and the two snake wire suites in the same PR.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 1 — WHY 090 (the number, confirmed at build time).
-- ---------------------------------------------------------------------------
-- tasks-M3 §7:360 reserves 088 (L.C1.6 auction realtime) and 089 (L.C1.7
-- mock auctions) whether or not they have landed — neither has (the chain
-- head is 087, verified by ls at build time). The SE track's D166 numbers
-- its own migrations "above both bands, expected 090/091/092 — expected,
-- never promised", and explicitly names this task's floating "088+
-- next-free" claim as a legal earlier claimant of 090. So 090 is the next
-- genuinely free number: 088/089 are reserved, nothing above 087 exists,
-- and SE re-confirms ITS next-free at its own build time (D161 grep rule).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2 — D137 HEAD-RULE PROVENANCE, PER FUNCTION.
-- ---------------------------------------------------------------------------
-- All five bodies below were authored against the CURRENT FILE TEXT of
-- migration 087 — the newest migration defining each (headship established
-- by `grep -ln 'FUNCTION <name>' supabase/migrations/*.sql`: each name hits
-- 069 and 087 only, except the helper which exists only in 087; 087 is the
-- newest in every case). Never `pg_get_functiondef`, never the deployed
-- body (the CLAUDE.md 073 lesson).
--   draft_auction_pause_gate_internal  ← 087:270–289   (only definition)
--   draft_set_clock                    ← 087:1069–1271 (087 replaced 069's)
--   draft_undo                         ← 087:1281–1492 (087 replaced 069's)
--   draft_reassign_pick                ← 087:1503–1777 (087 replaced 069's)
--   draft_move_player                  ← 087:1796–2031 (087 replaced 069's)
-- Each body was EXTRACTED from those exact ranges (CREATE → `$$;`) and then
-- edited; `diff -u` hunk counts per function — the PR body carries the
-- diffs: gate 1 hunk (the small body is rewritten whole) · set_clock 5
-- (OR REPLACE line · v_note declaration removed · gate comment · the
-- extend-arm replacement · the live-extend block deleted + the post's
-- `|| v_note` dropped) · undo 1 (gate comment only) · reassign 2 (OR
-- REPLACE line · gate comment) · move 2 (same shape). Everything outside
-- those hunks is byte-identical to 087.
-- No signature changes ⇒ every body is CREATE OR REPLACE (the three 087
-- DROP+CREATEs stay at their 087 arities). REVOKEs are re-issued verbatim
-- anyway — harmless under OR REPLACE's ACL preservation, and the file then
-- reads complete on its own (087's own form).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 3 — WHAT CHANGES AND WHAT DOES NOT (the scope guard).
-- ---------------------------------------------------------------------------
-- CHANGES (exactly Chris's gated set, via the ONE helper — no copies):
--   draft_undo (both arms) · draft_reassign_pick · draft_move_player ·
--   draft_set_clock now refuse on a RUNNING snake/linear draft. The gate
--   helper's body loses its `draft_type = 'auction' AND` conjunction; the
--   four call sites are UNTOUCHED (they were always unconditional — the
--   auction-only scope lived in the helper, which is why the R367/§A
--   no-drift architecture makes this a one-predicate alignment).
--   draft_set_clock's snake extend-current arm is RETIRED (see the comment
--   at the arm — the gate makes it unreachable; deleting beats trapping).
-- DOES NOT CHANGE:
--   * The AUCTION posture, byte for byte: the auction refusal sentence is
--     087's exactly; 036's auction pins run untouched and stay green.
--   * draft_reverse_won_bid / draft_cancel_nomination on snake: both check
--     `draft_type <> 'auction'` BEFORE the gate (087:545/860), so a snake
--     caller still gets the type refusal, never a pause-first sentence
--     about a verb snake does not have. Neither body is replaced here.
--   * draft_set_order — R373's pinned pre-start divergence was NOT part of
--     the ruling (tasks-M3 §6 L.C1.8 item 4); posture unchanged.
--   * draft_force_pick / draft_reset — not in Chris's gated set; postures
--     unchanged (force still refuses paused with its own sentence; reset
--     stays the terminal control).
--   * Mock refusals (D138/D103) — every guard fires BEFORE the gate,
--     unchanged; pgTAP 025's pins run against these bodies and stay green.
--   * Solvency, audit immutability, lock semantics, snapshot reads: no
--     money-adjacent or lock-adjacent line is touched (the hunks above are
--     the whole diff).
--
-- Migration checklist (plan §8.1 / tasks-M3 §4.4): NO DDL — no table, no
-- column, no policy, no index, no signature change; five CREATE OR
-- REPLACEs only · rollback = re-apply 087's five bodies (the extracted
-- originals are the rollback text) · staging rehearsal: R6 waiver — no
-- staging clone exists (environments are local + prod only); the recorded
-- rehearsal is the fresh local `npx supabase db reset` replay of the full
-- 001–090 chain in this PR, plus pgTAP 023/025/026/036 · typegen: no
-- object added, removed or re-typed ⇒ `src/types/database.ts` is verified
-- UNCHANGED in this PR (no regen needed; the alias block stands).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_auction_pause_gate_internal — the ONE D141 gate, now type-neutral
--    (F57 ALIGN). Same name, same signature, same six callers (036 §A pins
--    the call form and the cardinality).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_auction_pause_gate_internal(
  p_draft public.drafts,
  p_verb  TEXT
) RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  -- 090/L.C1.8 — F57 RULED 2026-08-18 (Chris): ALIGN. The ONE D141 gate is
  -- now draft-type-NEUTRAL: every consumer refuses on ANY running draft —
  -- one mental model, the command bar's Pause button as the universal door
  -- to commissioner edits (spec §8.7 v2.12.5). The function KEEPS its
  -- historical name: renaming would ripple through six PERFORM sites and
  -- 036 §A's call-form pins for zero behavioural value; the name records
  -- where the rule came from (D141), not its scope.
  -- The auction sentence is BYTE-IDENTICAL to 087's, so 036's auction pins
  -- stand untouched; snake/linear gets its own sentence (honest copy — the
  -- Q13 precedent; a snake commissioner should not be told about auction
  -- controls).
  IF p_draft.status = 'live' THEN
    IF p_draft.draft_type = 'auction' THEN
      RAISE EXCEPTION
        '%: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
        p_verb
        USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION
      '%: pause the draft first — commissioner controls run on a paused board (§8.7 v2.12.5)',
      p_verb
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_auction_pause_gate_internal(public.drafts, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. draft_set_clock — HEAD 087:1069–1271. The gate now fires on snake; the
--    snake extend-current arm is retired (comment at the arm).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_set_clock(
  p_draft_id UUID,
  p_pick_timer_seconds INTEGER DEFAULT NULL,
  p_extend_current BOOLEAN DEFAULT FALSE,
  p_reason TEXT DEFAULT NULL,
  p_nomination_seconds INTEGER DEFAULT NULL,
  p_bid_seconds INTEGER DEFAULT NULL,
  p_anti_snipe_seconds INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
  v_cfg   JSONB;
  v_parts TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- 087/L.C1.5: the NULL half of this check moved below the draft-type
  -- dispatch, because an auction-only timer edit legitimately passes no
  -- pick_timer_seconds. The NEGATIVE half keeps its message and its position
  -- ahead of every data access (023's pin at :697 passes -1, not NULL).
  IF p_pick_timer_seconds IS NOT NULL AND p_pick_timer_seconds < 0 THEN
    RAISE EXCEPTION 'draft_set_clock: pick_timer_seconds must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;
  IF p_nomination_seconds IS NOT NULL AND p_nomination_seconds < 0 THEN
    RAISE EXCEPTION 'draft_set_clock: auction_nomination_seconds must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;
  IF p_bid_seconds IS NOT NULL AND p_bid_seconds < 0 THEN
    RAISE EXCEPTION 'draft_set_clock: auction_bid_seconds must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;
  IF p_anti_snipe_seconds IS NOT NULL AND p_anti_snipe_seconds < 0 THEN
    RAISE EXCEPTION 'draft_set_clock: auction_anti_snipe_seconds must be a non-negative integer'
      USING ERRCODE = '22023';
  END IF;
  IF p_pick_timer_seconds IS NULL AND p_nomination_seconds IS NULL
     AND p_bid_seconds IS NULL AND p_anti_snipe_seconds IS NULL THEN
    RAISE EXCEPTION 'draft_set_clock: name at least one timer to change'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_set_clock: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  -- MOCK GUARD (L.B1.6/071 — amended in place, F12; D103(2)/§8.8): §8.7
  -- is the REAL-draft commissioner surface. On a mock this control is
  -- interference with a member's solo practice (and for draft_reset an
  -- outright zero-side-effect breach — it writes leagues.status and the
  -- stored schedule instant). The launcher's controls are
  -- pause/resume/delete (069 mock arms + 071). Pinned in pgTAP 025.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_set_clock: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION
      'draft_set_clock: the draft is % — the pick clock can only be edited mid-draft (E15); pre-draft, edit it in League settings',
      v_draft.status
      USING ERRCODE = 'P0001';
  END IF;

  -- 090/L.C1.8 — D141 gate, F57 ALIGNED (Chris, 2026-08-18): ALL clock
  -- edits are pause-first on EVERY draft type (§8.7 v2.12.5).
  PERFORM public.draft_auction_pause_gate_internal(v_draft, 'draft_set_clock');

  -- 087/L.C1.5 — THE AUCTION ARM (§8.7's timer row, E15 analog). An auction
  -- has no pick clock: it has a NOMINATION clock, a BID clock and an
  -- anti-snipe floor (§7.3.8). Each edit governs SUBSEQUENT clocks — the
  -- E15 rule, carried verbatim — and there is no extend-current arm at all,
  -- because D141 already refused this verb on a running auction, so there is
  -- never a running clock here to extend.
  IF v_draft.draft_type = 'auction' THEN
    IF p_pick_timer_seconds IS NOT NULL THEN
      RAISE EXCEPTION
        'draft_set_clock: this is an auction — it has no pick clock; set the nomination, bid, or anti-snipe timers instead (§7.3.8)'
        USING ERRCODE = 'P0001';
    END IF;
    IF p_extend_current THEN
      RAISE EXCEPTION
        'draft_set_clock: an auction clock cannot be extended in place — the draft is paused, and the new timer applies when it resumes (§8.7 v2.10)'
        USING ERRCODE = 'P0001';
    END IF;

    v_cfg := v_draft.config;
    IF p_nomination_seconds IS NOT NULL THEN
      v_cfg := jsonb_set(v_cfg, '{auction_nomination_seconds}',
                         to_jsonb(p_nomination_seconds));
      v_parts := v_parts || ('nomination clock ' || CASE
                   WHEN p_nomination_seconds = 0 THEN 'untimed'
                   ELSE p_nomination_seconds || 's' END);
    END IF;
    IF p_bid_seconds IS NOT NULL THEN
      v_cfg := jsonb_set(v_cfg, '{auction_bid_seconds}', to_jsonb(p_bid_seconds));
      v_parts := v_parts || ('bid clock ' || CASE
                   WHEN p_bid_seconds = 0 THEN 'untimed'
                   ELSE p_bid_seconds || 's' END);
    END IF;
    IF p_anti_snipe_seconds IS NOT NULL THEN
      v_cfg := jsonb_set(v_cfg, '{auction_anti_snipe_seconds}',
                         to_jsonb(p_anti_snipe_seconds));
      v_parts := v_parts || ('anti-snipe ' || CASE
                   WHEN p_anti_snipe_seconds = 0 THEN 'off'
                   ELSE p_anti_snipe_seconds || 's' END);
    END IF;

    UPDATE public.drafts SET config = v_cfg, updated_at = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;

    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, auth.uid(),
            'Auction clocks updated by ' || public.draft_actor_name() || ': '
            || array_to_string(v_parts, ', ')
            || ' (applies to upcoming nominations).',
            'draft:' || p_draft_id::text, TRUE);

    RETURN jsonb_build_object('draft', to_jsonb(v_draft));
  END IF;

  -- SNAKE / LINEAR from here down — 069's text, unchanged.
  IF p_nomination_seconds IS NOT NULL OR p_bid_seconds IS NOT NULL
     OR p_anti_snipe_seconds IS NOT NULL THEN
    RAISE EXCEPTION
      'draft_set_clock: this is a % draft — the auction timers apply to auction drafts only (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;
  -- (069's own `p_pick_timer_seconds IS NULL` arm is deliberately NOT repeated
  -- here: the "name at least one timer" check above already refuses a call
  -- that passes none, and on a snake draft the auction timers are refused a
  -- few lines up, so a NULL pick timer cannot reach this point. Its 22023
  -- message survives for the NEGATIVE case, which is the one 023 pins.)
  -- 090/L.C1.8 — THE EXTEND-CURRENT ARM IS RETIRED (F57 ALIGN). Pause-first
  -- makes an in-place extension unreachable from both sides: the D141 gate
  -- above refuses this verb on a RUNNING snake draft, and the shipped paused
  -- arm always refused to rewrite the pause bookkeeping ("resume first, then
  -- extend" — a sentence the gate has made a lie). Keeping the live extend
  -- machinery below a gate that forbids reaching it would be a booby trap:
  -- any future weakening of the gate would silently resurrect it. So the arm
  -- is DELETED — the auction treatment exactly (087's auction arm shipped
  -- with no extend-in-place for the same reason). R138/D108(3)'s
  -- impose-on-untimed behaviour is superseded WITH its decision trail named,
  -- not silently: the pause itself is the time relief now (a paused clock
  -- keeps its stored remaining time), and pgTAP 023 pins this refusal where
  -- it used to pin the extension.
  IF p_extend_current THEN
    RAISE EXCEPTION
      'draft_set_clock: the pick clock cannot be extended in place — the current pick keeps its stored remaining time across the pause, and the new timer applies to upcoming picks (§8.7 v2.12.5 / F57)'
      USING ERRCODE = 'P0001';
  END IF;

  -- E15: the new timer governs SUBSEQUENT picks — the drafts.config
  -- snapshot is the live room's authority (D95); league settings untouched.
  UPDATE public.drafts SET
    config     = jsonb_set(config, '{pick_timer_seconds}',
                           to_jsonb(p_pick_timer_seconds)),
    updated_at = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Pick clock set to ' ||
          CASE WHEN p_pick_timer_seconds = 0 THEN 'untimed'
               ELSE p_pick_timer_seconds || ' seconds' END ||
          ' by ' || public.draft_actor_name() ||
          ' (applies to upcoming picks).',
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft));
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_set_clock(UUID, INTEGER, BOOLEAN, TEXT, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3. draft_undo — HEAD 087:1281–1492. Comment-only hunk: the in-body claim
--    "Snake keeps M2's live-controls posture" became false with the F57
--    ruling, and D137 makes THIS file the text the next author reads — a
--    stale divergence comment in the head body is exactly how a future
--    session "restores" snake by accident.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_undo(
  p_draft_id UUID,
  p_to_pick_number INTEGER DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_max_live   INTEGER;
  v_to         INTEGER;
  v_first      INTEGER;
  v_undone     INTEGER;
  v_team_count INTEGER;
  v_timer      INTEGER;
  v_team_name  TEXT;
  v_onclock    UUID;
  v_void_live  INTEGER := 0;
  v_void_past  INTEGER := 0;
  v_nom_note   TEXT := '';
BEGIN
  IF p_to_pick_number IS NOT NULL AND p_to_pick_number < 0 THEN
    RAISE EXCEPTION 'draft_undo: to_pick_number must be >= 0'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_undo: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  -- MOCK GUARD (L.B1.6/071 — amended in place, F12; D103(2)/§8.8): §8.7
  -- is the REAL-draft commissioner surface. On a mock this control is
  -- interference with a member's solo practice (and for draft_reset an
  -- outright zero-side-effect breach — it writes leagues.status and the
  -- stored schedule instant). The launcher's controls are
  -- pause/resume/delete (069 mock arms + 071). Pinned in pgTAP 025.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_undo: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_undo: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_undo: the draft has not started yet — nothing to undo'
      USING ERRCODE = 'P0001';
  END IF;

  -- 090/L.C1.8 — D141 gate, F57 ALIGNED (Chris, 2026-08-18): undo (single
  -- AND cascade) is pause-first on EVERY draft type (§8.7 v2.12.5).
  PERFORM public.draft_auction_pause_gate_internal(v_draft, 'draft_undo');

  SELECT max(p.pick_number) INTO v_max_live
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.is_undone = FALSE;

  IF v_max_live IS NULL THEN
    RAISE EXCEPTION 'draft_undo: no picks have been made yet — nothing to undo'
      USING ERRCODE = 'P0001';
  END IF;

  -- p_to NULL ⇒ single undo of the highest live pick (§8.7 row 3).
  v_to := COALESCE(p_to_pick_number, v_max_live - 1);
  IF v_to >= v_max_live THEN
    RAISE EXCEPTION
      'draft_undo: nothing to undo after pick % — the last completed pick is pick %',
      v_to, v_max_live
      USING ERRCODE = 'P0001';
  END IF;

  -- 087/L.C1.5 — E29 (D131(2)): on an auction the LIVE nomination is voided
  -- FIRST, and only then are picks reverted. "Bids returned" costs nothing
  -- because bids never hold budget — only won picks do — so this is a
  -- clearing of the block, not a refund.
  IF v_draft.draft_type = 'auction' THEN
    v_void_live := public.draft_void_nomination_internal(p_draft_id);

    -- D162: the nominations being REVERTED are voided too. Their picks are
    -- about to become is_undone, so their bids no longer belong to a
    -- standing pick — and, decisively, current_pick_number is about to rewind
    -- ONTO those sequence numbers, so leaving the rows live would merge two
    -- nominations' bids under one seq for every reader keyed on it. This is
    -- the same merge D143 creates and the same fix.
    UPDATE public.draft_bids SET voided_at = now()
    WHERE draft_id = p_draft_id
      AND nomination_seq > v_to
      AND voided_at IS NULL;
    GET DIAGNOSTICS v_void_past = ROW_COUNT;
  END IF;

  -- E4: soft-undo everything after pick v_to. Pool return is the partial
  -- index (undone rows free their players); rows are KEPT (§12.4 audit).
  UPDATE public.draft_picks
  SET is_undone = TRUE
  WHERE draft_id = p_draft_id AND is_undone = FALSE AND pick_number > v_to;
  GET DIAGNOSTICS v_undone = ROW_COUNT;

  -- Clock rewind to the first reverted pick (E4: "clock rewound to that
  -- team") with a FRESH full timer — live now; paused on resume.
  v_first := v_to + 1;
  v_team_count := jsonb_array_length(v_draft.draft_order);
  v_timer := COALESCE((v_draft.config->>'pick_timer_seconds')::int, 90);

  -- 087/L.C1.5 — WHO IS ON THE CLOCK AFTER THE REWIND, and on which clock.
  IF v_draft.draft_type = 'auction' THEN
    -- The auction has no positional derivation: pick_number is a NOMINATION
    -- sequence number, so "the team on the clock at seq v_first" is the team
    -- that NOMINATED at v_first — recovered from the opening bid row that
    -- every nomination writes (F62). The rows were just stamped voided; they
    -- still stand, which is exactly why a void marks rather than deletes.
    --
    -- 087/R379 — SCOPED TO THIS RUN, and that scoping is load-bearing.
    -- `nomination_seq` IS `current_pick_number`, and draft_reset rewinds it to
    -- 1 (D162 situation (c)) while draft_start re-issues every number from
    -- there, so (draft_id, nomination_seq) is ambiguous ACROSS runs. This
    -- lookup deliberately reads VOIDED rows — the stamps a few lines up are
    -- its own — so `voided_at` cannot be the discriminator. `started_at` is:
    -- every bid of this run was written after the start that set it, and
    -- draft_reset NULLs it. Without this the earliest row wins and a rewind
    -- past a restarted draft's boundary puts the PREVIOUS run's nominator on
    -- the clock (the seq→nominator map is not positional — §8.6.7(c) skips
    -- complete rosters — so it is a different franchise, not a stale copy of
    -- the same one). A NULL started_at on a live/paused draft is corruption
    -- and is refused LOUDLY rather than silently widening the window back
    -- over every run this draft has ever had.
    IF v_draft.started_at IS NULL THEN
      RAISE EXCEPTION
        'draft_undo: auction % is % but has no started_at — this run''s bid history cannot be told from a previous run''s; refusing to guess whose nomination to rewind to (R379)',
        p_draft_id, v_draft.status
        USING ERRCODE = 'P0001';
    END IF;
    SELECT b.team_id INTO v_onclock
    FROM public.draft_bids b
    WHERE b.draft_id = p_draft_id AND b.nomination_seq = v_first
      AND b.created_at >= v_draft.started_at
    ORDER BY b.created_at, b.id
    LIMIT 1;
    IF v_onclock IS NULL THEN
      RAISE EXCEPTION
        'draft_undo: auction % has no bid history for nomination % — cannot tell whose nomination to rewind to (F62)',
        p_draft_id, v_first
        USING ERRCODE = 'P0001';
    END IF;
    -- The fresh clock is the NOMINATION clock: the rewind lands the board in
    -- the nominating phase (current_nomination was cleared above), and
    -- handing it a pick-clock value would be a snake number on an auction.
    v_timer := COALESCE((v_draft.config->>'auction_nomination_seconds')::int, 30);
  ELSE
    v_onclock := public.draft_team_for_pick(
                   v_draft.draft_order, v_draft.draft_type,
                   COALESCE((v_draft.config->>'snake_reversal')::boolean, FALSE),
                   v_first);
  END IF;

  UPDATE public.drafts SET
    current_pick_number   = v_first,
    -- Snake: the round. Auction: the display-only rotation LAP (D126) — the
    -- same arithmetic, and nothing in the engine reads it either way.
    current_round         = ((v_first - 1) / v_team_count) + 1,
    on_clock_team_id      = v_onclock,
    current_deadline      = CASE WHEN status = 'live' AND v_timer > 0
                                 THEN now() + make_interval(secs => v_timer)
                            END,
    deadline_remaining_ms = CASE WHEN status = 'paused' AND v_timer > 0
                                 THEN v_timer * 1000
                            END,
    completed_at          = NULL,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  SELECT t.name INTO v_team_name
  FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;

  -- 087: say what happened to the block, if anything did (§16.3).
  IF v_void_live + v_void_past > 0 THEN
    v_nom_note := ' The live nomination was cancelled and '
      || (v_void_live + v_void_past) || ' bid'
      || CASE WHEN v_void_live + v_void_past = 1 THEN ' is' ELSE 's are' END
      || ' void (no money moved).';
  END IF;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          CASE WHEN v_undone = 1
            THEN 'Pick ' || v_first || ' undone by ' || public.draft_actor_name()
                 || ' — ' || COALESCE(v_team_name, 'the team') || ' is back on the clock.'
            ELSE 'Picks ' || v_first || '-' || v_max_live || ' undone by '
                 || public.draft_actor_name() || ' (' || v_undone
                 || ' picks reverted) — ' || COALESCE(v_team_name, 'the team')
                 || ' is back on the clock at pick ' || v_first || '.'
          END || v_nom_note,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'undone_count', v_undone,
    'rewound_to_pick', v_first,
    'voided_bids', v_void_live + v_void_past);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_undo(UUID, INTEGER, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 4. draft_reassign_pick — HEAD 087:1503–1777. Comment-only hunks (plus the
--    OR REPLACE line); behaviour on snake changes through the helper alone.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_reassign_pick(
  p_draft_id UUID,
  p_pick_id UUID,
  p_team_id UUID DEFAULT NULL,
  p_player_id TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_price INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_pick          public.draft_picks;
  v_new_player    TEXT;
  v_new_team      UUID;
  v_old_team      UUID;
  v_old_pl_name   TEXT;
  v_new_pl_name   TEXT;
  v_old_team_name TEXT;
  v_new_team_name TEXT;
  v_target_count  BIGINT;
  v_msg           TEXT;
  v_price_in      INTEGER := p_price;
  v_recv_team     UUID;
  v_old_owner     UUID;
  v_min_bid       INTEGER;
  v_remaining     INTEGER;
  v_open          INTEGER;
  v_max_bid       INTEGER;
BEGIN
  IF p_team_id IS NULL AND p_player_id IS NULL AND p_price IS NULL THEN
    RAISE EXCEPTION 'draft_reassign_pick: provide a new team, a new player, or both'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_reassign_pick: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  -- MOCK GUARD (L.B1.6/071 — amended in place, F12; D103(2)/§8.8): §8.7
  -- is the REAL-draft commissioner surface. On a mock this control is
  -- interference with a member's solo practice (and for draft_reset an
  -- outright zero-side-effect breach — it writes leagues.status and the
  -- stored schedule instant). The launcher's controls are
  -- pause/resume/delete (069 mock arms + 071). Pinned in pgTAP 025.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_reassign_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_reassign_pick: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_reassign_pick: the draft has not started yet'
      USING ERRCODE = 'P0001';
  END IF;

  -- 090/L.C1.8 — D141 gate, F57 ALIGNED (Chris, 2026-08-18): pick edits
  -- are pause-first on EVERY draft type (§8.7 v2.12.5).
  PERFORM public.draft_auction_pause_gate_internal(v_draft, 'draft_reassign_pick');

  -- 087/L.C1.5 — a price on a SNAKE pick is a category error, refused HERE
  -- (immediately after the gate) rather than at the priced block far below:
  -- an argument that means nothing for this draft type should not depend on
  -- finding the row it would have been applied to.
  IF v_draft.draft_type <> 'auction' AND p_price IS NOT NULL THEN
    RAISE EXCEPTION
      'draft_reassign_pick: this is a % draft — its picks carry no price (§12.4)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_pick
  FROM public.draft_picks p
  WHERE p.id = p_pick_id AND p.draft_id = p_draft_id AND p.is_undone = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_reassign_pick: pick % is not a live pick of this draft', p_pick_id
      USING ERRCODE = 'P0002';
  END IF;

  v_new_player := COALESCE(p_player_id, v_pick.player_id);
  v_new_team   := COALESCE(p_team_id, v_pick.team_id);

  -- Before-values captured for the §8.7 before/after post.
  v_old_team := v_pick.team_id;
  SELECT pl.full_name INTO v_old_pl_name
  FROM public.players pl WHERE pl.id = v_pick.player_id;
  SELECT t.name INTO v_old_team_name
  FROM public.teams t WHERE t.id = v_pick.team_id;

  -- New player must exist…
  IF p_player_id IS NOT NULL THEN
    SELECT pl.full_name INTO v_new_pl_name
    FROM public.players pl WHERE pl.id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'draft_reassign_pick: player % not found', p_player_id
        USING ERRCODE = 'P0002';
    END IF;
    -- …and be exclusive: no live pick of this draft may already hold him
    -- (the pick's OWN row counts — a no-change reassign surfaces here).
    IF EXISTS (
      SELECT 1 FROM public.draft_picks p
      WHERE p.draft_id = p_draft_id AND p.player_id = p_player_id
        AND p.is_undone = FALSE
    ) THEN
      RAISE EXCEPTION
        'draft_reassign_pick: % is already on a roster in this draft — undo or reassign that pick first',
        v_new_pl_name
        USING ERRCODE = 'P0001';
    END IF;
    -- 087/R379-cycle (filed R380) — THE ONE PLAYER THE SWEEP ABOVE CANNOT
    -- SEE. On an auction the NOMINATED player has no draft_picks row yet: the
    -- tick writes it at the award (ARM 2.6's INSERT, 087:3497). So the
    -- exclusivity check passes
    -- for exactly the player who must not be assigned, and nothing else on
    -- this path looks at `current_nomination` — the E28 arms are about money,
    -- and the section-3b gate returns silently when the receiving team is not
    -- the high bidder. The award's INSERT then hits `uniq_draft_player_live`
    -- (`uniq_draft_player_live`, 065:178), ARM 2.6's containment — the
    -- `EXCEPTION WHEN OTHERS` at 087:3581 — swallows the unique_violation into
    -- `auction_failures`, the nomination is never cleared, and every 5s tick
    -- reproduces it: the D160(8) stuck clock reached through the board.
    -- draft_move_player cannot reach this — it requires the player to already
    -- hold a live pick — which is why the guard lives here and only here.
    IF v_draft.draft_type = 'auction'
       AND v_draft.current_nomination->>'player_id' = p_player_id THEN
      RAISE EXCEPTION
        'draft_reassign_pick: % is on the block right now — cancel the nomination first (Edit current nomination), then assign him (§8.7/D143)',
        v_new_pl_name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- New team must be an active franchise of THIS league.
  IF p_team_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
        AND t.status <> 'retired'
    ) THEN
      RAISE EXCEPTION 'draft_reassign_pick: team % is not an active franchise of this league', p_team_id
        USING ERRCODE = 'P0002';
    END IF;
    -- Capacity (v2.8.11: slot validation at pick time = capacity only).
    IF p_team_id <> v_pick.team_id THEN
      SELECT count(*) INTO v_target_count
      FROM public.draft_picks p
      WHERE p.draft_id = p_draft_id AND p.team_id = p_team_id
        AND p.is_undone = FALSE;
      IF v_target_count >= v_draft.total_rounds THEN
        RAISE EXCEPTION
          'draft_reassign_pick: that team''s roster is already full (% of % picks) — move a player off it first',
          v_target_count, v_draft.total_rounds
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  v_recv_team := v_new_team;
  v_old_owner := v_pick.team_id;

  -- 087/L.C1.5 — D142's PRICED PATH. Manual Edit Mode's "Move player to a
  -- different team" charges the receiving team, so the commissioner
  -- RE-ENTERS the cost and that re-entered amount IS the validation input.
  IF v_draft.draft_type = 'auction' THEN
    -- The cost is re-entered when the pick CHANGES HANDS (D142's second
    -- choice). A same-team edit — swapping which player the pick took, or
    -- correcting the price alone — does not charge a new team, so demanding
    -- a price there would be ceremony rather than a check.
    IF v_price_in IS NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      RAISE EXCEPTION
        'draft_reassign_pick: this is an auction — re-enter the price this pick should cost the receiving team (§8.7 Manual Edit Mode)'
        USING ERRCODE = '22023';
    END IF;
    v_min_bid := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);
    IF v_price_in IS NOT NULL AND v_price_in < v_min_bid THEN
      RAISE EXCEPTION
        'draft_reassign_pick: $% is below this league''s $% minimum bid (§7.3.8)',
        v_price_in, v_min_bid
        USING ERRCODE = 'P0001';
    END IF;
    -- E28-class: the same algebra the award uses (§8.6.8 rule 7). A team can
    -- afford `price` exactly when price <= max_bid, because paying it leaves
    -- remaining - price >= (open_slots - 1) * min_bid.
    IF v_price_in IS NOT NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      SELECT b.remaining, b.open_slots, b.max_bid
        INTO v_remaining, v_open, v_max_bid
      FROM public.draft_team_budget(p_draft_id, v_recv_team) b;
      IF v_price_in > v_max_bid THEN
        RAISE EXCEPTION
          'draft_reassign_pick: $% is over that team''s max bid of $% — they have $% for % open roster spots at a $% minimum bid; reverse a won bid or adjust their budget first (E28/§8.6.8)',
          v_price_in, v_max_bid, v_remaining, v_open, v_min_bid
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;   -- (the snake arm was refused right after the gate, above)

  SELECT t.name INTO v_new_team_name
  FROM public.teams t WHERE t.id = v_new_team;

  UPDATE public.draft_picks
  SET team_id   = v_new_team,
      player_id = v_new_player,
      -- 087: the auction's re-entered cost rides the row (§12.4's `price`);
      -- a snake pick keeps its NULL, because v_price_in is NULL there by the
      -- refusal above.
      price     = COALESCE(v_price_in, price)
  WHERE id = p_pick_id
  RETURNING * INTO v_pick;

  UPDATE public.drafts SET updated_at = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- 087/R367 — E28 ARM 3 (D131(4)), RE-ASKED AFTER THE WRITE. The pre-write
  -- `price <= max_bid` above measures the world BEFORE this pick lands, and
  -- it is guarded by `recv IS DISTINCT FROM old_owner` so a same-team
  -- price-only correction never reaches it at all. Both gaps are the same
  -- gap: the receiving team's max bid falls when the pick lands, and if that
  -- team is the LIVE HIGH BIDDER the close becomes unaffordable and the tick
  -- refuses the award forever (the D160(8) stuck clock). Unconditional here
  -- — no distinct-owner guard — so the price-only arm is covered too. The
  -- RAISE rolls the UPDATE back inside the caller's transaction.
  PERFORM public.draft_auction_high_bid_gate_internal(
    v_draft, v_recv_team, 'draft_reassign_pick',
    'Void the nomination (Edit current nomination — the board is already paused) or reverse a won bid first');

  -- 087 — §4 rule 7 backstop, through the ONE family: the targeted refusals
  -- above cover the receiving team, this proves nobody else's floor moved.
  IF v_draft.draft_type = 'auction'
     AND NOT public.draft_auction_solvent(p_draft_id) THEN
    RAISE EXCEPTION
      'draft_reassign_pick: that edit left auction % insolvent (§8.6.8) — refusing',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Before/after in the post (§8.7 row 5) — built from the values captured
  -- BEFORE the update.
  v_msg := 'Pick ' || v_pick.pick_number || ' edited by ' || public.draft_actor_name();
  IF p_player_id IS NOT NULL THEN
    v_msg := v_msg || ': ' || COALESCE(v_old_pl_name, '?') || ' -> '
                   || COALESCE(v_new_pl_name, '?');
  END IF;
  IF p_team_id IS NOT NULL AND p_team_id <> v_old_team THEN
    v_msg := v_msg
      || CASE WHEN p_player_id IS NOT NULL THEN ';' ELSE ':' END
      || ' moved from ' || COALESCE(v_old_team_name, '?')
      || ' to ' || COALESCE(v_new_team_name, '?');
  END IF;
  IF v_price_in IS NOT NULL THEN
    v_msg := v_msg || CASE WHEN p_player_id IS NOT NULL
                             OR (p_team_id IS NOT NULL AND p_team_id <> v_old_team)
                           THEN '; ' ELSE ': ' END
                   || 'price set to $' || v_price_in;
  END IF;
  v_msg := v_msg || '.';

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(), v_msg,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_reassign_pick(UUID, UUID, UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 5. draft_move_player — HEAD 087:1796–2031. Same shape as 4.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_move_player(
  p_draft_id UUID,
  p_player_id TEXT,
  p_from_team UUID,
  p_to_team UUID,
  p_reason TEXT DEFAULT NULL,
  p_price INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft        public.drafts;
  v_pick         public.draft_picks;
  v_player_name  TEXT;
  v_from_name    TEXT;
  v_to_name      TEXT;
  v_target_count BIGINT;
  v_price_in     INTEGER := p_price;
  v_recv_team    UUID;
  v_old_owner    UUID;
  v_min_bid      INTEGER;
  v_remaining    INTEGER;
  v_open         INTEGER;
  v_max_bid      INTEGER;
BEGIN
  IF p_player_id IS NULL OR btrim(p_player_id) = ''
     OR p_from_team IS NULL OR p_to_team IS NULL THEN
    RAISE EXCEPTION 'draft_move_player: player_id, from_team, and to_team are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_move_player: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  -- MOCK GUARD (L.B1.6/071 — amended in place, F12; D103(2)/§8.8): §8.7
  -- is the REAL-draft commissioner surface. On a mock this control is
  -- interference with a member's solo practice (and for draft_reset an
  -- outright zero-side-effect breach — it writes leagues.status and the
  -- stored schedule instant). The launcher's controls are
  -- pause/resume/delete (069 mock arms + 071). Pinned in pgTAP 025.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_move_player: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_move_player: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_move_player: the draft has not started yet'
      USING ERRCODE = 'P0001';
  END IF;

  -- 090/L.C1.8 — D141 gate, F57 ALIGNED (Chris, 2026-08-18): pause-first
  -- on EVERY draft type (§8.7 v2.12.5). THIS
  -- IS ALSO THE ARM D160(8)/R364 NAMED: before 087 this function had no
  -- draft_type awareness at all, so a commissioner mis-click could move a
  -- priced player onto a team and shrink a live high bidder's max_bid below
  -- their standing bid — manufacturing exactly the insolvent award the tick
  -- then refuses forever.
  --
  -- R367 CORRECTION, and it is worth reading rather than trusting: this
  -- comment used to end "the gate, the priced validation and the solvency
  -- backstop below are what close that door", and that sentence was FALSE.
  -- The gate only decides WHEN the commissioner may act; the pre-write
  -- `price <= max_bid` measures the world before the pick lands; and
  -- `draft_auction_solvent` cannot see a bid at all, because bids hold no
  -- money (D131(2)). The door is closed by E28 arm 3, asked AFTER the write
  -- (section 3b) — which is the ONLY one of the four that compares the
  -- post-edit max bid against the STANDING bid.
  PERFORM public.draft_auction_pause_gate_internal(v_draft, 'draft_move_player');

  -- 087/L.C1.5 — a price on a SNAKE pick is a category error, refused HERE
  -- (immediately after the gate) rather than at the priced block far below:
  -- an argument that means nothing for this draft type should not depend on
  -- finding the row it would have been applied to.
  IF v_draft.draft_type <> 'auction' AND p_price IS NOT NULL THEN
    RAISE EXCEPTION
      'draft_move_player: this is a % draft — its picks carry no price (§12.4)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_move_player: player % not found', p_player_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT t.name INTO v_to_name
  FROM public.teams t
  WHERE t.id = p_to_team AND t.league_id = v_draft.league_id
    AND t.status <> 'retired';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_move_player: team % is not an active franchise of this league', p_to_team
      USING ERRCODE = 'P0002';
  END IF;

  -- The task's exclusivity refusal (also the natural replay shape: after a
  -- successful move the player IS on p_to_team, so a replay lands here).
  IF p_to_team = p_from_team THEN
    RAISE EXCEPTION
      'draft_move_player: % is already on that team',
      v_player_name
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_pick
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.player_id = p_player_id
    AND p.is_undone = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_move_player: % has not been drafted in this draft', v_player_name
      USING ERRCODE = 'P0001';
  END IF;
  IF v_pick.team_id <> p_from_team THEN
    SELECT t.name INTO v_from_name
    FROM public.teams t WHERE t.id = v_pick.team_id;
    RAISE EXCEPTION
      'draft_move_player: % is on % — not the team you are moving from',
      v_player_name, COALESCE(v_from_name, 'another team')
      USING ERRCODE = 'P0001';
  END IF;

  -- Capacity (v2.8.11: slot validation at pick time = capacity only).
  SELECT count(*) INTO v_target_count
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.team_id = p_to_team
    AND p.is_undone = FALSE;
  IF v_target_count >= v_draft.total_rounds THEN
    RAISE EXCEPTION
      'draft_move_player: that team''s roster is already full (% of % picks) — move a player off it first',
      v_target_count, v_draft.total_rounds
      USING ERRCODE = 'P0001';
  END IF;

  v_recv_team := p_to_team;
  v_old_owner := p_from_team;

  -- 087/L.C1.5 — D142's PRICED PATH. Manual Edit Mode's "Move player to a
  -- different team" charges the receiving team, so the commissioner
  -- RE-ENTERS the cost and that re-entered amount IS the validation input.
  IF v_draft.draft_type = 'auction' THEN
    -- The cost is re-entered when the pick CHANGES HANDS (D142's second
    -- choice). A same-team edit — swapping which player the pick took, or
    -- correcting the price alone — does not charge a new team, so demanding
    -- a price there would be ceremony rather than a check.
    IF v_price_in IS NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      RAISE EXCEPTION
        'draft_move_player: this is an auction — re-enter the price this pick should cost the receiving team (§8.7 Manual Edit Mode)'
        USING ERRCODE = '22023';
    END IF;
    v_min_bid := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);
    IF v_price_in IS NOT NULL AND v_price_in < v_min_bid THEN
      RAISE EXCEPTION
        'draft_move_player: $% is below this league''s $% minimum bid (§7.3.8)',
        v_price_in, v_min_bid
        USING ERRCODE = 'P0001';
    END IF;
    -- E28-class: the same algebra the award uses (§8.6.8 rule 7). A team can
    -- afford `price` exactly when price <= max_bid, because paying it leaves
    -- remaining - price >= (open_slots - 1) * min_bid.
    IF v_price_in IS NOT NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      SELECT b.remaining, b.open_slots, b.max_bid
        INTO v_remaining, v_open, v_max_bid
      FROM public.draft_team_budget(p_draft_id, v_recv_team) b;
      IF v_price_in > v_max_bid THEN
        RAISE EXCEPTION
          'draft_move_player: $% is over that team''s max bid of $% — they have $% for % open roster spots at a $% minimum bid; reverse a won bid or adjust their budget first (E28/§8.6.8)',
          v_price_in, v_max_bid, v_remaining, v_open, v_min_bid
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;   -- (the snake arm was refused right after the gate, above)

  SELECT t.name INTO v_from_name
  FROM public.teams t WHERE t.id = p_from_team;

  UPDATE public.draft_picks
  SET team_id = p_to_team,
      -- 087: D142's re-entered cost. NULL on snake by the refusal above, so
      -- COALESCE keeps 069's behaviour there exactly.
      price   = COALESCE(v_price_in, price)
  WHERE id = v_pick.id
  RETURNING * INTO v_pick;

  UPDATE public.drafts SET updated_at = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- 087/R367 — E28 ARM 3 (D131(4)), RE-ASKED AFTER THE WRITE. This is the
  -- arm that made the comment above false until R367: the gate + the
  -- pre-write `price <= max_bid` do NOT stop a commissioner shrinking the
  -- live high bidder's max bid below its own standing bid, because that
  -- shrink only happens once the pick lands. Driven, not reasoned — a move
  -- at $100 against a $150 high bid was ACCEPTED and left max_bid $99, and
  -- `draft_auction_solvent` stayed TRUE throughout (a bid holds no money, so
  -- no derivation sees it). The RAISE rolls the UPDATE back inside the
  -- caller's transaction.
  PERFORM public.draft_auction_high_bid_gate_internal(
    v_draft, v_recv_team, 'draft_move_player',
    'Void the nomination (Edit current nomination — the board is already paused) or reverse a won bid first');

  -- 087 — §4 rule 7 backstop, through the ONE family: the targeted refusals
  -- above cover the receiving team, this proves nobody else's floor moved.
  IF v_draft.draft_type = 'auction'
     AND NOT public.draft_auction_solvent(p_draft_id) THEN
    RAISE EXCEPTION
      'draft_move_player: that edit left auction % insolvent (§8.6.8) — refusing',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Before/after in the post (§8.7 row 5).
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          v_player_name || ' moved from ' || COALESCE(v_from_name, '?')
          || ' to ' || v_to_name || ' by ' || public.draft_actor_name()
          || CASE WHEN v_price_in IS NOT NULL
                  THEN ' at $' || v_price_in ELSE '' END || '.',
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_move_player(UUID, TEXT, UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon;
