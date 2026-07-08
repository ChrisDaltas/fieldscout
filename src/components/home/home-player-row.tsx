'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PositionBadge } from '@/components/players/position-badge'

/**
 * Compact card-flush player row shared by the home hub's right-column cards
 * (trending / waivers / injuries): square headshot tile, name (optionally a
 * link into the player window), position badge + meta line, right-aligned
 * stat block. Home-local on purpose — once batch B reskins
 * `players/player-row.tsx`, this should fold into it as a compact variant
 * (reported, not created as a shared primitive here).
 */

interface HomePlayerRowProps {
  name: string
  position: string
  headshotUrl?: string | null
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
  meta,
  nameBadge,
  note,
  right,
  onOpen,
}: HomePlayerRowProps) {
  return (
    <div className="flex items-start gap-2.5 px-[13px] py-2">
      <Avatar className="h-8 w-8">
        {headshotUrl && (
          <AvatarImage
            src={headshotUrl}
            alt={name}
            className="object-cover object-top"
          />
        )}
        <AvatarFallback>{initialsOf(name)}</AvatarFallback>
      </Avatar>

      <div className="mr-auto min-w-0">
        <div className="flex items-center gap-1.5 leading-tight">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="min-w-0 truncate text-left text-[11px] font-extrabold hover:underline hover:decoration-2 hover:underline-offset-2 focus-visible:underline focus:outline-none"
            >
              {name}
            </button>
          ) : (
            <span className="min-w-0 truncate text-[11px] font-extrabold">
              {name}
            </span>
          )}
          {nameBadge}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <PositionBadge position={position} size="sm" className="shrink-0" />
          {meta && (
            <span className="truncate text-[10px] font-semibold text-n-3">
              {meta}
            </span>
          )}
        </div>
        {note && (
          <div className="mt-1 text-[10px] font-medium leading-snug text-n-3">
            {note}
          </div>
        )}
      </div>

      {right && <div className="shrink-0 text-right">{right}</div>}
    </div>
  )
}
