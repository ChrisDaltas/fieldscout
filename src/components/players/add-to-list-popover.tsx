'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { listsKeys, useLists } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'

interface AddToListPopoverProps {
  /** One or many player IDs to add. */
  playerIds: string[]
  /** Display name used in toasts and the popover header. */
  playerName: string
  /**
   * `default` — compact labeled stroke button ("+ List") for standalone
   *             placements (rail cards).
   * `primary` — full "Add to list" stroke button. Used in detail views and
   *             the multi-select action bar.
   * `icon`    — icon-only "+" square button (players table rows).
   */
  triggerVariant?: 'default' | 'primary' | 'icon'
  /** Popover alignment relative to the trigger. */
  align?: 'start' | 'end'
}

export function AddToListPopover({
  playerIds,
  playerName,
  triggerVariant = 'default',
  align = 'end',
}: AddToListPopoverProps) {
  const router = useRouter()
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data } = useLists(1, 50)
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [query, setQuery] = useState('')

  const lists = (data?.lists ?? []).filter((l) =>
    query.trim()
      ? l.title.toLowerCase().includes(query.trim().toLowerCase())
      : true,
  )

  const isMulti = playerIds.length > 1

  const addToExisting = async (listId: string, listTitle: string) => {
    if (working) return
    setWorking(true)
    try {
      const res = await fetch(`/api/lists/${listId}/players/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player_ids: playerIds }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error ?? `Add failed (${res.status})`)
      }
      const inserted = (body as { inserted?: number }).inserted ?? 0
      const skipped = (body as { skipped?: number }).skipped ?? 0
      toast({
        title:
          inserted === 0
            ? 'Already on that list'
            : `Added ${inserted} to ${listTitle}`,
        description:
          skipped > 0
            ? `${skipped} already on the list`
            : isMulti
              ? undefined
              : playerName,
      })
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      qc.invalidateQueries({ queryKey: listsKeys.all })
      setOpen(false)
    } catch (err) {
      toast({
        title: 'Could not add',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
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
      const list = (await createRes.json()) as { id: string; title: string }
      if (!createRes.ok) {
        throw new Error(
          (list as unknown as { error?: string }).error ?? 'Create failed',
        )
      }

      const addRes = await fetch(`/api/lists/${list.id}/players/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player_ids: playerIds }),
      })
      const addBody = await addRes.json().catch(() => ({}))
      if (!addRes.ok) {
        throw new Error(addBody.error ?? 'Add failed')
      }

      toast({
        title: 'New list created',
        description: isMulti
          ? `${playerIds.length} players added to ${list.title}`
          : `${playerName} added to ${list.title}`,
      })
      qc.invalidateQueries({ queryKey: listsKeys.all })
      setOpen(false)
      router.push(`/app/lists/${list.id}`)
    } catch (err) {
      toast({
        title: 'Could not create list',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setWorking(false)
    }
  }

  const trigger =
    triggerVariant === 'icon' ? (
      <Button
        variant="stroke"
        size="icon-sm"
        aria-label={`Add ${playerName} to a list`}
        title="Add to a list"
      >
        <Icon name="plus" size={13} />
      </Button>
    ) : triggerVariant === 'primary' ? (
      <Button variant="stroke" size="sm">
        <Icon name="plus" size={13} />
        Add to list
      </Button>
    ) : (
      <Button
        variant="stroke"
        size="sm"
        aria-label={`Add ${playerName} to a list`}
      >
        <Icon name="plus" size={13} />
        List
      </Button>
    )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <div className="border-b border-n-4 px-3 py-2">
          <p className="fs-overline text-n-3">
            {isMulti
              ? `Add ${playerIds.length} players to list`
              : 'Add to list'}
          </p>
          <p className="mt-0.5 truncate text-[12px] font-bold">{playerName}</p>
        </div>

        <div className="border-b border-n-4 px-2 py-1.5">
          <div className="flex h-7 items-center gap-2 rounded-sm border border-n-4 bg-white px-2 transition-colors focus-within:border-accent">
            <Icon name="search" size={13} className="text-n-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a list…"
              className="h-full min-w-0 flex-1 bg-transparent text-[12px] font-medium text-ink outline-none placeholder:text-n-3"
            />
          </div>
        </div>

        <ul className="max-h-60 overflow-y-auto p-1">
          {lists.length === 0 && (
            <li className="px-3 py-3 text-center text-[11px] font-medium text-n-3">
              {query ? 'No matching lists.' : 'No lists yet.'}
            </li>
          )}
          {lists.map((list) => (
            <li key={list.id}>
              <button
                type="button"
                disabled={working}
                onClick={() => addToExisting(list.id, list.title)}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] font-medium text-ink transition-colors hover:bg-accent-soft disabled:opacity-40"
              >
                <span className="min-w-0 flex-1 truncate">{list.title}</span>
                <span className="fs-num shrink-0 text-[11px] text-n-3">
                  {list.player_count}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="border-t border-n-4 p-1">
          <button
            type="button"
            disabled={working}
            onClick={createAndAdd}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-[12px] font-bold text-ink transition-colors hover:bg-accent-soft disabled:opacity-40"
          >
            <Icon name="plus" size={13} />
            Create new list
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
