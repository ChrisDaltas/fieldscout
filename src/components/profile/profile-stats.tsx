'use client'

import { Award, ClipboardList, Target, TrendingUp, Vote } from 'lucide-react'

import { CredInfoPopover } from '@/components/stats/cred-info-popover'
import { Card, CardContent } from '@/components/ui/card'
import { computeCredRank } from '@/lib/cred-tiers'

interface ProfileStatsProps {
  credScore: number
  /** When true, the cred info popover renders next to the section heading. */
  showInfoPopover?: boolean
}

/**
 * Re-usable stats dashboard displayed on both the user's own /app/profile and
 * their public /u/[username] page. Built to read entirely from `profile`
 * fields the API already exposes — accuracy / submission counts wire up later.
 */
export function ProfileStats({ credScore, showInfoPopover }: ProfileStatsProps) {
  const rank = computeCredRank(credScore)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary">
          Rank progress
        </h2>
        {showInfoPopover && <CredInfoPopover />}
      </div>

      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Current rank
              </p>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="inline-flex h-3 w-3 rounded-full"
                  style={{ backgroundColor: rank.current.accent }}
                />
                <h3 className="text-2xl font-bold">{rank.current.name}</h3>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                Total cred
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                {credScore.toLocaleString()}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-xs text-text-secondary">
              <span>
                {rank.next ? (
                  <>
                    Next: <span className="text-foreground">{rank.next.name}</span>
                  </>
                ) : (
                  <span className="text-foreground">Top tier</span>
                )}
              </span>
              <span className="font-mono tabular-nums">
                {rank.next ? `${rank.toNext.toLocaleString()} to go` : 'GOAT'}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-elevated-3">
              <div
                className="h-full rounded-full bg-foreground transition-all"
                style={{ width: `${rank.progressPct}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<Target className="h-4 w-4 text-text-secondary" />}
          label="Season accuracy"
          value="—"
          helper="Spearman correlation vs actuals"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-text-secondary" />}
          label="vs Consensus"
          value="—"
          helper="Average delta from the crowd"
        />
        <StatCard
          icon={<Award className="h-4 w-4 text-text-secondary" />}
          label="Best week"
          value="—"
          helper="Highest single-week accuracy"
        />
      </div>

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-tertiary">
          Activity breakdown
        </h3>
        <div className="grid gap-4 md:grid-cols-3">
          <ActivityCard
            icon={<ClipboardList className="h-4 w-4 text-text-secondary" />}
            label="Big Board updates"
            count={0}
            accuracy={null}
            credEarned={0}
          />
          <ActivityCard
            icon={<TrendingUp className="h-4 w-4 text-text-secondary" />}
            label="Weekly submissions"
            count={0}
            accuracy={null}
            credEarned={0}
          />
          <ActivityCard
            icon={<Vote className="h-4 w-4 text-text-secondary" />}
            label="Start or Sit votes"
            count={0}
            accuracy={null}
            credEarned={0}
          />
        </div>
      </section>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode
  label: string
  value: string
  helper: string
}) {
  return (
    <Card className="border-bg-elevated-2 bg-bg-elevated">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          {icon}
          <span className="font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <p className="font-mono text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-[10px] text-text-tertiary">{helper}</p>
      </CardContent>
    </Card>
  )
}

function ActivityCard({
  icon,
  label,
  count,
  accuracy,
  credEarned,
}: {
  icon: React.ReactNode
  label: string
  count: number
  accuracy: number | null
  credEarned: number
}) {
  return (
    <Card className="border-bg-elevated-2 bg-bg-elevated">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          {icon}
          <span className="font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Mini label="Count" value={count.toString()} />
          <Mini label="Accuracy" value={accuracy != null ? `${accuracy}%` : '—'} />
          <Mini label="Cred" value={credEarned.toString()} />
        </div>
      </CardContent>
    </Card>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-bg-elevated-2 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-text-tertiary">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}
