import type { CSSProperties } from 'react'

import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
 * Position-group identity fills — the one source of truth for "what colour is
 * this list?". `AP` (no position filter, i.e. all players) is deliberately ink:
 * Chris, 2026-08-11 — *"if it's all players, it'll be the black. But if it's
 * any of the other positions, then it uses whatever that color is for that
 * position group."* Lists v2's gallery cover band reads this map too, so the
 * rail tile and the card band can never drift apart.
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
  /**
   * The list's first players, in list order. Only the first three are drawn —
   * one per quadrant after Q1 — so callers may hand over more (`/api/lists`
   * returns four, for the Lists v2 gallery band) without slicing first.
   */
  players?: ThumbnailPlayer[] | null
  /**
   * Named step, or an exact edge length in px.
   *
   * The numeric form exists for Lists v2, whose cover tiles are sized from the
   * design (24px in the rail, 51px in the hero — the handoff's 30/64 at this
   * app's ×0.8 scale) and land between the named steps. Named sizes keep their
   * literal Tailwind classes so no pre-existing screen shifts by a pixel.
   */
  size?: ListThumbnailSize
  className?: string
}

export type ListThumbnailNamedSize = 'sm' | 'md' | 'lg' | 'xl'
export type ListThumbnailSize = ListThumbnailNamedSize | number

const SIZE_CLASSES: Record<ListThumbnailNamedSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
  xl: 'h-[90px] w-[90px]',
}

const LABEL_SIZE: Record<ListThumbnailNamedSize, string> = {
  sm: 'text-[8px]',
  md: 'text-[9px]',
  lg: 'text-[10px]',
  xl: 'text-base',
}

const EMPTY_HINT_ICON_SIZE: Record<ListThumbnailNamedSize, number> = {
  sm: 10,
  md: 12,
  lg: 14,
  xl: 20,
}

interface ThumbnailMetrics {
  /** Set for named sizes only; the numeric form uses `boxStyle` instead. */
  boxClass?: string
  boxStyle?: CSSProperties
  labelClass?: string
  /** Font metrics for the position label, whose length varies (`K` … `FLEX`). */
  labelStyle?: CSSProperties
  /** Font metrics for a headshot-less quadrant's initials — always 2 glyphs. */
  initialsStyle?: CSSProperties
  iconSize: number
}

/**
 * Largest font that fits `length` monospace glyphs inside one quadrant.
 *
 * A quadrant is half the tile less its 1px seam, and this app's mono face runs
 * ~0.6em per glyph. Without this, `FLEX` — the only four-character label —
 * overflowed its quadrant and bled across the headshot beside it at the Lists
 * v2 sizes (24px rail, 51px hero); `DEF` clipped at 24px. Shrinking to fit is
 * the right trade because the *fill colour* is what identifies the position
 * group (Chris, 2026-08-11) and the letters only confirm it.
 */
function fitFontPx(size: number, length: number): number {
  const quadrant = size / 2 - 2
  return Math.max(4, Math.min(Math.round(size * 0.28), Math.floor(quadrant / (0.6 * length))))
}

function metricsFor(size: ListThumbnailSize, labelLength: number): ThumbnailMetrics {
  if (typeof size !== 'number') {
    return {
      boxClass: SIZE_CLASSES[size],
      labelClass: LABEL_SIZE[size],
      iconSize: EMPTY_HINT_ICON_SIZE[size],
    }
  }
  return {
    boxStyle: { width: size, height: size },
    labelStyle: { fontSize: fitFontPx(size, labelLength) },
    initialsStyle: { fontSize: fitFontPx(size, 2) },
    iconSize: Math.max(8, Math.round(size * 0.3)),
  }
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
  const metrics = metricsFor(size, label.length)

  if (imageUrl) {
    return (
      <div
        aria-hidden
        className={cn(
          'inline-flex shrink-0 overflow-hidden rounded-sm border border-ink',
          metrics.boxClass,
          className,
        )}
        style={metrics.boxStyle}
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
        metrics.boxClass,
        className,
      )}
      style={metrics.boxStyle}
      title={titleAttr}
    >
      <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px">
        <div
          className={cn(
            'flex items-center justify-center overflow-hidden font-mono font-bold uppercase leading-none tracking-tight',
            tint.bg,
            tint.fg,
            metrics.labelClass,
          )}
          style={metrics.labelStyle}
        >
          {label}
        </div>
        <PlayerQuadrant player={top3[0]} metrics={metrics} />
        <PlayerQuadrant player={top3[1]} metrics={metrics} />
        {isEmpty ? (
          <div className="flex items-center justify-center bg-n-4 text-n-3">
            <Icon name="edit" size={metrics.iconSize} />
          </div>
        ) : (
          <PlayerQuadrant player={top3[2]} metrics={metrics} />
        )}
      </div>
    </div>
  )
}

function PlayerQuadrant({
  player,
  metrics,
}: {
  player: ThumbnailPlayer | undefined
  metrics: ThumbnailMetrics
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

  // The base `Avatar` primitive rather than a bare `<img>`: it is what gives
  // this quadrant an *error* fallback and not just a *missing-URL* one. The
  // previous `player.headshot_url ? <img> : <initials>` painted the browser's
  // broken-image glyph on any 403/404 — which every team defense produced, and
  // which is precisely "nothing happened" being displayed as content
  // (CLAUDE.md). `PlayerAvatarImage` also resolves DEF to its team logo.
  //
  // The quadrant is a seam in a 2×2 grid, so the primitive's own tile chrome
  // (`rounded-sm border border-ink`, `bg-n-4`) is turned off — the team colour
  // is the fill, and the tile's border belongs to the wrapper.
  return (
    <Avatar
      className="h-full w-full rounded-none border-0"
      style={{ backgroundColor: primary }}
    >
      <PlayerAvatarImage player={player} draggable={false} />
      <AvatarFallback
        className={cn(
          'bg-transparent font-mono font-bold uppercase tracking-tight text-white/90',
          metrics.labelClass,
        )}
        style={metrics.initialsStyle}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * `lists.position_filter` → a tint key. The column is nullable and constrained
 * to `POSITION_FILTERS` (`src/types/schemas/lists.ts`), so anything else —
 * including `null` — is "all players".
 */
export function listThumbnailLabel(
  input: string | null | undefined,
): ListThumbnailLabel {
  return normalizeLabel(input)
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
