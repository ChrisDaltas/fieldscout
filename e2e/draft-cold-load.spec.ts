import { readFileSync } from 'node:fs'
import path from 'node:path'

import { expect, test, type BrowserContext } from '@playwright/test'

import {
  assertPlayerPoolPresent,
  cleanupSweep,
  serviceClient,
} from './helpers/harness'
import { provisionLeague, signInDev, signInDevPro } from './helpers/provision'
import { DEV_USER, STORAGE_STATE } from './helpers/local-env'

/**
 * Spec (e) — the draft room's COLD LOAD (DR.8; spec §16.1 v2.12 "the route
 * must render correctly from a COLD LOAD every time"; PROGRESS F63; D148).
 *
 * The redesign made the cold tab the room's PRIMARY entry (desktop in-app
 * entry opens a NEW browser tab — §16.1's platform split), and DR.1's hunt
 * found a real middleware defect on exactly that path: both redirect
 * branches returned a bare `NextResponse.redirect(...)`, which drops the
 * auth cookies `setAll` had just written — a refreshed session's ROTATED
 * refresh token was discarded, leaving the browser holding one the auth
 * server had already spent (and the failure direction dropped cookie
 * REMOVALS, leaving dead cookies that re-fail forever). Fixed in DR.1 via
 * `redirectPreservingAuthCookies` (`src/middleware.ts`), unit-pinned in
 * `src/middleware.test.ts`. THIS spec is the browser-level regression F63
 * left open: it loads the room URL DIRECTLY — no in-app navigation — on
 * real sessions against the local stack (the webServer runs with
 * `NEXT_PUBLIC_DEV_AUTH=false`, so no dev auto-login can paper over an
 * auth bug), and its third test asserts the cookie-preserving redirect at
 * the HTTP level, the same differential DR.1 measured by hand.
 *
 * The four §16.1 cold paths, mapped: (a) paste-URL/fresh tab = test 1's
 * fresh-context direct goto; (b) refresh mid-draft = test 1's reload; (c)
 * external deep link = the same server-side shape as (a) (a cold
 * navigation with no client history — no referrer distinction reaches the
 * route); (d) the DR.6 desktop new tab = test 4, through the league home's
 * real `Join draft` anchor (`use-room-entry-target`'s `_blank` arm).
 */

const ROOM_BAR = 'header[aria-label="Draft command bar"]'

/**
 * A storage state whose Supabase auth cookie says the ACCESS TOKEN IS
 * EXPIRED while the refresh token stays valid — the exact client state
 * that makes middleware's `getUser()` rotate the session mid-request
 * (D148(b)'s trigger). The cookie is `base64-<base64url(session JSON)>`
 * with an `expires_at` the client checks before the server ever sees the
 * JWT; rewinding it forces the refresh path deterministically. Fails
 * loudly if the cookie shape ever changes (chunked `.0`/`.1` cookies,
 * new encoding) rather than silently testing nothing.
 */
