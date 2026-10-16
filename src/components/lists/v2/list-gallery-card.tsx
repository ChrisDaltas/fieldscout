'use client'

import { PositionBadge } from '@/components/players/position-badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { ListWithTags } from '@/hooks/use-lists'
import { listKindOf } from '@/lib/lists/ranking-mode'
import type { ListFolder } from '@/types/database'

import { ListCoverBand } from './cover-tile'
import { formatCount, formatCreated } from './list-stats'

/**
 * Lists v2 — one card in the Cards gallery (`screens/cards-gallery.png`).
 *
 * Full-bleed colour cover, two chips + a dots menu, title, a two-line
 * description clamp, position badges with the player count, then a footer of
 * avatar, date, view count and a bordered comments pill.
 *
 * v7 card: 14px radius, hairline edge, no resting shadow; on hover the edge
 * darkens and the card lifts (design LAW, Geometry — elevation is a hover
 * affordance). The cover band is clipped to the card's rounded top.
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
  folders,
  onOpen,
  onShare,
  onDuplicate,
  onDelete,
  onOpenComments,
  onTogglePin,
  onMoveToFolder,
  onAttachToLeague,
}: {
  list: ListWithTags
  viewer: { username: string | null; avatarUrl: string | null }
  /** Folders the viewer owns; empty means the submenu never renders (LV.7). */
  folders: ListFolder[]
  onOpen: () => void
  onShare: () => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenComments: () => void
  onTogglePin: () => void
  onMoveToFolder: (folderId: string | null) => void
  /** "Attach to league" (M2 L.B4.2 — §7.4's card entry). Handler-gated by
   *  the page: leagues flag on + viewer owns the list; absent, no item. */
  onAttachToLeague?: () => void
}) {
  const positions = [
    ...new Set((list.first_players ?? []).map((player) => player.position).filter(Boolean)),
  ].slice(0, 4) as string[]

  const author = list.owner
    ? { username: list.owner.username, avatarUrl: list.owner.avatar_url }
    : { username: viewer.username, avatarUrl: viewer.avatarUrl }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-n-4 bg-white transition-[border-color,box-shadow] hover:border-surface-strong hover:shadow-hard-6">
      <button type="button" onClick={onOpen} className="block text-left">
        <ListCoverBand list={list} players={list.first_players} />
      </button>

      <div className="flex flex-1 flex-col gap-2.5 p-[14px]">
        <div className="flex items-center gap-1.5">
          {/* Ranking (numbered) · Tiers (tiers without numbers) · List. */}
          <Chip>{listKindOf(list.ranking_mode)}</Chip>
          <Chip>{list.is_private ? 'Private' : 'Public'}</Chip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="List options"
                className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-pill text-n-3 transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <Icon name="dots" size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[168px]">
              <DropdownMenuItem onSelect={onShare}>
                <Icon name="send" size={13} />
                Copy share link
              </DropdownMenuItem>
              {/* Pin / unpin and Move to folder are LV.7 ports: this card
                  replaced `list-card.tsx`, which held the app's only pin
                  control and its only folder gesture. */}
              <DropdownMenuItem onSelect={onTogglePin}>
                <Icon name="marker" size={13} />
                {list.is_favorited ? 'Unpin' : 'Pin'}
              </DropdownMenuItem>
              {!list.owner && folders.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Icon name="folder" size={13} />
                    Move to folder
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {folders.map((folder) => (
                      <DropdownMenuItem
                        key={folder.id}
                        disabled={list.folder_id === folder.id}
                        onSelect={() => onMoveToFolder(folder.id)}
                      >
                        {folder.name}
                      </DropdownMenuItem>
                    ))}
                    {list.folder_id && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onMoveToFolder(null)}>
                          Remove from folder
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {onAttachToLeague && (
                // §7.4 (M2 L.B4.2): the card's "Attach to league" entry —
                // handler-gated by the page (leagues flag + ownership).
                <DropdownMenuItem onSelect={onAttachToLeague}>
                  <Icon name="cup" size={13} />
                  Attach to league
                </DropdownMenuItem>
              )}
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
          <span className="block text-[13px] font-bold leading-tight tracking-[-0.01em] text-ink">
            {list.title}
            {list.is_favorited && (
              <Icon
                name="marker"
                size={10}
                className="ml-1.5 inline-block text-accent"
                aria-label="Pinned"
              />
            )}
          </span>
        </button>

        {list.description ? (
          <p className="-mt-1 line-clamp-2 text-[11px] font-medium leading-snug text-n-3">
            {list.description}
          </p>
        ) : null}

        <div className="mt-auto flex items-center gap-1 pt-0.5">
          {positions.map((position) => (
            <PositionBadge key={position} position={position} />
          ))}
          <span className="ml-auto whitespace-nowrap text-[10px] font-medium text-n-6">
            {list.player_count ?? 0} players
          </span>
        </div>

        <div className="flex items-center gap-2 border-t border-n-4 pt-2.5">
          <UserAvatar
            src={author.avatarUrl}
            name={author.username}
            className="h-[17px] w-[17px] shrink-0"
            fallbackClassName="text-[8px]"
          />
          <span className="mr-auto whitespace-nowrap text-[10px] font-medium text-n-6">
            {formatCreated(list.created_at)}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-n-6">
            <Icon name="eye" size={11} />
            <span className="fs-num">{formatCount(list.view_count)}</span>
          </span>
          <button
            type="button"
            onClick={onOpenComments}
            title="Comments"
            className="inline-flex h-6 items-center gap-1 rounded-pill bg-surface-control px-2 text-[10px] font-semibold text-n-2 transition-colors hover:bg-surface-pressed"
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
    <span className="inline-flex h-[17px] items-center rounded-sm bg-surface-control px-1.5 text-[9px] font-semibold text-n-3">
      {children}
    </span>
  )
}

/** The dashed tile that closes the gallery (`screens/cards-gallery.png`),
 *  in v7's card geometry. */
export function NewListTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[192px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-n-7 text-n-3 transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Icon name="plus" size={18} />
      <span className="text-[11px] font-semibold">New list</span>
    </button>
  )
}
