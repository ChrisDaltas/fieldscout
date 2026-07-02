import type { SupabaseClient } from '@supabase/supabase-js'

import {
  calculateFantasyPoints,
  type ScoringRules,
  type StatRow,
} from '@/lib/scoring/default'
import {
  CURRENT_SEASON,
  LAST_SEASON,
  SCORING_BY_KEY,
  type ScoringKey,
} from '@/lib/stats/aggregate-fantasy'
import { fetchWeeklyStatsForPlayers } from '@/lib/stats/fetch-weekly-stats'
import type {
  AiPosition,
  AiScoringFormat,
  GeneratedPlayer,
  ResolvedGeneratedPlayer,
} from '@/types/schemas/ai'

/**
 * Shared player data packet builder (plan §5.5): List Generation, persona
 * seeding/refresh, and (later) Ask AI all assemble Claude input from here.
 *
 * Known gaps vs. the spec's wishlist, until the stats layer grows them:
 * target share / carry share / snap % (needs team totals) and strength of
 * schedule (needs schedule data). The packet carries raw volume (targets,
 * carries, receptions) instead — extend here when those land.
 */

export const SCORING_KEY_BY_FORMAT: Record<AiScoringFormat, ScoringKey> = {
  Standard: 'standard',
  PPR: 'ppr',
  'Half-PPR': 'half_ppr',
}

const PROJECTION_COLUMN_BY_KEY: Record<ScoringKey, string> = {
  standard: 'projected_pts_standard',
  ppr: 'projected_pts_ppr',
  half_ppr: 'projected_pts_half_ppr',
}

const POSITIONS_FOR: Record<AiPosition, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  Overall: ['QB', 'RB', 'WR', 'TE'],
}

/** Sleeper status values that mean "on IR" — spec rule: never rank IR players. */
const IR_STATUSES = new Set([
  'injured reserve',
  'ir',
  'pup',
  'physically unable to perform',
  'non football injury',
])

export function isOnInjuredReserve(status: string | null | undefined): boolean {
  return status ? IR_STATUSES.has(status.trim().toLowerCase()) : false
}

export interface PacketPlayer {
  id: string
  name: string
  position: string
  team: string | null
  age: number | null
  adp: number | null
  bye_week: number | null
  status: string | null
  last_season_points: number | null
  last_season_games: number
  targets: number
  receptions: number
  rush_attempts: number
  projected_points: number | null
}

export interface PlayerPacket {
  position: AiPosition
  scoring: AiScoringFormat
  players: PacketPlayer[]
  /** Compact text rendering fed to Claude as {player_data_packet}. */
  rendered: string
}

interface PlayerPoolRow {
  id: string
  full_name: string
  position: string
  team: string | null
  status: string | null
  birth_date: string | null
  adp: number | null
  bye_week: number | null
  [key: string]: unknown
}

type WeeklyRow = StatRow & {
  player_id: string | null
  week: number | null
  targets: number | null
  receptions: number | null
  rush_attempts: number | null
}

const CACHE_TTL_MS = 10 * 60 * 1000
const packetCache = new Map<string, { at: number; packet: PlayerPacket }>()

