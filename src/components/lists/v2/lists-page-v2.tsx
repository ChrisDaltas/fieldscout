'use client'

import { useSearchParams } from 'next/navigation'
import * as React from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { FolderFormDialog } from '@/components/lists/folder-form-dialog'
import { GenerateAiButton } from '@/components/lists/generate-ai-button'
import { Button } from '@/components/ui/button'
import { Icon, type IconName } from '@/components/ui/icon'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { useDeleteFolder, useFolders, useMoveListToFolder } from '@/hooks/use-folders'
import { useToast } from '@/hooks/use-toast'
import {
  useDeleteList,
  useDuplicateList,
  useLists,
  useToggleFavorite,
  type ListWithTags,
} from '@/hooks/use-lists'
import { cn } from '@/lib/utils'
import { useAiBuildStore } from '@/stores/ai-build-store'
import { useUIStore } from '@/stores/ui-store'
import type { ListFolder } from '@/types/database'

import { ListGalleryCard, NewListTile } from './list-gallery-card'
import { ListDetailPanel } from './list-detail-panel'
import { FolderScopeCrumb, ListFoldersSection } from './lists-folders'
import { ListsRail } from './lists-rail'

/**
 * Lists v2 — the Lists page (LV.2, rebuilt from
 * `docs/design/lists/screens/*.png`).
 *
 * Three page modes behind one header: **List** (rail plus the open list),
 * **Cards** (the gallery), and **Side by side**. The first two are built here;
 * the third renders its segment and says where it lives, because it is its own
 * task.
 *
 * **The structural point, since the previous attempt got it wrong:** in List
 * mode the right-hand panel is the *whole* open list — hero, tabs, toolbar and
 * rows. Not a cover with an "Open list" button (PROGRESS §7 gap 1).
 *
 * The header's resting / hover / active colours are Tailwind classes, never
 * inline styles — the handoff's own critical note, and the reason its
 * segmented control lost its hover state.
 *
 * **Create with AI lives in this header (LV.5).** It is not decoration: the
 * 2026 go-live ships "Lists + Stats/player research + **AI stat lists**"
 * (CLAUDE.md → Active Builds), and this screen is what LV.7 flips the flag to.
 * Rebuilding the page as a new file quietly dropped the trigger the legacy page
 * carries, which is exactly the outcome CLAUDE.md → Redesign forbids ("never
 * remove them"). `ai-surfaces.test.ts` pins it so a later tidy-up cannot repeat
 * the omission silently.
 */

type PageMode = 'rail' | 'gallery' | 'compare'
type ListsTab = 'mine' | 'saved'

const MODES: ReadonlyArray<{ id: PageMode; label: string; icon: IconName }> = [
  { id: 'rail', label: 'List', icon: 'list' },
  { id: 'gallery', label: 'Cards', icon: 'layers' },
  { id: 'compare', label: 'Side by side', icon: 'table' },
]

