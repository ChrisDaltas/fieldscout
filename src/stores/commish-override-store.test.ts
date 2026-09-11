import { beforeEach, describe, expect, it } from 'vitest'

import { useCommishOverrideStore } from './commish-override-store'

/**
 * COMMISSIONER OVERRIDE MODE — the store's two load-bearing properties
 * (M6A; PROGRESS §3(h)). `team-page.render.test.ts` pins what the SURFACE does
 * with the answer; this pins the answer, because zustand v5 hands a static
 * render `getInitialState()` and a render test therefore cannot.
 */
describe('commish-override-store', () => {
  beforeEach(() => useCommishOverrideStore.setState({ leagueId: null }))

  it('starts off, turns on for a league, and turns off again', () => {
    const { enter, exit } = useCommishOverrideStore.getState()
    expect(useCommishOverrideStore.getState().leagueId).toBeNull()
    enter('league-a')
    expect(useCommishOverrideStore.getState().leagueId).toBe('league-a')
    exit()
    expect(useCommishOverrideStore.getState().leagueId).toBeNull()
  })

  it('is KEYED BY LEAGUE — being in the mode for one league is not being in it for another', () => {
    // The whole reason this is a store and not page state is that the mode
    // follows him from team 5 to team 6. It must not follow him out of the
    // league: a commissioner of A opening a team page in B is an ordinary
    // member there, and an inherited override bar would say otherwise.
    useCommishOverrideStore.getState().enter('league-a')
    const { leagueId } = useCommishOverrideStore.getState()
    expect(leagueId === 'league-a').toBe(true)
    expect(leagueId === 'league-b').toBe(false)
    // Entering another league REPLACES rather than accumulates — one league at
    // a time, so exiting can never leave a second one silently on.
    useCommishOverrideStore.getState().enter('league-b')
    expect(useCommishOverrideStore.getState().leagueId).toBe('league-b')
  })
})