function expiredAccessTokenState(statePath: string): {
  cookies: Array<Record<string, unknown>>
  origins: unknown[]
} {
  const state = JSON.parse(
    readFileSync(path.resolve(process.cwd(), statePath), 'utf8'),
  ) as { cookies: Array<{ name: string; value: string }>; origins: unknown[] }
  const authCookies = state.cookies.filter(
    (c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'),
  )
  if (authCookies.length !== 1 || !authCookies[0]!.value.startsWith('base64-')) {
    throw new Error(
      `expected exactly one un-chunked base64 sb-*-auth-token cookie, found ` +
        `${authCookies.length} (${authCookies.map((c) => c.name).join(', ') || 'none'}) — ` +
        `the @supabase/ssr cookie shape changed; update expiredAccessTokenState`,
    )
  }
  const cookie = authCookies[0]!
  const session = JSON.parse(
    Buffer.from(cookie.value.slice('base64-'.length), 'base64url').toString('utf8'),
  ) as { expires_at?: number }
  session.expires_at = Math.floor(Date.now() / 1000) - 3600
  cookie.value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
  return state as never
}

test.describe('draft room cold load (F63 / spec §16.1 v2.12)', () => {
  let roomPath: string
  let leaguePath: string

  test.beforeAll(async () => {
    const service = serviceClient()
    await cleanupSweep(service)
    await assertPlayerPoolPresent(service)
    const commishAuth = await signInDev()
    const managerAuth = await signInDevPro()
    const league = await provisionLeague({
      nameSuffix: 'cold load',
      teamCount: 8,
      rounds: 2,
      clockSeconds: 60,
      commish: commishAuth,
      manager: managerAuth,
      order: 'commish-first',
      createDraftRow: true,
      start: true, // the LIVE room — the strongest cold-load target
    })
    roomPath = `/app/leagues/${league.leagueId}/draft`
    leaguePath = `/app/leagues/${league.leagueId}`
  })

  test.afterAll(async () => {
    await cleanupSweep(serviceClient())
  })

  test('(a)+(b) authenticated direct load renders the LIVE room — and survives a mid-draft refresh', async ({
    browser,
  }) => {
    // A fresh context + a direct goto IS the cold tab: no client history,
    // no in-app navigation, server-rendered from the cookie alone.
    const context = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const page = await context.newPage()
      await page.goto(roomPath)

      // Not bounced: the reported failure shape was a 307 chain ending at
      // `/app?redirect=…` — the URL must still be the room's.
      expect(new URL(page.url()).pathname).toBe(roomPath)
      await expect(page.locator(ROOM_BAR)).toBeVisible()
      await expect(page.getByText("You're on the clock").first()).toBeVisible({
        timeout: 30_000,
      })

      // (b) refresh mid-draft — the same cold render, second time around.
      await page.reload()
      expect(new URL(page.url()).pathname).toBe(roomPath)
      await expect(page.locator(ROOM_BAR)).toBeVisible()
      await expect(page.getByText("You're on the clock").first()).toBeVisible({
        timeout: 30_000,
      })
    } finally {
      await context.close()
    }
  })

  test('(c) anonymous cold load bounces to /login WITH the room preserved — and login lands IN the room', async ({
    browser,
  }) => {
    const context = await browser.newContext() // no storage state — anonymous
    try {
      const page = await context.newPage()
      await page.goto(roomPath)

      // The middleware guard: /login carrying the room as ?redirect.
      const bounced = new URL(page.url())
      expect(bounced.pathname).toBe('/login')
      expect(bounced.searchParams.get('redirect')).toBe(roomPath)

      // The REAL login form (NEXT_PUBLIC_DEV_AUTH=false — no auto-login).
      await page.locator('#email').fill(DEV_USER.email)
      await page.locator('#password').fill(DEV_USER.password)
      await page.getByRole('button', { name: 'Sign in' }).click()

      // login/page.tsx honors ?redirect — the user lands in the ROOM, not
      // on the app home.
      await page.waitForURL(`**${roomPath}`, { timeout: 60_000 })
      await expect(page.locator(ROOM_BAR)).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('the middleware redirect KEEPS rotated auth cookies (D148(b) — the F63 defect stays fixed)', async ({
    browser,
  }) => {
    // The client state that rotates the session mid-request: expired
    // access token, valid refresh token. Middleware's `getUser()` spends
    // the refresh token and `setAll` writes the NEW pair — a redirect
    // response that drops it strands the browser on a refresh token the
    // auth server has already rotated away (the pre-DR.1 defect).
    const context: BrowserContext = await browser.newContext({
      storageState: expiredAccessTokenState(STORAGE_STATE.dev) as never,
    })
    try {
      const page = await context.newPage()

      // The redirect branch DR.1 measured: an authenticated hit on an auth
      // page 307s to /app. `context.request` shares the browser cookie
      // jar; maxRedirects: 0 exposes the raw redirect response.
      const res = await context.request.get(
        `/login?redirect=${encodeURIComponent(roomPath)}`,
        { maxRedirects: 0 },
      )
      expect(res.status()).toBe(307)
      expect(res.headers()['location']).toContain('/app')

      // THE PIN (D148(b)): the 307 carries the rotated session. Pre-fix
      // this response had NO set-cookie at all — measured 2026-08-18 and
      // re-shown by this spec's break probe (helper reverted to a bare
      // NextResponse.redirect).
      const setCookies = res
        .headersArray()
        .filter((h) => h.name.toLowerCase() === 'set-cookie')
      expect(
        setCookies.length,
        'the redirect must Set-Cookie the rotated auth session (redirectPreservingAuthCookies)',
      ).toBeGreaterThan(0)
      expect(
        setCookies.some((h) => h.value.startsWith('sb-')),
        `expected an sb-* auth cookie on the redirect; saw: ${setCookies
          .map((h) => h.value.split('=')[0])
          .join(', ')}`,
      ).toBe(true)

      // Follow-through: the jar now holds the rotated pair, so the session
      // SURVIVED the bounce — the room renders, no re-login.
      await page.goto(roomPath)
      expect(new URL(page.url()).pathname).toBe(roomPath)
      await expect(page.locator(ROOM_BAR)).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('(d) the DR.6 desktop new tab: league-home Join draft opens the room in a NEW tab that cold-loads', async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: STORAGE_STATE.dev })
    try {
      const page = await context.newPage() // desktop viewport → the _blank arm
      await page.goto(leaguePath)
      const joinLink = page.getByRole('link', { name: 'Join draft' })
      await expect(joinLink).toBeVisible()
      // `use-room-entry-target` upgrades to _blank on mount at ≥lg + fine
      // pointer; the popup IS a fresh server-rendered cold start.
      await expect(joinLink).toHaveAttribute('target', '_blank')
      const [roomPage] = await Promise.all([
        context.waitForEvent('page'),
        joinLink.click(),
      ])
      await roomPage.waitForLoadState()
      expect(new URL(roomPage.url()).pathname).toBe(roomPath)
      await expect(roomPage.locator(ROOM_BAR)).toBeVisible()
    } finally {
      await context.close()
    }
  })
})