export function ListsPageV2() {
  const { toast } = useToast()
  const { profile } = useAuth()
  const openCreateList = useUIStore((state) => state.setCreateListOpen)

  /**
   * **The deep link (LV.7).** `/app/lists/[listId]` used to be a whole page; in
   * Lists v2 a list opens in this page's right-hand panel (§7 gap 1), so that
   * route now redirects here carrying `?list=<id>` and this reads it.
   *
   * It is a *seed*, not a controlled value: once the page is open, clicking a
   * different list must not have to rewrite the URL.
   *
   * **It seeds `useState`, and it has to — an effect is too late.** Written as
   * a `useEffect` this was measurably broken: on the first commit the seeding
   * effect set the selection to the deep-linked id, and the auto-selection
   * effect below ran in the same commit with a closure that still saw
   * `selectedId === null` and an empty collection, so it immediately wrote
   * `null` over it. The URL then said one list and the panel showed another
   * (caught in the browser at `/app/lists/<id>`, not by a test). Seeding the
   * initial state means the auto-selection effect sees the pin
   * (`selectedId === deepLinkId`) from its very first run.
   */
  const deepLinkId = useSearchParams().get('list')

  const [mode, setMode] = React.useState<PageMode>('rail')
  const [tab, setTab] = React.useState<ListsTab>('mine')
  const [selectedId, setSelectedId] = React.useState<string | null>(deepLinkId)
  const [openedId, setOpenedId] = React.useState<string | null>(deepLinkId)
  const [expanded, setExpanded] = React.useState(false)
  const [folderId, setFolderId] = React.useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = React.useState(false)
  const [editFolder, setEditFolder] = React.useState<ListFolder | null>(null)
  const tabSeededRef = React.useRef(false)

  const lists = useLists(1, 50)
  const duplicateList = useDuplicateList()
  const deleteList = useDeleteList()
  const toggleFavorite = useToggleFavorite()
  const folders = useFolders()
  const deleteFolder = useDeleteFolder()
  const moveToFolder = useMoveListToFolder()

  /**
   * **The AI build job is the deep link (LV.5).** Lists v2 has no standalone
   * detail screen — a list opens in this page's right-hand panel (§7 gap 1) —
   * so the generate dialog creates the list, queues the job, and navigates
   * here. The job already names its list, which makes a `?list=` query
   * parameter unnecessary: while a build is live, its list is by definition the
   * one to show.
   */
  const buildingListId = useAiBuildStore((state) => state.job?.listId ?? null)

  const viewer = React.useMemo(
    () => ({ username: profile?.username ?? null, avatarUrl: profile?.avatar_url ?? null }),
    [profile?.username, profile?.avatar_url],
  )

  // "Saved" is a list you favourited that someone else owns — the collection
  // route only populates `owner` for exactly those, so it is the whole test.
  const { mine, saved } = React.useMemo(() => {
    const all = lists.data?.lists ?? []
    const own = all.filter((list) => !list.owner)
    // Favorites is permanent and always leads (design LAW, store rules).
    own.sort((a, b) => Number(Boolean(b.is_favorites)) - Number(Boolean(a.is_favorites)))
    return { mine: own, saved: all.filter((list) => Boolean(list.owner)) }
  }, [lists.data?.lists])

  const openFolder = folderId
    ? (folders.data ?? []).find((folder) => folder.id === folderId) ?? null
    : null

  // Folders scope only your own lists: `lists.folder_id` is the owner's field,
  // so a saved list has nothing to be filed into (LV.7).
  const visible = React.useMemo(() => {
    const set = tab === 'mine' ? mine : saved
    if (!openFolder) return set
    return set.filter((list) => list.folder_id === openFolder.id)
  }, [tab, mine, saved, openFolder])

  // A build that just started takes the frame, in whichever mode the page is
  // in — `detailId` reads `openedId` in Cards mode and `selectedId` otherwise,
  // so both are set.
  React.useEffect(() => {
    if (!buildingListId) return
    setSelectedId(buildingListId)
    setOpenedId(buildingListId)
  }, [buildingListId])

  /**
   * The one part of the deep link an effect still owns: **which tab**. A link to
   * a *saved* list would otherwise land on "My lists" and be filtered out of the
   * rail, and that answer needs the collection, which has not arrived at mount.
   * Once, and only while the selection is still the one the URL asked for — so
   * it can never yank the tab out from under a click.
   */
  React.useEffect(() => {
    if (!deepLinkId || tabSeededRef.current || !lists.isSuccess) return
    tabSeededRef.current = true
    if (selectedId === deepLinkId && saved.some((list) => list.id === deepLinkId)) {
      setTab('saved')
    }
  }, [deepLinkId, saved, selectedId, lists.isSuccess])

  // Selection follows the visible set: opening the page, or switching tabs,
  // lands on the first list rather than an empty frame.
  React.useEffect(() => {
    if (mode !== 'rail') return
    // ...except while the AI is building, when the selection is pinned to its
    // list. The list was created seconds ago and the collection query may not
    // carry it yet; without this the line below would read "not in `visible`"
    // as "stale selection", bounce to the first list, and strand the build show
    // off-screen. The pin releases when the job clears — by which point
    // `use-ai-list-build` has invalidated the collection.
    if (buildingListId && selectedId === buildingListId) return
    // The same pin for a deep link. `/app/lists/<id>` could open any list the
    // viewer is allowed to see, including one that is neither owned nor saved
    // and so never appears in this collection — bouncing it to `visible[0]`
    // would turn a working URL into "here is some other list".
    if (deepLinkId && selectedId === deepLinkId) return
    if (selectedId && visible.some((list) => list.id === selectedId)) return
    setSelectedId(visible[0]?.id ?? null)
  }, [mode, visible, selectedId, buildingListId, deepLinkId])

  const summaryById = React.useMemo(
    () => new Map((lists.data?.lists ?? []).map((list) => [list.id, list])),
    [lists.data?.lists],
  )

  const shareList = (list: ListWithTags) => {
    const username = list.owner?.username ?? viewer.username ?? 'you'
    const link = `${window.location.origin}/u/${username}/lists/${list.slug}`
    void navigator.clipboard
      ?.writeText(link)
      .then(() => toast({ title: 'Link copied', description: link }))
      .catch(() => toast({ title: 'Could not copy the link', description: link, variant: 'destructive' }))
  }

  const pinList = (list: ListWithTags) =>
    toggleFavorite.mutate(list.id, {
      onSuccess: (result) =>
        toast({ title: result.is_favorited ? 'Pinned' : 'Unpinned', description: list.title }),
      onError: (error) =>
        toast({
          title: 'Could not update the pin',
          description: error.message,
          variant: 'destructive',
        }),
    })

  const fileList = (list: ListWithTags, nextFolderId: string | null) =>
    moveToFolder.mutate(
      { listId: list.id, folderId: nextFolderId },
      {
        onSuccess: () =>
          toast({
            title: nextFolderId ? 'Moved to folder' : 'Removed from folder',
            description: list.title,
          }),
        onError: (error) =>
          toast({
            title: 'Could not move the list',
            description: error.message,
            variant: 'destructive',
          }),
      },
    )

  const detailId = mode === 'gallery' ? openedId : selectedId

  /**
   * Whether the collection actually arrived — **not** the negation of
   * `isPending`.
   *
   * React Query has a third state: `fetchStatus: 'paused'`, which it enters
   * when it believes the browser is offline. A paused query is neither pending
   * in any useful sense nor errored, and every "no rows" branch below used to
   * treat it as "you have no lists". Asking `isSuccess` is the only question
   * whose true answer means the data is real.
   */
  const loaded = lists.isSuccess
  const paused = lists.fetchStatus === 'paused' && !lists.isSuccess

  /**
   * Page mode — the **icon + label** variation of the shared control
   * (`ui/tabs.tsx`), boxed, exactly as `screens/list-rail-list-view.png` draws
   * it. It is a `Segment` and not a Radix `Tabs` for a structural reason:
   * `PageHeader` pushes this row into the app shell through a Zustand store,
   * so the control and the content it switches are in different React trees
   * and a `Tabs.Root` cannot enclose both. It also renders twice — here and
   * in-page below `lg` — which a single `Tabs.Root` could not do either.
   */
  const modeSwitch = (
    <Segment aria-label="Page mode">
      {MODES.map((item) => (
        <SegmentItem
          key={item.id}
          icon={item.icon}
          active={mode === item.id}
          onClick={() => {
            setMode(item.id)
            setOpenedId(null)
            setExpanded(false)
          }}
        >
          {item.label}
        </SegmentItem>
      ))}
    </Segment>
  )

  /** The **label + count** variation, bare — same reasoning as `modeSwitch`. */
  const tabSwitch =
    mode === 'compare' ? null : (
      <Segment appearance="bare" aria-label="Which lists">
        {(
          [
            { id: 'mine', label: 'My lists', count: mine.length },
            { id: 'saved', label: 'Saved', count: saved.length },
          ] as const
        ).map((item) => (
          <SegmentItem
            key={item.id}
            active={tab === item.id}
            count={item.count}
            onClick={() => {
              setTab(item.id)
              setOpenedId(null)
              // Folders are your own lists' filing; Saved has nothing to file.
              if (item.id === 'saved') setFolderId(null)
            }}
          >
            {item.label}
          </SegmentItem>
        ))}
      </Segment>
    )

  return (
    <>
      <PageHeader
        title={
          <div className="flex min-w-0 items-center gap-3">
            <h3 className="shrink-0 text-h3">Lists</h3>
            {modeSwitch}
            {tabSwitch}
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <GenerateAiButton size="sm" />
            {/* Folders survive the cutover (LV.7, Chris 2026-08-11), so their
                one entry point does too — the retired Lists page carried this
                button in exactly this slot. */}
            <Button variant="stroke" size="sm" onClick={() => setNewFolderOpen(true)}>
              <Icon name="folder" size={13} /> New folder
            </Button>
            <Button variant="blue" size="sm" shadow onClick={() => openCreateList(true)}>
              <Icon name="plus" size={13} /> New list
            </Button>
          </div>
        }
      />

      {/* The shell hides its header below `lg` (`app-shell.tsx` — "mobile keeps
          the legacy top bar"), which would leave a phone with no way to change
          page mode or tab at all. The same controls therefore render in-page on
          small screens. The design package shows no mobile screens; this extends
          it rather than dropping the controls. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 lg:hidden">
        <h3 className="mr-auto text-h5">Lists</h3>
        {/* Create with AI rides along here too — the shell's header is hidden
            below `lg`, so leaving it out of this row would put AI list
            generation out of reach on a phone entirely. */}
        <GenerateAiButton size="sm" />
        <Button variant="stroke" size="sm" onClick={() => setNewFolderOpen(true)}>
          <Icon name="folder" size={13} /> New folder
        </Button>
        <Button variant="blue" size="sm" shadow onClick={() => openCreateList(true)}>
          <Icon name="plus" size={13} /> New list
        </Button>
        <div className="flex w-full flex-wrap items-center gap-2">
          {modeSwitch}
          {tabSwitch}
        </div>
      </div>

      {/* Folders (LV.7). Above the content in both page modes, which is where
          the retired Lists page put them — the design package defines no
          folders screen, so this is a carry rather than a new placement. */}
      {mode !== 'compare' && tab === 'mine' && !lists.isError && !paused && (
        openFolder ? (
          <FolderScopeCrumb
            folder={openFolder}
            count={visible.length}
            onClear={() => setFolderId(null)}
          />
        ) : (
          <ListFoldersSection
            folders={folders.data ?? []}
            countFor={(folder) => mine.filter((list) => list.folder_id === folder.id).length}
            onOpen={(folder) => {
              setFolderId(folder.id)
              setOpenedId(null)
            }}
            onRename={setEditFolder}
            onDelete={(folder) =>
              deleteFolder.mutate(folder.id, {
                onSuccess: () => {
                  if (folderId === folder.id) setFolderId(null)
                  toast({ title: 'Folder deleted — lists kept', description: folder.name })
                },
                onError: (error) =>
                  toast({
                    title: 'Could not delete the folder',
                    description: error.message,
                    variant: 'destructive',
                  }),
              })
            }
          />
        )
      )}

      {lists.isError ? (
        <ErrorState message={lists.error.message} onRetry={() => void lists.refetch()} />
      ) : paused ? (
        <ErrorState
          message="Your lists have not loaded because the browser reports no network connection."
          onRetry={() => void lists.refetch()}
        />
      ) : mode === 'compare' ? (
        <SideBySidePlaceholder />
      ) : mode === 'gallery' ? (
        openedId ? (
          <div className="mx-auto max-w-content">
            <ListDetailPanel
              listId={openedId}
              summary={summaryById.get(openedId)}
              viewer={viewer}
              expanded
              onToggleExpanded={() => setOpenedId(null)}
              onClose={() => setOpenedId(null)}
              onDeleted={() => setOpenedId(null)}
            />
          </div>
        ) : (
          <Gallery
            lists={visible}
            loading={!loaded}
            tab={tab}
            viewer={viewer}
            folders={folders.data ?? []}
            onTogglePin={pinList}
            onMoveToFolder={fileList}
            onOpen={(list) => {
              setSelectedId(list.id)
              setOpenedId(list.id)
            }}
            onShare={shareList}
            onDuplicate={(list) =>
              duplicateList.mutate(list.id, {
                onSuccess: (copy) => toast({ title: `“${copy.title}” created` }),
              })
            }
            onDelete={(list) =>
              deleteList.mutate(list.id, {
                onSuccess: () => toast({ title: `“${list.title}” moved to trash` }),
              })
            }
            onNew={() => openCreateList(true)}
          />
        )
      ) : (
        <div
          className={cn(
            // `grid-cols-1` is load-bearing, not decoration: without it the
            // single implicit column is `auto`, so the table's own min-width
            // pushes the whole page into a horizontal scroll on a phone.
            'grid grid-cols-1 items-start gap-3 lg:gap-0',
            expanded ? 'lg:grid-cols-1' : 'lg:grid-cols-[160px_minmax(0,1fr)]',
          )}
        >
          {!expanded && (
            <ListsRail
              lists={visible}
              loaded={loaded}
              selectedId={selectedId}
              onSelect={(list) => setSelectedId(list.id)}
              emptyMessage={
                tab === 'saved'
                  ? 'Lists you save from other people show up here.'
                  : 'No lists yet. Start one with New list.'
              }
              // Below `lg` the rail stacks above the open list instead of
              // sharing an edge with it. Hiding it there would strand a phone
              // inside whichever list was auto-selected.
              className="max-h-[224px] lg:max-h-none"
            />
          )}
          <div>
            {detailId ? (
              <ListDetailPanel
                listId={detailId}
                summary={summaryById.get(detailId)}
                viewer={viewer}
                expanded={expanded}
                onToggleExpanded={() => setExpanded((value) => !value)}
                onClose={() => {
                  setSelectedId(null)
                  setExpanded(false)
                }}
                onDeleted={() => {
                  setSelectedId(null)
                  setExpanded(false)
                }}
              />
            ) : (
              <EmptyDetail loading={!loaded} onNew={() => openCreateList(true)} />
            )}
          </div>
        </div>
      )}

      {/* Folder create / rename — the existing dialog, unchanged (LV.7). */}
      <FolderFormDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} mode="create" />
      {editFolder && (
        <FolderFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditFolder(null)
          }}
          mode="edit"
          folder={editFolder}
        />
      )}
    </>
  )
}

