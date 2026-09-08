import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { stackInclude } from '../../vitest.shared'

/**
 * THE DATABASE WORKFLOW'S TRIGGER MUST MATCH THE FILES IT RUNS (R608; D271)
 * AND THE SOURCE THOSE FILES IMPORT (F290; D329).
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
 * THE THIRD DIRECTION (F290, 2026-09-08). Mirroring `stackInclude` pinned the
 * filter against the TEST FILES the job runs — but not against the MODULES
 * those files import, and there a source-only change walked straight past.
 * Measured on PR #274: `season-sweep-db.test.ts` imports `./season-runner`;
 * #274 changed `season-runner.ts`, `season-scenario.ts` and `sim-types.ts`,
 * touched no `*-db.test.ts`, and only the `CI` workflow ran. Arms 1-5 below
 * were all green on that PR, because the two lists they compare did agree.
 * Arm 6 walks the stack suites' TRANSITIVE IMPORT CLOSURE and requires every
 * module in it to be matched by the filter; arm 7 requires every source
 * pattern to be earning its place, so the widening cannot rot into the R608
 * shape (a pattern that looks like coverage over files this job never runs).
 *
 * This file runs in the UNIT lane (no stack, no database) so it fires on every
 * PR through `ci.yml`, including the ones that never reach `db.yml` — which is
 * the only place it could catch a filter that has stopped matching.
 *
 * Deliberately zero dependencies: `node:fs`, a 12-line glob translator whose
 * supported shapes are themselves asserted (arm 4), and a specifier scanner
 * that parses no TypeScript at all (see `REPO_SPECIFIER`). `picomatch`,
 * `js-yaml`, `tinyglobby` and `oxc-parser` all resolve here but none is a
 * DECLARED dependency of this project, and a pin that rests on a transitive
 * dep is a pin that a dependency bump can delete.
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

/** The SOURCE half (F290): the modules the stack suites import. Enumerated
 *  here for the same reason as `INFRA_PATHS` — arm 3 pins the workflow to
 *  exactly this list, arm 6 proves the list is SUFFICIENT (nothing reachable
 *  escapes it) and arm 7 proves it is not PADDED (nothing in it is dead).
 *  Derived from the measured closure, not from taste; the strays outside
 *  `src/lib/leagues/**` are each reached by a real import, and the three
 *  `src/components/draft` entries are named file-by-file so that the 26 React
 *  components and 36 unit-test files beside them stay out of the lane. */
const SOURCE_PATHS = [
  'src/lib/leagues/**',
  'src/lib/sync/**',
  'src/lib/supabase/**',
  'src/lib/lists/**',
  'src/lib/sports-data/**',
  'src/lib/email/**',
  'src/lib/nfl-teams.ts',
  'src/utils/**',
  'src/types/database.ts',
  'src/components/draft/auction-budget.ts',
  'src/components/draft/commish-auction-ops.ts',
  'src/components/draft/draft-order.ts',
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

/** Minimal glob → RegExp for the shapes `stackInclude` and `SOURCE_PATHS`
 *  use. Arm 4 asserts no other shape is present, so this never has to guess. */
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

// ---------------------------------------------------------------------------
// The import closure (arm 6). Everything below is deliberately small and
// dependency-free; its three limitations are stated, not silent.
// ---------------------------------------------------------------------------

type PathAlias = { prefix: string; targetDir: string }

/** The repo's own `@/*` → `./src/*` mapping, READ FROM `tsconfig.json` rather
 *  than hard-coded — a pin that hard-codes the alias stops describing the repo
 *  the day the alias moves. Arm 6 asserts the parse found at least one. */
function tsconfigAliases(): PathAlias[] {
  const parsed: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tsconfig.json'), 'utf8'))
  const compilerOptions =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { compilerOptions?: { paths?: unknown } }).compilerOptions
      : undefined
  const paths = compilerOptions?.paths
  if (typeof paths !== 'object' || paths === null) return []
  const aliases: PathAlias[] = []
  for (const [pattern, targets] of Object.entries(paths as Record<string, unknown>)) {
    if (!pattern.endsWith('/*') || !Array.isArray(targets)) continue
    const first: unknown = targets[0]
    if (typeof first !== 'string' || !first.endsWith('/*')) continue
    aliases.push({
      prefix: pattern.slice(0, -1), //            '@/*'    → '@/'
      targetDir: path.resolve(REPO_ROOT, first.slice(0, -2)), // './src/*' → <root>/src
    })
  }
  return aliases
}

