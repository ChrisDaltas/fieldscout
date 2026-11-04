import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { STAT_KEYS } from '@/lib/leagues/stats/stat-keys'
import { PRESET_LINE_COLUMNS } from '@/lib/players/preset-scoring'

/**
 * One scorer (K0): every fantasy-point number outside a league comes from
 * `src/lib/players/preset-scoring.ts`, and the legacy calculator stays gone.
 * Ruled by Chris 2026-10-29: "ESPN's table (K0), fixed once in the shared
 * scoring before grading, so the stats pages, the rankings player list and the
 * grades all match one platform."
 *
 * A source pin in the style of `system-message-rule.test.ts`. Comments are
 * stripped, tests are skipped, and the lists are exact on purpose: a new hit
 * fails, and so does a removed one, so an entry can't go stale. Nothing is exempt
 * by directory, the engine included.
 *
 * A hand-written scorer is caught by what it multiplies, not by what it calls its
 * variables: a scoring stat beside a `*`, a read from a weights object beside a
 * `*`, a stat read by a computed key beside a `*`, or a walk over a weights
 * object. A hit that isn't a score goes on the list with its reason.
 *
 * `presetTotalsPoints` is the only function that scores a summed line, and it is
 * offense only: a K or D/ST can't be tiered from a sum. A new caller here is a
 * question, not a formality.
 */

const ROOT = process.cwd()
const ROOTS = ['src', 'scripts']

const LEGACY_CALCULATOR = /\bcalculateFantasyPoints\b/g
const LEGACY_RULES = /\b(?:PPR|HALF_PPR|QUARTER_PPR|STANDARD|TE_PREMIUM)_SCORING\b/g

const TIMES = String.raw`(?<![*/])\*(?![*/])=?`
/** Between a stat and the `*` after it: what can hold the stat (`')`, ` ?? 0)`,
 *  `, 0)`). No `:` or `=`, so a fixture's `pass_yards: 250 * scale` isn't a product of it. */
const NEAR_AFTER = String.raw`[^*;:=\n]{0,24}?`
/** Between a `*` and the stat after it: as above, and no `,` or `+`, so
 *  `pass_yards: 250 * scale, pass_tds: 2` isn't a product of `pass_tds` either. */
