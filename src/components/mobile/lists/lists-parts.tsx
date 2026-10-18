'use client'

import { useState } from 'react'

import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { ScoringSheet } from '@/components/mobile/ui/scoring-sheet'
import type { ThumbnailPlayer } from '@/hooks/use-lists'
import type { ListScoring, TimeFrame } from '@/hooks/use-mobile-lists-timeframe-stats'
import { cn } from '@/lib/utils'

import { coverBgClass, youTubeId, youTubeThumb } from './lists-model'
import { SCORING_OPTIONS, TIME_FRAMES, scoringLabel, timeFrameLabel } from './lists-stats'

/**
 * FieldScout Mobile — Lists shared parts (lr-lists §2, lr-frame §2.13): the
 * prototype's inline icons, the Ranked / Tiers switch, the time-frame and
 * scoring controls, covers and the video card.
 */

// =============================================================================
// Icons the shared `MIcon` set lacks (lr-frame §2.13.12), viewBox 16
// =============================================================================

export const L_ICON = {
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  play: 'M4.5 2.8v10.4L13 8z',
  collage: 'M2.5 2.5h5v5h-5zM8.5 2.5h5v5h-5zM2.5 8.5h5v5h-5zM8.5 8.5h5v5h-5z',
  upload: 'M8 10.5V3M5 5.5L8 2.5l3 3M2.5 10v3.5h11V10',
  videoFrame: 'M2.5 4h11v8h-11zM7 6.3v3.4L9.8 8z',
  autoTiers: 'M3 4h10M3 8h7M3 12h4',
  addTierLine: 'M2.5 8h11M8 5v6',
  /** Import a ranking (lr-frame §2.13.12). */
  import: 'M3 3.5h10M3 8h6M3 12.5h4M11 9v5M8.5 11.5L11 14l2.5-2.5',
  dots: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  folder: 'M2 4.5a1 1 0 0 1 1-1h3.2l1.4 1.5H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z',
  share: 'M8 10V2.5M5 5.5L8 2.5l3 3M3 9v4.5h10V9',
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9',
  lock: 'M4.5 7.5h7v6h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2',
  globe: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 8h12M8 2c1.7 1.6 2.5 3.6 2.5 6S9.7 12.4 8 14C6.3 12.4 5.5 10.4 5.5 8S6.3 3.6 8 2z',
  pin: 'M6 2.5h4M6.5 2.5v4L4.5 9h7l-2-2.5v-4M8 9v4.5',
  edit: 'M11 2.5l2.5 2.5L6 12.5H3.5V10zM9.5 4l2.5 2.5',
  sparkle: 'M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3zM12.5 11.5l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z',
  league: 'M5 2.5h6v3a3 3 0 0 1-6 0zM5 3.5H3v1.2A2.3 2.3 0 0 0 5.2 7M11 3.5h2v1.2A2.3 2.3 0 0 1 10.8 7M8 8.5v2.5M5.5 13.5h5L10 11H6z',
  chevronDown: 'M4 6l4 4 4-4',
  // List tools in the ⋯ sheet (gap list §3 #3) — the design has none.
  group: 'M2.5 3.5h11M4.5 6.5h9M4.5 9.5h9M2.5 12.5h11',
  checkOff: 'M3 3h10v10H3zM5.5 8.2l1.8 1.8 3.2-3.5',
  clear: 'M4.5 6H10a3 3 0 0 1 0 6H6.5M6.5 3.5L4 6l2.5 2.5',
  note: 'M3.5 2.5h6.5L12.5 5v8.5h-9zM6 7.5h4M6 10h2.5',
  columns: 'M2.5 3h4.5v10H2.5zM9 3h4.5v10H9z',
} as const

export type LIconName = keyof typeof L_ICON

export function LIcon({
  name,
  size = 16,
  stroke = 1.5,
  filled = false,
  className,
}: {
  name: LIconName
  size?: number
  stroke?: number
  filled?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <path d={L_ICON[name]} />
    </svg>
  )
}

