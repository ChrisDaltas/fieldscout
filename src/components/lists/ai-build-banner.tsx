'use client'

import { ScoutAiMark } from '@/components/ui/ai-insight'
import { Button } from '@/components/ui/button'
import { Icon, type IconName } from '@/components/ui/icon'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { AiBuildJob } from '@/stores/ai-build-store'

interface AiBuildBannerProps {
  job: AiBuildJob
  onRetry: () => void
  onDismiss: () => void
}

/**
 * Narrates the live AI build on the open list: scouting (the Claude call),
 * adding (players landing one by one), ordering (the sort pass), and the error
 * state with retry/dismiss. Scout AI surfaces are accent-blue, never lime.
 *
 * **v7 restyle.** CLAUDE.md → Redesign: *"AI list generation ... never leave
 * them in the old style, never remove them."* v7 has no AI-build screen, so this
 * is built from v7's own Scout AI language rather than invented: an AI panel is
 * a `rounded-2xl bg-surface-sunken` strip with no border and no shadow; the
 * shared `ScoutAiMark` blue tile carries the phase (its glyph changes); the
 * headline is 12px bold over an 11px grey phase line; the bar is the v7
 * `Progress` primitive (grey pill track, accent fill). A real failure swaps the
 * sunken fill for `bg-negative-soft`; a `blocked` job (today's allowance spent)
 * is a normal state and keeps the neutral strip.
 *
 * **No inline style in this file.** The handoff's critical note is that an
 * inline `background` outranks `:hover` and silently kills it; the progress
 * width now lives inside `ui/progress`, and `ai-surfaces.test.ts` pins that no
 * colour is ever written inline here.
 */
export function AiBuildBanner({ job, onRetry, onDismiss }: AiBuildBannerProps) {
  if (job.phase === 'error') {
    // `blocked` = retrying cannot help (today's AI allowance is spent). That
    // is a normal, non-punitive state, so it gets the neutral card rather
    // than the red one — and no Retry button to bounce off.
    return (
      <div
        className={cn(
          'rounded-2xl px-4 py-3',
          job.blocked ? 'bg-surface-sunken' : 'bg-negative-soft',
        )}
      >
        <div className="flex items-center gap-2">
          <Icon
            name="info-circle"
            size={14}
            className={job.blocked ? 'text-n-3' : 'text-negative-strong'}
          />
          <p className="text-[12px] font-bold text-ink">
            {job.blocked ? 'Out of AI generations for today' : 'AI build hit a snag'}
          </p>
        </div>
        <p className="mt-1 text-[11px] font-medium text-n-3">{job.error}</p>
        {job.blocked && (
          <p className="mt-1 text-[11px] font-medium text-n-3">
            The list is still yours — add players by hand any time.
          </p>
        )}
        <div className="mt-2.5 flex gap-2">
          {!job.blocked && (
            <Button size="sm" variant="blue" onClick={onRetry}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          )}
          {/* Quiet, not secondary: the grey `stroke` fill would vanish into
              the sunken strip it sits on. */}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    )
  }

  const total = job.result?.players.length ?? job.request.player_count
  const addedCount = job.addedIds.length
  const showProgress = job.phase === 'adding' && total > 0
  const pct = total > 0 ? Math.round((addedCount / total) * 100) : 0

  const { icon, headline, detail }: {
    icon: IconName
    headline: React.ReactNode
    detail: string
  } =
    job.phase === 'adding'
      ? {
          icon: 'plus-circle',
          headline: (
            <>
              Adding players… <span className="fs-num">{addedCount}</span> of{' '}
              <span className="fs-num">{total}</span>
            </>
          ),
          detail: 'Every pick lands with a note on why.',
        }
      : job.phase === 'ordering'
        ? {
            icon: 'sort',
            headline: 'Putting the board in order…',
            detail: 'Sorting the room into a ranking.',
          }
        : {
            icon: 'star',
            headline: 'Scouting players…',
            detail: 'FieldScout AI is working the film room — a few seconds.',
          }

  return (
    <div className="rounded-2xl bg-surface-sunken px-4 py-3">
      <div className="flex items-center gap-2.5">
        {/* The mark itself is the phase indicator — one accent square whose
            glyph changes, rather than a second icon beside a constant one. */}
        <ScoutAiMark
          icon={icon}
          size="sm"
          className={job.phase === 'generating' ? 'animate-pulse' : undefined}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold leading-tight text-ink">{headline}</p>
          <p className="mt-0.5 text-[11px] font-medium leading-snug text-n-3">{detail}</p>
        </div>
        {showProgress && (
          <span className="fs-num shrink-0 text-[10px] font-semibold text-n-6">{pct}%</span>
        )}
      </div>
      {showProgress && (
        <Progress
          value={pct}
          aria-label="Players added"
          className="mt-2.5"
          indicatorClassName="duration-300"
        />
      )}
    </div>
  )
}
