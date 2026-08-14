import path from 'node:path'
import { configDefaults } from 'vitest/config'

/**
 * Shared vitest config pieces (L.B7.1) — imported by the root config
 * (vitest.config.ts, which carries the unit/stack projects split) AND by
 * the flat gate configs (vitest.gate-m1/m2.config.ts, which must NOT merge
 * a projects config — a root `include` merged onto one is silently
 * ignored). Kept out of vitest.config.ts so that file only default-exports
 * (a config entry module with mixed exports trips rolldown's
 * MIXED_EXPORTS warning on every run).
 */

// Mirror tsconfig's "@/*" → "src/*" so tests can import modules that use
// the app's path alias.
export const resolveAlias = {
  '@': path.resolve(__dirname, 'src'),
}

/**
 * Never collect tests from agent worktree checkouts (.claude/worktrees/*):
 * they duplicate every suite and the stack-backed ones race the real runs
 * against the same local Supabase fixtures (observed 2026-08-03, L.B1.1 —
 * 78 collected files = 2×39, auth-fixture collisions).
 * e2e/** is Playwright's (L.B5.1): its *.spec.ts files match vitest's
 * default include and would be collected — and immediately fail — here.
 */
export const sharedExclude = [...configDefaults.exclude, '.claude/**', 'e2e/**']

/** The STACK-BACKED suites — everything that talks to the local Supabase
 *  stack (D59(5)). Exactly the `test:stack` filter set: every *-db.test.ts
 *  plus the m1-gate journey. */
export const stackInclude = ['**/*-db.test.ts', 'src/lib/leagues/m1-gate/**/*.test.ts']