/** Six-dot grip (fill currentColor, r 1.2 at 5.5|10.5 × 4|8|12). */
export function GripIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} fill="currentColor" aria-hidden="true" className={cn('shrink-0', className)}>
      {[4, 8, 12].map((cy) => (
        <g key={cy}>
          <circle cx={5.5} cy={cy} r={1.2} />
          <circle cx={10.5} cy={cy} r={1.2} />
        </g>
      ))}
    </svg>
  )
}

// =============================================================================
// Ranked / Tiers switch (lr-frame §2.13.10): 38×22 track, 18px knob — the
// phone's one switch, shared from the mobile form parts.
// =============================================================================

export { SwitchTrack } from '@/components/mobile/ui/m-form'

// =============================================================================
// Time-frame control (lr-frame §2.13.11 n): Week N | Last 3 | Season
// =============================================================================

export function TimeFrameControl({
  value,
  onChange,
  latestWeek,
}: {
  value: TimeFrame
  onChange: (tf: TimeFrame) => void
  latestWeek: number | null
}) {
  return (
    <MSegmented
      label="Time frame"
      options={TIME_FRAMES.map((tf) => ({ value: tf, label: timeFrameLabel(tf, latestWeek) }))}
      value={value}
      onChange={onChange}
      className="flex flex-none gap-0 rounded-pill"
      // 24px segments as drawn; the tap area reaches the README's 30px
      // minimum (lr-lists gap 32 — enlarge the hit area, not the visual).
      itemClassName="relative h-6 whitespace-nowrap rounded-pill px-2.5 text-[11px] after:absolute after:inset-x-0 after:-inset-y-[3px] after:content-['']"
    />
  )
}

// =============================================================================
// Scoring control (gap list #19, Chris 2026-10-15): which scoring the list's
// points follow — PPR, Half PPR, Quarter PPR or Standard. The design has no
// such control, so it extends the design language: a 24px pill beside the
// time frame that names the active scoring, opening the shared scoring sheet
// (`ScoringSheet` — the player profile's chip opens it too) of the four.
// =============================================================================

export function ScoringControl({
  value,
  onChange,
  disabled = false,
}: {
  value: ListScoring
  onChange: (scoring: ListScoring) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Scoring: ${scoringLabel(value)}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
        // 24px as the time frame's segments; the tap area reaches 30px
        // (lr-lists gap 32).
        className="relative flex h-6 flex-none items-center gap-1 whitespace-nowrap rounded-pill bg-m-b2 pl-2.5 pr-2 text-[11px] font-semibold text-m-t1 after:absolute after:inset-x-0 after:-inset-y-[3px] after:content-[''] active:bg-m-b2h disabled:opacity-40"
      >
        {scoringLabel(value)}
        <LIcon name="chevronDown" size={9} stroke={2.4} />
      </button>
      <ScoringSheet
        open={open}
        onOpenChange={setOpen}
        subtitle="The points in this list’s stats"
        options={SCORING_OPTIONS}
        value={value}
        onPick={onChange}
      />
    </>
  )
}

// =============================================================================
// Covers (lr-lists §2.1 card, §2.7 view)
// =============================================================================

type CollageHead = Pick<ThumbnailPlayer, 'id' | 'full_name' | 'team' | 'headshot_url' | 'position'>

/**
 * The first four players' headshots in two columns, centred. A collage of one
 * or three is centred too (the design's fixed grid draws them off-centre,
 * lr-lists gap 29).
 */
export function CoverCollage({ players, size }: { players: readonly CollageHead[]; size: 46 | 60 }) {
  const gap = size === 46 ? 6 : 8
  const heads = players.slice(0, 4)
  if (heads.length === 0) return null
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="flex flex-wrap justify-center" style={{ width: size * 2 + gap, gap }}>
        {heads.map((player) => (
          <MHeadshot key={player.id} player={player} size={size} />
        ))}
      </div>
    </div>
  )
}

/** A full-bleed cover image (uploaded thumbnail or a video frame). */
export function CoverImage({ src }: { src: string }) {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 bg-cover bg-center"
      style={{ backgroundImage: `url("${src.replace(/"/g, '%22')}")` }}
    />
  )
}

