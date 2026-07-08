'use client'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import type { AiBuildJob } from '@/stores/ai-build-store'

interface AiBuildBannerProps {
  job: AiBuildJob
  onRetry: () => void
  onDismiss: () => void
}

/**
 * Narrates the live AI build on the List Detail page: scouting (the Claude
 * call), adding (players landing one by one), ordering (the sort pass), and
 * the error state with retry/dismiss. Scout AI surfaces are accent-blue.
 */
export function AiBuildBanner({ job, onRetry, onDismiss }: AiBuildBannerProps) {
  if (job.phase === 'error') {
    return (
      <div className="rounded-sm border border-negative-strong bg-negative-soft p-4">
        <p className="text-sm font-bold text-ink">
          {job.upgradeRequired ? 'FieldScout Pro required' : 'AI build hit a snag'}
        </p>
        <p className="mt-1 text-sm font-medium text-n-3">{job.error}</p>
        <div className="mt-3 flex gap-2">
          {!job.upgradeRequired && (
            <Button size="sm" variant="blue" onClick={onRetry}>
              Retry
            </Button>
          )}
          <Button size="sm" variant="stroke" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    )
  }

  const total = job.result?.players.length ?? job.request.player_count
  const addedCount = job.addedIds.length

  const { icon, headline, detail } =
    job.phase === 'adding'
      ? {
          icon: <Icon name="plus-circle" size={14} className="text-accent" />,
          headline: `Adding players… ${addedCount} of ${total}`,
          detail: 'Every pick lands with a note on why.',
        }
      : job.phase === 'ordering'
        ? {
            icon: <Icon name="sort" size={14} className="text-accent" />,
            headline: 'Putting the board in order…',
            detail: 'Sorting the room into a ranking.',
          }
        : {
            icon: (
              <Icon name="star" size={14} className="animate-pulse text-accent" />
            ),
            headline: 'Scouting players…',
            detail: 'FieldScout AI is working the film room — a few seconds.',
          }

  return (
    <div className="rounded-sm border border-accent bg-accent-soft p-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-bold text-ink">{headline}</p>
        {job.phase === 'adding' && total > 0 && (
          <p className="fs-num ml-auto text-[11px] font-bold text-n-3">
            {Math.round((addedCount / total) * 100)}%
          </p>
        )}
      </div>
      <p className="mt-1 text-xs font-medium text-n-3">{detail}</p>
      {job.phase === 'adding' && total > 0 && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-sm border border-ink bg-white">
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{ width: `${Math.round((addedCount / total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
