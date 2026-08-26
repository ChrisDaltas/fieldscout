import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { stackInclude } from '../../vitest.shared'

/**
 * THE DATABASE WORKFLOW'S TRIGGER MUST MATCH THE FILES IT RUNS (R608; D271).
 *
 * `.github/workflows/db.yml`'s *Database-backed tests* step runs
 * `npm run test:stack`, whose file set is defined by ONE array —
 * `vitest.shared.ts`'s `stackInclude`. The job's `paths:` filter decides
 * whether that step runs at all. Those are two hand-kept lists describing the
 * same thing, and on 2026-08-26 they disagreed in BOTH directions at once:
 * the filter watched `supabase/**` only, so a PR editing a stack suite got no
 * database run, and the fix's first cut then PARAPHRASED `stackInclude` as
 * `src/lib/leagues/gate/**` — a directory holding only the M0 gate this job
 * never runs — leaving `m1-gate/m1-phase-a-journey.test.ts`, one of the 31
 * files it DOES run, unwatched. Over-trigger and under-trigger from a single
 * typo, and nothing could see it: a filter that never fires and a filter that
 * fires too often both look like silence.
 *
 * So this file makes the mirror an assertion. It runs in the UNIT lane (no
 * stack, no database) so it fires on every PR through `ci.yml`, including the
 * ones that never reach `db.yml` — which is the only place it could catch a
 * filter that has stopped matching.
 *
 * Deliberately zero dependencies: `node:fs` and a 12-line glob translator
 * whose supported shapes are themselves asserted (arm 4). `picomatch`,
 * `js-yaml` and `tinyglobby` all resolve here but none is a DECLARED
 * dependency of this project, and a pin that rests on a transitive dep is a
 * pin that a dependency bump can delete.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'db.yml')

/** The non-`src/` half of the filter: infra whose change can invalidate a
 *  replay or the lane's own scheduling. Enumerated so that ADDING a pattern
 *  is a deliberate conversation with this file rather than a silent widening
 *  of the expensive lane (the `src/**` that the workflow banner rules out). */
const INFRA_PATHS = [
  'supabase/**',
  '.github/workflows/db.yml',
  'vitest.shared.ts',
  'vitest.config.ts',
]

/** Every `paths:` list in the workflow, in file order. Deliberately textual:
 *  the file is ours, its shape is fixed, and arm 0 asserts we found exactly
 *  the two blocks we expect — a restructure REDS here instead of silently
 *  matching nothing (the CLAUDE.md "nothing happened means it worked" trap
 *  is exactly what a YAML query returning `[]` would be). */
function pathsBlocks(source: string): string[][] {
  const blocks: string[][] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*paths:\s*$/.test(lines[i]!)) continue
    const entries: string[] = []
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!
      if (/^\s*#/.test(line)) continue
      const match = /^\s*-\s*'([^']+)'\s*$/.exec(line)
      if (match === null) break
      entries.push(match[1]!)
    }
    blocks.push(entries)
  }
  return blocks
}

/** Minimal glob → RegExp for the shapes `stackInclude` uses. Arm 4 asserts
 *  no other shape is present, so this never has to guess. */
function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('/')
    .map((segment) => {
      if (segment === '**') return '(?:.*)'
      return segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
    })
    .join('/')
    // `a/**/b` must also match `a/b` — the zero-directory case.
    .replace(/\/\(\?:\.\*\)\//g, '/(?:.*/)?')
  return new RegExp(`^${source}$`)
}

function allTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) allTestFiles(full, acc)
    else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      acc.push(path.relative(REPO_ROOT, full))
    }
  }
  return acc
}

const source = readFileSync(WORKFLOW, 'utf8')
const blocks = pathsBlocks(source)

describe('db.yml triggers on the files its own step runs (R608)', () => {
  it('0. the workflow still has exactly two `paths:` filters, both non-empty', () => {
    expect(blocks, 'db.yml restructured — this pin cannot see its filters any more').toHaveLength(2)
    for (const block of blocks) expect(block.length).toBeGreaterThan(0)
  })

  it('1. UNDER-TRIGGER: every `stackInclude` pattern appears VERBATIM in both filters', () => {
    for (const [index, block] of blocks.entries()) {
      for (const pattern of stackInclude) {
        expect(
          block,
          `paths filter #${index + 1} does not carry stackInclude's '${pattern}' — a PR touching ` +
            'those files would get no database run at all',
        ).toContain(pattern)
      }
    }
  })

  it('2. OVER-TRIGGER: every non-infra pattern is a `stackInclude` pattern', () => {
    for (const [index, block] of blocks.entries()) {
      const claimedAsLane = block.filter((entry) => !INFRA_PATHS.includes(entry))
      expect(
        claimedAsLane.slice().sort(),
        `paths filter #${index + 1} watches a path the stack lane does not run — the R608 shape ` +
          '(it looked like coverage and was not, while the file it should have watched went ' +
          'unwatched in the same edit)',
      ).toEqual(stackInclude.slice().sort())
    }
  })

  it('3. the infra half is the enumerated set, and the two filters agree', () => {
    for (const [index, block] of blocks.entries()) {
      expect(
        block.filter((entry) => !stackInclude.includes(entry)).slice().sort(),
        `paths filter #${index + 1} gained a non-lane pattern — widening the expensive lane is a ` +
          'deliberate conversation with this file (the workflow banner rules out a broad src/**)',
      ).toEqual(INFRA_PATHS.slice().sort())
    }
    expect(blocks[0]!.slice().sort(), 'the two filters have drifted apart').toEqual(
      blocks[1]!.slice().sort(),
    )
  })

  it('4. the pattern shapes this pin can reason about are the ones in use', () => {
    for (const pattern of stackInclude) {
      expect(
        /^(\*\*\/)?[\w./*-]+$/.test(pattern),
        `stackInclude gained a glob shape '${pattern}' that globToRegExp above was never taught — ` +
          'extend it rather than deleting this arm',
      ).toBe(true)
    }
  })

  it('5. FILE LEVEL: every file the stack lane runs is matched by a filter pattern', () => {
    const stackRegexes = stackInclude.map(globToRegExp)
    const filterRegexes = blocks.map((block) => block.map(globToRegExp))
    const stackFiles = allTestFiles(path.join(REPO_ROOT, 'src')).filter((file) =>
      stackRegexes.some((re) => re.test(file)),
    )
    // The premise, asserted before the sweep (F94's lesson): an empty sweep
    // must never read as a pass.
    expect(
      stackFiles.length,
      'no stack-lane files found — the sweep is vacuous, not green',
    ).toBeGreaterThan(25)
    expect(
      stackFiles,
      'the m1-gate journey is the file R608 caught unwatched — it must stay in the swept set',
    ).toContain(path.join('src', 'lib', 'leagues', 'm1-gate', 'm1-phase-a-journey.test.ts'))
    for (const [index, regexes] of filterRegexes.entries()) {
      const unwatched = stackFiles.filter((file) => !regexes.some((re) => re.test(file)))
      expect(unwatched, `files run by the job but unwatched by paths filter #${index + 1}`).toEqual(
        [],
      )
    }
  })
})
