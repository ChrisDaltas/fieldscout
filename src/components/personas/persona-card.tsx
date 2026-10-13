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
 * v7 card (hairline, no resting shadow), round avatar and the AI badge;
 * it is a link, so it lifts softly on hover.
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
      className="block h-full rounded-2xl border border-n-4 bg-white p-[15px] transition-shadow hover:shadow-hard-4"
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
            <span className="truncate text-[13px] font-bold tracking-[-0.01em] text-ink">
              {displayName}
            </span>
            <PersonaBadge />
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-[1.45] text-n-3">
            {bio}
          </p>
          {typeof listCount === 'number' && (
            <p className="fs-num mt-2 text-[10px] font-semibold text-n-6">
              {listCount} {listCount === 1 ? 'list' : 'lists'}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
