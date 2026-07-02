'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { UserAvatar } from '@/components/ui/user-avatar'
import { computeCredRank } from '@/lib/cred-tiers'

interface ProfileHeaderProps {
  username: string
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  isPro: boolean
  credScore: number
  followerCount: number
  followingCount: number
  isOwn: boolean
}

export function ProfileHeader({
  username,
  displayName,
  bio,
  avatarUrl,
  isPro,
  credScore,
  followerCount,
  followingCount,
  isOwn,
}: ProfileHeaderProps) {
  const rank = computeCredRank(credScore)

  return (
    <header className="flex flex-col gap-4 border-b border-bg-elevated-2 pb-6 sm:flex-row sm:items-center">
      <UserAvatar
        src={avatarUrl}
        name={displayName ?? username}
        className="h-20 w-20 shrink-0 sm:h-24 sm:w-24"
        fallbackClassName="text-lg"
      />

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold leading-tight">
            {displayName ?? `@${username}`}
          </h1>
          {isPro && (
            <Badge
              variant="default"
              className="border-amber-300/40 bg-amber-300/10 text-[10px] font-semibold text-amber-300"
            >
              PRO
            </Badge>
          )}
          <Badge
            variant="default"
            className="border-bg-elevated-3 text-[10px] text-text-secondary"
          >
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: rank.current.accent }}
            />
            {rank.current.name}
          </Badge>
        </div>

        <p className="text-sm text-text-secondary">@{username}</p>

        {bio && (
          <p className="max-w-xl text-sm text-foreground">{bio}</p>
        )}

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link
            href={`/u/${username}/following`}
            className="text-text-secondary transition-colors hover:text-foreground"
          >
            <span className="font-mono font-bold tabular-nums text-foreground">
              {followingCount.toLocaleString()}
            </span>{' '}
            Following
          </Link>
          <Link
            href={`/u/${username}/followers`}
            className="text-text-secondary transition-colors hover:text-foreground"
          >
            <span className="font-mono font-bold tabular-nums text-foreground">
              {followerCount.toLocaleString()}
            </span>{' '}
            Followers
          </Link>
          <span className="text-text-secondary">
            <span className="font-mono font-bold tabular-nums text-foreground">
              {credScore.toLocaleString()}
            </span>{' '}
            Cred
          </span>
        </div>

        {isOwn && (
          <p className="text-[10px] text-text-tertiary">
            This is what your public profile looks like — visitors also see
            your public lists.
          </p>
        )}
      </div>
    </header>
  )
}
