import Link from 'next/link'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { PositionBadge } from '@/components/players/position-badge'
import { cn } from '@/lib/utils'

import { initialsOf, type MockInjuryStatus, type MockLineupPlayer } from './league-mock-data'

/**
 * Small display cells shared across the league workspace tabs. Mock-data UI
 * only — crests and headshots render as initials tiles until the league
 * backend supplies real art.
 *
 * TODO(live-draft): crest/headshot images arrive with real league data.
 */

interface CrestProps {
  name: string
  /** Uploaded crest art (leagues.avatar_url, migration 064); initials fallback. */
  src?: string | null
  className?: string
  fallbackClassName?: string
}

/** Square team/league crest — uploaded art when present, else initials on the
 *  sunken fill (base Avatar). */
export function Crest({ name, src, className, fallbackClassName }: CrestProps) {
  return (
    <Avatar className={cn('h-6 w-6 shrink-0', className)}>
      {src && <AvatarImage src={src} alt={name} className="object-cover" />}
      <AvatarFallback className={cn('text-[9px]', fallbackClassName)}>
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * Where a franchise's own page lives — §16.1 `…/leagues/[id]/team/[teamId]`.
 * ONE copy of the URL (the `mock-launcher-entry.ts` seam idiom): every door to
 * a team page is built here, so the app cannot grow a second spelling of it.
 */
export function teamPageHref(leagueId: string, teamId: string): string {
  return `/app/leagues/${leagueId}/team/${teamId}`
}

interface TeamNameLinkProps {
  /** The visible text AND the link's accessible name — the franchise. */
  name: string
  leagueId: string
  /**
   * `null` / `undefined` ⇒ plain, non-interactive text: an open seat, a bye,
   * an unrecorded champion. A name that resolves to no franchise gets no
   * door — a dead anchor that looks clickable is exactly the failure this
   * primitive exists to avoid (CLAUDE.md: never let "nothing happened" mean
   * "it worked"). Same shape as `lists/v2/list-row-parts.tsx`'s name, which
   * is a plain `<span>` when it has nowhere to go.
   */
  teamId?: string | null
  /**
   * The call site's own typography and layout (`min-w-0 flex-1 truncate`,
   * its size and weight, its own accent colour). The primitive contributes
   * ONLY the link treatment — no colour, no weight — so it cannot fight the
   * viewer's own-team `text-accent-strong` or a bracket winner's weight, and
   * it drops into an existing name element without moving anything.
   */
  className?: string
}

/**
 * A team name as a door to that team's page — the shared primitive for the
 * F322/C65 shape ("the server has the verb, the UI has no door"): `set_lineup`
 * has accepted a commissioner acting for another franchise since migration
 * 114 (§16.1), and until this existed nothing in the app linked to any team
 * but the viewer's own.
 *
 * The treatment is the house inline-link convention (`list-detail-hero.tsx`,
 * `list-comments-tab.tsx`, `list-row-parts.tsx`): the underline is RESERVED at
 * rest with `decoration-transparent` and painted on hover, so hovering is a
 * paint-only change and can never reflow a narrow table cell or push a grid
 * into horizontal scroll. No shadow — this is text in normal page flow, and
 * elevation is a hover affordance for things that float (CLAUDE.md).
 */
export function TeamNameLink({ name, leagueId, teamId, className }: TeamNameLinkProps) {
  if (!teamId) return <span className={className}>{name}</span>
  return (
    <Link
      href={teamPageHref(leagueId, teamId)}
      data-team-link={teamId}
      className={cn(
        'underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent',
        className,
      )}
    >
      {name}
    </Link>
  )
}

interface TeamCellProps {
  team: string
  sub?: React.ReactNode
  crestClassName?: string
  className?: string
  /** With `teamId`, the name becomes a door to that team's page — the SAME
   *  `TeamNameLink` the row-level call sites use, so the linked/unlinked
   *  decision and its treatment live in one place. */
  leagueId?: string
  teamId?: string | null
}

/** Crest + bold team name (+ optional muted sub line). */
export function TeamCell({ team, sub, crestClassName, className, leagueId, teamId }: TeamCellProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <Crest name={team} className={crestClassName} />
      <div className="min-w-0">
        <div className="truncate text-[11px] font-extrabold leading-tight">
          {leagueId ? <TeamNameLink name={team} leagueId={leagueId} teamId={teamId} /> : team}
        </div>
        {sub && (
          <div className="truncate text-[10px] font-semibold leading-tight text-n-3">
            {sub}
          </div>
        )}
      </div>
    </div>
  )
}

/** Injury designation tag — Q/D caution, Out negative. */
export function StatusTag({ status }: { status: MockInjuryStatus }) {
  if (!status) return null
  const variant = status === 'O' ? 'pink' : 'yellow'
  const label = status === 'O' ? 'Out' : status
  return (
    <Badge
      variant={variant}
      className="ml-1.5 h-[15px] px-1.5 text-[9px] leading-none"
    >
      {label}
    </Badge>
  )
}

interface PlayerCellProps {
  player: MockLineupPlayer
  /** Extra meta after the team code (defaults to team only). */
  meta?: React.ReactNode
  /** Right-align the cell (opponent side of the Matchup tab). */
  mirror?: boolean
  className?: string
}

/** Headshot tile + name + status + position badge + muted meta. */
export function PlayerCell({ player, meta, mirror, className }: PlayerCellProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-2',
        mirror && 'flex-row-reverse',
        className,
      )}
    >
      <Avatar className="h-7 w-7 shrink-0">
        <AvatarFallback className="text-[9px]">
          {initialsOf(player.name)}
        </AvatarFallback>
      </Avatar>
      <div className={cn('min-w-0', mirror && 'text-right')}>
        <div className="truncate text-[11px] font-extrabold leading-tight">
          {player.name}
          <StatusTag status={player.status} />
        </div>
        <div
          className={cn(
            'mt-0.5 flex items-center gap-1.5',
            mirror && 'justify-end',
          )}
        >
          <PositionBadge position={player.pos} size="sm" className="shrink-0" />
          <span className="truncate text-[10px] font-semibold text-n-3">
            {meta ?? player.team}
          </span>
        </div>
      </div>
    </div>
  )
}

interface WinProbMeterProps {
  /** Left side's win probability, 0–100. */
  value: number
  /** Dashed center tick marking even odds (Matchup tab). */
  showTick?: boolean
  className?: string
}

/** Accent win-probability meter on the system progress track. */
export function WinProbMeter({ value, showTick, className }: WinProbMeterProps) {
  return (
    <div className={cn('relative', className)}>
      <Progress value={value} className="h-2" />
      {showTick && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-1/2 border-l border-dashed border-n-3"
        />
      )}
    </div>
  )
}

/** Opponent positional rank chip — low = tough (negative), high = soft
 *  (positive), middle = caution. Dark text on all three fills. */
export function OprkChip({ value }: { value: number }) {
  const tone =
    value <= 8 ? 'bg-negative' : value >= 24 ? 'bg-positive' : 'bg-caution'
  return (
    <span
      className={cn(
        'fs-num inline-flex h-[18px] min-w-[21px] items-center justify-center rounded-sm px-1.5 text-[10px] font-bold',
        tone,
      )}
    >
      {value}
    </span>
  )
}
