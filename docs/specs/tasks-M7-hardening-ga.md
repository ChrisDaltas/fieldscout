# M7 Task Breakdown — Hardening & GA (L.F1 Phase F polish + L.F2 hardening)

> **Architect session output — 2026-10-03.** Read together with `spec-redraft-leagues.md` (the LAW — §18 Phase F, §22.6, §24) and `delivery-plan-redraft-leagues.md` **v1.4** (§3 M7 row, `delivery-plan-redraft-leagues.md:72`; the beta ladder, `:76`; the 2026 alpha, `:78–82`; M8, `:74`). This doc sequences M7 into Builder-sized tasks; it never overrides the spec. One task per Builder session, one PR per task, in dependency order (§7). Per the #150 / #161 / #244 / #289 / #323 / #360 precedent **this breakdown's PR STAYS OPEN for Chris's approval** — nothing here is takeable until it merges and ACTIVE-BUILD points here.
>
> **Process rule — "lighten it" (Chris, 2026-09-27).** Pre-launch, **FULL** rigour (adversarial review until clean, pgTAP per role, break probes shown) only for **scoring, standings/results, permissions and production writes**. Everything else gets **ONE PASS**; nits become follow-ups; ledger notes stay short. Every task is tagged.
>
> **One local DB (standing rule).** Worktrees do not isolate Supabase. Every task is flagged **parallel-safe: yes** (docs, UI-only, static review, scripts that run against nothing local) or **parallel-safe: no (needs local DB)**. Only one "no" task may run at a time.
>
> **Task ids.** The plan names **`L.F1`** for Phase F; this doc uses **`L.F1.*`** for the §18 Phase F polish items and **`L.F2.*`** for the hardening/GA work (load, chaos, runbooks, security, kill switches, beta, gate).
>
> **Seven questions (§11, filed as PROGRESS §3 Q88–Q94)** block specific tasks only. Most of the breakdown can start the day it merges (§7).

---

## 1. Scope & exit criteria

**In M7 (plan §3 M7 row; spec §18 Phase F, §22.6, §24):**
- **L.F1 — Phase F polish** (§18): draft-order reveal (F43), the full accessibility pass (F55, F73), notifications wiring, the 20-team draft-room performance pass (F43; sizes cap at 16 today — see Q93), Lighthouse/CWV.
- **L.F2 — hardening:** the full k6 §22.6 suite (four scenarios); chaos drills (kill realtime mid-draft, delay/duplicate provider rows, crash a worker mid-batch — plan `:98`); the §24.1 golden-signal alerts that actually page someone (F330); the §24.2 kill switches; the §24.3 runbooks, written and rehearsed once for real; a security review of the RLS/RPC/grant surface (F7, F17, F36, F327, F372); the §22.5 rate limits (F41); the beta ladder; the M7 gate.

**Exit criteria (plan, verbatim):** (1) §22.6 all green at target load · (2) runbooks rehearsed once for real · (3) zero S0/S1 open · (4) 25-league friends-and-family beta completes a live draft weekend without a page.

**Not in M7 (named so nobody builds them by accident):**
- **M8 — Platform Admin Console.** Its order relative to M7 is **Chris's call (Q94)**. If M8 goes first, L.F2.5's kill switches become M8 buttons and L.F2.5 shrinks to the server half.
- History Mode tab, public league SEO page, hash-chain tamper-evidence, optional auto-sub inactives — §18 Phase F lists them; this doc proposes they are **post-GA** unless Chris says otherwise (Q93). Standard platforms don't offer tamper-evidence chains; ESPN/Yahoo/Sleeper have no public league SEO page by default.
- Paid stats provider contract (OQ14) and any billing (free-only launch).
- No new API routes or schema for UI-only surfaces.

---

## 2. Current state (measured 2026-10-03 on `main` @ `9bcdd81`)

- Migrations head **177**, pgTAP head **125**. Push debt per ACTIVE-BUILD: 177.
- **Exists:** `system_flags` (122) with `stats_degraded` and the `autopilot_disabled` kill switch (125/139); cron ping + stall check (124); draft pause semantics (069); the reconciliation job (L.D2.3); one runbook (`runbook-hosted-migration-reconciliation.md`); gates `test:gate:m0…m6`.
- **Does not exist:** any k6 script; a staging environment with production-shaped data (§22.6 assumes one — Q89); pause-all-drafts / disable-waiver-runs / freeze-scoring switches; an alert that reaches a human outside pg_cron (F330); any §24.3 runbook; rate limits (F41).
- **Measured load finding already on file:** F311 — locally the app emits broadcasts ~5x faster than the realtime tenant carries at 25 concurrent drafts, and the overflow drops silently. Scenario 1 of §22.6 (50 drafts) will hit this first.

