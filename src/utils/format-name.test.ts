import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { shortPlayerName } from './format-name'

describe('shortPlayerName — the phone’s one short-name rule (gap list §4 item 17)', () => {
  it('first initial, a period, then every later word', () => {
    expect(shortPlayerName('Saquon Barkley', 'RB')).toBe('S. Barkley')
    expect(shortPlayerName("Ja'Marr Chase", 'WR')).toBe('J. Chase')
    expect(shortPlayerName('Amon-Ra St. Brown', 'WR')).toBe('A. St. Brown')
    expect(shortPlayerName('Michael Penix Jr.', 'QB')).toBe('M. Penix Jr.')
    expect(shortPlayerName('Efton Chism III', 'WR')).toBe('E. Chism III')
    expect(shortPlayerName('CeeDee Lamb', 'WR')).toBe('C. Lamb')
    expect(shortPlayerName('  Josh   Allen ')).toBe('J. Allen')
  })

  it('keeps a first name that is already initials — A.J., DK and CJ', () => {
    expect(shortPlayerName('A.J. Brown', 'WR')).toBe('A.J. Brown')
    expect(shortPlayerName('DK Metcalf', 'WR')).toBe('DK Metcalf')
    expect(shortPlayerName('CJ Stroud', 'QB')).toBe('CJ Stroud')
    expect(shortPlayerName('C.J. Stroud', 'QB')).toBe('C.J. Stroud')
    expect(shortPlayerName('T.J. Hockenson', 'TE')).toBe('T.J. Hockenson')
    expect(shortPlayerName('J.J. McCarthy', 'QB')).toBe('J.J. McCarthy')
    expect(shortPlayerName('AJ Dillon', 'RB')).toBe('AJ Dillon')
  })

  it('A.J. Brown and Amon-Ra St. Brown no longer read alike', () => {
    expect(shortPlayerName('A.J. Brown', 'WR')).not.toBe('A. Brown')
    expect(shortPlayerName('A.J. Brown', 'WR')).not.toBe(shortPlayerName('Amon-Ra St. Brown', 'WR'))
  })

  it('leaves team defenses and one-word names as written', () => {
    expect(shortPlayerName('Broncos D/ST')).toBe('Broncos D/ST')
    expect(shortPlayerName('Denver Broncos', 'DEF')).toBe('Denver Broncos')
    expect(shortPlayerName('Pittsburgh Steelers', 'DST')).toBe('Pittsburgh Steelers')
    expect(shortPlayerName('New England Patriots', 'def')).toBe('New England Patriots')
    expect(shortPlayerName('Cher', 'QB')).toBe('Cher')
    expect(shortPlayerName('   ')).toBe('')
  })
})

/**
 * One rule, one home: no file in the phone tree builds its own "F. Last"
 * again (there were eight copies, and they disagreed about A.J. and DK).
 * Same source-pin idiom as `src/components/ui/elevation-rule.test.ts`.
 */
describe('the phone shortens player names in one place', () => {
  const MOBILE = path.join(process.cwd(), 'src', 'components', 'mobile')

  function sources(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...sources(full))
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }

  it('no mobile file defines its own short-name helper', () => {
    const offenders: string[] = []
    for (const file of sources(MOBILE)) {
      const src = readFileSync(file, 'utf8')
      // `${first[0]}. ${rest…}` — an initial, a period, then the rest of the name.
      if (/\$\{[^}]*\[0\]!?\}\. \$\{/.test(src) || /function shortName\b/.test(src)) {
        offenders.push(path.relative(process.cwd(), file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('the draft room’s phone-only “Recent picks” ticker uses the same rule', () => {
    // The room has no phone version: below `lg` it shows this ticker instead
    // of the board, so a phone draft reads names through it.
    const room = readFileSync(
      path.join(process.cwd(), 'src', 'components', 'draft', 'draft-room.tsx'),
      'utf8',
    )
    const start = room.indexOf('aria-label="Recent picks"')
    expect(start).toBeGreaterThan(-1)
    const ticker = room.slice(start, room.indexOf('No picks yet.', start))
    expect(ticker).toContain('shortPlayerName(player.full_name, player.position)')
    expect(ticker).not.toContain('abbreviateName(')
  })
})
