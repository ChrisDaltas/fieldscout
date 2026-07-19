# M0 Task Breakdown — Foundations for Testability

> **Architect session output — 2026-07-18** (adversarially reviewed same session; findings applied). Read together with `spec-redraft-leagues.md` **v2.7** (the LAW) and `delivery-plan-redraft-leagues.md` **v1.3**. This doc sequences M0 into Builder-sized tasks; it never overrides the spec. Builder sessions take **one task each**, in dependency order (§5), and satisfy delivery plan §2.3 DoD per task.
>
> **Q1 and Q2 were resolved by Chris on 2026-07-18** (PROGRESS §3 Resolved): Q1 → nflverse supplements kickoffs/inactives (adapter deferred past M0; D16). Q2 → the named advanced stats were **illustrative examples**, punted until a paid/owned stats source is funded; M0 seeds `core_box` keys only and proves tracking/charted machinery with placeholder keys (D15). **No task is gated.**

**Spec sections in scope:** §23.1 (provider strategy), §23.2 (ingestion invariants), §23.3 (calendar realities), §23.5 (capability tiers + `STAT_KEYS`), §23.6 (`SyntheticStatsProvider`), §12.20 (`nfl_weeks`)
**Delivery plan:** §3 M0 row (contents + exit criteria), §4.2–4.3 (simulator + test data), §8.1–8.2 (migration/RLS checklists)

---

## 1. M0 contents & exit criteria (restated from delivery plan §3)

**Contents:** `TimeProvider` abstraction · `StatsProvider` interface (§23.1) · `SyntheticStatsProvider` + versioned scenario library (§23.6, task lineage "L.A0b") · fixture recorder for live 2026-season provider responses + injury/inactive feeds · `nfl_weeks` seed (§12.20).

**Exit criteria:**
1. A recorded NFL week replays through the ingestion path at 1×/4×/64× speed **deterministically**.
2. Every synthetic scenario (happy path, flex, postponement, mass-inactives, outage, in-window correction, post-window correction, charted-late, charted-revision) runs to a passing assertion with **zero external calls**.

Proof mapping in §7. The 1×/4×/64× reading and the pre-September fixture strategy are logged decisions (PROGRESS §4).

---

## 2. Current state (surveyed 2026-07-18; caller claims grep-verified in review)

