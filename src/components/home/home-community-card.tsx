'use client'

import Link from 'next/link'

import { FeedRow, FeedSkeleton } from '@/components/explore/explore-feed'
import { CollapsibleCard } from '@/components/layout/two-column-layout'
import { COMMUNITY_HREF, HOME_COMMUNITY_SIZE } from '@/components/mobile/community/community-ops'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { homeCommunityItems, useExploreFeed } from '@/hooks/use-explore-feed'

/**
 * "From the Community" (plan C8) — desktop Home's jump-off into Community,
 * a card in the hub grid. Not in v7, so it's drawn in v7's Home card
 * language (`CollapsibleCard`: white, hairline border, 13px bold title, a
 * right-hand link) holding Community's own feed rows (`FeedRow`): each opens
 * the list inside the app, with Like and Follow; "See all" opens Community.
 *
 * What it shows and in what order is the Popular tab's (`homeCommunityItems`
 * — the phone's For you order): real lists with players, at most five.
 *
 * Mounted only while Community is switched on (desktop Home). Loading:
 * skeleton rows. A failed read says "Couldn't load", with Try again — never
 * an empty card. No lists to show: the card is left out (no empty box on
 * Home).
 */
export function HomeCommunityCard() {
  const feed = useExploreFeed('popular', null)
  const items = feed.data ? homeCommunityItems(feed.data.pages) : []
  // Read, and nothing on it is a list to show: no card at all.
  if (feed.data && items.length === 0) return null
  // A failed first read; a later page failing (Community's Load more)
  // leaves the rows already read, which is all this card shows.
  const failed = feed.isError && !feed.data

  return (
    <CollapsibleCard
      title="From the Community"
      defaultOpen
      className="overflow-hidden"
      headerRight={
        <Link
          href={COMMUNITY_HREF}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:text-accent-strong"
        >
          See all
          <Icon name="arrow-next" size={11} />
        </Link>
      }
    >
      <div className="border-t border-n-4" data-home-community>
        {failed ? (
          <div className="flex flex-col items-center gap-[9px] px-[15px] py-6 text-center">
            <p className="text-[11px] font-medium text-negative-strong" role="alert">
              Couldn&apos;t load lists from the Community.
            </p>
            <Button variant="stroke" size="sm" onClick={() => void feed.refetch()} disabled={feed.isFetching}>
              <Icon name="reset" size={11} /> {feed.isFetching ? 'Loading…' : 'Try again'}
            </Button>
          </div>
        ) : !feed.data ? (
          <FeedSkeleton rows={HOME_COMMUNITY_SIZE} />
        ) : (
          <div className="divide-y divide-n-4">
            {items.map((item) => (
              <FeedRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </CollapsibleCard>
  )
}
