'use client'

import Link from 'next/link'
import { useMemo } from 'react'

import { LatestShelf } from '@/components/mobile/community/community-cards'
import { COMMUNITY_HREF, homeCommunityLists } from '@/components/mobile/community/community-ops'
import { useMobileCommunityFeed } from '@/hooks/use-mobile-community-feed'

import { HomeNote, HomeSectionTitle } from './home-section'

/**
 * "From the Community" (plan C8) — Home's jump-off into Community, right
 * after My stuff. Not in the mobile design, so it's drawn in the design's
 * own shelf language: For you's horizontal row of cards (`LatestShelf`),
 * the same cards Community shows, each opening the list on Community's list
 * page; "See all" opens Community.
 *
 * What it shows and in what order is For you's (`homeCommunityLists`): real
 * lists with players, "popular + recent" (ruling #35), at most five. It
 * reads Community's own feed (`useMobileCommunityFeed`), so See all opens on
 * a feed that's already loaded.
 *
 * Mounted only while Community is switched on (MobileHome). Loading: three
 * card placeholders. A failed read says "Couldn't load", with Try again —
 * never an empty shelf. No lists to show: the section is left out (no empty
 * box on Home).
 */
export function HomeCommunity() {
  const feed = useMobileCommunityFeed()
  // The feed's own read time, as Community's screen uses (a pure render).
  const now = feed.dataUpdatedAt
  const lists = useMemo(() => (feed.data ? homeCommunityLists(feed.data, now) : []), [feed.data, now])
  if (feed.data && lists.length === 0) return null
  return (
    <section data-home-community>
      <HomeSectionTitle
        title="From the Community"
        align="center"
        className="mt-6"
        right={
          // 16px line box as designed; the padding grows the tap area to 30px without moving it.
          <Link href={COMMUNITY_HREF} className="-my-[7px] py-[7px] text-[13px] font-semibold leading-[16px] text-accent">
            See all
          </Link>
        }
      />
      {feed.data ? (
        <div className="mt-[10px]">
          <LatestShelf items={lists} now={now} home />
        </div>
      ) : feed.isError ? (
        <HomeNote tone="error" action={{ label: 'Try again', onClick: () => void feed.refetch() }}>
          Couldn’t load lists from the Community.
        </HomeNote>
      ) : (
        <ShelfSkeleton />
      )}
    </section>
  )
}

/** Three cards loading, as the shelf lays them out (cover, title, author). */
function ShelfSkeleton() {
  return (
    <div className="-mx-4 mt-[10px] flex gap-[10px] overflow-hidden px-4" aria-busy="true" aria-label="Loading lists">
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className="flex w-[150px] flex-none flex-col gap-[6px]">
          <span className="h-[150px] rounded-[14px] bg-m-b1" />
          <span className="h-3.5 w-4/5 rounded-[14px] bg-m-b1" />
          <span className="h-3 w-1/2 rounded-[14px] bg-m-b1" />
        </span>
      ))}
    </div>
  )
}
