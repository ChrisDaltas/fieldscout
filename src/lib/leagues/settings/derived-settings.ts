/**
 * Shared derived-settings rules for the create wizard AND the settings panel
 * (M1; spec §7.3.1/§7.3.5/§7.3.8; ledger F27 + review nit R108).
 *
 * Pure TS (engine home, D1): no React, no Node/Next APIs, no clock reads.
 *
 * BOTH settings surfaces — `league-create-wizard.tsx` (L.A2.1) and
 * `settings-panel.tsx` (L.A2.4) — reconcile their working settings through
 * THIS one module so the two can never diverge on a derived or dependent
 * field (F27's invariant lives in one place; R108's re-clamps land in both
 * surfaces at once). `league-create-wizard-ops.ts` re-exports these for its
 * existing callers; the panel imports them directly.
 *
 * The rules, in application order:
 *   1. **F27 (Q10 ruling (a) / spec v2.8.6) — always:** `playoff_start_week`
 *      is read-only-derived = `regular_season_weeks + 1` (strict continuity).
 *      Neither surface offers a free input for it, so re-deriving on every
 *      settings edit keeps the stored value consistent on every emission (the
 *      contract's `validateLeagueSettings` seam check is the backstop).
 *   2. **§7.3.5 derived default — on `team_count` change, when untouched:** a
 *      `trade_veto_votes` still sitting at the OLD ⌈team_count/2⌉ default
 *      follows to the NEW one (R63); a customized value is preserved (the
 *      equality check distinguishes the two).
 *   3. **R108 re-clamps — dependent fields whose driver shrank below them:**
 *      `playoff_teams` ≤ `team_count` (clamped down to the largest legal
 *      option) and `trade_deadline_week` ≤ `regular_season_weeks` (clamped
 *      down, `null`/off left alone). Invariant-restoring, so they fire only
 *      when actually violated — a driver Select shrinking no longer leaves a
 *      dependent Radix Select momentarily blank (R108). `validateLeagueSettings`
 *      still gates persistence, so this is UX, not a correctness backstop.
 */
import {
  deriveDefaultVetoVotes,
  type LeagueSettings,
} from './league-settings'

/**
 * §7.3.1 `playoff_teams` options (0 = points-only champion). The single
 * source both surfaces filter their option list against and the R108 clamp
 * snaps to; mirrors the schema's `z.literal([0,2,4,6,8,10,12])`.
 */
export const PLAYOFF_TEAMS_OPTIONS = [0, 2, 4, 6, 8, 10, 12] as const

/**
 * F27 (Q10/v2.8.6): the derived playoff start — the week after the regular
 * season ends. Rendered read-only next to `regular_season_weeks`, never an
 * input.
 */
export function derivePlayoffStartWeek(regularSeasonWeeks: number): number {
  return regularSeasonWeeks + 1
}

/**
 * The largest legal `playoff_teams` option that fits within `team_count`
 * (§7.3.1 R: `playoff_teams` ≤ `team_count`). Every v1 `team_count` (8–16) has
 * at least 8 as a fit, so the clamp never lands on an illegal value.
 */
export function largestPlayoffTeamsWithin(teamCount: number): LeagueSettings['playoff_teams'] {
  let best: LeagueSettings['playoff_teams'] = 0
  for (const option of PLAYOFF_TEAMS_OPTIONS) {
    if (option <= teamCount) best = option
  }
  return best
}

/**
 * Re-apply the derived/dependent-field rules after a settings edit, given the
 * PREVIOUS settings (to detect what changed). Pure: returns a fresh object,
 * never mutates `next`.
 */
export function reconcileDerived(prev: LeagueSettings, next: LeagueSettings): LeagueSettings {
  const reconciled: LeagueSettings = {
    ...next,
    // (1) F27 — always.
    playoff_start_week: derivePlayoffStartWeek(next.regular_season_weeks),
  }

  // (2) §7.3.5 veto re-default — team_count changed AND the veto was untouched.
  if (
    next.team_count !== prev.team_count &&
    prev.trade_veto_votes === deriveDefaultVetoVotes(prev.team_count)
  ) {
    reconciled.trade_veto_votes = deriveDefaultVetoVotes(next.team_count)
  }

  // (3) R108 re-clamps — dependent fields whose driver shrank below them.
  if (reconciled.playoff_teams > reconciled.team_count) {
    reconciled.playoff_teams = largestPlayoffTeamsWithin(reconciled.team_count)
  }
  if (
    reconciled.trade_deadline_week !== null &&
    reconciled.trade_deadline_week > reconciled.regular_season_weeks
  ) {
    reconciled.trade_deadline_week = reconciled.regular_season_weeks
  }

  return reconciled
}
