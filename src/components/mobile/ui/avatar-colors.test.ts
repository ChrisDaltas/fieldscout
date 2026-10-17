import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { leagueAvClass } from './avatar-colors'

const ROOT = path.resolve(__dirname, '../../../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('league tiles — one rule for the letters (ruling #38, 2026-10-15)', () => {
  it('each fill carries its letter colour: white, dark on the gold tile', () => {
    expect([0, 1, 2, 3].map(leagueAvClass)).toEqual([
      'bg-m-ink text-white',
      'bg-pos-wr text-white',
      'bg-pos-rb text-white',
      'bg-pos-te text-ink',
    ])
    // Cycled by the league's place in your list.
    expect(leagueAvClass(7)).toBe(leagueAvClass(3))
  })

  it('no screen overrides the letters next to a league tile (Home used to force white on gold)', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(path.join(ROOT, 'src'))) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!line.includes('leagueAvClass(') || line.includes('export function leagueAvClass')) return
        // The tile's own class list: this line — and, when the call is an
        // argument on its own line of a multi-line `cn(…)`, its neighbours.
        const own = line.trim().startsWith('leagueAvClass(')
        const near = own ? [lines[i - 1] ?? '', line, lines[i + 1] ?? ''].join('\n') : line
        if (/['"\s]text-(white|ink|black|m-t\d)['"\s]/.test(near)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
