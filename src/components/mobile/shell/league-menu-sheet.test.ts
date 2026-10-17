import { describe, expect, it } from 'vitest'

import { playoffWeeks } from './league-menu-sheet'

describe('playoffWeeks — the Menu’s Playoffs value', () => {
  it('spans one round per halving of the field', () => {
    expect(playoffWeeks({ playoff_teams: 6, playoff_start_week: 15, playoff_weeks_per_round: 1 })).toBe('Weeks 15–17')
    expect(playoffWeeks({ playoff_teams: 4, playoff_start_week: 15, playoff_weeks_per_round: 1 })).toBe('Weeks 15–16')
    expect(playoffWeeks({ playoff_teams: 4, playoff_start_week: 13, playoff_weeks_per_round: 2 })).toBe('Weeks 13–16')
    expect(playoffWeeks({ playoff_teams: 2, playoff_start_week: 15, playoff_weeks_per_round: 1 })).toBe('Week 15')
  })
  it('says None without playoffs, and nothing before the settings load', () => {
    expect(playoffWeeks({ playoff_teams: 0, playoff_start_week: 15, playoff_weeks_per_round: 1 })).toBe('None')
    expect(playoffWeeks(undefined)).toBeUndefined()
  })
})
