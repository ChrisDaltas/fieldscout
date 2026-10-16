import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { removeMode } from './list-picker-sheet'

/**
 * "Remove from list" on the phone player profile (Chris, 2026-10-15: "any
 * normal user would expect a remove from list button, and if they hit that it
 * should work"). From a list the viewer owns it removes at once; from the list
 * editor — where edits are a draft that Update saves and Back discards (#16) —
 * it takes the player out of that draft.
 */
describe('Remove from list on the phone profile', () => {
  it('is offered only with a list, and follows the editor’s draft when it has one', () => {
    expect(removeMode(null)).toBe('none')
    expect(removeMode({ listId: 'l1', listTitle: 'Sleepers' })).toBe('now')
    expect(removeMode({ listId: 'l1', listTitle: 'Sleepers', removeFromDraft: () => undefined })).toBe('draft')
  })

  it('the list editor opens the profile with its draft remover', () => {
    const editor = readFileSync(path.resolve(process.cwd(), 'src/components/mobile/lists/list-editor.tsx'), 'utf8')
    expect(editor).toMatch(/openPlayerView\(playerId, null, \{[\s\S]*?removeFromDraft: \(id\) => edit\(\(current\) => removeFromDraft\(current, id\)\)/)
  })
})
