'use client'

import { CredInfoPopover } from '@/components/stats/cred-info-popover'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
 * until accuracy data lands — no fabricated bars.
 */
export function ProfileStats({
  credScore,
  followerCount,
  followingCount,
  showInfoPopover,
}: ProfileStatsProps) {
  const rank = computeCredRank(credScore)

  return (
    <div className="space-y-[19px]">
      {/* Stat tiles — fs-overline labels, mono values */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      {/* Cred progress — hard-edged StatBar row (white track, ink border) */}
      <Card>
        <CardHeader>
          <CardTitle>Cred progress</CardTitle>
          {showInfoPopover && <CredInfoPopover />}
        </CardHeader>
        <CardContent>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-extrabold text-ink">
              {rank.next
                ? `Progress to ${rank.next.name}`
                : 'Top tier reached'}
            </span>
            <span className="fs-num text-[12px] font-bold text-n-3">
              {rank.next
                ? `${credScore.toLocaleString()} / ${rank.next.threshold.toLocaleString()}`
                : credScore.toLocaleString()}
            </span>
          </div>
          <Progress
            value={rank.progressPct}
            className="h-2"
            indicatorClassName={rank.next ? 'bg-accent' : 'bg-brand'}
          />
          <p className="mt-2 text-[11px] font-medium text-n-3">
            Earn cred with big board updates, weekly submissions, and start or
            sit votes. Accuracy bonuses stack on top.
          </p>
        </CardContent>
      </Card>

      {/* Accuracy — honest placeholders until accuracy data exists */}
      <Card>
        <CardHeader>
          <CardTitle>Ranking accuracy</CardTitle>
          <span className="fs-overline text-n-3">Tracks from week 1</span>
        </CardHeader>
        <div className="px-card-pad">
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
            last
          />
        </div>
        <div className="border-t border-n-4 px-card-pad py-2.5">
          <p className="text-[11px] font-medium text-n-3">
            The 2026 season hasn&apos;t kicked off yet — accuracy fills in as
            your rankings meet real results.
          </p>
        </div>
      </Card>
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
    <div className="rounded-sm border border-ink bg-white px-3.5 py-3">
      <div className="fs-overline text-n-3">{label}</div>
      <div
        className={cn(
          'mt-1 truncate text-[21px] font-extrabold leading-tight text-ink',
          valueIsNum && 'fs-num',
        )}
      >
        {value}
      </div>
      {sub && (
        <div
          className={cn(
            'mt-0.5 text-[10px] font-bold',
            tone === 'good' ? 'text-positive-strong' : 'text-n-3',
          )}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

function AccuracyRow({
  label,
  helper,
  last = false,
}: {
  label: string
  helper: string
  last?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 py-3',
        !last && 'border-b border-n-4',
      )}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-extrabold text-ink">{label}</div>
        <div className="text-[11px] font-medium text-n-3">{helper}</div>
      </div>
      <span className="fs-num shrink-0 text-[13px] font-bold text-n-3">—</span>
    </div>
  )
}
