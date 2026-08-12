'use client'

import * as React from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { PlayerAvatarImage } from '@/components/players/player-image'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ListPlayerWithPlayer } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'

import type { Bucket } from './list-buckets'

/**
 * Lists v2 — the pieces every view style shares: headshot, position/team line,
 * the note mark and its hover card, the drafted checkbox, the row menu, and a
 * bucket header.
 *
 * Sizes are the design's stated values converted to this app's ×0.8 scale
 * (plan §1, "Scale"): a 30px headshot is 24, a 26px one is 21, a 60px row is
 * 48, a 44px row is 36.
 */

// -----------------------------------------------------------------------------
// Player identity
// -----------------------------------------------------------------------------

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function PlayerFace({
  entry,
  size = 24,
  round,
}: {
  entry: ListPlayerWithPlayer
  size?: number
  round?: boolean
}) {
  const name = entry.player.full_name
  return (
    <Avatar
      className={cn('shrink-0', round && 'rounded-pill')}
      style={{ width: size, height: size }}
    >
      <PlayerAvatarImage player={entry.player} />
      <AvatarFallback
        className={cn('fs-num font-bold', round && 'rounded-pill')}
        style={{ fontSize: Math.round(size * 0.36) }}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

/** Position badge + team code, and the injury flag the design shows beside it. */
export function PlayerMeta({
  entry,
  className,
}: {
  entry: ListPlayerWithPlayer
  className?: string
}) {
  const status = entry.player.status
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <PositionBadge position={entry.player.position ?? 'FLEX'} />
      <span className="fs-num whitespace-nowrap text-[10px] font-medium text-n-3">
        {entry.player.team ?? 'FA'}
      </span>
      {status && status !== 'Active' ? (
        <span className="inline-flex h-[13px] shrink-0 items-center rounded-sm border border-ink bg-caution px-1 text-[8px] font-bold text-ink">
          {status === 'Questionable' ? 'Q' : status === 'Out' ? 'Out' : status.slice(0, 3)}
        </span>
      ) : null}
    </span>
  )
}

// -----------------------------------------------------------------------------
// Note
// -----------------------------------------------------------------------------

/**
 * "A note is a mark, not a paragraph" (design LAW, Notes): one accent
 * `comments` glyph beside the player, and the note itself only on hover, in a
 * white ink-stroked box at modal elevation.
 */
export function NoteMark({ note, size = 11 }: { note: string | null; size?: number }) {
  if (!note?.trim()) return null
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 cursor-help text-accent" aria-label="Note">
          <Icon name="comments" size={size} />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-[208px] border-1 border-ink bg-white p-2 text-[11px] font-medium leading-snug text-ink shadow-hard-8"
      >
        {note}
      </TooltipContent>
    </Tooltip>
  )
}

// -----------------------------------------------------------------------------
// Drafted
// -----------------------------------------------------------------------------

/**
 * The drafted checkbox. **Permanent — there is no draft-mode gate**
 * (Chris, 2026-08-10; plan D2). It is purely a display treatment: it never
 * reorders, filters, or cascades.
 */
export function DraftedCheckbox({
  drafted,
  onToggle,
  className,
}: {
  drafted: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      title={drafted ? 'Mark undrafted' : 'Mark drafted'}
      aria-pressed={drafted}
      className={cn(
        'inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-sm border-1 border-ink transition-colors',
        drafted ? 'bg-positive' : 'bg-white hover:bg-accent-soft',
        className,
      )}
    >
      {drafted ? <Icon name="check" size={8} className="text-ink" /> : null}
    </button>
  )
}

// -----------------------------------------------------------------------------
// Row menu
// -----------------------------------------------------------------------------

export interface RowMenuActions {
  drafted: boolean
  onToggleDrafted: () => void
  onEditNote: () => void
  onRemove: () => void
  canEdit: boolean
  /**
   * Can this viewer mark players drafted? A drafted mark is a row in
   * `list_player_drafted` keyed by `user_id`, so it needs an account — the
   * public share view (LV.6) passes `false` and the item disappears rather than
   * offering a write that would 401.
   */
  canMark: boolean
  /** Card view has its own checkbox, so its menu omits "Mark drafted". */
  omitDrafted?: boolean
}

/**
 * Returns `null` when there is nothing to put in the menu — a trigger that
 * opens an empty popover is worse than no trigger, and on the public share view
 * every item is subtracted at once.
 */
