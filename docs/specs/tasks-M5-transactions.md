# M5 Task Breakdown — Transactions (waivers / FAAB / free agency + trades)

> **Architect session output — 2026-09-27.** Read together with `spec-redraft-leagues.md` **v2.16.52** (the LAW) and `delivery-plan-redraft-leagues.md` **v1.4** (§3 M5 row, `delivery-plan-redraft-leagues.md:70`). This doc sequences M5 into Builder-sized tasks; it never overrides the spec. One task per Builder session, one PR per task, in dependency order (§7). Per the #150 / #161 / #244 / #289 precedent **this breakdown's PR STAYS OPEN for Chris's approval — the loop builds no `L.D2.4+` / `L.D3.2+` task until he merges it and ACTIVE-BUILD is pointed here** (M6A's last task, L.E1.27, is still in flight).
>
> **Process rule — "lighten it" (Chris, 2026-09-27).** Pre-launch, **full rigour** (adversarial review until clean, pgTAP per role, break probes shown) only for **scoring, standings/results, money-shaped state (FAAB), roster exclusivity and permissions**. Everything else — API plumbing, UI, copy, tooling, sim, docs — gets **one review pass**; nits become follow-ups; ledger notes stay short. Every task below is tagged **FULL** or **ONE PASS**.
>
> **Task ids.** M4 already used `L.D2.1`–`L.D2.3` (ingestion / score worker / wiring) and `L.D3.1` (nflverse adapter). M5 continues **`L.D2.4+`** (waivers / FAAB / free agency) and **`L.D3.2+`** (trades, then the cross-cutting sim / E2E / gate tail).
>
> **Ten product questions (§11, filed as PROGRESS §3 Q70–Q79) block specific tasks only.** Seven tasks can start the day this merges without any answer (§7).

---

## 1. Scope & exit criteria

**In M5 (delivery plan §3, spec §13.1–13.4, §7.3.4–7.3.5, §12.9–12.11, §14 rows `process-waivers` / `trade-review-expiry`):**
- **Waivers / FAAB / free agency:** blind claims with `claim_order`; the `process-waivers` job for FAAB, rolling priority and reverse standings; `bench_lock` (E33/E34 — or its retirement, Q73); the waiver **schedule** model F229 asked for (Q70); FAAB balances live, carried with the seat (§2.3, C72); `commish_edit_faab` (D352 / F340).
- **Trades:** propose / accept / reject / cancel / counter; review by none / commissioner / league vote; deadline; lock behaviour (E35); uneven trades with drops (E36); invalidation (E37, E47); FAAB in trades when allowed; `commish_force_or_reverse_trade` (E11, D352 / F340).
- **Surfaces:** API + hooks per §15.3/§15.4, the players-page claim flow, a claims panel, a trade center (spec §16.1:1812, §16.2:1848-1849 / :1882-1883, §16.5.2:1941-1942), activity rendering, FAAB on team page + standings.
- **Proof:** a transacting sim persona + the Ghost (F211 / F284(b) / F300), E2E for waiver morning + trade lifecycle, and `test:gate:m5`.

