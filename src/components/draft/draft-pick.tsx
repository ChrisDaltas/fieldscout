import type { PlayerCardContext } from '@/components/players/player-card-context'
import { PlayerLink } from '@/components/players/player-link'
import { cn } from '@/lib/utils'

interface DraftPickProps {
  pick: number
  /** Abbreviated at the call site (board cells are narrow): "C. McCaffrey". */
  playerName?: string
  /** With an id, the name opens the player's card (League UX batch 2). */
  playerId?: string | null
  /** The card's context; omitted in the room (its ambient context applies). */
  cardContext?: PlayerCardContext
  position?: string
  team?: string | null
  byManager?: string | null
  /** The active pick — accent-soft fill + accent text (never a shadow). */
  onClock?: boolean
  /** Upcoming slot — grey well, no player. */
  empty?: boolean
  /** Optional display label overriding the raw overall number (the board
   *  grid passes round.slot — "3.04"). */
  label?: string
  className?: string
}

/**
 * DraftPick — a single cell on the draft board grid: player name, pick
 * label, position · team · manager. v7 (FieldScout Draft Room): a made cell
 * is FILLED with its position colour (`pos-*`; K and DEF are light fills and
 * take ink text), an open slot is a grey well, and the pick on the clock is
 * an accent-soft fill with accent text — fill and type, never a shadow.
 *
 * Draft-only primitive (lives here, not in components/ui/ — no other surface
 * renders a draft board).
 */
export function DraftPick({
  pick,
  playerName,
  playerId,
  cardContext,
  position,
  team,
  byManager,
  onClock = false,
  empty = false,
  label,
  className,
}: DraftPickProps) {
  if (empty || !playerName) {
    return (
      <div
        className={cn(
          'flex min-h-[42px] items-center justify-center rounded-md px-1.5',
          // On-the-clock is a status, not a hover state — the fill says it.
          onClock ? 'bg-accent-soft' : 'bg-surface-control',
          className,
        )}
      >
        <span
          className={cn(
            'fs-num truncate text-[10px]',
            onClock ? 'font-bold text-accent-deep' : 'font-medium text-n-8',
          )}
        >
          {onClock ? 'On the clock' : (label ?? `Pick ${pick}`)}
        </span>
      </div>
    )
  }

  const fill = position ? (CELL_FILL[position] ?? CELL_FILL.IDP) : 'bg-surface-sunken text-ink'
  const darkText = !position || DARK_TEXT.has(position)

  return (
    <div
      className={cn(
        'flex min-h-[42px] min-w-0 flex-col justify-center gap-0.5 rounded-md px-[7px] py-[5px]',
        fill,
        // On-the-clock is a resting status — an inset accent ring, never a shadow.
        onClock && 'ring-2 ring-inset ring-accent',
        className,
      )}
    >
      <div className="flex items-baseline gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight">
          {playerId ? <PlayerLink playerId={playerId} name={playerName} context={cardContext} className="max-w-full" /> : playerName}
        </span>
        <span
          className={cn(
            'fs-num shrink-0 text-[10px] font-medium',
            darkText ? 'text-n-3' : 'text-white/75',
          )}
        >
          {label ?? `#${pick}`}
        </span>
      </div>
      <div
        className={cn(
          'truncate text-[10px] font-medium leading-tight',
          darkText ? 'text-n-3' : 'text-white/75',
        )}
      >
        {position ? `${position} · ` : ''}
        {team}
        {byManager ? ` · ${byManager}` : ''}
      </div>
    </div>
  )
}

/** Board-cell fills by position — v7 Draft Room: a pale tint of each
 *  position colour with ink text (`pos-*-tint`). Full literal strings so
 *  Tailwind's scanner emits them. */
const CELL_FILL: Record<string, string> = {
  QB: 'bg-pos-qb-tint text-ink',
  RB: 'bg-pos-rb-tint text-ink',
  WR: 'bg-pos-wr-tint text-ink',
  TE: 'bg-pos-te-tint text-ink',
  K: 'bg-pos-k-tint text-ink',
  DEF: 'bg-pos-def-tint text-ink',
  DST: 'bg-pos-def-tint text-ink',
  FLEX: 'bg-pos-flex-tint text-ink',
  IDP: 'bg-surface-control text-ink',
}
/** Every v7 tint is light, so every cell's meta text is grey. */
const DARK_TEXT = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DST', 'FLEX', 'IDP'])
