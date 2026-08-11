'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { ListGalleryCard } from './list-gallery-card'
import { ListsPageHeader } from './lists-page-header'
import { ListsRail } from './lists-rail'
import {
  formatCreated,
  partitionLists,
  playerCountLabel,
  type ListsPageMode,
  type ListsTab,
} from './lists-view-state'

import { PageHeader } from '@/components/layout/app-header'
import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useLists, type ListWithTags } from '@/hooks/use-lists'
import { useUIStore } from '@/stores/ui-store'

/**
 * Lists v2 — the Lists page (LV.2; handoff §"Lists page").
 *
 * Route-level branch target for `featureFlags.listsV2` (LV.1.1). Renders the
 * page header, the rail mode and the cards gallery over the lists the existing
 * `useLists` hook already fetches — this task adds no route, no schema and no
 * fetching of its own (delivery plan §1).
 *
 * Two seams are deliberate and named here so nobody reads them as unfinished
 * work that slipped:
 *
 * - **Side by side** is round 2 (delivery plan §6). Its segment renders
 *   disabled; `PAGE_MODES` in `lists-view-state.ts` is the single place that
 *   says so, and a unit test pins it.
 * - **The rail's right-hand panel** is the list detail, which is LV.3's whole
 *   task. Until then it shows the selected list's identity and opens it — the
 *   same destination the gallery cards use.
 */