**Not in M5 (named so nobody builds them by accident):**
- Swap spots / `process-swaps` and `auto_sub_inactives` (F211's other two arms) — **Q79** asks whether the cohort wants them; either way they are a later slice, not an M5 task.
- What a ceiling-closed week does with an **unplayed game's scores** — Q37 / F243 / M8 (operator tools). M5 builds only the ceiling's **lock release** (Q78).
- Push notifications / digests (§16.4:1903) — M5 writes in-app `notifications` rows only (001:540; the league RPCs already do, 062/063).
- Real money / dues (§21 item 2 — out of v1).

**Exit criteria (delivery plan §3 M5 row, restated as checkable):**
1. **Phase D transaction gate** (spec §18:2012-2015): in one seeded league, claims process on schedule and a trade completes **under each review mode**.
2. **Deterministic FAAB tiebreak property tests:** the same claim set + seed → byte-identical results; ties resolve by the configured tiebreaker; no reachable run leaves a negative balance or a player on two rosters.
3. **E32–E37 all covered** (E32 already pinned by M4: pgTAP 061/063 + `e2e/inseason-lock.spec.ts`), plus E7, E8, E11, E13 (blind bids), E47, E49's FAAB line.
4. **Continuity:** `test:gate:m4` (which composes M3→M0) stays green.

---

## 2. Current state (measured 2026-09-27 on `main` @ `729f760`; migrations 001–143, pgTAP 001–091)

### 2.1 What does not exist
- **No `waiver_claims`, `trades`, `trade_items` table** in any migration (grep over `supabase/migrations/*.sql`). No claim processor, no trade verb, no waiver or trade cron.
- **No route or page for trades or claims:** `src/app/api/leagues/[id]/` has `transactions/` (add/drop) but no `waivers/` or `trades/`; `src/app/app/(shell)/leagues/[leagueId]/` has no `trades/`.
- **The UI says so honestly:** `WAIVERS_LATER_COPY` / `TRADES_LATER_COPY` (`src/components/leagues/league-home-season-ops.ts:153-154`); the players page's `on_waivers` Add title says claims arrive later (`players-page-ops.ts:129-130`).
- **The season sim drives no transactions** (F284(b), F300; `src/lib/leagues/sim/season-runner.ts:3722`), so `league_player_pool` is post-draft-only in every run.

### 2.2 What M5 builds on (the rails are laid)
- **`transactions`** (`109:239-253`): type CHECK already admits `waiver_claim` / `trade`; status admits `pending|complete|reversed|failed|vetoed`; `action_id` added by 113; `related_action_id` FK by 123. Member-readable (`109:257-258`, SELECT only). Broadcast on INSERT with a column-selected payload (`119:245-259`, trigger `119:396-414`).
- **`league_player_pool`** (`109:268-279`): `free_agent | on_waivers | rostered | locked_in_game`, `waivers_until`; the on_waivers ⇔ waivers_until CHECK from 113.
- **`roster_add_drop_internal`** — head of chain **`115:338`** (never replaced since): league row locked first (`115:410-414`, the one serialization point); manager-only (`115:416-426`); a drop goes `on_waivers` for `waiver_period_hours` unless `none_fcfs` / `fa_hold` (`115:540-551`); an add of an `on_waivers` player before `waivers_until` refuses naming M5 (`115:576-582`), after it he is FCFS (`115:583-588`, the Q33 interim); caps counted from `complete` rows carrying `payload.add_player_id` (`115:478-479`, `:615-630`); E32 both sides (`115:528-535`, `:601-606`); lineup interplay removes a dropped player's key and benches an add (`115:673-730`); one `transactions` row (`115:818-819`).
- **Commissioner spine:** `commissioner_actions` (`123:275`), `log_commissioner_action_internal` (`123:417-453`), the seven-part verb template **D336**; reason optional everywhere since 131 (Q66). `commish_force_add_drop` / `commish_move_player` already bypass waivers and locks (`127:1565-1606`).
- **Settings:** Zod catalog `src/lib/leagues/settings/league-settings.ts:398-425`; `waiver_type`, `faab_budget`, `trade_review`, `trade_deadline_week` are typed columns (`:747-750`), the rest live in the `settings` blob; `waiver_process_time` is HH:MM **ET** (`:36-38`, D60). Every waiver/trade knob is FREE to change in-season (`129:193-194`, carried by 141). **No SQL reads `bench_lock`, `faab_min_bid`, `faab_tiebreaker`, `waiver_process_*` or any `trade_*` knob** except 129/141's setting verb.
- **Week clock:** `nfl_weeks.last_game_ends_at` is the lock release (Q34(B)); Q50's Tuesday 00:00 PT **floor** is built (`src/lib/leagues/time/release-floor.ts`), the Wednesday 00:00 PT **ceiling is not** (F333).
- **Cron vehicle:** in-database functions on pg_cron (`116:1339-1349` — `lineup-lock` every minute, `league-week-advance`, `finalize-matchups`); `draft_tick`'s SKIP LOCKED batch pattern (`068:1265`). No external call is needed for waivers or trades, so no route + ping.
- **Order sources:** `league_standings` (`118:879`, total order incl. seeded coin flip); `drafts.draft_order` / `nomination_order` (`065:115-116`) for reverse draft order.
- **Kill-switch store:** `system_flags` (`122:99`), already used by `autopilot_disabled`.

### 2.3 FAAB — the one money-shaped defect already on `main`
`league_members.faab_balance` (`052:71`, no CHECK) is seeded on join. Spec §12.2's v2.8.7 note (`spec:897`) says balances **track the budget until the draft starts** — *"nothing spends FAAB before `in_season`"*. But the seat-fill paths re-seed the balance to the full budget **with no status gate**: takeover (`120:443-448`), vacate (`120:645-649`), `leave_league` (`063:1061-1065`), and the seat-claim / assign helper `seat_league_member_internal` (`077:368`, re-seed at `:425-431`). Retire-and-succeed correctly carries it (`120:89`, `:560-569`), and an in-season budget change correctly leaves balances alone (`141:396-405`). **Vacuous today** (nothing spends FAAB) — **live the moment L.D2.9 lands**: an orphaned team that spent $60 would be handed a fresh $100 on takeover. Filed as **C72**; fixed by **L.D2.6** before the processor ships. Not a question — the spec's own note and E49 / §10.1's "takeover (successor inherits the franchise)" already decide it.

---

## 3. Design decisions (Architect; **TD1–TD16** — they enter PROGRESS §4 as D-numbers at merge, measured then (L.E1.27 may take the next D first))

- **TD1 — Two lanes, ONE schema lane.** Waivers and trades share `transactions`, the pool, the lineup interplay and the league-row lock; migrations serialize in merge order. Trades may build in parallel with waivers only in their TS/UI tasks.
- **TD2 — FAAB stays where the spec puts it** (`league_members.faab_balance`, §12.10 note) — one row per seat, which is why it carries through retire-and-succeed. M5 adds `CHECK (faab_balance IS NULL OR faab_balance >= 0)`. **No new ledger table:** every balance change writes a receipt with `faab_before` / `faab_after` — a `transactions` row for a won claim or a trade leg, a `commissioner_actions` row for an edit. The ledger invariant (sim + property test): *balance at draft start − Σ won bids ± Σ trade legs + Σ commissioner deltas = balance now*.
- **TD3 — Blind means blind, after processing too.** Only a **won** claim writes a `transactions` row (member-visible, carries the winning bid). Lost / invalid / cancelled claims write **no** `transactions` row; their outcome and reason live on the `waiver_claims` row (owner + commissioners only) and in the owner's notification. `waiver_claims` gets **no** broadcast trigger. (The losing manager sees the winning amount — it is public in the won row — per §16.5.2:1941 "outbid amount".)
- **TD4 — Writes through RPCs only.** `waiver_claims`, `trades`, `trade_items`, votes: SELECT policies only, keyed on **membership truth** (`league_members.team_id`), never the legacy `teams.owner_id`. Spec §12.10's "Own claims write FOR ALL" policy is **not** built — the F18 precedent (112:305-308 dropped the same owner-keyed FOR ALL on `team_lineups`). Erratum **C73**, folded by L.D2.5. This is a tightening, never a loosening.
- **TD5 — The commissioner can do anything a manager can, on any team** (PROGRESS §3 standing rule (a)). Every manager verb here (submit / cancel / reorder a claim; propose / respond / vote) accepts a commissioner acting for any team, writes ONE `commissioner_actions` row with `acting_as_team_id`, reason optional — the `set_lineup` commissioner-arm shape. Validity rules (exclusivity, roster legality, balance ≥ 0) bind him too (standing rule (i)); timing rules (deadline, review period, waiver schedule) do not — that is what `commish_force_*` and `commish_move_player` are for.
- **TD6 — The processor is in-database and ticks every minute.** `waiver_tick(p_now)` on pg_cron claims leagues whose `waiver_next_run_at ≤ p_now` with `FOR UPDATE SKIP LOCKED` (the `draft_tick` shape), and runs `process_waivers_internal(league, p_at)` per league in its own transaction, locking the league row first (so it serializes with add/drop at `115:410-414`). A `system_flags` **`waivers_paused`** kill switch is read and named in the tick's report — the first M8 knob, free here.
- **TD7 — One reference resolver, two implementations.** The resolution rules (Q71/Q72/Q73/Q74) are written ONCE as a pure TS function (`resolveWaiverRun`) with fast-check properties, and the SQL processor is proven equal to it on random claim sets (the M3 solvency-property precedent, `auction-solvency-property-db.test.ts`). The delivery plan's "deterministic FAAB tiebreak property tests" are these.
- **TD8 — Waiver priority lives on the seat:** `league_members.waiver_priority INTEGER` (1 = first), carried with the seat like FAAB; seeded lazily at the first run from Q72's order. `reverse_standings` computes its order at run time from `league_standings`, so a stat correction that changes standings (E44) changes the next run's order with no extra machinery.
- **TD9 — What a claim's `transactions` row carries.** `type = 'waiver_claim'`, `status = 'complete'`, `payload.add_player_id` / `drop_player_id` (the F227(a) contract — 115's caps count it), `faab_bid`, `faab_before/after`, `claim_id`, `run_at`, `week`. A **trade's** payload deliberately carries **no** `add_player_id` key, so trades never count against acquisition caps (the incumbent norm).
- **TD10 — Traded and claimed players land on the bench;** dropped / traded-away players leave every `team_lineups.slot_map` from the current week on (115:673-730's interplay, copied not re-derived). No M5 verb calls `lineup_fit_internal`, so **F350 stays unowned** (127's reasoning, D358(10)).
- **TD11 — Trades obey the same game-day lock as add/drop** (Q34(B)): a player who has kicked off cannot change rosters until the week's last game ends. `trade_lock_behavior = defer` waits for that moment for ALL players in the trade together; `reject` fails it by name. (Q75 confirms the reading of E35's "live".)
- **TD12 — E37 is trigger-driven, the tick is the backstop.** An `AFTER DELETE OR UPDATE OF team_id` trigger on `league_rosters` marks any pending trade naming that (player, from-team) `invalid` with a reason and notifies both managers — immediate, and it covers every roster writer (add/drop, claims, trades, 127's commissioner verbs) without replacing any of them. `trade_tick` re-validates everything else each minute (FAAB leg no longer affordable, E47's manager change, deadline) and execution re-validates once more — never a silent failure at execute time.
- **TD13 — Drops for uneven trades are part of the trade** (E36): proposer names his drops at proposal, the recipient at acceptance; they execute atomically with the swap and follow the schedule (TD14) like any drop.
- **TD14 — Pending the Q70 ruling, the waiver-schedule model proposed (F229's investigation):** a league's week has **waiver runs** at set local times, and **free-agency windows** in which every unowned, unlocked player is an instant pickup. Outside a window every unowned player is claim-only and settles at the next run. Dropped players are on waivers until the next run. Everything is evaluated in the league's own IANA zone (§16.4:1915 — replacing D60's fixed "ET"). Chris's two leagues become presets. `waiver_process_day` / `waiver_process_time` / `waiver_period_hours` / `free_agency` are replaced by the new keys (old keys migrated to the nearest preset; nothing strands). The full shape is in Q70; nothing is built until he rules.
- **TD15 — The week ceiling releases LOCKS only.** Pending Q78: at Wednesday 00:00 PT the pool lock helper treats the week as released even if a game is unplayed — a sibling read to `release-floor.ts`, NOT a stamp on `last_game_ends_at` (which also drives `league_week_advance` and scoring and must keep meaning "the games are over").
- **TD16 — Notifications are in-app rows** (`notifications`, 001:540) written inside the verb's transaction: claim won / lost / failed (owner only), trade proposed / accepted / vetoed / executed / invalid / expired (both managers), commissioner actions affecting a team (that manager). Executed trades and commissioner actions also post the non-disableable `league_chat` system line (§10.3).

