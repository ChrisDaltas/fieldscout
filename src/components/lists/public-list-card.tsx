import Link from 'next/link'
import { Heart } from 'lucide-react'

import { PositionBadge } from '@/components/players/position-badge'
import { UserAvatar } from '@/components/ui/user-avatar'

interface PublicListCardProps {
  href: string
  title: string
  description: string | null
  positionFilter: string | null
  playerCount: number
  likeCount: number
  updatedAt: string
  owner: {
    username: string
    display_name: string | null
    avatar_url: string | null
  }
}

function formatRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days < 1) return 'today'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

export function PublicListCard({
  href,
  title,
  description,
  positionFilter,
  playerCount,
  likeCount,
  updatedAt,
  owner,
}: PublicListCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-bg-elevated-2 bg-bg-elevated p-4 transition-colors hover:border-bg-elevated-3 hover:bg-bg-elevated-2"
    >
      <div className="flex items-start gap-3">
        <UserAvatar
          src={owner.avatar_url}
          name={owner.display_name ?? owner.username}
          className="h-9 w-9 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            {positionFilter && <PositionBadge position={positionFilter} />}
          </div>
          {description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">
              {description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-text-secondary">
            <span>{owner.display_name ?? `@${owner.username}`}</span>
            <span>·</span>
            <span className="tabular-nums">{playerCount} players</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Heart className="h-3 w-3" />
              {likeCount}
            </span>
            <span>·</span>
            <span>{formatRelative(updatedAt)}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
