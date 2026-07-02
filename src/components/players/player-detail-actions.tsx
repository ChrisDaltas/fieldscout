'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExternalLink, LinkIcon, MinusCircle, MoreHorizontal, Shield } from 'lucide-react'

import { AddToListPopover } from '@/components/players/add-to-list-popover'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useRemovePlayer } from '@/hooks/use-lists'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import { useToast } from '@/hooks/use-toast'
import { getNflTeam } from '@/lib/nfl-teams'

export interface PlayerListContext {
  listId: string
  listTitle: string
}

interface PlayerDetailActionsProps {
  player: PlayerStatsPlayer
  /** When set, the player was opened from this list and can be removed from it. */
  listContext?: PlayerListContext | null
  /** Signed-out contexts (guest big board): swap list actions for a signup CTA. */
  readOnly?: boolean
  /** Hide "Open full page" when we're already on the full page. */
  onFullPage?: boolean
  /** Called after a successful remove (e.g. to close the modal). */
  onRemoved?: () => void
}

/**
 * Key actions row for player detail views. Main actions stay visible —
 * add to list, and remove when opened from a list — everything else lives
 * in the "More…" overflow menu.
 */
export function PlayerDetailActions({
  player,
  listContext = null,
  readOnly = false,
  onFullPage = false,
  onRemoved,
}: PlayerDetailActionsProps) {
  const router = useRouter()
  const { toast } = useToast()
  const removePlayer = useRemovePlayer(listContext?.listId ?? '')

  const teamInfo = getNflTeam(player.team)

  const handleRemove = () => {
    if (!listContext) return
    removePlayer.mutate(player.id, {
      onSuccess: () => {
        toast({
          title: 'Removed from list',
          description: `${player.full_name} · ${listContext.listTitle}`,
        })
        onRemoved?.()
      },
      onError: (err) =>
        toast({
          title: 'Could not remove',
          description: err.message,
          variant: 'destructive',
        }),
    })
  }

  const handleCopyLink = async () => {
    const url = `${window.location.origin}/app/players/${player.id}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'Link copied', description: url })
    } catch {
      toast({
        title: 'Could not copy link',
        description: url,
        variant: 'destructive',
      })
    }
  }

  if (readOnly) {
    return (
      <Button variant="brand" size="sm" asChild className="font-semibold">
        <Link href="/signup">Sign up to add to lists</Link>
      </Button>
    )
  }

  return (
    <>
      <AddToListPopover
        playerIds={[player.id]}
        playerName={player.full_name}
        triggerVariant="primary"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="default"
            size="sm"
            aria-label="More actions"
            className="border border-bg-elevated-3 bg-bg-elevated-2 font-semibold text-text-secondary hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-bg-elevated-2 bg-bg-elevated">
          {!onFullPage && (
            <DropdownMenuItem onSelect={() => router.push(`/app/players/${player.id}`)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open full page
            </DropdownMenuItem>
          )}
          {player.team && (
            <DropdownMenuItem onSelect={() => router.push(`/app/nfl/${player.team}`)}>
              <Shield className="mr-2 h-4 w-4" />
              View {teamInfo ? `${teamInfo.city} ${teamInfo.name}` : player.team}
            </DropdownMenuItem>
          )}
          {(!onFullPage || player.team) && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={handleCopyLink}>
            <LinkIcon className="mr-2 h-4 w-4" />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {listContext && (
        <Button
          variant="default"
          size="sm"
          onClick={handleRemove}
          disabled={removePlayer.isPending}
          className="border border-bg-elevated-3 bg-bg-elevated-2 font-semibold text-destructive hover:bg-destructive/20"
        >
          <MinusCircle className="h-4 w-4" />
          {removePlayer.isPending ? 'Removing…' : 'Remove'}
        </Button>
      )}
    </>
  )
}
