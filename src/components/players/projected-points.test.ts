import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import postcss, { type Declaration, type Rule } from 'postcss'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlayerRow } from './player-row'
import { M_PROJ_TEXT, PROJ_TEXT, SEASON_PROJ_LABEL } from './projected-points'

import tailwindConfig from '../../../tailwind.config'

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

// ---------------------------------------------------------------------------
// The phone (gap list §4 item 15)
// ---------------------------------------------------------------------------

/**
 * The phone layout has a dark mode, so its projections take the themed
 * `m-proj` token through `M_PROJ_TEXT`: D497's #0060C0 in light, the README's
 * dark blue text #6FB5FF in dark (globals.css).
 */
const PHONE_SURFACES = [
  'src/components/mobile/community/community-detail.tsx', // Community list detail: each player's projection
]

const ROOT = process.cwd()
const css = postcss.parse(readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8'))
const LIGHT = ':root'
const DARK = "html[data-theme='dark']"
/** A page with no phone screen yet stays light in phone dark mode. */
const LIGHT_RESET = "html[data-theme='dark'] main[data-app-main]:not(:has([data-by-layout]))"

/** `--prop`'s value inside the rule whose selector is exactly `selector`. */
function varIn(selector: string, prop: string): string | undefined {
  let value: string | undefined
  css.walkDecls(prop, (d: Declaration) => {
    if ((d.parent as Rule).selector === selector) value = d.value
  })
  return value
}

/** `0 96 192` → `#0060C0`. */
const hexOf = (channels: string) =>
  `#${channels
    .trim()
    .split(/\s+/)
    .map((c) => Number(c).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase()

/** WCAG relative luminance of a `r g b` channel triple. */
function luminance(channels: string): number {
  const [r, g, b] = channels
    .trim()
    .split(/\s+/)
    .map((c) => {
      const v = Number(c) / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const colors = (tailwindConfig.theme?.extend as { colors: Record<string, Record<string, unknown>> }).colors

describe('projected points are dark blue on the phone too, one mechanism (gap list §4 item 15)', () => {
  it('M_PROJ_TEXT is the phone’s themed m-proj token', () => {
    expect(M_PROJ_TEXT).toBe('text-m-proj')
    expect(colors.m!.proj).toBe('rgb(var(--m-proj) / <alpha-value>)')
  })

  it('light = D497’s dark blue, desktop’s fs-blue-deep (#0060C0)', () => {
    expect(hexOf(varIn(LIGHT, '--m-proj')!)).toBe('#0060C0')
    expect(hexOf(varIn(LIGHT, '--m-proj')!)).toBe(String((colors.fs!.blue as { deep: string }).deep).toUpperCase())
  })

  it('dark = the README’s dark blue text (#6FB5FF, the dark m-tb), readable on the page and its cards (AA)', () => {
    expect(hexOf(varIn(DARK, '--m-proj')!)).toBe('#6FB5FF')
    expect(varIn(DARK, '--m-proj')).toBe(varIn(DARK, '--m-tb'))
    for (const surface of ['--m-b0', '--m-b1']) {
      expect(contrast(varIn(DARK, '--m-proj')!, varIn(DARK, surface)!), surface).toBeGreaterThanOrEqual(4.5)
    }
    for (const surface of ['--m-b0', '--m-b1']) {
      expect(contrast(varIn(LIGHT, '--m-proj')!, varIn(LIGHT, surface)!), surface).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a page with no phone screen yet keeps the light value in dark mode', () => {
    expect(varIn(LIGHT_RESET, '--m-proj')).toBe(varIn(LIGHT, '--m-proj'))
  })

  it('every phone projected-points surface takes its colour from M_PROJ_TEXT', () => {
    for (const rel of PHONE_SURFACES) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src, rel).toMatch(/import \{[^}]*\bM_PROJ_TEXT\b[^}]*\} from '@\/components\/players\/projected-points'/)
      expect(src, rel).toMatch(/M_PROJ_TEXT\)/)
      // The desktop's fixed blue would stay dim in phone dark mode.
      expect(src, rel).not.toMatch(/\bPROJ_TEXT\b/)
    }
  })

  it('the phone’s colour class is never hand-written at a call site', () => {
    const offenders = walk(path.join(ROOT, 'src'))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => rel !== 'src/components/players/projected-points.ts')
      .filter((rel) => /text-m-proj(?![\w-])/.test(readFileSync(path.join(ROOT, rel), 'utf8')))
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// "Season proj" (gap list §3 #29)
// ---------------------------------------------------------------------------

/**
 * A season-long projection shown beside something weekly is named by ONE
 * label, so Community and phone Lists can't drift apart — and both change
 * together when weekly projections arrive.
 */
const SEASON_PROJ_SURFACES = [
  'src/components/mobile/community/community-detail.tsx', // Community list page: the players heading row
  'src/components/mobile/lists/lists-stats.ts', // phone Lists: the column beside Week N / Last 3 / Season, and its chip
]

describe('"Season proj" is one label (gap list §3 #29)', () => {
  it('reads "Season proj"', () => {
    expect(SEASON_PROJ_LABEL).toBe('Season proj')
  })

  it('every surface naming the season projection takes it from SEASON_PROJ_LABEL', () => {
    for (const rel of SEASON_PROJ_SURFACES) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8')
      expect(src, rel).toMatch(/import \{[^}]*\bSEASON_PROJ_LABEL\b[^}]*\} from '@\/components\/players\/projected-points'/)
    }
  })

  it('the words are never hand-written at a call site', () => {
    const offenders = walk(path.join(ROOT, 'src'))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => rel !== 'src/components/players/projected-points.ts')
      .filter((rel) => /['"`]Season proj['"`]/i.test(readFileSync(path.join(ROOT, rel), 'utf8')))
    expect(offenders).toEqual([])
  })
})
