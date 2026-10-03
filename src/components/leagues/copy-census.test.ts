/**
 * THE COPY CENSUS — League UX batch 5 (Chris 2026-10-03: plain fantasy
 * language). No spec section mark, no ledger code and no dev placeholder in
 * the words a league member reads.
 *
 * What it scans: every `.ts` / `.tsx` file (tests, fixtures and the mock-data
 * file excluded) under `src/components/leagues`, `src/components/draft` and
 * `src/app/app/(shell)/leagues`, parsed with the TypeScript compiler. It
 * reads the COPY a file can render — string literals, template-literal
 * text and JSX text — and never a comment (code comments may cite the spec
 * and the ledger freely). Two things are not copy and are skipped: an import /
 * export path, and a single-token string with no whitespace (an enum value
 * such as the invite seat status `'placeholder'`, a CSS class, a key).
 *
 * What it flags: `§`; a ledger code (`E63`, `(Q12)`, `F136`, `D143`, `R894`);
 * the words "coming", "later update", "TODO" and "placeholder". A legitimate
 * use is pinned below per file, to its exact count, with the reason.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const DIRS = ['src/components/leagues', 'src/components/draft', 'src/app/app/(shell)/leagues']

export const DEV_COPY = /§|\b[EQFDR]\d{1,4}[a-z]?\b|\bcoming\b|later update|\bTODO\b|\bplaceholder\b/i

/** file → [count, why the hit is plain language]. */
const ALLOWED: Record<string, [number, string]> = {
  'src/components/leagues/league-home-states.tsx': [2, '“Picks are coming off the board” — the live draft, in fantasy words'],
  'src/components/leagues/settings-panel-ops.ts': [1, '“while its stat corrections are still coming in” — plain words about corrections'],
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
}

/** Every piece of copy in one source text that the pattern flags. */
export function copyHits(fileName: string, source: string): string[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const hits: string[] = []
  const visit = (node: ts.Node) => {
    let text: string | null = null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent
      const isPath = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)
      text = isPath ? null : node.text
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      text = node.text
    }
    if (text !== null && /\s/.test(text.trim()) && DEV_COPY.test(text)) hits.push(text.trim().replace(/\s+/g, ' '))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

function census(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const dir of DIRS) {
    for (const file of walk(path.join(process.cwd(), dir))) {
      if (!/\.tsx?$/.test(file) || /\.test\.|fixtures|mock-data/.test(file)) continue
      const rel = path.relative(process.cwd(), file)
      const hits = copyHits(rel, readFileSync(file, 'utf8'))
      if (hits.length > 0) out[rel] = hits.length
    }
  }
  return out
}

describe('league and draft copy carries no spec marks, ledger codes or dev placeholders', () => {
  it('no flagged copy outside the allow-list, and every entry is pinned to its count', () => {
    const expected = Object.fromEntries(Object.entries(ALLOWED).map(([file, [count]]) => [file, count]))
    expect(census()).toEqual(expected)
  })

  it('the scan catches what it says, and skips what it says (probe sources)', () => {
    expect(copyHits('a.ts', "export const L = 'clean two-team ties only (E63)'")).toHaveLength(1)
    expect(copyHits('a.ts', 'const n = `Runs live or paused (§8.7).`')).toHaveLength(1)
    expect(copyHits('a.ts', 'const n = `${x} picks re-derive (E31) ${y} later`')).toHaveLength(1)
    expect(copyHits('a.tsx', 'const C = () => <p>Trades are coming in a later update.</p>')).toHaveLength(1)
    expect(copyHits('a.tsx', 'const C = () => <p>The waiver rule (F425) applies here.</p>')).toHaveLength(1)
    // Not copy: comments, an import path, a single-token enum value.
    expect(copyHits('a.ts', "// §7.3.2 (E63) TODO\nimport x from './e63-placeholder'\nconst s = 'placeholder'")).toEqual([])
    expect(copyHits('a.tsx', 'const C = () => <p>{/* (D143) */}Plain words.</p>')).toEqual([])
  })
})
