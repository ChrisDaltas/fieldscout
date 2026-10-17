'use client'

import { cn } from '@/lib/utils'

import { PathIcon } from './players-chrome'

/**
 * FieldScout Mobile — the Players tab's row and tile actions (spec m-players
 * §5 `actOf`): Add (green +), Claim (gold "W"), Drop (red −), Trade (blue ⇄).
 * The prototype only toasts; the app runs its real verbs with their rules.
 * The screen decides each door with the player card's own derivation
 * (`cardLeagueView`); a press opens the mobile profile's own move sheet
 * (`PlayerMoveSheet` — the same confirm, drop picker and bid step every
 * mobile surface uses) or the trade builder. A closed door is dimmed and
 * says why on tap instead of attempting the move.
 */

export type ActionKind = 'add' | 'claim' | 'drop' | 'trade'

const ACTION: Record<ActionKind, { bg: string; icon: string | null; tip: string; label: string }> = {
  add: { bg: 'bg-confirm', icon: 'M8 3.5v9M3.5 8h9', tip: 'Add', label: 'Add' },
  claim: { bg: 'bg-m-gold', icon: null, tip: 'Claim off waivers', label: 'Claim' },
  drop: { bg: 'bg-negative-strong', icon: 'M3.5 8h9', tip: 'Drop', label: 'Drop' },
  trade: { bg: 'bg-accent', icon: 'M3 5.5h9.5L10 3M13 10.5H3.5L6 13', tip: 'Propose trade', label: 'Trade' },
}

export interface ActionDoor {
  kind: ActionKind
  /** The accessible name — the verb and player, or why the door is shut. */
  label: string
  closed: boolean
  onPress: () => void
}

/** The 28px (List / Cards) or 22px (Sheet) action circle. */
export function ActionCircle({ door, size }: { door: ActionDoor; size: 28 | 22 }) {
  const a = ACTION[door.kind]
  return (
    <button
      type="button"
      onClick={door.onPress}
      title={a.tip}
      aria-label={door.label}
      aria-disabled={door.closed || undefined}
      className={cn('flex flex-none items-center justify-center rounded-full text-white', a.bg, size === 28 ? 'size-7' : 'size-[22px]', door.closed && 'opacity-40')}
      data-action={door.kind}
      data-closed={door.closed || undefined}
    >
      {a.icon ? (
        <PathIcon d={a.icon} size={size === 28 ? 13 : 11} stroke={2.4} />
      ) : (
        <span className={cn('font-bold leading-none', size === 28 ? 'text-[11px]' : 'text-[9px]')}>W</span>
      )}
    </button>
  )
}

/** The Trending tile's action pill (spec §2.2): 28px, 12/600, white on the
 *  verb's colour, labelled Add / Claim / Trade. */
export function ActionPill({ door }: { door: ActionDoor }) {
  const a = ACTION[door.kind]
  return (
    <button
      type="button"
      onClick={door.onPress}
      title={a.tip}
      aria-label={door.label}
      aria-disabled={door.closed || undefined}
      className={cn('flex h-7 flex-none items-center rounded-full px-3 text-[12px] font-semibold text-white', a.bg, door.closed && 'opacity-40')}
      data-action={door.kind}
      data-closed={door.closed || undefined}
    >
      {a.label}
    </button>
  )
}