---

## 4. Standing rules for every M5 task

1. **Spec first.** Every deviation or ruling folds into the spec changelog in the same PR. The spec wins; ambiguity → STOP, file in plain terms (PROGRESS §3).
2. **Server-authoritative.** Clients never decide a claim, a price, a balance, an order, a lock or an execution. `SECURITY DEFINER SET search_path = ''`, auth re-checked in-body, the league row locked before validation, `action_id` idempotency on every client-triggered mutation (replay returns the stored result byte-identically).
3. **Time only through `p_at` / `p_now`** (the TimeProvider rule); the DEFINER wrapper passes `now()`. No `Date.now()` in `src/lib/leagues/**`.
4. **CREATE OR REPLACE against the HEAD of the chain** (`grep -n "FUNCTION <name>" supabase/migrations/*.sql | tail -1`) — never the deployed body (CLAUDE.md, migration 073's lesson).
5. **Loud, never "nothing happened".** A run that resolves zero claims says why (no pending claims / league paused / not due); a 0-row write asserts its reason; every read of a large set pages past 1000 rows.
6. **Exclusivity and balance are asserted, not trusted:** after any write, the player is on exactly one roster (or none) and the balance is ≥ 0 — RAISE if not.
7. **Commissioner arms follow D336** (ledger, one audit row inside the no-op guard, system post, triple-REVOKEd internal); a no-op writes no receipt (standing rule (b)).
8. **FULL-rigour tasks** add: pgTAP per role (anon / non-member / member / owner / commissioner) incl. the blind-bid negative tests (E13), a break probe shown red then green, and a re-review until clean. **ONE-PASS tasks**: one review, nits filed.
9. **Migration discipline:** `npx supabase migration new`, typegen committed, never a hand-applied SQL; pushed to production only via `db push`.
10. **Design:** UI tasks restyle in the new design language (single theme, tokens, elevation only on hover / true overlays); no new shared component without approval — extend `src/components/ui/` variants.

---

## 5. Interface sketches (names contractual; Builder finalizes fields)

**Tables (new):**
- `waiver_claims` — §12.10 as printed **plus** `action_id UUID` (UNIQUE per league), `result_reason TEXT` (`outbid` / `drop_locked` / `add_locked` / `drop_gone` / `roster_full` / `insufficient_faab` / `cap_reached` / `already_claimed` …), `created_by UUID`; status `pending|won|lost|invalid|cancelled`. SELECT: own team (membership) or commissioner. No write policy.
- `trades` — §12.11 **plus** status `invalid` and `expired`, `status_reason TEXT`, `accepted_at`, `execute_after TIMESTAMPTZ` (defer), `proposed_by UUID`, `action_id`. `trade_items` as printed. `trade_drops(trade_id, team_id, player_id)` (TD13). `trade_votes(trade_id, team_id, vote, voted_at)` (only if Q77 keeps league vote). SELECT: league members (votes: see Q77). No write policy. Broadcast trigger on `trades` (member-visible columns only).
- Columns: `league_members.waiver_priority INTEGER`; `leagues.waiver_next_run_at TIMESTAMPTZ` (+ the Q70 schedule keys in the settings blob); `CHECK (faab_balance >= 0)`.

**RPCs (manager verbs carry the TD5 commissioner arm):**
`waiver_claim_submit(league, team, add, drop?, bid, action_id)` · `waiver_claim_cancel(claim, action_id)` · `waiver_claim_reorder(team, ordered_claim_ids, action_id)` · `process_waivers_internal(league, p_at)` + `waiver_tick(p_now)` · `commish_edit_faab(league, team, balance, reason?, action_id)` · `trade_propose(league, from_team, to_team, items, drops, note?, action_id)` · `trade_respond(trade, op ∈ accept|reject|cancel, drops?, action_id)` · `trade_vote(trade, team, vote, action_id)` · `trade_execute_internal(trade, p_at)` + `trade_tick(p_now)` · `commish_force_or_reverse_trade(trade, op ∈ approve|veto|force|reverse, reason?, action_id)`.

**Routes (§15.3 / §15.4):** `POST|GET /api/leagues/[id]/waivers` (submit / my pending), `PATCH|DELETE /api/leagues/[id]/waivers/[cid]` (reorder / cancel) · `POST|GET /api/leagues/[id]/trades`, `PATCH /api/leagues/[id]/trades/[tid]` (accept / reject / cancel / vote) · `POST /api/leagues/[id]/commish/faab` · `POST /api/leagues/[id]/commish/trade`. Error mapping per the in-season family (`inseason-errors.ts` — 42501→403, P0001→409, 22023→400, refusal text verbatim).

**Hooks:** `useWaiverClaims`, `useSubmitClaim`, `useTrades`, `useTradeAction`, `useCommishFaab`, `useCommishTrade` (one hook per file, React Query; optimistic only for claim reorder).

---

## 6. Task list

### L.D2.4 — Spec fold-back of the M5 rulings + ledger transcription (DOCS ONLY) · ONE PASS
- **Blocked by:** the Q70–Q79 answers (fold whichever are ruled; re-run for late ones). **Depends:** this breakdown merged.
- **Scope:** fold each ruling into the spec with a changelog entry — §7.3.4 (the schedule keys per Q70, `bench_lock` per Q73), §7.3.5 (deadline per Q76, vote per Q77), §13.1–13.3, §14's two job rows, E33/E34/E35/E37; the §12.10 / §12.11 errata C73–C77 (§10); transcribe TD1–TD16 into PROGRESS §4 as D-numbers; set F229 / F239 / F333 / F211 statuses per §10.
- **Files:** `docs/specs/spec-redraft-leagues.md`, `docs/specs/PROGRESS-leagues.md`.
- **Acceptance:** every ruled Q marked ✅ with Chris's words verbatim; no spec sentence contradicts a ruling; version bumped.

### L.D2.5 — Migration: `waiver_claims` + claim verbs + FAAB guards · **FULL** (permissions, blind bids, money)
- **Blocked by:** nothing. **Depends:** this breakdown merged.
- **Scope:** the `waiver_claims` table (§5) with membership-keyed SELECT, no write policy; `CHECK (faab_balance >= 0)` (assert no existing row violates it first); `league_members.waiver_priority`; `waiver_claim_submit` / `_cancel` / `_reorder` with the TD5 arm. Submit refuses by name: league not in season / playoffs; `waiver_type = none_fcfs`; add player already rostered in this league (friendly, never a raw 23505); drop player not on this team; bid < `faab_min_bid` or > current balance or non-zero under a priority type; an identical pending claim. Lock and schedule checks are the processor's (L.D2.9) — submit does not guess them.
- **Files:** `supabase/migrations/<next>_waiver_claims.sql`, `supabase/tests/<next>_waiver_claims.sql`, `src/types/database.ts`.
- **Acceptance:** a manager submits / cancels / reorders his own claims; a commissioner does it for any team with one audit row; replay by `action_id` is byte-identical.
- **Proofs:** pgTAP — **E13 per role**: anon, non-member, other member (sees NO claim, not even a count), owner (sees own), commissioner (sees all); every refusal by name; the CHECK refuses a negative balance at the owner role; break probe: widen the SELECT policy to `is_league_member` ⇒ the other-member cell reds.

### L.D2.6 — Migration: FAAB carries with the seat once the draft has started (C72) · **FULL** (money)
- **Blocked by:** nothing. **Depends:** L.D2.5 (for the CHECK).
- **Scope:** takeover, vacate, leave and the seat-claim / assign helper stop re-seeding `faab_balance` when the league is past `drafting` (they keep re-seeding before, per spec:897). Replace each against the HEAD of its chain (`remove_manager` head `120:222`; `seat_league_member_internal` head `077:368`; `leave_league` head `063:982` — re-measure each with `grep -n "FUNCTION <name>"` at task time). Spec §12.2 note gets a one-line clarification.
- **Acceptance:** a team that spent $60 of $100 keeps $40 through takeover, vacate + re-claim, leave + re-claim, and retire-and-succeed; preseason behaviour unchanged.
- **Proofs:** pgTAP — each path in `in_season` keeps the balance, each in `setup` re-seeds; the existing 120 / 062 / 063 suites stay green unmodified except where they pinned the in-season re-seed (named in the PR).

### L.D2.7 — Migration: the waiver schedule (F229) + the add path it changes · **FULL** (who may add a player, when)
- **Blocked by:** **Q70.** **Depends:** L.D2.4 (the schedule fold-back), L.D2.5; **L.E1.27 merged** (its migration is the head of `commish_change_setting_internal`).
- **Scope:** the ruled schedule keys in the Zod catalog + league-settings validator + DB round-trip; `leagues.waiver_next_run_at` and a pure next-run function (TS twin + SQL, same zone arithmetic as `release-floor.ts`, one implementation of the Pacific/IANA math); post-draft waiver state per the ruling; `roster_add_drop_internal` replaced against **115:338**: the add path refuses a claim-only player by name (naming the next run) and allows an instant pickup inside a free-agency window; a drop's destination follows the ruling; **F240**'s refusal text fixed in the same hunk; `commish_change_setting`'s key whitelist learns the new keys (against L.E1.27's head).
- **Files:** migration + pgTAP, `src/lib/leagues/settings/league-settings.ts` (+ test), a new `src/lib/leagues/time/waiver-schedule.ts` (+ test), typegen.
- **Acceptance:** both of Chris's leagues (§11 Q70) configured as presets behave exactly as he described across a simulated week, including the DST fall-back week (2026-11-01).
- **Proofs:** TS unit table for next-run across zones / DST; pgTAP: add refused one second before a window opens, allowed at the instant; existing 061/063 re-cut only where the interim Q33 behaviour is replaced (named).

