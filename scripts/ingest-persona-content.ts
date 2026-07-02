/**
 * Manual/local run of the daily persona content ingestion (Slice B) —
 * same engine the Vercel cron route calls.
 *
 *   npm run ingest:personas
 *
 * Change-gated: quiet feeds cost zero paid calls. Requires
 * ANTHROPIC_API_KEY plus seeded persona_sources rows.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import { ingestPersonaContent } from '../src/lib/personas/ingest'

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
  const summary = await ingestPersonaContent(supabase)
  console.log(
    `personas: ${summary.personas} · sources checked: ${summary.sourcesChecked} · with new content: ${summary.sourcesWithNewContent}`,
  )
  console.log(
    `items ingested: ${summary.itemsIngested} · contexts refreshed: ${summary.contextsRefreshed}`,
  )
  if (summary.errors.length > 0) {
    console.error(`\n${summary.errors.length} error(s):`)
    for (const e of summary.errors) console.error(`  ✗ ${e}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
