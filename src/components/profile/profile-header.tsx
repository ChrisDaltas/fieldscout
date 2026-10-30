'use client'

import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { UserAvatar } from '@/components/ui/user-avatar'
import { computeCredRank } from '@/lib/cred-tiers'
import { PRO_UPSELL_ENABLED } from '@/lib/pro-upsell'

interface ProfileHeaderProps {
  username: string
  bio: string | null
  avatarUrl: string | null
  isPro: boolean
  credScore: number
  followerCount: number
  followingCount: number
  isOwn: boolean
}

/**
 * Profile header (v7 Profile) — no card: a 65px round avatar beside the
 * 26px handle + tier badge (and Pro, once the app offers Pro again), and an 11px grey meta line with linked
 * follower/following counts in tabular numerals.
 *
 * The handle is the only name a person renders under — FieldScout stores no
 * other name for them (ruling 2026-08-05).
 *
 * Heading semantics: the public /u/[username] page keeps the handle as the
 * page h1 (SEO); on /app/profile the shell PageHeader owns the page title,
 * so it demotes to h2.
 */
export function ProfileHeader({
  username,
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
    <header className="flex flex-wrap items-center gap-[15px]">
      <UserAvatar
        src={avatarUrl}
        name={username}
        className="h-[65px] w-[65px] shrink-0"
        fallbackClassName="text-[22px] font-bold"
      />

      <div className="flex min-w-0 flex-[1_1_204px] flex-col gap-[3px]">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="text-h2 text-ink">
            @{username}
          </Heading>
          <Badge variant="stroke" className="gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: rank.current.accent }}
            />
            {rank.current.name}
          </Badge>
          {/* No Pro badge while the app offers no Pro (`PRO_UPSELL_ENABLED`,
              plan C4 / readiness F8): a "Pro" on someone's name means nothing
              when every account gets everything. */}
          {PRO_UPSELL_ENABLED && isPro && <Badge variant="accent">Pro</Badge>}
        </div>

        <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-semibold text-n-3">
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
          <p className="mt-1 max-w-xl text-[12px] font-medium text-n-2">{bio}</p>
        )}

        {isOwn && (
          <p className="mt-1 text-[10px] font-medium text-n-6">
            This is what your public profile looks like — visitors also see
            your public lists.
          </p>
        )}
      </div>
    </header>
  )
}
