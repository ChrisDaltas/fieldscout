'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { PlayoffBracket } from '@/lib/leagues/api/playoffs-service'

import { useLeagueChannel } from './use-league-channel'
import { invalidatingHandlers, playoffBracketEventInvalidates } from './use-league-channel-ops'

/**
 * The playoff bracket — M4 task L.D5.5 (spec §11.5's Playoffs bullet
 * v2.16.25 / Q39 (A)–(E); §16.1's standings page "Playoffs" tab, ALL
 * SEASON; §16.2 `playoff-bracket.tsx`; migration 118's
 * `league_playoff_bracket`; PROGRESS D318(6), F256(a)/(c)/(g)).
 *
 * READ: the `GET /api/leagues/[id]/playoffs` route (the L.D4.1 read-family
 * shape). The document is 118's, whole: while `in_season` the PROJECTED
 * round 1 ("if the playoffs started today" — seeded server-side from
 * `league_standings_projected`) with its basis; once built, the stored
 * rounds (seeds frozen on the rows, per-week rows, the two-week totals,
 * `decided_by`, `final`); the no-bracket kinds (`points_race` /
 * `no_playoffs`) with the stored champion; and the ONE absolute instant
 * the real bracket materialises (`rollover_at`, a `timestamptz` — NULL
 * until ingestion records it, F238). Nothing is computed here — no seed,
 * no total, no tiebreak, no instant; the view renders what arrived. Never
 * optimistic.
 *
 * LIVE: subscribed to `league:<id>` through the ONE spine (F233(a)); the
 * handler map is DERIVED from `playoffBracketEventInvalidates` (R773) —
 * 118/119 emit no bracket event of their own, so the read refetches on
 * the events the rollover and its consequences already emit (the
 * predicate's docblock names each: `league_weeks` is the rollover itself,
 * `matchups` the (re)build and the score tick, `team_week_results` the
 * correction close, `leagues` the status flips, `teams` a retirement).
 * Every confirmed (re)join refetches (§9.3).
 */

export const playoffBracketKeys = {
  all: (leagueId: string) => ['league-playoffs', leagueId] as const,
}

/** The fetch half. `enabled` lets a host fetch only while the tab shows it. */
export function usePlayoffBracket(leagueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: playoffBracketKeys.all(leagueId ?? 'none'),
    enabled: Boolean(leagueId) && enabled,
    queryFn: () => sendLeagueAction<PlayoffBracket>(`/api/leagues/${leagueId!}/playoffs`),
  })
}

/** The fetch + subscribe half — what a mounted bracket uses. Returns the
 *  query plus the spine's `connection` for the §16.5.4 reconnecting banner. */
export function usePlayoffBracketLive(leagueId: string | undefined, enabled = true) {
  const query = usePlayoffBracket(leagueId, enabled)
  const queryClient = useQueryClient()
  const invalidate = () => {
    if (!leagueId) return
    void queryClient.invalidateQueries({ queryKey: playoffBracketKeys.all(leagueId) })
  }
  const { connection } = useLeagueChannel(leagueId, invalidatingHandlers(playoffBracketEventInvalidates, invalidate), {
    onJoin: invalidate,
    onDrop: invalidate,
  })
  return { ...query, connection }
}