### L.D2.8 — The reference resolver (TS, pure) + property tests · **FULL** (money, exclusivity)
- **Blocked by:** **Q71, Q72, Q73, Q74.** **Depends:** nothing in code (can run beside L.D2.7).
- **Scope:** `src/lib/leagues/waivers/resolve-waiver-run.ts` — input: claims, rosters, balances, priorities / standings order, lock facts, settings; output: per-claim outcome + reason, balance deltas, new priorities, roster moves. FAAB and both priority types; `claim_order` per Q71; tiebreak per `faab_tiebreaker` + Q72's fallback; E33 per Q73; locked adds per Q74; caps; roster capacity.
- **Proofs (fast-check, seeded, ≥ 1,000 runs each):** determinism (same input + seed → identical output); **exclusivity** (no player awarded twice, never to a team that already rosters him); **balance ≥ 0** after every award; **highest bid wins each contested player** (or the Q71-ruled rule, stated as a property); losers' balances unchanged; E7 (equal top bids resolve by the tiebreaker, and flipping standings flips the winner); priority rotation (rolling: a winner moves to the back, non-winners keep relative order).

### L.D2.9 — Migration: the `process-waivers` processor + `waiver_tick` · **FULL** (money, exclusivity)
- **Blocked by:** Q70–Q74 (through its dependencies). **Depends:** L.D2.5, L.D2.6, L.D2.7, L.D2.8.
- **Scope:** `process_waivers_internal(league, p_at)` implementing L.D2.8's rules in SQL; `waiver_tick(p_now)` on pg_cron every minute (TD6) with the `waivers_paused` kill switch; per won claim: roster + pool + lineup interplay (TD10), balance decrement, one `transactions` row (TD9), `waiver_priority` update; per lost / invalid claim: status + reason + owner notification, no `transactions` row (TD3); `waiver_next_run_at` advanced; F227(a) contract honoured.
- **Acceptance:** a due league processes exactly once even with two ticks racing; a league with nothing pending reports why; a run of 12 teams × 10 claims holds the league lock < 50 ms of validation per claim (§8.3 held-lock budget, measured, stated).
- **Proofs:** pgTAP — E7, E8 (claim vs. add/drop race on the same player — one wins, the other refuses cleanly), E33 (or its ruled replacement), blind-bid privacy after processing (TD3: a lost bid is visible to nobody but owner + commissioners), SKIP LOCKED double-tick; **DB property test** `waivers-resolver-parity-db.test.ts`: random claim sets through SQL == `resolveWaiverRun` byte-for-byte; break probe: reverse the tiebreak ⇒ the parity test reds.

