'use client'

import { Fragment } from 'react'
import type * as React from 'react'

import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import type { PlayerCardContext } from './player-card-context'
import { playerParts, type NamedPlayer } from './player-link-ops'

/**
 * The player door (League UX batch 2 — Chris 2026-10-03: *"when I click on a
 * player who is on my roster, there is no option to drop them and the player
 * detail card is not opening up"*). Every player name and headshot in the
 * league and draft surfaces goes through `PlayerLink` / `PlayerFace`, so a
 * click anywhere opens the ONE floating card (`player-window.tsx`, mounted
 * once at the app root) with the context it was opened from.
 *
 * Treatment: the house inline-link convention (`TeamNameLink`,
 * `UsernameLink`) — the underline is reserved at rest and painted on hover,
 * a paint-only change that cannot reflow a narrow row; no colour or weight
 * of its own, so it drops into an existing name element. No shadow — text
 * in page flow never lifts (CLAUDE.md).
 *
 * The click stops there (`stopPropagation` + `preventDefault`): a name sits
 * inside rows that select, drag, or toggle a checkbox, and opening the card
 * must not also do the row's job.
 */

export const PLAYER_LINK_CLASS =
  'fs-entity-link cursor-pointer text-left underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent'

function useOpenCard(playerId: string, context: PlayerCardContext | undefined) {
  const open = usePlayerWindowsStore((s) => s.open)
  return (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    // No context = the surface's ambient one (the draft room's seat), else global.
    open(playerId, context ? { context } : undefined)
  }
}

interface PlayerLinkProps {
  playerId: string
  /** The visible text — usually the full name, or a board's abbreviation. */
  name: string
  /** Omitted inside the draft room: the room's ambient context applies. */
  context?: PlayerCardContext
  /** The call site's own typography only. */
  className?: string
  title?: string
}

export function PlayerLink({ playerId, name, context, className, title }: PlayerLinkProps) {
  const onClick = useOpenCard(playerId, context)
  return (
    <button
      type="button"
      onClick={onClick}
      // dnd-kit starts a drag on pointer-down; a press on the name is a click.
      onPointerDown={(e) => e.stopPropagation()}
      data-player-link={playerId}
      title={title}
      className={cn(PLAYER_LINK_CLASS, 'inline max-w-full truncate p-0 font-[inherit]', className)}
    >
      {name}
    </button>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface PlayerFaceProps {
  playerId: string
  name: string
  position?: string | null
  team?: string | null
  headshotUrl?: string | null
  context?: PlayerCardContext
  /** Pixel size of the square tile (the app's ×0.8 scale). */
  size?: number
  className?: string
}

/** The headshot as a door to the same card. */
export function PlayerFace({ playerId, name, position, team, headshotUrl, context, size = 24, className }: PlayerFaceProps) {
  const onClick = useOpenCard(playerId, context)
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={`Open ${name}`}
      data-player-face={playerId}
      className={cn('shrink-0 rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent', className)}
    >
      <Avatar className="shrink-0" style={{ width: size, height: size }}>
        <PlayerAvatarImage player={{ id: playerId, position, team, headshot_url: headshotUrl ?? null }} />
        <AvatarFallback className="fs-num font-bold" style={{ fontSize: Math.round(size * 0.36) }}>
          {initials(name)}
        </AvatarFallback>
      </Avatar>
    </button>
  )
}

/** A composed sentence whose named players (`playerParts`) are each a door
 *  to his card; the rest stays text. */
export function TextWithPlayers({ text, players, context }: { text: string; players: readonly NamedPlayer[]; context: PlayerCardContext }) {
  return (
    <>
      {playerParts(text, players).map((part, i) =>
        typeof part === 'string' ? <Fragment key={i}>{part}</Fragment> : <PlayerLink key={i} playerId={part.playerId} name={part.name} context={context} />,
      )}
    </>
  )
}
