import Link from 'next/link'

import { PersonaBadge } from '@/components/personas/persona-badge'
import { UserAvatar } from '@/components/ui/user-avatar'

interface PersonaCardProps {
  username: string
  displayName: string
  bio: string
  avatarUrl?: string | null
  listCount?: number
}

/**
 * Profile card for explore/feed surfaces. Links to the public persona page.
 * White card, ink border, round robot avatar, stroke AI badge; lifts onto a
 * hard shadow on hover like the other clickable cards.
 */
export function PersonaCard({
  username,
  displayName,
  bio,
  avatarUrl,
  listCount,
}: PersonaCardProps) {
  return (
    <Link
      href={`/personas/${username}`}
      className="block h-full rounded-sm border border-ink bg-white p-card-pad transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-hard-4"
    >
      <div className="flex items-start gap-3">
        <UserAvatar
          src={avatarUrl ?? undefined}
          alt={displayName}
          name={displayName}
          className="h-10 w-10 shrink-0"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-extrabold text-ink">
              {displayName}
            </span>
            <PersonaBadge />
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] font-medium text-n-3">
            {bio}
          </p>
          {typeof listCount === 'number' && (
            <p className="fs-num mt-2 text-[11px] font-semibold text-n-3">
              {listCount} {listCount === 1 ? 'list' : 'lists'}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
