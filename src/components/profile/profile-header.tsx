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

/**
 * Profile hero card — white surface, ink border, resting hard shadow (the
 * package's Profile header card). Round person avatar left; name + tier/Pro
 * badges; meta line with linked follower/following counts in mono numerals.
 *
 * Heading semantics: the public /u/[username] page keeps the name as the
 * page h1 (SEO); on /app/profile the shell PageHeader owns the page title,
 * so the name demotes to h2.
 */
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
  const Heading = isOwn ? ('h2' as const) : ('h1' as const)

  return (
    <header className="flex flex-col gap-4 rounded-sm border border-ink bg-white p-card-pad shadow-hard-4 sm:flex-row sm:items-center sm:gap-[18px] sm:px-[18px] sm:py-4">
      <UserAvatar
        src={avatarUrl}
        name={displayName ?? username}
        className="h-16 w-16 shrink-0 sm:h-20 sm:w-20"
        fallbackClassName="text-lg"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <Heading className="text-h4 leading-tight text-ink">
            {displayName ?? `@${username}`}
          </Heading>
          <Badge variant="stroke" className="gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: rank.current.accent }}
            />
            {rank.current.name}
          </Badge>
          {isPro && <Badge variant="accent">Pro</Badge>}
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] font-bold text-n-3">
          <span>@{username}</span>
          <span aria-hidden>·</span>
          <Link
            href={`/u/${username}/followers`}
            className="transition-colors hover:text-ink hover:underline"
          >
            <span className="fs-num">{followerCount.toLocaleString()}</span>{' '}
            followers
          </Link>
          <span aria-hidden>·</span>
          <Link
            href={`/u/${username}/following`}
            className="transition-colors hover:text-ink hover:underline"
          >
            <span className="fs-num">{followingCount.toLocaleString()}</span>{' '}
            following
          </Link>
          <span aria-hidden>·</span>
          <span>
            <span className="fs-num">{credScore.toLocaleString()}</span> cred
          </span>
        </p>

        {bio && (
          <p className="mt-2 max-w-xl text-[13px] font-medium text-ink">{bio}</p>
        )}

        {isOwn && (
          <p className="mt-2 text-[11px] font-medium text-n-3">
            This is what your public profile looks like — visitors also see
            your public lists.
          </p>
        )}
      </div>
    </header>
  )
}
