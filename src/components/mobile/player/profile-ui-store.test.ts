/**
 * The mobile player profile's own stack (Chris, #45 + #27, 2026-10-15): a
 * depth-chart name opens that player in place; Back returns to the profile
 * it was opened from, on its tab — and only while the stack is the truth.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { trailBackTo, useProfileUiStore, type ProfileTrailStep } from './profile-ui-store'

const target = (playerId: string) => ({ playerId, leagueId: 'L1', listContext: null })
const step = (from: string, to: string, fromTab = 'team'): ProfileTrailStep => ({ from: target(from), fromName: from.toUpperCase(), fromTab, to })

describe('profile stack', () => {
  beforeEach(() => {
    useProfileUiStore.getState().clearTrail()
  })

  it('push and pop, newest first; popping an empty stack is null', () => {
    const ui = useProfileUiStore.getState()
    ui.pushTrail(step('a', 'b'))
    ui.pushTrail(step('b', 'c', 'summary'))
    expect(useProfileUiStore.getState().trail.map((s) => s.to)).toEqual(['b', 'c'])
    expect(useProfileUiStore.getState().popTrail()).toMatchObject({ to: 'c', from: { playerId: 'b' }, fromTab: 'summary' })
    expect(useProfileUiStore.getState().popTrail()).toMatchObject({ to: 'b', from: { playerId: 'a' } })
    expect(useProfileUiStore.getState().popTrail()).toBeNull()
    expect(useProfileUiStore.getState().trail).toEqual([])
  })

  it('Back shows only on the player the newest step opened (A → B → C, back to B, back to A)', () => {
    const trail = [step('a', 'b'), step('b', 'c')]
    expect(trailBackTo(trail, 'c')?.fromName).toBe('B')
    expect(trailBackTo(trail.slice(0, 1), 'b')?.fromName).toBe('A')
    expect(trailBackTo([], 'a')).toBeNull()
    // Another surface opened someone the stack did not: no Back to a stranger.
    expect(trailBackTo(trail, 'z')).toBeNull()
    expect(trailBackTo(trail, null)).toBeNull()
  })

  it('clearing the stack drops a pending tab restore too', () => {
    const ui = useProfileUiStore.getState()
    ui.pushTrail(step('a', 'b'))
    ui.setRestore({ playerId: 'a', tab: 'team' })
    ui.clearTrail()
    expect(useProfileUiStore.getState().trail).toEqual([])
    expect(useProfileUiStore.getState().restore).toBeNull()
  })
})
