import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Mirror tsconfig's "@/*" → "src/*" so tests can import modules that use
// the app's path alias.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
