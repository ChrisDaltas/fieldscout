import { beforeEach, describe, expect, it } from 'vitest'

import { usePlayerModalStore } from '@/stores/player-modal-store'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import { openPlayer } from './use-open-player'

// Chris 2026-10-04, "Player links open the modal".
describe('openPlayer — player links open the modal', () => {
  beforeEach(() => {
    usePlayerModalStore.setState({ target: null })
    usePlayerWindowsStore.setState({ windows: [], ambient: null })
  })

  it('global context → the modal, no league', () => {
    openPlayer('p1')
    expect(usePlayerModalStore.getState().target).toEqual({ playerId: 'p1', leagueId: null })
    expect(usePlayerWindowsStore.getState().windows).toEqual([])
  })

  it('a league link → the modal in that league', () => {
    openPlayer('p1', { kind: 'league', leagueId: 'L1' })
    expect(usePlayerModalStore.getState().target).toEqual({ playerId: 'p1', leagueId: 'L1' })
  })

  it('no context inside a league shell → the ambient league', () => {
    usePlayerWindowsStore.setState({ ambient: { kind: 'league', leagueId: 'L2' } })
    openPlayer('p1')
    expect(usePlayerModalStore.getState().target).toEqual({ playerId: 'p1', leagueId: 'L2' })
  })

  it('the draft room keeps the floating card (Queue)', () => {
    usePlayerWindowsStore.setState({ ambient: { kind: 'draft', leagueId: 'L1', draftId: 'd1', teamId: 't1' } })
    openPlayer('p1')
    expect(usePlayerModalStore.getState().target).toBeNull()
    expect(usePlayerWindowsStore.getState().windows.map((w) => w.playerId)).toEqual(['p1'])
  })
})
