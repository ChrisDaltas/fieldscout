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

/**
 * Drain a paginated Supabase query. The builder MUST apply a stable
 * .order(...) — PostgREST pages are unspecified without one, and unstable
 * pages silently drop rows between requests.
 */
export async function pageAll<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000
  let offset = 0
  const out: T[] = []
  while (true) {
    const { data, error } = await build(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return out
}
