/**
 * Generate themed persona posts (spec-ai-content-engine.md, Slice C) —
 * same engine the weekly cron route calls. Posts land as DRAFTS for the
 * admin review gate at /app/admin/posts.
 *
 *   npm run generate:posts                          # all personas × active themes (capped per run)
 *   npm run generate:posts bathew-merry-ai          # one persona
 *   npm run generate:posts bathew-merry-ai top-busts  # one persona, one theme
 *
 * Requires ANTHROPIC_API_KEY. Idempotent: existing (persona, theme, season)
 * posts are skipped.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import { generatePersonaContentRun } from '../src/lib/personas/posts'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main(): Promise<void> {
  const summary = await generatePersonaContentRun(supabase, {
    personaFilter: process.argv[2],
    themeFilter: process.argv[3],
  })
  console.log(
    `\npersonas: ${summary.personas} · drafts created: ${summary.created} · skipped: ${summary.skipped}`,
  )
  if (summary.created > 0) {
    console.log('Review and publish drafts at /app/admin/posts.')
  }
  if (summary.errors.length > 0) {
    console.error(`\n${summary.errors.length} note(s):`)
    for (const e of summary.errors) console.error(`  ! ${e}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
