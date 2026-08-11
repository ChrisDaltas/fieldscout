'use client'

import { PositionBadge } from '@/components/players/position-badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { ListWithTags } from '@/hooks/use-lists'

import { ListCoverBand } from './cover-tile'
import { formatCount, formatCreated } from './list-stats'

/**
 * Lists v2 — one card in the Cards gallery (`screens/cards-gallery.png`).
 *
 * Full-bleed colour cover, two chips + a dots menu, title, a two-line
 * description clamp, position badges with the player count, then a footer of
 * avatar, date, view count and a bordered comments pill.
 *
 * Cards **rest flat and lift on hover** — the only elevation rule in the design
 * (design LAW, Geometry).
 *
 * Two things this card cannot say as truthfully as the reference does:
 *
 * * **The second chip is visibility, not scope.** There is no scope column —
 *   see the Details tab for the same substitution and why.
 * * **The comments pill carries no count.** `/api/lists` returns no comment
 *   total and fetching one per card is an N+1. An icon with no number is
 *   honest; a number that is really the like count would not be.
 */
export function ListGalleryCard({
  list,
  viewer,
  onOpen,
  onShare,
  onDuplicate,
  onDelete,
  onOpenComments,
}: {
  list: ListWithTags
  viewer: { username: string | null; avatarUrl: string | null }
  onOpen: () => void
  onShare: () => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenComments: () => void
}) {
  const positions = [
    ...new Set((list.first_players ?? []).map((player) => player.position).filter(Boolean)),
  ].slice(0, 4) as string[]

  const author = list.owner
    ? { username: list.owner.username, avatarUrl: list.owner.avatar_url }
    : { username: viewer.username, avatarUrl: viewer.avatarUrl }

  return (
    <div className="flex flex-col border border-ink bg-white transition-shadow hover:shadow-hard-4">
      <button type="button" onClick={onOpen} className="block text-left">
        <ListCoverBand list={list} />
      </button>

      <div className="flex flex-1 flex-col gap-2 p-2.5">
        <div className="flex items-center gap-1.5">
          <Chip>{list.ranking_mode === 'unranked' ? 'List' : 'Ranking'}</Chip>
          <Chip>{list.is_private ? 'Private' : 'Public'}</Chip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="List options"
                className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink transition-colors hover:bg-accent-soft"
              >
                <Icon name="dots" size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[168px]">
              <DropdownMenuItem onSelect={onShare}>
                <Icon name="send" size={13} />
                Copy share link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Icon name="layers" size={13} />
                Duplicate
              </DropdownMenuItem>
              {!list.is_favorites && !list.owner && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Icon name="remove" size={13} />
                    Delete list
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <button type="button" onClick={onOpen} className="text-left">
          <span className="block text-[12px] font-bold leading-tight tracking-[-0.01em]">
            {list.title}
          </span>
        </button>

        {list.description ? (
          <p className="line-clamp-2 text-[10px] font-medium leading-normal text-n-3">
            {list.description}
          </p>
        ) : null}

        <div className="mt-auto flex items-center gap-1 pt-1.5">
          {positions.map((position) => (
            <PositionBadge key={position} position={position} />
          ))}
          <span className="ml-auto whitespace-nowrap text-[9px] font-medium text-n-3">
            {list.player_count ?? 0} players
          </span>
        </div>

        <div className="flex items-center gap-2 border-t border-n-4 pt-2">
          <UserAvatar
            src={author.avatarUrl}
            name={author.username}
            className="h-[17px] w-[17px] shrink-0"
            fallbackClassName="text-[8px]"
          />
          <span className="mr-auto whitespace-nowrap text-[9px] font-medium text-n-3">
            {formatCreated(list.created_at)}
          </span>
          <span className="inline-flex items-center gap-1 text-[9px] font-medium text-n-3">
            <Icon name="eye" size={11} />
            <span className="fs-num">{formatCount(list.view_count)}</span>
          </span>
          <button
            type="button"
            onClick={onOpenComments}
            title="Comments"
            className="inline-flex h-[21px] items-center gap-1 rounded-sm border border-ink px-1.5 text-[9px] font-bold transition-colors hover:bg-accent-soft"
          >
            <Icon name="comments" size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[15px] items-center rounded-sm border border-n-4 bg-n-4 px-1.5 text-[8.5px] font-medium text-n-3">
      {children}
    </span>
  )
}

/** The dashed tile that closes the gallery (`screens/cards-gallery.png`). */
export function NewListTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[192px] flex-col items-center justify-center gap-1.5 border border-dashed border-ink text-n-3 transition-colors hover:bg-accent-soft hover:text-ink"
    >
      <Icon name="plus" size={18} />
      <span className="text-[10px] font-bold">New list</span>
    </button>
  )
}
