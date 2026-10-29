/**
 * chaos-isolation.test.ts — R1717 (PR #540): the chaos injectors are TEST
 * code. `src/lib/leagues/chaos/` holds a WebSocket that refuses to connect,
 * a provider that lies and a client that crashes on purpose; none of it may
 * ever be reachable from the app, a route, a cron or a script. This pin
 * fails if any non-test file outside this folder imports from it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../../../..')
const CHAOS_DIR = 'src/lib/leagues/chaos'

/** Every import / export-from / dynamic import / require specifier that names the chaos folder. */
export function importsChaos(source: string, fileRel: string): string[] {
  const out: string[] = []
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"`]([^'"`]+)['"`]/g
  for (const m of source.matchAll(re)) {
    const spec = m[1]!
    if (spec.startsWith('@/lib/leagues/chaos')) out.push(spec)
    else if (spec.startsWith('.')) {
      const target = relative(REPO, resolve(REPO, fileRel, '..', spec))
      if (target === CHAOS_DIR || target.startsWith(`${CHAOS_DIR}/`)) out.push(spec)
    }
  }
  return out
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      walk(rel, acc)
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) acc.push(rel)
  }
  return acc
}

describe('the chaos injectors never reach app code (R1717)', () => {
  it('the matcher sees every import shape (falsifiability)', () => {
    expect(importsChaos(`import { x } from '@/lib/leagues/chaos/faults'`, 'src/app/page.tsx')).toEqual(['@/lib/leagues/chaos/faults'])
    expect(importsChaos(`export * from '../leagues/chaos'`, 'src/lib/sync/x.ts')).toEqual(['../leagues/chaos'])
    expect(importsChaos(`const m = await import('../../lib/leagues/chaos/faults')`, 'src/app/api/x.ts')).toEqual(['../../lib/leagues/chaos/faults'])
    expect(importsChaos(`import '../chaos/faults'`, 'src/lib/leagues/scoring/y.ts')).toEqual(['../chaos/faults'])
    expect(importsChaos(`import { y } from '../scoring/reconcile'`, 'src/lib/leagues/chaos/z.ts')).toEqual([])
  })

  it('no non-test file outside src/lib/leagues/chaos/ imports from it', () => {
    const offenders: string[] = []
    for (const root of ['src', 'scripts', 'load']) {
      for (const file of walk(root)) {
        if (file.startsWith(`${CHAOS_DIR}/`)) continue
        if (/\.test\.(ts|tsx)$/.test(file)) continue
        const hits = importsChaos(readFileSync(join(REPO, file), 'utf8'), file)
        for (const spec of hits) offenders.push(`${file} → ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
