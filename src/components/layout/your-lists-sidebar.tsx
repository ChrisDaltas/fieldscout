'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowLeft,
  Folder,
  FolderPlus,
  MoreVertical,
  PanelLeft,
  PanelRight,
  Pencil,
  Search,
  Pin,
  Trash2,
  X,
} from 'lucide-react'

import { FolderFormDialog } from '@/components/lists/folder-form-dialog'
import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { PositionBadge } from '@/components/players/position-badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useDeleteFolder, useFolders } from '@/hooks/use-folders'
import { useLists, type ListWithTags } from '@/hooks/use-lists'
import { useListOrderStore } from '@/stores/list-order-store'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import type { ListFolder } from '@/types/database'

const POSITION_OPTIONS = ['', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'] as const

// Sentinel id for the virtual "Pinned" folder — it isn't a real list_folders
// row; its contents are every pinned (favorited) list, including ones owned by
// other users.
const PINNED_FOLDER_ID = '__pinned__'

interface YourListsSidebarProps {
  collapsed: boolean
}

export function YourListsSidebar({ collapsed }: YourListsSidebarProps) {
  const pathname = usePathname()
  const toggleCollapsed = useUIStore((s) => s.toggleSidebarCollapsed)

  // Manual, drag-reorderable list order (persisted to localStorage).
  const listOrder = useListOrderStore((s) => s.order)
  const syncListOrder = useListOrderStore((s) => s.sync)

  const { data, isLoading } = useLists(1, 100)
  const lists = useMemo<ListWithTags[]>(() => data?.lists ?? [], [data])

  // Keep the persisted order in sync with the live set of lists.
  useEffect(() => {
    syncListOrder(lists.map((l) => l.id))
  }, [lists, syncListOrder])
  const { data: folders = [] } = useFolders()
  const deleteFolder = useDeleteFolder()
  const { toast } = useToast()

  const [folderDialog, setFolderDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; folder: ListFolder } | null
  >(null)
  // Drill-down navigation. Entering a folder pushes a new "layer": only that
  // folder's lists show and the header gains a Back button. null = root view.
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  // Direction of the last navigation so the list pane slides the right way.
  const [navDir, setNavDir] = useState<'forward' | 'back'>('forward')

  const enterFolder = (id: string) => {
    setNavDir('forward')
    setSelectedFolderId(id)
  }
  const exitFolder = () => {
    setNavDir('back')
    setSelectedFolderId(null)
  }
  // Clicking a folder icon in the collapsed strip expands the sidebar and
  // drills into it (collapsed mode has no in-place drill-down).
  const openFromCollapsed = (id: string) => {
    toggleCollapsed()
    enterFolder(id)
  }

  const handleDeleteFolder = (folder: ListFolder) => {
    deleteFolder.mutate(folder.id, {
      onSuccess: () =>
        toast({
          title: 'Folder deleted',
          description: `Lists from “${folder.name}” are folderless again.`,
        }),
      onError: (err) =>
        toast({
          title: 'Could not delete folder',
          description: err.message,
          variant: 'destructive',
        }),
    })
  }

  // Local filter state.
  const [search, setSearch] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const [positionFilter, setPositionFilter] = useState<string>('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const openSearch = () => {
    setSearchActive(true)
    requestAnimationFrame(() => searchInputRef.current?.focus())
  }
  const closeSearch = () => {
    setSearchActive(false)
    setSearch('')
  }

  const filtered = useMemo(() => {
    let result = lists
    const q = search.trim().toLowerCase()
    if (q) result = result.filter((l) => l.title.toLowerCase().includes(q))
    if (positionFilter)
      result = result.filter((l) => l.position_filter === positionFilter)
    return result
  }, [lists, search, positionFilter])

  // Order by the persisted manual order; anything not yet in it falls to the end.
  const sorted = useMemo(() => {
    const idx = new Map(listOrder.map((id, i) => [id, i]))
    return [...filtered].sort(
      (a, b) =>
        (idx.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (idx.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }, [filtered, listOrder])

  const activeListId = useMemo(() => {
    const match = pathname.match(/^\/app\/lists\/([^/]+)/)
    return match?.[1] ?? null
  }, [pathname])

  // Folders only render in the default browse state — any active filter
  // flattens the view so results stay scannable.
  const filtersActive = Boolean(search.trim()) || Boolean(positionFilter)
  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders])

  // Pinning is additive: the "Pinned" folder is a cross-cutting shortcut to
  // every favorited list, but a pinned list ALSO stays visible in its real
  // folder (or at root). So pinned lists are not excluded from those views.
  const pinnedLists = useMemo(
    () => sorted.filter((l) => l.is_favorited),
    [sorted],
  )
  const hasPinned = pinnedLists.length > 0

  // The folder structure (Pinned + real folders) exists whenever there's
  // something to group and no flat filter is active. `showFolders` is the
  // expanded-only flavour; collapsed mode renders the same structure as icons.
  const structureVisible =
    !filtersActive && (folders.length > 0 || hasPinned)
  const showFolders = !collapsed && structureVisible

  // Collapsed mode shows folder icons + folderless list icons (no drill-down).
  const collapsedRootLists = structureVisible
    ? sorted.filter((l) => !l.folder_id || !folderIds.has(l.folder_id))
    : sorted

  // Folders only show in the default browse state, so a drilled-in folder only
  // counts while showFolders holds — an active filter flattens back to root.
  const isPinnedSelected = selectedFolderId === PINNED_FOLDER_ID
  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null
  const insideFolder =
    showFolders && (isPinnedSelected || selectedFolder !== null)
  const headerTitle = isPinnedSelected
    ? 'Pinned'
    : insideFolder
      ? selectedFolder!.name
      : 'Your Lists'
  // ~28px folder thumbnail (or icon) shown left of the name when drilled in.
  const headerLeading = isPinnedSelected ? (
    <Pin className="h-7 w-7 shrink-0 fill-current text-text-secondary" />
  ) : selectedFolder ? (
    selectedFolder.thumbnail_url ? (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-elevated-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={selectedFolder.thumbnail_url}
          alt=""
          className="h-full w-full object-cover"
        />
      </span>
    ) : (
      <Folder className="h-7 w-7 shrink-0 fill-current text-text-secondary" />
    )
  ) : null
  // Inside Pinned: every pinned list. Inside a real folder: that folder's
  // lists (pinned ones included). At root: folderless lists. Filtered: flat.
  const visibleLists = isPinnedSelected
    ? pinnedLists
    : insideFolder
      ? sorted.filter((l) => l.folder_id === selectedFolder!.id)
      : showFolders
        ? sorted.filter((l) => !l.folder_id || !folderIds.has(l.folder_id))
        : sorted

  return (
    <div className="group/sidebar flex h-full flex-col">
      <SidebarHeader
        title={headerTitle}
        onBack={insideFolder ? exitFolder : undefined}
        leading={insideFolder ? headerLeading : undefined}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />

      {!collapsed && (
        <>
          <PositionChips
            value={positionFilter}
            onChange={setPositionFilter}
          />
          <ControlsRow
            searchActive={searchActive}
            search={search}
            searchInputRef={searchInputRef}
            onSearchChange={setSearch}
            onOpenSearch={openSearch}
            onCloseSearch={closeSearch}
            onNewFolder={() => setFolderDialog({ mode: 'create' })}
          />
        </>
      )}

      <div className="flex-1 overflow-hidden">
        {/* Keyed on the current layer so each navigation remounts and replays
            the slide — forward (into a folder) slides in from the right, Back
            slides in from the left, mirroring a push/pop down the stack. */}
        <div
          key={collapsed ? 'collapsed' : (selectedFolderId ?? 'root')}
          className={cn(
            'h-full overflow-y-auto px-2 pb-3 pt-1',
            'animate-in fade-in duration-300',
            navDir === 'forward'
              ? 'slide-in-from-right-6'
              : 'slide-in-from-left-6',
          )}
        >
          {collapsed ? (
            <ul>
              {structureVisible && hasPinned && (
                <CollapsedFolderButton
                  label="Pinned"
                  icon={
                    <Pin className="h-7 w-7 shrink-0 fill-current text-text-secondary" />
                  }
                  onOpen={() => openFromCollapsed(PINNED_FOLDER_ID)}
                />
              )}
              {structureVisible &&
                folders.map((folder) => (
                  <CollapsedFolderButton
                    key={folder.id}
                    label={folder.name}
                    thumbnailUrl={folder.thumbnail_url}
                    onOpen={() => openFromCollapsed(folder.id)}
                  />
                ))}
              {collapsedRootLists.map((list) => (
                <li key={list.id}>
                  <SidebarListRow
                    list={list}
                    active={activeListId === list.id}
                    collapsed
                  />
                </li>
              ))}
            </ul>
          ) : insideFolder ? (
            <ul>
              {visibleLists.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-text-tertiary">
                  This folder is empty.
                </li>
              ) : (
                <SortableContext
                  items={visibleLists.map((l) => `list-drag:${l.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {visibleLists.map((list) => (
                    <li key={list.id}>
                      <DraggableListRow
                        list={list}
                        active={activeListId === list.id}
                      />
                    </li>
                  ))}
                </SortableContext>
              )}
            </ul>
          ) : (
            <>
              {showFolders && (
                <ul>
                  {hasPinned && (
                    <PinnedFolderRow
                      count={pinnedLists.length}
                      onOpen={() => enterFolder(PINNED_FOLDER_ID)}
                    />
                  )}
                  {folders.map((folder) => (
                    <FolderSection
                      key={folder.id}
                      folder={folder}
                      count={
                        sorted.filter((l) => l.folder_id === folder.id).length
                      }
                      onOpen={() => enterFolder(folder.id)}
                      onEdit={() => setFolderDialog({ mode: 'edit', folder })}
                      onDelete={() => handleDeleteFolder(folder)}
                    />
                  ))}
                </ul>
              )}

              <RootListArea enabled={showFolders}>
                {isLoading && sorted.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-text-tertiary">
                    Loading lists…
                  </li>
                )}
                {!isLoading && visibleLists.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-text-tertiary">
                    No lists match these filters.
                  </li>
                )}
                <SortableContext
                  items={visibleLists.map((l) => `list-drag:${l.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {visibleLists.map((list) => (
                    <li key={list.id}>
                      <DraggableListRow
                        list={list}
                        active={activeListId === list.id}
                      />
                    </li>
                  ))}
                </SortableContext>
              </RootListArea>
            </>
          )}
        </div>
      </div>

      <FolderFormDialog
        open={folderDialog !== null}
        onOpenChange={(next) => {
          if (!next) setFolderDialog(null)
        }}
        mode={folderDialog?.mode ?? 'create'}
        folder={folderDialog?.mode === 'edit' ? folderDialog.folder : undefined}
      />
    </div>
  )
}

/**
 * Folderless region — also the drop target for dragging a list OUT of a
 * folder ("folder-drop:root" clears folder_id).
 */
function RootListArea({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: 'folder-drop:root',
    disabled: !enabled,
  })
  const draggingFromFolder = Boolean(
    (active?.data.current as { kind?: string; fromFolder?: boolean } | undefined)
      ?.fromFolder,
  )

  return (
    <ul
      ref={setNodeRef}
      className={cn(
        'min-h-[40px] rounded-md transition-colors',
        enabled && draggingFromFolder && 'bg-foreground/5 ring-1 ring-foreground/20',
        enabled && draggingFromFolder && isOver && 'ring-foreground/60',
      )}
    >
      {children}
    </ul>
  )
}

/** Sidebar list row wrapped as a drag source (`kind: 'list'`). */
function DraggableListRow({
  list,
  active,
}: {
  list: ListWithTags
  active: boolean
}) {
  // Sortable so rows can be dragged to manually reorder; the row is also the
  // drag source for moving a list into/out of a folder (handled app-level).
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    transform,
    transition,
  } = useSortable({
    id: `list-drag:${list.id}`,
    data: {
      kind: 'list',
      listId: list.id,
      label: list.title,
      fromFolder: Boolean(list.folder_id),
    },
  })

  // Swallow the post-drag click so finishing a drag doesn't also navigate.
  const wasDragging = useRef(false)
  if (isDragging) wasDragging.current = true

  return (
    <div
      ref={setNodeRef}
      // The app DragOverlay renders the moving chip, so the active row stays
      // put as a dimmed placeholder; only the other rows shift (transform).
      style={{
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      onClickCapture={(e) => {
        if (wasDragging.current) {
          wasDragging.current = false
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      className={cn('touch-manipulation', isDragging && 'opacity-50')}
    >
      <SidebarListRow list={list} active={active} collapsed={false} />
    </div>
  )
}

/**
 * A folder row in the sidebar's root view. Clicking it drills into the folder
 * (a new navigation layer showing only that folder's lists). It's still a drop
 * target — drag a list onto it to move the list into the folder — and exposes
 * a hover-revealed ⋯ menu with Edit / Delete.
 */
function FolderSection({
  folder,
  count,
  onOpen,
  onEdit,
  onDelete,
}: {
  folder: ListFolder
  count: number
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: `folder-drop:${folder.id}`,
  })
  const draggingList =
    (active?.data.current as { kind?: string } | undefined)?.kind === 'list'

  return (
    <li>
      <div
        ref={setNodeRef}
        className={cn(
          'group/folder relative flex items-center gap-3 rounded-md px-2 py-2 transition-colors',
          draggingList && 'ring-1 ring-foreground/20',
          draggingList && isOver && 'bg-foreground/10 ring-foreground/60',
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${folder.name}`}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {folder.thumbnail_url ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-elevated-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={folder.thumbnail_url}
                alt=""
                className="h-full w-full object-cover"
              />
            </span>
          ) : (
            <Folder className="h-10 w-10 shrink-0 fill-current text-text-secondary" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-foreground">
              {folder.name}
            </span>
            <span className="block text-sm font-medium text-text-secondary">
              {count} list{count === 1 ? '' : 's'}
            </span>
          </span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Folder options for ${folder.name}`}
              // Floated out of flow so the folder name can use the full width;
              // only appears (and becomes clickable) on hover / focus / open.
              className="pointer-events-none absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-bg-elevated-2 text-text-secondary opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/folder:pointer-events-auto group-hover/folder:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-bg-elevated-2 bg-bg-elevated">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

/**
 * The special "Pinned" folder. Like a real folder it drills into a layer of
 * its lists, but it has no rename/delete menu and isn't a drop target — its
 * contents are every list the user has pinned (favorited), including lists
 * owned by other users.
 */
function PinnedFolderRow({
  count,
  onOpen,
}: {
  count: number
  onOpen: () => void
}) {
  return (
    <li>
      <div className="group/folder flex items-center gap-3 rounded-md px-2 py-2 transition-colors">
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open Pinned"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center">
            <Pin className="h-7 w-7 shrink-0 fill-current text-text-secondary" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-foreground">
              Pinned
            </span>
            <span className="block text-sm font-medium text-text-secondary">
              {count} list{count === 1 ? '' : 's'}
            </span>
          </span>
        </button>
      </div>
    </li>
  )
}

/**
 * A folder shown in the collapsed sidebar strip — just its thumbnail/icon.
 * Clicking it expands the sidebar and drills into the folder.
 */
function CollapsedFolderButton({
  label,
  thumbnailUrl,
  icon,
  onOpen,
}: {
  label: string
  thumbnailUrl?: string | null
  icon?: React.ReactNode
  onOpen: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={label}
        aria-label={`Open ${label}`}
        className="flex w-full items-center justify-center rounded-full px-2 py-1.5 transition-colors hover:bg-bg-elevated-2"
      >
        {thumbnailUrl ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-elevated-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
          </span>
        ) : (
          (icon ?? (
            <Folder className="h-7 w-7 shrink-0 fill-current text-text-secondary" />
          ))
        )}
      </button>
    </li>
  )
}

interface SidebarHeaderProps {
  title: string
  /** When set, the header is a drilled-in folder layer — show a Back button. */
  onBack?: () => void
  /** Drill-in only: a ~28px folder thumbnail / icon shown left of the title. */
  leading?: React.ReactNode
  collapsed: boolean
  onToggleCollapsed: () => void
}

function SidebarHeader({
  title,
  onBack,
  leading,
  collapsed,
  onToggleCollapsed,
}: SidebarHeaderProps) {
  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 px-2 py-3">
        <button
          type="button"
          aria-label="Expand sidebar"
          title="Expand sidebar"
          onClick={onToggleCollapsed}
          className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
        >
          <PanelRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  if (onBack) {
    return (
      <div className="flex shrink-0 items-center gap-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 self-start rounded-full text-sm font-medium text-text-secondary transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex min-w-0 items-center gap-2">
            {leading}
            <p className="truncate text-lg font-bold text-foreground">{title}</p>
          </div>
        </div>

        <button
          type="button"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={onToggleCollapsed}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center px-4 py-3">
      {/* Hover-only controls — collapsed to zero width by default so
          "Your Lists" sits at the left edge, then animate the row open
          on hover to push the title to the right. */}
      <div
        className={cn(
          'flex items-center gap-0.5 overflow-hidden',
          'max-w-0 opacity-0 transition-all duration-200 ease-out',
          'group-hover/sidebar:max-w-[80px] group-hover/sidebar:opacity-100 group-hover/sidebar:mr-2',
          'focus-within:max-w-[80px] focus-within:opacity-100 focus-within:mr-2',
        )}
      >
        <button
          type="button"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={onToggleCollapsed}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      </div>

      <p className="truncate text-lg font-bold text-foreground transition-all duration-200 ease-out">
        {title}
      </p>

      <div className="flex-1" />
    </div>
  )
}

function PositionChips({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="shrink-0 overflow-x-auto px-4 pb-2 scrollbar-none">
      <div className="flex items-center gap-1.5">
        {POSITION_OPTIONS.map((pos) => {
          const active = value === pos
          return (
            <button
              key={pos || 'all'}
              type="button"
              onClick={() => onChange(pos)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                active
                  ? 'bg-foreground text-background'
                  : 'bg-bg-elevated-2 text-text-secondary hover:bg-bg-elevated-3 hover:text-foreground',
              )}
            >
              {pos || 'All'}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface ControlsRowProps {
  searchActive: boolean
  search: string
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onSearchChange: (v: string) => void
  onOpenSearch: () => void
  onCloseSearch: () => void
  onNewFolder: () => void
}

function ControlsRow({
  searchActive,
  search,
  searchInputRef,
  onSearchChange,
  onOpenSearch,
  onCloseSearch,
  onNewFolder,
}: ControlsRowProps) {
  return (
    <div className="flex shrink-0 items-center gap-1 px-4 pb-3">
      {searchActive ? (
        <div className="flex h-9 flex-1 items-center gap-2 rounded-full border border-bg-elevated-2 bg-bg-elevated-3 px-3">
          <Search className="h-4 w-4 text-text-tertiary" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search your lists…"
            className="h-full flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-text-tertiary"
          />
          <button
            type="button"
            aria-label="Close search"
            onClick={onCloseSearch}
            className="text-text-tertiary transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search your lists"
          title="Search your lists"
          className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
        >
          <Search className="h-4 w-4" />
        </button>
      )}

      {!searchActive && <div className="flex-1" />}

      <button
        type="button"
        onClick={onNewFolder}
        aria-label="New folder"
        title="New folder"
        className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-bg-elevated-2 hover:text-foreground"
      >
        <FolderPlus className="h-4 w-4" />
      </button>
    </div>
  )
}

interface SidebarListRowProps {
  list: ListWithTags
  active: boolean
  collapsed: boolean
}

function SidebarListRow({ list, active, collapsed }: SidebarListRowProps) {
  // Defense lists store position_filter as 'DEF'; display it as the 'DST' tag.
  const positionLabel =
    list.position_filter === 'DEF' ? 'DST' : list.position_filter
  const playerCountText = `${list.player_count} player${list.player_count === 1 ? '' : 's'}`
  // Plain-text variant for the collapsed-rail tooltip (no badges there).
  const metaLine = [list.position_filter, playerCountText].filter(Boolean).join(' · ')

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={`/app/lists/${list.id}`}
            aria-label={list.title}
            className={cn(
              'flex items-center justify-center rounded-md px-2 py-2.5 transition-colors hover:bg-bg-elevated-2',
              active && 'bg-bg-elevated-2',
            )}
          >
            <ListThumbnail
              positionFilter={list.position_filter}
              isTeam={list.is_team ?? false}
              imageUrl={list.thumbnail_url}
              players={list.first_players}
              size="lg"
              className="h-12 w-12"
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className="max-w-[220px]">
          <p
            className={cn(
              'truncate text-sm font-semibold',
              active && 'text-tier-a',
            )}
          >
            {list.title}
          </p>
          {(list.owner || metaLine) && (
            <p className="truncate text-xs text-text-secondary">
              {list.owner ? `${list.owner.username} · ${metaLine}` : metaLine}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Link
      href={`/app/lists/${list.id}`}
      className={cn(
        'flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-bg-elevated-2',
        active && 'bg-bg-elevated-2',
      )}
    >
      <ListThumbnail
        positionFilter={list.position_filter}
        isTeam={list.is_team ?? false}
        imageUrl={list.thumbnail_url}
        players={list.first_players}
        size="lg"
        className="h-12 w-12"
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-base font-semibold transition-colors',
            active ? 'text-tier-a' : 'text-foreground',
          )}
        >
          {list.title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-text-secondary">
          {list.owner && (
            <>
              <UserAvatar
                src={list.owner.avatar_url}
                name={list.owner.display_name ?? list.owner.username}
                className="h-4 w-4 shrink-0"
              />
              <span className="min-w-0 truncate">{list.owner.username}</span>
            </>
          )}
          {positionLabel && (
            <PositionBadge
              position={positionLabel}
              size="sm"
              className="shrink-0"
            />
          )}
          <span className="shrink-0 truncate">{playerCountText}</span>
        </span>
      </span>
    </Link>
  )
}