### L.D2.10 — Migration: the week ceiling releases locks (F333) · **FULL** (locks)
- **Blocked by:** **Q78.** **Depends:** L.D2.7 (same lock helper chain).
- **Scope:** Wednesday 00:00 PT (as people experience it — Q50(a)) added beside the floor in `release-floor.ts`; the pool lock helpers (`pool_game_lock_internal` / `_any_internal`, head **115:225 / :283**) treat a week past its ceiling as released even with a game unfinished; the tick / pool view follow (TD15). `last_game_ends_at`, `league_week_advance`, finalization and scoring are untouched.
- **Proofs:** pgTAP at ceiling −1 s (locked) / at the instant (released) across the DST week; a control week with all games final releases at the floor as today.

### L.D2.11 — Migration: `commish_edit_faab` (D352 / F340) · **FULL** (money, permissions)
- **Blocked by:** nothing. **Depends:** L.D2.5.
- **Scope:** D336 template, `target_type = 'team'`; sets a seat's balance to any integer ≥ 0 (above the budget allowed — it is a repair tool); no-op writes no receipt; before / after in the audit row; system post; the affected manager notified.
- **Proofs:** pgTAP — manager refused (no-leak 42501), commissioner and co-commissioner allowed, no-op leaves `commissioner_actions` and `league_chat` counts unchanged, negative refused by the CHECK, replay byte-identical.

