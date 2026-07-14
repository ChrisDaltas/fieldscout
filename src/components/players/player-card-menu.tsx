'use client'

import { useQueryClient } from '@tanstack/react-query'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { listsKeys, useLists } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'

interface PlayerCardMenuProps {
  playerId: string
  playerName: string
  /** Extra classes for the trigger button (e.g. hover-reveal positioning). */
  className?: string
}

/**
 * The hover ⋯ menu on a player card: add the player to one of the user's
 * lists, or spin up a new list seeded with this player. Adding a player that's
 * already on the chosen list surfaces a clear toast instead of erroring.
 */
export function PlayerCardMenu({
  playerId,
  playerName,
  className,
}: PlayerCardMenuProps) {
  const { data } = useLists(1, 100)
  const lists = data?.lists ?? []
  const { toast } = useToast()
  const qc = useQueryClient()
  const setSeed = useUIStore((s) => s.setCreateListSeedPlayerId)
  const openCreate = useUIStore((s) => s.setCreateListOpen)

  const addToList = async (listId: string, listTitle: string) => {
    try {
      const res = await fetch(`/api/lists/${listId}/players`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      })
      if (res.status === 409) {
        toast({ title: 'This player is already on this list' })
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Failed (${res.status})`)
      }
      qc.invalidateQueries({ queryKey: listsKeys.detail(listId) })
      qc.invalidateQueries({ queryKey: listsKeys.all })
      toast({ title: `Added ${playerName} to ${listTitle}` })
    } catch (err) {
      toast({
        title: 'Could not add to list',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Options for ${playerName}`}
          // Keep the click off the card body (which opens the player modal).
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-sm border border-ink bg-white text-ink transition-colors hover:bg-n-4 hover:text-accent',
            className,
          )}
        >
          <Icon name="dots" size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Icon name="list" size={14} />
            Add to list
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {lists.length === 0 ? (
              <DropdownMenuItem disabled>No lists yet</DropdownMenuItem>
            ) : (
              lists.map((list) => (
                <DropdownMenuItem
                  key={list.id}
                  onSelect={() => addToList(list.id, list.title)}
                >
                  <span className="truncate">{list.title}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onSelect={() => {
            setSeed(playerId)
            openCreate(true)
          }}
        >
          <Icon name="plus" size={14} />
          Create new list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