const ALIASES = tsconfigAliases()

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Every quoted string in a file that LOOKS like a repo path — relative
 * (`./`, `../`) or aliased (`@/`, from tsconfig).
 *
 * LIMITATION 1, deliberate: this parses no TypeScript. It therefore catches
 * static imports (multi-line ones included — the shape a line-oriented import
 * regex silently misses, worth 15 of the 69 modules when both were measured),
 * `export … from`, dynamic `import()` and `vi.mock()` alike, at the cost of
 * also matching path-shaped strings that are not imports at all. That
 * over-capture is SAFE in this direction: a string resolving to no file is
 * dropped, and one that does resolve only makes the closure — and so this
 * pin's demand on the filter — LARGER, never smaller. Bare specifiers never
 * match, so `node_modules` and node builtins are excluded by construction.
 *
 * LIMITATION 2: a specifier COMPOSED at runtime (`import(`./${name}`)`) is
 * invisible to a textual scan. Nothing in today's closure does that; if that
 * changes, the module it loads must be added to `SOURCE_PATHS` by hand.
 */
const SPECIFIER_PREFIXES = [
  '\\.{1,2}/', // './' and '../'
  ...ALIASES.map((alias) => escapeRegExp(alias.prefix)),
]
// Built from a non-empty list on purpose: interpolating an EMPTY alias list
// straight into an alternation would leave an empty branch, and an empty
// branch matches every quoted string in the repo. Arm 6 reds on a missing
// alias anyway; this makes the red honest instead of a 200k-match sweep.
const REPO_SPECIFIER = new RegExp(
  `['"\`]((?:${SPECIFIER_PREFIXES.join('|')})[^'"\`\\n]*)['"\`]`,
  'g',
)

/** Suffixes tried in order; `''` is a specifier that already carries its
 *  extension. LIMITATION 3: this is node-ish resolution plus the tsconfig
 *  alias, not a full implementation of `moduleResolution: bundler`. It is
 *  enough for every specifier in today's closure (measured: zero unresolved),
 *  and an exotic one that resolves to nothing here is simply not swept. */
const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js',
]

/** Repo-relative path of the file a specifier names, or null when it names
 *  nothing in this repo. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  const alias = ALIASES.find((candidate) => specifier.startsWith(candidate.prefix))
  const base =
    alias === undefined
      ? path.resolve(path.dirname(path.join(REPO_ROOT, fromFile)), specifier)
      : path.join(alias.targetDir, specifier.slice(alias.prefix.length))
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const relative = path.relative(REPO_ROOT, candidate)
      // Outside the repo entirely — nothing a `paths:` filter can watch.
      return relative.startsWith('..') ? null : relative
    }
  }
  return null
}

/** Breadth of the seeds' transitive imports, minus the seeds themselves.
 *  Values are the file that first reached the key, so a red can NAME the
 *  chain instead of just the orphan. */
function importClosure(seeds: string[]): Map<string, string> {
  const seedSet = new Set(seeds)
  const reachedFrom = new Map<string, string>()
  const visited = new Set(seeds)
  const queue = [...seeds]
  while (queue.length > 0) {
    const file = queue.pop()!
    let source: string
    try {
      source = readFileSync(path.join(REPO_ROOT, file), 'utf8')
    } catch {
      continue
    }
    for (const match of source.matchAll(REPO_SPECIFIER)) {
      const resolved = resolveSpecifier(match[1]!, file)
      if (resolved === null) continue
      if (!seedSet.has(resolved) && !reachedFrom.has(resolved)) reachedFrom.set(resolved, file)
      if (!visited.has(resolved)) {
        visited.add(resolved)
        queue.push(resolved)
      }
    }
  }
  return reachedFrom
}

const source = readFileSync(WORKFLOW, 'utf8')
const blocks = pathsBlocks(source)

