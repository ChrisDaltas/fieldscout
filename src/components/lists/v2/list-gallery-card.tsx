'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { formatCreated, listPositions, playerCountLabel } from './lists-view-state'

import {
  listThumbnailLabel,
  POS_TINTS,
} from '@/components/lists/list-thumbnail'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { useDeleteList, useDuplicateList, type ListWithTags } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * Lists v2 — one card in the gallery (handoff §"Lists page" → Mode: Cards).
 *
 * Cover band, kind badge + row menu, name, description, the list's positions,
 * player count, then a footer rule carrying the author and the view/like
 * counts. **Rests flat and lifts on hover** — elevation is a hover affordance
 * only, per §"Geometry".
 *
 * Cover: the handoff's per-list `cover.{color, emoji}` is out of scope
 * (delivery plan §2.2 — "use existing `thumbnail_url` only"), so an uploaded
 * image fills the band and everything else falls back to the list's **position
 * identity colour** carrying its monogram. No colour is invented: the tint map
 * is `ListThumbnail`'s own, so a list's card and its cover tile agree.
 *
 * The menu is the handoff's minus the two items with no backing concept here:
 * "Pop out" is round 2 (delivery plan §6) and there is no archive state — soft
 * delete is what `useDeleteList` does.
 */
interface ListGalleryCardProps {
  list: ListWithTags
  /** Where clicking the card goes. */
  href: string
}

export function ListGalleryCard({ list, href }: ListGalleryCardProps) {
  const router = useRouter()
  const { toast } = useToast()
  const duplicateList = useDuplicateList()
  const deleteList = useDeleteList()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const positions = listPositions(list)
  const kind = list.ranking_mode === 'unranked' ? 'List' : 'Ranking'
  const coverLabel = listThumbnailLabel(list.position_filter, Boolean(list.is_team))
  const coverTint = POS_TINTS[coverLabel]
  // Favorites is permanent — the Delete item is omitted entirely, not disabled
  // (handoff §"Store rules that matter").
  const deletable = !list.is_favorites

  return (
    <>
      <article
        className={cn(
          'flex flex-col rounded-sm border-1 border-ink bg-white transition-all',
          'shadow-none hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4',
        )}
      >
        <Link
          href={href}
          aria-label={`Open ${list.title}`}
          className={cn(
            'block h-[93px] shrink-0 overflow-hidden border-b-1 border-ink',
            list.thumbnail_url ? 'bg-n-4' : coverTint.bg,
          )}
        >
          {list.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={list.thumbnail_url}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <span className="relative block h-full w-full">
              <span className="fs-num absolute bottom-1 left-2.5 text-[37px] font-extrabold leading-none tracking-[-0.05em] text-white/85">
                {coverLabel}
              </span>
              <Icon
                name="list"
                size={24}
                className="absolute right-2.5 top-2.5 text-white/45"
              />
            </span>
          )}
        </Link>

        <div className="flex flex-1 flex-col gap-2 p-2.5">
          <div className="flex items-center gap-1.5">
            <Badge variant="stroke" className="h-[15px] px-1.5 text-[9px]">
              {kind}
            </Badge>
            {list.is_private ? (
              <Badge variant="stroke" className="h-[15px] px-1.5 text-[9px]">
                Private
              </Badge>
            ) : null}
            <span className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${list.title}`}
                  >
                    <Icon name="dots" size={13} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      duplicateList.mutate(list.id, {
                        onSuccess: (created) => {
                          toast({
                            title: 'Duplicated',
                            description: `${list.title} → ${created.title}`,
                          })
                          router.push(`/app/lists/${created.id}`)
                        },
                        onError: (e) =>
                          toast({
                            title: 'Could not duplicate',
                            description: e.message,
                            variant: 'destructive',
                          }),
                      })
                    }
                  >
                    <Icon name="layers" size={13} /> Duplicate
                  </DropdownMenuItem>
                  {deletable ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="focus:bg-negative-soft"
                        onSelect={() => setConfirmDelete(true)}
                      >
                        <Icon name="remove" size={13} /> Delete list
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>

          <Link
            href={href}
            className="block truncate text-[13px] font-extrabold leading-tight tracking-[-0.01em] text-ink hover:underline"
          >
            {list.title}
          </Link>

          {list.description ? (
            <p className="line-clamp-2 text-[10px] font-medium leading-snug text-n-3">
              {list.description}
            </p>
          ) : null}

          <div className="mt-auto flex items-center gap-1 pt-1.5">
            {positions.slice(0, 4).map((pos) => (
              <PositionBadge key={pos} position={pos} size="sm" />
            ))}
            <span className="ml-auto shrink-0 whitespace-nowrap text-[9px] font-medium leading-tight text-n-3">
              {playerCountLabel(list.player_count)}
            </span>
          </div>

          <div className="flex items-center gap-2 border-t border-n-4 pt-2">
            <span className="min-w-0 truncate text-[9px] font-medium leading-tight text-n-3">
              {list.owner ? `@${list.owner.username} · ` : ''}
              {formatCreated(list.created_at)}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2 text-[9px] font-medium text-n-3">
              <span className="inline-flex items-center gap-1">
                <Icon name="eye" size={11} />
                <span className="fs-num">{list.view_count ?? 0}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Icon name="like" size={11} />
                <span className="fs-num">{list.like_count ?? 0}</span>
              </span>
            </span>
          </div>
        </div>
      </article>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this list?</DialogTitle>
            <DialogDescription>
              {list.title} moves to the trash — you can restore it from there.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="stroke" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteList.isPending}
              onClick={() =>
                deleteList.mutate(list.id, {
                  onSuccess: () => {
                    setConfirmDelete(false)
                    toast({ title: 'List deleted', description: list.title })
                  },
                  onError: (e) =>
                    toast({
                      title: 'Could not delete list',
                      description: e.message,
                      variant: 'destructive',
                    }),
                })
              }
            >
              Delete list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
