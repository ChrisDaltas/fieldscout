'use client'

import { Award, ClipboardList, Target, TrendingUp, Vote } from 'lucide-react'

import { Card, CardContent } from '@/components/ui/card'
import { CredInfoPopover } from '@/components/stats/cred-info-popover'
import { useAuth } from '@/hooks/use-auth'
import { computeCredRank } from '@/lib/cred-tiers'

export function StatsDashboard() {
  const { profile } = useAuth()
  const totalCred = profile?.cred_score ?? 0
  const rankInfo = computeCredRank(totalCred)

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stats</h1>
        <CredInfoPopover />
      </header>

      <RankCard rank={rankInfo} totalCred={totalCred} />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<Target className="h-4 w-4 text-foreground" />}
          label="Season accuracy"
          value="—"
          helper="Spearman correlation vs actuals"
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-foreground" />}
          label="vs Consensus"
          value="—"
          helper="Average delta from the crowd"
        />
        <StatCard
          icon={<Award className="h-4 w-4 text-foreground" />}
          label="Best week"
          value="—"
          helper="Highest single-week accuracy"
        />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-tertiary">
          Activity breakdown
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <ActivityCard
            icon={<ClipboardList className="h-4 w-4 text-foreground" />}
            label="Big Board updates"
            count={0}
            accuracy={null}
            credEarned={0}
          />
          <ActivityCard
            icon={<TrendingUp className="h-4 w-4 text-foreground" />}
            label="Weekly submissions"
            count={0}
            accuracy={null}
            credEarned={0}
          />
          <ActivityCard
            icon={<Vote className="h-4 w-4 text-foreground" />}
            label="Start or Sit votes"
            count={0}
            accuracy={null}
            credEarned={0}
          />
        </div>
      </section>

      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="p-6 text-sm text-text-secondary">
          The 2026 season hasn&apos;t kicked off yet. As you submit weekly
          rankings, vote on Start or Sit, and update your Big Board, your cred
          and accuracy stats will populate here. The progress bar above shows
          how much cred you need to reach the next rank.
        </CardContent>
      </Card>
    </div>
  )
}

function RankCard({
  rank,
  totalCred,
}: {
  rank: ReturnType<typeof computeCredRank>
  totalCred: number
}) {
  return (
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
              <h2 className="text-2xl font-bold">{rank.current.name}</h2>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              Total cred
            </p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {totalCred.toLocaleString()}
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
                <span className="text-foreground">You&apos;re at the top tier</span>
              )}
            </span>
            <span className="font-mono tabular-nums">
              {rank.next
                ? `${rank.toNext.toLocaleString()} to go`
                : 'GOAT'}
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
