'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { WeekMatchups } from '@/lib/leagues/api/matchups-service'

import { useLeagueChannel } from './use-league-channel'
import { matchupsHandlers } from './use-matchups-ops'

/**
 * One week's matchups, live scores and results — M4 task L.D4.1 (spec
 * §15.3/§15.6/§11.4; PROGRESS D296/D298, ledger **F233(a)**).
 *
 * READ: the `GET /api/leagues/[id]/matchups?week=` route (§15.3 prints it).
 * `week` is REQUIRED — the route reads the spec's `?week=` literally and
 * infers no "current" week (§23.3; `matchups-service.ts`'s header); the
 * surface picks the week from `useSchedule`'s ladder.
 *
 * LIVE: subscribed to `league:<id>` through the ONE spine — this hook passes
 * a handler map and never opens a `.channel(` (F233(a); `single-room-tab`'s
 * one-per-topic pin). Freshness is D298's mechanism: **refetch on
 * `scores_updated`**, which on this topic is the `matchups` UPDATE event
 * (D296 — one coalesced event per league per worker batch), plus
 * `team_week_results` (finalization) and `league_weeks` (the status flip
 * behind the `final (pending corrections)` badge). Never a cache patch: the
 * payloads are column-selected and cannot rebuild a week. The decision per
 * event is the PURE reducer in `use-matchups-ops.ts` — an event naming
 * another week is inert, an unknown event is inert, a payload without a
 * week refetches conservatively — and the handler map is DERIVED from
 * `matchupsEventInvalidates` (R773), so dropping `matchups` from that list
 * really does stop the score tick from refetching (the DoD's probe).
 *
 * Every confirmed (re)join refetches (§9.3's missed-broadcast recovery):
 * the boot window and the reconnect gap both drop broadcasts silently, so
 * no view may depend on having received one.
 *
 * NOTE (D298 / F233(c)): the `matchups` trigger that emits the event is
 * L.D1.9's, behind blocker B9 at the time of writing. The wiring here is
 * pinned in node against a synthetic event through the real `joinLeagueRoom`
 * with the client mocked; the wire-level delivery proof is deferred with the
 * trigger (PROGRESS F248).
 */

export const leagueMatchupKeys = {
  /** Every week of one league — the invalidation target. */
  all: (leagueId: string) => ['league-matchups', leagueId] as const,
  week: (leagueId: string, week: number) => ['league-matchups', leagueId, week] as const,
}

/** The fetch half. */
export function useMatchups(leagueId: string | undefined, week: number | undefined) {
  return useQuery({
    queryKey: leagueMatchupKeys.week(leagueId ?? 'none', week ?? 0),
    enabled: Boolean(leagueId) && week !== undefined,
    queryFn: () =>
      sendLeagueAction<WeekMatchups>(`/api/leagues/${leagueId!}/matchups?week=${week!}`),
  })
}

/**
 * The fetch + subscribe half — what a mounted matchup view uses. Returns
 * the query plus the spine's `connection` for the §16.5.4 reconnecting
 * banner.
 */
export function useMatchupsLive(leagueId: string | undefined, week: number | undefined) {
  const query = useMatchups(leagueId, week)
  const queryClient = useQueryClient()

  const invalidate = () => {
    if (!leagueId || week === undefined) return
    void queryClient.invalidateQueries({ queryKey: leagueMatchupKeys.week(leagueId, week) })
  }

  const { connection } = useLeagueChannel(
    leagueId,
    matchupsHandlers(week ?? 0, invalidate),
    { onJoin: invalidate, onDrop: invalidate },
  )

  return { ...query, connection }
}
