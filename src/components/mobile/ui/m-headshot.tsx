'use client'

import { useState } from 'react'

import { getPlayerImageUrl, type PlayerImageSubject } from '@/lib/player-image'
import { NFL_TEAM_COLORS } from '@/lib/nfl-team-colors'
import { cn } from '@/lib/utils'

/**
 * Mobile headshot (handoff `FSHeadshot`): a circle with a 1px white gap and a
 * team-colour ring (2px at 32px and up, 1.5px below), the photo scaled 1.25
 * and nudged down so the face fills the circle, falling back to initials on
 * #EEEEF1. Team colours are data (the app's NFL team colour table).
 */
export function headshotInitials(name: string): string {
  const parts = name.replace(/ D\/ST$/, '').split(/[\s'-]+/).filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function MHeadshot({
  player,
  size = 34,
  className,
  ring = true,
}: {
  player: PlayerImageSubject & { full_name: string; team: string | null }
  size?: number
  className?: string
  ring?: boolean
}) {
  const src = getPlayerImageUrl(player)
  const [failed, setFailed] = useState<string | null>(null)
  const showImg = !!src && failed !== src
  const teamColor = player.team ? NFL_TEAM_COLORS[player.team]?.primary : undefined
  const rw = size >= 32 ? 2 : 1.5
  return (
    <span
      title={player.full_name}
      className={cn('relative inline-flex flex-none items-center justify-center overflow-hidden rounded-full bg-m-head-bg font-bold text-n-3', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        boxShadow: ring && teamColor ? `0 0 0 1px #fff, 0 0 0 ${1 + rw}px ${teamColor}` : 'inset 0 0 0 1px rgba(0,0,0,.04)',
      }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- small headshot; next/image adds nothing here
        <img
          src={src}
          alt={player.full_name}
          onError={() => setFailed(src)}
          className="absolute inset-0 size-full object-cover"
          style={{ objectPosition: '50% 15%', transform: 'scale(1.25) translateY(8%)' }}
        />
      ) : (
        headshotInitials(player.full_name)
      )}
    </span>
  )
}
