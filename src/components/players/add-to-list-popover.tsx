'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { listsKeys, useLists } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'

interface AddToListPopoverProps {
  /** One or many player IDs to add. */
  playerIds: string[]
  /** Display name used in toasts and the popover header. */
  playerName: string
  /**
   * `default` — small icon-only chip that only shows on row hover. Tooltip
   *             reveals the label.
   * `primary` — full pill button with icon + "Add to list" text. Used in
   *             the multi-select action bar.
   */
  triggerVariant?: 'default' | 'primary'
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
    triggerVariant === 'primary' ? (
      <Button variant="brand" className="font-semibold">
        <Plus className="h-4 w-4" />
        Add to list
      </Button>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="primary"
            size="icon"
            className="h-7 w-7"
            aria-label={`Add ${playerName} to a list`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">Add to list</TooltipContent>
      </Tooltip>
    )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-72 border-bg-elevated-2 bg-bg-elevated p-0"
      >
        <div className="border-b border-bg-elevated-2 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            {isMulti
              ? `Add ${playerIds.length} players to list`
              : 'Add to list'}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-secondary">
            {playerName}
          </p>
        </div>

        <div className="border-b border-bg-elevated-2 px-2 py-1.5">
          <div className="flex h-7 items-center gap-2 rounded-full bg-bg-elevated-3 px-3">
            <Search className="h-3.5 w-3.5 text-text-tertiary" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a list…"
              className="h-full flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-text-tertiary"
            />
          </div>
        </div>

        <ul className="max-h-60 overflow-y-auto p-1">
          {lists.length === 0 && (
            <li className="px-3 py-3 text-center text-[11px] text-text-tertiary">
              {query ? 'No matching lists.' : 'No lists yet.'}
            </li>
          )}
          {lists.map((list) => (
            <li key={list.id}>
              <button
                type="button"
                disabled={working}
                onClick={() => addToExisting(list.id, list.title)}
                className="flex w-full items-center justify-between gap-2 rounded-full px-2 py-1.5 text-left text-xs transition-colors hover:bg-bg-elevated-2 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {list.title}
                </span>
                <span className="shrink-0 text-[10px] text-text-tertiary tabular-nums">
                  {list.player_count}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="border-t border-bg-elevated-2 p-1">
          <button
            type="button"
            disabled={working}
            onClick={createAndAdd}
            className="flex w-full items-center gap-2 rounded-full px-2 py-2 text-xs font-medium text-foreground transition-colors hover:bg-bg-elevated-2 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Create new list
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
