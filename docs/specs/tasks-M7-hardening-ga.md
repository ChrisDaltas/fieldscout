# M7 Task Breakdown — Hardening & GA (L.F1 Phase F polish + L.F2 hardening)

> **Architect session output — 2026-10-03; rulings folded 2026-10-19.** Read together with `spec-redraft-leagues.md` (the LAW — §18 Phase F, §22.6, §24 incl. §24.4) and `delivery-plan-redraft-leagues.md` **v1.4** (§3 M7 row, `delivery-plan-redraft-leagues.md:72`; the beta ladder, `:76`; the 2026 alpha, `:78–82`; M8, `:74`). This doc sequences M7 into Builder-sized tasks; it never overrides the spec. One task per Builder session, one PR per task, in dependency order (§7).
>
> **APPROVED by Chris 2026-10-19** (*"do M7 next"*, after M8) with the rulings on Q88–Q94 he gave 2026-10-02/03 (PROGRESS §3, all ANSWERED; folded below — §11 keeps the original question text with each ruling). ACTIVE-BUILD points here; first takeable task **L.F2.0** (the spec fold-back). In short: **Q88 (a)** test at 2026 size now, GA size before launch · **Q89 (a)** a separate hosted test project · **Q90 (c)** internal security review now, outside review before launch · **Q91 none** — no emergency switches and no alerts until launch; refined by **Q102** (2026-10-08): M8's manual `job_pauses` buttons are the one mechanism, and M7 adds only the automatic / alert side on top of it, at launch · **Q92 (a)** the 2026 test leagues count for the beta weekend · **Q93 none** — none of the Phase F extras are in · **Q94 (a)** M8 first (done — the console, `job_pauses`, `platform_operator_actions` and the state views are on `main`).
>
> **Two windows (TD9).** Most of M7 is takeable now (the **2026 window**). Five tasks wait for the **pre-launch window** (before GA, July 2027) because a ruling deferred them to launch: L.F2.4 (alerts), L.F2.5 (automatic trips), L.F2.13 (GA-size load run), L.F2.14 (outside security review), closed by L.F2.15 (the launch gate re-run). `/build-next` does not take a pre-launch task until Chris says the launch window is open.
>
> **Process rule — "lighten it" (Chris, 2026-09-27).** Pre-launch, **FULL** rigour (adversarial review until clean, pgTAP per role, break probes shown) only for **scoring, standings/results, permissions and production writes**. Everything else gets **ONE PASS**; nits become follow-ups; ledger notes stay short. Every task is tagged.
>
> **One local DB (standing rule).** Worktrees do not isolate Supabase. Every task is flagged **parallel-safe: yes** (docs, UI-only, static review, scripts that run against nothing local) or **parallel-safe: no (needs local DB)**. Only one "no" task may run at a time. The hosted test project (Q89) is a second shared resource: one task on it at a time.
>
> **Task ids.** The plan names **`L.F1`** for Phase F; this doc uses **`L.F1.*`** for the §18 Phase F polish items and **`L.F2.*`** for the hardening/GA work (load, chaos, runbooks, security, alerts, beta, gate).
>
> **Needs Chris outside the repo (§12).** The test project (**C1**) blocks L.F2.2, L.F2.10 and the run half of L.F2.1 — and M8's own L.G2.1 drill. Nothing else in the 2026 window waits on him.

---

## 1. Scope & exit criteria

**In M7 (plan §3 M7 row; spec §18 Phase F, §22.6, §24) — as ruled:**
- **L.F1 — Phase F polish** (§18): the full accessibility pass (F55, F73, F78) and Lighthouse/CWV. **Q93 "none of it":** the draft-order reveal, notifications wiring, History tab, tamper-proof audit chain, public league page, auto-sub and the 16/20-team draft-room performance test are **not in M7** (§1 "Not in M7").
- **L.F2 — hardening:** the full k6 §22.6 suite (four scenarios), run at **2026 size now and GA size before launch** (Q88 (a)) on the **hosted test project** (Q89 (a)); chaos drills (kill realtime mid-draft, delay/duplicate provider rows, crash a worker mid-batch — plan `:98`); the §24.3 runbooks, written and rehearsed once for real on the test project; an **internal** security review of the RLS/RPC/grant surface now — including M8's operator surface — and an **outside** one before launch (Q90 (c)); the §22.5 rate limits (F41); the beta ladder with the 2026 test leagues (Q92 (a)); the M7 gate.
- **Pre-launch window only (Q91 / Q102):** the §24.1 alerts that page a human (F330, F332) and the automatic side of the §24.2 controls, built on M8's `job_pauses`.

