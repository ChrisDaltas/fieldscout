'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Check, Layers, MoreHorizontal, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useLists, useList } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'

import type { List } from '@/types/database'

const STORAGE_KEY = 'fieldscout.sidebyside.columns'
const MAX_COLUMNS = 5

export function SideBySideTab() {
  const { data, isLoading } = useLists(1, 100)
  const lists = useMemo(() => data?.lists ?? [], [data])

  const [columnIds, setColumnIds] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [hasAutoPrompted, setHasAutoPrompted] = useState(false)

  // Hydrate from localStorage so the user's previous selection sticks across
  // sessions. We deliberately do NOT auto-fill with all lists when the
  // selection is empty — the empty state prompts the user to pick instead.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
          setColumnIds(parsed.slice(0, MAX_COLUMNS))
        }
      }
    } catch {
      // ignore
    }
    setHydrated(true)
  }, [])

  // Drop deleted lists from the stored selection.
  useEffect(() => {
    if (!hydrated) return
    const valid = new Set(lists.map((l) => l.id))
    const cleaned = columnIds.filter((id) => valid.has(id))
    if (cleaned.length !== columnIds.length) setColumnIds(cleaned)
  }, [hydrated, lists, columnIds])

  // Persist column selection.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(columnIds))
    } catch {
      // ignore quota errors
    }
  }, [columnIds, hydrated])

  // First entry to Side by Side with no saved selection: pop the picker.
  useEffect(() => {
    if (!hydrated || hasAutoPrompted) return
    if (columnIds.length === 0 && lists.length > 0) {
      setPickerOpen(true)
    }
    setHasAutoPrompted(true)
  }, [hydrated, hasAutoPrompted, columnIds.length, lists.length])

  const orderedColumns = useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l]))
    return columnIds
      .map((id) => byId.get(id))
      .filter((l): l is (typeof lists)[number] => Boolean(l))
  }, [columnIds, lists])

  const removeFromView = (id: string) =>
    setColumnIds((cur) => cur.filter((x) => x !== id))

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-96 w-[220px] shrink-0 rounded-lg" />
        ))}
      </div>
    )
  }

  if (lists.length === 0) {
    return (
      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <p className="text-sm text-text-secondary">
            You haven&apos;t created any lists yet.
          </p>
          <Button asChild className="font-semibold">
            <Link href="/app/lists/new">Create your first list</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="default"
          size="sm"
          className="border-bg-elevated-3 text-text-secondary hover:text-foreground"
          onClick={() => setPickerOpen(true)}
        >
          <Layers className="mr-1.5 h-4 w-4" />
          {orderedColumns.length === 0
            ? 'Choose lists'
            : `Change lists (${orderedColumns.length}/${MAX_COLUMNS})`}
        </Button>
      </div>

      {orderedColumns.length === 0 ? (
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-elevated-2 text-text-tertiary">
              <Layers className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Pick up to {MAX_COLUMNS} lists</p>
              <p className="mt-1 text-xs text-text-secondary">
                Side by Side renders each as a vertical column you can scroll
                independently.
              </p>
            </div>
            <Button
              onClick={() => setPickerOpen(true)}
              className="rounded-full font-semibold"
            >
              Choose lists
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
          <div className="flex gap-3">
            {orderedColumns.map((list) => (
              <ColumnView
                key={list.id}
                list={list}
                onRemove={() => removeFromView(list.id)}
                onChange={() => setPickerOpen(true)}
              />
            ))}
            {orderedColumns.length < MAX_COLUMNS && (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="flex h-[calc(100vh-260px)] min-h-[400px] w-[220px] shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-bg-elevated-2 text-text-secondary transition-colors hover:border-bg-elevated-3 hover:bg-bg-elevated hover:text-foreground"
              >
                <Plus className="h-5 w-5" />
                <span className="text-xs font-medium">Add a list</span>
              </button>
            )}
          </div>
        </div>
      )}

      <ListPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        lists={lists}
        selected={columnIds}
        max={MAX_COLUMNS}
        onSave={(next) => {
          setColumnIds(next)
          setPickerOpen(false)
        }}
      />
    </div>
  )
}

