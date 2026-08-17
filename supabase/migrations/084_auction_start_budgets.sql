-- ============================================================================
-- Auction budget derivation family + draft_start's auction arm —
-- migration 084 (task L.C1.2; spec §8.6.1 (budget + max bid), §8.6.8
-- (solvency invariant), §8.3 (nomination order), §7.3.8 (the auction
-- catalog + its validation rules), §12.3; tasks-M3 §4 standing rules
-- (rule 7 solvency doctrine, §4.7 ONE authority), D126/D127/D129(1)/D137,
-- and D91/D94/D95/D101/D105/D43/D64(2) carried unchanged from M2).
-- pgTAP file is **033** (032 = draft_bids; next free confirmed at task
-- time); tests/020's auction start-refusal assertion FLIPS in this PR.
--
-- D137 HEAD RULE — the source of every replaced body, named:
--   * draft_start_internal is replaced from **066_draft_core_rpcs.sql**
--     (the newest migration that defines it — its text at the head of the
--     chain, NOT pg_get_functiondef of whatever is deployed; the CLAUDE.md
--     migration-discipline lesson that migration 073 learned the hard
--     way). Everything outside the auction arm is byte-for-byte 066's
--     body: the R122 lock order, the D63 idempotent re-start, the
--     'scheduled' gate, D94's create-if-absent, the D95 re-hydration, the
--     D96/F45 capacity gate, D101/D105 order resolution, D91 rounds, and
--     the D43/D64(2) snapshot-BEFORE-transition. 020's existing pins on
--     all of them are the regression proof.
--   * draft_start (the auth wrapper), draft_create/_internal,
--     draft_resolve_order_internal, draft_rounds_from_roster,
--     draft_team_for_pick, draft_apply_pick_internal and draft_make_pick
--     are NOT touched here. draft_make_pick's auction refusal STAYS (it
--     is reworded by 085/L.C1.3 — auction drafts pick via nominate/bid).
--   * 068's D94 auto-start arm needs NO edit: it calls
--     draft_start_internal(league, FALSE), which now succeeds for
--     auctions. The auction edition of the D94 no-dead-end pin ships as
--     this task's stack vitest (auction-start-db.test.ts).
--
--   1. THE BUDGET DERIVATION FAMILY (D127 / §4.7 — the ONE authority).
--      Budgets are DERIVED, never stored counters: a counter can drift
--      from truth, a derivation cannot. Every budget-affecting path from
--      085 on (nominate, bid, award, undo, reverse, budget edit, priced
--      reassign/move) reads its numbers HERE, under the draft-row lock,
--      and no path re-implements the arithmetic (tasks-M3 §4 rule 7 —
--      a diff that touches these two functions without extending their
--      pgTAP pins is an automatic review finding).
--
--        draft_team_budget(draft, team) → (remaining, open_slots,
--                                          max_bid, committed)
--          committed  = Σ price of the team's NON-UNDONE picks
--          remaining  = auction_budget + budget_adjustments[team]
--                       − committed                              (D127)
--          open_slots = total_rounds − non-undone picks           (D91:
--                       total_rounds is the auction's per-team roster
--                       capacity = starters + bench, IR excluded — D126)
--          max_bid    = remaining − (open_slots − 1) × min_bid  (§8.6.1's
--                       printed formula; E25's $3/3-slots ⇒ $1 and
--                       §8.6.7(d)'s $1-max team fall out of it)
--        draft_auction_solvent(draft) → ∀ active teams:
--          remaining ≥ open_slots × min_bid                       (§8.6.8)
--
--      Both are STABLE and LOUD (the CLAUDE.md "never let nothing
--      happened mean it worked" rule): a missing draft, a team outside
--      the draft's league, a non-auction draft, an unset total_rounds, or
--      an EMPTY team set each RAISE rather than returning a plausible
--      zero / a vacuous TRUE. draft_auction_solvent over zero teams would
--      be exactly that trap — bool_and over no rows is NULL, and a
--      consumer writing `IF NOT solvent` would sail past a NULL.
--      open_slots = 0 ⇒ max_bid 0 (E27: a complete roster cannot bid) —
--      a semantic rule, not a clamp; max_bid is otherwise UNCLAMPED so an
--      insolvent state stays visible instead of being rounded to zero.
--      NOTE on price: a snake pick's `price` is NULL and contributes 0 to
--      `committed`; 086's award path writes a price on EVERY auction pick
--      (pinned there). These functions are engine internals — triple
--      REVOKE (PUBLIC, anon, authenticated), the 062-form/
--      draft_resolve_order_internal posture: no client consumer exists
--      (the room's budget display derives from the D134 broadcast
--      payloads, pinned TS ≡ SQL by L.C2.1's parity fixture), so the
--      narrow grant costs nothing and keeps the ONE authority
--      server-side. service_role keeps EXECUTE (037's explicit default
--      ACL survives a PUBLIC revoke — the 020 pin's mechanism).
--
--   2. draft_nomination_order_internal — §8.3's auction line
--      ("`nomination_order` is circular; `nomination_order_mode` controls
--      it") resolved per §7.3.8's three modes:
--        same_as_draft_order (the catalog default) → copies the resolved
--          draft order, so §8.3's snake/auction orders agree by
--          construction;
--        random → DELEGATES to 066's draft_resolve_order_internal (the
--          ONE order-resolution implementation — D105's md5 shuffle and
--          D101's candidate-wins rule, no fork) with a DERIVED seed,
--          md5('nomination:' || draft_id)::uuid. The derived seed is
--          load-bearing: passing the draft id itself would make a random
--          nomination order a carbon copy of a random draft order (same
--          seed, same team set, same shuffle) — a "random" mode that
--          silently equals same_as_draft_order. Still deterministic, no
--          wall clock, no random() (D105).
--        manual → the stored drafts.nomination_order must be a
--          permutation of the active team ids (TEXT-compared — the R117
--          lesson), else a friendly P0001. The permutation CHECK is the
--          one thing not delegated: 066's message names
--          `draft_order_mode` and "Draft setup", which would send a
--          commissioner to re-save the wrong order. Error strings are UX
--          (house rule), so this arm carries its own message naming
--          `nomination_order_mode`. The shuffle — the part a fork would
--          actually drift — is NOT duplicated.
--
--   3. draft_start's AUCTION ARM (the 066:640–644 refusal becomes the
--      engine). Every shared gate is unchanged and runs identically for
--      both draft types: the leagues lock, the D63 idempotent re-start,
--      the 'scheduled' gate, create-if-absent, the drafts-row lock BELOW
--      the scheduled gate (R122), D95 re-hydration, the D96/F45 capacity
--      gate (== team_count — the audited draft-short override stays M6's
--      F45), D91 rounds, and the D43/D64(2) snapshot BEFORE the
--      transition. The arm then differs in exactly four places:
--        (a) nomination_order per nomination_order_mode (item 2), stored
--            on the drafts row — snake/linear keep NULL;
--        (b) on_clock_team_id = nomination_order[0] (the first NOMINATOR;
--            draft_team_for_pick is snake/linear's pick-1 math and is not
--            consulted for auctions — D126);
--        (c) current_deadline = now() + auction_nomination_seconds.
--            RECORDED (§7.3.8/§8.2): an untimed `pick_timer_seconds = 0`
--            does NOT null an auction clock. The soft-timer option is the
--            snake pick clock's; nomination (10–120) and bid (10–60)
--            clocks are their own catalog fields with their own floors,
--            so an auction is never untimed and the tick always has a
--            deadline to enforce;
--        (d) current_nomination is set NULL — D126's phase rule: NULL ⇒
--            NOMINATING (on_clock is the nominator, the clock is the
--            nomination clock), non-NULL ⇒ BIDDING. Writing it
--            explicitly also makes a start-after-reset honest (a ghost
--            nomination could otherwise resurrect a bidding phase at
--            pick 1 — 087/R302 clears it from the other side).
--        current_pick_number = 1 doubles as nomination sequence #1
--        (§12.4's "sequence # (auction)", D126); current_round tracks the
--        rotation lap.
--
--   4. THE START-TIME SOLVENCY BACKSTOP (§8.6.8 + §7.3.8's own
--      "enforced in API + DB constraints"; tasks-M3 §4 rule 7). After the
--      transition write, an auction start asserts
--      draft_auction_solvent(draft) through the family above and refuses
--      LOUDLY (whole txn rolls back — nothing partial) when it does not
--      hold. WHY this exists even though the settings layer already
--      blocks under-budget leagues (league-settings.ts:541 — and more
--      conservatively, since its floor counts IR spots while the engine
--      counts D91 draftable slots): 061's own banner records that full
--      §7.3.8 blob-shape validation deliberately STAYS API-side
--      (D68(3)/D69), so the database itself has no auction floor. Without
--      this line a crafted settings write could start an auction whose
--      §8.6.8 invariant is false at t = 0 and every later path — bid,
--      award, undo, budget edit — would inherit an impossible state that
--      the never-weaken invariant is supposed to make unreachable.
--      ZERO false-refusal risk: any league that came through the
--      validated settings path passes the stricter floor already, so this
--      can only fire on a state the app cannot produce (pinned from BOTH
--      sides in 033 — a legal at-the-floor league starts, a below-floor
--      one is refused with the remedy named).
--
-- Grants doctrine (tasks-M1 §4.1, D18→D23; M3 §4 rule 1): no per-object
-- GRANTs. draft_start_internal keeps 066's plain-function + triple-REVOKE
-- posture (its SECURITY DEFINER wrapper draft_start is untouched); the
-- three new functions are SECURITY INVOKER with SET search_path = '' and
-- the same triple REVOKE — no SECURITY DEFINER is created here, so no
-- in-body auth is owed (each new function is only reachable from an
-- already-authorized engine path or from a privileged/service caller).
--
-- Migration checklist (plan §8.1 / tasks-M3 §4.4): no DDL — three new
-- functions plus one CREATE OR REPLACE of an existing one; no table,
-- column, index, policy or data change · no new client-reachable surface
-- (triple REVOKE) · no realtime work (the auction payload extensions are
-- 088/L.C1.6's, D134) · staging rehearsal: **R6 waiver** — no staging
-- clone exists (environments are local + prod only); the recorded
-- rehearsal evidence is the fresh local `npx supabase db reset` replay of
-- the full 001–084 chain in this task's PR plus pgTAP 033 + the flipped
-- 020 in the same PR · **D38 waiver N/A** (no new table) · typegen re-run
-- with the hand-written alias block re-appended (additive-only diff
-- verified in the PR).
--
-- Falsifiability notes (§4.3):
--   * DERIVATION GOLDENS as stored literals per league size/config
--     (033 §D): a fresh 12-team $200 league reads remaining 200,
--     open_slots 15, max_bid 186 per team; a $300/min-2 league reads
--     max_bid 272; a $0-min-bid league reads max_bid = remaining (C38);
--     E25's $3-with-3-slots reads max_bid 1 (§8.6.7(d)).
--     **THE DoD BREAK PROBE, AS RUN (not as predicted):** dropping the
--     `− 1` turned **11 of 033's 66** pins RED — every pin whose tuple
--     carries max_bid (the 12-team golden and its all-twelve-franchises
--     sweep, the $50-buy / undone-row / −$20 / +$25 / per-team-adjustment
--     quadruples, the $300/min-2 golden, the negative-max_bid insolvency
--     pin, E25's $3/3-slots, and the $50/min-3 golden) — plus the stack
--     vitest's wire golden (186 → 185). Everything that does not read
--     max_bid stayed GREEN, including two cases worth naming because they
--     look like coverage and are not: E27's complete-roster tuple (its
--     max_bid comes from the open_slots ≤ 0 branch the probe never
--     reaches) and the C38 min_bid-0 golden (× 0 makes both formulas
--     agree at 200). pgTAP 020's flipped start pin also stayed green — it
--     pins the start SHAPE, not budgets. Reverted; chain re-verified.
--   * SOLVENCY BOTH WAYS (033 §D): true on a fresh start, FALSE the
--     moment a privileged over-spend pick lands (the invariant fn is
--     falsifiable, not decorative), loud on an empty/unknown set.
--   * NOMINATION ORDER, all three modes (033 §C), the random arm pinned
--     as a STORED LITERAL against a fixed draft id (the 020 LK
--     precedent) AND pinned NOT EQUAL to the same draft's random draft
--     order — the derived-seed decision made falsifiable.
--   * 020's auction start-refusal assertion becomes a start-SUCCEEDS pin
--     (live · nominating phase · first nominator · auction deadline
--     despite pick_timer_seconds = 0), and the same file now pins that an
--     unseated auction league gets the CAPACITY refusal — the shared
--     gates provably still gate the auction arm (F45 mirrored).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_team_budget — the ONE budget derivation (D127; §8.6.1)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_team_budget(
  p_draft_id UUID,
  p_team_id UUID
)
RETURNS TABLE (remaining INTEGER, open_slots INTEGER, max_bid INTEGER, committed INTEGER)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_budget     INTEGER;
  v_min_bid    INTEGER;
  v_adjustment INTEGER;
  v_committed  INTEGER;
  v_filled     INTEGER;
  v_open       INTEGER;
  v_remaining  INTEGER;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_team_budget: draft % not found (or not visible)', p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Budgets are an auction concept: a snake board writes no price, so any
  -- number produced here for one would be a plausible-looking fiction.
  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_team_budget: draft % is a % draft — budgets apply to auctions only (§8.6)',
      p_draft_id, v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = p_team_id AND t.league_id = v_draft.league_id
  ) THEN
    RAISE EXCEPTION
      'draft_team_budget: team % is not a franchise in draft %''s league', p_team_id, p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- total_rounds IS the auction's per-team roster capacity (D91/D126); an
  -- unset one would make open_slots NULL and every downstream comparison
  -- silently unknown.
  IF v_draft.total_rounds IS NULL OR v_draft.total_rounds < 1 THEN
    RAISE EXCEPTION
      'draft_team_budget: draft % has no roster capacity (total_rounds is %) — budgets are underivable',
      p_draft_id, COALESCE(v_draft.total_rounds::text, 'unset')
      USING ERRCODE = 'P0001';
  END IF;

  v_budget     := COALESCE((v_draft.config->>'auction_budget')::int, 200);   -- §7.3.8 defaults
  v_min_bid    := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);
  v_adjustment := COALESCE((v_draft.budget_adjustments->>p_team_id::text)::int, 0);  -- D127

  SELECT COALESCE(SUM(p.price), 0)::int, COUNT(*)::int
    INTO v_committed, v_filled
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id
    AND p.team_id = p_team_id
    AND p.is_undone = FALSE;                     -- undone picks refund by derivation (D131)

  v_remaining := v_budget + v_adjustment - v_committed;
  v_open      := v_draft.total_rounds - v_filled;

  RETURN QUERY SELECT
    v_remaining,
    v_open,
    -- §8.6.1: max_bid = remaining − (open_slots − 1) × min_bid. A complete
    -- roster bids nothing at all (E27) — that is the ONLY special case;
    -- the formula is otherwise unclamped so an insolvent state stays
    -- visible to draft_auction_solvent instead of being rounded away.
    CASE WHEN v_open <= 0 THEN 0
         ELSE v_remaining - ((v_open - 1) * v_min_bid) END,
    v_committed;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_team_budget(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. draft_auction_solvent — §8.6.8, the never-weaken invariant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_auction_solvent(p_draft_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_draft   public.drafts;
  v_min_bid INTEGER;
  v_ok      BOOLEAN;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_auction_solvent: draft % not found (or not visible)', p_draft_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_auction_solvent: draft % is a % draft — the solvency invariant applies to auctions only (§8.6.8)',
      p_draft_id, v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  v_min_bid := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);

  SELECT bool_and(b.remaining >= b.open_slots * v_min_bid)
    INTO v_ok
  FROM public.teams t
  CROSS JOIN LATERAL public.draft_team_budget(p_draft_id, t.id) b
  WHERE t.league_id = v_draft.league_id
    AND t.status <> 'retired';                   -- the capacity/order team set

  -- bool_and over zero rows is NULL, and `IF NOT solvent` would sail
  -- straight past a NULL: an empty franchise set must be LOUD, never a
  -- vacuous TRUE (CLAUDE.md — "never let nothing happened mean it
  -- worked").
  IF v_ok IS NULL THEN
    RAISE EXCEPTION
      'draft_auction_solvent: draft % has no active franchises to check — refusing to report solvency over an empty set',
      p_draft_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_ok;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_auction_solvent(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. draft_nomination_order_internal — §8.3's auction line, §7.3.8's three
--    modes (banner item 2 carries the delegation rationale)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_nomination_order_internal(
  p_league_id   UUID,
  p_team_count  INTEGER,
  p_mode        TEXT,
  p_candidate   JSONB,     -- drafts.nomination_order as stored (a pre-start edit)
  p_draft_order JSONB,     -- the RESOLVED draft order (same_as_draft_order's source)
  p_seed        UUID,      -- the draft id; the random arm derives its own seed
  p_label       TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_valid BOOLEAN;
BEGIN
  IF p_mode = 'manual' THEN
    -- Permutation of the active franchises, compared as TEXT (malformed
    -- entries fail validation rather than blowing up a ::uuid cast — the
    -- R117 lesson, same shape as draft_resolve_order_internal's check).
    v_valid := jsonb_typeof(p_candidate) = 'array' AND (
      SELECT count(*) = p_team_count
         AND count(DISTINCT e.val) = p_team_count
         AND bool_and(EXISTS (
               SELECT 1 FROM public.teams t
               WHERE t.league_id = p_league_id
                 AND t.status <> 'retired'
                 AND t.id::text = e.val))
      FROM jsonb_array_elements_text(p_candidate) AS e(val)
    );
    IF NOT v_valid THEN
      RAISE EXCEPTION
        '%: league % has nomination_order_mode=manual but the stored nomination order does not cover every active franchise exactly once — set the nomination order in the commissioner panel, or switch nomination_order_mode to same_as_draft_order (§8.3)',
        p_label, p_league_id
        USING ERRCODE = 'P0001';
    END IF;
    RETURN p_candidate;

  ELSIF p_mode = 'random' THEN
    -- The ONE order-resolution implementation (066/D107(2)): D101's
    -- candidate-wins rule + D105's md5 shuffle, unforked. The seed is
    -- DERIVED from the draft id so a random nomination order is not a
    -- carbon copy of a random draft order (see the banner).
    RETURN public.draft_resolve_order_internal(
      p_league_id,
      p_team_count,
      'random',
      p_candidate,
      NULL,                                        -- no settings fallback: the
                                                   -- catalog has no
                                                   -- nomination_order field
      md5('nomination:' || p_seed::text)::uuid,
      p_label);

  ELSE
    -- 'same_as_draft_order' — the §7.3.8 default, and the fallback for an
    -- unrecognized mode (the catalog enum is closed API-side; this mirrors
    -- draft_start's COALESCE(draft_order_mode, 'random') shape).
    RETURN p_draft_order;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_nomination_order_internal(UUID, INTEGER, TEXT, JSONB, JSONB, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. draft_start_internal — REPLACED FROM 066 (D137 head rule). The auction
--    refusal at 066:640–644 becomes the auction arm; every other line is
--    066's, unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_start_internal(
  p_league_id UUID,
  p_require_commish BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_league       public.leagues;
  v_draft        public.drafts;
  v_config       JSONB;
  v_order        JSONB;
  v_active_count INTEGER;
  v_total_rounds INTEGER;
  v_timer        INTEGER;
  v_first        UUID;
  -- 084 (L.C1.2) additions:
  v_type         TEXT;
  v_nom_order    JSONB;
  v_deadline     TIMESTAMPTZ;
  v_budget       INTEGER;
  v_min_bid      INTEGER;
BEGIN
  SELECT l.* INTO v_league
  FROM public.leagues l
  WHERE l.id = p_league_id AND l.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_start: league % not found', p_league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Re-gate under the league lock (R93); skipped for the system caller
  -- (068's tick — see draft_create_internal's note).
  IF p_require_commish AND NOT public.is_league_commish(p_league_id) THEN
    RAISE EXCEPTION 'draft_start: not a commissioner of this league'
      USING ERRCODE = '42501';
  END IF;

  -- PLAIN read for the idempotent arm — deliberately NOT locked (R122):
  -- taking the drafts-row lock here, while holding the leagues lock, races
  -- an in-flight draft_make_pick into a deadlock cycle — the pick holds the
  -- drafts row (its step 1) and its draft_picks INSERT takes an RI FOR KEY
  -- SHARE on the leagues row (the league_id FK, 065:152), which conflicts
  -- with our leagues lock. Live-proven 40P01 (the batch-2 R122 probe). The
  -- plain read is safe for the no-op arm: creates and starts serialize on
  -- the league lock held above, and the already-started shape's status
  -- truth is the LEAGUE row ('drafting'), read under its own lock.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused');

  -- Idempotent re-start (the D63 same-status class): a double-clicked
  -- Start must not error — even while a pick is mid-flight holding the
  -- drafts-row lock (R122: this arm returns without ever touching it). A
  -- started draft and its league move in ONE txn, so live/paused +
  -- 'drafting' is the only reachable already-started shape.
  IF FOUND AND v_draft.status IN ('live', 'paused') AND v_league.status = 'drafting' THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'started', FALSE);
  END IF;

  IF v_league.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'draft_start: league % is in % — schedule the draft first (League settings → Draft setup), then start it',
      p_league_id, v_league.status
      USING ERRCODE = 'P0001';
  END IF;

  -- CREATE-IF-ABSENT (the D94 no-dead-end principle on the manual path): a
  -- league scheduled purely through the settings surface has no drafts row;
  -- the idempotent create-internal supplies it. Same txn — the league lock
  -- is already held and simply re-entered. p_require_commish FALSE: this
  -- caller's authorization is already established (wrapper fast-fail + the
  -- re-gate above when required).
  IF v_draft.id IS NULL THEN
    PERFORM public.draft_create_internal(p_league_id, FALSE);
  END IF;

  -- NOW lock the draft row — BELOW the 'scheduled' gate (R122): with the
  -- league locked at 'scheduled', no pick's INSERT can be in flight on this
  -- draft (picks require 'live', and start moves draft + league in one txn
  -- under the league lock), so this lock can never complete the
  -- FK-KEY-SHARE cycle described above.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.league_id = p_league_id
    AND d.is_mock = FALSE
    AND d.status IN ('scheduled', 'live', 'paused')
  FOR UPDATE;

  -- Defensive: a live/paused draft under a non-'drafting' league is
  -- unreachable (start moves both in one txn) — refuse LOUDLY rather than
  -- silently resetting a live board to pick 1. (Also catches the
  -- can't-happen empty re-read after create-if-absent.)
  IF v_draft.id IS NULL OR v_draft.status <> 'scheduled' THEN
    RAISE EXCEPTION
      'draft_start: draft % is % while league % is scheduled — inconsistent state; contact support',
      COALESCE(v_draft.id::text, '(missing)'), COALESCE(v_draft.status, '(missing)'), p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- D95: RE-HYDRATE from live settings — the fidelity moment.
  v_config := COALESCE(v_league.settings->'draft', '{}'::jsonb);
  v_type   := COALESCE(v_config->>'draft_type', 'snake');

  -- 084 (L.C1.2): the M2 seam refusal that stood here (066:640–644 —
  -- "the auction engine lands in M3") is GONE; §8.6's engine begins with
  -- this migration. The gates below are shared by both draft types and are
  -- unchanged from 066 — an auction is capacity-gated, snapshot-gated and
  -- rounds-gated exactly like a snake draft.

  -- Capacity (§7.2/D96): every franchise must exist before the draft.
  -- Orphaned seats count (they draft on autopilot — E48); retired do not.
  -- The audited "draft short" override is M6's (F45).
  SELECT count(*) INTO v_active_count
  FROM public.teams t
  WHERE t.league_id = p_league_id AND t.status <> 'retired';
  IF v_active_count <> v_league.team_count THEN
    RAISE EXCEPTION
      'draft_start: league % has % of % franchises seated — every seat must exist before the draft starts; add placeholder seats for the empty slots (League home → Invite) or invite managers (§7.2/D96)',
      p_league_id, v_active_count, v_league.team_count
      USING ERRCODE = 'P0001';
  END IF;

  -- Order resolution (D101/D105/R123/R126) via the ONE implementation
  -- (draft_resolve_order_internal — extracted at L.B1.6 amendment (e),
  -- logic verbatim; 071's create_mock_draft is the second consumer):
  -- candidate = the draft row's stored order (a pre-start randomize/order
  -- edit — it wins so the order the lobby displayed is the order that
  -- drafts), config fallback manual/custom-only, seed = the draft row's
  -- own id, label 'draft_start' (every pinned message unchanged).
  -- An auction resolves it too: `same_as_draft_order` feeds from it, and
  -- the commissioner's pre-draft order surface is one surface (§8.3).
  v_order := public.draft_resolve_order_internal(
    p_league_id,
    v_league.team_count,
    COALESCE(v_config->>'draft_order_mode', 'random'),
    v_draft.draft_order,
    v_config->'draft_order',
    v_draft.id,
    'draft_start');

  -- 084: nomination order (§8.3/§7.3.8) — auction only; snake/linear leave
  -- the column NULL.
  IF v_type = 'auction' THEN
    v_nom_order := public.draft_nomination_order_internal(
      p_league_id,
      v_league.team_count,
      COALESCE(v_config->>'nomination_order_mode', 'same_as_draft_order'),
      v_draft.nomination_order,
      v_order,
      v_draft.id,
      'draft_start');
  END IF;

  -- D91: rounds = starters + bench (IR excluded). For an auction this is
  -- the per-team roster CAPACITY the open-slots math counts down (D126).
  v_total_rounds := public.draft_rounds_from_roster(v_league.roster_settings);
  IF v_total_rounds IS NULL OR v_total_rounds < 1 THEN
    RAISE EXCEPTION
      'draft_start: league % roster settings produce no draftable rounds (rounds = starters + bench, D91) — fix the roster in League settings',
      p_league_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Clock + first seat, per draft type.
  IF v_type = 'auction' THEN
    -- §7.3.8's own clocks. An untimed pick_timer_seconds = 0 (§8.2's soft
    -- timer) does NOT null this one — see the banner, item 3(c).
    v_deadline := now() + make_interval(
      secs => COALESCE((v_config->>'auction_nomination_seconds')::int, 30));
    v_first    := (v_nom_order->>0)::uuid;        -- the first NOMINATOR (D126)
  ELSE
    v_timer    := COALESCE((v_config->>'pick_timer_seconds')::int, 90);
    v_deadline := CASE WHEN v_timer > 0
                       THEN now() + make_interval(secs => v_timer)
                       ELSE NULL END;             -- §8.2 soft timer: 0 ⇒ no clock
    v_first    := public.draft_team_for_pick(
      v_order, v_type,
      COALESCE((v_config->>'snake_reversal')::boolean, FALSE), 1);
  END IF;

  -- Snapshot BEFORE the transition (D43/D64(2)): we are in 'scheduled' —
  -- exactly 059's sanctioned window. A league that cannot snapshot (no
  -- scoring reference) fails LOUDLY here and nothing below runs; the D43
  -- trigger on the leagues UPDATE is the backstop either way. The INTERNAL
  -- (059, amended alongside 068): the wrapper's commissioner gate would
  -- refuse the cron auto-start caller (no JWT) — this caller's
  -- authorization is already established (see the re-gate above).
  PERFORM public.snapshot_league_scoring_internal(p_league_id);

  UPDATE public.drafts SET
    status               = 'live',
    draft_type           = v_type,
    config               = v_config,
    draft_order          = v_order,
    nomination_order     = v_nom_order,  -- auction only; NULL for snake/linear
    current_nomination   = NULL,         -- D126: NULL ⇒ NOMINATING phase
    total_rounds         = v_total_rounds,
    current_round        = 1,
    current_pick_number  = 1,            -- doubles as nomination seq 1 (D126)
    on_clock_team_id     = v_first,
    current_deadline     = v_deadline,
    paused_at            = NULL,
    deadline_remaining_ms = NULL,
    started_at           = now(),
    completed_at         = NULL,
    updated_at           = now()
  WHERE id = v_draft.id
  RETURNING * INTO v_draft;

  -- 084: the §8.6.8 start-time backstop (banner item 4) — read through the
  -- ONE derivation family, on the LIVE row, before the league transitions.
  IF v_type = 'auction' AND NOT public.draft_auction_solvent(v_draft.id) THEN
    v_budget  := COALESCE((v_config->>'auction_budget')::int, 200);
    v_min_bid := COALESCE((v_config->>'auction_min_bid')::int, 1);
    RAISE EXCEPTION
      'draft_start: league % cannot start an auction — a $% budget cannot fill % roster spots at a $% minimum bid (§8.6.8 solvency); raise the auction budget or lower the minimum bid in League settings → Draft setup',
      p_league_id, v_budget, v_total_rounds, v_min_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- draft_start's OWN transition under the D43 guard (059's banner: M2
  -- removes the M1 refusal only via this path — set_league_status is NOT
  -- widened).
  UPDATE public.leagues
  SET status = 'drafting', updated_at = now()
  WHERE id = p_league_id;

  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'started', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_start_internal(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
