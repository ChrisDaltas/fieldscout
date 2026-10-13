'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Icon } from '@/components/ui/icon'
import { PositionBadge } from '@/components/players/position-badge'
import { PROJ_TEXT } from '@/components/players/projected-points'
import { cn } from '@/lib/utils'

export interface PlayerCardPlayer {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  /** Board layout shows the bye inline in the meta row when present. */
  bye_week?: number | null
}

/** A labeled stat pill on the board-layout card ("Rank: 3rd", "$28"). */
export interface PlayerCardStatChip {
  id: string
  text: string
  /** ink = neutral stat, pink = warning-ish (SOS), green = money (auction). */
  tone?: 'ink' | 'pink' | 'green'
}

// v7 status pills: soft tint + same-hue text (neutral grey for plain stats).
const CHIP_TONES: Record<NonNullable<PlayerCardStatChip['tone']>, string> = {
  ink: 'bg-surface-control text-n-2',
  pink: 'bg-negative-soft text-negative-strong',
  green: 'bg-positive-soft text-positive-strong',
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
  /**
   * 'tile' (default) is the vertical centered card. 'board' is the Big Board
   * dashboard card (v7): round headshot, name over a position · team · bye
   * meta row, accent rank chip at the top-right, labeled stat pills along the
   * bottom, and hover-revealed drafted / do-not-draft buttons.
   */
  layout?: 'tile' | 'board'
  /** Board layout only: labeled stat pills along the card bottom (max 4). */
  statChips?: PlayerCardStatChip[]
  /** Board layout only: quick label — tints (drafted) or greys (dnd) the card. */
  label?: 'drafted' | 'dnd' | null
  /** Board layout only: toggle a quick label (renders the hover buttons). */
  onToggleLabel?: (label: 'drafted' | 'dnd') => void
  /** Board layout only: dim the card (position filter in "fade others" mode). */
  faded?: boolean
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
        'block w-full truncate font-semibold leading-tight tracking-[-0.01em]',
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
      className="block w-full min-w-0 cursor-pointer text-center transition-colors hover:text-accent-strong hover:underline hover:underline-offset-2 focus:outline-none focus-visible:underline"
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
  layout = 'tile',
  statChips,
  label,
  onToggleLabel,
  faded = false,
  className,
}: PlayerCardProps) {
  const { first, last } = splitName(player.full_name)
  const initials = (first[0] ?? '') + (last[0] ?? '')
  const compact = size === 'compact'

  const projectionLabel =
    typeof projectedPts === 'number' ? projectedPts.toFixed(1) : '—'

  if (layout === 'board') {
    const abbrev = first ? `${first[0]}. ${last}` : last
    const drafted2 = label === 'drafted'
    const dnd = label === 'dnd'
    const dimContent = faded || dnd
    const name = (
      <span
        title={player.full_name}
        className={cn(
          'block truncate text-[13px] font-semibold leading-tight tracking-[-0.01em]',
          drafted2 && 'line-through decoration-n-6',
        )}
      >
        {abbrev}
      </span>
    )
    // Quick-label toggles (v7 round icon buttons). Resting hover shows bare
    // glyphs; once a label is active both stay visible — filled active,
    // grey idle (Figma states: Hover / Highlighted / Demoted).
    const labelButtonClass = (active: boolean, activeFill: string) =>
      cn(
        'flex h-6 w-6 items-center justify-center rounded-pill transition-[background-color,color,opacity] focus-visible:opacity-100',
        active
          ? `${activeFill} text-white opacity-100`
          : label != null
            ? 'bg-surface-control text-n-2 opacity-100 hover:bg-surface-pressed hover:text-ink'
            : 'text-n-6 opacity-0 hover:bg-surface-hover hover:text-ink group-hover:opacity-100',
      )
    const hasFooter = Boolean(onToggleLabel) || Boolean(statChips && statChips.length > 0)
    return (
      <div
        {...dragHandleProps}
        className={cn(
          // v7 card: hairline only at rest; the soft lift is the hover
          // affordance (the card is a drag / open target).
          'group relative flex flex-col gap-2.5 rounded-2xl border border-n-4 p-3 transition-shadow hover:shadow-hard-4',
          drafted2 ? 'bg-positive-soft' : dnd ? 'bg-surface-sunken' : 'bg-white',
          draggable && 'cursor-grab active:cursor-grabbing',
          // Mid-drag the card genuinely floats over the grid — it keeps the
          // lift at rest while it's being carried (drag-ghost exception).
          isDragging && 'z-10 shadow-hard-6',
          faded && 'opacity-50',
          className,
        )}
      >
        {/* header — round headshot, name over a position · team · bye meta
            row, the board's rank chip at the right */}
        <div className={cn('flex items-start gap-2.5', dimContent && 'opacity-60')}>
          <Avatar className={cn('h-[38px] w-[38px] shrink-0', dimContent && 'grayscale')}>
            <PlayerAvatarImage player={player} alt={player.full_name} />
            <AvatarFallback className="text-[11px] font-semibold">{initials}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 pt-px">
            {onOpen ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen()
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="block w-full cursor-pointer text-left transition-colors hover:text-accent-strong hover:underline hover:underline-offset-2 focus:outline-none focus-visible:underline"
              >
                {name}
              </button>
            ) : (
              name
            )}

            <span className="mt-[5px] flex items-center gap-[5px]">
              <PositionBadge position={player.position} className="shrink-0" />
              <span className="truncate text-[10px] font-medium text-n-6">
                {[player.team, player.bye_week != null ? `Bye ${player.bye_week}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </div>

          {showRank && (
            <span className="fs-num inline-flex h-[19px] min-w-[26px] shrink-0 items-center justify-center rounded bg-accent px-[5px] text-[10px] font-bold leading-none text-accent-foreground">
              {rank}
            </span>
          )}
        </div>

        {hasFooter && (
          <div className="flex min-h-6 items-center gap-1">
            {/* labeled stat pills (max 4) */}
            <div
              className={cn(
                'flex min-w-0 flex-1 flex-wrap items-center gap-1',
                dimContent && 'opacity-60',
              )}
            >
              {(statChips ?? []).slice(0, 4).map((chip) => (
                <span
                  key={chip.id}
                  className={cn(
                    'fs-num inline-flex h-[18px] items-center rounded-pill px-[7px] text-[10px] font-semibold leading-none',
                    CHIP_TONES[chip.tone ?? 'ink'],
                  )}
                >
                  {chip.text}
                </span>
              ))}
            </div>

            {onToggleLabel && (
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  aria-label={dnd ? 'Undo do not draft' : 'Do not draft'}
                  aria-pressed={dnd}
                  title={dnd ? 'Undo do not draft' : 'Do not draft'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleLabel('dnd')
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={labelButtonClass(dnd, 'bg-ink')}
                >
                  <Icon name="eye-off" size={13} />
                </button>
                <button
                  type="button"
                  aria-label={drafted2 ? 'Undo drafted' : 'Mark drafted'}
                  aria-pressed={drafted2}
                  title={drafted2 ? 'Undo drafted' : 'Mark drafted'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleLabel('drafted')
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={labelButtonClass(drafted2, 'bg-positive-strong')}
                >
                  <Icon name="check" size={13} />
                </button>
              </span>
            )}
          </div>
        )}

        {menuSlot}
      </div>
    )
  }

  // v7 card: hairline at rest, soft lift on hover only. The lift stays
  // shadow-only: dnd-kit drives `transform` inline, so a translate hover
  // would fight the drag transform.
  return (
    <div
      {...dragHandleProps}
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col items-stretch rounded-2xl border border-n-4 bg-white transition-[box-shadow,background-color,border-color] hover:shadow-hard-4',
        // Compact is a fixed 120×112 tile (list detail cards view) that must
        // never resize; default fills its column and is 160px tall.
        compact ? 'h-[112px] w-[120px] px-2 pt-1.5 pb-1.5' : 'h-40 px-3 pt-2.5 pb-2',
        draggable && 'cursor-grab active:cursor-grabbing',
        // Drag ghost / card mid-drag: it really floats above the page, so it
        // keeps its lift at rest (overlay exception).
        isDragging && 'z-10 shadow-hard-6',
        // Selected is a resting state — fill + blue edge, never a shadow.
        selected && 'border-accent bg-accent-soft',
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
            'absolute right-1.5 top-1.5 z-10 flex items-center justify-center rounded-pill bg-surface-control text-n-2 opacity-0 transition-[background-color,color,opacity] hover:bg-negative-soft hover:text-negative-strong focus-visible:opacity-100 group-hover:opacity-100',
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
              'fs-num font-bold text-ink',
              compact ? 'text-[12px]' : 'text-[13px]',
            )}
          >
            {rank}
          </span>
        )}
        <span className={cn('fs-num text-[11px] font-bold', PROJ_TEXT)} data-proj>
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
          <PlayerAvatarImage player={player} alt={player.full_name} />
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
          <span className="text-[10px] font-medium text-n-6">{player.team}</span>
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
            'mt-1.5 flex h-btn-sm items-center justify-center rounded-pill text-[10px] font-semibold leading-none opacity-0 transition-[background-color,opacity] focus-visible:opacity-100 group-hover:opacity-100',
            drafted
              ? 'bg-surface-control text-n-2 hover:bg-surface-pressed'
              : 'bg-accent text-accent-foreground hover:bg-accent-strong',
          )}
        >
          {drafted ? <Icon name="check" size={12} /> : 'Mark drafted'}
        </button>
      )}
    </div>
  )
}
