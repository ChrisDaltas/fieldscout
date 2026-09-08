import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * NEXT.JS SEGMENT-CONFIG EXPORTS MUST BE LITERALS (R885 → F271; D325).
 *
 * Next.js reads a route segment's config (`maxDuration`, `dynamic`,
 * `revalidate`, `runtime`, `fetchCache`, `preferredRegion`, `dynamicParams`)
 * with a STATIC parser at build time — the value must be a literal. An
 * identifier compiles, type-checks, lints and passes every vitest that
 * imports the module (the export evaluates fine at runtime), and then fails
 * ONLY in `next build`:
 *
 *   ⨯ Next.js can't recognize the exported `config` field in route
 *     "/api/cron/score-week/route": Unknown identifier
 *     "SCORE_WEEK_MAX_DURATION_SECONDS" at "maxDuration"
 *   Invalid segment configuration export detected
 *
 * That is exactly how PR #268 passed both GitHub jobs and failed on Vercel
 * (R885): CI runs no `next build` — deliberately, Vercel builds every PR
 * (ci.yml's banner) — so the fast lane had no way to see it. This pin is
 * the cheap static check that would have caught it: it runs in the UNIT
 * lane on every PR, reads every `route.ts` / `page.tsx` / `layout.tsx`
 * under `src/app`, and asserts each segment-config export's right-hand
 * side is a literal. Zero dependencies (the ci-stack-lane-trigger pin's
 * discipline): `node:fs` and one regex whose accepted shapes are themselves
 * asserted below.
 *
 * Shown RED against the R885 shape before landing (a route temporarily
 * exporting `maxDuration = SOME_CONST`), then green — D325.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const APP_DIR = path.join(REPO_ROOT, 'src', 'app')

/** Next.js's route-segment config keys (App Router). */
const SEGMENT_CONFIG_EXPORTS = [
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
  'experimental_ppr', // R905: the eighth key of Next 15's AppSegmentConfigSchemaKeys — R885's class too
] as const

/** The files Next.js applies segment config to. */
const SEGMENT_FILES = new Set(['route.ts', 'page.tsx', 'layout.tsx'])

/** A literal right-hand side, optionally `as const`: a number, a quoted
 *  string, a boolean, an expression-free template literal, or an array of
 *  those (Next's `extract-const-value` accepts exactly these — R904;
 *  `preferredRegion` is typed `string | string[]`). An identifier, a member
 *  expression, a call, a template literal WITH `${}`, or arithmetic is
 *  refused, because Next's static extractor cannot evaluate them (R885). */
const SCALAR_RHS = String.raw`(?:-?\d+(?:\.\d+)?|'[^'\n]*'|"[^"\n]*"|` + '`[^`$\\n]*`' + String.raw`|true|false)`
const LITERAL_RHS = new RegExp(
  `^(?:${SCALAR_RHS}|\\[\\s*(?:${SCALAR_RHS}(?:\\s*,\\s*${SCALAR_RHS})*\\s*,?)?\\s*\\])(?:\\s+as\\s+const)?$`,
)

/** `export const <key>[: type] = <rhs>` at the start of a line, one per
 *  match; group 1 = the key, group 2 = the raw right-hand side. */
const SEGMENT_EXPORT =
  /^[ \t]*export[ \t]+const[ \t]+(dynamic|dynamicParams|revalidate|fetchCache|runtime|preferredRegion|maxDuration|experimental_ppr)\b[ \t]*(?::[^=\n]+)?=[ \t]*([^;\n]+?)[ \t]*;?[ \t]*$/gm

/** Drop comments so a commented-out identifier export (score-week's own R885
 *  note, for one) is not reported. Crude by design — only the segment-config
 *  export lines matter, and none of them can legitimately contain `//` or
 *  `/*` inside a string. Newlines inside block comments are KEPT so a
 *  reported line number is the file's own. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

function segmentFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) segmentFiles(full, acc)
    else if (SEGMENT_FILES.has(entry.name)) acc.push(full)
  }
  return acc
}

interface SegmentExport {
  file: string
  line: number
  key: string
  rhs: string
}

function segmentExports(file: string): SegmentExport[] {
  const source = stripComments(readFileSync(file, 'utf8'))
  const found: SegmentExport[] = []
  for (const match of source.matchAll(SEGMENT_EXPORT)) {
    const line = source.slice(0, match.index).split('\n').length
    found.push({ file: path.relative(REPO_ROOT, file), line, key: match[1]!, rhs: match[2]!.trim() })
  }
  return found
}

const files = segmentFiles(APP_DIR)
const exportsFound = files.flatMap(segmentExports)

describe('Next.js segment-config exports are literals (R885 / F271)', () => {
  it('0. the sweep is not vacuous: many segment files, and some carry a segment-config export', () => {
    expect(files.length, 'no route.ts / page.tsx / layout.tsx under src/app').toBeGreaterThan(50)
    // The cron routes export maxDuration — the very export R885 broke.
    expect(exportsFound.map((e) => e.key), 'no segment-config export found anywhere').toContain(
      'maxDuration',
    )
    expect(exportsFound.map((e) => e.file)).toContain(
      path.join('src', 'app', 'api', 'cron', 'score-week', 'route.ts'),
    )
  })

  it('1. every segment-config export in every segment file is a LITERAL, never an identifier', () => {
    const offenders = exportsFound.filter((e) => !LITERAL_RHS.test(e.rhs))
    expect(
      offenders.map((e) => `${e.file}:${e.line} export const ${e.key} = ${e.rhs}`),
      'Next.js reads segment config statically — an identifier passes tsc/lint/vitest and fails ' +
        'ONLY in `next build` (R885). Write the literal and pin it against the constant in the ' +
        "route's own test instead.",
    ).toEqual([])
  })

  it('2. the matcher accepts exactly the literal shapes and rejects the R885 shape', () => {
    for (const ok of [
      '60', '300', '0', '-1', "'force-dynamic'", '"edge"', 'true', 'false', "'iad1' as const",
      '`nodejs`', "['iad1']", "['iad1', 'sfo1'] as const", '[]', // R904: Next's extractor accepts these
    ]) {
      expect(LITERAL_RHS.test(ok), `should accept ${ok}`).toBe(true)
    }
    for (const bad of [
      'SCORE_WEEK_MAX_DURATION_SECONDS', // R885 verbatim
      'config.maxDuration',
      'Number(process.env.X)',
      '`${REGION}`', // a template literal WITH an expression is not static
      '[REGION]', // an array of identifiers is not static either
      '60 * 5',
    ]) {
      expect(LITERAL_RHS.test(bad), `should reject ${bad}`).toBe(false)
    }
    // The line matcher: type annotation, trailing semicolon, and the value
    // are all read; a commented-out export is not.
    const sample = stripComments(
      [
        "export const runtime: 'edge' = 'edge';",
        'export const maxDuration = 60',
        '// export const maxDuration = SOME_CONST',
        '/* export const revalidate = OTHER */',
        'export const dynamic = FORCE',
      ].join('\n'),
    )
    const rhs = [...sample.matchAll(SEGMENT_EXPORT)].map((m) => `${m[1]}=${m[2]!.trim()}`)
    expect(rhs).toEqual(["runtime='edge'", 'maxDuration=60', 'dynamic=FORCE'])
  })

  it('3. the key list is Next.js’s segment-config surface (a new key is a deliberate edit here)', () => {
    expect([...SEGMENT_CONFIG_EXPORTS].sort()).toEqual(
      ['dynamic', 'dynamicParams', 'experimental_ppr', 'fetchCache', 'maxDuration', 'preferredRegion', 'revalidate', 'runtime'],
    )
    // The line matcher's alternation must carry the same keys — a key added
    // to one list and not the other would silently drop coverage.
    for (const key of SEGMENT_CONFIG_EXPORTS) {
      expect(SEGMENT_EXPORT.source, `matcher lacks ${key}`).toContain(key)
    }
  })
})