const stackRegexes = stackInclude.map(globToRegExp)
const stackFiles = allTestFiles(path.join(REPO_ROOT, 'src')).filter((file) =>
  stackRegexes.some((re) => re.test(file)),
)

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

  it('2. OVER-TRIGGER: every pattern that is neither infra nor source is a `stackInclude` pattern', () => {
    for (const [index, block] of blocks.entries()) {
      const claimedAsLane = block.filter(
        (entry) => !INFRA_PATHS.includes(entry) && !SOURCE_PATHS.includes(entry),
      )
      expect(
        claimedAsLane.slice().sort(),
        `paths filter #${index + 1} watches a path the stack lane does not run — the R608 shape ` +
          '(it looked like coverage and was not, while the file it should have watched went ' +
          'unwatched in the same edit)',
      ).toEqual(stackInclude.slice().sort())
    }
  })

  it('3. the infra and source halves are the enumerated sets, and the two filters agree', () => {
    for (const [index, block] of blocks.entries()) {
      expect(
        block
          .filter((entry) => !stackInclude.includes(entry) && !SOURCE_PATHS.includes(entry))
          .slice()
          .sort(),
        `paths filter #${index + 1} gained a non-lane pattern — widening the expensive lane is a ` +
          'deliberate conversation with this file (the workflow banner rules out a broad src/**)',
      ).toEqual(INFRA_PATHS.slice().sort())
      expect(
        block
          .filter((entry) => !stackInclude.includes(entry) && !INFRA_PATHS.includes(entry))
          .slice()
          .sort(),
        `paths filter #${index + 1}'s source half is not SOURCE_PATHS — arms 6 and 7 reason about ` +
          'that list, so a pattern the list does not know about is unproven in both directions',
      ).toEqual(SOURCE_PATHS.slice().sort())
    }
    expect(blocks[0]!.slice().sort(), 'the two filters have drifted apart').toEqual(
      blocks[1]!.slice().sort(),
    )
  })

  it('4. the pattern shapes this pin can reason about are the ones in use', () => {
    for (const pattern of [...stackInclude, ...SOURCE_PATHS]) {
      expect(
        /^(\*\*\/)?[\w./*-]+$/.test(pattern),
        `the filter gained a glob shape '${pattern}' that globToRegExp above was never taught — ` +
          'extend it rather than deleting this arm',
      ).toBe(true)
    }
  })

  it('5. FILE LEVEL: every file the stack lane runs is matched by a filter pattern', () => {
    const filterRegexes = blocks.map((block) => block.map(globToRegExp))
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

  it('6. IMPORT CLOSURE: every module a stack suite transitively imports is watched (F290)', () => {
    // Premises first — every one of these silently false would turn the sweep
    // below into a vacuous pass (the exact way F290 hid inside a green pin).
    expect(ALIASES.length, 'tsconfig.json exposed no `paths` alias — the @/ half of every ' +
      'specifier would resolve to nothing and the closure would be a fraction of itself').toBeGreaterThan(0)
    expect(stackFiles.length, 'no stack-lane seeds — the closure is vacuous').toBeGreaterThan(25)

    const closure = importClosure(stackFiles)
    expect(
      closure.size,
      'the import closure collapsed — the scanner or the resolver has stopped seeing imports, ' +
        'and a green here would mean nothing (69 modules when this arm was written)',
    ).toBeGreaterThan(40)
    // The module PR #274 changed, reached from the suite that imports it.
    // This is the case the first two mirror directions could not see.
    expect(
      [...closure.keys()],
      'season-runner.ts is F290 itself — a source-only change to it merged with no Database run. ' +
        'If it has left the closure, this arm is no longer pinning the thing it was built for',
    ).toContain(path.join('src', 'lib', 'leagues', 'sim', 'season-runner.ts'))

    const filterRegexes = blocks.map((block) => block.map(globToRegExp))
    for (const [index, regexes] of filterRegexes.entries()) {
      const unwatched = [...closure.entries()]
        .filter(([module]) => !regexes.some((re) => re.test(module)))
        .map(([module, via]) => `${module}  (reached from ${via})`)
      expect(
        unwatched,
        `paths filter #${index + 1} does not watch source the stack lane executes — a change to ` +
          'these files would merge with the Database job never running (F290, PR #274). Add the ' +
          'narrowest covering pattern to SOURCE_PATHS and to BOTH paths blocks in db.yml',
      ).toEqual([])
    }
  })

  it('7. no dead source pattern: every `SOURCE_PATHS` entry matches something the lane imports', () => {
    const closure = importClosure(stackFiles)
    const modules = [...closure.keys()]
    for (const pattern of SOURCE_PATHS) {
      const regex = globToRegExp(pattern)
      expect(
        modules.some((module) => regex.test(module)),
        `SOURCE_PATHS carries '${pattern}', which no module in the stack lane's import closure ` +
          'matches — that is the R608 shape (a pattern that looks like coverage over files this ' +
          'job never runs). Delete it, or narrow it to what is actually reached',
      ).toBe(true)
    }
  })
})