export function RowMenu({ actions, className }: { actions: RowMenuActions; className?: string }) {
  const showDrafted = actions.canMark && !actions.omitDrafted
  if (!showDrafted && !actions.canEdit) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Row options"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink transition-colors hover:bg-accent-soft',
            className,
          )}
        >
          <Icon name="dots-vertical" size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[168px]">
        {showDrafted && (
          <DropdownMenuItem onSelect={actions.onToggleDrafted}>
            <Icon name="check" size={13} />
            {actions.drafted ? 'Mark undrafted' : 'Mark drafted'}
          </DropdownMenuItem>
        )}
        {actions.canEdit && (
          <DropdownMenuItem onSelect={actions.onEditNote}>
            <Icon name="edit" size={13} />
            Add note
          </DropdownMenuItem>
        )}
        {actions.canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={actions.onRemove}>
              <Icon name="remove" size={13} />
              Remove from list
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// -----------------------------------------------------------------------------
// Drag grip
// -----------------------------------------------------------------------------

/**
 * The grip dots — the drag affordance (LV.4). The whole row is draggable, as in
 * the prototype; the grip is what says so.
 *
 * When a grouping cannot be reordered by hand it still renders, faded, carrying
 * the reason on hover. That is deliberate: the alternative — an affordance that
 * accepts the drag and then snaps back, because cost bands re-sort by price — is
 * exactly the "nothing happened" failure CLAUDE.md forbids.
 */
export function Grip({
  className,
  draggable,
  reason,
}: {
  className?: string
  draggable?: boolean
  reason?: string
}) {
  return (
    <span
      aria-hidden={reason ? undefined : 'true'}
      title={reason}
      className={cn(
        'h-[14px] w-[9px] shrink-0',
        draggable ? 'cursor-grab opacity-45 hover:opacity-100' : 'opacity-25',
        className,
      )}
      style={{
        backgroundImage: 'radial-gradient(circle, currentColor 0.9px, transparent 0.9px)',
        backgroundSize: '4px 4px',
        backgroundPosition: '1px 2px',
      }}
    />
  )
}

// -----------------------------------------------------------------------------
// Drop gap
// -----------------------------------------------------------------------------

/**
 * The hole the dragged player will land in (design LAW §"Drag and drop"): sized
 * to exactly the dragged element's `offsetHeight` / `offsetWidth`, filled
 * `--accent-soft` with a dashed `--accent` edge, carrying the player's name.
 *
 * It exists only while a drag is running, and it carries its own slot in
 * `data-drop-gap`, so a pointer that ends up inside the open gap re-aims at the
 * same slot instead of flipping to whichever row the gap just pushed under it.
 * That is what keeps the gap from oscillating.
 *
 * **Vertical (list and table):** every slot is mounted at zero height and the
 * open one animates to size, which is the prototype's behaviour and needs
 * containers that space rows with borders, not a flex `gap`.
 * **Horizontal (cards):** only the open slot is mounted, because that container
 * *is* a `flex-wrap` with a gap and a row of zero-width placeholders would each
 * claim their own 8px. The prototype solves that with per-card margins; changing
 * the shipped card layout for a mid-drag detail is not worth it, and the only
 * thing lost is the 120ms open animation.
 */
export function DropGap({
  bucketKey,
  index,
  open,
  height,
  width,
  name,
  axis = 'y',
  minWidth,
}: {
  bucketKey: string
  index: number
  open: boolean
  height: number
  width: number
  name: string
  axis?: 'x' | 'y'
  minWidth?: number
}) {
  const horizontal = axis === 'x'
  if (horizontal && !open) return null

  const slot = `${bucketKey}:${index}`
  return (
    <div
      data-drop-gap={slot}
      style={
        horizontal
          ? { width, height, flexShrink: 0, overflow: 'hidden' }
          : {
              height: open ? height : 0,
              minWidth,
              overflow: 'hidden',
              transition: 'height 120ms linear',
            }
      }
    >
      <div
        className="flex h-full items-center gap-1.5 border border-dashed border-accent bg-accent-soft px-2.5"
        style={{ width: horizontal ? width : undefined }}
      >
        <Icon name="arrow-next" size={11} className="shrink-0 text-accent-strong" />
        <span className="truncate text-[11px] font-medium text-accent-strong">{name}</span>
      </div>
    </div>
  )
}

/**
 * "A dashed *Drop a player here to start tier N* zone sits below the last
 * section" (design LAW §"Drag and drop").
 *
 * Only rendered where the assignment can actually be written — tier mode, with a
 * letter still free. The prototype offers it in round mode too; that would
 * `23514` against `list_players_tier_check` until LV.1.5, so it is withheld
 * rather than shown as a target that 500s. Since LV.1.5 round mode renders it
 * too — `nextBucket` decides, and `bucketZoneLabel` words it.
 */
export function NewBucketZone({
  bucketKey,
  label,
  over,
}: {
  bucketKey: string
  /** "start tier A" / "start round 4" — `bucketZoneLabel` owns the wording. */
  label: string
  over: boolean
}) {
  return (
    <div
      data-drop-new={bucketKey}
      className={cn(
        'flex h-[42px] items-center justify-center gap-2 border border-dashed text-[11px] font-bold transition-colors',
        over ? 'border-accent bg-accent-soft text-accent-strong' : 'border-ink text-n-3',
      )}
    >
      <Icon name="plus" size={12} />
      <span>Drop a player here to {label}</span>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Empty list
// -----------------------------------------------------------------------------

/**
 * "This list has nothing on it." Shared by the app panel and the public share
 * view (LV.6) — the non-owner copy was already written for the panel's saved
 * lists, and it is exactly the sentence a stranger following a share link
 * should read, so the two surfaces use one component rather than two spellings
 * of the same empty state.
 */
export function EmptyListState({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 border border-dashed border-ink px-6 py-10 text-center">
      <Icon name="list" size={20} className="text-n-3" />
      <p className="text-[13px] font-bold">No players on this list yet.</p>
      <p className="max-w-[300px] text-[11px] font-medium text-n-3">
        {canEdit
          ? 'Use Add players to search the pool and start building the board.'
          : 'The owner has not added anyone yet.'}
      </p>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Bucket header
// -----------------------------------------------------------------------------

/**
 * The saturated band above each section: value alone on the left (never
 * "Tier 3" — the grouping control above already says the word), the running
 * spend where a grouping has one, and `Add +` on the right.
 *
 * Cost bands are the one renameable bucket, edited **inline in the header**
 * (`screens/detail-grouping-avg-cost.png`).
 */
export function BucketHeader({
  bucket,
  canEdit,
  onRename,
  onAdd,
  compact,
}: {
  bucket: Bucket
  canEdit: boolean
  /** Absent on a read-only surface — the band renders as plain text. */
  onRename?: (bandKey: string, label: string) => void
  /** Absent on a read-only surface — the `Add +` affordance disappears. */
  onAdd?: () => void
  compact?: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(bucket.label ?? '')
  const renameable = canEdit && Boolean(onRename) && bucket.editableKey != null

  React.useEffect(() => {
    setDraft(bucket.label ?? '')
    setEditing(false)
  }, [bucket.label])

  const commit = () => {
    if (bucket.editableKey) onRename?.(bucket.editableKey, draft)
    setEditing(false)
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-ink pl-2.5 pr-1.5',
        compact ? 'h-[26px]' : 'h-8',
        bucket.className,
      )}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') {
              setDraft(bucket.label ?? '')
              setEditing(false)
            }
          }}
          className="h-[19px] w-[94px] rounded-sm border-1 border-caution-strong bg-white px-1.5 text-[10px] font-bold text-ink outline-none"
        />
      ) : renameable ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Rename this band"
          className="inline-flex cursor-text items-center gap-1 whitespace-nowrap text-[10px] font-bold leading-none"
        >
          {bucket.label}
          <Icon name="edit" size={9} className="opacity-60" />
        </button>
      ) : (
        <span className="whitespace-nowrap text-[10px] font-bold leading-none">{bucket.label}</span>
      )}

      <span className="ml-auto" />
      {bucket.meta ? (
        <span className="fs-num text-[10px] font-medium">{bucket.meta}</span>
      ) : null}
      {canEdit && onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          title={`Add a player to ${bucket.label}`}
          className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-sm px-1.5 text-[10px] font-medium opacity-85 transition-opacity hover:opacity-100"
        >
          Add
          <Icon name="plus" size={10} />
        </button>
      ) : null}
    </div>
  )
}
