import Link from 'next/link'

import { PositionBadge } from '@/components/players/position-badge'
import { UsernameLink } from '@/components/shared/username-link'
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
    avatar_url: string | null
    /**
     * PUBLIC name shown before the handle — set only for AI personas, whose
     * parody name is brand copy ("Bathew Merry (AI)"). People have no such
     * field: a person renders as their handle alone (ruling 2026-08-05).
     */
    name?: string | null
  }
  /**
   * The owner's handle opens his profile (L.E1.41). Off where it would point
   * nowhere new — the owner's own profile page lists his own lists — or at
   * the wrong page (an AI persona's profile is `/personas/…`, not `/u/…`).
   */
  linkOwner?: boolean
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
  linkOwner = false,
}: PublicListCardProps) {
  // The whole card opens the list through its title's stretched hit area
  // (`after:inset-0`), so the owner's handle can be its own link above it —
  // never an anchor inside an anchor (L.E1.41).
  return (
    <div className="relative block rounded-sm border border-ink bg-white p-4 transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4">
      <div className="flex items-start gap-3">
        <UserAvatar
          src={owner.avatar_url}
          name={owner.name ?? owner.username}
          className="h-9 w-9 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-extrabold text-ink">
              <Link
                href={href}
                className="after:absolute after:inset-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              >
                {title}
              </Link>
            </h3>
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
              {owner.name ? `${owner.name} · ` : ''}
              {linkOwner && !owner.name ? (
                <UsernameLink username={owner.username} className="relative z-10" />
              ) : (
                `@${owner.username}`
              )}
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
    </div>
  )
}
