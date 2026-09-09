import { defineConfig } from 'vitest/config'

import { resolveAlias, sharedExclude } from './vitest.shared'

/**
 * M4 gate suite (L.D6.3) — the vitest slice of `npm run test:gate:m4`
 * (tasks-M4 §6 L.D6.3 item 1). It COMPOSES the existing proofs — the
 * L.A1.16/L.B7.1 precedent; nothing is rewritten for composition's sake —
 * and it honours **F84**: every lane that landed between tasks-M4 §6's
 * approval and this gate is enumerated BY NAME, never by glob (R51 — a
 * hand-off without its own row is itself a finding). Counts are stated per
 * lane so a silent drop is visible in review.
 *
 * THE MEMBERSHIP RULE, said once so it can be checked: this config carries
 * (a) every `src/**` test file ADDED during M4 — the band is
 * `git log --diff-filter=A ... 109_inseason_tables.sql~1..HEAD`, 56 files —
 * plus (b) 15 named PRE-EXISTING suites the in-season lane composes directly
 * onto: scoring-api-db · scoring-parity-db · scoring-walls-db · calculator ·
 * derive-stats · live-stats · stat-keys · degradation · scenario-beats ·
 * synthetic-stats-provider · plan · invariants · personas ·
 * league-home-states-ops · ci-stack-lane-trigger. Nothing else. The M1/M2/M3 suites are proven by the composed
 * `test:gate:m1|m2|m3` stages; the whole pgTAP surface rides `test:db`.
 *
 * ── L.D1 schema lane, stack suites (13) ────────────────────────────────
 *   lineups-db · lineup-api-db · lineup-service — 112 set_lineup (E16
 *     bipartite, locks, IR) and the L.D4.1 service over it
 *   schedule-api-db · schedule-edit-api-db · schedule-property-db — 110/111
 *     generation, Remix confirm, E41 matchup edit, the property sweep
 *   roster-add-drop-db — 113/115 E32, caps, fa_hold, the unconditional
 *     game-day gates
 *   week-workers-db — 116 lineup_lock_tick / league_week_advance /
 *     finalize_matchups at an injected p_now
 *   playoffs-api-db · playoffs-service — 118 bracket/reseed/champion
 *   inseason-realtime-db — 119's four D296 triggers + score_write_week_batch
 *   inseason-reads-api-db · box-score-api-db · transactions-api-db — the
 *     L.D4.x read family over the wire
 *
 * ── L.D1/L.D4/L.D5 service + route layer (8) ───────────────────────────
 *   box-score-service · playoffs-service (above) · rosters-service ·
 *   standings-service · activity-service · inseason-routes ·
 *   scoring-api-db · next-segment-config-literals
 *
 * ── L.D2 scoring worker + reconciliation (9) ───────────────────────────
 *   score-week-worker · score-week-worker-db · score-week-invoker —
 *     §22.2's incremental drain, its named lawful states, E61's pending
 *     semantics through the test-only snapshot overlay
 *   reconcile · reconcile-db — L.D2.3's sweep
 *   scoring-parity-db · scoring-walls-db · calculator · derive-stats —
 *     PRE-EXISTING; the in-season worker composes straight onto them, and
 *     104's reserved-key wall is what makes L.D6.3's charted coverage gap a
 *     measured fact rather than an opinion (PROGRESS §3 Q44)
 *
 * ── L.D2/L.D3 ingestion + providers (10) ───────────────────────────────
 *   ingest-week · ingest-week-db · ingest-flags-db · live-poll ·
 *   nflverse-backfill-db · nflverse-provider · cron/sync-live ·
 *   cron/score-week · cron/reconcile · live-stats (PRE-EXISTING)
 *
 * ── Stats tier registry + the synthetic world (4, all PRE-EXISTING) ────
 *   stat-keys — the registry `example_charted_yards` lives in
 *   degradation — §23.2's three-strike flag
 *   scenario-beats · synthetic-stats-provider — §23.6's declared beats
 *
 * ── L.D6.1 sim season mode (6) ─────────────────────────────────────────
 *   season-invariants · season-scenario · season-sweep-db (the seven
 *   invariants planted in the DB) + plan · invariants · personas
 *   (PRE-EXISTING; `plan` carries the season matrix's seed-RANGE guarantees
 *   and `personas` the F288 need-aware pins)
 *
 * ── L.D5 UI lane (16) + hooks (4) ──────────────────────────────────────
 *   league-home-season{,-ops,.render} · lineup-editor-ops ·
 *   matchup-view{-ops,.render} · standings-table-ops ·
 *   standings-schedule.render · schedule-view-ops · team-page.render ·
 *   players-page{-ops,.render} · activity-feed-ops ·
 *   playoff-bracket{-ops,.render} · settings-panel-ops ·
 *   league-home-states-ops · use-league-channel-{ops,room} ·
 *   use-lineup-invalidation · use-matchups-ops
 *
 * ── M4's CI lane pin (1) ───────────────────────────────────────────────
 *   ci-stack-lane-trigger — F290/F291's home (db.yml's source globs)
 *
 * TOTAL: 71 files. Nothing here needs the RESTORED player pool, which is
 * why the whole config runs at stage [3/13], BEFORE [3.5]'s restore, on the
 * D144(5) side that wants the EMPTY post-reset pool. Any future M4 suite
 * that drafts the real pool must move OUT of this config into its own
 * post-restore stage, with the reason stated — the `[3.6]` precedent in
 * gate-m3.sh, which red-lit that gate's first composed run.
 *
 * FLAT config (no projects — see vitest.gate-m1.config.ts's note: a root
 * `include` merged onto a projects config is SILENTLY ignored) with
 * fileParallelism: false — the stack-backed files must meet the stack alone
 * (the F52 discipline).
 *
 * `oxc.jsx = automatic` is carried over from the ROOT config VERBATIM (SE.9's
 * note there): tsconfig keeps Next's required `jsx: "preserve"`, which the
 * runner's OXC transform otherwise honours and then fails to parse. This is
 * the first gate config to enumerate `*.render.test.ts` files, and without the
 * override all six of them died at import with "Failed to parse source for
 * import analysis" — a LOAD error, which vitest counts as a failed FILE and
 * not as a failed test, so it would have been easy to mistake for a
 * collection quirk (measured 2026-09-08: 6 failed / 65 passed, 1182 tests
 * "passed").
 */
