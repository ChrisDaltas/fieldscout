import { describe, expect, it } from 'vitest'

import {
  DOCK_TABS,
  dockPanelId,
  dockReducer,
  dockTabButtonId,
  focusReturnTarget,
  openPanelIds,
  type DockAction,
  type DockState,
  type DockTabId,
} from './draft-dock-ops'

/**
 * Golden pins for the dock's pure state machine (spec §16.4's dock
 * paragraph; tasks-DR DR.5, D150/D151). Every expectation is a stored
 * literal (the falsifiability floor): the tab set, every transition, the
 * single-open invariant enumerated over the whole state × action space,
 * and the focus-return assignment.
 */

const ALL_TABS: readonly DockTabId[] = ['players', 'queue', 'roster', 'lists', 'chat']
const ALL_STATES: readonly DockState[] = [null, ...ALL_TABS]

describe('the tab catalog (spec §16.4: five panels, one dock; DR.5 item 6 labels)', () => {
  it('is exactly the five shipped panels, in strip order, with the SHIPPED labels', () => {
    // D140's rename landed in L.C3.1: the tab ID stays `queue` (schema/API/
    // internal names untouched — D140's ruled scope) and the LABEL is the
    // product's word. Both halves are pinned here, so a future half-rename
    // (label without id, or id without label) fails this golden.
    expect(DOCK_TABS).toEqual([
      { id: 'players', label: 'Players' },
      { id: 'queue', label: 'Targets' },
      { id: 'roster', label: 'Roster' },
      { id: 'lists', label: 'Lists' },
      { id: 'chat', label: 'Chat' },
    ])
  })
})

describe('transitions (D150 verbatim)', () => {
  it('a tab opens from closed', () => {
    expect(dockReducer(null, { type: 'toggle', tab: 'players' })).toBe('players')
    expect(dockReducer(null, { type: 'toggle', tab: 'chat' })).toBe('chat')
  })

  it('the ACTIVE tab toggles closed', () => {
    for (const tab of ALL_TABS) {
      expect(dockReducer(tab, { type: 'toggle', tab })).toBeNull()
    }
  })

  it('another tab SWITCHES — still exactly one open, never two', () => {
    expect(dockReducer('players', { type: 'toggle', tab: 'queue' })).toBe('queue')
    expect(dockReducer('queue', { type: 'toggle', tab: 'lists' })).toBe('lists')
    expect(dockReducer('lists', { type: 'toggle', tab: 'chat' })).toBe('chat')
    expect(dockReducer('chat', { type: 'toggle', tab: 'roster' })).toBe('roster')
  })

  it('Escape closes from every state (and is a no-op when already closed)', () => {
    for (const state of ALL_STATES) {
      expect(dockReducer(state, { type: 'escape' })).toBeNull()
    }
  })

  it('close closes from every state', () => {
    for (const state of ALL_STATES) {
      expect(dockReducer(state, { type: 'close' })).toBeNull()
    }
  })
})

describe('the single-open invariant (D150: "two open panels is a rail again")', () => {
  it('holds over the ENTIRE state × action space — never more than one open', () => {
    const actions: DockAction[] = [
      ...ALL_TABS.map((tab): DockAction => ({ type: 'toggle', tab })),
      { type: 'close' },
      { type: 'escape' },
    ]
    let transitions = 0
    for (const state of ALL_STATES) {
      for (const action of actions) {
        const next = dockReducer(state, action)
        expect(openPanelIds(next).length).toBeLessThanOrEqual(1)
        transitions += 1
      }
    }
    // 6 states × 7 actions — the whole space, enumerated, not sampled.
    expect(transitions).toBe(42)
  })

  it('openPanelIds is [] closed and exactly [tab] open', () => {
    expect(openPanelIds(null)).toEqual([])
    for (const tab of ALL_TABS) {
      expect(openPanelIds(tab)).toEqual([tab])
    }
  })
})

describe('focus return (D150: back to the tab button on close)', () => {
  it('a close returns focus to the tab that WAS open', () => {
    expect(focusReturnTarget('players', null)).toBe('players')
    expect(focusReturnTarget('chat', null)).toBe('chat')
  })

  it('an open or a switch focuses the panel instead — no button target', () => {
    expect(focusReturnTarget(null, 'players')).toBeNull()
    expect(focusReturnTarget('players', 'queue')).toBeNull()
  })

  it('closed → closed focuses nothing', () => {
    expect(focusReturnTarget(null, null)).toBeNull()
  })
})

describe('the aria wiring ids', () => {
  it('are stable, per-tab literals', () => {
    expect(dockTabButtonId('players')).toBe('draft-dock-tab-players')
    expect(dockPanelId('players')).toBe('draft-dock-panel-players')
    expect(dockTabButtonId('chat')).toBe('draft-dock-tab-chat')
    expect(dockPanelId('chat')).toBe('draft-dock-panel-chat')
  })
})
