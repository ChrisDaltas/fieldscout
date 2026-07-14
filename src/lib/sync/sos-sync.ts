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

const ALL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

/** Team-level ranks from projection-weighted team strength — the fallback
 *  basis for positions (or whole seasons) without matchup splits. */
async function teamLevelRanks(supabase: SyncClient, season: number) {
  const games = await fetchSchedule(season)
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
  return computeSosRanks(games, strength)
}

/**
 * Stamp players.sos (rank 1-32, 1 = easiest). Preferred basis: positional
 * splits (per team × position). The fallback is PER POSITION, not per run:
 * any position without splits (kickers — Sleeper publishes no opponent-
 * tagged weekly K projections) gets a fresh team-level rank each run
 * instead of silently keeping a stale value.
 */
export async function syncSos(
  supabase: SyncClient,
  season: number,
): Promise<SyncSummary> {
  const games = await fetchSchedule(season)
  const splits = await loadSplits(supabase, season)
  const warnings: string[] = []

  if (splits.size === 0) {
    // No splits at all — team-level for everyone.
    const ranks = await teamLevelRanks(supabase, season)
    let updated = 0
    for (const [team, rank] of ranks) {
      const { error, count } = await supabase
        .from('players')
        .update({ sos: rank }, { count: 'exact' })
        .eq('team', team)
      if (error) throw new Error(`sos update failed for ${team}: ${error.message}`)
      updated += count ?? 0
    }
    return {
      name: 'sos',
      counts: { teams: ranks.size, players: updated },
      warnings: ['no splits for season — used team-level fallback (run splits sync)'],
    }
  }

  // Positional path for positions that have splits…
  const ranks = computePositionalSosRanks(games, splits)
  let updated = 0
  const covered = new Set<string>()
  for (const key of ranks.keys()) covered.add(key.split('|')[1])
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

  // …and team-level fallback for the positions that don't.
  const missing = ALL_POSITIONS.filter((p) => !covered.has(p))
  let fallbackUpdated = 0
  if (missing.length > 0) {
    warnings.push(`team-level fallback for positions without splits: ${missing.join(', ')}`)
    const teamRanks = await teamLevelRanks(supabase, season)
    for (const [team, rank] of teamRanks) {
      const { error, count } = await supabase
        .from('players')
        .update({ sos: rank }, { count: 'exact' })
        .eq('team', team)
        .in('position', missing as unknown as string[])
      if (error) throw new Error(`sos fallback failed for ${team}: ${error.message}`)
      fallbackUpdated += count ?? 0
    }
  }

  return {
    name: 'sos',
    counts: { schedules: ranks.size, players: updated, fallbackPlayers: fallbackUpdated },
    warnings,
  }
}
