import { describe, expect, it } from 'vitest'

import { commishRole, leagueStatusPill, leaguesCardSub, LEAGUES_PARENT } from './leagues-ops'

describe('leagueStatusPill — desktop’s badge for the states Home’s card has no words for', () => {
  it('names the playoffs (blue) and a finished league (quiet)', () => {
    expect(leagueStatusPill('playoffs')).toEqual({ label: 'Playoffs', tone: 'blue' })
    expect(leagueStatusPill('complete')).toEqual({ label: 'Complete', tone: 'quiet' })
  })
  it('says nothing in season or around the draft — the matchup or the draft pill speaks', () => {
    for (const status of ['setup', 'scheduled', 'drafting', 'in_season', 'something_new']) {
      expect(leagueStatusPill(status), status).toBeNull()
    }
  })
})

describe('the role on a Leagues card', () => {
  it('names the commissioners only', () => {
    expect(commishRole('commissioner')).toBe('Commissioner')
    expect(commishRole('co_commissioner')).toBe('Co-commissioner')
    expect(commishRole('manager')).toBeNull()
  })
  it('ends Home’s sub with it', () => {
    expect(leaguesCardSub('8-team PPR · Week 5', 'commissioner')).toBe('8-team PPR · Week 5 · Commissioner')
    expect(leaguesCardSub('12-team half PPR · 2026', 'co_commissioner')).toBe('12-team half PPR · 2026 · Co-commissioner')
    expect(leaguesCardSub('8-team PPR · Week 5', 'manager')).toBe('8-team PPR · Week 5')
  })
})

describe('Back with nothing behind', () => {
  it('goes Home, where the same league cards live', () => {
    expect(LEAGUES_PARENT).toBe('/app')
  })
})
