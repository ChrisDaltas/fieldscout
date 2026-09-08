'use client'

import { useQuery } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { TeamBoxScore } from '@/lib/leagues/api/box-score-service'

/**
 * One team's box score for one week — M4 task L.D5.2 (spec §11.4 "the
 * matchup view refetches box-score lines on `scores_updated`"; §16.2
 * `matchup-view`; PROGRESS D296/D298).
 *
 * READ: `GET /api/leagues/[id]/matchups/box?week=&team=` — the per-starter
 * points / pending / no-line states computed SERVER-side through the
 * worker's own pipeline (`box-score-service.ts`). The client computes no
 * score; it renders what arrived.
 *
 * LIVE: this hook opens no channel of its own. The week's ONE subscriber is
 * `useMatchupsLive` (the refcounted `league:<id>` room — F233(a)), whose
 * invalidation on `matchups` / `team_week_results` / `league_weeks` names
 * BOTH the matchups key and `leagueBoxKeys.week(leagueId, week)`
 * (`matchupsInvalidationKeys`, `use-matchups-ops.ts`) — so every box of the
 * week refetches on the same coalesced `scores_updated` event, exactly the
 * §11.4 sentence, with no second handler map and no second socket. A box
 * mounted without a live matchups hook on the page is a plain fetch (the
 * render tests' shape).
 */

export const leagueBoxKeys = {
  /** Every box of one week — the invalidation target. */
  week: (leagueId: string, week: number) => ['league-box', leagueId, week] as const,
  team: (leagueId: string, week: number, teamId: string) => ['league-box', leagueId, week, teamId] as const,
}

export function useBoxScore(leagueId: string | undefined, week: number | undefined, teamId: string | null | undefined) {
  return useQuery({
    queryKey: leagueBoxKeys.team(leagueId ?? 'none', week ?? 0, teamId ?? 'none'),
    enabled: Boolean(leagueId) && week !== undefined && Boolean(teamId),
    queryFn: () => sendLeagueAction<TeamBoxScore>(`/api/leagues/${leagueId!}/matchups/box?week=${week!}&team=${teamId!}`),
  })
}
