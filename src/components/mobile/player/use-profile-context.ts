'use client'

import { useEffect, useState } from 'react'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { useMobileDock } from '@/components/mobile/shell/mobile-dock'
import { useLeague } from '@/hooks/use-league'
import { useLeagues, type MyLeagueRow } from '@/hooks/use-leagues'
import { usePlayerCoreStats } from '@/hooks/use-player-core-stats'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import { featureFlags } from '@/lib/feature-flags'
import { resolveChoice, SCORING_CHOICE_STORAGE_KEY } from '@/lib/players/core-stats-ops'

/**
 * The league the profile's header action, ownership row and History
 * transactions speak for (m-pprofile §5 "Ownership" — the prototype always
 * used its first league). In order: the league the player was opened from;
 * the league the mobile shell is in (the dock's league context); the
 * viewer's only league when there is exactly one; else none — the header
 * then offers no roster action and the ownership row summarises every
 * league. `explicit` = it came from where he was opened (it also sets the
 * scoring basis, like the desktop view's `?league=`).
 */
export function useProfileLeague(targetLeagueId: string | null): {
  leagueId: string | null
  explicit: boolean
  leagues: MyLeagueRow[]
  leaguesPending: boolean
  leaguesError: boolean
} {
  const on = featureFlags.leagues
  const leagues = useLeagues({ enabled: on })
  const dock = useMobileDock()
  const list = leagues.data ?? []
  if (!on) return { leagueId: null, explicit: false, leagues: [], leaguesPending: false, leaguesError: false }
  const member = (id: string | null) => !!id && (leagues.isPending || list.some((l) => l.id === id))
  const pick = member(targetLeagueId)
    ? { leagueId: targetLeagueId, explicit: true }
    : member(dock.leagueId)
      ? { leagueId: dock.leagueId, explicit: true }
      : list.length === 1
        ? { leagueId: list[0]!.id, explicit: false }
        : { leagueId: null, explicit: false }
  return { ...pick, leagues: list, leaguesPending: leagues.isPending, leaguesError: leagues.isError }
}

function readStoredChoice(): string | null {
  try {
    return window.localStorage.getItem(SCORING_CHOICE_STORAGE_KEY)
  } catch {
    return null
  }
}

/** The core-stats read under the same scoring resolution as the desktop
 *  view (D486(11)): the league he was opened in, else the viewer's stored
 *  pick, else ESPN Standard. The mobile design has no picker. */
export function useProfileScoring(playerId: string, leagueId: string | null) {
  const league = useLeague(featureFlags.leagues && leagueId ? leagueId : undefined)
  const leagueParam = featureFlags.leagues && leagueId && !league.isError ? leagueId : null
  const leagues = useLeagues({ enabled: featureFlags.leagues })
  const myLeagues = featureFlags.leagues ? (leagues.isError ? [] : (leagues.data ?? null)) : []
  const [stored, setStored] = useState<string | null>(null)
  useEffect(() => setStored(readStoredChoice()), [])
  const choice = resolveChoice({ picked: null, leagueParam, stored, leagues: myLeagues })
  const stats = usePlayerCoreStats(playerId, choice)
  return { choice, stats }
}

/** The pool shape the league card reads (the desktop view's `poolOf`). */
export function poolOf(player: PlayerStatsPlayer): PoolPlayer {
  return {
    id: player.id,
    full_name: player.full_name,
    position: player.position,
    team: player.team,
    adp: player.adp,
    headshot_url: player.headshot_url,
    status: player.status,
  }
}
