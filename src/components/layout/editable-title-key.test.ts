import { describe, expect, it } from 'vitest'

import { editableTitleKey } from './app-header'

// R1512 — Escape in the standard header's editable title restores the old value.
describe('editableTitleKey (R1512)', () => {
  it('Escape after typing closes and restores the starting value', () => {
    expect(editableTitleKey('Escape', 'My new nam', 'Sleepers')).toEqual({ close: true, restore: 'Sleepers' })
  })
  it('Escape with nothing changed just closes', () => {
    expect(editableTitleKey('Escape', 'Sleepers', 'Sleepers')).toEqual({ close: true })
  })
  it('Enter keeps the edit', () => {
    expect(editableTitleKey('Enter', 'My new name', 'Sleepers')).toEqual({ close: true })
  })
  it('other keys do nothing', () => {
    expect(editableTitleKey('a', 'x', 'y')).toEqual({ close: false })
  })
})
