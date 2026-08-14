/**
 * Local-stack coordinates for the E2E harness — M2 task L.B5.1.
 *
 * SAFETY CONTRACT (the R207 lesson, applied to Playwright): `.env.local`
 * points at HOSTED PRODUCTION, so nothing in this suite may ever read it.
 * These constants are the same standard local-dev demo JWTs every
 * `*-db.test.ts` suite pins (they are identical on every `supabase start`
 * install and secret to no one), overridable through the same
 * `SUPABASE_LOCAL_*` env names. playwright.config.ts injects them into the
 * `next dev` webServer env — explicit process env beats `.env.local` in
 * Next.js, the exact mechanism the gitignored `dev-local` launch config
 * proves daily — and `auth.setup.ts` ASSERTS the app's own auth traffic
 * lands on 127.0.0.1:54321 before any spec runs.
 */

export const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? 'http://127.0.0.1:54321'

export const LOCAL_ANON_KEY =
  process.env.SUPABASE_LOCAL_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export const LOCAL_SERVICE_ROLE_KEY =
  process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

/** The `next dev` webServer port — dedicated to E2E (3000 = dev, 3123 =
 *  dev-local); baseURL in playwright.config.ts derives from it. */
export const E2E_PORT = 4310

export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`

/** The deterministic seed.sql users (tasks-M2 §2 — the pre-solved auth
 *  fixture problem). Passwords are local-dev only, seeded on every reset. */
export const DEV_USER = {
  email: 'dev@fieldscout.local',
  password: 'dev-password-1234',
  id: '11111111-1111-4111-8111-111111111111',
  username: 'dev_user',
} as const

export const DEV_PRO_USER = {
  email: 'dev-pro@fieldscout.local',
  password: 'dev-password-1234',
  id: '22222222-2222-4222-8222-222222222222',
  username: 'devpro',
} as const

/** Storage-state paths (gitignored — minted fresh by auth.setup.ts). */
export const STORAGE_STATE = {
  dev: 'e2e/.auth/dev.json',
  devPro: 'e2e/.auth/dev-pro.json',
} as const

/**
 * Fixture identity — every league this suite creates carries this name
 * prefix, and the harness cleanup sweeps by it (the R285 loud-cleanup
 * class; unique in the repo — the sim owns 'SIM L.B6.1', wire suites their
 * vitest-* names). No fixed action-id literals exist in this suite
 * (crypto.randomUUID per submit — the D123(2) precedent), so no D108(14)
 * prefix registration is needed beyond this name.
 */
export const E2E_LEAGUE_PREFIX = 'E2E L.B5.1'
