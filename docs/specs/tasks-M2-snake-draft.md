# M2 Task Breakdown — Snake Draft Engine (Phase B)

> **Architect session output — 2026-08-03** (adversarially reviewed same session; findings applied). Read together with `spec-redraft-leagues.md` **v2.8.10** (the LAW) and `delivery-plan-redraft-leagues.md` **v1.3**. This doc sequences M2 into Builder-sized tasks (each ≤ half a day); it never overrides the spec. Builder sessions take **one task each**, in dependency order (§6), and satisfy delivery plan §2.3 DoD per task **plus the M2 standing rules (§4)**.
>
> **What M2 is:** the draft engine is the highest-stakes, most concurrency-sensitive surface in the app (spec §8 preamble; plan principle 5 — "draft night is the SLA"). Everything here is **server-authoritative**: clients never decide who is on the clock, what time is left, or whether a pick is legal. M2 also lands the repo's first realtime wiring (Broadcast-from-DB, §9.2), the first E2E layer (Playwright, plan §4.1/D39), and the **League Simulator** (plan §4.2 — "build it in M2; everything else stands on it").
>
> **What M2 is NOT:** the auction engine (`draft_bids`, nominate/bid, anti-snipe, solvency — M3); in-season anything (matchups, lineups, waivers, schedule — M4/M5); `commissioner_actions` (M6 — see D97/F40). The auction-draft-room mock component is deliberately untouched until M3 (§9 C25).

**Spec sections in scope:** §7.1 (lifecycle: `scheduled → drafting → in_season`), §7.2 (capacity, autodraft), §7.3.8 (draft configuration + validation), §7.4 (list ↔ league tie-in), §8.1–8.5, §8.7–8.9 (engine, timer, order, queue/autopick, snake flow, commish controls, chat + Mock Draft Mode, draft references), §9 (realtime architecture — all of it), §12.3–12.4, §12.6–12.7, §12.13–12.15 (schema), §14 (`draft-tick`), §15.2/§15.5/§15.6 (API + hooks), §16.1–16.5 (draft-room UI slice), §17 (permissions), §19.2 E1–E4/**E15/E17**/E30–E31/E48/E59–E60 *(E14's drift/no-dropped-picks half runs at 16 teams — its 20-team premise conflicts with v1's 8–16 sizes and routes to M7 with F43's performance pass, C31; E16's bipartite slot-fit is M4's lineup validator — M2's autopick uses the documented greedy)*, §22.1/22.3/22.5 (load model, job architecture, mock caps)
**Delivery plan:** §3 M2 row (contents + exit criteria), §2.1–2.3 (loop + DoD), §4.1 (pyramid — Playwright lands here), §4.2 (League Simulator — built here), §8.1–8.4 (checklists; **§8.4 realtime is IN FORCE for the first time** — the D38 waiver era ends where a subscriber exists)

---

## 1. M2 contents & exit criteria (restated from delivery plan §3)

**Contents:** L.B1–L.B4 + v2.0: pause bookkeeping (`deadline_remaining_ms`) · K/D-ST autopick deferral (E30) · SKIP-LOCKED `draft-tick` (§22.3) · Broadcast-from-DB triggers + private channel auth (§9.2) · **Mock Draft Mode (snake)** (§8.8: humanized timing, speed toggle, 72h expiry, recap, 3-active cap) · `league_lists` + attach UI + the draft-room My Lists panel with primary-board autopick (§7.4/§8.9/§12.15 — sequenced here by D32) · the **League Simulator** (plan §4.2) · the **Playwright bootstrap** (plan §4.1; D39 discharge — the deferred Phase A journey E2E lands with it).

**Exit criteria (all must pass; proof map in §8):**
1. **Spec §18 Phase B gate:** run a full snake draft to completion with live clients; commissioner can pause, undo (single + cascade), reassign a pick, and move a drafted player between teams; disconnect/reconnect is seamless; `league_rosters` populated; status → `in_season`; a solo mock snake draft (§8.8) completes against CPU opponents with realistic timing and zero league side effects.
2. **Simulator runs 25 concurrent bot snake drafts to completion — zero duplicate picks, zero stuck clocks.**
3. **Reconnect < 2s verified in E2E** (§8.7 disconnect/robustness: refetch authoritative state, then resubscribe).
4. **A solo mock snake draft E2E:** launch → CPU picks with realistic timing → finish → recap → **zero league writes** (asserted by DB diff, not absence of errors).

**Sequencing dispositions (not conflicts):** the auction halves of §8 (§8.6, `draft_bids`, E5–E6/E25–E29/E62) are M3 per the delivery plan; M2's engine leaves the auction seams in place (`drafts.current_nomination`, `draft_type`, config fields) but implements none of them. `linear` drafts are implemented (one branch in the order math — §7.3.8 calls linear "a cheap variant of snake") but v1 QA focuses snake + auction per the same row; the sim matrix runs snake only in M2. **E14** splits: the no-dropped-picks/clock-drift substance is proven at 16 teams (L.B6.1's matrix + L.B5.1's drift assertion); its printed 20-team size is unreachable in v1 (`team_count` ∈ {8..16}, §7.3.8) — the 20-team performance pass rides M7/F43 (C31). **E16** (overlapping-flex bipartite slot-fit) belongs to M4's lineup validator; M2's autopick need-model is the documented greedy (L.B1.3).

---

## 2. Current state (surveyed 2026-08-03; multi-agent survey, every fact file:line-verified)