const NEAR_BEFORE = String.raw`[^*;:=,+\n]{0,24}?`
/** Every canonical key and every column a line is scored from. */
const STAT = [...new Set([...STAT_KEYS.map((def) => def.key), ...PRESET_LINE_COLUMNS])].join('|')
/** `s.receptions * 1`, `w * (s.receptions ?? 0)`, `get('fg_made') * 3`, `rules.rec_2pt * x`. */
const STAT_TIMES = new RegExp(String.raw`\b(?:${STAT})\b${NEAR_AFTER}\s*${TIMES}|${TIMES}${NEAR_BEFORE}\b(?:${STAT})\b`, 'g')
/** A read from anything named like a weights object, however deep (`args.rules.y`, `rules?.[k]`). */
const WEIGHTS = String.raw`(?:[\w$]+\??\.)*[\w$]*(?:rules|scoring|preset)[\w$]*\??\.?(?:\.|\[)`
/** `x * rules[key]`, `rules[key] * x`, `x * (args.scoring?.y ?? 0)`, whatever the key. */
const WEIGHT_TIMES = new RegExp(String.raw`${TIMES}\s*\(*\s*${WEIGHTS}|\b${WEIGHTS}[\w$'"\]\[.?]*\)?\s*${TIMES}`, 'gi')
/** `s[k] * w`, `(s[k] ?? 0) * w`, `w * s[k]`. A numeric index (`m[2]`) isn't a stat key. */
const COMPUTED_KEY = String.raw`\[\s*[A-Za-z_$][\w$]*\s*\]`
const COMPUTED_KEY_TIMES = new RegExp(
  String.raw`[\w$\]]${COMPUTED_KEY}\)?(?:\s*(?:\?\?|\|\|)\s*[\w.]+\)?)?\s*${TIMES}|${TIMES}\s*\(*\s*[\w$.?]+${COMPUTED_KEY}`,
  'g',
)
/** `Object.entries(rules).reduce(...)`, `for (const [k, w] of Object.entries(args.rules))`. */
const WEIGHTS_WALK = /\bObject\.(?:entries|keys|values)\(\s*(?:[\w$]+\??\.)*[\w$]*(?:rules|scoring|preset)[\w$]*/gi
/** The settings editor's values: a ready way back to a second scorer. */
const WEIGHT_SOURCES = /\b(?:SCORING_PRESETS|getScoringPreset|ScoringRules)\b/g
/** Identifiers, not calls, so `import { presetTotalsPoints as ptp }` counts. */
const TOTALS_SCORER = /\bpresetTotalsPoints\b/g
const SYSTEM_RULES = /\bsystemRules\b/g

/** Where the settings editor's preset values are defined. Nothing else names them. */
const LEGACY_RULES_HOME: Record<string, { count: number; why: string }> = {
  'src/lib/scoring/default.ts': { count: 17, why: 'the values the settings editor shows, not a scorer' },
}

/** Not one of these is a fantasy score. */
const STAT_TIMES_ALLOWED: Record<string, { count: number; why: string }> = {
  'src/components/mobile/league/game/game-ops.ts': { count: 1, why: 'a sort key for a kicker row in a game box, never shown' },
  'src/components/mobile/lists/lists-stats.ts': { count: 1, why: 'a completion percentage' },
  'src/components/mobile/players/players-ops.ts': { count: 2, why: 'completion and catch percentages' },
  'src/components/players/player-detail-panels.tsx': { count: 1, why: 'a completion percentage' },
  'src/lib/leagues/stats/synthetic/synthetic-stats-provider.ts': { count: 1, why: 'made-up catches for the dev feed, a share of its targets' },
  'src/lib/sync/usage.ts': { count: 1, why: 'a target share percentage' },
}

const WEIGHT_TIMES_ALLOWED: Record<string, { count: number; why: string }> = {
  'src/lib/leagues/sim/plan.ts': { count: 1, why: 'the sim planner picks a random template by index, `SEASON_SCORING_TEMPLATES.length`' },
}

const COMPUTED_KEY_TIMES_ALLOWED: Record<string, { count: number; why: string }> = {
  'src/components/landing/landing-data.ts': { count: 1, why: 'the made-up projection on the marketing page\'s sample row' },
}

const WEIGHTS_WALK_ALLOWED: Record<string, { count: number; why: string }> = {
  'src/components/leagues/scoring-template-picker-ops.ts': { count: 1, why: 'reads the key names to label the D/ST model, no values' },
  'src/lib/leagues/scoring/calculator.ts': { count: 2, why: 'the engine: the one real dot product and its corrupt-rules check' },
  'src/lib/leagues/scoring/rules-doc.ts': { count: 1, why: 'lists a tier family by key prefix, no values' },
}

const WEIGHT_SOURCE_FILES: Record<string, string> = {
  'src/app/app/(shell)/settings/scoring/page.tsx': 'the settings picker lists the presets by name',
  'src/components/lists/builder/list-builder.tsx': 'the list builder picker lists the presets by name',
  'src/components/mobile/settings/mobile-scoring-settings.tsx': 'the phone settings picker lists the presets by name',
  'src/hooks/use-scoring-editor.ts': 'the editor starts from a preset\'s values',
  'src/lib/scoring/default.ts': 'the definition',
  'src/lib/scoring/scoring-editor.ts': 'the editor groups and validates the values',
}

const TOTALS_SCORER_NAMED: Record<string, { count: number; why: string }> = {
  'src/app/api/players/[id]/stats/route.ts': { count: 3, why: 'the import, then offense pace and projected stat lines, each stat paced before scoring' },
  'src/hooks/use-mobile-rankings-sources.ts': { count: 2, why: 'the import, then the 0.25 PPR pool, offense only, from the builder route season totals' },
  'src/lib/players/preset-scoring.ts': { count: 1, why: 'the definition' },
}

const SYSTEM_RULES_NAMED: Record<string, { count: number; why: string }> = {
  'src/app/api/players/[id]/core-stats/route.ts': { count: 2, why: 'the import, then the cached pool standings, with presetLines' },
  'src/lib/players/core-stats-service.ts': { count: 3, why: 'the import, the re-export, then the player page in preset mode, with presetLines' },
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

  it('no scoring stat is multiplied outside these', () => {
    expect(hitsPerFile(STAT_TIMES)).toEqual(counts(STAT_TIMES_ALLOWED))
  })

  it('no read from a weights object is multiplied', () => {
    expect(hitsPerFile(WEIGHT_TIMES)).toEqual(counts(WEIGHT_TIMES_ALLOWED))
  })

  it('no stat read by a computed key is multiplied outside these', () => {
    expect(hitsPerFile(COMPUTED_KEY_TIMES)).toEqual(counts(COMPUTED_KEY_TIMES_ALLOWED))
  })

  it('a weights object is walked only by the engine and for its key names', () => {
    expect(hitsPerFile(WEIGHTS_WALK)).toEqual(counts(WEIGHTS_WALK_ALLOWED))
  })

  it('the settings values are named only by the settings editors', () => {
    expect(Object.keys(hitsPerFile(WEIGHT_SOURCES)).sort()).toEqual(Object.keys(WEIGHT_SOURCE_FILES).sort())
  })

  it('the summed-line scorer is named exactly here', () => {
    expect(hitsPerFile(TOTALS_SCORER)).toEqual(counts(TOTALS_SCORER_NAMED))
  })

  it('the preset rules are named only by the scorer and the player page pool', () => {
    expect(hitsPerFile(SYSTEM_RULES)).toEqual(counts(SYSTEM_RULES_NAMED))
  })

  describe('the patterns really catch what they name (positive controls)', () => {
    const hits = (pattern: RegExp, text: string) => text.match(pattern)?.length ?? 0
    const isHandScored = (text: string) => [STAT_TIMES, WEIGHT_TIMES, COMPUTED_KEY_TIMES, WEIGHTS_WALK].some((pattern) => hits(pattern, text) > 0)

    it('the legacy names', () => {
      expect(hits(LEGACY_CALCULATOR, 'calculateFantasyPoints(row, rules)')).toBe(1)
      expect(hits(LEGACY_RULES, 'import { PPR_SCORING, HALF_PPR_SCORING } from x')).toBe(2)
      expect(hits(LEGACY_RULES, 'MY_STANDARD_SCORING_THING')).toBe(0)
    })

    it.each([
      "pts += get('pass_yards') * rules.pass_yards",
      "total += stat * rules['pass_tds']",
      'const v = rules.pass_tds * stat',
      's.receptions * preset.ppr.receptions',
      's.receptions * scoring.receptions',
      's.receptions * args.rules.receptions',
      's.receptions * (rules?.receptions ?? 0)',
      'rules.rec_2pt * s.rec_2pt',
      's.receiving_yards * 0.1 + s.receptions * 1',
      "get('fg_made') * 3",
      "s['fg_made'] * 3",
      '(s.pass_tds ?? 0) * 4',
      'Number(s.pass_tds) * 4',
      'toNumber(s.pass_tds, 0) * 4',
      '4 * Number(s.pass_tds)',
      'total *= s.receptions',
      'x * rules[key]',
      'rules[key] * x',
      'x * rules?.[key]',
      'x * (args.scoring?.anything ?? 0)',
      'Object.entries(rules).reduce((sum, [k, w]) => sum + (s[k] ?? 0) * w, 0)',
      'for (const [k, w] of Object.entries(args.rules)) total += w',
      'Object.entries(presetWeights)',
      '(s[k] ?? 0) * w',
      's[k] * w',
      'w * s[k]',
    ])('a hand-written scorer: %s', (text) => {
      expect(isHandScored(text)).toBe(true)
    })

    it.each([
      'pass_yards: 250 * scale',
      'pass_yards: 250 * scale, pass_tds: 2 * scale, interceptions: 1',
      'Number(m[2]) * 60',
      'const a = 2 * 3',
      'width * height',
      "const glob = 'src/*.ts'",
      'Object.entries(styleWeights)',
    ])('not a scorer: %s', (text) => {
      expect(isHandScored(text)).toBe(false)
    })

    it('a name counts, not a call, so an alias can not hide', () => {
      expect(hits(TOTALS_SCORER, "presetTotalsPoints('ppr', 'WR', totals)")).toBe(1)
      expect(hits(TOTALS_SCORER, "import { presetTotalsPoints as ptp } from '@/lib/players/preset-scoring'")).toBe(1)
      expect(hits(SYSTEM_RULES, "systemRules('ppr')")).toBe(1)
      expect(hits(SYSTEM_RULES, 'const r = systemRules')).toBe(1)
      expect(hits(WEIGHT_SOURCES, 'import { SCORING_PRESETS, getScoringPreset, type ScoringRules } from x')).toBe(3)
    })
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
