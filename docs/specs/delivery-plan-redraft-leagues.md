# Delivery Plan: Redraft Leagues + Custom Draft Engine

**Companion to:** `docs/specs/spec-redraft-leagues.md` (v2.7) — that spec defines *what*; this doc defines *how we build, test, fix, ship, and operate it* using Claude Code as the engineering team.
**Author:** Chris Daltas · **Date:** July 16, 2026 · **Status:** Ready

---

## 1. Principles (read before every session)

1. **The spec is law; the delivery plan is the sequencer.** Any deviation discovered mid-build gets written back into the spec (changelog entry) before the code merges — the spec never drifts behind the code.
2. **Prove it free before you pay for it.** Every feature in this build — draft, commissioner tools, live scoring, Alpha/Ultra — must run and demo cleanly against the `synthetic` stats tier (spec §23.6) before real or paid provider data enters the picture. A milestone that "needs the real feed to test" is a milestone that skipped building its `StatsProvider` abstraction correctly.
2. **Server-authoritative or it doesn't exist.** No client ever decides a turn, a clock, a price, a lock, or a score.
3. **Every bug becomes a test.** No fix merges without a failing-then-passing regression test. The test suite is the accumulated scar tissue of the project.
4. **Determinism everywhere.** Seeded schedules, seeded tiebreak coin flips, virtual clock, replayable stat feeds. If a behavior can't be reproduced from a seed + a fixture, it can't be debugged at 1:07pm on a Sunday.
5. **Draft night is the SLA.** A league that has a bad draft night doesn't come back. Everything about testing, freezes, and on-call flows from that.
6. **One task, one session, one commit train.** Claude Code gets one scoped task at a time with its Definition of Done; parallel agents work in separate git worktrees on non-overlapping surfaces.

---

## 2. Agent operating model ("a group of seasoned engineers and designers")

Claude Code plays distinct roles in distinct sessions. Roles never blend within a session — the reviewer must not be the author's context window.

| Role | Session input | Output | Cadence |
|---|---|---|---|
| **Architect** | spec section + current schema + this plan | Task breakdown, migration plan, interface sketches; updates spec if a gap is found | Start of each milestone |
| **Builder** | One task prompt (Appendix C style + DoD checklist §2.3) | Code + migrations + unit/integration tests + a self-review note | Continuous |
| **Red-team Reviewer** | The diff + the relevant spec sections + Appendix checklists | Findings list: security (RLS/RPC), concurrency, spec deviations, missing tests. Blocks merge on any Critical | After every Builder task |
| **QA Agent** | The merged build + acceptance criteria + simulator | Runs the gate suite for the milestone; files bugs in the tracker format (§5.2); writes new edge-case tests it discovers | End of each task cluster + nightly |
| **Design Reviewer** | Screens/flows vs `docs/06-DESIGN-SYSTEM.md` + §16 | Runs `design:design-critique` and `design:accessibility-review` skills; findings block only on accessibility/clarity failures. **Coverage checklist = spec §16.5**: every workflow row, state, and banner/badge in the catalog must exist before a UI milestone closes — a flow missing its empty/error/degraded states is an automatic finding | End of each UI task |

### 2.1 The build loop (Builder sessions run this until green, autonomously)
```
read task → read referenced spec sections → plan (write PLAN.md notes in the task branch)
→ migration first (if any) → typegen → implement → unit tests → pgTAP/RLS tests
→ run affected E2E subset → self-review against DoD checklist → fix → repeat
→ commit with task ID + summary of spec sections satisfied → hand to Reviewer
```
Stop conditions (halt and surface to Chris instead of looping): a spec ambiguity with product impact; any schema change not in the spec; any RLS policy loosening; any test deleted or weakened; loop exceeds 3 fix cycles on the same failure.

### 2.2 Context discipline
- `CLAUDE.md` gains a **Leagues** section pointing at: spec v2.0, this plan, the checklists (§8), and the simulator commands — so every fresh session self-orients in one read.
- Builders read *only* the sections the task names, plus §12 (schema) and §9 (realtime) which are always in scope. Reviewers read the diff first, spec second — fresh eyes by construction.
- Parallelization: max 3 Builder worktrees at once, partitioned by surface (e.g., draft engine / in-season / UI) with migrations serialized through a single "schema lane" to avoid conflicts.

