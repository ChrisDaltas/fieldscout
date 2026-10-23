import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { middleware } from './middleware'

/**
 * §22.5 route-layer rate limits at the route door — M7 L.F2.6 (migration
 * 209; PROGRESS D700–D706).
 *
 * The middleware is the route layer for every league / practice-draft write:
 * one `rate_limit_take` per write, as the signed-in member, and a refusal is
 * a 429 with `Retry-After` and plain words — never a silent drop, never an
 * empty 200. A limiter FAULT lets the request through (deploy-before-push:
 * PGRST202 until 209 is pushed is today's behaviour).
 *
 * The fake stands in for supabase-js: `getUser` answers the session, `rpc`
 * answers the door as 209 does (shapes copied from pgTAP 159 L2 / D1).
 * Nothing here talks to a network.
 */

interface CookieWrite {
  name: string
  value: string
  options: { path: string; sameSite?: 'lax'; maxAge: number }
}

let cookiesWritten: CookieWrite[] = []
let currentUser: { id: string } | null = null
let rpcAnswer: { data: unknown; error: { code: string; message: string } | null } = { data: null, error: null }
let rpcThrows = false
const rpcCalls: Array<{ fn: string; args: unknown }> = []
const rpcSignals: AbortSignal[] = []

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { getAll: () => unknown; setAll: (c: CookieWrite[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        opts.cookies.setAll(cookiesWritten)
        return { data: { user: currentUser } }
      },
    },
    // supabase-js's builder: `.rpc(...).abortSignal(signal)` is awaited.
    rpc: (fn: string, args: unknown) => ({
      abortSignal: async (signal: AbortSignal) => {
        rpcCalls.push({ fn, args })
        rpcSignals.push(signal)
        if (rpcThrows) throw new Error('network down')
        if (signal.aborted) return { data: null, error: { code: '20', message: 'AbortError: The operation was aborted' } }
        return rpcAnswer
      },
    }),
  }),
}))

const LEAGUE = '46c4e571-4218-4b3b-96d3-93e50aa99e85'
const MOCK = '7a1c0e52-1d9e-4c0a-9b1e-2f6f3c8d9a10'

function request(path: string, method = 'POST', cookie?: string) {
  return new NextRequest(new URL(path, 'http://localhost:3124'), {
    method,
    ...(cookie ? { headers: { cookie } } : {}),
  })
}

const ALLOWED = { allowed: true, bucket: 'mutation', limit: 10, window_ms: 10000, remaining: 9, retry_after_ms: 0 }
const REFUSED = { allowed: false, bucket: 'mutation', limit: 10, window_ms: 10000, remaining: 0, retry_after_ms: 2300 }
const BID_REFUSED = { allowed: false, bucket: 'bid', limit: 5, window_ms: 1000, remaining: 0, retry_after_ms: 400 }

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  cookiesWritten = []
  currentUser = { id: 'u1' }
  rpcAnswer = { data: ALLOWED, error: null }
  rpcThrows = false
  rpcCalls.length = 0
  rpcSignals.length = 0
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('over the limit: 429, Retry-After, plain words', () => {
  it('a refused league mutation is a 429 with Retry-After rounded UP to whole seconds', async () => {
    rpcAnswer = { data: REFUSED, error: null }
    const res = await middleware(request(`/api/leagues/${LEAGUE}/teams/${LEAGUE}/lineup`, 'PATCH'))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('3')
    expect(await res.json()).toEqual({
      error: "You're making changes too fast. Wait 3 seconds and try again — nothing was changed.",
      code: 'RATE_LIMITED',
      bucket: 'mutation',
      retry_after_seconds: 3,
    })
    expect(rpcCalls).toEqual([{ fn: 'rate_limit_take', args: { p_bucket: 'mutation', p_scope: LEAGUE } }])
  })

  it('a refused bid names the bid, with a 1-second Retry-After', async () => {
    rpcAnswer = { data: BID_REFUSED, error: null }
    const res = await middleware(request(`/api/leagues/${LEAGUE}/draft/bid`))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('1')
    expect((await res.json()).error).toBe(
      "You're bidding faster than the room can take. Wait 1 second and bid again — that bid wasn't placed.",
    )
    expect(rpcCalls[0]).toEqual({ fn: 'rate_limit_take', args: { p_bucket: 'bid', p_scope: LEAGUE } })
  })

  it('a practice draft spends its own allowance (mocks share every live-draft limit)', async () => {
    rpcAnswer = { data: REFUSED, error: null }
    const res = await middleware(request(`/api/mocks/${MOCK}/pick`))
    expect(res.status).toBe(429)
    expect(rpcCalls[0]).toEqual({ fn: 'rate_limit_take', args: { p_bucket: 'mutation', p_scope: MOCK } })
    await middleware(request(`/api/mocks/${MOCK}/bid`))
    expect(rpcCalls[1]).toEqual({ fn: 'rate_limit_take', args: { p_bucket: 'bid', p_scope: MOCK } })
  })

  it('the 429 keeps the cookies the session refresh just minted (D148(b))', async () => {
    rpcAnswer = { data: REFUSED, error: null }
    cookiesWritten = [{ name: 'sb-127-auth-token', value: 'base64-REFRESHED', options: { path: '/', maxAge: 100 } }]
    const res = await middleware(request(`/api/leagues/${LEAGUE}/draft/pick`, 'POST', 'sb-127-auth-token=base64-STALE'))
    expect(res.status).toBe(429)
    expect(res.headers.getSetCookie().find((c) => c.startsWith('sb-127-auth-token='))).toContain('base64-REFRESHED')
  })
})

