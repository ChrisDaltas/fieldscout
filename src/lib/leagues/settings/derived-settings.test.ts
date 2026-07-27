/**
 * Shared derived-settings rules — golden pins for the ONE module both the
 * create wizard (L.A2.1) and the settings panel (L.A2.4) reconcile through
 * (F27's invariant + R108's re-clamps live here, so both surfaces get them).
 *
 * Pinned here:
 *   1. **F27 (Q10/v2.8.6):** `derivePlayoffStartWeek` = weeks + 1 across the
 *      range (with the 14→15 default as the deliberate-break target), and
 *      `reconcileDerived` re-derives it on every rsw change AND overrides a
 *      hostile free value.
 *   2. **§7.3.5 veto re-default:** follows a team_count change while untouched,
 *      preserved once customized.
 *   3. **R108 re-clamps (each fails without the fix):** `playoff_teams` snaps
 *      down when `team_count` shrinks below it; `trade_deadline_week` snaps
 *      down when `regular_season_weeks` shrinks below it (`null`/off untouched);
 *      neither fires when the invariant already holds.
 *
 * The wizard-ops suite re-exercises (1) and (2) through the re-export; this
 * suite owns them at the shared module and adds the R108 pins.
 */
import { describe, expect, it } from 'vitest'

import {
  derivePlayoffStartWeek,
  largestPlayoffTeamsWithin,
  reconcileDerived,
} from './derived-settings'
import {
  deriveDefaultVetoVotes,
  LEAGUE_SETTINGS_DEFAULTS,
  validateLeagueSettings,
  type LeagueSettings,
} from './league-settings'

const base = (): LeagueSettings => structuredClone(LEAGUE_SETTINGS_DEFAULTS)

describe('F27 — playoff_start_week is read-only-derived (Q10/v2.8.6)', () => {
  it('derivePlayoffStartWeek = regular_season_weeks + 1 across the range', () => {
    expect(derivePlayoffStartWeek(12)).toBe(13)
    expect(derivePlayoffStartWeek(13)).toBe(14)
    expect(derivePlayoffStartWeek(14)).toBe(15) // GOLDEN PIN (default) — break target
    expect(derivePlayoffStartWeek(15)).toBe(16)
  })

  it('reconcile re-derives playoff_start_week on every rsw change (emission stays valid)', () => {
    const b = base()
    for (const rsw of [12, 13, 14, 15]) {
      const next = reconcileDerived(b, { ...b, regular_season_weeks: rsw })
      expect(next.playoff_start_week).toBe(rsw + 1)
      expect(validateLeagueSettings(next).valid).toBe(true)
    }
  })

  it('reconcile overrides a hostile free playoff_start_week value (never an input)', () => {
    const b = base() // rsw 14
    const tampered = { ...b, playoff_start_week: 99 as LeagueSettings['playoff_start_week'] }
    expect(reconcileDerived(b, tampered).playoff_start_week).toBe(15)
  })
})

describe('§7.3.5 — veto default follows a team_count change only while untouched', () => {
  it('untouched veto (= old ⌈team_count/2⌉) follows to the new default', () => {
    const b = base() // team_count 12, veto 6
    expect(reconcileDerived(b, { ...b, team_count: 16 }).trade_veto_votes).toBe(deriveDefaultVetoVotes(16))
  })

  it('a customized veto is preserved across a team_count change', () => {
    const b = { ...base(), trade_veto_votes: 3 }
    expect(reconcileDerived(b, { ...b, team_count: 16 }).trade_veto_votes).toBe(3)
  })
})

describe('R108 — dependent fields re-clamp when their driver shrinks', () => {
  it('largestPlayoffTeamsWithin snaps to the largest legal option', () => {
    expect(largestPlayoffTeamsWithin(8)).toBe(8)
    expect(largestPlayoffTeamsWithin(10)).toBe(10)
    expect(largestPlayoffTeamsWithin(12)).toBe(12)
    expect(largestPlayoffTeamsWithin(14)).toBe(12) // no 14 option
    expect(largestPlayoffTeamsWithin(16)).toBe(12)
  })

  it('clamps playoff_teams down when team_count shrinks below it (fails without R108)', () => {
    // team_count 16, playoff_teams 12 (max) → shrink team_count to 8 → 8.
    const b = { ...base(), team_count: 16 as LeagueSettings['team_count'], playoff_teams: 12 as LeagueSettings['playoff_teams'] }
    const next = reconcileDerived(b, { ...b, team_count: 8 })
    expect(next.playoff_teams).toBe(8)
    expect(validateLeagueSettings(next).valid).toBe(true)
  })

  it('leaves playoff_teams alone when it already fits', () => {
    const b = { ...base(), team_count: 16 as LeagueSettings['team_count'], playoff_teams: 6 as LeagueSettings['playoff_teams'] }
    expect(reconcileDerived(b, { ...b, team_count: 8 }).playoff_teams).toBe(6)
  })

  it('clamps trade_deadline_week down when regular_season_weeks shrinks below it (fails without R108)', () => {
    // rsw 15, deadline 15 → shrink rsw to 12 → deadline 12.
    const b = { ...base(), regular_season_weeks: 15, trade_deadline_week: 15 }
    const next = reconcileDerived(b, { ...b, regular_season_weeks: 12 })
    expect(next.trade_deadline_week).toBe(12)
    expect(validateLeagueSettings(next).valid).toBe(true)
  })

  it('leaves trade_deadline_week alone when off (null) or already inside the season', () => {
    const off = { ...base(), regular_season_weeks: 15, trade_deadline_week: null }
    expect(reconcileDerived(off, { ...off, regular_season_weeks: 12 }).trade_deadline_week).toBeNull()
    const inside = { ...base(), regular_season_weeks: 15, trade_deadline_week: 10 }
    expect(reconcileDerived(inside, { ...inside, regular_season_weeks: 12 }).trade_deadline_week).toBe(10)
  })
})