/** `cover_color` is optional: a row read before migration 188 has no key. */
export function coverClass(list: {
  thumbnail_url: string | null
  position_filter: string | null
  cover_color?: string | null
}): string {
  return list.thumbnail_url ? 'bg-m-ink' : coverBgClass(list.position_filter, list.cover_color)
}

// =============================================================================
// Video card (lr-lists §2.7): 112×63 thumbnail, red play badge, title, source
// =============================================================================

/**
 * `title` is YouTube's real title, or null when YouTube would not give one —
 * then the card shows NO title line (Chris, 2026-10-15: "the actual YouTube
 * titles or nothing"); the thumbnail and the source line carry it.
 */
export function VideoCard({
  url,
  title,
  sub = 'Watch on YouTube',
}: {
  url: string
  title: string | null
  sub?: string
}) {
  const id = youTubeId(url)
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 rounded-xl bg-m-b1 p-2 text-m-t1 active:bg-m-b2h"
    >
      <span className="relative h-[63px] w-[112px] flex-none overflow-hidden rounded-md bg-m-ink">
        {id ? <CoverImage src={youTubeThumb(id)} /> : null}
        <span className="absolute left-1/2 top-1/2 flex h-[22px] w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded bg-negative-strong text-white">
          <LIcon name="play" size={10} filled />
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <span className="text-[13px] font-semibold leading-[1.3] [text-wrap:pretty]">{title}</span> : null}
        <span className="text-[11px] font-medium text-m-t3">{sub}</span>
      </span>
    </a>
  )
}

/** YouTube's red badge with a white play (20×14, radius 4). */
export function YouTubeBadge() {
  return (
    <span className="flex h-3.5 w-5 flex-none items-center justify-center rounded-sm bg-negative-strong text-white">
      <LIcon name="play" size={8} filled />
    </span>
  )
}

/** Centred empty / error line (extends the design language: 13–15px t3). */
export function CenterNote({
  title,
  body,
  action,
  className,
}: {
  title: string
  body?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-5 py-12 text-center', className)}>
      <span className="text-[15px] font-semibold text-m-t1">{title}</span>
      {body ? <span className="text-[13px] font-medium leading-[1.4] text-m-t3 [text-wrap:pretty]">{body}</span> : null}
      {action}
    </div>
  )
}

/**
 * A read that failed under content that still shows (extends the design
 * language: a b1 strip, 12/500 t3 with an accent "Try again"). Used where a
 * failure would otherwise look like empty cells (CLAUDE.md, loud failure).
 */
export function InlineError({
  message,
  onRetry,
  className,
  tone = 'quiet',
  retryLabel = 'Try again',
}: {
  message: string
  onRetry: () => void
  className?: string
  /** `alert`: a failed write (the editor's Update) — the message in the
   *  negative colour, not the quiet t3 a failed read uses. */
  tone?: 'quiet' | 'alert'
  retryLabel?: string
}) {
  return (
    <div role="alert" className={cn('flex items-center gap-2 rounded-xl bg-m-b1 py-2 pl-3 pr-1.5', className)}>
      <span
        className={cn(
          'min-w-0 flex-1 text-[12px] font-medium leading-[1.4] [text-wrap:pretty]',
          tone === 'alert' ? 'text-m-red' : 'text-m-t3',
        )}
      >
        {message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="flex h-[30px] flex-none items-center whitespace-nowrap rounded-pill px-2.5 text-[12px] font-semibold text-accent active:bg-m-b2"
      >
        {retryLabel}
      </button>
    </div>
  )
}

/** The design's blue 40px pill (empty-state "Add players"). */
export function PillButton({
  children,
  onClick,
  tone = 'accent',
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'accent' | 'quiet'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-10 items-center rounded-pill px-[18px] text-[14px] font-semibold',
        tone === 'accent' ? 'bg-accent text-white active:bg-accent-strong' : 'bg-m-b2 text-m-t1 active:bg-m-b2h',
      )}
    >
      {children}
    </button>
  )
}
