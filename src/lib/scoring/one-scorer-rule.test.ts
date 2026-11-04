import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * One scorer (K0): every fantasy-point number outside a league comes from
 * `src/lib/players/preset-scoring.ts`, and the legacy calculator stays gone.
 * Ruled by Chris 2026-10-29: "ESPN's table (K0), fixed once in the shared
 * scoring before grading, so the stats pages, the rankings player list and the
 * grades all match one platform."
 *
 * A source pin in the style of `system-message-rule.test.ts`. Comments are
 * stripped, tests are skipped, and the counts are exact on purpose: a new
 * caller fails, and so does a removed one, so an entry can't go stale.
 *
 * `presetTotalsPoints` is the only function that scores a summed line, and it is
 * offense only: a K or D/ST can't be tiered from a sum. A new caller here is a
 * question, not a formality.
 */

const ROOT = process.cwd()
const ROOTS = ['src', 'scripts']

const LEGACY_CALCULATOR = /\bcalculateFantasyPoints\b/g
const LEGACY_RULES = /\b(?:PPR|HALF_PPR|QUARTER_PPR|STANDARD|TE_PREMIUM)_SCORING\b/g
/** `x * rules.y`, `x * rules[y]`, `rules.y * x`: a hand-written dot product. */
const HAND_DOT_PRODUCT = /\*\s*rules(?:\.|\[)|\brules(?:\.[a-z_]+|\[[^\]]+\])\s*\*(?!\s*\/)/g
const TOTALS_SCORER_CALL = /\bpresetTotalsPoints\(/g
const SYSTEM_RULES_CALL = /\bsystemRules\(/g

/** Where the settings editor's preset values are defined. Nothing else names them. */
const LEGACY_RULES_HOME: Record<string, { count: number; why: string }> = {
  'src/lib/scoring/default.ts': { count: 17, why: 'the values the settings editor shows, not a scorer' },
}

const HAND_DOT_PRODUCTS: Record<string, { count: number; why: string }> = {}

const TOTALS_SCORER_CALLERS: Record<string, { count: number; why: string }> = {
  'src/app/api/players/[id]/stats/route.ts': { count: 2, why: 'offense pace and projected stat lines, each stat paced before scoring' },
  'src/hooks/use-mobile-rankings-sources.ts': { count: 1, why: 'the 0.25 PPR pool, offense only, from the builder route season totals' },
  'src/lib/players/preset-scoring.ts': { count: 1, why: 'the definition' },
}

const SYSTEM_RULES_CALLERS: Record<string, { count: number; why: string }> = {
  'src/app/api/players/[id]/core-stats/route.ts': { count: 1, why: 'the cached pool standings, with presetLines' },
  'src/lib/players/core-stats-service.ts': { count: 1, why: 'the player page in preset mode, with presetLines' },
  'src/lib/players/preset-scoring.ts': { count: 3, why: 'the definition and its two scorers' },
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') out.push(...sourceFiles(full))
    } else if (/\.(tsx?|mjs|cjs|js)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

/** A block comment opens with whitespace, `*` or `!` after `/*`, as a real one
 *  always does, so a glob's `/*.{ts,tsx}` opens nothing. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s*!][\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

const files = ROOTS.flatMap((root) => sourceFiles(path.join(ROOT, root))).map((file) => ({
  path: rel(file),
  source: stripComments(readFileSync(file, 'utf8')),
}))

function hitsPerFile(pattern: RegExp): Record<string, number> {
  const out: Record<string, number> = {}
  for (const file of files) {
    const count = file.source.match(pattern)?.length ?? 0
    if (count > 0) out[file.path] = count
  }
  return out
}

const counts = (allow: Record<string, { count: number }>) => Object.fromEntries(Object.entries(allow).map(([file, { count }]) => [file, count]))

describe('one scorer', () => {
  it('walks the real tree (a broken walk would pass everything below)', () => {
    expect(files.length).toBeGreaterThan(1000)
    expect(files.some((file) => file.path === 'src/lib/players/preset-scoring.ts')).toBe(true)
    expect(files.some((file) => file.path.startsWith('scripts/'))).toBe(true)
    expect(files.some((file) => file.path.endsWith('.test.ts'))).toBe(false)
  })

  it('the legacy calculator appears nowhere', () => {
    expect(hitsPerFile(LEGACY_CALCULATOR)).toEqual({})
  })

  it('the *_SCORING constants appear only in default.ts', () => {
    expect(hitsPerFile(LEGACY_RULES)).toEqual(counts(LEGACY_RULES_HOME))
  })

  it('no hand-written dot product over a rules object', () => {
    expect(hitsPerFile(HAND_DOT_PRODUCT)).toEqual(counts(HAND_DOT_PRODUCTS))
  })

  it('the summed-line scorer has exactly these callers', () => {
    expect(hitsPerFile(TOTALS_SCORER_CALL)).toEqual(counts(TOTALS_SCORER_CALLERS))
  })

  it('the preset rules are read only by the scorer and the player page pool', () => {
    expect(hitsPerFile(SYSTEM_RULES_CALL)).toEqual(counts(SYSTEM_RULES_CALLERS))
  })

  it('the patterns really catch what they name (positive controls)', () => {
    const hits = (pattern: RegExp, text: string) => text.match(pattern)?.length ?? 0
    expect(hits(LEGACY_CALCULATOR, 'calculateFantasyPoints(row, rules)')).toBe(1)
    expect(hits(LEGACY_RULES, 'import { PPR_SCORING, HALF_PPR_SCORING } from x')).toBe(2)
    expect(hits(LEGACY_RULES, 'MY_STANDARD_SCORING_THING')).toBe(0)
    expect(hits(HAND_DOT_PRODUCT, "pts += get('pass_yards') * rules.pass_yards")).toBe(1)
    expect(hits(HAND_DOT_PRODUCT, "total += stat * rules['pass_tds']")).toBe(1)
    expect(hits(HAND_DOT_PRODUCT, 'const v = rules.pass_tds * stat')).toBe(1)
    expect(hits(TOTALS_SCORER_CALL, "presetTotalsPoints('ppr', 'WR', totals)")).toBe(1)
    expect(hits(SYSTEM_RULES_CALL, "systemRules('ppr')")).toBe(1)
  })

  it('comments do not count, and a glob does not open one', () => {
    expect(stripComments('/** calculateFantasyPoints */ const a = 1')).not.toContain('calculateFantasyPoints')
    expect(stripComments('// calculateFantasyPoints\nconst a = 1')).not.toContain('calculateFantasyPoints')
    expect(stripComments("const glob = 'src/*.ts'; calculateFantasyPoints()")).toContain('calculateFantasyPoints')
  })
})