function Gallery({
  lists,
  loading,
  tab,
  viewer,
  folders,
  onOpen,
  onShare,
  onDuplicate,
  onDelete,
  onNew,
  onTogglePin,
  onMoveToFolder,
}: {
  lists: ListWithTags[]
  loading: boolean
  tab: ListsTab
  viewer: { username: string | null; avatarUrl: string | null }
  folders: ListFolder[]
  onOpen: (list: ListWithTags) => void
  onShare: (list: ListWithTags) => void
  onDuplicate: (list: ListWithTags) => void
  onDelete: (list: ListWithTags) => void
  onNew: () => void
  onTogglePin: (list: ListWithTags) => void
  onMoveToFolder: (list: ListWithTags, folderId: string | null) => void
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(214px,1fr))] gap-3">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="h-[228px] animate-pulse border border-n-4 bg-white">
            <div className="h-[93px] bg-n-4" />
          </div>
        ))}
      </div>
    )
  }

  if (lists.length === 0) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(214px,1fr))] gap-3">
        {tab === 'mine' ? (
          <NewListTile onClick={onNew} />
        ) : (
          <p className="col-span-full py-12 text-center text-[12px] font-semibold text-n-3">
            Lists you save from other people show up here.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(214px,1fr))] gap-3">
      {lists.map((list) => (
        <ListGalleryCard
          key={list.id}
          list={list}
          viewer={viewer}
          onOpen={() => onOpen(list)}
          onOpenComments={() => onOpen(list)}
          onShare={() => onShare(list)}
          onDuplicate={() => onDuplicate(list)}
          onDelete={() => onDelete(list)}
          folders={folders}
          onTogglePin={() => onTogglePin(list)}
          onMoveToFolder={(folderId) => onMoveToFolder(list, folderId)}
        />
      ))}
      {tab === 'mine' && <NewListTile onClick={onNew} />}
    </div>
  )
}