### 2.3 Definition of Done (every task; Reviewer verifies literally)
- [ ] Referenced spec sections satisfied; deviations written back to the spec changelog
- [ ] Migration follows the checklist (§8.1); `npx supabase gen types` committed
- [ ] All new RPCs pass the RPC checklist (§8.3); all new tables pass the RLS checklist (§8.2)
- [ ] Unit tests for pure logic; pgTAP tests for policies/constraints; E2E updated if a user flow changed
- [ ] Idempotency: any client-triggered mutation is retry-safe (`action_id` or natural key)
- [ ] Realtime: any authoritative-table write reaches clients via a Broadcast trigger (§8.4); no Postgres Changes subscriptions added
- [ ] Structured logs carry `league_id`/`draft_id`; new failure modes have a metric or alert hook (§24)
- [ ] `npm run lint && npm run typecheck && npm run test` clean; affected E2E green
- [ ] Self-review note: what I'd flag if reviewing this cold

---

## 3. Build sequence & milestones

Maps spec §18 Phases A–F onto milestones with the v2.0 work slotted in. **Prerequisite reality:** the repo is in Phase 0; this epic starts after Phases 0–4 + Live Mode land. The 2026 NFL season (Sept 2026–Jan 2027) is therefore the **recording season**: M0 ships the fixture recorder against live 2026 data so the replay harness has a full real season in the can. **GA target: July 2027, ahead of 2027 draft season** (leagues draft mid-Aug–early Sept; GA must precede it by ≥6 weeks for beta soak).

