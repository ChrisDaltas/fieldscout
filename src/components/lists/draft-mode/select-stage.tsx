'use client'

import Link from 'next/link'

import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { ListWithTags } from '@/hooks/use-lists'

interface SelectStageProps {
  /** Lists shown in the grid (already folder-filtered). */
  lists: ListWithTags[]
  isLoading: boolean
  /** True when the grid is scoped to a ?folder=ID. */
  inFolder: boolean
  /** Picked list ids, in pick order. */
  picked: string[]
  onTogglePick: (id: string) => void
  onPickAll: () => void
  onStart: () => void
}

function ordinal(n: number): string {
  const rem10 = n % 10
  const rem100 = n % 100
  if (rem10 === 1 && rem100 !== 11) return `${n}st`
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`
  return `${n}th`
}

function updatedLabel(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'updated today'
  if (days === 1) return 'updated yesterday'
  if (days < 7) return `updated ${days}d ago`
  if (days < 30) return `updated ${Math.floor(days / 7)}w ago`
  if (days < 365) return `updated ${Math.floor(days / 30)}mo ago`
  return `updated ${Math.floor(days / 365)}y ago`
}

/** Stage 1 — pick which lists go on the draft board. */
export function SelectStage({
  lists,
  isLoading,
  inFolder,
  picked,
  onTogglePick,
  onPickAll,
  onStart,
}: SelectStageProps) {
  const pickedLists = picked
    .map((id) => lists.find((l) => l.id === id))
    .filter((l): l is ListWithTags => Boolean(l))

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
      {/* --- list grid --- */}
      <div>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : lists.length === 0 ? (
          <Card>
            <CardContent className="py-9 text-center">
              <div className="text-h6">
                {inFolder ? 'No lists in this folder' : 'No lists yet'}
              </div>
              <p className="mt-1.5 text-[11px] font-semibold text-n-3">
                {inFolder
                  ? 'Add lists to this folder from the lists page, then come back.'
                  : 'Create a couple of lists first — draft mode puts them side by side on draft day.'}
              </p>
              <Button asChild variant="stroke" size="sm" className="mt-4">
                <Link href="/app/lists">Back to lists</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {lists.map((list) => (
              <PickCard
                key={list.id}
                list={list}
                pickIndex={picked.indexOf(list.id)}
                onToggle={() => onTogglePick(list.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* --- sticky draft mode panel --- */}
      <div className="lg:sticky lg:top-5">
        <Card>
          <CardHeader>
            <CardTitle>Draft mode</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={onPickAll}
              disabled={lists.length === 0}
            >
              Pick all
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-[11px] font-semibold leading-relaxed text-n-3">
              Pick the lists you want on the board. Columns follow your pick
              order and scroll sideways when they run out of room.
            </p>

            <div className="my-3.5 flex flex-col gap-2">
              {pickedLists.length === 0 && (
                <div className="rounded-sm border border-dashed border-n-3 px-3 py-3.5 text-center text-[10px] font-bold text-n-3">
                  Nothing picked yet
                </div>
              )}
              {pickedLists.map((list, i) => (
                <div
                  key={list.id}
                  className="flex items-center gap-2.5 rounded-sm border border-ink bg-white py-1.5 pl-2.5 pr-1"
                >
                  <Badge variant="black" className="fs-num shrink-0 px-1.5">
                    {ordinal(i + 1)}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-extrabold">
                    {list.title}
                  </span>
                  <span className="fs-num shrink-0 text-[10px] font-bold text-n-3">
                    {list.player_count ?? 0}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${list.title}`}
                    onClick={() => onTogglePick(list.id)}
                  >
                    <Icon name="close" size={12} />
                  </Button>
                </div>
              ))}
            </div>

            <Button
              variant="blue"
              shadow
              className="w-full"
              disabled={picked.length < 2}
              onClick={onStart}
            >
              <Icon name="table" size={14} />
              {picked.length === 0
                ? 'Pick 2 lists'
                : picked.length === 1
                  ? 'Pick 1 more'
                  : 'Start draft mode'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

interface PickCardProps {
  list: ListWithTags
  /** Index in the pick order, or -1 when not picked. */
  pickIndex: number
  onToggle: () => void
}

function PickCard({ list, pickIndex, onToggle }: PickCardProps) {
  const isPicked = pickIndex >= 0
  const count = list.player_count ?? 0

  return (
    <div
      role="checkbox"
      aria-checked={isPicked}
      aria-label={`Pick ${list.title} for the draft board`}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onToggle()
        }
      }}
      className={cn(
        'cursor-pointer rounded-sm border border-ink p-3.5 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        isPicked ? 'bg-accent-soft shadow-hard-4' : 'bg-white hover:shadow-hard-4',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="pointer-events-none flex shrink-0">
          <Checkbox checked={isPicked} tabIndex={-1} />
        </span>
        <ListThumbnail
          positionFilter={list.position_filter}
          isTeam={Boolean(list.is_team)}
          imageUrl={list.thumbnail_url}
          players={list.first_players}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-extrabold leading-tight">
            {list.title}
          </div>
          <div className="mt-1 text-[10px] font-semibold text-n-3">
            <span className="fs-num">{count}</span> player{count === 1 ? '' : 's'}
            {list.updated_at ? ` · ${updatedLabel(list.updated_at)}` : ''} ·{' '}
            {list.is_private ? 'Private' : 'Public'}
          </div>
        </div>
        {isPicked && (
          <Badge variant="black" className="fs-num shrink-0 self-start px-1.5">
            {ordinal(pickIndex + 1)}
          </Badge>
        )}
      </div>

      <div className="mt-2.5 flex min-h-chip flex-wrap items-center gap-1.5">
        {count === 0 ? (
          <Badge variant="stroke">Empty</Badge>
        ) : list.position_filter ? (
          <PositionBadge position={list.position_filter} />
        ) : (
          <Badge variant="black">All positions</Badge>
        )}
        {(list.tags ?? []).slice(0, 2).map((tag) => (
          <Badge key={tag.id} variant="stroke" className="bg-accent-soft">
            {tag.name}
          </Badge>
        ))}
      </div>
    </div>
  )
}