---

## 3. Design decisions (Architect; TD1–TD8 — enter PROGRESS §4 as D-numbers at merge)

- **TD1 — Target load is a parameter, not a constant.** Every k6 scenario reads its sizes from one config file; the gate runs it at the Q88 target. Same scripts serve 2026 and GA.
- **TD2 — k6 runs against a hosted non-production project, never prod and never the shared local DB** (Q89). Scripts and a seeder are parallel-safe to write; the runs are not "needs local DB" but do need the staging project to themselves.
- **TD3 — Kill switches are `system_flags` rows** (the 122/125 shape), read once per job invocation, flipped by a service-role-only RPC that writes an ops-log row. No new table unless the ops log needs one.
- **TD4 — Paging = one external channel** (email or phone push) fired from outside the database (Vercel cron or an uptime monitor), so a dead pg_cron still pages (F330).
- **TD5 — A runbook is "rehearsed" only when its steps were executed against the hosted staging project with a timestamped log** — reading it aloud doesn't count.
- **TD6 — S0/S1 definitions:** S0 = wrong score/standing/result or data loss or a permission breach; S1 = a live draft or scoring weekend cannot complete without operator help. Everything else is S2+. Ledger F-rows get a severity column for this gate.
- **TD7 — Security review produces findings, not fixes.** Fixes are their own FULL tasks.
- **TD8 — The beta ladder reuses the 2026 test-league flag**; no new gating mechanism.

---

## 4. Standing rules for every M7 task

(a) Spec wins; a spec gap → PROGRESS §3, stop. (b) Server-authoritative; TimeProvider/StatsProvider only. (c) No secrets, hostnames or project ids in commits, PRs or logs — the repo is public. (d) Merge deploys app code at once; DB goes out on Chris's `db push`; new code works on the older schema. (e) No load or chaos run against production. (f) Measurements are reported to Chris; he rules on any miss — no task "accepts" a miss on his behalf. (g) Match ESPN/Yahoo/Sleeper; drop spec-only inventions. (h) Never weaken audit immutability, lock semantics, snapshot reads or the §22.6 gates.

---

## 5. Interface sketches (names contractual)

- `load/k6/config.ts` — `{ drafts, botsPerDraft, clockSec, leagues, replaySpeed, soakHours }` (TD1).
- `scripts/load/seed-staging.ts` — seeds production-shaped data into the staging project (refuses a production URL by name).
- `system_flags` keys: `drafts_paused_all`, `waivers_disabled`, `scoring_frozen` (TD3) — subject to Q91.
- `ops_set_flag(p_key, p_value, p_note)` — SECURITY DEFINER, `search_path=''`, service role only.
- `docs/runbooks/*.md` — one file per §24.3 runbook.

---

## 6. Task list

### L.F2.1 — Load harness: k6 scripts for the four §22.6 scenarios + the staging seeder · ONE PASS
- **Depends:** this breakdown merged. **Blocked by:** Q89 (where it runs) for the run only. **Parallel-safe: yes** (writing scripts; no local DB).
- **Scope:** TD1 config; scenario 1 (snake drafts, bots, p95 pick→broadcast, zero duplicate picks), 2 (auction bid storm), 3 (Sunday replay at 1x/4x across N leagues, scoring lag p95, no missed corrections), 4 (soak with connection churn, realtime quota, connection leaks); the seeder; a small-size smoke run.
- **Acceptance:** each scenario runs at smoke size and prints its asserts; numbers recorded in PROGRESS.

### L.F2.2 — Load runs at target + the fix list · **FULL** (proves scoring/draft correctness under load)
- **Depends:** L.F2.1, Q88, Q89. **Parallel-safe: no** (needs the staging project to itself; not the local DB).
- **Scope:** run all four at the Q88 target; file every miss as an F-row with the measurement (F311 first); report to Chris. Fixes are separate tasks.
- **Acceptance:** a results table per scenario; misses filed, not waived.

### L.F2.3 — Chaos drills · **FULL** (scoring/draft correctness)
- **Depends:** L.F2.1. **Parallel-safe: no (needs local DB or staging).**
- **Scope:** kill realtime mid-draft (clients fall back to REST, draft completes); delay and duplicate provider rows (no double-scoring, reconciliation clean); crash a worker mid-batch (idempotent re-run, no partial week). Scripted so they re-run in the gate.
- **Acceptance:** each drill ends with reconcile exit 0 and zero duplicate picks.

