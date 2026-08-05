'use client'

import Link from 'next/link'

import { FollowButton } from '@/components/explore/follow-button'
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
    <div className="relative flex items-center gap-3 px-card-pad py-2.5 transition-colors hover:bg-accent-soft">
      <UserAvatar
        src={avatarUrl}
        name={username}
        className="h-9 w-9 shrink-0"
        fallbackClassName="text-[10px]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/u/${username}`}
            className="truncate text-[13px] font-extrabold leading-tight text-ink after:absolute after:inset-0"
          >
            @{username}
          </Link>
          {isPro && <Badge variant="accent">Pro</Badge>}
        </div>
        {bio && (
          <p className="mt-0.5 truncate text-[11px] font-semibold text-n-3">
            {bio}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right leading-tight">
        <span className="fs-num block text-[13px] font-bold text-ink">
          {credScore.toLocaleString()}
        </span>
        <span className="fs-overline text-[9px] text-n-3">Cred</span>
      </div>
      <FollowButton userId={userId} className="relative z-10 shrink-0" />
    </div>
  )
}