- **Green field on draft symbols.** No migration creates `drafts`, `draft_picks`, `draft_queues`, `draft_bids`, `league_rosters`, or `league_lists` — grep over `supabase/migrations/` returns zero hits; 001's 27-table inventory has no draft table. Next migration = **065** (064 = league profile); next pgTAP file = **019** (018 = league profile). Builders confirm next-free at task time (the M1 drift lesson — tasks-M1 §7).
- **The M1 platform M2 builds on (all landed, pgTAP 19 files / 951):** `leagues` full settings surface incl. `status` CHECK (`setup|scheduled|drafting|in_season|playoffs|complete`, 059:105–107) + `scoring_rules_snapshot` with the D43 BEFORE-trigger guard (059:112–136 — raises on any `drafting`+ row with a NULL snapshot, all roles; **M2's `draft_start` inherits it mechanically**); `snapshot_league_scoring` restricted to `setup`/`scheduled` (059:174–179 — D64(2): draft_start snapshots BEFORE its transition, exactly the sanctioned window); `set_league_status` refuses every `drafting`+ target with "the draft engine lands in M2" (059:257–262 — **M2 removes this refusal only via `draft_start`'s own path**, never by widening `set_league_status`); `league_members` with `is_autodraft` + `faab_balance` (052:70–71), SELECT-only on the client (063:343–348); `teams` franchise columns + `one_open_stint_per_team` (053); the full invite/claim/member-management RPC surface (062/063) with the SQLSTATE convention (42501 auth/no-leak · P0002 → 404 · P0001 friendly refusal · 22023 arg shape; 063:234–245) and lock order `leagues → league_members → teams` (063:254–268).
- **Post-M1 work that landed OUTSIDE the Builder loop (PRs #69–#73, 2026-07-27→08-03) — PROGRESS §2/§4 does not fully record it (C24/D86):** PR #71 (six commits, no D-entries) shipped: a **3-step `LeagueCreateModal`** replacing the `/new` wizard page (`league-create-wizard.tsx` DELETED; the ops layer `league-create-wizard-ops.ts` survives and powers the modal — league-create-modal.tsx:22–28); the **Manage page folded into League home** (`league-manage-view.tsx` + `/manage` route DELETED; `league-home-states.tsx` renders `InvitePanel` directly at :201–205/:355–359); **a draft scheduling picker already exists** — `ScheduleDraftGroup` (settings-panel.tsx:1168–1286), a Month/Day/Time stepped picker writing the NESTED `settings.draft.draft_scheduled_at` as an **offset-ISO instant** (no IANA zone — settings-panel.tsx:1136–1146) through the ordinary atomic settings PATCH; collapsible settings sections + a "Draft setup" section holding the schedule card + draft-config card (settings-panel.tsx:440–447). PR #72 = migration 064 + pgTAP 018 (league profile). PR #73 = `supabase/seed.sql` (deterministic dev users on every `db reset`) + `restore:dev`. **Consequence: F38's "no date/time picker exists in M1" is stale — M2's remaining scheduling scope is the IANA zone (D98) + order-method UI + the CTAs, not a first picker.**
- **The F38 CTAs are still disabled stubs:** `StubbedCta label="Enter draft lobby"` / `"Practice this draft"` at league-home-states.tsx:307–308 (disabled, `title="Arrives with the draft room"`); `layout/draft-bar.tsx`'s `useDraftAlert()` returns `null` unconditionally with `TODO(M2 draft engine — F38)` (draft-bar.tsx:15–22). The `drafting` status renders the "not yet" `later` placeholder (league-home-states.tsx:107–118) — M2 builds the real LIVE hero; `in_season`+ stays placeholder until M4.
- **Draft mock UI (7 files, 1,136 lines, `src/components/draft/`):** `snake-draft-room.tsx` (180 — local-state simulation: `handleDraft` appends to local board :76–90, `useMockDraftClock` is a wrap-around setInterval), `auction-draft-room.tsx` (391 — M3; carries the repo's one standing lint warning, unused `league` at :105), `best-available-card.tsx` (**fetches the REAL pool** from `/api/players/builder` and subtracts mock-board picks BY NAME :26–45 — C26), `draft-pick.tsx` + `draft-queue-card.tsx` (presentational, reusable), `mock-draft.ts` (223 — its own header instructs M2: *keep the exported types, delete the `MOCK_*` constants, feed the rooms from the live channel*; pure `roundForPick`/`managerForPick` already implement snake order math :47–61), `use-mock-draft-clock.ts`. Route `src/app/app/leagues/[leagueId]/draft/page.tsx` renders fixtures chosen by `?format=` (:19–23) — C25. **No `mock-draft-launcher` exists anywhere.** No chat UI exists in either room.
- **Realtime: literally zero usage anywhere.** No `channel(`/`broadcast`/`realtime.` call in `src/` (the only hits are a polling comment in use-notifications.ts:44 and an RSS variable); no `realtime.messages` policy or realtime DDL in any migration (every migration "realtime" hit is a D38 waiver banner). config.toml `[realtime] enabled = true` (config.toml:84). M2 writes the repo's first triggers, first channel-auth policies, and first client subscription.
- **Background work: Vercel crons only — no pg_cron, no Edge Functions.** `vercel.json` schedules 4 Next.js cron routes (min granularity 1 minute); `supabase/functions/` does not exist; grep for pg_cron over `supabase/`+`src/` = zero. **A ~5s `draft-tick` cannot ride this pattern** → D87.
- **Settings contract (the §7.3.8 block is fully authored):** `draftConfigSchema` at league-settings.ts:189–204 carries EVERY §7.3.8 field (`draft_type`/`snake_reversal`/`draft_order_mode`/`draft_order`/`pick_timer_seconds` ∈ PICK_TIMER_SECONDS incl. 0 = untimed/auction fields/`nomination_order_mode`/`autopick_default` literal/`disconnect_grace_seconds`/`draft_scheduled_at`); the whole draft block lives in the `settings` JSONB blob (`draft` is NOT a typed column — league-settings.ts:541–553); `deriveRosterSize` = starters + bench + **IR** (league-settings.ts:180–183) → D91 (total_rounds excludes IR).
- **Autopick sources exist in-DB:** `draft_queues` (M2 creates), `league_lists` → `lists`/`list_players` (M2 creates the join table), the user's Big Board = `lists.is_big_board` (partial-unique per owner, auto-created at signup — 001:207/221–222/933–935), `players.adp NUMERIC` (002:15, indexed :22). Placeholder/CPU seats have no user → their resolution collapses to ADP + need, which is exactly §8.8's bot behavior (D93).
- **Service layer + hooks:** `leagues-service.ts` (create/patch/detail; `deepMergePatch` at :256–264 — **R83's `__proto__` no-op is still unfixed**, grep for `__proto__` in src/ = 0 hits; PROGRESS pinned :244, the function has shifted); `members-service.ts` carries `AUTODRAFT_DEFERRED_MESSAGE` ("Autodraft toggles arrive with the draft engine in M2 — this league has no draft yet.", :111–112) returned as a 400 on any `is_autodraft` PATCH (:127–132) — **F33's discharge site**; hooks `use-league(s)/use-league-members/use-league-invites/use-scoring-templates` establish the pattern: reads = RLS-scoped direct SELECT or GET route, writes = React Query mutations over routes (D92 follows it).
- **Test infra:** vitest (`test` all, `test:gate` = M0 substring filter, `test:gate:m1` = `scripts/gate-m1.sh`), pgTAP via `test:db` (19 files / 951, files numbered independently of migrations — 018 covers 064). **Playwright is NOT installed** — no dep, no config, no `test:e2e` script (CLAUDE.md's Commands line is still aspirational — C22). `supabase/seed.sql` gives every fresh reset two deterministic confirmed dev users (11111111-… `dev@fieldscout.local`, 22222222-… `dev-pro@fieldscout.local`, password `dev-password-1234`) — the E2E auth fixture problem is pre-solved.
- **`league_chat` (001:527–535) + its C11 policies are unchanged since 001:** SELECT + INSERT both keyed on the old `teams.league_id` ownership proxy (001:880–893), not `is_league_member` — the F18 chat half M2 replaces. `team_lineups`' surface (001:850–861, world-readable + owner FOR ALL) stays M4's (F18 other half). No `context`/`is_system` columns exist yet (§12.13 ALTER is M2's).
- **ESLint time/random guard** covers `src/lib/leagues/**` recursively (.eslintrc.json:3–81 — Date/performance/Math.random/crypto bans): the sim (`src/lib/leagues/sim/`) is auto-guarded; draft UI under `src/components/` is not (component-layer ticking clocks are legal, the D82(4) precedent — but deadline math must still come from server timestamps, §9.3).

---

## 3. Design decisions (Architect; logged as D86–D101 in PROGRESS §4)

- **D86 — The out-of-loop PR #69–#73 record.** PR #71's six UI commits and PR #73 carry no D-entries and stale PROGRESS text (§2 L.A2.1/L.A2.4 cite deleted files; F38 claims no picker exists). This breakdown's §2 survey is the corrected record; the PR carrying this doc annotates the stale PROGRESS cells and F38 row (bracketed corrections, R45 de-staling pattern — no history rewritten).
- **D87 — `draft-tick` = pg_cron calling an in-database SQL RPC; no Edge Function, no HTTP hop.** §8.2/§14 name "Supabase Edge Function invoked by pg_cron"; the repo has zero Edge Functions and its cron pattern (Vercel, 60s floor) cannot run a ~5s tick. The tick's entire work — deadline scan, autopick, advance, broadcast — is in-database, so the Edge Function wrapper is a vehicle, not a requirement; §15.2 already lists `draft_tick` as an RPC. Ship: `CREATE EXTENSION pg_cron` + one `cron.schedule('draft-tick', '5 seconds', …)` entry calling `draft_tick()` (SECURITY DEFINER, `FOR UPDATE SKIP LOCKED` batch claim per §22.3, self-gating no-op when no draft is `live`). The spec's "immediate self-schedule after each action" exists to tighten Edge-Function latency; in-database, an action RPC sets the next deadline synchronously and the ≤5s cron enforces expiry — worst-case timeout enforcement lag ~5s, inside incumbent norms (the p95 pick→broadcast < 500ms metric targets user actions, not timeouts). Escape hatch recorded: if 5s proves coarse, add pg_net self-invocation later without changing the RPC contract. Folded into the spec as an erratum (§8.2/§14 vehicle note).
- **D88 — `league_rosters` ships in M2.** §18 Phase B's gate requires "`league_rosters` populated; status → `in_season`" while §18 Phase D's migration list also names `league_rosters` — an internal §18 sequencing contradiction. Resolved in favor of the gate (it is explicit and testable): M2 creates §12.7 verbatim (exclusivity `UNIQUE(league_id, player_id)`, member SELECT, no client writes) and writes ONLY the completion path (`acquisition_type='draft'`, `acquisition_cost` NULL for snake). Every in-season writer (add/drop/trade/commish move, `slot_key` management) is M4+. Erratum: §18 Phase D's list annotated "(created M2 at draft completion; extended here)".
- **D89 — §12.14's `supabase_realtime` publication ALTER is NOT executed.** Its own comment ("so Postgres Changes broadcast") is v1.x text that §9's v2.0 transport rule explicitly supersedes ("clients never use Postgres Changes"); `realtime.broadcast_changes()` writes to `realtime.messages` and needs no publication membership. Adding the tables would only re-enable the anti-pattern the checklist (§8.4) bans. Erratum: §12.14 rewritten to the Broadcast-from-DB trigger inventory. (Resolved Architect-side per the D48 precedent — the spec elsewhere unambiguously governs; flagged in the PR body for Chris's read.)
- **D90 — Engine authority lives in SQL only; TS gets display math, pinned by parity.** Turn order (snake/linear/3RR), autopick resolution, K/D-ST deferral, CPU timing — one implementation each, in the RPCs/tick. No TS twin of any decision the server makes. The UI keeps `mock-draft.ts`'s pure `roundForPick`/`managerForPick` (renamed/kept per its header) ONLY to render empty future cells, and a fixture test pins TS-predicted assignments ≡ a SQL-driven draft's actual `draft_picks` rows for every (team_count 8..16) × {reversal on/off} × {linear} — drift between display and truth fails the suite.
- **D91 — `total_rounds` = Σ starting-slot counts + bench (IR excluded).** §12.3's comment says "derived from roster_size", but the §7.3.8 `roster_size` (deriveRosterSize) includes IR spots — and §7.3.2's IR eligibility rules (a spot holds only players carrying an eligible designation) make "drafting into IR" unsatisfiable for healthy draftees. Rounds therefore count draftable spots: starters + bench. Erratum clarifying §12.3's comment; golden-pinned per size in pgTAP (default roster → 15 rounds: 9 starters + 6 bench).
- **D92 — Draft reads are RLS-scoped hooks; writes are Route Handlers → RPCs.** §15.2 prints no GET for draft state — deliberate: `drafts`/`draft_picks` are member-SELECTable, so `use-draft` refetches them directly (the `use-league-invites`/`use-scoring-templates` precedent, D79(2)), and §15.6's "subscribes to `draft:<id>`" hook owns refetch-then-subscribe. `draft_queues` reads are own-team by RLS (never broadcast — §9.2). Every mutation is a §15.2 route.
- **D93 — Mock CPU mechanics: the server's own autopick + deterministic think-time; the "one implementation, two consumers" promise lands server-side.** A mock's CPU seats are simply seats with no human; their picks are made by `draft_tick` running the SAME autopick strategy as a live timeout — plan §4.2's "every mock exercises the tested path" is satisfied maximally (the mock IS the timeout path). Humanized timing: think-time = seeded PRNG(`draft_id`, `pick_number`) mapped to 20–70% of the pick clock (`realistic`) or ~2s (`fast`), computed on the fly by the tick — no stored schedule, fully deterministic, the human's clock always real (§8.8). Auto-pause on disconnect: the room heartbeats `draft_liveness` (D102 — one mechanism for real AND mock drafts); the tick auto-pauses a live mock whose human `last_seen_at` is stale past `disconnect_grace_seconds` + one tick. Caps in-body at launch: 3 active mocks/user, creation 5/hour/user (§22.5 — these two are product rules with §16.5.2 states, so they land now; generic route rate limits stay M7/F41). *(Mock authorization + capacity narrowings: D103.)*
- **D94 — Real drafts auto-start at `draft_scheduled_at`; the tick scans LEAGUES, so a missing drafts row can never dead-end a scheduled league.** §8.5.1 "Room opens at `draft_scheduled_at` (or commissioner clicks Start Draft). Status → `drafting`" — read as: either event starts the draft. The tick's auto-start arm scans `leagues` in `scheduled` whose `settings.draft.draft_scheduled_at` ≤ now with no live/complete non-mock draft, **creating the drafts row if absent** (`draft_create` is idempotent vs the partial unique) and starting it (capacity + snapshot checks identical to the manual path; failures surface as a lobby banner, retried each tick, never a silent skip); the commissioner's Start button is the early/manual path. This closes the gap where a league scheduled purely through the shipped settings surface (which creates no drafts row) would otherwise never start. Absent rooms still draft correctly (autopick + the authoritative-clock principle, §14).
- **D95 — `drafts.config` hydration: at creation, re-hydrated at start; SETTINGS is the single pre-start store for the schedule.** POST `/api/leagues/[id]/draft` creates the row hydrating §7.3.8 from current league settings ("hydrated when scheduled"); pre-start settings edits — **including every `draft_scheduled_at` change — flow through the settings PATCH only** (the shipped `ScheduleDraftGroup` path; `PATCH /api/leagues/[id]/draft` carries NO schedule field, eliminating dual-writer drift for the D94 scan), so `draft_start` re-hydrates config from live settings at the start instant — the fidelity moment; a mock snapshots at launch (§8.8) and never re-hydrates. One live/scheduled non-mock draft per league at a time (partial unique index) — a draft row is reusable across reschedules; `draft_reset` returns it to `scheduled`.
- **D96 — Short-draft commissioner override deferred to M6.** §7.2 capacity says the commissioner "may override to draft short — audited". The audit table is M6's, and placeholder seats make full capacity always reachable (a placeholder IS a franchise and autodrafts — D93's no-user rule). M2's `draft_start` requires active (non-retired) franchises == `team_count`, friendly refusal pointing at placeholder seats. D42-class scope cut; **F45** routes the audited override to M6.
- **D97 — Commissioner draft controls ship with mandatory system chat posts; audit rows wait for M6.** Every §8.7 control validates + accepts `reason` (Zod, stored nowhere — the F32 pattern) and writes a **non-disableable `league_chat` system post** (`is_system = TRUE`, §8.8) in the same transaction — the room sees every override happen (§16.3) even before the audit log exists. New ledger row **F40** carries the M6 audit obligation for the full §8.7 control list.
- **D98 — IANA league draft zone: additive `draft.time_zone` (IANA string, nullable, default null).** §16.4 requires a league reference timezone and F38 routes the "named per-league IANA draft zone" here, but no catalog field exists. Added additively to the §7.3.8 block (erratum): display-only metadata — instants (`draft_scheduled_at`, `current_deadline`) stay the authority; when set, league-time renders as the named zone (Intl `timeZone`), when null the M1 offset render stays. The draft-setup surface offers the scheduler's own zone as the one-tap default.
- **D99 — Draft chat = `league_chat` + `context`/`is_system` (§12.13), direct client INSERT retained, C11 policies replaced.** §9.3 sanctions exactly one direct client write — `league_chat` — so no chat route is added. 065 replaces the teams-keyed policies with: SELECT `is_league_member`; INSERT `is_league_member` AND `user_id = auth.uid()` AND `is_system = FALSE` AND length ≤ 500 AND (for `draft:` contexts) the draft belongs to the league. System posts are written only by the §8.7 RPCs (no client can forge one — WITH CHECK pins `is_system = FALSE`). No UPDATE/DELETE for anyone (chat is append-only in v1). Mock chat scopes by `context = 'draft:<mock_id>'` (member-visible per the printed SELECT — visibility is not a §8.8 "side effect"). Rate limiting (§22.5 chat 5/10s) routes to M7 — **F41**.
- **D100 — The simulator drives the service layer; Playwright drives the browser; virtual time in the DB via privileged deadline rewinds.** Bots are per-user authed supabase clients driving the REAL RPC path through the service layer (the D68(6)/M1-gate precedent — the Next cookie layer is the only plumbing skipped; "real RPCs through the real API, never direct DB writes" per plan §4.2), each with a seeded PRNG persona; timeout/grace scenarios are produced by service-role `current_deadline` rewinds between tick invocations (a harness move, like lifecycle-db's fixtures) — **production RPCs never accept a caller clock**. Reconnect-<2s and UI truth are Playwright's alone.
- **D101 — Randomize order = instant seeded shuffle; the reveal animation is Phase F.** §8.3's "visible animation (and an optional reveal screen)" is listed in §18 Phase F's contents. M2: randomize writes the result immediately (result-before-start per §8.3); the lobby shows the final order; the animation/reveal ships in M7 — **F43**.
- **D102 — `draft_liveness` + the spec-faithful grace/outage contract.** The spec keys disconnect grace and the commissioner-outage auto-pause to *connectedness* (§7.3.8: "Disconnected manager isn't auto-picked until grace elapses"; §8.5.4 timeout → autopick AT deadline vs §8.5.5 disconnect; §8.7:478 auto-pause "so nothing runs unsupervised"), but Supabase Presence is ephemeral — the tick cannot read it. Mechanism: a minimal **`draft_liveness(draft_id, user_id, last_seen_at, PK(draft_id, user_id))`** table (spec-absent schema, recorded here + erratum — the D46 precedent) written ONLY by a tiny `draft_touch` RPC the room calls (~15s cadence + visibility change); **deliberately its own table, never a `drafts` column — heartbeats must not contend with the draft-row lock**. No broadcast, no client DML. Tick contract at deadline expiry: `is_autodraft`/no-user seats and seats with a FRESH heartbeat (≤ 2 missed beats — a pinned constant) autopick AT deadline (§8.5.4); a STALE seat's pick is held open until deadline + `disconnect_grace_seconds` — the returning human may pick manually during the hold ("reconnect restores manual control", E3) — then autopicks. Commissioner outage (§8.7): a live NON-mock draft where no commissioner/co-commissioner heartbeat is fresh for > `disconnect_grace_seconds` auto-pauses (system chat post; resume is a commissioner action). Mocks reuse the same table for the D93 stale-pause.
- **D103 — Mock-mode narrowings (three, each a recorded reading of §8.8).** (1) **Launch requires active franchises == `team_count`** (mirror of D96): the order needs a full seat map and `draft_picks.team_id` is a NOT NULL FK — a half-seated league cannot host a full-board mock without minting league rows (a forbidden side effect); friendly refusal names placeholder seats as the remedy. (2) **Pick authorization:** in a mock, the ONLY legal human caller of `draft_make_pick` is `config.mock.launched_by`, and only when `on_clock_team_id = config.mock.human_team_id` ("any seat selectable" means the launcher's chosen seat — not that managing a seat elsewhere confers pick rights, and no other member may drive someone's solo practice); every other seat is tick-only. (3) **Queue ownership:** the launcher owns the human seat's queue regardless of stint — `draft_queues` RLS gains a mock carve-out (owner check OR mock-launcher-of-this-draft) since the chosen seat may be another user's franchise.

---

## 4. Standing rules for every M2 task

Rules 1–4 carry forward from tasks-M1 §4 **verbatim and in full force** (grants doctrine D18→D23 · no-write-policy pgTAP pattern · falsifiability floor incl. the ≥1 deliberate-break probe · migration checklist + R6 rehearsal waiver + typegen alias-block re-append). Two new rules join them; Builders cite all six in the self-review note:

5. **Realtime doctrine (plan §8.4, now literal).** The D38 waiver era is over wherever a subscriber exists: every authoritative-table write a client renders live reaches it via a Broadcast-from-DB trigger on a **private** channel with a `realtime.messages` policy covering the topic; payloads are column-selected (never `draft_queues` rows, never anything blind); `realtime.send()` for synthetic events. **No Postgres Changes subscription anywhere in any diff** (§9's transport rule; D89). Clients: fetch-then-subscribe, `state_version` gap ⇒ refetch, countdowns from server timestamps only, ≤ 3 channels per socket, unsubscribe on route change (§9.3).
6. **Draft-row lock discipline (§8.1/plan §8.3).** Every state-changing draft RPC: `SELECT … FROM drafts … FOR UPDATE` FIRST → validate (turn, status, legality, idempotency) → write → advance + set `current_deadline` → return new authoritative state. Held-lock < 50ms asserted in an integration test per RPC family. `action_id` idempotency on every client-triggered mutation (E2); the E1 race loser gets the friendly "just went off the board" message. SQLSTATE conventions carry from 063 verbatim (42501 auth/no-leak · P0002 → 404 · P0001 friendly · 22023 shape); error strings are UX (§8.3 checklist).

---

## 5. Interface sketches (Builder finalizes exact fields; names below are contractual)

```sql
-- L.B1.2 core (all SECURITY DEFINER SET search_path=''; REVOKE FROM PUBLIC, anon; §4.6 lock discipline)
draft_create(p_league_id uuid) RETURNS jsonb            -- hydrate §7.3.8 config from settings (D95); one live/scheduled non-mock draft per league
draft_start(p_league_id uuid) RETURNS jsonb             -- commish; requires status='scheduled' + franchises == team_count (D96);
                                                        -- re-hydrates config; generates/validates draft_order (random|manual|custom);
                                                        -- total_rounds per D91; calls snapshot_league_scoring BEFORE status → 'drafting'
                                                        -- (D43/D64(2) — the guard trigger proves the order); sets pick 1 deadline
draft_make_pick(p_draft_id uuid, p_player_id text, p_action_id uuid) RETURNS jsonb
  -- lock → my-turn check (manager of on_clock team, or commish force path) → uniq_draft_player_live catches E1 →
  -- uniq_draft_action replays E2 as no-op → insert pick → advance (snake/linear/3RR) → next deadline → completion detection

-- L.B1.3 (the worker; D87/D102)
draft_tick() RETURNS jsonb  -- pg_cron '5 seconds'; claims due drafts FOR UPDATE SKIP LOCKED (idx_drafts_due);
  -- arms: auto-start (D94 — scans scheduled LEAGUES, creates the row if absent) · timeout → autopick at deadline for
  -- autodraft/no-user/FRESH seats; STALE seat held open to deadline + grace, manual pick allowed during the hold (D102) ·
  -- mock CPU think-time (D93) · mock stale-pause · commissioner-outage auto-pause for real drafts (D102 — arm lands L.B1.4);
  -- autopick resolution: queue → primary league-tagged board (league_lists) → owner's is_big_board list → players.adp,
  -- filtered by need-fit (greedy slot model, documented in the banner) + E30 K/D-ST deferral; is_auto=TRUE, made_via='autopick'
draft_touch(p_draft_id uuid) RETURNS void  -- the D102 liveness heartbeat (real + mock rooms); writes draft_liveness only

-- L.B1.4 commissioner controls (each: validate → write → system chat post in-txn (D97) → broadcast)
draft_pause(p_draft_id) / draft_resume(p_draft_id)      -- deadline_remaining_ms bookkeeping (§8.7 v2.0: clocks never gain/lose time)
draft_set_clock(p_draft_id, p_pick_timer_seconds)       -- E15: subsequent picks; may extend current deadline
draft_undo(p_draft_id, p_to_pick_number default null)   -- single or cascade (E4): is_undone=TRUE soft-undo, clock rewinds
draft_reassign_pick(p_draft_id, p_pick_id, p_team_id default null, p_player_id default null)
draft_move_player(p_draft_id, p_player_id, p_from_team, p_to_team)
draft_force_pick(p_draft_id, p_player_id)               -- pick for the on-clock team (made_via='commissioner')
draft_set_order(p_draft_id, p_order uuid[])             -- pre-start free; post-start = E31 (remaining picks re-derive)
draft_reset(p_draft_id)                                 -- wipe to pre-draft, status → 'scheduled'; drafting/paused only (post-completion → M6, F44)

-- L.B1.6 mock mode (§8.8; D103)
create_mock_draft(p_league_id, p_human_team_id, p_cpu_speed) RETURNS jsonb  -- any member, league in setup/scheduled,
  -- franchises == team_count (D103(1)); snapshots real config; is_mock=TRUE;
  -- config.mock = {human_team_id, cpu_speed, launched_by}; caps in-body (D93); liveness via draft_touch (D102)
delete_mock_draft(p_draft_id) RETURNS void  -- launcher-only delete (covers abandon + recap-delete)
```

```ts
// src/hooks/use-draft.ts (§15.6; D92) — THE room data spine
useDraft(draftId)   // refetch drafts+draft_picks via RLS SELECT → render → subscribe 'draft:<id>' → apply broadcasts as
                    // cache patches; monotonic state_version (drafts.updated_at) gap ⇒ full refetch; reconnect ⇒ refetch-first (§9.3)
useDraftQueue(draftId, teamId)  // own rows only; optimistic reorder (§15.6); never broadcast
useActiveDraft(leagueId)        // lobby/CTA/draft-bar summary (rides getLeagueDetail's active-draft summary — L.B2.1)

// src/lib/leagues/sim/ (plan §4.2; D100) — pure orchestration, auto-time-guarded
npm run sim -- draft --leagues 25 --teams 12 --clock 5 --seed 42   // prints seed; `sim replay <seed>` reproduces exactly
// personas: queue-drafter · adp-drafter · afk (timeout path) · chaos (double-taps every action — E2)
// invariant sweep after every run: zero duplicate live picks per draft · every board complete (teams × total_rounds) ·
// zero stuck clocks, grace-aware (D102: human seats stuck only past deadline + grace + tick + ε; autodraft/no-user
// seats past deadline + tick + ε) · per-team pick count == total_rounds ·
// league_rosters count == picks count · status == 'in_season' · zero unhandled worker errors
```

**Channels & payloads (§9.1–9.2):** topic `draft:<draft_id>` — `drafts` UPDATE (column-selected: status, current_pick_number, current_round, on_clock_team_id, current_deadline, paused_at, updated_at), `draft_picks` INSERT/UPDATE (pick_number, round, team_id, player_id, is_auto, is_undone), `league_chat` INSERT for `context='draft:<id>'`, Presence, tick heartbeat (server now + deadline). Topic `league:<league_id>` — `leagues` status/profile updates (flips the home hero + draft bar). Auth: `realtime.messages` SELECT policies per §9.2 (league topic via `is_league_member(uuid)`; draft topic via the `drafts.league_id` lookup). **Never broadcast:** `draft_queues`, anything blind.

---

## 6. Task list (one Builder session each; ≤ half a day)

Dependency order — **schema lane serialized** (plan §2.2; one migration number chain), API/UI/E2E fan out behind their deps:

```
SCHEMA  L.B1.1(065: tables+chat) → L.B1.2(066: start/pick core) → L.B4.1(067: league_lists) → L.B1.3(068: autopick+tick)
        → L.B1.4(069: commish controls) → L.B1.5(070: realtime — F8) → L.B1.6(071: mock mode) → L.B1.7(072: completion+rosters+autodraft — F33)
API     L.B1.2 → L.B2.1 (schedule/start/lobby + R83) · {L.B1.3, L.B1.7, L.B4.1} → L.B2.2 (pick/queue/autodraft incl. from-list) · {L.B1.4, L.B1.6} → L.B2.3 (commish + mock routes)
UI      {L.B2.1, L.B1.5} → L.B3.1 (room shell + realtime client) · {L.B3.1, L.B2.2} → L.B3.2 (board/pool/queue/tracker) ·
        {L.B3.1, L.B2.3} → L.B3.3 (chat + commish panel) · {L.B2.1, L.B3.1} → L.B3.4 (lobby + CTAs + draft-setup — F38) ·
        {L.B2.3, L.B3.2} → L.B3.5 (mock launcher + recaps) · {L.B4.1, L.B3.2, L.B2.2} → L.B4.2 (attach UI + My Lists panel)
SIM/E2E {L.B2.1, L.B2.2, L.B1.7} → L.B6.1 (simulator) · {L.B3.3, L.B3.4, L.B3.5, L.B1.7} → L.B5.1 (Playwright bootstrap + E2E)
GATE    everything → L.B7.1
```

### L.B1.1 — Migration 065: `drafts` + `draft_picks` + `draft_queues` + `league_chat` draft extension (C11/F18 chat half)
> Read spec §12.3/§12.4/§12.6/§12.13, §8.1 (concurrency model), §9.2 (what will never broadcast), delivery plan §8.1–8.2, this doc §2–4, D99. Schema lane opener. **No RPCs in this migration** — tables, constraints, indexes, RLS only.
>
> 1. `065_draft_tables.sql`: §12.3/12.4/12.6 DDL verbatim (member SELECT on `drafts`/`draft_picks`, no client writes; `draft_queues` own-team SELECT + FOR ALL per the printed policy — the one spec-sanctioned client-writable draft table; commissioner read of all queues per §12.6's comment is deliberately NOT shipped as a policy until a debugging surface consumes it — **F48** routes it to M6's console). Indexes: `uniq_draft_player_live`, `uniq_draft_action`, `idx_draft_picks_draft`, `idx_drafts_league`, `idx_drafts_active`, `idx_draft_bids`-family SKIPPED (M3), plus `idx_drafts_due ON drafts(current_deadline) WHERE status='live'` (§22.3) and a **partial unique `one_active_real_draft_per_league` ON drafts(league_id) WHERE is_mock = FALSE AND status IN ('scheduled','live','paused')** (D95). CHECKs: `drafts.status IN ('scheduled','live','paused','complete')`, `draft_type IN ('snake','auction','linear')` (the R43 lesson — enum comments become CHECKs at creation).
> 2. `league_chat` ALTER per §12.13 (`context TEXT DEFAULT 'league'`, `is_system BOOLEAN DEFAULT FALSE`) + **replace the two 001 teams-keyed policies** per D99 (SELECT `is_league_member`; INSERT membership + own `user_id` + `is_system = FALSE` + `char_length(message) <= 500` + draft-context validity; no UPDATE/DELETE for anyone). This is C11's fix and **F18's chat half — flip the ledger row's chat portion with a pointer here** (team_lineups half stays M4).
> 3. pgTAP **019**: §4.2 per-role deny-by-default on all three tables + chat; the E1 index proven directly (privileged double-insert → 23505; undone pick coexists); `uniq_draft_action` NULL-action_id coexistence (system picks); chat: member posts, non-member 42501, `is_system` forge refused, teams-keyed-ghost counter-pin (a teams-row owner with no membership sees nothing — the 052 policy-swap falsifiability pattern).
> 4. Typegen + alias block (add `Draft`, `DraftPick`, `DraftQueueEntry` aliases).
>
> DoD: §4 standing rules; fresh `db reset` 001–065; break probe (e.g. drop `WHERE is_undone = FALSE` from the unique index → the undone-coexistence pin fails) shown + reverted.

### L.B1.2 — Migration 066: `draft_create` + `draft_start` + `draft_make_pick` (the serialized core)
> Read spec §8.1 (the five-step action contract), §8.3 (order), §8.5 (flow), §7.2 (capacity), §7.3.8, §12.3–12.4, this doc D90/D91/D94/D95/D96 + §4.6. Depends L.B1.1.
>
> 1. `draft_create` + `draft_start` per the §5 sketch. Start: commish 42501 → league lock → `status='scheduled'` required → capacity == team_count (D96 friendly refusal naming placeholder seats) → config re-hydration from live settings → order generation (`random` = seeded shuffle written before start (D101); `manual`/`custom` = validate the stored array is a permutation of active team_ids) → `total_rounds` per D91 → **`snapshot_league_scoring` call BEFORE the status UPDATE** (059's setup/scheduled window — the D43 trigger is the backstop and the pgTAP probe) → `status='drafting'`, `started_at`, pick-1 deadline (`pick_timer_seconds` 0 ⇒ NULL deadline, §8.2 soft-timer). Draft rows are league-scoped; `on_clock_team_id` from order[0].
> 2. `draft_make_pick` per the §5 sketch: the full §8.1 five-step contract. Turn validation = caller manages `on_clock_team_id` (open stint / membership cache per M1's access model) — commissioners use L.B1.4's force path, not this RPC; **the mock branch (launcher-only, human seat only — D103(2)) is amended in by L.B1.6, cross-referenced in this banner so neither session misses the seam.** Advance math: snake reversal per round parity, `snake_reversal` flips round 3 (3RR), `linear` repeats. Completion (all `total_rounds × team_count` live picks) sets `status='complete'`/`completed_at` — **league transition + rosters land in L.B1.7** (this task's completion is mock-sufficient; banner cross-references).
> 3. pgTAP **020**: order math golden pins (8-team no-reversal + 12-team 3RR + linear, stored-literal pick→team tables for rounds 1–4); E1 race (two sessions… single-session analogue: second insert for the same player → friendly refusal message pinned); E2 replay (same action_id → no-op, same response); wrong-turn refusal; capacity boundary (team_count−1 franchises refused, == succeeds); the D43 order probe (snapshot NULL + forced start → trigger raises); untimed (0) leaves NULL deadline.
> 4. Stack vitest `draft-core-db.test.ts`: start → 3 picks over PostgREST as real users; held-lock < 50ms assertion (§4.6).
>
> DoD: §4 standing rules; break probe: invert the reversal parity → exactly the order-math pins fail (shown, reverted).

### L.B4.1 — Migration 067: `league_lists` + attach routes + hooks (D32 arrives)
> Read spec §7.4, §12.15 (incl. the shared-private `lists` SELECT note), §15.5, this doc §2 (Big Board facts). Depends nothing beyond M1 (parallel-safe; sequenced here so L.B1.3's autopick can read it). **This task does not touch the draft room.**
>
> 1. `067_league_lists.sql`: §12.15 DDL verbatim (the printed owner-scoped FOR ALL is a spec-sanctioned client-write exception — banner cites §12.15 + plan §8.2's allowance) + `uniq_primary_board_per_member` + the **shared-private `lists` SELECT policy** (read when a `league_lists` row links it shared to a league the viewer belongs to).
> 2. **Routes per §15.5 are REQUIRED deliverables** (attach / list mine+shared / patch primary+shared / detach) — thin handlers over the RLS-writable table (§15's preamble: "All mutations are Route Handlers"; D92's rule; the printed route list is the contract). The RLS policies remain the backstop, not the API.
> 3. `use-league-lists.ts` hook (mine + league-shared; set-primary optimistic).
> 4. pgTAP **021**: §4.2 per-role; privacy: a non-shared attachment invisible to other members (positive control: shared visible); one-primary-per-member boundary (second primary → 23505); the shared-private lists policy (member reads a PRIVATE list only when share-linked; non-member never).
>
> DoD: §4 standing rules; break probe on the privacy pin.

### L.B1.3 — Migration 068: autopick + `draft_tick` + pg_cron (the authoritative clock)
> Read spec §8.2, §8.4 (strategy + E30), §14 (draft-tick row), §22.3, this doc D87/D90/D93(timing arm lands L.B1.6)/D94 + §4.6. Depends L.B1.2 + L.B4.1.
>
> 1. Autopick resolution fn: highest available from (1) own `draft_queues` → (2) primary league-tagged board (`league_lists.is_primary_board` → `list_players` order) → (3) owner's `lists.is_big_board` order → (4) lowest `players.adp`; each source skips drafted players; **need-fit filter**: deterministic greedy slot model (documented in the banner; full bipartite is M4's lineup validator) — when remaining picks == remaining unfilled required slots, only players filling one are eligible; a position whose useful cap is reached (all fillable starting slots filled + bench headroom exhausted... Builder finalizes the documented greedy) is skipped while other needs are open (the §8.4 3rd-QB rule, pinned); **E30 K/D-ST deferral**: K/DST ineligible until forced or round > total_rounds − 3 (pinned at the exact boundary round). Seats with no user (placeholder/vacated) resolve straight to (4) — E48's autopilot for free.
> 2. `draft_liveness` table + `draft_touch` RPC (D102 — its own table, never a `drafts` column: heartbeats must not contend with the draft-row lock; no client DML, no broadcast; spec-absent schema recorded as the D102 erratum).
> 3. `draft_tick()` per the §5 sketch + `CREATE EXTENSION IF NOT EXISTS pg_cron` + `cron.schedule('draft-tick','5 seconds', …)` (D87; banner records the vehicle erratum + the hosted-project enablement note). Arms this task: auto-start (D94 — scans scheduled leagues, creates the row if absent) · **timeout per the D102 contract:** at deadline expiry, `is_autodraft` seats, no-user seats (placeholder/vacated — E48's autopilot), and seats with a FRESH `draft_liveness` heartbeat autopick immediately (§8.5.4: timeout → autopick); a STALE seat's pick is HELD OPEN until deadline + `disconnect_grace_seconds` — a returning human may pick manually during the hold ("reconnect restores manual control", §8.5.5/E3) — then autopicks. Batch-limited loop until no due rows (§22.3). *(The commissioner-outage auto-pause arm lands with L.B1.4, where pause bookkeeping exists.)*
> 4. pgTAP **022**: source-priority pins (queue beats board beats big-board beats ADP — four fixtures, each falsifiable alone); E30 boundary (round total_rounds−3 vs −2); 3rd-QB block + positive control; deadline-rewind harness pattern (service-role `current_deadline` rewind → tick call → autopick row asserted — D100); auto-start pin (league scheduled via the settings PATCH alone, NO drafts row → tick creates + starts it — the D94 no-dead-end pin); **both grace branches**: fresh-heartbeat seat autopicks at deadline (+1s); stale seat NOT picked at deadline+grace−1s, picked at +1s; manual pick lands during a stale hold.
> 5. Stack vitest: a 4-team scripted draft where every seat times out → board completes correctly, zero manual picks.
>
> **Pre-authorized fallback split (sizing; L.A1.12/L.A1.14 precedent):** if fix-cycle 3 is reached, land the autopick resolution fn + its pins as this task and open "L.B1.3b — `draft_liveness` + `draft_tick` + pg_cron + the arm set" immediately — a sanctioned exit, not a stop-and-wait.
>
> DoD: §4 standing rules; break probe: disable the deferral clause → E30 pins fail (shown, reverted).

### L.B1.4 — Migration 069: commissioner live controls (§8.7) + system chat posts
> Read spec §8.7 (the full table + v2.0 pause bookkeeping), §8.8 (system posts), E4/E15/E29(snake half: cascade during live clock)/E31, §17, this doc D97/D101 + §4.6. Depends L.B1.2 (chat exists from 065).
>
> 1. RPCs per the §5 sketch — all commish/co-commish in-body (42501), all under the draft-row lock, each writing the **in-txn system chat post** (D97; `is_system=TRUE`, `context='draft:<id>'`, human-readable summary — they are UX). Pause/resume: `deadline_remaining_ms` persisted on pause, `current_deadline = now() + remaining` on resume (clocks never gain/lose — pinned to the millisecond with a frozen-now fixture). Undo: soft `is_undone=TRUE` (audit trail per §12.4), pool return via the partial index, clock rewind to the undone team, cascade = everything after pick N (E4). Reassign/move: exclusivity + slot validation, before/after in the chat post. Order edit post-start: completed picks unchanged, remaining re-derived (E31). **Reset: `drafting`/`paused` only → picks soft-undone, `drafts.status='scheduled'` AND `leagues.status='scheduled'` in the same txn — the league's backward move is sanctioned by §8.7's own row ("status → scheduled"; §7.1's re-open arrow), and the D43 guard is indifferent (the snapshot survives)**; post-completion reset → M6 (**F44**). Clock edit: subsequent picks + optional current-deadline extension (E15).
> 2. **The §8.7 commissioner-outage arm (D102):** the tick auto-pauses a live NON-mock draft when no commissioner/co-commissioner heartbeat is fresh for > `disconnect_grace_seconds` ("nothing runs unsupervised during an outage" — §8.7:478; lands here because pause bookkeeping is this task's); system chat post; resume is a commissioner action. pgTAP: stale commish + fresh co-commish → keeps running; both stale → paused; fresh commish → never pauses.
> 3. `reason` accepted + Zod-validated on every route-facing control, stored nowhere (F32 pattern) — **F40** (filed with this breakdown) carries the M6 audit obligation for every §8.7 control incl. the L.B1.7 autodraft toggle; the chat post is the interim transparency.
> 4. pgTAP **023**: pause/resume ms-exact pin; cascade undo golden fixture (undo to pick 3 of 8 → exactly picks 4–8 undone, pool restored, on_clock rewound); reassign validates exclusivity (target already has the player → friendly refusal); non-commish per-control 42501 sweep; system post row pinned per control (recipient-visible, `is_system` TRUE); reset boundary (complete → refused) + the league-status flip pin; the outage-arm pins (item 2).
>
> **Pre-authorized fallback split (sizing):** if fix-cycle 3 is reached, land the clock family (pause/resume/clock-edit/undo±cascade) + the outage arm as this task and open "L.B1.4b — reassign/move/force/set_order/reset" immediately — a sanctioned exit, not a stop-and-wait.
>
> DoD: §4 standing rules; break probe: resume without restoring remaining → the ms-exact pin fails (shown, reverted).

### L.B1.5 — Migration 070: Broadcast-from-DB + channel auth (F8 discharge; the repo's first realtime)
> Read spec §9 (ALL — the transport rule is the point), §12.14 (+ D89 erratum), delivery plan §8.4, this doc §4.5/§5 channels. Depends L.B1.4.
>
> 1. Broadcast triggers per §9.2: `drafts` (UPDATE, column-selected per §5), `draft_picks` (INSERT/UPDATE), `league_chat` (INSERT; topic from `context` — `draft:` rows to the draft topic, else `league:<league_id>`), `leagues` (UPDATE — status/name/avatar_url only; flips home hero + draft bar). **Never** `draft_queues` (§9.2). All trigger fns SECURITY DEFINER `SET search_path=''` per the printed pattern.
> 2. `realtime.messages` policies per §9.2: `league:%` via `is_league_member(split_part(topic,':',2)::uuid)`; `draft:%` via the `drafts.league_id` lookup. **The §12.14 publication ALTER is NOT executed** — D89; the migration banner carries the erratum text.
> 3. Tick heartbeat (§9.1's 15s clock-drift beat): the tick emits server-now + deadline per live draft — vehicle latitude (a `realtime.send()` per pass ~5s, or every third pass; Builder finalizes, records). **F8 flips ✅** with this migration's pointer + the full D38-banner table inventory stated in the flip note so the discharge is auditable as complete; **F42** (filed with this breakdown): the M1 tables with no M2 subscriber (`league_members`, `team_managers`, **`teams`**, `league_invites`, `league_weeks` — the full D38 waiver set incl. 053's) stay trigger-less on the D38 rationale, re-routed per-table to M4's activity-feed milestone (`league_rosters` is NOT carried — its trigger ships at creation, L.B1.7(3b)).
> 4. pgTAP **024**: trigger existence + function-form pins (search_path exact, SECURITY DEFINER); `realtime.messages` policy pins (pg_policies definition golden-pinned; behavioral topic-read where the harness allows — realtime schema exists on the local stack); a payload-shape unit pin on the column-select function (no `settings`/`scoring_rules_snapshot`/`invite_code` in the leagues payload — the §9.2 "nothing blind" rule made falsifiable).
> 5. Integration (stack vitest): supabase-js client subscribes to `draft:<id>`, a pick INSERT arrives with the selected columns; a non-member client gets nothing (auth policy behavioral check).
>
> DoD: §4 standing rules (rule 5 now literal); break probe: widen the leagues payload to full-row → the payload pin fails (shown, reverted).

### L.B1.6 — Migration 071: Mock Draft Mode (§8.8) — engine-native, zero side effects
> Read spec §8.8 (ALL), §22.5 (caps), E59/E60, this doc D93/D95. Depends L.B1.3 (amends the tick — unreleased-migration amend precedent, F12).
>
> 1. `create_mock_draft` / `delete_mock_draft` per the §5 sketch (liveness rides L.B1.3's `draft_touch` — D102). Launch: any member, league `setup`/`scheduled`, **active franchises == `team_count` (D103(1) — friendly refusal naming placeholder seats)**, snapshots the REAL config (type, clock, rounds via D91, order incl. the launcher's actual slot; any seat selectable), `is_mock=TRUE`, `config.mock = {human_team_id, cpu_speed, launched_by}` (no schema change — §8.8), starts immediately (`status='live'`, pick-1 deadline). Caps in-body: 3 active/user + 5 creations/hour/user (friendly refusals — §16.5.2 states).
> 2. **The D103(2)/(3) authorization amendments:** `draft_make_pick` gains the mock branch (launcher-only, human seat only, every other seat tick-only — amends 066 in place, cross-referenced in both banners); `draft_queues` RLS gains the mock-launcher carve-out for the human seat's queue.
> 3. Tick amendments (D93): CPU seats (every non-human seat in a mock) pick at think-time = PRNG(draft_id, pick_number) → 20–70% of clock (`realistic`) or ~2s (`fast`) — the pick itself IS the autopick strategy fn (one implementation, §8.8/plan §4.2); occasional near-buzzer picks fall out of the 20–70% distribution's tail naturally; the human's clock always real; a stale human heartbeat (> grace + one tick) auto-pauses a live mock (E59). Mock completion: `status='complete'` + recap retention — **no league transition, no `league_rosters`, no notifications** (the zero-side-effect contract, pinned by a full-table diff in pgTAP: snapshot league-scoped row counts before/after a scripted mock → identical outside `drafts`/`draft_picks`/`draft_queues`/`draft_liveness`/`league_chat(draft:mock)` rows).
> 4. 72h expiry: daily `cron.schedule('mock-expiry', …)` deleting incomplete mocks idle > 72h (completed recaps kept until owner-deleted — §8.8).
> 5. pgTAP **025**: cap boundaries (3rd active OK… 4th refused; 6th-in-hour refused); **below-capacity launch refused / at-capacity succeeds (D103(1))**; **both sides of D103(2): the launcher picks on their non-managed chosen seat successfully; another member's pick on any mock seat refused**; zero-side-effect diff pin; E60 independence (a live mock + a real scheduled draft coexist — the `one_active_real_draft_per_league` index ignores mocks, pinned); CPU determinism (same draft_id+pick → same think-fraction, stored-literal); human seat never CPU-picked while its heartbeat is fresh.
>
> DoD: §4 standing rules; break probe: point the CPU arm at a raw ADP pick skipping need-fit → the shared-strategy pin fails (shown, reverted).

### L.B1.7 — Migration 072: completion → `league_rosters` + `in_season` (D88) + the real autodraft toggle (F33)
> Read spec §8.5.6, §12.7, §12.2 (`is_autodraft`), §15.1 members-PATCH + §15.2 autodraft, E48, this doc D88/D96. Depends L.B1.6.
>
> 1. `league_rosters` per §12.7 verbatim (exclusivity UNIQUE, member SELECT, no client writes, both indexes) — **table created here per D88**; `slot_key`/IR columns ship but stay NULL (M4's).
> 2. Completion path (amends 066's `draft_make_pick`/tick completion arm): final live pick → `drafts.complete` + populate `league_rosters` from non-undone picks (`acquisition_type='draft'`) + `leagues.status='in_season'` in ONE txn (the D43 guard holds — snapshot exists since start; pinned). **Mock branch bypasses all of it** (re-pinned here from the completion side).
> 3. `set_team_autodraft(p_league_id, p_team_id, p_on)` — self (open-stint manager) or commish (§8.4 "Commissioner can toggle it for any team"); replaces nothing DB-side (052's column was always real). **The commissioner path is a §8.7 control ("Toggle autopick for any team") and gets the full D97 treatment: in-txn system chat post when a live draft exists + F40 audit routing**; the self path posts nothing. **F33 discharges in L.B2.2** (the service/route half); this task lands the RPC + pins (incl. the commish-path system post).
> 3b. **`league_rosters` broadcast trigger ships here** (§9.2's transport table lists it; its only M2 writer is this completion txn — one column-selected trigger, same 070 pattern, so F42 never needs to carry it).
> 4. E48 verified end-to-end: `remove_manager(vacate)` mid-draft (063 permits it) → seat has no user → next turn autopicks at deadline (no grace — L.B1.3's rule); a seat-invite claim mid-draft restores manual control (062's seat-targeted claim is status-unrestricted — the §7.2.1 replacement-GM path, re-pinned in the draft context).
> 5. pgTAP **026**: completion golden fixture (8-team × N rounds scripted → rosters count, per-team counts, exclusivity, status flip); undone picks excluded from rosters; autodraft toggle per-role sweep; E48 fixture.
>
> DoD: §4 standing rules; break probe: include undone picks in the roster population → the exclusion pin fails (shown, reverted).

### L.B2.1 — Draft schedule/start/lobby API + home data (takes R83)
> Read spec §15.2 (create/PATCH/start), §15.6, this doc D92/D94/D95/D98, CLAUDE.md (route + hook patterns). Depends L.B1.2.
>
> 1. Routes: `POST /api/leagues/[id]/draft` (create — commish, Zod, idempotent vs the partial unique), `PATCH /api/leagues/[id]/draft` (order edit incl. randomize — pre-start; **no schedule field**: every `draft_scheduled_at` change flows through the settings PATCH per D95, and post-start order edits route through L.B2.3's dispatch), `POST /api/leagues/[id]/draft/start`.
> 2. `useActiveDraft` + the `getLeagueDetail` active-draft summary (id, status, scheduled instant, is_mock-filtered) — **this opens `leagues-service.ts`: take R83** (deepMergePatch `__proto__`/reserved-key guard + the one-line pin, per the routed conditional at PROGRESS batch-13/R83). `use-draft` fetch half (D92).
> 3. Stack vitest: create → PATCH order → start over the wire; non-commish 403s; the double-create idempotency.
>
> DoD: plan §2.3 + §4; R83's pin shown failing pre-fix (the recorded probe) then green.

### L.B2.2 — Pick/queue/autodraft API (discharges F33)
> Read spec §15.2 (pick/queue/autodraft), §15.5 (queue/from-list), §15.6 (optimistic queue ONLY — never picks), this doc D92/D93. Depends L.B1.3 + L.B1.7 (+ L.B4.1 for from-list).
>
> 1. `POST …/draft/pick` (action_id minted per submit — the D68(1) stamping pattern), `POST …/draft/queue` (upsert own queue; reorder), `POST …/draft/queue/from-list/[listId]` (load attached list in order, skip drafted, append/replace per §8.9), `POST …/draft/autodraft` (self toggle → L.B1.7 RPC).
> 2. **F33 discharge:** `members-service.ts` `patchMember` — the `AUTODRAFT_DEFERRED_MESSAGE` branch (members-service.ts:127–132) becomes the real commish toggle via the same RPC; the named-message pin flips to a real-toggle pin; **flip F33 ✅** with pointers.
> 3. `use-draft-queue` (optimistic reorder). Stack vitest: pick race (two clients, one player — loser's message pinned), queue round-trip, from-list skip-drafted, both toggle paths.
>
> DoD: plan §2.3 + §4; break probe on the from-list skip-drafted pin.

### L.B2.3 — Commissioner control routes + mock routes
> Read spec §15.2 (commish block + mock-drafts), §17, this doc D97. Depends L.B1.4 + L.B1.6.
>
> 1. Commish: `POST …/draft/pause` (+resume verb in body), `/draft/undo` (`to_pick_number?`), `/draft/reassign`, `/draft/force-pick`, `/draft/move-player`, `/draft/reset`, clock edit (fold into PATCH draft or a dedicated verb — Builder finalizes vs §15.2's list, records), **and the post-start order edit: `PATCH /api/leagues/[id]/draft` with an order body on a live draft dispatches to `draft_set_order` (E31 — §15.2's PATCH prints no pre-start restriction; reason required per D97), with the wire test (post-start order PATCH → remaining picks re-derive) here**.
> 2. Mock: `POST /api/leagues/[id]/mock-drafts` (launch), `GET` (my active + recaps), `DELETE …/[did]`.
> 3. Stack vitest: per-route auth sweep (manager 403 on every commish verb — §17 matrix row), pause→resume clock integrity over the wire, mock launch→delete lifecycle, cap refusals surfaced as friendly 4xx.
>
> DoD: plan §2.3 + §4.

### L.B3.1 — Draft room shell: realtime client + clock + presence (re-skin in place)
> Read spec §9.3 (client rules — every line is a requirement), §16.2 (draft-room/pick-clock/presence-bar), §16.3, §16.5.4 (reconnecting banner), this doc §4.5/§5, CLAUDE.md redesign rules. Depends L.B2.1 + L.B1.5.
>
> 1. `use-draft` subscribe half: refetch → render → subscribe; `state_version` gap ⇒ refetch; reconnect ⇒ refetch-first + resubscribe + the §16.5.4 reconnecting banner; ≤ 3 channels; unsubscribe on route change. Repo's first realtime client — the doctrine pins live here as unit tests on the pure gap/refetch reducer (ops-layer split per the L.A2.x precedent).
> 2. `snake-draft-room.tsx` re-skinned IN PLACE to real data (drafts row + picks): room shell, on-clock header, `pick-clock` (server deadline + subscribe-time offset, heartbeat-corrected; paused state with remaining), `presence-bar` (Presence join keyed by team), MOCK banner when `is_mock` (§16.2). `[leagueId]/draft/page.tsx` drops `?format=`/fixtures (C25) — real draft or an honest "no draft yet" state routing to the lobby.
> 3. Countdown ops pure + `nowMs`-injected (D82(4) precedent); no client clock authority anywhere (§9.3 — a grep-able rule: no `Date.now()` inside deadline math, component tick only drives re-render).
>
> DoD: plan §2.3 + §4 (UI scoping of §4.3 per tasks-M1: ops-layer pins + D39 browser pass w/ screenshots); break probe on the gap⇒refetch reducer pin.

### L.B3.2 — Board grid + available players + queue + roster tracker (the room's working surfaces)
> Read spec §8.5.2, §16.2 (board-grid/available-players/my-queue/my-roster-tracker), §16.4 (mobile density — ticker + "my picks" rail, full grid one tap), E17, this doc D90, C26. Depends L.B3.1 + **L.B2.2** (the pick submission + queue route/hook this task wires — D92: every mutation is a route).
>
> 1. Board grid from real picks; empty future cells via the kept TS order helpers, **parity-pinned against SQL** (the D90 fixture test). `mock-draft.ts` `MOCK_*` constants DELETED (its own header's instruction); types + helpers kept.
> 2. `available-players`: real pool minus drafted **by player_id** (C26 fix), search/position filters, ADP + Big Board rank columns; updates live off the picks channel (E17). `best-available-card` rewired to draft_picks-subtraction.
> 3. `my-queue` wired (drag reorder optimistic, drafted auto-removed/greyed — E17); `my-roster-tracker` (slots filling vs `roster_settings`, needs surface — read-model of the same greedy the server documents, display-only).
> 4. Mobile per §16.4: ticker + my-rail collapse, grid one tap away.
>
> DoD: plan §2.3 + §4 UI scoping; D39 pass incl. a live two-browser pick observed via broadcast (screenshots).

### L.B3.3 — Draft chat + commissioner panel UI
> Read spec §8.7 (panel), §8.8 (chat + system posts), §16.2 (draft-chat/commish-draft-panel), §16.3 (distinct accent; system posts visible to the room), this doc D97/D99. Depends L.B3.1 + L.B2.3.
>
> 1. `draft-chat`: direct client INSERT (the sanctioned write), live via the chat broadcast; system posts styled distinctly, non-hideable.
> 2. `commish-draft-panel` overlay: pause/resume (pause overlay w/ remaining time — §16.5.2), clock edit, undo single + cascade (confirm dialog listing exactly what reverts — §8.7), reassign/move (exclusivity errors surfaced friendly), force pick, order edit, **toggle autopick for any team (the §8.7 control — L.B1.7's RPC, commish path; the autopick-on seat badge renders in the room per §16.5.4)**, reset (hard confirm), **and the §8.7 "Reassign a draft seat" control — satisfied by composing M1's membership surface (`assign_manager` / `remove_manager(takeover)` via the existing invite-panel affordances), exposed from the panel as the seat-controls entry; E48 covers the mid-draft claim path; no new RPC**. Distinct accent; every action's system post visibly lands in chat (the live transparency loop, §16.3).
>
> DoD: plan §2.3 + §4 UI scoping; D39 pass (pause overlay, cascade confirm, system post in chat — screenshots).

### L.B3.4 — Lobby + home/nav CTAs + draft-setup completion (discharges F38)
> Read spec §8.5.1, §16.2 (draft-setup-panel), §16.5.1 (scheduled + drafting rows), §16.5.2 (draft-night workflow), this doc D94/D98/D101, F38's full text. Depends L.B2.1 + L.B3.1.
>
> 1. Lobby (pre-start room state): presence, checklist (seats/settings/order), order display (post-randomize list — no animation, D101/F43), Start button (commish), auto-start countdown (D94).
> 2. **F38 discharge:** scheduled-hero CTAs real (`Enter draft lobby` → lobby/room, `Practice this draft` → launcher entry — launcher itself is L.B3.5; this task wires the CTA to it behind a ready-flag so lane order can't dead-end); the `drafting` home hero (LIVE badge + Join draft, §16.5.1 — replaces the `later` placeholder for `drafting` only; `in_season`+ stays M4); `draft-bar` wired to `useActiveDraft` (the F38/D84 TODO at draft-bar.tsx:15–22); setup-checklist "Schedule draft" affordance intact (the picker exists — D86).
> 3. Draft-setup completion (compose over `ScheduleDraftGroup`, no fork): order-method UI (randomize action + manual drag of team order + custom), **D98 IANA `draft.time_zone`** (additive catalog field + erratum; scheduler's zone one-tap default; league-time renders named-zone everywhere the offset renders today).
> 4. **Flip F38 ✅** — legal because the M4-heroes remainder already has its OWN row: **F46** (filed with this breakdown — real `in_season`/`playoffs`/`complete` home heroes → M4); flip F38 with pointers to this task and F46 (a hand-off may never live only in a Status cell — R51).
>
> DoD: plan §2.3 + §4 UI scoping; D39 pass (CTA → lobby → live room journey; draft bar appears; zone label — screenshots).

### L.B3.5 — Mock launcher + recap + resumable card
> Read spec §8.8 (launch/lifecycle/recap), §16.2 (mock-draft-launcher/mock-recap), §16.5.2 (mock workflow row: resumable card, 72h note, cap message), E59. Depends L.B2.3 + L.B3.2.
>
> 1. `mock-draft-launcher` (new §16.2 component): seat picker (defaults to the launcher's real seat), CPU speed toggle, active-mocks resume list + recaps, cap messaging (3-active, 5/hour).
> 2. Same room + persistent MOCK banner; `draft_touch` heartbeat from the room (D102 — same call real rooms make); pause/leave → resumable-paused card on league home (§16.5.2); `mock-recap` (full board + your roster vs CPUs + delete) at `/draft/recap` per §16.1.
> 2b. **The REAL-draft recap variant ships here too** (§16.1: `/draft/recap` serves "real & mock"; §16.5.2's draft-night row ends at it): a completed real draft's room routes to the recap (final board + all rosters, NO delete affordance); the completion moment in the room surfaces it.
> 3. D39 pass: launch → CPUs pick with visible humanized timing → finish → recap → delete (screenshots; the E2E automation of the same journey is L.B5.1).
>
> DoD: plan §2.3 + §4 UI scoping.

### L.B4.2 — Attach UI + My Lists panel + queue-from-list + autopick tie-in (closes §7.4/§8.9)
> Read spec §7.4 (all bullets), §8.9 (all bullets), §16.2 (attach-list-modal/my-lists-panel), E17, this doc L.B4.1's shape. Depends L.B4.1 + L.B3.2 + L.B2.2.
>
> 1. `attach-list-modal` + entry points (list detail/card/Big Board "Attach to league"; league side "Add a draft list"); primary-board + share toggles; smart-suggestion surface (format-match one-tap — heuristic latitude, recorded); create-flow offer per §7.4 (the modal — compose into `LeagueCreateModal`'s success step, not a new surface).
> 2. `my-lists-panel` in the room (tab beside My Queue): attached + league-shared + Big Board; cheat-sheet side panel; pool overlay (rank/tier column + "only players on this list" filter); load-into-queue (replace/append via L.B2.2's route); best-available-from-board helper; all live off the picks channel (E17). Mobile bottom sheet.
> 3. Autopick tie-in verified live: set primary board → timeout → the pick honors it (stack vitest against the real tick — the L.B1.3 SQL already reads `league_lists`; this is the end-to-end consumer proof).
>
> DoD: plan §2.3 + §4 UI scoping; D39 pass (attach → overlay → load-into-queue → primary-board autopick observed).

### L.B6.1 — The League Simulator (snake) — plan §4.2 lands
> Read delivery plan §4.2 (every bullet), §4.3, spec §22.1/§22.3, this doc D90/D93/D100 + §5's sim sketch. Depends **L.B2.1** (the draft create/schedule/start service path the runner drives) + L.B2.2 + L.B1.7.
>
> 1. `src/lib/leagues/sim/`: bot personas (queue-drafter · adp-drafter · afk · chaos double-tap) as seeded pure policies over per-bot authed service-layer clients (D100 — real RPC path, never direct DB writes); a runner that provisions N leagues (create → seat via real invite/claim paths → schedule → start) and drafts them concurrently; deadline-rewind harness for timeout scenarios (service-role, harness-only).
> 2. Scenarios as code: `npm run sim -- draft --leagues N --teams X --clock S --seed K`; every run prints its seed; `--seed` replays exactly (determinism = plan principle 4; the ESLint time/random guard applies — seeded PRNG only).
> 3. Invariant sweep after every run (§5 sketch list) — each invariant falsifiable (deliberately broken once in the task log: e.g. suppress one bot's final pick → the board-complete invariant names the draft).
> 4. **The 25-league gate run green** (mixed sizes incl. ≥1 **16-team** league — E14's drift/no-dropped-picks substance at v1's max size (C31) — mixed personas incl. ≥1 all-afk league — the all-timeout path — and chaos double-taps throughout): zero duplicate picks, zero stuck clocks, all `in_season`, rosters consistent. **The stuck-clock invariant is grace-aware (D102): a human seat is stuck only past deadline + grace + tick + ε; autodraft/no-user seats past deadline + tick + ε.** Wall-clock kept sane via short clocks + rewinds.
>
> DoD: plan §2.3 + §4 standing rules (full §4.3 applies — this is an engine-lane task); the gate run's output in the session log.

### L.B5.1 — Playwright bootstrap + draft E2E (discharges D39/C14)
> Read delivery plan §4.1 (E2E row), spec §19.3, §8.7 (reconnect < 2s), §8.8 (mock E2E), this doc §2 (seed.sql users). Depends L.B3.3 + L.B3.4 + L.B3.5 **+ L.B1.7** (completion path — test (a) runs to completion; L.B2.2 arrives transitively via L.B3.2).
>
> 1. Bootstrap: `@playwright/test` + config (local stack + `next dev` webServer; the deterministic seed.sql users as auth fixtures; storage-state login helper); `npm run test:e2e` (closes C14/C22 — CLAUDE.md's command becomes true).
> 2. Tests: **(a)** full short-clock snake draft to COMPLETION, two browser contexts (commish + manager) — picks broadcast cross-client, board converges, **cross-client clock skew < 1s sampled mid-draft (E14's drift substance)**, completion routes to the REAL recap, league lands `in_season`; **(b)** disconnect/reconnect: kill the socket (context offline) mid-draft, reconnect → full room state restored **< 2s** (asserted timing, refetch-then-resubscribe observed); **(c)** the solo mock E2E — launch → CPU picks land at humanized timing → finish → recap renders → **zero league writes** (DB diff via a helper, the L.B1.6 pin's E2E twin); **(d)** the deferred Phase A journey E2E (D39's debt: create modal → configure → invite → claim → scheduled).
> 3. CI wiring (merge + nightly per plan §4.1): no CI config exists in-repo — **F47** routes the hand-off to Chris's CI setup with the exact commands recorded; noted, not invented.
>
> **Pre-authorized fallback split (sizing):** if fix-cycle 3 is reached, land the bootstrap + journey (d) as this task and open "L.B5.1b — draft specs (a)–(c)" immediately — a sanctioned exit, not a stop-and-wait.
>
> DoD: plan §2.3; all four specs green locally against a fresh stack (shown); flake policy per plan §5.2 (a flaky draft test = a real concurrency bug until proven otherwise).

### L.B7.1 — M2 gate harness (exit-criteria proof; updates PROGRESS)
> Read this doc §1 + §8, delivery plan §3 M2 row, tasks-M1 L.A1.16/D83 (the composition precedent). Depends everything above.
>
> 1. `npm run test:gate:m2` = `scripts/gate-m2.sh` under `set -euo pipefail`: fresh `db reset` (001–072) → `test:db` (pgTAP full, 019–026 = M2) → the M2 vitest gate config (draft-core/tick/mock DB suites + the D90 parity fixture) → **the L.B6.1 25-league sim run** → `test:e2e` (the L.B5.1 suite) → `test:gate:m1` → `test:gate` (continuity — M1 and M0 stay green).
> 2. D39-class browser pass over the full journey (schedule → lobby → live draft with a second browser → commish pause/undo → completion → **real recap** → in_season home → mock launch → mock recap) — screenshots in the session log.
> 3. Update PROGRESS: §1 M2 status, §2 checkboxes, ledger audit (every row naming an M2 task verified flipped or carried — F8/F18-chat/F33/F38/R83 + the new F40–F48), session-log entry with gate output.
>
> DoD: all §1 exit criteria shown green in one session log.

---

## 7. Migration plan (schema lane, serialized)

| # | File | Contents | Task |
|---|---|---|---|
| 065 | `065_draft_tables.sql` | `drafts` + `draft_picks` + `draft_queues` (§12.3/12.4/12.6 + CHECKs + `idx_drafts_due` + one-active-real-draft partial unique); `league_chat` `context`/`is_system` + C11 policy replacement (D99, F18 chat half) | L.B1.1 |
| 066 | `066_draft_core_rpcs.sql` | `draft_create` / `draft_start` / `draft_make_pick` (D90/D91/D94/D95/D96) | L.B1.2 |
| 067 | `067_league_lists.sql` | §12.15 verbatim + shared-private `lists` SELECT policy (D32 arrives) | L.B4.1 |
| 068 | `068_draft_tick_autopick.sql` | autopick resolution + `draft_liveness` + `draft_touch` (D102) + `draft_tick` + `CREATE EXTENSION pg_cron` + the 5s schedule (D87/D94; E30) | L.B1.3 |
| 069 | `069_draft_commish_controls.sql` | §8.7 control RPCs + in-txn system chat posts (D97; E4/E15/E31) + the commissioner-outage auto-pause tick arm (D102/§8.7:478) | L.B1.4 |
| 070 | `070_draft_realtime.sql` | Broadcast triggers (drafts/draft_picks/league_chat/leagues) + `realtime.messages` policies + heartbeat (D89; **F8 ✅**, F42 filed) | L.B1.5 |
| 071 | `071_mock_draft_mode.sql` | `create_mock_draft`/`delete_mock_draft` + the D103 amendments (mock pick-auth branch in `draft_make_pick`, queue-RLS carve-out) + tick CPU/stale-pause arms + 72h expiry cron (D93/D103; E59/E60) | L.B1.6 |
| 072 | `072_draft_completion_rosters.sql` | `league_rosters` (§12.7, D88) **+ its broadcast trigger** + completion txn + `set_team_autodraft` (F33's RPC half, D97 commish path; E48) | L.B1.7 |

Every migration: banner citing spec §; §4 standing rules (grants doctrine + REVOKE discipline; R6 rehearsal waiver; **rule 5 replaces the D38 waiver line** — a table with a subscriber gets its trigger in the same migration or names its trigger migration); pgTAP in the same PR (files **019–026** — confirm next-free at task time, the M1 drift rule); typegen + alias-block re-append. Numbers 065–072 are reservations under the standing confirm-at-task-time policy — review-fix migrations may interleave exactly as 048–051/054 did in M1. **Not in M2:** `draft_bids` + auction RPCs (M3) · `matchups`/`transactions`/`waiver_claims`/`trades`/`lineup_swaps`/`league_player_pool`/`team_week_results`/`stat_correction_events`/`league_weeks` population (M4+) · `commissioner_actions` (M6, F40) · rate-limit hardening (M7, F41).

---

## 8. Exit-criteria → proof map

| Exit criterion (§1) | Proven by |
|---|---|
| Phase B gate — full snake draft, live clients; commish pause/undo(±cascade)/reassign/move; seamless reconnect; `league_rosters` populated; status → `in_season`; solo mock, realistic timing, zero side effects | L.B5.1 E2E (a)–(c) + L.B6.1 invariant sweep + pgTAP 023 (controls) / 026 (completion) / 025 (zero-side-effect diff), composed in L.B7.1 |
| 25 concurrent bot drafts — zero duplicates, zero stuck clocks | L.B6.1's gate run (re-run inside `test:gate:m2`); duplicates additionally impossible-by-schema (065's `uniq_draft_player_live`, pgTAP-proven) |
| Reconnect < 2s in E2E | L.B5.1 test (b), asserted timing on the refetch-then-resubscribe path |
| Solo mock E2E — launch → CPU realistic timing → finish → recap → zero league writes | L.B5.1 test (c) with the DB-diff assertion (the pgTAP 025 pin's E2E twin) |
| Playwright bootstrap (plan §4.1 / D39) | L.B5.1 — incl. the deferred Phase A journey E2E (d); `npm run test:e2e` exists and passes |

---

## 9. Conflict report (codebase / migrations 001–064 / docs vs the M2 spec sections)

*Numbering continues from tasks-M1 §9 (C1–C18). Verified during the 2026-08-03 survey; each item names its resolution.*

| # | Conflict | Evidence | Resolution |
|---|---|---|---|
| **C19** | §12.14 says add draft/league tables to `supabase_realtime` "so Postgres Changes broadcast" — §9's v2.0 transport rule bans exactly that; `broadcast_changes()` needs no publication | spec §12.14 vs §9/§9.2; plan §8.4 | **D89**: publication ALTER not executed; erratum rewrites §12.14 as the trigger inventory. Flagged for Chris in the PR body |
| **C20** | §18 Phase B gate requires `league_rosters` populated, but §18 Phase D's migration list owns `league_rosters` creation | spec §18 Phase B vs Phase D | **D88**: table + completion writer ship in M2 (072); M4 extends. Erratum annotates Phase D's list |
| **C21** | §8.2/§14 name "Edge Function invoked by pg_cron"; repo has no Edge Functions and its cron floor is 60s (Vercel) — a 5s tick is unbuildable on the existing pattern | vercel.json crons; no `supabase/functions/`; zero pg_cron refs | **D87**: pg_cron → in-database `draft_tick()` RPC; erratum on the vehicle; escape hatch recorded |
| **C22** | CLAUDE.md Commands lists `npm run test:e2e`; the script and Playwright don't exist (C14's M0/M1 disposition) | package.json:5–34; no playwright dep/config | **L.B5.1** finally lands it — C14 closes; CLAUDE.md's line becomes true |
| **C23** | §12.3's `total_rounds` "derived from roster_size", but the implemented §7.3.8 `roster_size` includes IR spots — drafting into IR is unsatisfiable under §7.3.2 eligibility | league-settings.ts:180–183; spec §7.3.2 IR rules | **D91**: rounds = starters + bench; erratum clarifies §12.3's comment |
| **C24** | PROGRESS §2/§4/§6 don't record PR #71/#73: L.A2.1 cites the deleted `league-create-wizard.tsx`, L.A2.4 the deleted `league-manage-view.tsx`; **F38 claims "no date/time picker exists"** though `ScheduleDraftGroup` shipped; no D-entries for six UI commits | PROGRESS:56/59/428 vs settings-panel.tsx:1168–1286; git log | **D86**: this doc's §2 is the corrected record; the breakdown PR annotates the stale cells + F38 row (bracketed, R45 pattern) |
| **C25** | The draft-room route renders pure fixtures selected by `?format=`; `mock-draft.ts` fixtures are internally inconsistent (the old C16) | [leagueId]/draft/page.tsx:19–31; C16 | L.B3.1/L.B3.2 replace fixtures with real data; `MOCK_*` deleted per the file's own header; **C16 mooted by replacement**. The auction room + its fixture + its lint warning stay untouched (M3's) |
| **C26** | `best-available-card` subtracts mock picks from the REAL pool **by full_name** — collides on shared names and can't survive real picks | best-available-card.tsx:26–45 | L.B3.2 rewires subtraction to `draft_picks.player_id` |
| **C27** | §16.4 requires a league reference timezone; no catalog field exists anywhere (§7.3.8 stores an offset-ISO instant only) | league-settings.ts:189–204; F38's zone clause | **D98**: additive `draft.time_zone` (IANA, nullable); erratum |
| **C28** | §7.2 capacity allows an audited "draft short" override; `commissioner_actions` is M6 | spec §7.2:173 vs §18 Phase E | **D96**: M2 requires full capacity (placeholders reachable + they autopick); override → M6 (**F45**) |
| **C29** | §8.7 requires every draft control to write `commissioner_actions`; the table is M6's | spec §8.7 vs §18 Phase E | **D97**: mandatory in-txn system chat posts now; audit rows → M6 (**F40**) |
| **C30** | §9.3/§22.5 tension: chat is a direct client INSERT but carries a route-layer rate limit | spec §9.3 vs §22.5 | **D99**: direct INSERT stands (spec-explicit); rate limits → M7 (**F41**, the tasks-M1 §11 routing precedent) |
| **C31** | E14 is written at 20 teams; v1's `team_count` CHECK is {8..16} (§7.3.8; §16.5.5 defers 18/20 to v1.1) — the case as printed is unreachable | spec §19.2 E14 vs §7.3.8; 040's CHECK | Substance (no dropped picks, drift < 1s) proven at 16 teams (L.B6.1 matrix + L.B5.1(a) drift assertion); the 20-team size rides M7's performance pass (**F43**) with OQ 12's v1.1 re-widening |

---

## 10. M1-thread + ledger dispositions (every row naming M2, swept from PROGRESS §6 and tasks-M1 §11)

| Thread / row | Disposition in M2 |
|---|---|
| **F8** — Broadcast triggers for M1 tables (D38 waiver) | **L.B1.5 discharges** for every table with an M2 subscriber (`leagues`, `league_chat` + the new draft tables); the no-subscriber M1 tables re-waived per-table → **new row F42** (M4 activity feed). F8 flips ✅ at 070 |
| **F18** — teams-keyed RLS on `league_chat` (C11) + `team_lineups` (C12) | Chat half **discharged by L.B1.1** (065 policy replacement; row updated with the pointer, lineups half stays M4) |
| **F33** — `is_autodraft` PATCH refusal (`AUTODRAFT_DEFERRED_MESSAGE`) | RPC half L.B1.7 (072), service/route half **L.B2.2 discharges** — the named-message pin becomes the real-toggle pin. Flips ✅ |
| **F38** — home CTAs + draft-setup-panel + later heroes | **L.B3.4 discharges the M2 scope** (CTAs, lobby, drafting hero, draft-bar, order UI, D98 zone; the picker half pre-landed out-of-loop — D86/C24). The M4-heroes remainder is filed as its OWN row (**F46**) before the flip — never Status-cell-only (R51) |
| **R83** — `deepMergePatch` `__proto__` no-op (leagues-service.ts:256–264, drifted from the recorded :244) | **L.B2.1 takes it** (first M2 task that opens `leagues-service.ts`), per the routed conditional |
| **D32** — `league_lists` sequenced to M2 | **L.B4.1/L.B4.2** land it (§7.4/§8.9/§12.15 complete) |
| **C16** — draft mock-fixture inconsistency | Mooted by replacement (C25) — `MOCK_*` deleted, types/helpers kept + D90 parity-pinned |
| **D39/C14** — Playwright + deferred Phase A E2E | **L.B5.1 discharges** (bootstrap + journey E2E (d)) |
| **D43/D64(2)** — snapshot guard inherited by `draft_start` | L.B1.2 calls `snapshot_league_scoring` inside its sanctioned window BEFORE the transition; the trigger + a pgTAP order-probe prove it (no loosening of 059) |
| **F32 pattern** (reason accepted, nothing stores it) | Extended to every §8.7 control (D97) — **new row F40** routes the audit-row obligation to M6 |
| **New rows filed by this breakdown** | **F40** §8.7 audit rows (incl. the autodraft commish toggle) → M6 · **F41** chat/draft rate limits (§22.5) → M7 · **F42** no-subscriber M1-table triggers (`league_members`/`team_managers`/`teams`/`league_invites`/`league_weeks`) → M4 · **F43** order-reveal animation + 20-team performance pass (§8.3/§18-F/C31) → M7 · **F44** post-completion draft reset (`in_season → drafting` backward move) → M6 audited override · **F45** §7.2 audited draft-short override (D96) → M6 · **F46** real `in_season`/`playoffs`/`complete` home heroes (F38 remainder) → M4 · **F47** Playwright CI wiring (merge + nightly, plan §4.1) → Chris's CI setup · **F48** §12.6 commissioner all-queues SELECT policy → M6 console debugging surface |
| **Not M2's** (verified no false pulls) | F4 (`league_weeks` transitions — M2 never touches league_weeks) · F22/F23 (M4 scoring worker) · F1/F31 (M4 retire) · F35/F36/F7/F17 (M7/product) · F10/F24 (September ops) · F15 (vendor) · F16/F21 (funded/v1.1) |

---

## 11. Known gaps & notes for later milestones (not M2 work)

- **M3 inherits:** `draft_bids` + `draft_nominate`/`draft_place_bid` + the auction `draft_tick` arm (anti-snipe, endgame E25–E27, solvency E28/E62); the auction-draft-room re-skin (+ its standing lint warning at auction-draft-room.tsx:105); CPU auction bidders (value-based, same solvency validator); E29's auction half (cascade during live bids); `nomination_order` machinery.
- **M4 inherits:** `league_rosters` in-season writers + `slot_key` management (D88); the **F42** trigger set (league_members/team_managers/teams/league_invites/league_weeks) with the `league:<id>` activity feed; `team_lineups` RLS replacement (F18's other half); **F46** — the real `in_season`/`playoffs`/`complete` home heroes; `league_weeks` population + `league-week-advance`; E16's bipartite slot-fit (the lineup validator — M2's autopick greedy is not it); the Ghost simulator scenario (plan §4.2 — needs rosters/FAAB).
- **M6 inherits:** **F40** (a `commissioner_actions` row per §8.7 control incl. the commissioner autodraft toggle — the system chat posts are the interim); **F44** (post-completion reset as an audited backward transition); **F45** (the short-draft override, D96); **F48** (the §12.6 commissioner all-queues SELECT for the console's autopick-debugging surface); the M1 F32 list unchanged.
- **M7 inherits:** **F41** (§22.5 rate limits — chat 5/10s, mutations 10/10s, mock-creation limits beyond the in-body caps); **F43** (order-reveal animation + the 20-team performance pass, §18 Phase F/C31); the §22.6 k6 gate suite (the M2 sim is machine-speed correctness, not load — 50-draft k6 at target latency is M7's).
- **September ops (unchanged):** F10/F24 recording windows; the M0 gate re-run.
- **Chris:** C19's erratum direction (D89 — flagged in the PR body); **F47** (Playwright CI wiring once CI exists); the C24 PROGRESS annotations ride this PR; C2/C13 from tasks-M1 §9 remain his.
