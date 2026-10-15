import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { FREE_PRIVATE_LIST_LIMIT } from '@/lib/lists/helpers'

/**
 * The one-private-list cap is SUSPENDED (Chris, 2026-10-15 — the Pro rules
 * are paused for the free-only launch). Private lists are unlimited for
 * everyone; the checks stay in place behind `FREE_PRIVATE_LIST_LIMIT` so a
 * Pro tier can bring a cap back by setting a number.
 */

const ROUTES = ['src/app/api/lists/route.ts', 'src/app/api/lists/[id]/route.ts', 'src/app/api/lists/[id]/duplicate/route.ts']

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8')

describe('private lists are unlimited while the Pro rules are suspended', () => {
  it('the cap is off', () => {
    expect(FREE_PRIVATE_LIST_LIMIT).toBeNull()
  })

  it('create, make-private and duplicate each skip the cap while it is off', () => {
    for (const route of ROUTES) {
      const source = read(route)
      expect(source, route).toContain('FREE_PRIVATE_LIST_LIMIT !== null')
      // The check is kept (not ripped out — CLAUDE.md), just switched off.
      expect(source, route).toContain('countPrivateLists(')
    }
  })
})
