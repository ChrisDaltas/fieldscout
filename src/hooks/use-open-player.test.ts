import { beforeEach, describe, expect, it } from 'vitest'

import { usePlayerModalStore } from '@/stores/player-modal-store'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import { openPlayer } from './use-open-player'

// Chris 2026-10-04, "Player links open the modal".
// Chris 2026-10-05 (D494, supersedes D488/D491 routing): every click opens
// the floating mini card first; its Expand opens the modal.
describe('openPlayer — every player click opens the mini card', () => {
  beforeEach(() => {
    usePlayerModalStore.setState({ target: null })
    usePlayerWindowsStore.setState({ windows: [], ambient: null })
  })

  const only = () => {
    const ws = usePlayerWindowsStore.getState().windows
    expect(ws).toHaveLength(1)
    expect(usePlayerModalStore.getState().target).toBeNull()
    return ws[0]
  }

  it('global context → the card, global', () => {
    openPlayer('p1')
    expect(only()).toMatchObject({ playerId: 'p1', context: { kind: 'global' }, listContext: null })
  })

  it('a league link → the card in that league', () => {
    openPlayer('p1', { kind: 'league', leagueId: 'L1' })
    expect(only().context).toEqual({ kind: 'league', leagueId: 'L1' })
  })

  it('no context inside a league shell → the ambient league', () => {
    usePlayerWindowsStore.setState({ ambient: { kind: 'league', leagueId: 'L2' } })
    openPlayer('p1')
    expect(only().context).toEqual({ kind: 'league', leagueId: 'L2' })
  })

  it('an owned list context rides on the card (Remove from list)', () => {
    openPlayer('p1', undefined, { listId: 'list1', listTitle: 'My list' })
    expect(only().listContext).toEqual({ listId: 'list1', listTitle: 'My list' })
  })

  it('R1518: a draft ambient context opens the draft card (Queue); a list context does not change that', () => {
    usePlayerWindowsStore.setState({ ambient: { kind: 'draft', leagueId: 'L1', draftId: 'd1', teamId: 't1' } })
    openPlayer('p2', undefined, { listId: 'list1', listTitle: 'My list' })
    const win = only()
    expect(win.playerId).toBe('p2')
    expect(win.context).toEqual({ kind: 'draft', leagueId: 'L1', draftId: 'd1', teamId: 't1' })
    expect(win.listContext).toBeNull()
  })
})
