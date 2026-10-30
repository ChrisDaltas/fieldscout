/**
 * "List created. Add players to share it." (plan C4, readiness F9): Community
 * shows only lists with players, so a public list saved empty says why it
 * won't appear there yet — only while Community is on, and never for a
 * private list.
 */
import { describe, expect, it } from 'vitest'

import { ADD_PLAYERS_TO_SHARE, emptyListShareHint } from './share-hint'

describe('emptyListShareHint', () => {
  it('a public list with no players, Community on: "Add players to share it."', () => {
    expect(ADD_PLAYERS_TO_SHARE).toBe('Add players to share it.')
    expect(emptyListShareHint({ players: 0, isPrivate: false }, true)).toBe(ADD_PLAYERS_TO_SHARE)
  })

  it('nothing to say once it has players, for a private list, or while Community is off', () => {
    expect(emptyListShareHint({ players: 1, isPrivate: false }, true)).toBeNull()
    expect(emptyListShareHint({ players: 0, isPrivate: true }, true)).toBeNull()
    expect(emptyListShareHint({ players: 0, isPrivate: false }, false)).toBeNull()
  })
})
