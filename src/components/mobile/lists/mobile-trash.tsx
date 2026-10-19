'use client'

import { useState, type ReactNode } from 'react'

import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'
import { useRestoreList, useTrashedLists } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import type { List } from '@/types/database'

import { trashRowSub } from './lists-model'
import { CenterNote, CoverImage, InlineError, PillButton } from './lists-parts'

/** Trash's parent: Lists, where its rows come from and go back to. */
export const TRASH_PARENT = '/app/lists'

/** Copy shared by the screen and its tests. */
export const TRASH_COPY = {
  emptyTitle: 'Trash is empty',
  emptyBody: 'Deleted lists land here so you can restore them later.',
  loadFailed: 'Your trash could not be loaded.',
  offline: 'Your trash has not loaded because the browser reports no network connection.',
  refreshFailed: 'Trash could not be refreshed.',
} as const

/**
 * Trash on the phone (`/app/trash`, gap list §4 item 102) — the same page as
 * desktop's: your soft-deleted lists, most recently deleted first, each with
 * Restore. Deletes stay soft (CLAUDE.md rule 8), so there is no "delete
 * forever" here, and a deleted list can't be opened — Restore is the row's
 * one action.
 *
 * The handoff draws no Trash, so it extends the Lists language: the G-page
 * bar (blue back, "Trash"), rows ruled off by b2 hairlines like Profile's
 * list rows — a 40px b2 tile with the lists glyph (or the list's uploaded
 * cover), the title, "Deleted 2d ago · 12 players" — and a quiet Restore
 * pill. Each row restores on its own (two at once both go through); a row's
 * pill is off while its own restore is on its way, and the row leaves when
 * it lands, with a toast. Back goes to where you came from, else Lists.
 */
export function MobileTrash() {
  const goBack = useGoBack()
  const { toast } = useToast()
  const trash = useTrashedLists()
  const restore = useRestoreList()
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(() => new Set())

  const onRestore = async (list: List) => {
    if (restoring.has(list.id)) return
    setRestoring((cur) => new Set(cur).add(list.id))
    try {
      await restore.mutateAsync(list.id)
      toast({ title: `“${list.title}” restored` })
    } catch (err) {
      toast({
        title: 'Could not restore the list',
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setRestoring((cur) => {
        const next = new Set(cur)
        next.delete(list.id)
        return next
      })
    }
  }

  const header = <MPageBar title="Trash" onBack={() => goBack(TRASH_PARENT)} />
  const lists = trash.data
  const retry = () => void trash.refetch()

  let body: ReactNode
  if (!lists) {
    // Nothing read yet: a failure (or no network) says so — never an empty
    // Trash it can't vouch for.
    body = trash.isError ? (
      <CenterNote
        title={TRASH_COPY.loadFailed}
        body={trash.error.message}
        action={<PillButton onClick={retry}>Try again</PillButton>}
      />
    ) : trash.fetchStatus === 'paused' ? (
      <CenterNote
        title={TRASH_COPY.loadFailed}
        body={TRASH_COPY.offline}
        action={<PillButton onClick={retry}>Try again</PillButton>}
      />
    ) : (
      <TrashSkeleton />
    )
  } else {
    body = (
      <>
        {/* A refresh that failed under rows that still show. */}
        {trash.isError && <InlineError className="mt-3" message={TRASH_COPY.refreshFailed} onRetry={retry} />}
        {lists.length === 0 ? (
          <CenterNote title={TRASH_COPY.emptyTitle} body={TRASH_COPY.emptyBody} />
        ) : (
          <ul className="flex flex-col pt-1" aria-label="Deleted lists">
            {lists.map((list) => (
              <TrashRow
                key={list.id}
                list={list}
                busy={restoring.has(list.id)}
                onRestore={() => void onRestore(list)}
              />
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <MobileScreen header={header} className="leading-[normal] tabular-nums">
      <div className="px-4 pb-8" data-trash>
        {body}
      </div>
    </MobileScreen>
  )
}

function TrashRow({ list, busy, onRestore }: { list: List; busy: boolean; onRestore: () => void }) {
  return (
    <li className="flex items-center gap-3 border-b border-m-b2 py-3 last:border-b-0" data-trash-row={list.id}>
      <span
        aria-hidden
        className="relative flex size-10 flex-none items-center justify-center overflow-hidden rounded-[12px] bg-m-b2 text-m-t1"
        data-trash-cover
      >
        {list.thumbnail_url ? <CoverImage src={list.thumbnail_url} /> : <MIcon name="lists" size={18} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold text-m-t1">{list.title}</span>
        <span className="truncate text-[12px] font-medium text-m-t3">{trashRowSub(list)}</span>
      </span>
      <button
        type="button"
        onClick={onRestore}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={`${busy ? 'Restoring' : 'Restore'} “${list.title}”`}
        className="flex h-8 flex-none items-center whitespace-nowrap rounded-pill bg-m-b2 px-3.5 text-[13px] font-semibold text-m-t1 active:bg-m-b2h disabled:opacity-50"
        data-trash-restore
      >
        {/* One label, so the pill keeps its width (and the title its room)
            while it goes; it dims, and its spoken name says Restoring. */}
        Restore
      </button>
    </li>
  )
}

/** Loading rows in the list's own rhythm (b1 blocks). */
function TrashSkeleton() {
  return (
    <div className="flex flex-col pt-1" aria-busy="true" aria-label="Loading your trash" data-trash-loading>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 border-b border-m-b2 py-3 last:border-b-0">
          <span className="size-10 flex-none animate-pulse rounded-[12px] bg-m-b1" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-[15px] w-3/5 animate-pulse rounded-md bg-m-b1" />
            <span className="h-3 w-2/5 animate-pulse rounded-md bg-m-b1" />
          </span>
          <span className="h-8 w-[78px] flex-none animate-pulse rounded-pill bg-m-b1" />
        </div>
      ))}
    </div>
  )
}
