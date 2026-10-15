'use client'

import { useEffect, useMemo } from 'react'

import { playerMoves, type ProfileMove } from '@/components/mobile/player/profile-ops'
import { useCompletedRealDraft, useDraft } from '@/hooks/use-draft'
import { useLeague } from '@/hooks/use-league'
import { useLeagueActivityPages } from '@/hooks/use-league-activity'
import type { ActivityItem } from '@/lib/leagues/api/activity-service'

/** Pages of 100 the profile reads before it says older moves are left out. */
const MAX_PAGES = 10
const FILTERS = { kind: 'transaction', limit: 100 } as const

/**
 * One league's moves of one player for the mobile player profile's
 * Transactions tab and History section (m-pprofile §2.8 / §2.10): the
 * league's transactions feed (`GET /api/leagues/[id]/activity`, kind
 * transaction — the route the Activity page reads, member-gated) filtered to
 * the moves that name him, plus his pick in the league's real draft
 * (`draft_picks`, member-SELECTable). Nothing new server-side: the feed is
 * paged through (two-half cursor) up to `MAX_PAGES`, and a feed that still
 * has more is reported as `truncated` rather than passed off as complete.
 */
export function useMobileProfileLeagueMoves(leagueId: string, playerId: string) {
  const league = useLeague(leagueId)
  const feed = useLeagueActivityPages(leagueId, FILTERS)
  const completed = useCompletedRealDraft(leagueId)
  const detail = league.data
  const draftId = completed.data?.id ?? (detail?.league.status === 'drafting' ? detail.active_draft?.id : undefined)
  const draft = useDraft(draftId)

  const pages = feed.data?.pages.length ?? 0
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && pages > 0 && pages < MAX_PAGES) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, pages, fetchNextPage])

  const items = useMemo<ActivityItem[]>(() => (feed.data?.pages ?? []).flatMap((p) => p.items), [feed.data])
  const moves = useMemo<ProfileMove[]>(
    () =>
      detail
        ? playerMoves({
            playerId,
            items,
            picks: draft.data?.picks ?? [],
            teams: detail.teams,
            members: detail.members,
          })
        : [],
    [detail, items, draft.data, playerId],
  )

  const loading =
    league.isPending ||
    feed.isPending ||
    (hasNextPage === true && pages < MAX_PAGES) ||
    completed.isPending ||
    (Boolean(draftId) && draft.isPending)
  const error = league.isError || feed.isError || completed.isError || draft.isError
  return {
    state: error ? ('error' as const) : loading ? ('loading' as const) : ('ready' as const),
    moves,
    truncated: hasNextPage === true && pages >= MAX_PAGES,
    leagueName: detail?.league.name ?? null,
  }
}
