import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
