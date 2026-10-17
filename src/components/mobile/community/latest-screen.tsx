'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'

import { EmptyBlock, RankingRow } from '@/components/mobile/community/community-cards'
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
 * from, else to Community (gap list #27).
 */
export function MobileCommunityLatest() {
  return (
    <Suspense fallback={null}>
      <LatestScreen />
    </Suspense>
  )
}

function LatestScreen() {
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

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = feed
  // Load the next page while the end of the list is near — again after each
  // read while it still is (a page of rankings, with rankings switched off,
  // adds no rows). A failed read waits for "Try again".
  const [endEl, setEndEl] = useState<HTMLDivElement | null>(null)
  const [nearEnd, setNearEnd] = useState(false)
  useEffect(() => {
    if (!endEl || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => setNearEnd(entries.some((e) => e.isIntersecting)), {
      rootMargin: '0px 0px 600px 0px',
    })
    observer.observe(endEl)
    return () => {
      observer.disconnect()
      setNearEnd(false)
    }
  }, [endEl])
  useEffect(() => {
    if (nearEnd && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [nearEnd, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

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
        ) : items.length === 0 && !hasNextPage ? (
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
            <div ref={setEndEl} />
            {isFetchNextPageError ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center" role="alert">
                <p className="text-[13px] font-medium text-m-t3">Couldn’t load more.</p>
                <button
                  type="button"
                  onClick={() => void fetchNextPage()}
                  className="text-[13px] font-semibold text-accent"
                >
                  Try again
                </button>
              </div>
            ) : isFetchingNextPage || (hasNextPage && items.length === 0) ? (
              <RowsSkeleton count={2} label="Loading more" />
            ) : hasNextPage ? (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => void fetchNextPage()}
                  className="flex h-9 items-center rounded-pill bg-m-b2 px-4 text-[13px] font-semibold text-m-t1 active:bg-m-b2h"
                >
                  Load more
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {openId && <CommunityDetail listId={openId} onBack={closeDetail} />}
    </MobileScreen>
  )
}

/** Latest rows loading: the 60px tile and two lines. */
function RowsSkeleton({ count, label }: { count: number; label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <span className="h-[60px] w-[60px] flex-none animate-pulse rounded-[10px] bg-m-b1" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-3/4 animate-pulse rounded-[14px] bg-m-b1" />
            <span className="h-3 w-1/2 animate-pulse rounded-[14px] bg-m-b1" />
          </span>
        </div>
      ))}
    </div>
  )
}
