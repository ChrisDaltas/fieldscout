import { defineConfig } from 'vitest/config'

import { resolveAlias, sharedExclude } from './vitest.shared'

/**
 * M6 gate suite (L.E1.37) — the vitest slice of `npm run test:gate:m6`
 * (tasks-M6 §6 L.E1.37: "the M6 vitest set (ingest classification, records,
 * replay, copy census)"). It COMPOSES the existing proofs and honours **F84**:
 * every file is enumerated BY NAME, never by glob, so a silent drop is
 * visible in review.
 *
 * THE MEMBERSHIP RULE, said once so it can be checked (f9ff511 = the commit
 * that added the M6 breakdown, PR #360):
 *   (a) every `src/**` / `scripts/**` test file ADDED in `f9ff511..HEAD`
 *       (`git log --diff-filter=A`) — all 30 still exist;
 *   (b) every pre-existing test file M6 MODIFIED in the same range
 *       (`git diff --diff-filter=M`) — 45 files: the receipt re-pins
 *       (L.E1.29 / L.E1.30 / L.E1.31 / F555 / L.E1.42), L.D3.16's trade
 *       powers, the ingest door and its classification (L.E2.1), the
 *       worker's correction records (L.E2.2), the ✸ / username renders.
 * Named for the task's four words:
 *   ingest classification — ingest-week · ingest-week-db · ingest-flags-db
 *     · live-poll · stat-corrections-db
 *   records — league-stat-corrections-db · score-week-worker-db
 *     · corrections-api-db / -service
 *   replay — correction-replay · correction-replay-db (the synthetic pair;
 *     the real-capture leg prints that no real correction is captured —
 *     non-blocking per Chris 2026-10-02, D468; open under F540)
 *   copy census — commish-log-copy · stat-correction-labels
 *     · username-link.render (the plain-handle source census) · route-groups
 * TOTAL: 75 files. The whole pgTAP surface rides `test:db`; the M5 → M0
 * suites ride `test:gate:m5`.
 *
 * Runs BEFORE the gate's draft-scope restore, on the EMPTY post-reset pool
 * (D144(5)) — the M5 gate's posture. FLAT config, fileParallelism: false
 * (F52), `oxc.jsx = automatic` for the `*.render.test.ts` files.
 */
export default defineConfig({
  resolve: { alias: resolveAlias },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    exclude: sharedExclude,
    fileParallelism: false,
    include: [
      // (a) ADDED during M6 (30)
      'scripts/correction-events-export.test.ts',
      'scripts/correction-snapshot-diff.test.ts',
      'src/app/api/leagues/[id]/commish/summary/route.test.ts',
      'src/app/app/(shell)/leagues/[leagueId]/activity/activity-page.test.ts',
      'src/app/app/(shell)/leagues/[leagueId]/commish/commish-page.test.ts',
      'src/components/leagues/activity-page-ops.test.ts',
      'src/components/leagues/activity-page.render.test.ts',
      'src/components/leagues/commish-console.render.test.ts',
      'src/components/leagues/commish-log-copy.test.ts',
      'src/components/leagues/corrections-view-ops.test.ts',
      'src/components/leagues/corrections-view.render.test.ts',
      'src/components/leagues/invite-panel.render.test.ts',
      'src/components/shared/username-link.render.test.ts',
      'src/hooks/use-commish-log-invalidation.test.ts',
      'src/hooks/use-commish-log-receipt-hooks.test.ts',
      'src/hooks/use-commish-summary.test.ts',
      'src/hooks/use-league-members.test.ts',
      'src/hooks/use-stat-corrections.test.ts',
      'src/lib/leagues/api/commish-summary-api-db.test.ts',
      'src/lib/leagues/api/commish-summary-service.test.ts',
      'src/lib/leagues/api/corrections-api-db.test.ts',
      'src/lib/leagues/api/corrections-service.test.ts',
      'src/lib/leagues/api/members-retire-api-db.test.ts',
      'src/lib/leagues/api/members-service.test.ts',
      'src/lib/leagues/scoring/correction-replay-db.test.ts',
      'src/lib/leagues/scoring/correction-replay.test.ts',
      'src/lib/leagues/scoring/league-stat-corrections-db.test.ts',
      'src/lib/leagues/scoring/stat-correction-labels.test.ts',
      'src/lib/scoring/personal-scoring-system-db.test.ts',
      'src/lib/sync/stat-corrections-db.test.ts',
      // (b) pre-existing suites M6 changed underneath (45)
      'src/app/api/leagues/[id]/commish/trade/route.test.ts',
      'src/components/draft/commish-panel-ops.test.ts',
      'src/components/draft/room-entry.test.ts',
      'src/components/leagues/activity-feed-ops.test.ts',
      'src/components/leagues/league-home-season-ops.test.ts',
      'src/components/leagues/league-home-season.render.test.ts',
      'src/components/leagues/matchup-override.render.test.ts',
      'src/components/leagues/players-page-ops.test.ts',
      'src/components/leagues/players-page.render.test.ts',
      'src/components/leagues/playoff-bracket.render.test.ts',
      'src/components/leagues/settings-panel-inseason.render.test.ts',
      'src/components/leagues/standings-schedule.render.test.ts',
      'src/components/leagues/team-commish.render.test.ts',
      'src/components/leagues/team-page.render.test.ts',
      'src/components/leagues/trades-ops.test.ts',
      'src/components/leagues/trades-ui.render.test.ts',
      'src/components/leagues/waivers-ui.render.test.ts',
      'src/components/notifications/notification-href.test.ts',
      'src/hooks/use-commish-part2-invalidation.test.ts',
      'src/hooks/use-trade-hooks.test.ts',
      'src/lib/ci-stack-lane-trigger.test.ts',
      'src/lib/leagues/api/activity-service.test.ts',
      'src/lib/leagues/api/auction-commish-api-db.test.ts',
      'src/lib/leagues/api/commish-log-service.test.ts',
      'src/lib/leagues/api/commish-overrides-api-db.test.ts',
      'src/lib/leagues/api/commish-part2-api-db.test.ts',
      'src/lib/leagues/api/commish-trade-api-db.test.ts',
      'src/lib/leagues/api/draft-commish-api-db.test.ts',
      'src/lib/leagues/api/draft-commish-db.test.ts',
      'src/lib/leagues/api/draft-queue-api-db.test.ts',
      'src/lib/leagues/api/inseason-routes.test.ts',
      'src/lib/leagues/api/lineup-api-db.test.ts',
      'src/lib/leagues/api/lineups-db.test.ts',
      'src/lib/leagues/api/members-api-db.test.ts',
      'src/lib/leagues/api/trades-api-db.test.ts',
      'src/lib/leagues/api/trades-service.test.ts',
      'src/lib/leagues/scoring/score-week-invoker.test.ts',
      'src/lib/leagues/scoring/score-week-worker-db.test.ts',
      'src/lib/leagues/scoring/scoring-walls-db.test.ts',
      'src/lib/leagues/sim/season-sweep-db.test.ts',
      'src/lib/route-groups.test.ts',
      'src/lib/sync/ingest-flags-db.test.ts',
      'src/lib/sync/ingest-week-db.test.ts',
      'src/lib/sync/ingest-week.test.ts',
      'src/lib/sync/live-poll.test.ts',
    ],
  },
})
