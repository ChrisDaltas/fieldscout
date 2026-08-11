'use client'

import * as React from 'react'

import { PositionBadge } from '@/components/players/position-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
      {entry.player.headshot_url ? (
        <AvatarImage src={entry.player.headshot_url} alt="" />
      ) : null}
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
  /** Card view has its own checkbox, so its menu omits "Mark drafted". */
  omitDrafted?: boolean
}

export function RowMenu({ actions, className }: { actions: RowMenuActions; className?: string }) {
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
        {!actions.omitDrafted && (
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
 * The grip dots. Rendered, not wired — drag-and-drop is its own task (LV.4) —
 * so it is inert decoration and says so to assistive tech.
 */
export function Grip({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('h-[14px] w-[9px] shrink-0 opacity-35', className)}
      style={{
        backgroundImage: 'radial-gradient(circle, currentColor 0.9px, transparent 0.9px)',
        backgroundSize: '4px 4px',
        backgroundPosition: '1px 2px',
      }}
    />
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
  onRename: (bandKey: string, label: string) => void
  onAdd: () => void
  compact?: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(bucket.label ?? '')
  const renameable = canEdit && bucket.editableKey != null

  React.useEffect(() => {
    setDraft(bucket.label ?? '')
    setEditing(false)
  }, [bucket.label])

  const commit = () => {
    if (bucket.editableKey) onRename(bucket.editableKey, draft)
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
      {canEdit ? (
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
