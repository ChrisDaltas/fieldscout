'use client'

import Link from 'next/link'

import { PositionBadge } from '@/components/players/position-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useDraftMode } from '@/hooks/use-draft-mode'
import { useList } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'

import type { BoardMark } from '@/components/lists/draft-mode/use-board-marks'
import type { ListPlayerWithPlayer, ListWithTags } from '@/hooks/use-lists'

interface BoardColumnProps {
  list: ListWithTags
  markOf: (listId: string, playerId: string) => BoardMark
  onCycle: (listId: string, playerId: string) => void
}

/** One draft-board column — a list's players as tappable flush rows. */
export function BoardColumn({ list, markOf, onCycle }: BoardColumnProps) {
  const { data, isLoading } = useList(list.id)
  // Shared with the list detail page's draft mode: rows marked drafted there
  // strike through and count into the "drafted" badge here.
  const draft = useDraftMode(list.id)

  const players = data?.players ?? []
  const draftedCount = players.filter((p) =>
    draft.drafted.has(p.player_id),
  ).length
  const isRanking = !list.hide_order

  return (
    <div className="min-w-[240px] max-w-[344px] flex-[1_0_240px]">
      <Card>
        <CardHeader>
          <CardTitle className="min-w-0 truncate">{list.title}</CardTitle>
          <Badge
            variant={isRanking ? 'accent' : 'stroke'}
            className="shrink-0"
          >
            {isRanking ? 'Ranking' : 'List'}
          </Badge>
        </CardHeader>
        <CardContent className="pb-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="stroke">
              <span className="fs-num">{players.length}</span>
              &nbsp;player{players.length === 1 ? '' : 's'}
            </Badge>
            {draftedCount > 0 && (
              <Badge variant="black">
                <span className="fs-num">{draftedCount}</span>&nbsp;drafted
              </Badge>
            )}
            <Button asChild size="sm" variant="ghost" className="ml-auto">
              <Link href={`/app/lists/${list.id}`}>
                Open
                <Icon name="arrow-next" size={13} />
              </Link>
            </Button>
          </div>

          <div className="-mx-card-pad mt-3 border-t border-ink">
            {isLoading ? (
              <div className="flex flex-col gap-1.5 p-3.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : players.length === 0 ? (
              <div className="px-3.5 py-3 text-[10px] font-semibold text-n-3">
                No players yet.
              </div>
            ) : (
              players.map((row, i) => (
                <SideRow
                  key={row.player_id}
                  row={row}
                  rank={i + 1}
                  mark={markOf(list.id, row.player_id)}
                  drafted={draft.drafted.has(row.player_id)}
                  onCycle={() => onCycle(list.id, row.player_id)}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface SideRowProps {
  row: ListPlayerWithPlayer
  rank: number
  mark: BoardMark
  drafted: boolean
  onCycle: () => void
}

/** Tap cycles the row's mark: clear → marine tint → green tint → clear. */
function SideRow({ row, rank, mark, drafted, onCycle }: SideRowProps) {
  const player = row.player
  const initials = player.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  return (
    <button
      type="button"
      onClick={onCycle}
      aria-label={`Mark ${player.full_name}`}
      className={cn(
        'flex w-full items-center gap-2 border-b border-n-4 px-3.5 py-2 text-left transition-colors last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        mark === 1
          ? 'bg-accent-soft'
          : mark === 2
            ? 'bg-positive-soft'
            : 'bg-white',
        drafted && 'opacity-45',
      )}
    >
      <span className="fs-num w-4 shrink-0 text-center text-[10px] font-semibold text-n-3">
        {rank}
      </span>
      <Avatar className="h-6 w-6">
        {player.headshot_url && (
          <AvatarImage
            src={player.headshot_url}
            alt=""
            className="object-cover object-top"
          />
        )}
        <AvatarFallback className="text-[8px]">{initials}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[11px] font-extrabold leading-tight',
            drafted && 'line-through',
          )}
        >
          {player.full_name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <PositionBadge
            position={player.position}
            className="h-[15px] min-w-[21px] px-1 text-[8px]"
          />
          <span className="truncate text-[9px] font-semibold text-n-3">
            {player.team ?? 'FA'}
          </span>
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="fs-num block text-[11px] font-extrabold leading-tight">
          {player.adp ?? '—'}
        </span>
        <span className="block text-[8px] font-bold uppercase tracking-wider text-n-3">
          ADP
        </span>
      </span>
    </button>
  )
}
