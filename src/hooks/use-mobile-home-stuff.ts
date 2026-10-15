'use client'

import { ssCounts } from '@/components/mobile/profile/profile-ops'
import { useAuth } from '@/hooks/use-auth'
import { useLists } from '@/hooks/use-lists'
import { useMobileProfileRankings } from '@/hooks/use-mobile-profile-rankings'
import { useMobileProfileStartSit } from '@/hooks/use-mobile-profile-start-sit'
import { featureFlags } from '@/lib/feature-flags'

/**
 * The counts under Home's "My stuff" tiles (m-home §5 — static in the
 * prototype, live here). Each tile counts the SAME read as the Profile
 * segment it opens, so the number and the rows always agree:
 *  - Lists: the user's own lists (`GET /api/lists` total — the `useLists(1,
 *    100)` read Profile › Lists and the Recently viewed shelf make).
 *  - Rankings: Profile › Rankings' rows (`useMobileProfileRankings`) — this
 *    season's weekly boards whose list isn't deleted, plus the pre-draft big
 *    board. The app stores no "submitted" state, so that half of the
 *    design's "3 rankings · 2 submitted" is left out.
 *  - Start/Sit: Profile › Start/Sit's questions (`useMobileProfileStartSit`,
 *    voided ones left out), open vs closed by its own `ssCounts` rule.
 *
 * Rankings and Start/Sit exist only while their surfaces are released
 * (`featureFlags.weeklyRanks` / `startOrSit` — Profile offers those
 * segments under the same flags); otherwise the tile is `null` and nothing
 * is read. A count that fails to load is `error`, never a silent 0 or a
 * blank that looks like loading.
 */
export interface StuffCount<T> {
  value: T | null
  error: boolean
}

export function useMobileHomeStuff(now: number) {
  const { user } = useAuth()
  const lists = useLists(1, 100)
  const rankings = useMobileProfileRankings(user?.id, featureFlags.weeklyRanks)
  const startSit = useMobileProfileStartSit(user?.id, featureFlags.startOrSit)

  const retry = () => {
    if (lists.isError) void lists.refetch()
    if (featureFlags.weeklyRanks && rankings.isError) void rankings.refetch()
    if (featureFlags.startOrSit && startSit.isError) void startSit.refetch()
  }

  return {
    lists: { value: lists.data?.pagination.total ?? null, error: lists.isError } satisfies StuffCount<number>,
    rankings: featureFlags.weeklyRanks
      ? ({ value: rankings.data?.length ?? null, error: rankings.isError } satisfies StuffCount<number>)
      : null,
    startSit: featureFlags.startOrSit
      ? ({
          value: startSit.data ? ssCounts(startSit.data, now) : null,
          error: startSit.isError,
        } satisfies StuffCount<{ open: number; closed: number }>)
      : null,
    retry,
  }
}
