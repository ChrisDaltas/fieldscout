-- ============================================================================
-- Auction commissioner controls — migration 087 (task L.C1.5)
--
-- Spec: §8.7 (the auction rows + Manual Edit Mode + the v2.10 pause-first
-- ruling + End draft), §8.6.7(a)(b)(c), §8.6.8, §12.5, §12.7, §17, E4, E15,
-- E28, E29, E31; tasks-M3 §4 rules 1–8, §5 sketch, §6 L.C1.5, §10 (F40).
-- Decisions: D97 (in-txn system chat posts), D127 (budgets derived — ONE
-- family), D131 (reversals), D137 (CREATE OR REPLACE authored against the
-- chain HEAD), D138 (every auction commissioner verb refuses mocks),
-- D141 (pause-first, in-body, auction-only), D142 (Manual Edit Mode =
-- two existing engine paths, the cost RE-ENTERED), D143 (cancel-and-
-- renominate, the sequence number NOT consumed), D146 (one-unit-short
-- pins), D160/D161 (the L.C1.4 findings this task discharges), and the new
-- D162 below. Grows ledger row F40; discharges the R363/R364 hand-offs.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 1 — D162: WHAT "OPEN BIDS ARE VOIDED" MEANS IN THE SCHEMA.
-- ---------------------------------------------------------------------------
-- R363 routed this question here and tasks-M3 §6's L.C1.5 read-list prints
-- the three options. THE DECISION IS OPTION (a): `draft_bids` gains a
-- nullable `voided_at TIMESTAMPTZ`, stamped by the ONE void helper below.
--
-- Why the other two were rejected, explicitly:
--   * "merged history is acceptable; every reader filters by player_id" is
--     NOT SOUND, and the counter-example is reachable through the shipped
--     verbs: D143 restarts the SAME nominator's nomination clock on resume,
--     and nothing stops that nominator renominating the SAME player at the
--     SAME amount. `nomination_seq`, `player_id`, `team_id` and `amount`
--     then all tie across the void boundary, and the only thing separating
--     the two rows is 086's `ORDER BY created_at DESC` — an ORDER BY
--     carrying a correctness argument, which is precisely the shape D161(2)
--     forbade one task ago.
--   * "a distinct nomination identity that a cancel DOES advance" (a second
--     counter beside `nomination_seq`) works, but it costs a new column on
--     `drafts`, a stamp in BOTH nomination writers (085 and 086's ARM 2.6),
--     a reset rule in every award, and a new invariant that can drift —
--     and it still would not tell the room's feed WHICH rows to strike
--     through, because an attempt number is not the fact a reader wants.
--     `voided_at` is that fact.
--
-- IS THIS A BREACH OF THE APPEND-ONLY RULING (D131(2) / 083:136)? No, and
-- the distinction is load-bearing rather than a comfort. 083's sentence is
-- about POLICIES — "no UPDATE/DELETE policy for anyone" — and THIS MIGRATION
-- ADDS NEITHER. No role gains an UPDATE or DELETE path to `draft_bids`; the
-- stamp is written only by SECURITY DEFINER verbs, and pgTAP 036 §B re-runs
-- the literal per-role write matrix (member/commissioner/outsider/anon ×
-- INSERT/UPDATE/DELETE) AFTER this migration to prove the client-facing
-- posture is byte-for-byte what 032 pinned. D131(2)'s substance is that bid
-- rows STAND — they are never deleted and "bids returned" costs nothing
-- because bids never hold budget. A void stamp keeps every row standing and
-- rewrites none of its bid facts (who, what, how much, when); it ADDS the
-- record of an event that really happened. The spec already asserts that
-- event — §8.7's "open bids voided" — and until this migration the sentence
-- had no referent at all.
--
-- SPEC ERRATUM, folded in this PR (the fold-back rule): §12.5's printed table
-- gains `voided_at` with the meaning above, and the changelog carries it as
-- **v2.12.2**. v2.11 stays reserved for PR #152 (first-filed keeps — R312).
--
-- CONSEQUENCE, and it is why `draft_tick` is replaced below: 086's award
-- lookup gains `AND b.voided_at IS NULL`. The `player_id` discriminator R363
-- added stays (it is the right shape and it covers the different-player
-- case); `voided_at` closes the same-player case the ORDER BY was silently
-- carrying. After this migration the lookup's WHERE is sufficient on its own
-- and the ordering decides nothing — 036 §G pins that with a decoy built
-- through the REAL verbs (nominate → pause → cancel → resume → renominate
-- the same player at the same amount), which is the state 035 §K could only
-- forge because the cancel verb did not exist.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 2 — THE STUCK CLOCK D160(8) RECORDED NOW HAS A REMEDY.
-- ---------------------------------------------------------------------------
-- D160(8)/R364 measured that a refused insolvent award leaves the nomination
-- standing, that `draft_pause` → `draft_resume` does NOT clear it, that the
-- next tick reproduces the identical failure, and that the only recovery was
-- `draft_reset` — which wipes the board. `draft_cancel_nomination` is what
-- makes that last sentence false. The recovery was DRIVEN end to end on the
-- forged state (the same forge D160(8) used), not reasoned: see the PR body
-- and 036 §E, which puts the whole loop — forge → tick refuses → pause →
-- cancel → resume → tick advances → the board survives — through the real
-- verbs and pins the before/after.
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 3 — D137 HEAD-RULE PROVENANCE, PER FUNCTION.
-- ---------------------------------------------------------------------------
-- Every `CREATE OR REPLACE` below was authored against the CURRENT FILE TEXT
-- of the newest migration that DEFINES the function — read from the file,
-- never from `pg_get_functiondef` and never from the deployed body (the
-- CLAUDE.md lesson; 073 silently reverted 049/050/051 exactly that way).
-- Headship was established by `grep -n 'FUNCTION <name>' supabase/migrations/
-- *.sql` for each name; the seven §8.7 controls have their ONLY definition in
-- 069, and `draft_tick`'s newest is 086 (068 is superseded).
--   draft_set_clock       ← 069:531–639    (only definition)
--   draft_undo            ← 069:645–771    (only definition)
--   draft_reassign_pick   ← 069:778–939    (only definition)
--   draft_move_player     ← 069:946–1080   (only definition)
--   draft_force_pick      ← 069:1087–1199  (only definition)
--   draft_set_order       ← 069:1205–1343  (only definition)
--   draft_reset           ← 069:1350–1462  (only definition)
--   draft_tick            ← 086:758–1791   (086 replaced 068's)
-- Each body below was EXTRACTED from those exact line ranges and then
-- edited; the PR body carries the per-function `diff -u` hunk counts so a
-- reviewer can confirm the untouched regions really are untouched.
--
-- THREE SIGNATURES CHANGE, and each is a DROP + CREATE rather than a
-- CREATE OR REPLACE, because a defaulted trailing parameter added by
-- CREATE OR REPLACE creates an OVERLOAD and every existing 4-argument call
-- then fails "function is not unique":
--   draft_set_clock     gains p_nomination_seconds / p_bid_seconds /
--                       p_anti_snipe_seconds (§8.7's auction timer row)
--   draft_move_player   gains p_price   (D142's re-entered cost)
--   draft_reassign_pick gains p_price   (D142's re-entered cost)
-- All three are additive with defaults, so the shipped routes and
-- `draft-service.ts` call sites need NO change — PostgREST resolves by NAMED
-- argument and every existing call names only the old parameters. The
-- REVOKEs are re-issued explicitly after each CREATE (a DROP takes the ACL
-- with it — this is the one place where CREATE OR REPLACE's ACL preservation
-- does not apply). 023's exact-signature pin at :131 is updated in the same
-- PR — pgTAP files are tests, not migrations (D137's closing sentence).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 4 — THE D141 PAUSE-FIRST GATE, AND WHAT IS NOT IN IT.
-- ---------------------------------------------------------------------------
-- Chris's 2026-08-15 ruling (spec §8.7 v2.10) gates exactly six verbs on a
-- RUNNING auction: draft_undo (both arms), draft_reverse_won_bid, the priced
-- draft_reassign_pick / draft_move_player, draft_set_clock, and
-- draft_cancel_nomination. ONE helper carries it
-- (`draft_auction_pause_gate_internal`) so the six cannot drift apart, and
-- it fires ONLY on `draft_type = 'auction' AND status = 'live'` — snake keeps
-- the live-controls posture M2 shipped, which is the recorded divergence
-- (F57, owner Chris). NOT gated, because the ruling did not name them:
-- pause/resume, draft_adjust_budget, draft_set_order, draft_force_pick,
-- draft_reset, and draft_end (a terminal control — the Reset treatment; the
-- hard confirm is the UI's, L.C3.2).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 5 — D138: EVERY AUCTION COMMISSIONER VERB REFUSES MOCKS.
-- ---------------------------------------------------------------------------
-- A mock has no commissioner (D110(1)/D103(2)): the launcher's whole control
-- surface is pause / resume / delete. The four NEW verbs therefore carry the
-- same mock guard the seven 069 controls already carry, with the same
-- message shape, and 036 §H sweeps all eleven. This is a seam, not dead
-- code: 071 refuses auction mocks today, so the refusal is unreachable until
-- L.C1.7 lifts that — which is exactly why it must exist before then (the
-- F61 argument, applied to the commissioner surface).
--
-- ---------------------------------------------------------------------------
-- BANNER ITEM 6 — SOLVENCY (§4 rule 7) AT EVERY MONEY-ADJACENT POINT.
-- ---------------------------------------------------------------------------
-- Nothing here computes a budget. Every number comes from 084's ONE family
-- (`draft_team_budget` / `draft_auction_solvent`, D127/§4.7):
--   draft_adjust_budget      writes the map, then RE-DERIVES and refuses on
--                            any of E28's three arms (the write rolls back
--                            with the RAISE — one txn, no compensating math)
--   draft_reverse_won_bid    is solvency-INCREASING by construction
--                            (remaining' = remaining + price, open' = open+1,
--                            price >= min_bid ⇒ D131(3)); asserted anyway
--   priced reassign / move   validates the RECEIVING team at `price <=
--                            max_bid` — the identical algebra the award uses
--   draft_force_pick         (nominate arm) validates exactly as that team's
--                            own nomination would (§8.6.7(a)/D129(1))
--   draft_end                spends nothing, so solvency is preserved
--                            trivially — pinned rather than asserted in prose
--
-- Migration checklist (plan §8.1 / tasks-M3 §4.4): additive-only DDL (one
-- nullable column; no data change, no policy added or removed on any table)
-- · IF NOT EXISTS on the column add · the three DROP+CREATEs are signature
-- widenings with defaults, so no call site breaks · no new index needed —
-- `idx_draft_bids_nom` still serves every live-history read and `voided_at
-- IS NULL` is a filter over an already-narrow (draft_id, nomination_seq)
-- slice · broadcast of `voided_at` is L.C1.6's payload work (088), noted
-- there, not smuggled here · staging rehearsal: R6 waiver — no staging clone
-- exists (environments are local + prod only); the recorded rehearsal is the
-- fresh local `npx supabase db reset` replay of the full 001–087 chain in
-- this PR, plus pgTAP 036 · typegen re-run with the hand-written alias block
-- re-appended (additive-only diff verified in the PR).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_bids.voided_at — D162 (banner item 1). The representation the
--    spec's "open bids voided" (§8.7) has never had.
-- ---------------------------------------------------------------------------

ALTER TABLE draft_bids
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
-- EXACT MEANING, stated mechanically so no reader has to infer it:
-- `voided_at IS NOT NULL` ⇔ **this bid row no longer belongs to the
-- live-or-future nomination at its `nomination_seq`.** That happens in
-- exactly two situations, which are the two situations that make a sequence
-- number ambiguous:
--   (a) the sequence is CLEARED WITHOUT AN AWARD — draft_cancel_nomination
--       (D143) and draft_end's un-awarded close — and D143 does not consume
--       the number, so the very next nomination re-uses it;
--   (b) the sequence is REWOUND ONTO — draft_undo moves
--       current_pick_number back over nominations that had already settled,
--       so those numbers will be issued again.
-- A REVERSED pick (draft_reverse_won_bid) is deliberately NOT in that list:
-- it consumes no sequence number and rewinds nothing, so its bids stay
-- live-flagged and the reversal is recorded where reversals have always been
-- recorded — `draft_picks.is_undone`. Two different facts, two columns, no
-- duplication. Written ONLY by draft_void_nomination_internal and by
-- draft_undo's rewind stamp; never cleared — a void is one-way, exactly like
-- the soft-undo it sits beside.
-- NO policy changes: draft_bids still has SELECT-for-members and no
-- UPDATE/DELETE policy for any role (083:132–136), which is what keeps
-- D131(2)'s append-only ruling true at the client boundary. 036 §B re-runs
-- 032's literal per-role write matrix after this column lands.

-- ---------------------------------------------------------------------------
-- 2. draft_auction_pause_gate_internal — the ONE D141 implementation
--    (consumers: undo, reverse_won_bid, priced reassign/move, set_clock,
--    cancel_nomination — banner item 4)
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
  -- Auction-only, running-only. A snake draft never reaches the RAISE — the
  -- M2 live-controls posture is deliberately preserved (F57 records that the
  -- divergence is a standing product question, not an oversight).
  IF p_draft.draft_type = 'auction' AND p_draft.status = 'live' THEN
    RAISE EXCEPTION
      '%: pause the draft first — auction commissioner controls run on a paused board (§8.7 v2.10)',
      p_verb
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_auction_pause_gate_internal(public.drafts, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. draft_void_nomination_internal — the ONE void implementation
--    (consumers: draft_cancel_nomination, draft_undo's E29 arm, draft_end)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_void_nomination_internal(p_draft_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft  public.drafts;
  v_player TEXT;
  v_voided INTEGER := 0;
BEGIN
  -- CALLER CONTRACT: the drafts row is held FOR UPDATE (§4.6) and the caller
  -- has already decided the nomination must not resolve. Plain re-read.
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;

  -- No live nomination is a legal, silent no-op: draft_undo and draft_end
  -- both call this unconditionally, and "there was nothing to void" is a
  -- true answer rather than an error. The count is RETURNED so callers can
  -- say the honest thing in their system post instead of guessing.
  IF v_draft.current_nomination IS NULL THEN
    RETURN 0;
  END IF;

  v_player := v_draft.current_nomination->>'player_id';

  -- D162. Scoped by (seq, player) and by `voided_at IS NULL`: the player
  -- predicate keeps an EARLIER void's rows out (D143 does not consume the
  -- sequence number, so this seq may already carry a voided nomination), and
  -- the NULL predicate makes a second void of the same nomination a no-op
  -- rather than a re-stamp with a later timestamp.
  UPDATE public.draft_bids SET voided_at = now()
  WHERE draft_id = p_draft_id
    AND nomination_seq = v_draft.current_pick_number
    AND player_id = v_player
    AND voided_at IS NULL;
  GET DIAGNOSTICS v_voided = ROW_COUNT;

  -- Back to the NOMINATING phase (D126). current_pick_number is deliberately
  -- NOT advanced — D143: the sequence number is NOT consumed.
  UPDATE public.drafts SET
    current_nomination = NULL,
    updated_at         = now()
  WHERE id = p_draft_id;

  RETURN v_voided;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_void_nomination_internal(UUID)
  FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. draft_reverse_won_bid — §8.7 "undo a won bid" / D131(1); Manual Edit
--    Mode's "Reset pick" (D142(a))
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
  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_reverse_won_bid: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  -- MOCK GUARD (D138/D110(1)/§8.8): a mock has no commissioner — the
  -- launcher's controls are pause, resume and delete. Unreachable until
  -- L.C1.7 lifts 071's auction-mock refusal; that is why it ships now (F61).
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_reverse_won_bid: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
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

REVOKE EXECUTE ON FUNCTION draft_reverse_won_bid(UUID, UUID, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 5. draft_adjust_budget — §8.7 "adjust a team's remaining budget" / E28 +
--    D131(4)'s live-high-bid arm
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION draft_adjust_budget(
  p_draft_id UUID,
  p_team_id  UUID,
  p_delta    INTEGER,
  p_reason   TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_team_name  TEXT;
  v_min_bid    INTEGER;
  v_before     INTEGER;
  v_after      INTEGER;
  v_remaining  INTEGER;
  v_open       INTEGER;
  v_max_bid    INTEGER;
  v_committed  INTEGER;
  v_high_bid   INTEGER;
  v_high_team  UUID;
  v_live_name  TEXT;
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

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_adjust_budget: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_adjust_budget: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
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

  v_min_bid := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);
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

  -- E28 ARM 2 — below the §8.6.8 solvency floor. open_slots * min_bid is the
  -- money the team must still be able to spend to finish a legal roster.
  IF v_remaining < v_open * v_min_bid THEN
    RAISE EXCEPTION
      'draft_adjust_budget: that leaves % with $% for % open roster spots at a $% minimum bid — §8.6.8 needs at least $%; reverse a won bid to free a spot, or make the adjustment smaller (E28)',
      v_team_name, v_remaining, v_open, v_min_bid, v_open * v_min_bid
      USING ERRCODE = 'P0001';
  END IF;

  -- E28 ARM 3 (D131(4)) — insolvent against the LIVE high bid. A bid holds no
  -- money (D131(2)); the AWARD spends it. So an edit that is fine right now
  -- can still make the close unaffordable, and the close is a tick away.
  -- Same algebra as the award: price <= max_bid.
  IF v_draft.current_nomination IS NOT NULL THEN
    v_high_team := (v_draft.current_nomination->>'high_bidder_team_id')::uuid;
    v_high_bid  := (v_draft.current_nomination->>'high_bid')::int;
    IF v_high_team = p_team_id AND v_high_bid > v_max_bid THEN
      SELECT pl.full_name INTO v_live_name
      FROM public.players pl WHERE pl.id = v_draft.current_nomination->>'player_id';
      RAISE EXCEPTION
        'draft_adjust_budget: % is the high bidder on % at $%, and that leaves a max bid of $% — the close would be unaffordable. Void the nomination (pause, then Edit current nomination) or reverse a won bid first (E28/D131(4))',
        v_team_name, COALESCE(v_live_name, 'the nominated player'),
        v_high_bid, v_max_bid
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

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

  RETURN jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'team_id', p_team_id,
    'adjustment_before', v_before,
    'adjustment_after', v_after,
    'remaining', v_remaining,
    'open_slots', v_open,
    'max_bid', v_max_bid);
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_adjust_budget(UUID, UUID, INTEGER, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 6. draft_cancel_nomination — §8.7 "Edit current nomination" / D143
--    (cancel-and-renominate; the sequence number is NOT consumed)
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

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_cancel_nomination: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_cancel_nomination: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
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

REVOKE EXECUTE ON FUNCTION draft_cancel_nomination(UUID, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 7. draft_end — §8.7 "End draft", C41's RULED end-as-is (spec v2.10.1)
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

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_end: not a commissioner of this draft''s league'
      USING ERRCODE = '42501';
  END IF;
  IF v_draft.is_mock THEN
    RAISE EXCEPTION
      'draft_end: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
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

REVOKE EXECUTE ON FUNCTION draft_end(UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 8. draft_set_clock — HEAD 069:531-639. DROP + CREATE (banner item 3): the
--    three auction timers are new trailing defaulted parameters, which
--    CREATE OR REPLACE would turn into an ambiguous overload.
-- ---------------------------------------------------------------------------

DROP FUNCTION draft_set_clock(UUID, INTEGER, BOOLEAN, TEXT);

CREATE FUNCTION draft_set_clock(
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
  v_note  TEXT := '';
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

  -- 087/L.C1.5 — D141: ALL timer edits are pause-first on an auction. Snake
  -- is untouched (the recorded divergence, F57).
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
  IF p_extend_current AND v_draft.status = 'paused' THEN
    RAISE EXCEPTION
      'draft_set_clock: the draft is paused — resume first, then extend the current pick (the paused clock keeps its stored remaining time)'
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

  IF p_extend_current AND v_draft.status = 'live' THEN
    IF p_pick_timer_seconds = 0 THEN
      -- Untimed (§8.2 soft timer) applied to the current pick: the clock
      -- comes off — removing a clock is not shortening it (E15).
      UPDATE public.drafts SET current_deadline = NULL, updated_at = now()
      WHERE id = p_draft_id
      RETURNING * INTO v_draft;
      v_note := ' The current pick is now untimed.';
    ELSE
      -- Extend-only: GREATEST — a shorter timer never silently shortens
      -- the running clock (E15). R138: on an UNTIMED current pick
      -- (current_deadline NULL) GREATEST(NULL, now()+timer) IMPOSES the
      -- new timer — the commissioner's explicit request (extend_current on
      -- an untimed pick means "put this pick on the clock"; the
      -- §8.2-symmetric inverse of the timer-0 arm; the pick gets a FULL
      -- fresh timer, so no running countdown is ever cut). Decided + pinned
      -- M2 batch 5; the post names the imposition distinctly. See the
      -- banner + D108(3).
      IF v_draft.current_deadline IS NULL THEN
        v_note := ' The current pick is now on the clock.';
      ELSE
        v_note := ' The current pick was extended.';
      END IF;
      UPDATE public.drafts SET
        current_deadline = GREATEST(current_deadline,
                                    now() + make_interval(secs => p_pick_timer_seconds)),
        updated_at       = now()
      WHERE id = p_draft_id
      RETURNING * INTO v_draft;
    END IF;
  END IF;

  INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
  VALUES (v_draft.league_id, auth.uid(),
          'Pick clock set to ' ||
          CASE WHEN p_pick_timer_seconds = 0 THEN 'untimed'
               ELSE p_pick_timer_seconds || ' seconds' END ||
          ' by ' || public.draft_actor_name() ||
          ' (applies to upcoming picks).' || v_note,
          'draft:' || p_draft_id::text, TRUE);

  RETURN jsonb_build_object('draft', to_jsonb(v_draft));
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_set_clock(UUID, INTEGER, BOOLEAN, TEXT, INTEGER, INTEGER, INTEGER)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 9. draft_undo — HEAD 069:645-771. D141 gate + E29's nomination void
--    (D131(2)) + the auction rewind. Signature unchanged ⇒ CREATE OR REPLACE.
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

  -- 087/L.C1.5 — D141: undo (single AND cascade) is pause-first on an
  -- auction. Snake keeps M2's live-controls posture (F57).
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
    SELECT b.team_id INTO v_onclock
    FROM public.draft_bids b
    WHERE b.draft_id = p_draft_id AND b.nomination_seq = v_first
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
-- 10. draft_reassign_pick — HEAD 069:778-939. DROP + CREATE (p_price is
--     D142's re-entered cost) + the D141 gate + the E28-class validation.
-- ---------------------------------------------------------------------------

DROP FUNCTION draft_reassign_pick(UUID, UUID, UUID, TEXT, TEXT);

CREATE FUNCTION draft_reassign_pick(
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

  -- 087/L.C1.5 — D141: Manual Edit Mode is pause-first on an auction.
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

  -- 087 — §4 rule 7 backstop, through the ONE family: the targeted refusal
  -- above covers the receiving team, this proves nobody else's floor moved.
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
-- 11. draft_move_player — HEAD 069:946-1080. DROP + CREATE (p_price) + the
--     D141 gate + the E28-class validation. This is the arm D160(8) named as
--     the reachability path into the stuck-clock state.
-- ---------------------------------------------------------------------------

DROP FUNCTION draft_move_player(UUID, TEXT, UUID, UUID, TEXT);

CREATE FUNCTION draft_move_player(
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

  -- 087/L.C1.5 — D141: Manual Edit Mode is pause-first on an auction. THIS
  -- IS ALSO THE ARM D160(8)/R364 NAMED: before 087 this function had no
  -- draft_type awareness at all, so a commissioner mis-click could move a
  -- priced player onto a team and shrink a live high bidder's max_bid below
  -- their standing bid — manufacturing exactly the insolvent award the tick
  -- then refuses forever. The gate, the priced validation and the solvency
  -- backstop below are what close that door.
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

  -- 087 — §4 rule 7 backstop, through the ONE family: the targeted refusal
  -- above covers the receiving team, this proves nobody else's floor moved.
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

-- ---------------------------------------------------------------------------
-- 12. draft_force_pick — HEAD 069:1087-1199. The R301 auction arm:
--     force-NOMINATE in the nominating phase, refuse in the bidding phase.
--     Signature unchanged ⇒ CREATE OR REPLACE.
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
  v_min_bid     INTEGER;
  v_bid_seconds INTEGER;
  v_remaining   INTEGER;
  v_open        INTEGER;
  v_max_bid     INTEGER;
  v_live_name   TEXT;
BEGIN
  IF p_player_id IS NULL OR btrim(p_player_id) = '' THEN
    RAISE EXCEPTION 'draft_force_pick: player_id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_force_pick: not a commissioner of this draft''s league'
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
      'draft_force_pick: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
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

    v_min_bid     := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);
    v_bid_seconds := COALESCE((v_draft.config->>'auction_bid_seconds')::int, 20);

    IF v_min_bid > v_max_bid THEN
      RAISE EXCEPTION
        'draft_force_pick: % cannot afford the $% minimum bid — max bid is $% ($% for % open spots) (§8.6.7(a))',
        COALESCE(v_team_name, 'that team'), v_min_bid, v_max_bid, v_remaining, v_open
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
       p_player_id, v_draft.on_clock_team_id, v_min_bid, v_action)
    RETURNING * INTO v_bid;

    -- Open the BIDDING phase (D126). current_pick_number is NOT advanced —
    -- it IS this nomination's sequence number until the award (D157(2)) —
    -- and on_clock stays the NOMINATOR.
    UPDATE public.drafts SET
      current_nomination = jsonb_build_object(
                             'player_id', p_player_id,
                             'high_bid', v_min_bid,
                             'high_bidder_team_id', v_draft.on_clock_team_id),
      current_deadline   = now() + make_interval(secs => v_bid_seconds),
      updated_at         = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;

    INSERT INTO public.league_chat (league_id, user_id, message, context, is_system)
    VALUES (v_draft.league_id, auth.uid(),
            'Nomination ' || v_draft.current_pick_number || ' made by commissioner '
            || public.draft_actor_name() || ' for '
            || COALESCE(v_team_name, 'the team on the clock')
            || ': ' || v_player_name || ' at $' || v_min_bid || '.',
            'draft:' || p_draft_id::text, TRUE);

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

REVOKE EXECUTE ON FUNCTION draft_force_pick(UUID, TEXT, UUID, TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 13. draft_set_order — HEAD 069:1205-1343. The auction arm edits
--     `nomination_order`. Signature unchanged ⇒ CREATE OR REPLACE.
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

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_set_order: not a commissioner of this draft''s league'
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
      'draft_set_order: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
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
        'draft_set_order: this auction has not started — set nomination_order_mode and its order in League settings before the draft (§7.3.8)'
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

REVOKE EXECUTE ON FUNCTION draft_set_order(UUID, UUID[], TEXT)
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 14. draft_reset — HEAD 069:1350-1462. R302's auction hygiene: the reset
--     UPDATE also clears current_nomination and budget_adjustments.
--     Signature unchanged ⇒ CREATE OR REPLACE.
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

  IF NOT FOUND OR NOT public.is_league_commish(v_draft.league_id) THEN
    RAISE EXCEPTION 'draft_reset: not a commissioner of this draft''s league'
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
      'draft_reset: mock drafts have no commissioner controls — the launcher can pause, resume, or delete their practice (§8.8/D103)'
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

REVOKE EXECUTE ON FUNCTION draft_reset(UUID, TEXT) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 15. draft_tick — HEAD 086:758-1791. ONE behavioural hunk: ARM 2.6's award
--     attribution lookup gains `AND b.voided_at IS NULL` (D162, banner item
--     1), plus the D160(8) residual comment is corrected because this
--     migration is what makes it false. Signature unchanged ⇒ CREATE OR
--     REPLACE; the whole body is re-emitted because that is the D137 vehicle.
-- ---------------------------------------------------------------------------
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
  v_min_bid        INTEGER;
  v_remaining      INTEGER;
  v_open           INTEGER;
  v_max_bid        INTEGER;
  v_price          INTEGER;
  v_win_team       UUID;
  v_win_player     TEXT;
  v_is_auto        BOOLEAN;
  v_order          JSONB;
  v_n              INTEGER;
  v_idx            INTEGER;
  v_step           INTEGER;
  v_next_team      UUID;
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
      AND EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = d.league_id AND l.deleted_at IS NULL
      )
    LIMIT c_batch
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = v_od.id;
      IF v_draft.status <> 'live' THEN
        CONTINUE;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
      ) THEN
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
      AND EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = d.league_id AND l.deleted_at IS NULL
      )
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
      IF NOT EXISTS (
        SELECT 1 FROM public.leagues l
        WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
      ) THEN
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
      PERFORM public.draft_pause_internal(
        v_draft.id, NULL,
        'Mock draft auto-paused — you left the room. Resume your practice from the league page.');
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
        IF NOT EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
        ) THEN
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
        AND EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = d.league_id AND l.deleted_at IS NULL
        )
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
        IF NOT EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
        ) THEN
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
  -- auction + non-mock + due + alive league — so an auction mid-clock is
  -- never locked by this arm, and every predicate is re-verified under the
  -- held lock below. The c_batch ceiling and its >25-candidate rotation
  -- behaviour are ARM 2's, inherited deliberately: tasks-M3 §10 routes that
  -- to F50 (M7) and says ARM 2.6 shares it with no new row.
  -- MOCKS ARE EXCLUDED and unreachable (071 refuses auction mocks; 085's
  -- verbs refuse them — F61). L.C1.7 adds the CPU sub-arm (D132/D138) and
  -- opens the claim; until then a hand-built live auction mock is claimed
  -- by no arm at all — true of ARM 2.5 as well only since R362 added the
  -- same two lines there, and RUN rather than reasoned (the fixture and
  -- its two tick summaries are in the ARM 2.5 comment; 035 §J pins them).
  -- -------------------------------------------------------------------------
  LOOP
    v_auc_loops := v_auc_loops + 1;
    v_pass := 0;

    FOR v_row IN
      SELECT d.id
      FROM public.drafts d
      WHERE d.status = 'live'
        AND d.draft_type = 'auction'
        AND d.is_mock = FALSE
        AND d.current_deadline IS NOT NULL
        AND d.current_deadline <= now()
        AND NOT (d.id = ANY(v_auc_seen))
        AND EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = d.league_id AND l.deleted_at IS NULL
        )
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
           OR v_draft.is_mock
           OR v_draft.current_deadline IS NULL
           OR v_draft.current_deadline > now()
           OR v_draft.on_clock_team_id IS NULL THEN
          CONTINUE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = v_draft.league_id AND l.deleted_at IS NULL
        ) THEN
          CONTINUE;
        END IF;

        v_min_bid := COALESCE((v_draft.config->>'auction_min_bid')::int, 1);

        IF v_draft.current_nomination IS NULL THEN
          -- ===== (a) NOMINATION EXPIRY — §8.6.2's timeout; D129(2)(3) ====
          -- Seat derivation: real drafts only (mocks are excluded above),
          -- so this is ARM 2's non-mock branch verbatim.
          SELECT m.user_id, COALESCE(m.is_autodraft, FALSE)
            INTO v_user, v_autodraft
          FROM public.league_members m
          WHERE m.league_id = v_draft.league_id
            AND m.team_id = v_draft.on_clock_team_id;

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

          -- §8.6.8 through the ONE derivation family (rule 7 — no path
          -- computes budgets independently). Both arms are unreachable on a
          -- sound board (the rotation skip guarantees the first; solvency
          -- implies the second, since remaining >= open × min_bid gives
          -- max_bid = remaining − (open − 1) × min_bid >= min_bid), so both
          -- are LOUD rather than silently skipped.
          SELECT b.remaining, b.open_slots, b.max_bid
            INTO v_remaining, v_open, v_max_bid
          FROM public.draft_team_budget(v_draft.id, v_draft.on_clock_team_id) b;

          IF v_open < 1 THEN
            RAISE EXCEPTION
              'draft_tick: the nominating team % in auction % has a complete roster — the §8.6.7(c) rotation skip is broken',
              v_draft.on_clock_team_id, v_draft.id;
          END IF;
          IF v_max_bid < v_min_bid THEN
            RAISE EXCEPTION
              'draft_tick: the nominating team % in auction % cannot afford the $% minimum opening bid (max bid $%; $% for % open spots) — §8.6.8 solvency is broken',
              v_draft.on_clock_team_id, v_draft.id, v_min_bid, v_max_bid,
              v_remaining, v_open;
          END IF;

          -- THE SYSTEM NOMINATION (D129(2); C33's erratum): the on-clock
          -- team's OWN resolve chain — the same brain a snake timeout uses,
          -- one implementation for both engines — so the nominated player
          -- fits the NOMINATOR's open slot. That is what satisfies
          -- §8.6.7(e)'s "fits *some* team's open slot" and what keeps
          -- §8.6.7(b)'s no-raise award to the nominator always legal.
          v_player := public.draft_autopick_resolve(
            v_draft.id, v_draft.on_clock_team_id);
          IF v_player IS NULL THEN
            RAISE EXCEPTION
              'draft_tick: no available player to system-nominate in auction draft % (pool exhausted)',
              v_draft.id;
          END IF;

          -- F62 — DISCHARGED: every nomination opens with a draft_bids row
          -- (§12.5's one uniform history — the room's feed, the E2 replay
          -- lookup and idx_draft_bids_nom all read it). The system path
          -- carries action_id NULL, which is precisely why C39 made the
          -- column NULLable. Pinned in 035 §D; load-bearing at the award
          -- below, which refuses without it.
          INSERT INTO public.draft_bids
            (draft_id, league_id, nomination_seq, player_id, team_id,
             amount, action_id)
          VALUES
            (v_draft.id, v_draft.league_id, v_draft.current_pick_number,
             v_player, v_draft.on_clock_team_id, v_min_bid, NULL);

          -- Open the BIDDING phase (D126). current_pick_number is NOT
          -- advanced — it IS this nomination's sequence number until the
          -- award (D157(2)) — and on_clock stays the NOMINATOR.
          UPDATE public.drafts SET
            current_nomination = jsonb_build_object(
                                   'player_id', v_player,
                                   'high_bid', v_min_bid,
                                   'high_bidder_team_id',
                                     v_draft.on_clock_team_id),
            current_deadline   = now() + make_interval(secs => COALESCE(
                                   (v_draft.config->>'auction_bid_seconds')::int,
                                   20)),
            updated_at         = now()
          WHERE id = v_draft.id;

          v_auc_nominated := v_auc_nominated + 1;
        ELSE
          -- ===== (b) BID EXPIRY → THE AWARD — §8.6.4/§8.6.7(b); D130 =====
          -- NO GRACE, deliberately (D129(4)/§8.6.5/OQ 10): the grace
          -- contract is a NOMINATION-clock rule. Nobody auto-bids for an
          -- absent manager and nobody can be timed INTO a bid, so a stale
          -- nominator or a stale high bidder delays nothing.
          -- E26 IS STRUCTURAL, NOT A BRANCH: 085 sets high_bidder_team_id
          -- to the NOMINATOR at nomination time, so "the clock expires with
          -- no raises ⇒ the nominator wins at the opening bid" is what
          -- awarding the standing high bidder already does.
          v_win_team   := (v_draft.current_nomination->>'high_bidder_team_id')::uuid;
          v_win_player := v_draft.current_nomination->>'player_id';
          v_price      := (v_draft.current_nomination->>'high_bid')::int;
          IF v_win_team IS NULL OR v_win_player IS NULL OR v_price IS NULL THEN
            RAISE EXCEPTION
              'draft_tick: auction % has a malformed current_nomination (%) — refusing to award',
              v_draft.id, v_draft.current_nomination;
          END IF;

          -- ATTRIBUTION (D130's "per actor"), read off the WINNING bid row:
          -- a system-opened nomination carries action_id NULL, so an
          -- unraised one is is_auto/'autopick' and anything a human
          -- nominated or raised is 'manager'. Its absence is engine
          -- corruption and refuses the award, which is what makes F62's
          -- invariant load-bearing.
          -- WHAT MAKES THE ROW UNAMBIGUOUS — NOT "unique by construction"
          -- (R363). An earlier draft of this comment claimed the triple
          -- (nomination_seq, team, amount) could only ever match one row
          -- because a raise must exceed the high bid and 085 refuses a
          -- self-raise. **D143 refutes that**: L.C1.5's
          -- `draft_cancel_nomination` voids a nomination and DOES NOT
          -- CONSUME the sequence number, so one `nomination_seq` can carry
          -- the bid rows of two successive nominations — on two different
          -- players, at the same amount, from the same team. `player_id`
          -- is therefore in the WHERE: it is the actual discriminator, and
          -- it is a column the row already carries (083). The remaining
          -- ordering is a chronological tiebreak only — `created_at DESC`
          -- prefers the live nomination's row because the voided one was
          -- written in an earlier transaction — and `b.id DESC` behind it
          -- decides NOTHING meaningful: `draft_bids.id` is
          -- `gen_random_uuid()` (083), so on a `created_at` tie it picks at
          -- random. That is exactly why the discriminator may not be the
          -- ordering. 035 §K pins the disambiguation with a same-second,
          -- same-(seq, team, amount) decoy on a DIFFERENT player whose id
          -- is chosen to WIN the UUID tiebreak.
          -- SETTLED BY 087/L.C1.5 (D162). D143's "open bids are voided" now
          -- HAS a representation: `draft_bids.voided_at`, stamped by the ONE
          -- void helper. `player_id` stays — it is the right discriminator
          -- for the different-player case and costs nothing — and
          -- `voided_at IS NULL` closes the case `player_id` could not: the
          -- SAME nominator renominating the SAME player at the SAME amount
          -- after a cancel, which ties every other column and left the
          -- ORDER BY carrying a correctness argument (the D161(2) rule).
          -- With both predicates the WHERE is sufficient on its own and the
          -- ordering decides nothing; it is kept only as a stable tiebreak.
          -- pgTAP 036 §G builds that state through the REAL verbs.
          SELECT b.action_id IS NULL INTO v_is_auto
          FROM public.draft_bids b
          WHERE b.draft_id = v_draft.id
            AND b.nomination_seq = v_draft.current_pick_number
            AND b.player_id = v_win_player          -- R363/D143: THE discriminator
            AND b.voided_at IS NULL                 -- D162: only LIVE bids resolve
            AND b.team_id = v_win_team
            AND b.amount = v_price
          ORDER BY b.created_at DESC, b.id DESC
          LIMIT 1;
          IF v_is_auto IS NULL THEN
            RAISE EXCEPTION
              'draft_tick: no draft_bids row backs the live high bid on auction % (nomination %, team %, $%) — refusing to award (F62)',
              v_draft.id, v_draft.current_pick_number, v_win_team, v_price;
          END IF;

          -- §8.6.8 AT THE AWARD (rule 7). Bids move no money (D131(2)); the
          -- AWARD does, so it re-reads the winner through the ONE family
          -- under the held lock. `price <= max_bid` is exactly the condition
          -- whose award leaves remaining' >= open_slots' × min_bid — the
          -- algebra 085's bid clause exists to establish — so re-checking it
          -- HERE is what makes the award solvency-preserving by
          -- construction rather than by trust in an earlier validator. A
          -- violation is engine corruption (D131(4) makes commissioner
          -- budget edits refuse it) and is LOUD: no pick is written and the
          -- failure is recorded. THE REMEDY SHIPPED WITH 087 (L.C1.5),
          -- superseding D160(8)'s "no remedy exists": pause →
          -- `draft_cancel_nomination` → resume clears the standing
          -- nomination WITHOUT touching the board, and the next tick
          -- advances the rotation normally. Driven end to end, not reasoned
          -- — pgTAP 036 §E runs the whole loop on the same forged state
          -- D160(8) used. `draft_reset` is no longer the only exit.
          SELECT b.remaining, b.open_slots, b.max_bid
            INTO v_remaining, v_open, v_max_bid
          FROM public.draft_team_budget(v_draft.id, v_win_team) b;

          IF v_open < 1 THEN
            RAISE EXCEPTION
              'draft_tick: the winning team % on auction % has a complete roster — E27 says a complete roster cannot bid; refusing to award',
              v_win_team, v_draft.id;
          END IF;
          IF v_price > v_max_bid THEN
            RAISE EXCEPTION
              'draft_tick: awarding % at $% to team % on auction % would break §8.6.8 solvency (max bid $%; $% for % open spots at a $% minimum bid) — refusing the award',
              v_win_player, v_price, v_win_team, v_draft.id, v_max_bid,
              v_remaining, v_open, v_min_bid;
          END IF;

          -- (3) WRITE — §12.4's auction shape. `round` NULL (D126: an
          -- auction has no rounds); `price` set; `picked_by`/`action_id`
          -- NULL because the CLOCK wrote this pick, not a user (ARM 2's
          -- posture) — and §12.5 carries no user column, so deriving one
          -- from league_members would misattribute the moment a seat
          -- changes hands (§7.2.1: franchises outlive managers).
          INSERT INTO public.draft_picks
            (draft_id, league_id, pick_number, round, team_id, player_id,
             price, is_auto, picked_by, made_via, action_id)
          VALUES
            (v_draft.id, v_draft.league_id, v_draft.current_pick_number,
             NULL, v_win_team, v_win_player, v_price, v_is_auto, NULL,
             CASE WHEN v_is_auto THEN 'autopick' ELSE 'manager' END, NULL);

          -- (4) ADVANCE — the rotation (§8.6.7(c)/E27), scanning from AFTER
          -- the NOMINATOR (on_clock stays the nominator through bidding —
          -- D157(2); it is the seat the rotation advances FROM) and skipping
          -- complete rosters. ONE statement through the ONE family, the
          -- CROSS JOIN LATERAL shape draft_auction_solvent itself uses, so
          -- rule 7 holds without n round trips inside the lock.
          -- RECORDED RESIDUAL (085 banner item 5's sibling): a RETIRED seat
          -- inside nomination_order would make draft_team_budget RAISE its
          -- P0002 ("not an ACTIVE franchise … outside the §8.6.8 team set",
          -- R321) and the whole award would be contained as an
          -- auction_failure. Unreachable in M3 — retirement is M4's
          -- `retire_franchise` and nomination_order is built at start from
          -- the active set — and a loud, honest raise is the right answer
          -- for a state whose correct rotation is genuinely undecided.
          v_order := v_draft.nomination_order;
          v_n := COALESCE(jsonb_array_length(v_order), 0);
          IF v_n < 1 THEN
            RAISE EXCEPTION
              'draft_tick: auction % has no nomination_order — cannot advance the rotation',
              v_draft.id;
          END IF;

          SELECT o.idx INTO v_idx
          FROM jsonb_array_elements_text(v_order)
               WITH ORDINALITY AS o(team, idx)
          WHERE o.team = v_draft.on_clock_team_id::text
          LIMIT 1;
          IF v_idx IS NULL THEN
            RAISE EXCEPTION
              'draft_tick: the nominating team % is not in auction %''s nomination_order — cannot advance the rotation',
              v_draft.on_clock_team_id, v_draft.id;
          END IF;

          v_next_team := NULL;
          v_step      := NULL;
          SELECT c.team, c.step
            INTO v_next_team, v_step
          FROM (
            SELECT (v_order->>((v_idx - 1 + s.i) % v_n))::uuid AS team,
                   s.i AS step
            FROM generate_series(1, v_n) AS s(i)
          ) c
          CROSS JOIN LATERAL public.draft_team_budget(v_draft.id, c.team) b
          WHERE b.open_slots >= 1
          ORDER BY c.step
          LIMIT 1;

          IF v_next_team IS NULL THEN
            -- COMPLETION (§8.6.6/D130): the rotation having nowhere to go IS
            -- "no team has open slots" — ONE computation, so the two can
            -- never disagree. §8.6.6's "or budgets exhausted" is unreachable
            -- by construction (solvency keeps every open slot affordable at
            -- min_bid); 035 §H spot-checks it on a greedy-spend board. The
            -- writer prices the rosters (D111(3)).
            PERFORM public.draft_complete_internal(v_draft.id);
            v_auc_completed := v_auc_completed + 1;
          ELSE
            UPDATE public.drafts SET
              current_nomination  = NULL,          -- back to NOMINATING
              current_pick_number = v_draft.current_pick_number + 1,
              -- the ROTATION LAP (D126 — display-only; item 3 removed its
              -- last engine consumer): +1 when the scan wrapped past the
              -- end of nomination_order.
              current_round       = COALESCE(v_draft.current_round, 1)
                                    + CASE WHEN (v_idx - 1 + v_step) >= v_n
                                           THEN 1 ELSE 0 END,
              on_clock_team_id    = v_next_team,
              current_deadline    = now() + make_interval(secs => COALESCE(
                                      (v_draft.config->>'auction_nomination_seconds')::int,
                                      30)),
              updated_at          = now()
            WHERE id = v_draft.id;
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
        AND EXISTS (
          SELECT 1 FROM public.leagues l
          WHERE l.id = d.league_id AND l.deleted_at IS NULL
        )
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
    'loops', v_loops);
END;
$$;

-- Service-role/cron only (the 062-internal-helper narrowing — authenticated
-- is revoked too; the D100 harness drives it through the service role).
-- Restated after the CREATE OR REPLACE so the file shows its own posture;
-- CREATE OR REPLACE preserves ACLs, so this is belt-and-braces, not a fix.
REVOKE EXECUTE ON FUNCTION draft_tick() FROM PUBLIC, anon, authenticated;
