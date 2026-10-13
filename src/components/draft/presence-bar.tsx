import { cn } from '@/lib/utils'

export interface PresenceSeat {
  teamId: string
  /** Franchise name (teams.name — never an email, v2.9 identity rule). */
  name: string
  online: boolean
  onClock: boolean
  isMe: boolean
  /** §16.5.4 "autopick-on (draft seat)" badge (L.B3.3): the §8.4
   *  `is_autodraft` flag, or a no-user seat (E48's autopilot). */
  autopick?: boolean
}

interface PresenceBarProps {
  seats: PresenceSeat[]
  className?: string
}

/**
 * PresenceBar (§16.2) — who's in the room / on the clock, keyed by team.
 * Presentational: `useDraftRoom` owns the Presence join and hands the
 * online set down; this renders one chip per franchise in draft order.
 *
 * On-clock is a RESTING state, so it's carried by fill + text colour
 * (bg-accent-soft/text-accent-deep), never a shadow (CLAUDE.md elevation rule);
 * online-ness is the dot's fill, plus text for color-independence (§16.3 AA).
 */
export function PresenceBar({ seats, className }: PresenceBarProps) {
  return (
    // `relative` is load-bearing (DR.4, measured at 1280): the chips'
    // `sr-only` online/offline spans are `position: absolute`, and with no
    // positioned ancestor they anchor to the VIEWPORT — escaping this
    // container's overflow clip and extending document.scrollWidth (+63px
    // once the strip squeezes the chips into overflow), which grew the page
    // its own 15px scrollbars. Positioning the scroll container makes it
    // their containing block, so they clip and scroll with their chips.
    <div
      className={cn('relative flex gap-1.5 overflow-x-auto pb-0.5', className)}
      role="list"
      aria-label="Draft room presence"
    >
      {seats.map((seat) => (
        <div
          key={seat.teamId}
          role="listitem"
          className={cn(
            'flex h-btn-sm shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-[11px] font-semibold leading-none',
            seat.onClock
              ? 'bg-accent-soft text-accent-deep'
              : 'bg-surface-control text-ink',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-pill',
              seat.online ? 'bg-brand' : 'border border-n-7 bg-transparent',
            )}
          />
          <span className="max-w-[128px] truncate">
            {seat.name}
            {seat.isMe ? ' (You)' : ''}
          </span>
          <span className="sr-only">{seat.online ? 'online' : 'offline'}</span>
          {seat.autopick && (
            <span className="rounded-sm bg-caution-soft px-1 py-0.5 text-[9px] font-bold text-caution-strong">
              Auto
            </span>
          )}
          {seat.onClock && <span className="text-[10px] font-semibold text-accent-deep">On clock</span>}
        </div>
      ))}
    </div>
  )
}
