import { defineConfig } from 'vitest/config'

import { resolveAlias, sharedExclude } from './vitest.shared'

/**
 * M5 gate suite (L.D3.10) — the vitest slice of `npm run test:gate:m5`
 * (tasks-M5 §6 L.D3.10: "M5 vitest (resolver properties + parity)"). It
 * COMPOSES the existing proofs and honours **F84**: every file is enumerated
 * BY NAME, never by glob, so a silent drop is visible in review.
 *
 * THE MEMBERSHIP RULE, said once so it can be checked: (a) every `src/**`
 * test file ADDED during M5 that still exists — the band is
 * `git log --diff-filter=A 684861e..HEAD` (684861e = the M5 breakdown),
 * less L.E1.27's `per-week-rules-db` (M6A, in flight beside it) and less
 * `waiver-claim-edit.test.ts` (added at L.D2.12, removed since) — 32 files;
 * plus (b) THREE named pre-existing suites M5 changed underneath:
 * `roster-add-drop-db` (L.D2.7 re-cut the add path to the waiver schedule),
 * `transactions-api-db` (the activity read the claim / trade rows land in)
 * and `season-sweep-db` (the sim sweep L.D3.8 and L.D3.10 re-ordered and
 * paged). Nothing else: the M4 → M0 suites ride `test:gate:m4`, the whole
 * pgTAP surface (093–106) rides `test:db`.
 *
 * ── Exit criterion 2 — the FAAB tiebreak properties + parity (3) ────────
 *   resolve-waiver-run · resolve-waiver-run-property — the L.D2.8 reference
 *     resolver (TD5 worked examples; same claim set + seed ⇒ byte-identical;
 *     no negative balance, no player on two rosters)
 *   waivers-resolver-parity-db — the SQL processor ⇔ the TS resolver
 * ── Schema lanes over the stack (9) ─────────────────────────────────────
 *   waiver-claims-db · trades-db · trade-execution-db · finished-week-lineups-db
 *   · waivers-api-db · trades-api-db · commish-trade-api-db
 *   · stored-player-points-db · player-points-golden-db
 * ── Services, routes, hooks, pure helpers (15) ──────────────────────────
 *   waivers-service · waiver-window-service · commish-faab-service
 *   · trades-service · waiver-schedule · waiver-window-view
 *   · player-points-store · the six route files · use-waiver-hooks
 *   · use-trade-hooks
 * ── UI (4) + the sim's transaction invariants (1) ───────────────────────
 *   waiver-claims-ops · waivers-ui.render · trades-ops · trades-ui.render
 *   · transaction-invariants
 * TOTAL: 35 files.
 *
 * Nothing here needs the RESTORED player pool (the golden creates the players
 * its recording needs and deletes exactly those — D422), so the whole config
 * runs BEFORE the gate's draft-scope restore, on the side that wants the EMPTY
 * post-reset pool (D144(5)).
 *
 * FLAT config with fileParallelism: false (the F52 discipline — stack-backed
 * files meet the stack alone), and `oxc.jsx = automatic` carried over for the
 * `*.render.test.ts` files (vitest.gate-m4.config.ts explains why).
 */
export default defineConfig({
  resolve: { alias: resolveAlias },
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    exclude: sharedExclude,
    fileParallelism: false,
    include: [
      // exit criterion 2 — properties + parity (3)
      'src/lib/leagues/waivers/resolve-waiver-run.test.ts',
      'src/lib/leagues/waivers/resolve-waiver-run-property.test.ts',
      'src/lib/leagues/waivers/waivers-resolver-parity-db.test.ts',
      // schema lanes over the stack (9)
      'src/lib/leagues/api/waiver-claims-db.test.ts',
      'src/lib/leagues/api/trades-db.test.ts',
      'src/lib/leagues/api/trade-execution-db.test.ts',
      'src/lib/leagues/api/finished-week-lineups-db.test.ts',
      'src/lib/leagues/api/waivers-api-db.test.ts',
      'src/lib/leagues/api/trades-api-db.test.ts',
      'src/lib/leagues/api/commish-trade-api-db.test.ts',
      'src/lib/leagues/scoring/stored-player-points-db.test.ts',
      'src/lib/leagues/scoring/player-points-golden-db.test.ts',
      // services, routes, hooks, pure helpers (15)
      'src/lib/leagues/api/waivers-service.test.ts',
      'src/lib/leagues/api/waiver-window-service.test.ts',
      'src/lib/leagues/api/commish-faab-service.test.ts',
      'src/lib/leagues/api/trades-service.test.ts',
      'src/lib/leagues/time/waiver-schedule.test.ts',
      'src/lib/leagues/waivers/waiver-window-view.test.ts',
      'src/lib/leagues/scoring/player-points-store.test.ts',
      'src/app/api/leagues/[id]/waivers/route.test.ts',
      'src/app/api/leagues/[id]/waivers/[cid]/route.test.ts',
      'src/app/api/leagues/[id]/commish/faab/route.test.ts',
      'src/app/api/leagues/[id]/trades/route.test.ts',
      'src/app/api/leagues/[id]/trades/[tid]/route.test.ts',
      'src/app/api/leagues/[id]/commish/trade/route.test.ts',
      'src/hooks/use-waiver-hooks.test.ts',
      'src/hooks/use-trade-hooks.test.ts',
      // UI (4) + the sim's transaction invariants (1)
      'src/components/leagues/waiver-claims-ops.test.ts',
      'src/components/leagues/waivers-ui.render.test.ts',
      'src/components/leagues/trades-ops.test.ts',
      'src/components/leagues/trades-ui.render.test.ts',
      'src/lib/leagues/sim/transaction-invariants.test.ts',
      // named pre-existing suites M5 changed underneath (3)
      'src/lib/leagues/api/roster-add-drop-db.test.ts',
      'src/lib/leagues/api/transactions-api-db.test.ts',
      'src/lib/leagues/sim/season-sweep-db.test.ts',
    ],
  },
})
