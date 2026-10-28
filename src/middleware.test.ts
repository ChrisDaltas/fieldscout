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

/** What the fake answers a `lists` read with, and the reads it was asked. */
let listAnswer: { data: unknown; error: { code: string; message: string } | null } = { data: null, error: null }
let listReads: { table: string; filters: string[] }[] = []

/** A PostgREST query builder: every filter chains, `maybeSingle` answers. */
function fakeQuery(table: string) {
  const read = { table, filters: [] as string[] }
  listReads.push(read)
  const builder = {
    select: (cols: string) => (read.filters.push(`select ${cols}`), builder),
    eq: (col: string, value: unknown) => (read.filters.push(`eq ${col} ${String(value)}`), builder),
    is: (col: string, value: unknown) => (read.filters.push(`is ${col} ${String(value)}`), builder),
    abortSignal: () => builder,
    maybeSingle: async () => listAnswer,
  }
  return builder
}

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
    from: fakeQuery,
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
  listAnswer = { data: null, error: null }
  listReads = []
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

describe('the landing page: signed-in visitors go to the app (F744)', () => {
  // This redirect moved here from src/app/page.tsx so the landing page can be
  // static (its metadata then renders in <head>). Same rule as before: a
  // signed-in visitor to / lands on /app, a signed-out one sees the page.
  it('signed out → the landing page is served', async () => {
    const res = await middleware(request('/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('signed in → /app, without the query string (as the page did)', async () => {
    currentUser = { id: 'u1' }
    const res = await middleware(request('/?utm_source=x'))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/app')
    expect(location.search).toBe('')
  })

  it('signed in → the redirect keeps the refreshed cookies (D148(b))', async () => {
    currentUser = { id: 'u1' }
    cookiesWritten = REFRESHED
    const res = await middleware(request('/', 'sb-127-auth-token=base64-STALE'))
    expect(res.status).toBe(307)
    expect(authCookie(res)).toContain('base64-REFRESHED')
  })

  it('only / itself — other public pages are not redirected', async () => {
    currentUser = { id: 'u1' }
    const res = await middleware(request('/u/someone'))
    expect(res.status).toBe(200)
  })
})

describe('a person’s phone screen is shareable: signed out, it opens the public page (audit profile-1)', () => {
  it('signed out → /app/u/<name> goes to the public /u/<name>, not the sign-in page', async () => {
    const res = await middleware(request('/app/u/devpro'))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/u/devpro')
    expect(location.search).toBe('')
  })

  it('…and their Followers / Following go to the public lists', async () => {
    for (const kind of ['followers', 'following']) {
      const res = await middleware(request(`/app/u/devpro/${kind}`))
      expect(res.status).toBe(307)
      expect(new URL(res.headers.get('location')!).pathname).toBe(`/u/devpro/${kind}`)
    }
  })

  it('signed in → the phone screen is served', async () => {
    currentUser = { id: 'u1' }
    const res = await middleware(request('/app/u/devpro'))
    expect(res.status).toBe(200)
  })

  it('every other /app page still asks a signed-out visitor to sign in', async () => {
    for (const path of ['/app/u', '/app/profile', '/app/u/devpro/lists']) {
      const res = await middleware(request(path))
      expect(res.status, path).toBe(307)
      expect(new URL(res.headers.get('location')!).pathname, path).toBe('/login')
    }
  })

  it('the redirect keeps the cookies the request produced (D148(b))', async () => {
    cookiesWritten = CLEARED
    const res = await middleware(request('/app/u/devpro', 'sb-127-auth-token=base64-DEAD'))
    expect(res.status).toBe(307)
    expect(authCookie(res)).toMatch(/^sb-127-auth-token=;/)
  })
})

describe('a list’s phone address is shareable: signed out, a public list opens its public page (audit lists-2)', () => {
  const LIST = '5d0c1a7e-3b2f-4c11-9e8a-0f1b2c3d4e5f'

  it('signed out → /app/lists?list=<id> goes to /u/<owner>/lists/<slug>, not the sign-in page', async () => {
    listAnswer = { data: { slug: 'my-rb-sleepers', owner: { username: 'devpro' } }, error: null }
    const res = await middleware(request(`/app/lists?list=${LIST}`))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/u/devpro/lists/my-rb-sleepers')
    expect(location.search).toBe('')
  })

  it('…reading only a public, undeleted list, by its id', async () => {
    listAnswer = { data: { slug: 'my-rb-sleepers', owner: [{ username: 'devpro' }] }, error: null }
    const res = await middleware(request(`/app/lists?list=${LIST}&from=grid`))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/u/devpro/lists/my-rb-sleepers')
    expect(listReads).toHaveLength(1)
    expect(listReads[0]!.table).toBe('lists')
    expect(listReads[0]!.filters).toEqual(
      expect.arrayContaining([`eq id ${LIST}`, 'eq is_private false', 'is deleted_at null']),
    )
  })

  it('Community’s list page (/app/explore?list=<id>, and over the Latest page) too', async () => {
    listAnswer = { data: { slug: 'my-rb-sleepers', owner: { username: 'devpro' } }, error: null }
    for (const path of ['/app/explore', '/app/explore/latest']) {
      const res = await middleware(request(`${path}?list=${LIST}`))
      expect(res.status, path).toBe(307)
      expect(new URL(res.headers.get('location')!).pathname, path).toBe('/u/devpro/lists/my-rb-sleepers')
    }
  })

  it('a private, deleted or unknown list asks them to sign in, and signing in opens that list', async () => {
    listAnswer = { data: null, error: null }
    const res = await middleware(request(`/app/lists?list=${LIST}`))
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('redirect')).toBe(`/app/lists?list=${LIST}`)
    // Only the destination rides along — not the list id as a /login param.
    expect([...location.searchParams.keys()]).toEqual(['redirect'])
  })

  it('a failed read is logged, never taken for “no such list”, and falls back to sign in', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    listAnswer = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
    const res = await middleware(request(`/app/lists?list=${LIST}`))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('could not read a shared list'), '57014', expect.any(String))
    logged.mockRestore()
  })

  it('an owner with no username yet has no public page: sign in', async () => {
    listAnswer = { data: { slug: 'x', owner: { username: null } }, error: null }
    const res = await middleware(request(`/app/lists?list=${LIST}`))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login')
  })

  it('no read for an id that isn’t a list id, or an address that opens no list', async () => {
    for (const path of ['/app/lists?list=not-an-id', '/app/lists', '/app/explore', '/app/rankings?list=' + LIST]) {
      const res = await middleware(request(path))
      expect(new URL(res.headers.get('location')!).pathname, path).toBe('/login')
    }
    expect(listReads).toHaveLength(0)
  })

  it('signed in → the phone screen is served, with no read', async () => {
    currentUser = { id: 'u1' }
    const res = await middleware(request(`/app/lists?list=${LIST}`))
    expect(res.status).toBe(200)
    expect(listReads).toHaveLength(0)
  })

  it('the redirect keeps the cookies the request produced (D148(b))', async () => {
    cookiesWritten = CLEARED
    listAnswer = { data: { slug: 'my-rb-sleepers', owner: { username: 'devpro' } }, error: null }
    const res = await middleware(request(`/app/lists?list=${LIST}`, 'sb-127-auth-token=base64-DEAD'))
    expect(res.status).toBe(307)
    expect(authCookie(res)).toMatch(/^sb-127-auth-token=;/)
  })
})

describe('signing in lands on the page that was opened, query string included', () => {
  it('a protected address with a query string keeps it in ?redirect', async () => {
    const res = await middleware(request('/app/leagues/join?code=ABC123'))
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('redirect')).toBe('/app/leagues/join?code=ABC123')
    expect([...location.searchParams.keys()]).toEqual(['redirect'])
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
