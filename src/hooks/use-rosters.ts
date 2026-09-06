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
 * `league_rosters` (072's trigger, live today) and `transactions` (the drop
 * carrier once L.D1.9 lands — a DELETE on `league_rosters` does not
 * broadcast). The handler map is derived from `rostersEventInvalidates`
 * (R773). Every confirmed (re)join refetches (§9.3's missed-broadcast
 * recovery).
 *
 * **What NOTHING carries: the lock (R822(ii)).** `game_lock` is read from
 * `league_player_pool`, which the `lineup_lock_tick` rewrites every minute
 * from `nfl_games` (116) — and no trigger broadcasts that table (072's is on
 * `league_rosters`; D296's four are L.D1.9's and do not name the pool). With
 * the provider's `refetchOnWindowFocus: false` and no interval, a mounted
 * page would show the 🔒 it fetched at open until something else
 * invalidated the key (the `use-league.ts` measurement: no timer bounds
 * this). So a surface that renders the lock for the CURRENT week passes
 * `refetchInterval` — the tick's own cadence — and a surface that does not
 * (a past/future week, a roster list) passes nothing. The poll is the M4
 * interim (ledger **F252**); a pool broadcast is L.D1.9's to decide. React
 * Query's `refetchIntervalInBackground` default (false) keeps a hidden tab
 * quiet.
 */

export const leagueRosterKeys = {
  /** Everything for one league — the invalidation target (F233(b)). */
  all: (leagueId: string) => ['league-rosters', leagueId] as const,
}

export interface RostersReadOptions {
  /** Poll the route on this cadence while mounted and visible (ms), or
   *  `false`/absent for no poll — see the header (R822(ii)/F252). */
  refetchInterval?: number | false
}

/** The fetch half. */
export function useRosters(leagueId: string | undefined, options: RostersReadOptions = {}) {
  return useQuery({
    queryKey: leagueRosterKeys.all(leagueId ?? 'none'),
    enabled: Boolean(leagueId),
    queryFn: () => sendLeagueAction<LeagueRosters>(`/api/leagues/${leagueId!}/rosters`),
    refetchInterval: options.refetchInterval ?? false,
  })
}

/**
 * The fetch + subscribe half — what a mounted roster surface uses. Returns
 * the query plus the spine's `connection` for the §16.5.4 reconnecting
 * banner.
 */
export function useRostersLive(leagueId: string | undefined, options: RostersReadOptions = {}) {
  const query = useRosters(leagueId, options)
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
