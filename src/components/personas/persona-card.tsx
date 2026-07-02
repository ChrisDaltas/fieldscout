import Link from 'next/link'

import { PersonaBadge } from '@/components/personas/persona-badge'
import { Card, CardContent } from '@/components/ui/card'
import { UserAvatar } from '@/components/ui/user-avatar'

interface PersonaCardProps {
  username: string
  displayName: string
  bio: string
  avatarUrl?: string | null
  listCount?: number
}

/** Profile card for explore/feed surfaces. Links to the public persona page. */
export function PersonaCard({
  username,
  displayName,
  bio,
  avatarUrl,
  listCount,
}: PersonaCardProps) {
  return (
    <Link href={`/personas/${username}`} className="block">
      <Card className="border-bg-elevated-2 bg-bg-elevated transition-colors hover:border-bg-elevated-3">
        <CardContent className="flex items-start gap-3 p-4">
          <UserAvatar
            src={avatarUrl ?? undefined}
            alt={displayName}
            name={displayName}
            className="h-10 w-10"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{displayName}</span>
              <PersonaBadge />
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{bio}</p>
            {typeof listCount === 'number' && (
              <p className="mt-2 text-xs text-text-tertiary">
                {listCount} {listCount === 1 ? 'list' : 'lists'}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
