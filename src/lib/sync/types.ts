import type { SupabaseClient } from '@supabase/supabase-js'

/** Sync functions accept both the untyped script client and the typed
 *  admin client — sync code works in generic rows either way. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SyncClient = SupabaseClient<any, any, any>

/** Uniform summary every sync step returns — the cron route reports these. */
export interface SyncSummary {
  name: string
  /** Step-specific counters (rows written, teams ranked, …). */
  counts: Record<string, number>
  warnings: string[]
}
