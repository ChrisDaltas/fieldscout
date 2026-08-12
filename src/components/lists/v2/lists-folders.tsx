'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import type { ListFolder } from '@/types/database'

/**
 * Lists v2 — list folders (LV.7).
 *
 * **Ruled by Chris 2026-08-11: *"Folders yes keep folders."*** The cutover was
 * halted on exactly this (PROGRESS §3 Q3): folders are a database-backed
 * feature — `list_folders` (migrations 015/016), `lists.folder_id`, four
 * `/api/folders` routes, `src/hooks/use-folders.ts` — whose entire UI lived in
 * the two components LV.7 deletes.
 *
 * **So this is a carry, not a redesign, and deliberately so.** The design
 * package (`docs/design/lists/README.md`) mentions folders nowhere and its
 * `List` shape has no folder field, so there is no folders screen to build
 * *toward*; inventing one would be improvising against silent LAW (plan §1).
 * What ships here is the retired `lists-browse.tsx` folder grid and scope crumb,
 * with the same gestures over the same hooks — open, rename, delete, per-folder
 * count, and "Move to folder" from a list's own dots menu.
 *
 * Two deliberate differences from the retired version, both forced:
 *
 * * **No per-folder "Draft mode" button.** That surface (`/app/lists/draft-mode`
 *   and the whole `lists/draft-mode/**` tree) is deleted by this same task, on
 *   Chris's earlier ruling. A button to a route that no longer exists is worse
 *   than no button.
 * * **Folders appear on the "My lists" tab only.** A saved list belongs to
 *   somebody else and `lists.folder_id` is the owner's field, so there is
 *   nothing to file on the Saved tab.
 *
 * The tiles are flat at rest and lift on hover — they are clickable, so the
 * lift is an affordance for the thing you are about to click (CLAUDE.md,
 * "Elevation is a hover state, never a resting one").
 */

/** The bar that replaces the grid once you are inside a folder. */
export function FolderScopeCrumb({
  folder,
  count,
  onClear,
}: {
  folder: ListFolder
  count: number
  onClear: () => void
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button variant="stroke" size="sm" onClick={onClear}>
        <Icon name="arrow-prev" size={13} /> All lists
      </Button>
      <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ink">
        <Icon name="folder" size={14} /> {folder.name}
      </span>
      <Badge variant="stroke" className="fs-num">
        {count}
      </Badge>
    </div>
  )
}

export function ListFoldersSection({
  folders,
  countFor,
  onOpen,
  onRename,
  onDelete,
}: {
  folders: ListFolder[]
  countFor: (folder: ListFolder) => number
  onOpen: (folder: ListFolder) => void
  onRename: (folder: ListFolder) => void
  onDelete: (folder: ListFolder) => void
}) {
  if (folders.length === 0) return null

  return (
    <section className="mb-4 flex flex-col gap-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.08em] text-n-3">Folders</h2>
      <div className="grid gap-2 md:grid-cols-2">
        {folders.map((folder) => {
          const count = countFor(folder)
          return (
            <div
              key={folder.id}
              role="button"
              tabIndex={0}
              title={`Open ${folder.name}`}
              onClick={(event) => {
                const target = event.target as HTMLElement
                if (target.closest('a, button, [role="menu"], [role="menuitem"]')) return
                onOpen(folder)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpen(folder)
                }
              }}
              className="flex cursor-pointer items-center gap-2.5 border border-ink bg-white px-3 py-2 transition-shadow hover:shadow-hard-4"
            >
              {folder.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={folder.thumbnail_url}
                  alt=""
                  className="h-7 w-7 shrink-0 border border-ink object-cover"
                />
              ) : (
                <Icon name="folder" size={16} className="shrink-0 text-ink" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-ink">{folder.name}</p>
                <p className="text-[9px] font-medium text-n-3">
                  <span className="fs-num">{count}</span> list{count === 1 ? '' : 's'}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={`Actions for ${folder.name}`}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink transition-colors hover:bg-accent-soft"
                  >
                    <Icon name="dots" size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[168px]">
                  <DropdownMenuItem onSelect={() => onRename(folder)}>
                    <Icon name="edit" size={13} />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(folder)}>
                    <Icon name="remove" size={13} />
                    Delete folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        })}
      </div>
    </section>
  )
}