export default defineConfig({
  resolve: { alias: resolveAlias },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    exclude: sharedExclude,
    fileParallelism: false,
    include: [
      // L.D1 schema lane, stack suites (13)
      'src/lib/leagues/api/lineups-db.test.ts',
      'src/lib/leagues/api/lineup-api-db.test.ts',
      'src/lib/leagues/api/lineup-service.test.ts',
      'src/lib/leagues/api/schedule-api-db.test.ts',
      'src/lib/leagues/api/schedule-edit-api-db.test.ts',
      'src/lib/leagues/api/schedule-property-db.test.ts',
      'src/lib/leagues/api/roster-add-drop-db.test.ts',
      'src/lib/leagues/api/week-workers-db.test.ts',
      'src/lib/leagues/api/playoffs-api-db.test.ts',
      'src/lib/leagues/api/inseason-realtime-db.test.ts',
      'src/lib/leagues/api/inseason-reads-api-db.test.ts',
      'src/lib/leagues/api/box-score-api-db.test.ts',
      'src/lib/leagues/api/transactions-api-db.test.ts',
      // L.D1/L.D4/L.D5 service + route layer (8)
      'src/lib/leagues/api/box-score-service.test.ts',
      'src/lib/leagues/api/playoffs-service.test.ts',
      'src/lib/leagues/api/rosters-service.test.ts',
      'src/lib/leagues/api/standings-service.test.ts',
      'src/lib/leagues/api/activity-service.test.ts',
      'src/lib/leagues/api/inseason-routes.test.ts',
      'src/lib/leagues/api/scoring-api-db.test.ts',
      'src/lib/next-segment-config-literals.test.ts',
      // L.D2 scoring worker + reconciliation (9)
      'src/lib/leagues/scoring/score-week-worker.test.ts',
      'src/lib/leagues/scoring/score-week-worker-db.test.ts',
      'src/lib/leagues/scoring/score-week-invoker.test.ts',
      'src/lib/leagues/scoring/reconcile.test.ts',
      'src/lib/leagues/scoring/reconcile-db.test.ts',
      'src/lib/leagues/scoring/scoring-parity-db.test.ts',
      'src/lib/leagues/scoring/scoring-walls-db.test.ts',
      'src/lib/leagues/scoring/calculator.test.ts',
      'src/lib/leagues/scoring/derive-stats.test.ts',
      // L.D2/L.D3 ingestion + providers (10)
      'src/lib/sync/ingest-week.test.ts',
      'src/lib/sync/ingest-week-db.test.ts',
      'src/lib/sync/ingest-flags-db.test.ts',
      'src/lib/sync/live-poll.test.ts',
      'src/lib/sync/live-stats.test.ts',
      'src/lib/sync/nflverse-backfill-db.test.ts',
      'src/lib/leagues/stats/nflverse/nflverse-provider.test.ts',
      'src/app/api/cron/sync-live/route.test.ts',
      'src/app/api/cron/score-week/route.test.ts',
      'src/app/api/cron/reconcile/route.test.ts',
      // Stats tier registry + the synthetic world (4)
      'src/lib/leagues/stats/stat-keys.test.ts',
      'src/lib/leagues/stats/degradation.test.ts',
      'src/lib/leagues/stats/synthetic/scenario-beats.test.ts',
      'src/lib/leagues/stats/synthetic/synthetic-stats-provider.test.ts',
      // L.D6.1 sim season mode (6)
      'src/lib/leagues/sim/season-invariants.test.ts',
      'src/lib/leagues/sim/season-scenario.test.ts',
      'src/lib/leagues/sim/season-sweep-db.test.ts',
      'src/lib/leagues/sim/plan.test.ts',
      'src/lib/leagues/sim/invariants.test.ts',
      'src/lib/leagues/sim/personas.test.ts',
      // L.D5 UI lane (16) + 2 of the 4 hooks
      'src/components/leagues/league-home-season-ops.test.ts',
      'src/components/leagues/league-home-season.render.test.ts',
      'src/components/leagues/league-home-states-ops.test.ts',
      'src/components/leagues/lineup-editor-ops.test.ts',
      'src/components/leagues/matchup-view-ops.test.ts',
      'src/components/leagues/matchup-view.render.test.ts',
      'src/components/leagues/standings-table-ops.test.ts',
      'src/components/leagues/standings-schedule.render.test.ts',
      'src/components/leagues/schedule-view-ops.test.ts',
      'src/components/leagues/team-page.render.test.ts',
      'src/components/leagues/players-page-ops.test.ts',
      'src/components/leagues/players-page.render.test.ts',
      'src/components/leagues/activity-feed-ops.test.ts',
      'src/components/leagues/playoff-bracket-ops.test.ts',
      'src/components/leagues/playoff-bracket.render.test.ts',
      'src/components/leagues/settings-panel-ops.test.ts',
      'src/hooks/use-league-channel-ops.test.ts',
      'src/hooks/use-league-channel-room.test.ts',
      // the other 2 hooks + M4's CI lane pin (1)
      'src/hooks/use-lineup-invalidation.test.ts',
      'src/hooks/use-matchups-ops.test.ts',
      'src/lib/ci-stack-lane-trigger.test.ts',
    ],
  },
})
