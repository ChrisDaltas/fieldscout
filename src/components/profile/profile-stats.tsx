'use client'

import { CredInfoPopover } from '@/components/stats/cred-info-popover'
import { Progress } from '@/components/ui/progress'
import { computeCredRank } from '@/lib/cred-tiers'
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
 * follower/following counts. Accuracy comparisons stay honest placeholders
 * until accuracy data lands — no fabricated bars (the v7 category bars render
 * as empty tracks).
 *
 * v7 Profile: grey stat tiles, then plain sections (14px bold titles, no
 * card chrome) laid side by side when there is room.
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

      <div className="flex flex-wrap gap-5">
        {/* Cred progress — thin pill bar, accent fill */}
        <section className="flex min-w-0 flex-[1_1_238px] flex-col gap-3">
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
            Earn cred with big board updates, weekly submissions, and start or
            sit votes. Accuracy bonuses stack on top.
          </p>
        </section>

        {/* Accuracy — honest placeholders until accuracy data exists */}
        <section className="flex min-w-0 flex-[1.4_1_306px] flex-col gap-3">
          <div className="flex min-h-btn-sm items-center justify-between gap-2">
            <div className="text-[14px] font-bold tracking-[-0.015em] text-ink">
              Ranking accuracy
            </div>
            <span className="text-[10px] font-semibold text-n-6">
              Tracks from week 1
            </span>
          </div>
          <AccuracyRow
            label="Season accuracy"
            helper="Spearman correlation vs actuals"
          />
          <AccuracyRow
            label="vs consensus"
            helper="Average delta from the crowd"
          />
          <AccuracyRow
            label="Best week"
            helper="Highest single-week accuracy"
          />
          <p className="text-[10px] font-medium text-n-6">
            The 2026 season hasn&apos;t kicked off yet — accuracy fills in as
            your rankings meet real results.
          </p>
        </section>
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  sub,
  tone,
  valueIsNum = true,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good'
  valueIsNum?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px] rounded-2xl bg-surface-sunken px-[15px] py-3.5">
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
    </div>
  )
}

function AccuracyRow({ label, helper }: { label: string; helper: string }) {
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="min-w-0 font-semibold text-ink">
          {label}{' '}
          <span className="font-medium text-n-6">· {helper}</span>
        </span>
        <span className="fs-num shrink-0 font-semibold text-n-6">—</span>
      </div>
      {/* Empty track — no fill until accuracy data exists. */}
      <div className="h-1 rounded-pill bg-surface-control" />
    </div>
  )
}
