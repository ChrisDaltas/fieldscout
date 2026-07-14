import {
  computeMatchupFactors,
  rankSplits,
  splitKey,
  type WeeklyProjectionRow,
} from '@/lib/sports-data/splits'

import type { SyncClient, SyncSummary } from './types'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)

interface SleeperWeeklyProjectionRow {
  player_id: string
  opponent: string | null
  stats: { pts_half_ppr?: number | null } | null
}

async function fetchWeek(
  season: number,
  position: string,
  week: number,
): Promise<WeeklyProjectionRow[]> {
  const url = `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=regular&position[]=${position}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Weekly projections fetch failed (${position} wk${week}): ${res.status}`)
  }
  const rows = (await res.json()) as SleeperWeeklyProjectionRow[]
  return rows.flatMap((row) => {
    const points = Number(row.stats?.pts_half_ppr ?? NaN)
    if (!row.opponent || !Number.isFinite(points)) return []
    return [{ playerId: row.player_id, position, opponent: row.opponent, points }]
  })
}

/**
 * Implied defensive splits from matchup-adjusted weekly projections —
 * see lib/sports-data/splits.ts for the math. Run syncSos afterwards.
 */
export async function syncSplits(
  supabase: SyncClient,
  season: number,
): Promise<SyncSummary> {
  const rows: WeeklyProjectionRow[] = []
  const warnings: string[] = []

  for (const pos of POSITIONS) {
    let posRows = 0
    // 108 requests total — batched gently.
    for (let i = 0; i < WEEKS.length; i += 6) {
      const batch = WEEKS.slice(i, i + 6)
      const results = await Promise.all(batch.map((w) => fetchWeek(season, pos, w)))
      for (const r of results) {
        rows.push(...r)
        posRows += r.length
      }
    }
    if (posRows === 0) warnings.push(`${pos}: no opponent-tagged weekly projections`)
  }

  const splits = computeMatchupFactors(rows)
  const ranks = rankSplits(splits)

  const upserts = Array.from(splits.entries()).map(([key, split]) => {
    const [defense, position] = key.split('|')
    return {
      defense,
      position,
      season,
      factor: split.factor,
      rank: ranks.get(splitKey(defense, position)) ?? 0,
      sample_weeks: split.sampleWeeks,
      updated_at: new Date().toISOString(),
    }
  })

  if (upserts.length > 0) {
    const { error } = await supabase
      .from('defense_position_splits')
      .upsert(upserts, { onConflict: 'defense,position,season' })
    if (error) throw new Error(`splits upsert failed: ${error.message}`)
  }

  return {
    name: 'splits',
    counts: { playerWeeks: rows.length, splits: upserts.length },
    warnings,
  }
}
