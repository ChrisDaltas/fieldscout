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

/**
 * Flush person row for follower/following lists — round avatar, bold name,
 * handle + bio meta, mono cred right. Rows sit inside a bordered card and
 * divide with n-4 rules; hover tints accent-soft like every data row.
 */
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
      className="flex items-center gap-3 px-card-pad py-2.5 transition-colors hover:bg-accent-soft"
    >
      <UserAvatar
        src={avatarUrl}
        name={displayName ?? username}
        className="h-9 w-9 shrink-0"
        fallbackClassName="text-[10px]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-[13px] font-extrabold leading-tight text-ink">
            {displayName ?? `@${username}`}
          </p>
          {isPro && <Badge variant="accent">Pro</Badge>}
        </div>
        <p className="mt-0.5 truncate text-[11px] font-semibold text-n-3">
          @{username}
          {bio ? ` · ${bio}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right leading-tight">
        <span className="fs-num block text-[13px] font-bold text-ink">
          {credScore.toLocaleString()}
        </span>
        <span className="fs-overline text-[9px] text-n-3">Cred</span>
      </div>
    </Link>
  )
}
