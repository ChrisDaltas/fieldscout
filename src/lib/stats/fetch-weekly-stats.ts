import type { SupabaseClient } from '@supabase/supabase-js'

import { pageAll, type PageResponse } from '@/lib/supabase/page-all'

/**
 * Fetch weekly player_stats rows for many players without tripping
 * Supabase's 1000-row PostgREST cap.
 *
 * Why this exists: PostgREST returns at most 1000 rows per *response*. With
 * ~1100 players × ~21 weekly rows × 2 seasons, a single
 * .in('player_id', allIds) silently truncates to the first 1000, leaving most
 * players with zero aggregated stats. Symptom: top fantasy guys (Jonathan
 * Taylor, etc.) showing 0 last-season points and 0 projections in the UI.
 *
 * Two mechanisms, and both are load-bearing:
 *   - chunking bounds the fan-out per query (and keeps URLs sane), and
 *   - pageAll drains each chunk, because a chunk CAN exceed 1000 rows on its
 *     own (50 players × 21 weeks × 2 seasons ≈ 2100 worst case).
 * The cap is per response, not per query — `.range()` paging does get past
 * it, which is exactly what pageAll does.
 *
 * Always use this helper instead of issuing a one-shot .in() query against
 * player_stats — that's the trap.
 */

// Bounds fan-out per request; pageAll handles any chunk that still exceeds
// the per-response cap.
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
    chunks.map((chunk) =>
      pageAll<T>((from, to) => {
        let q = supabase
          .from('player_stats')
          .select(select, { count: 'exact' })
          .in('player_id', chunk)
          .in('season', seasons)
        if (!includeWeekNull) q = q.not('week', 'is', null)
        return (
          q
            .order('player_id', { ascending: true })
            .order('season', { ascending: true })
            .order('week', { ascending: true })
            // Unique final tiebreak. (player_id, season, week) is NOT unique
            // when includeWeekNull is on — Postgres treats NULL weeks as
            // distinct — and unstable pages drop rows at the boundary.
            .order('id', { ascending: true })
            .range(from, to) as unknown as PageResponse<T>
        )
      }),
    ),
  )

  return results.flat()
}
