import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * §4 rule 13 (tasks-MP; D231(4)), as a grep-level pin — MP.11 item 3.
 *
 * **THE FLAG GATES SURFACES, NOT SERVER AUTHORITY.** `NEXT_PUBLIC_` env vars
 * are inlined into the client bundle at build time, so a `featureFlags.*`
 * read in a route handler's authorization path, a service-layer gate, or a
 * SQL function would be a client-side gate on a server-authoritative
 * surface (spec §12). Isolation is RLS and schema — the `league_id IS NULL`
 * ownership arm (D234/095) and §8.8's zero-side-effects rule — enforced
 * identically whatever any flag says.
 *
 * The pin is deliberately blunter than the rule: ZERO `featureFlags`
 * occurrences anywhere under the server trees, not "zero in authorization
 * paths" — because deciding whether a given read is "an authorization path"
 * is exactly the judgment call a sweep must not encode. Measured at pin
 * time (2026-08-25, MP.11): the count is already zero everywhere below, so
 * the blunt form costs nothing and any future read is a deliberate
 * conversation with this file. A legitimate future SURFACE read belongs in
 * a component or a route LAYOUT (`src/app/app/**`, e.g. the release gates
 * pinned in `launch-scope-gates.test.ts` and `route-groups.test.ts`) —
 * never under these trees.
 *
 * Swept trees:
 *   - `src/app/api/**` — every route handler (the wire's server half).
 *   - `src/lib/leagues/**` — the whole service layer every handler calls.
 *   - `supabase/migrations/**` — SQL cannot read a client env var, but a
 *     body that ships the STRING would mean someone tried; pinned so the
 *     attempt reddens before review.
 */

function sourceFiles(dir: string, exts: RegExp): string[] {
  const out: string[] = []
  for (const entry of readdirSync(path.resolve(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`
    const abs = path.resolve(process.cwd(), rel)
    if (statSync(abs).isDirectory()) {
      out.push(...sourceFiles(rel, exts))
      continue
    }
    if (!exts.test(entry)) continue
    out.push(rel)
  }
  return out
}

describe('§4 rule 13: no featureFlags read on any server path (D231(4))', () => {
  it('route handlers and the service layer never mention featureFlags', () => {
    const hits: Array<[string, number]> = []
    for (const rel of [
      ...sourceFiles('src/app/api', /\.(ts|tsx)$/),
      ...sourceFiles('src/lib/leagues', /\.(ts|tsx)$/),
    ]) {
      // Test files are swept too, on purpose: a stack-backed suite that
      // branched on a flag would make the suite's green depend on the env,
      // which is the same lie one layer out.
      const count = (readFileSync(path.resolve(process.cwd(), rel), 'utf8').match(
        /featureFlags|NEXT_PUBLIC_FLAG_/g,
      ) ?? []).length
      if (count > 0) hits.push([rel, count])
    }
    expect(hits).toEqual([])
  })

  it('no migration carries a flag env-var string', () => {
    const hits: Array<[string, number]> = []
    for (const rel of sourceFiles('supabase/migrations', /\.sql$/)) {
      const count = (readFileSync(path.resolve(process.cwd(), rel), 'utf8').match(
        /NEXT_PUBLIC_FLAG_|featureFlags/g,
      ) ?? []).length
      if (count > 0) hits.push([rel, count])
    }
    expect(hits).toEqual([])
  })
})
