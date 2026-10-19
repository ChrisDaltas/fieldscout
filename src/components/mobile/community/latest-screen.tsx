'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo } from 'react'

import { EmptyBlock, MoreFooter, RankingRow, RowsSkeleton } from '@/components/mobile/community/community-cards'
import { CommunityDetail } from '@/components/mobile/community/community-detail'
import {
  COMMUNITY_HREF,
  CREATE_LIST_HREF,
  LATEST_HREF,
  closeCommunityDetail,
  latestPageItems,
} from '@/components/mobile/community/community-ops'
import { useCommunityStore } from '@/components/mobile/community/community-store'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MobileScreen, RoundNavButton } from '@/components/mobile/ui/mobile-header'
import { useCommunityLatest } from '@/hooks/use-community-latest'
import { featureFlags } from '@/lib/feature-flags'

/**
 * FieldScout Mobile — the Latest page (`/app/explore/latest`; For you's
 * "Latest" shelf → See all, Chris 2026-10-16). Back + "Latest", then every
 * public list and ranking, simply newest posted first, as the Latest rows
 * ("@handle · List · 25m"). More load as you scroll toward the end, and a
 * "Load more" button does the same by hand — nothing is cut off. Rankings
 * stay out while their switch is off, as everywhere on Community.
 *
 * A row opens the list's detail over this page (`?list=<id>`), so Back
 * returns here exactly as it was. The page's own Back goes where you came
 * from, else to Community (gap list #27). `currentWeek` (the app's NFL week)
 * is the detail's: whether a weekly ranking can be duplicated now.
 */
export function MobileCommunityLatest({ currentWeek }: { currentWeek: number }) {
  return (
    <Suspense fallback={null}>
      <LatestScreen currentWeek={currentWeek} />
    </Suspense>
  )
}

function LatestScreen({ currentWeek }: { currentWeek: number }) {
  const router = useRouter()
  const goBack = useGoBack()
  const openId = useSearchParams().get('list')
  const detailFromFeed = useCommunityStore((s) => s.detailFromFeed)
  const setDetailFromFeed = useCommunityStore((s) => s.setDetailFromFeed)

  const feed = useCommunityLatest()
  const ranksOn = featureFlags.weeklyRanks
  const items = useMemo(() => latestPageItems(feed.data?.pages ?? [], ranksOn), [feed.data, ranksOn])
  // "Now" for the posted times is when the pages were read.
  const now = feed.dataUpdatedAt

  // The detail is open from this page only while `?list=` is set.
  useEffect(() => {
    if (!openId) setDetailFromFeed(false)
  }, [openId, setDetailFromFeed])

  const closeDetail = () =>
    closeCommunityDetail(
      detailFromFeed,
      {
        popFeed: () => {
          setDetailFromFeed(false)
          window.history.back()
        },
        goBack,
      },
      LATEST_HREF,
    )

  const header = (
    <div className="flex h-[52px] items-center px-3" inert={openId ? true : undefined}>
      <RoundNavButton kind="back" onClick={() => goBack(COMMUNITY_HREF)} />
      <h2 className="min-w-0 flex-1 truncate text-center text-[16px] font-semibold">Latest</h2>
      <span className="size-9 flex-none" aria-hidden />
    </div>
  )

  return (
    <MobileScreen header={header}>
      <div className="px-4 pb-6" inert={openId ? true : undefined}>
        {!feed.data ? (
          // Nothing read yet: loading, or the first read failed. (A later
          // page failing keeps what's shown — "Couldn’t load more" below.)
          feed.isError ? (
            <EmptyBlock
              message="Couldn’t load the latest lists. Check your connection and try again."
              action="Try again"
              onAction={() => void feed.refetch()}
            />
          ) : (
            <RowsSkeleton count={6} label="Loading the latest lists" />
          )
        ) : items.length === 0 && !feed.hasNextPage ? (
          <EmptyBlock
            message={ranksOn ? 'No lists or rankings yet' : 'No lists yet'}
            action="Create a list"
            onAction={() => router.push(CREATE_LIST_HREF)}
          />
        ) : (
          <>
            <div className="flex flex-col">
              {items.map((item) => (
                <RankingRow key={item.id} item={item} postedNow={now} from={LATEST_HREF} />
              ))}
            </div>
            {/* More load as the end comes near, or by hand. */}
            <MoreFooter
              read={feed}
              auto
              nothingShown={items.length === 0}
              skeleton={<RowsSkeleton count={2} label="Loading more" />}
            />
          </>
        )}
      </div>

      {openId && <CommunityDetail listId={openId} onBack={closeDetail} currentWeek={currentWeek} />}
    </MobileScreen>
  )
}