describe('at or under the limit: the request goes through untouched', () => {
  it('an allowed take passes the request on (status 200 = NextResponse.next)', async () => {
    const res = await middleware(request(`/api/leagues/${LEAGUE}/draft/pick`))
    expect(res.status).toBe(200)
    expect(res.headers.get('retry-after')).toBeNull()
    expect(rpcCalls).toHaveLength(1)
  })

  it('reads spend nothing: GET, and the trade preview (a read sent as a POST)', async () => {
    await middleware(request(`/api/leagues/${LEAGUE}/standings`, 'GET'))
    await middleware(request(`/api/leagues/${LEAGUE}/trades/preview`, 'POST'))
    expect(rpcCalls).toHaveLength(0)
  })

  it('a signed-out caller spends nothing (the route answers 401 itself)', async () => {
    currentUser = null
    const res = await middleware(request(`/api/leagues/${LEAGUE}/draft/pick`))
    expect(res.status).toBe(200)
    expect(rpcCalls).toHaveLength(0)
  })

  it('routes outside leagues / practice drafts spend nothing (incl. cron and the admin console — R1690)', async () => {
    await middleware(request('/api/leagues'))
    await middleware(request('/api/leagues/join'))
    await middleware(request('/api/lists'))
    await middleware(request('/api/leagues/not-a-uuid/draft/pick'))
    await middleware(request('/api/cron/waivers'))
    await middleware(request('/api/cron/week-advance', 'GET'))
    await middleware(request(`/api/admin/leagues/${LEAGUE}/commissioner`))
    await middleware(request(`/api/admin/leagues/${LEAGUE}/jobs/pause`, 'PATCH'))
    expect(rpcCalls).toHaveLength(0)
  })

  it('R1688: a percent-encoded league id is decoded before it is classified — it cannot slip past the limit', async () => {
    rpcAnswer = { data: REFUSED, error: null }
    const encoded = LEAGUE.split('').map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    const res = await middleware(request(`/api/leagues/${encoded}/draft/pick`))
    expect(res.status).toBe(429)
    expect(rpcCalls[0]).toEqual({ fn: 'rate_limit_take', args: { p_bucket: 'mutation', p_scope: LEAGUE } })
  })

  it('R1688: a malformed escape does not throw — the raw path is classified (and, not matching, spends nothing)', async () => {
    const res = await middleware(request(`/api/leagues/${LEAGUE}%E0%A4%A/draft/pick`))
    expect(res.status).toBe(200)
  })
})

describe('a limiter fault FAILS OPEN (deploy-before-push; never stop a draft on our fault)', () => {
  it('PGRST202 — 209 not pushed yet — lets the request through and logs it', async () => {
    rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.rate_limit_take' } }
    const res = await middleware(request(`/api/leagues/${LEAGUE}/draft/pick`))
    expect(res.status).toBe(200)
    expect(console.error).toHaveBeenCalled()
  })

  it('an answer of the wrong shape lets the request through and logs it', async () => {
    rpcAnswer = { data: { allowed: 'nope' }, error: null }
    const res = await middleware(request(`/api/leagues/${LEAGUE}/draft/pick`))
    expect(res.status).toBe(200)
    expect(console.error).toHaveBeenCalled()
  })

  it('R1690: the call carries a 1.5 s timeout; a timed-out call lets the request through', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort())
    const res = await middleware(request(`/api/leagues/${LEAGUE}/draft/pick`))
    expect(timeout).toHaveBeenCalledWith(1500)
    expect(rpcSignals[0].aborted).toBe(true)
    expect(res.status).toBe(200)
    expect(console.error).toHaveBeenCalled()
  })

  it('a non-member of the scope (42501 from the door, R1687) lets the request through — the route answers him', async () => {
    rpcAnswer = { data: null, error: { code: '42501', message: 'rate_limit: not a member of this league or draft' } }
    const res = await middleware(request(`/api/leagues/${LEAGUE}/members`))
    expect(res.status).toBe(200)
  })

  it('a thrown call lets the request through and logs it', async () => {
    rpcThrows = true
    const res = await middleware(request(`/api/leagues/${LEAGUE}/draft/pick`))
    expect(res.status).toBe(200)
    expect(console.error).toHaveBeenCalled()
  })
})
