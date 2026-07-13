import {
  computeSosRanks,
  computeTeamStrength,
} from '@/lib/sports-data/sos'
import {
  computePositionalSosRanks,
  splitKey,
  type SplitsByDefensePosition,
} from '@/lib/sports-data/splits'

import { fetchSchedule } from './schedule'
import type { SyncClient, SyncSummary } from './types'

async function loadSplits(
  supabase: SyncClient,
  season: number,
): Promise<SplitsByDefensePosition> {
  const { data, error } = await supabase
    .from('defense_position_splits')
    .select('defense, position, factor')
    .eq('season', season)
  if (error) throw new Error(`splits query failed: ${error.message}`)
  const splits: SplitsByDefensePosition = new Map()
  for (const row of data ?? []) {
    splits.set(splitKey(row.defense as string, row.position as string), {
      factor: Number(row.factor),
      sampleWeeks: 0,
    })
  }
  return splits
}

/**
 * Stamp players.sos (rank 1-32, 1 = easiest). Preferred basis: positional
 * splits (per team × position); falls back to projection-weighted team
 * strength when no splits exist for the season.
 */
export async function syncSos(
  supabase: SyncClient,
  season: number,
): Promise<SyncSummary> {
  const games = await fetchSchedule(season)
  const splits = await loadSplits(supabase, season)

  if (splits.size > 0) {
    const ranks = computePositionalSosRanks(games, splits)
    let updated = 0
    for (const [key, rank] of ranks) {
      const [team, position] = key.split('|')
      const { error, count } = await supabase
        .from('players')
        .update({ sos: rank }, { count: 'exact' })
        .eq('team', team)
        .eq('position', position)
      if (error) throw new Error(`sos update failed for ${team} ${position}: ${error.message}`)
      updated += count ?? 0
    }
    return {
      name: 'sos',
      counts: { schedules: ranks.size, players: updated },
      warnings: [],
    }
  }

  // Fallback: team-level rank from projection-weighted team strength.
  const { data: players, error } = await supabase
    .from('players')
    .select('team, projected_pts_half_ppr')
    .not('team', 'is', null)
    .not('projected_pts_half_ppr', 'is', null)
  if (error) throw new Error(`players query failed: ${error.message}`)

  const strength = computeTeamStrength(
    (players ?? []).map((p) => ({
      team: p.team as string,
      projected: p.projected_pts_half_ppr as number,
    })),
  )
  const ranks = computeSosRanks(games, strength)

  let updated = 0
  for (const [team, rank] of ranks) {
    const { error: updateError, count } = await supabase
      .from('players')
      .update({ sos: rank }, { count: 'exact' })
      .eq('team', team)
    if (updateError) throw new Error(`sos update failed for ${team}: ${updateError.message}`)
    updated += count ?? 0
  }
  return {
    name: 'sos',
    counts: { teams: ranks.size, players: updated },
    warnings: ['no splits for season — used team-level fallback (run splits sync)'],
  }
}
