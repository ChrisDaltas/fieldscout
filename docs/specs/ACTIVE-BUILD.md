# Active build

> **This file decides what `/build-next` builds.** It is the single pointer the
> build loop reads before anything else. Change it here, and every future
> cycle — including an unattended `/loop /build-next` — follows.
>
> Exactly one build is active at a time. Pausing a milestone means pointing
> this file elsewhere; it does **not** mean editing that milestone's PROGRESS.

---

## Active: **Redraft Leagues M6 — Commissioner Console + Audit, and Stat Corrections** *(breakdown approved by Chris 2026-09-29 — "Approve and start"; PR #360)*

- **LAW:** `docs/specs/spec-redraft-leagues.md` (the version on main). **Task text:** `docs/specs/tasks-M6-commissioner-console.md` §6 (+ its APPROVED note — Q81 ruled no, Q82 per E43, **Q83 dropped: L.E1.35 is not built**, Q84–Q86 as recommended, Q87 a design choice). **Memory:** `docs/specs/PROGRESS-leagues.md`. **Task-id prefixes:** `L.E1.*` (from L.E1.28 — console, audit, backstop proof, gate) and `L.E2.*` (the stat-corrections pipeline and view).
- ~~**NEXT TAKEABLE TASK: `L.E1.28`**~~ *(built — docs only: the M6 rulings folded, spec v2.16.77; Q81–Q87 filed, Q47 answered; D433–D448; F272 / F302 closed, F510 filed)*
- **NEXT TAKEABLE TASK: `L.E2.1`** (in build in parallel), then **`L.E1.29`** when the local DB is free. Builders read the ruled form of the breakdown: spec v2.16.77 + PROGRESS D438 / D439 / D445 + **F510** (the breakdown sentences Q81 / Q83 superseded). **L.E2.1** is FULL — stat-correction events + detection + the daily re-poll of final weeks; it changes the production poll, so today's path stays as the pre-push fallback. **L.E1.29** is FULL — receipts for the draft-room controls. Schema tasks share the one local DB: one at a time.
- *(L.E2.1 built — migration 167 / pgTAP 115: `stat_correction_events` + `ingest_write_batch` (lines, events and queue in one transaction, F267); detection against the games stored before the poll; the daily 11:00Z re-poll of weeks locked within 7 days; the pre-167 two-call path kept as the named fallback; D432, F507–F509. **Push debt: 167** — Chris pushes it before L.E2.2's migration so the poll is on one path. The local DB is free: L.E1.29 next.)*
- **Process:** unchanged — the lighter pre-launch rule (Chris 2026-09-27): FULL rigour for scoring / standings / permissions / production writes; ONE PASS for UI / API / docs / e2e; no second re-review after a small fix round unless it touched scoring or permissions.
- *(L.E1.29 built — migration 168 / pgTAP 116: every draft-room control writes its `commissioner_actions` receipt through one seam (one row per real change, none for a no-op, a mock or the tick's start); a start names its no-manager seats (F45); D449, F40 / F45 discharged, F512–F514 filed — **F514: `set_lineup`'s commissioner arm still writes no receipt**, owned by L.E1.30. NEXT in the schema lane: L.E2.2 / L.E1.30 per the suggested order.)*
- *(L.E1.30 built — migration 169 / pgTAP 117: membership, invites and league setup write their `commissioner_actions` receipts through L.E1.29's seam (one row per real change, none for a no-op; the removal outcome, role changes and placeholder seat named; a settings or scoring save recorded per changed key in one row; an invite receipt names only the seat — never a token, email, username or code), and `set_lineup`'s commissioner arm writes its receipt acting for the team (F514); D450, F32 / F514 discharged, F515–F516 filed. NEXT in the schema lane: L.E2.2 / L.E1.31 per the suggested order.)*
- *(L.E1.31 built — migration 170 / pgTAP 118: the backstop proof. A census over every commissioner-gated database function (56: 52 write a receipt, 4 allowlisted with their reason), a matrix calling every commissioner verb for real (a change writes exactly one receipt, a no-op none), the manager-verb census (the commissioner does every manager act for any team — through the verb's own arm or override mode's twin; a trade vote is a manager's own ballot), and guards on the five columns that point at the log (only the receipt the same action just wrote). Ruling D451: a receipt names the team the commissioner acted for whenever he does one team's manager act — the override lineup, add / drop and rename now do too. D451, F513 / F515 discharged, F518–F523 filed (F521: the commissioner cannot bid or edit a queue for another team — a rule-(a) defect for its own task). NEXT in the schema lane: L.E2.2 per the suggested order.)*
- *(L.E1.38 built — migration 171 / pgTAP 119: F521, the commissioner's doors on the two draft-room manager verbs that refused him — `draft_place_bid` bids for a named team (every bid rule binding him), `draft_queue_replace` sets another team's Targets; one receipt acting for the team per real change, none for a no-op / a mock / his own seat. D452; F524 (the room's "acting as" controls) / F525 filed. NEXT in the schema lane: L.E2.2 per the suggested order.)*
- *(L.E2.2 built — migration 172 / pgTAP 120: each league's record of a stat correction (`league_stat_corrections` — one per team that STARTED the player, none for a bench player or a stat the league does not score), written by the scoring door in the SAME transaction as the re-score, with ONE league post and a notification only where a result changed (second game and median included); `matchups.result` still written only at finalization (F245); `applied_at` stamped; F476's immediate bracket sync; reconcile names the event (F268); F511's 6-hour settle grace in `ingestWeek` (TD2 amended — live at merge). **In plain words (R1347): a real stat fix that arrives within 6 hours of the week's last game being seen final re-scores the week silently — even if it flips a result — with no league post and no notification.** Fix round R1342–R1348: a correction is announced at most once. D453; F527–F531 filed. NEXT: L.E2.3 (ONE PASS, no migration) per the suggested order.)*
- *(L.E2.3 built — no migration: `GET /api/leagues/[id]/corrections?week=` lists the league's stat corrections that changed a score (Q81 — no "week final" label), each in plain words — the player, the stat, old → new, the team, his points and the team score before → after, and the result change once the games were over; members only; paged; a week with none says so; on a database without 172 a named 503. The activity feed tags the correction posts with their week; `useStatCorrections`. D454; F532 filed. NEXT: L.E2.4 (the corrections view) / L.E1.32 per the suggested order.)*
- *(L.E1.32 built — no migration: `GET …/commish/summary`, the console's "needs you" read for commissioners only — teams with no manager and autopilot off, trades waiting on the commissioner's review, and which of this week's matchups can be corrected now vs not yet (135's lock door, its sentence verbatim); each section says "unavailable" by name on a database without its object; no lineup-report or final-week-correction section (Q83 / Q81). `GET …/commish/log` gains `type` / `team_id` / `week`; `useCommishLog` pages with `fetchNextPage`; `useCommishSummary`. D455; F534–F535 filed. Nothing to push. NEXT: L.E1.33 (the console page) / L.E2.3 per the suggested order.)*
- *(L.E2.4 built — no migration: the league's stat-corrections view (`CorrectionsView`, on its own page `/app/leagues/[id]/corrections` until the Activity page mounts it as a tab — F536), linked from League Home's activity card and the matchup page's note when a correction changed a score or result; each correction in plain words ("Receiving yards 100 → 94"); the box score says where its points come from (F477); the settings page states "Stat fixes count until next week's first game" — the old Thursday option is gone (Q86 / F475); the list refreshes when the correction's league post lands (F527). No final-week state or commissioner door (Q81). D456. Nothing to push. NEXT: L.E1.33 / L.E1.34 per the suggested order.)*
- *(L.E1.33 built — no migration: the Commissioner Console at `/app/leagues/[id]/commish` — commissioners only, decided on the server (a manager is sent to the league page); the override switch, "Needs you", one door per kind of tool (each opening its screen with override mode on), the last five actions; the Commissioner door in the league nav and League Home; set result and reset draft confirm with before / after. D457; F535 discharged, F538–F539 filed (F539: after the draft no screen can change a team's manager — needs a task). Nothing to push. NEXT: L.E1.34 / L.E2.4 per the suggested order.)*
- *(L.E1.34 built — no migration: the Activity page at `/app/leagues/[id]/activity` — members only, decided on the server; tabs All · Adds & drops · Trades (Q84: went through / vetoed / reversed, one line each; the executed trade once) · Commissioner (by team and week, opened at an entry from any ✸) · Stat corrections (L.E2.4's view; `/corrections` redirects); every commissioner action and setting in words (TD12's census); League Home "See all activity"; the console's "See all". D459; F543–F545 filed. Nothing to push. NEXT: L.E1.36 / L.E2.5 per the suggested order.)*
- **Production:** at **171** (measured read-only 2026-09-30 10:18Z). Push debt: **172** (the correction records — until it is pushed the score worker writes every score exactly as today: a 158 door ignores the `corrections` element and the worker names that; the two new doors' absence is named and skipped; the settle grace is TS-only and applies from the merge).

---

## Closed: **Redraft Leagues M5 — Transactions (waivers / FAAB / trades)** *(breakdown approved by Chris 2026-09-27 — "approve M5, all recommendations"; PR #323)*

- **LAW:** `docs/specs/spec-redraft-leagues.md` (the version on main). **Task text:** `docs/specs/tasks-M5-transactions.md` §6 (+ its approval note). **Memory:** `docs/specs/PROGRESS-leagues.md` (Q70–Q79 ruled as recommended; D383, D384; F406–F409, F411). **Task-id prefixes:** `L.D2.*` (waivers / FAAB / free agency) and `L.D3.*` (trades).
- **Landed:** L.D2.5 (PR #325, migration 145 / pgTAP 093); L.D2.6 (migration 146 / pgTAP 094 — C72 fixed); L.D2.11 (migration 147 / pgTAP 095 — `commish_edit_faab`, F412's reset re-seed); L.D3.2 (migration 148 / pgTAP 096 — trade tables, propose / accept / reject / cancel / counter, the E37 trigger; F413 for L.D3.3); L.D2.12 (no migration — waiver claim routes + `/commish/faab` + hooks; FAAB balance / waiver priority on the rosters, standings and league-detail reads; D387); L.D2.8 (no migration — the pure TS resolver, D389); L.D2.4 (docs — the M5 rulings folded, v2.16.58); L.D2.7 (migration 149 / pgTAP 097 — the waiver schedule, D388); **L.D2.9 in review** (migration 150 / pgTAP 098 — the resolver re-cut to Chris's F422 rulings, the SQL twin, the processor + per-minute `waiver_tick`, `waiver_claim_edit`; D406).
- ~~**NEXT TAKEABLE TASK: `L.D2.10`**~~ *(built — migration 153 / pgTAP 101, the Wednesday ceiling releases every lock; F333 lock half + F424; D412)*
- *(L.D2.15 built — migration 154 / pgTAP 102: one starting slot per player per league-week (F441 + F445 + F442; D413). NEXT is unchanged.)*
- ~~**NEXT TAKEABLE TASK: `L.D2.13`**~~ *(built — the waivers UI, no migration; F425 / F432 / F443 discharged, F431 re-routed; D414)*
- ~~**NEXT TAKEABLE TASK: `L.D3.4`**~~ *(built — migration 155 / pgTAP 103, league-vote review; F430 / F435 discharged, F450 filed; D415)*
- ~~**NEXT TAKEABLE TASK: `L.D3.5`**~~ *(built — migration 156 / pgTAP 104, `commish_force_or_reverse_trade`; F436 + F340 discharged, F451 filed; D416)*
- ~~**NEXT TAKEABLE TASK: `L.D3.6`**~~ *(built — no migration: the trade routes + `/commish/trade` + hooks; F451 route half discharged, F452 filed; D417)*
- ~~**NEXT TAKEABLE TASK: `L.D3.7`**~~ *(built — no migration: the trade center + trade builder, the Trade / Propose trade doors, the League Home chip; F415 / F438 / F450 / F451 / F452 discharged, F462–F463 filed; D419)*
- ~~**NEXT TAKEABLE TASK: `L.D3.9`**~~ *(built — no migration, no product code: `e2e/transactions.spec.ts` — waiver morning, a trade per review mode, a deferred trade, F296 taken; D421; F471 filed: `inseason-week.spec.ts` is red on main since 143)*
- ~~**NEXT TAKEABLE TASK: `L.D3.10`**~~ *(built — `npm run test:gate:m5` GREEN end to end, 3,581 s, on 001–159; run 1 found F480 (trade-door race, fixed); F374 / F375 fixed in the sim harness, F409 as migration 159 / pgTAP 107, F457 / F471 discharged; D423. **M5's gate is passed — the breakdown's task list is complete.** NEXT: the orchestrator's call (M5 closeout / push 135–159 / the next milestone).)*
- *(L.D3.8 built — no migration: `sim season --transact` drives the transacting personas + the Ghost with four transaction invariants and their `--probe`s; F284(b) / F300 / F211's Ghost arm / F406 discharged; D418; F457 hands the run to L.D3.10. NEXT is unchanged.)*
- *(L.D2.16 built — migration 157 / pgTAP 105: a player who has played this week stays locked after the NFL releases or trades him — F447 discharged; R1234 needs no executor hunk; D420. NEXT is unchanged.)*
- *(L.D3.11 built — migration 158 / pgTAP 106: each starter's points stored with the score, the stat-correction window to the next week's first kickoff, a final week locked — F405 + F268's post-window part discharged; D422. Push adds one step: after `db push`, `npm run backfill:player-points -- --season 2026` (dry, then `--apply --confirm-target <host>`). NEXT is unchanged.)*
- *(L.D2.17 built — migration 160 / pgTAP 108: equal FAAB bids go by the rolling waiver order by default (Chris 2026-09-29); the stored old default is rewritten at the push (hosted: 1 league); F478 discharged; D424. Measured: hosted is at 159. NEXT is unchanged.)*
- *(L.D3.13 built — migration 161 / pgTAP 109: the one-time, ruled, audited re-score of FINAL weeks (Chris 2026-09-29: "re-score weeks 1 and 2 with the actual yards"); `npm run rescore:final-weeks`; D425. NEXT is unchanged.)*
- *(L.D3.12 built — migration 162 / pgTAP 110: the trade screen never lets a manager build an offer the league would refuse (Chris 2026-09-29); `trade_deadline` + `trade_preview`, F452 / F462 discharged; D426. Until 162 is pushed the app falls back to send-and-see. NEXT is unchanged.)*
- *(L.D2.18 built — migration 163 / pgTAP 111: the rolling waiver order is stored the moment the draft ends (Chris 2026-09-29: "the waiver priority starts as soon as the draft is over and never resets") and shown as "Waiver priority #N" / "Ties on equal bids: you're #N"; F484 discharged; D427. Until 163 is pushed the app shows no number before the first run, as before. NEXT is unchanged.)*
- *(L.D3.14 built — migration 164 / pgTAP 112: the M5 cleanup batch — the commissioner's receipts name the played lock (F467), the kept-start rule uses the locks' real-kickoff guard (F468(b)), the one-time re-score door is retired (F489: service role REVOKEd; `rescore:final-weeks` refuses by name), pgTAP 096 C25 scoped (F491), 109 B2/B4/B5 made falsifiable (R1277); D428. NEXT is unchanged.)*
- *(L.D2.19 built — migration 165 / pgTAP 113: the commissioner's lineup editor (and the week-open carry) store a played player's kickoff record per player, as `set_lineup` has since 157 — a commissioner fix no longer erases the record of a player the NFL released or traded after he played, reads him as a bye, or is refused for him under `allow_illegal_lineups` off (F497 discharged; F500 filed); D429. NEXT is unchanged.)*
- *(L.D2.20 built — migration 166 / pgTAP 114: the lineup batch — a starter who played and is now OUT (IR after Thursday) no longer blocks a commissioner fix that leaves him where he stands (the manager's re-save was already allowed; F500, a rule-(g) defect), and a traded starter's lineup record stays on the game he played after his new team also kicks off (F501); F503 folded in by the review (a kept off-roster start moved into an empty slot is refused too); F504 filed; D430. NEXT is unchanged.)*
- *(L.D3.15 built — no migration: the standings page lists the whole waiver order the server stored (F494), and `transactions.spec.ts` drives the prevented trade states in a browser — full-roster drop pickers on the builder and the offer card, the past-deadline doors (F492); D431. NEXT is unchanged.)*
- **Process (Chris 2026-09-27, "lighten it"):** FULL rigour for FAAB money, roster exclusivity, trades that move players, permissions; ONE PASS for UI / API / sim / docs; no second re-review after a small fix round; short ledger notes (one checklist line, one session-log row, F-rows only for real follow-ups).
- **One local DB:** parallel builders share the one local Supabase stack — serialize `db reset` / `test:db`.
- **M5 CLOSED 2026-09-29** — every follow-up without a ruling is built; F490 / F495 ruled as built. **NEXT (Chris, 2026-09-29): M6 — the commissioner console + the stat-corrections pipeline (L.E2).** Needs its task breakdown (Architect) and Chris's approval before `/build-next` builds it.
- **Production:** at **166** (pushed 2026-09-29 — 135–159, then 160 + 161 + 162, then 163, then 164, then 165, then 166; weeks 1–2 re-scored and the player-points backfill applied — PROGRESS F488). Push debt: **none** (L.D3.15 is UI + E2E only — nothing to push).

---

## ~~Active~~ PAUSED AT CLOSEOUT — **Redraft Leagues M6A — Commissioner Fallback & Autopilot** *(all ruling tasks L.E1.1–L.E1.27 merged; the §8 exit gate and open F-rows remain — not scheduled)*

 *(scope ruled by Chris 2026-09-09/11; breakdown approved and merged 2026-09-11, PR #289)*

**The breakdown is LAW — `docs/specs/tasks-M6A-commissioner-fallback.md` (PR #289).**
A pulled-forward slice of M6 / Phase E, sequenced **BEFORE M5**. The loop builds
`L.E1.*` in order. **`L.E1.1` is LANDED** (PR #286, migration 123 — the
`commissioner_actions` spine + `commish_edit_lineup`), **`L.E1.2` is LANDED**
(PR #291, docs only — spec v2.16.39's errata, Q60–Q64 filed, D335–D354 and
F334–F344 transcribed), **`L.E1.3` is LANDED** (PR **#294** —
pgTAP 064 + 067 gain explicit `league_members` coverage and each gains ONE
seating-premise cell, its own commit, no migration; re-review CLEAN with three
nits recorded, **R997 filed as F346**, now swept), **`L.E1.4` is LANDED**
(PR **#295** — migration **125** + pgTAP **073** `plan(103)` — `plan(80)` as first
built, taken to 103 by its own fix round — plus one stack vitest
suite: `lineup_autopilot_internal` as a PURE chooser plus a THIRD ARM (c) on
`lineup_lock_tick`, four hunks against `119:696`'s file text with arms (a)/(b)
byte-identical and the carry / `league_week_advance` / `118:1825` untouched;
**Q62 and Q63 shipped their recommendations on silence**; the
`autopilot_disabled` kill switch minted on `system_flags`; **discharges F334 and
F346**, mints **F347**, records **D356**), and **`L.E1.5` is LANDED**
(migration **126** + pgTAP **074** `plan(117)` after its fix round — `commish_edit_score` /
`commish_set_result` as ONE verb with two optional arms over one internal and one
replay namespace, **F325's `matchups` backstop discharged in the same migration as
its first writer** with D343's corrected predicate in the trigger's `WHEN` clause,
and `rebuild_team_week_results` replaced against `117:758-891`'s file text with
**exactly one body hunk** per D344. **THE SPLIT SEAM WAS NOT TAKEN — 131 / pgTAP
079 stay unspent and §6's dependency graph is unamended.** **Q61 shipped to its
recommendation with the default on ONE labelled line** — grep `Q61 SWAP LINE` in
126; it stays OPEN because Chris has not ruled, but a different answer is now a
one-line migration rather than a design — **and after the fix round the swap is
one line in CORRECTNESS as well as in plumbing (R1007): the freeze copy moved
into `commish_override_freeze_internal`, a PURE chooser taking that decision as
an ARGUMENT, and pgTAP 074 §L walks BOTH rulings' arms.** Mints **F351**,
records **D357** (amended in place through (13) by the fix round)),
**`L.E1.6` is LANDED** (PR **#297** — migration **127** + pgTAP **075**
`plan(158)` after its fix round, plus two stack vitest cells:
`commish_move_player` / `commish_force_add_drop` as ONE `p_verb`-discriminated
internal under two DEFINER doors, a shared lineup-sync helper, and
`commish_roster_actions` (D350). **115 is byte-untouched and PINNED** (075 §K).
TIMING lifted and NAMED in `bypassed[]`; LEGALITY kept and refused BY NAME —
**F324's second site recorded, not decided**. **F353** is the round's own find
(a force-DROP's enqueue reached NO league, because the worker maps a queued
player through `league_rosters`). **Half-discharges F344**, **re-routes F350**
(127 never calls the matcher — 075 **I3** proves zero `prosrc` hits), mints
**F352 / F353 / F354**, records **D358**), and **`L.E1.7` is LANDED**
(migration **128** + pgTAP **076** `plan(89)` — `commish_rename_team` **and**
`rename_own_team`, the manager's own, because F338's gap was TOTAL. **128
REPLACES NOTHING — zero D137 hunks**, every function is new. §C asserts the gap
BEFORE the verb closes it, with its premise and a positive control; the one
refusal is the spec's own (`spec:183`, a sealed franchise's name is frozen) and
its message names **F354** rather than a remedy nobody built. **Discharges
F338**, mints **F355 / F356**, records **D359**. The manager arm is a documented
**clean drop seam** — migration 128's banner and pgTAP 076's header say exactly
what to delete), and **`L.E1.8` is LANDED** (migration **129** + pgTAP **077**
`plan(121)` — `commish_change_setting`, a PER-KEY read-modify-write, **zero
D137 hunks** (118 byte-untouched and pinned); the per-key policy table ships as
data (`commish_setting_policy`); the FAAB re-seed narrowed to pre-draft and the
snapshot re-freeze kept, both re-decided in the banner; `rescore` built to
**Q64's recommendation** — a final week refused BY NAME behind one marked
`-- Q64 SEAM` block, `reopen_week` NOT built, seam numbers **132 / 080 released
unspent**. **Discharges F345**, mints **F359**, records **D360**), and
**`L.E1.9` is LANDED** (migration **130** + pgTAP **078** `plan(118)` —
`commish_edit_schedule`, the lock-exempt sibling (lifts `111:887` / `:904` /
`:913` / `:993`, each named in `bypassed[]` and proven by an ADJACENT paired
contrast; KEEPS `111:894` (§22.2) and `111:881` (a bracket row — **F360**)),
plus `schedule_edit_matchup`'s **ONE receipt hunk** against `111:785-1153`'s
file text (D137 — `diff -u` shows one `@@`, zero original lines touched;
`schedule_remix_confirm`'s pre-130 prosrc md5 is a stored-literal pin, F341's
wall). ~~The hunk makes 111's reason UNCONDITIONAL (the receipt's `reason` is
NOT NULL) — 059 / the stack vitest amended, the M4 panel hint is **F361**.~~
**FIX ROUND 2026-09-16 on TWO RULINGS BY CHRIS: (1) Q66 — a reason is
OPTIONAL on every commissioner action, the audit row is ALWAYS written, every
action is shown in League Home's activity section (spec v2.16.41); 130 §0
makes `commissioner_actions.reason` nullable once (123 is in production,
untouched) and both of 130's verbs are under the ruling — 111's OWN
post-kickoff gate is outside the one hunk and is the sweep's; (2) R1047 —
hand-picking playoff matchups is a WANTED feature, its own task. THE SWEEP
(F362, the six earlier verbs + 111/112) AND THE BRACKET VERB (F360) ARE
FILED AS tasks-M6A §6 AMENDMENT NOTES (proposed L.E1.15 / L.E1.16), UNBUILT,
PENDING CHRIS'S APPROVAL OF THE AMENDMENT.** D361(6) retracted into Q66.
**Discharges F339**, F225 in part (the `schedule_edit_matchup` half), mints
**F360 / F361 / F362**, records **D361**), so
**`L.E1.10` is LANDED** (API + hooks, part 1 — `/commish/score`,
`/commish/result`, `/commish/move-player`, `/commish/roster` over 126/127;
NO migration, NO pgTAP, NO typegen — **131 / 079 still unspent**; built to
**Q66** with `reason` OPTIONAL on all four schemas (`optionalReason`, no
`.min(1)`); **the transitional state is recorded, not hidden** — 126's and
127's in-body gates still refuse a blank reason until L.E1.15, and four
stack cells pin that 400 BY NAME so the sweep reds them; F65(b) guard per
verb on its own fields + the verb (shared ledgers, D350); records **D362**), so
**`L.E1.15` is LANDED** (PR **#302** — the reason-optional sweep, F362 — migration **131** +
pgTAP **079** + eight re-cut suites; Q66 brought to the CODE: ONE migration
`CREATE OR REPLACE`-ing all eight bodies against their newest definers' FILE
TEXT (D137; 123 in production, 125–130 unpushed — **the Architect's two open
calls decided: one new migration, and `set_lineup`'s commissioner arm IS IN**,
D363), every gate a normalisation, every post clause conditional, 111's
`reason_required` → false, `schedule_remix_confirm`'s receipt landed (F341
discharged; 078 L7/L8 re-derived), the L.E1.1 route + hook (R1052) and
L.E1.10's four transitional stack cells re-cut (R1053/R1054 taken), (h)/F343
clarified, out-of-scope remainders → **F363**; records **D363**), and
**`L.E1.11` is LANDED** (API + hooks, part 2 — `/commish/team`,
`/commish/setting`, `/commish/schedule` over 128/129/130 (via 131) and
**`GET /commish/log`**, the activity-section read surface Q66 named; NO
migration, NO pgTAP, NO typegen — heads stay 131 / 079; `reason` OPTIONAL end
to end with no transitional state, 18 stack cells; F65(b) per verb on its own
fields — **the setting guard omits the VALUE on measurement (129 echoes it
canonicalised), filed as F364**; the log read gated before the first
`.from(`, ONE opaque composite cursor, the same-instant pair proven with its
premise planted; C70 in the docblock, no execution field; F363(b) re-routed
to L.E1.12; records **D364**), and
**`L.E1.12` is LANDED** (UI part 1 — override MODE on the matchup page
through the lineup editor's own switch, lifted into `override-mode-bar.tsx`;
both scores + declare-a-winner with NO reason field and NO reason on the
wire; `no_changes` never says "saved" and the consequence arms render first;
the `✸` marker on the matchup and, per team, on the standings table over the
live schedule read; **F363(b) discharged** — the manager lineup route's
`reason` is `lineupReason`, blank ⇒ absent; NO migration — heads stay
131 / 079; a bye row's score arm is unreachable through `/commish/score`,
filed **F366**; records **D365**), and
**`L.E1.13` is LANDED** (UI part 2 — the team page's commissioner roster
tools (move / drop / add) and BOTH rename arms, and the settings panel's
in-season editing, every one a face of the SAME override mode — the pages
mount `OverrideModeBar`, no second switch, no reason input and no reason on
the wire (the lineup editor's two fixed labels are REMOVED — F363(d));
**Q66's second clause is BUILT**: League Home's activity card shows the §10.3
commissioner log, read from `GET /commish/log`, a NULL reason rendered as
absent; the manager's own rename gets its route, `POST
…/teams/[tid]/name` → `rename_own_team`; migration **132** + pgTAP **080**
flip the Remix preview's `window.reason_required` to FALSE together with the
modal's gate (F363(c) / R1056 — no UI blocks on an empty reason); **F365
discharged** (the setting replay guard narrowed to 129's class), R1063 /
R1064 taken; the `✸` badge's words widened with F344's flag; **discharges
F343, F344, F361, F363(c)/(d), F365**, mints **F367 / F368 / F369**, records
**D366**), and
**`L.E1.14` is LANDED** (TS only, NO migration — heads stay 133 / 081: the
synthetic gate stops seating unmanaged seats — `seedLineups`' `manager ??
commishClient` fallback is gone, so the SERVER's autopilot seats them or
invariant 8 `unmanaged-seat-autopilot` reds, its premise a run PROBLEM; and
invariant 6 is TAUGHT provenance, never exempted — `baselines[]`, a
re-baseline path with a pre-event drift read, exactly one audit row per
baseline change, `renderCells` re-cut as a partition by owner, one lawful
`commish_edit_score` injected per run with no reason; **discharges F335 +
F336**, builds F334's second half, mints **F373** (knock-on overrides are not
modelled) and **F374** (the season gate is RED today on an
`allow_illegal_lineups = false` league because the restored pool carries real
`Out` QBs — whoever next runs `test:gate:m4` meets it), records **D368**), so
the next takeable task was **`L.E1.16`** — `commish_edit_bracket`, hand-picked
playoff matchups (F360). **`L.E1.16` is LANDED 2026-09-21** (migration **134**
+ pgTAP **082** `plan(115)`, `/commish/bracket`, the bracket hand-pick
control in override mode; **F366** discharged in its own commit; discharges
F360, mints F377, records D370) — **and it was M6A's LAST PLANNED TASK: the
§6 list (L.E1.1–L.E1.17) is COMPLETE.**

**`L.E1.18` is LANDED 2026-09-27** (migration **135** + pgTAP **083** `plan(86)` after PR #313's fix round —
R1097: a side with no lineup row is not finished outside a final week — pgTAP 074 re-cut,
`GET /commish/matchup-lock`, the matchup panel gate — Q61 as ruled: no score /
result override while any starter on either team is still playing; a final week
always editable. **Measured first:** the signal is `nfl_games.status = 'final'`
from `ingestWeek` (no cancelled value is ever written — Q37 / F243 inherited).
Discharges **F378**, mints **F383**, records **D372**; spec **v2.16.43** (fold-back).
**⚠ PUSH DEBT: 135** — production is at 134; until Chris runs
`npx supabase db push`, production still accepts a live-week score edit.)

**`L.E1.19` is LANDED 2026-09-27** (migration **136** + pgTAP **084** `plan(54)` —
`player_weekly_projections` (THIS week's projected stat line per player, canonical
namespace, SELECT for signed-in users, no write policy) + `src/lib/sync/weekly-projections.ts`
+ `npm run sync:weekly-projections` + `GET /api/cron/sync-weekly-projections`, fired
hourly at :40 by pg_cron `sync-weekly-projections-ping` (124's vehicle). **Measured
first:** Sleeper's weekly endpoint answers 200 with filler rows, and a week that does
not exist is ALL filler — so zero PROJECTED rows for any position fails the week.
The first third of Q62; records **D373** (incl. D373(2), the namespace reading —
flagged), mints **F385 / F386** for L.E1.20; spec **v2.16.44** (fold-back).
**⚠ PUSH DEBT: 135–136** — production is at 134.)

**`L.E1.20` is LANDED 2026-09-27** (migration **137** + pgTAP **085** `plan(65)` —
`league_player_values` (per league / week / rostered player: THIS week's projected points,
season-to-date points + games, preseason projected points — POINTS under the league's
FROZEN snapshot through the worker's own composition; every NULL names why, NULL is never
zero; member-readable, no write policy) + `src/lib/leagues/scoring/player-values.ts` /
`player-values-job.ts` + `GET /api/cron/league-player-values`, fired hourly at :50 by
pg_cron `league-player-values-ping`. **F385** discharged (the legacy season line
translated), **F386(b)** discharged (a fractional projected PA takes its floor's tier —
Sleeper's own indicator, 186 / 186 live), **F386(a)** → F10 (neither map extended; every
value names the keys its source cannot supply), **F387**'s compute half discharged (6 h);
actual scoring byte-unchanged. The second third of Q62; records **D374**, mints
**F388 / F389**; spec **v2.16.45** (fold-back). **⚠ PUSH DEBT: 135–137** — production
is at 134.)

**`L.E1.21` is LANDED 2026-09-27** (migration **138** + pgTAP **086** `plan(70)` —
`lineup_autopilot_internal` against `125:328-704`'s file text, nine hunks; the tick
UNTOUCHED (md5 pinned). Autopilot now starts the eligible player with the highest
projected points: ONE lexicographic ORDER BY per player (this week's projection →
season-to-date → preseason points, then ADP, then `player_id`) over a LEFT JOIN to
`league_player_values`; a values row or projection older than 6 h at the tick instant is
absent (**F387** read half — row closed; **F389** discharged). **`Doubtful` sits** —
swapped only for a healthy replacement, otherwise started ("yes start the doubtful"); a
preference under both `allow_illegal_lineups` values, never the `out` flag. Every pick
names its key; a pass with no usable value says it fell back to ADP and why. **F379
closed**; records **D375**; files **Q68** (does NOT block — an OUT starter whose only
replacement is Doubtful is no longer swapped, as the rulings' text reads; Chris's call);
spec **v2.16.46** (fold-back). **⚠ PUSH DEBT: 135–138** — production is at 134.)

**`L.E1.22` is LANDED 2026-09-27** (migration **139** + pgTAP **087** `plan(76)` — Q63 as
ruled: autopilot is OFF by default, per team, behind the commissioner's "Put on autopilot"
switch. `team_autopilot` (no row = OFF — **every existing team, production's unmanaged
seats included, goes OFF on push, no backfill**), `commish_set_autopilot` (commissioner or
co-commissioner; ON only for a seat with no manager; OFF for any franchise; audited,
reason optional, the §10.3 post, its own replay ledger), `lineup_lock_tick` arm (c) gated
on the switch (an OFF seat is materialized, never filled, and NAMED in
`commissioner_managed[]`), `POST /api/leagues/[id]/commish/autopilot` + hook + the switch
on the team page inside override mode + the activity-feed line. **F392** discharged in the
same migration (the chooser's `order_basis`, one hunk). **The synthetic gate is RE-CUT**
(invariant 8 counts switched-ON seats; invariant 9 = the OFF negative control; invariant
10 = F391's selection grade, with the projections → values chain run in the sim over the
recorded fixture). Records **D376**; **F380 / F391 / F392 discharged**; mints **F393 /
F394**; spec **v2.16.47** (fold-back). **⚠ PUSH DEBT: 135–139** — production is at 134,
and pushing 139 turns autopilot OFF for every existing team in production.)

**`L.E1.23` is LANDED 2026-09-27** (migration **140** + pgTAP **088** `plan(8)` — F377's
remainder: `playoff_bracket_sync_internal`'s played-round refusal raises a NOTICE that says
the bracket *"stands as played (F377(a), ruled 2026-09-27)"* instead of an hourly WARNING
promising a commissioner act — ONE hunk against 134's file text, the return document
byte-unchanged (088 A6's one-line md5 proof), 066 / 082 unmodified; and the bracket's
*Edit a result* is a LINK per game (per week row on a two-week game) to its matchup page —
the pending door is gone. Records **D377**; **F377 CLOSED**; mints **F395** (the callers
`league_week_advance` / `finalize_matchups` still raise their OWN hourly "BLOCKED — a
commissioner must act" WARNING for the same refusal — out of the one-hunk scope, filed with
its shape) and **F396** (a co-commissioner sees neither bracket affordance); spec
**v2.16.48** (fold-back). **⚠ PUSH DEBT: 135–140** — production is at 134.)

**`L.E1.24` is LANDED 2026-09-27** (migration **141** + pgTAP **089** `plan(43)` — Q64 as
ruled: `commish_change_setting_internal` against 131's file text, nine hunks; the
`-- Q64 SEAM` whole-call refusal is gone — with a final week the scoring change LANDS, the
open weeks (`live` + `correction_window`) are re-queued, and the final weeks come back BY
NAME (`rescore_skipped_final_weeks`, in the result, receipt and league post); pgTAP 077
G10–G14 re-cut; the settings panel's hint no longer promises a refusal and the outcome line
shows the kept weeks verbatim. **Measured first: the nightly reconcile and the box score
re-derive a FINAL week under the league's CURRENT rules, so after any scoring change a kept
final week reads as reconcile `drift` — F397, pre-existing since 129, pinned by a stack
cell, not fixed here.** Records **D378**; **F382 DISCHARGED**; spec **v2.16.49**
(fold-back). **⚠ PUSH DEBT: 135–141** — production is at 134.)

**`L.E1.25` and `L.E1.26` are LANDED 2026-09-27** (PR #321 — migration **142** + pgTAP
**090**, Q67 + Q68, PROGRESS D379; PR #322 — migration **143** + pgTAP **091**, F390 yards
allowed, PROGRESS D380). They were built AROUND #320's reserved 141 / 089 and merged first;
#320 was brought forward onto main by a merge commit (PROGRESS **D381**).

**Chris's rulings on #320's review (2026-09-27, in chat):** **Q69** — *"Q69 keep last week's
scores"*: a scoring change with re-score on does NOT re-score a week in its stat-correction
window. **141 as merged re-scores one — INTERIM, contradicting the ruling (F404).** **F397** —
*"F397 yes build it"*: each league week stores the scoring rules it is played with. Spec
**v2.16.52** (fold-back).

**`L.E1.27` is LANDED 2026-09-27** (`feat/M6A-L.E1.27-per-week-scoring-rules` — migration
**144** + pgTAP **092**; PROGRESS **D382**; **F397 + F404 DISCHARGED**; spec **v2.16.53**):
each league week stores the scoring rules it is played with (stamped when the week opens);
the worker, box score, nightly reconcile and season-to-date values read the week's rules;
a scoring change with re-score on re-scores only the live week and keeps + names the final
and correction-window weeks; existing weeks backfilled (mixed weeks named in the NOTICE).
**Open for Chris: F405** (a finished week's box score can differ from its final score after
a late stat fix — store per-player points?). **The M6A ruling tasks are complete — the
pointer now reads the CLOSEOUT below.**

**⚠ PRODUCTION PUSH ORDER (Chris's steps; production is at 134):** (1) `npx supabase db push`
— **135–144 together** (never 141 without 144, F404); read the `144 backfill` NOTICE lines —
any AMBIGUOUS / UNRECOVERABLE week is named there; (2) **immediately**
`npm run sync:reingest -- --season 2026 --weeks <every completed week> --confirm-target <hosted host>`
**If `db push` stops with an error on 144 (or any migration), STOP: do not run `sync:reingest`, and report the error — production would otherwise sit with 141 live and 144 missing (F404). (R1158.) Read the `144 backfill` NOTICE lines; any `AMBIGUOUS` week had a scoring change land mid-week without a re-score and will show nightly drift alerts for the teams that kept the old rules (R1159).**
(143 / F400).

~~**NEXT TAKEABLE TASK: `L.E1.27`**~~ *(landed — above)* — per-week scoring rules (F397) + Q69: persist each league
week's rules when it opens; the score worker (incl. correction-window stat corrections), the
box score, the nightly reconcile and L.E1.20's season-to-date read THAT week's rules; 141's
rescore skips `correction_window` weeks and names them beside the final ones; backfill the
existing weeks. Task text: tasks-M6A §6's L.E1.27 amendment note (right after L.E1.24's
AS-BUILT note). Heads: **143 / 091** — re-measure at task time (D161).

~~**⚠ PRODUCTION PUSH — Chris should NOT push to production until L.E1.27 has merged** (141's
`correction_window` re-score contradicts Q69). **PUSH DEBT: 135–143**, plus L.E1.27's
migration — production is at 134. When the push happens, 143's order still applies:
`npx supabase db push` → immediately `sync:reingest` for every completed week (F400).~~
*(superseded by the push order above — push debt is now **135–144**)*

~~**NEXT TAKEABLE TASK: `L.E1.25`** (Chris's rulings 2026-09-27 — Q67 empty-lineup lock + Q68
Doubtful swap) **then `L.E1.26`** (F390 — yards allowed, sourced). Task text: tasks-M6A §6's
second 2026-09-27 amendment. Heads after L.E1.24: **141 / 089** — re-measure at task time
(D161).~~ *(both landed — advanced by #320's merge-forward, D381)*

~~**QUEUED AFTER L.E1.24 (Chris's rulings 2026-09-27): `L.E1.25`** (Q67 empty-lineup lock + Q68 Doubtful swap) **then `L.E1.26`** (F390 — yards allowed, sourced). Task text: tasks-M6A §6's second 2026-09-27 amendment.~~ *(promoted to NEXT TAKEABLE by L.E1.24's own PR)*

~~**NEXT TAKEABLE TASK: `L.E1.24`**~~ *(advanced by L.E1.24's own PR)* — Q64 as ruled: `rescore = true` re-scores every OPEN and
future week and SKIPS final weeks, naming them, instead of refusing (tasks-M6A §6's
2026-09-27 amendment; PROGRESS **F382**). The last of the ruling tasks L.E1.18–L.E1.24;
after it, the M6A closeout below. Heads after L.E1.23: **140 / 088** — re-measure at task
time (D161).

~~**NEXT TAKEABLE TASK: `L.E1.23`**~~ *(advanced by L.E1.23's own PR)* — F377(c) (bracket "Edit a result" → a link to the game's
matchup page) + the played-round WARNING downgraded to a NOTICE (tasks-M6A §6's 2026-09-27
amendment; PROGRESS **F377**'s remainder). Then L.E1.24. Heads after L.E1.22:
**139 / 087** — re-measure at task time (D161).

~~**NEXT TAKEABLE TASK: `L.E1.22`**~~ *(advanced by L.E1.22's own PR)* — Q63: autopilot OFF by default + the commissioner's
"Put on autopilot" switch, and the synthetic gate re-cut (PROGRESS **F380**, and **F391** —
the re-cut also runs the projections → values chain in the sim and grades WHICH player
autopilot chose (R1121, PR #316's fix round); tasks-M6A §6's 2026-09-27 amendment). Then
L.E1.23 → L.E1.24 in numeric order. Heads after L.E1.21:
**138 / 086** — re-measure at task time (D161).

~~**NEXT TAKEABLE TASK: `L.E1.21`**~~ *(advanced by L.E1.21's own PR)* — autopilot's selection order (Q62) and `Doubtful` sits,
the last third of Q62 (PROGRESS **F379**; it READS `league_player_values` under **F389**'s
join contract — a LEFT JOIN, points columns only — and owns **F387**'s read half: bound
`projection_fetched_at` / `computed_at` at lock; tasks-M6A §6's 2026-09-27 amendment).

~~**NEXT TAKEABLE TASK: `L.E1.20`**~~ *(advanced by L.E1.20's own PR)* — league-scored player values for autopilot (the
canonical TS scorer, persisted), the second third of Q62 (PROGRESS **F379**; its
inputs **F385** — the preseason line is in the legacy namespace — and **F386** — the
canonical map drops kicker short-FG / DEF yards-allowed projection fields, and Sleeper's
projected points allowed is usually FRACTIONAL — and **F387** — nothing bounds a
projection line's age; tasks-M6A §6's 2026-09-27 amendment). Then L.E1.21 → L.E1.24 in numeric order. Heads after
L.E1.19: **136 / 084** — re-measure at task time (D161).

~~**NEXT TAKEABLE TASK: `L.E1.19`**~~ *(advanced by L.E1.19's own PR)* — weekly projections sync (Sleeper), the first
third of Q62 (PROGRESS **F379**; tasks-M6A §6's 2026-09-27 amendment). Then
L.E1.20 → L.E1.24 in numeric order. Heads after L.E1.18: **135 / 083** —
re-measure at task time (D161).

~~**NEXT TAKEABLE TASK: `L.E1.18`**~~ *(advanced by L.E1.18's own PR)* — Q61: refuse a score / result override
while the matchup's games are in progress (tasks-M6A §6's **2026-09-27
amendment**; PROGRESS **F378**). **M6A IS REOPENED for ~~six~~ seven ruling tasks,
L.E1.18 → L.E1.24, taken in numeric order** (edges: L.E1.20 needs L.E1.19,
L.E1.21 needs L.E1.20; the rest need nothing new). Chris ruled **Q60–Q64**
and the **F377** read on 2026-09-27 (spec **v2.16.42**, PROGRESS **D371**):
Q60 NO (no `commish_edit_record`) needs no task; Q64 option 1 (going
forward only — the open week IS re-scored, final weeks are not; `reopen_week`
not wanted) → **L.E1.24** (F382 — the shipped refusal blocks the open week;
added by the PR #312 review, R1090); Q61 → L.E1.18 ("in progress" ruled PER MATCHUP — editable once every
starter on both teams has finished); Q62 → L.E1.19 /
L.E1.20 / L.E1.21 (weekly projections, league-scored values, the order +
`Doubtful`); Q63 → **L.E1.22 (autopilot OFF by default + the commissioner's
switch — it RE-CUTS L.E1.14's synthetic gate, and migrating the flag OFF
stops production's unmanaged seats being auto-filled until the switch is
flipped)**; F377(c) + the WARNING → L.E1.23. Numbers are measured at each
task's own time (D161). *(Advanced from the closeout by the 2026-09-27
rulings docs session.)*

~~**NEXT — M6A CLOSEOUT, not a `L.E1.*` task.** There is no unbuilt task in
tasks-M6A §6.~~ **What remains AFTER L.E1.18–L.E1.27** (all landed 2026-09-27 — this is now the NEXT item), before the pointer
moves to the next milestone:
~~(1) **Chris's rulings** — Q60–Q64 (still open in PROGRESS §3) and the
F377 read (a "confirm as played" act for a round under R839's hourly
WARNING?);~~ **(1) RULED 2026-09-27 — see above;** (2) **the M6A exit-criteria gate** per tasks-M6A §8 (a Reviewer /
gate session, not a Builder task); (3) **the open M6A ledger rows**, each
small and filed with its shape — F361 (the M4 panel hint), F363 (the retire
verb's reason gate), F368, F370, F371 (League Home's activity feed), F372
(REFERENCES / TRIGGER / MAINTAIN grants), F373–F376 (the synthetic gate's
recorded blindnesses), ~~F377 ((a)/(b) ruled 2026-09-27; the remainder is L.E1.23)~~ **F377 CLOSED by L.E1.23**, F395 (the callers' hourly BLOCKED WARNING for a played round), F396 (co-commissioner and the bracket's affordances), **F405 (Chris's call — per-player points for finished weeks)**; **(3b) the production push 135–144 + `sync:reingest` (Chris's — order above)**; (4) ~~⚠ **`npx supabase db push` for 125–134**~~ **DONE 2026-09-23** — production
reads 124–134 applied, 0 of 73 `public` tables grant TRUNCATE to anon/authenticated, the M6A verbs present. After the
closeout the delivery plan's next milestone is **M5** (trades / FAAB —
D352 / F340), which needs its own Architect breakdown before the loop can
take it. A `/build-next` that reads this file and finds no task should say
so and stop — this is the header's own rule.
~~⚠ **Chris owes `npx supabase db push` for migrations 125–132** (hosted tops
out at 124; 131 re-defines 123's verb, which IS in production; until 132 is
pushed the hosted Remix preview still answers `reason_required = NOT free` —
harmless, the modal no longer reads it as a gate).~~ **[Corrected 2026-09-27:
STALE — production was pushed 2026-09-23 and is at 134 (PR #311 recorded it);
there is no push debt.]**
**`L.E1.17` (INSERTED BY RULING — Chris 2026-09-21, the repo went public) is
BUILT: the TRUNCATE sweep, migration 133 + pgTAP 081 — discharges F349 + F327,
mints F372, records D367. It did NOT move the pointer (then `L.E1.14`);
L.E1.14's own PR moved it to `L.E1.16`.** ~~⚠ **The push debt is now 125–134, and production
is NOT protected against the F349 TRUNCATE grant until Chris runs
`npx supabase db push`.**~~ **PUSHED 2026-09-23 — no push debt; production is at 134.** **[2026-09-27: L.E1.18 adds 135 — push debt 135.]** **[2026-09-27: L.E1.19 adds 136 — push debt 135–136.]**
*(Advanced from `L.E1.2` in L.E1.2's own fix round, R982; advanced again by
L.E1.3's, L.E1.4's, L.E1.5's, L.E1.7's, L.E1.8's, L.E1.9's, L.E1.10's, L.E1.15's, L.E1.11's, L.E1.12's, L.E1.13's, L.E1.14's and L.E1.16's own sessions — L.E1.16's moved it to the CLOSEOUT, there being no task left.*
> **⚠ THE STREAK BROKE AT `L.E1.6`, AND THIS IS THE FAILURE THIS FILE'S OWN
> HEADER WARNS ABOUT.** Every task from L.E1.2 through L.E1.5 advanced this
> pointer inside its own PR, so a fresh `/build-next` reading this file first —
> which the loop mandates — always found an unbuilt task. **PR #297 landed
> L.E1.6 without touching this line**, so for a day the pointer named a task
> that was already merged, and the next session would have rebuilt it (burning
> migration 128 on a duplicate of 127, or halting). **L.E1.7's PR repairs it and
> records why: the pointer is not a summary of what happened, it is the input to
> the next build, so advancing it is part of finishing a task — not part of
> describing one.** If a future PR lands an `L.E1.*` task without moving this
> line, that is a review finding in its own right.*
Migration numbers **125–132** and pgTAP **073–080** are reservations confirmed at
task time — **125 / 073, 126 / 074, 127 / 075, 128 / 076, 129 / 077 and 130 / 078 are now SPENT**;
**131 / 079 were RESERVED for L.E1.5's seam and are released unspent**, and
**132 / 080 were RESERVED for L.E1.8's seam (`reopen_week`) and are released
unspent too — F359's task takes the next free number at its own time (D161)**.
Next free: **131 / 079** (the M6A band is exhausted; the next schema task
measures with `ls … | tail -1`, D161).

> **⚠️ MIGRATIONS 125, 126, 127, 128, 129 AND 130 ARE NOT ON PRODUCTION YET.**
> `npx supabase db push` is **Chris's to run**; `db-drift.yml` is expected red
> until he does, which is the drift check working. No `HELD-FROM-PRODUCTION`
> entry was added for any of them and none should be — the hold was cleared
> 2026-09-09 (PR #282); the file stays in the tree as the hold's record and
> no entry is added (R1042). Because none of the six is
> deployed, each was authored against the REPO's chain and a fix round may still
> edit one in place; the moment Chris pushes, that stops being true.
>
> **126 CHANGES WHAT THE DATABASE ALLOWS, so read this before the push.** It adds
> `trg_matchups_override_guard` (`BEFORE UPDATE`, `ENABLE ALWAYS`) on `matchups`:
> from the moment it lands, **no statement may move `is_overridden` in either
> direction without `app.commish_action_id`** — not `authenticated`, not
> `service_role`, not the table owner. That is §12.12's own ask and M6A exit
> criterion 1, and it is why two stack test suites and one pgTAP fixture had to
> change in the same PR. Nothing in production writes that column today (measured:
> zero writers in 109–125), so the push is safe; but **any future hand-run SQL that
> sets the flag will be refused**, and the route through it is an audited verb.
>
> **The GUC is an INTENT marker, not a credential (R1010).** The trigger checks
> that `app.commish_action_id` is non-empty; it does not verify that an audit row
> exists, and a forged value passes. That is §12.12's own printed check and it is
> not a hole — `matchups` carries no UPDATE policy for any role (`109:193-194`), so
> the only callers who reach the trigger at all are the DEFINER verbs, **the service
> role** and the table owner. **Do not read the guard as proof that every `TRUE` flag has a receipt
> behind it, and do not GRANT EXECUTE on `rebuild_team_week_results` believing the
> GUC would hold that door — the REVOKE does (`117:892-893`).**

**Scope is spec §15.4 IN FULL plus `commish_rename_team`**, per the standing rule
in PROGRESS §3 (*"a commissioner may do anything a manager can, on any team"* —
**a verb that refuses a commissioner is a DEFECT to fix, never a question to
ask**). Trade and FAAB overrides defer to M5 for want of a SUBJECT, not
authority.

**Read before taking any task:**
1. **PROGRESS §3's STANDING RULE, all of (a)–(i)** — especially **(g)** the
   game-day lock does not bind a commissioner, **(h)** override is a MODE
   with **no reason prompt** (superseded its own "captured once" clause the day
   it was written), and **(i)** (ruled 2026-09-11, explaining Q59) — the test to
   apply to every future verb: **commissioner powers FIX what is broken; they do
   not CHANGE what the game is.** A TIMING or REACHABILITY refusal is a defect to
   fix; a VALIDITY refusal binds him too and needs no question. L.E1.6's
   roster-shape legality question turns on it. (Grep the clause headings —
   PROGRESS line numbers move.)
2. **Q59 is RULED (2026-09-11): timing is lifted, POSITIONAL legality is not.**
   *"even a commish cannot break the positional rules."* No exemption from E16.
3. **The breakdown's citation discipline** (head of its §2): for `src/**` the
   IDENTIFIER is authoritative and the line number advisory — grep the symbol.
   Migration, pgTAP and `spec:` citations stay exact, and a wrong one THERE is a
   real error to report.
4. **Q60–Q64** are open and Chris's (filed in PROGRESS §3 by L.E1.2); none
   blocks starting — each names exactly what it blocks.

> **⚠ THE HOLD-FILE INSTRUCTION IS RETIRED — do NOT follow M4's §4 rule 11.**
> `tasks-M4-inseason.md` §4 rule 11 says every new migration extends
> `supabase/HELD-FROM-PRODUCTION.txt`'s closed range in the same PR. **That was
> true while production ran behind; it is false now.** Chris cleared the hold on
> 2026-09-09 for go-live (commit `26eca84`) and production has since taken 123
> and 124 — the file has **zero live entries**. Adding a hold line for a new
> migration would keep the fix out of the very league it was written for; that
> nearly happened with 123. **The default act for a new migration is
> `npx supabase db push`, which is CHRIS'S to run, after merge.** A new migration
> reds `db-drift.yml` between merge and push — that is rule 1 working, not a
> defect.

---

## Paused: **Redraft Leagues M4 — In-season core** *(not abandoned — two items outstanding)*

**M4 is 🟡, and the loop is NOT taking `L.D*` tasks while M6A is active.** What
remains, so nobody has to re-derive it:
- **`L.D6.4` — the real-2026 replay gate (exit criterion 2).** Was calendar-blocked
  on the first recorded 2026 week; **that block is GONE** — week 1 is in the books
  and Chris's live league carries real `player_stats`, `matchups` and scores.
  Takeable whenever this file points back.
- **F308 / blocker B11 — exit criterion 4 (continuity).** `test:gate:m4` last
  exited 1 at `e2e/auction-live.spec.ts:213`, the nomination broadcast, and F308
  is deliberately NOT in the flake policy. Diagnosed (the Realtime tenant's
  100 events/s ceiling is the mechanism in the reproduction, F311) but the gate
  instance's own trigger is unproven.

Exit criteria 1 and 3 are measured green and shown three times over.

---

## Previous: **Redraft Leagues M4 — In-season core** *(approved by Chris 2026-09-01, PR #244 merged; Q29 ruled at approval)* — **SUPERSEDED as the active build 2026-09-11; see "Paused: M4" above for what remains**

**The breakdown is LAW — Chris approved and merged PR #244 (2026-09-01).**
`docs/specs/tasks-M4-inseason.md` sequences the milestone (24 tasks, 6 lanes;
spec at **v2.16.11**; Q29 ruled — a mid-season league starts at the next NFL
week, shrink-or-refuse ≤ 18). **The loop builds `L.D*` tasks in lane order,
starting L.D1.1** (migration 109 — schema lane opener; numbers 109–118 /
pgTAP 057–066 are reservations confirmed at task time; every migration extends
`HELD-FROM-PRODUCTION.txt` same-PR). PROGRESS §2 carries the M4 checklist;
§4 carries D287–D301; §3's Q28 is re-framed LIVE and needs Chris **before the
cohort's first scored week**. The L.D6.4 real-replay gate is calendar-blocked
on the first recorded 2026 week (~Sept 10+) — the loop runs everything ahead
of it and holds there if it arrives first.

*(The F210 merge-time duties — this lane clause + the D288–D301 transcription
into PROGRESS §4 — were executed by the same PR that carries this edit.)*

---

## Previous: **NONE — awaiting Chris's direction** *(SE completed 2026-09-01; every candidate next build runs through a Chris gate)*

> **[corrected 2026-09-01]** ~~the remaining lane is SE~~ — **the SE track is COMPLETE.**
> The gate statement on the record: *"the editor's own quality gate (spec §7.3.3.1,
> v2.16.11) passed 2026-09-01"* (PROGRESS §1; D286; PR #241). SE.1–SE.10 plus the
> four SC cuts (Scout Standard + Scout PPR, the rename, the roster default, the
> preselection) are all built, adversarially reviewed, and merged. **This header
> outlived the lane exactly as the 2026-08-25 correction above warned; corrected
> the day the gate passed rather than eleven days later.**
>
> **The loop takes NOTHING until this file points somewhere new, and every
> candidate is gated on Chris:**
> 1. **F59 — the boundary editor** (the SE successor named in the ledger): gated
>    on **Q26** (PROGRESS §3 — the tier re-cut allowlist question; silence ships
>    option (c), which reverses two of his v2.11 rulings), then an Architect
>    breakdown he approves.
> 2. **M4** (canonical milestone order M2 ✓ → M3 ✓ → M4): needs its Architect
>    breakdown, which is his approval gate (the #150/#161 precedent).
> 3. **DR2 (PR #180)**: parked for his Figma session; owes a rebase (F134's
>    strike-keeping rule applies).
> 4. **MS.1/MS.4/MS.6**: parked with the deferred league-attached mock feature,
>    per the standing ruling (mocks lead, leagues follow demand).

---

## Previous: Redraft Leagues M3 — Auction engine (**COMPLETE**) → SE (**COMPLETE 2026-09-01**)

> **[corrected 2026-08-25, PROGRESS D266]** ~~M3 — Auction engine (in build)~~ — **M3 is COMPLETE.** HEAD commit subject: *"L.C6.1 — THE M3 GATE: `test:gate:m3` green twice; F84/F56/F60 discharged; M3 complete (#215)"*; PROGRESS §1 → **🟢 Gate passed 2026-08-25**. This file had not been touched since `8fc5852` (2026-08-24), so the header outlived the milestone. **The one lane with unchecked tasks is SE** (`SE.1`–`SE.10`, prefix `SE.`, table below) — plus MS.1/MS.4/MS.6, which stay **parked** with the deferred league-attached feature per step 1c. **Before taking ANY `SE.*` task, read `docs/specs/tasks-SE-scoring-editor.md` §0** — that breakdown sat unrevised through five lanes and was re-measured 2026-08-25; two of its corrections change what gets built.

*(Set 2026-08-14 — **ruled by Chris in-session** ("M3 — Auction engine", the
recommended option of the M2-gate-passed question), recorded here per this
file's rule. **M2 passed its gate 2026-08-14** (L.B7.1, `npm run test:gate:m2`
green end-to-end — see the PROGRESS §1 row and the gate session-log entry).
In the same ruling Chris settled **R278**: D39-class browser-pass evidence is
**prose + DB corroboration** (the merged-PR precedent) — recorded at the
standing sites in PROGRESS.)*

**The breakdown is LAW — Chris approved and merged PR #150 (2026-08-16).**
`docs/specs/tasks-M3-auction.md` sequences the milestone (15 tasks, 5 lanes;
spec at **v2.10.1** with every C-row resolved or ruled); PROGRESS §2 carries
the M3 checklist and §4/§6 carry D126–D143 + F57. **The loop builds `L.C*`
tasks in lane order, starting L.C1.1** (migration 083 — schema lane opener).
The C43 projections-splits sync runs as an authorized standalone data-task PR
in parallel with the loop, never an `L.C` dependency.

| | |
| --- | --- |
| **PROGRESS (the loop's only memory)** | `docs/specs/PROGRESS-leagues.md` |
| **Delivery plan** | `docs/specs/delivery-plan-redraft-leagues.md` (v1.4 — §3 M3 row: Phase C gate; solvency property test incl. bot-driven mocks; bid-storm E2E) |
| **Spec (LAW)** | `docs/specs/spec-redraft-leagues.md` — **v2.13** (§8.6 auction incl. §8.6.7–8 endgame/solvency and **§8.6.9 the uncontestable instant award**; §8.8's pacing bar; L.C1) |
| **Task breakdown** | `docs/specs/tasks-M3-auction.md` (Architect; **approved & merged 2026-08-16**, PR #150) |
| **Task id prefix** | ~~`L.C`~~ **`SE.`** *(corrected 2026-08-25 — the `L.C` lane is complete; SE is the only lane with unchecked tasks. `SE.` was already declared below and step 3 already routes to it.)* |

**Standing constraints:** CLAUDE.md + the M2-era standing rules carry forward
(spec is LAW; server-authoritative always; branch + PR per task; proof chains
shown, not claimed; the realtime doctrine and draft-lock discipline as landed).
Inherited M3 notes already recorded: tasks-M2 §11's M3-inherits line
(presence-only `realtime.messages` INSERT posture — M3's auction realtime
decides whether to open Client Broadcast for bid-pulse UX, deliberately);
auction refusal seams in 066/071 name M3; the 2026 test-cohort note (CLAUDE.md)
makes **auction + custom scoring the headline feedback goals** — ~~the custom
scoring editor un-punt still needs its spec changelog entry (Architect) before
any build touches it~~ *(satisfied 2026-08-18: spec v2.11/§7.3.3.1 merged as
PR #152, and the SE lane block below carries the build — ~~no editor build until
Chris also merges the SE breakdown PR~~ **[corrected 2026-08-25: he merged it 2026-08-19 (#161); the editor build is authorized]**)*.

**Lane precedence — TWO lanes under one active build (added 2026-08-17; takes effect when
the draft-room redesign PR merges, and is part of what Chris approves with it).**
Chris used the shipped M2 draft room live and ordered a **layout redesign**, ruling it runs
**AHEAD of the auction UI** so the auction room is built into the new shell rather than the
old one — **with the M3 engine lane continuing behind it**. That is not a build swap, so this
file's pointer does not move: **M3 stays the active build and gains a second lane.**

| | |
| --- | --- |
| **Redesign breakdown** | `docs/specs/tasks-DR-draft-room-redesign.md` (Architect, 2026-08-17) |
| **Redesign task id prefix** | `DR.` |
| **Spec fold** | `spec-redraft-leagues.md` **v2.12** (§16.1/§16.2/§16.3/§16.4/§16.5, §8.7, §9.3) |
| **PROGRESS** | the same file — `docs/specs/PROGRESS-leagues.md` §2 carries both checklists |

**Third concurrent lane — SE, the custom scoring editor (added 2026-08-18; ~~takes effect
when the SE breakdown PR merges~~ — **LIVE: PR #161 merged 2026-08-19**, and as of 2026-08-25 it is the
**only lane with unblocked tasks**).**
Spec **v2.11** (§7.3.3.1, approved & merged 2026-08-18 as PR #152) made the test-cohort
custom scoring editor LAW and required a follow-up Architect breakdown before build; that
breakdown exists and this row activates it. SE is the **C37 separate parallel track — never
an M3 lane**: it never blocks and is never blocked by `DR.*` or `L.C*` (its schema work is
additive; ~~SE migration numbers stay **above tasks-M3 §7's 088/089 reservations**~~ **[corrected 2026-08-25 — that band is a dead
letter 13 numbers behind the head; SE takes the NEXT FREE number measured at task time, heads 102 / 050]**). The only
shared surface is `PROGRESS-leagues.md` (append-collisions resolved at merge, the
established two-lane pattern).

| | |
| --- | --- |
| **SE breakdown** | `docs/specs/tasks-SE-scoring-editor.md` (Architect, 2026-08-18; **AMENDED 2026-08-25 — read its §0 before any `SE.*` task**: five lanes landed under it unrevised, and two of the corrections change what gets built — §0(A)/**F133** adds SE.2 a sixth deliverable, §0(B)/§0(C) retire SE.6's planned hook. PROGRESS **D266**) |
| **SE task id prefix** | `SE.` |
| **Spec fold** | `spec-redraft-leagues.md` **v2.11** (§7.3.3.1, §7.3.8, §12.25, §16.2, §23.5, App B.4) |
| **PROGRESS** | the same file — `docs/specs/PROGRESS-leagues.md` §2 carries all three checklists |

**Fourth lane — AP, auction pacing (added 2026-08-20; takes effect when the AP breakdown PR
merges, and is part of what Chris approves with it).**
Chris drove the **finished** M3 auction room on 2026-08-20 and ruled six changes to it — bot
pacing with a number on it (a mock under 45 minutes, a live draft under 90), instant awards for
uncontestable nominations, `$0` nominations as a per-league toggle with `auction_min_bid`
retired, the auction's manual nomination order, the six projection split columns that have
data, and idempotent budget adjustments. Spec **v2.13** is the fold. **This is not a build swap
and the pointer does not move: M3 stays the active build and gains a fourth lane** — the DR
precedent, applied again.

**AP runs AHEAD of M3's remaining three tasks — Chris ruled that order in-session.** `L.C4.1`
(sim + the solvency property test), `L.C5.1` (auction E2E incl. the bid storm) and `L.C6.1` (the
gate) all encode current behaviour as assertions, and **the bid-storm spec in particular assumes
today's bot cadence**; writing them against behaviour about to change buys a suite that must be
rewritten and, worse, a green gate certifying the wrong thing. Reasoning recorded at PROGRESS
**D197(4)**.

| | |
| --- | --- |
| **AP breakdown** | `docs/specs/tasks-AP-auction-pacing.md` (Architect, 2026-08-20) |
| **AP task id prefix** | `AP.` |
| **Spec fold** | `spec-redraft-leagues.md` **v2.13** (§7.3.8 · §8.3 · §8.6.1–8.6.3 · §8.6.8 · NEW §8.6.9 · §8.8 · §16.2 · §16.4 · §16.5.4 · E67–E70 · App A.4) |
| **MS breakdown** | `docs/specs/tasks-MS-mock-sandbox.md` (Architect, 2026-08-20; PR #184) |
| **MS task id prefix** | `MS.` |
| **MS spec fold** | `spec-redraft-leagues.md` **v2.15** (§8.7 · §8.8 · §19.2 · E75–E77) |
| **MP breakdown** | `docs/specs/tasks-MP-mock-practice.md` (Architect, 2026-08-21; PR #187 — **standalone mocks, base scoring templates, no league inheritance**; the league-attached practice launch is DEFERRED until league demand, per Chris) |
| **MP task id prefix** | `MP.` |
| **MP spec fold** | `spec-redraft-leagues.md` **v2.16** (§8.8 · E78–E80; Q23 lapsed, F85 de-targeted) |
| **MP release gate** | `NEXT_PUBLIC_FLAG_MOCK_DRAFTS` — never the `leagues` flag; everything must work with `leagues` OFF (E79) |
| **PROGRESS** | the same file — `docs/specs/PROGRESS-leagues.md` §2 carries all six checklists |

**The loop's order, precisely:**

1. Take the next unblocked **`DR.*`** task (dependency order in tasks-DR §5).
   *(**The DR lane is COMPLETE — DR.1–DR.8 all landed 2026-08-18**, so this step
   never fires again; the DR prerequisites in step 3 are all satisfied.)*
1a. **THE MOCK TRACK RUNS AHEAD OF THE LEAGUE LANES — take the next unblocked `MP.*` task
   first** (dependency order in `tasks-MP-mock-practice.md` §5; **D225–D233**, spec **v2.16**).
   Chris's ruling, 2026-08-21: standalone mocks are what users are invited to during the
   2026 launch, while league work waits for demand (*"until then we can invite users to come
   do mocks for practice"*) — and he opened the build in-session (*"perfect, lets build"*).
   `MP.1` (the storage investigation) is first and writes no code; its finding gates the
   lane's shape. **The lane's one cross-lane constraint: MP.4's launch dialog/RPC and MS.8's
   slot picker compose — one dialog, one RPC; whichever lands second composes, never forks.**
1b. **When no `MP.*` task is unblocked, take the next unblocked `AP.*` task** (dependency
   order in tasks-AP §7) before any remaining `L.C*` task. **`AP.4` is CLOSED with no code**
   (Q17's numbers already ship; Q23 lapsed with the standalone rewrite; the measurement is
   banked in the AP.4 closure row — do NOT re-run a ~52-minute mock to re-derive it). The
   remaining AP tasks are **AP.5 / AP.6 / AP.7**.
1c. **When no `MP.*` or `AP.*` task is unblocked, take the next unblocked `MS.*` task**
   (dependency order in `tasks-MS-mock-sandbox.md` §5, as re-read by tasks-MP §7) **before any
   remaining `L.C*` task.** The lane makes the mock launcher the commissioner of their own mock
   (**D216–D223**, spec **v2.15**). **MS.1, MS.4 and MS.6 serve the DEFERRED league-attached
   feature and are parked with it** (tasks-MP §7) — skip them until that feature returns.
   **One hard ordering constraint, and it is the only correctness-affecting one in the lane:
   `MS.7` must land BEFORE `MS.5` renders the order control.** `draft_set_order`'s route
   resolves `.eq('is_mock', false)`, so today the control is aimed at the REAL draft; it is
   live but latent, and rendering it in a mock room first makes the bug one click away
   (R468/D222).
2. When no `MP.*`, `AP.*` or `MS.*` task is unblocked, take the next **`L.C*`** engine task (tasks-M3 §6).
   **The three that remain — `L.C4.1`, `L.C5.1`, `L.C6.1` — must not be started while any
   `AP.*` task is unblocked** (the ordering above). `L.C6.1` additionally owes **F84**: the gate
   composes the AP suites by name.
3. ~~When **all three** are blocked~~ **[corrected 2026-08-25 — there is no "three": FIVE steps precede this one (1 DR, 1a MP, 1b AP, 1c MS, 2 L.C). Read it as: **when no `MP.*`, `AP.*`, `MS.*` or `L.C*` task is unblocked** — which, as of 2026-08-25, is the case: DR, AP, MP and L.C are all complete, and the only unchecked MS tasks (MS.1/MS.4/MS.6) are parked by step 1c. **SE is the live lane.**]** — or when Chris directs by name ("build SE.x") — take the
   next unblocked **`SE.*`** task (dependency order in tasks-SE §5). *(Its breakdown PR #161
   **merged 2026-08-19**, so this clause is live.)* The pure-TS opener
   chain (SE.1 → SE.2 → SE.3) touches no migration, so it is always safe to take while
   the schema lanes are contended. ~~**AP and SE contend for migration numbers 091+ and pgTAP 039+**~~ **[corrected 2026-08-25 — false in both halves: AP has ZERO unchecked tasks, and 091 / pgTAP 039 were consumed by `091_mock_cpu_reactive_bidding.sql` / `039_mock_cpu_reactive_bidding.sql` (AP.3). Heads on 2026-08-25 are **migration 102 / pgTAP 050**.]** — **the rule below is unchanged and is the half of this bullet that MATTERED:** both lanes confirm the real next-free with
   `ls supabase/migrations/` at task time (D161/D166); **neither trusts a number written in a planning document** — which is exactly what kept SE from
   colliding when every number its breakdown "expected" was taken out from under it.
4. **Do not start `L.C3.1` until DR.1, DR.4 and DR.5 have landed** — it builds into the
   new shell (tasks-M3 §6's amended banners carry the dependency). `L.C3.2` additionally
   waits on DR.3; `L.C3.3` on DR.5.
5. The M3 **engine** lane — `L.C1.3` → `L.C1.7`, `L.C2.1`, `L.C2.2` — has **no `DR.`
   dependency** and is never blocked by the redesign. Exception: **`L.C1.8`** (added
   2026-08-18, F57 ruled — snake pause-first alignment) is engine work that runs
   **AFTER DR.2 lands**, per its own banner's sequencing note (it resets the local DB
   and DR.2's browser fixtures live on the stack).

**Do not build `LV.*` or Scout tasks while M3 is active.**

---

## Completed: Redraft Leagues M2 — Snake draft engine

*(🟢 **Gate passed 2026-08-14** — L.B7.1, `npm run test:gate:m2` green
end-to-end in one run; every §2 checkbox checked; F49/F52/F53/F54 discharged.
PROGRESS-leagues.md §1 + the 2026-08-14 session-log entry are the record.
M3 continues in the same PROGRESS file under the `L.C` prefix.)*

---

## Paused: Lists v2 — Round 2 complete, no Round 3 queued

*(Parked 2026-08-13 with **both rounds shipped**: Round 1 (LV.1 – LV.11)
completed 2026-08-11; Round 2 (LV.12 – LV.17) landed 2026-08-12. The seven
LV.7 follow-ups (F-LV7.1 – F-LV7.7) in `PROGRESS-lists-v2.md` §5 remain
**filed items, not queued tasks** — queueing them as a Round 3 is a Chris
decision this file would record.)*

| | |
| --- | --- |
| **PROGRESS** | `docs/specs/PROGRESS-lists-v2.md` |
| **Delivery plan** | `docs/specs/delivery-plan-lists-v2.md` |
| **Design LAW** | `docs/design/lists/README.md` (+ prototype in `docs/design/lists/design/`) |
| **Task text** | Round 2 was the plan's §6 (Round 1 was §4 — corrected 2026-08-11, LV.12 review R210) |
| **Task id prefix** | `LV.` |

**Standing constraints for any reactivation** (full text in the plan §1):

- UI/UX only, with **three** exceptions, each individually ruled by Chris:
  (a) the `drafted` table (LV.1.2, 2026-08-09); (b) widening
  `list_players.tier`'s CHECK constraint (LV.1.5, 2026-08-09 — one
  `ALTER TABLE`, no new table or column); and (c) the `list_links` table plus
  its routes (LV.8, 2026-08-11 — *"we need a way to link back to resources
  used and a way for creators to attached videos to their lists"*).
  **That is the whole budget** — no fourth schema change, no other new API
  route. A task that thinks it needs one has left scope: stop and raise it.
  *(This row said "two" until 2026-08-11. Each exception was raised by a
  Builder rather than improvised around, and ruled on its own merits — the
  count moving is the process working, not the budget eroding.)*
- **Boards are off limits.** No task opens `src/components/big-board/**`,
  `src/stores/board-labels-store.ts`, or `src/components/lists/draft-mode/**`.
- ~~Everything lands behind `featureFlags.listsV2`.~~ **The flag was removed at
  LV.7 (2026-08-11)** — `/app/lists` serves the rebuilt page unconditionally and
  the legacy components are deleted. Nothing left to gate. **Round 2 shipped
  unflagged too**, which is why LV.15's app-shell host renders nothing when
  no window is open.
- **Round 2 composed Round 1, never re-solved it** (plan §6, D11).
  Grouping is `list-buckets.ts`, rows are `list-row-parts.tsx`, covers are
  `cover-tile.tsx`, marks are `use-draft-mode.ts`, reorder is
  `use-list-drag.tsx`, the mode control is `Segment`. A new surface that
  quietly reimplements one of these is the LV.7 failure repeating.
- Keep the app's ×0.8 token scale; implement colors from tokens, not the
  handoff's literal hex.
- **Browser verification runs against the LOCAL Supabase stack, never hosted.**
  `.env.local` points at the **hosted production** project, so `npm run dev`
  straight out of the box drives a real users' database — LV.12 did exactly
  that and left seven soft-deleted `LV12 tmp` rows in production (**R207**).
  Use the gitignored `.claude/launch.json` config **`dev-local`** (port 3123),
  which overrides `NEXT_PUBLIC_SUPABASE_URL` to `http://127.0.0.1:54321` with
  the keys from `npx supabase status`; confirm it took by checking a network
  request goes to `127.0.0.1:54321`. **State the verification environment in
  the PR body and in PROGRESS §4** — the LV.12 PR disclosed neither, which is
  what made the finding a should-fix rather than a note.
- **The local stack carries a deliberate saved-list fixture, and
  `supabase db reset` destroys it.** LV.12's fix round (**R208**) left a public
  list owned by the *second* local account (`dev-pro@fieldscout.local`),
  favourited from `dev@`, in the **local** DB on purpose — so the `saved` half
  of the collection is non-empty by default, which is the one condition LV.12's
  original verification never had. After a reset, **re-create it before
  verifying anything about saved lists**: a public list on the `dev-pro`
  account, favourited as `dev@` through the shipped
  `POST /api/lists/[id]/favorite`. Skip that and the verification reproduces
  R208 exactly — every observation taken over an empty array, looking green.
  Full detail in `PROGRESS-lists-v2.md` §4 item 6. *(Added 2026-08-11, LV.12
  review **R215** — the same "put it where the next Builder reads it" argument
  R207 made, applied to R207's own round's artefact.)*
- **There is a second deliberate local fixture, and the same reset destroys
  it.** LV.13 left **`LV13 local fixture — round board`** in the **local** DB on
  purpose: owned by `dev@fieldscout.local`, 8 players carrying tiers `r1`–`r4`.
  It is the **only** list on the local stack that can render a *round*-grouped
  column, which is what makes "each column groups independently" observable —
  without it every column groups by tier and a build that ignored per-column
  grouping entirely would produce identical-looking evidence. To re-create it
  after a reset: make a list on `dev@` in the UI, add ~8 players, then set the
  rounds directly —
  `docker exec supabase_db_fieldscout psql -U postgres -d postgres -c "update list_players set tier = 'r' || ((position - 1) / 2 + 1) where list_id = '<id>'"`
  — and switch the column's `dots` menu to **Rounds**. (`r1`–`r30` are legal
  because LV.1.5 widened `list_players.tier`'s CHECK constraint to
  `^([SABCDF]|r([1-9]|[12][0-9]|30)|c[1-4])$`; that is exception (b) above, not
  a new one.) The `update` was run to verify it — `UPDATE 8`, reproducing the
  fixture's exact `r1,r1,r2,r2,r3,r3,r4,r4` — so it is a tested instruction, not
  a remembered one. *(Added 2026-08-12, LV.13 review
  **R219** — R215's argument applied to R215's own round's successor: the
  fixture was documented only in `PROGRESS-lists-v2.md` §4, which is the
  placement R215 corrected one task earlier.)*
- **A third local-fixture note, and this one is a correction rather than a
  creation.** `Secret sleepers` (`aaaa1111-…ab99`) carried
  `lists.player_count = 3` against **2** `list_players` rows, so every surface
  that reads the denormalised count — the picker card, the rail row, the gallery
  card — said *"3 players"* for a 2-player list. Corrected 2026-08-12 (LV.17
  review **R247**) with
  `update lists set player_count = (select count(*) from list_players lp where lp.list_id = lists.id) where id = '…ab99'`,
  and the whole table then checked for the same drift (**0 rows**). It is
  recorded here because a `supabase db reset` re-seeds the fixture from whatever
  produced the drift in the first place: **after a reset, re-check
  `player_count` against `list_players` across the table before trusting any
  count on screen.** Nothing in the app writes that column from the client, so a
  wrong count is always seed drift, never a bug you are looking at.

---

## Not yet active: Scout

*(Specced and prototyped; no code written into the app. `PROGRESS-scout.md`
committed 2026-08-13 — it was sitting untracked in the working tree; Chris
ruled it committed. Activation is a Chris decision recorded here.)*

| | |
| --- | --- |
| **PROGRESS** | `docs/specs/PROGRESS-scout.md` |
| **Delivery plan** | `docs/specs/delivery-plan-scout.md` (v2.7) |
| **Spec (LAW)** | `docs/specs/spec-scout.md` (v2.7) |
| **Content** | `docs/specs/scout-content/` (registry, trait model, guides, lesson copy — done) |

---

## Switching builds

1. Finish the current cycle (PROGRESS current, `main` clean, no open PRs).
2. Move the milestone's row from **Active** to **Paused**, noting the task id
   it paused at and the date.
3. Promote the incoming one to **Active**.
4. Do not edit either PROGRESS file as part of the switch — they are each
   milestone's own memory and stay truthful about their own state.