export function ListsPageV2() {
  const openCreateList = useUIStore((s) => s.setCreateListOpen)
  const { data, isError, error, refetch, isFetching, fetchStatus } = useLists(1, 100)

  const [mode, setMode] = useState<ListsPageMode>('rail')
  const [tab, setTab] = useState<ListsTab>('mine')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { mine, saved } = useMemo(
    () => partitionLists(data?.lists ?? []),
    [data?.lists],
  )
  const shown = tab === 'saved' ? saved : mine

  // Derived, not stored: the tab can change under a selection, and a list can
  // disappear (deleted elsewhere) while its id is still in state. Falling back
  // to the first row keeps the panel populated without an effect.
  const selected: ListWithTags | null =
    shown.find((l) => l.id === selectedId) ?? shown[0] ?? null

  const newListButton = (
    <Button variant="blue" size="sm" shadow onClick={() => openCreateList(true)}>
      <Icon name="plus" size={12} /> New list
    </Button>
  )

  const header = (
    <ListsPageHeader
      mode={mode}
      onModeChange={setMode}
      tab={tab}
      onTabChange={setTab}
      counts={{ mine: mine.length, saved: saved.length }}
    />
  )

  /**
   * **"No lists yet" requires an answer, never the absence of one.** Only a
   * payload we actually received can put the empty state on screen; every
   * state without one is loading or a failure, and says which.
   *
   * This is not defensive theatre — it was measured. With `/api/lists` forced
   * to 500, React Query left the query at `status: 'pending'` /
   * `fetchStatus: 'paused'` (its `networkMode: 'online'` retryer parks a
   * failed attempt instead of surfacing it), so `isLoading` **and** `isError`
   * were both `false` with no data, and an earlier `isLoading → isError →
   * empty` chain rendered "No lists yet" over a broken API. That is precisely
   * CLAUDE.md's "never let 'nothing happened' mean 'it worked'".
   */
  let body: React.ReactNode
  if (data) {
    body =
      shown.length === 0 ? (
        <ListsEmpty tab={tab} onNewList={() => openCreateList(true)} />
      ) : mode === 'gallery' ? (
        <Gallery
          lists={shown}
          // The New list tile belongs to your own gallery — a saved list is
          // someone else's, so offering "new" there reads as "new saved list".
          onNewList={tab === 'mine' ? () => openCreateList(true) : undefined}
        />
      ) : (
        // No gap: the rail's right border is removed so the two panels share
        // one edge (handoff §"Mode: List (rail)").
        <div className="grid items-start gap-3 lg:grid-cols-[160px_minmax(0,1fr)] lg:gap-0">
          <ListsRail
            lists={shown}
            selectedId={selected?.id ?? null}
            onSelect={(list) => setSelectedId(list.id)}
            emptyMessage="Lists you save from other people show up here."
          />
          {selected ? <SelectedListPanel list={selected} /> : <NothingSelected />}
        </div>
      )
  } else if (isError) {
    body = (
      <ListsError
        message={(error as Error)?.message ?? 'Something went wrong.'}
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    )
  } else if (fetchStatus === 'paused') {
    body = (
      <ListsError
        title="Your lists are still on the way"
        message="The request is paused because the connection dropped. Your lists are safe — this page just could not reach them."
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    )
  } else {
    body = <ListsLoading mode={mode} />
  }

  return (
    <>
      {/* Desktop: the shell header hosts the page header, exactly as the
          prototype's app shell does. It is `hidden lg:block`, so the same
          header renders in the page below that breakpoint — one component,
          two mount points, never a fork. */}
      <PageHeader title={header} actions={newListButton} />
      <div className="mb-4 lg:hidden">
        <ListsPageHeader
          mode={mode}
          onModeChange={setMode}
          tab={tab}
          onTabChange={setTab}
          counts={{ mine: mine.length, saved: saved.length }}
          actions={newListButton}
        />
      </div>

      {/* A refetch that fails on top of lists we already have must not throw
          them away — but it must still say so. The full error card is only for
          the case where there is nothing to show. */}
      {isError && data ? (
        <ListsError
          variant="strip"
          message={(error as Error)?.message ?? 'Something went wrong.'}
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      ) : null}

      {body}
    </>
  )
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function Gallery({
  lists,
  onNewList,
}: {
  lists: ListWithTags[]
  onNewList?: () => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(214px,1fr))] gap-3">
      {lists.map((list) => (
        <ListGalleryCard key={list.id} list={list} href={`/app/lists/${list.id}`} />
      ))}
      {onNewList ? (
        <button
          type="button"
          onClick={onNewList}
          className="flex min-h-[192px] flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed border-ink bg-transparent text-n-3 transition-colors hover:bg-accent-soft hover:text-accent-strong"
        >
          <Icon name="plus" size={18} />
          <span className="text-[11px] font-bold">New list</span>
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rail mode — the panel beside the rail
// ---------------------------------------------------------------------------

/**
 * The selected list, summarised. LV.3 replaces this whole panel with the list
 * detail screen (hero, tabs, toolbar, the three view styles); the border
 * treatment here is the shared edge that panel inherits.
 */
function SelectedListPanel({ list }: { list: ListWithTags }) {
  return (
    <section className="rounded-sm border-1 border-ink bg-white p-4">
      <div className="flex flex-wrap items-start gap-3">
        <ListThumbnail
          size="lg"
          positionFilter={list.position_filter}
          isTeam={Boolean(list.is_team)}
          imageUrl={list.thumbnail_url}
          players={list.first_players}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-extrabold leading-tight tracking-[-0.01em] text-ink">
            {list.title}
          </h2>
          <p className="mt-1 text-[10px] font-medium leading-tight text-n-3">
            {list.owner ? (
              <span className="text-ink">@{list.owner.username} · </span>
            ) : null}
            {list.created_at ? `created ${formatCreated(list.created_at)} · ` : ''}
            {playerCountLabel(list.player_count)}
          </p>
          {list.description ? (
            <p className="mt-2 max-w-[60ch] text-[11px] font-medium leading-snug text-n-3">
              {list.description}
            </p>
          ) : null}
          {list.tags.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {list.tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="stroke"
                  className="h-[15px] px-1.5 text-[9px]"
                >
                  {tag.name}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          asChild
          variant="blue"
          size="sm"
          shadow
          // On a phone the button drops to its own row so the description keeps
          // the full column width.
          className="shrink-0 max-sm:order-last max-sm:basis-full"
        >
          <Link href={`/app/lists/${list.id}`}>
            Open list <Icon name="arrow-next" size={12} />
          </Link>
        </Button>
      </div>
    </section>
  )
}

function NothingSelected() {
  return (
    <section className="flex min-h-[288px] flex-col items-center justify-center gap-2.5 rounded-sm border-1 border-ink bg-white p-8 text-center">
      <Icon name="list" size={21} className="text-n-3" />
      <p className="text-[13px] font-extrabold text-ink">
        Select or create a new list
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Loading / empty / error
// ---------------------------------------------------------------------------

function ListsLoading({ mode }: { mode: ListsPageMode }) {
  if (mode === 'gallery') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(214px,1fr))] gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[248px] w-full rounded-sm" />
        ))}
      </div>
    )
  }
  return (
    <div className="grid items-start gap-3 lg:grid-cols-[160px_minmax(0,1fr)] lg:gap-0">
      <div className="flex flex-col rounded-sm border-1 border-ink bg-white lg:border-r-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-2 border-b border-n-4 px-2 py-[7px] last:border-b-0"
          >
            <Skeleton className="h-6 w-6 shrink-0 rounded-sm" />
            <div className="min-w-0 flex-1 space-y-1">
              <Skeleton className="h-2.5 w-4/5 rounded-sm" />
              <Skeleton className="h-2 w-3/5 rounded-sm" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-[168px] w-full rounded-sm" />
    </div>
  )
}

