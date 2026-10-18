import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import postcss, { type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

import { tierChipClass } from './tier-colors'

import tailwindConfig from '../../../../tailwind.config'

/**
 * Green and red words brighten in phone dark mode (gap list §4 item 6). The
 * phone used desktop's fixed `positive-strong` / `negative-strong` (and
 * `confirm`) as text, so a gain, a "Live", an "Open" start/sit row or the
 * Lists video-link error stayed the light page's shade on #121212. The
 * README gives the dark values: success text #07A852 → #1ED760, danger
 * #FF0028 → text #FF6B6B.
 *
 * The fix is the phone's own themed pair, `m-green` / `m-red` (globals.css,
 * tailwind.config.ts): the same light values, the README's dark ones. Pins:
 *  1. the tokens carry exactly those values in every palette block;
 *  2. no phone component writes a fixed green/red as text or a glyph colour;
 *  3. the Tier 3 label (the third item named) is a chip whose fill carries
 *     its own text, so it reads the same in both themes.
 */

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

/** `7 168 82` → `#07A852`. */
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
      const s = Number(c) / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const colors = (tailwindConfig.theme?.extend as { colors: Record<string, Record<string, unknown>> }).colors

describe('the phone’s bright green / red text tokens', () => {
  it('light = the handoff’s #07A852 / #FF0028 — desktop’s positive-strong / negative-strong', () => {
    expect(hexOf(varIn(LIGHT, '--m-green')!)).toBe('#07A852')
    expect(hexOf(varIn(LIGHT, '--m-red')!)).toBe('#FF0028')
    expect(hexOf(varIn(LIGHT, '--m-green')!)).toBe(String((colors.positive as { strong: string }).strong).toUpperCase())
    expect(hexOf(varIn(LIGHT, '--m-red')!)).toBe(String((colors.negative as { strong: string }).strong).toUpperCase())
  })

  it('dark = the README’s #1ED760 / #FF6B6B (the same as the dark tint-text pair)', () => {
    expect(hexOf(varIn(DARK, '--m-green')!)).toBe('#1ED760')
    expect(hexOf(varIn(DARK, '--m-red')!)).toBe('#FF6B6B')
    expect(varIn(DARK, '--m-green')).toBe(varIn(DARK, '--m-tg'))
    expect(varIn(DARK, '--m-red')).toBe(varIn(DARK, '--m-tr'))
  })

  it('dark values read on the dark page and its cards (AA, 4.5:1)', () => {
    for (const token of ['--m-green', '--m-red']) {
      for (const surface of ['--m-b0', '--m-b1']) {
        expect(contrast(varIn(DARK, token)!, varIn(DARK, surface)!), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('a page with no phone screen yet keeps the light values in dark mode', () => {
    expect(varIn(LIGHT_RESET, '--m-green')).toBe(varIn(LIGHT, '--m-green'))
    expect(varIn(LIGHT_RESET, '--m-red')).toBe(varIn(LIGHT, '--m-red'))
  })

  it('Tailwind maps text-m-green / text-m-red onto the variables', () => {
    expect(colors.m!.green).toBe('rgb(var(--m-green) / <alpha-value>)')
    expect(colors.m!.red).toBe('rgb(var(--m-red) / <alpha-value>)')
  })
})

// ---------------------------------------------------------------------------
// No fixed green / red text on the phone
// ---------------------------------------------------------------------------

const MOBILE = path.join(ROOT, 'src/components/mobile')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * A fixed green or red used as a text or glyph colour, any variant prefix.
 * Fills (`bg-positive-strong` avatars, `bg-confirm` buttons, the small red
 * dots) are not text and stay fixed — the bright red's fill rule lives in
 * `ui/system-message-rule.test.ts`.
 */
const FIXED_TEXT =
  /(?<![\w-])(?:text|fill|stroke|decoration|caret|placeholder)-(?:positive-strong|negative-strong|confirm|destructive|\[#(?:07A852|FF0028|07B85A)\])(?![\w-])/gi

/** The source with comments blanked (same length, so line numbers hold). */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, (m, lead: string) => lead + ' '.repeat(m.length - lead.length))
}

const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length

describe('phone components use the themed pair for green and red words', () => {
  const files = sourceFiles(MOBILE)

  it('finds the phone components', () => {
    expect(files.length).toBeGreaterThan(150)
    expect(files.map((f) => path.relative(ROOT, f))).toContain('src/components/mobile/lists/list-details-screen.tsx')
  })

  it('the pattern sees every spelling (self-check)', () => {
    const caught = [
      "'text-positive-strong'",
      'className="font-semibold text-negative-strong"',
      "up ? 'text-confirm' : 'x'",
      "'disabled:text-negative-strong'",
      "'fill-positive-strong'",
      "'text-[#FF0028]'",
    ]
    for (const s of caught) expect(s.match(FIXED_TEXT), s).toHaveLength(1)
    const allowed = ["'text-m-green'", "'text-m-red'", "'bg-positive-strong'", "'bg-confirm text-white'", "'bg-m-gr text-m-tr'", "'text-m-tg'"]
    for (const s of allowed) expect(s.match(FIXED_TEXT), s).toBeNull()
    expect(withoutComments('// text-negative-strong\nconst a = 1').match(FIXED_TEXT)).toBeNull()
    expect(withoutComments('/* text-confirm */ const a = 1').match(FIXED_TEXT)).toBeNull()
  })

  for (const file of files) {
    const source = withoutComments(readFileSync(file, 'utf8'))
    const hits = [...source.matchAll(FIXED_TEXT)].map((m) => `line ${lineOf(source, m.index)}: ${m[0]}`)
    if (hits.length === 0) continue
    it(`${path.relative(ROOT, file)} writes no fixed green/red text`, () => {
      expect(
        hits,
        'A fixed green/red as text stays the light page’s shade in phone dark mode. Use text-m-green / ' +
          'text-m-red (or text-m-tg / text-m-tr on their tints).',
      ).toEqual([])
    })
  }
})

// ---------------------------------------------------------------------------
// The named spots
// ---------------------------------------------------------------------------

describe('the three places the gap list named', () => {
  const read = (rel: string) => readFileSync(path.join(MOBILE, rel), 'utf8')

  it('Profile › Start/Sit: an open question’s line is the themed green', () => {
    expect(read('profile/mobile-profile.tsx')).toContain("subClassName={ssIsOpen(q, now) ? 'text-m-green' : 'text-m-t3'}")
  })

  it('Lists › Add video: the bad-link line is the themed red', () => {
    expect(read('lists/list-details-screen.tsx')).toMatch(/text-m-red">\{ADD_VIDEO_PROBLEM\[linkProblem\]\}/)
  })

  it('Tier 3: a chip whose fixed fill carries its own ink text — no page-themed colour to miss', () => {
    const chip = tierChipClass(2)
    expect(chip).toContain('bg-tier-3')
    expect(chip).toContain('text-ink')
    expect(chip).not.toMatch(/text-m-|positive-strong/)
  })
})
