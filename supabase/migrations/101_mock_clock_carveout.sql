-- ============================================================================
-- 101 — the clock is live in a mock: the D141 carve-out (MS.3)
--       (tasks-MS §5 MS.3; spec §8.7's v2.15 pause-first carve-out + §8.8;
--        E15/E76; D219; PROGRESS D260; discharges F100 together with this
--        PR's route-docblock fix)
-- ============================================================================
--
-- WHAT THIS IS. Chris's ruling 1, built: "the user running the mock should
-- be able to make it as fast as possible IMO and pause it if they need to
-- do something." Pause already works (D110(1)); this file opens the CLOCK.
-- On a RUNNING mock the launcher edits all four timers — the snake/linear
-- pick clock and the auction nomination / bid / anti-snipe clocks (§7.3.8)
-- — with NO pause. Two CREATE OR REPLACEs:
--
--   1. draft_auction_pause_gate_internal (head 090, re-derived at task time
--      with the sorted-glob rule, D137/D259(4)). ONE predicate change in
--      the BODY, never the consumer set (D219(4): commish-auction-ops.
--      test.ts couples the six-consumer set to the UI mirror):
--        IF p_draft.status = 'live'
--           AND NOT (p_draft.is_mock AND p_verb = 'draft_set_clock') THEN
--      The verb term is deliberate and is what makes D219(2) STRUCTURAL:
--      the other five consumers (undo, reassign, move, reverse-won-bid,
--      cancel-nomination) keep pause-first EVEN IN A MOCK — they edit
--      draft state the tick is concurrently reading. Today they refuse a
--      mock earlier, at their 100/E75 arms; the verb term is what stops a
--      future E75 lift from silently inheriting no-pause-first. A plain
--      `AND NOT p_draft.is_mock` would have lifted the gate for all six
--      the day the audit opens them — the exact widening §8.7 v2.15
--      refuses ("covers draft_set_clock only"). Both refusal sentences
--      are BYTE-IDENTICAL to 090's (036:417–418 pin them in prosrc).
--
--   2. draft_set_clock (head 100). Gate surgery only; every other line is
--      the head's file text verbatim (extraction scripted, anchors
--      count-asserted — 4 hunks against the head):
--        a. 100's E75 stays-shut mock arm is RETIRED for this verb — the
--           MS.2 launcher gate above it is the whole mock authority, and
--           the launcher falls through to the carved-out pause gate.
--        b. Both extend_current refusals gain an is_mock branch, because
--           on a running mock the shipped sentences became FALSE ("the
--           draft is paused…" / "…across the pause") — tasks-MS §1.6. The
--           mock sentences are STATE-NEUTRAL (true running or paused);
--           the REAL sentences are byte-identical (§4 rule 13 — pgTAP
--           023:707 and 036's pins pass untouched). The extend machinery
--           stays deleted (090:291–303 — "a booby trap"); E15's
--           next-clock-only rule is structural, not re-decided here.
--
-- WHAT DOES NOT CHANGE. Real drafts, in every respect (§4 rule 13): every
-- refusal message and every gate order is byte-identical on is_mock =
-- FALSE — the break probe for this file widens the carve-out and shows
-- 023/036's real-draft refusal pins RED. The other five gated verbs still
-- refuse on a running mock (E76's last sentence; pgTAP 049 pins the gate's
-- own arm per-verb AND the E75 fronting arms). E15 holds in both worlds:
-- the running deadline is untouched by an edit and the NEXT clock takes
-- the new value — 049 pins the boundary instant on both draft types.
-- STANDALONE mocks are covered by the same gates (095's member floor +
-- 100's launcher arm are uniform; the clock body is draft-scoped, and the
-- chat post writes a NULL league_id per 095 banner item 3(b)) — pinned in
-- 049 §G. No wire door for a standalone clock edit exists yet (D245(2)
-- types commissioner verbs league-scoped) — F129 carries it to MS.5/MS.8's
-- surfacing, filed not fixed.
--
-- §4.1 posture: both functions keep their shipped volatility/DEFINER/
-- search_path pins; each REVOKE restated after its replace (093/095/100
-- precedent). No DDL, no data change — D38 BACKFILL: none owed.
-- R6 STAGING WAIVER, cited: no staging clone exists (environments are
-- local + prod only). The rehearsal is `npx supabase migration up` against
-- the local stack plus the full pgTAP suite and the stack-backed vitest
-- files; NO `db reset` (the 095/F110 rule — `migration up` replays this
-- file against the deployed chain).
-- Rollback = re-apply 090's gate body and 100's draft_set_clock body
-- verbatim.
--
-- Proof: pgTAP 049 (the four timers edited on RUNNING mocks with no pause,
-- stored literals; the running deadline untouched and the NEXT clock at
-- the new value, exact instants — E15's boundary; the byte-identical real
-- refusals; the other five shut on a running mock, gate-arm and E75-arm
-- both; the §4-rule-10 composite incl. the league:<id> topic; standalone;
-- the mock extend sentences). 048's two touched pins re-pointed, none
-- deleted (§4 rule 11). Wire: the launcher's clock 200s in
-- draft-commish-api-db.test.ts + auction-commish-api-db.test.ts. Break
-- probe (shown RED, reverted md5-identical): the carve-out widened to all
-- live drafts ⇒ 023/036/049's real-draft pause-first pins RED.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_auction_pause_gate_internal — head 090; ONE body predicate.
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
  -- 101/MS.3 — THE ONE CARVE-OUT (spec §8.7 v2.15; D219; E76): on a MOCK,
  -- the CLOCK edit is not pause-first — the launcher is solo, so the pause
  -- protects nobody and costs one every time they try a different number.
  -- The carve-out is keyed on the VERB as well as is_mock, deliberately:
  -- the other five consumers keep pause-first EVEN IN A MOCK (D219(2) —
  -- they edit draft state the tick is concurrently reading, and the pause
  -- is what takes the tick out of the race). Today those five refuse a
  -- mock earlier, at their own E75 arms; this term is what stops a future
  -- E75 lift from silently inheriting no-pause-first. The consumer set is
  -- UNCHANGED (commish-auction-ops.test.ts couples it to the UI mirror);
  -- real drafts cannot feel this predicate at all (§4 rule 13).
  IF p_draft.status = 'live'
     AND NOT (p_draft.is_mock AND p_verb = 'draft_set_clock') THEN
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
-- 2. draft_set_clock — head 100; the E75 arm retired for this verb, the two
--    extend_current refusals split (mock sentence / real sentence).
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

  -- MS.2/100 — GATE ORDER (D217(5)/E75): member floor → (real draft ⇒
  -- commissioner) → (mock ⇒ launcher, the ONE gate helper). The
  -- real-draft refusal below is byte-identical to the pre-100 text (§4
  -- rule 13; 023/036 pin it): a member-but-not-commissioner, a non-member
  -- and a nonexistent draft all still answer this same 42501 (no-leak).
  -- The floor's standalone arm reuses D226(3)'s ONE ownership predicate
  -- via is_standalone_mock_launcher (095); is_league_member(NULL) and
  -- is_standalone_mock_launcher(NULL) are both FALSE — fail closed.
  IF NOT FOUND
     OR NOT (public.is_league_member(v_draft.league_id)
             OR public.is_standalone_mock_launcher(v_draft.id))
     OR (NOT v_draft.is_mock AND NOT public.is_league_commish(v_draft.league_id)) THEN
    RAISE EXCEPTION 'draft_set_clock: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_set_clock');
  -- 101/MS.3 — THE CLOCK IS OPEN IN A MOCK (§8.8 v2.15 / §8.7's v2.15
  -- carve-out; D219; E76). 100's E75 stays-shut arm is retired for THIS
  -- verb only: the launcher gate above is the whole mock authority, and
  -- the D141 pause gate below carries the mocks-only carve-out in its own
  -- body. §8.8 isolation is measured in pgTAP 049 (whole-row composite
  -- over the real league + the league:<id> broadcast topic).

  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION
      'draft_set_clock: the draft is % — the pick clock can only be edited mid-draft (E15); pre-draft, edit it in League settings',
      v_draft.status
      USING ERRCODE = 'P0001';
  END IF;

  -- 090/L.C1.8 — D141 gate, F57 ALIGNED (Chris, 2026-08-18): ALL clock
  -- edits are pause-first on EVERY draft type (§8.7 v2.12.5). Since 101
  -- (MS.3) the gate's own body carves out exactly (is_mock AND this verb):
  -- a running MOCK's clock edit passes; every real draft still refuses
  -- with the byte-identical sentence (§8.7 v2.15; E76).
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
      -- 101/MS.3: on a mock this arm is now reachable RUNNING, where the
      -- shipped sentence ("the draft is paused…") would be false. The mock
      -- gets a state-neutral true sentence; the REAL sentence is
      -- byte-identical to 087's (§4 rule 13). The machinery stays retired
      -- on both paths — E15's next-clock rule is structural (090:291–303).
      IF v_draft.is_mock THEN
        RAISE EXCEPTION
          'draft_set_clock: an auction clock cannot be extended in place — the current clock is never rewritten, and the new timer applies to upcoming nominations (E15 / §8.7 v2.15)'
          USING ERRCODE = 'P0001';
      END IF;
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
    -- 101/MS.3: same split as the auction arm — the mock sentence is
    -- state-neutral (true running OR paused); the real one is 090's,
    -- byte-identical (pgTAP 023 pins it).
    IF v_draft.is_mock THEN
      RAISE EXCEPTION
        'draft_set_clock: the pick clock cannot be extended in place — the current clock is never rewritten, and the new timer applies to upcoming picks (E15 / §8.7 v2.15)'
        USING ERRCODE = 'P0001';
    END IF;
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

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION
  draft_set_clock(UUID, INTEGER, BOOLEAN, TEXT, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon;
