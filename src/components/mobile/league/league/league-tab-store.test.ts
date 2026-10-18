import { beforeEach, describe, expect, it } from 'vitest'

import { useLeagueTabStore } from './league-tab-store'

// Gap list §4 item 9: the week League › Matchups was stepped to, per league.
describe('league tab store — the kept Matchups week', () => {
  beforeEach(() => useLeagueTabStore.setState({ weeks: {} }))

  it('keeps a week per league, and null forgets only that league’s', () => {
    const { setWeek } = useLeagueTabStore.getState()
    setWeek('a', 3)
    setWeek('b', 7)
    expect(useLeagueTabStore.getState().weeks).toEqual({ a: 3, b: 7 })
    setWeek('a', 5)
    expect(useLeagueTabStore.getState().weeks.a).toBe(5)
    setWeek('a', null)
    expect(useLeagueTabStore.getState().weeks).toEqual({ b: 7 })
  })

  it('leaves the segment and the filters alone', () => {
    useLeagueTabStore.setState({ segments: { a: 'standings' } })
    useLeagueTabStore.getState().setWeek('a', 2)
    expect(useLeagueTabStore.getState().segments).toEqual({ a: 'standings' })
  })
})
