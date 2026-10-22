import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { friendlyMessage } from '@/lib/leagues/api/friendly-messages'

import {
  classifyRateLimitedRequest,
  parseRateLimitTake,
  rateLimitCopy,
  rateLimitedResponseParts,
  retryAfterSeconds,
} from './route-limits'

/**
 * §22.5 route-layer limits — the route side (M7 L.F2.6; PROGRESS D700–D706).
 * The census walks the real route tree, so a NEW league / practice-draft
 * write route is covered the day it lands — or this file says why not.
 */

const L = '46c4e571-4218-4b3b-96d3-93e50aa99e85'
const M = '7a1c0e52-1d9e-4c0a-9b1e-2f6f3c8d9a10'

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return routeFiles(full)
    return name === 'route.ts' ? [full] : []
  })
}

/** `src/app/api/leagues/[id]/draft/pick/route.ts` → `/api/leagues/<L>/draft/pick`. */
function urlFor(file: string): string {
  const rel = relative(join(process.cwd(), 'src', 'app'), file).split(sep).slice(0, -1).join('/')
  return (
    '/' +
    rel
      .replace(/^api\/leagues\/\[id\]/, `api/leagues/${L}`)
      .replace(/^api\/mocks\/\[mockId\]/, `api/mocks/${M}`)
      .replace(/\[[^\]]+\]/g, L)
  )
}

function writeMethods(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  return ['POST', 'PATCH', 'PUT', 'DELETE'].filter((m) => new RegExp(`export async function ${m}\\b`).test(src))
}

describe('census — every league / practice-draft write route spends an allowance', () => {
  const files = [
    ...routeFiles(join(process.cwd(), 'src', 'app', 'api', 'leagues', '[id]')),
    ...routeFiles(join(process.cwd(), 'src', 'app', 'api', 'mocks', '[mockId]')),
  ]
  const writes = files.flatMap((f) => writeMethods(f).map((m) => ({ method: m, url: urlFor(f) })))

  it('the census found the tree (not an empty pass)', () => {
    expect(files.length).toBeGreaterThan(60)
    expect(writes.length).toBeGreaterThan(70)
  })

  it('each write is a mutation, except the two bid routes (bid) and the trade preview (a read)', () => {
    const outcome = writes.map(({ method, url }) => {
      const target = classifyRateLimitedRequest(method, url)
      return { method, url, bucket: target?.bucket ?? 'none' }
    })
    const notMutation = outcome
      .filter((o) => o.bucket !== 'mutation')
      .sort((a, b) => a.url.localeCompare(b.url))
    expect(notMutation).toEqual([
      { method: 'POST', url: `/api/leagues/${L}/draft/bid`, bucket: 'bid' },
      { method: 'POST', url: `/api/leagues/${L}/trades/preview`, bucket: 'none' },
      { method: 'POST', url: `/api/mocks/${M}/bid`, bucket: 'bid' },
    ])
  })

  it('the trade preview really is a read (its own header says so) — the exemption is earned', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/leagues/[id]/trades/preview/route.ts'), 'utf8')
    expect(src).toContain('A READ: nothing is written')
  })
})

describe('classifyRateLimitedRequest', () => {
  it('scopes by the league / practice-draft id (lower-cased)', () => {
    expect(classifyRateLimitedRequest('post', `/api/leagues/${L.toUpperCase()}/draft/pick`)).toEqual({ bucket: 'mutation', scope: L })
    expect(classifyRateLimitedRequest('DELETE', `/api/mocks/${M}`)).toEqual({ bucket: 'mutation', scope: M })
    expect(classifyRateLimitedRequest('PATCH', `/api/leagues/${L}`)).toEqual({ bucket: 'mutation', scope: L })
    expect(classifyRateLimitedRequest('POST', `/api/leagues/${L}/draft/bid/`)).toEqual({ bucket: 'bid', scope: L })
  })

  it('reads, non-league routes and malformed ids spend nothing', () => {
    expect(classifyRateLimitedRequest('GET', `/api/leagues/${L}/draft`)).toBeNull()
    expect(classifyRateLimitedRequest('HEAD', `/api/leagues/${L}/draft`)).toBeNull()
    expect(classifyRateLimitedRequest('OPTIONS', `/api/leagues/${L}/draft/pick`)).toBeNull()
    expect(classifyRateLimitedRequest('POST', '/api/leagues')).toBeNull()
    expect(classifyRateLimitedRequest('POST', '/api/leagues/join')).toBeNull()
    expect(classifyRateLimitedRequest('POST', '/api/mocks')).toBeNull()
    expect(classifyRateLimitedRequest('POST', `/api/leaguesx/${L}/draft/pick`)).toBeNull()
    expect(classifyRateLimitedRequest('POST', `/app/leagues/${L}/draft`)).toBeNull()
    // the reverse-bid is a commissioner correction, not a bid
    expect(classifyRateLimitedRequest('POST', `/api/leagues/${L}/draft/reverse-bid`)?.bucket).toBe('mutation')
  })
})

describe('the 429', () => {
  it('Retry-After rounds UP to whole seconds and is never below 1', () => {
    expect(retryAfterSeconds(0)).toBe(1)
    expect(retryAfterSeconds(1)).toBe(1)
    expect(retryAfterSeconds(1000)).toBe(1)
    expect(retryAfterSeconds(1001)).toBe(2)
    expect(retryAfterSeconds(10000)).toBe(10)
    expect(retryAfterSeconds(Number.NaN)).toBe(1)
  })

  it('the copy, golden — what happened, the wait, that nothing changed', () => {
    expect(rateLimitCopy('mutation', 10)).toBe(
      "You're making changes too fast. Wait 10 seconds and try again — nothing was changed.",
    )
    expect(rateLimitCopy('mutation', 1)).toBe(
      "You're making changes too fast. Wait 1 second and try again — nothing was changed.",
    )
    expect(rateLimitCopy('bid', 1)).toBe(
      "You're bidding faster than the room can take. Wait 1 second and bid again — that bid wasn't placed.",
    )
  })

  it('the copy survives the one member-facing cleaner unchanged (no code, no citation to strip)', () => {
    for (const s of [rateLimitCopy('mutation', 3), rateLimitCopy('bid', 1)]) {
      expect(friendlyMessage(s)).toBe(s)
    }
    const chat = "You're sending messages too fast. Wait 10 seconds and send it again — that message wasn't posted."
    expect(friendlyMessage(chat)).toBe(chat) // 209's chat refusal, verbatim (pgTAP 159 C3)
  })

  it('the response parts', () => {
    expect(rateLimitedResponseParts('mutation', 2300)).toEqual({
      body: {
        error: "You're making changes too fast. Wait 3 seconds and try again — nothing was changed.",
        code: 'RATE_LIMITED',
        bucket: 'mutation',
        retry_after_seconds: 3,
      },
      retryAfter: '3',
    })
  })
})

describe('parseRateLimitTake', () => {
  it('reads 209\'s answer and refuses anything else', () => {
    const ok = { allowed: false, bucket: 'mutation', limit: 10, window_ms: 10000, remaining: 0, retry_after_ms: 10000 }
    expect(parseRateLimitTake(ok)).toEqual(ok)
    expect(parseRateLimitTake(null)).toBeNull()
    expect(parseRateLimitTake({ allowed: true })).toBeNull()
    expect(parseRateLimitTake({ ...ok, retry_after_ms: -1 })).toBeNull()
  })
})
