import { Icon } from '@/components/ui/icon'
import { getTeamColors } from '@/lib/nfl-team-colors'
import { cn } from '@/lib/utils'

import type { ThumbnailPlayer } from '@/hooks/use-lists'

export type ListThumbnailLabel =
  | 'QB'
  | 'RB'
  | 'WR'
  | 'TE'
  | 'K'
  | 'DEF'
  | 'FLEX'
  | 'AP'
  | 'TM'

/**
 * The list's identity colour, keyed by its position label. Exported so other
 * list surfaces (the Lists v2 gallery cover band) tint from the same source
 * instead of minting a second map.
 */
export const POS_TINTS: Record<ListThumbnailLabel, { bg: string; fg: string }> = {
  QB: { bg: 'bg-pos-qb', fg: 'text-white' },
  RB: { bg: 'bg-pos-rb', fg: 'text-white' },
  WR: { bg: 'bg-pos-wr', fg: 'text-white' },
  TE: { bg: 'bg-pos-te', fg: 'text-white' },
  K: { bg: 'bg-pos-k', fg: 'text-white' },
  DEF: { bg: 'bg-pos-def', fg: 'text-white' },
  FLEX: { bg: 'bg-pos-flex', fg: 'text-white' },
  AP: { bg: 'bg-ink', fg: 'text-white' },
  TM: { bg: 'bg-ink', fg: 'text-white' },
}

interface ListThumbnailProps {
  /** The list's position_filter value, or null when no position is set. */
  positionFilter: string | null | undefined
  /**
   * Team lists aren't position-filtered, so they'd otherwise fall back to the
   * "AP" (All Players) label. Pass `isTeam` to label the tile "TM" / "Team".
   */
  isTeam?: boolean
  /** Optional uploaded cover image — overrides the 4-quadrant default. */
  imageUrl?: string | null
  /** First 1–3 players on the list. Renders one per quadrant after Q1. */
  players?: ThumbnailPlayer[] | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const SIZE_CLASSES: Record<NonNullable<ListThumbnailProps['size']>, string> = {
  // 24px — the Lists v2 rail row's cover tile (the handoff's 30px at the
  // app's ×0.8 scale). Additive: no existing call site passes `xs`.
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
  xl: 'h-[90px] w-[90px]',
}

const LABEL_SIZE: Record<NonNullable<ListThumbnailProps['size']>, string> = {
  xs: 'text-[7px]',
  sm: 'text-[8px]',
  md: 'text-[9px]',
  lg: 'text-[10px]',
  xl: 'text-base',
}

const EMPTY_HINT_ICON_SIZE: Record<NonNullable<ListThumbnailProps['size']>, number> = {
  xs: 8,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 20,
}

/** 2×2 headshot tile — square, 1px ink border, 1px ink seams. */
export function ListThumbnail({
  positionFilter,
  isTeam = false,
  imageUrl,
  players,
  size = 'md',
  className,
}: ListThumbnailProps) {
  const label = isTeam ? 'TM' : normalizeLabel(positionFilter)
  const titleAttr =
    label === 'TM' ? 'Team' : label === 'AP' ? 'All players' : `${label} list`

  if (imageUrl) {
    return (
      <div
        aria-hidden
        className={cn(
          'inline-flex shrink-0 overflow-hidden rounded-sm border border-ink',
          SIZE_CLASSES[size],
          className,
        )}
        title={titleAttr}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      </div>
    )
  }

  const top3 = (players ?? []).slice(0, 3)
  const tint = POS_TINTS[label]
  const isEmpty = top3.length === 0

  return (
    // The grid lives on a protected INNER element so a caller's `className`
    // (e.g. a responsive `sm:inline-flex` for show/hide) lands on the outer
    // wrapper and can never override the grid's `display`, which would collapse
    // the 2×2 quadrants into a single row.
    <div
      aria-hidden
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded-sm border border-ink bg-ink',
        SIZE_CLASSES[size],
        className,
      )}
      title={titleAttr}
    >
      <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px">
        <div
          className={cn(
            'flex items-center justify-center font-mono font-bold uppercase tracking-tight',
            tint.bg,
            tint.fg,
            LABEL_SIZE[size],
          )}
        >
          {label}
        </div>
        <PlayerQuadrant player={top3[0]} size={size} />
        <PlayerQuadrant player={top3[1]} size={size} />
        {isEmpty ? (
          <div className="flex items-center justify-center bg-n-4 text-n-3">
            <Icon name="edit" size={EMPTY_HINT_ICON_SIZE[size]} />
          </div>
        ) : (
          <PlayerQuadrant player={top3[2]} size={size} />
        )}
      </div>
    </div>
  )
}

function PlayerQuadrant({
  player,
  size,
}: {
  player: ThumbnailPlayer | undefined
  size: NonNullable<ListThumbnailProps['size']>
}) {
  if (!player) {
    return <div className="bg-n-4" />
  }
  const { primary } = getTeamColors(player.team)
  const initials = player.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  return (
    <div
      className="relative flex items-center justify-center overflow-hidden"
      style={{ backgroundColor: primary }}
    >
      {player.headshot_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.headshot_url}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-top"
          draggable={false}
        />
      ) : (
        <span
          className={cn(
            'font-mono font-bold uppercase tracking-tight text-white/90',
            LABEL_SIZE[size],
          )}
        >
          {initials}
        </span>
      )}
    </div>
  )
}

/** Public form of the label rule, for callers tinting from `POS_TINTS`. */
export function listThumbnailLabel(
  positionFilter: string | null | undefined,
  isTeam = false,
): ListThumbnailLabel {
  return isTeam ? 'TM' : normalizeLabel(positionFilter)
}

function normalizeLabel(input: string | null | undefined): ListThumbnailLabel {
  if (!input) return 'AP'
  const upper = input.toUpperCase()
  if (
    upper === 'QB' ||
    upper === 'RB' ||
    upper === 'WR' ||
    upper === 'TE' ||
    upper === 'K' ||
    upper === 'DEF' ||
    upper === 'FLEX'
  ) {
    return upper as ListThumbnailLabel
  }
  return 'AP'
}
