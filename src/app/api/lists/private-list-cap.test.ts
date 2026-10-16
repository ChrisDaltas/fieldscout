import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { FREE_PRIVATE_LIST_LIMIT, FREE_TEAM_LIST_LIMIT, isPrivateListCapError, isTeamListCapError } from '@/lib/lists/helpers'

/**
 * The free-tier list caps are SUSPENDED — one private list (Chris,
 * 2026-10-15) and one team (2026-10-16: "remove the list caps for non-Pro,
 * Pro logic on hold"). Both are unlimited for everyone; the checks stay in
 * place behind `FREE_PRIVATE_LIST_LIMIT` / `FREE_TEAM_LIST_LIMIT` so a Pro
 * tier can bring a cap back by setting a number. The database side is
 * migration 187 (pinned by pgTAP 135); until it is pushed, the routes turn
 * the database's refusals back into the friendly 403s and duplicate falls
 * back to a public copy for a private list.
 */

const ROUTES = ['src/app/api/lists/route.ts', 'src/app/api/lists/[id]/route.ts', 'src/app/api/lists/[id]/duplicate/route.ts']

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), 'utf8')

describe('private lists are unlimited while the Pro rules are suspended', () => {
  it('the cap is off', () => {
    expect(FREE_PRIVATE_LIST_LIMIT).toBeNull()
  })

  it('the one-team cap is off too, behind its own switch in create and duplicate', () => {
    expect(FREE_TEAM_LIST_LIMIT).toBeNull()
    for (const route of ['src/app/api/lists/route.ts', 'src/app/api/lists/[id]/duplicate/route.ts']) {
      const source = read(route)
      expect(source, route).toContain('FREE_TEAM_LIST_LIMIT !== null')
      // No hard-coded one-team check is left behind.
      expect(source, route).not.toMatch(/\(count \?\? 0\) >= 1\b/)
    }
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

describe('until migration 187 is pushed, the database refusal stays friendly', () => {
  it('recognises the trigger’s refusal and nothing else', () => {
    expect(isPrivateListCapError({ code: '23514', message: 'Free accounts can have one private list.' })).toBe(true)
    expect(isPrivateListCapError({ code: '23514', message: 'Free accounts can have one team.' })).toBe(false)
    expect(isPrivateListCapError({ code: '23505', message: 'one private list' })).toBe(false)
    expect(isPrivateListCapError(null)).toBe(false)
    expect(isTeamListCapError({ code: '23514', message: 'Free accounts can have one team.' })).toBe(true)
    expect(isTeamListCapError({ code: '23514', message: 'Free accounts can have one private list.' })).toBe(false)
    expect(isTeamListCapError({ code: '23505', message: 'one team' })).toBe(false)
  })

  it('every route that writes a team answers the database’s one-team refusal with the 403', () => {
    for (const route of [
      'src/app/api/lists/route.ts',
      'src/app/api/lists/[id]/route.ts',
      'src/app/api/lists/[id]/restore/route.ts',
      'src/app/api/lists/[id]/duplicate/route.ts',
    ]) {
      expect(read(route), route).toMatch(/isTeamListCapError\(\w+\)\) \{\s*return NextResponse\.json\(TEAM_LIMIT_BODY, \{ status: 403 \}\)/)
    }
  })

  it('create, make-private and restore answer 403; duplicate retries as a public copy', () => {
    for (const route of ['src/app/api/lists/route.ts', 'src/app/api/lists/[id]/route.ts', 'src/app/api/lists/[id]/restore/route.ts']) {
      const source = read(route)
      expect(source, route).toMatch(/isPrivateListCapError\(\w+\)\) \{\s*return NextResponse\.json\(PRIVATE_LIMIT_BODY, \{ status: 403 \}\)/)
    }
    expect(read('src/app/api/lists/[id]/duplicate/route.ts')).toMatch(/isPrivateListCapError\(rpcError\) && !forcePublic\) \{\s*;\(\{ data: created, error: rpcError \} = await duplicate\(true\)\)/)
  })
})