### L.F2.4 — Alerts that page a human (§24.1, F330) · ONE PASS
- **Depends:** this breakdown merged. **Blocked by:** Q91 (who gets paged, how). **Parallel-safe: yes** (route + config; no migration).
- **Scope:** the §24.1 table wired to Sentry/logs; one outside-the-DB watchdog (TD4) that pages when pg_cron stops; `cron.job_run_details` retention (F332) if Q91 keeps it in scope.
- **Acceptance:** each page-worthy alert fired once on staging and received.

### L.F2.5 — Kill switches (§24.2) · **FULL** (production writes)
- **Depends:** this breakdown merged. **Blocked by:** Q91 (which switches), Q94 (whether M8 owns the buttons). **Parallel-safe: no (needs local DB).**
- **Scope:** TD3 flags + `ops_set_flag`; draft tick, waiver run and score worker each read their flag once per invocation; pause-all uses the existing pause path with a banner; freeze-scoring shows last-good scores. Works on the older schema (missing flag = off).
- **Acceptance:** pgTAP per role (service role only); each switch flipped mid-run on a stack and the job stops cleanly, then resumes with no lost work; break probe: a job that ignores the flag reds.

### L.F2.6 — Rate limits (§22.5, F41) · **FULL** (permissions)
- **Depends:** this breakdown merged. **Parallel-safe: no (needs local DB).**
- **Scope:** chat 5 msgs/10s, mutations 10/10s/league, bids 5/s; refusal copy in plain words.
- **Acceptance:** pgTAP / route tests at and over each limit; the UI prevents the action (prevent-don't-refuse) where it can.

### L.F2.7 — Security review of the RLS / RPC / grant surface · **FULL** (permissions)
- **Depends:** this breakdown merged. **Blocked by:** Q90 (internal or outside reviewer). **Parallel-safe: yes** (static read of migrations + a findings doc; a probe pass against a stack is a separate "no" step at the end).
- **Scope:** every table's RLS vs §12; every SECURITY DEFINER's `search_path`, in-body auth and REVOKE; grants (F17, F327, F372); F7, F36; anon reach. Output: findings with S0–S3 (TD6).
- **Acceptance:** a findings list; every S0/S1 filed as an F-row with a fix task.

### L.F2.8 — Security fixes from L.F2.7 · **FULL** (permissions) — one PR per finding group
- **Depends:** L.F2.7. **Parallel-safe: no (needs local DB).**
- **Acceptance:** each fix with a pgTAP probe per role; zero S0/S1 from L.F2.7 open.

### L.F2.9 — Runbooks written (§24.3) · ONE PASS
- **Depends:** L.F2.5 (the switches they reference). **Parallel-safe: yes** (docs).
- **Scope:** stuck draft · stats outage mid-Sunday · realtime degradation · waiver partial failure · commissioner locked out · restore one league from PITR. No hostnames or keys in the text.

### L.F2.10 — Runbook rehearsal, once for real · ONE PASS (executes FULL-rigour paths)
- **Depends:** L.F2.9, L.F2.4. **Parallel-safe: no** (staging project).
- **Acceptance:** a timestamped log per runbook (TD5); every step that didn't work is fixed in the runbook or filed.

### L.F1.1 — Accessibility pass (§16.3, F55, F73) · ONE PASS
- **Depends:** this breakdown merged. **Parallel-safe: yes** (UI-only; reads a running dev app against hosted or mock data, no local DB writes).
- **Scope:** `design:accessibility-review` over the league surfaces (draft room first: focus, live-region announcements for picks/clock, color-independent status); touch reorder on the queue (F73); F78's copy.
- **Acceptance:** the review passes WCAG 2.1 AA on the named screens; findings fixed or filed.

### L.F1.2 — Draft-order reveal (§8.3, F43) · ONE PASS
- **Depends:** this breakdown merged. **Parallel-safe: yes** (UI over the existing order read). Sleeper-style animated reveal; skippable.

### L.F1.3 — Notifications wiring for league events · ONE PASS
- **Depends:** this breakdown merged. **Blocked by:** Q93 (which events). **Parallel-safe: no** if it needs a trigger; **yes** if it uses existing rows.
- **Scope:** your pick is up, draft starting, trade offered/accepted, waiver result — into the existing `notifications` table and rail panel.

### L.F1.4 — Draft-room performance pass + Lighthouse/CWV · ONE PASS
- **Depends:** L.F2.1 (for the concurrent-load leg). **Parallel-safe: yes** (browser measurement against staging or mock). Size per Q93 (16 vs 20 teams).

### L.F2.11 — Beta ladder runbook + cohort flags · ONE PASS
- **Depends:** L.F2.4, L.F2.5. **Blocked by:** Q92 (when the 25-league beta happens). **Parallel-safe: yes** (docs + flag config via existing mechanism, TD8).
- **Scope:** staff (1) → friends & family (5) → canary (25) rungs; what "a page" means (L.F2.4's alerts); what to record each rung.

### L.F2.12 — THE M7 GATE (`npm run test:gate:m7`) · ONE PASS (runs FULL-rigour suites)
- **Depends:** all of the above (minus Q-deferred items). **Parallel-safe: no.**
- **Scope:** composes `test:gate:m6`; adds the chaos drills, the kill-switch and rate-limit pgTAP, the security probes; attaches the latest L.F2.2 results and L.F2.10 logs; lists open F-rows by severity (zero S0/S1).
- **Note:** criterion 4 (the 25-league beta weekend) is a real-world event, not a script — the gate records it when it happens (Q92).

**Task count: 16** (L.F1.1–L.F1.4, L.F2.1–L.F2.12).

---

## 7. Dependency order — and what can start now

| Task | Depends on | Blocked by a question? | Rigour | Parallel-safe |
|---|---|---|---|---|
| L.F2.1 k6 harness | merge | Q89 (the run only) | ONE PASS | yes |
| L.F2.2 load runs | L.F2.1 | Q88, Q89 | FULL | no (staging) |
| L.F2.3 chaos drills | L.F2.1 | — | FULL | no |
| L.F2.4 paging alerts | merge | Q91 | ONE PASS | yes |
| L.F2.5 kill switches | merge | Q91, Q94 | FULL | no |
| L.F2.6 rate limits | merge | — | FULL | no |
| L.F2.7 security review | merge | Q90 | FULL | yes (static) |
| L.F2.8 security fixes | L.F2.7 | — | FULL | no |
| L.F2.9 runbooks written | L.F2.5 | — | ONE PASS | yes |
| L.F2.10 runbook rehearsal | L.F2.9, L.F2.4 | — | ONE PASS | no (staging) |
| L.F1.1 accessibility | merge | — | ONE PASS | yes |
| L.F1.2 order reveal | merge | — | ONE PASS | yes |
| L.F1.3 notifications | merge | Q93 | ONE PASS | depends |
| L.F1.4 perf + CWV | L.F2.1 | Q93 (size) | ONE PASS | yes |
| L.F2.11 beta ladder | L.F2.4, L.F2.5 | Q92 | ONE PASS | yes |
| L.F2.12 M7 gate | all | — | ONE PASS | no |

**Suggested build order (one DB lane + parallel lanes):**
- **DB lane (serial):** L.F2.6 → L.F2.5 → L.F2.3 → L.F2.8 (each finding group) → L.F2.12.
- **Parallel lane (no DB):** L.F2.1, L.F2.7 (static), L.F1.1, L.F1.2, L.F2.4, then L.F2.9, L.F2.11, L.F1.4.
- **Staging lane (needs the staging project, not the local DB):** L.F2.2, then L.F2.10.

L.F2.6 first in the DB lane because it needs no answer; L.F2.1 and L.F2.7 first in parallel because the load numbers and the security findings drive the most follow-up work.

**Deploy safety.** Each schema task works on the older schema (missing flag = off; missing limiter = today's behaviour). One push per merged schema task; keep the backlog short.

---

## 8. Migration / pgTAP numbering

Measure at build time (D161). Heads today **177 / 125**. This doc reserves no numbers. Schema-lane order (merge order wins): L.F2.6 → L.F2.5 → L.F2.8.

---

## 9. Exit criteria → proof map

| Exit criterion (§1) | Proven by |
|---|---|
| 1. §22.6 all green at target load | L.F2.1 (scripts) + L.F2.2 (runs at the Q88 target) + L.F2.3 (chaos) + fixes; results attached to L.F2.12 |
| 2. Runbooks rehearsed once for real | L.F2.9 + L.F2.10 logs (TD5) |
| 3. Zero S0/S1 open | L.F2.7 → L.F2.8; TD6 severity on the ledger; L.F2.12's open-row list |
| 4. 25-league beta completes a live draft weekend without a page | L.F2.4 (what pages) + L.F2.11 (the ladder) + the real weekend, recorded in PROGRESS (timing per Q92) |
| (Phase F gate) 20-team live draft load, CWV, accessibility | L.F1.4 + L.F1.1 (size per Q93) |
| Continuity | L.F2.12 runs `test:gate:m6` |

---

## 10. Ledger dispositions

- **Discharged by M7:** F7, F17, F36, F327, F372 (L.F2.7/8); F41 (L.F2.6); F43 (L.F1.2 + L.F1.4); F55, F73, F78 (L.F1.1); F311 (L.F2.2 measures, fix filed); F330, F332 (L.F2.4).
- **Reviewed at L.F2.12 for severity, not built here:** F50, F86, F92, F93, F144, F212, F226, F248, F256, F260, F262, F274, F275, F278, F281 — each gets an S-rating; any S0/S1 becomes a task.

---

## 11. Questions for Chris (filed as PROGRESS §3 Q88–Q94)

**Q88 — How big should the load test be? — blocks L.F2.2.**
The spec's load test assumes GA size: 50 drafts at the same time, 500 leagues scoring on a Sunday. In 2026 we have a handful of friends' test leagues. Options: **(a)** test at 2026 size now (about 5 drafts, 25 leagues) and again at GA size before July 2027; **(b)** test only at GA size; **(c)** test at GA size now. *Recommend (a)* — same scripts, two sizes; the 2026 run tells us the friends' leagues are safe, the GA run is the real gate. We already know local realtime drops messages at 25 drafts (F311), so the GA size will need fixes.

**Q89 — Where do we run load tests? — blocks L.F2.2, L.F2.10.**
Load tests must never hit the real site. Options: **(a)** a second, separate hosted Supabase project used only for testing (extra monthly cost, Chris's account); **(b)** the local machine only (cheap, but it isn't production-shaped and it's the one shared DB); **(c)** a Supabase branch of production. *Recommend (a)* — the spec asks for "staging with production-shaped data", and runbook rehearsals need somewhere real to break things. Cost is yours to rule on.

**Q90 — Security review: us, or someone outside? — blocks L.F2.7.**
Options: **(a)** an internal review (a fresh agent reviewer over every table and function, with probes); **(b)** a paid outside firm before GA; **(c)** internal now, outside before GA. *Recommend (c)* — internal now costs nothing and catches the known holes; with no users and no money in 2026, an outside review is worth it only before real leagues at GA.

**Q91 — Which emergency switches, and who gets the alert? — blocks L.F2.4, L.F2.5.**
The spec lists three switches: pause every live draft, stop waivers from running, freeze scores at the last good numbers. Alerts need to reach a person. Options: **(a)** all three switches, alerts to your phone/email; **(b)** just "pause all drafts" now, the rest later; **(c)** none until GA. *Recommend (a)*, alerts to you only. These are the controls ESPN/Yahoo/Sleeper staff use on bad nights (e.g. pausing drafts during an outage), and test-league draft weekends are where we'll learn whether they work.

**Q92 — When does the 25-league beta happen? — blocks L.F2.11 and exit criterion 4.**
The plan ends M7 with 25 friends-and-family leagues completing a live draft weekend without an alert firing. Options: **(a)** the 2026 test leagues count, at whatever number we reach; **(b)** a real beta in August 2027 draft season, just before GA; **(c)** a staged beta before GA with mock drafts filling out to 25. *Recommend (b)* — real draft weekends happen in late August, and 2026's test cohort is smaller than 25 and not real leagues. That means M7 cannot fully close until then; everything else can be done this year.

**Q93 — Which of the spec's "polish" extras are in? — blocks L.F1.3, L.F1.4.**
Spec Phase F lists: draft-order reveal animation, league notifications (your pick is up, trade offered, waiver results), a History tab, a tamper-proof audit chain, a public league page for search engines, auto-subbing inactive players, and a 20-team draft test (leagues cap at 16 today). *Recommend:* **in** — the reveal, notifications, and a 16-team performance test (matches our cap; ESPN/Yahoo go to 20, so 20 teams can come later). **Out until after GA** — History tab, tamper-proof chain, public league page (no major platform has these), and auto-sub (Sleeper-only).

**Q94 — Admin console (M8) before or after this milestone? — blocks L.F2.5's buttons; Chris's call.**
M8 is your operator panel: send notices, pause/resume jobs, force a week to close, look at any league. The plan wants it before GA. Options: **(a)** M8 first, then M7 — the emergency switches become buttons in your panel; **(b)** M7 first, switches flipped by script, M8 after; **(c)** build them side by side. No recommendation — this is your placement call. Note that (a) lets L.F2.5 skip any UI, and that a postponed game during the 2026 test season is when you'd first want M8.

---

*Rigour key: FULL = adversarial review until clean, pgTAP per role, break probes. ONE PASS = one review, nits become follow-ups.*
