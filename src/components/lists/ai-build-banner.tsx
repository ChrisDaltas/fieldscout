'use client'

import { ArrowDownUp, Loader2, Sparkles, UserRoundPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { AiBuildJob } from '@/stores/ai-build-store'

interface AiBuildBannerProps {
  job: AiBuildJob
  onRetry: () => void
  onDismiss: () => void
}

/**
 * Narrates the live AI build on the List Detail page: scouting (the Claude
 * call), adding (players landing one by one), ordering (the sort pass), and
 * the error state with retry/dismiss.
 */
export function AiBuildBanner({ job, onRetry, onDismiss }: AiBuildBannerProps) {
  if (job.phase === 'error') {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <p className="text-sm font-semibold text-destructive">
          {job.upgradeRequired ? 'FieldScout Pro required' : 'AI build hit a snag'}
        </p>
        <p className="mt-1 text-sm text-text-secondary">{job.error}</p>
        <div className="mt-3 flex gap-2">
          {!job.upgradeRequired && (
            <Button size="sm" variant="primary" onClick={onRetry}>
              Retry
            </Button>
          )}
          <Button size="sm" onClick={onDismiss}>
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
          icon: <UserRoundPlus className="h-4 w-4 text-ai-glint" />,
          headline: `Adding players… ${addedCount} of ${total}`,
          detail: 'Every pick lands with a note on why.',
        }
      : job.phase === 'ordering'
        ? {
            icon: <ArrowDownUp className="h-4 w-4 text-ai-glint" />,
            headline: 'Putting the board in order…',
            detail: 'Sorting the room into a ranking.',
          }
        : {
            icon: <Sparkles className="h-4 w-4 animate-pulse text-ai-glint" />,
            headline: 'Scouting players…',
            detail: 'FieldScout AI is working the film room — a few seconds.',
          }

  return (
    <div className="rounded-lg border border-ai-glint/25 bg-bg-elevated p-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-semibold">{headline}</p>
        <Loader2 className="ml-auto h-4 w-4 animate-spin text-text-tertiary" />
      </div>
      <p className="mt-1 text-xs text-text-secondary">{detail}</p>
      {job.phase === 'adding' && total > 0 && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-bg-elevated-2">
          <div
            className="h-full rounded-full bg-ai-glint transition-[width] duration-300"
            style={{ width: `${Math.round((addedCount / total) * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
