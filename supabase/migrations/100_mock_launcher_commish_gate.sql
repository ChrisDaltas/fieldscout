-- ============================================================================
-- 100 — the launcher is the commissioner of their own mock (MS.2)
--       (tasks-MS §5 MS.2; spec §8.8's v2.15 block + §8.7; E75; D217/D218;
--        PROGRESS D259; discharges F126 together with this PR's wire flip)
-- ============================================================================
--
-- WHAT THIS IS. The MS lane's enablement migration: the launcher of a mock
-- holds the §8.7 commissioner surface on it (§8.8 v2.15 — Chris, 2026-08-20:
-- "in a mock … the solo person is the commish"). Two changes, both at the
-- gate, at ALL ELEVEN §8.7 RPC sites (cleared AND excluded — D217(5)):
--
--   1. THE GATE ORDER — the load-bearing fix, measured in tasks-MS §1.1.
--      Pre-100, `is_league_commish` fired BEFORE the mock refusal at every
--      site, so a non-commissioner launcher got a bare 42501 and the
--      friendly refusal was unreachable for exactly the person this lane is
--      about. The new order is 069/095 `draft_pause`'s idiom: member floor
--      (league member OR standalone launcher) → real draft ⇒ commissioner →
--      mock ⇒ launcher. REAL drafts are byte-unchanged (§4 rule 13): a
--      member-but-not-commissioner, a non-member and a nonexistent draft
--      all answer the identical pre-100 42501 (023/036's pins pass
--      untouched).
--   2. THE MOCK ARM — one helper, `draft_mock_launcher_gate_internal`,
--      D226(3)'s ONE ownership predicate (`config->'mock'->>'launched_by'`,
--      TEXT-compared, R117): a non-launcher — commissioner included, no
--      bypass, D103(2) — gets the friendly P0001. `draft_pause`/`draft_resume`
--      (head 095) keep their L.B1.6 inline arms with their pinned per-verb
--      copy; the helper is the ONE implementation for the eleven §8.7 sites
--      it gates, and consolidating pause/resume's pinned messages into it
--      would move shipped copy for zero behaviour (noted, not done).
--
-- WHAT OPENS, AND WHAT HONESTLY CANNOT YET. §8.8 v2.15 is explicit: which
-- controls the launcher may use "is settled by MEASUREMENT, per control, not
-- by reading the code" — and the per-control route-level audit (MS.1) is
-- PARKED with the deferred league-attached feature (tasks-MP §7). So:
--
--   * CLEARED here: `draft_set_order` ONLY — the one control whose
--     route-level targeting AND real-league isolation were measured by
--     MS.7/D258 (the R468 landscape: a mock and a real draft alive in one
--     league, driven through the route, the real draft's whole row + chat
--     byte-identical), with the launcher-success half of that measurement
--     (pgTAP 048's §8.8 composite + the F126 wire pins) landing in this PR.
--     League-attached mocks only: a STANDALONE mock's order edit refuses
--     with its own reason (the body's permutation validation is
--     league-derived, and D245(2)/D258(4) type the standalone scope out of
--     every commissioner verb at the wire) — F128 carries the standalone
--     arm as a follow-up, not an exclusion.
--   * STILL SHUT, each behind its own reason-naming refusal (E75): the
--     other ten. The retired class sentence ("mock drafts have no
--     commissioner controls") stopped being true the moment order opened
--     and appears in no function after this file (§4 rule 11) — every
--     shut control now names its own reason. draft_reset (the live-proven
--     leagues writer) stays with MS.4/D220; draft_set_clock stays with
--     MS.3/D219; the rest await the parked audit. Enabling any of them
--     from a code read alone would violate the spec's own measurement
--     sentence — stated as the boundary, not padded around.
--
-- ELEVEN CREATE OR REPLACEs, each authored against the CURRENT FILE TEXT of
-- its chain HEAD (D137), heads re-derived at task time with
-- `grep -lE 'CREATE (OR REPLACE )?FUNCTION (public\.)?<name>\(' | sort`:
--   draft_set_clock 090 · draft_undo 090 · draft_reassign_pick 092 ·
--   draft_move_player 092 · draft_force_pick 093 · draft_reverse_won_bid 087 ·
--   draft_adjust_budget 099 · draft_cancel_nomination 087 ·
--   draft_set_order 098 · draft_end 087 · draft_reset 087.
-- Gate surgery only: the two auth blocks move; every other line is the
-- head's text verbatim (the extraction was scripted and count-asserted, one
-- gate block and one mock block per body).
--
-- §4.1 posture: every function stays SECURITY DEFINER + in-body auth +
-- `search_path = ''`; each REVOKE restated after its replace (093/095
-- precedent). The new helper is REVOKEd from PUBLIC/anon/authenticated —
-- callable only from the DEFINER bodies.
--
-- D38 BACKFILL: none owed — function-only, no DDL, no data change.
-- R6 STAGING WAIVER, cited: no staging clone exists (environments are local
-- + prod only). The rehearsal is `npx supabase migration up` against the
-- local stack plus the full pgTAP suite and the stack-backed vitest files;
-- NO `db reset` was run (the 095/F110 precedent — `migration up` replays
-- this file against the deployed chain, and resetting destroys the dev
-- machine's login/data to rehearse nothing extra).
-- Rollback = re-apply the eleven head bodies named above verbatim and DROP
-- the helper.
--
-- Proof: pgTAP 048 (the launcher-arm contract per E75, the order-edit
-- success + §8.8 whole-row composite, the ten reason-naming refusals as the
-- LAUNCHER, no-bypass, the real-draft 42501 floor byte-identical, the
-- standalone arm both ways); 025/036/038's 29 re-pointed pins; the wire
-- flips in draft-commish-api-db.test.ts §C (F126 pins (a)+(e)) and
-- auction-commish-api-db.test.ts. Break probes (shown RED, reverted):
-- (1) the helper neutered ⇒ every non-launcher friendly-refusal pin fails;
-- (2) one real-draft arm widened ⇒ 036's 42501 pin fails (rule 13).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. THE ONE LAUNCHER GATE (D226(3): one ownership predicate, never a
--    membership graph; R117: TEXT comparison, never a uuid cast of a NULL).
--    On a non-mock draft it is a no-op. On a mock it refuses everyone but
--    the launcher — the commissioner included (D103(2), no bypass). A mock
--    with no launched_by key (a fixture insert) refuses EVERYONE: NULL IS
--    DISTINCT FROM any uid — fail closed, the 038 §H posture.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_mock_launcher_gate_internal(
  p_draft public.drafts,
  p_verb  TEXT
) RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_draft.is_mock
     AND p_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      '%: only the member practicing this mock can use its commissioner controls (§8.8/D103)',
      p_verb
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_mock_launcher_gate_internal(public.drafts, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- draft_set_clock — head 090 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
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
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — MS.3 owns the D219 clock carve-out; until it lands the clock stays shut.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_set_clock: clock edits are not open in a practice yet (§8.8/E75)'
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

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION
  draft_set_clock(UUID, INTEGER, BOOLEAN, TEXT, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_undo — head 090 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
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
    RAISE EXCEPTION 'draft_undo: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_undo');
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — pause-gated tick-racing editor; awaiting the parked MS.1 route-level audit.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_undo: undo is not open in a practice yet (§8.8/E75)'
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

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_undo(UUID, INTEGER, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_reassign_pick — head 092 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
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
  v_reserve       INTEGER;
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
    RAISE EXCEPTION 'draft_reassign_pick: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_reassign_pick');
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — in-place draft_picks editor; awaiting the parked MS.1 route-level audit.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_reassign_pick: pick edits are not open in a practice yet (§8.8/E75)'
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
    -- 092/AP.1: ONE derived number for BOTH jobs this line does (D198(1);
    -- §7.3.8's auction_zero_dollar_nominations row) — the floor a re-entered
    -- price must clear, and the §8.6.1 per-slot reserve the max-bid message
    -- below names. $1 with the toggle OFF, $0 with it ON. Neither is the bid
    -- increment, which is a fixed $1 (§8.6.3).
    v_reserve := public.draft_auction_reserve(v_draft.config);
    IF v_price_in IS NOT NULL AND v_price_in < v_reserve THEN
      RAISE EXCEPTION
        'draft_reassign_pick: $% is below this league''s $% price floor (§7.3.8)',
        v_price_in, v_reserve
        USING ERRCODE = 'P0001';
    END IF;
    -- E28-class: the same algebra the award uses (§8.6.8 rule 7). A team can
    -- afford `price` exactly when price <= max_bid, because paying it leaves
    -- remaining - price >= (open_slots - 1) * reserve.
    IF v_price_in IS NOT NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      SELECT b.remaining, b.open_slots, b.max_bid
        INTO v_remaining, v_open, v_max_bid
      FROM public.draft_team_budget(p_draft_id, v_recv_team) b;
      IF v_price_in > v_max_bid THEN
        RAISE EXCEPTION
          'draft_reassign_pick: $% is over that team''s max bid of $% — they have $% for % open roster spots at a $% per-slot reserve; reverse a won bid or adjust their budget first (E28/§8.6.8)',
          v_price_in, v_max_bid, v_remaining, v_open, v_reserve
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

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION
  draft_reassign_pick(UUID, UUID, UUID, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_move_player — head 092 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
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
  v_reserve      INTEGER;
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
    RAISE EXCEPTION 'draft_move_player: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_move_player');
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — in-place draft_picks editor; awaiting the parked MS.1 route-level audit.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_move_player: moving a drafted player is not open in a practice yet (§8.8/E75)'
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
    -- 092/AP.1: ONE derived number for BOTH jobs this line does (D198(1);
    -- §7.3.8's auction_zero_dollar_nominations row) — the floor a re-entered
    -- price must clear, and the §8.6.1 per-slot reserve the max-bid message
    -- below names. $1 with the toggle OFF, $0 with it ON. Neither is the bid
    -- increment, which is a fixed $1 (§8.6.3).
    v_reserve := public.draft_auction_reserve(v_draft.config);
    IF v_price_in IS NOT NULL AND v_price_in < v_reserve THEN
      RAISE EXCEPTION
        'draft_move_player: $% is below this league''s $% price floor (§7.3.8)',
        v_price_in, v_reserve
        USING ERRCODE = 'P0001';
    END IF;
    -- E28-class: the same algebra the award uses (§8.6.8 rule 7). A team can
    -- afford `price` exactly when price <= max_bid, because paying it leaves
    -- remaining - price >= (open_slots - 1) * reserve.
    IF v_price_in IS NOT NULL AND v_recv_team IS DISTINCT FROM v_old_owner THEN
      SELECT b.remaining, b.open_slots, b.max_bid
        INTO v_remaining, v_open, v_max_bid
      FROM public.draft_team_budget(p_draft_id, v_recv_team) b;
      IF v_price_in > v_max_bid THEN
        RAISE EXCEPTION
          'draft_move_player: $% is over that team''s max bid of $% — they have $% for % open roster spots at a $% per-slot reserve; reverse a won bid or adjust their budget first (E28/§8.6.8)',
          v_price_in, v_max_bid, v_remaining, v_open, v_reserve
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

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION
  draft_move_player(UUID, TEXT, UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_force_pick — head 093 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_force_pick(
  p_draft_id UUID,
  p_player_id TEXT,
  p_action_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft       public.drafts;
  v_pick        public.draft_picks;
  v_player_name TEXT;
  v_team_name   TEXT;
  v_result      JSONB;
  v_bid         public.draft_bids;
  v_action      UUID;
  v_nom_floor   INTEGER;
  v_bid_seconds INTEGER;
  v_remaining   INTEGER;
  v_open        INTEGER;
  v_max_bid     INTEGER;
  v_live_name   TEXT;
  v_uncontested BOOLEAN;
BEGIN
  IF p_player_id IS NULL OR btrim(p_player_id) = '' THEN
    RAISE EXCEPTION 'draft_force_pick: player_id is required'
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
    RAISE EXCEPTION 'draft_force_pick: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_force_pick');
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — reaches draft_complete_internal; its mock guard is unmeasured from this caller (tasks-MS §5 MS.1 item 5).
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_force_pick: picking for another seat is not open in a practice yet (§8.8/E75)'
      USING ERRCODE = 'P0001';
  END IF;

  -- =====================================================================
  -- 087/L.C1.5 — THE AUCTION ARM (R301): §8.7's "Pick for a manager" on an
  -- auction is a FORCE-NOMINATION, and only in the NOMINATING phase.
  -- THERE IS DELIBERATELY NO COMMISSIONER FORCE-BID: absent managers do not
  -- bid (§8.6.5/OQ 10), and the close needs no force because the clock
  -- awards the standing high bidder on its own (§8.6.7(b)). Recorded, not
  -- omitted.
  -- NOT pause-gated — D141's list does not name force pick, and this is the
  -- control a commissioner reaches for precisely while the clock runs.
  -- =====================================================================
  IF v_draft.draft_type = 'auction' THEN
    -- E2 replay, nomination edition: the opening bid IS a draft_bids row
    -- (D157(1)), so the replay lookup is the same select-then-insert shape
    -- 085 uses — never an ON CONFLICT arbiter against the PARTIAL
    -- uniq_draft_bid_action (42P10 — R310/D144(7)).
    IF p_action_id IS NOT NULL THEN
      SELECT b.* INTO v_bid
      FROM public.draft_bids b
      WHERE b.draft_id = p_draft_id AND b.action_id = p_action_id;
      IF FOUND THEN
        RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
      END IF;
    END IF;

    IF v_draft.status = 'paused' THEN
      RAISE EXCEPTION
        'draft_force_pick: the draft is paused — resume it first, then nominate for the team on the clock'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_draft.status <> 'live' THEN
      RAISE EXCEPTION 'draft_force_pick: the draft is % — there is no nomination on the clock', v_draft.status
        USING ERRCODE = 'P0001';
    END IF;

    -- PHASE (D126). A live nomination means bidding is open, and there is no
    -- force-bid to offer.
    IF v_draft.current_nomination IS NOT NULL THEN
      SELECT pl.full_name INTO v_live_name
      FROM public.players pl
      WHERE pl.id = v_draft.current_nomination->>'player_id';
      RAISE EXCEPTION
        'draft_force_pick: bidding is already open on % at $% — a commissioner cannot bid for a manager (§8.6.5); the clock awards the high bidder when it expires',
        COALESCE(v_live_name, 'the nominated player'),
        COALESCE(v_draft.current_nomination->>'high_bid', '0')
        USING ERRCODE = 'P0001';
    END IF;

    SELECT pl.full_name INTO v_player_name
    FROM public.players pl WHERE pl.id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'draft_force_pick: player % not found', p_player_id
        USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.draft_picks p
      WHERE p.draft_id = p_draft_id AND p.player_id = p_player_id
        AND p.is_undone = FALSE
    ) THEN
      RAISE EXCEPTION
        'draft_force_pick: % just went off the board — nominate another player',
        v_player_name
        USING ERRCODE = 'P0001';
    END IF;

    -- D129(1): validated EXACTLY as the on-clock team's own nomination would
    -- be, through the ONE family (§4.7) — capacity first, then the
    -- §8.6.7(a) affordability rule that makes a no-raise award legal.
    SELECT b.remaining, b.open_slots, b.max_bid
      INTO v_remaining, v_open, v_max_bid
    FROM public.draft_team_budget(p_draft_id, v_draft.on_clock_team_id) b;

    SELECT t.name INTO v_team_name
    FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;

    IF v_open < 1 THEN
      RAISE EXCEPTION
        'draft_force_pick: %''s roster is complete — complete rosters are skipped in the nomination rotation (§8.6.7(c)/E27)',
        COALESCE(v_team_name, 'that team')
        USING ERRCODE = 'P0001';
    END IF;

    -- 092/AP.1: the NOMINATION FLOOR. It is the SAME derived number as the
    -- §8.6.1 per-slot reserve (§7.3.8's toggle sets both: $1 OFF, $0 ON), so
    -- it is read through the ONE authority — D198(1). It is NOT the bid
    -- increment: raises are `> high_bid`, i.e. a fixed $1 in BOTH columns
    -- (§8.6.3), which is the distinction the retired 0-5 min-bid field
    -- collapsed and Chris ruled apart ("Nomination and Min Bid need to be
    -- different", 2026-08-20). The retired key is named nowhere in any
    -- shipped body ON PURPOSE — pgTAP 040 §A pins `prosrc` clean of it.
    v_nom_floor   := public.draft_auction_reserve(v_draft.config);
    v_bid_seconds := COALESCE((v_draft.config->>'auction_bid_seconds')::int, 20);

    IF v_nom_floor > v_max_bid THEN
      RAISE EXCEPTION
        'draft_force_pick: % cannot afford the $% nomination floor — max bid is $% ($% for % open spots) (§8.6.7(a))',
        COALESCE(v_team_name, 'that team'), v_nom_floor, v_max_bid, v_remaining, v_open
        USING ERRCODE = 'P0001';
    END IF;

    -- ATTRIBUTION (D130 "per actor", read off the bid row at the award —
    -- D160(3)): a commissioner force-nomination is a HUMAN act, so the
    -- opening row must carry a non-NULL action_id or an unraised close would
    -- attribute it as an autopick. When the caller supplies none we MINT one
    -- rather than write NULL — the honest answer, at the cost of the E2
    -- replay this call never had anyway (069's snake arm behaves the same
    -- with a NULL action_id).
    v_action := COALESCE(p_action_id, gen_random_uuid());

    -- F62: every nomination opens with a draft_bids row.
    INSERT INTO public.draft_bids
      (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
    VALUES
      (p_draft_id, v_draft.league_id, v_draft.current_pick_number,
       p_player_id, v_draft.on_clock_team_id, v_nom_floor, v_action)
    RETURNING * INTO v_bid;

    -- 093/AP.2 — §8.6.9/E67 on the COMMISSIONER path too. tasks-AP §AP.2
    -- item 3 named two nomination paths; this is the third, and §8.6.9 is
    -- written about NOMINATIONS with no qualifier on who opened one (Chris:
    -- "it should apply no matter where it happens in the draft"). The
    -- precedent for the breakdown missing a live site in this exact family
    -- is D214(1), where §1.3's read-site table missed this same function.
    -- The spec wins where the two disagree (tasks-AP preamble).
    v_uncontested := public.draft_nomination_uncontestable(
                       p_draft_id, v_draft.on_clock_team_id, v_nom_floor);

    -- Open the BIDDING phase (D126). current_pick_number is NOT advanced —
    -- it IS this nomination's sequence number until the award (D157(2)) —
    -- and on_clock stays the NOMINATOR.
    -- 093/AP.2: the uncontestable arm adds the ADDITIVE `"uncontested"` key
    -- the room reads and opens NO bid clock (D199(4)/E67) — draft_nominate
    -- carries the full reasoning; one mechanism, three callers.
    UPDATE public.drafts SET
      current_nomination = jsonb_build_object(
                             'player_id', p_player_id,
                             'high_bid', v_nom_floor,
                             'high_bidder_team_id', v_draft.on_clock_team_id)
                           || CASE WHEN v_uncontested
                                   THEN jsonb_build_object('uncontested', TRUE)
                                   ELSE '{}'::jsonb END,
      current_deadline   = CASE WHEN v_uncontested THEN NULL
                                ELSE now() + make_interval(secs => v_bid_seconds)
                           END,
      updated_at         = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;

    -- The system chat line is written BEFORE the instant award on purpose:
    -- it names `v_draft.current_pick_number`, which IS this nomination's
    -- sequence number until the award advances it (D157(2)). Awarding first
    -- would silently renumber the sentence.
    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, auth.uid(),
            'Nomination ' || v_draft.current_pick_number || ' made by commissioner '
            || public.draft_actor_name() || ' for '
            || COALESCE(v_team_name, 'the team on the clock')
            || ': ' || v_player_name || ' at $' || v_nom_floor || '.',
            'draft:' || p_draft_id::text, TRUE);

    IF v_uncontested THEN
      -- THE INSTANT AWARD (§8.6.9/E67) — the same extracted award (D199(3)).
      PERFORM public.draft_award_nomination_internal(p_draft_id);
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
    END IF;

    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
  END IF;

  -- SNAKE / LINEAR from here down — 069's text, unchanged.
  -- E2 replay short-circuit (optional idempotency — §4.6; the R125
  -- semantics apply: an action_id is consumed forever, undone or not).
  IF p_action_id IS NOT NULL THEN
    SELECT p.* INTO v_pick
    FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id AND p.action_id = p_action_id;
    IF FOUND THEN
      RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
    END IF;
  END IF;

  IF v_draft.status = 'paused' THEN
    RAISE EXCEPTION
      'draft_force_pick: the draft is paused — resume it first, then pick for the team on the clock'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status <> 'live' THEN
    RAISE EXCEPTION 'draft_force_pick: the draft is % — there is no pick on the clock', v_draft.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_force_pick: player % not found', p_player_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E1 availability under the lock (friendly path; the partial unique is
  -- the guarantee).
  IF EXISTS (
    SELECT 1 FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id AND p.player_id = p_player_id
      AND p.is_undone = FALSE
  ) THEN
    RAISE EXCEPTION
      'draft_force_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END IF;

  SELECT t.name INTO v_team_name
  FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;

  -- The ONE advance path (reuse, never fork): §8.7 "Pick for a manager"
  -- shape — a deliberate human action, not an autopick (is_auto FALSE),
  -- made_via 'commissioner', picked_by = the commissioner (§12.4).
  BEGIN
    v_result := public.draft_apply_pick_internal(
      p_draft_id, p_player_id, FALSE, 'commissioner', auth.uid(), p_action_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION
      'draft_force_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Pick ' || v_draft.current_pick_number || ' made by commissioner '
          || public.draft_actor_name() || ' for ' || COALESCE(v_team_name, 'the team on the clock')
          || ': ' || v_player_name || '.',
          'draft:' || p_draft_id::text, TRUE);

  RETURN v_result;
END;
$$;

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_force_pick(UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_reverse_won_bid — head 087 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_reverse_won_bid(
  p_draft_id UUID,
  p_pick_id  UUID,
  p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft       public.drafts;
  v_pick        public.draft_picks;
  v_player_name TEXT;
  v_team_name   TEXT;
  v_remaining   INTEGER;
  v_open        INTEGER;
BEGIN
  IF p_pick_id IS NULL THEN
    RAISE EXCEPTION 'draft_reverse_won_bid: pick_id is required'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the drafts row FIRST (§4.6 rule 6).
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. One no-leak 42501 for nonexistent / non-member /
  -- non-commissioner (is_league_commish(NULL) is FALSE) — 069's shape.
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
    RAISE EXCEPTION 'draft_reverse_won_bid: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_reverse_won_bid');
  -- MOCK GUARD (D138/D110(1)/§8.8): a mock has no commissioner — the
  -- launcher's controls are pause, resume and delete. Unreachable until
  -- L.C1.7 lifts 071's auction-mock refusal; that is why it ships now (F61).
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — in-place draft_picks editor; awaiting the parked MS.1 route-level audit.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_reverse_won_bid: reversing a won bid is not open in a practice yet (§8.8/E75)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_reverse_won_bid: this is a % draft — there are no won bids to reverse; use Undo or Edit pick instead (§8.7)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  -- F44 boundary, verbatim with 069's siblings: post-completion reversal is
  -- an audited override that arrives with the commissioner console (M6).
  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_reverse_won_bid: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_reverse_won_bid: the draft has not started yet — nothing to reverse'
      USING ERRCODE = 'P0001';
  END IF;

  -- D141 (banner item 4): Manual Edit Mode is pause-first.
  PERFORM public.draft_auction_pause_gate_internal(v_draft, 'draft_reverse_won_bid');

  SELECT p.* INTO v_pick
  FROM public.draft_picks p
  WHERE p.id = p_pick_id AND p.draft_id = p_draft_id AND p.is_undone = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_reverse_won_bid: pick % is not a live pick of this draft', p_pick_id
      USING ERRCODE = 'P0002';
  END IF;

  -- An auction pick always carries a price (086 writes it at the award), so
  -- a NULL one is engine corruption, not a user mistake — and refunding
  -- "NULL" would silently refund nothing. LOUD (CLAUDE.md).
  IF v_pick.price IS NULL THEN
    RAISE EXCEPTION
      'draft_reverse_won_bid: pick % on auction % carries no price — refusing to reverse a bid that recorded no money',
      p_pick_id, p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = v_pick.player_id;
  SELECT t.name INTO v_team_name
  FROM public.teams t WHERE t.id = v_pick.team_id;

  -- (3) WRITE. Soft undo, exactly as E4/§12.4 do it everywhere else: the row
  -- STAYS (audit trail), the player returns to the pool through
  -- uniq_draft_player_live's partial index, and THE BUDGET IS RESTORED BY
  -- DERIVATION — draft_team_budget sums `WHERE is_undone = FALSE`, so there
  -- is literally nothing to write back (D127: no stored counters). The team
  -- also re-enters the nomination rotation for free: ARM 2.6's scan skips on
  -- `open_slots >= 1`, which this reversal has just made true again (E27).
  UPDATE public.draft_picks
  SET is_undone = TRUE
  WHERE id = p_pick_id;

  -- current_pick_number is NOT rewound (the snake undo's rewind is a
  -- pick-order concept). In an auction the sequence number is a nomination
  -- counter that only advances; the reversed seq is simply never re-used,
  -- and nothing reads pick_number for contiguity.
  UPDATE public.drafts SET updated_at = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- §4 rule 7. A reversal is solvency-INCREASING by construction (D131(3):
  -- remaining' = remaining + price and open' = open + 1, and price >=
  -- min_bid, so remaining' >= open' * min_bid follows from the pre-state) —
  -- asserted anyway, because "provably safe" is the class of claim this lane
  -- keeps finding to be false.
  IF NOT public.draft_auction_solvent(p_draft_id) THEN
    RAISE EXCEPTION
      'draft_reverse_won_bid: reversing pick % left auction % insolvent (§8.6.8) — refusing',
      p_pick_id, p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  SELECT b.remaining, b.open_slots INTO v_remaining, v_open
  FROM public.draft_team_budget(p_draft_id, v_pick.team_id) b;

  -- D97: the in-txn system post, with the money in it (§16.3 transparency).
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Won bid reversed by ' || public.draft_actor_name() || ': '
          || COALESCE(v_player_name, 'a player') || ' returns to the pool and '
          || COALESCE(v_team_name, 'the team') || ' is refunded $' || v_pick.price
          || ' (now $' || v_remaining || ' for ' || v_open || ' open spots).',
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'pick', to_jsonb(v_pick),
    'refunded', v_pick.price,
    'remaining', v_remaining,
    'open_slots', v_open);
END;
$$;

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_reverse_won_bid(UUID, UUID, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_adjust_budget — head 099 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_adjust_budget(
  p_draft_id  UUID,
  p_team_id   UUID,
  p_delta     INTEGER,
  p_reason    TEXT DEFAULT NULL,
  p_action_id UUID DEFAULT NULL   -- 099/AP.6 (E69): client-minted dedupe key; NULL = unstamped caller, composes as before
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_team_name  TEXT;
  v_reserve    INTEGER;
  v_before     INTEGER;
  v_after      INTEGER;
  v_remaining  INTEGER;
  v_open       INTEGER;
  v_max_bid    INTEGER;
  v_committed  INTEGER;
  v_result     JSONB;            -- 099/AP.6: the return payload, built once, stored verbatim
BEGIN
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'draft_adjust_budget: team_id is required'
      USING ERRCODE = '22023';
  END IF;
  -- A zero delta is refused rather than treated as a D63-class no-op: the
  -- D63 convention is for a REPEATED command (double-tapped Pause), and a
  -- commissioner who typed 0 made a mistake we should not post about.
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION
      'draft_adjust_budget: delta must be a non-zero integer — say how many dollars to add or remove'
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
    RAISE EXCEPTION 'draft_adjust_budget: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_adjust_budget');

  -- 099/AP.6 — E69/E2 replay short-circuit, after the auth gate and BEFORE
  -- the status checks (066:915's placement): a retried adjustment is a
  -- no-op returning its ORIGINAL stored payload (D203 — a retry that
  -- reported a different adjustment_after than the first call would be a
  -- second lie on top of the first), even if the draft has since paused,
  -- completed or moved on. The draft-row lock above serializes the normal
  -- path; uniq_draft_budget_adjust_action is the race backstop (R310: a
  -- bare ON CONFLICT arbiter cannot match a partial index — this is the
  -- select-then-insert form on purpose).
  IF p_action_id IS NOT NULL THEN
    SELECT a.result INTO v_result
    FROM public.draft_budget_adjustments a
    WHERE a.draft_id = p_draft_id AND a.action_id = p_action_id;
    IF FOUND THEN
      RETURN v_result;
    END IF;
  END IF;

  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — budget writer; awaiting the parked MS.1 route-level audit.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_adjust_budget: budget adjustments are not open in a practice yet (§8.8/E75)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_adjust_budget: this is a % draft — budgets apply to auctions only (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_adjust_budget: the draft is complete — post-completion corrections arrive with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_adjust_budget: the draft has not started yet — set the budget in League settings'
      USING ERRCODE = 'P0001';
  END IF;
  -- NOT pause-gated: D141's ruling names undo, Manual Edit Mode, current-
  -- nomination edits and timer edits. Budget adjust is deliberately absent
  -- from that list (banner item 4), and E28's arms below are what make it
  -- safe to run live.

  SELECT t.name INTO v_team_name
  FROM public.teams t
  WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
    AND t.status <> 'retired';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_adjust_budget: team % is not an active franchise of this league', p_team_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 092/AP.1: the reserve, through the ONE authority (D198(1)).
  v_reserve := public.draft_auction_reserve(v_draft.config);
  v_before  := COALESCE((v_draft.budget_adjustments->>p_team_id::text)::int, 0);
  v_after   := v_before + p_delta;   -- CUMULATIVE: successive corrections compose.

  -- (3) WRITE FIRST, THEN RE-DERIVE. The ONE family (D127/§4.7) reads
  -- budget_adjustments, so the only way to validate the POST-edit world
  -- without re-implementing the arithmetic is to make the edit and ask.
  -- Every refusal below RAISEs, which rolls this write back inside the
  -- caller's transaction — the 084 start-backstop pattern (assert AFTER the
  -- transition write), and the reason no compensating math exists here.
  UPDATE public.drafts SET
    budget_adjustments = jsonb_set(budget_adjustments,
                                   ARRAY[p_team_id::text], to_jsonb(v_after), TRUE),
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  SELECT b.remaining, b.open_slots, b.max_bid, b.committed
    INTO v_remaining, v_open, v_max_bid, v_committed
  FROM public.draft_team_budget(p_draft_id, p_team_id) b;

  -- E28 ARM 1 — below committed spend. Strictly a special case of arm 2, and
  -- kept separate ON PURPOSE: it is the arm with a different remedy, and a
  -- commissioner told "you are $12 under the solvency floor" when the real
  -- problem is that they cut a team below what it has already SPENT will fix
  -- the wrong thing.
  IF v_remaining < 0 THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that leaves % $% short of the $% already spent — reverse a won bid instead, or make the adjustment smaller (E28)',
      v_team_name, -v_remaining, v_committed
      USING ERRCODE = 'P0001';
  END IF;

  -- E28 ARM 2 — below the §8.6.8 solvency floor. open_slots * reserve is the
  -- money the team must still be able to spend to finish a legal roster.
  IF v_remaining < v_open * v_reserve THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that leaves % with $% for % open roster spots at a $% per-slot reserve — §8.6.8 needs at least $%; reverse a won bid to free a spot, or make the adjustment smaller (E28)',
      v_team_name, v_remaining, v_open, v_reserve, v_open * v_reserve
      USING ERRCODE = 'P0001';
  END IF;

  -- E28 ARM 3 (D131(4)) — insolvent against the LIVE high bid. A bid holds no
  -- money (D131(2)); the AWARD spends it. So an edit that is fine right now
  -- can still make the close unaffordable, and the close is a tick away.
  -- Same algebra as the award: price <= max_bid.
  --
  -- 087/R367: the comparison MOVED into draft_auction_high_bid_gate_internal
  -- (section 3b) because the two priced Manual Edit paths need the identical
  -- arm and had shipped without it. The rendered message is BYTE-IDENTICAL to
  -- the inline version this replaced — 036 §F's exact-message pins are
  -- unchanged, which is the check that the move was lossless.
  PERFORM public.draft_auction_high_bid_gate_internal(
    v_draft, p_team_id, 'draft_adjust_budget',
    'Void the nomination (pause, then Edit current nomination) or reverse a won bid first');

  -- Cross-team backstop (§4 rule 7): the arms above check the EDITED team;
  -- this proves the edit did not disturb anyone else's floor. It cannot fire
  -- today — budget_adjustments is per team and no other team's derivation
  -- reads this key — so it is a guard against a future edit to the family,
  -- not a live branch. Stated plainly rather than left to look like coverage.
  IF NOT public.draft_auction_solvent(p_draft_id) THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that adjustment left auction % insolvent (§8.6.8) — refusing',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D97: the in-txn post, with the before/after numbers the task asks for.
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Budget adjusted by ' || public.draft_actor_name() || ': '
          || v_team_name || ' '
          || CASE WHEN p_delta > 0 THEN '+$' || p_delta ELSE '-$' || (-p_delta) END
          || ' (total adjustment '
          || CASE WHEN v_after >= 0 THEN '+$' || v_after ELSE '-$' || (-v_after) END
          || '; now $' || v_remaining || ' remaining for ' || v_open
          || ' open spots, max bid $' || v_max_bid || ').',
          'draft:' || p_draft_id::text, TRUE);

  v_result := jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'team_id', p_team_id,
    'adjustment_before', v_before,
    'adjustment_after', v_after,
    'remaining', v_remaining,
    'open_slots', v_open,
    'max_bid', v_max_bid);

  -- 099/AP.6 (E69): the adjustment's own record — one row per landed edit,
  -- carrying the ORIGINAL return payload verbatim so a replay answers
  -- byte-identically. NULL action_id rows (unstamped callers) are recorded
  -- too and simply have no dedupe key — the C39 shape.
  INSERT INTO public.draft_budget_adjustments
    (draft_id, league_id, team_id, delta, adjustment_after, action_id, result)
  VALUES
    (p_draft_id, v_draft.league_id, p_team_id, p_delta, v_after, p_action_id, v_result);

  RETURN v_result;
END;
$$;

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_adjust_budget(UUID, UUID, INTEGER, TEXT, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_cancel_nomination — head 087 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_cancel_nomination(
  p_draft_id UUID,
  p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft        public.drafts;
  v_player       TEXT;
  v_player_name  TEXT;
  v_high_bid     INTEGER;
  v_nominator    TEXT;
  v_voided       INTEGER;
  v_nom_seconds  INTEGER;
BEGIN
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
    RAISE EXCEPTION 'draft_cancel_nomination: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_cancel_nomination');
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — live-nomination editor; awaiting the parked MS.1 route-level audit.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_cancel_nomination: cancelling a nomination is not open in a practice yet (§8.8/E75)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_cancel_nomination: this is a % draft — only auction drafts have nominations (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_cancel_nomination: the draft is complete'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_cancel_nomination: the draft has not started yet'
      USING ERRCODE = 'P0001';
  END IF;

  -- D141/D143: "Edit current nomination (WHILE PAUSED)". This is the arm the
  -- ruling names most explicitly, and it is also what makes the verb safe —
  -- voiding a nomination out from under a live bid clock would race the tick.
  PERFORM public.draft_auction_pause_gate_internal(v_draft, 'draft_cancel_nomination');

  -- PHASE (D126): there must BE a nomination to cancel.
  IF v_draft.current_nomination IS NULL THEN
    RAISE EXCEPTION
      'draft_cancel_nomination: no player is nominated right now — there is nothing to cancel (§8.6.2)'
      USING ERRCODE = 'P0001';
  END IF;

  v_player   := v_draft.current_nomination->>'player_id';
  v_high_bid := (v_draft.current_nomination->>'high_bid')::int;
  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = v_player;
  SELECT t.name INTO v_nominator
  FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;

  -- (3) WRITE — through the ONE void helper (D162): bid rows stamped
  -- `voided_at`, current_nomination cleared, current_pick_number UNTOUCHED.
  v_voided := public.draft_void_nomination_internal(p_draft_id);

  -- D143's "on resume the same nominator's nomination clock restarts". The
  -- draft is PAUSED here, so the clock lives in deadline_remaining_ms and
  -- draft_resume turns it back into a deadline. Overwriting it is the whole
  -- point: the stored remainder is what was left of the BID clock, and
  -- resuming into the NOMINATING phase with a bid-clock remainder would give
  -- the nominator a few stray seconds to renominate. on_clock_team_id is
  -- untouched — the same nominator renominates (D143).
  v_nom_seconds := COALESCE((v_draft.config->>'auction_nomination_seconds')::int, 30);
  UPDATE public.drafts SET
    deadline_remaining_ms = CASE WHEN v_nom_seconds > 0
                                 THEN v_nom_seconds * 1000 END,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- D97 in-txn post. It names the voided-bid count because that is the part
  -- a bidder needs to hear: their money was never taken, and their bid is
  -- gone (§16.3).
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Nomination cancelled by ' || public.draft_actor_name() || ': '
          || COALESCE(v_player_name, 'the nominated player')
          || ' comes off the block at $' || v_high_bid || ' and '
          || CASE WHEN v_voided = 1 THEN '1 bid is' ELSE v_voided || ' bids are' END
          || ' void (no money moved). ' || COALESCE(v_nominator, 'The same team')
          || ' nominates again when the draft resumes.',
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'cancelled_player_id', v_player,
    'voided_bids', v_voided,
    'nomination_seq', v_draft.current_pick_number);
END;
$$;

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_cancel_nomination(UUID, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_set_order — head 098 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_set_order(
  p_draft_id UUID,
  p_order UUID[],
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_league     public.leagues;
  v_new_order  JSONB;
  v_valid      BOOLEAN;
  v_timer      INTEGER;
  v_new_onclock UUID;
BEGIN
  IF p_order IS NULL OR cardinality(p_order) = 0 THEN
    RAISE EXCEPTION 'draft_set_order: a non-empty draft order is required'
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
    RAISE EXCEPTION 'draft_set_order: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_set_order');
  -- MS.2/100 — the ORDER edit is the lane's first CLEARED control (D222
  -- parity; §8.8 v2.15). The launcher passed the gate above, so on a
  -- league-attached mock the body below acts on the MOCK's own row —
  -- MS.7/D258 fixed the service targeting, and pgTAP 048 + the wire pins
  -- carry the §8.8 whole-row composite around the success. A STANDALONE
  -- mock stays shut with its own reason (E75): the permutation validation
  -- below is league-derived (v_league.team_count + the league's franchise
  -- rows), no standalone editor exists, and the wire types the standalone
  -- scope out of every commissioner verb (D245(2)/D258(4)). F128 carries
  -- the standalone arm forward; it is a follow-up, not an exclusion.
  IF v_draft.is_mock AND v_draft.league_id IS NULL THEN
    RAISE EXCEPTION
      'draft_set_order: a standalone practice cannot edit its order yet — delete it and launch a new one for a fresh order (§8.8/E75)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_set_order: the draft is complete — the order cannot change'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_set_order: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Permutation of the active franchises (066's validation, typed at the
  -- boundary — uuid[] means malformed entries failed at the wire cast).
  v_valid := (
    SELECT count(*) = v_league.team_count
       AND count(DISTINCT e.id) = v_league.team_count
       AND bool_and(EXISTS (
             SELECT 1 FROM public.teams t
             WHERE t.league_id = v_draft.league_id
               AND t.status <> 'retired'
               AND t.id = e.id))
    FROM unnest(p_order) AS e(id)
  );
  IF NOT v_valid THEN
    RAISE EXCEPTION
      'draft_set_order: the order must include every active franchise exactly once (§8.3)'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_order := to_jsonb(p_order);
  v_timer := COALESCE((v_draft.config->>'pick_timer_seconds')::int, 90);

  -- 087/L.C1.5 — THE AUCTION ARM (E31 analog). On an auction the order under
  -- edit is `nomination_order`, not `draft_order`: completed nominations are
  -- stored picks and stay untouched, and the rotation re-derives mechanically
  -- because ARM 2.6 scans `nomination_order` from the current nominator.
  -- on_clock_team_id and both clocks are deliberately NOT recomputed — there
  -- is no positional derivation to redo (the snake branch's whole reason for
  -- re-deriving), the seat mid-nomination keeps its turn, and the new order
  -- takes effect at the next advance. NOT pause-gated (D141 does not name
  -- order edits).
  IF v_draft.draft_type = 'auction' THEN
    IF v_draft.status = 'scheduled' THEN
      RAISE EXCEPTION
        'draft_set_order: this auction has not started — set nomination_order_mode and drag the nomination order in League settings (Draft configuration); draft_start hydrates it (§7.3.8)'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.drafts SET
      nomination_order = v_new_order,
      updated_at       = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;

    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, auth.uid(),
            'Nomination order changed by ' || public.draft_actor_name()
            || ' at nomination ' || v_draft.current_pick_number
            || ' — the rotation follows the new order from the next nomination.',
            'draft:' || p_draft_id::text, TRUE);

    RETURN jsonb_build_object('draft', to_jsonb(v_draft));
  END IF;

  IF v_draft.status = 'scheduled' THEN
    -- Pre-start: just the stored order — the lobby shows it and
    -- draft_start honors the draft-row candidate (D101/R123).
    UPDATE public.drafts SET
      draft_order = v_new_order,
      updated_at  = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;
  ELSE
    -- E31 (live/paused): completed picks are STORED rows and stay
    -- untouched; remaining picks re-derive mechanically because advance
    -- reads drafts.draft_order. The CURRENT pick's team re-derives NOW; a
    -- CHANGED on-clock team gets a FRESH full clock (it never had the
    -- clock), an unchanged team keeps its running clock. RESIDUAL: a
    -- mid-round edit can leave per-team totals uneven — E31 sanctions it
    -- (see the banner).
    v_new_onclock := public.draft_team_for_pick(
      v_new_order, v_draft.draft_type,
      COALESCE((v_draft.config->>'snake_reversal')::boolean, FALSE),
      v_draft.current_pick_number);

    UPDATE public.drafts SET
      draft_order           = v_new_order,
      on_clock_team_id      = v_new_onclock,
      current_deadline      = CASE
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                     AND status = 'live' AND v_timer > 0
                                THEN now() + make_interval(secs => v_timer)
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                THEN NULL
                                ELSE current_deadline
                              END,
      deadline_remaining_ms = CASE
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                     AND status = 'paused' AND v_timer > 0
                                THEN v_timer * 1000
                                WHEN v_new_onclock IS DISTINCT FROM v_draft.on_clock_team_id
                                     AND status = 'paused'
                                THEN NULL
                                ELSE deadline_remaining_ms
                              END,
      updated_at            = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;
  END IF;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          CASE WHEN v_draft.status = 'scheduled'
            THEN 'Draft order updated by ' || public.draft_actor_name() || '.'
            ELSE 'Draft order changed by ' || public.draft_actor_name()
                 || ' at pick ' || v_draft.current_pick_number
                 || ' — remaining picks follow the new order.'
          END,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft));
END;
$$;

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_set_order(UUID, UUID[], TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_end — head 087 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_end(
  p_draft_id UUID,
  p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft    public.drafts;
  v_voided   INTEGER;
  v_unfilled INTEGER;
  v_filled   INTEGER;
BEGIN
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
    RAISE EXCEPTION 'draft_end: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_end');
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — reaches draft_complete_internal (league_rosters + leagues writes behind its guard, unmeasured from this caller); delete_mock_draft is the served-another-way exit.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_end: a practice cannot be ended early — delete the practice instead (§8.8/E75)'
      USING ERRCODE = 'P0001';
  END IF;

  -- AUCTION ONLY. C41 ruled End Draft for the auction (spec v2.10.1 §8.7);
  -- a snake board that ends early is not a ruled behavior and inventing one
  -- here would be improvising past the spec.
  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_end: this is a % draft — ending early as-is is an auction control (§8.7, ruled v2.10.1); use Reset to wipe a snake draft',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_end: the draft is already complete'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_end: the draft has not started yet — nothing to end'
      USING ERRCODE = 'P0001';
  END IF;
  -- NOT pause-gated (banner item 4): End is terminal, like Reset. The hard
  -- confirm listing the consequences is the UI's (§8.7; L.C3.2).

  -- The leagues row, AFTER the drafts row — 072/069's lock order (drafts →
  -- leagues), never the reverse (the R122 cycle).
  PERFORM 1 FROM public.leagues l
  WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_end: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Unfilled slots counted BEFORE the transition, through the ONE family, so
  -- the post says something true rather than something plausible.
  SELECT COALESCE(SUM(b.open_slots), 0)::int INTO v_unfilled
  FROM public.teams t
  CROSS JOIN LATERAL public.draft_team_budget(p_draft_id, t.id) b
  WHERE t.league_id = v_draft.league_id AND t.status <> 'retired';

  SELECT count(*)::int INTO v_filled
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.is_undone = FALSE;

  -- (3a) Any live nomination is VOIDED, not awarded (C41: "ends as-is").
  -- The high bidder does not get the player and no money moves.
  v_voided := public.draft_void_nomination_internal(p_draft_id);

  -- (3b) The L.C1.4 completion writer's SANCTIONED PARTIAL ENTRY (D160(1)):
  -- rosters from the existing non-undone picks WITH their prices
  -- (acquisition_cost = price — D111(3)/§12.7), unfilled slots simply absent,
  -- drafts.complete + leagues.in_season in this one transaction. The writer
  -- asserts nothing about roster fullness precisely so this call is one line
  -- instead of a second implementation.
  v_draft := public.draft_complete_internal(p_draft_id);

  -- §4 rule 7, pinned rather than asserted in prose: ending spends nothing,
  -- so every team's (remaining, open_slots) pair is exactly what it was and
  -- the invariant carries across untouched.
  IF NOT public.draft_auction_solvent(p_draft_id) THEN
    RAISE EXCEPTION
      'draft_end: auction % was already insolvent (§8.6.8) — refusing to freeze a broken board into rosters',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D97 in-txn post, naming the unfilled-slot count (the task's requirement)
  -- and where those spots go — free agency, §8.7's own wording.
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Draft ended by ' || public.draft_actor_name() || ' — '
          || v_filled || ' players are rostered at their winning prices and '
          || v_unfilled || ' roster spot' || CASE WHEN v_unfilled = 1 THEN '' ELSE 's' END
          || ' stay empty for free agency.'
          || CASE WHEN v_voided > 0
                  THEN ' The live nomination was cancelled un-awarded ('
                       || v_voided || ' bid' || CASE WHEN v_voided = 1 THEN '' ELSE 's' END
                       || ' void, no money moved).'
                  ELSE '' END,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'ended', TRUE,
    'rostered', v_filled,
    'unfilled_slots', v_unfilled,
    'voided_bids', v_voided);
END;
$$;

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_end(UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- draft_reset — head 087 (re-derived at task time, D137). Gate surgery only:
-- the two auth blocks move; every other line is the head's text verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_reset(
  p_draft_id UUID,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft  public.drafts;
  v_undone INTEGER;
BEGIN
  -- LOCK ORDER (banner item 10): the DRAFTS row FIRST — serializing with
  -- in-flight picks — then the LEAGUES row. Taking leagues first would
  -- recreate the R122 FK-KEY-SHARE cycle against a pick in flight.
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
    RAISE EXCEPTION 'draft_reset: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.draft_mock_launcher_gate_internal(v_draft, 'draft_reset');
  -- MS.2/100 — E75: the launcher holds the commissioner's tools on their
  -- own mock (§8.8 v2.15), but THIS control is not cleared through §8.8's
  -- per-control isolation measurement — the ONE live-proven §8.8 breach (writes leagues.status + settings, broadcasts league:<id>); MS.4/D220 owns the mock-safe-variant decision.
  -- It stays shut for everyone, launcher included, behind its own
  -- reason-naming refusal. The retired class sentence ("mock drafts have
  -- no commissioner controls") is FALSE now that draft_set_order is open
  -- and does not return (§4 rule 11); pins re-pointed in 025/036/038 + 048.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_reset: a practice cannot be reset — delete it and start a new one (§8.8/E75)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'complete' THEN
    RAISE EXCEPTION
      'draft_reset: the draft is complete — a post-completion reset is an audited override that arrives with the commissioner console (M6)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_draft.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'draft_reset: the draft has not started — nothing to reset'
      USING ERRCODE = 'P0001';
  END IF;

  -- Now the league row (drafts → leagues — see the banner's lock-order
  -- analysis).
  PERFORM 1 FROM public.leagues l
  WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_reset: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Soft-undo every live pick (§12.4 audit trail; pool return is the
  -- partial index).
  UPDATE public.draft_picks
  SET is_undone = TRUE
  WHERE draft_id = p_draft_id AND is_undone = FALSE;
  GET DIAGNOSTICS v_undone = ROW_COUNT;

  -- 087/R379 — D162 situation (c): THIS RUN'S BID HISTORY ENDS HERE. The
  -- reset rewinds current_pick_number to 1 and draft_start re-issues the same
  -- sequence numbers over rows that are still `voided_at IS NULL`, so leaving
  -- them live merges two runs' nominations under one seq for every reader
  -- keyed on it — the same merge D143 creates within a run, at run scale.
  -- Rows are KEPT and STAMPED, never deleted: §12.5 is append-only and the
  -- previous run's history is audit (the draft_picks soft-undo above is the
  -- same posture, one table over). A direct sweep rather than
  -- draft_void_nomination_internal, because that helper voids the LIVE
  -- nomination only (by seq + player) and what ends here is the whole run.
  -- NOT restricted to auctions: a snake draft simply has no draft_bids rows,
  -- so the statement is a measured no-op there rather than a branch.
  UPDATE public.draft_bids SET voided_at = now()
  WHERE draft_id = p_draft_id AND voided_at IS NULL;

  -- The system post BEFORE the drafts-row context anchor changes nothing —
  -- same txn; written first so the room's transcript reads
  -- action-then-state.
  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Draft reset by ' || public.draft_actor_name() || ' — ' || v_undone
          || ' picks cleared; the draft is back to scheduled. Re-schedule it in Draft setup or start it manually when ready.',
          'draft:' || p_draft_id::text, TRUE);

  -- The drafts row back to pre-draft. draft_order KEPT (D101 — the shown
  -- order survives a reset; manual/custom orders are not lost).
  UPDATE public.drafts SET
    status                = 'scheduled',
    current_round         = 1,
    current_pick_number   = 1,
    on_clock_team_id      = NULL,
    current_deadline      = NULL,
    paused_at             = NULL,
    deadline_remaining_ms = NULL,
    started_at            = NULL,
    completed_at          = NULL,
    -- 087/L.C1.5 — R302, the auction-hygiene half. Without these two a reset
    -- mid-BIDDING resurrects a ghost nomination on restart (D126's phase rule
    -- reads current_nomination, and draft_start does not clear it), and the
    -- league restarts carrying live-draft budget corrections that belong to
    -- the draft they corrected. §8.7's own row says a reset returns to
    -- pre-draft; these are pre-draft's values. NULL/'{}' on a snake draft too
    -- — they are already that, so the snake path is unchanged.
    current_nomination    = NULL,
    budget_adjustments    = '{}'::jsonb,
    updated_at            = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- Fresh room state: this draft's heartbeats go too (the outage arm's
  -- "supervision established" memory starts clean on a re-run — D108).
  DELETE FROM public.draft_liveness WHERE draft_id = p_draft_id;

  -- League back to 'scheduled' (§8.7's own row; §7.1's re-open arrow; the
  -- D43 guard is indifferent — the snapshot survives) AND the stored
  -- auto-start instant REMOVED — the D107(5) seam closure: a PAST
  -- draft_scheduled_at would re-start this draft on the next 5s tick
  -- (D94). Auto-start re-arms only when the commissioner re-schedules
  -- through the settings picker; the Start button works without an
  -- instant (066 create-if-absent).
  UPDATE public.leagues SET
    status     = 'scheduled',
    settings   = settings #- '{draft,draft_scheduled_at}',
    updated_at = now()
  WHERE id = v_draft.league_id;

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'reset', TRUE,
    'picks_cleared', v_undone);
END;
$$;

-- §4.1 posture restated after the replace (093/095 precedent).
REVOKE EXECUTE ON FUNCTION draft_reset(UUID, TEXT) FROM PUBLIC, anon;
