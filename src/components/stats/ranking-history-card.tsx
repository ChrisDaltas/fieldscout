'use client'

import Link from 'next/link'

import { CollapsibleCard } from '@/components/layout/two-column-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useBigBoardHistory } from '@/hooks/use-big-board'

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Ranking history on My stats — every saved big board snapshot as a flush
 * row (date + mono player count). Reads the existing useBigBoardHistory
 * hook; restores stay on the big board screen, so rows here are read-only.
 */
export function RankingHistoryCard() {
  const { data, isLoading, isError } = useBigBoardHistory()
  const snapshots = data?.snapshots ?? []

  return (
    <CollapsibleCard
      title="Ranking history"
      headerRight={
        snapshots.length > 0 ? (
          <Badge variant="stroke" className="fs-num">
            {snapshots.length} {snapshots.length === 1 ? 'save' : 'saves'}
          </Badge>
        ) : undefined
      }
    >
      {isLoading ? (
        <CardContent className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </CardContent>
      ) : isError ? (
        <CardContent>
          <p className="text-[13px] font-medium text-negative-strong">
            Couldn&apos;t load your ranking history. Refresh to retry.
          </p>
        </CardContent>
      ) : snapshots.length === 0 ? (
        <CardContent className="py-8 text-center">
          <h3 className="text-h6">No saved boards yet</h3>
          <p className="mx-auto mt-1 max-w-sm text-[13px] font-medium text-n-3">
            Every time you update your big board, a snapshot lands here.
          </p>
          <Button asChild variant="stroke" size="sm" className="mt-4">
            <Link href="/app/big-board">Open the big board</Link>
          </Button>
        </CardContent>
      ) : (
        <>
          <ul>
            {snapshots.map((snap, i) => {
              const saved = new Date(snap.saved_at)
              return (
                <li
                  key={snap.id}
                  className={
                    i < snapshots.length - 1
                      ? 'border-b border-n-4'
                      : undefined
                  }
                >
                  <div className="flex items-center justify-between gap-3 px-card-pad py-2.5">
                    <div className="min-w-0">
                      <div className="text-[13px] font-extrabold text-ink">
                        {DATE_FMT.format(saved)}
                      </div>
                      <div className="text-[11px] font-medium text-n-3">
                        {TIME_FMT.format(saved)}
                      </div>
                    </div>
                    <span className="fs-num shrink-0 text-[13px] font-bold text-ink">
                      {snap.player_count}{' '}
                      <span className="text-[11px] font-semibold text-n-3">
                        players
                      </span>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="border-t border-ink px-card-pad py-2.5">
            <Link
              href="/app/big-board"
              className="text-[12px] font-bold text-accent hover:underline"
            >
              Open the big board to restore a save
            </Link>
          </div>
        </>
      )}
    </CollapsibleCard>
  )
}
