/**
 * Shared plumbing for the sync:* CLI wrappers — env, service-role client,
 * season parsing, summary printing. The actual sync logic lives in
 * src/lib/sync/* so the weekly cron routes run the same code.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

import type { SyncClient, SyncSummary } from '../src/lib/sync/types'

config({ path: resolve(process.cwd(), '.env.local') })

export function cliClient(): SyncClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function cliSeason(fallbackOffset = 0): number {
  const arg = process.argv[2]
  const season = Number(
    arg ?? Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026) + fallbackOffset,
  )
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    console.error(`Invalid season: ${season}`)
    process.exit(1)
  }
  return season
}

export function printSummary(summary: SyncSummary) {
  const counts = Object.entries(summary.counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  console.log(`Done [${summary.name}] ${counts}`)
  for (const w of summary.warnings) console.warn(`  warning: ${w}`)
}

export function fail(err: unknown): never {
  console.error(err)
  process.exit(1)
}
