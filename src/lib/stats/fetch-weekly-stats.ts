import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fetch weekly player_stats rows for many players, chunking the .in()
 * filter so we never trip Supabase's 1000-row PostgREST cap.
 *
 * Why this exists: PostgREST returns at most 1000 rows per SELECT regardless
 * of `.range()`. With ~850 players × ~21 weekly rows per player = ~17,000
 * rows, a single .in('player_id', allIds) silently truncates to the first
 * 1000, leaving most players with zero aggregated stats. Symptom: top
 * fantasy guys (Jonathan Taylor, etc.) showing 0 last-season points and 0
 * projections in the UI.
 *
 * Always use this helper instead of issuing a one-shot .in() query against
 * player_stats — that's the trap.
 */

// Conservative: 50 players × ≤21 rows ≈ ≤1050 rows per chunk. Keeps each
// individual query well below the cap with margin for outlier players.
const PLAYER_CHUNK_SIZE = 50

export interface FetchWeeklyStatsArgs {
  supabase: SupabaseClient
  playerIds: string[]
  seasons: number[]
  /** Column list passed to .select() — caller controls the projection. */
  select: string
  /** When true, also include rows where week IS NULL (season totals). */
  includeWeekNull?: boolean
}

export async function fetchWeeklyStatsForPlayers<T = Record<string, unknown>>({
  supabase,
  playerIds,
  seasons,
  select,
  includeWeekNull = false,
}: FetchWeeklyStatsArgs): Promise<T[]> {
  if (playerIds.length === 0) return []

  const chunks: string[][] = []
  for (let i = 0; i < playerIds.length; i += PLAYER_CHUNK_SIZE) {
    chunks.push(playerIds.slice(i, i + PLAYER_CHUNK_SIZE))
  }

  // Run chunks in parallel — they're independent reads. With ~17 chunks at
  // ~50ms each, sequential would add ~800ms; parallel keeps it to one
  // round-trip's worth.
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      let q = supabase
        .from('player_stats')
        .select(select)
        .in('player_id', chunk)
        .in('season', seasons)
      if (!includeWeekNull) q = q.not('week', 'is', null)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return (data ?? []) as T[]
    }),
  )

  return results.flat()
}
