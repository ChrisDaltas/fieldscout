'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ListFormDialog } from '@/components/lists/list-form-dialog'
import { ListThumbnail } from '@/components/lists/list-thumbnail'
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import {
  type ListWithTags,
  useDeleteList,
  useDuplicateList,
  useToggleFavorite,
  useUpdateList,
} from '@/hooks/use-lists'
import { useMoveListToFolder } from '@/hooks/use-folders'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { ListFolder } from '@/types/database'

interface ListCardProps {
  list: ListWithTags
  folders: ListFolder[]
  className?: string
}

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/**
 * Lists-browse grid card — white surface, 1px ink border, lifts onto a hard
 * shadow on hover. The ⋯ menu keeps every list action: rename, pin,
 * duplicate, make public/private, move to folder, delete (soft).
 */
export function ListCard({ list, folders, className }: ListCardProps) {
  const router = useRouter()
  const { toast } = useToast()
  const updateList = useUpdateList(list.id)
  const toggleFavorite = useToggleFavorite()
  const duplicateList = useDuplicateList()
  const deleteList = useDeleteList()
  const moveToFolder = useMoveListToFolder()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const positions: string[] = []
  for (const p of list.first_players ?? []) {
    if (p.position && !positions.includes(p.position)) positions.push(p.position)
  }

  const err = (title: string) => (e: Error) =>
    toast({ title, description: e.message, variant: 'destructive' })

  const handleTogglePrivacy = () => {
    updateList.mutate(
      { is_private: !list.is_private },
      {
        onSuccess: (next) =>
          toast({
            title: next.is_private ? 'List is now private' : 'List is now public',
            description: list.title,
          }),
        // The free-tier private-list gate is enforced server-side; surface it.
        onError: err('Could not change visibility'),
      },
    )
  }

  const handleDuplicate = () => {
    duplicateList.mutate(list.id, {
      onSuccess: (created) => {
        toast({ title: 'Duplicated', description: `${list.title} → ${created.title}` })
        router.push(`/app/lists/${created.id}`)
      },
      onError: err('Could not duplicate'),
    })
  }

  const handleDelete = () => {
    deleteList.mutate(list.id, {
      onSuccess: () => {
        setDeleteOpen(false)
        toast({ title: 'List deleted', description: list.title })
      },
      onError: err('Could not delete list'),
    })
  }

  const handleMove = (folderId: string | null) => {
    moveToFolder.mutate(
      { listId: list.id, folderId },
      {
        onSuccess: () =>
          toast({
            title: folderId ? 'Moved to folder' : 'Removed from folder',
            description: list.title,
          }),
        onError: err('Could not move list'),
      },
    )
  }

  return (
    <div
      className={cn(
        'group relative flex cursor-pointer flex-col rounded-sm border border-ink bg-white p-4 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4',
        className,
      )}
      onClick={(e) => {
        const t = e.target as HTMLElement
        if (t.closest('a, button, [role="menu"], [role="dialog"]')) return
        router.push(`/app/lists/${list.id}`)
      }}
    >
      <div className="flex items-center gap-3">
        <ListThumbnail
          positionFilter={list.position_filter}
          isTeam={list.is_team ?? false}
          imageUrl={list.thumbnail_url}
          players={list.first_players}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <Link
            href={`/app/lists/${list.id}`}
            className="block truncate text-[14px] font-extrabold leading-tight text-ink hover:underline"
          >
            {list.title}
            {list.is_favorited && (
              <Icon
                name="marker"
                size={11}
                className="ml-1.5 inline-block text-accent"
                aria-label="Pinned"
              />
            )}
          </Link>
          <p className="mt-1 truncate text-[11px] font-semibold text-n-3">
            <span className="fs-num">{list.player_count ?? 0}</span> players ·
            updated {formatRelative(list.updated_at)} ·{' '}
            {list.is_private ? 'Private' : 'Public'}
          </p>
        </div>

        <span className="shrink-0 self-start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${list.title}`}
              >
                <Icon name="dots" size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => router.push(`/app/lists/${list.id}`)}>
                <Icon name="external-link" size={13} /> Open
              </DropdownMenuItem>
              {!list.is_big_board && (
                <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                  <Icon name="edit" size={13} /> Rename
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  toggleFavorite.mutate(list.id, {
                    onError: err('Could not update pin'),
                  })
                }
              >
                <Icon name="marker" size={13} /> {list.is_favorited ? 'Unpin' : 'Pin'}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={duplicateList.isPending}
                onSelect={handleDuplicate}
              >
                <Icon name="save" size={13} /> Duplicate
              </DropdownMenuItem>
              {!list.is_big_board && (
                <DropdownMenuItem onSelect={handleTogglePrivacy}>
                  <Icon name="eye" size={13} />{' '}
                  {list.is_private ? 'Make public' : 'Make private'}
                </DropdownMenuItem>
              )}
              {folders.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Icon name="folder" size={13} /> Move to folder
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {folders.map((f) => (
                      <DropdownMenuItem
                        key={f.id}
                        disabled={list.folder_id === f.id}
                        onSelect={() => handleMove(f.id)}
                      >
                        {f.name}
                      </DropdownMenuItem>
                    ))}
                    {list.folder_id && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => handleMove(null)}>
                          Remove from folder
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {!list.is_big_board && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="focus:bg-negative-soft"
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <Icon name="remove" size={13} /> Delete list
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      <div className="mt-3 flex min-h-[19px] flex-wrap items-center gap-1.5">
        {positions.length === 0 && <Badge variant="stroke">Empty</Badge>}
        {positions.length > 3 ? (
          <Badge variant="black">All positions</Badge>
        ) : (
          positions.map((pos) => (
            <PositionBadge key={pos} position={pos === 'DEF' ? 'DST' : pos} size="sm" />
          ))
        )}
        {(list.tags ?? []).slice(0, 2).map((tag) => (
          <Badge key={tag.id} variant="stroke" className="bg-accent-soft">
            {tag.name}
          </Badge>
        ))}
        {list.is_big_board && <Badge variant="black">Big board</Badge>}
        {list.is_team && <Badge variant="stroke">Team</Badge>}
      </div>

      {/* Rename — reuses the list form (create/edit) so validation stays in one place. */}
      {renameOpen && (
        <span onClick={(e) => e.stopPropagation()}>
          <ListFormDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            mode="edit"
            list={list}
          />
        </span>
      )}

      {deleteOpen && (
        <span onClick={(e) => e.stopPropagation()}>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Delete this list?</DialogTitle>
                <DialogDescription>
                  <span className="font-bold text-ink">{list.title}</span> will
                  be moved to your Trash. You can restore it from there until
                  it&apos;s permanently removed.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="stroke"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleteList.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  shadow
                  onClick={handleDelete}
                  disabled={deleteList.isPending}
                >
                  {deleteList.isPending ? 'Deleting…' : 'Delete list'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </span>
      )}
    </div>
  )
}