function EmptyDetail({ loading, onNew }: { loading: boolean; onNew: () => void }) {
  return (
    <div className="flex min-h-[288px] flex-col items-center justify-center gap-3 border border-ink bg-white p-8 text-center">
      <Icon name="list" size={21} className="text-n-3" />
      <span className="text-[13px] font-bold">
        {loading ? 'Loading your lists…' : 'Select or create a new list'}
      </span>
      {!loading && (
        <Button variant="blue" size="sm" shadow onClick={onNew}>
          <Icon name="plus" size={13} /> New list
        </Button>
      )}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-[288px] flex-col items-center justify-center gap-3 border border-ink bg-white p-8 text-center">
      <Icon name="info-circle" size={21} className="text-negative-strong" />
      <span className="text-[13px] font-bold">Your lists could not be loaded.</span>
      <p className="max-w-[360px] text-[11px] font-medium text-n-3">{message}</p>
      <Button variant="stroke" size="sm" onClick={onRetry}>
        <Icon name="reset" size={13} /> Try again
      </Button>
    </div>
  )
}

/**
 * Side by side renders its segment and nothing else.
 *
 * The mode is fully realised in the prototype — a picker, then 300px columns
 * with permanent drafted checkboxes and tier bands carrying through — and it is
 * its own task. Showing the segment keeps the header honest about the three
 * modes the design has; building the mode here would be scope creep.
 */
function SideBySidePlaceholder() {
  return (
    <div className="flex min-h-[288px] flex-col items-center justify-center gap-3 border border-dashed border-ink p-8 text-center">
      <Icon name="table" size={21} className="text-n-3" />
      <span className="text-[13px] font-bold">Side by side is not built yet</span>
      <p className="max-w-[400px] text-[11px] font-medium text-n-3">
        Comparing several boards as columns on draft night is its own task. Pick List or Cards to
        keep working.
      </p>
    </div>
  )
}
