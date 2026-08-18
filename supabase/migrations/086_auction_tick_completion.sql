-- ============================================================================
-- The auction clock: draft_tick ARM 2.6 + the priced completion writer —
-- migration 086 (task L.C1.4; spec §8.2 (timer enforcement), §8.6.2
-- (nomination timeout), §8.6.4 (bid clock hits 0), §8.6.6 (repeat until
-- rosters full), §8.6.7(b)/(c)/(e) (the endgame arms), §8.6.8 (solvency),
-- §12.4 (the auction pick shape), §12.7 (`acquisition_cost`), §14 (the
-- draft-tick row), §22.3 (SKIP-LOCKED batches), E26/E27/E30/E48;
-- tasks-M3 §4 standing rules (rule 6 lock discipline, rule 7 solvency
-- doctrine, rule 8 bid-path discipline), D126/D129(2)(3)(4)/D130/D137/
-- D146; D102's grace contract carried to the nomination clock; D111(3)).
-- pgTAP file is **035** (034 = the auction core; next free confirmed at
-- task time). Discharges ledger row **F62**.
--
-- SPEC ERRATA RIDING THIS PR (the fold-back rule; both dispositioned
-- "Builder-carriable" by tasks-M3 §9, and this is the task that implements
-- the behaviour they describe) — spec **v2.12.1**:
--   * **C32 — §8.6.2 step 2's "or skips per setting" names a setting that
--     does not exist** in §7.3.8 and never has. v1 always system-nominates;
--     the erratum prints the mechanism this migration implements, including
--     the K/D-ST forced-only mapping (item 3 below) and the §8.5.5 hold
--     carried to the nomination clock.
--   * **C33 — §8.6.7 (e) contradicts (b)** at the one instant both apply:
--     (e) as printed can nominate a player the NOMINATOR cannot roster, and
--     (b) then awards it to that nominator. Reconciled by D129(2)'s reading
--     — the system nomination runs the nominator's OWN resolve chain, so
--     (e) is satisfied a fortiori and (b) is always legal.
--
-- D137 HEAD RULE — the source of every replaced body, named, and why it is
-- the head (each verified with `grep -n 'FUNCTION <name>' supabase/migrations/*.sql`
-- rather than from `pg_get_functiondef`, per the CLAUDE.md 073 lesson):
--   * `draft_apply_pick_internal` ← **066_draft_core_rpcs.sql:743–846**.
--     066 is the ONLY migration that defines it (072 amended 066 IN PLACE
--     under the F12 unreleased-chain rule, so 066's file text already
--     carries the completion arm; 084 and 085 did not touch it).
--   * `draft_autopick_resolve` ← **068_draft_tick_autopick.sql:463–648**.
--     068 is the only migration that defines it (071 amended 068 in place
--     for the mock branch — again F12, so 068's file text is current).
--   * `draft_tick` ← **068_draft_tick_autopick.sql:657–1247**. Same: 069,
--     070 and 071 all amended 068 in place, so its file text carries ARMs
--     1, 1.5, 1.6, 2, 2.5 and 3 as deployed. 085 named it explicitly as
--     NOT touched.
--   Nothing else is replaced here. `draft_nominate`/`draft_place_bid`
--   (085), the derivation family (084) and the commissioner controls (069)
--   are untouched.
--
-- ----------------------------------------------------------------------------
-- THE DEFECT THIS MIGRATION CLOSES (measured on main @ 9c81f7c with the
-- 001–085 chain applied, before a line of this file was written — not
-- inferred from the code):
--   `draft_tick` ARM 2 claims EVERY live draft with a due deadline and has
--   no `draft_type` awareness at all. 084 made auctions startable. So a
--   live auction whose NOMINATION clock expired past deadline + grace was
--   run through the SNAKE path: a privileged probe (an 8-team $200/min-1
--   auction started through `draft_start_internal`, deadline rewound to
--   now() − 60s, one direct `draft_tick()` call) wrote
--     draft_picks(pick_number=1, round=1, price=NULL, is_auto=t,
--                 made_via='autopick')
--   and advanced `current_pick_number` to 2 with `on_clock_team_id` moved
--   by `draft_team_for_pick` — i.e. a free player, no nomination, no bid,
--   ZERO `draft_bids` rows, and `current_nomination` still NULL. (At
--   deadline + 1s the same probe reported `held_for_grace: 1` and wrote
--   nothing — the grace hold was the only thing standing between a live
--   auction and a silently snake-drafted board.) ARM 2's claim and its
--   under-lock re-verify therefore both gain `draft_type <> 'auction'`,
--   and pgTAP 035 §C pins that a due auction is NOT snake-autopicked.
-- ----------------------------------------------------------------------------
--
-- Contents:
--   1. `draft_complete_internal(p_draft_id)` — NEW. **THE ONE completion
--      writer**, extracted from 066's `draft_apply_pick_internal` because
--      the second consumer has arrived (the L.B1.3 extraction precedent:
--      an internal gets extracted WHEN, not before). Sets the draft to
--      `complete`, populates `league_rosters` from the non-undone picks
--      with **`acquisition_cost = p.price`** (D111(3)/§12.7 — NULL for
--      snake, because `draft_picks.price` is NULL there; the auction's
--      winning price for auction rows: ONE expression, both engines), and
--      flips the league to `in_season`. The mock bypass, the D43 snapshot
--      guard interaction and the drafts→leagues lock order are 072's,
--      unchanged.
--      **IT ACCEPTS A PARTIAL BOARD, DELIBERATELY.** It asserts nothing
--      about roster fullness — it writes exactly the picks that exist.
--      The all-slots-full DETECTOR stays in the two callers (the snake
--      pick counter in `draft_apply_pick_internal`, the rotation scan in
--      ARM 2.6), which is what makes L.C1.5's `draft_end` (C41's ruled
--      end-as-is) a one-line call rather than a second implementation:
--      unfilled slots simply produce fewer `league_rosters` rows and
--      `in_season` flips regardless. That is the sanctioned partial entry
--      the tasks-M3 §6 L.C1.4 banner requires and the L.C1.5 banner
--      cross-references.
--      It also clears `current_nomination` — a no-op for snake (always
--      NULL) and auction hygiene for a board that completed on an award.
--   2. `draft_apply_pick_internal` — REPLACED FROM 066. The completion
--      block's 38 lines become one `PERFORM public.draft_complete_internal`
--      call. Every other line — the write, the live-pick count, the snake
--      advance, the return shape — is 066's, byte-identical (proven by the
--      diff in the PR body). Behaviour for snake/linear is unchanged: the
--      rosters INSERT now reads `p.price`, which is NULL on every snake
--      row, so it writes the same NULL 066 wrote literally.
--   3. `draft_autopick_resolve` — REPLACED FROM 068. **ONE hunk**: the E30
--      K/DST deferral's OPEN-mode escape gains `draft_type <> 'auction'`.
--      D129(2)'s ruling is that in an auction the deferral maps to the
--      FORCED-ONLY arm — there are no rounds in an auction, so the
--      round-window escape (`current_round > total_rounds − 3`) has no
--      meaning to inherit. `current_round` on an auction is the ROTATION
--      LAP (D126, display-only), and letting a lap counter unlock kickers
--      would be exactly the accidental coupling D126 calls display-only.
--      **The boundary, finalized and pinned (035 §G):** K/DST stay
--      ineligible in OPEN mode for the whole auction, at every lap, and
--      become eligible the instant FORCED mode engages (`remaining <=
--      unfilled`) with a K/DST seat among the unfilled — pinned one unit
--      short on both sides (remaining = unfilled + 1 defers; remaining =
--      unfilled admits). Snake/linear are unaffected: `draft_type <>
--      'auction'` is TRUE for them, so the expression is the same
--      expression, and 022's E30 boundary pins stay green.
--   4. `draft_tick` — REPLACED FROM 068. Three hunks:
--      (a) ARM 2's claim WHERE and its under-lock re-verify exclude
--          auctions (the defect block above);
--      (b) ARM 2.5's claim WHERE and its under-lock re-verify exclude
--          auctions too (R362) — the SAME two lines, because that arm
--          reaches the SAME snake writer by a second door. Measured, not
--          inferred: see the ARM 2.5 comment for the fixture and the
--          `"mock_cpu_picked": 1` it returned before these lines existed;
--      (c) **ARM 2.6**, new, between ARM 2.5 and ARM 3 exactly as the
--          breakdown sequences it (D129/D130).
--
-- ----------------------------------------------------------------------------
-- ARM 2.6 — WHAT IT DOES
-- ----------------------------------------------------------------------------
-- CLAIM: live + `draft_type = 'auction'` + NOT mock + due deadline + alive
-- league, `ORDER BY current_deadline LIMIT 25 FOR UPDATE SKIP LOCKED`, in
-- ARM 2's loop + `v_seen` rotation shape. The batch ceiling and its
-- known >25 behaviour are ARM 2's, inherited deliberately — tasks-M3 §10
-- routes that to **F50** (M7) and explicitly says ARM 2.6 shares it and
-- files no new row. Every claim predicate is re-verified UNDER the held
-- lock (the R135 claim ≡ body discipline).
--
-- MOCKS ARE OUT OF SCOPE HERE, AND UNREACHABLE: 071's `create_mock_draft`
-- refuses auction configs and a mock's `draft_type` is snapshotted at
-- creation, so no auction mock can exist; 085's two verbs refuse mocks for
-- the same reason (F61). L.C1.7 adds the mock CPU sub-arm (D132/D138) and
-- opens the claim. Recorded consequence in the meantime: a hand-built live
-- auction mock (privileged fixture only) is claimed by NO tick arm — and
-- THAT SENTENCE IS NOW TRUE OF ALL THREE, which it was not when it was
-- first written (R362). ARM 2 excludes auctions, **ARM 2.5 excludes them
-- too** and ARM 2.6 excludes mocks. The observation that establishes it
-- is not the reading of three WHERE clauses but a run: the fixture in the
-- ARM 2.5 comment — live auction mock, CPU seat on the clock, think-time
-- due, deadline still in the future — returns
-- `mock_cpu_picked: 0, mock_cpu_failures: [], auction_claimed_due: 0`
-- with zero `draft_picks`, `current_pick_number` still 1 and the draft
-- still `live`; the same fixture returned `mock_cpu_picked: 1` and a
-- snake-shaped pick before ARM 2.5's two lines were added. 035 §J is
-- that run, pinned — including the "no arm FAILED either" half, so the
-- zero is an arm-scope fact and not a contained exception (CLAUDE.md:
-- never let "nothing happened" mean "it worked"). That is the honest
-- seam, not an oversight.
--
-- (a) NOMINATION EXPIRY (`current_nomination IS NULL` — D126's phase rule).
--     **The D102 grace contract, carried verbatim to the nomination clock
--     (D129(3)).** `is_autodraft` seats, no-user seats (placeholder /
--     vacated — E48) and seats FRESH AS OF THE DEADLINE system-nominate AT
--     the deadline; a STALE human seat is HELD to deadline + grace, during
--     which the manager may still nominate manually (`draft_nominate` never
--     reads the deadline — the E3 posture `draft_make_pick` has). Freshness
--     is measured against the DEADLINE INSTANT, not now() — R132's rule,
--     re-used rather than re-derived, and the 45s constant is the same
--     `draft_liveness_freshness()` every other arm reads.
--     THE SYSTEM NOMINATION (D129(2), C33's erratum): the on-clock team's
--     OWN resolve chain — `draft_autopick_resolve` — at an opening bid of
--     `auction_min_bid` ($0 is legal when min_bid is 0 — C38). Because the
--     player fits the NOMINATOR's open slot, §8.6.7(e)'s "fits *some*
--     team's open slot" is satisfied and §8.6.7(b)'s no-raise award to the
--     nominator is always legal. One implementation, snake and auction.
--     **F62 — DISCHARGED HERE:** the system nomination writes its opening
--     bid as a `draft_bids` row exactly like a human one, with
--     **`action_id` NULL** (the reason C39 made the column NULLable).
--     035 §D pins it. The invariant is not merely pinned but LOAD-BEARING:
--     the award below derives its attribution from that row and refuses
--     loudly if it is missing.
--     Two §8.6.8 assertions guard the nomination, both through the ONE
--     derivation family (rule 7): the nominator has `open_slots >= 1`
--     (§8.6.7(c) — the rotation guarantees it, so a violation is engine
--     corruption and is LOUD), and `max_bid >= min_bid` (which solvency
--     implies: remaining >= open × min_bid ⇒ max_bid = remaining −
--     (open − 1) × min_bid >= min_bid). Neither can fail on a sound board;
--     both refuse rather than open a nomination nobody can afford.
--
-- (b) BID EXPIRY (`current_nomination IS NOT NULL`) → THE AWARD (D130).
--     **NO GRACE, deliberately (D129(4)/§8.6.5/OQ 10):** the grace contract
--     is a NOMINATION-clock rule. Nobody is auto-bid for and nobody can be
--     timed INTO a bid, so a stale nominator or a stale high bidder delays
--     nothing — the clock closes on schedule. Pinned from that side in 035.
--     Winner and price come from `current_nomination` (the authoritative
--     high bid 085 maintains). **E26 IS STRUCTURAL, NOT A BRANCH:** 085
--     writes `high_bidder_team_id` = the nominator at nomination time, so
--     "bid clock expires with no raises ⇒ the nominator wins at the opening
--     bid" is what awarding the standing high bidder DOES. There is no
--     no-raise special case to get wrong — which is why the DoD's printed
--     break probe ("drop the E26 branch") is realised in this file as a
--     guard that voids the winner when the nomination has only its opening
--     row; see the falsifiability notes.
--     ATTRIBUTION (§12.4's shape, D130's "per actor"): the winning
--     `draft_bids` row is looked up by (nomination_seq, **player**, team,
--     amount) — `player_id` is in that list because D143 lets one
--     `nomination_seq` carry two nominations' rows (a cancel does not
--     consume the number), so the triple without it is NOT unique and the
--     `b.id DESC` tiebreak behind the `created_at` ordering is a random
--     UUID (083). R363; 035 §K pins it — and
--     **`is_auto := (that row's action_id IS NULL)`** — a system-opened,
--     unraised nomination is `is_auto = TRUE, made_via = 'autopick'`;
--     anything a human nominated or raised is `is_auto = FALSE,
--     made_via = 'manager'`. `round` is NULL (D126 — an auction has no
--     rounds). `picked_by` and `action_id` are NULL: the clock wrote this
--     pick, not a user, and §12.5's `draft_bids` carries no user column —
--     deriving one from `league_members` would misattribute the moment a
--     seat changes hands (§7.2.1 franchises outlive managers), so the
--     attribution that IS recorded (`team_id`, and the bid history itself)
--     is the one that stays true. This is ARM 2's posture verbatim.
--     **§8.6.8 AT THE AWARD (rule 7 — the award is the money-moving step;
--     bids move nothing, D131(2)).** Before writing, the winner is re-read
--     through `draft_team_budget` under the held lock: `open_slots >= 1`
--     (E27) and `price <= max_bid`. The second is the whole algebra 085's
--     bid clause exists to establish — max_bid is precisely the largest
--     amount whose award leaves remaining' >= open_slots' × min_bid — so
--     re-checking it here is what makes the award solvency-preserving BY
--     CONSTRUCTION rather than by trust in an earlier validator. A
--     violation is engine corruption (D131(4) makes commissioner budget
--     edits refuse it) and is LOUD: the award is refused, recorded in
--     `auction_failures`, and retried each tick. **Recorded residual, as
--     DRIVEN rather than assumed (R364) — THERE IS NO REMEDY TODAY:** the
--     state was forged (an over-max `high_bid` with a backing bid row, so
--     F62's check passes and the solvency clause is what refuses) and run.
--     The refusal is correct and loud — `auction_failures[0]` names §8.6.8,
--     no pick is written, the nomination stands. But `draft_pause` →
--     `draft_resume` leaves the draft `live` with the SAME nomination and
--     a `time_left` of −00:00:01, and the next `draft_tick()` reproduces
--     the identical failure: **pause contains the retry loop, it does not
--     clear the nomination.** `draft_cancel_nomination` DOES NOT EXIST YET
--     — it is L.C1.5's deliverable — so the only recovery available in
--     this migration's world is `draft_reset` + `draft_start_internal`,
--     which WIPES THE BOARD. Reachability, for the record: 069's
--     `draft_move_player` has no `draft_type` guard and can shrink a live
--     high bidder's `max_bid`, so a commissioner mis-click can produce the
--     state before L.C1.5's priced validation lands — that arm is already
--     an explicit L.C1.5 deliverable, so no new ledger row is owed. The
--     trade is still the right one (an insolvent award breaks a
--     never-weaken invariant permanently; a loud stall is recoverable at
--     the cost of the board), but the cost is stated here at its real
--     size instead of as a verb that has not shipped.
--     ROTATION (§8.6.7(c)/E27, D130): the next nominator is the first team
--     AFTER the NOMINATOR in `nomination_order` with `open_slots >= 1`.
--     After the nominator, not after the winner — `on_clock_team_id` stays
--     the nominator through the whole bidding phase (D157(2)), and it is
--     the seat the rotation advances FROM. Complete rosters are skipped.
--     One statement, `CROSS JOIN LATERAL draft_team_budget` — the shape
--     `draft_auction_solvent` itself uses, so the rotation reads the ONE
--     family (rule 7) without n round trips inside the lock.
--     `current_round` is incremented when that scan WRAPS past the end of
--     the order — the rotation LAP, display-only per D126, with no engine
--     consumer left now that item 3 removed the resolve chain's.
--     COMPLETION (§8.6.6/D130): the scan finding NO eligible team IS the
--     completion condition — one computation, so "no team has open slots"
--     and "the rotation has nowhere to go" can never disagree. It calls
--     `draft_complete_internal`, which prices the rosters. §8.6.6's
--     "or budgets exhausted" is unreachable by construction: solvency
--     guarantees every open slot is affordable at min_bid, and 035 §H
--     spot-checks it with a greedy-spend board driven to completion
--     (§H, not §F — verified against 035's own `^-- [A-Z]\. ` anchors, the
--     R333 method; §F is the rotation/completion world).
--
-- ----------------------------------------------------------------------------
-- SQLSTATE conventions (063, carried): the tick has no user-facing
-- refusals — every raise inside an arm is contained by that arm's
-- per-draft subtransaction, recorded in the returned summary and WARNed
-- with the draft_id, exactly as ARMs 1/1.5/1.6/2/2.5 do. Nothing here is
-- silent (CLAUDE.md: "never let nothing happened mean it worked").
--
-- Grants doctrine (tasks-M1 §4.1, D18→D23; M3 §4 rule 1): no per-object
-- GRANTs. `draft_complete_internal` is a plain (SECURITY INVOKER) internal
-- like `draft_apply_pick_internal`, `SET search_path = ''`, and TRIPLE
-- revoked (PUBLIC, anon, authenticated) — it has no client consumer and
-- never will; its callers are the SECURITY DEFINER RPCs. Every replaced
-- function keeps its 066/068 posture, restated below so the file shows it.
--
-- Migration checklist (plan §8.1 / tasks-M3 §4.4): no DDL — one new
-- function plus three `CREATE OR REPLACE`s; no table, column, index,
-- policy or data change · no new realtime surface (the `draft_bids`
-- broadcast trigger is 088/L.C1.6's, D134; the award's `draft_picks`
-- INSERT and the completion's `league_rosters` INSERTs ride triggers that
-- already exist — 070 and 072 respectively) · staging rehearsal:
-- **R6 waiver** — no staging clone exists (environments are local + prod
-- only); the recorded rehearsal evidence is the fresh local
-- `npx supabase db reset` replay of the full 001–086 chain in this task's
-- PR plus pgTAP 035 in the same PR · **D38 waiver N/A** (no new table) ·
-- typegen re-run with the hand-written alias block re-appended.
--
-- Falsifiability notes (§4.3) — every number below was RUN, not predicted
-- (the R306/R314 lesson). Each probe was applied to the LOCAL database
-- ONLY, as a `CREATE OR REPLACE` from a patched copy of this file, and
-- reverted by re-applying this file unmutated — never `db push`, never a
-- hosted project. pgTAP 035 was 105/105 and the wire suite 3/3 before and
-- after each of probes 1–3 at first landing; the file now carries **116**
-- pins (R362/R363 added 11), and the batch-4 fix cycle re-ran ALL of them
-- at 116/116 and 3/3 before and after — a recorded count against a file
-- that has since grown is a number nobody can reproduce.
--   * **BREAK PROBE 1 (the DoD's own, adapted and disclosed) — AS RUN AT
--     FIRST LANDING: 35 of 035's 105 pins RED, and the file runs to the
--     END** — **re-run in the batch-4 fix cycle: 39 of 116**, that same
--     set reproduced exactly plus §K's 112–115 (LV's award is itself a
--     no-raise nomination, so §K is real E26 coverage as well as R363's) (pins 23,
--     25–27, 29, 31–32, 35–36, 38, 40, 43–44, 46–47, 49, 51–52, 55, 60–61,
--     63, 65–67, 71, 79, 82–83, 86–91), plus **2 of the wire suite's 3**
--     cases. The task prints "award to high bidder even when no raises
--     exist (drop the E26 branch)". In THIS implementation there is no E26
--     branch to drop — 085 makes the nominator the high bidder, so awarding
--     the high bidder IS §8.6.7(b). The mutation with the same MEANING is a
--     guard that refuses to award when the nomination carries only its
--     opening row: no-raise nominations then never award, which is exactly
--     the defect the E26 goldens exist to catch (pin 46 is the human $7
--     one the DoD names; pin 31 the system one). The blast radius is wide
--     because every system nomination in this engine is a no-raise award —
--     that is the arm's normal operating mode, not a coverage accident.
--     NAMED SO NOBODY COUNTS THEM AS COVERAGE THEY ARE NOT: the wire
--     suite's FIRST case stays GREEN by construction (the probe touches
--     only the award, never the nomination), as do 035 §A's form pins,
--     §G's resolve pins and §I's completion-writer pins, which never route
--     through the award at all.
--   * **BREAK PROBE 2 (the E27 rotation skip) — AS RUN: 9 of 105 RED**
--     (60, 63, 65–67, 71, 79, 87–88) plus **1 of the wire suite's 3**;
--     re-run against 116 pins: **9 of 116**, the same set. Caveat filed
--     as ledger F67: pins 79/87 read `auction_failures->0`, an index this
--     probe makes ambiguous by breaking a second world in the same tick,
--     and `now()` is transaction-stable in pgTAP so the forced deadlines
--     TIE — one run in ~7 reported 8 with 79/87 green. The unprobed file
--     is deterministic (116/116, empty and restored pools alike).
--     Dropping `open_slots >= 1` from the rotation scan lands the rotation
--     on a complete roster, so the completion condition is never reached.
--     Pins 89–91 stay GREEN by construction and are named: the greedy board
--     still FILLS all 24 spots, it just never COMPLETES — which is pin 88.
--   * **BREAK PROBE 3 (D146, the one-unit doctrine applied to this file's
--     own never-weaken guard) — AS RUN: 13 of 105 RED** (78–80, 82–84,
--     86–92) and **0 of 3** in the wire suite; re-run against 116 pins:
--     **13 of 116**, the same set. Loosening the award's
--     solvency clause from `price > max_bid` to `price > max_bid + 1` lets
--     a $199 award land against a $198 max bid (pin 78) and — the point of
--     the doctrine — turns `draft_auction_solvent` FALSE on the finished
--     board (pin 92). The wire suite is GREEN by construction and is named:
--     its fixture never produces an over-max high bid, because 085's bid
--     clause refuses one; the state is reachable only through 035's
--     privileged simulation, which is why the pin lives there.
--   * **BREAK PROBE 4 (batch-4/R362 — the ARM 2.5 exclusion this cycle
--     added). Both lines removed. AS RUN: 3 of 116 RED** (107, 109, 110)
--     and **0 of 3** in the wire suite, which has no mock auction — run,
--     not assumed. §J's pins 106 and 108 stay GREEN by construction and
--     are named: 106 asserts the fixture is CLAIMABLE before the tick and
--     108 asserts the arm did not claim-then-fail, so neither moves when
--     the arm simply picks. They are the reason the section's zeroes mean
--     something.
--   * **BREAK PROBE 5 (batch-4/R363 — the award lookup's `player_id`
--     discriminator). Removed. AS RUN: 2 of 116 RED** (114, 115): the
--     decoy row wins the ordering, `is_auto` flips to FALSE and
--     `made_via` to `manager` — the WRONG ACTOR recorded on the pick,
--     which is the defect the predicate exists to prevent. **0 of 3** in
--     the wire suite (its fixture writes one row per (sequence, player),
--     so no decoy exists there) — run, not assumed.
--   * **ONE UNIT SHORT, EVERYWHERE (D146/R320).** Every ≥/≤/< comparison
--     this migration makes carries a pin that is false by exactly one unit
--     of the thing compared:
--       open_slots >= 1 (rotation skip)  → a 1-slot team is nominated
--                                          next / a 0-slot team is skipped
--       open_slots >= 1 (award, E27)     → the same pair at the award
--       price <= max_bid (award)         → exactly max_bid awards and
--                                          leaves solvency TRUE at
--                                          equality / max_bid + 1 is
--                                          refused and writes no pick
--       now() < deadline + grace         → deadline + grace − 1s HOLDS,
--                                          deadline + grace + 1s nominates
--       freshness (45s, as-of-deadline)  → a beat 44s before the deadline
--                                          is FRESH (nominates at once),
--                                          46s before is STALE (holds)
--       completion (no open slots left)  → one team with ONE slot left
--                                          keeps the draft live; that slot
--                                          filling completes it
--       K/DST forced-only (auction)      → remaining = unfilled + 1 still
--                                          defers, remaining = unfilled
--                                          admits
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. draft_complete_internal — THE ONE completion writer (§8.5 step 6 /
--    §8.6.6, §12.7, D111(3)/D88). Extracted from 066 because the auction
--    award is the second consumer and L.C1.5's draft_end is the third.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_complete_internal(p_draft_id UUID)
RETURNS public.drafts
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft public.drafts;
BEGIN
  -- CALLER CONTRACT: the drafts row is held FOR UPDATE and the caller has
  -- already decided that the draft is finished. This helper asserts NOTHING
  -- about roster fullness — a PARTIAL board is a legal input (C41's
  -- end-as-is; L.C1.5's draft_end is the one sanctioned partial caller).
  UPDATE public.drafts SET
    status             = 'complete',
    completed_at       = now(),
    on_clock_team_id   = NULL,
    current_deadline   = NULL,
    current_nomination = NULL,     -- no-op for snake; hygiene for an auction
    updated_at         = now()
  WHERE id = p_draft_id
  RETURNING * INTO v_draft;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_complete_internal: draft % not found', p_draft_id
      USING ERRCODE = 'P0002';
  END IF;

  -- THE COMPLETION ARM (066's text, D111(3)-priced). NON-mock only: the
  -- §8.8 zero-side-effect contract keeps a mock at drafts.complete + recap
  -- — no rosters, no league transition (pinned from this side in 025/026).
  -- In THIS txn, under the caller's drafts-row lock (drafts → leagues —
  -- see 072's banner lock analysis):
  --   * league_rosters from the draft's non-undone picks
  --     (acquisition_type='draft'; **acquisition_cost = p.price** — D111(3)
  --     /§12.7: the auction's winning bid, and NULL on every snake row
  --     because draft_picks.price is NULL there, which is the literal NULL
  --     066 wrote. ONE expression, both engines). slot_key/IR columns stay
  --     NULL (M4's). The §12.7 UNIQUE(league_id, player_id) is the
  --     exclusivity backstop — a duplicate here means engine corruption and
  --     the 23505 aborts the completion LOUDLY (nothing to convert:
  --     uniq_draft_player_live makes it unreachable via any RPC path).
  --   * leagues.status = 'in_season' (§8.5 step 6 / §8.6.6). The D43
  --     snapshot guard fires on this UPDATE and holds — the snapshot has
  --     existed since draft_start (pinned in 026). 070's status-column
  --     trigger broadcasts the flip on league:<id> (home hero / draft bar).
  IF NOT v_draft.is_mock THEN
    INSERT INTO public.league_rosters
      (league_id, team_id, player_id, acquisition_type, acquisition_cost)
    SELECT p.league_id, p.team_id, p.player_id, 'draft', p.price
    FROM public.draft_picks p
    WHERE p.draft_id = p_draft_id
      AND p.is_undone = FALSE;

    UPDATE public.leagues
    SET status = 'in_season', updated_at = now()
    WHERE id = v_draft.league_id;
  END IF;

  RETURN v_draft;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_complete_internal(UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. draft_apply_pick_internal — REPLACED FROM 066 (D137 head rule,
--    066:743–846). The ONLY change is the completion block: 38 lines
--    become one draft_complete_internal call. The write, the live-pick
--    count, the snake advance and the return shape are 066's, unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_apply_pick_internal(
  p_draft_id UUID,
  p_player_id TEXT,
  p_is_auto BOOLEAN,
  p_made_via TEXT,
  p_picked_by UUID,
  p_action_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft      public.drafts;
  v_pick       public.draft_picks;
  v_team_count INTEGER;
  v_timer      INTEGER;
  v_next       INTEGER;
  v_live_picks BIGINT;
BEGIN
  -- Plain re-read: the caller holds the drafts-row lock (§4.6), so this is
  -- the authoritative current state.
  SELECT d.* INTO v_draft
  FROM public.drafts d
  WHERE d.id = p_draft_id;

  v_team_count := jsonb_array_length(v_draft.draft_order);
  v_timer := COALESCE((v_draft.config->>'pick_timer_seconds')::int, 90);

  -- (3) WRITE.
  INSERT INTO public.draft_picks
    (draft_id, league_id, pick_number, round, team_id, player_id,
     is_auto, picked_by, made_via, action_id)
  VALUES
    (p_draft_id, v_draft.league_id, v_draft.current_pick_number,
     v_draft.current_round, v_draft.on_clock_team_id, p_player_id,
     p_is_auto, p_picked_by, p_made_via, p_action_id)
  RETURNING * INTO v_pick;

  -- (4) ADVANCE. Completion = all total_rounds × team_count LIVE picks
  -- (counted, not inferred — robust against L.B1.4's undo rewinds).
  SELECT count(*) INTO v_live_picks
  FROM public.draft_picks p
  WHERE p.draft_id = p_draft_id AND p.is_undone = FALSE;

  IF v_live_picks >= v_draft.total_rounds * v_team_count THEN
    -- COMPLETION (086/L.C1.4): the 38 lines 072 amended in here are now
    -- `draft_complete_internal` — THE ONE completion writer, so the snake
    -- board, the auction award (ARM 2.6) and L.C1.5's `draft_end` cannot
    -- drift apart. Behaviour for snake/linear is unchanged: the rosters
    -- INSERT reads `p.price`, which is NULL on every snake row — the same
    -- NULL this block used to write literally (D111(3) prices auction rows
    -- through the same expression). The all-slots-full DETECTOR stays HERE,
    -- above the call: the helper accepts a partial board on purpose.
    v_draft := public.draft_complete_internal(p_draft_id);
  ELSE
    v_next := v_draft.current_pick_number + 1;
    UPDATE public.drafts SET
      current_pick_number = v_next,
      current_round       = ((v_next - 1) / v_team_count) + 1,
      on_clock_team_id    = public.draft_team_for_pick(
                              draft_order, draft_type,
                              COALESCE((config->>'snake_reversal')::boolean, FALSE),
                              v_next),
      current_deadline    = CASE WHEN v_timer > 0
                                 THEN now() + make_interval(secs => v_timer)
                                 ELSE NULL END,
      updated_at          = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_draft;
  END IF;

  -- (5) RETURN the new authoritative state.
  RETURN jsonb_build_object('draft', to_jsonb(v_draft), 'pick', to_jsonb(v_pick));
END;
$$;

REVOKE EXECUTE ON FUNCTION
  draft_apply_pick_internal(UUID, TEXT, BOOLEAN, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. draft_autopick_resolve — REPLACED FROM 068 (D137 head rule,
--    068:463–648). ONE hunk: the E30 K/DST round-window escape becomes
--    snake/linear-only, so an auction's deferral is the FORCED-ONLY arm
--    (D129(2)). Everything else — the sources, the R120 queue join, the mock
--    branch, the greedy model a–h, the never-stall floor — is 068's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION draft_autopick_resolve(
  p_draft_id UUID,
  p_team_id UUID
) RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_draft    public.drafts;
  v_league   public.leagues;
  v_user     UUID;
  v_slots    JSONB;
  v_n_slots  INTEGER;
  v_counts   INTEGER[] := '{}';
  v_filled   INTEGER[] := '{}';
  v_have     JSONB := '{}';         -- normalized position -> count on team
  v_picks    INTEGER := 0;
  v_unfilled INTEGER := 0;
  v_remaining INTEGER;
  v_forced   BOOLEAN;
  v_need     TEXT[] := '{}';        -- positions accepted by unfilled slots
  v_i        INTEGER;
  v_placed   BOOLEAN;
  v_row      RECORD;
  v_ok       BOOLEAN;
  v_floor    TEXT;
BEGIN
  SELECT d.* INTO v_draft FROM public.drafts d WHERE d.id = p_draft_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT l.* INTO v_league FROM public.leagues l WHERE l.id = v_draft.league_id;

  -- The seat's user (NULL row or NULL user_id = no-user seat — E48).
  -- MOCK-AWARE (L.B1.6/071 — amended in place, F12; D93/D103): in a mock,
  -- the HUMAN seat resolves under the LAUNCHER's queue/boards — the
  -- launcher is the one practicing, and the chosen seat may be a
  -- placeholder or another member's franchise — while every CPU seat
  -- resolves as a NO-USER seat (ADP + need, §8.8's bot behavior per D93:
  -- a CPU seat must NEVER read its real owner's queue/boards — pinned in
  -- 025). launched_by is RPC-written (auth.uid()::text) so the cast is
  -- safe; a hand-crafted garbage value raises and is contained by the
  -- tick's per-draft subtransaction.
  IF v_draft.is_mock THEN
    IF v_draft.config->'mock'->>'human_team_id' = p_team_id::text THEN
      v_user := (v_draft.config->'mock'->>'launched_by')::uuid;
    ELSE
      v_user := NULL;
    END IF;
  ELSE
    SELECT m.user_id INTO v_user
    FROM public.league_members m
    WHERE m.league_id = v_draft.league_id AND m.team_id = p_team_id;
  END IF;

  -- Greedy model steps a–c (banner): capacities, then assign existing
  -- picks in pick order.
  v_slots := COALESCE(v_league.roster_settings->'starting_slots', '[]'::jsonb);
  v_n_slots := COALESCE(jsonb_array_length(v_slots), 0);
  FOR v_i IN 1..v_n_slots LOOP
    v_counts[v_i] := COALESCE((v_slots->(v_i - 1)->>'count')::int, 0);
    v_filled[v_i] := 0;
  END LOOP;

  FOR v_row IN
    SELECT CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END AS pos
    FROM public.draft_picks p
    JOIN public.players pl ON pl.id = p.player_id
    WHERE p.draft_id = p_draft_id AND p.team_id = p_team_id
      AND p.is_undone = FALSE
    ORDER BY p.pick_number
  LOOP
    v_picks := v_picks + 1;
    v_have := jsonb_set(v_have, ARRAY[v_row.pos],
                        to_jsonb(COALESCE((v_have->>v_row.pos)::int, 0) + 1));
    v_placed := FALSE;
    FOR v_i IN 1..v_n_slots LOOP
      IF NOT v_placed
         AND v_filled[v_i] < v_counts[v_i]
         AND (v_slots->(v_i - 1)->'eligible') ? v_row.pos THEN
        v_filled[v_i] := v_filled[v_i] + 1;
        v_placed := TRUE;
      END IF;
    END LOOP;
    -- not placed => bench (implicit)
  END LOOP;

  FOR v_i IN 1..v_n_slots LOOP
    IF v_filled[v_i] < v_counts[v_i] THEN
      v_unfilled := v_unfilled + (v_counts[v_i] - v_filled[v_i]);
      v_need := v_need || ARRAY(
        SELECT jsonb_array_elements_text(v_slots->(v_i - 1)->'eligible'));
    END IF;
  END LOOP;

  v_remaining := COALESCE(v_draft.total_rounds, 0) - v_picks;
  v_forced := v_remaining <= v_unfilled;   -- greedy step d

  -- Source-priority enumeration (banner item 4). Each branch is gated so a
  -- no-user seat (v_user NULL) resolves straight to ADP; the queue branch
  -- carries the R120 team -> draft-league join.
  FOR v_row IN
    SELECT c.player_id, c.pos
    FROM (
      SELECT 1 AS src,
             row_number() OVER (ORDER BY q.rank, q.player_id) AS ord,
             q.player_id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END AS pos
      FROM public.draft_queues q
      JOIN public.teams t
        ON t.id = q.team_id AND t.league_id = v_draft.league_id   -- R120
      JOIN public.players pl ON pl.id = q.player_id
      WHERE v_user IS NOT NULL
        AND q.draft_id = p_draft_id AND q.team_id = p_team_id
      UNION ALL
      SELECT 2,
             row_number() OVER (ORDER BY lp.position, lp.player_id),
             lp.player_id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
      FROM public.league_lists ll
      JOIN public.lists ls ON ls.id = ll.list_id AND ls.deleted_at IS NULL
      JOIN public.list_players lp ON lp.list_id = ll.list_id
      JOIN public.players pl ON pl.id = lp.player_id
      WHERE v_user IS NOT NULL
        AND ll.league_id = v_draft.league_id
        AND ll.owner_id = v_user
        AND ll.is_primary_board = TRUE
      UNION ALL
      SELECT 3,
             row_number() OVER (ORDER BY lp.position, lp.player_id),
             lp.player_id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
      FROM public.lists b
      JOIN public.list_players lp ON lp.list_id = b.id
      JOIN public.players pl ON pl.id = lp.player_id
      WHERE v_user IS NOT NULL
        AND b.owner_id = v_user AND b.is_big_board = TRUE
        AND b.deleted_at IS NULL
      UNION ALL
      SELECT 4,
             row_number() OVER (ORDER BY pl.adp NULLS LAST, pl.id),
             pl.id,
             CASE WHEN pl.position = 'DEF' THEN 'DST' ELSE pl.position END
      FROM public.players pl
    ) c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.draft_picks dp
      WHERE dp.draft_id = p_draft_id AND dp.player_id = c.player_id
        AND dp.is_undone = FALSE
    )
    ORDER BY c.src, c.ord
  LOOP
    IF v_forced THEN
      -- Greedy step d: every remaining pick must fill a required seat
      -- (E30's "until forced" arm rides need membership).
      v_ok := v_row.pos = ANY(v_need);
    ELSE
      -- Greedy steps e–g: E30 deferral + the 3rd-QB useful cap (caps lift
      -- when no starting seat is unfilled).
      -- 086/L.C1.4 — THE ONE HUNK: the E30 round-window escape is
      -- SNAKE/LINEAR's. D129(2) rules that an auction's K/DST deferral maps
      -- to the FORCED-ONLY arm below: there are no rounds in an auction, and
      -- `current_round` there is the display-only ROTATION LAP (D126), so
      -- inheriting the window would let a lap counter unlock kickers. K/DST
      -- therefore stay ineligible in OPEN mode for the whole auction and
      -- become eligible exactly when FORCED mode engages with a K/DST seat
      -- unfilled (pinned one unit short both ways, 035 §G).
      v_ok := (v_row.pos NOT IN ('K', 'DST')
               OR (v_draft.draft_type <> 'auction'
                   AND v_draft.current_round > v_draft.total_rounds - 3))
          AND (v_unfilled = 0
               OR COALESCE((v_have->>v_row.pos)::int, 0) <
                  (SELECT COALESCE(SUM((s->>'count')::int), 0)
                   FROM jsonb_array_elements(v_slots) s
                   WHERE s->'eligible' ? v_row.pos) + 1);
    END IF;
    IF v_ok THEN
      RETURN v_row.player_id;
    END IF;
  END LOOP;

  -- Greedy step h — the FLOOR: never stall the draft (§22.3). Lowest-ADP
  -- available with NO filters; NULL only when the pool is exhausted.
  SELECT pl.id INTO v_floor
  FROM public.players pl
  WHERE NOT EXISTS (
    SELECT 1 FROM public.draft_picks dp
    WHERE dp.draft_id = p_draft_id AND dp.player_id = pl.id
      AND dp.is_undone = FALSE
  )
  ORDER BY pl.adp NULLS LAST, pl.id
  LIMIT 1;
  RETURN v_floor;
END;
$$;

REVOKE EXECUTE ON FUNCTION draft_autopick_resolve(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. draft_tick — REPLACED FROM 068 (D137 head rule, 068:657–1247). Two
--    hunks: ARM 2 and ARM 2.5 each exclude auctions (claim + under-lock
--    re-verify — the second pair is R362's), and the new ARM 2.6 lands
--    between ARM 2.5 and ARM 3. ARMs 1, 1.5, 1.6 and 3 are 068's,
--    byte-identical.
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
          -- Recorded for L.C1.5 (its read-list in tasks-M3 §6 names it):
          -- D143's "open bids are voided" has NO representation in the
          -- schema yet — `draft_bids` has no UPDATE or DELETE policy for
          -- anyone and is append-only by ruling (083, D131(2)) — so the
          -- voided rows simply stay. This lookup is that ruling's first
          -- consumer and it is written to survive it.
          SELECT b.action_id IS NULL INTO v_is_auto
          FROM public.draft_bids b
          WHERE b.draft_id = v_draft.id
            AND b.nomination_seq = v_draft.current_pick_number
            AND b.player_id = v_win_player          -- R363/D143: THE discriminator
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
          -- failure is recorded. NO COMMISSIONER REMEDY EXISTS YET (R364,
          -- driven on a forged state): pause/resume leaves the same
          -- nomination standing and the next tick reproduces the identical
          -- refusal — `draft_cancel_nomination` is L.C1.5's and has not
          -- shipped, so today the only way out is `draft_reset` +
          -- `draft_start_internal`, which wipes the board. See the banner.
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
