'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Icon } from '@/components/ui/icon'
import { PositionBadge } from '@/components/players/position-badge'
import { cn } from '@/lib/utils'

export interface PlayerCardPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
}

interface PlayerCardProps {
  rank: number
  player: PlayerCardPlayer
  /**
   * Top-right number. Pass `null`/omit when no projection exists — we show
   * "—" rather than fabricating a zero. See aggregate-fantasy.ts for the
   * rule that makes the "no projection" path explicit.
   */
  projectedPts?: number | null
  /** Click handler for the avatar/name area (typically opens the stats modal). */
  onOpen?: () => void
  /** Drag attributes/listeners from useSortable, spread on the card surface. */
  dragHandleProps?: Record<string, unknown>
  draggable?: boolean
  isDragging?: boolean
  /** Highlighted "selected" state — the card the arrow keys will move. */
  selected?: boolean
  /** Click handler for the card body — toggles the selected state. */
  onSelect?: () => void
  /** Optional draft toggle — renders a button across the bottom of the card. */
  draftMode?: boolean
  drafted?: boolean
  onToggleDrafted?: () => void
  /**
   * Hide the top-left rank number. The home shelves render the same card but
   * aren't a ranked board, so they suppress the rank. The projected-points
   * number then moves to occupy the top-right alone.
   */
  showRank?: boolean
  /**
   * Optional element pinned to the top-right corner — e.g. the home shelf's
   * hover ⋯ PlayerCardMenu. Positioned absolutely so it floats over the card
   * without affecting the fixed layout.
   */
  menuSlot?: ReactNode
  /**
   * 'default' (160px tall, fills its column — Big Board / shelves) or 'compact'
   * (fixed 120×112 — the list detail cards view, which must not resize).
   */
  size?: 'default' | 'compact'
  /** Optional hover-revealed "remove from list" button (top-right). */
  onRemove?: () => void
  className?: string
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

let measureCanvas: HTMLCanvasElement | null = null

/** Width of `text` in `font` (a CSS font shorthand), measured off-DOM. */
function measureTextWidth(text: string, font: string): number {
  if (typeof document === 'undefined') return 0
  measureCanvas ??= document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

/**
 * The player name on a fixed-size card. Shows the full name when it fits on
 * one line; if it doesn't, falls back to "F. Last"; if that still doesn't fit
 * it's truncated with an ellipsis. The font size never changes, so a long
 * name can never grow the card. When `onOpen` is set the name is a button
 * that opens the player detail modal.
 */
function FittedName({
  first,
  last,
  fullName,
  drafted,
  onOpen,
  compact = false,
}: {
  first: string
  last: string
  fullName: string
  drafted: boolean
  onOpen?: () => void
  compact?: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [text, setText] = useState(fullName)
  const initialName = first ? `${first[0]}. ${last}` : last

  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const decide = () => {
      const avail = el.clientWidth
      if (!avail) return
      const cs = getComputedStyle(el)
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const fits = measureTextWidth(fullName, font) <= avail - 1
      setText(fits ? fullName : initialName)
    }
    decide()
    const ro = new ResizeObserver(decide)
    ro.observe(el)
    // Re-measure once web fonts settle so the first paint isn't off.
    document.fonts?.ready.then(decide).catch(() => {})
    return () => ro.disconnect()
  }, [fullName, initialName])

  const name = (
    <span
      ref={ref}
      title={fullName}
      className={cn(
        'block w-full truncate font-extrabold leading-tight',
        compact ? 'text-[12px]' : 'text-[13px]',
        drafted && 'line-through',
      )}
    >
      {text}
    </span>
  )

  if (!onOpen) {
    return <div className="w-full min-w-0 text-center">{name}</div>
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="block w-full min-w-0 cursor-pointer text-center hover:underline hover:decoration-2 hover:underline-offset-2 focus:outline-none focus-visible:underline"
    >
      {name}
    </button>
  )
}

function splitName(full: string): { first: string; last: string } {
  const trimmed = full.trim()
  const space = trimmed.indexOf(' ')
  if (space < 0) return { first: '', last: trimmed }
  return {
    first: trimmed.slice(0, space),
    last: trimmed.slice(space + 1),
  }
}

/**
 * The canonical player tile used on the Big Board, list cards view, the
 * public profile Big Board, the home page position shelves, and the guest
 * Big Board. Every place a player is shown as a fixed-size card renders this
 * component — add a prop here rather than forking a bespoke tile. Layout
 * reasoning:
 *   - Rank is large and lives top-left because it's the dominant
 *     information on a sorted board.
 *   - Projected points sit top-right opposite the rank — the two
 *     numbers users compare across cards.
 *   - Name splits onto two lines so long surnames don't truncate. First
 *     name is de-emphasized; last name is the bold identifier.
 *   - Position + team sit flush at the bottom (no padding under) so the
 *     visual weight is concentrated.
 *
 * This is the only place this design lives. If a card variant elsewhere
 * starts to drift, fold it back in here rather than forking.
 */
export function PlayerCard({
  rank,
  player,
  projectedPts,
  onOpen,
  dragHandleProps,
  draggable = false,
  isDragging = false,
  selected = false,
  onSelect,
  draftMode = false,
  drafted = false,
  onToggleDrafted,
  showRank = true,
  menuSlot,
  size = 'default',
  onRemove,
  className,
}: PlayerCardProps) {
  const { first, last } = splitName(player.full_name)
  const initials = (first[0] ?? '') + (last[0] ?? '')
  const compact = size === 'compact'

  const projectionLabel =
    typeof projectedPts === 'number' ? projectedPts.toFixed(1) : '—'

  // Hover lift stays shadow-only: dnd-kit drives `transform` inline, so a
  // translate hover would fight the drag transform.
  return (
    <div
      {...dragHandleProps}
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col items-stretch rounded-sm border border-ink bg-white transition-all hover:shadow-hard-4',
        // Compact is a fixed 120×112 tile (list detail cards view) that must
        // never resize; default fills its column and is 160px tall.
        compact ? 'h-[112px] w-[120px] px-2 pt-1.5 pb-1' : 'h-40 px-3 pt-2.5 pb-1.5',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'z-10 shadow-hard-6',
        selected && 'bg-accent-soft ring-2 ring-ink',
        drafted && 'opacity-50',
        className,
      )}
    >
      {menuSlot}

      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Remove from list"
          className={cn(
            'absolute right-1 top-1 z-10 flex items-center justify-center rounded-sm border border-ink bg-white text-ink opacity-0 transition-all hover:bg-negative hover:text-ink focus-visible:opacity-100 group-hover:opacity-100',
            compact ? 'h-5 w-5' : 'h-6 w-6',
          )}
        >
          <Icon name="close" size={compact ? 11 : 12} />
        </button>
      )}

      <div
        className={cn(
          'flex items-start leading-none',
          showRank ? 'justify-between' : 'justify-end',
        )}
      >
        {showRank && (
          <span
            className={cn(
              'fs-num font-extrabold text-ink',
              compact ? 'text-sm' : 'text-base',
            )}
          >
            {rank}
          </span>
        )}
        <span className="fs-num text-[11px] font-semibold text-n-3">
          {projectionLabel}
        </span>
      </div>

      {/* The avatar stays part of the drag surface — only the name is a
          click target, so drags can start from almost anywhere on the card. */}
      <div
        className={cn(
          'flex flex-1 flex-col items-center',
          compact ? 'mt-0.5 gap-0.5' : 'mt-1 gap-1',
        )}
      >
        <Avatar className={cn('shrink-0', compact ? 'h-9 w-9' : 'h-14 w-14')}>
          {player.headshot_url && (
            <AvatarImage
              src={player.headshot_url}
              alt={player.full_name}
              className="h-full w-full object-cover object-top"
            />
          )}
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <FittedName
          first={first}
          last={last}
          fullName={player.full_name}
          drafted={drafted}
          onOpen={onOpen}
          compact={compact}
        />
      </div>

      <div className="mt-auto flex items-center justify-center gap-1.5">
        <PositionBadge position={player.position} />
        {player.team && (
          <span className="text-[10px] font-semibold text-n-3">{player.team}</span>
        )}
      </div>

      {draftMode && onToggleDrafted && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleDrafted()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'mt-1 rounded-sm border border-ink py-1 text-[10px] font-bold leading-none opacity-0 transition-all focus-visible:opacity-100 group-hover:opacity-100',
            drafted
              ? 'bg-white text-ink hover:bg-n-4'
              : 'bg-accent text-accent-foreground hover:bg-accent-strong',
          )}
        >
          {drafted ? <Icon name="check" size={12} className="mx-auto" /> : 'Mark drafted'}
        </button>
      )}
    </div>
  )
}
