# M8 Task Breakdown — Platform Admin Console (L.G1 tools + L.G2 drill)

> **Architect session output — 2026-10-03.** Read together with `spec-redraft-leagues.md` (the LAW — §5 invariants, §11.2 week close, §12.12 audit, §23.2 / §23.4, §24) and `delivery-plan-redraft-leagues.md` **v1.4** (§3 M8 row, `delivery-plan-redraft-leagues.md:74`). This doc sequences M8 into Builder-sized tasks; it never overrides the spec. One task per Builder session, one PR per task, in dependency order (§7). **APPROVED by Chris 2026-10-08** with rulings on Q95–Q102 (PROGRESS §3, all ANSWERED; folded below — §11 keeps the original question text with each ruling). ACTIVE-BUILD points here; first takeable task **L.G1.0**.
>
> **Order (Q94, Chris 2026-10-03): M8 first, then M7.** So M8 is built against `main`, not against M7's TD3 switches.
>
> **Process rule — "lighten it" (Chris, 2026-09-27).** **FULL** rigour (adversarial review until clean, pgTAP per role, break probes shown) only for **scoring, standings/results, permissions and production writes**. Everything else gets **one review pass**; nits become follow-ups. Every operator verb in this milestone writes production league state or gates on a permission, so most schema tasks are FULL; UI is ONE PASS.
>
> **Task ids.** Phase E was M6 (`L.E*`), Phase F is M7 (`L.F*`). M8 takes **`L.G1.*`** (the operator tools) and **`L.G2.*`** (the drill and the gate).
>
> **Eight questions (§11, PROGRESS §3 Q95–Q102) — all ruled 2026-10-08.** No task is blocked by a question; L.G1.0 folds the rulings into the spec first.

---

## 1. Scope & exit criteria

**The principle (Chris, 2026-09-09):** *"we probably won't predict the exact exception and will have to handle it differently — what we might actually need are some knobs and tools."* The automation keeps the predictable path (§11.2: a week releases when every game is final, floored Tuesday 00:00 PT, ceilinged Wednesday 00:00 PT). M8 gives the platform owner a small set of **manual** knobs for the rest.

**In M8:**
- **Who is an operator** — the existing `profiles.is_admin` switch, separate from league commissioner (Q95: Chris is the only admin).
- **The operator audit** — `platform_operator_actions`, one immutable row per operator action that changes something; none for a no-op.
- **Hand-written notifications** — the sender picks the audience on every notice: **everyone in any league**, **every app user**, or **one league's members** (Q97). Channel: the in-app bell only (the existing `notifications` table and rail panel, 001:540, `rail/notifications-panel.tsx`). Designed so email and push can later be added as extra channel checkboxes; **no email or push is built**.
- **Job knobs** (Q98) — pause / resume / run-now for **waivers, week advance and week finalize**, for one league or all leagues. **Lineup locking gets run-now only — no pause** (pausing it would let people move players after kickoff). **Drafts and stat syncing get no buttons.** Manual only — **no automatic trip** (Q91 / Q102).
- **Week knobs** — force a week close (release locks / advance per §11.2, ignoring the ceiling only). **No forced finalize and no "finalize anyway"** (Q99 (a)): to finish a week over an unplayed game the admin marks the game first, and the normal E43 rule closes the week.
- **Game status** (Q100, answers Q37 / F243) — three choices on a game: **moved later this week** (the week waits), **moved out of the week**, or **cancelled** (both: its players score 0 and the week closes under E43). The stat sync respects `operator_hold`; the admin can switch the game back.
- **League live-state view** — read-only: weeks and their status, games holding the week, pending score jobs, job pause state, last cron runs, recent commissioner and operator rows.
- **The postponed-game drill** — rehearsed end to end by hand on the hosted test project (Q89), with the notification a real user receives.

