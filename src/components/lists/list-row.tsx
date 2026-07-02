'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  Copy,
  GripVertical,
  Lock,
  MoreHorizontal,
  Pin,
  Trash2,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ListThumbnail } from '@/components/lists/list-thumbnail'
import type { ThumbnailPlayer } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'

import type { List } from '@/types/database'

interface ListRowProps {
  list: List
  draggable?: boolean
  dragHandleProps?: Record<string, unknown>
  isDragging?: boolean
  /** When omitted, falls back to list.is_favorited. */
  isFavorited?: boolean
  /** First 1–3 players for the quadrant thumbnail. */
  firstPlayers?: ThumbnailPlayer[] | null
  onToggleFavorite?: () => void
  onDelete?: () => void
  onDuplicate?: () => void
}

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const dt = new Date(iso)
  const diffMs = Date.now() - dt.getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

export function ListRow({
  list,
  draggable = false,
  dragHandleProps,
  isDragging = false,
  isFavorited,
  firstPlayers,
  onToggleFavorite,
  onDelete,
  onDuplicate,
}: ListRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const favorited = isFavorited ?? list.is_favorited ?? false

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-md border border-transparent bg-bg-elevated px-3 py-3 transition-colors hover:border-bg-elevated-2 hover:bg-bg-elevated-2',
        isDragging && 'border-bg-elevated-3 shadow-lg shadow-black/40',
      )}
    >
      {draggable && (
        <button
          type="button"
          {...dragHandleProps}
          className="-ml-1 cursor-grab rounded-full text-text-tertiary opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      {onToggleFavorite && (
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={favorited ? 'Unpin' : 'Pin'}
          aria-pressed={favorited}
          className="rounded-full p-1 text-text-tertiary transition-colors hover:text-foreground"
        >
          <Pin
            className={cn(
              'h-4 w-4 transition-opacity',
              favorited
                ? 'fill-foreground text-foreground'
                : 'opacity-0 group-hover:opacity-100',
            )}
          />
        </button>
      )}

      <ListThumbnail
        positionFilter={list.position_filter}
        isTeam={list.is_team ?? false}
        imageUrl={list.thumbnail_url}
        players={firstPlayers}
        size="md"
      />

      <Link href={`/app/lists/${list.id}`} className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold">{list.title}</h3>
          {list.is_big_board && (
            <Badge
              variant="default"
              className="border-bg-elevated-3 bg-bg-elevated-2 text-[10px] font-semibold text-foreground px-1.5 py-0"
            >
              Big Board
            </Badge>
          )}
          {list.hide_order && (
            <Badge
              variant="default"
              className="border-bg-elevated-3 text-[10px] text-text-secondary px-1.5 py-0"
            >
              Unranked
            </Badge>
          )}
          {list.tiers_enabled && (
            <Badge
              variant="default"
              className="border-bg-elevated-3 text-[10px] text-text-secondary px-1.5 py-0"
            >
              Tiers
            </Badge>
          )}
          {list.is_private && (
            <span
              title="Private"
              className="inline-flex items-center text-text-tertiary"
            >
              <Lock className="h-3 w-3" />
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-text-secondary">
          <span className="tabular-nums">{list.player_count} players</span>
          <span>·</span>
          <span>Updated {formatRelative(list.updated_at)}</span>
          {(list.like_count ?? 0) > 0 && (
            <>
              <span>·</span>
              <span className="tabular-nums">{list.like_count} likes</span>
            </>
          )}
        </div>
      </Link>

      {(onDelete || onDuplicate) && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="List options"
              className="rounded-full p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-bg-elevated-3 hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="border-bg-elevated-2 bg-bg-elevated"
          >
            {onDuplicate && (
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false)
                  onDuplicate()
                }}
              >
                <Copy className="mr-2 h-4 w-4" /> Duplicate
              </DropdownMenuItem>
            )}
            {onDelete && !list.is_big_board && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  setMenuOpen(false)
                  onDelete()
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
