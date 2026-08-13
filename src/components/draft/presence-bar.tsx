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
 * On-clock is a RESTING state, so it's carried by fill + border
 * (bg-accent-soft/border-accent), never a shadow (CLAUDE.md elevation rule);
 * online-ness is the dot's fill, plus text for color-independence (§16.3 AA).
 */
export function PresenceBar({ seats, className }: PresenceBarProps) {
  return (
    <div
      className={cn('flex gap-1.5 overflow-x-auto pb-0.5', className)}
      role="list"
      aria-label="Draft room presence"
    >
      {seats.map((seat) => (
        <div
          key={seat.teamId}
          role="listitem"
          className={cn(
            'flex h-chip shrink-0 items-center gap-1.5 rounded-sm border px-2 text-[11px] font-bold leading-none',
            seat.onClock
              ? 'border-accent bg-accent-soft text-ink'
              : 'border-ink bg-white text-ink',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-pill',
              seat.online ? 'bg-positive-strong' : 'border border-n-3 bg-transparent',
            )}
          />
          <span className="max-w-[128px] truncate">
            {seat.name}
            {seat.isMe ? ' (You)' : ''}
          </span>
          <span className="sr-only">{seat.online ? 'online' : 'offline'}</span>
          {seat.autopick && (
            <span className="fs-overline rounded-sm bg-caution-soft px-1 text-[9px] text-ink">
              Auto
            </span>
          )}
          {seat.onClock && <span className="fs-overline text-[9px] text-accent-strong">On clock</span>}
        </div>
      ))}
    </div>
  )
}
