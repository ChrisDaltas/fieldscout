# Progress: Redraft Leagues

> **Read this file at the start of every session. Update it at the end of every session.**
> This is the build's memory across sessions — the spec (`spec-redraft-leagues.md`) and delivery plan (`delivery-plan-redraft-leagues.md`) don't change task-to-task; this file does. If you're a fresh session with no other context, this file plus the two docs it points to is everything you need to pick up exactly where the last session left off.

**Spec:** `docs/specs/spec-redraft-leagues.md` — v2.6 (LAW — see CLAUDE.md)
**Delivery plan:** `docs/specs/delivery-plan-redraft-leagues.md` — v1.2
**Last updated:** *(not yet started — update this line every session)*
**Updated by:** *(session type, e.g. "Architect", "Builder — Task L.A0")*

---

## 1. Milestone status

Mirrors delivery plan §3. Update the Status column only — Contents/Exit criteria are the source-of-truth summary; if they ever drift from the delivery plan, the delivery plan wins and this table gets corrected, not the other way around.

| Milestone | Contents (spec refs) | Exit criteria | Status |
|---|---|---|---|
| **M0 — Foundations for testability** | `TimeProvider` abstraction; `StatsProvider` interface (§23.1); `SyntheticStatsProvider` + scenario library (§23.6); fixture recorder (2026 season); `nfl_weeks` seed (§12.20) | Recorded NFL week replays deterministically at 1×/4×/64×; every synthetic scenario (happy path, flex, postponement, mass-inactives, outage, in-window correction, post-window correction, charted-late, charted-revision) passes with zero external calls | ⬜ Not started |
| **M1 — League foundation** *(Phase A)* | L.A1–L.A2; v2.0 settings catalog; scoring snapshot; `league_weeks`; identity contract + seat-targeted invites + `team_managers` stints (§7.2/§7.2.1/§12.22–23); 8 scoring templates + picker UX; DL/Hot Swap naming | Phase A gate; snapshot present from draft start; settings round-trip tested; template parity tests (5 canonical player-weeks/platform); Alpha/Ultra backtest harness runs (OQ 17) | ⬜ Not started |
| **M2 — Snake draft engine** *(Phase B)* | L.B1–L.B4; pause bookkeeping; K/D-ST autopick deferral; SKIP-LOCKED `draft-tick`; Broadcast-from-DB (§9.2); Mock Draft Mode (snake) | Phase B gate; 25 concurrent bot snake drafts, zero duplicates/stuck clocks; reconnect <2s; solo mock snake draft E2E | ⬜ Not started |
| **M3 — Auction engine** *(Phase C)* | L.C1; endgame rules & solvency invariant (§8.6.7–8); mock auctions | Phase C gate; solvency property test incl. bot-driven mocks; bid-storm E2E | ⬜ Not started |
| **M4 — In-season core** *(Phase D, split)* | L.D0 schedule engine + Remix; L.D1 lineups/locks/scoring/standings; L.D4 `score-league-week` fan-out (§22.2); L.D5 `league_player_pool` + game-day locks | Phase D gate run **twice**: synthetic first (100 leagues, all §23.6 scenarios, Alpha/Ultra two-phase) — must pass before proceeding — then real-2026 replay (100 leagues, cent-accurate, flexed-game locks, Remix audited) | ⬜ Not started |
| **M5 — Transactions** *(Phase D remainder)* | L.D2 waivers/FAAB (`claim_order`, bench_lock); L.D3 trades (lock behavior, invalidation job) | Phase D transaction gates; deterministic FAAB tiebreak property tests; E32–E37 covered | ⬜ Not started |
| **M6 — Commissioner Console + Audit** *(Phase E)* | L.E1; backstop trigger; L.E2 stat-corrections pipeline + corrections view (§23.4) | Phase E gate; proof test — no override bypasses the log; a recorded real correction replays into a changed result with system note | ⬜ Not started |
| **M7 — Hardening & GA** *(Phase F + §22.6/§24)* | L.F1; full k6 gate suite; chaos drills; runbook rehearsal; RLS/RPC security review; accessibility pass; kill switches | §22.6 green at target load; runbooks rehearsed; zero S0/S1 open; 25-league F&F beta completes a live draft weekend without a page | ⬜ Not started |

**Status key:** ⬜ Not started · 🟡 In progress · 🟢 Gate passed · 🔴 Blocked (see Blockers below)

**Prerequisite reality:** this epic starts after repo Phases 0–4 + Live Mode land (delivery plan §3). Confirm that's true before M0 begins; if not, this build is blocked on the base app, not on itself.

---

## 2. M0 task checklist *(the immediate next work)*

- [ ] `TimeProvider` abstraction — all engine/worker code reads injected time; no raw `Date.now()`/`now()` outside it
- [ ] `StatsProvider` interface (§23.1) — `getWeekStats`, `getGameStates`, `getInjuries/Inactives`, `getSchedule`
- [ ] `SyntheticStatsProvider` (§23.6) — fabricates `core_box` + `tracking` + `charted` tiers on the `TimeProvider` virtual clock
- [ ] Synthetic scenario library, versioned in-repo: happy path · flexed/moved kickoff · postponed game · mass-inactives Sunday · provider outage (`stats_degraded`) · in-window correction · post-window correction (flagged, not auto-applied) · charted feed late · charted feed revises after posting
- [ ] Fixture recorder — captures live 2026-season provider responses + injury/inactive feeds to replayable files (real-data cross-check)
- [ ] `nfl_weeks` seed (§12.20)
- [ ] Exit criteria demonstrated: a recorded week replays deterministically at 1×/4×/64×; every synthetic scenario passes with zero external calls

---

## 3. Spec questions

*Anything where the spec is ambiguous, silent, or seems wrong. Write it here and STOP rather than improvising — per CLAUDE.md. Move to "Resolved" once Chris answers; the answer should also get folded back into the spec itself as a changelog entry.*

### Open
*(none yet)*

### Resolved
*(none yet)*

---

## 4. Decisions log

*Build-time engineering decisions made during implementation that aren't spelled out verbatim in the spec — naming, library choices, minor sequencing calls. Product/scope decisions belong in the spec's own changelog (see spec-redraft-leagues.md), not here; this log is for "how we built it," not "what we're building."*

*(none yet)*

---

## 5. Blockers

*Anything currently stopping forward progress — a spec question awaiting an answer, a prerequisite phase not yet landed, a flaky test blocking a merge, an infra limit. Delete once resolved.*

*(none yet)*

---

## 6. Session log

*One line per session: date, session type, what shipped, what's next. Newest on top. Keep entries short — this is a changelog, not a diary; detail belongs in commit messages and PRs.*

| Date | Session | Shipped | Next |
|---|---|---|---|
| — | — | *(not yet started)* | Kick off M0 with the Architect session |