/**
 * Loud failure, never a plausible empty state (CLAUDE.md: "never let 'nothing
 * happened' mean 'it worked'"). A failed fetch says so and offers a retry — it
 * must never render as "no lists yet".
 */
function ListsError({
  message,
  onRetry,
  retrying,
  variant = 'card',
  title = 'Your lists could not be loaded',
}: {
  message: string
  onRetry: () => void
  retrying: boolean
  /** `strip` sits above lists that are still on screen from a previous load. */
  variant?: 'card' | 'strip'
  title?: string
}) {
  if (variant === 'strip') {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-sm border-1 border-negative-strong bg-negative-soft px-3 py-2">
        <Icon name="info-circle" size={13} className="text-ink" />
        <p className="text-[11px] font-semibold text-ink">
          These lists may be out of date — {message}
        </p>
        <Button
          variant="stroke"
          size="sm"
          className="ml-auto"
          onClick={onRetry}
          disabled={retrying}
        >
          <Icon name="repeat" size={12} /> {retrying ? 'Retrying…' : 'Try again'}
        </Button>
      </div>
    )
  }
  return (
    <div className="rounded-sm border-1 border-negative-strong bg-negative-soft p-5">
      <h2 className="text-[13px] font-extrabold text-ink">{title}</h2>
      <p className="mt-1 text-[11px] font-medium text-n-3">{message}</p>
      <Button
        variant="stroke"
        size="sm"
        className="mt-3"
        onClick={onRetry}
        disabled={retrying}
      >
        <Icon name="repeat" size={12} /> {retrying ? 'Retrying…' : 'Try again'}
      </Button>
    </div>
  )
}

function ListsEmpty({ tab, onNewList }: { tab: ListsTab; onNewList: () => void }) {
  if (tab === 'saved') {
    return (
      <div className="rounded-sm border-1 border-ink bg-white px-6 py-12 text-center">
        <Icon name="save" size={21} className="mx-auto text-n-3" />
        <h2 className="mt-2.5 text-[14px] font-extrabold text-ink">
          Nothing saved yet
        </h2>
        <p className="mt-1 text-[11px] font-medium text-n-3">
          Lists you save from other people show up here.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-sm border-1 border-ink bg-white px-6 py-12 text-center">
      <Icon name="list" size={21} className="mx-auto text-n-3" />
      <h2 className="mt-2.5 text-[14px] font-extrabold text-ink">No lists yet</h2>
      <p className="mt-1 text-[11px] font-medium text-n-3">
        Build your first board — rankings are lists under the hood.
      </p>
      <Button variant="blue" size="sm" shadow className="mt-4" onClick={onNewList}>
        <Icon name="plus" size={12} /> New list
      </Button>
    </div>
  )
}
