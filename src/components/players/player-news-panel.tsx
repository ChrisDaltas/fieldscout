'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlayerNews } from '@/hooks/use-player-news'
import { newsAge, outboundHref, type PlayerNewsItem } from '@/lib/news/types'

/**
 * News (F575; Chris 2026-10-18): headline · source · time, each a link out
 * to the outlet's own page in a new tab. Newest first, paged ("Show more").
 * Headlines are plain text rendered as text — never HTML; no article is
 * fetched or shown.
 */
export function PlayerNewsPanel({ playerId }: { playerId: string }) {
  const news = usePlayerNews(playerId)
  if (news.isPending) {
    return (
      <div className="space-y-2" data-news="loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }
  if (news.isError) {
    return (
      <div className="flex items-center gap-3" data-news="error">
        <p className="text-[11px] font-medium text-n-6">Couldn&apos;t load news.</p>
        <Button variant="stroke" size="md" onClick={() => void news.refetch()}>
          Retry
        </Button>
      </div>
    )
  }
  const items = news.data.pages.flatMap((p) => p.items)
  if (items.length === 0) {
    return (
      <p className="text-[11px] font-medium text-n-6" data-news="empty">
        No recent news for this player.
      </p>
    )
  }
  // eslint-disable-next-line no-restricted-syntax -- display-only relative time ("3h ago"), not league logic
  const now = new Date()
  return (
    <div data-news="list">
      <ul className="divide-y divide-n-4">
        {items.map((item) => (
          <NewsRow key={item.id} item={item} now={now} />
        ))}
      </ul>
      {news.hasNextPage && (
        <Button
          variant="stroke"
          size="md"
          className="mt-3"
          disabled={news.isFetchingNextPage}
          onClick={() => void news.fetchNextPage()}
          data-news-more
        >
          {news.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </Button>
      )}
      {news.isFetchNextPageError && <p className="mt-2 text-[11px] font-medium text-n-6">Couldn&apos;t load more.</p>}
    </div>
  )
}

function NewsRow({ item, now }: { item: PlayerNewsItem; now: Date }) {
  const href = outboundHref(item.url)
  const meta = (
    <p className="mt-0.5 text-[10px] font-semibold text-n-6">
      {item.source} · {newsAge(item.published_at, now)}
    </p>
  )
  return (
    <li className="py-2.5" data-news-item>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="group block"
        >
          <p className="text-[13px] font-semibold leading-snug tracking-[-0.01em] transition-colors group-hover:text-accent">
            {item.headline}
          </p>
          {meta}
        </a>
      ) : (
        <>
          <p className="text-[13px] font-semibold leading-snug">{item.headline}</p>
          {meta}
        </>
      )}
    </li>
  )
}
