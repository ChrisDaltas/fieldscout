'use client'

import type { AiBuildJob } from '@/stores/ai-build-store'

import { LIcon } from './lists-parts'

/**
 * FieldScout Mobile — the AI build narration on a list being built (the desktop
 * `AiBuildBanner`, in the design's card language: b1 card, 13/600 over 11/500).
 */
export function AiBuildStrip({
  job,
  onRetry,
  onDismiss,
}: {
  job: AiBuildJob
  onRetry: () => void
  onDismiss: () => void
}) {
  if (job.phase === 'error') {
    return (
      <div className={job.blocked ? 'rounded-[14px] bg-m-b1 px-3.5 py-3' : 'rounded-[14px] bg-m-gr px-3.5 py-3'}>
        <p className={job.blocked ? 'text-[13px] font-semibold text-m-t1' : 'text-[13px] font-semibold text-m-tr'}>
          {job.blocked ? 'Out of AI generations for today' : 'AI build hit a snag'}
        </p>
        <p className="mt-1 text-[12px] font-medium leading-[1.4] text-m-t3">{job.error}</p>
        {job.blocked && (
          <p className="mt-1 text-[12px] font-medium leading-[1.4] text-m-t3">
            The list is still yours — add players by hand any time.
          </p>
        )}
        <div className="mt-2.5 flex gap-2">
          {!job.blocked && (
            <button
              type="button"
              onClick={onRetry}
              className="flex h-8 items-center rounded-pill bg-accent px-3.5 text-[13px] font-semibold text-white active:bg-accent-strong"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-8 items-center rounded-pill bg-m-b2 px-3.5 text-[13px] font-semibold text-m-t1 active:bg-m-b2h"
          >
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  const total = job.result?.players.length ?? job.request.player_count
  const added = job.addedIds.length
  const adding = job.phase === 'adding' && total > 0
  const pct = total > 0 ? Math.round((added / total) * 100) : 0
  const [headline, detail] =
    job.phase === 'adding'
      ? [`Adding players… ${added} of ${total}`, 'Every pick lands with a note on why.']
      : job.phase === 'ordering'
        ? ['Putting the board in order…', 'Sorting the room into a ranking.']
        : ['Scouting players…', 'FieldScout AI is working the film room — a few seconds.']

  return (
    <div className="rounded-[14px] bg-m-b1 px-3.5 py-3" role="status">
      <div className="flex items-center gap-2.5">
        <span
          className={
            job.phase === 'generating'
              ? 'flex size-8 flex-none animate-pulse items-center justify-center rounded-[9px] bg-accent text-white'
              : 'flex size-8 flex-none items-center justify-center rounded-[9px] bg-accent text-white'
          }
        >
          <LIcon name="sparkle" size={16} stroke={1.6} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] font-semibold tabular-nums text-m-t1">{headline}</span>
          <span className="text-[11px] font-medium text-m-t3">{detail}</span>
        </span>
        {adding && <span className="text-[11px] font-semibold tabular-nums text-m-t3">{pct}%</span>}
      </div>
      {adding && (
        <div className="mt-2.5 h-[3px] overflow-hidden rounded-pill bg-m-b2" aria-hidden>
          <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
