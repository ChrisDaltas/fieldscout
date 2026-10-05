import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * D494 (Chris 2026-10-05): every player click opens the mini card first —
 * these two surfaces used to open the modal directly (R1529, R1530).
 * Source pins, comment-stripped, because `.tsx` cannot be parsed here.
 */
const code = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

describe('player clicks route through openPlayer (D494)', () => {
  it('R1529: the players search dropdown — plain click → openPlayer, modified click keeps the deep link', () => {
    const src = code('src/components/players/players-spreadsheet.tsx')
    expect(src).not.toContain('player-modal-store')
    expect(src).not.toContain('openPlayerView')
    expect(src).toMatch(
      /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.button !== 0\) return\s*\n\s*e\.preventDefault\(\)\s*\n\s*openPlayer\(p\.id\)/,
    )
    expect(src).toContain('href={playerPageHref(p.id)}')
  })

  it('R1530: the command palette pick → openPlayer after the palette closes (rAF focus handoff)', () => {
    const src = code('src/components/shared/command-palette.tsx')
    expect(src).not.toContain('player-modal-store')
    expect(src).toContain("import { openPlayer } from '@/hooks/use-open-player'")
    expect(src).toMatch(/setOpen\(false\)\s*\n\s*requestAnimationFrame\(\(\) => openPlayer\(player\.id\)\)/)
  })
})
