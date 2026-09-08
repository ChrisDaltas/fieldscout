'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { LeagueRosters } from '@/lib/leagues/api/rosters-service'

import { useLeagueChannel } from './use-league-channel'
import { invalidatingHandlers, rostersEventInvalidates } from './use-league-channel-ops'

/**
 * Every franchise's roster — M4 task L.D4.1 (spec §15.3/§15.6; PROGRESS
 * D92, D298, ledger **F233(b)** + **F241(d)**).
 *
 * READ: the `GET /api/leagues/[id]/rosters` route (§15.3 prints it) — the
 * membership gate, the five-table join and the F241(d) `'infinity'`
 * normalisation all live server-side in `rosters-service.ts`, so what this
 * hook holds is already renderable: `game_lock` is a discriminated view
 * (`unlocked` / `locked_until` / `locked_release_unrecorded`), never the raw
 * `locked_until` string a `new Date()` would turn into `Invalid Date`.
 *
 * **`leagueRosterKeys` is THE roster query key** — the one F233(b) asked
 * this task to name so that `useAddDrop` (`use-transactions.ts`) could
 * invalidate it on a completed move instead of inventing a key L.D4.1 would
 * then have had to match. `useSetLineup` invalidates it too (a set writes
 * `league_rosters.slot_key`).
 *
 * LIVE: subscribed to `league:<id>` through the ONE spine (F233(a) — this
 * hook passes handlers, never opens a `.channel(`), refetching on
 * `league_rosters` (072's trigger), `transactions` (119 — the drop carrier:
 * a DELETE on `league_rosters` does not broadcast) and `league_player_pool`
 * (119 — the lock carrier, below). The handler map is derived from
 * `rostersEventInvalidates` (R773). Every confirmed (re)join refetches
 * (§9.3's missed-broadcast recovery).
 *
 * **The lock IS carried now (R822(ii) → F252(a), decided at L.D1.9).**
 * `game_lock` is read from `league_player_pool`, which `lineup_lock_tick`
 * refreshes from `nfl_games` every minute (116); since 119 the tick sends
 * ONE coalesced `league_player_pool` summary per league per pass that
 * changed at least one lock (a kickoff or a release instant — never a quiet
 * minute, never per row; D319(6)), and this hook refetches on it. The
 * `refetchInterval` plumbing L.D5.1 added for its 60 s poll RETIRED with
 * L.D5.4 (F259(a)): the room is the freshness mechanism (D298), and no
 * consumer asks for a timer.
 */

export const leagueRosterKeys = {
  /** Everything for one league — the invalidation target (F233(b)). */
  all: (leagueId: string) => ['league-rosters', leagueId] as const,
}

/** The fetch half. */
export function useRosters(leagueId: string | undefined) {
  return useQuery({
    queryKey: leagueRosterKeys.all(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: () => sendLeagueAction<LeagueRosters>(`/api/leagues/${leagueId!}/rosters`),
  })
}

/**
 * The fetch + subscribe half — what a mounted roster surface uses. Returns
 * the query plus the spine's `connection` for the §16.5.4 reconnecting
 * banner.
 */
export function useRostersLive(leagueId: string | undefined) {
  const query = useRosters(leagueId)
  const queryClient = useQueryClient()

  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: leagueRosterKeys.all(leagueId) })
  }

  const { connection } = useLeagueChannel(
    leagueId,
    invalidatingHandlers(rostersEventInvalidates, invalidate),
    { onJoin: invalidate, onDrop: invalidate },
  )

  return { ...query, connection }
}
