'use client'

import { FollowButton } from '@/components/explore/follow-button'
import { UsernameLink } from '@/components/shared/username-link'
import { Badge } from '@/components/ui/badge'
import { UserAvatar } from '@/components/ui/user-avatar'

interface ProfileListRowProps {
  /** Profile id — drives the follow control. */
  userId: string
  username: string
  avatarUrl: string | null
  bio: string | null
  credScore: number
  isPro: boolean
}

/**
 * Flush person row for follower/following lists — round avatar, bold handle,
 * bio meta, mono cred, and a follow control. The handle is a stretched link
 * (after:inset-0) so the whole row navigates while the follow button stays a
 * real sibling button — no button-inside-anchor nesting.
 */
export function ProfileListRow({
  userId,
  username,
  avatarUrl,
  bio,
  credScore,
  isPro,
}: ProfileListRowProps) {
  return (
    <div className="relative flex items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-surface-sunken">
      <UserAvatar
        src={avatarUrl}
        name={username}
        className="h-8 w-8 shrink-0"
        fallbackClassName="text-[10px]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <UsernameLink
            username={username}
            className="truncate text-[12px] font-semibold leading-tight text-ink after:absolute after:inset-0"
          />
          {isPro && <Badge variant="accent">Pro</Badge>}
        </div>
        {bio && (
          <p className="mt-0.5 truncate text-[10px] font-medium text-n-6">
            {bio}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right leading-tight">
        <span className="fs-num block text-[12px] font-bold text-ink">
          {credScore.toLocaleString()}
        </span>
        <span className="text-[9px] font-semibold text-n-6">Cred</span>
      </div>
      <FollowButton userId={userId} className="relative z-10 shrink-0" />
    </div>
  )
}
