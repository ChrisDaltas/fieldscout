'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { AddToListPopover } from '@/components/players/add-to-list-popover'
import { playerPageHref } from '@/components/players/player-page-ops'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { useRemovePlayer } from '@/hooks/use-lists'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import { useToast } from '@/hooks/use-toast'
import { getNflTeam } from '@/lib/nfl-teams'
import { usePlayerModalStore } from '@/stores/player-modal-store'

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
  /** Hide "Open player view" when we're already in it (modal or deep link). */
  onFullPage?: boolean
  /** Called after a successful remove (e.g. to close the modal). */
  onRemoved?: () => void
  /**
   * Overrides More → "Open player view". The mini card passes its own expand
   * handler so this item closes the card first and keeps its league context,
   * exactly like the expand icon (R1507/R1508).
   */
  onOpenPlayerView?: () => void
}

/**
 * Key actions row for player detail views. Main actions stay visible —
 * add to list, and remove when opened from a list — everything else lives
 * in the "More" overflow menu. Stroke buttons on the ink border, kit-style.
 */
export function PlayerDetailActions({
  player,
  listContext = null,
  readOnly = false,
  onFullPage = false,
  onRemoved,
  onOpenPlayerView,
}: PlayerDetailActionsProps) {
  const router = useRouter()
  const openPlayerView = usePlayerModalStore((s) => s.openPlayerView)
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
    const url = `${window.location.origin}${playerPageHref(player.id)}`
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
      <Button variant="blue" size="sm" asChild>
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
          <Button variant="stroke" size="sm" aria-label="More actions">
            <Icon name="dots" size={13} />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!onFullPage && (
            <DropdownMenuItem
              onSelect={() => (onOpenPlayerView ? onOpenPlayerView() : openPlayerView(player.id))}
            >
              <Icon name="external-link" size={14} />
              Open player view
            </DropdownMenuItem>
          )}
          {player.team && (
            <DropdownMenuItem onSelect={() => router.push(`/app/nfl/${player.team}`)}>
              <Icon name="team" size={14} />
              View {teamInfo ? `${teamInfo.city} ${teamInfo.name}` : player.team}
            </DropdownMenuItem>
          )}
          {(!onFullPage || player.team) && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={handleCopyLink}>
            <Icon name="document" size={14} />
            Copy link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {listContext && (
        <Button
          variant="stroke"
          size="sm"
          onClick={handleRemove}
          disabled={removePlayer.isPending}
          className="text-negative-strong hover:border-negative-strong hover:bg-negative-soft hover:text-negative-strong"
        >
          <Icon name="minus-circle" size={13} />
          {removePlayer.isPending ? 'Removing…' : 'Remove'}
        </Button>
      )}
    </>
  )
}
