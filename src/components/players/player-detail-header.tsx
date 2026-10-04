'use client'

import Link from 'next/link'

import { PositionBadge } from '@/components/players/position-badge'
import { PlayerAvatarImage } from '@/components/players/player-image'
import { identityParts } from '@/components/players/player-page-ops'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { PlayerStatsPlayer } from '@/hooks/use-player-stats'
import { getNflTeam } from '@/lib/nfl-teams'
import { cn } from '@/lib/utils'

interface PlayerDetailHeaderProps {
  player: PlayerStatsPlayer
  /** Larger headshot/type scale for the full page ('expanded'). */
  size?: 'compact' | 'expanded'
}

/** Status designation chip (Q / D / O / IR …) after the name, kit-style. */
const STATUS_CHIPS: Record<string, { label: string; tone: 'caution' | 'negative' }> = {
  Questionable: { label: 'Q', tone: 'caution' },
  Doubtful: { label: 'D', tone: 'caution' },
  Out: { label: 'O', tone: 'negative' },
  IR: { label: 'IR', tone: 'negative' },
  PUP: { label: 'PUP', tone: 'negative' },
  Suspended: { label: 'SUS', tone: 'negative' },
  injured: { label: 'IR', tone: 'negative' },
}

/**
 * Identity block for the full player page (D486(12)): headshot, name with
 * its status tag, then position badge · team · Bye Wk N, and age · height ·
 * weight on a smaller muted line. Every fact appears once on the page; a
 * part with no source is omitted.
 */
export function PlayerDetailHeader({
  player,
  size = 'expanded',
}: PlayerDetailHeaderProps) {
  const initials = player.full_name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const teamInfo = getNflTeam(player.team)
  const expanded = size === 'expanded'
  const status = player.status ? STATUS_CHIPS[player.status] : undefined

  // Identity line — only fields that exist in the payload.
  const parts = identityParts(player, new Date())

  // Injury context (Sleeper roster feed): "Hamstring · limited practice".
  const injuryParts: string[] = []
  if (player.injury_body_part) injuryParts.push(player.injury_body_part)
  if (player.practice_participation) {
    injuryParts.push(`${player.practice_participation.toLowerCase()} practice`)
  }
  const injuryDetail = injuryParts.join(' · ')

  return (
    <div className="min-w-0">
      <div className="flex items-start gap-4">
        {/* Headshot — large square tile on the ink border (kit Headshot 88px ×0.8) */}
        <Avatar
          className={cn('shrink-0', expanded ? 'h-[70px] w-[70px]' : 'h-12 w-12')}
        >
          <PlayerAvatarImage player={player} alt={player.full_name} />
          <AvatarFallback className={expanded ? 'text-[21px]' : 'text-[14px]'}>
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              'flex flex-wrap items-center gap-2',
              expanded ? 'text-h4' : 'text-h6',
            )}
          >
            <span className="min-w-0 break-words">{player.full_name}</span>
            {status && (
              <span
                title={player.injury_notes ?? undefined}
                className={cn(
                  'inline-flex shrink-0 items-center rounded-sm px-1.5 py-px text-[11px] font-extrabold leading-none',
                  status.tone === 'caution' ? 'bg-caution' : 'bg-negative',
                )}
              >
                {status.label}
                {injuryDetail && (
                  <span className="ml-1 font-bold normal-case opacity-80">
                    — {injuryDetail}
                  </span>
                )}
              </span>
            )}
          </h2>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1" data-player-identity>
            <PositionBadge position={player.position} size="md" />
            {player.team && (
              <Link
                href={`/app/nfl/${player.team}`}
                title={teamInfo ? `${teamInfo.city} ${teamInfo.name}` : player.team}
                className="text-[13px] font-bold text-ink transition-colors hover:text-accent"
              >
                {player.team}
              </Link>
            )}
            {parts.primary.map((p) => (
              <span key={p.key} className="flex items-center gap-2 text-[13px] font-bold text-ink" data-identity={p.key}>
                <span aria-hidden className="text-n-3">·</span>
                <span className="fs-num">{p.text}</span>
              </span>
            ))}
          </div>
          {parts.secondary.length > 0 && (
            <p className="fs-num mt-1 text-[11px] font-semibold text-n-3" data-player-vitals-line>
              {parts.secondary.map((p, i) => (
                <span key={p.key} data-identity={p.key}>
                  {i > 0 && ' · '}
                  {p.text}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
