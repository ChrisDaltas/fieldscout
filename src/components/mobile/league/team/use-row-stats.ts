'use client'

import { useMemo } from 'react'

import { nflGameHref } from '@/components/mobile/league/game/game-ops'
import { useBoxScore } from '@/hooks/use-box-score'
import { useDefenseSplits } from '@/hooks/use-defense-splits'
import { useLeaguePlayerValues } from '@/hooks/use-league-player-values'
import { useMobileTeamGames } from '@/hooks/use-mobile-team-games'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'

import type { RowStats } from './lineup-rows'
import { gameLine, oprkSpan } from './team-ops'

/**
 * What a mobile lineup row reads, from the same server reads the desktop
 * team page uses: projections (`league_player_values`, the league's own
 * scoring), the week's points (the box read — the worker's pipeline, shown
 * once a game is under way), the game line (`nfl_games`), OPRK
 * (`defense_position_splits`) and headshots (`players`). Anything a read
 * doesn't carry renders as absent, never a guess.
 */
export function useRowStats(args: {
  leagueId: string
  season: number
  week: number | undefined
  teamId: string
  playerIds: readonly string[]
  /** Points come from the box read — only the Team tab shows them. */
  withPoints: boolean
}): RowStats {
  const { leagueId, season, week, teamId, playerIds, withPoints } = args
  const values = useLeaguePlayerValues(leagueId, season, week)
  const games = useMobileTeamGames(season, week)
  const splits = useDefenseSplits(season)
  const box = useBoxScore(withPoints ? leagueId : undefined, week, teamId)
  const identity = usePlayersByIds(playerIds)

  return useMemo<RowStats>(() => {
    const pointsBy = new Map<string, { phase: string; points: number }>()
    for (const s of box.data?.starters ?? []) if (s.player) pointsBy.set(s.player.id, s)
    for (const b of box.data?.bench ?? []) pointsBy.set(b.player_id, b)
    const gameRows = games.data ?? []
    const splitRows = splits.data ?? []
    return {
      proj: (id) => values.byPlayer.get(id)?.projected_points ?? null,
      points: (id) => {
        const line = pointsBy.get(id)
        if (!line || line.phase === 'up_next' || line.phase === 'bye') return null
        return line.points.toFixed(2)
      },
      game: (nflTeam) => gameLine(nflTeam, gameRows),
      oprk: (line, position) => oprkSpan(splitRows, line, position),
      headshot: (id) => identity.playerById.get(id)?.headshot_url ?? null,
      gameHref: (line) => (line.kind === 'game' && line.gameId ? nflGameHref(leagueId, line.gameId) : null),
    }
  }, [box.data, games.data, splits.data, values.byPlayer, identity.playerById, leagueId])
}
