import { defineConfig } from 'vitest/config'

import { resolveAlias, sharedExclude } from './vitest.shared'

/**
 * M3 gate suite (L.C6.1) — the vitest slice of `npm run test:gate:m3`
 * (tasks-M3 §6 L.C6.1 item 1: "the M3 vitest gate config (auction-core/
 * tick/commish DB suites + the derivation parity fixture + the property
 * test)"). It COMPOSES the existing proofs — the L.A1.16/L.B7.1 precedent;
 * nothing is rewritten for composition's sake — and it discharges **F84**:
 * every lane that landed between tasks-M3 §6's approval and this gate is
 * enumerated BY NAME, never by glob (the F84 doctrine; R51 — a hand-off
 * without its own row is itself a finding). Counts are stated per lane so
 * a silent drop is visible in review.
 *
 * ── M3 engine lane (L.C1.*–L.C3.*) — 8 stack suites ────────────────────
 *   auction-start-db        — 084 budget derivation + the auction start arm
 *   auction-core-db         — 085 nominate/bid over the wire (E2/E5/E25)
 *   auction-tick-db         — 086 ARM 2.6 + priced completion
 *   auction-commish-db      — 087 reverse/adjust/cancel/end + D141 gates
 *   auction-commish-api-db  — the §8.7 auction routes (L.C2.2) + AP.6's
 *                             E69 idempotent budget edit + MS.2's pin (e)
 *   auction-api-db          — nominate/bid routes + the §4.7 TS≡SQL parity
 *                             sweep (stack half) — F113/F132's home file:
 *                             a red at the "launcher bids FOR the human
 *                             seat" line is those rows, not a gate failure,
 *                             IF it fires once and isolates green
 *   auction-realtime-db     — 088 bid broadcasts + void summary (D184)
 *   mock-auction-db         — 089 mock auctions, CPU bidders, E62 wire half
 *
 * ── Derivation parity + THE property test (L.C2.1/L.C4.1) — 3 ──────────
 *   auction-budget          — the D90-pattern LITERAL half (pgTAP 033
 *                             goldens as stored literals)
 *   auction-solvency-property     — pure layer (fast-check, seed printed)
 *   auction-solvency-property-db  — DB layer: four worlds + WORLD E over
 *                                   the real RPCs (exit criterion 2)
 *
 * ── Sim unit suites (L.B6.1/L.C4.1) — 3 ────────────────────────────────
 *   sim/plan · sim/personas · sim/invariants (incl. the auction pins and
 *   the R561 checkAuctionNoWorkerErrors falsification)
 *
 * ── AP lane (tasks-AP §5/§7; F84's original clause) — 4 ────────────────
 *   auction-uncontestable-db   — AP.2's §8.6.9 instant-award stack suite
 *   commish-auction-ops        — the pause-first coupling pin (:171) +
 *                                AP/MS gate-shape pins
 *   auction-player-table       — AP.7's split columns (Q16) + L.C3.3
 *   auction-player-table-ops   — the derived-column goldens (91 incl. the
 *                                two stored-literal column lists)
 *   (AP.1/AP.3/AP.5/AP.6 landed as pins inside files already enumerated
 *   above and as pgTAP 039/040/041/046/047, which ride the full `test:db`
 *   stage of scripts/gate-m3.sh.)
 *
 * ── MP lane (F84's MP line, named at MP.11's merge) — 13 ───────────────
 *   standalone-actions-db · auth-pin (api/mocks) · mock-launch-ops ·
 *   mock-report · mock-surface-states · room-scope · home-quick-actions ·
 *   more-lists · draft-config-fields · use-mock-drafts-cache ·
 *   draft-settings-guard · client-fetch · flag-free-server-paths
 *   (pgTAP 042–045 ride the test:db stage.)
 *
 * ── MP-extended DR room suites (F84's ambit note) — 2 ──────────────────
 *   room-entry · room-exits
 *
 * ── MS lane (tasks-MS §5/§8; landed MS.2/3/5/7/8) — 3 ──────────────────
 *   draft-commish-api-db    — MS.7's targeting fix + MS.2's launcher-200
 *                             wire pins (also an M2 gate file — deliberate
 *                             overlap, the gate composes, never dedupes
 *                             away a lane's named home)
 *   draft-options-menu      — MS.5's honest render set
 *   mock-launcher-ops       — MS.8's slot control (+ MP launch surface)
 *   (pgTAP 048/049/050 ride the test:db stage. MS.1/MS.4/MS.6 are PARKED
 *   with the deferred league-attached feature — ACTIVE-BUILD 1c — so
 *   MS.6's §8.8 harness does not exist to compose; when that feature
 *   returns, its harness joins this list BY NAME.)
 *
 * ── L.C5.1's client-fix pin home — 1 ───────────────────────────────────
 *   use-draft-ops           — the equal-version delivery-order pins (the
 *                             auction-completion wedge fix) + R565's
 *                             replay-is-same-reference pin
 *
 * TOTAL: 37 files. The other slices of `test:gate:m3` (scripts/gate-m3.sh)
 * prove the rest: fresh `db reset` → full pgTAP (032–050 are the
 * M3/AP/MP/MS files) → THIS config → the draft-scope restore → the
 * L.C4.1 25-league auction sim run → the F56 bounded settle → `test:e2e`
 * (the L.C5.1 trio + the M2 suite, one Playwright run) → `test:gate:m2`
 * → `test:gate:m1` → `test:gate` (M0/M1/M2 continuity).
 *
 * FLAT config (no projects — see vitest.gate-m1.config.ts's note) with
 * fileParallelism: false: the stack-backed files must meet the stack
 * alone (the F52 discipline); the interleaved unit files are cheap and
 * serializing them costs seconds.
 */
