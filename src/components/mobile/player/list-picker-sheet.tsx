'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import type { PlayerListContext } from '@/components/players/player-detail-actions'
import { listsKeys, useLists, useRemovePlayer } from '@/hooks/use-lists'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * The profile's "+ List" (m-pprofile §2.1 row 1 — the prototype only toasts
 * "Choose a list for …"; the app has a real picker, `AddToListPopover`). The
 * same requests as that popover — the lists route's bulk add, and create a
 * list then add — laid out as the mobile bottom sheet: one row per list,
 * then "Create new list". Opened from a list the viewer owns, the sheet also
 * offers "Remove from <list>" (D494), the desktop view's Remove.
 */
export function ListPickerSheet({
  open,
  onOpenChange,
  playerId,
  playerName,
  listContext,
  onRemoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  playerId: string
  playerName: string
  listContext: PlayerListContext | null
  onRemoved: () => void
}) {
  const router = useRouter()
  const qc = useQueryClient()
  const { data, isPending, isError } = useLists(1, 50)
  const [working, setWorking] = useState(false)
  const lists = data?.lists ?? []

  const addTo = async (listId: string, title: string) => {
    if (working) return
    setWorking(true)
    try {
      const res = await fetch(`/api/lists/${listId}/players/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player_ids: [playerId] }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; inserted?: number }
      if (!res.ok) throw new Error(body.error ?? `Add failed (${res.status})`)
      toast({ title: (body.inserted ?? 0) === 0 ? 'Already on that list' : `Added to ${title}` })
      void qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      void qc.invalidateQueries({ queryKey: listsKeys.all })
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Could not add', description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
    } finally {
      setWorking(false)
    }
  }

  const createAndAdd = async () => {
    if (working) return
    setWorking(true)
    try {
      const createRes = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'New List' }),
      })
      const list = (await createRes.json().catch(() => ({}))) as { id?: string; title?: string; error?: string }
      if (!createRes.ok || !list.id) throw new Error(list.error ?? 'Create failed')
      const addRes = await fetch(`/api/lists/${list.id}/players/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player_ids: [playerId] }),
      })
      const addBody = (await addRes.json().catch(() => ({}))) as { error?: string }
      if (!addRes.ok) throw new Error(addBody.error ?? 'Add failed')
      toast({ title: 'New list created', description: `${playerName} added to ${list.title ?? 'New List'}` })
      void qc.invalidateQueries({ queryKey: listsKeys.all })
      onOpenChange(false)
      router.push(`/app/lists/${list.id}`)
    } catch (err) {
      toast({ title: 'Could not create list', description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
    } finally {
      setWorking(false)
    }
  }

  const removal = useListRemoval(listContext, playerId, playerName, () => {
    onOpenChange(false)
    onRemoved()
  })

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Add to list" subtitle={playerName}>
      <div className="flex flex-col px-3 pb-1.5" data-list-picker>
        {listContext && (
          <button
            type="button"
            onClick={removal.remove}
            disabled={removal.pending}
            className="flex min-h-[52px] items-center gap-3 rounded-[14px] px-2 text-left text-m-red active:bg-m-b2 disabled:opacity-40"
          >
            <span className="flex size-8 flex-none items-center justify-center rounded-[9px] bg-m-gr">
              <MIcon name="drop" size={14} stroke={2.2} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
              {removal.pending ? 'Removing…' : `Remove from ${listContext.listTitle}`}
            </span>
          </button>
        )}
        {isPending ? (
          <div className="flex flex-col gap-1.5 px-2 py-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-[14px] bg-m-b1" />
            ))}
          </div>
        ) : isError ? (
          <p className="px-2 py-4 text-center text-[13px] font-medium text-m-t3">Couldn’t load your lists.</p>
        ) : lists.length === 0 ? (
          <p className="px-2 py-4 text-center text-[13px] font-medium text-m-t3">No lists yet.</p>
        ) : (
          lists.map((l) => (
            <button
              key={l.id}
              type="button"
              disabled={working}
              onClick={() => void addTo(l.id, l.title)}
              className="flex min-h-[52px] items-center gap-3 rounded-[14px] px-2 text-left active:bg-m-b2 disabled:opacity-40"
            >
              <span className="flex size-8 flex-none items-center justify-center rounded-[9px] bg-m-b1 text-m-t2">
                <MIcon name="lists" size={15} stroke={1.8} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-m-t1">{l.title}</span>
              <span className="flex-none text-[12px] font-medium tabular-nums text-m-t3">{l.player_count}</span>
            </button>
          ))
        )}
        <button
          type="button"
          disabled={working}
          onClick={() => void createAndAdd()}
          className={cn('flex min-h-[52px] items-center gap-3 rounded-[14px] px-2 text-left text-accent active:bg-m-b2 disabled:opacity-40')}
        >
          <span className="flex size-8 flex-none items-center justify-center rounded-[9px] bg-m-gb">
            <MIcon name="add" size={14} stroke={2.4} />
          </span>
          <span className="text-[15px] font-semibold">Create new list</span>
        </button>
      </div>
    </MobileSheet>
  )
}

/** How the profile's "Remove from list" acts: not offered (no list), on the
 *  list editor's draft (saved by Update, undone by Back), or at once. */
export function removeMode(listContext: PlayerListContext | null | undefined): 'none' | 'draft' | 'now' {
  if (!listContext) return 'none'
  return listContext.removeFromDraft ? 'draft' : 'now'
}

/**
 * "Remove from list" for the phone profile — the header's Remove pill and
 * this sheet's row. From the list editor it acts on the editor's draft (gone
 * from the list now, saved by Update, undone by Back); from a list the viewer
 * owns it removes at once.
 */
export function useListRemoval(
  listContext: PlayerListContext | null | undefined,
  playerId: string,
  playerName: string,
  onDone: () => void,
) {
  const remove = useRemovePlayer(listContext?.listId ?? '')
  const mode = removeMode(listContext)
  return {
    mode,
    pending: remove.isPending,
    remove: () => {
      if (!listContext || mode === 'none') return
      if (mode === 'draft') {
        listContext.removeFromDraft!(playerId)
        toast({ title: 'Removed from list', description: 'Tap Update to save' })
        onDone()
        return
      }
      remove.mutate(playerId, {
        onSuccess: () => {
          toast({ title: 'Removed from list', description: `${playerName} · ${listContext.listTitle}` })
          onDone()
        },
        onError: (err) => toast({ title: 'Could not remove', description: err.message, variant: 'destructive' }),
      })
    },
  }
}