**Not in M8 (named so nobody builds them by accident):**
- **Automatic kill switches, alerts that trip a switch, paging** — deferred to launch (Q91). M8's pause is a person pressing a button.
- **Editing a league's scores, lineups, rosters or results as an operator.** That is the commissioner's console (M6). An operator who needs it uses the commissioner tools as a member, or Q96's "act as commissioner" if Chris wants one.
- **User management** (bans, password resets, deleting accounts) — not in the plan row.
- **Email / push delivery infrastructure** unless Q97 says so.
- **Anything in M7** (load, chaos, security review, runbooks). M7's L.F2.5 shrinks once M8 lands (§10).

**Exit criteria (delivery plan §3 M8 row, restated as checkable):**
1. **Every operator action audited:** each operator verb that changes something writes exactly one `platform_operator_actions` row (who, when, scope, before / after, reason optional); a no-op writes none; rows cannot be edited or deleted by anyone.
2. **No forbidden state:** no operator verb can produce a state §5 forbids — proven by pgTAP per verb. **There is no named exception** (Q99 (a)): every finalized week went through the normal E43 / §11.2 rule, so the synthetic gate's "zero final-cell rewrites" and "zero unhandled worker errors" arms apply to every week unchanged — no marker, no exclusion.
3. **The postponed-game drill:** on the test project, a game is postponed out of the week, an operator handles it end to end by hand using only the console, the week finalizes correctly, and a real test-league member receives the notification. Recorded with screenshots in PROGRESS.
4. **UX bar (standing priority, 2026-10-03):** every console page walked as a real operator; every player mention opens the player card; every form autosaves or confirms where standard; loading / empty / error states in the new design language.
5. **Continuity:** `test:gate:m6` stays green.

---

## 2. Current state (measured 2026-10-03 on `main` @ `6448f20`; migrations 001–179)

