'use client'

import { ScoutAiMark } from '@/components/ui/ai-insight'
import { Button } from '@/components/ui/button'
import { Icon, type IconName } from '@/components/ui/icon'
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
 * **Restyled into the Lists v2 language at LV.5** — CLAUDE.md → Redesign:
 * *"AI list generation ... never leave them in the old style, never remove
 * them."* The design package has no reference screen for this surface, so it is
 * **derived from what LV.2/LV.3 built rather than invented**:
 *
 * - the square, ink-bordered card of `lists-page-v2.tsx`'s own state cards
 *   (`rounded-*` is 1px in this theme, so the old `rounded-sm` was never a
 *   visible corner — the frame is what carries the look);
 * - the explicit ×0.8 type scale those screens use — `text-[13px]` for the
 *   headline and `text-[11px]` for the detail, where this file used Tailwind's
 *   `text-sm` / `text-xs`;
 * - every count in `fs-num`, including the ones inside the headline sentence;
 * - the shared `ScoutAiMark`, which this file had drifted away from into a bare
 *   accent glyph;
 * - `Icon name="reset"` on Retry, matching the v2 error card's Try again.
 *
 * **The one inline style is a width, and it is data.** The handoff's critical
 * note is about resting/hover/active *colours* — an inline `background`
 * outranks `:hover` and silently kills it. There is no colour in an inline
 * style anywhere in this file, and `ai-surfaces.test.ts` pins that.
 */
export function AiBuildBanner({ job, onRetry, onDismiss }: AiBuildBannerProps) {
  if (job.phase === 'error') {
    // `blocked` = retrying cannot help (today's AI allowance is spent). That
    // is a normal, non-punitive state, so it gets the neutral card rather
    // than the red one — and no Retry button to bounce off.
    return (
      <div
        className={cn(
          'border p-card-pad',
          job.blocked ? 'border-ink bg-white' : 'border-negative-strong bg-negative-soft',
        )}
      >
        <div className="flex items-center gap-2">
          <Icon
            name="info-circle"
            size={14}
            className={job.blocked ? 'text-n-3' : 'text-negative-strong'}
          />
          <p className="text-[13px] font-bold text-ink">
            {job.blocked ? 'Out of AI generations for today' : 'AI build hit a snag'}
          </p>
        </div>
        <p className="mt-1.5 text-[11px] font-medium text-n-3">{job.error}</p>
        {job.blocked && (
          <p className="mt-1 text-[11px] font-medium text-n-3">
            The list is still yours — add players by hand any time.
          </p>
        )}
        <div className="mt-2.5 flex gap-2">
          {!job.blocked && (
            <Button size="sm" variant="blue" shadow onClick={onRetry}>
              <Icon name="reset" size={13} /> Retry
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
    <div className="border border-accent bg-accent-soft p-card-pad">
      <div className="flex items-center gap-2">
        {/* The mark itself is the phase indicator — one accent square whose
            glyph changes, rather than a second icon beside a constant one. */}
        <ScoutAiMark icon={icon} size="sm" className={job.phase === 'generating' ? 'animate-pulse' : undefined} />
        <p className="min-w-0 text-[13px] font-bold text-ink">{headline}</p>
        {showProgress && (
          <span className="fs-num ml-auto shrink-0 text-[11px] font-bold text-n-3">{pct}%</span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-n-3">{detail}</p>
      {showProgress && (
        <div className="mt-2.5 h-1.5 overflow-hidden border border-ink bg-white">
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
