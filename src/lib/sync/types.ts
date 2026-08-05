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

/** Null-preserving numeric coercion shared by the sync modules. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Lives in @/lib/supabase/page-all now — app routes need it too, and an
// app → sync import reads wrong. Re-exported so sync callers are unchanged.
export { pageAll } from '@/lib/supabase/page-all'
