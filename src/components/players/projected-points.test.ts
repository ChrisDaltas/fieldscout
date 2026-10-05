import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlayerRow } from './player-row'
import { PROJ_TEXT } from './projected-points'

/**
 * Projected points are ALWAYS dark blue (`fs-blue-deep`), site-wide, through
 * ONE mechanism — `PROJ_TEXT` (D497, Chris 2026-10-05).
 */
const SURFACES = [
  'src/components/leagues/lineup-editor.tsx', // My Team: Proj column, projected total, matchup strip
  'src/components/leagues/matchup-view.tsx', // Matchup + box score: per-starter proj, proj total
  'src/components/leagues/players-page.tsx', // league Players: Proj column
  'src/components/players/players-spreadsheet.tsx', // Players research: Proj column
  'src/components/players/player-card.tsx', // player card (also the rail)
  'src/components/players/player-detail-page-view.tsx', // player modal/page: game-log Proj
  'src/components/players/player-detail-panels.tsx', // player modal/page: projected season card
  'src/components/players/player-row.tsx', // `projected` stat cells (draft best-available, list builder)
  'src/components/draft/draft-queue-card.tsx', // draft room targets
  'src/components/draft/auction-player-table.tsx', // draft room auction Proj, Pts/wk
  'src/components/lists/builder/player-sidebar.tsx',
  'src/components/big-board/board-row.tsx',
  'src/components/home/trending-players-card.tsx',
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p)
  }
  return out
}

describe('projected points are dark blue, one mechanism (D497)', () => {
  it('PROJ_TEXT is the existing fs-blue-deep token', () => {
    expect(PROJ_TEXT).toBe('text-fs-blue-deep')
  })

  it('every projected-points surface takes its colour from PROJ_TEXT', () => {
    for (const rel of SURFACES) {
      const src = readFileSync(path.join(process.cwd(), rel), 'utf8')
      expect(src, rel).toMatch(/import \{ PROJ_TEXT \} from '@\/components\/players\/projected-points'/)
      expect(src, rel).toMatch(/PROJ_TEXT\)|PROJ_TEXT :|&& PROJ_TEXT/)
    }
  })

  it('the colour class is never hand-written at a call site (landing v13 demos excepted)', () => {
    const root = process.cwd()
    const offenders = walk(path.join(root, 'src'))
      .map((f) => path.relative(root, f).split(path.sep).join('/'))
      .filter((rel) => rel !== 'src/components/players/projected-points.ts' && !rel.startsWith('src/components/landing/'))
      .filter((rel) => readFileSync(path.join(root, rel), 'utf8').includes('text-fs-blue-deep'))
    expect(offenders).toEqual([])
  })

  it('a projected stat cell renders blue; an actual one stays ink', () => {
    const html = renderToStaticMarkup(
      createElement(PlayerRow, {
        rank: 1,
        player: { id: 'p', full_name: 'A B', position: 'RB', team: 'SEA', headshot_url: null },
        stats: [
          { label: 'Proj', value: '12.0', projected: true },
          { label: '2025', value: '200' },
        ],
      } as unknown as Parameters<typeof PlayerRow>[0]),
    )
    expect(html).toMatch(/text-fs-blue-deep[^>]*>12\.0</)
    expect(html).toMatch(/text-ink[^>]*>200</)
  })
})