export default defineConfig({
  resolve: { alias: resolveAlias },
  test: {
    exclude: sharedExclude,
    fileParallelism: false,
    include: [
      // M3 engine lane (8)
      'src/lib/leagues/api/auction-start-db.test.ts',
      'src/lib/leagues/api/auction-core-db.test.ts',
      'src/lib/leagues/api/auction-tick-db.test.ts',
      'src/lib/leagues/api/auction-commish-db.test.ts',
      'src/lib/leagues/api/auction-commish-api-db.test.ts',
      'src/lib/leagues/api/auction-api-db.test.ts',
      'src/lib/leagues/api/auction-realtime-db.test.ts',
      'src/lib/leagues/api/mock-auction-db.test.ts',
      // Derivation parity + the property test (3)
      'src/components/draft/auction-budget.test.ts',
      'src/components/draft/auction-solvency-property.test.ts',
      'src/lib/leagues/api/auction-solvency-property-db.test.ts',
      // Sim unit suites (3)
      'src/lib/leagues/sim/plan.test.ts',
      'src/lib/leagues/sim/personas.test.ts',
      'src/lib/leagues/sim/invariants.test.ts',
      // AP lane (4)
      'src/lib/leagues/api/auction-uncontestable-db.test.ts',
      'src/components/draft/commish-auction-ops.test.ts',
      'src/components/draft/auction-player-table.test.ts',
      'src/components/draft/auction-player-table-ops.test.ts',
      // MP lane (13)
      'src/lib/leagues/api/standalone-actions-db.test.ts',
      'src/app/api/mocks/auth-pin.test.ts',
      'src/components/draft/mock-launch-ops.test.ts',
      'src/components/draft/mock-report.test.ts',
      'src/components/draft/mock-surface-states.test.ts',
      'src/components/draft/room-scope.test.ts',
      'src/components/home/home-quick-actions.test.ts',
      'src/components/layout/more-lists.test.ts',
      'src/components/leagues/draft-config-fields.test.ts',
      'src/hooks/use-mock-drafts-cache.test.ts',
      'src/lib/leagues/settings/draft-settings-guard.test.ts',
      'src/lib/leagues/api/client-fetch.test.ts',
      'src/lib/flag-free-server-paths.test.ts',
      // MP-extended DR room suites (2)
      'src/components/draft/room-entry.test.ts',
      'src/components/draft/room-exits.test.ts',
      // MS lane (3)
      'src/lib/leagues/api/draft-commish-api-db.test.ts',
      'src/components/draft/draft-options-menu.test.ts',
      'src/components/draft/mock-launcher-ops.test.ts',
      // L.C5.1's client-fix pin home (1)
      'src/hooks/use-draft-ops.test.ts',
    ],
  },
})
