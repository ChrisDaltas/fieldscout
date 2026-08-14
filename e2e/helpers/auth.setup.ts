import { expect, test as setup, type Page } from '@playwright/test'

import { DEV_PRO_USER, DEV_USER, LOCAL_URL, STORAGE_STATE } from './local-env'

/**
 * Storage-state login helper — M2 task L.B5.1 (the "deterministic seed.sql
 * users as auth fixtures" bullet). Runs once per `test:e2e` invocation as
 * the `setup` project; every spec reuses the saved cookie state.
 *
 * THE ENV-OVERRIDE PROOF lives here deliberately: the login POST is the
 * app's own first Supabase round-trip, and asserting its URL pins the
 * webServer to the LOCAL stack before any spec can write anywhere. If the
 * production env from `.env.local` ever leaked past the playwright.config
 * override, this fails the entire run at the door (no spec runs without
 * the `setup` dependency).
 */

async function loginAndSave(
  page: Page,
  user: { email: string; password: string },
  statePath: string,
): Promise<void> {
  await page.goto('/login')

  // Capture the sign-in call the app itself makes — the env assertion's
  // evidence. GoTrue password grant: POST <SUPABASE_URL>/auth/v1/token.
  const tokenRequest = page.waitForRequest(
    (req) => req.url().includes('/auth/v1/token') && req.method() === 'POST',
  )

  await page.locator('#email').fill(user.email)
  await page.locator('#password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const req = await tokenRequest
  // The load-bearing assertion: the app's auth traffic targets the LOCAL
  // stack, never the hosted project `.env.local` names.
  expect(
    req.url().startsWith(`${LOCAL_URL}/auth/v1/token`),
    `auth traffic must hit the local stack — saw ${req.url()}`,
  ).toBe(true)

  // The login page hard-navigates to /app on success.
  await page.waitForURL('**/app', { timeout: 60_000 })
  await page.context().storageState({ path: statePath })
}

setup('log in dev@ (commissioner fixture) against the LOCAL stack', async ({ page }) => {
  await loginAndSave(page, DEV_USER, STORAGE_STATE.dev)
})

setup('log in dev-pro@ (manager fixture) against the LOCAL stack', async ({ page }) => {
  await loginAndSave(page, DEV_PRO_USER, STORAGE_STATE.devPro)
})
