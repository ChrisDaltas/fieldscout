'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { FolderFormDialog } from '@/components/lists/folder-form-dialog'
import { ListCard } from '@/components/lists/list-card'
import { Badge, FilterChip } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useDeleteFolder, useFolders } from '@/hooks/use-folders'
import { useLists } from '@/hooks/use-lists'
import { useTags } from '@/hooks/use-tags'
import { useToast } from '@/hooks/use-toast'
import { useUIStore } from '@/stores/ui-store'
import type { ListFolder } from '@/types/database'

const POSITION_FILTERS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FLEX'] as const
type PositionFilter = (typeof POSITION_FILTERS)[number]

const OVERLINE = 'text-[10px] font-bold tracking-[0.08em] text-n-3'

/** Lists browse — draft-mode CTA, position/tag filter rows, folders, and the
 *  3-up card grid. All list/folder mutations run through the existing hooks. */
export function ListsBrowse() {
  const { toast } = useToast()
  const openCreateList = useUIStore((s) => s.setCreateListOpen)
  const { data, isLoading, isError, error } = useLists(1, 100)
  const { data: folders = [] } = useFolders()
  const { data: tagData } = useTags({ systemOnly: true })
  const deleteFolder = useDeleteFolder()

  const [position, setPosition] = useState<PositionFilter>('All')
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const [editFolder, setEditFolder] = useState<ListFolder | null>(null)

  const lists = useMemo(() => data?.lists ?? [], [data])
  const openFolder = folderId ? folders.find((f) => f.id === folderId) ?? null : null

  // Filterable tag chips: the use-tags vocabulary, narrowed to tags actually
  // used on the viewer's lists (the full system set — weeks, formats — would
  // be dozens of chips that all filter to nothing).
  const tagChips = useMemo(() => {
    const used = new Map<string, string>()
    for (const list of lists) {
      for (const t of list.tags ?? []) if (!used.has(t.slug)) used.set(t.slug, t.name)
    }
    const ordered: { slug: string; name: string }[] = []
    for (const t of tagData?.tags ?? []) {
      if (used.has(t.slug)) {
        ordered.push({ slug: t.slug, name: t.name })
        used.delete(t.slug)
      }
    }
    // Custom (non-system) tags follow the system ones.
    for (const [slug, name] of used) ordered.push({ slug, name })
    return ordered
  }, [tagData, lists])

  const listCountFor = (f: ListFolder) =>
    lists.filter((l) => l.folder_id === f.id).length

  const shown = useMemo(() => {
    return lists
      .filter((list) => {
        if (position !== 'All' && list.position_filter !== position) return false
        if (
          tagFilters.length > 0 &&
          !(list.tags ?? []).some((t) => tagFilters.includes(t.slug))
        )
          return false
        if (folderId && list.folder_id !== folderId) return false
        return true
      })
      .sort(
        (a, b) =>
          new Date(b.updated_at ?? 0).getTime() -
          new Date(a.updated_at ?? 0).getTime(),
      )
  }, [lists, position, tagFilters, folderId])

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] w-full" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-sm border border-negative-strong bg-negative-soft p-6 text-sm font-medium text-ink">
        {(error as Error)?.message ?? 'Failed to load lists.'}
      </div>
    )
  }

  if (lists.length === 0) {
    return (
      <div className="rounded-sm border border-ink bg-white px-6 py-14 text-center">
        <h2 className="text-h5">No lists yet</h2>
        <p className="mt-2 text-sm font-medium text-n-3">
          Build your first board — rankings are lists under the hood.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="blue" shadow onClick={() => openCreateList(true)}>
            <Icon name="plus" size={13} /> New list
          </Button>
        </div>
      </div>
    )
  }

  const draftModeHref = folderId
    ? `/app/lists/draft-mode?folder=${folderId}`
    : '/app/lists/draft-mode'

  return (
    <div className="space-y-5">
      {/* Draft mode CTA — lime is "look here", reserved for the live-draft moment. */}
      <div className="flex flex-col gap-1.5">
        <Button
          asChild
          size="sm"
          variant="lime"
          shadow
          className="self-start bg-brand"
        >
          <Link href={draftModeHref}>
            <Icon name="table" size={13} /> Draft mode
          </Link>
        </Button>
        <p className="text-xs font-semibold text-n-3">
          View lists side by side on draft day — tap a player to mark him off
          the board.
        </p>
      </div>

      {/* Filter rows */}
      <div className="flex flex-wrap items-center gap-1.5">
        {POSITION_FILTERS.map((pos) => (
          <FilterChip
            key={pos}
            pressed={position === pos}
            onPressedChange={() => setPosition(pos)}
          >
            {pos}
          </FilterChip>
        ))}
        {tagChips.length > 0 && (
          <span className="mx-1.5 h-[18px] w-px shrink-0 bg-n-4" aria-hidden />
        )}
        {tagChips.map((tag) => (
          <FilterChip
            key={tag.slug}
            pressed={tagFilters.includes(tag.slug)}
            onPressedChange={() =>
              setTagFilters((cur) =>
                cur.includes(tag.slug)
                  ? cur.filter((s) => s !== tag.slug)
                  : [...cur, tag.slug],
              )
            }
          >
            {tag.name}
          </FilterChip>
        ))}
      </div>

      {/* Folder scope crumb */}
      {openFolder && (
        <div className="flex items-center gap-2">
          <Button variant="stroke" size="sm" onClick={() => setFolderId(null)}>
            <Icon name="arrow-prev" size={13} /> All lists
          </Button>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ink">
            <Icon name="folder" size={14} /> {openFolder.name}
          </span>
          <Badge variant="stroke" className="fs-num">
            {listCountFor(openFolder)}
          </Badge>
        </div>
      )}

      {/* Folders (only once the user has some, and not while inside one) */}
      {!openFolder && folders.length > 0 && (
        <section className="space-y-2.5">
          <h2 className={OVERLINE}>Folders</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {folders.map((folder) => {
              const count = listCountFor(folder)
              return (
                <div
                  key={folder.id}
                  role="button"
                  tabIndex={0}
                  title={`Open ${folder.name}`}
                  onClick={(e) => {
                    const t = e.target as HTMLElement
                    if (t.closest('a, button, [role="menu"]')) return
                    setFolderId(folder.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setFolderId(folder.id)
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-sm border border-ink bg-white px-4 py-3 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4"
                >
                  {folder.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={folder.thumbnail_url}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-sm border border-ink object-cover"
                    />
                  ) : (
                    <Icon name="folder" size={18} className="shrink-0 text-ink" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-ink">
                      {folder.name}
                    </p>
                    <p className="text-[11px] font-semibold text-n-3">
                      <span className="fs-num">{count}</span> list
                      {count === 1 ? '' : 's'}
                    </p>
                  </div>
                  {count > 0 ? (
                    <Button asChild variant="stroke" size="sm" className="shrink-0">
                      <Link href={`/app/lists/draft-mode?folder=${folder.id}`}>
                        <Icon name="table" size={13} /> Draft mode
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="stroke" size="sm" disabled className="shrink-0">
                      <Icon name="table" size={13} /> Draft mode
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${folder.name}`}
                      >
                        <Icon name="dots" size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditFolder(folder)}>
                        <Icon name="edit" size={13} /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="focus:bg-negative-soft"
                        onSelect={() =>
                          deleteFolder.mutate(folder.id, {
                            onSuccess: () =>
                              toast({
                                title: 'Folder deleted — lists kept',
                                description: folder.name,
                              }),
                            onError: (e) =>
                              toast({
                                title: 'Could not delete folder',
                                description: e.message,
                                variant: 'destructive',
                              }),
                          })
                        }
                      >
                        <Icon name="remove" size={13} /> Delete folder
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })}
          </div>
          <h2 className={`${OVERLINE} pt-2`}>Lists</h2>
        </section>
      )}

      {/* Lists grid */}
      {shown.length === 0 ? (
        <div className="rounded-sm border border-ink bg-white px-5 py-10 text-center">
          <h2 className="text-h6">
            {openFolder ? 'Nothing in this folder yet' : 'No lists match these filters'}
          </h2>
          <p className="mt-1.5 text-sm font-medium text-n-3">
            {openFolder
              ? "Open a list's menu and pick Move to folder."
              : 'Clear a chip or two and try again.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((list) => (
            <ListCard key={list.id} list={list} folders={folders} />
          ))}
        </div>
      )}

      {editFolder && (
        <FolderFormDialog
          open={Boolean(editFolder)}
          onOpenChange={(open) => {
            if (!open) setEditFolder(null)
          }}
          mode="edit"
          folder={editFolder}
        />
      )}
    </div>
  )
}
