import Link from 'next/link'

import { PositionBadge } from '@/components/players/position-badge'
import { Icon } from '@/components/ui/icon'
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
      className="block rounded-sm border border-ink bg-white p-4 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4"
    >
      <div className="flex items-start gap-3">
        <UserAvatar
          src={owner.avatar_url}
          name={owner.display_name ?? owner.username}
          className="h-9 w-9 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-extrabold text-ink">{title}</h3>
            {positionFilter && (
              <PositionBadge
                position={positionFilter === 'DEF' ? 'DST' : positionFilter}
              />
            )}
          </div>
          {description && (
            <p className="mt-0.5 line-clamp-2 text-xs font-medium text-n-3">
              {description}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2.5 text-[11px] font-semibold text-n-3">
            <span className="truncate">
              {owner.display_name ?? `@${owner.username}`}
            </span>
            <span>·</span>
            <span className="fs-num whitespace-nowrap">{playerCount} players</span>
            <span>·</span>
            <span className="fs-num inline-flex items-center gap-1 whitespace-nowrap">
              <Icon name="like" size={10} />
              {likeCount}
            </span>
            <span>·</span>
            <span className="whitespace-nowrap">{formatRelative(updatedAt)}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
