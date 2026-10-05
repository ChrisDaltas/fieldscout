import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * R1519 — the pop-out list window, pinned at the source (same idiom as
 * `side-by-side-columns.test.ts`: `.tsx` cannot be parsed under Next's
 * `jsx: "preserve"`, so assertions read the comment-stripped source).
 */
const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const WINDOW = 'src/components/lists/v2/list-window.tsx'

describe('list-window — a player name opens the player view modal (D491, D494)', () => {
  it('goes through the shared opener, never the floating card store', () => {
    const source = code(WINDOW)
    expect(source).toContain("import { openPlayer as openPlayerView } from '@/hooks/use-open-player'")
    expect(source).not.toContain('player-windows-store')
  })

  it('an owned list hands the modal its context, so it offers Remove', () => {
    const source = code(WINDOW)
    expect(source).toMatch(/openPlayerView\(\s*entry\.player_id,\s*undefined,/)
    expect(source).toContain('list?.is_owner ? { listId: list.id, listTitle: list.title } : null')
  })
})
