'use client'

import { useQuery } from '@tanstack/react-query'

// ---------------------------------------------------------------------------
// Response shape of /api/players/[id]/stats. The stat key list mirrors the
// columns that route selects, not the full PlayerStat row.
// ---------------------------------------------------------------------------

export interface StatTotals {
  pass_yards: number | null
  pass_tds: number | null
  interceptions: number | null
  pass_attempts: number | null
  pass_completions: number | null
  sacks_taken: number | null
  rush_attempts: number | null
  rush_yards: number | null
  rush_tds: number | null
  targets: number | null
  receptions: number | null
  receiving_yards: number | null
  receiving_tds: number | null
  fumbles_lost: number | null
  fg_made: number | null
  fg_attempted: number | null
  xp_made: number | null
  def_sacks: number | null
  def_interceptions: number | null
  def_tds: number | null
}

export interface SeasonBlock {
  season: number
  gamesPlayed: number
  totals: StatTotals
  fantasy: { ppr: number; standard: number }
  basis?: 'pace' | 'projections' | 'last_season'
}

export interface GameLogRow {
  week: number
  source: string | null
  is_live: boolean | null
  stats: StatTotals
  fantasy: { ppr: number; standard: number }
}

export interface PlayerStatsPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string | null
  jersey_number: number | null
  height: string | null
  weight: number | null
  birth_date: string | null
  college: string | null
  experience_years: number
  bye_week: number | null
  draft_year: number | null
  draft_round: number | null
  draft_pick: number | null
  adp: number | null
  /** Strength of schedule rank, 1 = easiest – 32 = hardest. */
  sos: number | null
  /** Positional rank among projected players (half PPR), 1 = best. */
  pos_rank: number | null
  injury_body_part: string | null
  injury_notes: string | null
  injury_start_date: string | null
  practice_participation: string | null
}

export interface PlayerStatsResponse {
  player: PlayerStatsPlayer
  seasons: { current: SeasonBlock; last: SeasonBlock; projection: SeasonBlock }
  gameLog: GameLogRow[]
}

export const playerStatsKeys = {
  detail: (id: string) => ['players', 'stats', id] as const,
}

export function usePlayerStats(playerId: string | null | undefined) {
  return useQuery({
    queryKey: playerId
      ? playerStatsKeys.detail(playerId)
      : ['players', 'stats', 'undefined'],
    queryFn: async () => {
      const res = await fetch(`/api/players/${playerId}/stats`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Stats failed (${res.status})`)
      }
      return (await res.json()) as PlayerStatsResponse
    },
    enabled: Boolean(playerId),
  })
}
