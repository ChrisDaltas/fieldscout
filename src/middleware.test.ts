import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { middleware } from './middleware'

/**
 * Middleware auth-cookie survival — DR.1 / D148(b).
 *
 * `supabase.auth.getUser()` rotates the session when the access token has
 * expired: it spends the refresh token and hands the new pair back through
 * `cookies.setAll`, which the middleware writes onto `supabaseResponse`. Both
 * redirect branches used to return a brand-new `NextResponse.redirect(...)`,
 * which is a different response object and carries none of that — the
 * documented `@supabase/ssr` footgun. The browser kept the OLD refresh token,
 * the auth server had already rotated it away, and the next request signed the
 * user out.
 *
 * It is unreachable through in-app client-side navigation (no middleware runs),
 * which is exactly why the full-screen draft room surfaced it: a new browser
 * tab or a refresh mid-draft IS a cold server request, and an anonymous one
 * lands on `/login?redirect=<room>` — the auth-page branch.
 *
 * Observed on the local stack 2026-08-18 before the fix, same cookie state,
 * two branches:
 *   GET /app/leagues/<id>/draft  → 200, set-cookie present  (no redirect)
 *   GET /login?redirect=<room>   → 307, NO set-cookie        (redirect)
 *
 * These pins reproduce that differential in-process. The fake below stands in
 * for supabase-js: it calls `setAll` exactly as a refresh does, then answers
 * `getUser`. Nothing here talks to a network.
 */

interface CookieWrite {
  name: string
  value: string
  options: { path: string; sameSite?: 'lax'; maxAge: number }
}

const REFRESHED: CookieWrite[] = [
  {
    name: 'sb-127-auth-token',
    value: 'base64-REFRESHED',
    options: { path: '/', sameSite: 'lax', maxAge: 34560000 },
  },
]

/** supabase-js's failure direction: a dead refresh REMOVES the cookies. */
const CLEARED: CookieWrite[] = [
  { name: 'sb-127-auth-token', value: '', options: { path: '/', maxAge: 0 } },
]

let cookiesWritten: CookieWrite[] = []
let currentUser: { id: string } | null = null

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { getAll: () => unknown; setAll: (c: CookieWrite[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        // The refresh happens INSIDE getUser — this is the ordering that makes
        // the bug possible at all.
        opts.cookies.setAll(cookiesWritten)
        return { data: { user: currentUser } }
      },
    },
  }),
}))

/**
 * R343: the cookie MUST go in through the constructor. `new NextRequest(url)`
 * followed by `req.headers.set('cookie', …)` sets the header but leaves
 * `req.cookies.getAll()` EMPTY — measured against Next 15.5.19, both forms in
 * one run: post-construction `[]`, constructor-supplied
 * `[{name:'sb-127-auth-token',value:'base64-STALE'}]`. The pins below still
 * discriminated with the broken helper (the fake client never reads
 * `getAll`), but the comment at the auth-page pin narrated a request state the
 * test never built. Building it is cheaper than qualifying the sentence.
 */
function request(url: string, cookie?: string) {
  return new NextRequest(
    new URL(url, 'http://localhost:3124'),
    cookie ? { headers: { cookie } } : undefined,
  )
}

const ROOM = '/app/leagues/46c4e571-4218-4b3b-96d3-93e50aa99e85/draft'

function authCookie(res: Response) {
  return res.headers.getSetCookie().find((c) => c.startsWith('sb-127-auth-token='))
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  cookiesWritten = []
  currentUser = null
})

describe('the harness builds the request it claims to build (R343)', () => {
  it('a cookie passed to request() reaches request.cookies, not just the header', () => {
    const req = request(`/login?redirect=${ROOM}`, 'sb-127-auth-token=base64-STALE')
    expect(req.cookies.getAll()).toEqual([
      { name: 'sb-127-auth-token', value: 'base64-STALE' },
    ])
  })
})

describe('a cold load of the draft room is gated, and keeps its destination', () => {
  it('anonymous → /login carrying the room as ?redirect', async () => {
    const res = await middleware(request(ROOM))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('redirect')).toBe(ROOM)
  })

  it('signed in → the room is served, not redirected', async () => {
    currentUser = { id: 'u1' }
    const res = await middleware(request(ROOM))
    expect(res.status).toBe(200)
  })
})

describe('a redirect never loses the cookies the refresh just minted (D148(b))', () => {
  it('the protected-path branch keeps them — this arm was always correct', async () => {
    // The control. If this ever goes red the fake is wrong, not the middleware.
    currentUser = { id: 'u1' }
    cookiesWritten = REFRESHED
    const res = await middleware(request(ROOM))
    expect(res.status).toBe(200)
    expect(authCookie(res)).toContain('base64-REFRESHED')
  })

  it('the auth-page branch keeps them too — the arm that dropped them', async () => {
    // The exact request the anonymous cold load above hands to the browser,
    // replayed once a session exists: /login?redirect=<room> with an expired
    // access token and a live refresh token.
    currentUser = { id: 'u1' }
    cookiesWritten = REFRESHED
    const res = await middleware(
      request(`/login?redirect=${encodeURIComponent(ROOM)}`, 'sb-127-auth-token=base64-STALE'),
    )
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/app')
    const cookie = authCookie(res)
    expect(cookie, 'the refreshed session must survive the redirect').toBeDefined()
    expect(cookie).toContain('base64-REFRESHED')
  })

  it('the sign-out branch keeps the REMOVALS too', async () => {
    // The failure direction: a refresh that fails clears the session. Dropping
    // that leaves dead cookies in the browser which re-fail on every request —
    // "nothing happened" reading as success (CLAUDE.md).
    currentUser = null
    cookiesWritten = CLEARED
    const res = await middleware(request(ROOM, 'sb-127-auth-token=base64-DEAD'))
    expect(res.status).toBe(307)
    const cookie = authCookie(res)
    expect(cookie, 'the clearing must survive the redirect').toBeDefined()
    expect(cookie).toMatch(/^sb-127-auth-token=;/)
  })
})
