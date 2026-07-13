import {
  sleeperProjectionToStatRow,
  type ProjectedStatLine,
  type SleeperProjectedStats,
} from '@/lib/sports-data/sleeper'

import type { SyncClient, SyncSummary } from './types'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
type Position = (typeof POSITIONS)[number]

interface SleeperProjectionRow {
  player_id: string
  stats:
    | (SleeperProjectedStats & {
        pts_ppr?: number | null
        pts_std?: number | null
        pts_half_ppr?: number | null
        gp?: number | null
        adp_half_ppr?: number | null
        adp_ppr?: number | null
        adp_std?: number | null
      })
    | null
}

interface UpdateRow {
  id: string
  projected_pts_ppr: number | null
  projected_pts_standard: number | null
  projected_pts_half_ppr: number | null
  projected_games: number | null
  adp: number | null
  projected_stats: ProjectedStatLine
  projections_season: number
  projections_updated_at: string
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Sleeper uses 999 as an "undrafted / no data" sentinel on ADP fields. */
function toNullableAdp(value: unknown): number | null {
  const n = toNullableNumber(value)
  return n === null || n >= 999 ? null : n
}

/** App scoring defaults to half PPR, so that ADP wins; fall back sensibly. */
function pickAdp(stats: SleeperProjectionRow['stats']): number | null {
  return (
    toNullableAdp(stats?.adp_half_ppr) ??
    toNullableAdp(stats?.adp_ppr) ??
    toNullableAdp(stats?.adp_std)
  )
}

async function fetchProjections(
  season: number,
  position: Position,
): Promise<SleeperProjectionRow[]> {
  const url = `https://api.sleeper.com/projections/nfl/${season}?season_type=regular&position[]=${position}&order_by=adp_ppr`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Projections fetch failed for ${position}: ${res.status}`)
  }
  return (await res.json()) as SleeperProjectionRow[]
}

export async function fetchKnownPlayerIds(supabase: SyncClient): Promise<Set<string>> {
  const known = new Set<string>()
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('players')
      .select('id')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const r of data) known.add(r.id as string)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return known
}

/** Season projections: preset point totals, ADP, and the full projected
 *  stat line (StatRow convention) for custom scoring. */
export async function syncProjections(
  supabase: SyncClient,
  season: number,
): Promise<SyncSummary> {
  const known = await fetchKnownPlayerIds(supabase)

  const updates = new Map<string, UpdateRow>()
  const now = new Date().toISOString()
  let skippedNoMatch = 0
  let skippedNoPoints = 0

  for (const pos of POSITIONS) {
    const rows = await fetchProjections(season, pos)
    for (const row of rows) {
      const id = row.player_id
      if (!known.has(id)) {
        skippedNoMatch++
        continue
      }
      const ppr = toNullableNumber(row.stats?.pts_ppr)
      const std = toNullableNumber(row.stats?.pts_std)
      const half = toNullableNumber(row.stats?.pts_half_ppr)
      if (ppr === null && std === null && half === null) {
        skippedNoPoints++
        continue
      }

      // Sleeper returns multiple rows per player (different companies). Take
      // the entry with the largest non-null PPR value — overwhelmingly the
      // rotowire row, consistent across positions.
      const adp = pickAdp(row.stats)
      const existing = updates.get(id)
      if (existing && (existing.projected_pts_ppr ?? 0) >= (ppr ?? 0)) {
        // Losing row can still contribute ADP if the winner had none.
        if (existing.adp === null && adp !== null) existing.adp = adp
        continue
      }

      updates.set(id, {
        id,
        projected_pts_ppr: ppr,
        projected_pts_standard: std,
        projected_pts_half_ppr: half,
        projected_games: toNullableNumber(row.stats?.gp),
        // Keep a previously-seen ADP when the winning row lacks one.
        adp: adp ?? existing?.adp ?? null,
        projected_stats: sleeperProjectionToStatRow(row.stats),
        projections_season: season,
        projections_updated_at: now,
      })
    }
  }

  // Per-row update so we don't clobber unrelated columns on `players`.
  const all = Array.from(updates.values())
  const BATCH = 200
  let written = 0
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map((row) =>
        supabase
          .from('players')
          .update({
            projected_pts_ppr: row.projected_pts_ppr,
            projected_pts_standard: row.projected_pts_standard,
            projected_pts_half_ppr: row.projected_pts_half_ppr,
            projected_games: row.projected_games,
            adp: row.adp,
            projected_stats: row.projected_stats,
            projections_season: row.projections_season,
            projections_updated_at: row.projections_updated_at,
          })
          .eq('id', row.id),
      ),
    )
    for (const r of results) {
      if (r.error) throw new Error(`projections update failed: ${r.error.message}`)
    }
    written += batch.length
  }

  return {
    name: 'projections',
    counts: { written, skippedNoMatch, skippedNoPoints },
    warnings: [],
  }
}