### 2.1 What M8 builds on
- **`profiles.is_admin`** (026) — service-role-write-only by trigger; read with the user's own client. Used today only by the persona-post review (`src/lib/auth/require-admin.ts`, `/app/admin/posts`, `/api/admin/posts`).
- **`system_flags`** (122) — persisted platform flags (F217's `stats_degraded`); the natural home for a pause flag.
- **The cron jobs** (`cron.schedule` in migrations): `draft-tick`, `finalize-matchups`, `league-player-values-ping`, `league-week-advance`, `lineup-lock`, `mock-expiry`, `process-waivers`, `score-week-ping`, `scoring-stall-check`, `sync-live-ping`, `sync-weekly-projections-ping`, `trade-tick`.
- **The week rule** — §11.2 / §23.4; `finalize_matchups` holds a week on `games_not_final` / `pending_scores`; E43 says a game postponed out of the week scores 0 and the week finalizes without it, a game moved within the week holds it.
- **Q37 / F243 (open)** — a cancelled game holds every week forever; the spec has no `cancelled` game state and `nfl_games.status` is unconstrained TEXT (001:92). Today's escape is a hand edit of `nfl_games`.
- **The commissioner audit spine** (M6A/M6) — `commissioner_actions`, its immutability triggers and receipt template D336. M8 copies the pattern; it does **not** write operator rows into the commissioner log (a commissioner is not the actor).
- **`notifications`** (001:540) and the rail panel.

### 2.2 What does not exist
- No operator audit table; no operator RPC; no pause flag any job reads; no "run now" door; no way to mark a game out-of-week except a raw `nfl_games` edit; no live-state read across a league's jobs; no admin page beyond persona posts.

---

## 3. Design decisions (Architect; TD1–TD11 — enter PROGRESS §4 as D-numbers at L.G1.0)

- **TD1 — Operators are a platform role, never a league role.** Every operator verb checks the operator gate in-body (`is_admin` or Q95's role) and **never** reads `league_members`. A commissioner gets nothing from M8; an operator gets no commissioner power from it.
- **TD2 — One operator audit, mirroring §12.12.** `platform_operator_actions` (actor, at, verb, scope `platform | league`, `league_id` nullable, `before` / `after` JSONB, `reason` optional, `action_id` UNIQUE). Immutable by the same trigger shape as 123 / 133. Readable by operators only; a league-scoped row also posts one plain-words line to that league's activity (Q101).
- **TD3 — Every knob is a SECURITY DEFINER RPC, `search_path = ''`, idempotent on `action_id`, no-op writes nothing.** The route layer is thin. Service-role is never handed to the browser.
- **TD4 — Pause is a flag the job reads, not `cron.unschedule`.** Pausing writes a row (`system_flags` key per job, or a `job_pauses` table keyed by job + league); each job's entry checks it and logs "paused by operator" instead of running. Unscheduling cron would lose the schedule and is invisible to the live-state view. A paused job never half-runs.
- **TD5 — "Run now" calls the same function the cron calls**, with `p_now` from TimeProvider, under the same guards. It cannot skip a rule the job enforces (a week with an unfinished game still holds).
- **TD6 — No operator verb overrides the finalize rule (Q99 (a), 2026-10-08).** There is no forced finalize and no `league_weeks.finalized_by` / `finalize_action_id` marker. An unplayed game is handled by marking it (TD7); E43 then closes the week through the normal path. `op_force_week_close` may ignore only the §11.2 ceiling, never the finalize rule.
- **TD7 — Game status is an NFL-data edit, audited.** Marking a game postponed-out-of-week / cancelled writes `nfl_games` through one operator RPC (player data otherwise stays sync-only); the existing E43 path then does the rest. The sync must not silently overwrite an operator's marker (the RPC sets an `operator_hold` the sync respects, per Q100). Statuses: moved later this week (holds the week), moved out of the week, cancelled (both score 0 per E43). The admin can switch a game back, which clears the hold.
- **TD8 — The console lives under `/app/admin`** next to the persona-post review (Q96), hidden for non-admins; the server returns 404, not 403, to them.
- **TD10 — Notices are channel-extensible (Q97).** `op_send_notification` takes an audience (`all_league_members | all_users | league`) and a channel set that today accepts only `in_app`; email / push are future additions to that set, unbuilt.
- **TD11 — League activity line (Q101 (a)).** A league-scoped operator action posts one line to that league's activity, signed "FieldScout" (never the admin's username).
- **TD9 — Deploy before push.** Every UI hides a control whose RPC is absent (PGRST202) rather than erroring; the jobs treat a missing pause row as "not paused".

---

## 4. Standing rules for every M8 task

1. **Spec first.** Each ruling folds into the spec changelog in the same PR; ambiguity → STOP, file it in plain words.
2. **Server-authoritative.** Clients compute nothing; RPCs SECURITY DEFINER `search_path = ''`, gate re-checked in-body, the league row locked before validation.
3. **Time only through `p_now` / TimeProvider; stats only through StatsProvider.**
4. **CREATE OR REPLACE against the HEAD of the chain** (`grep -n "FUNCTION <name>" supabase/migrations/*.sql | tail -1`).
5. **Never weaken:** §12.12 immutability, §7.3.4 / §11.2 locks, 158's final-week lock, scoring-snapshot reads.
6. **Loud, never "nothing happened".** A paused job says so in its log; "run now" that does nothing says why; a notification send reports how many recipients and fails loudly on 0.
7. **Audit:** one `platform_operator_actions` row per change; none per no-op.
8. **FULL tasks** add pgTAP per role (anon / authenticated non-admin / commissioner / operator / service), a break probe shown red then green, re-review until clean. **ONE PASS:** one review, nits filed.
9. **Migrations:** `npx supabase migration new`; typegen committed with the hand-written alias block kept; production only via Chris's `db push`; each PR states how merged code behaves on the older schema.
10. **Design + UX bar:** new design language, single theme, tokens only, elevation only on hover / true overlays; extend `src/components/ui/`; every player name opens the player card; plain words (no job names, keys or action types on screen); walk every page as a real operator before review.
11. **The repo is public.** No operator emails, user ids or project refs in commits, fixtures or PR text.
12. **One local DB.** Tasks marked "Parallel-safe: no" serialize `db reset` / `test:db`; reserve the migration number at task time.

---

## 5. Interface sketches (names contractual; the Builder finalizes fields)

**Tables:** `platform_operator_actions` (TD2) · `job_pauses` (`job`, `league_id` nullable = all leagues, `paused_at`, `paused_by`, `action_id`; one live row per job+scope) — or `system_flags` keys if the Builder shows that is simpler · `nfl_games` gains `operator_hold` (TD7, Q100). *(No `league_weeks.finalized_by` — dropped with TD6, Q99.)*

**RPCs (operator only):** `op_send_notification(audience, league_id?, channels, title, body, link?, action_id)` · `op_pause_job(job, league_id?, reason?, action_id)` / `op_resume_job(...)` · `op_run_job_now(job, league_id?, action_id)` · `op_force_week_close(league_id, week, action_id)` · `op_set_game_status(game_id, status, action_id)` *(no `op_force_finalize` — Q99)* · `op_league_state(league_id)` (read).

**Routes:** `/api/admin/notifications`, `/api/admin/jobs`, `/api/admin/leagues/[id]/state`, `/api/admin/leagues/[id]/week`, `/api/admin/games/[id]`, `/api/admin/log`. Pages: `/app/admin` (home), `/app/admin/leagues/[id]`, `/app/admin/notify`, `/app/admin/log`.

**Hooks:** `useAdminLeagueState`, `useAdminJobs`, `useAdminLog`, `useSendAdminNotification`, `useAdminWeekAction`, `useAdminGameStatus` — one per file, React Query.

---

## 6. Task list

### L.G1.0 — Spec fold-back of the M8 rulings (DOCS ONLY) · ONE PASS
- **Depends:** this breakdown merged. **Blocked by:** — (Q95–Q102 all ruled 2026-10-08). **Parallel-safe: yes.**
- **Scope:** add an operator section to the spec (who, what, audit); §11.2 / §23.4 state that operators have **no** finalize override (Q99 (a)) and that marking a game is the only route; a `cancelled` / postponed-out-of-week game vocabulary per Q100 (answers Q37); transcribe TD1–TD11 as D-numbers; mark Q37 answered and F243 discharged-by L.G1.4.
- **Acceptance:** every ruled Q marked ✅ with Chris's words; no spec sentence contradicts a ruling.

### L.G1.1 — Migration: the operator gate + `platform_operator_actions` · **FULL** (permissions, audit)
- **Depends:** merge. **Blocked by:** — (Q95: `is_admin`). **Parallel-safe: no** (local DB).
- **Scope:** the gate function `is_platform_operator()` (reads `profiles.is_admin`, Q95); the audit table, immutability triggers, read policy (operators only), insert helper `log_operator_action_internal` (REVOKEd); `requireAdminUser` reused for routes.
- **Acceptance / proofs:** pgTAP — anon / user / commissioner cannot read or write; operator reads; nobody (owner role included) can UPDATE / DELETE / TRUNCATE; a user cannot self-grant (026 re-proved). Break probe: drop the trigger ⇒ the immutability cell reds.

### L.G1.2 — Migration + route: hand-written notifications · **FULL** (production writes to every user)
- **Depends:** L.G1.1. **Blocked by:** — (Q97, Q101 ruled). **Parallel-safe: no.**
- **Scope:** `op_send_notification` (TD10) — the sender picks the audience: everyone in any league, every app user, or one league's members; channel `in_app` only (email / push are future checkboxes, not built); a league-scoped send also posts the "FieldScout" activity line (TD11); writes `notifications` rows in pages past 1000; one audit row with the recipient count; the rail shows it with a "From FieldScout" label; a link opens in-app.
- **Acceptance:** recipient count matches each of the three audiences exactly (1000+ fixture); a channel other than `in_app` is refused; 0 recipients refuses loudly; a replayed `action_id` sends nothing twice; non-operator refused.

### L.G1.3 — Migration: job pause / resume / run now · **FULL** (production writes, scoring jobs)
- **Depends:** L.G1.1. **Blocked by:** — (Q98, Q102 ruled). **Parallel-safe: no.**
- **Scope:** in-scope jobs (Q98): **waivers, week advance, week finalize** — pause / resume / run-now; **lineup locking — run-now only, pause refused**; drafts and stat syncing — no knobs. `job_pauses` (TD4); each pausable job's entry function (HEAD of chain) checks it per league and records "skipped — paused" in its run log; `op_pause_job` / `op_resume_job`; `op_run_job_now` (TD5). Waivers first: a paused league's waiver run does not process, claims stay pending and in order, and resume processes them at the next run or on "run now" with the same priority rules.
- **Acceptance:** paused ⇒ zero claim / score / lock writes for that league, other leagues unaffected; resume ⇒ identical outcome to an unpaused run on the same inputs; run now cannot finalize a week the rule holds. `op_pause_job('lineup-lock', …)` and any draft / stat-sync job are refused. Break probe: remove the check from `process_waivers` ⇒ the paused-league cell reds.

### L.G1.4 — Migration: force week close, game status · **FULL** (scoring, standings, results)
- **Depends:** L.G1.1, L.G1.0's Q99 / Q100 folds. **Blocked by:** — (Q99, Q100 ruled). **Parallel-safe: no.**
- **Scope:** `op_set_game_status` (TD7: moved later this week / moved out of the week / cancelled / back to normal; sets or clears `operator_hold`; the stat sync respects it); `op_force_week_close` (release locks / advance per §11.2, ignoring the ceiling only). **No forced finalize** (Q99 (a)): after a game is marked out of the week or cancelled, the normal `finalize_matchups` / E43 path scores its players 0 and closes the week; standings rebuild through the existing chain. Discharges Q37 / F243.
- **Acceptance:** every §5 invariant holds after each verb (pgTAP per verb); a game marked out-of-week or cancelled lets the normal finalize close the week with its players at 0; "moved later this week" still holds it; the sync cannot overwrite a held game; switching back clears the hold; re-running is a no-op; no operator path finalizes a week the rule holds. Break probe: remove the sync's `operator_hold` check ⇒ the held-game cell reds.

### L.G1.5 — Read: a league's live state · ONE PASS
- **Depends:** L.G1.1 (gate). **Parallel-safe: yes** if it reads existing tables only; **no** if `op_league_state` is a new RPC.
- **Scope:** weeks + status, games still holding the week and why, pending score / waiver jobs, pause rows, last cron run per job (`cron.job_run_details`), the league's latest commissioner and operator rows. Plain words.

### L.G1.6 — UI: the admin console · ONE PASS
- **Depends:** L.G1.2–L.G1.5. **Blocked by:** Q96 (where it lives). **Parallel-safe: yes** (UI; mock reads if needed).
- **Scope:** `/app/admin` home (what needs attention: weeks held past Wednesday, paused jobs, stalled scoring), league search → league page (state + the week / job / game knobs, each a confirm dialog with before / after), notify page (compose, preview as the user sees it, autosaved draft, send with recipient count), operator log. Persona-post review keeps its place as a tab. Every player opens the player card; loading / empty / error / overflow states.
- **Acceptance:** walked as a real operator on desktop and phone width; no control rendered whose RPC is absent.

### L.G2.1 — The postponed-game drill, rehearsed on the test project · ONE PASS (executes FULL paths)
- **Depends:** L.G1.6, Q89's hosted test project. **Parallel-safe: yes** (not the local DB).
- **Scope:** script + checklist: a test league mid-week; a game marked postponed out of the week; the operator pauses waivers, notifies the league, waits for the rest of the week, force-closes / finalizes per the rule, resumes waivers, checks standings and that every member got the notification. Recorded in PROGRESS with screenshots. Every miss filed as an F-row.

### L.G2.2 — THE M8 GATE (`npm run test:gate:m8`) · ONE PASS (runs FULL suites)
- **Depends:** all above. **Parallel-safe: no.**
- **Scope:** the M8 pgTAP + an E2E of the console (notify one league, pause / resume waivers, mark a game cancelled and watch the normal finalize close the week) + `test:gate:m6`. Criterion 3 is L.G2.1's recorded run.

---

## 7. Dependency order — and what can start now

| Task | Depends on | Blocked by a question? | Rigour | Parallel-safe |
|---|---|---|---|---|
| L.G1.0 spec fold-back | merge | — (Q95–Q102 ruled) | ONE PASS | yes |
| L.G1.1 gate + audit | merge | — | FULL | no |
| L.G1.2 notifications | L.G1.1 | — | FULL | no |
| L.G1.3 job knobs | L.G1.1 | — | FULL | no |
| L.G1.4 week + game knobs | L.G1.1, L.G1.0 | — | FULL | no |
| L.G1.5 live-state read | L.G1.1 | — | ONE PASS | yes / no (see task) |
| L.G1.6 console UI | L.G1.2–L.G1.5 | — | ONE PASS | yes |
| L.G2.1 postponed-game drill | L.G1.6 | Q89 (already ruled) | ONE PASS | yes |
| L.G2.2 M8 gate | all | — | ONE PASS | no |

**Suggested build order:** L.G1.0 → L.G1.1 → L.G1.3 (waivers first — highest value) → L.G1.4 → L.G1.2 → L.G1.5 → L.G1.6 → L.G2.1 → L.G2.2. The schema lane (L.G1.1–L.G1.4) is serial on the one local DB; L.G1.6's layout can start in parallel against mock reads once Q96 is ruled.

**Deploy safety.** Each schema task merges with the older-schema behaviour stated; Chris pushes each before the next lane task depends on it in production; keep push debt to one.

**Task count:** 9 (7 L.G1, 2 L.G2).

---

## 8. Migration numbering
Measure at build time (`ls supabase/migrations | tail -1`). Head today **179**. This doc reserves no numbers. Schema order: L.G1.1 → L.G1.3 → L.G1.4 → L.G1.2 (→ L.G1.5 if it adds an RPC).

---

## 9. Exit criteria → proof map

| Exit criterion (§1) | Proven by |
|---|---|
| 1. Every operator action audited, immutable, none per no-op | L.G1.1 – L.G1.4 pgTAP; L.G2.2 |
| 2. No forbidden state (no exception — Q99) | L.G1.3 / L.G1.4 pgTAP per verb; the synthetic gate's arms unchanged |
| 3. Postponed-game drill end to end with a real notification | L.G2.1 (recorded run) |
| 4. UX bar | L.G1.6 walk-through + review |
| 5. Continuity | L.G2.2 runs `test:gate:m6` |

---

## 10. Conflicts & ledger dispositions

- **M7 overlap (Q91 / Q94).** M7's L.F2.5 proposed three `system_flags` switches (`drafts_paused_all`, `waivers_disabled`, `scoring_frozen`). M8's manual pause **is** the "disable waivers" switch in all but name. **Ruled (Q102, 2026-10-08):** M8's `job_pauses` is the one mechanism; M7 at launch adds only the automatic / alert side on top.
- **Q37 / F243** — answered by Q100 and discharged by L.G1.4.
- **F265** (the blocked-bracket flag M6 left for M8) — the live-state read (L.G1.5) shows it; any fix is a separate task.
- **Plan row vs Q99.** The delivery plan's M8 row names a forced finalize as an exception; Q99 (a) removes it — L.G1.0 folds that into the plan/spec text. No §5 invariant conflict remains.

---

## 11. Questions for Chris (PROGRESS §3 Q95–Q102) — ALL ANSWERED 2026-10-08

**Q95 — Who counts as a platform admin? — blocks L.G1.1.**
Today there is one switch on a user's profile ("is admin") that only unlocks reviewing AI expert posts. Options: **(a)** reuse that switch — anyone with it can use every admin tool; **(b)** add separate roles (e.g. "can send notices" vs "can touch leagues"). *Recommend (a)* — it is just you (and maybe one helper) this year; roles can come later if more people join.
**RULED (Chris 2026-10-08): (a) — the existing is_admin switch. Chris is the only admin.**

**Q96 — Where does the admin console live? — blocks L.G1.6.**
Options: **(a)** inside the app at an Admin page only admins can see (where the AI-post review already is); **(b)** a separate admin site. *Recommend (a)* — same login, same look, nothing extra to run. Non-admins never see a link and get "page not found" if they guess the address.
**RULED (Chris 2026-10-08): (a) — an in-app Admin page at /app/admin, hidden for non-admins; the server returns 404 to them.**

**Q97 — When you send a notice by hand, where does it show up? — blocks L.G1.2.**
Options: **(a)** in-app only (the bell in the right-hand bar); **(b)** in-app plus email; **(c)** in-app plus email plus phone push. *Recommend (a)* for now — the test leagues are friends who use the app, and email/push need sending services we don't have yet. Also: a platform-wide notice goes to **everyone in any league** (recommended) or every user of the app?
**RULED (Chris 2026-10-08): every notice lets the sender choose the audience: everyone in any league, every app user, or one league's members. Channel: the in-app bell now; designed so email and push can be added later as extra checkboxes; no email or push built.**

**Q98 — Which automatic jobs get pause / resume / run-now buttons? — blocks L.G1.3.**
Options: **(a)** waivers only; **(b)** waivers, lineup locking, week advance and week finalize; **(c)** every scheduled job including drafts and stat syncing. *Recommend (b)* — those are the four a postponed game touches. Draft clocks already have the commissioner's pause; stat syncing pausing would hide real data.
**RULED (Chris 2026-10-08): pause, resume and run-now for waivers, week advance and week finalize. Lineup locking: run-now only, NO pause (pausing would let people move players after kickoff). Drafts and stat syncing: no buttons.**

**Q99 — Can an admin finalize a week while a game hasn't been played? — blocks L.G1.4.**
Example: Week 5's Monday game is postponed with no new date. Today the week waits (unless the game is marked "out of the week", when its players score 0 and the week finishes — your earlier E43 ruling). Options: **(a)** no — the admin must first mark the game postponed/cancelled, then the normal rule finishes the week; **(b)** yes — a "finalize anyway" button that scores the unplayed game's players 0, marks the week "finalized by admin", and logs it. *Recommend (a)* — it is the same result through one rule instead of two, and every league treats the game the same way. ESPN/Yahoo/Sleeper handle a cancelled game by treating it as 0 points too.
**RULED (Chris 2026-10-08): (a) — no "finalize anyway". The admin marks the game first and the normal E43 rule closes the week. TD6's forced-finalize exception and the finalized_by marker are dropped.**

**Q100 — Can an admin mark an NFL game as postponed out of the week, or cancelled? — blocks L.G1.4 (answers the old Q37).**
Today a cancelled game would hold every league's week forever, and the only fix is editing the database by hand. *Recommend yes:* an admin button on the game with three choices — "moved later this week" (week waits), "moved out of this week" and "cancelled" (both: players score 0, week finishes). The stat sync is not allowed to undo the admin's choice; if the game is later played inside the same week, the admin can switch it back.
**RULED (Chris 2026-10-08): yes — moved later this week (the week waits), moved out of the week, or cancelled (both: players score 0, week closes). The sync respects operator_hold; the admin can switch it back. Answers Q37 and F243.**

**Q101 — Should league members see when an admin acted on their league? — blocks L.G1.2's league line.**
Example: you pause waivers in a test league. Options: **(a)** a line in that league's activity ("FieldScout paused waivers this week") plus your notice; **(b)** only the notice you choose to send; **(c)** nothing. *Recommend (a)* — the commissioner's actions already show in activity, so an admin's should too; the admin's name is shown as "FieldScout", not your username.
**RULED (Chris 2026-10-08): (a) — a line in that league's activity, signed "FieldScout".**

**Q102 — Your M7 ruling said no emergency switches until launch. Is a manual "pause waivers" button okay now? — blocks L.G1.3.**
The pause buttons in M8 are pressed by a person; nothing trips them automatically. They do the same thing M7's "disable waivers" switch would. *Recommend:* yes, build the manual buttons in M8 and let M7 (at launch) add only the automatic/alert side on top of the same buttons, so there is one mechanism, not two.
**RULED (Chris 2026-10-08): yes — build the manual buttons now; at launch M7 adds only the automatic and alert side on top of the same mechanism.**
