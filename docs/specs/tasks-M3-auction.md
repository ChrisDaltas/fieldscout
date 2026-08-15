# M3 Task Breakdown — Auction Draft Engine (Phase C)

> **Architect session output — 2026-08-14.** Read together with `spec-redraft-leagues.md` **v2.9.2** (the LAW) and `delivery-plan-redraft-leagues.md` **v1.4**. This doc sequences M3 into Builder-sized tasks (each ≤ half a day); it never overrides the spec. Builder sessions take **one task each**, in dependency order (§6), and satisfy delivery plan §2.3 DoD per task **plus the M3 standing rules (§4)**. Per ACTIVE-BUILD, **this breakdown's PR stays open for Chris's approval — the loop builds no `L.C*` task until it merges.**
>
> **What M3 is:** the auction half of the draft engine (spec §8.6) composed ONTO the landed M2 platform — the same drafts row, tick, broadcast surface, room chrome, mock mode, simulator, and E2E harness, extended with nominations, bids, budgets, and the **solvency invariant (§8.6.8)**, which joins the never-weaken class (audit immutability, lock semantics, snapshot reads, §22.6 gates). Auction is a **2026 test-cohort headline feedback goal** (plan v1.4; CLAUDE.md) — it ships when its gate passes, no calendar deadline.
>
> **What M3 is NOT:** in-season anything (M4/M5) · `commissioner_actions` audit rows (M6 — F40 grows auction verbs, §10) · rate limiting incl. §22.5's "bids 5/s" (M7 — F41, D136) · the §22.6(2) k6 bid storm at load (M7 — M3's bid-storm E2E proves *correctness under burst*, not latency at scale) · auto-bid for absent managers (OQ 10 — v1 simply doesn't bid for the absent, §8.6.5) · standalone/multi-human mock lobbies (v1.1, §8.8) · **the custom scoring editor un-punt** (C37 — a separate Architect spec-changelog track, NOT an M3 lane; see §9).

**Spec sections in scope:** §7.3.8 (auction fields + the solvency floor), §8.1 (five-step action contract — bids/nominations included by its own text), §8.3 (nomination order), §8.6 **in full** (flow, §8.6.7 endgame (a)–(e), §8.6.8 solvency invariant), §8.7 (the auction rows: "Adjust auction budget / undo a won bid"; E29's auction half), §8.8 (auction CPU bidders, mock auctions), §9 (Client Broadcast decision — D133), §12.3/§12.4/§12.5 (`draft_bids`)/§12.7 (`acquisition_cost`), §14 (auction tick arms), §15.2 (nominate/bid routes), §16.2 (`auction-block.tsx`)/§16.3/§16.4/§16.5, §17, §19.2 **E5, E6, E25–E29, E62** (+ E2/E17/E60 auction analogs), §22.1 (auction-burst load row), §22.5 (noted, deferred), §18 Phase C.
**Delivery plan:** §3 M3 row (contents + exit criteria), §2.1–2.3, §4.1 (property tests: "max-bid & solvency"), §4.2 (auction personas: "sniper who bids at T-1s"; CPU bidders = sim bots), §8.1–8.4 checklists.

---

## 1. M3 contents & exit criteria (restated from delivery plan §3)

**Contents:** L.C1 + v2.0 endgame rules & solvency invariant (§8.6.7–8); mock auctions (spec §8.8 CPU bidders).

**Exit criteria (all must pass; proof map in §8):**
1. **Spec §18 Phase C gate:** "run a full auction with budgets enforced (no overspend, every team completes a legal roster), anti-snipe works, commissioner can reverse a won bid and adjust budgets; **mock auctions run with CPU bidders that obey the solvency invariant**."
2. **The solvency property test** (plan §3 M3 row, verbatim): "no reachable sequence of bids/undos/commish budget edits violates solvency — *including bot-driven mock auctions*" (E28/E62; §8.6.8).
3. **Bid-storm E2E** (plan §3 M3 row): a burst of concurrent bids on one nomination — single winner, no lost/duplicate bids, anti-snipe observed, all clients converge.
4. **Continuity:** `test:gate:m2`, `test:gate:m1`, `test:gate` (M0) stay green, composed into `test:gate:m3`.

**Sequencing dispositions (not conflicts):** snake/linear QA surface is untouched — auction is additive (D137: no in-place edits of released M2 migrations). The §22.6 k6 suite stays M7's; M3's storm is Playwright + service-layer burst. `linear` needs nothing here. Mock auctions land in the SAME milestone as the auction engine (the §18 Phase C gate names them), unlike M2 where mock mode trailed the engine by five tasks — the CPU-bidder arm is the gate's own subject.

---

## 2. Current state (surveyed 2026-08-14; two-agent survey, every load-bearing fact file:line-verified against main @ 240fc17)

- **Migration chain head = 082** (`082_draft_queue_replace.sql`); next = **083**. pgTAP head = **031**; next = **032**. Builders confirm next-free at task time (the M1/M2 drift rule).
- **The auction seams M2 left, exactly three live refusals (all P0001, all naming M3):** `draft_start` at 066:640–644 ("league % is configured for an auction draft — the auction engine lands in M3…", reads `v_config->>'draft_type'` re-hydrated per D95); `draft_make_pick` at 066:940–943 ("this is an auction draft — the auction engine lands in M3", reads the **column** `v_draft.draft_type`); `create_mock_draft` at 071:315–319 ("mock auctions land with the auction engine in M3"). **Each refusal string is asserted verbatim in pgTAP** — `tests/020_draft_core_rpcs.sql:685,961` and `tests/025_mock_draft_mode.sql:400` — so every refusal removal and its assertion flip must land in the same PR. Ordering constraints recorded at 066:47–49 (start: refusal after lock, below the scheduled gate, before capacity) and 071:309–313 ("config-shape refusals (auction) answer before seat-map ones").
- **Schema seams already in place (065):** `drafts.draft_type` CHECK already allows `'auction'` (065:132; pinned at tests/019:356); `nomination_order JSONB` (065:116) and `current_nomination JSONB -- { player_id, high_bid, high_bidder_team_id }` (065:121) exist unused; `draft_picks.price INTEGER` (065:162) exists, never written; `draft_picks.pick_number`'s comment already reads "sequence # (auction)" (065:158). **No `draft_bids` table, index, or policy exists anywhere** — the only repo hits are the client's forward-compat pin (below). `one_active_real_draft_per_league` (065:146) and `idx_drafts_due` (065:144) serve auction unchanged.
- **`draft_tick` (068) has NO `draft_type` awareness at all** (grep `draft_type` in 068 = zero). Arms in body order: ARM 1 auto-start (068:704) · ARM 1.5 commissioner-outage pause (:750) · ARM 1.6 mock stale-pause (:873) · ARM 2 timeout-autopick, batch `LIMIT 25`, deadline-instant freshness per R132 (:958) · ARM 2.5 mock CPU think-time picks (:1093) · ARM 3 heartbeat (:1187). An auction arm slots cleanly as **ARM 2.6** between 2.5 and 3 (D129/D130); `idx_drafts_due` already serves any clock-driven arm.
- **Broadcast surface (070):** `draft_broadcast_payload` (070:139, selects :145–153) excludes "auction fields (M3)" by its own banner (070:134–138); `draft_pick_broadcast_payload` (070:163, selects :169–175) excludes `price` by name (:159–162). `realtime.messages` INSERT policies are **presence-only** (`extension = 'presence'` at 070:358 and :366); the banner at 070:45–52 records that Client Broadcast is deliberately closed and *"M3's auction UX extends the policy deliberately if it wants it"* (D109(5)). D133 answers this.
- **The M2 client is already forward-compatible:** `applyDraftRoomEvent`'s `default:` arm returns `{ state, refetch: false }` with the comment "Unknown events (M3's auction surfaces…) are inert" (use-draft-ops.ts:270–273), **pinned by a test that fires an event literally named `'draft_bids'`** (use-draft-ops.test.ts:351). New broadcast events can ship before the auction room lands without breaking live snake rooms. The reverse is guarded: `DraftsBroadcastRecord`/`PickBroadcastRecord` are non-strict Zod parses — additive payload keys strip harmlessly on old clients (Builder re-verifies at L.C1.6).
- **Room state:** `page.tsx` renders `<SnakeDraftRoom>` unconditionally — its docblock (draft/page.tsx:24–25) says one room serves every reachable draft because start refuses auction; the fork point is `snake-draft-room.tsx:389` (`draft_type === 'linear' ? 'linear' : 'snake'`, comment :386–387). `auction-draft-room.tsx` (393 lines) is **still the M0-era fixture mock** — props typed against `mock-draft.ts` fixture types, local `useState` simulation (:105–120), client-local `useMockDraftClock`, the standing lint warning (unused `league`) now at **:107**, and **zero imports anywhere** (only a comment in mock-draft.ts:7 references it). `mock-draft.ts`'s own banner (:6–15) rules: *"M3 replaces the auction types with live shapes and this file goes away entirely."* `best-available-card.tsx:66` names M3's auction room as a mount hook. §16.2's canonical shell name is `draft-room.tsx`; D117(8) sanctions consolidation, no fork.
- **Settings:** the full §7.3.8 auction block is authored — `draftConfigSchema` at league-settings.ts:213–224 (`auction_budget` 50–1000 default 200, `auction_min_bid` 0–5 default 1, `auction_nomination_seconds` 10–120/30, `auction_bid_seconds` 10–60/20, `auction_anti_snipe_seconds` 0–15/10, `nomination_order_mode`). The **solvency floor is implemented** at league-settings.ts:541–551, gated on `draft_type === 'auction'` (D60), pinned at validate-league-settings.test.ts:297–320 + settings-round-trip-db.test.ts:523. *Note:* the floor uses `deriveRosterSize` (starters + bench + **IR**), conservative vs the engine's D91 open-slots (starters + bench) — harmless, recorded in D127. **UI gap:** settings-panel.tsx:1477–1517 renders budget / min bid / nomination clock only — `auction_bid_seconds`, `auction_anti_snipe_seconds`, `nomination_order_mode` are persisted + validated but have **no input control** (L.C3.2).
- **Service layer** (`src/lib/leagues/api/draft-service.ts`, 1041 lines): full snake surface (create/start/pick/queue/controls/mock); **no `nominatePlayer`/`placeBid`, no budget read, no nominate/bid Zod schemas**. Routes: 13 under `api/leagues/[id]/draft/` + mock-drafts — **no `nominate/`, `bid/`, or budget route exists**. Hooks: `use-draft.ts` (`useDraftRoom`, `useActiveDraft` — `ActiveDraftSummary` already carries `draft_type`), `use-draft-ops.ts` (pure reducer), `use-draft-controls*`, `use-draft-queue`, `use-draft-pool`, `use-draft-chat`, `use-mock-drafts`.
- **Simulator** (`src/lib/leagues/sim/`): personas are all pick-shaped (`queue-drafter | adp-drafter | afk | chaos`, sim-types.ts:15); `sweepAudit` composes nine invariants (invariants.ts:166) — none money-shaped; `runner.ts:379` hardcodes `draft_type: 'snake'`; `scripts/sim.ts` has **no `--type` flag** and silently ignores unknown flags (:48–86 parse; unknown-command refusal :51–56 only). plan.ts:16–17 and sim-types.ts:14 record auction as deliberately absent.
- **E2E** (`e2e/`): 4 specs + harness. The zero-league-writes diff helper is `snapshotLeagueWrites` (harness.ts:178); `rewindDeadline` (:109) and `tickOnce` (:123) are the deadline harness; auth fixtures + `provisionLeague` exist. `playwright.config.ts` at root; suite = `npm run test:e2e` (CI wiring = F47, commands recorded at D124(10)).
- **F56 (the one ledger row routed to M3):** gate attempt 1 (2026-08-14) saw the manager room regress to the scheduled-lobby fallback after the sim's broadcast burst — unreproduced, trace lost. Its row routes it to *"M3's first draft-room-adjacent task, or the first session that reproduces it."* Two halves: the room fetch-path fallback honesty question (L.C3.1) and the gate's bounded stack-health settle question (L.C6.1).
- **Evidence rule (R278, ruled 2026-08-14):** D39-class browser-pass evidence = **prose + DB corroboration** (captures welcome, never required). Every DoD line below is written to that form.

---

## 3. Design decisions (Architect; D126–D138 — they enter PROGRESS §4 verbatim when this PR merges, the tasks-M2 D86–D101 precedent)

- **D126 — Auction state lives on the drafts row; phase is `current_nomination`'s NULLity.** No new state columns: `current_nomination` NULL ⇒ **nominating** (`on_clock_team_id` = the nominator per `nomination_order` rotation, `current_deadline` = nomination clock); non-NULL ⇒ **bidding** (`current_nomination = { player_id, high_bid, high_bidder_team_id }` per 065:121's printed shape, `current_deadline` = bid clock). `current_pick_number` doubles as the 1-based **nomination sequence** (§12.4's "sequence # (auction)"); `draft_picks.round` is NULL for auction rows; `current_round` tracks the rotation lap (display only). `total_rounds` keeps its D91 meaning (draftable slots = starters + bench) — it is the auction's per-team roster capacity, not a rounds count.
- **D127 — Budgets are always DERIVED, never stored counters.** `remaining_budget(team) = auction_budget + adjustment(team) − Σ price(non-undone picks)`; `open_slots(team) = total_rounds − count(non-undone picks)`; `max_bid(team) = remaining − (open_slots − 1) × min_bid` (§8.6.1). One SQL derivation fn family (§5), used by every validator — a stored counter could drift from truth; a derivation cannot. Commissioner budget edits need storage: **additive column `drafts.budget_adjustments JSONB NOT NULL DEFAULT '{}'`** (team_id → integer delta; spec-absent schema recorded here + erratum, the D102 precedent) — validated per E28 at edit time, room-visible (D134), history via the D97 system chat post until M6's audit rows. *Recorded nuance:* the settings-layer floor (league-settings.ts:541) uses roster_size incl. IR — deliberately conservative vs the engine's D91 open-slots; both stand.
- **D128 — Bid-clock semantics: a fixed window with an anti-snipe floor (the E6-consistent reading).** The bid clock starts at `auction_bid_seconds` when bidding opens (at nomination) and is **not** reset by bids; a bid landing with remaining < `auction_anti_snipe_seconds` resets remaining **to** `auction_anti_snipe_seconds` (§7.3.8's own words: "resets clock **to it**"; Appendix C L.C1: "reset bid clock to auction_anti_snipe_seconds"; E6: 3s left, threshold 10 → clock reads 10s). `auction_anti_snipe_seconds = 0` disables extension (pure fixed window). §8.6.3's looser "each bid resets the bid clock per anti-snipe" is read as "each bid applies the anti-snipe rule". **C34 flags this for Chris's read before build** — pacing is product feel; the alternative (Sleeper-style reset-to-full-per-bid) contradicts E6 as printed and would need a spec change. **RULED 2026-08-15 (Chris, in-session): CONFIRMED** — his own scenario language: 30s total clock; bids above the threshold neither reset nor pause it — the countdown continues uninterrupted (Chris's explicit clarification); a higher bid landing inside the final 10 seconds resets the clock to 10 seconds (his "bid with 3 seconds left → clock resets to 10"), repeatable. D128 as written is the LAW reading; no spec change.
- **D129 — Nomination discipline.** (1) Human nomination validates: nominator's turn, player undrafted, opening bid ≥ `auction_min_bid` AND ≤ nominator's max bid (§8.6.7(a)), **capacity-only fit** (open_slots ≥ 1 — the v2.8.11 manual-pick rule extended: need-fit is a system-path rule, humans may buy a 3rd QB). Rotation-skip (§8.6.7(c)) guarantees the nominator has an open slot, so the §8.6.7(b) nominator-award is always legal. (2) **System nomination (timeout) = the M2 autopick resolution chain run for the on-clock team** (queue → primary board → Big Board → ADP with need-fit; 068's `draft_autopick_resolve`) at an opening bid of `min_bid` ($0 legal when `min_bid = 0` — C38; R305) — this satisfies §8.6.7(e)'s "fits *some* team's open slot" (it fits the nominator's) and makes (b) safe; one implementation, snake and auction (C33 records the reading). K/D-ST deferral maps to the forced-only arm (no rounds in auction; deferral holds until open slots force them — Builder finalizes the documented rule, pins the boundary). (3) The **D102 grace contract carries to the nomination clock**: autodraft/no-user/FRESH seats system-nominate AT deadline; a STALE seat's nomination is held to deadline + grace, manual nomination allowed during the hold. (4) **No auto-bidding for absent seats** (§8.6.5/OQ 10) — grace applies to nominations only; you cannot be timed *into* a bid.
- **D130 — Award path.** Bid-clock expiry under the draft-row lock: winner = `current_nomination.high_bidder_team_id` (or the nominator at the opening bid when no raises — §8.6.7(b)/E26); write `draft_picks` (pick_number = nomination seq, round NULL, `price`, `made_via`/`is_auto` per actor: system-nominated no-raise awards are `is_auto = TRUE, made_via = 'autopick'`); clear `current_nomination`; advance rotation to the next team with open_slots ≥ 1 (E27 skip); next nomination deadline. **Completion = no team has open slots** → the 072 completion txn extended to write `acquisition_cost = price` (D111(3)); "budgets exhausted" (§8.6.6) is unreachable — solvency guarantees every open slot is affordable at min_bid, pinned as a property.
- **D131 — Auction reversals.** (1) **`draft_reverse_won_bid`** (§8.7's "undo a won bid"): targeted soft-undo of a specific auction pick (`is_undone = TRUE`) — player to pool, budget restored by derivation (free), the team re-enters the rotation if it was complete; live/paused drafts only (post-completion reversal is F44's M6 class). (2) **Undo/cascade (E29):** when a nomination has live bids, `draft_undo` FIRST voids the nomination (clear `current_nomination`; `draft_bids` rows stand as append-only history — "bids returned" costs nothing because **bids never hold budget, only won picks do**), then reverts picks; on_clock rewinds to the target nomination's nominator with a fresh nomination clock. (3) Undo is provably solvency-preserving (remaining' = remaining + price ≥ (open+1) × min_bid whenever price ≥ min_bid — pinned as a property). (4) **E28 extends to the live nomination:** a budget edit that would make the CURRENT high bid insolvent for its bidder is refused (friendly: void the nomination or reverse won bids first) — otherwise the close could award an unaffordable player.
- **D132 — CPU bidders: tick-driven, value-based, same validators (one implementation, two consumers).** Mock auction CPUs nominate via D129(2) (their own resolve chain) at humanized think-time (the D93 PRNG pattern) and **bid** via a seeded value model: dollar value = f(ADP rank, budget scale, roster needs) × (1 + seeded noise), deterministic per (draft_id, nomination_seq, team_id, pass) — a CPU raises only while `high_bid + 1 ≤ min(its value, its max_bid)`, at most one raise per tick pass per nomination (bids land ~5s apart — humanized pacing for free), with the near-buzzer tail falling out of the think-fraction distribution (anti-snipe becomes visible, §8.8). E62 by construction: CPUs pass the same server-side max-bid/solvency validator as humans. The sim's auction personas (L.C4.1) drive the same decision spine through real RPCs (D100).
- **D133 — Client Broadcast STAYS CLOSED (the D109(5) decision, made).** M3 adds no `extension = 'broadcast'` INSERT policy: the "bid-button pulse" IS the authoritative `draft_bids` INSERT broadcast (sub-second, already fan-out-cheap), and v1 auction needs no typing indicators. A member who could client-broadcast could forge a server-shaped bid event to the room — the same spoof D109(5) refused. Recorded as deliberate; revisit only with a named consumer + a forgery-safe event namespace (v1.1 at earliest).
- **D134 — Payload extensions (the §9.2 "columns clients render" rule, extended additively).** `draft_broadcast_payload` += `current_nomination` + `budget_adjustments` (neither is blind: the high bid is the room's centerpiece and §8.7 transparency wants budget edits visible); `draft_pick_broadcast_payload` += `price` (the board renders spend; 070's exclusion note is superseded by an auction that renders it — banner updated in place… NO: the exclusion note's migration is released — the NEW payload fn versions in 088 carry the updated banner, D137). New **`draft_bid_broadcast_payload`** (nomination_seq, player_id, team_id, amount, created_at — never `action_id`) + INSERT trigger on `draft_bids`, event name `'draft_bids'` — the exact name the M2 client's inert-default pin already proves safe (use-draft-ops.test.ts:351). Old clients strip additive keys (non-strict Zod, §2) and ignore the new event: no forced-upgrade window.
- **D135 — Room composition: one shell + an auction center stage; the fixture room dies.** The landed room (`snake-draft-room.tsx`) is renamed to §16.2's canonical **`draft-room.tsx`** (D117(8)'s sanctioned consolidation; git mv, no fork) and branches at the :389 fork point: `auction` renders **`auction-block.tsx`** (nomination stage, bid input + max-bid, per-team budgets rail, nomination/bid clocks, anti-snipe indicator — §16.2's printed component) in place of the snake board's on-clock surfaces; board grid becomes results-by-team with prices. Chat, presence, pool, queue, My Lists, commish panel, recap, lobby compose unchanged. **`auction-draft-room.tsx` is DELETED after harvest** (unmounted since M2, §2) and **`mock-draft.ts` goes away entirely** per its own banner — the repo's standing lint warning (auction-draft-room.tsx:107) retires with it.
- **D136 — No route-layer bid limiter in M3.** §22.1's "≤ 5 bids/s/draft" is a load-model assumption; §22.5's "bids 5/s" route limit is F41's, routed to M7 with the rest of the rate-limit family. The draft-row lock is the serializer (§8.1); M3 proves correctness-under-burst (storm E2E + chaos persona), M7 proves latency/quota at k6 scale. The instant "outbid" loser path must be friendly-P0001, never a 429.
- **D137 — Amendment vehicle: CREATE OR REPLACE in NEW migrations, authored against the chain HEAD.** M2's in-place amendment convention (F12/F51) was an intra-milestone convenience on unreleased files; 065–082 are merged, gate-pinned, and awaiting the F12 prod push. M3 therefore replaces `draft_start`/`draft_make_pick`/`draft_tick`/the 072 completion writer via `CREATE OR REPLACE` in 083+ migrations, each authored against the CURRENT file text of the function's last definition (the CLAUDE.md migration-discipline lesson — read the newest migration that defines the function), with the source migration named in the banner. pgTAP files 020/025 are tests, not migrations — their refusal assertions are edited in place in the same PRs.
- **D138 — Mock auctions: the 071 refusal lifts in the same milestone as the engine, and every M2 mock rule carries.** Launcher-only control surface (D110(1)) — pause/resume/delete by `config.mock.launched_by`, every other §8.7 control (incl. the new auction verbs) refuses mocks; caps + advisory-lock serializer + 72h expiry + E59/E60 unchanged; the zero-side-effect diff pin is re-run with `draft_bids` added to the allowed-tables set; the launcher is the only legal human nominator/bidder (the D103(2) rule extended to bids). Mock CPU auctions are the E62 property surface.

---

## 4. Standing rules for every M3 task

Rules 1–6 carry forward from tasks-M2 §4 **verbatim and in full force** (M1's four: grants doctrine · no-write-policy pgTAP pattern · falsifiability floor incl. the ≥1 deliberate-break probe · migration checklist + typegen alias-block re-append — plus M2's realtime doctrine (rule 5) and draft-row lock discipline (rule 6, incl. SQLSTATE conventions + held-lock < 50ms per RPC family)). Two new rules join them; Builders cite all eight in the self-review note:

7. **Solvency doctrine (never-weaken class).** Every budget-affecting write path — bid, nomination, award, undo, reverse, budget edit, reassign/move of a priced pick — validates §8.6.8 in-body under the draft-row lock via the ONE derivation-fn family (D127); no path computes budgets independently, no stored counter exists, and no test asserting the invariant may be deleted or weakened. TS budget math is display-only, pinned by a SQL-parity fixture (the D90 pattern). A diff that touches the derivation fns without extending their pgTAP pins is an automatic review finding.
8. **Bid-path discipline.** Nominate/bid/close follow the §8.1 five-step contract exactly; every client-triggered nominate/bid carries an `action_id` (replay = same-response no-op, E2); the race loser gets the instant friendly refusal ("outbid" / "just went off the board" — §16.3, never a 429 in M3 per D136); anti-snipe arithmetic uses server timestamps only. Evidence for D39-class passes = **prose + DB corroboration** (R278) — task DoD lines below say "browser pass" and mean that form.

---

## 5. Interface sketches (Builder finalizes exact fields; names below are contractual)

```sql
-- L.C1.2 derivation family (STABLE, search_path=''; the ONE budget authority — §4.7)
draft_team_budget(p_draft_id uuid, p_team_id uuid)      -- → (remaining, open_slots, max_bid, committed)
  -- remaining = config budget + budget_adjustments[team] − Σ price WHERE NOT is_undone (D127)
draft_auction_solvent(p_draft_id uuid)                  -- → bool: ∀ teams remaining ≥ open_slots × min_bid (§8.6.8)

-- L.C1.3 the auction actions (SECURITY DEFINER SET search_path=''; §4.6 lock discipline; §4.8)
draft_nominate(p_draft_id uuid, p_player_id text, p_opening_bid int, p_action_id uuid) RETURNS jsonb
  -- lock → nominating phase + my-turn (or commish force path L.C1.5) → player undrafted → opening ≥ min_bid
  -- AND ≤ my max_bid (§8.6.7(a)) → capacity fit (D129(1)) → set current_nomination{player, opening, me}
  -- → bid deadline (auction_bid_seconds) → return state
draft_place_bid(p_draft_id uuid, p_amount int, p_action_id uuid) RETURNS jsonb
  -- lock → bidding phase → bidder has open_slots ≥ 1 (E27: complete rosters cannot bid) → amount > high_bid
  -- (integer raises) → amount ≤ my max_bid (E5/§8.6.7(d): a $1 max bid admits only $1) → not already high bidder
  -- → INSERT draft_bids + update current_nomination → anti-snipe floor (D128) → return state; loser P0001 "outbid"

-- L.C1.4 tick ARM 2.6 (amends draft_tick per D137; between ARM 2.5 and ARM 3)
--   nomination expiry: autodraft/no-user/FRESH → system nomination via draft_autopick_resolve (D129(2));
--     STALE → hold to deadline + grace (D102 carried), then system-nominate
--   bid expiry: award per D130 (no-raise ⇒ nominator at opening, E26); rotation skip (E27); completion → 072 txn + price
--   mock CPU sub-arm lands L.C1.7 (D132)

-- L.C1.5 auction commissioner controls (D97 in-txn system chat posts; refuse mocks — D138)
draft_reverse_won_bid(p_draft_id uuid, p_pick_id uuid)  -- targeted soft-undo (D131(1)); live/paused only (F44)
draft_adjust_budget(p_draft_id uuid, p_team_id uuid, p_delta int)
  -- E28: refuse below committed spend, below open_slots × min_bid, or insolvent vs the LIVE high bid (D131(4))
-- amendments: draft_undo (E29 nomination void — D131(2)) · draft_reassign_pick/draft_move_player (price rides;
-- receiving team validated vs max-bid) · draft_set_clock (auction timers, E15 analog) · draft_set_order (nomination order)
-- · draft_force_pick (force-nominate, NOMINATING phase only; no force-bid exists — R301)
-- · draft_reset (clears current_nomination + budget_adjustments — R302)
```

```ts
// L.C2.1 service + hooks (D92: reads RLS-scoped, writes via routes)
nominatePlayer(supabase, leagueId, { player_id, opening_bid, action_id })   // POST …/draft/nominate (§15.2)
placeBid(supabase, leagueId, { amount, action_id })                          // POST …/draft/bid (§15.2)
useNominate(leagueId, draftId) / usePlaceBid(leagueId, draftId)              // never optimistic (§15.6)
// budgets: derived client-side from picks(price) + budget_adjustments broadcast (D134) — display math only,
// pinned TS ≡ SQL by a parity fixture (§4.7)

// L.C4.1 sim (plan §4.2; D100/D132)
npm run sim -- draft --type auction --leagues 25 --teams 12 --seed 42        // --type snake stays the default
// auction personas: value-bidder · sniper (T-1s via rewind harness) · budget-hoarder · afk (system path) · chaos (double-tap bids)
// auction invariant sweep adds: solvency ∀ teams after EVERY settled command · Σ price ≤ budget+adjustment ·
// every price ≥ min_bid (>0 configs) · rosters full at complete · nomination rotation never lands on a full team ·
// draft_bids monotone per nomination · zero stuck clocks (both clock kinds, grace-aware)
```

**Channels & payloads (§9.1–9.2, extended per D134):** topic `draft:<draft_id>` gains `draft_bids` INSERT (nomination_seq, player_id, team_id, amount, created_at); `drafts` UPDATE payload gains `current_nomination`, `budget_adjustments`; `draft_picks` payload gains `price`. Presence/heartbeat/chat unchanged. **Client Broadcast stays closed (D133). Never broadcast:** `draft_queues`, `action_id`s, anything blind.

---

## 6. Task list (one Builder session each; ≤ half a day)

Dependency order — **schema lane serialized** (plan §2.2), API/UI/SIM/E2E fan out behind their deps:

```
SCHEMA  L.C1.1(083: draft_bids + columns) → L.C1.2(084: derivation + start arm) → L.C1.3(085: nominate/bid)
        → L.C1.4(086: tick ARM 2.6 + completion) → L.C1.5(087: auction commish controls) → L.C1.6(088: realtime)
        → L.C1.7(089: mock auctions + CPU bidders)
API     L.C1.3 → L.C2.1 (nominate/bid routes + hooks) · {L.C1.5, L.C1.7} → L.C2.2 (commish auction routes)
UI      {L.C2.1, L.C1.6} → L.C3.1 (auction room + F56 room half) · {L.C3.1, L.C2.2} → L.C3.2 (commish rows + settings + recap)
SIM/E2E {L.C2.1, L.C1.7} → L.C4.1 (sim auction mode + THE property test) · {L.C3.2, L.C1.7} → L.C5.1 (auction E2E + bid storm)
GATE    everything → L.C6.1
```

### L.C1.1 — Migration 083: `draft_bids` + additive auction columns
> Read spec §12.5 (all), §12.3 (the seam columns, §2's inventory), §8.6.8, delivery plan §8.1–8.2, this doc §2–§4, D126/D127. Schema lane opener. **No RPCs** — table, constraints, indexes, RLS, columns only.
>
> 1. `083_draft_bids.sql`: §12.5 DDL verbatim (member SELECT via `is_league_member(league_id)`; **no client write policy** — bids via RPC only) with two recorded deltas: **`action_id UUID` NULLable + partial unique `UNIQUE(draft_id, action_id) WHERE action_id IS NOT NULL`** (C39 — system rows need NULL, the 065 `uniq_draft_action` pattern) and CHECKs the R43 lesson demands at creation: `amount >= 0`, `nomination_seq >= 1`. `idx_draft_bids_nom ON draft_bids(draft_id, nomination_seq, amount DESC)` per §12.5.
> 2. `ALTER TABLE drafts ADD COLUMN IF NOT EXISTS budget_adjustments JSONB NOT NULL DEFAULT '{}'` (D127 — the spec-absent-schema erratum rides this PR).
> 3. pgTAP **032**: §4.2 per-role deny-by-default (member SELECT positive; non-member/anon nothing; INSERT/UPDATE/DELETE refused for every role — bids are append-only via RPC); the partial-unique proven directly (privileged double-insert same action_id → 23505; two NULL-action_id rows coexist); CHECK boundaries.
> 4. Typegen + alias block (add `DraftBid` alias).
>
> DoD: §4 standing rules; fresh `db reset` 001–083; break probe (drop the partial-unique's WHERE → the NULL-coexistence pin fails) shown + reverted.

### L.C1.2 — Migration 084: budget derivation family + `draft_start`'s auction arm
> Read spec §8.6.1, §8.6.8, §8.3 (nomination order), §7.3.8, §12.3, this doc D126/D127/D129(1)/D137 + §4.7, and 066's CURRENT `draft_start` text (the D137 head rule; refusal at 066:640–644). Depends L.C1.1.
>
> 1. `draft_team_budget` + `draft_auction_solvent` per the §5 sketch (STABLE, one authority — §4.7). Open-slots math = D91 draftable slots via `total_rounds`.
> 2. `CREATE OR REPLACE draft_start` (authored against 066's current body): the auction refusal becomes the auction arm — after the shared gates (lock order, scheduled, capacity == team_count (the F45 gate mirrored), snapshot-BEFORE-transition per D43/D64(2), all unchanged): generate `draft_order` per `draft_order_mode` (unchanged, it feeds `same_as_draft_order`), then `nomination_order` per `nomination_order_mode` (`same_as_draft_order` copies; `random` = seeded shuffle, D101; `manual` validates a permutation of active team_ids); `total_rounds` per D91; `on_clock_team_id = nomination_order[0]`; pick-1 deadline = `auction_nomination_seconds` (untimed `pick_timer_seconds = 0` does NOT null auction clocks — nomination/bid clocks are their own catalog fields; recorded). The D94 auto-start arm needs no edit — it calls `draft_start`, which now succeeds for auctions (banner notes it; pinned in 033).
> 3. **pgTAP 020's start-refusal assertion (tests/020:685) flips in this PR** to a start-succeeds pin (status `live`, nomination phase, correct first nominator, deadline set). New pgTAP **033**: derivation goldens (fresh 12-team $200 league: remaining 200, open 15, max_bid 186 — stored literals per size); `nomination_order_mode` all three modes; solvency-floor boundary (settings floor already blocks under-budget leagues — positive control through a legal one).
> 4. Stack vitest: an auction league schedules + auto-starts via the tick (the D94 no-dead-end pin, auction edition).
>
> DoD: §4 standing rules; break probe: skew the max-bid formula (drop the `− 1`) → the derivation goldens fail (shown, reverted).

### L.C1.3 — Migration 085: `draft_nominate` + `draft_place_bid` (the serialized auction core)
> Read spec §8.1 (five-step contract), §8.6.2–8.6.4, §8.6.7(a)/(d), §12.5, E2/E5/E6/E25, this doc D126/D128/D129(1)/D131(3-context) + §4.6–4.8, and 066's CURRENT `draft_make_pick` (its auction refusal at 066:940–943 STAYS — reworded per item 3). Depends L.C1.2.
>
> 1. `draft_nominate` per the §5 sketch — the five-step contract; my-turn = caller manages `on_clock_team_id` (M1 access model; the commish force path is L.C1.5's); idempotency: a replayed `action_id` whose nomination already opened returns the same success shape (Builder records the mechanism — `draft_bids` opening row or a config echo — and pins it).
> 2. `draft_place_bid` per the §5 sketch — E5 (max-bid refusal message names the formula's number), §8.6.7(d) ($1-max team can bid exactly $1 — the formula does this; pinned at the boundary), E25 fixture ($3/3 slots ⇒ max bid $1), anti-snipe per D128 (deadline floor arithmetic pinned to the second), instant-loser P0001 ("outbid at $N" — error strings are UX), the E2 replay arm (same action_id → same-response no-op via the 083 partial unique). **The opening bid writes a `draft_bids` row too** (uniform history; nomination_seq monotonicity pinned).
> 3. `CREATE OR REPLACE draft_make_pick` (against 066's current body): the refusal message drops "lands in M3" for the permanent truth — "auction drafts pick via nominate and bid" (it remains correct forever; **tests/020:961's assertion updates in this PR**).
> 4. pgTAP **034**: phase refusals (nominate during bidding / bid during nominating → friendly P0001s); turn refusal; opening-bid bounds (< min_bid refused; > nominator max refused — §8.6.7(a)); raise semantics (≤ high refused, +1 accepted); self-raise refused; E27's bid half (roster-full team's bid refused); anti-snipe boundary (bid at threshold−1s floors the clock; at threshold+1s doesn't); E2 replays for both RPCs; min_bid = 0 boundary (C40: $0 opening legal, raises still integer-increment).
> 5. Stack vitest `auction-core-db.test.ts`: nominate → 3 raises over PostgREST as real users; held-lock < 50ms for the bid family (§4.6 — §22.1's burst row makes this the hottest lock in the app).
>
> DoD: §4 standing rules; break probe: drop the max-bid clause from `draft_place_bid` → E5/E25 pins fail (shown, reverted).

### L.C1.4 — Migration 086: tick ARM 2.6 — nomination timeout, bid close, rotation, completion
> Read spec §8.2, §8.6.2 (timeout), §8.6.7(b)/(c)/(e), §12.7, E26/E27, this doc D126/D129(2-4)/D130/D137 + §4.7, 068's CURRENT `draft_tick` (arm map in §2) and 072's CURRENT completion writer. Depends L.C1.3.
>
> 1. `CREATE OR REPLACE draft_tick` (against 068's current body): **ARM 2.6** between ARM 2.5 and ARM 3, claiming due auction drafts via the same `idx_drafts_due` SKIP-LOCKED batch pattern (`LIMIT 25` precedent). Nomination-expiry sub-arm: D129(3)'s grace contract (autodraft/no-user/FRESH at deadline; STALE held to deadline + grace — manual nomination allowed during the hold); system nomination = `draft_autopick_resolve` for the on-clock team at the D129(2) opening, `is_auto`-marked. Bid-expiry sub-arm: award per D130 — E26 (no-raise ⇒ nominator at opening), rotation advance skipping full rosters (E27, incl. the nominator-rotation skip §8.6.7(c)), next nomination deadline.
> 2. Completion: `CREATE OR REPLACE` the 072 completion path to write **`acquisition_cost = price`** for auction rows (D111(3); snake rows keep NULL); everything else (rosters populate, `in_season`, D43 guard, mock bypass) unchanged and re-pinned.
> 3. K/D-ST deferral in the auction resolve context: the forced-only arm (no rounds — D129(2)); documented in the banner, boundary pinned.
> 4. pgTAP **035**: nomination-timeout fixtures (all three seat classes; both grace branches — the 022 pattern rerun for the nomination clock); E26 golden (opening $7, no raises → nominator's pick at $7); E27 rotation fixture (team fills → next nomination skips it; its bid refused by 034's pin); full-auction completion golden (4-team scripted → rosters count, `acquisition_cost` = prices, `in_season`); the D130 "budgets exhausted unreachable" property spot-check (min_bid 1: run a scripted greedy-spend draft to completion — every team fills).
> 5. Stack vitest: a 4-team auction where every seat times out end-to-end → board completes, all system nominations + nominator awards, zero manual actions (the all-afk auction — E48's auction analog).
>
> **Pre-authorized fallback split (sizing):** if fix-cycle 3 is reached, land the nomination-expiry sub-arm + pins as this task and open "L.C1.4b — bid close + rotation + completion" immediately.
>
> DoD: §4 standing rules; break probe: award to high bidder even when no raises exist (drop the E26 branch) → the E26 golden fails (shown, reverted).

### L.C1.5 — Migration 087: auction commissioner controls (§8.7's auction rows) + E28/E29
> Read spec §8.7 (the auction row + reassign/move/undo rows), E28/E29, §17, this doc D131/D137/D138 + §4.7, 069's CURRENT control RPCs, PROGRESS D110(1) (mock refusal contract). Depends L.C1.4.
>
> 1. `draft_reverse_won_bid` + `draft_adjust_budget` per the §5 sketch — commish/co-commish in-body (42501), draft-row lock, **in-txn D97 system chat post** (before/after budget numbers in the post text — §16.3 transparency), **mock refusal** (D138: the D110(1) "every other §8.7 control refuses mocks" list grows both verbs), live/paused only (F44). E28 all three refusal arms (below committed spend / below solvency floor / insolvent vs the live high bid — D131(4)), each message naming the remedy.
> 2. `CREATE OR REPLACE draft_undo` (against 069's current body): the E29 arm — a live nomination is voided FIRST (D131(2)), then the cascade reverts; on_clock rewinds to the target nomination's nominator, fresh nomination clock; single system post describing both effects. `draft_reassign_pick`/`draft_move_player`: priced picks validate the receiving team via `draft_team_budget` (max-bid style — an E28-class refusal). `draft_set_clock`: gains the auction timers (nomination/bid/anti-snipe — E15 analog: subsequent clocks; may extend the current deadline). `draft_set_order`: on an auction edits `nomination_order` (E31 analog: completed nominations unchanged, rotation re-derives). **`draft_force_pick` — the §8.7 "Pick for a manager" auction arm (R301; the L.C1.3/§5 force-path pledge lands HERE):** in NOMINATING phase it force-nominates for the on-clock team — commissioner supplies the player, opening bid = `min_bid`, validated exactly as that team's own nomination (D129(1)); in BIDDING phase it refuses with a friendly P0001 — absent teams don't bid (§8.6.5/OQ 10) and the close needs no force, so there is **deliberately no commissioner force-bid** (recorded). **`draft_reset` — the auction-hygiene arm (R302):** the reset UPDATE (069:1424–1436 clears only the snake fields) additionally clears **`current_nomination`** (without it, a reset mid-bidding resurrects a ghost nomination on restart under D126's phase rule) **and `budget_adjustments`** (a reset returns to pre-draft per §8.7's own row; adjustments were live-draft corrections and die with the draft they corrected — recorded).
> 3. **F40's row grows the auction verbs when this lands** (the Builder appends to the PROGRESS §6 Obligation cell with a pointer here — audit rows stay M6; chat posts are the interim, D97).
> 4. pgTAP **036**: E28 all three arms + positive control (legal edit lands, `budget_adjustments` map updated, solvency holds); reverse-won-bid golden (pick undone, pool restored, rotation re-includes, derivation reflects instantly); E29 cascade golden (nomination with 3 live bids + undo to seq N → nomination voided, picks > N undone, on_clock = seq-N nominator); priced-reassign refusal (receiving team over max-bid) + positive control; **force-nominate golden (nominating phase — the nomination opens exactly as the seat's own would) + the bidding-phase force refusal (R301)**; **reset-mid-bidding pin (R302): `current_nomination` NULL + `budget_adjustments` `'{}'` + a restart opens in nominating phase at seq 1**; per-control non-commish 42501 sweep + mock-refusal sweep (D138); system post pinned per control.
>
> DoD: §4 standing rules; break probe: drop the live-high-bid arm from E28 → the D131(4) pin fails (shown, reverted).

### L.C1.6 — Migration 088: auction realtime — `draft_bids` broadcast + payload extensions (D133/D134)
> Read spec §9 (all — the transport rule), §9.2, delivery plan §8.4, this doc §2 (070's payload/exclusion lines + the inert-default pin), D133/D134/D137. Depends L.C1.5.
>
> 1. `draft_bid_broadcast_payload` + INSERT trigger on `draft_bids` → topic `draft:<draft_id>`, event `'draft_bids'` (the name the M2 client's default-case pin proves inert — §2); SECURITY DEFINER `SET search_path = ''` per the 070 pattern; never `action_id`.
> 2. `CREATE OR REPLACE draft_broadcast_payload` (+= `current_nomination`, `budget_adjustments`) and `draft_pick_broadcast_payload` (+= `price`) against 070's current bodies — the new banners restate the D109 "columns clients render" rule with the auction columns now IN the inventory (D134) and re-enumerate what stays out (`config`, `is_mock`, ids, `action_id`, `picked_by`/`made_via`).
> 3. **No `realtime.messages` INSERT policy change — D133 recorded in the migration banner** (Client Broadcast stays presence-only; pinned: a member's `extension='broadcast'` INSERT still refused — re-run of 070's negative with the auction topic).
> 4. pgTAP **037**: trigger existence/form pins; payload-shape pins (bid payload exact key set; drafts payload includes the two new keys, still excludes `config`; pick payload includes `price`, still excludes `action_id`); the D133 negative.
> 5. Integration (stack vitest): a supabase-js member client hears the bid event with the selected columns on a live raise; a non-member hears nothing; **an M2-shape reducer fed the new payloads stays inert/strips cleanly** (the §2 forward-compat claim made falsifiable — Builder re-verifies the non-strict Zod parse and pins it).
>
> DoD: §4 standing rules (rule 5 literal); break probe: widen the bid payload to full-row (action_id leaks) → the payload pin fails (shown, reverted).

### L.C1.7 — Migration 089: mock auctions — the 071 refusal lifts + CPU bidders (E62)
> Read spec §8.8 (all — CPU bidders bid value-based and "pass the same max-bid/solvency validator as humans"), §22.5 (caps unchanged), E59/E60/E62, this doc D132/D138, PROGRESS D110 (all sub-items), 071's CURRENT `create_mock_draft` (refusal at 071:315–319). Depends L.C1.6 (broadcast exists for the room later; the tick sub-arm amends L.C1.4's ARM 2.6 per D137).
>
> 1. `CREATE OR REPLACE create_mock_draft`: the auction refusal becomes the auction launch arm — snapshots the real config (incl. auction clocks + budget), `nomination_order` per the launcher's real league order rules, human takes their chosen seat, `status='live'`, first nomination deadline. Caps/serializer/`launched_by`/`action_id` dedupe (D110(6)(11)) untouched. **tests/025:400's assertion flips in this PR** to a launch-succeeds pin.
> 2. `CREATE OR REPLACE draft_tick`: ARM 2.6 gains the mock sub-arm (D132) — CPU nominations at think-time (the D93 PRNG), CPU raises per the value model (≤ min(value, max_bid), one raise per pass per nomination, deterministic per (draft_id, nomination_seq, team_id, pass)); the human's clocks always real; E59 stale-pause + launcher-resume unchanged. D103(2) extended: the launcher is the mock's only legal human nominator/bidder (D138) — pinned from both sides.
> 3. Zero-side-effect re-pin: the 025 full-table diff extends its allowed set with `draft_bids`; a scripted mock auction to completion writes NOTHING league-scoped outside the mock's own rows (no `league_rosters`, no status transition).
> 4. pgTAP **038**: CPU raise determinism (same inputs → same decision, stored literal); **E62's pgTAP half** — a CPU pushed to its budget edge by a scripted human bid-up never exceeds max_bid (the validator refuses; the CPU's next pass passes or folds — both branches pinned); mock-refusal sweep for the auction commish verbs (D138); E60 independence re-pin (live mock auction + real scheduled draft coexist); launch-arm goldens (config snapshot incl. anti-snipe, first nominator = order[0]).
>
> DoD: §4 standing rules; break probe: let the CPU bid `value` ignoring max_bid → the E62 pin fails (shown, reverted).

### L.C2.1 — Nominate/bid API + hooks
> Read spec §15.2 (nominate/bid rows), §15.6 (never optimistic for bids), §16.3 (latency-resilient intent), this doc D92-precedent/D134 + §5, CLAUDE.md route patterns. Depends L.C1.3.
>
> 1. Routes: `POST /api/leagues/[id]/draft/nominate` (Zod: player_id, opening_bid; action_id minted per submit — the D68(1) stamping pattern), `POST /api/leagues/[id]/draft/bid` (amount; same stamping). Service fns `nominatePlayer`/`placeBid` per the §5 sketch (`draft-service.ts` grows the auction block; SQLSTATE mapping per the 063 conventions — "outbid" P0001 → friendly 4xx with the message passed through).
> 2. Hooks `useNominate`/`usePlaceBid` (mutation-only, cache untouched — the broadcast is the truth, §15.6); budget display selectors over the D134 payloads (pure, `nowMs`-injected where clocked; **the TS max-bid mirror is display math pinned TS ≡ SQL** by a parity fixture — §4.7).
> 3. Stack vitest: nominate → outbid race (two clients, one raise each — loser's message pinned), E2 double-submit no-op over the wire, outsider/non-member auth sweep (the R155 lesson: pin the no-leak arms with a real outsider client).
>
> DoD: plan §2.3 + §4; break probe on the parity fixture (skew the TS mirror → parity fails).

### L.C2.2 — Auction commissioner routes (C40's §15.2 extension)
> Read spec §15.2 (commish block — prints NO auction verbs; C40 records the two new routes as the v2.8.17 clock-route precedent), §17, this doc D131/D138. Depends L.C1.5 + L.C1.7.
>
> 1. `POST /api/leagues/[id]/draft/reverse-bid` (pick_id) + `POST /api/leagues/[id]/draft/budget` (team_id, delta) → the L.C1.5 RPCs; `reason` accepted + Zod-validated, stored nowhere (F32/F40 pattern); erratum text for §15.2 rides this PR.
> 2. Existing control routes pass the auction args through where L.C1.5 extended them (clock: auction timers; order: nomination order) — wire tests for each.
> 3. Stack vitest: per-route auth sweep (manager 403 on both verbs — §17); E28 refusals surfaced as friendly 4xx with the remedy text; mock refusal surfaced (D138).
>
> DoD: plan §2.3 + §4.

### L.C3.1 — The auction room: `auction-block.tsx` + shell consolidation (D135) — takes F56's room half
> Read spec §8.6.1 (budgets + max bid on every team), §16.2 (`auction-block.tsx` — nomination, bid input, budgets, max-bid, anti-snipe), §16.3 (one-glance clarity; instant outbid), §16.4 (mobile density), §16.5.2 (draft-night row), E17-analog, this doc §2 (room state + fork point)/D133/D134/D135, PROGRESS **F56** (the room-fallback half — this is "M3's first draft-room-adjacent task", the row's own routing), CLAUDE.md redesign rules (re-skin in place; single theme; elevation = hover only). Depends L.C2.1 + L.C1.6.
>
> 1. **D135 consolidation:** `git mv snake-draft-room.tsx draft-room.tsx` (§16.2's canonical name; imports updated, no fork); the :389 fork point gains the `'auction'` branch rendering `auction-block.tsx` — new §16.2 component: nomination stage (player card + high bid + high bidder), bid input with the max-bid cap surfaced ("max $N" — E5's message prevented at the UI), per-team budgets rail (remaining + max bid, §8.6.1), nomination/bid clocks off the existing `pick-clock` ops (server deadlines only), anti-snipe indicator (clock floor visibly re-arms — E6). Board grid renders results-by-team with prices; pool/queue/chat/presence/commish-panel/My-Lists compose unchanged (best-available-card's :66 mount hook is available, not required).
> 2. The reducer learns the `'draft_bids'` event + the D134 payload keys (additive; unknown-event default stays for M4+ — re-pinned); "submitting…"/outbid states per §16.3 (intent optimistic, result authoritative).
> 3. **`auction-draft-room.tsx` DELETED; `mock-draft.ts` DELETED** (its banner's own instruction — the auction fixture types are replaced by live shapes) — **rehome `abbreviateName` first** (the file's one live export; FOUR importers: the room shell :54, draft-board-grid.tsx:9, draft-recap.tsx:36, my-roster-tracker.tsx:11 — R304, count corrected from the review's three); the standing lint warning retires — `npm run lint` output goes clean-or-new-baseline, recorded.
> 4. **F56 room half:** decide the fetch-path fallback — a room whose draft query ERRORS must not silently render the scheduled-lobby fallback (the observed shape); surface the R263-class banner on the fetch path (N-failure threshold, mirroring the subscribe path), pin the mount-during-error shape. Record the decision; the gate-settle half stays L.C6.1's.
> 5. MOCK banner + launcher-entry behavior carry to auction mocks unchanged (§16.5.2's mock row).
>
> DoD: plan §2.3 + §4 UI scoping (ops-layer pins + browser pass, R278 form); break probe on the reducer's bid-event pin. **New auction surfaces join F55's member list** (accessibility sweep stays M7; the Builder appends members, not fixes).

### L.C3.2 — Commissioner auction rows + settings completion + recap/tracker variants
> Read spec §8.7 (auction row), §7.3.8 (the three UI-less fields — §2's gap), §16.2 (commish panel/draft-setup/recap), §16.5.1–16.5.2, §16.4 (timezones note), E28 copy, this doc D131/D135, PROGRESS F46 (recap doors stay M4's — no scope pull). Depends L.C3.1 + L.C2.2.
>
> 1. Commish panel gains the auction section: reverse-a-won-bid picker (priced picks list → confirm with before/after budgets), budget editor (delta + live solvency preview; E28 refusals rendered with the remedy copy), auction clock edits; every action's system post visibly lands in chat (§16.3 loop).
> 2. Settings/draft-setup completion: inputs for `auction_bid_seconds`, `auction_anti_snipe_seconds`, `nomination_order_mode` in the §7.3.8 panel block (compose over the existing auction group at settings-panel.tsx:1477–1517 — no fork); lobby shows nomination order + budget once scheduled.
> 3. Recap (both variants) + roster tracker render spend: prices on the final board, per-team total spent + biggest buy; tracker's needs surface gains remaining-budget context. Mobile per §16.4.
>
> DoD: plan §2.3 + §4 UI scoping; browser pass (R278 form): full commish auction journey — reverse a bid, edit a budget, see both refused at E28's arms, system posts in chat — prose + DB corroboration.

### L.C4.1 — Sim auction mode + THE solvency property test (exit criterion 2)
> Read delivery plan §4.2 (auction personas; "sniper who bids at T-1s"), §4.1 (property row: "max-bid & solvency"), §3 M3 row (the exit-criterion sentence), spec §22.1, E62, this doc D127/D131(3)/D132/D136 + §5's sim sketch, sim §2 facts (runner.ts:379; no --type flag). Depends L.C2.1 + L.C1.7.
>
> 1. `--type snake|auction` on `scripts/sim.ts` (snake default; **unknown flags now REFUSED** — the silent-ignore §2 gap closes here); runner provisions auction leagues (`draft_type: 'auction'` through the real settings path); auction personas per §5 (value-bidder, sniper via rewind-to-T-1s harness, budget-hoarder, afk, chaos double-tap) as seeded pure policies over the real service layer (D100 — never direct DB writes).
> 2. Auction invariant sweep per §5 (solvency after EVERY settled command is the headline — sampled mid-run + full at end); each invariant falsifiable (deliberately broken once in the task log).
> 3. **The property test** (vitest + fast-check, seeded, seed printed): (a) pure layer — TS derivation mirror vs SQL parity + algebraic properties (undo solvency-preservation D131(3); max-bid monotonicity); (b) **DB layer — randomized legal/illegal command sequences (nominate/bid/timeout-close via tick/undo/cascade/reverse/budget-edit) against a real draft incl. MOCK auctions with CPU bidders**: after every command, `draft_auction_solvent` holds and refused commands changed nothing. This is the plan's exit-criterion sentence made executable — bot-driven mocks included (E62's property half).
> 4. **The 25-league auction gate run green** (`sim draft --type auction --leagues 25 --seed …`, mixed sizes incl. ≥1 16-team, mixed personas incl. ≥1 all-afk league, chaos throughout): zero duplicate players, zero stuck clocks (both clock kinds, grace-aware), all `in_season`, rosters full, **solvency never violated**, budget conservation exact.
>
> **Pre-authorized fallback split (sizing):** if fix-cycle 3 is reached, land sim mode + invariants + the pure property layer as this task and open "L.C4.1b — the DB-layer property test" immediately.
>
> DoD: plan §2.3 + §4 (full §4.3 falsifiability — engine lane); the gate run's output in the session log.

### L.C5.1 — Auction E2E: full draft, the bid storm (exit criterion 3), mock auction
> Read delivery plan §3 M3 row (bid-storm E2E), spec §19.3 (E2E row: "full auction"), §8.6, E6/E60, this doc §2 (harness inventory)/D136, e2e/helpers (harness.ts:109/:123/:178). Depends L.C3.2 + L.C1.7.
>
> 1. **(a) `auction-live.spec.ts`:** full short-clock auction to completion, two browser contexts (commish + manager) — nominations and raises broadcast cross-client, budgets rail converges, completion → recap with prices, league `in_season`.
> 2. **(b) `auction-storm.spec.ts` — the exit criterion:** one nomination; a service-layer burst (~20 bids in ~2s across N seated bot clients — the §22.6(2) shape at Playwright scale) while both browsers also bid; assert single winner at the max legal amount, `draft_bids` rows == accepted raises (none lost, none duplicated — the E2/action_id proof under burst), anti-snipe extensions observed in both browsers, final state converges < 2s after close, losers saw the instant outbid state.
> 3. **(c) `mock-auction.spec.ts`:** launch → CPU nominations + raises land at humanized timing → human wins one player against a CPU bid-up (E62 visible) → finish → recap with prices → **zero league writes** (`snapshotLeagueWrites` diff, `draft_bids` in the mock-allowed set).
> 4. Reconnect-during-bidding folded into (a): context offline across a raise → reconnect restores nomination + high bid < 2s (refetch-then-resubscribe on the auction payloads).
>
> **Pre-authorized fallback split (sizing):** if fix-cycle 3 is reached, land (a) + (c) as this task and open "L.C5.1b — the storm spec" immediately.
>
> DoD: plan §2.3; all specs green locally against a fresh stack ×2 (shown); flake policy per plan §5.2 (a flaky auction test is a concurrency bug until proven otherwise).

### L.C6.1 — M3 gate harness (exit-criteria proof; updates PROGRESS) — takes F56's gate half
> Read this doc §1 + §8, delivery plan §3 M3 row, tasks-M2 L.B7.1/D125 (the composition precedent — the gate composes, never rewrites), PROGRESS **F56** (the gate-settle half). Depends everything above.
>
> 1. `npm run test:gate:m3` = `scripts/gate-m3.sh` under `set -euo pipefail`: fresh `db reset` (001–089) → `test:db` (pgTAP full incl. 032–038) → the M3 vitest gate config (auction-core/tick/commish DB suites + the derivation parity fixture + **the property test**) → the L.C4.1 25-league auction sim run → the L.C5.1 specs (+ the M2 E2E suite — one Playwright run) → `test:gate:m2` → `test:gate:m1` → `test:gate` (M0). Continuity is exit criterion 4.
> 2. **F56 gate half:** if still unreproduced, implement the row's own recommendation — a bounded stack-health settle between sim and E2E (poll until N consecutive OK draft-state responses; a diagnosed wait, never a blind sleep) — and record it; if reproduced meanwhile, the diagnosing session owns it and this item is a verification. **Flip F56** with pointers (both halves).
> 3. Browser pass (R278 form) over the auction journey: schedule auction → lobby → live room two-browser nominate/bid/anti-snipe → commish reverse + budget edit (E28 refusal seen) → completion → recap with prices → in_season home → mock auction launch → CPU bid-up → mock recap → zero-side-effect DB check. Prose + DB corroboration in the session log.
> 4. Update PROGRESS: §1 M3 status flip, §2 M3 checkboxes, ledger audit (every row this doc's §10 names, verified appended/flipped/untouched as dispositioned), session-log entry with gate output.
>
> DoD: all §1 exit criteria shown green in one session log.

---

## 7. Migration plan (schema lane, serialized)

| # | File | Contents | Task |
|---|---|---|---|
| 083 | `083_draft_bids.sql` | `draft_bids` (§12.5 + C39 action_id delta + CHECKs) + `drafts.budget_adjustments` (D127) | L.C1.1 |
| 084 | `084_auction_start_budgets.sql` | derivation fns + `draft_start` auction arm (CREATE OR REPLACE per D137; refusal → arm; tests/020:685 flips) | L.C1.2 |
| 085 | `085_auction_nominate_bid.sql` | `draft_nominate` + `draft_place_bid` + `draft_make_pick` message reword (tests/020:961 flips) | L.C1.3 |
| 086 | `086_auction_tick_completion.sql` | `draft_tick` ARM 2.6 + the priced completion writer (both CREATE OR REPLACE per D137) | L.C1.4 |
| 087 | `087_auction_commish_controls.sql` | `draft_reverse_won_bid` + `draft_adjust_budget` + E28/E29 arms in undo/reassign/move/clock/order | L.C1.5 |
| 088 | `088_auction_realtime.sql` | `draft_bids` trigger + payload fn; drafts/pick payload extensions (D134); D133 recorded | L.C1.6 |
| 089 | `089_mock_auctions.sql` | `create_mock_draft` auction arm (tests/025:400 flips) + tick mock CPU sub-arm (D132/D138) | L.C1.7 |

Numbers 083–089 are **reservations under the standing confirm-at-task-time policy** (the M1/M2 drift lesson — review-fix migrations may interleave); pgTAP files **032–038** likewise. Every migration: banner citing spec §; §4 standing rules; the D137 head-rule note naming the source migration of every replaced function; pgTAP in the same PR; typegen + alias-block re-append. **Not in M3:** `commissioner_actions` (M6/F40) · rate limits (M7/F41) · k6 (M7) · any in-season table (M4+).

---

## 8. Exit-criteria → proof map

| Exit criterion (§1) | Proven by |
|---|---|
| Phase C gate — full auction, budgets enforced, no overspend, legal full rosters, anti-snipe, commish reverse + adjust, mock auctions with solvency-obedient CPUs | L.C5.1 (a)+(c) + L.C4.1 sweep + pgTAP 034 (E5/E6/E25) / 035 (E26/E27/completion) / 036 (E28/E29) / 038 (E62, mock) composed in L.C6.1; overspend additionally impossible-by-validator (§4.7, pgTAP-proven at every entry point) |
| Solvency property test incl. bot-driven mocks (plan §3, verbatim) | L.C4.1 item 3 (pure + DB layers; mock CPU auctions in the command universe) + the sweep's per-command solvency assert; E62 |
| Bid-storm E2E | L.C5.1 (b) — burst + browsers, single winner, zero lost/dup bids, anti-snipe observed, convergence < 2s |
| Continuity (M2/M1/M0 green) | `test:gate:m3` composes `test:gate:m2` → `test:gate:m1` → `test:gate` |

---

## 9. Conflict report (codebase / migrations 001–082 / docs vs the M3 spec sections)

*Numbering continues from tasks-M2 §9 (C19–C31). Verified during the 2026-08-14 survey; each item names its resolution. Two items need Chris BEFORE build (flagged); the rest are Builder-carriable or Architect-resolved errata.*

| # | Conflict | Evidence | Resolution |
|---|---|---|---|
| **C32** | §8.6.2 says nomination timeout "nominates highest available **or skips per setting**" — no such setting exists in §7.3.8 | league-settings.ts:213–224 (the full catalog block; no skip field) | Always system-nominate per §8.6.7(e)/D129(2); the skip setting doesn't exist in v1. Erratum. Builder-carriable |
| **C33** | §8.6.7(e) "fits *some* team's open slot" can pick a player the nominator can't use, but §8.6.7(b) awards no-raise nominations TO the nominator | spec §8.6.7(b) vs (e) | **D129(2)**: system nomination = the on-clock team's own resolve chain (satisfies (e), makes (b) always legal, one implementation with snake). Erratum. Flagged in the PR body for Chris's read |
| **C34** | Bid-clock semantics ambiguous: §8.6.3 "each bid resets the bid clock per anti-snipe" vs §7.3.8/E6/App C "resets clock **to** anti_snipe_seconds" (a reset-to-full reading contradicts E6 as printed) | spec §8.6.3 vs §7.3.8:376–377, E6, App C L.C1 | **D128**: fixed window + anti-snipe floor (every printed number is consistent with it). **RULED 2026-08-15 — Chris confirmed D128 with the 30s/10s/3s→10s scenario** (see D128's ruling note); no spec change owed |
| **C35** | §22.6(2)'s "auction bid storm" is a k6/staging gate but the M3 exit criterion says "bid-storm E2E" | plan §3 M3 row vs spec §22.6 | Sequencing disposition, not conflict: M3 = Playwright + service-burst correctness (L.C5.1(b)); k6 latency at load = M7 (§22.6 unchanged). Recorded |
| **C36** | §16.2 prints ONE shell (`draft-room.tsx`) + `auction-block.tsx`, but the repo has a second full room (`auction-draft-room.tsx`, unmounted M0 fixture w/ the standing lint warning) and `mock-draft.ts` whose banner orders its own deletion | §2 survey; mock-draft.ts:6–15; auction-draft-room.tsx:107 | **D135**: one shell (renamed to the canonical name), auction-block center stage; both legacy files deleted; lint warning retires. C25's twin, mooted by replacement |
| **C37** | Plan v1.4 requires a **spec changelog entry for the custom scoring editor un-punt before build** and names the Architect; the M3 milestone is the Architect's next session, but custom scoring is orthogonal to the auction engine | plan v1.4 changelog + §3 test-cohort bullet; CLAUDE.md Active Builds; F21 (the v1.1 editor footgun row) | **NOT pulled into M3 scope** (improvising it into an auction breakdown is exactly what the plan's "needs a spec changelog entry (Architect)" guards against). Recommendation: a **separate, small Architect spec-session** — changelog entry scoping the editor for the test cohort (citing F21's overlapping-PA double-pay footgun; §7.3.3 snapshot semantics stay LAW), schedulable in PARALLEL with M3's build. **RULED 2026-08-15 (Chris): the separate parallel Architect track CONFIRMED.** He also supplied the editor's product requirements verbatim as that track's input (recorded here so the spec session reads them at the source): **(1) scoring is configured BY POSITION** — the user steps through each position entering its scoring, not today's global "Rushing"/"Passing" category style; **(2) an "All Positions" switch** that applies a section's values (e.g. Rushing) globally to every position while per-position customization stays possible after; **(3) every position except K and DEF carries sections: Rushing, Passing, Receiving, Special Teams (e.g. return yards), and Turnovers (fumbles, interceptions)**; **(4) a live example player per section** whose sample stat line recomputes as the user edits values (e.g. "Adrian Peterson: 22 carries, 121 rush yds, 4 rec, 23 rec yds = N points"), with the sample players fixed as **Dan Marino (QB), Randy Moss (WR), Adrian Peterson (RB), Gronk (TE)**. The spec session owns reconciling per-position rules with §7.3.3's calculator/snapshot semantics and the F21 double-pay guardrails — the data-model implication (rules keyed by position × stat, not stat alone) is that track's central design question, deliberately NOT decided here |
| **C38** | `auction_min_bid = 0` is catalog-legal (0–5): solvency floor degenerates to ≥ 0, opening bids of $0 are legal | league-settings.ts:220; §7.3.8:374 | Legal as printed; raises stay integer-increment (> high_bid); boundaries pinned (pgTAP 034). Architect-resolved note |
| **C39** | §12.5 prints `action_id UUID NOT NULL` on `draft_bids`, but system rows (the nominator's opening bid written by the tick, D130) have no client action | spec §12.5:853 vs D129(2)/D130 | NULLable + partial unique `WHERE action_id IS NOT NULL` — 065's `uniq_draft_action` precedent exactly. Erratum. Builder-carriable (L.C1.1) |
| **C40** | §15.2 prints no routes for the §8.7 auction controls (reverse a won bid / adjust budget) | spec §15.2:1411–1418 (the commish block) vs §8.7:473 | Add `POST …/draft/reverse-bid` + `POST …/draft/budget` — the v2.8.17 clock-route precedent. Erratum (L.C2.2). Builder-carriable |

---

## 10. Ledger dispositions (every §6 row naming M3 or plausibly dischargeable here, swept 2026-08-14)

| Row | Disposition in M3 |
|---|---|
| **F56** — the E2E post-load contention observation (routed: "M3's first draft-room-adjacent task, or the first session that reproduces it") | **DISCHARGED IN M3, two halves:** room fetch-path fallback honesty → **L.C3.1(4)**; the gate's bounded stack-health settle → **L.C6.1(2)**. The Builder flips the row with both pointers |
| **F40** — `commissioner_actions` rows for every §8.7 control (M6) | **Stays M6; GROWS in M3** — L.C1.5's Builder appends `draft_reverse_won_bid` + `draft_adjust_budget` (+ the auction arms of undo/reassign/move/clock/order) to the row's control list with a pointer (D97 chat posts are the interim). Status cell untouched |
| **F41** — §22.5 rate limits, incl. its own words "**bids 5/s for M3**" (M7) | **Stays M7 (D136)** — the bids clause is deliberately NOT absorbed: M3 proves correctness under burst (L.C5.1(b) + chaos persona); the draft-row lock serializes; route-layer throttles land with the family. The row's clause reads as "the limit M7 must implement for bids", not an M3 deliverable — noted in the PR body |
| **F42** — no-subscriber M1-table triggers (M4) | Not M3's. `draft_bids` never joins it — its trigger ships **at creation-adjacent time** (L.C1.6, the `league_rosters`/072-3b precedent) |
| **F43** — order-reveal animation + 20-team pass (M7) | Not M3's; no auction reveal exists to add |
| **F44** — post-completion reset/reversal (M6) | Stays M6; L.C1.5 gates `draft_reverse_won_bid` to live/paused, same boundary |
| **F45** — audited draft-short override (M6) | Stays M6; L.C1.2's auction start keeps the full-capacity gate (placeholders reachable + they system-nominate, D129) |
| **F46** — M4 home heroes + recap/launcher doors (R281) | Stays M4; auction recaps ride the same doors when F46 lands — no new row needed (R281's clause is door-generic). No scope pull |
| **F47** — Playwright CI wiring (Chris) | Unchanged; L.C5.1's specs land into the same suite — the recorded commands (D124(10)) already cover them |
| **F48** — §12.6 commissioner all-queues SELECT (M6 console) | Stays M6. The parallel question for `draft_bids` **does not arise**: §12.5 prints member SELECT (bids are public in an open auction) — recorded so nobody files a phantom row |
| **F50** — tick outage-batch rotation > 25 (M7) | Stays M7; ARM 2.6 uses the same batch pattern and inherits the same known ceiling — noted in L.C1.4's banner, no new row |
| **F55** — draft-room accessibility pledge members (M7 sweep) | Stays M7; **L.C3.1 appends the auction surfaces** (auction-block, budgets rail, bid input, anti-snipe indicator) to the member list as it lands them |
| **Not M3's (verified no false pulls)** | F1/F4/F9/F11/F13/F22/F23/F31/F35 (M4/M6 in-season + stints) · F7/F17/F36 (M7/product/security) · F10/F24 (September ops) · F12 (prod migration push — but see D137: its open/closed state is why M3 uses CREATE OR REPLACE, not in-place amends) · F14/F19 (template/scoring keys) · **F21 (the v1.1 custom-editor footgun — cited by C37's recommendation, NOT pulled)** · F15 (vendor) · F16 (funded stats) · F32 (M6 audit class) |

---

## 11. Known gaps & notes for later milestones (not M3 work)

- **M4 inherits:** `acquisition_cost` consumers (FAAB/keeper surfaces render auction spend); everything in tasks-M2 §11's M4 list unchanged; auction recap doors ride F46; the Ghost sim scenario still waits on rosters/FAAB.
- **M6 inherits:** **F40** now including the auction verbs (L.C1.5's append) · F44 (post-completion reversal incl. auction picks) · F45 · F48 · the F32 class.
- **M7 inherits:** **F41** (incl. bids 5/s — D136's deliberate deferral) · the §22.6(2) k6 auction bid storm at load (C35) · F43 · F50 (ARM 2.6 shares the ceiling) · **F55** (auction surfaces appended at L.C3.1) · the §24 dashboards gaining bid-rate/solvency-refusal metrics (plan §2.3's metric hook line applies per task — no separate row needed).
- **v1.1:** auto-bid for absent managers (OQ 10) · standalone/multi-human mock auction lobbies (§8.8) · Client Broadcast for ephemeral bid-pulse UX beyond the authoritative feed (D133's revisit clause).
- **September ops (unchanged):** F10/F24; the M0 gate re-run.
- **Chris:** ~~**C34**~~ (RULED 2026-08-15 — D128 confirmed) · ~~**C37**~~ (RULED 2026-08-15 — separate parallel track; editor requirements recorded in the C37 row) (custom-scoring changelog entry as a separate parallel Architect track — before/alongside approval) · F47 (CI) · C33's erratum read (with the PR) · the C19/C2/C13 leftovers from earlier milestones remain his.
