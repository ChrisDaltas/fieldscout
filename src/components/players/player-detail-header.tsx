'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'

import { PositionBadge } from '@/components/players/position-badge'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import { darkTeamPrimary, teamTintBackground } from '@/lib/nfl-team-colors'
import { getNflTeam } from '@/lib/nfl-teams'
import { cn } from '@/lib/utils'

interface PlayerDetailHeaderProps {
  player: PlayerStatsPlayer
  /** Larger headshot/type scale for the expanded modal and the full page. */
  size?: 'compact' | 'expanded'
}

/**
 * Identity band shared by the player modal (both disclosure levels) and the
 * full player page. Figma node 473:74 — square rounded headshot tile on a
 * team-tinted gradient, name, badge pills, then a "team · seasons · age"
 * meta line. The team pill links to the NFL team detail page.
 */
export function PlayerDetailHeader({
  player,
  size = 'compact',
}: PlayerDetailHeaderProps) {
  const initials = player.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')

  const teamInfo = getNflTeam(player.team)
  const expanded = size === 'expanded'
  const age = formatAge(player.birth_date)
  const seasons =
    player.experience_years > 0
      ? `${player.experience_years} season${player.experience_years === 1 ? '' : 's'}`
      : 'Rookie'

  return (
    <div className="flex items-start gap-4 p-4 sm:p-6">
      {/* Headshot tile — rounded square on a team-color tint (Figma tile-001) */}
      <div
        className={cn(
          'flex shrink-0 items-end justify-center overflow-hidden rounded-xl',
          expanded ? 'h-28 w-28' : 'h-20 w-20',
        )}
        style={{
          background: `linear-gradient(180deg, ${teamTintBackground(player.team, 0.55)}, ${teamTintBackground(player.team, 0.25)})`,
          boxShadow: `inset 0 0 0 1px ${darkTeamPrimary(player.team)}`,
        }}
      >
        {player.headshot_url ? (
          <img
            src={player.headshot_url}
            alt={player.full_name}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-lg font-bold text-foreground">
            {initials}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        <h2
          className={cn(
            'font-bold leading-tight',
            expanded ? 'text-3xl' : 'text-2xl',
          )}
        >
          {player.full_name}
        </h2>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <PositionBadge position={player.position} size="md" />
          {player.team && (
            <Link
              href={`/app/nfl/${player.team}`}
              title={teamInfo ? `${teamInfo.city} ${teamInfo.name}` : player.team}
              className="inline-flex h-6 items-center rounded-full bg-bg-elevated-3 px-2.5 text-xs font-bold tracking-wide text-foreground transition-colors hover:bg-bg-elevated-2"
            >
              {player.team}
            </Link>
          )}
          {isInjuryStatus(player.status) && (
            <span className="inline-flex h-6 items-center rounded-full bg-destructive/20 px-2.5 text-xs font-bold text-destructive">
              {player.status}
            </span>
          )}
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs font-medium tracking-wide text-text-secondary">
          {teamInfo && (
            <>
              <span>{teamInfo.city}</span>
              <span>·</span>
            </>
          )}
          <span>{seasons}</span>
          {age && (
            <>
              <span>·</span>
              <span>{age} yo</span>
            </>
          )}
          {player.bye_week != null && (
            <>
              <span>·</span>
              <span>Bye {player.bye_week}</span>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

const INJURY_STATUSES = new Set([
  'Questionable',
  'Doubtful',
  'Out',
  'IR',
  'PUP',
  'Suspended',
  'injured',
])

function isInjuryStatus(status: string | null): boolean {
  return Boolean(status) && (INJURY_STATUSES.has(status!) || status!.toLowerCase().includes('injur'))
}

/** Decimal age, e.g. "30.1" — matches the reference design's "30.1 yo". */
function formatAge(birthDate: string | null): string | null {
  if (!birthDate) return null
  const born = new Date(birthDate).getTime()
  if (Number.isNaN(born)) return null
  const years = (Date.now() - born) / (365.25 * 24 * 60 * 60 * 1000)
  return years > 0 ? years.toFixed(1) : null
}
