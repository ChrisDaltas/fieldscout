/**
 * The phone profile's door to the player's NFL team page (audit frame-2) and
 * the way Back from that page returns to the player — "Back always goes to
 * where you came from" (Chris, 2026-10-15, gap list #27).
 *
 * The profile is an overlay; leaving the page under it closes it. The door
 * leaves a mark on the history entry it leaves and keeps the profile (tab,
 * stack, draft seat) in memory; landing on that entry again reopens it.
 * History is faked here — the same `state` / `replaceState` the browser has.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/app' }))

import { usePlayerModalStore } from '@/stores/player-modal-store'

import {
  isPlainClick,
  markProfileResume,
  nflTeamDoor,
  PROFILE_RESUME_KEY,
  reopenFrom,
  resumeMarkOf,
  resumeOnArrival,
  withoutResumeMark,
  withResumeMark,
} from './profile-team-door'
import { useProfileUiStore, type ProfileTrailStep } from './profile-ui-store'

/** One history entry's state, as the browser keeps it — Next's own keys
 *  included, which every write must carry over. */
function fakeHistory(state: Record<string, unknown> | null = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'] }) {
  const h = {
    state: state as unknown,
    replaceState: vi.fn((next: unknown) => {
      h.state = next
    }),
  }
  return h
}

const target = (playerId: string, leagueId: string | null = 'L1') => ({ playerId, leagueId, listContext: null })

beforeEach(() => {
  useProfileUiStore.setState({ trail: [], restore: null, draft: null, resume: null })
  usePlayerModalStore.setState({ target: null })
})

describe('nflTeamDoor', () => {
  it('his team page, named in full', () => {
    expect(nflTeamDoor('KC', '/app/players', null)).toEqual({ href: '/app/nfl/KC', name: 'Kansas City Chiefs', here: false })
  })

  it('none for a free agent or a team the app does not know (its page would be a 404)', () => {
    expect(nflTeamDoor(null, '/app', null)).toBeNull()
    expect(nflTeamDoor('', '/app', null)).toBeNull()
    expect(nflTeamDoor('FA', '/app', null)).toBeNull()
    expect(nflTeamDoor('XYZ', '/app', null)).toBeNull()
  })

  it('none from a list editor holding a draft — leaving its page would lose the unsaved changes', () => {
    expect(nflTeamDoor('KC', '/app/lists', { listId: 'l', listTitle: 'L', removeFromDraft: () => {} })).toBeNull()
    // A saved list's profile (Remove writes at once) keeps the door.
    expect(nflTeamDoor('KC', '/app/lists', { listId: 'l', listTitle: 'L' })?.href).toBe('/app/nfl/KC')
  })

  it('over that very team page, the door only closes the profile (no second copy of the page)', () => {
    expect(nflTeamDoor('KC', '/app/nfl/KC', null)?.here).toBe(true)
    expect(nflTeamDoor('kc', '/app/nfl/kc', null)?.here).toBe(true)
    expect(nflTeamDoor('KC', '/app/nfl/BUF', null)?.here).toBe(false)
    expect(nflTeamDoor('KC', '/app/nfl', null)?.here).toBe(false)
  })
})

describe('isPlainClick', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }
  it('a plain tap marks; a modified click (a new tab) leaves this page as it is', () => {
    expect(isPlainClick(click)).toBe(true)
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false)
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false)
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false)
    expect(isPlainClick({ ...click, button: 1 })).toBe(false)
  })
})

describe('the history mark', () => {
  const mark = { id: 'm1', path: '/app/players', playerId: 'p1', leagueId: null }

  it('reads only a well-formed mark', () => {
    expect(resumeMarkOf({ [PROFILE_RESUME_KEY]: mark })).toEqual(mark)
    expect(resumeMarkOf(null)).toBeNull()
    expect(resumeMarkOf({ __NA: true })).toBeNull()
    expect(resumeMarkOf({ [PROFILE_RESUME_KEY]: { ...mark, playerId: 7 } })).toBeNull()
    expect(resumeMarkOf({ [PROFILE_RESUME_KEY]: { ...mark, leagueId: 3 } })).toBeNull()
    expect(resumeMarkOf({ [PROFILE_RESUME_KEY]: 'p1' })).toBeNull()
  })

  it("adding and taking it off keep Next's own keys", () => {
    const next = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'] }
    const on = withResumeMark(next, mark)
    expect(on).toEqual({ ...next, [PROFILE_RESUME_KEY]: mark })
    expect(withoutResumeMark(on)).toEqual(next)
    expect(withResumeMark(null, mark)).toEqual({ [PROFILE_RESUME_KEY]: mark })
  })
})

