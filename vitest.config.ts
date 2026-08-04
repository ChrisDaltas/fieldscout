import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

// Mirror tsconfig's "@/*" → "src/*" so tests can import modules that use
// the app's path alias.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // Never collect tests from agent worktree checkouts (.claude/worktrees/*):
    // they duplicate every suite and the stack-backed ones race the real runs
    // against the same local Supabase fixtures (observed 2026-08-03, L.B1.1 —
    // 78 collected files = 2×39, auth-fixture collisions).
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
