import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { UserAvatar } from '@/components/ui/user-avatar'

interface ProfileListRowProps {
  username: string
  displayName: string | null
  avatarUrl: string | null
  bio: string | null
  credScore: number
  isPro: boolean
}

export function ProfileListRow({
  username,
  displayName,
  avatarUrl,
  bio,
  credScore,
  isPro,
}: ProfileListRowProps) {
  return (
    <Link
      href={`/u/${username}`}
      className="flex items-center gap-3 rounded-md border border-bg-elevated-2 bg-bg-elevated p-3 transition-colors hover:border-bg-elevated-3 hover:bg-bg-elevated-2"
    >
      <UserAvatar
        src={avatarUrl}
        name={displayName ?? username}
        className="h-10 w-10 shrink-0"
        fallbackClassName="text-xs"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">
            {displayName ?? `@${username}`}
          </p>
          {isPro && (
            <Badge
              variant="default"
              className="border-amber-300/40 bg-amber-300/10 text-[9px] font-semibold text-amber-300"
            >
              PRO
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-text-secondary">@{username}</p>
        {bio && (
          <p className="mt-1 line-clamp-1 text-xs text-text-tertiary">{bio}</p>
        )}
      </div>
      <span className="shrink-0 text-right text-xs">
        <span className="block text-[9px] uppercase tracking-wider text-text-tertiary">
          Cred
        </span>
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {credScore.toLocaleString()}
        </span>
      </span>
    </Link>
  )
}
