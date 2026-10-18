'use client'

import { useQuery } from '@tanstack/react-query'

import { GAME_BOX_COLUMNS, type GameBoxLine, type GameBoxPlayer, type NflGameRow } from '@/components/mobile/league/game/game-ops'
import { MOBILE_LIVE_GAMES_REFETCH_MS } from '@/hooks/use-mobile-team-games'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * One NFL game and its players' stored lines, for the phone's game screen
 * (gap list §3 #17). Three world-readable reads (`nfl_games`, `players`,
 * `player_stats` — 001/005), no new backend: the game row, the players of
 * its two teams, and their weekly lines for the game's season and week.
 * Which line belongs to the game is `lineInGame`'s rule (the held-games
 * one), applied by `boxGroups`.
 *
 * `game: null` is a real "no such game" (the id names no row). A transport
 * error THROWS, and a read AT PostgREST's 1000-row cap is refused rather
 * than shown short. While the game is live the read re-polls (a refresh
 * timer — no clock decides anything).
 */
export interface NflGameBox {
  game: NflGameRow | null
  players: GameBoxPlayer[]
  lines: GameBoxLine[]
}

export const nflGameBoxKeys = {
  game: (gameId: string) => ['nfl-game-box', gameId] as const,
}

const CAP = 1000

export function useNflGameBox(gameId: string) {
  return useQuery({
    queryKey: nflGameBoxKeys.game(gameId),
    queryFn: async (): Promise<NflGameBox> => {
      const supabase = createBrowserClient()
      // `*`: `operator_hold` exists only from 184 — a database before that
      // push simply answers without it (nothing held), never an error.
      const gameRes = await supabase.from('nfl_games').select('*').eq('id', gameId).maybeSingle()
      if (gameRes.error) throw gameRes.error
      const game = (gameRes.data ?? null) as NflGameRow | null
      if (!game) return { game: null, players: [], lines: [] }

      const playersRes = await supabase.from('players').select('id, full_name, position, team').in('team', [game.away_team, game.home_team])
      if (playersRes.error) throw playersRes.error
      const players = (playersRes.data ?? []) as GameBoxPlayer[]
      if (players.length >= CAP) throw new Error(`players: the game's roster read hit the ${CAP}-row cap`)
      if (players.length === 0) return { game, players, lines: [] }

      const linesRes = await supabase
        .from('player_stats')
        .select(['player_id', 'game_id', ...GAME_BOX_COLUMNS].join(', '))
        .eq('season', game.season)
        .eq('week', game.week)
        .eq('stat_type', 'weekly')
        .in(
          'player_id',
          players.map((p) => p.id),
        )
      if (linesRes.error) throw linesRes.error
      const lines = (linesRes.data ?? []) as unknown as GameBoxLine[]
      if (lines.length >= CAP) throw new Error(`player_stats: the game's line read hit the ${CAP}-row cap`)
      return { game, players, lines }
    },
    refetchInterval: (query) => (query.state.data?.game?.status === 'live' ? MOBILE_LIVE_GAMES_REFETCH_MS : false),
  })
}
