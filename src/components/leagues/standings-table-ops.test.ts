/**
 * standings-table-ops.test.ts — L.D5.3's standings pins (spec §7.3.7, §11.5,
 * §16.2 `standings-table`; PROGRESS D297/D314/D317).
 *
 * THE DoD PIN: **the chain renders in the RPC's STORED order**. The golden
 * below is a literal document in 117's shape whose chain is
 * `win_pct → points_for → head_to_head → points_against → coin_flip` and
 * whose rows carry the separators 117 named; `renderedChain` must return the
 * five entries in exactly that order and the row separators must render
 * as the RPC's words. The probe (render PA before H2H) reds the first cell
 * here and the render pin in `standings-schedule.render.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { GOLDEN_STANDINGS, standingsRow } from './standings-schedule.fixtures'
import {
  NO_FINAL_WEEKS_COPY,
  formatRecord,
  formatWinPct,
  overriddenTitle,
  overriddenWeeksByTeam,
  recordColumns,
  renderedChain,
  separatorLabel,
  skipNotes,
  standingsEmptyCopy,
  tiebreakerLabel,
  type OverriddenMatchupSlice,
} from './standings-table-ops'

// M6A L.E1.12 — the commissioner-adjusted marker reads the stored flag only.
describe('overriddenWeeksByTeam — `matchups.is_overridden`, row-scoped (D342), regular season only', () => {
  const row = (over: Partial<OverriddenMatchupSlice>): OverriddenMatchupSlice => ({
    week: 1,
    round_type: 'regular',
    home_team_id: 't1',
    away_team_id: 't2',
    is_overridden: false,
    ...over,
  })

  it('no flag ⇒ an EMPTY map (nothing is inferred from a score)', () => {
    expect(overriddenWeeksByTeam([row({}), row({ week: 2 })]).size).toBe(0)
  })

  it('BOTH sides of a flagged row are marked, weeks sorted and unique across regular + secondary rows', () => {
    const map = overriddenWeeksByTeam([
      row({ week: 5, is_overridden: true }),
      row({ week: 2, is_overridden: true, home_team_id: 't1', away_team_id: 't3' }),
      row({ week: 5, is_overridden: true, round_type: 'secondary', home_team_id: 't1', away_team_id: 't4' }),
      row({ week: 3 }), // not flagged
    ])
    expect(map.get('t1')).toStrictEqual([2, 5])
    expect(map.get('t2')).toStrictEqual([5])
    expect(map.get('t3')).toStrictEqual([2])
    expect(map.get('t4')).toStrictEqual([5])
    expect(map.size).toBe(4)
  })

  it('a playoff row feeds the bracket, not this table; a bye row marks its one side', () => {
    expect(overriddenWeeksByTeam([row({ round_type: 'playoff', is_overridden: true })]).size).toBe(0)
    const bye = overriddenWeeksByTeam([row({ away_team_id: null, is_overridden: true })])
    expect([...bye.keys()]).toStrictEqual(['t1'])
  })

  it('the words name the weeks, singular and plural', () => {
    expect(overriddenTitle([3])).toBe('Commissioner-adjusted — the score or result of this team’s Week 3 matchup was set by the commissioner.')
    expect(overriddenTitle([3, 7])).toContain('Week 3, Week 7 matchups')
  })
})

describe('the chain renders in the RPC’s STORED order — the DoD pin', () => {
  it('the golden chain is win_pct → points_for → head_to_head → points_against → division_record → coin_flip, labelled, in that order', () => {
    expect(renderedChain(GOLDEN_STANDINGS.chain).map((e) => e.entry)).toEqual([
      'win_pct',
      'points_for',
      'head_to_head',
      'points_against',
      'division_record',
      'coin_flip',
    ])
    expect(renderedChain(GOLDEN_STANDINGS.chain).map((e) => e.label)).toEqual([
      'Win %',
      'PF',
      'H2H',
      'PA',
      'Division',
      'Coin flip',
    ])
    // PA is AFTER H2H — the probe's exact target.
    const labels = renderedChain(GOLDEN_STANDINGS.chain).map((e) => e.label)
    expect(labels.indexOf('H2H')).toBeLessThan(labels.indexOf('PA'))
  })

  it('a REORDERED stored chain renders reordered — this file follows the RPC, it does not know the "right" order', () => {
    // A commissioner may store win_pct lower down (Q38(C)); 117 honours the
    // stored order and so must the strip.
    const stored = [
      { entry: 'points_for', status: 'applied', reason: null },
      { entry: 'win_pct', status: 'applied', reason: null },
      { entry: 'coin_flip', status: 'applied', reason: null },
    ]
    expect(renderedChain(stored).map((e) => e.entry)).toEqual([
      'points_for',
      'win_pct',
      'coin_flip',
    ])
  })

  it('a skipped or inert entry keeps its position and carries 117’s reason in words', () => {
    const chain = renderedChain(GOLDEN_STANDINGS.chain)
    expect(chain[2]).toEqual({ entry: 'head_to_head', label: 'H2H', status: 'applied', note: null })
    expect(chain[4]).toEqual({
      entry: 'division_record',
      label: 'Division',
      status: 'inert',
      note: 'inert — divisions are off in v1',
    })
    const totalPoints = renderedChain([
      { entry: 'head_to_head', status: 'skipped', reason: 'total_points' },
    ])
    expect(totalPoints[0].note).toBe('skipped — a total-points league has no head-to-head (E64)')
  })

  it('anything that is not 117’s chain array renders as an empty strip, never a guessed order', () => {
    expect(renderedChain(null)).toEqual([])
    expect(renderedChain('win_pct')).toEqual([])
    expect(renderedChain([{ status: 'applied' }, null, 'x'])).toEqual([])
  })
})

describe('the row separators are the RPC’s words', () => {
  it('the golden rows: leader null, Bravo by Win %, Charlie by H2H (the clean two-team tie), Delta by Win %', () => {
    expect(GOLDEN_STANDINGS.standings.map((r) => separatorLabel(r.separated_by))).toEqual([
      null,
      'Win %',
      'H2H',
      'Win %',
    ])
  })

  it('unknown entries render their key; `unresolved` renders as such', () => {
    expect(separatorLabel('unresolved')).toBe('unresolved')
    expect(separatorLabel('something_new')).toBe('something_new')
    expect(tiebreakerLabel('coin_flip')).toBe('Coin flip')
  })
})

describe('formatting', () => {
  it('records drop the tie column until a tie exists', () => {
    expect(formatRecord({ wins: 5, losses: 2, ties: 0 })).toBe('5-2')
    expect(formatRecord({ wins: 5, losses: 2, ties: 1 })).toBe('5-2-1')
  })

  it('win % is .667 / 1.000 / .000', () => {
    expect(formatWinPct(0.6667)).toBe('.667')
    expect(formatWinPct(1)).toBe('1.000')
    expect(formatWinPct(0)).toBe('.000')
  })
})

describe('the extra-record columns follow the settings, and a real record shows regardless', () => {
  it('off by default; on with the setting', () => {
    expect(
      recordColumns(GOLDEN_STANDINGS.standings, { median_game: false, second_opponent: false }),
    ).toEqual({
      median: false,
      second: false,
    })
    expect(
      recordColumns(GOLDEN_STANDINGS.standings, { median_game: true, second_opponent: false }),
    ).toEqual({
      median: true,
      second: false,
    })
  })

  it('a row carrying a median record shows the column even when the setting is off (the RPC’s record is the truth)', () => {
    const rows = [
      standingsRow({
        rank: 1,
        team_id: 't1',
        name: 'A',
        median_record: { wins: 1, losses: 0, ties: 0 },
      }),
    ]
    expect(recordColumns(rows, { median_game: false, second_opponent: false })).toEqual({
      median: true,
      second: false,
    })
  })
})

describe('empty is BY REASON, and the E63/E64 notes read the skips', () => {
  it('no_final_weeks renders the designed copy; a ranked table renders none', () => {
    expect(standingsEmptyCopy({ reason: 'no_final_weeks', weeks_final: 0 })).toBe(
      NO_FINAL_WEEKS_COPY,
    )
    expect(standingsEmptyCopy(GOLDEN_STANDINGS)).toBeNull()
  })

  it('a 3+ tie names its teams; a total-points skip names the mode', () => {
    const names = new Map([
      ['t1', 'Alpha'],
      ['t2', 'Bravo'],
      ['t3', 'Charlie'],
    ])
    expect(
      skipNotes(
        [{ entry: 'head_to_head', reason: 'group_of_3_or_more', teams: ['t1', 't2', 't3'] }],
        names,
      ),
    ).toEqual(['Head-to-head skipped for a tie of three or more (E63): Alpha, Bravo, Charlie.'])
    expect(
      skipNotes([{ entry: 'head_to_head', reason: 'total_points', teams: ['t1', 't2'] }], names),
    ).toEqual(['Head-to-head does not apply in a total-points league (E64): Alpha, Bravo.'])
    expect(skipNotes(null, names)).toEqual([])
  })
})