**Exit criteria (plan, verbatim):** (1) §22.6 all green at target load · (2) runbooks rehearsed once for real · (3) zero S0/S1 open · (4) 25-league friends-and-family beta completes a live draft weekend without a page.
- **As ruled:** (1) "target load" = 2026 size for the 2026 gate (L.F2.12), GA size for the launch gate (L.F2.15) — Q88 (a). (4) is met by the 2026 test leagues at whatever number they reach (Q92 (a)); with no alerts before launch (Q91), "without a page" is recorded as TD10 says and Chris rules on the record.

**Not in M7 (named so nobody builds them by accident):**
- **Anything M8 built** — the admin console (`/app/admin`), `job_pauses` + `op_pause_job` / `op_resume_job` / `op_run_job_now`, `platform_operator_actions`, `op_league_state` / `op_platform_state` (incl. `overdue_weeks`), notices, game status. M7 **reuses** them; it never adds a second switch table or a second ops log (TD3).
- **Q93 — none of the Phase F extras:** draft-order reveal animation (was L.F1.2), league-event notifications (was L.F1.3), History Mode tab, hash-chain tamper-evidence, public league SEO page, optional auto-sub inactives, and the 16/20-team draft-room performance test (was half of L.F1.4). Post-launch, unscheduled.
- **Before launch only, by ruling:** alerts and automatic trips (Q91 / Q102), the GA-size load run (Q88), the outside security review (Q90).
- Paid stats provider contract (OQ14) and any billing (free-only launch).
- No new API routes or schema for UI-only surfaces.

---

## 2. Current state (re-measured 2026-10-19 on `main` @ `b19365b`)

