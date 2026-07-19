# Progress: Redraft Leagues

> **Read this file at the start of every session. Update it at the end of every session.**
> This is the build's memory across sessions — the spec (`spec-redraft-leagues.md`) and delivery plan (`delivery-plan-redraft-leagues.md`) don't change task-to-task; this file does. If you're a fresh session with no other context, this file plus the two docs it points to is everything you need to pick up exactly where the last session left off.

**Spec:** `docs/specs/spec-redraft-leagues.md` — v2.6.1 (LAW — see CLAUDE.md)
**Delivery plan:** `docs/specs/delivery-plan-redraft-leagues.md` — v1.2
**M0 task breakdown:** `docs/specs/tasks-M0-foundations.md` (Architect, 2026-07-18)
**Last updated:** 2026-07-18
**Updated by:** Architect — M0

---

## 1. Milestone status

Mirrors delivery plan §3. Update the Status column only — Contents/Exit criteria are the source-of-truth summary; if they ever drift from the delivery plan, the delivery plan wins and this table gets corrected, not the other way around.

| Milestone | Contents (spec refs) | Exit criteria | Status |
|---|---|---|---|
| **M0 — Foundations for testability** | `TimeProvider` abstraction; `StatsProvider` interface (§23.1); `SyntheticStatsProvider` + scenario library (§23.6); fixture recorder (2026 season); `nfl_weeks` seed (§12.20) | Recorded NFL week replays deterministically at 1×/4×/64×; every synthetic scenario (happy path, flex, postponement, mass-inactives, outage, in-window correction, post-window correction, charted-late, charted-revision) passes with zero external calls | 🟡 In progress (Architect done; Builder tasks not started) |
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

Task breakdown, interface sketches, and per-task Builder prompts: **`docs/specs/tasks-M0-foundations.md`**. Dependency order: L.A0.1 → L.A0.2a → {L.A0.2b, L.A0.3, L.A0.4 parallel} → L.A0.6; L.A0.5a → L.A0.5b independent (schema lane). **Q2 gates L.A0.2a/3/4** (see §3); L.A0.1 and L.A0.5a/5b can start now.

- [ ] **L.A0.1** — `TimeProvider` abstraction + ESLint time-guard — all engine/worker code reads injected time; no raw `Date.now()`/`now()` outside it
- [ ] **L.A0.2a** — `StatsProvider` interface (§23.1: `getWeekStats`, `getGameStates`, `getInjuries` + `getInactives`, `getSchedule`) + `STAT_KEYS` registry (§23.5) + `SleeperStatsProvider` adapter *(advanced keys gated by Q2)*
- [ ] **L.A0.2b** — ingestion seam: `syncLiveStats` consumes injected provider + time (single caller: sync-live cron route)
- [ ] **L.A0.3** — `SyntheticStatsProvider` (§23.6) + scenario library, versioned in-repo: happy path · flexed/moved kickoff · postponed game · mass-inactives Sunday · provider outage (`stats_degraded` via `DegradationTracker`) · in-window correction · post-window correction (flagged, not auto-applied) · charted feed late · charted feed revises after posting *(gated by Q2)*
- [ ] **L.A0.4** — Fixture recorder + replay provider + `record:fixtures` CLI — captures live 2026-season provider responses + injury/inactive feeds to replayable files *(Q1 caveat: sleeper_free recordings carry no official inactives/kickoff timestamps until Q1 is decided; gated by Q2 for check-ins)*
- [ ] **L.A0.5a** — local Supabase stack + pgTAP bootstrap (first in repo)
- [ ] **L.A0.5b** — `nfl_weeks` migration 037 + 2026 seed (§12.20)
- [ ] **L.A0.6** — M0 gate harness: recorded week replays deterministically at 1×/4×/64× (D11 reading); all nine synthetic scenarios pass with zero external calls; calendar assertion against seeded `nfl_weeks`

**Ops note:** live 2026 fixture recording starts with the season (~Sept 10) — schedule `record:fixtures` for game windows then; the M0 gate re-runs against the first real 2026 recorded week. Q1 wants an answer before September.

---

## 3. Spec questions

*Anything where the spec is ambiguous, silent, or seems wrong. Write it here and STOP rather than improvising — per CLAUDE.md. Move to "Resolved" once Chris answers; the answer should also get folded back into the spec itself as a changelog entry.*

### Open

**Q1 — `sleeper_free` can't meet the live-provider hard requirements (kickoff timestamps + official inactives).** Spec §23.1 (line ~1820) makes official inactives ~90 min pre-kickoff and in-game injury designations "a hard requirement of whichever *live* provider is running," and §23.3 derives every lock from `nfl_games.kickoff_at` at evaluation time. Surveyed reality: the free Sleeper schedule endpoint returns day-granularity dates only (no kickoff timestamps), there is no official-inactives feed in the current integration (injuries arrive only as columns on `players` from the roster dump), and nothing writes `nfl_games`. Consequences: (a) the M0 fixture recorder will capture injuries but **no official inactives and no kickoff timestamps** from this tier; (b) `sleeper_free` cannot host real beta leagues (M4 gate: "locks fire exactly at recorded kickoffs") without a supplementary source.
**Recommendation:** keep `sleeper_free` for stats, supplement schedule/kickoffs (and likely inactives) from a free source — nflverse schedules carry kickoff datetimes and we already use nflverse in `scripts/load-historical-stats.py`; evaluate ESPN's public scoreboard as the inactives/game-state source. Decide **before the September recording season** so the 2026 fixture library isn't missing these feeds; hard-required before M4.
**M0 impact if unanswered:** none for L.A0.1/2a/2b/3/5a/5b/6 (synthetic fabricates kickoffs + inactives per §23.1); L.A0.4 proceeds with the gap documented in-code.