| Milestone | Contents (spec refs) | Exit criteria (all must pass) |
|---|---|---|
| **M0 — Foundations for testability** *(build during Phases 0–4, small)* | **L.A0 (new):** `TimeProvider` abstraction (all engine/worker code reads injected time — never `Date.now()`/`now()` directly outside it); `StatsProvider` interface (§23.1); **L.A0b (new): `SyntheticStatsProvider`** (spec §23.6) with its versioned scenario library — the $0 tier every later milestone builds and gates against; **fixture recorder** capturing 2026-season provider responses + injury/inactive feeds to replayable files (real-data cross-check, still $0); `nfl_weeks` seed (§12.20) | A recorded NFL week replays through the ingestion path at 1×/4×/64× speed deterministically **and** every synthetic scenario (happy path, flex, postponement, mass-inactives, outage, in-window correction, post-window correction, charted-late, charted-revision) runs to a passing assertion with zero external calls |
| **M1 — League foundation** *(Phase A + v2.0 settings)* | Tasks L.A1–L.A2 with the v2.0 settings catalog (schedule_mode/median/second, locks, correction window), scoring **snapshot** plumbing, `league_weeks`; identity contract + seat-targeted invites + `team_managers` stints written from day one (spec §7.2/§7.2.1/§12.22–23); seed the scoring templates + template-picker UX (spec §7.3.3/App B — no custom editor in v1, which collapses the scoring QA matrix; **6 parity templates only (Chris, 2026-07-18; spec v2.7) — Alpha/Ultra cards return when advanced stats are funded**); DL preset + Hot Swap naming in the roster builder | Spec §18 Phase A gate + snapshot present from draft start + settings round-trip tested for every §7.3 field + **template parity tests** (each platform template's calculator output matches hand-computed scores for 5 canonical player-weeks) + *Alpha/Ultra backtest harness deferred — spec v2.7 re-scoped advanced stats to illustrative examples pending funding; M1 Architect re-cuts this gate item* |
| **M2 — Snake draft engine** *(Phase B)* | L.B1–L.B4 + v2.0: pause bookkeeping, K/D-ST autopick deferral, SKIP-LOCKED `draft-tick`, Broadcast-from-DB triggers + private channel auth (§9.2); **Mock Draft Mode (snake)** — the simulator bots exposed as in-product CPU opponents (spec §8.8: humanized timing, speed toggle, 72h expiry, recap) | Phase B gate + **simulator runs 25 concurrent bot snake drafts to completion, zero duplicates, zero stuck clocks** + reconnect <2s verified in E2E + a solo mock snake draft E2E (launch → CPU picks with realistic timing → finish → recap → zero league writes) |
| **M3 — Auction engine** *(Phase C)* | L.C1 + v2.0 endgame rules & solvency invariant (§8.6.7–8); mock auctions (spec §8.8 CPU bidders) | Phase C gate + property test: *no reachable sequence of bids/undos/commish budget edits violates solvency — including bot-driven mock auctions* + bid-storm E2E |
| **M4 — In-season core** *(Phase D, split)* | **L.D0 (new):** schedule engine + Remix (§11.7, incl. median/second computation into `team_week_results`); L.D1 lineups/locks/scoring/standings on the new tables; **L.D4 (new):** `score-league-week` fan-out (§22.2); **L.D5 (new):** `league_player_pool` + game-day locks (§7.3.4/§13.1) | Phase D gate **run twice**: first on `synthetic` (100 seeded leagues, every §23.6 scenario incl. tracking/charted two-phase settle proven on placeholder keys per M0 breakdown D15 — Alpha/Ultra proper deferred until funded, spec v2.7; the pipeline must pass here with zero real data before anything below matters) — then **replay a full recorded 2026 NFL week across 100 seeded leagues: scores match hand-computed fixtures to the cent; locks fire exactly at recorded kickoffs incl. the flexed game; Remix diff/confirm audited** |
| **M5 — Transactions** *(Phase D remainder)* | L.D2 waivers/FAAB (with `claim_order`, bench_lock), L.D3 trades (defer/reject lock behavior, invalidation job) | Phase D transaction gates + deterministic FAAB tiebreak property tests + E32–E37 all covered |
| **M6 — Commissioner Console + Audit** *(Phase E)* | L.E1 + v2.0 backstop trigger; **L.E2 (new):** stat-corrections pipeline + league corrections view (§23.4) | Phase E gate + *proof test:* no override path can mutate state without a log row (backstop trigger test) + a recorded real 2026 stat correction replays into a changed result with system note |
| **M7 — Hardening & GA** *(Phase F + §22.6/§24)* | L.F1 + the full k6 gate suite, chaos drills, runbook rehearsal, security review of RLS/RPC surface, accessibility pass, kill switches | §22.6 all green at target load · runbooks rehearsed once for real · zero S0/S1 open · 25-league friends-and-family beta completes a live draft weekend without a page |

**Beta ladder (inside M7):** staff league (1) → friends & family (5, incl. Chris's real league) → canary cohort (25 leagues, feature-flagged) → GA. Each rung runs ≥1 real draft and ≥2 scored weekends (simulated weekends via replay before the season, real ones after kickoff).

**Cut lines if the 2027 date pressures:** `second_opponent` (off-by-default anyway) → consolation/third-place brackets → public SEO page → hash-chain tamper evidence. **Never cut:** audit log, locks, correction handling, load gates.

---

## 4. QA strategy

### 4.1 The pyramid (what runs where)
| Layer | Tooling | Owns | Runs |
|---|---|---|---|
| Unit + property | Vitest + fast-check | scoring math (vs Appendix B fixtures), snake/3RR order, max-bid & solvency, FAAB resolution, bipartite slot-fit, tiebreaker chains, median/second results, schedule invariants (§11.7) — property tests over random seeds/team counts | every commit |
| DB (pgTAP) | supabase test | every RLS policy per role incl. non-member + blind-bid privacy; unique/exclusion constraints (E1, E8, matchup uniqueness); audit immutability incl. backstop trigger; RPC authorization *inside* functions | every commit |
| Integration | Vitest + local supabase | RPC flows end-to-end (pick race, undo cascade, trade execute, waiver run, remix confirm), idempotency replays, correction recompute honoring overrides | every commit |
| E2E | Playwright | full snake draft, full auction, disconnect/reconnect, commissioner override flows incl. illegal-lineup, a scored week, waiver morning, trade lifecycle, Remix preview/confirm | merge to main + nightly |
| **League Simulator** | custom harness (the crown jewel) | see §4.2 | nightly + milestone gates |
| Load/chaos | k6 + fault injection | §22.6 suite; kill realtime mid-draft; delay/duplicate provider rows; crash a worker mid-batch | weekly + M7 gate |

### 4.2 The League Simulator (build it in M2; everything else stands on it)
A headless harness that runs whole leagues at machine speed using the `TimeProvider` virtual clock and, by default, the `SyntheticStatsProvider` (spec §23.6) — recorded real fixtures (M0) are layered in as a cross-check, never a prerequisite:
- **Bots** with personalities (queue-drafter, sniper who bids at T-1s, AFK, chaos-monkey who double-taps everything, and **the Ghost** — abandons the league mid-season) drive real RPCs through the real API — never direct DB writes. The Ghost scenario exercises the full §7.2.1 lifecycle: vacate → orphan/autopilot weeks → seat-invite claim → takeover, and separately retire-&-succeed, asserting stint history integrity + standings inheritance + instant access revocation. **These same bot brains are the user-facing mock-draft CPU opponents (spec §8.8)** — one implementation, two consumers, so every mock a user runs is also exercising the tested path and every sim improvement makes mocks feel more human.
- **Scenarios as code:** `sim draft --leagues 25 --type auction --clock 5s`, `sim season --leagues 100 --weeks 14 --fixtures 2026-wk7 --speed 64x`, `sim sunday-storm --leagues 500 --speed 4x`, `sim backtest --template fs-ultra --season 2026` (re-scores the recorded season under a template; emits the calibration report for OQ 17).
- **Assertions after every scenario:** invariant sweep (exclusivity, solvency, roster legality, standings = recompute-from-scratch, audit row per override, pool/roster mirror consistency) + zero orphaned deadlines + zero unhandled worker errors.
- **Determinism:** every run prints its seeds; any failure replays exactly with `sim replay <run-id>`.
- Nightly CI: full-season sim across a settings matrix (8/12/16 teams — v1's full range per spec v2.6; snake/auction; FAAB/priority/none; median on/off; strict/lax locks; 1–2 divisions; the **6 parity templates always**, plus Alpha/Ultra whenever their feature flag is on — flagged Ultra runs inject T+1 charted-stat arrival + a mid-week YCO revision to exercise §23.5 two-phase scoring, and one run per night includes a rules key with no delivered stat to assert pending-not-zero, E61; one run per night forces a 3+-team playoff-seeding tie to assert the head-to-head skip, E63). A red nightly blocks all merges until triaged.

### 4.3 Test data
**Primary:** the `SyntheticStatsProvider` scenario library (spec §23.6) — versioned, deterministic, covers every case below on demand without waiting for a real NFL week to produce it. **Cross-check:** recorded 2026 fixtures (M0) provide the real-world sanity check once synthetic passes — at least one week containing each of a Thursday game, an international 9:30am ET kickoff, a flexed SNF, a real postponement (if one occurs), a real stat correction that flips a result, and a mass-inactives Sunday. Both are versioned in-repo; synthetic is written first and used far more often.

---

## 5. Bug squashing

### 5.1 Severity & response
| Sev | Definition | Response |
|---|---|---|
| **S0** | Draft room down/corrupting, scoring materially wrong league-wide, data loss, security/RLS breach | Drop everything; kill switch if applicable (§24.2); hotfix path (§6); postmortem within 48h |
| **S1** | A league blocked (stuck draft, waiver run failed, wrong result standing) with no self-serve fix | Same day; commissioner override is a *mitigation*, never the fix |
| **S2** | Wrong but recoverable (UI state desync, notification miss, cosmetic score lag) | Next release train |
| **S3** | Polish, copy, minor UX | Backlog, batched |
In-season, S0/S1 found on a game day get fixed **forward** with data repair scripts that are themselves reviewed + tested; never manual prod SQL.

### 5.2 Mechanics
- **Bug template:** repro steps or sim seed · expected vs actual (spec section cited) · league/draft id · severity · *the regression test that will prove the fix*. A bug without a spec citation is either a spec gap (fix the spec too) or not a bug.
- **Triage:** QA Agent triages nightly-sim and beta reports each morning session; anything touching money-shaped state (FAAB, budgets), exclusivity, or the audit log auto-escalates one severity.
- **Flake policy:** a flaky test is an S1 against the test itself — quarantined ≤72h with an owner, then fixed or the underlying race fixed. Flakes in draft-engine tests are treated as *real concurrency bugs until proven otherwise* (they usually are).
- **Every fix ships with:** the regression test, a changelog line, and — if a league was affected in beta — a commissioner-visible system note in that league (transparency is the brand even for our own bugs).

---

## 6. Release engineering

- **Trains:** merge to `main` behind flags continuously; deploy to staging on merge; production train 2×/week off-season, **1×/week in-season (Tue)**, freeze Thu 7pm ET → Tue 6am ET (§24.2).
- **Hotfix path (S0/S1 only):** branch from prod tag → fix + regression test → Reviewer session (mandatory even at 1am) → deploy → backport. Kill switches buy the time to do this right.
- **Migrations:** expand → backfill (idempotent script, batched) → contract in a later train; in-season, contract steps wait for the off-season unless trivially safe. Every migration rehearses on a staging clone of prod data first.
- **Flags:** per-league `settings.flags` (spec §24.2) gate every new engine behavior; canary cohort graduates a flag only after one clean weekend.
- **Environments:** local (supabase start + simulator) → staging (prod-shaped seed: 500 sim leagues, recorded fixtures on a loop) → prod. Staging runs the Sunday-storm replay every Saturday as a standing rehearsal.

---

## 7. Game-day operations (in-season rhythm)

- **Tue:** release train · waiver-morning verification query (every league's run completed; zero stuck claims).
- **Wed–Thu:** correction-window close audit — reconciliation job green, `final (pending corrections)` → `final` counts match; any post-window corrections surfaced to commissioners.
- **Thu/Sun/Mon (games):** dashboard watch during windows (scoring lag, tick lag, quota headroom per §24.1); on-call = Chris + a standing Claude Code incident session with runbooks pre-loaded.
- **Draft-season evenings (Aug–Sep):** treat 7–11pm ET like game windows; draft-stuck alert is page-worthy.
- Weekly 30-min ops review: alerts fired, near-misses, one runbook improved. Postmortems are blameless, written by the QA Agent, and always end in a test or an alert.

---

## 8. Checklists (Reviewer verifies literally; copies live in `docs/checklists/`)

**8.1 Migration** — additive-first · RLS enabled + policies in the same migration as the table · indexes for every FK used in policies/joins · `IF NOT EXISTS` guards · staging-clone rehearsal noted · typegen committed · realtime broadcast trigger added if the table is client-visible.

**8.2 RLS** — SELECT scoped by `is_league_member`/ownership (blind data: owner+commish only) · no client INSERT/UPDATE/DELETE unless the spec names it (`league_chat`, own `waiver_claims`, own `draft_queues`, own `lineup_swaps`) · deny-by-default confirmed by a pgTAP negative test per role · immutable tables have **no** UPDATE/DELETE policy · policies use the helper fns, never inline subqueries on hot paths.

**8.3 RPC** — `SECURITY DEFINER SET search_path = ''` · authorization re-checked in-body · draft/league row locked before validation · single transaction incl. audit insert for overrides (+ GUC for the backstop trigger) · idempotency key honored · returns new authoritative state · friendly, specific error strings (they are UX) · held-lock time asserted <50ms in an integration test.

**8.4 Realtime** — change reaches clients via Broadcast-from-DB trigger on a private channel · payload column-selected, nothing blind/private · authorization policy on `realtime.messages` covers the topic · client refetch-on-reconnect path exercised in E2E · no new Postgres Changes subscriptions anywhere in the diff.

---

## 9. Session prompt templates (abbreviated; full versions in `docs/05-CLAUDE-CODE-PROMPTS.md` style)

**Builder:** "You are the Builder for Task {ID}. Read spec §{refs}, delivery plan §2.1–2.3, and checklists §8. Run the build loop until DoD passes. Stop conditions per §2.1. Deliver: code, tests, migration, self-review note."

**Reviewer:** "You are the Red-team Reviewer for {branch}. You did not write this. Read the diff first. Verify DoD §2.3 line-by-line and checklists §8 literally. Attack: concurrency (draft races, lock windows), RLS leaks (write the pgTAP test that would catch one), spec deviation, missing edge cases from §19.2. Output: Findings (Critical/Major/Minor) with file:line. Critical blocks merge."

**QA Agent (nightly):** "Run `sim nightly`. Triage failures per delivery plan §5. For each new failure: minimal repro seed, severity, spec citation, the regression test to write. File in the tracker format. Then pick the top S2 from the backlog and fix it through the Builder loop."

---

## Changelog
- **v1.0 (2026-07-16):** Initial delivery plan accompanying spec v2.0.
- **v1.1 (2026-07-17):** Aligned to spec v2.5's `SyntheticStatsProvider` (§23.6). New principle #2 ("prove it free before you pay"); M0 gains the synthetic provider + scenario library as an explicit deliverable (L.A0b), ahead of and independent from the real-data fixture recorder; M4's Phase D gate now runs on synthetic first and real-2026 replay second; the League Simulator (§4.2) and its test data (§4.3) default to synthetic, with recorded real fixtures repositioned as a cross-check rather than the primary QA input.
- **v1.2 (2026-07-17):** Aligned to spec v2.6. Nightly sim matrix narrowed to v1's actual size range (8/12/16, not 8/12/20) and gained a forced 3+-team playoff-tie scenario (E63).
- **v1.3 (2026-07-18):** Aligned to spec v2.7 (advanced stats re-scoped to illustrative examples, deferred until a paid/owned stats source is funded). M1 exit criteria: Alpha/Ultra backtest harness (OQ 17) deferred out of the gate — the M1 Architect re-cuts it when advanced stats are un-punted. Nightly-matrix Alpha/Ultra runs remain conditional on their feature flag (off until funded). M0 unchanged: the synthetic provider still proves `tracking`/`charted` machinery, now with placeholder keys (M0 breakdown D15). Follow-up same day: the v1 template picker ships the **6 parity templates only** (no Alpha/Ultra teaser cards) — M1 contents updated.
