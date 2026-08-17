-- ============================================================================
-- The serialized auction core: draft_nominate + draft_place_bid —
-- migration 085 (task L.C1.3; spec §8.1 (the five-step action contract),
-- §8.6.2–§8.6.4 (nomination, open bidding, the bid clock), §8.6.7(a)/(c)/(d)
-- (endgame: afford-your-own-opening, complete rosters skipped, the $1-max
-- team), §8.6.8 (solvency — enforced HERE as the max-bid clause), §12.5
-- (draft_bids), E2/E5/E6/E25/E27; tasks-M3 §4 standing rules (rule 6 lock
-- discipline, rule 7 solvency doctrine, rule 8 bid-path discipline),
-- D126/D128/D129(1)/D130-context/D131(3)-context/D136/D137).
-- pgTAP file is **034** (033 = the derivation family; next free confirmed at
-- task time); tests/020's `draft_make_pick` auction-refusal assertion is
-- REWORDED in this PR (item 3).
--
-- D137 HEAD RULE — the source of the one replaced body, named:
--   * draft_make_pick is replaced from **066_draft_core_rpcs.sql**
--     (066:856–1023 — the newest migration that defines it; 084 replaced
--     draft_start_internal and did NOT touch this function). EVERY LINE is
--     066's except TWO hunks (R335 — the first wording said one and was
--     off by one): the single RAISE message at 066:941–943, and a
--     five-line comment block inserted above it naming this migration as
--     the rewording's source. Every gate, guard and write is
--     byte-identical. The refusal
--     STAYS — an auction draft never picks through this RPC — it only
--     stops promising a milestone that has arrived: "the auction engine
--     lands in M3" becomes "auction drafts pick via nominate and bid",
--     which is true forever and tells the caller what to do instead.
--   * draft_start_internal (084), draft_apply_pick_internal, draft_tick
--     (068), the commissioner controls (069) and the derivation family
--     (084) are NOT touched here.
--
--   1. draft_nominate(draft, player, opening_bid, action_id) — §8.6.2.
--      The §8.1 five-step contract, in order: (1) LOCK the drafts row
--      FOR UPDATE — the ONE serializer for this draft (§8.1/rule 6; D136
--      records that M3 adds no route-layer limiter, so this lock is what
--      makes a bid storm correct); (2) VALIDATE; (3) WRITE the opening
--      `draft_bids` row; (4) ADVANCE — open the bidding phase and set the
--      bid deadline; (5) RETURN the new authoritative state.
--      VALIDATION ORDER and why: membership (42501, no-leak — a missing
--      draft and a non-member answer identically) → soft-deleted league
--      (P0002, the 063 rule) → E2 replay → mock seam → draft type →
--      status → PHASE (D126: current_nomination NULL ⇒ nominating) → turn
--      → player exists → player undrafted → CAPACITY fit → opening ≥
--      min_bid → opening ≤ MY max_bid. Capacity is checked BEFORE the bid
--      bounds deliberately: a complete roster reads max_bid 0 (084's E27
--      branch), so bounds-first would refuse a full team with a confusing
--      "over your max bid of $0" instead of the true reason.
--      MY-TURN = the caller manages `on_clock_team_id` (M1's access
--      model, exactly draft_make_pick's rule). There is NO commissioner
--      bypass here — force-nominate is 087/L.C1.5's own verb (R301).
--      CAPACITY-ONLY FIT (D129(1), the v2.8.11 manual-pick rule extended):
--      open_slots ≥ 1 is the whole roster test — humans may buy a third
--      QB; need-fit is the SYSTEM path's rule (§8.4), not a human's.
--
--   2. draft_place_bid(draft, amount, action_id,
--                      nomination_seq DEFAULT NULL,
--                      player_id DEFAULT NULL) — §8.6.3.
--      Same five steps, same order. VALIDATE: membership → league →
--      E2 replay → mock seam → type → status → PHASE (bidding requires a
--      live nomination) → NOMINATION IDENTITY (the two optional args,
--      R330 — see below) → the caller's franchise → not already the high
--      bidder (a self-raise is a mis-click, never a legal bid — it would
--      let a manager bid against himself to burn the clock) → open_slots
--      ≥ 1 (E27: a complete roster cannot bid) → amount > high_bid
--      (integer raises: the minimum legal raise is high_bid + 1, which is
--      also what keeps a $0 opening in a min_bid-0 league from being
--      "raised" to $0 — C38/C40) → amount ≤ MY max_bid (E5/§8.6.7(d)).
--      THE MAX-BID CLAUSE IS §8.6.8's ENFORCEMENT POINT AT THE BID LAYER
--      (rule 7): bids never move money — only a won pick does (D131(2)) —
--      so the invariant cannot be violated BY a bid; it is violated by an
--      AWARD of a bid that was too large. max_bid = remaining −
--      (open_slots − 1) × min_bid is precisely the largest amount whose
--      award leaves remaining' = remaining − amount ≥ (open_slots − 1) ×
--      min_bid = open_slots' × min_bid. Refusing above it is therefore
--      what makes 086's award solvency-preserving by construction, and
--      034 pins exactly that algebra: an award AT max_bid keeps
--      draft_auction_solvent TRUE, an award ONE DOLLAR ABOVE it makes it
--      FALSE (the D146 one-unit-short doctrine applied to the clause this
--      RPC exists to enforce). Every number comes from the ONE derivation
--      family (084 — `draft_team_budget`); no path here re-implements the
--      arithmetic (§4.7).
--      ANTI-SNIPE (D128, RULED by Chris 2026-08-15 — the fixed-window
--      reading): the bid clock is a FIXED window opened at nomination
--      (`auction_bid_seconds`) and bids do NOT reset it; a bid landing
--      when less than `auction_anti_snipe_seconds` remain resets the
--      remaining time TO `auction_anti_snipe_seconds` (E6: 3s left,
--      threshold 10 ⇒ the clock reads 10s), repeatable. Implemented as
--        deadline := GREATEST(deadline, now() + anti_snipe)   when anti > 0
--      which is the same rule written so that the clock can only ever be
--      EXTENDED, never shortened: above the threshold GREATEST keeps the
--      standing deadline (the countdown continues uninterrupted — Chris's
--      explicit clarification), at the threshold the two are equal, and
--      below it the floor wins. `auction_anti_snipe_seconds = 0` disables
--      extension entirely (a pure fixed window) and is written as its OWN
--      BRANCH rather than relying on GREATEST.
--      WHAT THE ZERO BRANCH ACTUALLY BUYS (R329 — the first wording was
--      arithmetically FALSE and is corrected here): at anti_snipe 0 the
--      two forms agree on every LIVE deadline, because
--      `now() + make_interval(secs => 0)` IS now() and GREATEST of a
--      future deadline and now() is that deadline. They differ ONLY when
--      the standing deadline is not in the future — an ALREADY-EXPIRED
--      one (a bid that beat the tick to the row), which an unconditional
--      GREATEST would REWRITE forward to exactly now(), and a NULL one,
--      which GREATEST (which ignores NULLs) would INVENT out of nothing.
--      Neither is "a fresh now()-based clock"; both are a disabled
--      extension touching a clock it has no business touching. 034 §I
--      pins the expired case on both sides of the branch.
--      THE COUNTERPART, DELIBERATE AND NOW RECORDED (R329 — previously
--      silent): with anti_snipe > 0 a bid landing AFTER the clock already
--      read zero receives a FULL FRESH WINDOW (`now() + anti_snipe`),
--      because GREATEST(expired, now() + anti) is the latter. That is
--      D128's letter — the floor is "reset the remaining time TO
--      anti_snipe" — and it is consistent with snake's posture that the
--      TICK is the enforcer of expiry, not the deadline column: a bid
--      that reaches the locked row before the tick closes the nomination
--      is a legal bid. Pinned in 034 §I.
--      All arithmetic is SERVER-side (`now()` = the transaction instant —
--      rule 8: "anti-snipe arithmetic uses server timestamps only").
--
--   3. THE OPENING BID IS A `draft_bids` ROW (the E2 mechanism, recorded).
--      `draft_nominate` writes the opening bid to `draft_bids` exactly
--      like a raise — one uniform history, which is what §12.5's table
--      and the room's bid feed both read, and what makes the E2 replay
--      arm identical for both RPCs: the REPLAY LOOKUP IS A SELECT ON
--      (draft_id, action_id) UNDER THE DRAFT LOCK — the house pattern
--      (066:917's pick replay), NOT an upsert. That choice is forced as
--      well as preferred: `uniq_draft_bid_action` is a PARTIAL unique
--      index (`WHERE action_id IS NOT NULL`, C39 — system rows carry
--      NULL), and a bare `ON CONFLICT (draft_id, action_id)` arbiter does
--      not match a partial index — it raises 42P10 at runtime, proven
--      under savepoints on the shipped schema (M3 batch-1 review, R310 /
--      D144(7); the 083 banner and the index itself carry the same note).
--      Replay semantics inherit R125 verbatim: an action_id is consumed
--      FOREVER, with no is_undone/phase filter — a stale retry returns
--      its original row plus the CURRENT authoritative draft state and
--      never re-applies anything.
--
--   4. WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--      * It never closes a nomination. Bid-clock expiry, the E26 no-raise
--        award, rotation advance (E27 skip) and completion are 086/L.C1.4
--        (tick ARM 2.6, D130). Nothing here writes `draft_picks`, so
--        nothing here moves a budget.
--      * It never advances `current_pick_number`. That column doubles as
--        the nomination sequence (D126/§12.4) and only the award advances
--        it — so every bid on one nomination shares one `nomination_seq`,
--        which is what `idx_draft_bids_nom` is ordered for.
--      * No system/tick path exists here: 086's system nomination
--        (D129(2)) is the second consumer, and the L.B1.3 precedent says
--        an internal gets EXTRACTED when the second consumer arrives, not
--        speculatively before. 086 must keep the invariant this migration
--        establishes — every nomination opens with a `draft_bids` row
--        (action_id NULL for the system path, which is exactly why C39
--        made the column NULLable) — and pin it in 035. Ledger row F62.
--      * MOCK AUCTIONS ARE REFUSED (a seam, in the 066/071 style). No
--        auction mock can exist today — 071's `create_mock_draft` refuses
--        auction configs and a mock's `draft_type` is snapshotted at
--        creation — so this refusal is unreachable, and that is the
--        point: the moment 089/L.C1.7 lifts the 071 refusal, the D103(2)
--        launcher rule and the human-seat rule (D138: "the launcher is
--        the only legal human nominator/bidder") must already govern
--        these two RPCs, and a bidder-team resolution for mock seats is
--        L.C1.7's design (CPU seats bid through the tick, D132). Leaving
--        the path SILENT until then would mean any league member could
--        bid inside another member's solo practice on the day 089 lands.
--        The two 034 pins flip in that PR — ledger row F61.
--
--   4a. NOMINATION IDENTITY ON THE BID PATH (R330 — added in the M3
--      batch-3 fix cycle, before this migration ever merged). A bid names
--      an AMOUNT and nothing else, so a bid in flight across a nomination
--      boundary was silently applied to whatever player was live when it
--      EXECUTED: proven on 034's own fixture — t3 nominated p09 at $1
--      (nomination 2) and a $40 bid intended for p01 (nomination 1) was
--      ACCEPTED against p09. `draft_place_bid` therefore takes two
--      OPTIONAL identity arguments — `p_nomination_seq` and `p_player_id`
--      — and refuses on mismatch with §16.3's "just went off the board"
--      copy. Both are checked and neither subsumes the other (D143's
--      cancel-and-renominate reuses a sequence number with a different
--      player; an undone award returns a player to the pool at a LATER
--      sequence). Omitted ⇒ shipped behavior, so no caller breaks; the
--      ROUTE must always send them — F64, and the read-list line on
--      tasks-M3 §6 L.C2.1. The guard lives in the RPC and not the route
--      because this is the server-authoritative boundary (spec §4/§8.1):
--      the sim, the pgTAP suite and every future caller must be safe, and
--      L.C1.4's completion path awards on exactly this data.
--
--   5. RECORDED RESIDUAL (no bespoke message): a RETIRED seat's manager
--      who reached a bid path would get 084's loud P0002 from
--      `draft_team_budget` ("not an ACTIVE franchise … retired seats are
--      outside the §8.6.8 team set", R321) rather than a bespoke refusal.
--      Deliberate: retirement is M4's (`retire_franchise`), a retired seat
--      is outside the nomination rotation and the invariant's team set,
--      and a loud, honest raise beats inventing UX copy for a state this
--      milestone cannot produce.
--
--   6. RECORDED RESIDUAL — THE E2 REPLAY LOOKUP IS VERB-BLIND, BY
--      CONSTRUCTION (R331; ledger row F65). Both verbs replay on
--      `(draft_id, action_id)` with no verb discrimination, so an
--      action_id consumed by one verb returns a false success through the
--      other: proven live — a member called `draft_nominate` with another
--      manager's RAISE action_id during the BIDDING phase and got a
--      SUCCESS payload carrying that raise row (no write, no refusal).
--      THE CONTRACT, therefore, is per-verb: **an action_id is minted per
--      user gesture and is NEVER shared across verbs.** It is enforced at
--      the MINT SITE (L.C2.1's routes — F65 carries the obligation and
--      the pin), not here, and the three in-body shapes were each
--      considered and rejected for a stated reason:
--        (a) NARROWING the lookup (e.g. `AND team_id = v_my_team`) is
--            forbidden — the lookup being unqualified is precisely what
--            makes a duplicate action_id impossible to insert under the
--            same FOR UPDATE, which is why no `EXCEPTION WHEN
--            unique_violation` wrapper is owed around the inserts.
--            Narrowing re-opens a raw 23505 on `uniq_draft_bid_action`.
--        (b) ARGUMENT-CONSISTENCY discrimination (refuse when the
--            replayed row disagrees with the arguments) contradicts R125,
--            which is settled law: an action_id is consumed forever and a
--            stale retry returns its original row — 034's two E2 pins
--            deliberately replay with DIFFERENT arguments and assert the
--            original row comes back.
--        (c) POSITION-based verb inference ("an opening row is the
--            earliest row of its nomination_seq") is not durable: D143's
--            `draft_cancel_nomination` (087/L.C1.5) does NOT consume the
--            sequence number, so a re-nomination writes a second opening
--            under an existing seq and the rule would FALSE-REFUSE a
--            legitimate reconnect retry — a worse bug than the one it
--            closes.
--      A verb column on `draft_bids` would settle it exactly; that is a
--      schema change to L.C1.1's table and is recorded as the option
--      rather than taken here (no DDL in this migration).
--
-- SQLSTATE conventions (063, carried verbatim): 42501 auth/no-leak ·
-- P0002 → 404 · P0001 friendly (every refusal a manager can hit in the
-- room) · 22023 argument shape. Error strings are UX (§8.3 checklist) —
-- the max-bid refusals name the formula's own number and the money that
-- produced it, and the race loser gets "outbid at $N", never a 429
-- (D136).
--
-- Grants doctrine (tasks-M1 §4.1, D18→D23; M3 §4 rule 1): no per-object
-- GRANTs. Both new RPCs are SECURITY DEFINER — they write append-only
-- `draft_bids` rows that carry NO client write policy (083) — so each
-- carries in-body authorization (is_league_member + the turn/franchise
-- check), `SET search_path = ''`, and `REVOKE … FROM PUBLIC, anon`
-- (`authenticated` KEEPS EXECUTE: these are the room's own verbs, called
-- through L.C2.1's routes — the draft_make_pick posture exactly).
--
-- Migration checklist (plan §8.1 / tasks-M3 §4.4): no DDL — two new
-- functions plus one CREATE OR REPLACE of an existing one; no table,
-- column, index, policy or data change · no new realtime surface (the
-- `draft_bids` broadcast trigger is 088/L.C1.6's, D134 — a bid landing
-- today reaches no subscriber, which is why L.C2.1's room work depends on
-- 088 as well) · staging rehearsal: **R6 waiver** — no staging clone
-- exists (environments are local + prod only); the recorded rehearsal
-- evidence is the fresh local `npx supabase db reset` replay of the full
-- 001–085 chain in this task's PR plus pgTAP 034 + the reworded 020 in
-- the same PR · **D38 waiver N/A** (no new table) · typegen re-run with
-- the hand-written alias block re-appended (additive-only diff verified
-- in the PR).
--
-- Falsifiability notes (§4.3) — every claim below was RUN, not predicted
-- (the R306/R314 lesson):
--   * **BREAK PROBE 1 (the DoD's own), AS RUN:** dropping the max-bid
--     clause from `draft_place_bid` (the `IF p_amount > v_max_bid` arm)
--     turned **6 of 034's 91** pins RED — the three bid-side E5 /
--     §8.6.7(d) refusals (pin 48: $187 against a $186 max; pin 81: E25's
--     $2 against a $1-max seat; pin 87: the same at min_bid 0), the two
--     population COUNTS that catch the bids which then landed (pins 66
--     and 88), and pin 89, the PROPERTY the clause exists for: "no bid
--     above its bidder's max bid exists in history", which is what 086's
--     award is built on.
--     Named so nobody counts them as coverage they are not: the
--     NOMINATION-side max-bid pins stayed GREEN (29 and 79 — they are
--     `draft_nominate`'s own §8.6.7(a) clause, a separate arm the probe
--     never touches), as did every phase/turn/identity/raise/anti-snipe/
--     E2 pin and §G's solvency-consequence pair (privileged award
--     simulations that never route through the probed function). The wire
--     suite `auction-core-db.test.ts` failed **2 of 3** under the same
--     probe. Reverted; 91/91 and 3/3 re-verified.
--   * **BREAK PROBE 2 (R330's guard), AS RUN:** removing the two
--     nomination-identity checks turned **5 of 91** RED — pins 44 and 45
--     (both refusal arms: the stale bids are ACCEPTED against the live
--     nomination instead), pin 46 (nomination 2 holds 5 rows where 3
--     belong) and the two population counts 66 and 88. Pin 43 (the
--     matching-identity ACCEPTANCE) stayed GREEN by construction — a
--     guard that does nothing still lets a correct bid through, which is
--     why the refusal arms are the discriminators. Reverted; 91/91.
--   * **BREAK PROBE 3 (R329's zero branch), AS RUN:** replacing the
--     branch with an unconditional
--     `GREATEST(current_deadline, now() + make_interval(secs => anti))`
--     turned **exactly 1 of 91** RED — pin 61, the already-expired
--     deadline at anti_snipe 0. Pin 60 (the shipped anti_snipe-0 pin with
--     1s left) stayed GREEN, which was the review finding: it advertised
--     a mutation it could not detect, because at anti_snipe 0 the two
--     forms agree on every live deadline. Reverted; 91/91.
--   * **ONE-UNIT-SHORT COVERAGE (D146, the R320 doctrine) — every ≥/≤
--     comparison this migration makes carries a pin that is false by
--     exactly one unit of the thing compared:**
--       opening ≥ min_bid       → min_bid − 1 refused / min_bid accepted
--                                 (and, at min_bid 0, −$1 refused / $0
--                                 accepted — C38's degenerate floor)
--       opening ≤ max_bid       → max_bid accepted / max_bid + 1 refused
--       amount  > high_bid      → high_bid refused / high_bid + 1 accepted
--       amount  ≤ max_bid       → max_bid accepted / max_bid + 1 refused
--                                 (E25: the $1-max team bids exactly $1,
--                                 and $2 is refused)
--       open_slots ≥ 1          → 1 slot bids / 0 slots refused (E27)
--       remaining < anti_snipe  → threshold − 1s FLOORS the clock,
--                                 threshold + 1s does NOT, threshold
--                                 exactly is a no-op (the boundary
--                                 instant, pinned to the second) — plus
--                                 the EXPIRED-deadline pair that
--                                 discriminates the zero branch (R329)
--       nomination identity     → mismatched player refused / mismatched
--                                 seq refused / matching accepted /
--                                 omitted unchanged (R330)
--     A clause loosened or tightened by one dollar/slot/second therefore
--     cannot pass 034.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_nominate — §8.6.2, the five-step contract
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_nominate(
  p_draft_id UUID,
  p_player_id TEXT,
  p_opening_bid INTEGER,
  p_action_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_bid           public.draft_bids;
  v_my_team       UUID;
  v_on_clock_name TEXT;
  v_player_name   TEXT;
  v_live_name     TEXT;
  v_min_bid       INTEGER;
  v_bid_seconds   INTEGER;
  v_remaining     INTEGER;
  v_open          INTEGER;
  v_max_bid       INTEGER;
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_player_id IS NULL OR btrim(p_player_id) = '' THEN
    RAISE EXCEPTION 'draft_nominate: player_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_opening_bid IS NULL THEN
    RAISE EXCEPTION 'draft_nominate: opening_bid is required — a nomination always names its opening bid (§8.6.2)'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'draft_nominate: action_id is required — client nominations are idempotent (§8.1/E2)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the drafts row FIRST (§4.6 rule 6). The league row is
  -- deliberately NOT locked (066's lock-order note: the leagues lock is
  -- draft_start's, and taking it here would re-open the R122 cycle).
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. No-leak: a nonexistent draft and a non-member get the
  -- same 42501 (is_league_member(NULL) is FALSE).
  IF NOT FOUND OR NOT public.is_league_member(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_nominate: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'draft_nominate: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E2 replay short-circuit — BEFORE status/phase/turn checks, so a
  -- retried nomination is a no-op even after the clock has moved on
  -- (§8.1 idempotency; R125: an action_id is consumed forever, no
  -- filters). The mechanism is the OPENING BID ROW this RPC writes — the
  -- select-then-insert house pattern (066:917), never an ON CONFLICT
  -- arbiter against the PARTIAL uniq_draft_bid_action (42P10 — R310).
  SELECT b.* INTO v_bid
  FROM public.draft_bids b
  WHERE b.draft_id = p_draft_id AND b.action_id = p_action_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
  END IF;

  -- Mock seam (banner item 4): unreachable today — 071 refuses auction
  -- mocks — and lifted by 089/L.C1.7 together with the D103(2) launcher
  -- gate and the CPU bidders. F61.
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_nominate: mock auctions are not open yet — solo practice against CPU bidders lands with the mock auction arm (§8.8/D138)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_nominate: this is a % draft — only auction drafts nominate (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'scheduled' THEN
    RAISE EXCEPTION 'draft_nominate: the draft has not started yet'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'paused' THEN
    RAISE EXCEPTION 'draft_nominate: the draft is paused'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_nominate: the draft is complete'
      USING ERRCODE = 'P0001';
  END IF;

  -- PHASE (D126): current_nomination NULL ⇒ nominating. A non-NULL one
  -- means bidding is live — the caller wants draft_place_bid.
  IF v_draft.current_nomination IS NOT NULL THEN
    SELECT pl.full_name INTO v_live_name
    FROM public.players pl
    WHERE pl.id = v_draft.current_nomination->>'player_id';
    RAISE EXCEPTION
      'draft_nominate: bidding is already open on % at $% — place a bid instead of nominating (§8.6.3)',
      COALESCE(v_live_name, 'the nominated player'),
      COALESCE(v_draft.current_nomination->>'high_bid', '0')
      USING ERRCODE = 'P0001';
  END IF;

  -- TURN: the caller manages the on-clock (nominating) team — M1's access
  -- model, draft_make_pick's rule verbatim. Commissioners use 087's
  -- force-nominate path (R301); no role bypass exists here.
  SELECT m.team_id INTO v_my_team
  FROM public.league_members m
  WHERE m.league_id = v_draft.league_id AND m.user_id = auth.uid();
  IF v_my_team IS NULL OR v_my_team IS DISTINCT FROM v_draft.on_clock_team_id THEN
    SELECT t.name INTO v_on_clock_name
    FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;
    RAISE EXCEPTION
      'draft_nominate: it is not your turn to nominate — % is on the clock',
      COALESCE(v_on_clock_name, 'another team')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_nominate: player % not found', p_player_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Availability under the lock (the E1 shape, nomination edition): a
  -- player already bought cannot be nominated again. uniq_draft_player_live
  -- is the backstop at the AWARD (086), which is the only writer of
  -- draft_picks on this path.
  IF EXISTS (
    SELECT 1 FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id
      AND p.player_id = p_player_id
      AND p.is_undone = FALSE
  ) THEN
    RAISE EXCEPTION
      'draft_nominate: % just went off the board — nominate another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END IF;

  -- The ONE budget authority (084/D127/§4.7). Capacity FIRST (see the
  -- banner): a complete roster reads max_bid 0, so bounds-first would
  -- refuse it with the wrong reason.
  SELECT b.remaining, b.open_slots, b.max_bid
    INTO v_remaining, v_open, v_max_bid
  FROM public.draft_team_budget(p_draft_id, v_my_team) b;

  IF v_open < 1 THEN
    RAISE EXCEPTION
      'draft_nominate: your roster is complete — complete rosters are skipped in the nomination rotation and cannot bid (§8.6.7(c)/E27)'
      USING ERRCODE = 'P0001';
  END IF;

  v_min_bid     := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);
  v_bid_seconds := COALESCE((v_draft.config->>'auction_bid_seconds')::int, 20);

  IF p_opening_bid < v_min_bid THEN
    RAISE EXCEPTION
      'draft_nominate: an opening bid of $% is below this league''s $% minimum bid (§7.3.8)',
      p_opening_bid, v_min_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- §8.6.7(a): the nominator must be able to afford their own opening bid
  -- — which is what makes §8.6.7(b)'s no-raise award (E26) always legal.
  -- The message names the formula's number AND the money behind it.
  IF p_opening_bid > v_max_bid THEN
    RAISE EXCEPTION
      'draft_nominate: an opening bid of $% is over your max bid of $% — you have $% for % open roster spots at a $% minimum bid (§8.6.7(a))',
      p_opening_bid, v_max_bid, v_remaining, v_open, v_min_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) WRITE. The opening bid is a draft_bids row like any other (banner
  -- item 3): one uniform history, one E2 mechanism, one feed.
  INSERT INTO public.draft_bids
    (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
  VALUES
    (p_draft_id, v_draft.league_id, v_draft.current_pick_number,
     p_player_id, v_my_team, p_opening_bid, p_action_id)
  RETURNING * INTO v_bid;

  -- (4) ADVANCE: open the BIDDING phase (D126) and start the bid clock.
  -- current_pick_number is NOT advanced — it is this nomination's
  -- sequence number until the award (086). on_clock_team_id stays the
  -- NOMINATOR through bidding: it is the seat the rotation advances FROM
  -- (D130) and the room's "X nominated" attribution.
  UPDATE public.drafts SET
    current_nomination = jsonb_build_object(
                           'player_id', p_player_id,
                           'high_bid', p_opening_bid,
                           'high_bidder_team_id', v_my_team),
    current_deadline   = now() + make_interval(secs => v_bid_seconds),
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- (5) RETURN the new authoritative state.
  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_nominate(UUID, TEXT, INTEGER, UUID)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 2. draft_place_bid — §8.6.3/§8.6.4 (open bidding + the anti-snipe floor)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_place_bid(
  p_draft_id UUID,
  p_amount INTEGER,
  p_action_id UUID,
  p_nomination_seq INTEGER DEFAULT NULL,
  p_player_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_bid           public.draft_bids;
  v_my_team       UUID;
  v_on_clock_name TEXT;
  v_high_name     TEXT;
  v_high_bid      INTEGER;
  v_high_team     UUID;
  v_player_id     TEXT;
  v_live_name     TEXT;
  v_stale_name    TEXT;
  v_min_bid       INTEGER;
  v_anti_snipe    INTEGER;
  v_deadline      TIMESTAMPTZ;
  v_remaining     INTEGER;
  v_open          INTEGER;
  v_max_bid       INTEGER;
BEGIN
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'draft_place_bid: amount is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'draft_place_bid: action_id is required — client bids are idempotent (§8.1/E2)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK — the serializer for the hottest path in the app (§22.1's
  -- burst row; D136: no route-layer limiter in M3, the lock is the
  -- answer).
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE.
  IF NOT FOUND OR NOT public.is_league_member(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_place_bid: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'draft_place_bid: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E2 replay short-circuit (identical mechanism to draft_nominate's —
  -- banner item 3): the double-tapped bid returns its own row, never a
  -- second raise. This is THE reason a flaky network cannot bid twice.
  SELECT b.* INTO v_bid
  FROM public.draft_bids b
  WHERE b.draft_id = p_draft_id AND b.action_id = p_action_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
  END IF;

  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_place_bid: mock auctions are not open yet — solo practice against CPU bidders lands with the mock auction arm (§8.8/D138)'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.draft_type <> 'auction' THEN
    RAISE EXCEPTION
      'draft_place_bid: this is a % draft — only auction drafts take bids (§8.6)',
      v_draft.draft_type
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'scheduled' THEN
    RAISE EXCEPTION 'draft_place_bid: the draft has not started yet'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'paused' THEN
    RAISE EXCEPTION 'draft_place_bid: the draft is paused'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_place_bid: the draft is complete'
      USING ERRCODE = 'P0001';
  END IF;

  -- PHASE (D126): no live nomination ⇒ nothing to bid on.
  IF v_draft.current_nomination IS NULL THEN
    SELECT t.name INTO v_on_clock_name
    FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;
    RAISE EXCEPTION
      'draft_place_bid: no player is up for bid right now — % is on the clock to nominate (§8.6.2)',
      COALESCE(v_on_clock_name, 'another team')
      USING ERRCODE = 'P0001';
  END IF;

  v_player_id := v_draft.current_nomination->>'player_id';
  v_high_bid  := COALESCE((v_draft.current_nomination->>'high_bid')::int, 0);
  v_high_team := (v_draft.current_nomination->>'high_bidder_team_id')::uuid;
  v_min_bid   := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);  -- §7.3.8 default; used by the E5 message

  -- NOMINATION IDENTITY (R330) — OPTIONAL arguments, and the reason they
  -- exist: a bid names an AMOUNT and nothing else, so without them a bid in
  -- flight across a nomination boundary is applied to whatever player is
  -- live when it EXECUTES, and a manager can become high bidder on a player
  -- they never saw. The insert below takes `player_id` from
  -- `current_nomination` and `nomination_seq` from `current_pick_number`,
  -- both read fresh under the lock — the RPC cannot otherwise know what the
  -- caller was looking at, and E2 does not help (a first-time submit carries
  -- a fresh action_id). This is the server-authoritative boundary, so the
  -- guard lives HERE rather than in a route: the sim, the tests and every
  -- future caller are covered, not only HTTP ones.
  --   * BOTH arguments are checked, and neither subsumes the other:
  --     `p_player_id` catches the ordinary case (the nomination moved on to
  --     a different player), and `p_nomination_seq` catches the two cases
  --     where the SAME player is live under a DIFFERENT nomination — D143's
  --     cancel-and-renominate (the sequence number is NOT consumed, so a
  --     re-nomination reuses it with a possibly different player) and an
  --     undone award returning a player to the pool at a later sequence.
  --   * When OMITTED (both NULL) behavior is exactly as shipped — no
  --     existing caller breaks. L.C2.1's route MUST always send them; that
  --     is where the guard becomes mandatory in practice (ledger row F64,
  --     and the read-list line in tasks-M3 §6 L.C2.1).
  --   * Checked the moment the live nomination is known and BEFORE the
  --     franchise/self-raise/raise/max-bid clauses, so a stale bid gets the
  --     TRUE reason (§16.3's "just went off the board" family) instead of
  --     "you are already the high bidder" or "outbid at $N" about a player
  --     the caller never named.
  IF p_player_id IS NOT NULL AND p_player_id IS DISTINCT FROM v_player_id THEN
    SELECT pl.full_name INTO v_stale_name
    FROM public.players pl WHERE pl.id = p_player_id;
    SELECT pl.full_name INTO v_live_name
    FROM public.players pl WHERE pl.id = v_player_id;
    RAISE EXCEPTION
      'draft_place_bid: % just went off the board — % is up for bid now at $% (§16.3)',
      COALESCE(v_stale_name, 'that player'),
      COALESCE(v_live_name, 'another player'),
      v_high_bid
      USING ERRCODE = 'P0001';
  END IF;
  IF p_nomination_seq IS NOT NULL
     AND p_nomination_seq IS DISTINCT FROM v_draft.current_pick_number THEN
    SELECT pl.full_name INTO v_live_name
    FROM public.players pl WHERE pl.id = v_player_id;
    RAISE EXCEPTION
      'draft_place_bid: that nomination just went off the board — % is up for bid now at $% (§16.3)',
      COALESCE(v_live_name, 'another player'),
      v_high_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- The caller's franchise. Bidding has no turn (§8.6.3: ANY manager with
  -- sufficient max bid raises) — but it does require a franchise to bid
  -- FOR: a member without a seat has no budget and no roster.
  SELECT m.team_id INTO v_my_team
  FROM public.league_members m
  WHERE m.league_id = v_draft.league_id AND m.user_id = auth.uid();
  IF v_my_team IS NULL THEN
    RAISE EXCEPTION
      'draft_place_bid: you do not manage a franchise in this league — only franchise managers can bid (§8.6.3)'
      USING ERRCODE = 'P0001';
  END IF;

  -- A self-raise is a mis-click, not a bid: bidding against yourself only
  -- burns your own budget and the clock.
  IF v_my_team = v_high_team THEN
    RAISE EXCEPTION
      'draft_place_bid: you are already the high bidder at $% — wait for someone to raise you (§8.6.3)',
      v_high_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- The ONE budget authority (084/§4.7) — capacity and money in one read.
  SELECT b.remaining, b.open_slots, b.max_bid
    INTO v_remaining, v_open, v_max_bid
  FROM public.draft_team_budget(p_draft_id, v_my_team) b;

  -- E27: a complete roster is skipped in the rotation AND cannot bid.
  IF v_open < 1 THEN
    RAISE EXCEPTION
      'draft_place_bid: your roster is complete — a complete roster cannot bid (§8.6.7(c)/E27)'
      USING ERRCODE = 'P0001';
  END IF;

  -- THE RACE LOSER'S INSTANT REFUSAL (§16.3/rule 8; D136 — friendly
  -- P0001, never a 429). Integer raises only: the minimum legal bid is
  -- high + 1, at every min_bid including 0 (C38/C40 — a $0 opening is
  -- raised to $1, not to $0).
  IF p_amount <= v_high_bid THEN
    SELECT t.name INTO v_high_name
    FROM public.teams t WHERE t.id = v_high_team;
    RAISE EXCEPTION
      'draft_place_bid: outbid at $% — % holds the high bid; bid $% or more',
      v_high_bid, COALESCE(v_high_name, 'another team'), v_high_bid + 1
      USING ERRCODE = 'P0001';
  END IF;

  -- E5/§8.6.7(d) — the solvency clause at the bid layer (banner item 2).
  -- The message names the formula's number and the money behind it, so a
  -- manager can see WHY $N is their ceiling.
  IF p_amount > v_max_bid THEN
    RAISE EXCEPTION
      'draft_place_bid: $% is over your max bid of $% — you have $% for % open roster spots at a $% minimum bid (§8.6.1/E5)',
      p_amount, v_max_bid, v_remaining, v_open, v_min_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- (3) WRITE.
  INSERT INTO public.draft_bids
    (draft_id, league_id, nomination_seq, player_id, team_id, amount, action_id)
  VALUES
    (p_draft_id, v_draft.league_id, v_draft.current_pick_number,
     v_player_id, v_my_team, p_amount, p_action_id)
  RETURNING * INTO v_bid;

  -- (4) ADVANCE: new high bid + the D128 anti-snipe floor. Above the
  -- threshold GREATEST keeps the standing deadline; below it the floor
  -- wins — the clock can only be EXTENDED, never shortened.
  -- The ZERO branch (R329, rationale corrected): at anti_snipe 0 the two
  -- forms agree on every LIVE deadline (`now() + make_interval(secs => 0)`
  -- IS now(), and GREATEST of a future deadline and now() is that
  -- deadline). They differ only when the standing deadline is NOT in the
  -- future: an ALREADY-EXPIRED one, which an unconditional GREATEST would
  -- REWRITE forward to exactly now(), and a NULL one, which GREATEST
  -- (which ignores NULLs) would INVENT out of nothing. Extension is
  -- disabled, so this branch touches no clock at all. Pinned in 034 §I on
  -- both sides. NOTE the counterpart, deliberate and now recorded: with
  -- anti_snipe > 0 a bid landing AFTER the clock already read zero DOES
  -- receive a full fresh window — D128's letter ("reset the remaining time
  -- TO anti_snipe"), and consistent with snake's posture that the TICK is
  -- the enforcer, not the deadline column.
  v_anti_snipe := COALESCE((v_draft.config->>'auction_anti_snipe_seconds')::int, 10);
  IF v_anti_snipe > 0 THEN
    v_deadline := GREATEST(v_draft.current_deadline,
                           now() + make_interval(secs => v_anti_snipe));
  ELSE
    v_deadline := v_draft.current_deadline;
  END IF;

  UPDATE public.drafts SET
    current_nomination = jsonb_build_object(
                           'player_id', v_player_id,
                           'high_bid', p_amount,
                           'high_bidder_team_id', v_my_team),
    current_deadline   = v_deadline,
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  -- (5) RETURN the new authoritative state.
  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'bid', to_jsonb(v_bid));
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_place_bid(UUID, INTEGER, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 3. draft_make_pick — REPLACED FROM 066 (D137 head rule). The ONLY change
--    is the auction refusal's MESSAGE (066:941–943): the refusal itself
--    stays forever — an auction draft does not pick through this RPC — but
--    it now names the permanent truth instead of a milestone that has
--    arrived. tests/020's assertion is reworded in this same PR.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_make_pick(
  p_draft_id UUID,
  p_player_id TEXT,
  p_action_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft         public.drafts;
  v_pick          public.draft_picks;
  v_my_team       UUID;
  v_on_clock_name TEXT;
  v_player_name   TEXT;
BEGIN
  -- Argument shape (22023) before any data access.
  IF p_player_id IS NULL OR btrim(p_player_id) = '' THEN
    RAISE EXCEPTION 'draft_make_pick: player_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'draft_make_pick: action_id is required — client picks are idempotent (§8.1/E2)'
      USING ERRCODE = '22023';
  END IF;

  -- (1) LOCK the drafts row FIRST (§4.6). The league row is deliberately
  -- NOT locked — see the banner's lock-order note.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  -- (2) VALIDATE. No-leak: a nonexistent draft and a non-member get the
  -- same 42501 (is_league_member(NULL) is FALSE).
  IF NOT FOUND OR NOT public.is_league_member(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_make_pick: not a member of this draft''s league'
      USING ERRCODE = '42501';
  END IF;

  -- A soft-deleted league answers 404 for a legitimate member (063 rule).
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues l
    WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'draft_make_pick: league % not found', v_draft.league_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E2 replay short-circuit — BEFORE status/turn checks: a retried pick is
  -- a no-op returning its original pick + the current authoritative state,
  -- even if the clock has moved on (§8.1 idempotency). R125 DECIDED
  -- (L.B1.4/069): DELIBERATELY no is_undone filter — an action_id is
  -- consumed forever. A stale retry of a commissioner-undone pick returns
  -- the historical (undone) row as a no-op and never re-applies the pick;
  -- filtering would route the retry into a 23505 on uniq_draft_action
  -- (undone rows keep their action_id) surfaced as a misleading E1
  -- message. Pinned in pgTAP 023; the manager re-picks with a fresh
  -- action_id.
  SELECT p.* INTO v_pick
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.action_id = p_action_id;
  IF FOUND THEN
    RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
  END IF;

  -- THE D103(2) MOCK BRANCH (landed by L.B1.6/071 — this was the seam
  -- refusal 066 shipped; the 020 seam pin flipped with it): on a mock the
  -- ONLY legal human caller is the launcher (config.mock.launched_by,
  -- TEXT-compared — R117). Any other member — including the on-clock
  -- seat's REAL manager and the commissioner — is refused: nobody else
  -- drives a member's solo practice, and there is no force-path bypass
  -- for mocks (069's controls refuse them). A config-less mock (only
  -- reachable by privileged fixture inserts — every RPC writer stamps
  -- config.mock) has launched_by NULL and stays tick-only, the safe
  -- default. The human-seat-only half of D103(2) lives at the TURN step
  -- below (it needs status='live' established first so on_clock is real).
  IF v_draft.is_mock
     AND v_draft.config->'mock'->>'launched_by' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION
      'draft_make_pick: this mock draft is another member''s solo practice (§8.8/D103)'
      USING ERRCODE = 'P0001';
  END IF;

  -- 085 (L.C1.3): the refusal STANDS — an auction draft never picks
  -- through this RPC — but the message no longer promises a milestone
  -- that has arrived. §8.6's engine is draft_nominate + draft_place_bid
  -- (085) plus the tick's award arm (086); this sentence is correct
  -- forever and tells the caller what to use instead.
  IF v_draft.draft_type = 'auction' THEN
    RAISE EXCEPTION
      'draft_make_pick: this is an auction draft — auction drafts pick via nominate and bid'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_draft.status = 'scheduled' THEN
    RAISE EXCEPTION 'draft_make_pick: the draft has not started yet'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'paused' THEN
    RAISE EXCEPTION 'draft_make_pick: the draft is paused'
      USING ERRCODE = 'P0001';
  ELSIF v_draft.status = 'complete' THEN
    RAISE EXCEPTION 'draft_make_pick: the draft is complete'
      USING ERRCODE = 'P0001';
  END IF;

  -- TURN. Mock branch (D103(2), the human-seat-only half): the launcher —
  -- already verified above — may pick ONLY while the HUMAN seat is on the
  -- clock (every other seat is tick-only, D93/071 ARM 2.5); the normal
  -- league_members turn check never runs for mocks (the chosen seat may
  -- be a placeholder or another member's franchise — "any seat
  -- selectable", §8.8). Real drafts: the caller manages the on-clock team
  -- (league_members cache — M1's access model). Commissioners use the
  -- L.B1.4 force path, not this RPC: no role bypass exists here.
  IF v_draft.is_mock THEN
    IF v_draft.config->'mock'->>'human_team_id'
       IS DISTINCT FROM v_draft.on_clock_team_id::text THEN
      RAISE EXCEPTION
        'draft_make_pick: a CPU seat is on the clock — CPU picks land on their own (§8.8)'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT m.team_id INTO v_my_team
    FROM public.league_members m
    WHERE m.league_id = v_draft.league_id AND m.user_id = auth.uid();
    IF v_my_team IS NULL OR v_my_team IS DISTINCT FROM v_draft.on_clock_team_id THEN
      SELECT t.name INTO v_on_clock_name
      FROM public.teams t WHERE t.id = v_draft.on_clock_team_id;
      RAISE EXCEPTION
        'draft_make_pick: it is not your turn — % is on the clock',
        COALESCE(v_on_clock_name, 'another team')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT pl.full_name INTO v_player_name
  FROM public.players pl WHERE pl.id = p_player_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_make_pick: player % not found', p_player_id
      USING ERRCODE = 'P0002';
  END IF;

  -- E1 availability under the lock (friendly path); the partial unique is
  -- the guarantee (§8.1: lock + index make double-picks impossible).
  IF EXISTS (
    SELECT 1 FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id
      AND p.player_id = p_player_id
      AND p.is_undone = FALSE
  ) THEN
    RAISE EXCEPTION
      'draft_make_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END IF;

  -- (3)+(4)+(5) via the ONE advance path (L.B1.3 amendment (b)): manual
  -- pick shape — is_auto FALSE, made_via 'manager', picked_by = caller.
  BEGIN
    RETURN public.draft_apply_pick_internal(
      p_draft_id, p_player_id, FALSE, 'manager', auth.uid(), p_action_id);
  EXCEPTION WHEN unique_violation THEN
    -- The exotic race loser (non-RPC interleavings the row lock cannot
    -- see) gets the same friendly E1 message (§8.1).
    RAISE EXCEPTION
      'draft_make_pick: % just went off the board — pick another player',
      v_player_name
      USING ERRCODE = 'P0001';
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_make_pick(UUID, TEXT, UUID) FROM PUBLIC, anon;