**Q2 — canonical advanced stat-key names: §23.5 vs Appendix B conflict.** §7.3.3's calculator is a generic dot-product over **one shared key namespace** (`score = Σ rules[key] × stat(key)`) — rules keys and stat keys must be identical, no translation layer. But §23.5 (line ~1848) names the stored keys `air_yards` / `yards_after_catch`, while Appendix B.2 scores `receiving_air_yards` / `receiving_yac`. (`rush_yards_after_contact` agrees in both.) M0 bakes the chosen names into `STAT_KEYS`, synthetic advanced payloads, and checked-in fixtures — resolving the other way later forces rekeying M0 artifacts.
**Recommendation:** Appendix B names win (`receiving_air_yards`, `receiving_yac`) — they're the user-facing scoring catalog with worked examples, and the `receiving_` prefix leaves room for QB-side air-yard keys later; fix §23.5's two names via a spec changelog entry.
**Gates:** L.A0.2a advanced-key seeding, L.A0.3 synthetic advanced payloads, L.A0.4 fixture check-ins. L.A0.1 and L.A0.5a/5b are unaffected and can start now.

### Resolved
*(none yet)*

---

## 4. Decisions log

*Build-time engineering decisions made during implementation that aren't spelled out verbatim in the spec — naming, library choices, minor sequencing calls. Product/scope decisions belong in the spec's own changelog (see spec-redraft-leagues.md), not here; this log is for "how we built it," not "what we're building."*

**2026-07-18 — Architect (M0).** Full rationale in `docs/specs/tasks-M0-foundations.md` §3:
- **D1** Engine home `src/lib/leagues/` — pure TS (no Next/Node APIs, no `process.env`, no `fetch` outside adapters) so it ports to Deno Edge Functions later.
- **D2** `TimeProvider` = `{ now(): Date }`; `VirtualClock` has step mode + wall-paced 1×/4×/64×.
- **D3** ESLint ban on `Date.now()`/argless `new Date()` in `src/lib/leagues/**` + `src/lib/sync/live-stats.ts` (mechanical, not convention).
- **D4** Spec's "`getInjuries/Inactives`" (§23.1) = two methods, `getInjuries` + `getInactives` (different shapes/cadences).
- **D5** One canonical stat-key namespace seeded from Appendix B.1–B.5 (names pending Q2); `storage: 'column'|'advanced'|'deferred'`; keys without columns not persisted in M0; capability *gating* starts M1.
- **D6** Fixture format: JSONL.gz in-repo, `{t, method, args, ok, status, body}`, replay = latest response ≤ virtual now.
- **D7** Pre-September gate data: synthetic multi-poll recording is the determinism fixture; a recorded real 2025 week is the cross-check; gate re-runs on the first real 2026 week.
- **D8** No `player_stats.advanced` migration in M0 (first persisting milestone adds it).
- **D9** pgTAP + local-stack bootstrap pulled into M0 (L.A0.5a) — DoD §2.3 requires it and the repo has none.
- **D10** `nfl_weeks` broadcast-trigger waiver: plan §8.1's realtime line waived (no subscribers; seed-only service-role writes); trigger ships with the milestone that live-updates `first_kickoff_at`/`last_game_ends_at`.
- **D11** 1×/4×/64× gate reading: full week step-driven ×3 identical + wall-paced ≥3-poll-interval slice equivalence (a full week at 1× is ~5 days — infeasible).
- **D12** Refactored ingestion stamps `updated_at` from injected time (deliberate payload change; wall-clock stamp at live-stats.ts:114 would break replay determinism by construction).
- **D13** Spec erratum v2.6.1: `nfl_games.kickoff` → `kickoff_at` (5 refs; matches deployed 001 schema).
- **D14** `source: 'sleeper'` preserved exactly through the seam refactor (002's `'live'` comment is stale; downstream branches on in-use values).

---

## 5. Blockers

*Anything currently stopping forward progress — a spec question awaiting an answer, a prerequisite phase not yet landed, a flaky test blocking a merge, an infra limit. Delete once resolved.*

*(none yet)*

---

## 6. Session log

*One line per session: date, session type, what shipped, what's next. Newest on top. Keep entries short — this is a changelog, not a diary; detail belongs in commit messages and PRs.*

| Date | Session | Shipped | Next |
|---|---|---|---|
| 2026-07-18 | Architect — M0 | M0 task breakdown (`tasks-M0-foundations.md`: L.A0.1–L.A0.6 incl. 2a/2b + 5a/5b splits, interface sketches, migration 037 plan, exit-criteria proof map; adversarially reviewed, 17 findings applied); spec erratum v2.6.1 (`kickoff_at`); Spec Questions Q1 (sleeper_free kickoffs/inactives) + Q2 (advanced stat-key names) filed; decisions D1–D14 logged | Chris answers Q1/Q2 (Q2 gates L.A0.2a/3/4; both want answers before Sept). Builders can start L.A0.1 and L.A0.5a now |