### L.D2.12 — API + hooks: waivers, FAAB, commissioner FAAB · ONE PASS
- **Blocked by:** nothing beyond deps. **Depends:** L.D2.5, L.D2.11 (L.D2.9 for result reads).
- **Scope:** §5's waiver routes + `/commish/faab`, Zod-validated, thin over the RPCs; `action_id` minted per submit and reused on retry; FAAB balance + waiver priority exposed on the rosters / teams / standings reads; activity-service renders `waiver_claim` rows (already in `TRANSACTION_TYPES`, `activity-service.ts:82-89`).
- **Proofs:** `*-api-db.test.ts` for each route incl. the non-member 404 and the blind-bid read (another member's GET returns only his own claims).

### L.D2.13 — UI: claim flow, claims panel, FAAB surfaces, schedule settings · ONE PASS
- **Blocked by:** Q70 for the schedule copy and settings form only. **Depends:** L.D2.12, L.D2.7.
- **Scope:** players page — Claim (FAAB bid modal or priority claim, optional drop) beside Add, with the next run time in the viewer's zone; `waiver-claims-panel` (reorder by drag, edit bid, cancel; won / lost / failed with reason); FAAB balance on team page + standings; league home waiver chip replaces `WAIVERS_LATER_COPY` with the real next run; the schedule presets in the settings panel + create wizard; commissioner FAAB edit inside override mode. States: empty, loading, error, locked 🔒 rows, `fa_hold` chip, paused-waivers banner.
- **Proofs:** render tests for each state; ops tests for the copy builders.

### L.D3.2 — Migration: trade tables + propose / reject / cancel / accept · **FULL** (exclusivity, permissions)
- **Blocked by:** nothing. **Depends:** L.D2.5 (schema lane order only).
- **Scope:** `trades`, `trade_items`, `trade_drops` (§5), member SELECT, broadcast trigger; `trade_propose` validates both rosters legal after the swap incl. drops (E36), every player on the named team, FAAB legs only when `allow_faab_in_trades` and ≤ balance, `allow_future_considerations` → note only; `trade_respond` accept (recipient picks drops) / reject / cancel (proposer) / **counter** = reject + a new proposal linked by `countered_from`; accepted trades wait in `accepted` for L.D3.3's executor; the TD12 invalidation trigger on `league_rosters`; notifications both ways; TD5 commissioner arm.
- **Proofs:** pgTAP — roster-overflow refused without drops, accepted with them; a proposal naming a player since dropped goes `invalid` the instant the roster row leaves (E37); non-party member cannot respond; commissioner can act for either side with one audit row each.

### L.D3.3 — Migration: execution, review (none / commissioner), deadline, lock behaviour · **FULL** (exclusivity, rosters)
- **Blocked by:** **Q75, Q76.** **Depends:** L.D3.2, L.D2.7 (drop destination follows the schedule).
- **Scope:** `trade_execute_internal` — league row lock, re-validate everything, atomic swap in `league_rosters`, drops, FAAB legs, lineup interplay (TD10), pool mirror, one `transactions` row (`type='trade'`, no `add_player_id` — TD9), system post, notifications; review: `none` → execute at accept, `commissioner` → `in_review` until approved / vetoed or `trade_review_period_hours` elapses (auto-approve, §13.3); `trade_tick(p_now)` every minute: expire review windows, run deferred trades at their lock-free moment (TD11), expire proposals at the deadline, E47 rescind when a party's manager changed, re-check FAAB affordability.
- **Proofs:** pgTAP — E35 both behaviours (defer executes at the release instant, reject fails by name), E36, E37 at execute, E47, E8 (trade vs. claim on the same player), deadline ±1 s; exclusivity asserted after every execute; break probe: skip the re-validation ⇒ the E37-at-execute cell reds.

### L.D3.4 — Migration: league-vote review · **FULL** (permissions)
- **Blocked by:** **Q77.** **Depends:** L.D3.3.
- **Scope:** `trade_votes` + `trade_vote` per the ruling; veto when votes reach `trade_veto_votes`; otherwise execute when the review period ends; vote visibility per the ruling.
- **Proofs:** pgTAP — who may vote (ruled set), threshold ±1, vote change before the deadline, a party cannot vote on his own trade (if so ruled).

### L.D3.5 — Migration: `commish_force_or_reverse_trade` (D352 / F340, E11) · **FULL** (exclusivity, money, permissions)
- **Blocked by:** nothing beyond deps. **Depends:** L.D3.3.
- **Scope:** D336 template, `target_type = 'trade'`; ops: `approve` (skip the rest of review), `veto`, `force` (execute now, past review, deadline or lock — timing rules the commissioner stands outside, standing rule (i)), `reverse` (restore both rosters and FAAB legs atomically). **Reverse refuses by name** when any player is no longer on the roster the trade put him on (exclusivity is a validity rule — it binds him too); the refusal names the player and points at `commish_move_player`. Past weeks' lineups and scores are untouched.
- **Proofs:** pgTAP — E11 happy path, the refusal, FAAB legs restored, one audit row per op, no-op (veto a vetoed trade) writes nothing.

### L.D3.6 — API + hooks: trades + commissioner trade · ONE PASS
- **Depends:** L.D3.2, L.D3.3, L.D3.5 (L.D3.4 when it lands).
- **Scope:** §5's trade routes + `/commish/trade`; trade reads with status, reason, review countdown and (per Q77) tally.
- **Proofs:** `*-api-db.test.ts` per route incl. non-member and non-party refusals.

### L.D3.7 — UI: trade builder + trade center · ONE PASS *(split seam: builder / center, if it overruns)*
- **Blocked by:** Q77 for the vote UI only. **Depends:** L.D3.6.
- **Scope:** `/app/leagues/[leagueId]/trades` — pending / history tabs; the two-sided builder with a server legality preview (drops prompted when a roster overflows); pending cards (accept with drops, reject, cancel, counter); review state (commissioner approve / veto, vote tally); states: under-review countdown, deferred-until chip, vetoed / invalid / expired with reason, deadline-passed lock, locked 🔒 assets; "Propose trade" from a player row and the team page; league home trade chip replaces `TRADES_LATER_COPY`; commissioner force / reverse inside override mode.
- **Proofs:** render tests per state; ops tests for the legality-preview copy.

### L.D3.8 — Sim: transacting personas + the Ghost · ONE PASS (invariants must be shown non-vacuous)
- **Depends:** L.D2.9, L.D3.3 (L.D3.4 optional).
- **Scope:** season-sim personas that place claims, add/drop and trade through the real RPCs; the Ghost (F211 — vacate → orphan → seat claim → takeover, FAAB carried per L.D2.6); invariants: exclusivity, TD2's FAAB ledger equation, pool ⇔ roster mirror (now non-empty — F300), no claim visible to a non-owner. Discharges **F284(b), F300** and F211's Ghost arm.
- **Proofs:** each invariant reported with its non-zero population count; a break probe per invariant.

### L.D3.9 — E2E: waiver morning + trade lifecycle · ONE PASS
- **Depends:** L.D2.13, L.D3.7.
- **Scope:** Playwright: submit claims → run the tick at an injected instant through the harness's enumerated jobs → won / lost visible with reasons; a trade under each review mode (none, commissioner, vote if built) to execution; a deferred trade executing after the release. Take **F296** (the `set_lineup` lock refusal arm) if its fixture is cheap; otherwise state on the record that it stays pgTAP-only.

### L.D3.10 — THE M5 GATE (`npm run test:gate:m5`) · ONE PASS (runs FULL-rigour suites)
- **Depends:** everything above.
- **Scope:** `scripts/gate-m5.sh`: fresh `db reset` → full pgTAP → M5 vitest (resolver properties + parity) → sim season with transacting personas across the settings matrix (FAAB / rolling / reverse; each review mode) → the M5 E2E → `test:gate:m4`. Record the run in PROGRESS; flip M5's status row.

---

## 7. Dependency order — and what can start now

| Task | Depends on | Blocked by a question? |
|---|---|---|
| L.D2.4 spec fold-back | this breakdown merged | the rulings it folds (Q70–Q79) |
| L.D2.5 claims + verbs | this breakdown merged | — |
| L.D2.6 FAAB carries | L.D2.5 | — |
| L.D2.7 waiver schedule | L.D2.4, L.D2.5, **L.E1.27 merged** | **Q70** |
| L.D2.8 reference resolver (TS) | — | **Q71, Q72, Q73, Q74** |
| L.D2.9 processor + tick | L.D2.5, L.D2.6, L.D2.7, L.D2.8 | (through its deps) |
| L.D2.10 week ceiling | L.D2.7 | **Q78** |
| L.D2.11 `commish_edit_faab` | L.D2.5 | — |
| L.D2.12 waivers API + hooks | L.D2.5, L.D2.11 (L.D2.9 for results) | — |
| L.D2.13 waivers UI | L.D2.12, L.D2.7 | Q70 (schedule copy only) |
| L.D3.2 trades core | L.D2.5 (lane order) | — |
| L.D3.3 execute + review + deadline + locks | L.D3.2, L.D2.7 | **Q75, Q76** |
| L.D3.4 league vote | L.D3.3 | **Q77** |
| L.D3.5 commish force / reverse | L.D3.3 | — |
| L.D3.6 trades API + hooks | L.D3.2, L.D3.3, L.D3.5 | — |
| L.D3.7 trades UI | L.D3.6 | Q77 (vote UI only) |
| L.D3.8 sim personas + Ghost | L.D2.9, L.D3.3 | — |
| L.D3.9 E2E | L.D2.13, L.D3.7 | — |
| L.D3.10 M5 gate | all of the above | — |

**Startable on merge with no answer:** L.D2.5, L.D2.6, L.D2.11, L.D2.12 and L.D3.2 (then L.D3.5 / L.D3.6 once L.D3.3 exists). Suggested loop order: **L.D2.5 → L.D2.6 → L.D2.11 → L.D3.2 → L.D2.12**, then whichever blocked task's question is answered first. L.D2.7 also waits for **L.E1.27** to merge (it replaces the setting verb after it).

---

## 8. Migration / pgTAP numbering

**Measure at build time (D161)** — `ls supabase/migrations | tail -1` and `ls supabase/tests | tail -1` immediately before `npx supabase migration new`. Heads on `main` today are **143 / 091**; L.E1.27 (in flight) takes the next pair, so M5's first migration is **not before 145 / 093**. This doc reserves **no** numbers. Schema-lane order (one lane, merge order wins): L.D2.5 → L.D2.6 → L.D2.11 → L.D3.2 → L.D2.7 → L.D2.9 → L.D2.10 → L.D3.3 → L.D3.4 → L.D3.5. Every migration: `IF NOT EXISTS` guards, RLS + policies in the same file as the table, indexes for policy / join FKs, typegen committed, pushed to production only via `db push`.

---

## 9. Exit criteria → proof map

| Exit criterion (§1) | Proven by |
|---|---|
| 1. Claims process on schedule; a trade completes under each review mode | L.D2.9 pgTAP + L.D3.3 / L.D3.4 pgTAP; L.D3.9 E2E; L.D3.10 sim matrix |
| 2. Deterministic FAAB tiebreak property tests | L.D2.8 properties + L.D2.9 SQL ⇔ TS parity |
| 3. E32–E37 (+ E7, E8, E11, E13, E47, E49-FAAB) | E32: M4's 061/063 + E2E · E33/E34: L.D2.9 (per Q73) · E35–E37, E47: L.D3.3 · E36: L.D3.2/L.D3.3 · E7/E8: L.D2.8/L.D2.9 · E11: L.D3.5 · E13: L.D2.5/L.D2.9 · E49 FAAB: L.D2.6 |
| 4. Continuity | L.D3.10 runs `test:gate:m4` last |

---

## 10. Conflict report & ledger dispositions

**Conflicts (spec vs code / spec vs itself) — each folded by the task named:**

| # | Conflict | Resolution | Task |
|---|---|---|---|
| **C72** | Seat-fill paths re-seed `faab_balance` in-season (§2.3) vs spec:897 "track the budget until the draft starts" + E49 + §10.1 takeover "inherits the franchise" | Carry after the draft starts | L.D2.6 |
| **C73** | §12.10 prints an owner-keyed `FOR ALL` write policy on `waiver_claims` (legacy `teams.owner_id` keying) | SELECT-only, membership-keyed; writes via RPC (TD4, F18 precedent) | L.D2.5 |
| **C74** | §12.11 `trades.status` has no `invalid` / `expired`, yet E37 marks trades `invalid` | Add both + `status_reason` | L.D3.2 |
| **C75** | §7.3.4 / D60 store `waiver_process_time` as ET; §16.4:1915 says an explicit IANA zone chosen at creation | League IANA zone (TD14 / Q70) | L.D2.7 |
| **C76** | E35 says "while one included player's game is live"; Q34(B) locks a kicked-off player until the week's last game ends | Same lock as add/drop (TD11 / Q75) | L.D3.3 |
| **C77** | §13.2 "cascading claims (a team's 2nd claim only if 1st failed)" vs "highest bid wins each contested player" can disagree (Q71's example) | Per Q71 | L.D2.8 |
| **C78** | §14 `process-waivers` prints pgmq + Edge Function; the house vehicle is in-DB pg_cron (D87 / D292) | In-DB tick (TD6) | L.D2.9 |

**Ledger rows (PROGRESS §6) — disposition:**
- **F229** (waiver-scheduling investigation) — investigation done here (TD14 + Q70); **discharged by L.D2.4** when Chris rules Q70.
- **F239** (`bench_lock` off) — asked as **Q73**; built by L.D2.8 / L.D2.9.
- **F333** (the Wednesday ceiling) — lock half **L.D2.10** (Q78); the unplayed-game half stays with Q37 / F243 / M8.
- **F340 / D352** (`commish_edit_faab`, `commish_force_or_reverse_trade`) — **L.D2.11**, **L.D3.5**.
- **F227(a)** (claim rows carry `add_player_id`) — L.D2.9 (TD9). Its `continuous` half is superseded by Q70.
- **F240** (115's refusal text) — rides L.D2.7's replacement of `roster_add_drop_internal`.
- **F211** — Ghost: **L.D3.8**. Swap spots + `auto_sub_inactives` (and C56's inactives-feed warning): **not M5** — Q79.
- **F284(b), F300** — **L.D3.8**. **F296** — L.D3.9, if cheap.
- **F350** — stays unowned: no M5 verb calls `lineup_fit_internal` (TD10).
- **F373** — untouched: the M5 sim injects no commissioner override with a knock-on.

---

## 11. Open questions for Chris (filed as PROGRESS §3 Q70–Q79)

Each names the tasks it blocks; everything else can start without it.

**Q70 — How do waivers run in your leagues? (the F229 investigation) — blocks L.D2.4 (schedule part), L.D2.7, L.D2.9, L.D2.13's schedule copy.**
You described two leagues: (1) waivers run every day at 9:00 AM Pacific until Sunday 6:00 AM, then instant-pickup free agency until Monday night's last game ends; (2) waivers run once, Tuesday at midnight, then instant pickup for the rest of the week. Proposed model — a league picks: **(a) when waivers run** (one or more days at one local time, in the league's own time zone), and **(b) when free agency is open** (instant pickup for any unowned player whose game hasn't started — e.g. "Sunday 6:00 AM until the week's last game ends", or "from the waiver run until the week's last game ends"). Outside free agency every unowned player is claim-only until the next run. Your two leagues become two presets; a third preset is "no waivers, always free agency". Three details to confirm, with my recommendation for each:
- **A player dropped on Friday** (league 2) — on waivers until the next run (Tuesday), or instant pickup? *Recommend: on waivers until the next run* — the spec's default today (a dropped player goes on waivers).
- **Right after the draft,** are undrafted players on waivers until the first run, or instant pickups? *Recommend: on waivers until the first run* (what the major apps do after a draft).
- **When the week ends** (Monday night), do all unowned players go back to claim-only until the next run? *Recommend: yes* — that is what makes league 1's Tuesday-morning run meaningful.

**Q71 — Can a team win more than one player in the same waiver run, and does "biggest bid wins" beat a manager's own ranking? — blocks L.D2.8, L.D2.9.**
Example: Team A bids $5 on Player X as its only claim. Team B ranks its claims #1 Player Y ($3), #2 Player X ($50). Option (1): **the highest bid on a player always wins that player** — B gets X for $50 (and Y too, if nobody else wants him); a team's own ranking only settles its own collisions (two claims dropping the same player, or not enough budget left for both). Option (2): **strict ranking** — B's #2 isn't looked at until B's #1 is settled, which can hand X to A for $5 although B bid $50. *Recommend (1)*, and yes, a team can win several players in one run as long as each claim is still valid when its turn comes.

**Q72 — Before there are standings, who gets first waiver priority? — blocks L.D2.8, L.D2.9.**
Example: Week 1's run, two teams bid the same $12 on the same player (or a league uses rolling priority). *Recommend:* **reverse draft order** (last pick in round 1 gets first priority) until the first week is final; after that, reverse standings or the rolling order as the league chose. Rolling priority starts from reverse draft order and only changes when a team wins a claim (winner moves to the back).

**Q73 — A waiver claim that drops a player who already played this week: go through or fail? (F239) — blocks L.D2.8, L.D2.9.**
Example: a claim "add Player A, drop Player B" is set Wednesday; B plays Thursday night; claims run Friday. Today there is a league setting (`bench_lock`, on by default): on = the claim fails, no FAAB spent, the manager is told why; off = it goes through and B's Thursday points still count. You ruled that a player who has kicked off can't be dropped until the week's last game ends. *Recommend: remove the setting — the claim always fails, the same rule as a manual drop* (the "off" position is the do-over you closed on 2026-09-05).

**Q74 — Claims on a player whose game has already started — blocks L.D2.8, L.D2.9.**
Example (league 1, daily 9 AM runs): Player C played Thursday night, so he can't change teams until Monday night's last game ends. *Recommend:* **(i)** the app won't accept a new claim on C until then (same message as the pickup lock), and **(ii)** a claim placed Wednesday on C, still pending at Friday's run, **fails** with the reason and no FAAB spent — rather than silently waiting for a later run.

**Q75 — An accepted trade where one player already played this week — blocks L.D3.3.**
Example: Sunday morning a 2-for-2 trade is accepted; one player in it played Thursday night, the other three haven't played. Your rule: a player who has played can't change rosters until the week's last game ends. The league setting (`trade_lock_behavior`, default "defer") says: **wait**, and run the whole trade automatically right after Monday night's game — or, if the league chose "reject", fail it. *Recommend: confirm "defer" as the default and that the wait is until the week's last game ends* (not just while the game is on), with all players moving together; while it waits the players stay with their current teams and can be started by them.

**Q76 — What exactly does "trade deadline: week 11" mean? — blocks L.D3.3.**
*Recommend:* trades can be **proposed and accepted until week 12 begins** (Wednesday 00:00 ET, when the app moves to week 12); a trade **accepted before** the deadline still completes even if its review period or a game-lock wait ends after it; offers still pending at the deadline **expire** with a note to both managers. (The commissioner can still move players after the deadline with his own tools.)

**Q77 — League-vote trades: who votes, and when does the trade go through? — blocks L.D3.4 and the vote UI in L.D3.7.**
*Recommend:* every manager **except the two teams in the trade** may vote to veto; the trade is **vetoed as soon as veto votes reach the league's number** (default half the league, rounded up); otherwise it **goes through when the review period ends** (default 24 hours); a manager can change his vote until then; the tally (count only, not who voted) is shown to the league. (For "commissioner review" the spec already says the trade goes through if the commissioner does nothing by the end of the period — unchanged.)

**Q78 — If a Monday game is postponed past Tuesday night, do players unlock at Wednesday 00:00 Pacific anyway? (F333) — blocks L.D2.10.**
You ruled that the week closes by Wednesday 00:00 Pacific even if a game hasn't been played. *Recommend:* at that moment **every locked player unlocks and waivers run on schedule**; the unplayed game's points stay pending until it is played or the commissioner steps in (that part is the operator-tools milestone, not M5).

**Q79 — Two lineup helpers from the spec are still unbuilt: do you want them for the test cohort this season? (F211) — blocks nothing in M5.**
**Auto-sub** (a league setting, off by default): if a starter is ruled out before his game, the app swaps in a bench player at the same position. **Hot Swap spots** (default 0): a manager names a backup for one starter ahead of time and it fires automatically. Neither is part of waivers or trades. *Recommend: leave both out of M5*; if you want them this season, they become a small follow-up slice after M5 (its one open question — when a Hot Swap locks — is Q36).

> + **APPROVED 2026-09-27 by Chris — *"approve M5, all recommendations"*.** Every open question Q70–Q79 is ruled as recommended; nothing in §6 remains blocked on a Chris ruling. Process: the lighter pre-launch rule (Chris 2026-09-27) applies — FULL rigour for FAAB money, roster exclusivity, trades that move players, permissions; ONE PASS for UI/API/sim/docs; short ledger notes.

> + **AMENDMENT 2026-09-28 (orchestrator, Chris's F405 ruling — additive):**
>
> **L.D3.11 — Stored per-player points + the standard stat-correction window (F405) · FULL** *(migration + pgTAP + worker/box-score/reconcile changes)*. Chris: *"okay lets stay in line with standard platforms"*. **(a)** When the scoring worker scores a team's week, store each starter's points (league-scored, under the WEEK's rules — 144's `weekScoringRules`) alongside the team total; the box score for a scored week reads the STORED per-player points, so its lines always sum to the stored team score; a live week still shows live points. **(b)** Move the end of the stat-correction window from Thursday 06:00 ET to the **next league week's first kickoff** (measure where the window end is computed — `league_week_advance` / 116/118's correction-close — and the §7.3.6 row); a correction inside the window re-scores (unchanged behaviour); after it, the week is final and **locked**: later corrections update `player_stats` (research stays right) but never a locked week's stored per-player points, team scores, results or standings. **(c)** Reconcile: a locked week's drift check compares against the stored per-player points (no false nightly alerts after a late correction); F268's post-window downgrade folds into this. **(d)** Backfill: existing scored weeks get per-player points recomputed from current stats under the week's rules where the week is still open or in its window; locked weeks recompute once and are marked as backfilled (state what's recoverable). Full rigour: golden before/after (no stored team score moves), a late-correction end-to-end (inside the window ⇒ re-scored; after ⇒ locked, research updated, box score unchanged and still summing to the team score). Dependencies: none on M5 waivers/trades — can run whenever the schema lane is free.