/** Modules a file reaches at runtime (`import type` carries no code). */
function runtimeImports(file: string): string[] {
  const source = stripComments(readFileSync(path.join(ROOT, file), 'utf8'))
  const specifiers = [...source.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1] as string)
  return specifiers.flatMap((specifier) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return [specifier]
    const base = specifier.startsWith('@/') ? path.join('src', specifier.slice(2)) : path.join(path.dirname(file), specifier)
    const found = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')].find((candidate) => {
      try {
        return statSync(path.join(ROOT, candidate)).isFile()
      } catch {
        return false
      }
    })
    if (!found) throw new Error(`${file}: can't resolve ${specifier}`)
    return [found.split(path.sep).join('/')]
  })
}

describe('the scorer stays safe to import in the browser', () => {
  const graph = new Set<string>()
  const walk = (file: string) => {
    if (graph.has(file)) return
    graph.add(file)
    if (file.startsWith('src/')) runtimeImports(file).forEach(walk)
  }
  walk('src/lib/players/preset-scoring.ts')

  it('reaches the engine', () => {
    expect(graph.has('src/lib/leagues/scoring/score-week-worker.ts')).toBe(true)
    expect(graph.has('src/lib/leagues/scoring/calculator.ts')).toBe(true)
  })

  it('never reaches zod, the Sleeper provider or process.env (client hooks load this)', () => {
    expect(graph.has('zod')).toBe(false)
    expect(graph.has('src/lib/leagues/scoring/validate-rules-doc.ts')).toBe(false)
    expect([...graph].filter((file) => file.includes('sleeper'))).toEqual([])
    const local = [...graph].filter((file) => file.startsWith('src/'))
    expect(local.filter((file) => stripComments(readFileSync(path.join(ROOT, file), 'utf8')).includes('process.env'))).toEqual([])
  })
})
