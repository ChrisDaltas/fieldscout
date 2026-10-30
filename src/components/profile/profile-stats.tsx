'use client'

import Link from 'next/link'

import { CredInfoPopover } from '@/components/stats/cred-info-popover'
import { Progress } from '@/components/ui/progress'
import { CRED_START, computeCredRank } from '@/lib/cred-tiers'
import { cn } from '@/lib/utils'

interface ProfileStatsProps {
  credScore: number
  followerCount: number
  followingCount: number
  /** When true, the cred info popover renders in the progress card head. */
  showInfoPopover?: boolean
}

/**
 * Stats block shared by /app/profile ("My stats") and the public
 * /u/[username] page. Reads entirely from profile fields the API already
 * exposes: cred score (+ tier progress from lib/cred-tiers) and
 * follower/following counts.
 *
 * Left out: v7's "Ranking accuracy" section. Nothing grades rankings yet
 * (gap list §2 — "Profile shows Cred score until grading exists"), and v7
 * features with no backend are left out, not stubbed (CLAUDE.md). It comes
 * back with real numbers when grading does.
 *
 * The cred copy says only what is true today: every account starts at
 * `CRED_START` (migration 197) and nothing awards cred yet — no table,
 * function or script writes `profiles.cred_score` beyond 197's backfill, and
 * the surfaces the old copy named (big board, weekly ranks, start or sit) are
 * switched off at launch. Name a way to earn cred here only once it exists.
 *
 * v7 Profile: grey stat tiles, then a plain section (14px bold title, no
 * card chrome).
 */
export function ProfileStats({
  credScore,
  followerCount,
  followingCount,
  showInfoPopover,
}: ProfileStatsProps) {
  const rank = computeCredRank(credScore)

  return (
    <div className="flex flex-col gap-6">
      {/* Stat tiles — v7 grey tiles: 10px label over a 20px bold value */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile
          label="Cred score"
          value={credScore.toLocaleString()}
          sub={
            rank.next
              ? `${rank.toNext.toLocaleString()} to ${rank.next.name}`
              : 'Top tier'
          }
          tone={rank.next ? undefined : 'good'}
        />
        <StatTile
          label="Scout tier"
          value={rank.current.name}
          sub={`Tier ${rank.current.level} of 10`}
          valueIsNum={false}
        />
        <StatTile label="Followers" value={followerCount.toLocaleString()} />
        <StatTile label="Following" value={followingCount.toLocaleString()} />
      </div>

      {/* Cred progress — thin pill bar, accent fill */}
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex min-h-btn-sm items-center justify-between gap-2">
          <div className="text-[14px] font-bold tracking-[-0.015em] text-ink">
            Cred progress
          </div>
          {showInfoPopover && <CredInfoPopover />}
        </div>
        <div className="flex flex-col gap-[5px]">
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="font-semibold text-ink">
              {rank.next
                ? `Progress to ${rank.next.name}`
                : 'Top tier reached'}
            </span>
            <span className="fs-num font-semibold text-n-6">
              {rank.next
                ? `${credScore.toLocaleString()} / ${rank.next.threshold.toLocaleString()}`
                : credScore.toLocaleString()}
            </span>
          </div>
          <Progress
            value={rank.progressPct}
            className="h-1 bg-surface-control"
            indicatorClassName={rank.next ? 'bg-accent' : 'bg-brand'}
          />
        </div>
        <p className="text-[10px] font-medium text-n-6">
          Everyone starts with {CRED_START} cred. Ways to earn more cred
          aren&apos;t live yet.
        </p>
      </section>
    </div>
  )
}

/**
 * One v7 grey stat tile: a 10px label over a 20px bold value, and an
 * optional 10px sub line. Shared by the profile's tiles (My stats, the
 * public page, the profile inside the app).
 *
 * With `href` the tile is a link (the in-app profile's Followers /
 * Following open those lists): the grey deepens under the pointer and while
 * pressed, as v7's grey buttons do. Nothing lifts at rest (CLAUDE.md,
 * elevation).
 */
export function StatTile({
  label,
  value,
  sub,
  tone,
  valueIsNum = true,
  href,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good'
  valueIsNum?: boolean
  href?: string
}) {
  const body = (
    <>
      <div className="text-[10px] font-semibold text-n-3">{label}</div>
      <div
        className={cn(
          'truncate text-[20px] font-bold leading-tight tracking-[-0.02em] text-ink',
          valueIsNum && 'fs-num',
        )}
      >
        {value}
      </div>
      {sub && (
        <div
          className={cn(
            'text-[10px] font-semibold',
            tone === 'good' ? 'text-positive-strong' : 'text-n-6',
          )}
        >
          {sub}
        </div>
      )}
    </>
  )
  const tile = 'flex min-w-0 flex-col gap-[3px] rounded-2xl bg-surface-sunken px-[15px] py-3.5'
  if (href) {
    return (
      <Link
        href={href}
        data-stat-link={label}
        className={cn(
          tile,
          'transition-colors hover:bg-surface-hover active:bg-surface-pressed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        )}
      >
        {body}
      </Link>
    )
  }
  return <div className={tile}>{body}</div>
}
