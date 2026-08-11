'use client'

import Link from 'next/link'

import { PositionBadge } from '@/components/players/position-badge'
import { PlayerAvatarImage } from '@/components/players/player-image'
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
 * Identity block for the full player page (Field Scout reskin of the kit's
 * PlayerPage hero): large square ink-stroked headshot tile, h2 name with a
 * status chip, meta line (position badge, team, height · weight · bye), then
 * the vitals grid. Pos-rank / auction / SOS aren't in the stats payload yet,
 * so the meta line omits them and the vitals grid shows "—".
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

  // Meta line — only fields that exist in the payload.
  const metaParts: string[] = []
  const height = formatHeight(player.height)
  if (height !== '—') metaParts.push(height)
  if (player.weight != null) metaParts.push(`${player.weight} lb`)
  if (player.bye_week != null) metaParts.push(`Bye ${player.bye_week}`)

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

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
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
            {metaParts.length > 0 && (
              <span className="fs-num text-[12px] font-semibold text-n-3">
                {metaParts.join(' · ')}
              </span>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 max-w-[448px]">
          <VitalsGrid player={player} />
        </div>
      )}
    </div>
  )
}

/**
 * Hairline-celled 4×2 vitals grid (kit VitalsGrid). Auction $ / Pos rank
 * aren't synced yet — "—" rather than fabricating values client-side.
 */
function VitalsGrid({ player }: { player: PlayerStatsPlayer }) {
  const cells: Array<[string, string]> = [
    ['ADP', formatAdp(player.adp)],
    ['Auction $', player.auction_value != null ? `$${player.auction_value}` : '—'],
    // Objective rank only exists once real points are scored — returns in-season.
    ['Pos rank', '—'],
    ['SOS', player.sos != null ? `${player.sos} of 32` : '—'],
    ['Height', formatHeight(player.height)],
    ['Weight', player.weight != null ? `${player.weight} lb` : '—'],
    ['Age', formatAge(player.birth_date)],
    ['Seasons', String(player.experience_years)],
  ]

  return (
    <div className="grid grid-cols-2 border-l border-t border-n-4 sm:grid-cols-4">
      {cells.map(([label, value]) => (
        <div key={label} className="border-b border-r border-n-4 px-2.5 py-1.5">
          <p className="fs-overline truncate leading-tight text-n-3">{label}</p>
          <p className="fs-num mt-0.5 truncate text-[13px] font-extrabold leading-tight">
            {value}
          </p>
        </div>
      ))}
    </div>
  )
}

function formatAdp(adp: number | null): string {
  if (adp == null) return '—'
  const n = Number(adp)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** The sync stores height as total inches in a string (e.g. "74" → 6'2"). */
function formatHeight(height: string | null): string {
  if (!height) return '—'
  const inches = Number(height)
  if (!Number.isFinite(inches) || inches <= 0) return height
  return `${Math.floor(inches / 12)}'${inches % 12}"`
}

function formatAge(birthDate: string | null): string {
  if (!birthDate) return '—'
  const born = new Date(birthDate)
  if (Number.isNaN(born.getTime())) return '—'
  const now = new Date()
  let age = now.getFullYear() - born.getFullYear()
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
  if (beforeBirthday) age -= 1
  return age > 0 ? String(age) : '—'
}