describe('leaving for the team page, then Back', () => {
  it('Back lands on the page left: the profile reopens as it was — player, league, tab, stack, draft seat — once', () => {
    const step: ProfileTrailStep = { from: target('p0'), fromName: 'Patrick Mahomes', fromTab: 'team', to: 'p1' }
    const seat = { playerId: 'p1', draftId: 'd1', teamId: 't1', leagueId: 'L1' }
    useProfileUiStore.setState({ trail: [step], draft: seat })
    const h = fakeHistory()

    const mark = markProfileResume(h, '/app/players', target('p1'), 'log')
    expect(resumeMarkOf(h.state)).toEqual(mark)
    expect(h.state).toMatchObject({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'] })
    // Leaving closes the profile, which ends its stack and seat.
    usePlayerModalStore.setState({ target: null })
    useProfileUiStore.getState().clearTrail()
    useProfileUiStore.getState().setDraft(null)

    expect(resumeOnArrival(h, '/app/players')).toBe(true)
    expect(usePlayerModalStore.getState().target).toEqual(target('p1'))
    const ui = useProfileUiStore.getState()
    expect(ui.restore).toEqual({ playerId: 'p1', tab: 'log' })
    expect(ui.trail).toEqual([step])
    expect(ui.draft).toEqual(seat)
    expect(ui.resume).toBeNull()
    // The mark is spent, Next's keys stay: coming back again opens nothing.
    expect(h.state).toEqual({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'] })
    usePlayerModalStore.setState({ target: null })
    expect(resumeOnArrival(h, '/app/players')).toBe(false)
    expect(usePlayerModalStore.getState().target).toBeNull()
  })

  it('a saved list’s context comes back with him (its Remove still shows)', () => {
    const fromList = { playerId: 'p1', leagueId: null, listContext: { listId: 'l1', listTitle: 'Sleepers' } }
    const h = fakeHistory()
    markProfileResume(h, '/app/lists', fromList, 'summary')
    expect(resumeOnArrival(h, '/app/lists')).toBe(true)
    expect(usePlayerModalStore.getState().target).toEqual(fromList)
  })

  it('an entry with no mark — the team page itself, or the same page reached from the dock — opens nothing', () => {
    expect(resumeOnArrival(fakeHistory(), '/app/players')).toBe(false)
    expect(resumeOnArrival(fakeHistory(null), '/app/players')).toBe(false)
    expect(usePlayerModalStore.getState().target).toBeNull()
  })

  it('a mark for another page is not this entry’s: nothing opens and it stays', () => {
    const h = fakeHistory()
    markProfileResume(h, '/app/players', target('p1'), 'summary')
    expect(resumeOnArrival(h, '/app/nfl/KC')).toBe(false)
    expect(resumeMarkOf(h.state)).not.toBeNull()
    expect(usePlayerModalStore.getState().target).toBeNull()
  })

  it('after a reload (memory gone) the mark alone reopens the player, in his league, on Summary', () => {
    const h = fakeHistory()
    markProfileResume(h, '/app', target('p1', 'L9'), 'history')
    useProfileUiStore.setState({ resume: null })
    expect(resumeOnArrival(h, '/app')).toBe(true)
    expect(usePlayerModalStore.getState().target).toEqual(target('p1', 'L9'))
    expect(useProfileUiStore.getState().restore).toBeNull()
    expect(useProfileUiStore.getState().trail).toEqual([])
  })

  it('reopenFrom trusts memory only for the same mark and player', () => {
    const mark = { id: 'm1', path: '/app', playerId: 'p1', leagueId: 'L1' }
    const kept = { id: 'm1', target: target('p1'), tab: 'log', trail: [], draft: null }
    expect(reopenFrom(mark, kept).restore).toEqual({ playerId: 'p1', tab: 'log' })
    expect(reopenFrom(mark, { ...kept, id: 'other' }).restore).toBeNull()
    expect(reopenFrom(mark, { ...kept, target: target('p2') }).target.playerId).toBe('p1')
  })
})

describe('profile store', () => {
  it('closing the profile (clearing its stack) keeps what the team door remembered', () => {
    const resume = { id: 'm1', target: target('p1'), tab: 'log', trail: [], draft: null }
    useProfileUiStore.getState().setResume(resume)
    useProfileUiStore.getState().clearTrail()
    expect(useProfileUiStore.getState().resume).toEqual(resume)
  })
})