function ColumnView({
  list,
  onRemove,
  onChange,
}: {
  list: List
  onRemove: () => void
  onChange: () => void
}) {
  const detail = useList(list.id)
  const players = detail.data?.players ?? []

  return (
    <div className="flex h-[calc(100vh-260px)] min-h-[400px] w-[220px] shrink-0 flex-col rounded-lg border border-bg-elevated-2 bg-bg-elevated">
      <div className="flex items-start justify-between gap-2 border-b border-bg-elevated-2 px-3 py-3">
        <Link href={`/app/lists/${list.id}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{list.title}</p>
          <p className="text-[10px] uppercase tracking-wider text-text-tertiary">
            {list.player_count} player{list.player_count === 1 ? '' : 's'}
          </p>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Column options"
              className="rounded-full p-1 text-text-tertiary transition-colors hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="border-bg-elevated-2 bg-bg-elevated"
          >
            <DropdownMenuItem asChild>
              <Link href={`/app/lists/${list.id}`}>Open list</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onChange}>
              Swap for another list
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onRemove}
              className="text-destructive focus:text-destructive"
            >
              Remove from view
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {detail.isLoading ? (
          <div className="space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full rounded" />
            ))}
          </div>
        ) : players.length === 0 ? (
          <p className="px-2 py-3 text-xs text-text-tertiary">No players yet.</p>
        ) : (
          <ol className="space-y-0.5">
            {players.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-bg-elevated-2"
              >
                <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-text-tertiary">
                  {p.position}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {p.player.full_name}
                </span>
                <span className="text-[10px] text-text-tertiary">
                  {p.player.team ?? '—'} · {p.player.position}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

function ListPicker({
  open,
  onOpenChange,
  lists,
  selected,
  max,
  onSave,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  lists: List[]
  selected: string[]
  max: number
  onSave: (next: string[]) => void
}) {
  const [draft, setDraft] = useState<string[]>(selected)

  useEffect(() => {
    if (open) setDraft(selected)
  }, [open, selected])

  const toggle = (id: string) => {
    setDraft((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= max) return cur
      return [...cur, id]
    })
  }

  const atCap = draft.length >= max

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-bg-elevated-2 bg-bg-elevated sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Side by Side</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-text-secondary">
          Pick up to {max} lists. They&apos;ll render as columns left to right
          in the order you picked them.
        </p>
        <div className="max-h-80 overflow-y-auto">
          <ul className="space-y-1">
            {lists.map((list) => {
              const active = draft.includes(list.id)
              const disabled = !active && atCap
              const order = active ? draft.indexOf(list.id) + 1 : null
              return (
                <li key={list.id}>
                  <button
                    type="button"
                    onClick={() => toggle(list.id)}
                    disabled={disabled}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-bg-elevated-2'
                        : 'hover:bg-bg-elevated-2 disabled:opacity-40 disabled:hover:bg-transparent',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                        active
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-bg-elevated-3 text-transparent',
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="flex-1 truncate font-medium">
                      {list.title}
                    </span>
                    {order != null && (
                      <span className="rounded-full bg-bg-elevated-2 px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
                        #{order}
                      </span>
                    )}
                    <span className="text-xs text-text-tertiary tabular-nums">
                      {list.player_count}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <p className="text-[10px] text-text-tertiary">
          {draft.length} / {max} selected
          {atCap && ' · max reached'}
        </p>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button
            variant="invisible"
            onClick={() => onOpenChange(false)}
            className="text-text-secondary"
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            onClick={() => onSave(draft)}
            disabled={draft.length === 0}
            className="rounded-full font-semibold disabled:opacity-60"
          >
            Show side by side
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
