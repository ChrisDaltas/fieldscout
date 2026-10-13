'use client'

import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { PositionBadge } from '@/components/players/position-badge'

/**
 * Compact card-flush player row shared by the home hub's right-column cards
 * (trending / waivers / injuries): round 31px headshot, name (optionally a
 * link into the player window), position badge + grey meta line,
 * right-aligned stat block. v7 row: each row carries its own top hairline
 * (`border-t border-n-4`), so a list of them reads as v7's separated rows. Home-local on purpose — once batch B reskins
 * `players/player-row.tsx`, this should fold into it as a compact variant
 * (reported, not created as a shared primitive here).
 */

interface HomePlayerRowProps {
  name: string
  position: string
  headshotUrl?: string | null
  /**
   * The player's NFL team. Only read to pick the image: a `DEF` row's picture
   * is its team logo, not the headshot the sync stored (see
   * `src/lib/player-image.ts`). Callers that render the team in `meta` should
   * pass it here too rather than relying on the meta text.
   */
  team?: string | null
  /** Small text after the position badge (team, rostered %, …). */
  meta?: React.ReactNode
  /** Chip rendered inline after the name (e.g. "On your team"). */
  nameBadge?: React.ReactNode
  /** Extra full-width line under the meta row (e.g. injury note). */
  note?: React.ReactNode
  /** Right-aligned block (stat value + sub-label). */
  right?: React.ReactNode
  /** Name click — opens the player window when provided. */
  onOpen?: () => void
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function HomePlayerRow({
  name,
  position,
  headshotUrl,
  team,
  meta,
  nameBadge,
  note,
  right,
  onOpen,
}: HomePlayerRowProps) {
  return (
    <div className="flex items-start gap-[9px] border-t border-n-4 px-[15px] py-[9px]">
      <Avatar className="h-[31px] w-[31px] shrink-0">
        <PlayerAvatarImage
          player={{ position, team, headshot_url: headshotUrl }}
          alt={name}
        />
        <AvatarFallback>{initialsOf(name)}</AvatarFallback>
      </Avatar>

      <div className="mr-auto min-w-0">
        <div className="flex min-h-[16px] items-center gap-1.5 leading-tight">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="min-w-0 truncate text-left text-[12px] font-semibold tracking-[-0.01em] text-ink transition-colors hover:text-accent focus:outline-none focus-visible:underline focus-visible:underline-offset-2"
            >
              {name}
            </button>
          ) : (
            <span className="min-w-0 truncate text-[12px] font-semibold tracking-[-0.01em] text-ink">
              {name}
            </span>
          )}
          {nameBadge}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <PositionBadge position={position} size="sm" className="shrink-0" />
          {meta && (
            <span className="truncate text-[10px] font-medium text-n-6">
              {meta}
            </span>
          )}
        </div>
        {note && (
          <div className="mt-1 text-[11px] font-medium leading-[1.45] text-n-3">
            {note}
          </div>
        )}
      </div>

      {right && <div className="shrink-0 text-right">{right}</div>}
    </div>
  )
}
