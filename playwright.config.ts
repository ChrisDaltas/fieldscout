import { defineConfig, devices } from '@playwright/test'

import {
  E2E_BASE_URL,
  E2E_PORT,
  LOCAL_ANON_KEY,
  LOCAL_SERVICE_ROLE_KEY,
  LOCAL_URL,
} from './e2e/helpers/local-env'

/**
 * Playwright bootstrap — M2 task L.B5.1 (delivery plan §4.1 E2E row; spec
 * §19.3; D39/C14/C22 discharge). `npm run test:e2e` — CLAUDE.md's command
 * is finally true.
 *
 * ENVIRONMENT SAFETY (the load-bearing block): `.env.local` points at
 * HOSTED PRODUCTION. The webServer below therefore launches `next dev`
 * with the LOCAL stack's coordinates in its process env — Next.js gives
 * explicit env precedence over `.env.local`, the same mechanism the
 * gitignored `dev-local` launch config uses (ACTIVE-BUILD's documented
 * pattern, network-confirmed in every D39 pass). All four names the app
 * reads are overridden (client, SSR server, middleware AND the service-role
 * admin client), and `auth.setup.ts` asserts the app's real auth traffic
 * lands on 127.0.0.1:54321 before any spec runs — a leak fails loudly
 * before anything writes.
 *
 * SERIALIZATION (workers: 1, fullyParallel: false): the four specs share
 * the two seed.sql users, one local stack, and run BESIDE the live 5s
 * `draft-tick` pg_cron — the F52 flake family is what parallel stack-backed
 * suites bought M2; the E2E lane does not re-buy it.
 *
 * RETRIES: 0 — plan §5.2's flake policy: a flaky draft spec is a real
 * concurrency bug until proven otherwise; auto-retry would launder it.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  // `next dev` compiles routes on first hit — generous budgets so a cold
  // compile is never mistaken for a hang. Draft-to-completion specs set
  // their own longer test timeouts.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: E2E_BASE_URL,
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // Logs in both seed users through the real /login UI, asserts the
      // auth POST hit the LOCAL stack (the env-override proof), saves
      // storage states for the specs.
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `npx next dev --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    // NEVER attach to an already-running server: an ambient `npm run dev`
    // carries `.env.local`'s production env. A busy port fails loudly
    // instead (prefer loud failure — CLAUDE.md).
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
      SUPABASE_URL: LOCAL_URL,
      SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_ROLE_KEY,
      // `.env.local` turns the dev-auth auto-login on — under E2E it would
      // hijack the login flow (any session-less context silently becomes
      // dev@) and hide real auth behavior. Off, explicitly.
      NEXT_PUBLIC_DEV_AUTH: 'false',
    },
  },
})
