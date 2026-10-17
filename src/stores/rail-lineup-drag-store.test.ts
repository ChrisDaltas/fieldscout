import { describe, expect, it, vi } from 'vitest'

import { railDropTargetAt, useRailLineupDragStore, type RailDrag } from './rail-lineup-drag-store'

// F570 — the bridge between the rail's app-level drag and the lineup.
describe('rail-lineup-drag-store (F570)', () => {
  const drag: RailDrag = {
    leagueId: 'L',
    playerId: 'p1',
    availability: 'free_agent',
    teamId: null,
    player: { id: 'p1', full_name: 'Free Agent', position: 'WR', team: 'KC', headshot_url: null, status: null, adp: null },
  }

  it('a drag starts clean, tracks the target under the pointer, and ends clean', () => {
    const s = useRailLineupDragStore.getState()
    s.start(drag)
    expect(useRailLineupDragStore.getState().drag).toEqual(drag)
    s.setHover('bench')
    expect(useRailLineupDragStore.getState().hover).toBe('bench')
    s.end()
    expect(useRailLineupDragStore.getState()).toMatchObject({ drag: null, hover: null })
  })

  it('the lineup registers the one drop handler and can withdraw it', () => {
    const handler = vi.fn()
    useRailLineupDragStore.getState().register(handler)
    useRailLineupDragStore.getState().onDrop?.(drag, 'bench')
    expect(handler).toHaveBeenCalledWith(drag, 'bench')
    useRailLineupDragStore.getState().register(null)
    expect(useRailLineupDragStore.getState().onDrop).toBeNull()
  })

  it('no document (server render) → no target, never a throw', () => {
    expect(railDropTargetAt(10, 10)).toBeNull()
  })
})