- **No provider abstraction exists.** Every sync module calls `fetch()` with hardcoded Sleeper/ESPN URLs. No `TimeProvider`/`StatsProvider` symbol anywhere.
- **The ingestion path is `src/lib/sync/live-stats.ts`** — `syncLiveStats(supabase, season, currentWeek, now = new Date())`. It isolates its two external reads (private `fetchWeekStats` + module-private `STAT_MAP`; `fetchSchedule` from `src/lib/sync/schedule.ts`) and already takes `now` as a parameter. This is the extraction seam.
- **`syncLiveStats` has exactly one caller:** `src/app/api/cron/sync-live/route.ts:28`. No `scripts/` CLI wraps it; `scripts/_sync-cli.ts` is shared plumbing that invokes no sync itself; the other cron route (`sync-stats`) calls seven unrelated syncs and is **untouched by M0**.
- **`fetchSchedule` is shared** by bye-weeks and SOS syncs — adapters **wrap** it; it does not move.
- **Ingestion rows today:** `source: 'sleeper'` (live-stats.ts:112 — the `'live'` value in 002's comment is stale; in-use values are `'historical' | 'mock' | 'sleeper'`, and downstream code branches on them) and `updated_at: new Date().toISOString()` (live-stats.ts:114 — a wall-clock stamp **inside the ingestion payload**; see D12, it must come from injected time or determinism is impossible).
- **`nfl_games` exists (001) but nothing writes to it.** Column is `kickoff_at` (spec erratum v2.6.1). Live sync approximates game windows from Sleeper's day-granularity `date` strings + a 36h constant. The free Sleeper schedule feed has **no kickoff timestamps** and there is **no official-inactives feed** → PROGRESS Q1 (**resolved:** nflverse supplement, D16).
- **`player_stats` exists** with flat typed columns, `UNIQUE(player_id, season, week)`, `is_live`. **No `advanced` JSONB column** (§23.5) — deliberately *not* added in M0 (D8).
- **`nfl_weeks` does not exist.** M0 creates it (§12.20 verbatim).
- **Migrations:** `NNN_snake_case.sql`, 3-digit sequential (next = **037**), banner comment citing spec §, RLS + indexes in the same file, `IF NOT EXISTS` guards, service-role-managed tables get SELECT-only policies + a comment. No `supabase/config.toml`, **no local stack, no pgTAP anywhere** — bootstrapped in L.A0.5a.
- **Types:** `src/types/database.ts` is generated **plus a hand-written alias block at the end (~lines 2294–2348) that regeneration clobbers** — every typegen must re-append it (verify block location at task time).
- **Tests:** Vitest 4, colocated `*.test.ts` under `src/lib/**`, pure-function style, inline fixtures, no mocking infra. `npm run test` = `vitest run`. No Playwright (CLAUDE.md's `npm run test:e2e` doesn't exist yet — lands with the first E2E milestone, M2 per plan §4.1).
- **Lint:** `.eslintrc.json` is extends-only (`next/core-web-vitals`, `next/typescript`, `prettier`) — no custom rules yet.
- **Player identity:** `players.id` TEXT = Sleeper id (§23.1 confirmed in schema).

---

## 3. Design decisions (Architect; logged as D1–D14 in PROGRESS §4)

- **D1 — Engine home: `src/lib/leagues/`.** All league-engine code (time, stats contract, providers, future draft/scoring engine) lives here as **pure TypeScript**: no Next.js/React imports, no `process.env` reads (config injected by callers), no direct `fetch` outside provider adapters. Rationale: consumable by Vitest, scripts, Route Handlers, and later Deno Edge Functions (§14 workers) without a shared-package refactor now.
- **D2 — `TimeProvider` is minimal: `now(): Date`.** Two implementations: `systemTime` and `VirtualClock` (step-driven **and** wall-paced at a speed multiplier — step for deterministic tests, paced for 1×/4×/64× replay and the future simulator §4.2). Cadences/deadlines are expressed in *virtual* time so the speed knob changes pacing, never behavior.
- **D3 — Mechanical enforcement of "no raw time":** ESLint `overrides` banning `Date.now()` and argless `new Date()` on **`src/lib/leagues/**` and `src/lib/sync/live-stats.ts`** (the refactored ingestion worker is engine code per the M0 row's TimeProvider definition), with a single scoped disable inside `systemTime`. Ships in L.A0.1 (leagues scope) and extends to live-stats.ts in L.A0.2b when the seam lands.
- **D4 — `StatsProvider` has five methods:** §23.1's "`getInjuries/Inactives`" is implemented as **two** methods — different shapes and cadences (in-game designations vs. the ~90-min-pre-kickoff official inactives list). Capability tiers (§23.5) are a declared readonly set on the provider.
- **D5 — One canonical stat-key namespace; M0 seeds `core_box` only (Q2 resolved: advanced stats punted).** §7.3.3's dot-product (`score = Σ rules[key] × stat(key)`) requires rules keys ≡ stat keys — **no translation layer, ever**. Per Chris (2026-07-18): the named tracking/charted stats were illustrative examples, deferred until a paid/owned stats source is funded — so the registry seeds the Appendix B.1/B.4–B.5 `core_box` catalog plus **clearly-marked placeholder keys** (e.g. `example_tracking_yards`, `example_charted_yards`, flagged `placeholder: true`) that exist solely so the tier machinery is exercised (D15); real advanced keys arrive later via the §23.5 one-PR checklist. Registry entries carry `storage: 'column' | 'advanced' | 'deferred'`; canonical keys without a `player_stats` column today (e.g. `fg_0_39`-shape kicking, `def_block`, `fg_missed`) are **not persisted in M0** — their storage mapping is M1 work. The Sleeper adapter's declared `capabilities` note explicitly that capability *gating* starts in M1 and its `core_box` completeness must be re-verified then (M0's ingested set is a strict subset of §23.5's core_box definition).
- **D6 — Fixture format: JSONL, gzip, in-repo** under `fixtures/nfl/<season>/wk<NN>/<provider>.jsonl.gz`. One line per provider call: `{ t, method, args, ok, status, body }` (`t` = capture wall-time ISO). Replay anchors the first timestamp to the virtual clock's start and serves the **latest recorded response with `t` ≤ virtual now** — deterministic under any poll cadence or speed; recorded failures replay as failures.
- **D7 — Pre-September gate data:** the multi-poll **synthetic-generated recording is the determinism fixture** (only it exercises intra-week delta replay); a real **2025** week recorded via the CLI is the real-data cross-check (effectively single-poll finals). Live 2026 capture starts with the season; the gate **re-runs against the first real 2026 recorded week** (ops note, PROGRESS).
- **D8 — No `player_stats.advanced` migration in M0.** No M0 deliverable persists advanced stats — synthetic/recorded tracking+charted data stays at the provider/fixture layer. The first milestone that persists advanced stats adds the column (additive). Builders: do **not** add it early.
- **D9 — pgTAP + local Supabase bootstrap happens in M0 (L.A0.5a).** DoD §2.3 requires pgTAP for every new table's policies; the repo has none. If the legacy 001–036 chain fails a fresh `supabase db reset`, that's a **stop condition** (report; never edit old migrations).
- **D10 — `nfl_weeks` broadcast-trigger waiver.** Plan §8.1's "realtime broadcast trigger if client-visible" line is **explicitly waived for M0**: no client subscribes to `nfl_weeks` yet and M0's only write is the seed (service-role, pre-launch). The trigger ships with the milestone that live-updates `first_kickoff_at`/`last_game_ends_at` from `nfl_games`. (Citable waiver for the Red-team Reviewer.)
- **D11 — 1×/4×/64× gate reading:** full recorded week **step-driven** (×3 → identical hashes) **plus** a wall-paced slice covering **≥3 poll intervals** at 1×/4×/64× matching step mode. A full week wall-paced at 1× is ~5 days — infeasible; step-determinism + pacing-equivalence composes to the criterion. Logged so QA can cite it rather than reject it.
- **D12 — `updated_at` comes from injected time in the refactored seam.** Today's wall-clock stamp inside upsert rows (live-stats.ts:114) would make replay hashes unequal by construction. This is a **deliberate, visible payload change** in L.A0.2b — the one exception to "behavior-preserving."
- **D13 — Spec erratum v2.6.1:** `nfl_games.kickoff` → `kickoff_at` (5 refs), applied this session with a changelog entry.
- **D14 — `source: 'sleeper'` is preserved exactly** through the refactor (downstream code branches on in-use values `'historical' | 'mock' | 'sleeper'`; 002's comment is stale).

---

## 4. Interface sketches (Builder finalizes exact fields; names below are contractual)

```ts
// src/lib/leagues/time/time-provider.ts
export interface TimeProvider {
  now(): Date
}
export const systemTime: TimeProvider // wall clock; the ONLY file allowed to call new Date()

// src/lib/leagues/time/virtual-clock.ts
export class VirtualClock implements TimeProvider {
  constructor(start: Date, opts?: { speed?: number }) // speed 0 = frozen/step-driven
  now(): Date
  advanceBy(ms: number): void
  advanceTo(t: Date): void
  setSpeed(multiplier: number): void // 1 | 4 | 64 wall-paced replay; 0 = manual stepping
}
```

```ts
// src/lib/leagues/stats/stat-keys.ts  (§23.5 registry — the extensibility contract)
export type StatTier = 'core_box' | 'tracking' | 'charted'
export interface StatKeyDef {
  key: string          // canonical key — ONE namespace shared by rules and stats (§7.3.3)
  label: string
  tier: StatTier
  storage: 'column' | 'advanced' | 'deferred'  // 'deferred' = no storage mapping until M1 (D5)
  placeholder?: true   // D15: machinery-proof keys only; never a product stat, never persisted
}
export const STAT_KEYS: readonly StatKeyDef[]  // core_box from Appendix B.1/B.4–B.5 + placeholder tier keys (D5/D15)
```

```ts
// src/lib/leagues/stats/stats-provider.ts  (§23.1 — the contract everything ships against)
export interface ProviderGame {
  gameId: string; season: number; week: number
  homeTeam: string; awayTeam: string
  kickoffAt: Date | null   // null when the tier can't supply it (PROGRESS Q1)
  status: 'scheduled' | 'live' | 'final' | 'postponed'
}
export interface ProviderGameState {
  gameId: string; status: ProviderGame['status']
  quarter?: number; clock?: string
  advancedFinalAt?: Date | null  // charted feed posted (§23.5 two-phase)
}
export interface ProviderPlayerWeekStats {
  playerId: string  // Sleeper-keyed players.id (§23.1); adapter owns external-ID mapping
  season: number; week: number; gameId?: string
  stats: Partial<Record<string, number>>     // core_box, canonical keys
  advanced: Partial<Record<string, number>>  // tracking/charted, canonical keys; missing = pending, never 0 (§23.5)
}
export interface ProviderInjury {
  playerId: string; designation: string      // questionable/doubtful/out/… incl. in-game rulings
  gameId?: string; reportedAt: Date
}
export interface ProviderInactives {
  gameId: string; playerIds: string[]; publishedAt: Date  // official ~90-min-pre-kickoff list (§23.1)
}

export interface StatsProvider {
  readonly name: string                       // 'sleeper' | 'synthetic' | 'fixture:<id>' | vendor ids later
  readonly capabilities: ReadonlySet<StatTier> // §23.5; gating begins M1 (D5)
  getSchedule(season: number): Promise<ProviderGame[]>
  getGameStates(season: number, week: number): Promise<ProviderGameState[]>
  getWeekStats(season: number, week: number): Promise<ProviderPlayerWeekStats[]>
  getInjuries(season: number, week: number): Promise<ProviderInjury[]>
  getInactives(season: number, week: number): Promise<ProviderInactives[]>
}
```

```ts
// src/lib/leagues/stats/degradation.ts  (§23.2 — pure, reused by real incident plumbing later)
export class DegradationTracker {
  recordPollResult(ok: boolean): void
  get degraded(): boolean   // true after 3 consecutive failures; clears on first success (§23.2)
}
```

```ts
// src/lib/leagues/stats/synthetic/  (§23.6 — pure function of (scenario, seed, now))
export interface SyntheticScenario {
  id: ScenarioId          // the nine §23.6 ids (L.A0.3)
  version: number         // versioned library — bump on any behavior change
  seed: number
  // declaratively describes: game slate + kickoffs, player pool, per-player stat
  // trajectories over game time, injury/inactive events, outage windows,
  // correction events (in/post window), charted arrival/revision times
}
export class SyntheticStatsProvider implements StatsProvider {
  constructor(scenario: SyntheticScenario, time: TimeProvider)
  // every method derives the world's state at time.now() — no mutable state,
  // no I/O, fully deterministic from (scenario, seed, now)
}
```

```ts
// src/lib/leagues/stats/fixtures/
export class RecordingStatsProvider implements StatsProvider {
  constructor(inner: StatsProvider, sink: FixtureSink, time: TimeProvider)
}
export class FixtureReplayProvider implements StatsProvider {
  constructor(recording: FixtureRecording, time: TimeProvider)
  // latest recorded response with t <= time.now(); recorded failure windows replay as failures
}
```

**Ingestion seam (L.A0.2b — refactor, not redesign):** `syncLiveStats(supabase, provider: StatsProvider, season, currentWeek, time: TimeProvider)`. live-stats.ts's private `fetchWeekStats` + `STAT_MAP` migrate into `SleeperStatsProvider` (module-private, zero external importers — safe); `schedule.ts` **stays put** and the adapter wraps `fetchSchedule`. The single caller (`sync-live` route) constructs `SleeperStatsProvider` + passes `systemTime`. `weeksToFinalize` tests untouched; `source: 'sleeper'` preserved (D14); `updated_at` from `time.now()` (D12 — the one deliberate payload change).

---

## 5. Task list (one Builder session each)

Dependency order:

```
L.A0.1 → L.A0.2a → { L.A0.2b, L.A0.3, L.A0.4 in parallel } → L.A0.6
L.A0.5a → L.A0.5b   (schema lane, independent; L.A0.6 item 1c needs L.A0.5b)
```

Gating: **none — all tasks are unblocked** (Q1/Q2 resolved 2026-07-18; see header note and PROGRESS §3 Resolved).

### L.A0.1 — TimeProvider + lint guard
> Build the `TimeProvider` abstraction. Read spec §23.1/§23.6 (virtual clock), delivery plan §2.1–2.3, and docs/specs/tasks-M0-foundations.md §3–4.
>
> 1. `src/lib/leagues/time/time-provider.ts` (`TimeProvider`, `systemTime`) and `virtual-clock.ts` (`VirtualClock`: step mode + wall-paced speed mode) per the §4 sketch.
> 2. ESLint override banning `Date.now()` and argless `new Date()` under `src/lib/leagues/**` (D3), scoped disable in `systemTime` only.
> 3. Vitest (colocated): two identically-scripted `VirtualClock` runs → identical readings; `advanceTo` monotonic (throws on backwards); paced mode maps wall→virtual at 1×/4×/64× within tolerance; step mode never moves on its own.
>
> DoD: `npm run lint && npm run type-check && npm run test` green (shown); a deliberate `Date.now()` under `src/lib/leagues/` fails lint (shown, then removed).

### L.A0.2a — StatsProvider contract + STAT_KEYS + Sleeper adapter
> Build the provider contract as pure new code — **no existing file changes** beyond exports. Read spec §23.1, §23.5, Appendix B, delivery plan §2.1–2.3, this doc §3–4, PROGRESS §3 Resolved (Q1/Q2). Depends on L.A0.1.
>
> 1. `src/lib/leagues/stats/stat-keys.ts` — registry per D5: canonical `core_box` keys from Appendix B.1/B.4–B.5 plus the D15 placeholder tier keys (`placeholder: true`), each with `label`, `tier`, `storage` (`'deferred'` where no `player_stats` column exists). **No real tracking/charted product keys** — punted per Q2 resolution.
> 2. `src/lib/leagues/stats/stats-provider.ts` — interface + payload types per §4; `src/lib/leagues/stats/degradation.ts` (`DegradationTracker`, §23.2) with unit tests.
> 3. `src/lib/leagues/stats/sleeper-stats-provider.ts` — wraps the existing Sleeper endpoints (imports `fetchSchedule` — schedule.ts does not move; re-implements the per-position weekly-stats fetch internally; `getInjuries` from the roster-dump injury fields). `capabilities` per D5 with the gating-starts-M1 doc-note. `getInactives` returns `[]` and `kickoffAt: null`, each with a doc-comment citing PROGRESS Q1.
> 4. Tests: adapter mapping from trimmed-real Sleeper rows (inline, `sleeper.test.ts` style) → canonical payloads; registry invariants (unique keys, every Appendix B.1/B.4–B.5 core_box key present, tier/storage consistency, placeholder keys never `storage: 'column'`).

### L.A0.2b — Ingestion seam refactor *(depends on L.A0.2a)*
> Put `syncLiveStats` behind the contract. Read spec §23.1–23.2, this doc §4 "Ingestion seam" + D3/D12/D14. **Scope: `src/lib/sync/live-stats.ts` and its single caller `src/app/api/cron/sync-live/route.ts` only** — `_sync-cli.ts`, the `sync-stats` route, and the seven other syncs are untouched.
>
> 1. Refactor to `syncLiveStats(supabase, provider, season, currentWeek, time)`; move `fetchWeekStats` + `STAT_MAP` into `SleeperStatsProvider`; `updated_at` from `time.now()` (D12); `source: 'sleeper'` byte-identical (D14).
> 2. Update the sync-live route: construct `SleeperStatsProvider`, pass `systemTime`.
> 3. Extend the D3 lint override to `src/lib/sync/live-stats.ts`.
> 4. Tests: `weeksToFinalize` suite untouched and green; new integration test — `syncLiveStats` with a stub provider + `VirtualClock` + capturing fake `SyncClient` asserting the exact upsert batches (the repo's first ingestion-path test), including the D12 stamp equalling injected time.
>
> Stop condition reminder: if this forces any schema or RLS change — halt; that's not this task.

### L.A0.3 — SyntheticStatsProvider + scenario library (task lineage "L.A0b") *(depends on L.A0.2a)*
> Build the synthetic tier. Read spec §23.6, §23.2 (outage/`stats_degraded`), §23.5 (tiers/pending), §19.2 rows E42–E45 + E55–E58, this doc §3–4 + D15.
>
> 1. `src/lib/leagues/stats/synthetic/`: seeded deterministic PRNG (no `Math.random` — same lint spirit as D3), versioned scenario schema, `SyntheticStatsProvider` pure in (scenario, seed, `time.now()`); fabricates core_box lines plus tracking/charted lines **using the D15 placeholder keys** (machinery proof — no product advanced keys exist yet), and inactives ~90 virtual minutes pre-kickoff (§23.1).
> 2. Nine scenarios, exact ids: `happy_path`, `flex_move` (E42), `postponement` (E43), `mass_inactives`, `provider_outage` (§23.2/E45 — methods throw inside the outage window; recovery back-fills cumulative lines; **passing assertion includes `DegradationTracker` reporting `stats_degraded` after 3 consecutive failed polls and clearing on recovery**), `correction_in_window` (E44/E10), `correction_post_window` (E44 — event dated *after* `correction_window_ends_at`; flag-vs-apply behavior is downstream, the provider must date it honestly), `charted_late` (E55/E57 — `advancedFinalAt` slips its virtual SLA), `charted_revision` (E56 — charted value changes after first posting).
> 3. Per-scenario Vitest: drive a `VirtualClock` through the timeline (step mode) asserting the §23.6 observable at each beat (pre-kickoff, monotone in-game deltas, final, T+1 charted arrival, correction emission). Suite-level guard: `globalThis.fetch` stubbed to **throw** — zero external calls, mechanically proven.
> 4. Determinism: same (scenario, seed) twice → deep-equal full-week transcripts; different seed → different lines, same event skeleton.
>
> **Pre-authorized fallback split (sizing):** if fix-cycle 3 is reached, land engine + schema + `happy_path`/`flex_move`/`postponement` as this task and open "L.A0.3b — remaining six scenarios" immediately — a sanctioned exit, not a stop-and-wait.

### L.A0.4 — Fixture recorder + replay provider + capture CLI *(depends on L.A0.2a — parallel-safe with L.A0.3)*
> Build the record/replay pair. Read spec §23.6 ("the recorder is the 'capture real'"), §23.2, delivery plan §3 (recording season) + §4.3, this doc D6–D7 + PROGRESS §3 Resolved (Q1).
>
> 1. `src/lib/leagues/stats/fixtures/`: fixture format (D6), `RecordingStatsProvider`, `FixtureReplayProvider` (latest-≤-now semantics; recorded failures replay as failures).
> 2. `scripts/record-fixtures.ts` (+ npm script `record:fixtures`), `_sync-cli.ts` conventions — wraps `SleeperStatsProvider`, polls all five methods on the §23.2 cadence, writes `fixtures/nfl/<season>/wk<NN>/sleeper.jsonl.gz`. Season/week/duration args. **Known limitation (Q1 resolved, D16): sleeper_free recordings carry injuries but no real-time official inactives or kickoff timestamps; nflverse back-fills both retroactively (adapter lands with the first runtime consumer of kickoffs, not M0).**
> 3. Check in one fixture: a real **2025** week recorded via the CLI (real-data cross-check, D7). Round-trip/composition tests use an **inline stub provider** — do NOT depend on `SyntheticStatsProvider` (that composition proof lives in L.A0.6, keeping this task parallel with L.A0.3).
> 4. Tests: round-trip (record stub → replay → identical transcripts); replay determinism across differing poll cadences; failure-window replay.

### L.A0.5a — Local stack + pgTAP bootstrap (schema lane; ungated)
> Bootstrap what DoD §2.3 assumes exists. Read delivery plan §8.1–8.2, this doc D9.
>
> 1. `supabase/config.toml` + local stack; fresh `supabase db reset` must run the full 001–036 chain. If it can't: **stop and report** (never edit old migrations).
> 2. pgTAP harness runnable via `supabase test db`, with one smoke test against an existing table's policy to prove the harness itself.

### L.A0.5b — `nfl_weeks` migration + 2026 seed *(depends on L.A0.5a)*
> Create the global NFL calendar. Read spec §12.20 (verbatim DDL), §23.3, §23.4, delivery plan §8.1–8.2, this doc §6 + D10.
>
> 1. `supabase/migrations/037_nfl_weeks.sql` per §6.
> 2. Seed derivation: run `fetchSchedule(2026)` (day-granularity is sufficient — boundaries are day math) via a throwaway script; verify Week 1 against the published 2026 opener; write explicit `America/New_York`-derived TIMESTAMPTZ literals (mind the Nov 1, 2026 DST transition); include the derivation output in the PR description.
> 3. Typegen committed — **re-append the hand-written alias block** in `src/types/database.ts` (§2).
> 4. pgTAP: anon + authenticated can SELECT; INSERT/UPDATE/DELETE denied for both (no policies exist); PK holds.
>
> DoD additionally: staging-clone rehearsal noted per §8.1; broadcast-trigger line disposed via the D10 waiver (cite it).

### L.A0.6 — M0 gate harness (exit-criteria proof) *(depends on L.A0.2b, L.A0.3, L.A0.4, L.A0.5b)*
> Prove the M0 exit criteria. Read delivery plan §3 M0 row, this doc §7 + D7/D11.
>
> 1. Record the multi-poll determinism fixture: run `RecordingStatsProvider` over `SyntheticStatsProvider` `happy_path` (this is also the recorder↔synthetic composition proof deferred from L.A0.4) and check it in.
> 2. Gate suite (Vitest, runnable as a tagged subset):
>    a. **Replay determinism (D11):** the multi-poll fixture through `syncLiveStats` (FixtureReplayProvider + VirtualClock + capturing fake SyncClient), step-driven ×3 → identical upsert-sequence hashes; then a wall-paced slice covering **≥3 poll intervals** at 1×/4×/64× → sequences identical to step mode. The 2025 real-week fixture replays as the cross-check.
>    b. **All nine scenarios** pass under the fetch-throws guard (re-runs L.A0.3's suite as a gate).
>    c. **Calendar assertion:** the replayed week's event timeline falls inside the seeded `nfl_weeks` `starts_at`/`correction_window_ends_at` bounds for that (season, week).
> 3. Update PROGRESS §1 (M0 gate status) + §2 checkboxes, pasting the gate output into the session log entry. Ops note: the gate re-runs against the first real 2026 recorded week (September).

---

## 6. Migration plan (only one in M0)

**`supabase/migrations/037_nfl_weeks.sql`** — spec §12.20 verbatim, repo conventions applied:

- Banner comment citing spec §12.20 / plan M0.
- `CREATE TABLE IF NOT EXISTS nfl_weeks (season INTEGER NOT NULL, week INTEGER NOT NULL, starts_at TIMESTAMPTZ NOT NULL, first_kickoff_at TIMESTAMPTZ, last_game_ends_at TIMESTAMPTZ, correction_window_ends_at TIMESTAMPTZ, PRIMARY KEY (season, week))` — column-for-column §12.20; **no additions, no omissions**.
- `ALTER TABLE nfl_weeks ENABLE ROW LEVEL SECURITY;` + one world-readable policy (`FOR SELECT USING (true)` — §12.20 "world-readable reference data"; 005 pattern) + the service-role-managed comment (020 pattern). **No write policies.**
- **No realtime broadcast trigger — D10 waiver** (no subscribers yet; only write is the service-role seed; trigger ships with the milestone that live-updates `first_kickoff_at`/`last_game_ends_at`).
- Seed 2026 weeks 1–18 in the same migration, `ON CONFLICT (season, week) DO NOTHING`:
  - `starts_at` = Wednesday 00:00 **America/New_York** preceding each week's first game (§12.20 "typically Wed 00:00 ET"); derivation per L.A0.5b(2).
  - `correction_window_ends_at` = following Thursday 06:00 ET (§23.4 default).
  - `first_kickoff_at`, `last_game_ends_at` = **NULL** — updated from `nfl_games` by a later milestone (nothing writes `nfl_games` yet; Q1).
- Indexes: PK suffices; no FKs used in policies (§8.1 satisfied vacuously).
- Typegen + alias-block re-append committed with the migration.

No other schema changes in M0. In particular (D8): **no** `player_stats.advanced`, **no** `nfl_games` writes, **no** RLS changes to existing tables.

---

## 7. Exit-criteria → proof map

| Exit criterion (plan §3 M0) | Proven by |
|---|---|
| Recorded week replays through the ingestion path at 1×/4×/64× deterministically | L.A0.6(2a) per D11, on L.A0.2b's seam + L.A0.4's replayer + the L.A0.6(1) multi-poll fixture; 2025 real week as cross-check |
| All nine synthetic scenarios pass with zero external calls | L.A0.3(3) fetch-throws guard, re-run as L.A0.6(2b); `provider_outage` asserts `stats_degraded` via `DegradationTracker` (§23.2) |
| Recorder captures 2026 provider responses + injury/inactive feeds (recording season, plan §3) | L.A0.4 CLI live from September — sleeper_free carries no real-time official inactives/kickoff timestamps; **nflverse back-fill per Q1 resolution (D16)** |
| `nfl_weeks` seeded (§12.20) | L.A0.5b migration + pgTAP; consumed by gate item L.A0.6(2c) |

---

## 8. Known gaps & notes for later milestones (not M0 work)

- **Q1 — resolved (nflverse, D16):** the nflverse kickoff/inactives adapter lands with the first runtime consumer of kickoffs (locks/schedule milestone); the 2026 fixture library back-fills retroactively; `nfl_games` population is fed by it.
- **Q2 — resolved (advanced stats punted; spec v2.7, D15):** real tracking/charted keys, Alpha/Ultra coefficients, calibration (OQ 17), and any vendor decision wait for funding. M1 Architect owns the 8-vs-6 template-picker question and re-cuts the M1 gate (delivery plan v1.3 already defers the Alpha/Ultra backtest).
- **RPC convention divergence:** existing repo RPCs use `SET search_path = public, pg_temp`; the leagues spec + CLAUDE.md mandate `SECURITY DEFINER SET search_path = ''` (§8.3). M0 ships no RPCs; **M1's first RPC must follow the spec form.**
- **`nfl_games` is unwritten** — populating it (kickoffs, statuses) belongs to the milestone that first needs it at runtime, fed by the nflverse supplement (Q1 resolution, D16).
- **`player_stats.advanced` JSONB** (§23.5) — added by the first milestone that persists advanced stats; with Q2's punt, none is scheduled until advanced stats are funded.
- **CLAUDE.md lists `npm run test:e2e` (Playwright) which doesn't exist yet** — Playwright bootstrap lands with the first E2E milestone (M2 per plan §4.1).
