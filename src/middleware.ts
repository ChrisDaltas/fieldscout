import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { publicPersonPath } from '@/components/shared/username-link-ops'
import {
  classifyRateLimitedRequest,
  parseRateLimitTake,
  rateLimitedResponseParts,
  type RateLimitTarget,
} from '@/lib/rate-limit/route-limits'

const PROTECTED_PATHS = ['/app']
const AUTH_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password', '/username']

/**
 * A redirect that KEEPS the auth cookies this request already produced.
 *
 * `supabase.auth.getUser()` may rotate the session: when the access token has
 * expired it spends the refresh token, and `setAll` writes the new pair onto
 * `supabaseResponse`. A bare `NextResponse.redirect(...)` is a DIFFERENT
 * response object, so returning one throws that write away — the documented
 * `@supabase/ssr` footgun. The browser then keeps the OLD refresh token, which
 * the auth server has just rotated away, and the next request signs the user
 * out. The same applies to the failure direction: a refresh that fails makes
 * supabase-js REMOVE the cookies, and dropping that leaves dead cookies behind
 * that re-fail on every subsequent request.
 *
 * Measured on the local stack 2026-08-18 (DR.1 / D148(b)), same cookie state,
 * two branches: `GET /app/leagues/<id>/draft` with an expired access token and
 * a valid refresh token returned `200` **with** `set-cookie`; `GET
 * /login?redirect=<room>` with the identical cookie returned `307` with **no
 * `set-cookie` at all**. Pinned in `middleware.test.ts`.
 *
 * This is on the draft room's primary entry path: an anonymous cold load of
 * the room is redirected to `/login?redirect=<room>`, which is precisely the
 * auth-page branch below.
 */
function redirectPreservingAuthCookies(
  url: URL,
  supabaseResponse: NextResponse,
): NextResponse {
  const redirect = NextResponse.redirect(url)
  for (const cookie of supabaseResponse.cookies.getAll()) {
    redirect.cookies.set(cookie)
  }
  return redirect
}

/**
 * §22.5 route-layer rate limits (M7 L.F2.6; migration 209; PROGRESS D700–D706).
 * One `rate_limit_take` per league / practice-draft write, as the signed-in
 * member (the door spends only the caller's own allowance). Returns the 429
 * to send, or `null` to let the request through.
 *
 * FAILS OPEN — any limiter error (the function not pushed yet: PGRST202; a
 * database blip; a call slower than 1.5 s; a caller who is not a member of
 * the scope, 42501 — the route's own gate answers him; an answer of the
 * wrong shape) lets the request through and
 * logs it. A missing limiter is today's behaviour (tasks-M7 §7 deploy
 * safety), and a limiter fault must never stop a draft; the route's own RPC
 * is the authority either way. A refusal is never silent: 429, plain words,
 * `Retry-After`, and the auth cookies this request produced (the same
 * footgun as the redirects above).
 */
const RATE_LIMIT_TIMEOUT_MS = 1500

async function rateLimitRefusal(
  supabase: ReturnType<typeof createServerClient>,
  target: RateLimitTarget,
  supabaseResponse: NextResponse,
): Promise<NextResponse | null> {
  try {
    // R1690: a slow limiter must never hold up a pick — after 1.5 s the
    // call is abandoned and the request goes through (fail open, below).
    const { data, error } = await supabase
      .rpc('rate_limit_take', { p_bucket: target.bucket, p_scope: target.scope })
      .abortSignal(AbortSignal.timeout(RATE_LIMIT_TIMEOUT_MS))
    if (error) {
      // R1695: 42501 is the door saying "not a member of this league / draft"
      // — an expected pass-through (the route's own gate answers him), not a
      // fault, so it is not logged.
      if (error.code === '42501') return null
      console.error('[rate-limit] limiter unavailable, letting the request through:', error.code, error.message)
      return null
    }
    const take = parseRateLimitTake(data)
    if (!take) {
      console.error('[rate-limit] limiter answered an unexpected shape, letting the request through')
      return null
    }
    if (take.allowed) return null

    const { body, retryAfter } = rateLimitedResponseParts(target.bucket, take.retry_after_ms)
    const refusal = NextResponse.json(body, { status: 429, headers: { 'Retry-After': retryAfter } })
    for (const cookie of supabaseResponse.cookies.getAll()) {
      refusal.cookies.set(cookie)
    }
    return refusal
  } catch (err) {
    console.error('[rate-limit] limiter threw, letting the request through:', err)
    return null
  }
}

/** R1688: classify what the router will route — `%xx` escapes decoded
 *  (an encoded id must not slip past the UUID match); a malformed escape
 *  falls back to the raw path. */
function decodedPathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  const rateLimitTarget = user ? classifyRateLimitedRequest(request.method, decodedPathname(pathname)) : null
  if (rateLimitTarget) {
    const refusal = await rateLimitRefusal(supabase, rateLimitTarget, supabaseResponse)
    if (refusal) return refusal
  }

  // A person's phone screen (`/app/u/…`) is the public profile in the app's
  // phone layout, and its address gets shared from a phone. Signed out, it
  // opens the public page itself instead of asking you to sign in.
  const publicPerson = user ? null : publicPersonPath(pathname)
  if (publicPerson) {
    const publicUrl = request.nextUrl.clone()
    publicUrl.pathname = publicPerson
    publicUrl.search = ''
    return redirectPreservingAuthCookies(publicUrl, supabaseResponse)
  }

  // Redirect unauthenticated users away from protected routes
  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p))
  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirect', pathname)
    return redirectPreservingAuthCookies(loginUrl, supabaseResponse)
  }

  // Redirect authenticated users away from auth pages (except username selection)
  const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p))
  if (isAuthPage && user && !pathname.startsWith('/username') && !pathname.startsWith('/reset-password')) {
    const appUrl = request.nextUrl.clone()
    appUrl.pathname = '/app'
    return redirectPreservingAuthCookies(appUrl, supabaseResponse)
  }

  // Signed-in visitors skip the public landing page and go to the app (F744).
  // This lives here, not in `src/app/page.tsx`, so the landing page reads no
  // cookies and builds as a static page — a page that renders per request has
  // its <title> and meta description streamed into <body>, after </head>.
  if (pathname === '/' && user) {
    const appUrl = request.nextUrl.clone()
    appUrl.pathname = '/app'
    appUrl.search = ''
    return redirectPreservingAuthCookies(appUrl, supabaseResponse)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