- Migrations head **198**, pgTAP head **148** (measure again at build time — D161). Gates `test:gate:m0…m6` exist; **`test:gate:m8` does not yet** (M8's L.G2.1 / L.G2.2 are unticked in PROGRESS §2 — L.G2.1 needs the same test project, C1).
- **Exists:** `system_flags` (122) with `stats_degraded` and the `autopilot_disabled` kill switch (125/139); cron ping + stall check (124); draft pause semantics (069); the reconciliation job (L.D2.3); one runbook (`runbook-hosted-migration-reconciliation.md`). **From M8:** the operator gate `is_platform_operator()` + `platform_operator_actions` (182, D511); `job_pauses` with pause / resume / run-now for `waivers`, `week-advance`, `week-finalize` read by the jobs themselves (183, D512); notices (185, D516); game status + `operator_hold` (184, D513); `op_league_state` / `op_platform_state` incl. last cron runs and `overdue_weeks` (186 / 194, D518 / D524); the admin console UI (D519, D521).
- **Does not exist:** any k6 script; the hosted test project (Q89 — C1); an automatic trip on `job_pauses`; pause-all-drafts or freeze-scoring (not built by ruling — spec §24.2 v2.16.89 note); an alert that reaches a human outside pg_cron (F330); any §24.3 runbook; rate limits (F41).
- **Measured load finding already on file:** F311 — locally the app emits broadcasts ~5x faster than the realtime tenant carries at 25 concurrent drafts, and the overflow drops silently. At 2026 size (about 5 drafts) scenario 1 may not reach it; the GA-size run (L.F2.13) will.

---

## 3. Design decisions (Architect; TD1–TD11 — L.F2.0 enters them in PROGRESS §4 as D-numbers)

- **TD1 — Target load is a parameter, not a constant.** Every k6 scenario reads its sizes from one config file with two named profiles, `y2026` and `ga` (Q88 (a)). Same scripts serve both.
- **TD2 — k6 runs against the hosted test project (Q89 (a)), never production and never the shared local DB.** Scripts and the seeder are parallel-safe to write; the runs need the test project to themselves. The seeder and the k6 config refuse the production project by name.
- **TD3 — SUPERSEDED by M8 (Q102).** ~~Kill switches are `system_flags` rows flipped by `ops_set_flag`.~~ The one mechanism is **`job_pauses`** (183) for waivers, week advance and week finalize; the one ops log is **`platform_operator_actions`** (182). An automatic trip (pre-launch, L.F2.5) writes the same pause row through the same internal path as the button, with its own receipt. No new switch table, no second log. Whether drafts or scoring get a switch at launch is still open (Q91 deferred it) — asked when L.F2.5 is cut.
- **TD4 — Paging = one external channel** (email or phone push) fired from outside the database (Vercel cron or an uptime monitor), so a dead pg_cron still pages (F330). **Pre-launch window only (Q91).** It reads M8's `op_platform_state` rather than re-deriving job health.
- **TD5 — A runbook is "rehearsed" only when its steps were executed against the hosted test project with a timestamped log** — reading it aloud doesn't count.
- **TD6 — S0/S1 definitions:** S0 = wrong score/standing/result or data loss or a permission breach; S1 = a live draft or scoring weekend cannot complete without operator help. Everything else is S2+. Ledger F-rows get a severity column for this gate.
- **TD7 — Security review produces findings, not fixes.** Fixes are their own FULL tasks.
- **TD8 — The beta ladder reuses the 2026 test-league flag**; no new gating mechanism.
- **TD9 — Two windows.** 2026 window = everything a ruling did not defer; pre-launch window = L.F2.4, L.F2.5, L.F2.13, L.F2.14, L.F2.15. The 2026 gate (L.F2.12) passes M7's 2026 form; M7 closes at L.F2.15.
- **TD10 — Criterion 4 in 2026 without alerts (Q91 + Q92).** The weekend is recorded from what exists: `platform_operator_actions` and the commissioner log over the weekend, M8's Admin Home state (stuck weeks, job pauses, last cron runs), and every F-row filed. "Without a page" is reported as "no operator or commissioner action was needed to fix a system fault" with the evidence; Chris rules on the record (standing rule (f)) — no task accepts it on his behalf.
- **TD11 — The rulings go into the spec first** (L.F2.0), as M8 did at L.G1.0: §18 Phase F (the extras and the 20-team gate out per Q93), §22.6 (two sizes, the test project), §24.1 / §24.2 (alerts and automatic trips at launch on `job_pauses`), §24.3 (rehearsed on the test project).

---

## 4. Standing rules for every M7 task

(a) Spec wins; a spec gap → PROGRESS §3, stop. (b) Server-authoritative; TimeProvider/StatsProvider only. (c) No secrets, hostnames or project ids in commits, PRs or logs — the repo is public; the test project's keys live only in a gitignored `.env*.local` file on Chris's machine. (d) Merge deploys app code at once; DB goes out on Chris's `db push`; new code works on the older schema. (e) No load or chaos run against production. (f) Measurements are reported to Chris; he rules on any miss — no task "accepts" a miss on his behalf. (g) Match ESPN/Yahoo/Sleeper; drop spec-only inventions. (h) Never weaken audit immutability, lock semantics, snapshot reads or the §22.6 gates. (i) Never `supabase link` the repo to the test project — production pushes ride on the link; reach the test project with `--db-url` only.

---

## 5. Interface sketches (names contractual)

- `load/k6/config.ts` — `{ drafts, botsPerDraft, clockSec, leagues, replaySpeed, soakHours }` with profiles `y2026` and `ga` (TD1).
- `scripts/load/seed-staging.ts` — seeds production-shaped data into the test project (refuses the production project by name).
- ~~`system_flags` keys `drafts_paused_all`, `waivers_disabled`, `scoring_frozen`; `ops_set_flag(...)`~~ — **superseded (TD3):** M8's `job_pauses` + `op_pause_job` / `op_resume_job` / `op_run_job_now` and `platform_operator_actions`.
- `docs/runbooks/*.md` — one file per §24.3 runbook, plus the postponed game.

---

## 6. Task list

### 2026 window

### L.F2.0 — Spec fold-back of the M7 rulings + TD transcription · ONE PASS (docs only)
- **Depends:** this breakdown merged. **Parallel-safe: yes** (docs).
- **Scope:** TD11's spec edits with a version bump and changelog; TD1–TD11 → PROGRESS §4 D-numbers; F43 re-owned per Q93 (done at approval — confirm); the §10 ledger dispositions checked against the ledger as it stands.
- **Acceptance:** the spec says what Q88–Q94 ruled; no M7 task text contradicts the spec.

### L.F2.1 — Load harness: k6 scripts for the four §22.6 scenarios + the test-project seeder · ONE PASS
- **Depends:** L.F2.0. **Blocked by:** C1 (the test project) for the smoke run only. **Parallel-safe: yes** (writing scripts; no local DB).
- **Scope:** TD1 config; scenario 1 (snake drafts, bots, p95 pick→broadcast, zero duplicate picks), 2 (auction bid storm), 3 (Sunday replay at 1x/4x across N leagues, scoring lag p95, no missed corrections), 4 (soak with connection churn, realtime quota, connection leaks); the seeder; a small-size smoke run on the test project.
- **Acceptance:** each scenario runs at smoke size and prints its asserts; numbers recorded in PROGRESS.

### L.F2.2 — Load runs at 2026 size + the fix list · **FULL** (proves scoring/draft correctness under load)
- **Depends:** L.F2.1, **C1**. **Parallel-safe: no** (needs the test project to itself; not the local DB).
- **Scope:** run all four at the `y2026` profile (Q88 (a): about 5 drafts, 25 leagues); file every miss as an F-row with the measurement; report to Chris. Fixes are separate tasks. The GA-size run is L.F2.13.
- **Acceptance:** a results table per scenario; misses filed, not waived.

### L.F2.3 — Chaos drills · **FULL** (scoring/draft correctness)
- **Depends:** L.F2.1. **Parallel-safe: no (needs local DB or the test project).**
- **Scope:** kill realtime mid-draft (clients fall back to REST, draft completes); delay and duplicate provider rows (no double-scoring, reconciliation clean); crash a worker mid-batch (idempotent re-run, no partial week). Scripted so they re-run in the gate.
- **Acceptance:** each drill ends with reconcile exit 0 and zero duplicate picks.

### L.F2.6 — Rate limits (§22.5, F41) · **FULL** (permissions)
- **Depends:** L.F2.0. **Parallel-safe: no (needs local DB).**
- **Scope:** chat 5 msgs/10s, mutations 10/10s/league, bids 5/s; refusal copy in plain words.
- **Acceptance:** pgTAP / route tests at and over each limit; the UI prevents the action (prevent-don't-refuse) where it can.

### L.F2.7 — Internal security review of the RLS / RPC / grant surface (Q90 (c)) · **FULL** (permissions)
- **Depends:** L.F2.0. **Parallel-safe: yes** (static read of migrations + a findings doc; a probe pass against a stack is a separate "no" step at the end).
- **Scope:** every table's RLS vs §12; every SECURITY DEFINER's `search_path`, in-body auth and REVOKE; grants (F17, F372); F7, F36; anon reach. **Includes M8's operator surface** — `is_platform_operator()`, every `op_*` verb, `platform_operator_actions`, `job_pauses` and the `/api/admin/*` routes (404 to non-admins). Done by a fresh agent reviewer (us). Output: findings with S0–S3 (TD6). The outside review is L.F2.14.
- **Acceptance:** a findings list; every S0/S1 filed as an F-row with a fix task.

### L.F2.8 — Security fixes from L.F2.7 · **FULL** (permissions) — one PR per finding group
- **Depends:** L.F2.7. **Parallel-safe: no (needs local DB).**
- **Acceptance:** each fix with a pgTAP probe per role; zero S0/S1 from L.F2.7 open.

### L.F2.9 — Runbooks written (§24.3) · ONE PASS
- **Depends:** L.F2.0 (the knobs they reference are M8's, already on `main`). **Parallel-safe: yes** (docs).
- **Scope:** stuck draft · stats outage mid-Sunday · realtime degradation · waiver partial failure · commissioner locked out · restore one league from PITR · **postponed game** (the same steps as M8's L.G2.1 checklist — one document, not two). Each step names the Admin console screen or `op_*` verb it uses; where a step needs a switch that does not exist in 2026 (pause-all-drafts, freeze-scoring), the runbook says what to do instead. No hostnames or keys in the text.

### L.F2.10 — Runbook rehearsal, once for real · ONE PASS (executes FULL-rigour paths)
- **Depends:** L.F2.9, **C1**. **Parallel-safe: no** (the test project).
- **Scope:** every L.F2.9 runbook executed on the test project. The postponed-game run may be done in the same session as M8's L.G2.1 drill; L.G2.1 keeps its own box. The PITR runbook needs PITR on the test project (C1 (f)); without it, it is reported as not rehearsed and Chris rules.
- **Acceptance:** a timestamped log per runbook (TD5); every step that didn't work is fixed in the runbook or filed.

### L.F1.1 — Accessibility pass (§16.3, F55, F73, F78) · ONE PASS
- **Depends:** L.F2.0. **Parallel-safe: yes** (UI-only; reads a running dev app against hosted or mock data, no local DB writes).
- **Scope:** `design:accessibility-review` over the league surfaces (draft room first: focus, live-region announcements for picks/clock, color-independent status); touch reorder on the queue (F73); F78's copy.
- **Acceptance:** the review passes WCAG 2.1 AA on the named screens; findings fixed or filed.

### ~~L.F1.2 — Draft-order reveal (§8.3, F43)~~ — **REMOVED (Q93 "none of it", 2026-10-19).** F43 re-owned post-launch.

### ~~L.F1.3 — Notifications wiring for league events~~ — **REMOVED (Q93 "none of it", 2026-10-19).** M8's hand-written notices (L.G1.2) are unrelated and stay as built.

### L.F1.4 — Lighthouse / CWV pass · ONE PASS
- **Depends:** L.F2.0. **Parallel-safe: yes** (browser measurement against a deployed build or mock data).
- **Scope:** Lighthouse / Core Web Vitals on the league surfaces (League Home, draft room, matchup, roster); findings fixed or filed. ~~The 16/20-team draft-room concurrency test~~ is out (Q93).
- **Acceptance:** scores recorded per screen; misses reported to Chris (rule (f)).

### L.F2.11 — Beta ladder runbook + cohort flags (Q92 (a)) · ONE PASS
- **Depends:** L.F2.0. **Parallel-safe: yes** (docs + flag config via the existing mechanism, TD8).
- **Scope:** the rungs with the **2026 test leagues** — staff (1) → friends & family (5) → the cohort at whatever number it reaches; what to record each rung; how a live draft weekend is recorded per TD10 (no alerts in 2026).

### L.F2.12 — THE M7 GATE, 2026 form (`npm run test:gate:m7`) · ONE PASS (runs FULL-rigour suites)
- **Depends:** all 2026-window tasks above. **Parallel-safe: no.**
- **Scope:** composes `test:gate:m6` (and `test:gate:m8` once M8's L.G2.2 adds it); adds the chaos drills, the rate-limit pgTAP, the security probes; attaches the L.F2.2 (2026-size) results and the L.F2.10 logs; lists open F-rows by severity (zero S0/S1).
- **Note:** criterion 4 is a real-world event, not a script — the gate records the test-league weekend per TD10 when it happens (Q92 (a)), and Chris rules on it.

### Pre-launch window (not takeable until Chris opens it — TD9)

### L.F2.4 — Alerts that page a human (§24.1, F330, F332) · ONE PASS — **PRE-LAUNCH (Q91)**
- **Depends:** the launch window; **C3**. **Parallel-safe: yes** (route + config; no migration unless F332's purge needs one).
- **Scope:** the §24.1 table wired to Sentry/logs; one outside-the-DB watchdog (TD4) that reads `op_platform_state` and pages when pg_cron stops or a week is stuck; `cron.job_run_details` retention (F332).
- **Acceptance:** each page-worthy alert fired once on the test project and received.

### L.F2.5 — Automatic trips on M8's `job_pauses` (§24.2, Q102) · **FULL** (production writes) — **PRE-LAUNCH (Q91)**
- **Depends:** L.F2.4, the launch window. **Parallel-safe: no (needs local DB).**
- **Scope:** an automatic trip pauses a job through the same internal path as M8's button (`job_pauses`, a `platform_operator_actions` receipt, the "FieldScout" league line) when its alert condition holds; resume stays a person's act. **Which jobs trip, and whether drafts or scoring get a switch at all, is asked of Chris when this task is cut** (Q91 deferred it). Works on the older schema.
- **Acceptance:** pgTAP per role; each trip fired mid-run on a stack, the job stops cleanly, then resumes by hand with no lost work; break probe: a job that ignores the pause reds.

### L.F2.13 — Load runs at GA size + fixes (Q88 (a)) · **FULL** — **PRE-LAUNCH**
- **Depends:** L.F2.2, C1. **Parallel-safe: no** (the test project). The `ga` profile (50 drafts, 500 leagues); F311 first.

### L.F2.14 — Outside security review (Q90 (c)) · **FULL** (permissions) — **PRE-LAUNCH**
- **Depends:** L.F2.8, **C2**. **Parallel-safe: yes** (the reviewer works from the repo and the test project). Findings filed with TD6 severities; fixes as L.F2.8-style tasks.

### L.F2.15 — The launch gate re-run · ONE PASS — **PRE-LAUNCH**
- **Depends:** L.F2.4, L.F2.5, L.F2.13, L.F2.14 (+ its fixes). **Parallel-safe: no.**
- **Scope:** `test:gate:m7` with the GA-size results, the alert and trip proofs and the outside review's zero S0/S1. M7 closes here.

**Task count:** 13 in the 2026 window (L.F2.0–L.F2.3, L.F2.6–L.F2.12, L.F1.1, L.F1.4) + 5 pre-launch (L.F2.4, L.F2.5, L.F2.13–L.F2.15); L.F1.2 and L.F1.3 removed (Q93).

---

## 7. Dependency order — and what can start now

| Task | Depends on | Blocked on Chris? | Rigour | Parallel-safe |
|---|---|---|---|---|
| L.F2.0 spec fold-back | merge | — | ONE PASS | yes |
| L.F2.1 k6 harness | L.F2.0 | C1 (smoke run only) | ONE PASS | yes |
| L.F2.2 load runs, 2026 size | L.F2.1 | **C1** | FULL | no (test project) |
| L.F2.3 chaos drills | L.F2.1 | — | FULL | no |
| L.F2.6 rate limits | L.F2.0 | — | FULL | no |
| L.F2.7 internal security review | L.F2.0 | — | FULL | yes (static) |
| L.F2.8 security fixes | L.F2.7 | — | FULL | no |
| L.F2.9 runbooks written | L.F2.0 | — | ONE PASS | yes |
| L.F2.10 runbook rehearsal | L.F2.9 | **C1** | ONE PASS | no (test project) |
| L.F1.1 accessibility | L.F2.0 | — | ONE PASS | yes |
| L.F1.4 Lighthouse / CWV | L.F2.0 | — | ONE PASS | yes |
| L.F2.11 beta ladder | L.F2.0 | C4 (the weekend itself) | ONE PASS | yes |
| L.F2.12 M7 gate (2026) | all above | C4 (records the weekend) | ONE PASS | no |
| *L.F2.4 alerts* | *launch window* | *C3* | *ONE PASS* | *yes* |
| *L.F2.5 automatic trips* | *L.F2.4* | *ruling when cut* | *FULL* | *no* |
| *L.F2.13 GA-size load* | *L.F2.2* | *C1* | *FULL* | *no (test project)* |
| *L.F2.14 outside review* | *L.F2.8* | *C2* | *FULL* | *yes* |
| *L.F2.15 launch gate* | *all pre-launch* | — | *ONE PASS* | *no* |

**Suggested build order (2026 window):**
- **First:** L.F2.0 (docs).
- **DB lane (serial):** L.F2.6 → L.F2.3 → L.F2.8 (each finding group) → L.F2.12.
- **Parallel lane (no DB):** L.F2.1 (scripts), L.F2.7 (static), L.F1.1, L.F1.4, L.F2.9, L.F2.11.
- **Test-project lane (waits on C1):** L.F2.1's smoke run, then L.F2.2, then L.F2.10 (M8's L.G2.1 can share the L.F2.10 session).

L.F2.6 first in the DB lane because it needs nothing from Chris; L.F2.1 and L.F2.7 first in parallel because the load numbers and the security findings drive the most follow-up work.

**Deploy safety.** Each schema task works on the older schema (missing limiter = today's behaviour). One push per merged schema task; keep the backlog short.

---

## 8. Migration / pgTAP numbering

Measure at build time (D161). Heads today **198 / 148**. This doc reserves no numbers. Schema-lane order (merge order wins): L.F2.6 → L.F2.8; pre-launch L.F2.5.

---

## 9. Exit criteria → proof map

| Exit criterion (§1) | Proven by |
|---|---|
| 1. §22.6 all green at target load | 2026: L.F2.1 + L.F2.2 (`y2026`) + L.F2.3 + fixes, attached to L.F2.12 · launch: L.F2.13 (`ga`), attached to L.F2.15 |
| 2. Runbooks rehearsed once for real | L.F2.9 + L.F2.10 logs on the test project (TD5) |
| 3. Zero S0/S1 open | L.F2.7 → L.F2.8 (2026); L.F2.14 (launch); TD6 severity on the ledger; the gates' open-row lists |
| 4. 25-league beta completes a live draft weekend without a page | L.F2.11 (the ladder) + the 2026 test-league weekend recorded per TD10 (Q92 (a)); Chris rules on the record |
| (Phase F gate) CWV, accessibility | L.F1.4 + L.F1.1. The 20-team live draft load test is out (Q93) — L.F2.0 records it in the spec |
| Continuity | L.F2.12 runs `test:gate:m6` (+ `test:gate:m8` when it exists) |

---

## 10. Ledger dispositions

- **Discharged by M7:** F7, F17, F36, F372 (L.F2.7/8); F41 (L.F2.6); F55, F73, F78 (L.F1.1); F311 (L.F2.2 measures at 2026 size, L.F2.13 at GA size, fix filed); F330, F332 (L.F2.4, pre-launch). *(F327 was listed here in the draft; it was already discharged 2026-09-21 by L.E1.17 — D367.)*
- **Not in M7 (Q93):** F43 (draft-order reveal + 20-team pass) — re-owned post-launch at approval.
- **Reviewed at L.F2.12 for severity, not built here:** F50, F86, F92, F93, F144, F212, F226, F248, F256, F260, F262, F274, F275, F278, F281 — each gets an S-rating; any S0/S1 becomes a task.

---

## 11. Questions for Chris (filed as PROGRESS §3 Q88–Q94) — ALL RULED

**Q88 — How big should the load test be? — blocks L.F2.2.**
The spec's load test assumes GA size: 50 drafts at the same time, 500 leagues scoring on a Sunday. In 2026 we have a handful of friends' test leagues. Options: **(a)** test at 2026 size now (about 5 drafts, 25 leagues) and again at GA size before July 2027; **(b)** test only at GA size; **(c)** test at GA size now. *Recommend (a)* — same scripts, two sizes; the 2026 run tells us the friends' leagues are safe, the GA run is the real gate. We already know local realtime drops messages at 25 drafts (F311), so the GA size will need fixes.
**RULED (Chris 2026-10-02/03): (a) — 2026 size now, launch size later.** → L.F2.2 at `y2026`; L.F2.13 at `ga`, pre-launch.

**Q89 — Where do we run load tests? — blocks L.F2.2, L.F2.10.**
Load tests must never hit the real site. Options: **(a)** a second, separate hosted Supabase project used only for testing (extra monthly cost, Chris's account); **(b)** the local machine only (cheap, but it isn't production-shaped and it's the one shared DB); **(c)** a Supabase branch of production. *Recommend (a)* — the spec asks for "staging with production-shaped data", and runbook rehearsals need somewhere real to break things. Cost is yours to rule on.
**RULED (Chris 2026-10-02/03): (a) — a separate hosted test project.** → Chris creates it (§12 C1).

**Q90 — Security review: us, or someone outside? — blocks L.F2.7.**
Options: **(a)** an internal review (a fresh agent reviewer over every table and function, with probes); **(b)** a paid outside firm before GA; **(c)** internal now, outside before GA. *Recommend (c)* — internal now costs nothing and catches the known holes; with no users and no money in 2026, an outside review is worth it only before real leagues at GA.
**RULED (Chris 2026-10-02/03): (c) — us now, outside before launch.** → L.F2.7 internal; L.F2.14 outside, pre-launch (§12 C2).

**Q91 — Which emergency switches, and who gets the alert? — blocks L.F2.4, L.F2.5.**
The spec lists three switches: pause every live draft, stop waivers from running, freeze scores at the last good numbers. Alerts need to reach a person. Options: **(a)** all three switches, alerts to your phone/email; **(b)** just "pause all drafts" now, the rest later; **(c)** none until GA. *Recommend (a)*, alerts to you only. These are the controls ESPN/Yahoo/Sleeper staff use on bad nights (e.g. pausing drafts during an outage), and test-league draft weekends are where we'll learn whether they work.
**RULED (Chris 2026-10-02/03): none until launch.** Refined by **Q102 (2026-10-08)**: M8 built the manual pause / resume / run-now buttons (`job_pauses`, migration 183); at launch M7 adds only the automatic and alert side on that same mechanism. → L.F2.4 and L.F2.5 move to the pre-launch window; TD3 superseded.

**Q92 — When does the 25-league beta happen? — blocks L.F2.11 and exit criterion 4.**
The plan ends M7 with 25 friends-and-family leagues completing a live draft weekend without an alert firing. Options: **(a)** the 2026 test leagues count, at whatever number we reach; **(b)** a real beta in August 2027 draft season, just before GA; **(c)** a staged beta before GA with mock drafts filling out to 25. *Recommend (b)* — real draft weekends happen in late August, and 2026's test cohort is smaller than 25 and not real leagues. That means M7 cannot fully close until then; everything else can be done this year.
**RULED (Chris 2026-10-02/03): (a) — the 2026 test leagues count.** → L.F2.11 unblocked; criterion 4 recorded per TD10.

**Q93 — Which of the spec's "polish" extras are in? — blocks L.F1.3, L.F1.4.**
Spec Phase F lists: draft-order reveal animation, league notifications (your pick is up, trade offered, waiver results), a History tab, a tamper-proof audit chain, a public league page for search engines, auto-subbing inactive players, and a 20-team draft test (leagues cap at 16 today). *Recommend:* **in** — the reveal, notifications, and a 16-team performance test (matches our cap; ESPN/Yahoo go to 20, so 20 teams can come later). **Out until after GA** — History tab, tamper-proof chain, public league page (no major platform has these), and auto-sub (Sleeper-only).
**RULED (Chris 2026-10-02/03): none of it.** → L.F1.2 and L.F1.3 removed; L.F1.4 keeps only Lighthouse/CWV; F43 re-owned post-launch.

**Q94 — Admin console (M8) before or after this milestone? — blocks L.F2.5's buttons; Chris's call.**
M8 is your operator panel: send notices, pause/resume jobs, force a week to close, look at any league. The plan wants it before GA. Options: **(a)** M8 first, then M7 — the emergency switches become buttons in your panel; **(b)** M7 first, switches flipped by script, M8 after; **(c)** build them side by side. No recommendation — this is your placement call. Note that (a) lets L.F2.5 skip any UI, and that a postponed game during the 2026 test season is when you'd first want M8.
**RULED (Chris 2026-10-02/03): M8 first.** Done; *"do M7 next"* (2026-10-19). → M7 reuses M8's console, `job_pauses`, operator log and state views.

---

## 12. What Chris must do outside the repo

**C1 — Create the hosted test project (Q89). Blocks L.F2.2, L.F2.10, L.F2.1's smoke run, L.F2.13 — and M8's L.G2.1.** In plain words:
- **(a)** In the Supabase dashboard, create a **new project** that is not production (any name, e.g. "fieldscout-test"). The plan, and so the monthly cost, is your call; a free project may hit realtime limits during the draft scenarios and pauses itself when idle.
- **(b)** Put its details in a file on your machine only — `.env.test-project.local` at the repo root (git already ignores `.env*.local`): the project URL, the anon key, the service-role key and the database connection string. Never paste them into a PR, an issue or a chat that gets committed.
- **(c)** Load the schema onto it: `npx supabase db push --db-url "<the test project's connection string>"`. **Do not run `supabase link` for the test project** — your production pushes ride on the link.
- **(d)** In the test project's Vault, add the two secrets the cron jobs read: `fieldscout_site_origin` = the test app's address (from (e)), and `fieldscout_cron_secret` = a **new** secret, never production's.
- **(e)** Give the test project an app of its own: a second Vercel project from the same repo (so it gets its own address), with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_APP_URL` set to the test project / test app, `CRON_SECRET` = the same new secret as (d), and `NEXT_PUBLIC_FLAG_LEAGUES` / `NEXT_PUBLIC_FLAG_MOCK_DRAFTS` = `true`. Leave the AI key and the paid stats key unset.
- **(f)** Optional, your cost call: turn on point-in-time recovery (a paid add-on) on the test project if you want the "restore one league" runbook rehearsed for real (L.F2.10); without it that runbook is reported as not rehearsed.
- Then tell the orchestrator "the test project is ready". k6 itself (`brew install k6`) can be installed by a builder.

**C2 — Pick and pay an outside security reviewer (Q90 (c)). Pre-launch only (L.F2.14).** Nothing to do in 2026.

**C3 — Choose where alerts reach you (Q91). Pre-launch only (L.F2.4).** At launch: the channel (email or phone push) and the account for the outside watchdog. Nothing to do in 2026.

**C4 — The beta weekend (Q92 (a)).** The 2026 test leagues run a live draft weekend; afterwards you rule whether the TD10 record counts as "without a page".

**Every M7 migration** (L.F2.6, L.F2.8): your `db push` to production as usual.

---

*Rigour key: FULL = adversarial review until clean, pgTAP per role, break probes. ONE PASS = one review, nits become follow-ups.*
