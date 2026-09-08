import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'

let cached: SupabaseClient | null = null

/**
 * Service-role Supabase client for server-only use cases that need to read
 * across users — e.g. rendering another user's public weekly Big Board (the
 * `big_board_weekly` table is locked to owner-only via RLS by spec).
 *
 * Never import this from client components.
 */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase admin client missing env (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).',
    )
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}

let cachedTyped: SupabaseClient<Database> | null = null

/**
 * The same service-role client, TYPED against the generated schema — what
 * the league workers take (`ScoreWorkerClient`, `FlagsClient`): the cron
 * routes that drive `runScoreWeekBatch` / `reconcileSeason` /
 * `runLivePollInvocation` bind it (L.D2.3). Server-only, like the one above.
 */
export function createTypedAdminClient(): SupabaseClient<Database> {
  if (cachedTyped) return cachedTyped
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase admin client missing env (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).',
    )
  }
  cachedTyped = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cachedTyped
}
