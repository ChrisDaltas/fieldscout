import { describe, expect, it } from 'vitest'

import { REPAIR_SCORED_TEAM_TITLE, repairMatchupLabel, repairOptions, repairProblem, repairable, teamSeatable } from './commish-repair-ops'
import { EDIT_NO_CHANGE_COPY, EDIT_SELF_COPY } from './schedule-view-ops'
import { NAMES, SCHEDULE, matchup } from './standings-schedule.fixtures'

describe('re-pair: only pairings the override verb accepts are offered (prevent, don’t refuse)', () => {
  it('repairable: regular / secondary, two teams, no result, no score, no override', () => {
    expect(repairable(matchup({ id: 'a', week: 3, home_team_id: 't1', away_team_id: 't2' }))).toBe(true)
    expect(repairable(matchup({ id: 'a', week: 3, home_team_id: 't1', away_team_id: 't2', round_type: 'secondary' }))).toBe(true)
    // A live, unscored game is still re-pairable — the override lifts the timing gate.
    expect(repairable(matchup({ id: 'a', week: 3, home_team_id: 't1', away_team_id: 't2', status: 'live', home_score: 0, away_score: null }))).toBe(true)
    expect(repairable(matchup({ id: 'a', week: 3, home_team_id: 't1', away_team_id: 't2', round_type: 'playoff' }))).toBe(false)
    expect(repairable(matchup({ id: 'a', week: 3, home_team_id: 't1', away_team_id: null }))).toBe(false)
    expect(repairable(matchup({ id: 'a', week: 3, home_team_id: 't1', away_team_id: 't2', result: 'home' }))).toBe(false)
    expect(repairable(matchup({ id: 'a', week: 3, home_team_id: 't1', away_team_id: 't2', is_overridden: true }))).toBe(false)
    // Boundary: the smallest score there is still counts as scored.
    expect(repairable(matchup({ id: 'a', week: 3, home_team_id: 't1', away_team_id: 't2', away_score: 0.01 }))).toBe(false)
  })

  it('repairOptions: weeks with a scored game everywhere are not offered; week 3 offers its four pairings', () => {
    const options = repairOptions(SCHEDULE.matchups, NAMES)
    expect([...options.keys()]).toEqual([3])
    expect(options.get(3)!.map(repairMatchupLabel)).toEqual(['Alpha vs Delta', 'Bravo vs Charlie', 'Alpha vs Bravo (second game)', 'Charlie vs Delta (second game)'])
  })

  it('teamSeatable: a team whose own game that week is already scored cannot be pulled in', () => {
    const matchups = [
      matchup({ id: 'x1', week: 2, home_team_id: 't1', away_team_id: 't3', home_score: 40.25 }),
      matchup({ id: 'x2', week: 2, home_team_id: 't2', away_team_id: 't4' }),
    ]
    const [target] = repairOptions(matchups, NAMES).get(2)!
    expect(target.id).toBe('x2')
    expect(teamSeatable('t1', target, matchups)).toEqual({ ok: false, why: REPAIR_SCORED_TEAM_TITLE })
    expect(teamSeatable('t2', target, matchups)).toEqual({ ok: true })
    // A team with no game that week to leave (only reachable with bad data) is not offered either.
    expect(teamSeatable('t9', target, matchups).ok).toBe(false)
  })

  it('repairProblem: self-pairing, the current pairing and a scored sibling stop Save; a real swap passes', () => {
    const options = repairOptions(SCHEDULE.matchups, NAMES).get(3)!
    const m5 = options.find((m) => m.id === 'm5')!
    expect(repairProblem(null, '', '', SCHEDULE.matchups)).toBe('Pick a matchup to re-pair.')
    expect(repairProblem(m5, 't1', 't1', SCHEDULE.matchups)).toBe(EDIT_SELF_COPY)
    expect(repairProblem(m5, 't1', 't4', SCHEDULE.matchups)).toBe(EDIT_NO_CHANGE_COPY)
    expect(repairProblem(m5, 't1', 't3', SCHEDULE.matchups)).toBeNull()
    // Flipping home and away IS a change the verb makes.
    expect(repairProblem(m5, 't4', 't1', SCHEDULE.matchups)).toBeNull()
    const scoredSibling = SCHEDULE.matchups.map((m) => (m.id === 'm6' ? { ...m, home_score: 3 } : m))
    expect(repairProblem(m5, 't1', 't3', scoredSibling)).toBe(REPAIR_SCORED_TEAM_TITLE)
  })
})
