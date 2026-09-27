'use client'

import { useQuery } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishMatchupEditLock } from '@/lib/leagues/api/commish-matchup-service'

import { leagueMatchupKeys } from './use-matchups'

/**
 * Can this matchup's score or result be corrected yet? — M6A task L.E1.18
 * (Q61, ruled 2026-09-27: not while any starter on either team is still
 * playing; a final week always). `GET /api/leagues/[id]/commish/matchup-lock`
 * over migration 135's `commish_matchup_edit_lock`, which calls the SAME SQL
 * helper the two override verbs refuse on — so the panel never re-derives
 * the rule and cannot disagree with the server.
 *
 * THE KEY LIVES UNDER THE WEEK'S MATCHUP KEY on purpose: every event that
 * re-reads the week (the `scores_updated` refetch — `matchupsInvalidationKeys`
 * — and both override hooks' success-AND-error invalidation, R822(i))
 * re-reads this too, so a refusal that arrives because the panel's read went
 * stale re-paints the panel from the server.
 *
 * While the answer is "not yet" the read re-polls once a minute — games end
 * without any league event of their own. Reads only; nothing is optimistic.
 */
export const commishMatchupLockKeys = {
  one: (leagueId: string, week: number, matchupId: string) =>
    [...leagueMatchupKeys.week(leagueId, week), 'commish-lock', matchupId] as const,
}

/** How often a "not yet" answer is re-read (games finish on their own clock). */
export const COMMISH_MATCHUP_LOCK_REPOLL_MS = 60_000

export function useCommishMatchupEditLock(
  leagueId: string,
  week: number,
  matchupId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: commishMatchupLockKeys.one(leagueId, week, matchupId),
    enabled,
    retry: false,
    queryFn: () =>
      sendLeagueAction<CommishMatchupEditLock>(
        `/api/leagues/${leagueId}/commish/matchup-lock?matchup_id=${encodeURIComponent(matchupId)}`,
      ),
    refetchInterval: (query) => (query.state.data?.editable === false ? COMMISH_MATCHUP_LOCK_REPOLL_MS : false),
  })
}