function ageFromBirthDate(birthDate: string | null): number | null {
  if (!birthDate) return null
  const born = new Date(birthDate)
  if (Number.isNaN(born.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - born.getUTCFullYear()
  const monthDiff = now.getUTCMonth() - born.getUTCMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) age--
  return age
}

function renderPacket(players: PacketPlayer[], scoring: AiScoringFormat): string {
  return players
    .map((p, i) => {
      const volume =
        p.position === 'RB'
          ? `, ${p.rush_attempts} carries, ${p.targets} targets`
          : p.position === 'WR' || p.position === 'TE'
            ? `, ${p.targets} targets, ${p.receptions} receptions`
            : ''
      const lastSeason =
        p.last_season_points != null
          ? `${LAST_SEASON}: ${p.last_season_points.toFixed(1)} ${scoring} pts in ${p.last_season_games} games${volume}`
          : `${LAST_SEASON}: no stats`
      const proj =
        p.projected_points != null
          ? `${CURRENT_SEASON} proj: ${p.projected_points.toFixed(1)} pts`
          : `${CURRENT_SEASON} proj: n/a`
      return `${i + 1}. ${p.name} (${p.position}, ${p.team ?? 'FA'}) — age ${p.age ?? '?'}, ADP ${p.adp ?? 'n/a'}, bye ${p.bye_week ?? '?'}, ${lastSeason}, ${proj}, status: ${p.status ?? 'unknown'}`
    })
    .join('\n')
}

export async function buildPlayerPacket(
  supabase: SupabaseClient,
  {
    position,
    scoring,
    playerCount,
  }: { position: AiPosition; scoring: AiScoringFormat; playerCount: number },
): Promise<PlayerPacket> {
  const poolSize = Math.min(150, Math.max(30, playerCount * 3))
  const cacheKey = `${position}:${scoring}:${poolSize}`
  const hit = packetCache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.packet

  const scoringKey = SCORING_KEY_BY_FORMAT[scoring]
  const projectionColumn = PROJECTION_COLUMN_BY_KEY[scoringKey]

  // Order in the DB before limiting — without it the limit truncates an
  // arbitrary heap-order subset and elite players can vanish from the packet.
  const { data, error } = await supabase
    .from('players')
    .select(
      'id, full_name, position, team, status, birth_date, adp, bye_week, projected_pts_standard, projected_pts_ppr, projected_pts_half_ppr',
    )
    .in('position', POSITIONS_FOR[position])
    .not('team', 'is', null)
    .order(projectionColumn, { ascending: false, nullsFirst: false })
    .order('adp', { ascending: true, nullsFirst: false })
    .limit(poolSize * 3)
  if (error) throw new Error(`Player pool query failed: ${error.message}`)

  const pool = ((data ?? []) as unknown as PlayerPoolRow[])
    .filter((p) => !isOnInjuredReserve(p.status))
    .map((p) => ({
      row: p,
      projected: (p[projectionColumn] as number | null) ?? null,
    }))
    .sort((a, b) => {
      const adpA = a.row.adp ?? Number.POSITIVE_INFINITY
      const adpB = b.row.adp ?? Number.POSITIVE_INFINITY
      if (adpA !== adpB) return adpA - adpB
      return (b.projected ?? 0) - (a.projected ?? 0)
    })
    .slice(0, poolSize)

  if (pool.length === 0) {
    throw new Error(
      `No players found for position ${position}. Run "npm run sync:players" to populate the player pool.`,
    )
  }

  const ids = pool.map((p) => p.row.id)
  const rules: ScoringRules = SCORING_BY_KEY[scoringKey]
  const weekly = await fetchWeeklyStatsForPlayers<WeeklyRow>({
    supabase,
    playerIds: ids,
    seasons: [LAST_SEASON],
    select:
      'player_id, week, pass_yards, pass_tds, interceptions, rush_yards, rush_tds, receptions, receiving_yards, receiving_tds, fumbles_lost, two_point_conversions, fg_made, fg_made_40_plus, fg_made_50_plus, xp_made, def_sacks, def_interceptions, def_fumble_recoveries, def_tds, def_safeties, targets, rush_attempts',
  })

  const byPlayer = new Map<
    string,
    { points: number; games: number; targets: number; receptions: number; rushAttempts: number }
  >()
  for (const row of weekly) {
    if (!row.player_id || row.week == null) continue
    const agg = byPlayer.get(row.player_id) ?? {
      points: 0,
      games: 0,
      targets: 0,
      receptions: 0,
      rushAttempts: 0,
    }
    agg.points += calculateFantasyPoints(row, rules)
    agg.games += 1
    agg.targets += row.targets ?? 0
    agg.receptions += row.receptions ?? 0
    agg.rushAttempts += row.rush_attempts ?? 0
    byPlayer.set(row.player_id, agg)
  }

  const players: PacketPlayer[] = pool.map(({ row, projected }) => {
    const agg = byPlayer.get(row.id)
    return {
      id: row.id,
      name: row.full_name,
      position: row.position,
      team: row.team,
      age: ageFromBirthDate(row.birth_date),
      adp: row.adp,
      bye_week: row.bye_week,
      status: row.status,
      last_season_points: agg ? Math.round(agg.points * 10) / 10 : null,
      last_season_games: agg?.games ?? 0,
      targets: agg?.targets ?? 0,
      receptions: agg?.receptions ?? 0,
      rush_attempts: agg?.rushAttempts ?? 0,
      projected_points: projected,
    }
  })

  const packet: PlayerPacket = {
    position,
    scoring,
    players,
    rendered: renderPacket(players, scoring),
  }
  packetCache.set(cacheKey, { at: Date.now(), packet })
  return packet
}

// ============================================================================
// Name → player_id resolution (plan §5.6): never trust model-produced IDs.
// ============================================================================

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Resolve Claude's generated players against the packet pool (the only
 * players it was shown). Unmatched names are dropped and reported; ranks are
 * renumbered so the list stays dense.
 */
export function resolveGeneratedPlayers(
  generated: GeneratedPlayer[],
  packet: PacketPlayer[],
): { players: ResolvedGeneratedPlayer[]; unresolved: string[] } {
  const byName = new Map<string, PacketPlayer>()
  for (const p of packet) {
    const key = normalizeName(p.name)
    if (!byName.has(key)) byName.set(key, p)
  }

  const players: ResolvedGeneratedPlayer[] = []
  const unresolved: string[] = []
  const seenIds = new Set<string>()

  for (const g of [...generated].sort((a, b) => a.rank - b.rank)) {
    const match = byName.get(normalizeName(g.player_name))
    if (!match || seenIds.has(match.id)) {
      unresolved.push(g.player_name)
      continue
    }
    seenIds.add(match.id)
    players.push({
      rank: players.length + 1,
      player_id: match.id,
      player_name: match.name,
      team: match.team ?? g.team,
      rationale: g.rationale,
    })
  }

  return { players, unresolved }
}
